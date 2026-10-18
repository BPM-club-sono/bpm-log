import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { compressImage } from "@/lib/image";
import type {
  Categorie,
  Emplacement,
  EquipmentListItem,
  EquipmentType,
  Fournisseur,
  Modele,
  SerieCreee,
} from "@/lib/types";
import { PREFIXE_EXTERNE, PREFIXE_INTERNE } from "@/lib/barcode";
import { BarcodeInput } from "@/shared/BarcodeInput";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { ExterneFields, Field } from "./EquipmentDetailPage";
import { ModeleField } from "./ModeleField";
import { RangementField, type RangementMode } from "./RangementField";

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

/** Choix du formulaire : « flight » = équipement standard marqué contenant (est_contenant). */
type FormType = EquipmentType | "flight";

const TYPES: { value: FormType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "vrac", label: "Vrac" },
  { value: "consommable", label: "Consommable" },
  { value: "flight", label: "Flight" },
];

interface EquipmentFormProps {
  /** Coche « location externe » par défaut (contexte presta externe). */
  externeDefault?: boolean;
  /** Contexte prestation : crée et alloue directement à cette prestation. */
  prestaId?: number;
  submitLabel?: string;
  /** Appelé après création réussie de la série (photo comprise). */
  onCreated: (res: SerieCreee) => void | Promise<void>;
}

/**
 * Formulaire complet de création d'équipement (tous types).
 * Réutilisé tel quel par la page « Nouvel équipement » et par la modale
 * d'ajout de matériel à une prestation.
 */
