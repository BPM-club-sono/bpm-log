import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("affiche le libellé lisible pour un statut en panne", () => {
    render(<StatusBadge statut="En_Panne" />);
    expect(screen.getByText("En panne")).toBeInTheDocument();
  });

  it("applique la couleur de succès pour un équipement fonctionnel", () => {
    render(<StatusBadge statut="Fonctionnel" />);
    const badge = screen.getByText("Fonctionnel");
    expect(badge.className).toContain("text-success");
  });
});
