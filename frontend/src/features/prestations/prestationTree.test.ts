import { describe, expect, it } from "vitest";
import type { Allocation } from "@/lib/types";
import { buildAllocTree, current, target } from "./prestationTree";

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
