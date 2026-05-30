"""Routes fournisseurs (matériel en location externe). Lecture pour tous, écriture Admin+Staff."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import EquipmentLocation, Fournisseur
from app.schemas.equipment import FournisseurCreate, FournisseurRead, FournisseurUpdate
from app.security.rbac import RequireStaff

router = APIRouter(tags=["fournisseurs"])


@router.get("/fournisseurs", response_model=list[FournisseurRead])
async def list_fournisseurs(_user: CurrentUser, db: DbSession) -> list[Fournisseur]:
    result = await db.scalars(
        select(Fournisseur).order_by(Fournisseur.favori.desc(), Fournisseur.nom)
    )
    return list(result.all())


@router.post(
    "/fournisseurs",
    response_model=FournisseurRead,
    status_code=201,
)
async def create_fournisseur(
    payload: FournisseurCreate,
    _user: RequireStaff,
    db: DbSession,
) -> Fournisseur:
    fournisseur = Fournisseur(
        nom=payload.nom.strip(),
        contact=payload.contact,
        favori=payload.favori,
    )
    db.add(fournisseur)
    await db.commit()
    await db.refresh(fournisseur)
    return fournisseur


@router.patch("/fournisseurs/{fournisseur_id}", response_model=FournisseurRead)
async def update_fournisseur(
    fournisseur_id: int,
    payload: FournisseurUpdate,
    _user: RequireStaff,
    db: DbSession,
) -> Fournisseur:
    fournisseur = await db.get(Fournisseur, fournisseur_id)
    if fournisseur is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fournisseur introuvable."
        )
    if payload.nom is not None:
        fournisseur.nom = payload.nom.strip()
    if payload.contact is not None:
        fournisseur.contact = payload.contact
    if payload.favori is not None:
        fournisseur.favori = payload.favori
    await db.commit()
    await db.refresh(fournisseur)
    return fournisseur


@router.delete("/fournisseurs/{fournisseur_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fournisseur(
    fournisseur_id: int,
    _user: RequireStaff,
    db: DbSession,
) -> None:
    fournisseur = await db.get(Fournisseur, fournisseur_id)
    if fournisseur is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fournisseur introuvable."
        )
    used = await db.scalar(
        select(EquipmentLocation).where(
            EquipmentLocation.fournisseur_id == fournisseur_id
        )
    )
    if used is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce fournisseur est rattaché à du matériel et ne peut pas être supprimé.",
        )
    await db.delete(fournisseur)
    await db.commit()
