import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { mergeEquipments } from "@/lib/equipmentMirror";

const navigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

// La caméra n'existe pas en jsdom : la saisie manuelle emprunte le même
// `resolve()`, c'est elle qu'on pilote.
vi.mock("./QrScanner", () => ({ QrScanner: () => <div data-testid="scanner" /> }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

const { api } = await import("@/lib/api");
const { ScanPage } = await import("./ScanPage");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function scan(code: string) {
  fireEvent.change(screen.getByPlaceholderText("BPM-000001"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Chercher" }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScanPage />
    </MemoryRouter>,
  );
}

describe("ScanPage", () => {
  beforeEach(async () => {
    await db.equipments.clear();
    navigate.mockReset();
    vi.mocked(api).mockReset();
    // Le montage rafraîchit le miroir : par défaut, l'API ne renvoie rien.
    vi.mocked(api).mockResolvedValue([]);
    setOnline(true);
  });

  it("en ligne : le serveur fait foi et on ouvre la fiche", async () => {
    renderPage();
    vi.mocked(api).mockResolvedValue({ id: 42, barcode_uid: "BPM-LUM-0001" });

    scan("BPM-LUM-0001");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/inventaire/42"));
  });

  it("en ligne : un 404 reste « inconnu dans le parc »", async () => {
    renderPage();
    vi.mocked(api).mockRejectedValue(new ApiError(404, "nope"));

    scan("BPM-999999");

    expect(await screen.findByText(/inconnu dans le parc/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hors ligne : un code mirroré donne la carte locale, sans réseau", async () => {
    await mergeEquipments([
      {
        id: 7,
        barcode_uid: "BPM-LUM-0001",
        nom: "Lyre Beam 7R",
        statut_actuel: "En_Panne",
      },
    ]);
    renderPage();
    await screen.findByText(/1 équipements disponibles hors ligne/);
    vi.mocked(api).mockClear();
    setOnline(false);

    scan("BPM-LUM-0001");

    expect(await screen.findByText("Lyre Beam 7R")).toBeInTheDocument();
    expect(screen.getByText("BPM-LUM-0001")).toBeInTheDocument();
    expect(screen.getByText("En panne")).toBeInTheDocument();
    expect(screen.getByText(/données du dernier passage en ligne/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByText(/Erreur réseau/)).not.toBeInTheDocument();
  });

  it("hors ligne : un code absent du miroir ne se fait pas passer pour un 404", async () => {
    renderPage();
    setOnline(false);

    scan("BPM-999999");

    expect(await screen.findByText(/absent du parc préchargé/)).toBeInTheDocument();
    expect(screen.queryByText(/inconnu dans le parc/)).not.toBeInTheDocument();
  });

  it("réseau en échec malgré navigator.onLine : le miroir prend le relais", async () => {
    await mergeEquipments([
      {
        id: 9,
        barcode_uid: "BPM-SON-0001",
        nom: "Ampli Crown XTi 6002",
        statut_actuel: "Fonctionnel",
      },
    ]);
    renderPage();
    await screen.findByText(/1 équipements disponibles hors ligne/);
    // `navigator.onLine` reste vrai (wifi capté sans internet), mais l'appel casse.
    vi.mocked(api).mockRejectedValue(new TypeError("Failed to fetch"));

    scan("BPM-SON-0001");

    expect(await screen.findByText("Ampli Crown XTi 6002")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("réseau en échec et miroir vide : erreur réseau explicite", async () => {
    renderPage();
    vi.mocked(api).mockRejectedValue(new TypeError("Failed to fetch"));

    scan("BPM-SON-0001");

    expect(await screen.findByText(/Erreur réseau/)).toBeInTheDocument();
  });

  it("annonce que le parc n'est pas disponible hors ligne quand le miroir est vide", async () => {
    renderPage();

    expect(
      await screen.findByText(/Parc non disponible hors ligne/),
    ).toBeInTheDocument();
  });
});
