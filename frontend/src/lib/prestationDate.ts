// Dates de prestation : format + temporalité au **jour près**.
//
// Source unique de vérité pour l'affichage des dates et le calcul « à venir /
// en cours / passée », utilisée par la home et la liste des prestations. La
// temporalité est comparée au jour local de l'appareil — donc correcte
// hors-ligne, sans dépendre d'un calcul serveur qui se périme à minuit.
//
// Les dates arrivent du backend en chaînes ISO date `YYYY-MM-DD`.

export type Temporalite = "a_venir" | "en_cours" | "passee" | null;

/**
 * Parse une chaîne `YYYY-MM-DD` en Date locale à minuit.
 * On construit explicitement `new Date(y, m-1, d)` plutôt que `new Date(iso)`,
 * car `new Date("2026-06-12")` est interprété en UTC et décalerait d'un jour
 * dans les fuseaux à offset négatif.
 */
function parseJour(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Jour local d'aujourd'hui à minuit. */
function aujourdhui(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Ex. « 12 juin » (fr-FR). `null` si pas de date. */
export function formatJour(iso: string | null): string | null {
  const jour = parseJour(iso);
  if (!jour) return null;
  return jour.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

/** Ex. « 12 juin → 14 juin », ou une seule borne, ou `null`. */
export function formatPeriode(
  debut: string | null,
  fin: string | null,
): string | null {
  const d = formatJour(debut);
  const f = formatJour(fin);
  if (d && f) return d === f ? d : `${d} → ${f}`;
  return d ?? f;
}

/**
 * Temporalité d'un événement comparé à aujourd'hui (jour, local).
 * - deux bornes nulles → `null` (pas de date)
 * - aujourd'hui < début → `a_venir`
 * - début ≤ aujourd'hui ≤ fin (fin absente = ouvert → en cours si commencé) → `en_cours`
 * - aujourd'hui > fin → `passee`
 */
export function temporalite(
  debut: string | null,
  fin: string | null,
): Temporalite {
  const d = parseJour(debut);
  const f = parseJour(fin);
  if (!d && !f) return null;
  const t = aujourdhui().getTime();

  if (d && t < d.getTime()) return "a_venir";
  if (f && t > f.getTime()) return "passee";
  // Ici : pas avant le début, et pas après la fin.
  // - début posé et atteint → en cours (fin ouverte ou non encore dépassée)
  // - seule la fin est posée et non dépassée → encore à venir
  if (d) return "en_cours";
  return "a_venir";
}
