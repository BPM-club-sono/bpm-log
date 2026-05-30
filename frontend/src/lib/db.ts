import Dexie, { type Table } from "dexie";
import type { Allocation, PrestationDetail } from "./types";

/** Type d'évènement métier mis en file pour synchronisation. */
export type SyncItemType = "ticket_reparation" | "log_scan" | "presta_check";

export interface SyncQueueItem {
  uuid_client: string;
  type: SyncItemType;
  payload: Record<string, unknown>;
  offline_created_at: string; // ISO 8601
  retry_count: number;
  last_error: string | null;
  /** Renseigné une fois l'item synchronisé (sera purgé). */
  synced_at: string | null;
}

/** Photo associée à un ticket, stockée en blob tant que non uploadée. */
export interface PhotoBlob {
  id: string;
  ticket_uuid: string;
  blob: Blob;
  created_at: string;
  uploaded: 0 | 1;
}

/** Snapshot d'une prestation préchargée pour le terrain (mode offline). */
export interface PrestaSnapshot {
  presta_id: number;
  presta: PrestationDetail;
  allocations: Allocation[];
  prepared_at: string;
}

class BpmDexie extends Dexie {
  sync_queue!: Table<SyncQueueItem, string>;
  photos_blob!: Table<PhotoBlob, string>;
  presta_snapshots!: Table<PrestaSnapshot, number>;

  constructor() {
    super("bpm_log");
    this.version(1).stores({
      // & = clé primaire unique ; les autres champs sont indexés.
      sync_queue: "&uuid_client, type, offline_created_at, synced_at",
      photos_blob: "&id, ticket_uuid, uploaded",
    });
    this.version(2).stores({
      sync_queue: "&uuid_client, type, offline_created_at, synced_at",
      photos_blob: "&id, ticket_uuid, uploaded",
      presta_snapshots: "&presta_id",
    });
  }
}

export const db = new BpmDexie();
