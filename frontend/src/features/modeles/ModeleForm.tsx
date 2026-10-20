import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Categorie, Modele } from "@/lib/types";
import { Button } from "@/shared/Button";
import { CategorieSelect } from "@/shared/CategorieSelect";
import { useToast } from "@/shared/Toast";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

/** Création ou édition des infos d'un modèle (nom, marque, catégorie). */
export function ModeleForm({
  initial,
  categories,
  onCancel,
  onSaved,
}: {
  initial: Modele | null;
  categories: Categorie[];
  onCancel: () => void;
  onSaved: (m: Modele) => void | Promise<void>;
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
      const m = initial
        ? await api<Modele>(`/modeles/${initial.id}`, { method: "PATCH", body })
        : await api<Modele>("/modeles", { method: "POST", body });
      toast(initial ? "Modèle modifié." : "Modèle créé.", "success");
      await onSaved(m);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const changeCategorie =
    initial &&
    categorieId !== (initial.categorie_id ?? "") &&
    (initial.nb_unites ?? 0) > 0;

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
        <CategorieSelect
          categories={categories}
          value={categorieId}
          onChange={setCategorieId}
          className={inputCls}
        />
        {changeCategorie && (
          <span className="block text-xs text-warning">
            S'applique aux {initial.nb_unites} unités de ce modèle.
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
