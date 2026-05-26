import Dexie from 'dexie';

export const db = new Dexie('BpmLogLocalDB');

// Définition du schéma des tables IndexedDB
db.version(1).stores({
  equipment: 'id, name, category, status, type, isBulk',
  sync_queue: 'id, equipment_id, action, timestamp, details, offline_created_at',
  synced_movements: 'id, equipment_id, action, timestamp, details, offline_created_at'
});

// Seed de la base locale si vide
export async function seedLocalDb() {
  const count = await db.equipment.count();
  if (count === 0) {
    await db.equipment.bulkAdd([
      { id: "BPM-EQ-001", name: "Lyre Beam Spot Wash 150W", category: "Lumières", status: "Disponible", type: "Individuel", isBulk: false },
      { id: "BPM-EQ-002", name: "Amplificateur de Puissance Crown 2x600W", category: "Sonorisation", status: "Disponible", type: "Individuel", isBulk: false },
      { id: "BPM-EQ-003", name: "Console Numérique Behringer X32", category: "Sonorisation", status: "En Réparation", type: "Individuel", isBulk: false },
      { id: "BPM-EQ-004", name: "Pied de Structure Aluminium renforcé", category: "Structure", status: "Stocké", type: "Individuel", isBulk: false },
      { id: "BPM-BOX-XLR", name: "Caisse Vrac - Câblerie Fine XLR", category: "Câblage", status: "Disponible", type: "Vrac", isBulk: true },
      { id: "BPM-BOX-POW", name: "Caisse Vrac - Adaptateurs & Alim", category: "Câblage", status: "Disponible", type: "Vrac", isBulk: true }
    ]);
    console.log("Local IndexedDB seeded successfully!");
  }
}
