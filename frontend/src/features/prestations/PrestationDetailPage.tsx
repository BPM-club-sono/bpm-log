import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { syncEngine } from "@/lib/syncEngine";
import type {
  Allocation,
  ClotureDecision,
  EquipmentListItem,
  PrestationDetail,
} from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { EquipmentForm } from "@/features/equipment/EquipmentForm";
import { ChecklistView, type ChecklistSens } from "./ChecklistView";
import { buildAllocTree, fournisseurChips } from "./prestationTree";
import { formatPeriode } from "@/lib/prestationDate";

type Mode = "info" | "sortie" | "retour" | "cloture";

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(v, high));
}

export function PrestationDetailPage() {
  const { id } = useParams();
  const prestaId = Number(id);
  const { user } = useAuth();
  const canManage = user?.role === "Admin" || user?.role === "Staff";

  const [detail, setDetail] = useState<PrestationDetail | null>(null);
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  const [prepared, setPrepared] = useState(false);
  const [mode, setMode] = useState<Mode>("info");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // --- Chargement : API en ligne, sinon snapshot Dexie -------------------
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<PrestationDetail>(`/prestations/${prestaId}`);
      setDetail(d);
      setAllocs(d.allocations);
      setOffline(false);
      const snap = await db.presta_snapshots.get(prestaId);
      setPrepared(snap != null);
    } catch (err) {
      // Hors-ligne : on retombe sur le snapshot préchargé.
      const snap = await db.presta_snapshots.get(prestaId);
      if (snap) {
        setDetail(snap.presta);
        setAllocs(snap.allocations);
        setPrepared(true);
        setOffline(true);
      } else {
        setError(
          err instanceof ApiError
            ? "Prestation introuvable."
            : "Hors-ligne et non préparée pour le terrain.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [prestaId]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Persistance du snapshot local (pour l'offline) --------------------
  const persistSnapshot = useCallback(
    async (nextAllocs: Allocation[]) => {
      if (!detail) return;
      const existing = await db.presta_snapshots.get(prestaId);
      await db.presta_snapshots.put({
        presta_id: prestaId,
        presta: { ...detail, allocations: nextAllocs },
        allocations: nextAllocs,
        prepared_at: existing?.prepared_at ?? new Date().toISOString(),
      });
    },
    [detail, prestaId],
  );

  async function prepareForField() {
    try {
      const d = await api<PrestationDetail>(`/prestations/${prestaId}`);
      setDetail(d);
      setAllocs(d.allocations);
      await db.presta_snapshots.put({
        presta_id: prestaId,
        presta: d,
        allocations: d.allocations,
        prepared_at: new Date().toISOString(),
      });
      setPrepared(true);
    } catch {
      setError("Préparation impossible (réseau requis).");
    }
  }

  // --- Checklist : application d'un delta unitaire -----------------------
  const applyDelta = useCallback(
    (alloc: Allocation, sens: ChecklistSens, delta: number) => {
      setAllocs((prev) => {
        const next = prev.map((a) => {
          if (a.id !== alloc.id) return a;
          if (sens === "sortie") {
            const v = clamp(a.quantite_sortie + delta, 0, a.quantite);
            if (v === a.quantite_sortie) return a;
            return { ...a, quantite_sortie: v };
          }
          const v = clamp(a.quantite_retournee + delta, 0, a.quantite_sortie);
          if (v === a.quantite_retournee) return a;
          return { ...a, quantite_retournee: v };
        });
        void persistSnapshot(next);
        return next;
      });

      // Effective delta peut être 0 si déjà au bord : on n'empile alors rien.
      const cur = sens === "sortie" ? alloc.quantite_sortie : alloc.quantite_retournee;
      const max = sens === "sortie" ? alloc.quantite : alloc.quantite_sortie;
      const applied = clamp(cur + delta, 0, max) - cur;
      if (applied === 0) return;

      const target =
        alloc.equipment_id > 0
          ? { equipment_id: alloc.equipment_id }
          : { barcode_uid: alloc.equipment_barcode };
      void syncEngine.enqueue("presta_check", {
        presta_id: prestaId,
        sens,
        delta: applied,
        ...target,
      });
    },
    [persistSnapshot, prestaId],
  );

  function handleScan(barcode: string, sens: ChecklistSens) {
    const match = allocs.find((a) => a.equipment_barcode === barcode);
    if (match) {
      // Scanner un flight pointe tout son contenu d'un coup (case + descendants).
      const { descendantsOf } = buildAllocTree(allocs);
      const descendants = descendantsOf(match);
      if (descendants.length > 0) {
        for (const line of [match, ...descendants]) {
          const cur = sens === "sortie" ? line.quantite_sortie : line.quantite_retournee;
          const tgt = sens === "sortie" ? line.quantite : line.quantite_sortie;
          if (cur < tgt) applyDelta(line, sens, tgt - cur);
        }
      } else {
        applyDelta(match, sens, +1);
      }
      navigator.vibrate?.(40);
      return;
    }
    if (sens !== "sortie") {
      setError(`« ${barcode} » n'est pas dans la prestation.`);
      return;
    }
    // Item non alloué scanné en sortie → ligne ad-hoc (créée serveur à la sync).
    const adhoc: Allocation = {
      id: -Date.now(),
      presta_id: prestaId,
      equipment_id: 0,
      quantite: 1,
      quantite_sortie: 1,
      quantite_retournee: 0,
      statut: "Sorti",
      equipment_nom: null,
      equipment_barcode: barcode,
    };
    setAllocs((prev) => {
      const next = [...prev, adhoc];
      void persistSnapshot(next);
      return next;
    });
    void syncEngine.enqueue("presta_check", {
      presta_id: prestaId,
      sens: "sortie",
      delta: 1,
      barcode_uid: barcode,
    });
    navigator.vibrate?.(40);
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error && !detail) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-danger">{error}</p>
        <Link to="/prestations" className="text-sm text-fg-muted hover:text-fg">
          ← Retour aux prestations
        </Link>
      </div>
    );
  }
  if (!detail) return null;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link
          to="/prestations"
          className="inline-flex items-center gap-1 text-xs text-fg-muted"
        >
          <Icon name="arrow_back" className="text-sm" /> Prestations
        </Link>
        <h1 className="text-2xl font-bold">{detail.nom}</h1>
        <p className="text-sm text-fg-muted">
          {detail.type}
          {detail.client_nom ? ` · ${detail.client_nom}` : ""}
          {offline && " · hors-ligne"}
        </p>
        {(() => {
          const periode = formatPeriode(detail.date_debut, detail.date_fin);
          if (!periode) return null;
          return (
            <p className="inline-flex items-center gap-1 text-sm text-fg-muted">
              <Icon name="event" className="text-sm" />
              {periode}
            </p>
          );
        })()}
      </header>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* Onglets de mode — libellés adaptés au type de presta */}
      <div className="flex border-b border-line">
        {(
          (detail.type === "Interne"
            ? [
                ["info", "Détail"],
                ["sortie", "Réception"],
                ["retour", "Rendu"],
                ["cloture", "Clôture"],
              ]
            : [
                ["info", "Détail"],
                ["sortie", "Sortie"],
                ["retour", "Retour"],
                ["cloture", "Clôture"],
              ]) as [Mode, string][]
        ).map(([m, label]) => {
          const locked = m !== "info" && !prepared;
          return (
            <button
              key={m}
              onClick={() => !locked && setMode(m)}
              disabled={locked}
              className={`-mb-px h-10 flex-1 border-b-2 text-xs font-medium transition-colors ${
                mode === m ? "border-fg text-fg" : "border-transparent text-fg-muted"
              } ${locked ? "opacity-40" : ""}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!prepared && (
        <div className="space-y-3 rounded-xl border border-dashed border-line bg-bg-soft p-4">
          <div className="flex items-start gap-3">
            <Icon name="cloud_download" className="mt-0.5 text-2xl text-fg-muted" />
            <div className="space-y-0.5 text-left">
              <p className="text-sm font-medium">Télécharger pour le terrain</p>
              <p className="text-xs text-fg-muted">
                Enregistre la liste du matériel sur cet appareil pour pointer la
                sortie et le retour même sans réseau.
              </p>
            </div>
          </div>
          <Button className="w-full" onClick={prepareForField}>
            <Icon name="download_for_offline" className="text-lg" />
            Télécharger pour utilisation hors-ligne
          </Button>
          <button
            type="button"
            disabled
            className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line text-sm font-medium text-fg-muted opacity-50"
          >
            <Icon name="request_quote" className="text-lg" />
            Importer depuis un devis — bientôt
          </button>
        </div>
      )}

      {mode === "info" && (
        <InfoView
          detail={detail}
          allocs={allocs}
          canManage={canManage && !offline}
          onReload={load}
        />
      )}
      {mode === "sortie" && (
        <ChecklistView
          sens="sortie"
          prestaType={detail.type}
          allocations={allocs}
          onDelta={(a, d) => applyDelta(a, "sortie", d)}
          onScan={(b) => handleScan(b, "sortie")}
        />
      )}
      {mode === "retour" && (
        <ChecklistView
          sens="retour"
          prestaType={detail.type}
          allocations={allocs}
          onDelta={(a, d) => applyDelta(a, "retour", d)}
          onScan={(b) => handleScan(b, "retour")}
        />
      )}
      {mode === "cloture" && (
        <ClotureView
          prestaId={prestaId}
          allocs={allocs}
          canManage={canManage && !offline}
          onClosed={load}
        />
      )}
    </div>
  );
}

// --- Vue détail + gestion des allocations (en ligne) ---------------------

function InfoView({
  detail,
  allocs,
  canManage,
  onReload,
}: {
  detail: PrestationDetail;
  allocs: Allocation[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<EquipmentListItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  // "tous" | "interne" | String(fournisseur_id) — un loueur précis.
  const [filter, setFilter] = useState<string>("tous");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allocatedIds = useMemo(
    () => new Set(allocs.map((a) => a.equipment_id)),
    [allocs],
  );

  useEffect(() => {
    if (!canManage) return;
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api<EquipmentListItem[]>(
          `/equipments?q=${encodeURIComponent(q)}`,
        );
        setResults(r.filter((e) => !allocatedIds.has(e.id)).slice(0, 8));
      } catch {
        setResults([]);
      }
    }, 300);
  }, [search, canManage, allocatedIds]);

  async function addEquipment(eq: EquipmentListItem) {
    setAdding(true);
    try {
      await api(`/prestations/${detail.id}/allocations`, {
        method: "POST",
        // Un contenant entraîne son contenu (les items suivent la caisse).
        body: { equipment_id: eq.id, quantite: 1, inclure_contenu: !!eq.est_contenant },
      });
      setSearch("");
      setResults([]);
      await onReload();
    } finally {
      setAdding(false);
    }
  }

  async function removeAllocation(alloc: Allocation) {
    await api(`/prestations/${detail.id}/allocations/${alloc.id}`, {
      method: "DELETE",
    });
    await onReload();
  }

  async function allocateCreated(created: { id: number }, quantite: number) {
    await api(`/prestations/${detail.id}/allocations`, {
      method: "POST",
      body: { equipment_id: created.id, quantite: Math.max(1, quantite) },
    });
    setShowModal(false);
    setSearch("");
    setResults([]);
    await onReload();
  }

  async function passerEnPreparation() {
    setAdvancing(true);
    try {
      await api(`/prestations/${detail.id}`, {
        method: "PATCH",
        body: { statut: "En_preparation" },
      });
      await onReload();
    } finally {
      setAdvancing(false);
    }
  }

  // Construction (Ébauche) et préparation : on peut encore ajuster le matériel.
  const editable =
    canManage &&
    (detail.statut === "Ebauche" || detail.statut === "En_preparation");

  const hasInterne = allocs.some((a) => !a.equipment_externe);
  const chips = fournisseurChips(allocs);
  const filterGroups: [string, string][] = [["tous", "Tous"]];
  if (hasInterne) filterGroups.push(["interne", "Matériel BPM"]);
  for (const c of chips) filterGroups.push([String(c.id), c.nom]);
  const visibleAllocs = allocs.filter((a) => {
    if (filter === "tous") return true;
    if (filter === "interne") return !a.equipment_externe;
    return a.equipment_externe && String(a.fournisseur_id) === filter;
  });

  // Arbre des contenants : les items d'un flight sont affichés imbriqués sous
  // leur caisse (style timeline), pas en vrac dans la liste plate.
  const { topLevel, descendantsOf } = buildAllocTree(visibleAllocs);

  const metaLine = (a: Allocation) => (
    <p className="mt-1 text-xs text-fg-muted">
      Prévu {a.quantite} · sorti {a.quantite_sortie} · retourné {a.quantite_retournee}
    </p>
  );
  const locationBadge = (a: Allocation) =>
    a.equipment_externe ? (
      <span className="flex-none rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
        Location
      </span>
    ) : null;
  const deleteBtn = (a: Allocation) =>
    editable && a.id > 0 ? (
      <button
        onClick={() => removeAllocation(a)}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-fg-muted hover:text-danger"
        aria-label="Retirer"
      >
        <Icon name="delete" className="text-lg" />
      </button>
    ) : null;

  return (
    <div className="space-y-4">
      {canManage && detail.statut === "Ebauche" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-bg-soft p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Ébauche</p>
            <p className="text-xs text-fg-muted">
              Finalise le matériel, puis valide pour passer en
              préparation.
            </p>
          </div>
          <Button
            className="h-9 shrink-0 px-3 text-xs"
            onClick={passerEnPreparation}
            loading={advancing}
          >
            Valider la préparation
          </Button>
        </div>
      )}
      {editable && (
        <div className="space-y-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ajouter du matériel…"
              className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
            />
          </div>
          {results.length > 0 && (
            <ul className="divide-y divide-line border-y border-line">
              {results.map((e) => (
                <li key={e.id}>
                  <button
                    disabled={adding}
                    onClick={() => addEquipment(e)}
                    className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left transition-opacity hover:opacity-70"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {e.est_contenant && (
                          <Icon name="inventory_2" className="text-sm text-fg-muted" />
                        )}
                        {e.nom}
                      </span>
                      <span className="block font-mono text-xs text-fg-muted">
                        {e.barcode_uid}
                        {e.est_contenant ? " · contenu inclus" : ""}
                      </span>
                    </span>
                    <Icon name="add_circle" className="text-xl text-fg-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-medium text-fg-muted transition-colors hover:bg-bg-elev"
          >
            <Icon name="add" className="text-lg" />
            Ajouter du matériel (créer une fiche)
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-fg-muted">
            {allocs.length} ligne{allocs.length > 1 ? "s" : ""} allouée
            {allocs.length > 1 ? "s" : ""}
          </p>
        </div>

        {filterGroups.length > 2 && (
          <div className="flex flex-wrap gap-1.5">
            {filterGroups.map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? "border-fg bg-fg text-bg"
                    : "border-line bg-bg-soft text-fg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <ul className="divide-y divide-line">
          {topLevel.map((a) => {
            const children = descendantsOf(a);

            // Article simple (hors flight) : ligne plate classique.
            if (children.length === 0) {
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
                    </p>
                    {metaLine(a)}
                  </div>
                  {locationBadge(a)}
                  {deleteBtn(a)}
                </li>
              );
            }

            // Flight : en-tête caisse + ses items en timeline (clairement dedans).
            return (
              <li key={`flight-${a.id}`} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    <Icon name="inventory_2" className="flex-none text-base text-fg-muted" />
                    <span className="truncate">
                      {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
                    </span>
                    {locationBadge(a)}
                  </p>
                  {deleteBtn(a)}
                </div>
                <p className="mt-0.5 pl-[26px] text-xs text-fg-muted">
                  {children.length} article{children.length > 1 ? "s" : ""} dans le flight
                </p>
                <ol className="relative ml-2 mt-2">
                  {children.map((c, i) => {
                    const isLast = i === children.length - 1;
                    const isContainer = descendantsOf(c).length > 0;
                    return (
                      <li key={c.id} className="relative flex gap-3 pb-3 last:pb-0">
                        {!isLast && (
                          <span className="absolute left-[7px] top-4 h-full w-px bg-line" />
                        )}
                        <span className="relative z-10 mt-1 flex h-4 w-4 flex-none items-center justify-center">
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-line bg-bg" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            {isContainer && (
                              <Icon
                                name="inventory_2"
                                className="flex-none text-sm text-fg-muted"
                              />
                            )}
                            <span className="truncate">
                              {c.equipment_nom ?? c.equipment_barcode ?? `#${c.equipment_id}`}
                            </span>
                            {locationBadge(c)}
                          </p>
                          {metaLine(c)}
                        </div>
                        {deleteBtn(c)}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ul>
        {visibleAllocs.length === 0 && (
          <p className="py-8 text-center text-sm text-fg-muted">
            Aucun matériel alloué.
          </p>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-bg p-4 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Ajouter du matériel</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-elev"
                aria-label="Fermer"
              >
                <Icon name="close" className="text-xl" />
              </button>
            </div>
            <p className="mb-3 text-xs text-fg-muted">
              Crée une fiche (tous types) et l'alloue automatiquement à la
              prestation.
            </p>
            <EquipmentForm
              externeDefault
              showQuantite
              submitLabel="Créer et allouer"
              onCreated={(created, quantite) => allocateCreated(created, quantite)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Vue clôture ---------------------------------------------------------

const DECISIONS: { value: ClotureDecision; label: string }[] = [
  { value: "retourne", label: "Retourné" },
  { value: "perdu", label: "Perdu" },
  { value: "casse", label: "Cassé" },
  { value: "ouvert", label: "Laisser ouvert" },
];

function ClotureView({
  prestaId,
  allocs,
  canManage,
  onClosed,
}: {
  prestaId: number;
  allocs: Allocation[];
  canManage: boolean;
  onClosed: () => Promise<void>;
}) {
  const ecarts = useMemo(
    () =>
      allocs.filter(
        (a) =>
          a.id > 0 &&
          a.statut !== "Retourne" &&
          a.quantite_retournee < a.quantite_sortie,
      ),
    [allocs],
  );
  const [decisions, setDecisions] = useState<Record<number, ClotureDecision>>({});
  const [saving, setSaving] = useState(false);
  // Filtre par loueur : trancher les écarts un prestataire à la fois.
  const [filter, setFilter] = useState<string>("tous");

  const hasInterne = ecarts.some((a) => !a.equipment_externe);
  const chips = fournisseurChips(ecarts);
  const filterGroups: [string, string][] = [["tous", "Tous"]];
  if (hasInterne) filterGroups.push(["interne", "Matériel BPM"]);
  for (const c of chips) filterGroups.push([String(c.id), c.nom]);
  const visibleEcarts = ecarts.filter((a) => {
    if (filter === "tous") return true;
    if (filter === "interne") return !a.equipment_externe;
    return a.equipment_externe && String(a.fournisseur_id) === filter;
  });

  async function submit() {
    setSaving(true);
    try {
      await api(`/prestations/${prestaId}/cloture`, {
        method: "POST",
        body: {
          items: ecarts.map((a) => ({
            allocation_id: a.id,
            decision: decisions[a.id] ?? "ouvert",
          })),
        },
      });
      await onClosed();
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">
        La clôture nécessite une connexion et le rôle Staff.
      </p>
    );
  }

  if (ecarts.length === 0) {
    return (
      <div className="space-y-3 py-8 text-center">
        <Icon name="task_alt" className="text-4xl text-success" />
        <p className="text-sm">Tout le matériel sorti a été retourné.</p>
        <Button className="w-full" loading={saving} onClick={submit}>
          Clôturer la prestation
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        {ecarts.length} ligne{ecarts.length > 1 ? "s" : ""} avec un écart. Tranche
        chaque cas :
      </p>
      {filterGroups.length > 2 && (
        <div className="flex flex-wrap gap-1.5">
          {filterGroups.map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "border-fg bg-fg text-bg"
                  : "border-line bg-bg-soft text-fg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line">
        {visibleEcarts.map((a) => (
          <li
            key={a.id}
            className="space-y-2 py-3"
          >
            <div>
              <p className="text-sm font-medium">
                {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
              </p>
              <p className="text-xs text-fg-muted">
                Manquant : {a.quantite_sortie - a.quantite_retournee} /{" "}
                {a.quantite_sortie}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DECISIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() =>
                    setDecisions((prev) => ({ ...prev, [a.id]: d.value }))
                  }
                  className={`h-8 rounded-lg border text-xs font-medium transition-colors ${
                    (decisions[a.id] ?? "ouvert") === d.value
                      ? "border-fg bg-fg text-bg"
                      : "border-line text-fg-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Button className="w-full" loading={saving} onClick={submit}>
        Clôturer la prestation
      </Button>
    </div>
  );
}
