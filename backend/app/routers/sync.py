import json
from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from app.database import get_db
from app.models.db_models import Equipment, MovementLog, BulkContent
from app.schemas.movement import SyncQueueBatch, MovementLogRead

router = APIRouter(
    prefix="/sync",
    tags=["sync"]
)

@router.post("/", response_model=List[MovementLogRead], status_code=status.HTTP_201_CREATED)
async def synchronize_movements(payload: SyncQueueBatch, db: AsyncSession = Depends(get_db)):
    """
    Reçoit un batch de mouvements enregistrés hors-ligne, les insère de manière idempotente,
    les applique par ordre chronologique et met à jour l'état général des stocks.
    """
    saved_logs = []
    
    # 1. Trier les mouvements par date de création physique (chronologique ascendante)
    # pour garantir que les états s'appliquent dans le bon ordre.
    sorted_movements = sorted(payload.movements, key=lambda m: m.offline_created_at)
    
    for mv_data in sorted_movements:
        # 2. Check Idempotence : Si l'UUID existe déjà, on l'ignore (déjà synchronisé lors d'une session précédente)
        existing_log = await db.get(MovementLog, mv_data.id)
        if existing_log:
            saved_logs.append(existing_log)
            continue
            
        # 3. Récupérer l'équipement associé
        equipment = await db.get(Equipment, mv_data.equipment_id)
        if not equipment:
            # Si le matériel n'existe pas en base, on ignore ou on trace (ici on continue par résilience)
            continue
            
        # 4. Enregistrer le log du mouvement physique
        new_log = MovementLog(
            id=mv_data.id,
            equipment_id=mv_data.equipment_id,
            action=mv_data.action,
            details=mv_data.details,
            offline_created_at=mv_data.offline_created_at
        )
        db.add(new_log)
        
        # 5. Déterminer si ce mouvement est le plus récent pour cet équipement en base
        # (Compare la date hors-ligne du scan actuel avec le max existant en BDD)
        max_date_query = await db.execute(
            select(func.max(MovementLog.offline_created_at))
            .where(MovementLog.equipment_id == mv_data.equipment_id)
        )
        max_date = max_date_query.scalar()
        
        is_most_recent = (max_date is None) or (mv_data.offline_created_at >= max_date)
        
        if is_most_recent:
            # Appliquer le nouvel état sur l'équipement
            if mv_data.action == "SORTIE":
                equipment.status = "Sorti / En Service"
            elif mv_data.action == "ENTRÉE":
                equipment.status = "Disponible"
            elif mv_data.action == "PANNE":
                equipment.status = "En Réparation"
                
            # 6. Si c'est du Vrac et qu'on a des détails de checklist
            if equipment.is_bulk and mv_data.details:
                try:
                    details_dict = json.loads(mv_data.details)
                    if details_dict.get("type") == "vrac" and "contents" in details_dict:
                        # Parcourir les ajustements de quantité saisis sur le terrain
                        for content_data in details_dict["contents"]:
                            item_name = content_data.get("name")
                            actual_qty = content_data.get("actual")
                            
                            if item_name is not None and actual_qty is not None:
                                # Trouver l'élément dans BulkContent pour cet équipement
                                content_query = await db.execute(
                                    select(BulkContent)
                                    .where(BulkContent.equipment_id == equipment.id)
                                    .where(BulkContent.item_name == item_name)
                                )
                                bulk_item = content_query.scalar_one_or_none()
                                if bulk_item:
                                    bulk_item.actual_quantity = actual_qty
                except Exception as e:
                    # En cas d'erreur de parsing JSON, on logue mais on ne bloque pas la transaction
                    print(f"Erreur lors du traitement du vrac pour le log {mv_data.id}: {e}")
                    
        await db.flush()
        saved_logs.append(new_log)
        
    await db.commit()
    return saved_logs
