import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { mergeEquipments, replaceEquipments } from "@/lib/equipmentMirror";
import type { EquipmentListItem, EquipmentType } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { EquipmentRow } from "@/features/equipment/EquipmentRow";

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
        // Alimente le miroir hors ligne au passage : la liste est déjà là.
        // Vue « archives » = liste partielle, donc fusion et non remplacement.
        void (archived ? mergeEquipments(eq) : replaceEquipments(eq));
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

  // Lien « voir les unités d'un modèle » (`?modele=<id>`, après une
  // création en série) : pas de filtre caché, on pré-remplit la recherche avec
  // le nom du modèle, que l'utilisateur voit et efface comme n'importe quelle saisie.
  const modeleParam = params.get("modele");
  useEffect(() => {
    if (!modeleParam || loading) return;
    const nom = equipments.find((e) => String(e.modele_id) === modeleParam)?.modele_nom;
    if (nom) setQuery(nom);
    const next = new URLSearchParams(params);
    next.delete("modele");
    setParams(next, { replace: true });
  }, [modeleParam, loading, equipments, params, setParams]);

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
      if (
        q &&
        !e.nom.toLowerCase().includes(q) &&
        !e.barcode_uid.toLowerCase().includes(q) &&
        !(e.modele_nom ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [equipments, query, filtre]);

  return (
    <div className="space-y-4">
      {/* Titre seul sur sa ligne, raccourcis en dessous : côte à côte, ils
          écrasaient le titre et débordaient sur mobile. */}
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Parc matériel</h1>
          <p className="text-sm text-fg-muted">
            {filtered.length} équipement{filtered.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className={`grid gap-2 ${canEdit ? "grid-cols-2" : "grid-cols-3"}`}>
          <Link
            to="/inventaire/rangement"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="account_tree" className="text-base" />
            Rangement
          </Link>
          <Link
            to="/modeles"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="category" className="text-base" />
            Modèles
          </Link>
          {canEdit && (
            <Link
              to="/referentiel"
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
            >
              <Icon name="tune" className="text-base" />
              Référentiel
            </Link>
          )}
          <Link
            to="/etiquettes"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="print" className="text-base" />
            Étiquettes
          </Link>
        </div>
      </header>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Nom, code-barres ou modèle…"
      />

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
          <span>Archives</span>
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
            <EquipmentRow key={e.id} item={e} />
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

