import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { syncEngine } from "@/lib/syncEngine";
import type {
  Allocation,
  ClotureDecision,
  EquipmentListItem,
  PrestationDetail,
  StatutAllocation,
  StatutEquipment,
  StatutPrestation,
} from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { normaliser } from "@/lib/barcode";
import { Button } from "@/shared/Button";
import { EquipmentSearch } from "@/shared/EquipmentSearch";
import { Icon } from "@/shared/Icon";
import { EquipmentForm } from "@/features/equipment/EquipmentForm";
import { ChecklistView, type ChecklistSens } from "./ChecklistView";
import { LocationsRendues } from "./LocationsRendues";
import { ModeleSearch } from "./ModeleSearch";
import {
  ecrireModeRecherche,
  lireModeRecherche,
  type ModeRecherche,
} from "./modeRecherche";
import { buildAllocTree, fournisseurChips } from "./prestationTree";
import { formatPeriode } from "@/lib/prestationDate";
import { useToast } from "@/shared/Toast";
import { STATUT_LABEL, STATUT_STYLE, derivePrestaStatut } from "./statut";
import { rapportCloture, type LigneRapport } from "./rapportCloture";

type Mode = "info" | "sortie" | "retour" | "cloture";

const STATUT_ALLOC_LABEL: Record<StatutAllocation, string> = {
  Planifie: "Planifié",
  Sorti: "Sorti",
  Retourne: "Retourné",
};

