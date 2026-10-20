import { Link } from "react-router-dom";
import type { EquipmentListItem } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";

/** Ligne d'équipement des listes (Parc, fiche modèle) : vignette, nom, statut, aperçu. */
export function EquipmentRow({ item: e }: { item: EquipmentListItem }) {
  return (
    <li>
      <Link
        to={`/inventaire/${e.id}`}
        className="flex gap-3.5 py-4 transition-opacity hover:opacity-70"
      >
        {e.photo_url ? (
          <img
            src={e.photo_url}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
            <Icon name="inventory_2" className="text-xl" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium">{e.nom}</p>
            <StatusBadge statut={e.statut_actuel} />
          </div>
          <p className="font-mono text-xs text-fg-muted">{e.barcode_uid}</p>
          <Preview item={e} />
        </div>
      </Link>
    </li>
  );
}

function Preview({ item }: { item: EquipmentListItem }) {
  if (item.vrac) {
    const v = item.vrac;
    return (
      <p className="mt-1 text-xs text-fg-muted">
        <span className="font-semibold tabular-nums text-fg">{v.quantite_actuelle}</span>
        /{v.quantite_theorique}
        {v.ecart !== 0 && (
          <span className={v.ecart > 0 ? "text-success" : "text-danger"}>
            {" "}
            ({v.ecart > 0 ? `+${v.ecart}` : v.ecart})
          </span>
        )}
        {v.locked && (
          <span className="ml-1">
            <Icon name="lock" className="text-sm align-middle" />
          </span>
        )}
      </p>
    );
  }
  if (item.conso) {
    const c = item.conso;
    return (
      <p className="mt-1 text-xs text-fg-muted">
        <span
          className={`font-semibold tabular-nums ${c.en_alerte ? "text-danger" : "text-fg"}`}
        >
          {c.stock_actuel}
        </span>
        {c.unite ? ` ${c.unite}` : ""} · seuil {c.seuil_alerte}
        {c.en_alerte && <span className="ml-1 font-medium text-danger">⚠</span>}
      </p>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
      {item.modele_nom && (
        <span className="inline-flex items-center gap-1 font-medium text-fg">
          {item.modele_nom}
        </span>
      )}
      {item.categorie_nom && (
        <span className="inline-flex items-center gap-1">
          <Icon name="category" className="text-sm" />
          {item.categorie_nom}
        </span>
      )}
      {(item.contenant_nom || item.emplacement_nom) && (
        <span className="inline-flex items-center gap-1">
          <Icon
            name={item.contenant_nom ? "inventory_2" : "location_on"}
            className="text-sm"
          />
          {item.contenant_nom ?? item.emplacement_nom}
        </span>
      )}
      {item.externe && (
        <span className="inline-flex items-center gap-1 text-warning">
          <Icon name="local_shipping" className="text-sm" />
          Externe
        </span>
      )}
    </div>
  );
}
