import { useMemo } from "react";
import { cheminDe, descendantsIds, enArbre } from "@/lib/categories";
import type { Categorie } from "@/lib/types";

/** Choix d'une catégorie dans l'arbre, en ordre d'arbre et libellée par son chemin
 *  (« Son › Ampli »). `exclure` retire une catégorie et ses descendantes (choix du
 *  parent : on ne range pas une catégorie dans elle-même). */
export function CategorieSelect({
  categories,
  value,
  onChange,
  exclure,
  vide = "—",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  categories: Categorie[];
  value: number | "";
  onChange: (id: number | "") => void;
  exclure?: number;
  vide?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const options = useMemo(() => {
    const exclus = exclure === undefined ? new Set<number>() : descendantsIds(categories, exclure);
    return enArbre(categories)
      .filter(({ categorie }) => !exclus.has(categorie.id))
      .map(({ categorie }) => ({ id: categorie.id, label: cheminDe(categories, categorie.id) }));
  }, [categories, exclure]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
    >
      <option value="">{vide}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
