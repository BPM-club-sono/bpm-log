import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Categorie } from "@/lib/types";
import { Button } from "@/shared/Button";
import { CategorieSelect } from "@/shared/CategorieSelect";
import { useToast } from "@/shared/Toast";
import { inputCls } from "./shared";

/** Création ou édition d'une catégorie (nom, description, catégorie parente).
 *  `categories` : tout l'arbre, pour le choix du parent. */
export function CategorieForm({
  initial,
  categories,
  onCancel,
  onSaved,
}: {
  initial: Categorie | null;
  categories: Categorie[];
  onCancel: () => void;
  onSaved: (c: Categorie) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [parentId, setParentId] = useState<number | "">(initial?.parent_id ?? "");
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
        description: description.trim() || null,
        parent_id: parentId === "" ? null : parentId,
      };
      const c = initial
        ? await api<Categorie>(`/categories/${initial.id}`, { method: "PATCH", body })
        : await api<Categorie>("/categories", { method: "POST", body });
      toast(initial ? "Catégorie modifiée." : "Catégorie ajoutée.", "success");
      await onSaved(c);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
      <h2 className="text-sm font-semibold">
        {initial ? "Modifier la catégorie" : "Nouvelle catégorie"}
      </h2>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Nom</span>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Lights, Son…"
          className={inputCls}
          autoFocus
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">
          Description <span className="font-normal">(facultatif)</span>
        </span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-muted">Rangée dans</span>
        <CategorieSelect
          categories={categories}
          value={parentId}
          onChange={setParentId}
          exclure={initial?.id}
          vide="Aucune (catégorie principale)"
          className={inputCls}
        />
        <span className="block text-xs text-fg-muted">
          Une sous-catégorie hérite des champs de spécification de toutes ses parentes.
        </span>
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
