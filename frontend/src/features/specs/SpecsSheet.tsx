import type { Specs, ValeurSpec } from "@/lib/types";
import { formatConnectiques, formatNombre, formatPrix } from "./format";

function valeurTexte(v: ValeurSpec): string | null {
  if (v.valeur === null || v.valeur === "") return null;
  if (v.type === "oui_non") return v.valeur === "true" ? "Oui" : "Non";
  if (v.type === "nombre") {
    const n = Number(v.valeur.replace(",", "."));
    return Number.isNaN(n) ? v.valeur : formatNombre(n, v.unite ?? undefined);
  }
  return v.unite ? `${v.valeur} ${v.unite}` : v.valeur;
}

/** Fiche technique en lecture seule ; les sections vides sont masquées. */
export function SpecsSheet({ specs }: { specs: Specs }) {
  const lignes: [string, string][] = [];
  if (specs.poids !== null) lignes.push(["Poids", formatNombre(specs.poids, "kg")]);
  if (specs.longueur !== null || specs.largeur !== null || specs.hauteur !== null) {
    const d = (n: number | null) => (n === null ? "—" : formatNombre(n));
    lignes.push([
      "Dimensions",
      `${d(specs.longueur)} × ${d(specs.largeur)} × ${d(specs.hauteur)} cm`,
    ]);
  }
  if (specs.prix_interne !== null) lignes.push(["Prix interne", formatPrix(specs.prix_interne)]);
  if (specs.prix_externe !== null) lignes.push(["Prix externe", formatPrix(specs.prix_externe)]);
  for (const v of specs.valeurs) {
    const t = valeurTexte(v);
    if (t !== null) lignes.push([v.nom, t]);
  }
  const entrees = specs.connectiques.filter((c) => c.sens === "entree");
  const sorties = specs.connectiques.filter((c) => c.sens === "sortie");
  if (entrees.length) lignes.push(["Entrées", formatConnectiques(entrees)]);
  if (sorties.length) lignes.push(["Sorties", formatConnectiques(sorties)]);

  if (lignes.length === 0) {
    return <p className="text-sm text-fg-muted">Aucune spécification</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {lignes.map(([label, valeur]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}
