"""Schémas Pydantic pour l'enregistrement et la connexion par Passkey (WebAuthn)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr


class WebauthnOptions(BaseModel):
    """Options WebAuthn (JSON) + state signé portant le challenge."""

    options: dict[str, Any]
    state: str


class RegisterComplete(BaseModel):
    state: str
    credential: dict[str, Any]
    device_name: str | None = None


class LoginBegin(BaseModel):
    email: EmailStr


class LoginComplete(BaseModel):
    state: str
    credential: dict[str, Any]


class PasskeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_name: str | None
    created_at: datetime
