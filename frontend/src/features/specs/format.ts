/** Normalise les espaces insécables que Intl insère avant l'unité ou le symbole. */
function normaliser(s: string): string {
  return s.replace(/[\u00a0\u202f]/g, " ");
}

/** « 1,5 » ou « 1.5 » → 1.5 ; vide → null ; invalide → NaN. */
export function parseNombre(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function formatNombre(n: number | null, unite?: string): string {
  if (n === null) return "—";
  const txt = normaliser(
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n),
  );
  return unite ? `${txt} ${unite}` : txt;
}

export function formatPrix(n: number | null): string {
  if (n === null) return "—";
  const decimales = Number.isInteger(n) ? 0 : 2;
  const txt = normaliser(
    new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(n),
  );
  return `${txt} €`;
}

export function formatConnectiques(
  list: { connecteur_nom: string; quantite: number }[],
): string {
  return list.map((c) => `${c.quantite}× ${c.connecteur_nom}`).join(", ");
}
