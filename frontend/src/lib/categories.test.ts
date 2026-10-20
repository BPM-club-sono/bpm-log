import { describe, expect, it } from "vitest";
import { ancetres, cheminDe, descendantsIds, enArbre, enfants } from "./categories";
import type { Categorie } from "./types";

const cat = (id: number, nom: string, parent_id: number | null): Categorie => ({
  id,
  nom,
  description: null,
  parent_id,
  chemin: null,
});

// Son > (Ampli > Classe D), Sub ; Lights
const CATS = [
  cat(1, "Son", null),
  cat(2, "Sub", 1),
  cat(3, "Ampli", 1),
  cat(4, "Classe D", 3),
  cat(5, "Lights", null),
];

describe("arbre des catégories", () => {
  it("liste les enfants directs, triés par nom", () => {
    expect(enfants(CATS, 1).map((c) => c.nom)).toEqual(["Ampli", "Sub"]);
    expect(enfants(CATS, null).map((c) => c.nom)).toEqual(["Lights", "Son"]);
  });

  it("remonte les ancêtres de la racine à la catégorie", () => {
    expect(ancetres(CATS, 4).map((c) => c.id)).toEqual([1, 3, 4]);
    expect(cheminDe(CATS, 4)).toBe("Son › Ampli › Classe D");
  });

  it("descend à toute profondeur", () => {
    expect([...descendantsIds(CATS, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...descendantsIds(CATS, 5)]).toEqual([5]);
  });

  it("ordonne en arbre avec le niveau", () => {
    expect(enArbre(CATS).map(({ categorie, niveau }) => `${niveau}:${categorie.nom}`)).toEqual([
      "0:Lights",
      "0:Son",
      "1:Ampli",
      "2:Classe D",
      "1:Sub",
    ]);
  });

  it("ne boucle pas sur un cycle", () => {
    const cycle = [cat(1, "A", 2), cat(2, "B", 1)];
    expect(ancetres(cycle, 1).map((c) => c.id)).toEqual([2, 1]);
  });
});
