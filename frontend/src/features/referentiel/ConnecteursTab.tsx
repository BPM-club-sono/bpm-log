import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Connecteur } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { SearchInput } from "@/shared/SearchInput";
import { useToast } from "@/shared/Toast";
import { inputCls, useCanManage, useFail } from "./shared";

/** Catalogue des connecteurs : recherche, lignes pleine largeur, renommage en place. */
export function ConnecteursTab() {
  const { toast } = useToast();
  const canManage = useCanManage();
  const fail = useFail();

  const [items, setItems] = useState<Connecteur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
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
      setCreating(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((c) => c.nom.toLowerCase().includes(q)) : items;
  }, [items, query]);

  return (
    <div className="space-y-4">
      {canManage && creating && (
        <div className="flex gap-2">
          <input
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Nouveau connecteur (XLR 3, PowerCon…)"
            aria-label="Nouveau connecteur"
            className={inputCls}
            autoFocus
          />
          <Button className="flex-none" onClick={() => void add()} aria-label="Ajouter">
            <Icon name="add" className="text-base" />
          </Button>
          <Button
            variant="ghost"
            className="flex-none"
            onClick={() => setCreating(false)}
            aria-label="Annuler"
          >
            <Icon name="close" className="text-base" />
          </Button>
        </div>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un connecteur…"
        aria-label="Rechercher un connecteur"
      />

      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-fg-muted">
          <Icon name="cable" className="text-4xl" />
          <p className="text-sm">Aucun connecteur trouvé.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="divide-y divide-line">
          {filtered.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-elev text-fg-muted">
                    <Icon name="cable" className="text-lg" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.nom}</p>
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

      {canManage && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="fixed bottom-20 right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg shadow-lg"
          aria-label="Nouveau connecteur"
        >
          <Icon name="add" className="text-2xl" />
        </button>
      )}
    </div>
  );
}
