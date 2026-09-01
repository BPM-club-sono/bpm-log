import Dexie, { type Table } from "dexie";
import type { Allocation, PrestationDetail, StatutEquipment } from "./types";

/** Type d'évènement métier mis en file pour synchronisation. */
export type SyncItemType =
  | "ticket_reparation"
  | "log_scan"
  | "presta_check"
  | "vrac_delta"
  | "conso_delta"
  | "deplacement";

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

/** Miroir local du parc, pour résoudre un code-barres scanné sans réseau.
 *  Volontairement minimal : juste de quoi identifier l'équipement et l'afficher
 *  le temps d'ouvrir sa fiche (qui, elle, se recharge depuis l'API si possible). */
export interface EquipmentMirrorRow {
  id: number;
  barcode_uid: string;
  nom: string;
  statut_actuel: StatutEquipment;
  /** ISO 8601 — date du dernier rafraîchissement, pour diagnostic. */
  mirrored_at: string;
}

class BpmDexie extends Dexie {
  sync_queue!: Table<SyncQueueItem, string>;
  photos_blob!: Table<PhotoBlob, string>;
  presta_snapshots!: Table<PrestaSnapshot, number>;
  equipments!: Table<EquipmentMirrorRow, number>;

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
    this.version(3).stores({
      sync_queue: "&uuid_client, type, offline_created_at, synced_at",
      photos_blob: "&id, ticket_uuid, uploaded",
      presta_snapshots: "&presta_id",
      // barcode_uid non-unique : le miroir est un cache, l'unicité reste garantie
      // côté serveur. Un code réattribué ne doit pas faire échouer un bulkPut.
      equipments: "&id, barcode_uid, nom",
    });
  }
}

export const db = new BpmDexie();
