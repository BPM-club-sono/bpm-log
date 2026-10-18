import { describe, expect, it } from "vitest";
import type { Allocation } from "@/lib/types";
import {
  buildAllocTree,
  current,
  fournisseurChips,
  grouperParModele,
  target,
} from "./prestationTree";

function alloc(
  id: number,
  equipment_id: number,
  opts: Partial<Allocation> = {},
): Allocation {
  return {
    id,
    presta_id: 1,
    equipment_id,
    quantite: 1,
    quantite_sortie: 0,
    quantite_retournee: 0,
    statut: "Planifie",
    equipment_nom: `eq-${equipment_id}`,
    equipment_barcode: `bc-${equipment_id}`,
    ...opts,
  };
}

const ids = (list: Allocation[]) => list.map((a) => a.id).sort((x, y) => x - y);

describe("buildAllocTree", () => {
  it("liste plate : tout est racine, aucun descendant", () => {
    const allocs = [alloc(1, 10), alloc(2, 20)];
    const { topLevel, descendantsOf } = buildAllocTree(allocs);
    expect(ids(topLevel)).toEqual([1, 2]);
    expect(descendantsOf(allocs[0])).toEqual([]);
  });

  it("flight à un niveau : le contenant est racine, les enfants sont ses descendants", () => {
    const flight = alloc(1, 10);
    const a = alloc(2, 20, { equipment_contenant_id: 10 });
    const b = alloc(3, 30, { equipment_contenant_id: 10 });
    const { topLevel, descendantsOf } = buildAllocTree([flight, a, b]);
    expect(ids(topLevel)).toEqual([1]);
    expect(ids(descendantsOf(flight))).toEqual([2, 3]);
  });

  it("flight imbriqué : les petits-enfants sont inclus dans les descendants", () => {
    const root = alloc(1, 10);
    const sub = alloc(2, 20, { equipment_contenant_id: 10 });
    const leaf = alloc(3, 30, { equipment_contenant_id: 20 });
    const { topLevel, descendantsOf } = buildAllocTree([root, sub, leaf]);
    expect(ids(topLevel)).toEqual([1]);
    expect(ids(descendantsOf(root))).toEqual([2, 3]);
    expect(ids(descendantsOf(sub))).toEqual([3]);
  });

  it("contenant absent : les enfants remontent en racine", () => {
    // L'allocation du contenant (equipment_id 10) n'est pas dans la liste.
    const a = alloc(2, 20, { equipment_contenant_id: 10 });
    const b = alloc(3, 30, { equipment_contenant_id: 10 });
    const { topLevel } = buildAllocTree([a, b]);
    expect(ids(topLevel)).toEqual([2, 3]);
  });

  it("ne boucle pas sur un cycle", () => {
    const a = alloc(1, 10, { equipment_contenant_id: 20 });
    const b = alloc(2, 20, { equipment_contenant_id: 10 });
    const { descendantsOf } = buildAllocTree([a, b]);
    // Pas de top-level (chacun a un parent présent), mais descendantsOf termine.
    expect(ids(descendantsOf(a))).toEqual([2]);
  });
});

describe("fournisseurChips", () => {
  const externe = (id: number, fid: number, fnom: string | null) =>
    alloc(id, id * 10, {
      equipment_externe: true,
      fournisseur_id: fid,
      fournisseur_nom: fnom,
    });

  it("ignore le matériel BPM (non externe)", () => {
    const chips = fournisseurChips([alloc(1, 10), externe(2, 5, "Trocadéro")]);
    expect(chips).toEqual([{ id: 5, nom: "Trocadéro" }]);
  });

  it("dédoublonne par fournisseur_id et trie par nom", () => {
    const chips = fournisseurChips([
      externe(1, 7, "SoundLight"),
      externe(2, 5, "Trocadéro"),
      externe(3, 5, "Trocadéro"),
    ]);
    expect(chips).toEqual([
      { id: 7, nom: "SoundLight" },
      { id: 5, nom: "Trocadéro" },
    ]);
  });

  it("repli « Location » quand le nom manque", () => {
    const chips = fournisseurChips([externe(1, 9, null)]);
    expect(chips).toEqual([{ id: 9, nom: "Location" }]);
  });

  it("ignore un externe sans fournisseur_id", () => {
    const chips = fournisseurChips([
      alloc(1, 10, { equipment_externe: true, fournisseur_id: null }),
    ]);
    expect(chips).toEqual([]);
  });
});

describe("current / target", () => {
  const a = alloc(1, 10, { quantite: 3, quantite_sortie: 2, quantite_retournee: 1 });

  it("sortie : courant = quantite_sortie, objectif = quantite", () => {
    expect(current(a, "sortie")).toBe(2);
    expect(target(a, "sortie")).toBe(3);
  });

  it("retour : courant = quantite_retournee, objectif = quantite_sortie", () => {
    expect(current(a, "retour")).toBe(1);
    expect(target(a, "retour")).toBe(2);
  });
});

describe("grouperParModele", () => {
  const mh = { equipment_modele_id: 7, equipment_modele_nom: "MH-100", equipment_modele_marque: "Robe" };

  it("regroupe à partir de 2 unités d'un même modèle, unités triées par nom", () => {
    const allocs = [
      alloc(1, 10, { ...mh, equipment_nom: "MH 10" }),
      alloc(2, 20, { ...mh, equipment_nom: "MH 2" }),
      alloc(3, 30, { equipment_modele_id: 8, equipment_modele_nom: "H30V" }),
      alloc(4, 40),
    ];
    const groupes = grouperParModele(allocs);
    expect(groupes).toHaveLength(1);
    expect(groupes[0]).toMatchObject({ modeleId: 7, nom: "MH-100", marque: "Robe" });
    expect(groupes[0].unites.map((a) => a.equipment_nom)).toEqual(["MH 2", "MH 10"]);
  });

  it("compte aussi les unités rangées dans un flight et les locations", () => {
    const allocs = [
      alloc(1, 10, { ...mh }),
      alloc(2, 99, { equipment_nom: "Flight MH" }),
      alloc(3, 30, { ...mh, equipment_contenant_id: 99 }),
      alloc(4, 40, { ...mh, equipment_externe: true, fournisseur_id: 5 }),
    ];
    expect(ids(grouperParModele(allocs)[0].unites)).toEqual([1, 3, 4]);
  });

  it("trie les groupes par nom de modèle", () => {
    const allocs = [
      alloc(1, 10, { equipment_modele_id: 2, equipment_modele_nom: "Spot" }),
      alloc(2, 20, { equipment_modele_id: 2, equipment_modele_nom: "Spot" }),
      alloc(3, 30, { ...mh }),
      alloc(4, 40, { ...mh }),
    ];
    expect(grouperParModele(allocs).map((g) => g.nom)).toEqual(["MH-100", "Spot"]);
  });
});
