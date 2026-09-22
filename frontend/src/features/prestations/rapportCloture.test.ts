import { describe, expect, it } from "vitest";
import type { Allocation, ClotureDecision } from "@/lib/types";
import { rapportCloture } from "./rapportCloture";

function alloc(
  id: number,
  sortie: number,
  retournee: number,
  decision_cloture: ClotureDecision | null = null,
): Allocation {
  return {
    id,
    presta_id: 1,
    equipment_id: id,
    quantite: sortie,
    quantite_sortie: sortie,
    quantite_retournee: retournee,
    statut: "Retourne",
    decision_cloture,
    equipment_nom: `eq${id}`,
    equipment_barcode: null,
  };
}

describe("rapportCloture", () => {
  it("ne signale rien quand tout est rentré", () => {
    const r = rapportCloture([alloc(1, 2, 2), alloc(2, 1, 1, "retourne")]);
    expect(r.anomalies).toBe(0);
  });

  it("classe perdus, cassés et laissés en suspens", () => {
    const r = rapportCloture([
      alloc(1, 1, 0, "perdu"),
      alloc(2, 1, 1, "casse"),
      alloc(3, 5, 2, "ouvert"),
      alloc(4, 1, 1, "retourne"),
    ]);
    expect(r.perdus.map((l) => l.alloc.id)).toEqual([1]);
    expect(r.casses.map((l) => l.alloc.id)).toEqual([2]);
    expect(r.enSuspens).toEqual([{ alloc: expect.objectContaining({ id: 3 }), manquant: 3 }]);
    expect(r.anomalies).toBe(3);
  });

  it("compte un écart sans décision comme en suspens", () => {
    const r = rapportCloture([alloc(1, 4, 1)]);
    expect(r.enSuspens).toEqual([{ alloc: expect.objectContaining({ id: 1 }), manquant: 3 }]);
  });

  it("donne la quantité perdue d'un lot", () => {
    const r = rapportCloture([alloc(1, 10, 7, "perdu")]);
    expect(r.perdus[0].manquant).toBe(3);
  });
});
