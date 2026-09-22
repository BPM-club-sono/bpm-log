import type { Allocation } from "@/lib/types";

export interface LigneRapport {
  alloc: Allocation;
  /** Quantité manquante (sortie − retournée), au moins 1. */
  manquant: number;
}

export interface RapportCloture {
  perdus: LigneRapport[];
  casses: LigneRapport[];
  enSuspens: LigneRapport[];
  /** Nombre de lignes à signaler : une clôture « propre » en a zéro. */
  anomalies: number;
}

function manquant(a: Allocation): number {
  return Math.max(a.quantite_sortie - a.quantite_retournee, 1);
}

/**
 * Bilan d'une prestation clôturée, à partir des décisions prises à la clôture
 * (`decision_cloture`, posée par POST /prestations/{id}/cloture).
 *
 * Un écart sans décision (pointé après coup, ou allocation jamais tranchée)
 * compte comme laissé en suspens : il n'est pas réglé.
 */
export function rapportCloture(allocs: Allocation[]): RapportCloture {
  const perdus: LigneRapport[] = [];
  const casses: LigneRapport[] = [];
  const enSuspens: LigneRapport[] = [];
  for (const a of allocs) {
    const ecart = a.quantite_retournee < a.quantite_sortie;
    if (a.decision_cloture === "perdu") perdus.push({ alloc: a, manquant: manquant(a) });
    else if (a.decision_cloture === "casse") casses.push({ alloc: a, manquant: 1 });
    else if (a.decision_cloture === "ouvert" || ecart)
      enSuspens.push({ alloc: a, manquant: manquant(a) });
  }
  return {
    perdus,
    casses,
    enSuspens,
    anomalies: perdus.length + casses.length + enSuspens.length,
  };
}
