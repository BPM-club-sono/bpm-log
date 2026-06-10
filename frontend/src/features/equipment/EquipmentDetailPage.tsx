import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { syncEngine } from "@/lib/syncEngine";
import { labelCart } from "@/lib/labelCart";
import { compressImage } from "@/lib/image";
import type {
  Categorie,
  ConsoPreview,
  ContenuChild,
  Emplacement,
  EquipmentDetail,
  EquipmentListItem,
  Fournisseur,
  InventaireEntry,
  PathSegment,
  StatutEquipment,
  VracDetailInfo,
} from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { StatusBadge } from "@/shared/StatusBadge";
import { useToast } from "@/shared/Toast";
import { RangementField, type RangementMode } from "./RangementField";

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
  const canEdit = user?.role === "Admin" || user?.role === "Staff";

  const [eq, setEq] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [inCart, setInCart] = useState(false);

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

  // Panier d'étiquettes : état réactif (bascule ajout / retrait).
  useEffect(() => {
    setInCart(labelCart.has(equipmentId));
    return labelCart.subscribe(() => setInCart(labelCart.has(equipmentId)));
  }, [equipmentId]);

  function toggleLabel() {
    labelCart.toggle(equipmentId);
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error && !eq) {
    return (
      <div className="space-y-4">
        <p className="py-8 text-center text-sm text-danger">{error}</p>
        <Link to="/inventaire" className="text-sm text-fg-muted hover:text-fg">
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

      <div className="space-y-3 border-b border-line pb-5">
        {eq.chemin && eq.chemin.length > 0 && <Chemin segments={eq.chemin} />}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{eq.nom}</h1>
            <p className="font-mono text-xs text-fg-muted">{eq.barcode_uid}</p>
          </div>
          <StatusBadge statut={eq.statut_actuel} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Icon name="label" className="text-sm" />
            {TYPE_LABEL[eq.type]}
          </span>
          {eq.externe && (
            <span className="inline-flex items-center gap-1 text-warning">
              <Icon name="local_shipping" className="text-sm" />
              Location externe
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Info label="Catégorie" value={eq.categorie_nom} />
          <Info
            label="Rangement"
            value={
              eq.contenant_id ? (
                <Link
                  to={`/inventaire/${eq.contenant_id}`}
                  className="font-medium hover:text-fg-muted"
                >
                  {eq.contenant_nom}
                </Link>
              ) : (
                eq.emplacement_nom
              )
            }
          />
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
        <Button variant={inCart ? "primary" : "ghost"} onClick={toggleLabel}>
          <Icon name={inCart ? "check" : "qr_code_2"} className="text-xl" />
          {inCart ? "Ajouté ✓" : "Imprimer étiquette"}
        </Button>
      </div>

      <Button variant="ghost" onClick={() => setMoving((v) => !v)} className="w-full">
        <Icon name="move_up" className="text-xl" />
        Déplacer / ranger
      </Button>
      {moving && (
        <MoveBlock
          equipmentId={equipmentId}
          currentName={eq.nom}
          onDone={() => setMoving(false)}
        />
      )}

      {eq.contenu && eq.contenu.length > 0 && <ContenuBlock contenu={eq.contenu} />}

      {eq.vrac && (
        <VracBlock equipmentId={equipmentId} vrac={eq.vrac} onChange={load} />
      )}
      {eq.conso && <ConsoBlock equipmentId={equipmentId} conso={eq.conso} />}

      <ActivityTimeline tickets={eq.tickets} scans={eq.scans} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="truncate">{value ?? "—"}</dd>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Fil d'Ariane de localisation (Dépôt > Étagère A > Flight MH)
// --------------------------------------------------------------------------- //
function Chemin({ segments }: { segments: PathSegment[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-fg-muted">
      <Icon name="location_on" className="text-sm" />
      {segments.map((seg, i) => (
        <span key={`${seg.kind}-${seg.id}`} className="inline-flex items-center gap-1">
          {i > 0 && <Icon name="chevron_right" className="text-sm opacity-60" />}
          {seg.kind === "contenant" ? (
            <Link to={`/inventaire/${seg.id}`} className="font-medium hover:text-fg">
              {seg.nom}
            </Link>
          ) : (
            <span>{seg.nom}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// --------------------------------------------------------------------------- //
// Contenu d'un contenant (flight case) : enfants directs + pack list
// --------------------------------------------------------------------------- //
function ContenuBlock({ contenu }: { contenu: ContenuChild[] }) {
  const { toast } = useToast();
  function addAllToCart() {
    contenu.forEach((c) => labelCart.add(c.id));
    toast(`${contenu.length} étiquette(s) ajoutée(s) au panier`, "success");
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg-muted">
          Contenu · {contenu.length} élément{contenu.length > 1 ? "s" : ""}
        </h2>
        <button
          type="button"
          onClick={addAllToCart}
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <Icon name="qr_code_2" className="text-sm" />
          Pack list
        </button>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {contenu.map((c) => (
          <Link
            key={c.id}
            to={`/inventaire/${c.id}`}
            className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-bg-soft"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                name={c.est_contenant ? "inventory_2" : "label"}
                className="flex-none text-base text-fg-muted"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.nom}</p>
                <p className="truncate font-mono text-xs text-fg-muted">
                  {c.barcode_uid}
                </p>
              </div>
            </div>
            <StatusBadge statut={c.statut_actuel} />
          </Link>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Déplacement offline : ranger dans un emplacement OU un contenant
// --------------------------------------------------------------------------- //
function MoveBlock({
  equipmentId,
  currentName,
  onDone,
}: {
  equipmentId: number;
  currentName: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"emplacement" | "contenant">("emplacement");
  const [emplacements, setEmplacements] = useState<Emplacement[]>([]);
  const [containers, setContainers] = useState<EquipmentListItem[]>([]);
  const [target, setTarget] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [emp, eqs] = await Promise.all([
          api<Emplacement[]>("/emplacements"),
          api<EquipmentListItem[]>("/equipments"),
        ]);
        setEmplacements(emp);
        // Cibles : seulement les flights, sauf soi-même (le serveur refuse les boucles).
        setContainers(eqs.filter((e) => e.est_contenant && e.id !== equipmentId));
      } catch {
        // listes non bloquantes
      }
    })();
  }, [equipmentId]);

  useEffect(() => setTarget(""), [mode]);

  async function confirm() {
    if (target === "") return;
    setBusy(true);
    const payload =
      mode === "contenant"
        ? { equipment_id: equipmentId, contenant_destination_id: target }
        : { equipment_id: equipmentId, emplacement_destination_id: target };
    await syncEngine.enqueue("deplacement", payload);
    toast(`« ${currentName} » déplacé (synchro en attente)`, "success");
    setBusy(false);
    onDone();
  }

  return (
    <section className="space-y-3 rounded-xl border border-line bg-bg-soft p-3">
      <div className="flex gap-1.5">
        {(["emplacement", "contenant"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "border-fg bg-fg text-bg" : "border-line bg-bg-elev text-fg"
            }`}
          >
            {m === "emplacement" ? "Emplacement" : "Dans un flight"}
          </button>
        ))}
      </div>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}
        className={inputCls}
      >
        <option value="">— choisir —</option>
        {mode === "emplacement"
          ? emplacements.map((em) => (
              <option key={em.id} value={em.id}>
                {em.nom}
              </option>
            ))
          : containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
      </select>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone} className="flex-1">
          Annuler
        </Button>
        <Button
          onClick={() => void confirm()}
          loading={busy}
          disabled={target === ""}
          className="flex-1"
        >
          Déplacer
        </Button>
      </div>
    </section>
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
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-fg-muted">Inventaire vrac</h2>
      {err && <p className="text-sm text-danger">{err}</p>}

      <div className="py-2 text-center">
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
        <div className="space-y-2">
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
        <div className="divide-y divide-line">
          {local.historique.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
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
            </div>
          ))}
        </div>
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
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-fg-muted">Stock consommable</h2>
      <div className="py-2 text-center">
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

// --------------------------------------------------------------------------- //
// Timeline d'activité unifiée (scans + réparations)
// --------------------------------------------------------------------------- //
const AVANCEMENT_LABEL: Record<string, string> = {
  A_faire: "À faire",
  En_cours: "En cours",
  En_attente_de_piece: "En attente de pièce",
  Resolu: "Résolu",
};

interface TimelineEvent {
  key: string;
  date: string;
  icon: string;
  accent: string; // classe texte pour le point quand c'est l'évènement le plus récent
  title: string;
  sub: string | null;
  to?: string;
}

function ConditionalLink({
  to,
  className,
  children,
}: {
  to?: string;
  className?: string;
  children: ReactNode;
}) {
  if (to) {
    return (
      <Link to={to} className={`${className ?? ""} transition-colors hover:opacity-80`}>
        {children}
      </Link>
    );
  }
  return <div className={className}>{children}</div>;
}

function scanLabel(typeAction: string, contexte: string | null): {
  title: string;
  icon: string;
  accent: string;
} {
  switch (typeAction) {
    case "Scan_Sortie":
      return {
        title: contexte ? `Sorti — ${contexte}` : "Sorti",
        icon: "logout",
        accent: "bg-warning",
      };
    case "Scan_Entree":
      return {
        title: contexte ? `Rentré — ${contexte}` : "Rentré",
        icon: "login",
        accent: "bg-success",
      };
    case "Changement_Statut":
      // Les déplacements sont aussi loggés en Changement_Statut (contexte dédié).
      if (contexte && (contexte === "Déplacé" || contexte.startsWith("Rangé"))) {
        return { title: contexte, icon: "move_up", accent: "bg-fg" };
      }
      return {
        title: `Statut ${contexte ?? "modifié"}`,
        icon: "swap_horiz",
        accent: "bg-fg",
      };
    case "Inventaire_Vrac":
      return { title: "Inventaire vrac", icon: "inventory_2", accent: "bg-fg" };
    default:
      return { title: typeAction, icon: "qr_code_2", accent: "bg-fg" };
  }
}

function ActivityTimeline({
  tickets,
  scans,
}: {
  tickets: EquipmentDetail["tickets"];
  scans: EquipmentDetail["scans"];
}) {
  const events: TimelineEvent[] = [
    ...scans.map((s) => {
      const { title, icon, accent } = scanLabel(s.type_action, s.contexte);
      return {
        key: `scan-${s.id}`,
        date: s.date_scan,
        icon,
        accent,
        title,
        sub: `par ${s.membre_nom ?? "—"}`,
      };
    }),
    ...tickets.map((t) => ({
      key: `ticket-${t.id}`,
      date: t.date_declaration,
      icon: "build",
      accent: "bg-danger",
      title: `Réparation — ${AVANCEMENT_LABEL[t.avancement] ?? t.avancement}`,
      sub: t.description_panne,
      to: `/pannes/${t.id}`,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (events.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Activité</h2>
        <p className="text-sm text-fg-muted">Aucune activité enregistrée.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-fg-muted">Activité</h2>
      <ol className="relative ml-1">
        {events.map((ev, i) => {
          const isLast = i === events.length - 1;
          const isMostRecent = i === 0;
          return (
            <li key={ev.key} className="relative flex gap-3 pb-4 last:pb-0">
              {/* trait vertical reliant les points */}
              {!isLast && (
                <span className="absolute left-[7px] top-4 h-full w-px bg-line" />
              )}
              {/* point : plein coloré pour le plus récent, creux gris sinon */}
              <span
                className={`relative z-10 mt-1 flex h-4 w-4 flex-none items-center justify-center`}
              >
                <span
                  className={
                    isMostRecent
                      ? `h-3 w-3 rounded-full ${ev.accent}`
                      : "h-2.5 w-2.5 rounded-full border-2 border-line bg-bg"
                  }
                />
              </span>
              <ConditionalLink to={ev.to} className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon name={ev.icon} className="text-base text-fg-muted" />
                    <span className="truncate">{ev.title}</span>
                    {ev.to && (
                      <Icon
                        name="chevron_right"
                        className="flex-none text-sm text-fg-muted"
                      />
                    )}
                  </p>
                  <span className="flex-none text-xs text-fg-muted">
                    {formatDate(ev.date)}
                  </span>
                </div>
                {ev.sub && (
                  <p className="mt-0.5 truncate text-xs text-fg-muted">{ev.sub}</p>
                )}
              </ConditionalLink>
            </li>
          );
        })}
      </ol>
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
  const [rangementMode, setRangementMode] = useState<RangementMode>(
    eq.contenant_id ? "contenant" : "emplacement",
  );
  const [contenantId, setContenantId] = useState<number | "">(eq.contenant_id ?? "");
  const [estContenant, setEstContenant] = useState(eq.est_contenant);
  const [containers, setContainers] = useState<EquipmentListItem[]>([]);
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
        const [cat, emp, four, eqs] = await Promise.all([
          api<Categorie[]>("/categories"),
          api<Emplacement[]>("/emplacements"),
          api<Fournisseur[]>("/fournisseurs"),
          api<EquipmentListItem[]>("/equipments"),
        ]);
        setCategories(cat);
        setEmplacements(emp);
        setFournisseurs(four);
        // Cibles : seulement les flights, sauf soi-même (le serveur refuse les boucles).
        setContainers(eqs.filter((e) => e.est_contenant && e.id !== eq.id));
      } catch {
        // listes non bloquantes
      }
    })();
  }, [eq.id]);

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
        statut_actuel: statut,
        externe,
      };
      // Rangement : emplacement fixe OU contenant (exclusifs côté serveur).
      if (rangementMode === "contenant" && contenantId !== "") {
        body.contenant_id = contenantId;
      } else {
        body.emplacement_id = emplacementId === "" ? null : emplacementId;
      }
      if (eq.type === "standard") body.est_contenant = estContenant;
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
        <button onClick={onCancel} className="text-sm text-fg-muted hover:text-fg">
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
      <RangementField
        mode={rangementMode}
        onModeChange={setRangementMode}
        emplacementId={emplacementId}
        onEmplacementChange={setEmplacementId}
        contenantId={contenantId}
        onContenantChange={setContenantId}
        emplacements={emplacements}
        flights={containers}
      />
      {eq.type === "standard" && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={estContenant}
            onChange={(e) => setEstContenant(e.target.checked)}
            className="h-4 w-4 accent-fg"
          />
          Flight (peut contenir du matériel)
        </label>
      )}
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
  const favoris = fournisseurs.filter((f) => f.favori);
  // On déplie la liste complète s'il n'y a aucun favori, ou si le fournisseur
  // sélectionné n'en est pas un.
  const selectedIsFavori =
    fournisseurId !== "" && favoris.some((f) => f.id === fournisseurId);
  // Replié par défaut : on montre les favoris dès qu'ils sont chargés. Si aucun
  // favori n'existe, le <select> complet s'affiche via la condition de rendu.
  const [showAll, setShowAll] = useState(false);

  function pickFavori(id: number) {
    setNouveauFournisseur("");
    setShowAll(false);
    setFournisseurId(fournisseurId === id ? "" : id);
  }

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
          <div className="space-y-1">
            <span className="text-xs font-medium text-fg-muted">Fournisseur</span>
            {favoris.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {favoris.map((f) => {
                  const active = fournisseurId === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pickFavori(f.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? "border-fg bg-fg text-bg"
                          : "border-line bg-bg-elev text-fg"
                      }`}
                    >
                      {f.nom}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    showAll || (fournisseurId !== "" && !selectedIsFavori)
                      ? "border-fg bg-fg text-bg"
                      : "border-line bg-bg-elev text-fg"
                  }`}
                >
                  Autre…
                </button>
              </div>
            )}
            {(showAll || favoris.length === 0) && (
              <select
                value={fournisseurId}
                onChange={(e) =>
                  setFournisseurId(e.target.value === "" ? "" : Number(e.target.value))
                }
                disabled={!!nouveauFournisseur.trim()}
                className={`${inputCls} mt-1`}
              >
                <option value="">— choisir —</option>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                    {f.favori ? " ★" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Field label="Référence devis">
            <input
              value={refDevis}
              onChange={(e) => setRefDevis(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Link
            to="/fournisseurs"
            className="inline-flex items-center gap-1 text-xs text-fg-muted"
          >
            <Icon name="settings" className="text-sm" />
            Gérer les fournisseurs (contacts, favoris)
          </Link>
        </>
      )}
    </div>
  );
}
