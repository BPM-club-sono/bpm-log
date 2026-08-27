"""Dépendances FastAPI partagées : session DB et utilisateur courant."""

from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Membre, UserAuth
from app.models.enums import RoleMembre
from app.security.oidc import decode_oidc_token

DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=True)

# Rôle attribué à un membre créé automatiquement à sa première connexion.
# Jamais Admin : une promotion reste un geste explicite en base.
DEFAULT_ROLE = RoleMembre.STAFF


def _split_name(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    """Prénom / nom depuis les claims, avec repli sur `name` puis l'email."""
    prenom = payload.get("given_name")
    nom = payload.get("family_name")
    if prenom or nom:
        return prenom, nom

    full = (payload.get("name") or "").strip()
    if full:
        first, _, last = full.partition(" ")
        return first, last or None

    return None, None


async def _provision(db: AsyncSession, email: str, payload: dict[str, Any]) -> Membre:
    """Crée le membre correspondant à un compte authentik inconnu de la base.

    authentik est la source de vérité des comptes : qui il laisse passer est
    membre du club (l'accès à l'application est filtré par le groupe
    `bpm-log-users`). La base ne garde que ce qui lui est propre — le rôle.
    """
    prenom, nom = _split_name(payload)
    membre = Membre(email=email, prenom=prenom, nom=nom, role=DEFAULT_ROLE)
    db.add(membre)
    try:
        await db.commit()
    except IntegrityError:
        # Le frontend émet plusieurs requêtes en parallèle au chargement :
        # deux d'entre elles peuvent tenter l'insertion en même temps.
        await db.rollback()
        existing = await db.scalar(select(Membre).where(Membre.email == email))
        if existing is None:
            raise
        return existing

    await db.refresh(membre)
    return membre


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
        membre = await _provision(db, email, payload)

    # Permet de couper l'accès sans attendre l'expiration du token authentik.
    auth = await db.scalar(select(UserAuth).where(UserAuth.membre_id == membre.id))
    if auth is not None and not auth.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte désactivé.",
        )

    return membre


CurrentUser = Annotated[Membre, Depends(get_current_user)]
