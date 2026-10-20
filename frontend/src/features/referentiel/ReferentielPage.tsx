import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "@/shared/Icon";
import { CategoriesTab } from "./CategoriesTab";
import { ConnecteursTab } from "./ConnecteursTab";

type Onglet = "categories" | "connecteurs";

/** Référentiel des spécifications : champs par catégorie et connecteurs.
 *  Staff modifie ; Tech consulte en lecture seule. */
export function ReferentielPage() {
  // Onglet dans l'URL : le retour depuis une fiche catégorie retrouve le bon onglet.
  const [params, setParams] = useSearchParams();
  const onglet: Onglet = params.get("onglet") === "connecteurs" ? "connecteurs" : "categories";
  const setOnglet = (o: Onglet) =>
    setParams(o === "categories" ? {} : { onglet: o }, { replace: true });

  return (
    <div className="space-y-4">
      <Link to="/inventaire" className="inline-flex items-center gap-1 text-sm text-fg-muted">
        <Icon name="arrow_back" className="text-base" /> Parc
      </Link>
      <h1 className="text-2xl font-bold">Référentiel</h1>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-bg-soft p-1">
        {(
          [
            ["categories", "Catégories"],
            ["connecteurs", "Connecteurs"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={onglet === id}
            onClick={() => setOnglet(id)}
            className={`h-9 rounded-lg text-sm font-medium ${
              onglet === id ? "bg-bg-elev text-fg" : "text-fg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {onglet === "categories" ? <CategoriesTab /> : <ConnecteursTab />}
    </div>
  );
}
