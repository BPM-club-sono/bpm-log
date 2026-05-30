"""Création et décodage des tokens JWT (access + refresh)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt

from app.config import settings


def _create_token(subject: str, expires_delta: timedelta, token_type: str, **claims: Any) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        **claims,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(membre_id: int, role: str) -> str:
    return _create_token(
        subject=str(membre_id),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        token_type="access",
        role=role,
    )


def create_refresh_token(membre_id: int) -> str:
    return _create_token(
        subject=str(membre_id),
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        token_type="refresh",
    )


def create_webauthn_state(membre_id: int, challenge: str, purpose: str) -> str:
    """Token court (5 min) transportant le challenge WebAuthn entre begin et complete."""
    return _create_token(
        subject=str(membre_id),
        expires_delta=timedelta(minutes=5),
        token_type=purpose,
        challenge=challenge,
    )


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
