import { useState } from "react";
import { api } from "@/lib/api";
import type { SousCategorie } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { inputCls, useCanManage, useFail } from "./shared";

export function SousCategories({
  categorieId,
  items,
  onChange,
}: {
  categorieId: number;
  items: SousCategorie[];
  onChange: () => Promise<void>;
}) {
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const [nouveau, setNouveau] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNom, setEditNom] = useState("");

  async function add() {
    if (!nouveau.trim()) return;
    try {
      await api("/sous-categories", {
        method: "POST",
        body: { nom: nouveau.trim(), categorie_id: categorieId },
      });
      setNouveau("");
      toast("Sous-catégorie ajoutée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Ajout impossible.");
    }
  }

  async function rename(s: SousCategorie) {
    if (!editNom.trim()) return;
    try {
      await api(`/sous-categories/${s.id}`, { method: "PATCH", body: { nom: editNom.trim() } });
      setEditId(null);
      toast("Sous-catégorie renommée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Modification impossible.");
    }
  }

  async function remove(s: SousCategorie) {
    const usage =
      s.nb_utilisations > 0 ? `\n\nElle est utilisée ${s.nb_utilisations} fois.` : "";
    if (!window.confirm(`Supprimer la sous-catégorie « ${s.nom} » ?${usage}`)) return;
    try {
      await api(`/sous-categories/${s.id}`, { method: "DELETE" });
      toast("Sous-catégorie supprimée.", "success");
      await onChange();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Sous-catégories
      </h3>
      {items.length === 0 && <p className="text-sm text-fg-muted">Aucune.</p>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            {editId === s.id ? (
              <>
                <input
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void rename(s)}
                  aria-label="Nom de la sous-catégorie"
                  className={inputCls}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void rename(s)}
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
                <span className="min-w-0 flex-1 truncate text-sm">
                  {s.nom}
                  <span className="text-xs text-fg-muted"> · {s.nb_utilisations} utilisation{s.nb_utilisations > 1 ? "s" : ""}</span>
                </span>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(s.id);
                        setEditNom(s.nom);
                      }}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                      aria-label={`Renommer ${s.nom}`}
                    >
                      <Icon name="edit" className="text-lg" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                      aria-label={`Supprimer ${s.nom}`}
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
      {canManage && (
        <div className="flex gap-2">
          <input
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Nouvelle sous-catégorie"
            aria-label="Nouvelle sous-catégorie"
            className={inputCls}
          />
          <Button className="flex-none" onClick={() => void add()} aria-label="Ajouter">
            <Icon name="add" className="text-base" />
          </Button>
        </div>
      )}
    </div>
  );
}
