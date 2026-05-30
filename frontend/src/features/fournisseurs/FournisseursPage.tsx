import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Fournisseur } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

export function FournisseursPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user?.role === "Admin" || user?.role === "Staff";

  const [items, setItems] = useState<Fournisseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Fournisseur | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<Fournisseur[]>("/fournisseurs"));
      setError(null);
    } catch {
      setError("Impossible de charger les fournisseurs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFavori(f: Fournisseur) {
    // Optimiste
    setItems((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, favori: !x.favori } : x)),
    );
    try {
      await api(`/fournisseurs/${f.id}`, {
        method: "PATCH",
        body: { favori: !f.favori },
      });
    } catch {
      await load();
      toast("Échec de la mise à jour.", "error");
    }
  }

  async function remove(f: Fournisseur) {
    if (!window.confirm(`Supprimer le fournisseur « ${f.nom} » ?`)) return;
    try {
      await api(`/fournisseurs/${f.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== f.id));
      toast("Fournisseur supprimé.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("Rattaché à du matériel : suppression impossible.", "error");
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

      <h1 className="text-2xl font-bold">Fournisseurs</h1>

      {(creating || editing) && canManage && (
        <FournisseurForm
          initial={editing}
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
        <p className="text-sm text-fg-muted">Aucun fournisseur enregistré.</p>
      )}

      <ul className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
        {items.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              disabled={!canManage}
              onClick={() => void toggleFavori(f)}
              className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
                f.favori ? "text-warning" : "text-fg-muted"
              } disabled:opacity-40`}
              aria-label={f.favori ? "Retirer des favoris" : "Mettre en favori"}
            >
              <Icon name={f.favori ? "star" : "star_border"} className="text-xl" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{f.nom}</p>
              <p className="truncate text-xs text-fg-muted">{f.contact ?? "—"}</p>
            </div>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(f)}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                  aria-label="Modifier"
                >
                  <Icon name="edit" className="text-lg" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(f)}
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                  aria-label="Supprimer"
                >
                  <Icon name="delete" className="text-lg" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FournisseurForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Fournisseur | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [favori, setFavori] = useState(initial?.favori ?? false);
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
      const body = { nom: nom.trim(), contact: contact.trim() || null, favori };
      if (initial) {
        await api(`/fournisseurs/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/fournisseurs", { method: "POST", body });
      }
      toast(initial ? "Fournisseur modifié." : "Fournisseur créé.", "success");
      await onSaved();
    } catch {
      setErr("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
      <h2 className="text-sm font-semibold">
        {initial ? "Modifier le fournisseur" : "Nouveau fournisseur"}
      </h2>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Nom</span>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Impact, Novelty, …"
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Contact</span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Téléphone, e-mail, nom du commercial…"
          className={inputCls}
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={favori}
          onChange={(e) => setFavori(e.target.checked)}
          className="h-4 w-4 accent-fg"
        />
        Favori (accès rapide lors de l'ajout de matériel)
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
