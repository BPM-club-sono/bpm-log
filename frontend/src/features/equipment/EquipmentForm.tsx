import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { compressImage } from "@/lib/image";
import type {
  Categorie,
  Emplacement,
  EquipmentDetail,
  EquipmentType,
  Fournisseur,
} from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { ExterneFields, Field } from "./EquipmentDetailPage";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

const TYPES: { value: EquipmentType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "vrac", label: "Vrac" },
  { value: "consommable", label: "Consommable" },
];

interface EquipmentFormProps {
  /** Coche « location externe » par défaut (contexte presta externe). */
  externeDefault?: boolean;
  /** Affiche un champ « Quantité » (quantité à allouer à la presta). */
  showQuantite?: boolean;
  submitLabel?: string;
  /** Appelé après création réussie de l'équipement (et de sa photo). */
  onCreated: (created: EquipmentDetail, quantite: number) => void | Promise<void>;
}

/**
 * Formulaire complet de création d'équipement (tous types).
 * Réutilisé tel quel par la page « Nouvel équipement » et par la modale
 * d'ajout de matériel à une prestation.
 */
export function EquipmentForm({
  externeDefault = false,
  showQuantite = false,
  submitLabel = "Créer l'équipement",
  onCreated,
}: EquipmentFormProps) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<EquipmentType>("standard");
  const [categorieId, setCategorieId] = useState<number | "">("");
  const [emplacementId, setEmplacementId] = useState<number | "">("");
  const [overrideBarcode, setOverrideBarcode] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [quantite, setQuantite] = useState(1);
  const [quantiteTheo, setQuantiteTheo] = useState(0);
  const [stock, setStock] = useState(0);
  const [seuil, setSeuil] = useState(0);
  const [unite, setUnite] = useState("");
  const [externe, setExterne] = useState(externeDefault);
  const [fournisseurId, setFournisseurId] = useState<number | "">("");
  const [nouveauFournisseur, setNouveauFournisseur] = useState("");
  const [refDevis, setRefDevis] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [emplacements, setEmplacements] = useState<Emplacement[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [cat, emp, four] = await Promise.all([
          api<Categorie[]>("/categories"),
          api<Emplacement[]>("/emplacements"),
          api<Fournisseur[]>("/fournisseurs"),
        ]);
        setCategories(cat);
        setEmplacements(emp);
        setFournisseurs(four);
      } catch {
        // listes non bloquantes
      }
    })();
  }, []);

  function onPhotoChange(file: File | null) {
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function submit() {
    if (!nom.trim()) {
      setErr("Le nom est obligatoire.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        nom: nom.trim(),
        type,
        categorie_id: categorieId === "" ? null : categorieId,
        emplacement_id: emplacementId === "" ? null : emplacementId,
        externe,
      };
      if (overrideBarcode && barcode.trim()) body.barcode_uid = barcode.trim();
      if (type === "vrac") body.quantite_theorique = quantiteTheo;
      if (type === "consommable") {
        body.stock_actuel = stock;
        body.seuil_alerte = seuil;
        body.unite = unite || null;
      }
      if (externe) {
        if (nouveauFournisseur.trim()) body.fournisseur_nom = nouveauFournisseur.trim();
        else if (fournisseurId !== "") body.fournisseur_id = fournisseurId;
        body.reference_devis = refDevis || null;
      }
      const created = await api<EquipmentDetail>("/equipments", {
        method: "POST",
        body,
      });
      if (photoFile) {
        const compressed = await compressImage(photoFile);
        const form = new FormData();
        form.append("file", compressed, "photo.jpg");
        await api(`/equipments/${created.id}/photo`, { method: "POST", body: form });
      }
      await onCreated(created, showQuantite ? Math.max(1, quantite) : 1);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-danger">{err}</p>}

      {photoPreview && (
        <img
          src={photoPreview}
          alt=""
          className="aspect-video w-full rounded-2xl border border-line object-cover"
        />
      )}
      <label className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-bg-soft text-sm font-medium">
        <Icon name="photo_camera" className="text-xl" />
        {photoFile ? "Changer la photo" : "Ajouter une photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
        />
      </label>

      <Field label="Nom">
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Lyre Beam 7R…"
          className={inputCls}
        />
      </Field>

      {showQuantite && (
        <Field label="Quantité à allouer">
          <input
            type="number"
            min={1}
            value={quantite}
            onChange={(e) => setQuantite(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
      )}

      <Field label="Type">
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              data-on={type === t.value}
              className="h-10 rounded-xl border border-line text-sm font-medium data-[on=true]:border-fg data-[on=true]:bg-bg-elev"
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Catégorie">
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
      </Field>
      <Field label="Emplacement">
        <select
          value={emplacementId}
          onChange={(e) =>
            setEmplacementId(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={inputCls}
        >
          <option value="">—</option>
          {emplacements.map((em) => (
            <option key={em.id} value={em.id}>
              {em.nom}
            </option>
          ))}
        </select>
      </Field>

      {type === "vrac" && (
        <Field label="Quantité théorique">
          <input
            type="number"
            value={quantiteTheo}
            onChange={(e) => setQuantiteTheo(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
      )}
      {type === "consommable" && (
        <>
          <Field label="Stock initial">
            <input
              type="number"
              value={stock}
              onChange={(e) => setStock(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Seuil d'alerte">
            <input
              type="number"
              value={seuil}
              onChange={(e) => setSeuil(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Unité">
            <input
              value={unite}
              onChange={(e) => setUnite(e.target.value)}
              placeholder="rouleaux, m, …"
              className={inputCls}
            />
          </Field>
        </>
      )}

      <ExterneFields
        externe={externe}
        setExterne={setExterne}
        fournisseurs={fournisseurs}
        fournisseurId={fournisseurId}
        setFournisseurId={setFournisseurId}
        nouveauFournisseur={nouveauFournisseur}
        setNouveauFournisseur={setNouveauFournisseur}
        refDevis={refDevis}
        setRefDevis={setRefDevis}
      />

      <div className="space-y-2 rounded-xl border border-line bg-bg-soft p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={overrideBarcode}
            onChange={(e) => setOverrideBarcode(e.target.checked)}
            className="h-4 w-4 accent-fg"
          />
          Code-barres personnalisé
        </label>
        {overrideBarcode ? (
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="BPM-LUM-0001"
            className={`${inputCls} font-mono`}
          />
        ) : (
          <p className="text-xs text-fg-muted">
            Généré automatiquement (BPM-000123).
          </p>
        )}
      </div>

      <Button onClick={() => void submit()} loading={saving} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}
