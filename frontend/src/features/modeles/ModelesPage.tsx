import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Categorie, Modele, Specs } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { SpecsEditor } from "@/features/specs/SpecsEditor";
import { SpecsSheet } from "@/features/specs/SpecsSheet";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

/** Modèles d'équipement (MH-100…) : Staff crée et renomme, Admin supprime un
 *  modèle sans unité. La catégorie d'un modèle s'applique à toutes ses unités. */
export function ModelesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.role === "Admin" || user?.role === "Staff";
  const isAdmin = user?.role === "Admin";

  const [items, setItems] = useState<Modele[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Modele | null>(null);
  const [creating, setCreating] = useState(false);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [specsEdit, setSpecsEdit] = useState<number | null>(null);

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

  async function remove(m: Modele) {
    if (!window.confirm(`Supprimer le modèle « ${m.nom} » ?`)) return;
    try {
      await api(`/modeles/${m.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== m.id));
      toast("Modèle supprimé.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Suppression impossible.", "error");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/inventaire" className="inline-flex items-center gap-1 text-sm text-fg-muted">
          <Icon name="arrow_back" className="text-base" /> Parc
        </Link>
        {canManage && !creating && !editing && (
          <Button className="h-9 px-3" onClick={() => setCreating(true)}>
            <Icon name="add" className="text-base" />
            Nouveau
          </Button>
        )}
      </div>

      <h1 className="text-2xl font-bold">Modèles</h1>

      {(creating || editing) && canManage && (
        <ModeleForm
          initial={editing}
          categories={categories}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-fg-muted">Aucun modèle enregistré.</p>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
          {items.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
              <Link
                to={`/inventaire?modele=${m.id}`}
                className="min-w-0 flex-1 hover:opacity-70"
              >
                <p className="truncate text-sm font-medium">
                  {m.nom}
                  {m.marque && <span className="text-fg-muted"> · {m.marque}</span>}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {m.nb_unites ?? 0} unité{(m.nb_unites ?? 0) > 1 ? "s" : ""}
                  {m.categorie_nom ? ` · ${m.categorie_nom}` : ""}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => setOuvert(ouvert === m.id ? null : m.id)}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                aria-label="Voir les spécifications"
                aria-expanded={ouvert === m.id}
              >
                <Icon name={ouvert === m.id ? "expand_less" : "expand_more"} className="text-lg" />
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setOuvert(m.id);
                    setSpecsEdit(m.id);
                  }}
                  className="flex h-9 flex-none items-center justify-center rounded-lg border border-line px-2 text-xs font-medium text-fg-muted"
                >
                  Spécifications
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                  aria-label="Modifier"
                >
                  <Icon name="edit" className="text-lg" />
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  disabled={(m.nb_unites ?? 0) > 0}
                  title={(m.nb_unites ?? 0) > 0 ? "Utilisé par du matériel" : undefined}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger disabled:opacity-40"
                  aria-label="Supprimer"
                >
                  <Icon name="delete" className="text-lg" />
                </button>
              )}
              </div>
              {ouvert === m.id && (
                <div className="pt-3">
                  {specsEdit === m.id ? (
                    <SpecsEditor
                      cible="modeles"
                      id={m.id}
                      onCancel={() => setSpecsEdit(null)}
                      onSaved={() => {
                        setSpecsEdit(null);
                        toast("Spécifications enregistrées.", "success");
                      }}
                    />
                  ) : (
                    <ModeleSpecs key={m.id} id={m.id} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModeleSpecs({ id }: { id: number }) {
  const [specs, setSpecs] = useState<Specs | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Specs>(`/modeles/${id}/specs`).then(setSpecs, () => setError(true));
  }, [id]);
  if (error) return <p className="text-sm text-danger">Spécifications indisponibles.</p>;
  if (!specs) return <p className="text-sm text-fg-muted">Chargement…</p>;
  return <SpecsSheet specs={specs} />;
}

function ModeleForm({
  initial,
  categories,
  onCancel,
  onSaved,
}: {
  initial: Modele | null;
  categories: Categorie[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [marque, setMarque] = useState(initial?.marque ?? "");
  const [categorieId, setCategorieId] = useState<number | "">(initial?.categorie_id ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!nom.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body = {
        nom: nom.trim(),
        marque: marque.trim() || null,
        categorie_id: categorieId === "" ? null : categorieId,
      };
      if (initial) {
        await api(`/modeles/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/modeles", { method: "POST", body });
      }
      toast(initial ? "Modèle modifié." : "Modèle créé.", "success");
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const changeCategorie =
    initial && (initial.nb_unites ?? 0) > 0 && categorieId !== (initial.categorie_id ?? "");

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
      <h2 className="text-sm font-semibold">
        {initial ? "Modifier le modèle" : "Nouveau modèle"}
      </h2>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Nom</span>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="MH-100, H30V-L250…"
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">
          Marque <span className="font-normal">(facultatif)</span>
        </span>
        <input
          value={marque}
          onChange={(e) => setMarque(e.target.value)}
          placeholder="Robe, Yamaha…"
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Catégorie</span>
        <select
          value={categorieId}
          onChange={(e) =>
            setCategorieId(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={inputCls}
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
        {changeCategorie && (
          <span className="block text-xs text-warning">
            S'applique aux {initial?.nb_unites} unités de ce modèle.
          </span>
        )}
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Annuler
        </Button>
        <Button className="flex-1" loading={saving} onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
