import type { Allocation, StatutPrestation } from "@/lib/types";

export const STATUT_LABEL: Record<StatutPrestation, string> = {
  Ebauche: "Ébauche",
  En_preparation: "En préparation",
  En_cours: "En cours",
  Terminee: "Terminée",
};

export const STATUT_STYLE: Record<StatutPrestation, string> = {
  Ebauche: "bg-fg-muted/15 text-fg-muted",
  En_preparation: "bg-warning/15 text-warning",
  En_cours: "bg-fg text-bg",
  Terminee: "bg-success/15 text-success",
};

/**
 * Statut déduit du pointage — miroir de `recalculer_statut` côté serveur
 * (backend/app/services/prestation_statut.py).
 *
 * Sert à l'affichage optimiste : hors-ligne, le serveur ne tranchera qu'à la
 * synchro, mais le badge doit suivre le pointage tout de suite. `Terminee` est
 * terminal : seules la clôture et la réouverture (en ligne) en sortent.
 */
export function derivePrestaStatut(
  allocs: Allocation[],
  statutActuel: StatutPrestation,
): StatutPrestation {
  if (statutActuel === "Terminee") return "Terminee";
  let prevu = 0;
  let sorti = 0;
  for (const a of allocs) {
    prevu += a.quantite;
    sorti += a.quantite_sortie;
  }
  if (sorti <= 0) return "Ebauche";
  if (prevu > 0 && sorti >= prevu) return "En_cours";
  return "En_preparation";
}
