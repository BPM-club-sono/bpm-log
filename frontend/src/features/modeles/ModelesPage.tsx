import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Categorie, Modele } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { ModeleForm } from "./ModeleForm";
import { ModeleRow } from "./ModeleRow";

/** Filtre de catégorie : id, « aucune » (modèles sans catégorie) ou tous. */
type Filtre = "tous" | "aucune" | number;

function lireFiltre(v: string | null): Filtre {
  if (v === "aucune") return "aucune";
  const n = Number(v);
  return v && Number.isInteger(n) ? n : "tous";
}

/** Modèles d'équipement (MH-100…) : recherche et filtre par catégorie, comme le
 *  Parc. Un modèle s'ouvre sur sa fiche (infos, spécifications, unités). */
export function ModelesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = user?.role === "Admin" || user?.role === "Staff";
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<Modele[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const filtre = lireFiltre(params.get("categorie"));
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [mod, cat] = await Promise.all([
        api<Modele[]>("/modeles"),
        api<Categorie[]>("/categories"),
      ]);
      setItems(mod);
      setCategories(cat);
      setError(null);
    } catch {
      setError("Impossible de charger les modèles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (creating) formRef.current?.scrollIntoView({ block: "start" });
  }, [creating]);

  function selectFiltre(f: Filtre) {
    setParams(f === "tous" ? {} : { categorie: String(f) }, { replace: true });
  }

  const sansCategorie = items.some((m) => m.categorie_id == null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filtre === "aucune" && m.categorie_id != null) return false;
      if (typeof filtre === "number" && m.categorie_id !== filtre) return false;
      if (
        q &&
        !m.nom.toLowerCase().includes(q) &&
        !(m.marque ?? "").toLowerCase().includes(q) &&
        !(m.sous_categorie_nom ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [items, query, filtre]);

  return (
    <div className="space-y-4">
      <Link to="/inventaire" className="inline-flex items-center gap-1 text-sm text-fg-muted">
        <Icon name="arrow_back" className="text-base" /> Parc
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Modèles</h1>
        <p className="text-sm text-fg-muted">
          {filtered.length} modèle{filtered.length > 1 ? "s" : ""}
        </p>
      </header>

      {creating && canManage && (
        <div ref={formRef}>
          <ModeleForm
            initial={null}
            categories={categories}
            onCancel={() => setCreating(false)}
            onSaved={(m) => navigate(`/modeles/${m.id}`)}
          />
        </div>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Nom, marque ou sous-catégorie…"
        aria-label="Rechercher un modèle"
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Catégorie">
        {[
          { value: "tous" as Filtre, label: "Tous" },
          ...categories.map((c) => ({ value: c.id as Filtre, label: c.nom })),
          ...(sansCategorie ? [{ value: "aucune" as Filtre, label: "Sans catégorie" }] : []),
        ].map((f) => (
          <button
            key={String(f.value)}
            type="button"
            onClick={() => selectFiltre(f.value)}
            data-on={filtre === f.value}
            aria-pressed={filtre === f.value}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && <p className="py-8 text-center text-sm text-danger">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="category" className="text-4xl" />
          <p className="text-sm">Aucun modèle trouvé.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="divide-y divide-line">
          {filtered.map((m) => (
            <ModeleRow key={m.id} modele={m} />
          ))}
        </ul>
      )}

      {canManage && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="fixed bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg shadow-lg"
          aria-label="Nouveau modèle"
        >
          <Icon name="add" className="text-2xl" />
        </button>
      )}
    </div>
  );
}
