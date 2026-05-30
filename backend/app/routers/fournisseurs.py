"""Routes fournisseurs (matériel en location externe). Lecture pour tous, création Admin+Staff."""

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Fournisseur
from app.schemas.equipment import FournisseurCreate, FournisseurRead
from app.security.rbac import RequireStaff

router = APIRouter(tags=["fournisseurs"])


@router.get("/fournisseurs", response_model=list[FournisseurRead])
async def list_fournisseurs(_user: CurrentUser, db: DbSession) -> list[Fournisseur]:
    result = await db.scalars(select(Fournisseur).order_by(Fournisseur.nom))
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
    fournisseur = Fournisseur(nom=payload.nom.strip(), contact=payload.contact)
    db.add(fournisseur)
    await db.commit()
    await db.refresh(fournisseur)
    return fournisseur
