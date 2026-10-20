import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { ancetres, enArbre, SEPARATEUR } from "@/lib/categories";
import type { Categorie, ChampSpec, Modele } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { CategorieForm } from "./CategorieForm";
import { CategorieRow } from "./CategorieRow";
import { useCanManage } from "./shared";
import { statsCategories } from "./stats";

/** Arbre des catégories, comme le Parc : catégories principales, chevron pour déplier
 *  leurs sous-catégories. En recherche, liste à plat des correspondances, avec le
 *  chemin de leurs parentes. Chaque catégorie s'ouvre sur sa fiche. */
export function CategoriesTab() {
  const canManage = useCanManage();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [modeles, setModeles] = useState<Modele[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ouverts, setOuverts] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [cat, ch, mod] = await Promise.all([
        api<Categorie[]>("/categories"),
        api<ChampSpec[]>("/champs-specification"),
        api<Modele[]>("/modeles"),
      ]);
      setCategories(cat);
      setChamps(ch);
      setModeles(mod);
      setError(null);
    } catch {
      setError("Impossible de charger le référentiel.");
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

  const stats = useMemo(
    () => statsCategories(categories, champs, modeles),
    [categories, champs, modeles],
  );

  const q = query.trim().toLowerCase();

  // Arbre : une ligne n'est visible que si tous ses ancêtres sont dépliés.
  const lignesArbre = useMemo(() => {
    const parId = new Map(categories.map((c) => [c.id, c]));
    return enArbre(categories).filter(({ categorie }) => {
      for (let p = parId.get(categorie.parent_id ?? NaN); p; p = parId.get(p.parent_id ?? NaN)) {
        if (!ouverts.has(p.id)) return false;
      }
      return true;
    });
  }, [categories, ouverts]);

  const resultats = useMemo(() => {
    if (!q) return [];
    return enArbre(categories)
      .map(({ categorie }) => categorie)
      .filter((c) =>
        [c.nom, c.description ?? ""]
          .concat(champs.filter((x) => x.categorie_id === c.id).map((x) => x.nom))
          .some((t) => t.toLowerCase().includes(q)),
      );
  }, [categories, champs, q]);

  const basculer = (id: number) =>
    setOuverts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const vide = q ? resultats.length === 0 : categories.length === 0;

  return (
    <div className="space-y-4">
      {creating && canManage && (
        <div ref={formRef}>
          <CategorieForm
            initial={null}
            categories={categories}
            onCancel={() => setCreating(false)}
            onSaved={(c) => navigate(`/referentiel/categories/${c.id}`)}
          />
        </div>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Catégorie ou champ…"
        aria-label="Rechercher une catégorie"
      />

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && <p className="py-8 text-center text-sm text-danger">{error}</p>}
      {!loading && !error && vide && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="tune" className="text-4xl" />
          <p className="text-sm">Aucune catégorie trouvée.</p>
        </div>
      )}

      {!loading && !error && !vide && (
        <ul className="divide-y divide-line">
          {q
            ? resultats.map((c) => (
                <CategorieRow
                  key={c.id}
                  categorie={c}
                  stats={stats.get(c.id)}
                  surTitre={
                    ancetres(categories, c.id)
                      .slice(0, -1)
                      .map((a) => a.nom)
                      .join(SEPARATEUR) || undefined
                  }
                />
              ))
            : lignesArbre.map(({ categorie: c, niveau }) => {
                const aDesEnfants = (stats.get(c.id)?.enfants ?? 0) > 0;
                return (
                  <CategorieRow
                    key={c.id}
                    categorie={c}
                    stats={stats.get(c.id)}
                    niveau={niveau}
                    arbre
                    ouvert={aDesEnfants ? ouverts.has(c.id) : undefined}
                    onToggle={aDesEnfants ? () => basculer(c.id) : undefined}
                  />
                );
              })}
        </ul>
      )}

      {canManage && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="fixed bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg shadow-lg"
          aria-label="Nouvelle catégorie"
        >
          <Icon name="add" className="text-2xl" />
        </button>
      )}
    </div>
  );
}
