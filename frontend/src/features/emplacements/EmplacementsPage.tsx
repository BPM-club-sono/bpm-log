import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Emplacement } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

/** Chemin lisible « Dépôt › Étagère A » pour situer un emplacement imbriqué. */
function cheminDe(em: Emplacement, parIndex: Map<number, Emplacement>): string {
  const segments: string[] = [];
  const vus = new Set<number>();
  let courant = em.parent_id != null ? parIndex.get(em.parent_id) : undefined;
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    segments.unshift(courant.nom);
    courant = courant.parent_id != null ? parIndex.get(courant.parent_id) : undefined;
  }
  return segments.join(" › ");
}

export function EmplacementsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.role === "Admin" || user?.role === "Staff";

  const [items, setItems] = useState<Emplacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Emplacement | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<Emplacement[]>("/emplacements"));
      setError(null);
    } catch {
      setError("Impossible de charger les emplacements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parIndex = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);

  async function remove(em: Emplacement) {
    if (!window.confirm(`Supprimer l'emplacement « ${em.nom} » ?`)) return;
    try {
      await api(`/emplacements/${em.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== em.id));
      toast("Emplacement supprimé.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(err.message, "error");
      } else {
        toast("Suppression impossible.", "error");
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to="/profil"
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> Profil
        </Link>
        {canManage && !creating && !editing && (
          <Button className="h-9 px-3" onClick={() => setCreating(true)}>
            <Icon name="add" className="text-base" />
            Nouveau
          </Button>
        )}
      </div>

      <h1 className="text-2xl font-bold">Emplacements</h1>

      {(creating || editing) && canManage && (
        <EmplacementForm
          initial={editing}
          emplacements={items}
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

      {loading && (
        <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-fg-muted">Aucun emplacement enregistré.</p>
      )}

      <ul className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
        {items.map((em) => {
          const chemin = cheminDe(em, parIndex);
          return (
            <li key={em.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-fg-muted">
                <Icon name="pin_drop" className="text-xl" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {em.nom}
                  {em.zone_stockage && (
                    <span className="ml-2 rounded bg-bg-elev px-1.5 py-0.5 text-[11px] text-fg-muted">
                      {em.zone_stockage}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-fg-muted">{chemin || "Racine"}</p>
              </div>
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(em)}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                    aria-label="Modifier"
                  >
                    <Icon name="edit" className="text-lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(em)}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                    aria-label="Supprimer"
                  >
                    <Icon name="delete" className="text-lg" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmplacementForm({
  initial,
  emplacements,
  onCancel,
  onSaved,
}: {
  initial: Emplacement | null;
  emplacements: Emplacement[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [zone, setZone] = useState(initial?.zone_stockage ?? "");
  const [parentId, setParentId] = useState<number | null>(initial?.parent_id ?? null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Parents possibles : tout sauf soi-même et sa descendance (sinon cycle).
  const parentsPossibles = useMemo(() => {
    if (!initial) return emplacements;
    const interdits = new Set<number>([initial.id]);
    let taille = 0;
    while (interdits.size !== taille) {
      taille = interdits.size;
      for (const e of emplacements) {
        if (e.parent_id != null && interdits.has(e.parent_id)) interdits.add(e.id);
      }
    }
    return emplacements.filter((e) => !interdits.has(e.id));
  }, [emplacements, initial]);

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
        zone_stockage: zone.trim() || null,
        parent_id: parentId,
      };
      if (initial) {
        await api(`/emplacements/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/emplacements", { method: "POST", body });
      }
      toast(initial ? "Emplacement modifié." : "Emplacement créé.", "success");
      await onSaved();
    } catch (error) {
      setErr(
        error instanceof ApiError && error.status === 409
          ? error.message
          : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
      <h2 className="text-sm font-semibold">
        {initial ? "Modifier l'emplacement" : "Nouvel emplacement"}
      </h2>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Nom</span>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Étagère A, Dépôt, Camion…"
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">
          Zone de stockage <span className="font-normal">(facultatif)</span>
        </span>
        <input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="Local technique, Sous-sol…"
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">
          Rangé dans <span className="font-normal">(facultatif)</span>
        </span>
        <select
          value={parentId ?? ""}
          onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
          className={inputCls}
        >
          <option value="">Racine</option>
          {parentsPossibles.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
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
