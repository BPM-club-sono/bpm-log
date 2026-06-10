"""Schémas Pydantic pour les prestations et leurs allocations (M6)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import StatutAllocation, StatutPrestation, TypePrestation


class PrestationCreate(BaseModel):
    nom: str = Field(min_length=1, max_length=200)
    type: TypePrestation = TypePrestation.INTERNE
    client_nom: str | None = None
    date_debut: datetime | None = None
    date_fin: datetime | None = None
    responsable_membre_id: int | None = None


class PrestationUpdate(BaseModel):
    nom: str | None = Field(default=None, min_length=1, max_length=200)
    type: TypePrestation | None = None
    client_nom: str | None = None
    date_debut: datetime | None = None
    date_fin: datetime | None = None
    statut: StatutPrestation | None = None
    responsable_membre_id: int | None = None


class PrestationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    type: TypePrestation
    client_nom: str | None
    date_debut: datetime | None
    date_fin: datetime | None
    statut: StatutPrestation
    responsable_membre_id: int | None


class AllocationCreate(BaseModel):
    equipment_id: int
    quantite: int = Field(default=1, ge=1)
    # Si l'équipement est un contenant, alloue aussi son contenu (items standard).
    inclure_contenu: bool = False


class AllocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    presta_id: int
    equipment_id: int
    quantite: int
    quantite_sortie: int
    quantite_retournee: int
    statut: StatutAllocation
    # Champs dénormalisés pour l'affichage offline de la checklist.
    equipment_nom: str | None = None
    equipment_barcode: str | None = None
    equipment_externe: bool = False
    # Prestataire de location (matériel loué) — pour grouper par loueur côté UI.
    fournisseur_id: int | None = None
    fournisseur_nom: str | None = None
    # Contenant de l'équipement (pour grouper la checklist sous son flight).
    equipment_contenant_id: int | None = None


class PrestationDetail(PrestationRead):
    allocations: list[AllocationRead] = Field(default_factory=list)


# --- Clôture de prestation -------------------------------------------------

ClotureDecision = Literal["retourne", "perdu", "casse", "ouvert"]


class ClotureItem(BaseModel):
    allocation_id: int
    decision: ClotureDecision


class ClotureIn(BaseModel):
    items: list[ClotureItem] = Field(default_factory=list)
