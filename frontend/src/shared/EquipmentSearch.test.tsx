import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EquipmentListItem } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

const { api } = await import("@/lib/api");
const { EquipmentSearch } = await import("./EquipmentSearch");

function eq(id: number, nom: string): EquipmentListItem {
  return {
    id,
    barcode_uid: `BPM-${String(id).padStart(6, "0")}`,
    nom,
    categorie_id: null,
    categorie_nom: null,
    emplacement_id: null,
    emplacement_nom: null,
    statut_actuel: "Fonctionnel",
    photo_url: null,
    type: "standard",
    externe: false,
    vrac: null,
    conso: null,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function Harness(props: {
  onSelect?: (e: EquipmentListItem) => void;
  excludeIds?: Set<number>;
  emptyHint?: string;
}) {
  const [q, setQ] = useState("");
  return (
    <EquipmentSearch
      value={q}
      onChange={setQ}
      onSelect={props.onSelect ?? (() => {})}
      excludeIds={props.excludeIds}
      emptyHint={props.emptyHint}
      placeholder="Chercher du matériel…"
    />
  );
}

function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Chercher du matériel…"), {
    target: { value: text },
  });
}

describe("EquipmentSearch", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    setOnline(true);
  });

  it("interroge l'API et propose les résultats", async () => {
    vi.mocked(api).mockResolvedValue([eq(1, "Enceinte L"), eq(2, "Enceinte R")]);
    render(<Harness />);
    type("enceinte");

    expect(await screen.findByText("Enceinte L")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/equipments?q=enceinte");
  });

  it("remonte l'équipement choisi", async () => {
    const onSelect = vi.fn();
    vi.mocked(api).mockResolvedValue([eq(1, "Enceinte L")]);
    render(<Harness onSelect={onSelect} />);
    type("enc");

    fireEvent.click(await screen.findByText("Enceinte L"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("écarte les équipements exclus", async () => {
    vi.mocked(api).mockResolvedValue([eq(1, "Enceinte L"), eq(2, "Enceinte R")]);
    render(<Harness excludeIds={new Set([1])} />);
    type("enceinte");

    expect(await screen.findByText("Enceinte R")).toBeInTheDocument();
    expect(screen.queryByText("Enceinte L")).not.toBeInTheDocument();
  });

  it("ne cherche pas hors ligne et affiche l'indication", async () => {
    setOnline(false);
    render(<Harness emptyHint="Inconnu en ligne" />);
    type("BPM-000001");

    expect(screen.getByText("Inconnu en ligne")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(api).not.toHaveBeenCalled();
  });

  it("ignore une réponse arrivée après une nouvelle frappe", async () => {
    let resolveFirst: (v: EquipmentListItem[]) => void = () => {};
    vi.mocked(api)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([eq(2, "Console")]);
    render(<Harness />);
    type("enc");
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    type("con");
    expect(await screen.findByText("Console")).toBeInTheDocument();

    resolveFirst([eq(1, "Enceinte L")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Enceinte L")).not.toBeInTheDocument();
  });
});