export function EquipmentForm({
  externeDefault = false,
  prestaId,
  submitLabel = "Créer l'équipement",
  onCreated,
}: EquipmentFormProps) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<FormType>("standard");
  const [categorieId, setCategorieId] = useState<number | "">("");
  const [modele, setModele] = useState<Modele | null>(null);
  const [rangementMode, setRangementMode] =
    useState<RangementMode>("emplacement");
  const [emplacementId, setEmplacementId] = useState<number | "">("");
  const [contenantId, setContenantId] = useState<number | "">("");
  const [overrideBarcode, setOverrideBarcode] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [quantite, setQuantite] = useState(1);
  const [nombre, setNombre] = useState(1);
  const [apercu, setApercu] = useState<string[]>([]);
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
  const [containers, setContainers] = useState<EquipmentListItem[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [cat, emp, four, eqs] = await Promise.all([
          api<Categorie[]>("/categories"),
          api<Emplacement[]>("/emplacements"),
          api<Fournisseur[]>("/fournisseurs"),
          api<EquipmentListItem[]>("/equipments"),
        ]);
        setCategories(cat);
        setEmplacements(emp);
        setFournisseurs(four);
        setContainers(eqs);
      } catch {
        // listes non bloquantes
      }
    })();
  }, []);

  function onPhotoChange(file: File | null) {
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  // Item unitaire à nous : il porte son modèle (ajout en nombre aux prestas).
  // Un vrac/conso n'en a pas ; un flight ou une location peuvent s'en passer.
  const avecModele = type === "standard" || type === "flight";
  const modeleRequis = type === "standard" && !externe;
  // Création en série : seulement pour un item unitaire standard.
  const nbExemplaires =
    type === "standard" ? Math.max(1, Math.floor(nombre) || 1) : 1;
  const serie = nbExemplaires > 1;
  const avecQuantite =
    !!prestaId && (type === "vrac" || type === "consommable");

  // Aperçu des noms qui seront créés (le serveur décide de la numérotation).
  useEffect(() => {
    const base = nom.trim();
    if (!serie || !base) {
      setApercu([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api<string[]>(
          `/equipments/noms-serie?base=${encodeURIComponent(base)}&nombre=${nbExemplaires}`,
        );
        if (!stale) setApercu(r);
      } catch {
        if (!stale) setApercu([]);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [nom, serie, nbExemplaires]);

  function choisirModele(m: Modele | null) {
    setModele(m);
    // Forme fonctionnelle : un nom tapé pendant la création du modèle n'est pas écrasé.
    if (m) setNom((prev) => (prev.trim() ? prev : m.nom));
  }

  async function submit() {
    if (!nom.trim()) {
      setErr("Le nom est obligatoire.");
      return;
    }
    if (modeleRequis && !modele) {
      setErr("Le modèle est obligatoire.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        nom: nom.trim(),
        // « Flight » = équipement standard marqué contenant.
        type: type === "flight" ? "standard" : type,
        est_contenant: type === "flight",
        categorie_id: categorieId === "" ? null : categorieId,
        modele_id: avecModele && modele ? modele.id : null,
        externe,
      };
      // Rangement : emplacement fixe OU contenant (exclusifs côté serveur).
      if (rangementMode === "contenant" && contenantId !== "") {
        body.contenant_id = contenantId;
      } else {
        body.emplacement_id = emplacementId === "" ? null : emplacementId;
      }
      if (overrideBarcode && barcode && !serie) body.barcode_uid = barcode;
      if (type === "vrac") body.quantite_theorique = quantiteTheo;
      if (type === "consommable") {
        body.stock_actuel = stock;
        body.seuil_alerte = seuil;
        body.unite = unite || null;
      }
      if (externe) {
        if (nouveauFournisseur.trim())
          body.fournisseur_nom = nouveauFournisseur.trim();
        else if (fournisseurId !== "") body.fournisseur_id = fournisseurId;
        body.reference_devis = refDevis || null;
      }
      body.nombre = nbExemplaires;
      if (avecQuantite) body.quantite_allouee = Math.max(1, quantite);
      const form = new FormData();
      form.append("donnees", JSON.stringify(body));
      if (photoFile)
        form.append("photo", await compressImage(photoFile), "photo.jpg");
      const res = await api<SerieCreee>(
        prestaId ? `/prestations/${prestaId}/equipements` : "/equipments/serie",
        { method: "POST", body: form },
      );
      await onCreated(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  // Le préfixe d'une référence identifie le propriétaire : celui du fournisseur
  // pour du matériel loué, BPM sinon. Un fournisseur sans trigramme donne EXT.
  const fournisseurSelectionne = fournisseurs.find(
    (f) => f.id === fournisseurId,
  );
  const prefixeRef = externe
    ? fournisseurSelectionne?.code || PREFIXE_EXTERNE
    : PREFIXE_INTERNE;

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

      <div className="space-y-1">
        <Field label={serie ? "Nom de base" : "Nom"}>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Lyre Beam 7R…"
            className={inputCls}
          />
        </Field>
        {serie && apercu.length > 0 && (
          <p className="text-xs text-fg-muted">
            {apercu.length <= 3
              ? `créera ${apercu.join(", ")}`
              : `créera ${apercu[0]} … ${apercu[apercu.length - 1]}`}
          </p>
        )}
      </div>

      {type === "standard" && (
        <Field label="Nombre d'exemplaires">
          <input
            type="number"
            min={1}
            value={nombre}
            onChange={(e) => setNombre(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
      )}

      {avecQuantite && (
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
        <div className="grid grid-cols-2 gap-2">
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

      {avecModele && (
        <Field label={modeleRequis ? "Modèle" : "Modèle (optionnel)"}>
          <ModeleField
            value={modele}
            onChange={choisirModele}
            categories={categories}
            required={modeleRequis}
          />
        </Field>
      )}

      <Field label="Catégorie">
        <select
          // Avec un modèle, la catégorie est la sienne (on la change sur le modèle).
          value={
            avecModele && modele ? (modele.categorie_id ?? "") : categorieId
          }
          disabled={avecModele && !!modele}
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
      <RangementField
        mode={rangementMode}
        onModeChange={setRangementMode}
        emplacementId={emplacementId}
        onEmplacementChange={setEmplacementId}
        contenantId={contenantId}
        onContenantChange={setContenantId}
        emplacements={emplacements}
        flights={containers.filter((c) => c.est_contenant)}
      />

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

      {!serie && (
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
            <BarcodeInput
              value={barcode}
              onChange={setBarcode}
              prefixe={prefixeRef}
            />
          ) : (
            <p className="text-xs text-fg-muted">
              Généré automatiquement ({prefixeRef}-000123).
            </p>
          )}
        </div>
      )}

      <Button onClick={() => void submit()} loading={saving} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}
