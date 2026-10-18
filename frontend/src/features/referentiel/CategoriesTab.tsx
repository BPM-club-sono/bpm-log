import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Categorie, ChampSpec, SousCategorie } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { Champs } from "./Champs";
import { SousCategories } from "./SousCategories";
import { inputCls, useCanManage, useFail } from "./shared";

export function CategoriesTab() {
  const canManage = useCanManage();
  const { toast } = useToast();
  const fail = useFail();
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [sousCats, setSousCats] = useState<SousCategorie[]>([]);
  const [champs, setChamps] = useState<ChampSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [nouveau, setNouveau] = useState("");
  const [nouvelleDesc, setNouvelleDesc] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNom, setEditNom] = useState("");

  const load = useCallback(async () => {
    try {
      const [cat, sc, ch] = await Promise.all([
        api<Categorie[]>("/categories"),
        api<SousCategorie[]>("/sous-categories"),
        api<ChampSpec[]>("/champs-specification"),
      ]);
      setCategories(cat);
      setSousCats(sc);
      setChamps(ch);
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

  async function add() {
    if (!nouveau.trim()) return;
    try {
      await api("/categories", {
        method: "POST",
        body: { nom: nouveau.trim(), description: nouvelleDesc.trim() || null },
      });
      setNouveau("");
      setNouvelleDesc("");
      toast("Catégorie ajoutée.", "success");
      await load();
    } catch (err) {
      fail(err, "Ajout impossible.");
    }
  }

  async function rename(c: Categorie) {
    if (!editNom.trim()) return;
    try {
      await api(`/categories/${c.id}`, { method: "PATCH", body: { nom: editNom.trim() } });
      setEditId(null);
      toast("Catégorie renommée.", "success");
      await load();
    } catch (err) {
      fail(err, "Modification impossible.");
    }
  }

  async function remove(c: Categorie) {
    if (!window.confirm(`Supprimer la catégorie « ${c.nom} » ?`)) return;
    try {
      await api(`/categories/${c.id}`, { method: "DELETE" });
      if (ouverte === c.id) setOuverte(null);
      toast("Catégorie supprimée.", "success");
      await load();
    } catch (err) {
      fail(err, "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="Nouvelle catégorie"
              aria-label="Nouvelle catégorie"
              className={inputCls}
            />
            <Button className="flex-none" onClick={() => void add()} aria-label="Ajouter la catégorie">
              <Icon name="add" className="text-base" />
            </Button>
          </div>
          <input
            value={nouvelleDesc}
            onChange={(e) => setNouvelleDesc(e.target.value)}
            placeholder="Description (facultatif)"
            aria-label="Description de la nouvelle catégorie"
            className={inputCls}
          />
        </div>
      )}
      {loading && <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && !error && categories.length === 0 && (
        <p className="text-sm text-fg-muted">Aucune catégorie.</p>
      )}
      {categories.map((c) => {
        const open = ouverte === c.id;
        const sc = sousCats.filter((s) => s.categorie_id === c.id);
        const ch = champs.filter((x) => x.categorie_id === c.id);
        return (
          <section key={c.id} className="rounded-2xl border border-line bg-bg-soft">
            <div className="flex items-center gap-2 pr-3">
              {editId === c.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3">
                  <input
                    value={editNom}
                    onChange={(e) => setEditNom(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void rename(c)}
                    aria-label="Nom de la catégorie"
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
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOuverte(open ? null : c.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.nom}</p>
                      <p className="text-xs text-fg-muted">
                        {sc.length} sous-catégorie{sc.length > 1 ? "s" : ""} · {ch.length} champ
                        {ch.length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <Icon name={open ? "expand_less" : "expand_more"} className="text-xl" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(c.id);
                          setEditNom(c.nom);
                        }}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-fg-muted"
                        aria-label={`Renommer ${c.nom}`}
                      >
                        <Icon name="edit" className="text-lg" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-danger"
                        aria-label={`Supprimer ${c.nom}`}
                      >
                        <Icon name="delete" className="text-lg" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            {open && (
              <div className="space-y-5 border-t border-line px-4 py-4">
                <SousCategories categorieId={c.id} items={sc} onChange={load} />
                <Champs categorieId={c.id} items={ch} sousCats={sc} onChange={load} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
