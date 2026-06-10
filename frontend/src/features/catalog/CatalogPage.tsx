import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { EquipmentListItem, EquipmentType } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";

type Filtre = "tous" | EquipmentType | "externe";

const FILTRES: { value: Filtre; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "standard", label: "Standard" },
  { value: "vrac", label: "Vrac" },
  { value: "consommable", label: "Conso" },
  { value: "externe", label: "Externe" },
];

export function CatalogPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "Admin" || user?.role === "Staff";
  const [params, setParams] = useSearchParams();
  const [equipments, setEquipments] = useState<EquipmentListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initial = (params.get("type") as Filtre | null) ?? "tous";
  const [filtre, setFiltre] = useState<Filtre>(
    FILTRES.some((f) => f.value === initial) ? initial : "tous",
  );
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const eq = await api<EquipmentListItem[]>(
          archived ? "/equipments?archive=1" : "/equipments",
        );
        if (!active) return;
        setEquipments(eq);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? "Impossible de charger le parc matériel."
            : "Erreur réseau. Réessaie.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [archived]);

  function selectFiltre(f: Filtre) {
    setFiltre(f);
    if (f === "tous") setParams({});
    else setParams({ type: f });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return equipments.filter((e) => {
      if (filtre === "externe" && !e.externe) return false;
      if (filtre !== "tous" && filtre !== "externe" && e.type !== filtre) return false;
      if (q && !e.nom.toLowerCase().includes(q) && !e.barcode_uid.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [equipments, query, filtre]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Parc matériel</h1>
          <p className="text-sm text-fg-muted">
            {filtered.length} équipement{filtered.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/inventaire/rangement"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="account_tree" className="text-base" />
            Rangement
          </Link>
          <Link
            to="/etiquettes"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="print" className="text-base" />
            Étiquettes
          </Link>
        </div>
      </header>

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un nom ou un code-barres…"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTRES.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => selectFiltre(f.value)}
            data-on={filtre === f.value}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setArchived((v) => !v)}
          data-on={archived}
          className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev data-[on=true]:border-warning data-[on=true]:bg-warning/15 data-[on=true]:text-warning"
        >
          <Icon name="archive" className="text-sm" />
          <span>Locations archivées</span>
        </button>
      </div>

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}

      {error && !loading && (
        <p className="py-8 text-center text-sm text-danger">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="inventory_2" className="text-4xl" />
          <p className="text-sm">Aucun équipement trouvé.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="divide-y divide-line">
          {filtered.map((e) => (
            <li key={e.id}>
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
          ))}
        </ul>
      )}

      {canEdit && (
        <Link
          to="/inventaire/nouveau"
          className="fixed bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg shadow-lg"
          aria-label="Nouvel équipement"
        >
          <Icon name="add" className="text-2xl" />
        </Link>
      )}
    </div>
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
