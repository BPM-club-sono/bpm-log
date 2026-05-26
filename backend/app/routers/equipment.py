from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.db_models import Equipment, BulkContent
from app.schemas.equipment import EquipmentRead, EquipmentCreate

router = APIRouter(
    prefix="/equipment",
    tags=["equipment"]
)

@router.get("/", response_model=List[EquipmentRead])
async def list_equipment(db: AsyncSession = Depends(get_db)):
    """
    Récupère la liste de tout le matériel disponible en stock.
    """
    result = await db.execute(select(Equipment))
    equipment_list = result.scalars().all()
    return equipment_list

@router.get("/{equipment_id}", response_model=EquipmentRead)
async def get_equipment(equipment_id: str, db: AsyncSession = Depends(get_db)):
    """
    Récupère les détails d'un équipement spécifique (et le contenu de la caisse s'il s'agit de vrac).
    """
    result = await db.execute(select(Equipment).where(Equipment.id == equipment_id))
    equipment = result.scalar_one_or_none()
    if not equipment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Matériel '{equipment_id}' introuvable."
        )
    return equipment

@router.post("/", response_model=EquipmentRead, status_code=status.HTTP_201_CREATED)
async def create_equipment(payload: EquipmentCreate, db: AsyncSession = Depends(get_db)):
    """
    Enregistre un nouvel équipement dans le parc matériel (individuel ou caisse de vrac).
    """
    # Vérification doublon
    existing = await db.get(Equipment, payload.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"L'équipement avec l'ID '{payload.id}' existe déjà."
        )
    
    new_equip = Equipment(
        id=payload.id,
        name=payload.name,
        category=payload.category,
        status=payload.status,
        type=payload.type,
        is_bulk=payload.is_bulk
    )
    db.add(new_equip)
    
    # Si c'est du vrac, ajouter le contenu
    if payload.is_bulk and payload.bulk_contents:
        for content in payload.bulk_contents:
            new_content = BulkContent(
                equipment_id=payload.id,
                item_name=content.item_name,
                expected_quantity=content.expected_quantity,
                actual_quantity=content.actual_quantity
            )
            db.add(new_content)
            
    await db.flush()
    return new_equip

@router.post("/seed", status_code=status.HTTP_201_CREATED)
async def seed_database(db: AsyncSession = Depends(get_db)):
    """
    Initialise la base de données avec le jeu d'essai standard BPM pour tester immédiatement.
    """
    # Vérifier s'il y a déjà du matériel
    result = await db.execute(select(Equipment))
    if len(result.scalars().all()) > 0:
        return {"message": "La base contient déjà des données. Seeding annulé."}
        
    initial_items = [
        # Gros Matériel
        Equipment(id="BPM-EQ-001", name="Lyre Beam Spot Wash 150W", category="Lumières", status="Disponible", type="Individuel", is_bulk=False),
        Equipment(id="BPM-EQ-002", name="Amplificateur de Puissance Crown 2x600W", category="Sonorisation", status="Disponible", type="Individuel", is_bulk=False),
        Equipment(id="BPM-EQ-003", name="Console Numérique Behringer X32", category="Sonorisation", status="En Réparation", type="Individuel", is_bulk=False),
        Equipment(id="BPM-EQ-004", name="Pied de Structure Aluminium renforcé", category="Structure", status="Stocké", type="Individuel", is_bulk=False),
        
        # Caisses de Vrac
        Equipment(id="BPM-BOX-XLR", name="Caisse Vrac - Câblerie Fine XLR", category="Câblage", status="Disponible", type="Vrac", is_bulk=True),
        Equipment(id="BPM-BOX-POW", name="Caisse Vrac - Adaptateurs & Alim", category="Câblage", status="Disponible", type="Vrac", is_bulk=True),
    ]
    
    for item in initial_items:
        db.add(item)
        
    # Contenu théorique des caisses de vrac
    xlr_contents = [
        BulkContent(equipment_id="BPM-BOX-XLR", item_name="Câble XLR M/F - 10m", expected_quantity=12, actual_quantity=12),
        BulkContent(equipment_id="BPM-BOX-XLR", item_name="Câble XLR M/F - 5m", expected_quantity=20, actual_quantity=20),
        BulkContent(equipment_id="BPM-BOX-XLR", item_name="Câble XLR M/F - 2m", expected_quantity=10, actual_quantity=10),
        BulkContent(equipment_id="BPM-BOX-XLR", item_name="Adaptateur Jack vers XLR M", expected_quantity=4, actual_quantity=4),
    ]
    
    pow_contents = [
        BulkContent(equipment_id="BPM-BOX-POW", item_name="Câble Shuko / Powercon - 1.5m", expected_quantity=8, actual_quantity=8),
        BulkContent(equipment_id="BPM-BOX-POW", item_name="Câble Shuko / Powercon - 5m", expected_quantity=4, actual_quantity=4),
        BulkContent(equipment_id="BPM-BOX-POW", item_name="Multiprise 3 plots (Triplette)", expected_quantity=6, actual_quantity=6),
        BulkContent(equipment_id="BPM-BOX-POW", item_name="Câble Alimentation standard IEC", expected_quantity=10, actual_quantity=10),
    ]
    
    for content in xlr_contents + pow_contents:
        db.add(content)
        
    await db.commit()
    return {"message": "Base de données initialisée avec succès !"}
