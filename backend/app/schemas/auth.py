"""Schémas Pydantic pour l'authentification."""

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import RoleMembre


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MembreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str | None
    prenom: str | None
    email: EmailStr
    role: RoleMembre
    mandat: int | None