/** Statuts qui interdisent l'allocation (miroir de services/disponibilite.py). */
const STATUT_BLOQUANT: Partial<Record<StatutEquipment, string>> = {
  En_Panne: "HS",
  En_Reparation: "HS",
  Perdu: "Perdu",
  Reforme: "Réformé",
};

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
  const [mode, setMode] = useState<Mode>("info");
  const { toast } = useToast();
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
      // Préchargement auto : tout accès en ligne rafraîchit le snapshot offline.
      void db.presta_snapshots
        .get(prestaId)
        .then((existing) =>
          db.presta_snapshots.put({
            presta_id: prestaId,
            presta: d,
            allocations: d.allocations,
            // Conserve la 1re date de préparation ; sinon stamp à l'ouverture.
            prepared_at: existing?.prepared_at ?? new Date().toISOString(),
          }),
        )
        .catch(() => {
          // IndexedDB indisponible/quota : ne pas bloquer l'affichage en ligne.
        });
    } catch (err) {
      // Hors-ligne : on retombe sur le snapshot préchargé.
      const snap = await db.presta_snapshots.get(prestaId);
      if (snap) {
        setDetail(snap.presta);
        setAllocs(snap.allocations);
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

  // Le statut suit le pointage (miroir de services/prestation_statut.py côté
  // serveur). On le dérive aussi localement pour que le badge bouge hors-ligne,
  // là où le serveur ne tranchera qu'à la synchro.
  useEffect(() => {
    setDetail((prev) => {
      if (!prev) return prev;
      const statut = derivePrestaStatut(allocs, prev.statut);
      return statut === prev.statut ? prev : { ...prev, statut };
    });
  }, [allocs]);

  const anomalies = useMemo(() => rapportCloture(allocs).anomalies, [allocs]);

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
          // Miroir du serveur : un perdu / en suspens entièrement rendu sort du rapport.
          const regle =
            v >= a.quantite_sortie &&
            (a.decision_cloture === "perdu" || a.decision_cloture === "ouvert");
          return {
            ...a,
            quantite_retournee: v,
            ...(regle ? { decision_cloture: null } : {}),
          };
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
    // Le code arrive déjà normalisé de ChecklistView ; on renormalise les deux
    // côtés pour ne pas dépendre de la casse d'un snapshot pris avant la refonte.
    const code = normaliser(barcode);
    const match = allocs.find(
      (a) => normaliser(a.equipment_barcode ?? "") === code,
    );
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
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUT_STYLE[detail.statut]}`}
          >
            {STATUT_LABEL[detail.statut]}
          </span>
          {/* « Terminée » ne veut pas dire « tout est rentré » : on le signale. */}
          {detail.statut === "Terminee" && anomalies > 0 && (
            <button
              type="button"
              onClick={() => setMode("cloture")}
              className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning"
            >
              <Icon name="warning" className="text-sm" />
              {anomalies} anomalie{anomalies > 1 ? "s" : ""}
            </button>
          )}
          <p className="text-sm text-fg-muted">
            {detail.type}
            {detail.client_nom ? ` · ${detail.client_nom}` : ""}
            {offline && " · hors-ligne"}
          </p>
        </div>
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
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`-mb-px h-10 flex-1 border-b-2 text-xs font-medium transition-colors ${
              mode === m ? "border-fg text-fg" : "border-transparent text-fg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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
          statut={detail.statut}
          allocs={allocs}
          canManage={canManage && !offline}
          onClosed={load}
          onError={setError}
          toast={toast}
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
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [reopening, setReopening] = useState(false);
  // "tous" | "interne" | String(fournisseur_id) — un loueur précis.
  const [filter, setFilter] = useState<string>("tous");
  const [modeRecherche, setModeRecherche] = useState<ModeRecherche>(lireModeRecherche);
  const allocatedIds = useMemo(
    () => new Set(allocs.map((a) => a.equipment_id)),
    [allocs],
  );

  function basculerRecherche() {
    const next = modeRecherche === "modele" ? "nom" : "modele";
    ecrireModeRecherche(next);
    setModeRecherche(next);
    setSearch("");
  }

  async function addEquipment(eq: EquipmentListItem) {
    setAdding(true);
    try {
      const res = await api<Allocation>(`/prestations/${detail.id}/allocations`, {
        method: "POST",
        // Un contenant entraîne son contenu (les items suivent la caisse).
        body: { equipment_id: eq.id, quantite: 1, inclure_contenu: !!eq.est_contenant },
      });
      setSearch("");
      await onReload();
      const ignores = res.contenu_ignore ?? 0;
      if (ignores > 0) {
        toast(
          `${ignores} objet${ignores > 1 ? "s" : ""} du flight non ajouté${ignores > 1 ? "s" : ""} (HS ou déjà pris).`,
          "info",
        );
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ajout impossible.", "error");
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

  async function rouvrir() {
    setReopening(true);
    try {
      await api(`/prestations/${detail.id}/reouverture`, { method: "POST" });
      await onReload();
      toast("Prestation rouverte.", "success");
    } catch {
      toast("Réouverture impossible.", "error");
    } finally {
      setReopening(false);
    }
  }

  // Le matériel reste ajustable jusqu'à la clôture — c'est la réouverture, et
  // non un statut intermédiaire, qui sert de garde-fou si on a oublié un item.
  const editable = canManage && detail.statut !== "Terminee";

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

  // Une unité (quantité 1) affiche son état ; un lot, ses compteurs.
  const metaLine = (a: Allocation) => (
    <p className="mt-1 text-xs text-fg-muted">
      {a.quantite === 1
        ? STATUT_ALLOC_LABEL[a.statut]
        : `Prévu ${a.quantite} · sorti ${a.quantite_sortie} · retourné ${a.quantite_retournee}`}
    </p>
  );
  // Unité tombée en panne (ou perdue) depuis son allocation : à remplacer à la main.
  const estHs = (a: Allocation) =>
    a.statut !== "Retourne" && !!a.equipment_statut && !!STATUT_BLOQUANT[a.equipment_statut];
  const nbHs = allocs.filter(estHs).length;
  const badges = (a: Allocation) => (
    <>
      {estHs(a) && (
        <span className="flex-none rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
          {STATUT_BLOQUANT[a.equipment_statut!]}
        </span>
      )}
      {a.equipment_externe && (
        <span className="flex-none rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
          Location
        </span>
      )}
    </>
  );
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
      {detail.statut === "Terminee" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-bg-soft p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Prestation clôturée</p>
            <p className="text-xs text-fg-muted">
              Le matériel n'est plus modifiable. Rouvre la prestation pour
              ajouter un oubli.
            </p>
          </div>
          {canManage && (
            <Button
              className="h-9 shrink-0 px-3 text-xs"
              onClick={rouvrir}
              loading={reopening}
            >
              Rouvrir
            </Button>
          )}
        </div>
      )}
      {detail.statut === "Terminee" && canManage && (
        <LocationsRendues prestaId={detail.id} onDone={onReload} />
      )}
      {nbHs > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <Icon name="warning" className="text-lg" />
          {nbHs} unité{nbHs > 1 ? "s" : ""} HS dans la prestation : à remplacer.
        </div>
      )}
      {editable && (
        <div className="space-y-2">
          {modeRecherche === "modele" ? (
            <ModeleSearch
              prestaId={detail.id}
              value={search}
              onChange={setSearch}
              version={allocs.map((a) => a.id).join(",")}
              onChanged={onReload}
              onToggleMode={basculerRecherche}
            />
          ) : (
            <EquipmentSearch
              value={search}
              onChange={setSearch}
              onSelect={addEquipment}
              excludeIds={allocatedIds}
              disabled={adding}
              placeholder="Nom ou code-barres…"
              extraQuery={`pour_presta=${detail.id}`}
              indisponible={(e) =>
                STATUT_BLOQUANT[e.statut_actuel] ??
                (e.occupe_par ? `Pris · ${e.occupe_par.presta_nom}` : null)
              }
              renderMeta={(e) =>
                [e.modele_nom, e.est_contenant ? "contenu inclus" : null]
                  .filter(Boolean)
                  .join(" · ") || null
              }
              renderTrailing={() => (
                <Icon name="add_circle" className="text-xl text-fg-muted" />
              )}
              icon="search"
              onIconClick={basculerRecherche}
              iconLabel="Passer à la recherche par modèle"
            />
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
                  {badges(a)}
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
                    {badges(a)}
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
                            {badges(c)}
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
              prestaId={detail.id}
              submitLabel="Créer et allouer"
              onCreated={async () => {
                setShowModal(false);
                setSearch("");
                await onReload();
              }}
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
  statut,
  allocs,
  canManage,
  onClosed,
  onError,
  toast,
}: {
  prestaId: number;
  statut: StatutPrestation;
  allocs: Allocation[];
  canManage: boolean;
  onClosed: () => Promise<void>;
  onError: (message: string | null) => void;
  toast: (message: string, kind?: "success" | "error" | "info") => void;
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
    onError(null);
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
      // On reste sur l'onglet : il affiche maintenant le rapport de clôture.
      await onClosed();
      toast("Prestation clôturée.", "success");
    } catch {
      onError("Clôture impossible. Réessaie une fois en ligne.");
    } finally {
      setSaving(false);
    }
  }

  // Déjà clôturée : pas de bouton re-cliquable, on affiche le bilan.
  if (statut === "Terminee") return <RapportClotureView allocs={allocs} />;

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

// --- Rapport de clôture -------------------------------------------------

function RapportClotureView({ allocs }: { allocs: Allocation[] }) {
  const rapport = useMemo(() => rapportCloture(allocs), [allocs]);

  if (rapport.anomalies === 0) {
    return (
      <div className="space-y-3 py-8 text-center">
        <Icon name="task_alt" className="text-4xl text-success" />
        <p className="text-sm">Prestation clôturée : tout le matériel est rentré.</p>
        <p className="text-xs text-fg-muted">
          Pour ajouter un oubli, rouvre-la depuis l'onglet Détail.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
        <Icon name="warning" className="text-xl text-warning" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Clôturée avec {rapport.anomalies} anomalie
            {rapport.anomalies > 1 ? "s" : ""}
          </p>
          <p className="text-xs text-fg-muted">
            Du matériel n'est pas rentré en état. Chaque ligne renvoie à la fiche de
            l'équipement et à son historique.
          </p>
        </div>
      </div>
      <RapportSection
        titre="Perdus"
        aide="Équipement passé en « Perdu »."
        icon="search_off"
        accent="text-danger"
        lignes={rapport.perdus}
      />
      <RapportSection
        titre="Cassés"
        aide="Équipement passé en panne, ticket de réparation ouvert."
        icon="build"
        accent="text-warning"
        lignes={rapport.casses}
      />
      <RapportSection
        titre="Laissés en suspens"
        aide="Pas encore rentrés ni tranchés : l'écart reste à régler."
        icon="hourglass_empty"
        accent="text-warning"
        lignes={rapport.enSuspens}
      />
      <p className="text-xs text-fg-muted">
        Pour ajouter un oubli, rouvre la prestation depuis l'onglet Détail.
      </p>
    </div>
  );
}

function RapportSection({
  titre,
  aide,
  icon,
  accent,
  lignes,
}: {
  titre: string;
  aide: string;
  icon: string;
  accent: string;
  lignes: LigneRapport[];
}) {
  if (lignes.length === 0) return null;
  return (
    <section className="space-y-1">
      <h2 className={`flex items-center gap-1.5 text-sm font-semibold ${accent}`}>
        <Icon name={icon} className="text-base" />
        {titre} ({lignes.length})
      </h2>
      <p className="text-xs text-fg-muted">{aide}</p>
      <ul className="divide-y divide-line">
        {lignes.map(({ alloc: a, manquant }) => (
          <li key={a.id}>
            <Link
              to={`/inventaire/${a.equipment_id}`}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.equipment_nom ?? a.equipment_barcode ?? `#${a.equipment_id}`}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {[a.equipment_barcode, a.fournisseur_nom].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                {manquant > 1 && `×${manquant}`}
                <Icon name="chevron_right" className="text-base" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
