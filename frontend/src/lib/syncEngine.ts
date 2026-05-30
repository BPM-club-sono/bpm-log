import { api, ApiError } from "./api";
import { db, type SyncItemType, type SyncQueueItem } from "./db";

interface SyncResponse {
  applied: string[];
  conflicts: { uuid_client: string; reason: string }[];
}

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

type Listener = (state: SyncState) => void;

export interface SyncState {
  pending: number;
  syncing: boolean;
  conflicts: number;
}

/** Identifiant unique côté client (fallback si crypto.randomUUID absent). */
function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class SyncEngine {
  private listeners = new Set<Listener>();
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private started = false;

  /** Démarre la détection online + le polling. À appeler une fois au boot. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("online", this.onOnline);
    this.timer = setInterval(() => void this.flush(), POLL_INTERVAL_MS);
    void this.flush();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener("online", this.onOnline);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private onOnline = () => {
    this.backoff = 0;
    void this.flush();
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.emit();
    return () => this.listeners.delete(listener);
  }

  private async emit(syncing = this.flushing): Promise<void> {
    const queue = await db.sync_queue.where("synced_at").equals("").toArray();
    const conflicts = queue.filter((i) => i.last_error !== null).length;
    const state: SyncState = { pending: queue.length, syncing, conflicts };
    this.listeners.forEach((l) => l(state));
  }

  /** Ajoute un évènement à la file et tente un flush immédiat. */
  async enqueue(
    type: SyncItemType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const item: SyncQueueItem = {
      uuid_client: newUuid(),
      type,
      payload,
      offline_created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      synced_at: "",
    };
    await db.sync_queue.add(item);
    await this.emit();
    void this.flush();
    return item.uuid_client;
  }

  /** Vide la file vers /sync/batch. Tri chronologique, batch, backoff. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    this.flushing = true;
    await this.emit(true);
    try {
      // Toujours par ordre de création offline, jamais l'ordre d'insertion.
      const queue = (await db.sync_queue.where("synced_at").equals("").toArray()).sort(
        (a, b) => a.offline_created_at.localeCompare(b.offline_created_at),
      );

      for (let i = 0; i < queue.length; i += BATCH_SIZE) {
        const batch = queue.slice(i, i + BATCH_SIZE);
        const res = await api<SyncResponse>("/sync/batch", {
          method: "POST",
          body: {
            items: batch.map((it) => ({
              uuid_client: it.uuid_client,
              type: it.type,
              offline_created_at: it.offline_created_at,
              payload: it.payload,
            })),
          },
        });

        const appliedAt = new Date().toISOString();
        await db.transaction("rw", db.sync_queue, async () => {
          // Les items appliqués (ou rejoués) sont marqués synchronisés.
          for (const uuid of res.applied) {
            await db.sync_queue.update(uuid, { synced_at: appliedAt });
          }
          // Les conflits restent en file avec leur raison pour arbitrage.
          for (const conflict of res.conflicts) {
            const existing = await db.sync_queue.get(conflict.uuid_client);
            await db.sync_queue.update(conflict.uuid_client, {
              last_error: conflict.reason,
              retry_count: (existing?.retry_count ?? 0) + 1,
            });
          }
        });

        // Les photos sont uploadées séparément, une fois le ticket synchronisé.
        await this.uploadPhotos(res.applied);
      }

      // Purge des items synchronisés (garde la file légère).
      await db.sync_queue.where("synced_at").notEqual("").delete();
      this.backoff = 0;
    } catch (err) {
      // Erreur réseau / 500 : on ne perd RIEN, on réessaiera avec backoff.
      const reason = err instanceof ApiError ? `HTTP ${err.status}` : "réseau";
      this.backoff = Math.min(
        this.backoff ? this.backoff * 2 : 5_000,
        MAX_BACKOFF_MS,
      );
      setTimeout(() => void this.flush(), this.backoff);
      void reason;
    } finally {
      this.flushing = false;
      await this.emit(false);
    }
  }

  /** Upload les photos liées aux tickets fraîchement synchronisés. */
  private async uploadPhotos(ticketUuids: string[]): Promise<void> {
    if (!ticketUuids.length) return;
    for (const uuid of ticketUuids) {
      const photos = await db.photos_blob
        .where("ticket_uuid")
        .equals(uuid)
        .filter((p) => p.uploaded === 0)
        .toArray();
      for (const photo of photos) {
        try {
          const form = new FormData();
          form.append("uuid_client", uuid);
          form.append("file", photo.blob, `${photo.id}.jpg`);
          await api("/tickets/photos", { method: "POST", body: form });
          await db.photos_blob.delete(photo.id);
        } catch {
          // On garde le blob ; il sera réessayé au prochain flush.
        }
      }
    }
  }

  /** Conflits en attente d'arbitrage (items avec last_error). */
  async listConflicts(): Promise<SyncQueueItem[]> {
    const queue = await db.sync_queue.where("synced_at").equals("").toArray();
    return queue
      .filter((i) => i.last_error !== null)
      .sort((a, b) => a.offline_created_at.localeCompare(b.offline_created_at));
  }

  /** Réessaie un item en conflit (efface l'erreur et relance un flush). */
  async retryItem(
    uuid: string,
    payloadPatch?: Record<string, unknown>,
  ): Promise<void> {
    const existing = await db.sync_queue.get(uuid);
    if (!existing) return;
    await db.sync_queue.update(uuid, {
      last_error: null,
      payload: payloadPatch
        ? { ...existing.payload, ...payloadPatch }
        : existing.payload,
    });
    await this.emit();
    void this.flush();
  }

  /** Abandonne définitivement un item en conflit. */
  async discardItem(uuid: string): Promise<void> {
    await db.sync_queue.delete(uuid);
    await db.photos_blob.where("ticket_uuid").equals(uuid).delete();
    await this.emit();
  }
}

export const syncEngine = new SyncEngine();
