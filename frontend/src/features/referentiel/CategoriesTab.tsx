import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Categorie, ChampSpec, Modele, SousCategorie } from "@/lib/types";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { CategorieForm } from "./CategorieForm";
import { useCanManage } from "./shared";

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Liste des catégories, comme le Parc : recherche, lignes pleine largeur, chaque
 *  catégorie s'ouvre sur sa fiche (sous-catégories, champs, modèles). */
export function CategoriesTab() {
  const canManage = useCanManage();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [sousCats, setSousCats] = useState<SousCategorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [modeles, setModeles] = useState<Modele[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [cat, sc, ch, mod] = await Promise.all([
        api<Categorie[]>("/categories"),
        api<SousCategorie[]>("/sous-categories"),
        api<ChampSpec[]>("/champs-specification"),
        api<Modele[]>("/modeles"),
      ]);
      setCategories(cat);
      setSousCats(sc);
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

  const lignes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .map((c) => ({
        categorie: c,
        sousCats: sousCats.filter((s) => s.categorie_id === c.id),
        champs: champs.filter((x) => x.categorie_id === c.id),
        nbModeles: modeles.filter((m) => m.categorie_id === c.id).length,
      }))
      .filter(
        (l) =>
          !q ||
          [l.categorie.nom, l.categorie.description ?? ""]
            .concat(l.sousCats.map((s) => s.nom), l.champs.map((x) => x.nom))
            .some((t) => t.toLowerCase().includes(q)),
      );
  }, [categories, sousCats, champs, modeles, query]);

  return (
    <div className="space-y-4">
      {creating && canManage && (
        <div ref={formRef}>
          <CategorieForm
            initial={null}
            onCancel={() => setCreating(false)}
            onSaved={(c) => navigate(`/referentiel/categories/${c.id}`)}
          />
        </div>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Catégorie, sous-catégorie ou champ…"
        aria-label="Rechercher une catégorie"
      />

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && !loading && <p className="py-8 text-center text-sm text-danger">{error}</p>}
      {!loading && !error && lignes.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="tune" className="text-4xl" />
          <p className="text-sm">Aucune catégorie trouvée.</p>
        </div>
      )}

      {!loading && !error && lignes.length > 0 && (
        <ul className="divide-y divide-line">
          {lignes.map((l) => (
            <li key={l.categorie.id}>
              <Link
                to={`/referentiel/categories/${l.categorie.id}`}
                className="flex items-center gap-3.5 py-4 transition-opacity hover:opacity-70"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
                  <Icon name="folder" className="text-xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{l.categorie.nom}</p>
                    <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                      {pluriel(l.nbModeles, "modèle")}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-fg-muted">
                    {pluriel(l.sousCats.length, "sous-catégorie")} ·{" "}
                    {pluriel(l.champs.length, "champ")}
                    {l.categorie.description && ` · ${l.categorie.description}`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
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
