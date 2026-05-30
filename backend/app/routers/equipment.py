"""Routes catalogue : équipements, catégories, emplacements (lecture seule pour l'instant)."""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Categorie, Emplacement, Equipment
from app.models.enums import StatutEquipment
from app.schemas.equipment import CategorieRead, EmplacementRead, EquipmentRead

router = APIRouter(tags=["catalogue"])


@router.get("/equipments", response_model=list[EquipmentRead])
async def list_equipments(
    _user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, description="Recherche sur le nom ou le code-barres"),
    categorie_id: int | None = Query(default=None),
    emplacement_id: int | None = Query(default=None),
    statut: StatutEquipment | None = Query(default=None),
) -> list[Equipment]:
    stmt = select(Equipment)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Equipment.nom.ilike(like) | Equipment.barcode_uid.ilike(like))
    if categorie_id is not None:
        stmt = stmt.where(Equipment.categorie_id == categorie_id)
    if emplacement_id is not None:
        stmt = stmt.where(Equipment.emplacement_id == emplacement_id)
    if statut is not None:
        stmt = stmt.where(Equipment.statut_actuel == statut)
    stmt = stmt.order_by(Equipment.nom)

    result = await db.scalars(stmt)
    return list(result.all())


@router.get("/equipments/by-barcode/{barcode_uid}", response_model=EquipmentRead)
async def get_equipment_by_barcode(
    barcode_uid: str,
    _user: CurrentUser,
    db: DbSession,
) -> Equipment:
    """Résout un code-barres scanné vers son équipement (utilisé par le scanner)."""
    equipment = await db.scalar(
        select(Equipment).where(Equipment.barcode_uid == barcode_uid)
    )
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Aucun équipement avec le code-barres {barcode_uid}.",
        )
    return equipment


@router.get("/categories", response_model=list[CategorieRead])
async def list_categories(_user: CurrentUser, db: DbSession) -> list[Categorie]:
    result = await db.scalars(select(Categorie).order_by(Categorie.nom))
    return list(result.all())


@router.get("/emplacements", response_model=list[EmplacementRead])
async def list_emplacements(_user: CurrentUser, db: DbSession) -> list[Emplacement]:
    result = await db.scalars(select(Emplacement).order_by(Emplacement.nom))
    return list(result.all())
