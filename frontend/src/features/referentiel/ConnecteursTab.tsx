import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Connecteur } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { inputCls, useCanManage, useFail } from "./shared";

export function ConnecteursTab() {
  const { toast } = useToast();
  const canManage = useCanManage();
  const fail = useFail();

  const [items, setItems] = useState<Connecteur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNom, setEditNom] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await api<Connecteur[]>("/connecteurs"));
      setError(null);
    } catch {
      setError("Impossible de charger les connecteurs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!nouveau.trim()) return;
    try {
      await api("/connecteurs", { method: "POST", body: { nom: nouveau.trim() } });
      setNouveau("");
      toast("Connecteur ajouté.", "success");
      await load();
    } catch (err) {
      fail(err, "Ajout impossible.");
    }
  }

  async function rename(c: Connecteur) {
    if (!editNom.trim()) return;
    try {
      await api(`/connecteurs/${c.id}`, { method: "PATCH", body: { nom: editNom.trim() } });
      setEditId(null);
      toast("Connecteur renommé.", "success");
      await load();
    } catch (err) {
      fail(err, "Modification impossible.");
    }
  }

  async function remove(c: Connecteur) {
    const usage =
      c.nb_utilisations > 0
        ? `\n\nIl est utilisé ${c.nb_utilisations} fois.`
        : "";
    if (!window.confirm(`Supprimer le connecteur « ${c.nom} » ?${usage}`)) return;
    try {
      await api(`/connecteurs/${c.id}`, { method: "DELETE" });
      toast("Connecteur supprimé.", "success");
      await load();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-2">
          <input
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Nouveau connecteur (XLR 3, PowerCon…)"
            aria-label="Nouveau connecteur"
            className={inputCls}
          />
          <Button className="flex-none" onClick={() => void add()} aria-label="Ajouter">
            <Icon name="add" className="text-base" />
          </Button>
        </div>
      )}

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-fg-muted">Aucun connecteur.</p>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              {editId === c.id ? (
                <>
                  <input
                    value={editNom}
                    onChange={(e) => setEditNom(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void rename(c)}
                    aria-label="Nom du connecteur"
                    className={inputCls}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void rename(c)}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line"
                    aria-label="Enregistrer"
                  >
                    <Icon name="check" className="text-lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditId(null)}
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                    aria-label="Annuler"
                  >
                    <Icon name="close" className="text-lg" />
                  </button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.nom}</p>
                    <p className="text-xs text-fg-muted">
                      {c.nb_utilisations} utilisation{c.nb_utilisations > 1 ? "s" : ""}
                    </p>
                  </div>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(c.id);
                          setEditNom(c.nom);
                        }}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                        aria-label="Renommer"
                      >
                        <Icon name="edit" className="text-lg" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                        aria-label="Supprimer"
                      >
                        <Icon name="delete" className="text-lg" />
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
