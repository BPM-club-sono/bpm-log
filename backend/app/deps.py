"""Dépendances FastAPI partagées : session DB et utilisateur courant."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Membre, UserAuth
from app.security.jwt import decode_token

DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    db: DbSession,
) -> Membre:
    """Décode le JWT access, vérifie le membre et son compte actif."""
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalide ou expiré.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(credentials.credentials)
    if payload is None or payload.get("type") != "access":
        raise invalid

    membre_id = payload.get("sub")
    if membre_id is None:
        raise invalid

    membre = await db.get(Membre, int(membre_id))
    if membre is None:
        raise invalid

    auth = await db.scalar(select(UserAuth).where(UserAuth.membre_id == membre.id))
    if auth is None or not auth.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte désactivé.",
        )

    return membre


CurrentUser = Annotated[Membre, Depends(get_current_user)]
