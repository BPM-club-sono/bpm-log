/** Miroir local du parc matériel.
 *
 *  Le scan libre (`/scan`) doit fonctionner hors ligne sur *tout* le parc, pas
 *  seulement sur les fiches déjà visitées : le cache du service worker est
 *  indexé par URL, il ne sait pas répondre à `/equipments/by-barcode/X` à
 *  partir de la liste `/equipments` qu'il a pourtant en cache.
 *
 *  On tient donc en IndexedDB une table `code-barres → équipement`, alimentée
 *  opportunistement à chaque fois qu'une liste complète du parc transite.
 *  C'est un cache : la source de vérité reste l'API. */

import { api } from "./api";
import { db, type EquipmentMirrorRow } from "./db";
import type { EquipmentListItem, StatutEquipment } from "./types";

/** Forme minimale acceptée en entrée : tout ce qui porte un code-barres. */
export interface MirrorableEquipment {
  id: number;
  barcode_uid: string;
  nom: string;
  statut_actuel: StatutEquipment;
}

function toRows(items: MirrorableEquipment[]): EquipmentMirrorRow[] {
  const now = new Date().toISOString();
  return items
    .filter((e) => typeof e.id === "number" && !!e.barcode_uid)
    .map((e) => ({
      id: e.id,
      barcode_uid: e.barcode_uid,
      nom: e.nom,
      statut_actuel: e.statut_actuel,
      mirrored_at: now,
    }));
}

/** Ajoute/met à jour des équipements sans toucher au reste (liste partielle :
 *  recherche, archives…). */
export async function mergeEquipments(items: MirrorableEquipment[]): Promise<void> {
  const rows = toRows(items);
  if (rows.length === 0) return;
  try {
    await db.equipments.bulkPut(rows);
  } catch {
    // Le miroir est un confort : un échec IndexedDB ne doit jamais casser l'écran appelant.
  }
}

/** Remplace intégralement le miroir (liste complète du parc actif). Purge au
 *  passage les équipements supprimés côté serveur. */
export async function replaceEquipments(items: MirrorableEquipment[]): Promise<void> {
  const rows = toRows(items);
  if (rows.length === 0) return;
  try {
    await db.transaction("rw", db.equipments, async () => {
      await db.equipments.clear();
      await db.equipments.bulkPut(rows);
    });
  } catch {
    // idem : best effort.
  }
}

/** Recharge le miroir depuis l'API. No-op hors ligne. */
export async function refreshEquipmentMirror(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const items = await api<EquipmentListItem[]>("/equipments");
    await replaceEquipments(items);
  } catch {
    // Hors ligne ou API indisponible : on garde le miroir précédent.
  }
}

/** Résout un code-barres dans le miroir local. `null` si inconnu (ou si
 *  IndexedDB est indisponible). */
export async function findByBarcode(code: string): Promise<EquipmentMirrorRow | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  try {
    return (await db.equipments.where("barcode_uid").equals(trimmed).first()) ?? null;
  } catch {
    return null;
  }
}

/** Nombre d'équipements actuellement mirrorés (affichage d'état). */
export async function mirrorCount(): Promise<number> {
  try {
    return await db.equipments.count();
  } catch {
    return 0;
  }
}
