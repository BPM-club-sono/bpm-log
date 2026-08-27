"""Schémas Pydantic pour l'authentification (identité fournie par authentik)."""

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import RoleMembre


class MembreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str | None
    prenom: str | None
    email: EmailStr
    role: RoleMembre
    mandat: int | None
