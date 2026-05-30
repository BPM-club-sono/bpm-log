"""Routes d'authentification : login (mot de passe), refresh, profil courant."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import Membre, UserAuth
from app.schemas.auth import (
    AccessToken,
    LoginRequest,
    MembreRead,
    RefreshRequest,
    TokenPair,
)
from app.security.jwt import create_access_token, create_refresh_token, decode_token
from app.security.passwords import hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession) -> TokenPair:
    membre = await db.scalar(select(Membre).where(Membre.email == payload.email))
    auth = (
        await db.scalar(select(UserAuth).where(UserAuth.membre_id == membre.id))
        if membre is not None
        else None
    )

    # Vérifie toujours pour limiter l'oracle de timing sur l'existence d'un email.
    valid = auth is not None and verify_password(payload.password, auth.password_hash)
    if not membre or not auth or not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides.",
        )
    if not auth.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Compte désactivé.")

    if needs_rehash(auth.password_hash):
        auth.password_hash = hash_password(payload.password)
    auth.last_login = datetime.now(UTC)
    await db.commit()

    return TokenPair(
        access_token=create_access_token(membre.id, membre.role.value),
        refresh_token=create_refresh_token(membre.id),
    )


@router.post("/refresh", response_model=AccessToken)
async def refresh(payload: RefreshRequest, db: DbSession) -> AccessToken:
    data = decode_token(payload.refresh_token)
    if data is None or data.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token invalide.",
        )

    membre = await db.get(Membre, int(data["sub"]))
    if membre is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Membre introuvable.")

    return AccessToken(access_token=create_access_token(membre.id, membre.role.value))


@router.get("/me", response_model=MembreRead)
async def me(user: CurrentUser) -> Membre:
    return user
