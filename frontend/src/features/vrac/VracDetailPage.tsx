import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { syncEngine } from "@/lib/syncEngine";
import type { InventaireEntry, VracDetail, VracLock } from "@/lib/types";
import { useAuth } from "@/app/AuthContext";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

interface LockResult {
  equipment_id: number;
  expires_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Détail d'une caisse vrac : verrou en ligne, comptage par deltas, historique. */
export function VracDetailPage() {
  const { id } = useParams<{ id: string }>();
  const equipmentId = Number(id);
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";

  const [caisse, setCaisse] = useState<VracDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCaisse(await api<VracDetail>(`/vrac/${equipmentId}`));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "Caisse introuvable."
          : "Erreur réseau.",
      );
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lock: VracLock | null = caisse?.lock ?? null;
  const canEdit = lock?.is_mine ?? false;

  async function acquireLock() {
    setBusy(true);
    setError(null);
    try {
      await api<LockResult>(`/vrac/${equipmentId}/lock`, { method: "POST" });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Caisse déjà verrouillée par un autre membre."
          : "Impossible de prendre le verrou (hors ligne ?).",
      );
    } finally {
      setBusy(false);
    }
  }

  async function releaseLock() {
    setBusy(true);
    try {
      await api(`/vrac/${equipmentId}/lock`, { method: "DELETE" });
      await load();
    } catch {
      setError("Impossible de libérer le verrou.");
    } finally {
      setBusy(false);
    }
  }

  async function applyDelta(delta: number) {
    if (!caisse || !canEdit) return;
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
    setCaisse({
      ...caisse,
      quantite_actuelle: caisse.quantite_actuelle + delta,
      ecart: caisse.ecart + delta,
      historique: [optimistic, ...caisse.historique],
    });
    await syncEngine.enqueue("vrac_delta", {
      equipment_id: equipmentId,
      delta,
    });
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error && !caisse) {
    return (
      <div className="space-y-4">
        <p className="py-8 text-center text-sm text-danger">{error}</p>
        <Link to="/vrac" className="text-sm text-fg-muted underline">
          ← Retour aux caisses
        </Link>
      </div>
    );
  }
  if (!caisse) return null;

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/vrac"
          className="inline-flex items-center gap-1 text-sm text-fg-muted"
        >
          <Icon name="arrow_back" className="text-base" /> Caisses
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{caisse.nom}</h1>
        <p className="text-xs text-fg-muted">{caisse.barcode_uid}</p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="rounded-2xl border border-line bg-bg-soft p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-fg-muted">
          Quantité actuelle
        </p>
        <p className="my-1 text-5xl font-bold tabular-nums">
          {caisse.quantite_actuelle}
        </p>
        <p className="text-sm text-fg-muted">
          {caisse.quantite_theorique} théorique ·{" "}
          <span
            className={
              caisse.ecart === 0
                ? "text-fg-muted"
                : caisse.ecart > 0
                  ? "text-success"
                  : "text-danger"
            }
          >
            {caisse.ecart > 0 ? `+${caisse.ecart}` : caisse.ecart} d'écart
          </span>
        </p>

        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => void applyDelta(-1)}
            disabled={!canEdit}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-line text-fg disabled:opacity-30"
          >
            <Icon name="remove" className="text-2xl" />
          </button>
          <button
            type="button"
            onClick={() => void applyDelta(+1)}
            disabled={!canEdit}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-fg text-bg disabled:opacity-30"
          >
            <Icon name="add" className="text-2xl" />
          </button>
        </div>
      </div>

      {!canEdit && (
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
            onClick={() => void acquireLock()}
            loading={busy}
            disabled={!!lock && !isAdmin}
            className="w-full"
          >
            <Icon name="lock_open" className="text-base" />
            Prendre le verrou
          </Button>
        </div>
      )}

      {canEdit && (
        <Button
          variant="ghost"
          onClick={() => void releaseLock()}
          loading={busy}
          className="w-full"
        >
          <Icon name="check" className="text-base" />
          Terminer et libérer
        </Button>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Historique</h2>
        {caisse.historique.length === 0 ? (
          <p className="text-sm text-fg-muted">Aucun mouvement.</p>
        ) : (
          <ul className="space-y-1.5">
            {caisse.historique.map((h) => (
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
    </div>
  );
}
