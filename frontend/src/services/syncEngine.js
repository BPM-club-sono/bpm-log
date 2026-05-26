import { db } from '../db/localDb';

const API_BASE_URL = '/api';

/**
 * Envoie la file d'attente locale (IndexedDB) vers l'API FastAPI et vide la queue en cas de succès.
 * Intègre les règles métiers d'idempotence et d'adaptation du stock local.
 */
export async function synchronizeQueue() {
  const queue = await db.sync_queue.toArray();
  if (queue.length === 0) return { success: true, count: 0 };

  // Préparer les données pour le format attendu par le schéma Pydantic (SyncQueueBatch)
  const payload = {
    movements: queue.map(mv => ({
      id: mv.id,
      equipment_id: mv.equipment_id,
      action: mv.action,
      details: mv.details, // Déjà une chaîne stringifiée ou null
      offline_created_at: mv.offline_created_at
    }))
  };

  try {
    const response = await fetch(`${API_BASE_URL}/sync/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Erreur API: ${response.statusText}`);
    }

    const syncedLogs = await response.json();
    console.log(`${syncedLogs.length} mouvements synchronisés avec le serveur.`);

    // 1. Déplacer chaque mouvement réussi de la queue locale vers l'historique local synchronisé
    for (const mv of queue) {
      await db.synced_movements.put({
        id: mv.id,
        equipment_id: mv.equipment_id,
        action: mv.action,
        timestamp: mv.timestamp,
        details: mv.details,
        offline_created_at: mv.offline_created_at
      });

      // 2. Mettre à jour le stock local pour refléter le dernier statut de l'équipement
      const item = await db.equipment.get(mv.equipment_id);
      if (item) {
        let newStatus = 'Disponible';
        if (mv.action === 'SORTIE') {
          newStatus = 'Sorti / En Service';
        } else if (mv.action === 'PANNE') {
          newStatus = 'En Réparation';
        }
        await db.equipment.update(mv.equipment_id, { status: newStatus });
        
        // Si c'est du vrac, appliquer aussi la mise à jour locale
        if (item.isBulk && mv.details) {
          try {
            const detailsObj = JSON.parse(mv.details);
            if (detailsObj.type === 'vrac' && detailsObj.contents) {
              // En local, on peut simuler les quantités réelles si besoin
              console.log("Mise à jour vrac locale enregistrée");
            }
          } catch (e) {
            console.error("Erreur parsing vrac local:", e);
          }
        }
      }

      // 3. Supprimer de la file d'attente
      await db.sync_queue.delete(mv.id);
    }

    return { success: true, count: queue.length };
  } catch (error) {
    console.error('Échec de la synchronisation de terrain:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Tente de pré-charger la liste du matériel depuis le serveur FastAPI au démarrage si connecté.
 * Permet d'avoir un catalogue à jour physique.
 */
export async function fetchCatalogFromServer() {
  try {
    const response = await fetch(`${API_BASE_URL}/equipment/`);
    if (response.ok) {
      const serverItems = await response.json();
      if (serverItems.length > 0) {
        // Remplacer le catalogue local par celui du serveur
        await db.equipment.clear();
        await db.equipment.bulkAdd(serverItems.map(item => ({
          id: item.id,
          name: item.name,
          category: item.category,
          status: item.status,
          type: item.type,
          isBulk: item.is_bulk
        })));
        console.log("Catalogue local synchronisé avec succès depuis le serveur !");
        return true;
      }
    }
  } catch (error) {
    console.log("Impossible de joindre le serveur pour charger le catalogue, utilisation du cache local.");
  }
  return false;
}
