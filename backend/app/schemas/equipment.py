"""Schémas Pydantic pour le catalogue : équipements, catégories, emplacements."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import StatutEquipment


class CategorieRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    description: str | None


class EmplacementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    zone_stockage: str | None


class EquipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    barcode_uid: str
    nom: str
    categorie_id: int | None
    emplacement_id: int | None
    statut_actuel: StatutEquipment
    created_at: datetime
