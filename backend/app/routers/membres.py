"""Route membres : liste légère pour l'assignation des tickets."""

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import DbSession
from app.models import Membre
from app.schemas.ticket import MembreLite
from app.security.rbac import RequireStaff

router = APIRouter(prefix="/membres", tags=["membres"])


@router.get("", response_model=list[MembreLite])
async def list_membres(user: RequireStaff, db: DbSession) -> list[Membre]:
    """Renvoie tous les membres (pour l'attribution d'une réparation)."""
    return list(
        (
            await db.scalars(
                select(Membre).order_by(Membre.prenom.asc(), Membre.nom.asc())
            )
        ).all()
    )
