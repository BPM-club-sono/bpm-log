import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Categorie, Modele } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { CategorieSelect } from "@/shared/CategorieSelect";

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 300;

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

interface ModeleFieldProps {
  value: Modele | null;
  onChange: (modele: Modele | null) => void;
  categories: Categorie[];
  required?: boolean;
}

/** Choix du modèle d'un équipement (MH-100…) : recherche, ou création sur place.
 *
 *  Le nom saisi est le nom créé, tel quel : pas de rapprochement « MH100 » /
 *  « MH-100 », on attend des noms de modèle propres. */
export function ModeleField({ value, onChange, categories, required }: ModeleFieldProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Modele[]>([]);
  const [creating, setCreating] = useState(false);
  const [marque, setMarque] = useState("");
  const [categorieId, setCategorieId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = search.trim();

  useEffect(() => {
    if (!q || value) {
      setResults([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api<Modele[]>(`/modeles?q=${encodeURIComponent(q)}`);
        if (!stale) setResults(r.slice(0, MAX_RESULTS));
      } catch {
        if (!stale) setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, value]);

  function pick(m: Modele | null) {
    onChange(m);
    setSearch("");
    setCreating(false);
    setErr(null);
  }

  async function create() {
    setSaving(true);
    setErr(null);
    try {
      const m = await api<Modele>("/modeles", {
        method: "POST",
        body: {
          nom: q,
          marque: marque.trim() || null,
          categorie_id: categorieId === "" ? null : categorieId,
        },
      });
      setMarque("");
      setCategorieId("");
      pick(m);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-xl border border-line bg-bg-soft px-3">
        <Icon name="category" className="text-lg text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {value.nom}
          {value.marque && <span className="text-fg-muted"> · {value.marque}</span>}
        </span>
        <button
          type="button"
          onClick={() => pick(null)}
          className="text-xs font-medium text-fg-muted hover:text-fg"
        >
          Changer
        </button>
      </div>
    );
  }

  const exact = results.some((m) => m.nom === q);

  return (
    <div className="space-y-1.5">
      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setCreating(false);
        }}
        placeholder={required ? "MH-100, H30V-L250… (obligatoire)" : "MH-100, H30V-L250…"}
        aria-label="Modèle"
      />
      {(results.length > 0 || (q && !exact)) && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-soft">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:opacity-70"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {m.nom}
                  {m.marque && <span className="text-fg-muted"> · {m.marque}</span>}
                </span>
                <span className="text-xs text-fg-muted">{m.categorie_nom}</span>
              </button>
            </li>
          ))}
          {q && !exact && !creating && (
            <li>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:opacity-70"
              >
                <Icon name="add" className="text-lg" />
                Créer le modèle « {q} »
              </button>
            </li>
          )}
        </ul>
      )}
      {creating && (
        <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
          <p className="text-sm font-medium">Nouveau modèle « {q} »</p>
          {err && <p className="text-xs text-danger">{err}</p>}
          <input
            value={marque}
            onChange={(e) => setMarque(e.target.value)}
            placeholder="Marque (optionnel)"
            className={inputCls}
          />
          <CategorieSelect
            categories={categories}
            value={categorieId}
            onChange={setCategorieId}
            vide="Catégorie —"
            aria-label="Catégorie du modèle"
            className={inputCls}
          />
          <Button onClick={() => void create()} loading={saving} className="w-full">
            Créer le modèle
          </Button>
        </div>
      )}
    </div>
  );
}
