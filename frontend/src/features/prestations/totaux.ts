/** « 3 items sans poids » ; null quand rien ne manque. */
export function libelleManquants(nb: number, quoi: "poids" | "prix"): string | null {
  if (nb <= 0) return null;
  return `${nb} item${nb > 1 ? "s" : ""} sans ${quoi}`;
}
