import { Link } from "react-router-dom";
import type { Modele } from "@/lib/types";
import { Icon } from "@/shared/Icon";

/** Ligne de modèle des listes (Modèles, fiche catégorie) : ouvre la fiche du modèle. */
export function ModeleRow({ modele: m }: { modele: Modele }) {
  return (
    <li>
      <Link
        to={`/modeles/${m.id}`}
        className="flex items-center gap-3.5 py-4 transition-opacity hover:opacity-70"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
          <Icon name="category" className="text-xl" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium">
              {m.nom}
              {m.marque && <span className="text-fg-muted"> · {m.marque}</span>}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-fg-muted">
              {m.nb_unites ?? 0} unité{(m.nb_unites ?? 0) > 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-fg-muted">
            {[m.categorie_nom, m.sous_categorie_nom].filter(Boolean).join(" · ") ||
              "Sans catégorie"}
          </p>
        </div>
      </Link>
    </li>
  );
}
