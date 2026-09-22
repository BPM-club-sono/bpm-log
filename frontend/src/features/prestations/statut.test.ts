import { describe, expect, it } from "vitest";
import type { Allocation } from "@/lib/types";
import { derivePrestaStatut } from "./statut";

function alloc(quantite: number, quantite_sortie: number): Allocation {
  return {
    id: 1,
    presta_id: 1,
    equipment_id: 1,
    quantite,
    quantite_sortie,
    quantite_retournee: 0,
    statut: "Planifie",
    equipment_nom: "eq",
    equipment_barcode: "bc",
  };
}

describe("derivePrestaStatut", () => {
  it("reste en ébauche tant que rien n'est sorti", () => {
    expect(derivePrestaStatut([], "Ebauche")).toBe("Ebauche");
    expect(derivePrestaStatut([alloc(2, 0), alloc(1, 0)], "Ebauche")).toBe("Ebauche");
  });

  it("passe en préparation au premier élément sorti", () => {
    expect(derivePrestaStatut([alloc(2, 1), alloc(1, 0)], "Ebauche")).toBe(
      "En_preparation",
    );
  });

  it("passe en cours quand tout le prévu est sorti", () => {
    expect(derivePrestaStatut([alloc(2, 2), alloc(1, 1)], "En_preparation")).toBe(
      "En_cours",
    );
  });

  it("redescend quand on dé-pointe ou qu'on ajoute une ligne", () => {
    expect(derivePrestaStatut([alloc(1, 0)], "En_cours")).toBe("Ebauche");
    expect(derivePrestaStatut([alloc(1, 1), alloc(1, 0)], "En_cours")).toBe(
      "En_preparation",
    );
  });

  it("ne sort jamais de l'état terminal", () => {
    expect(derivePrestaStatut([alloc(1, 1)], "Terminee")).toBe("Terminee");
    expect(derivePrestaStatut([], "Terminee")).toBe("Terminee");
  });
});
