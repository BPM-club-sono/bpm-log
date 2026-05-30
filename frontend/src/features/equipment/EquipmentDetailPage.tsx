import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { syncEngine } from "@/lib/syncEngine";
import { labelCart } from "@/lib/labelCart";
import { compressImage } from "@/lib/image";
import type {
  Categorie,
  ConsoPreview,
  Emplacement,
  EquipmentDetail,
  Fournisseur,
  InventaireEntry,
  StatutEquipment,
  VracDetailInfo,
} from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";
import { useToast } from "@/shared/Toast";

const STATUTS: { value: StatutEquipment; label: string }[] = [
  { value: "Fonctionnel", label: "Fonctionnel" },
  { value: "En_Panne", label: "En panne" },
  { value: "En_Reparation", label: "En réparation" },
  { value: "Perdu", label: "Perdu" },
  { value: "Reforme", label: "Réformé" },
];

const TYPE_LABEL: Record<string, string> = {
  standard: "Standard",
  vrac: "Vrac",
  consommable: "Consommable",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const equipmentId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const canEdit = user?.role === "Admin" || user?.role === "Staff";

  const [eq, setEq] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEq(await api<EquipmentDetail>(`/equipments/${equipmentId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? "Équipement introuvable." : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  function addToLabels() {
    labelCart.add(equipmentId);
    toast(`Ajouté aux étiquettes (${labelCart.count()})`, "success");
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error && !eq) {
    return (
      <div className="space-y-4">
        <p className="py-8 text-center text-sm text-danger">{error}</p>
        <Link to="/inventaire" className="text-sm text-fg-muted underline">
          ← Retour au parc
        </Link>
      </div>
    );
  }
  if (!eq) return null;

  if (editing && canEdit) {
    return (
      <EditForm
        eq={eq}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          to="/inventaire"
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> Parc
        </Link>
        {canEdit && (
          <Button variant="ghost" onClick={() => setEditing(true)} className="h-9 px-3">
            <Icon name="edit" className="text-base" />
            Modifier
          </Button>
        )}
      </div>

      {eq.photo_url && (
        <img
          src={eq.photo_url}
          alt={eq.nom}
          className="aspect-video w-full rounded-2xl border border-line object-cover"
        />
      )}

      <div className="space-y-3 rounded-2xl border border-line bg-bg-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{eq.nom}</h1>
            <p className="font-mono text-xs text-fg-muted">{eq.barcode_uid}</p>
          </div>
          <StatusBadge statut={eq.statut_actuel} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-elev px-2 py-0.5 text-fg-muted">
            <Icon name="label" className="text-sm" />
            {TYPE_LABEL[eq.type]}
          </span>
          {eq.externe && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
              <Icon name="local_shipping" className="text-sm" />
              Location externe
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Catégorie" value={eq.categorie_nom} />
          <Info label="Emplacement" value={eq.emplacement_nom} />
          {eq.externe && (
            <>
              <Info label="Fournisseur" value={eq.location?.fournisseur_nom ?? null} />
              <Info label="Réf. devis" value={eq.location?.reference_devis ?? null} />
            </>
          )}
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            navigate(`/pannes?barcode=${encodeURIComponent(eq.barcode_uid)}`)
          }
        >
          <Icon name="build" className="text-xl" />
          Déclarer une panne
        </Button>
        <Button variant="ghost" onClick={addToLabels}>
          <Icon name="qr_code_2" className="text-xl" />
          Imprimer étiquette
        </Button>
      </div>

      {eq.vrac && (
        <VracBlock equipmentId={equipmentId} vrac={eq.vrac} onChange={load} />
      )}
      {eq.conso && <ConsoBlock equipmentId={equipmentId} conso={eq.conso} />}

      <HistoireTickets tickets={eq.tickets} />
      <HistoireScans scans={eq.scans} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="truncate">{value ?? "—"}</dd>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Bloc vrac (verrou + delta + historique)
// --------------------------------------------------------------------------- //
function VracBlock({
  equipmentId,
  vrac,
  onChange,
}: {
  equipmentId: number;
  vrac: VracDetailInfo;
  onChange: () => Promise<void>;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";
  const [local, setLocal] = useState<VracDetailInfo>(vrac);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setLocal(vrac), [vrac]);

  const lock = local.lock;
  const canCount = lock?.is_mine ?? false;

  async function acquire() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/vrac/${equipmentId}/lock`, { method: "POST" });
      await onChange();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 409
          ? "Caisse déjà verrouillée par un autre membre."
          : "Impossible de prendre le verrou (hors ligne ?).",
      );
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    try {
      await api(`/vrac/${equipmentId}/lock`, { method: "DELETE" });
      await onChange();
    } catch {
      setErr("Impossible de libérer le verrou.");
    } finally {
      setBusy(false);
    }
  }

  async function applyDelta(delta: number) {
    if (!canCount) return;
    const optimistic: InventaireEntry = {
      id: -Date.now(),
      membre_id: user?.id ?? 0,
      membre_nom: user
        ? [user.prenom, user.nom].filter(Boolean).join(" ") || user.email
        : null,
      delta,
      note: null,
      presta_id: null,
      date: new Date().toISOString(),
    };
    setLocal((p) => ({
      ...p,
      quantite_actuelle: p.quantite_actuelle + delta,
      ecart: p.ecart + delta,
      historique: [optimistic, ...p.historique],
    }));
    await syncEngine.enqueue("vrac_delta", { equipment_id: equipmentId, delta });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-fg-muted">Inventaire vrac</h2>
      {err && <p className="text-sm text-danger">{err}</p>}

      <div className="rounded-2xl border border-line bg-bg-soft p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-fg-muted">Quantité actuelle</p>
        <p className="my-1 text-5xl font-bold tabular-nums">{local.quantite_actuelle}</p>
        <p className="text-sm text-fg-muted">
          {local.quantite_theorique} théorique ·{" "}
          <span
            className={
              local.ecart === 0
                ? "text-fg-muted"
                : local.ecart > 0
                  ? "text-success"
                  : "text-danger"
            }
          >
            {local.ecart > 0 ? `+${local.ecart}` : local.ecart} d'écart
          </span>
        </p>
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => void applyDelta(-1)}
            disabled={!canCount}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-line text-fg disabled:opacity-30"
          >
            <Icon name="remove" className="text-2xl" />
          </button>
          <button
            type="button"
            onClick={() => void applyDelta(+1)}
            disabled={!canCount}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg disabled:opacity-30"
          >
            <Icon name="add" className="text-2xl" />
          </button>
        </div>
      </div>

      {!canCount ? (
        <div className="space-y-2 rounded-xl border border-line bg-bg-soft p-4">
          {lock ? (
            <p className="text-sm text-fg-muted">
              <Icon name="lock" className="mr-1 text-base" />
              Verrouillée par {lock.membre_nom ?? "un autre membre"} jusqu'à{" "}
              {formatDate(lock.expires_at)}.
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              Prenez le verrou pour démarrer une session d'inventaire.
            </p>
          )}
          <Button
            onClick={() => void acquire()}
            loading={busy}
            disabled={!!lock && !isAdmin}
            className="w-full"
          >
            <Icon name="lock_open" className="text-base" />
            Prendre le verrou
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => void release()}
          loading={busy}
          className="w-full"
        >
          <Icon name="check" className="text-base" />
          Terminer et libérer
        </Button>
      )}

      {local.historique.length > 0 && (
        <ul className="space-y-1.5">
          {local.historique.map((h) => (
            <li
              key={h.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate">{h.membre_nom ?? "—"}</p>
                <p className="text-xs text-fg-muted">{formatDate(h.date)}</p>
              </div>
              <span
                className={`shrink-0 font-semibold tabular-nums ${
                  h.delta > 0 ? "text-success" : "text-danger"
                }`}
              >
                {h.delta > 0 ? `+${h.delta}` : h.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Bloc consommable (réappro +/-)
// --------------------------------------------------------------------------- //
function ConsoBlock({
  equipmentId,
  conso,
}: {
  equipmentId: number;
  conso: ConsoPreview;
}) {
  const [local, setLocal] = useState<ConsoPreview>(conso);
  useEffect(() => setLocal(conso), [conso]);

  async function applyDelta(delta: number) {
    const next = Math.max(0, local.stock_actuel + delta);
    if (next === local.stock_actuel) return;
    setLocal((p) => ({
      ...p,
      stock_actuel: next,
      en_alerte: next <= p.seuil_alerte,
    }));
    await syncEngine.enqueue("conso_delta", { equipment_id: equipmentId, delta });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-fg-muted">Stock consommable</h2>
      <div className="rounded-2xl border border-line bg-bg-soft p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-fg-muted">Stock actuel</p>
        <p
          className={`my-1 text-5xl font-bold tabular-nums ${
            local.en_alerte ? "text-danger" : ""
          }`}
        >
          {local.stock_actuel}
          {local.unite ? <span className="text-lg"> {local.unite}</span> : null}
        </p>
        <p className="text-sm text-fg-muted">
          seuil {local.seuil_alerte}
          {local.en_alerte && (
            <span className="ml-1 font-medium text-danger">⚠ à réappro</span>
          )}
        </p>
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => void applyDelta(-1)}
            disabled={local.stock_actuel <= 0}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-line text-fg disabled:opacity-30"
          >
            <Icon name="remove" className="text-2xl" />
          </button>
          <button
            type="button"
            onClick={() => void applyDelta(+1)}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg"
          >
            <Icon name="add" className="text-2xl" />
          </button>
        </div>
      </div>
    </section>
  );
}

function HistoireTickets({
  tickets,
}: {
  tickets: EquipmentDetail["tickets"];
}) {
  if (tickets.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-fg-muted">Historique des pannes</h2>
      <ul className="space-y-1.5">
        {tickets.map((t) => (
          <li
            key={t.id}
            className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{t.avancement}</span>
              <span className="text-xs text-fg-muted">
                {formatDate(t.date_declaration)}
              </span>
            </div>
            {t.description_panne && (
              <p className="mt-0.5 text-xs text-fg-muted">{t.description_panne}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoireScans({ scans }: { scans: EquipmentDetail["scans"] }) {
  if (scans.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-fg-muted">Derniers scans</h2>
      <ul className="space-y-1.5">
        {scans.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm"
          >
            <span>{s.type_action}</span>
            <span className="text-xs text-fg-muted">
              {s.membre_nom ?? "—"} · {formatDate(s.date_scan)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Mode édition
// --------------------------------------------------------------------------- //
function EditForm({
  eq,
  onCancel,
  onSaved,
}: {
  eq: EquipmentDetail;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [nom, setNom] = useState(eq.nom);
  const [barcode, setBarcode] = useState(eq.barcode_uid);
  const [categorieId, setCategorieId] = useState<number | "">(eq.categorie_id ?? "");
  const [emplacementId, setEmplacementId] = useState<number | "">(
    eq.emplacement_id ?? "",
  );
  const [statut, setStatut] = useState<StatutEquipment>(eq.statut_actuel);
  const [quantiteTheo, setQuantiteTheo] = useState<number>(
    eq.vrac?.quantite_theorique ?? 0,
  );
  const [seuil, setSeuil] = useState<number>(eq.conso?.seuil_alerte ?? 0);
  const [unite, setUnite] = useState<string>(eq.conso?.unite ?? "");
  const [externe, setExterne] = useState(eq.externe);
  const [fournisseurId, setFournisseurId] = useState<number | "">(
    eq.location?.fournisseur_id ?? "",
  );
  const [nouveauFournisseur, setNouveauFournisseur] = useState("");
  const [refDevis, setRefDevis] = useState(eq.location?.reference_devis ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(eq.photo_url);

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
    setPhotoPreview(file ? URL.createObjectURL(file) : eq.photo_url);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        nom,
        barcode_uid: barcode,
        categorie_id: categorieId === "" ? null : categorieId,
        emplacement_id: emplacementId === "" ? null : emplacementId,
        statut_actuel: statut,
        externe,
      };
      if (eq.type === "vrac") body.quantite_theorique = quantiteTheo;
      if (eq.type === "consommable") {
        body.seuil_alerte = seuil;
        body.unite = unite || null;
      }
      if (externe) {
        if (nouveauFournisseur.trim()) body.fournisseur_nom = nouveauFournisseur.trim();
        else if (fournisseurId !== "") body.fournisseur_id = fournisseurId;
        body.reference_devis = refDevis || null;
      }
      await api<EquipmentDetail>(`/equipments/${eq.id}`, {
        method: "PATCH",
        body,
      });

      if (photoFile) {
        const compressed = await compressImage(photoFile);
        const form = new FormData();
        form.append("file", compressed, "photo.jpg");
        await api(`/equipments/${eq.id}/photo`, { method: "POST", body: form });
      }
      toast("Équipement enregistré", "success");
      await onSaved();
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Erreur réseau. Réessaie.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Modifier</h1>
        <button onClick={onCancel} className="text-sm text-fg-muted underline">
          Annuler
        </button>
      </div>

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
          className={inputCls}
        />
      </Field>
      <Field label="Code-barres">
        <input
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          className={`${inputCls} font-mono`}
        />
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
      <Field label="Statut">
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutEquipment)}
          className={inputCls}
        >
          {STATUTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {eq.type === "vrac" && (
        <Field label="Quantité théorique">
          <input
            type="number"
            value={quantiteTheo}
            onChange={(e) => setQuantiteTheo(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
      )}
      {eq.type === "consommable" && (
        <>
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

      <Button onClick={() => void save()} loading={saving} className="w-full">
        Enregistrer
      </Button>
    </div>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export function ExterneFields({
  externe,
  setExterne,
  fournisseurs,
  fournisseurId,
  setFournisseurId,
  nouveauFournisseur,
  setNouveauFournisseur,
  refDevis,
  setRefDevis,
}: {
  externe: boolean;
  setExterne: (v: boolean) => void;
  fournisseurs: Fournisseur[];
  fournisseurId: number | "";
  setFournisseurId: (v: number | "") => void;
  nouveauFournisseur: string;
  setNouveauFournisseur: (v: string) => void;
  refDevis: string;
  setRefDevis: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg-soft p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={externe}
          onChange={(e) => setExterne(e.target.checked)}
          className="h-4 w-4 accent-fg"
        />
        Matériel en location externe
      </label>
      {externe && (
        <>
          <Field label="Fournisseur">
            <select
              value={fournisseurId}
              onChange={(e) =>
                setFournisseurId(e.target.value === "" ? "" : Number(e.target.value))
              }
              disabled={!!nouveauFournisseur.trim()}
              className={inputCls}
            >
              <option value="">— choisir —</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
          </Field>
          <Field label="…ou nouveau fournisseur">
            <input
              value={nouveauFournisseur}
              onChange={(e) => setNouveauFournisseur(e.target.value)}
              placeholder="Nom du fournisseur"
              className={inputCls}
            />
          </Field>
          <Field label="Référence devis">
            <input
              value={refDevis}
              onChange={(e) => setRefDevis(e.target.value)}
              className={inputCls}
            />
          </Field>
        </>
      )}
    </div>
  );
}
