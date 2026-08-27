"""Dépendances FastAPI partagées : session DB et utilisateur courant."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Membre, UserAuth
from app.security.oidc import decode_oidc_token

DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    db: DbSession,
) -> Membre:
    """Valide l'id_token authentik puis retrouve le membre par son email.

    L'identité vient du claim `email` : authentik répond « qui es-tu », la base
    reste la source de vérité métier (rôle, activation).
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalide ou expiré.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = await decode_oidc_token(credentials.credentials)
    if payload is None:
        raise invalid

    email = payload.get("email")
    if not email:
        raise invalid

    membre = await db.scalar(select(Membre).where(Membre.email == email))
    if membre is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte Google non rattaché à un membre.",
        )

    # Permet de couper l'accès sans attendre l'expiration du token authentik.
    auth = await db.scalar(select(UserAuth).where(UserAuth.membre_id == membre.id))
    if auth is not None and not auth.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte désactivé.",
        )

    return membre


CurrentUser = Annotated[Membre, Depends(get_current_user)]
