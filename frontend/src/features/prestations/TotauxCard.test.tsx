import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TotauxPresta } from "@/lib/types";
import { TotauxCard } from "./TotauxCard";

const base: TotauxPresta = {
  tarif: "interne",
  fige: false,
  poids_total: 25,
  nb_sans_poids: 0,
  prix_total: 60,
  nb_sans_prix: 0,
  connectiques: [],
};

describe("TotauxCard", () => {
  it("ne rend rien pour un détail en cache sans totaux", () => {
    const { container } = render(<TotauxCard totaux={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche les totaux sans badge partiel ni Entrées quand tout est renseigné", () => {
    render(<TotauxCard totaux={base} />);
    expect(screen.getByTestId("totaux-poids")).toHaveTextContent("25 kg");
    expect(screen.getByTestId("totaux-prix")).toHaveTextContent("60 €");
    expect(screen.queryByText("partiel")).not.toBeInTheDocument();
    expect(screen.queryByText("Entrées")).not.toBeInTheDocument();
    expect(screen.queryByText("Figé à la clôture")).not.toBeInTheDocument();
  });

  it("signale un total partiel quand des unités n'ont pas de poids", () => {
    render(<TotauxCard totaux={{ ...base, nb_sans_poids: 2 }} />);
    expect(screen.getByText("partiel")).toBeInTheDocument();
  });

  it("indique les totaux figés et affiche les entrées", () => {
    render(
      <TotauxCard
        totaux={{
          ...base,
          fige: true,
          connectiques: [
            { connecteur_id: 1, connecteur_nom: "PowerCon", sens: "entree", quantite: 3 },
          ],
        }}
      />,
    );
    expect(screen.getByText("Figé à la clôture")).toBeInTheDocument();
    expect(screen.getByTestId("totaux-entrees")).toHaveTextContent("PowerCon");
  });
});
