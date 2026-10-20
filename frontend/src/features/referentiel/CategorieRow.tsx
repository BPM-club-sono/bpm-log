import { Link } from "react-router-dom";
import type { Categorie } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { pluriel } from "./shared";
import type { StatsCategorie } from "./stats";

/** Ligne d'une catégorie, comme le Parc : s'ouvre sur sa fiche. Dans l'arbre, un
 *  chevron déplie ses sous-catégories et `niveau` décale la ligne. */
export function CategorieRow({
  categorie,
  stats,
  niveau = 0,
  arbre = false,
  ouvert,
  onToggle,
  surTitre,
}: {
  categorie: Categorie;
  stats: StatsCategorie | undefined;
  niveau?: number;
  /** Vue arbre : réserve la place du chevron pour aligner les lignes. */
  arbre?: boolean;
  /** Défini seulement si la catégorie a des enfants et qu'on peut la déplier. */
  ouvert?: boolean;
  onToggle?: () => void;
  /** Ex. le chemin des parents, en recherche. */
  surTitre?: string;
}) {
  const s = stats ?? { enfants: 0, champs: 0, champsTotal: 0, modeles: 0 };
  const details = [
    s.enfants > 0 && pluriel(s.enfants, "sous-catégorie"),
    pluriel(s.champsTotal, "champ"),
    categorie.description,
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-1" style={{ paddingLeft: `${niveau * 1.25}rem` }}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={ouvert}
          aria-label={`${ouvert ? "Replier" : "Déplier"} ${categorie.nom}`}
          className="flex h-10 w-8 shrink-0 items-center justify-center text-fg-muted"
        >
          <Icon
            name="chevron_right"
            className={`text-xl transition-transform ${ouvert ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        arbre && <span className="w-8 shrink-0" aria-hidden />
      )}
      <Link
        to={`/referentiel/categories/${categorie.id}`}
        className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 transition-opacity hover:opacity-70"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
          <Icon name={s.enfants > 0 ? "folder_open" : "folder"} className="text-xl" />
        </div>
        <div className="min-w-0 flex-1">
          {surTitre && <p className="truncate text-xs text-fg-muted">{surTitre}</p>}
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium">{categorie.nom}</p>
            <span className="shrink-0 text-xs tabular-nums text-fg-muted">
              {pluriel(s.modeles, "modèle")}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">{details.join(" · ")}</p>
        </div>
      </Link>
    </li>
  );
}
