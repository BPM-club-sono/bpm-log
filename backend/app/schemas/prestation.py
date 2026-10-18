"""Schémas Pydantic pour les prestations et leurs allocations (M6)."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    DecisionCloture,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypePrestation,
)
from app.schemas.equipment import EquipmentCreate


def valide_periode(debut: date | None, fin: date | None) -> None:
    """Lève si les deux bornes sont posées et incohérentes (fin < debut).

    Partagé par les schémas (validation du payload) et le routeur PATCH, qui
    revalide sur l'état final fusionné (DB + champs patchés) — cf. update_prestation.
    """
    if debut is not None and fin is not None and fin < debut:
        raise ValueError("date_fin doit être postérieure ou égale à date_debut")


class EquipmentCreatePresta(EquipmentCreate):
    """Création de fiches depuis une prestation : chaque fiche est allouée aussitôt.

    `quantite_allouee` ne vaut que pour un vrac/consommable (quantité par fiche) ;
    un unitaire s'alloue toujours à l'unité.
    """

    quantite_allouee: int = Field(default=1, ge=1)


class PrestationCreate(BaseModel):
    nom: str = Field(min_length=1, max_length=200)
    type: TypePrestation = TypePrestation.INTERNE
    client_nom: str | None = None
    date_debut: date | None = None
    date_fin: date | None = None
    responsable_membre_id: int | None = None

    @model_validator(mode="after")
    def _valide_periode(self) -> "PrestationCreate":
        valide_periode(self.date_debut, self.date_fin)
        return self


class PrestationUpdate(BaseModel):
    nom: str | None = Field(default=None, min_length=1, max_length=200)
    type: TypePrestation | None = None
    client_nom: str | None = None
    date_debut: date | None = None
    date_fin: date | None = None
    responsable_membre_id: int | None = None
    # Pas de `statut` : il est dérivé du pointage (app/services/prestation_statut.py),
    # posé par /cloture, réaligné par /reouverture — jamais saisi à la main.

    @model_validator(mode="after")
    def _valide_periode(self) -> "PrestationUpdate":
        valide_periode(self.date_debut, self.date_fin)
        return self


class PrestationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    type: TypePrestation
    client_nom: str | None
    date_debut: date | None
    date_fin: date | None
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
    # Choix fait à la clôture (rapport : perdus, cassés, laissés en suspens).
    decision_cloture: DecisionCloture | None = None
    # Champs dénormalisés pour l'affichage offline de la checklist.
    equipment_nom: str | None = None
    equipment_barcode: str | None = None
    equipment_externe: bool = False
    # Prestataire de location (matériel loué) — pour grouper par loueur côté UI.
    fournisseur_id: int | None = None
    fournisseur_nom: str | None = None
    # Contenant de l'équipement (pour grouper la checklist sous son flight).
    equipment_contenant_id: int | None = None
    # Statut actuel de l'unité : une unité tombée en panne après son allocation
    # est signalée sur sa ligne (à remplacer à la main).
    equipment_statut: StatutEquipment | None = None
    # Réponse d'ajout d'un flight seulement : nombre d'items du contenu non alloués
    # car hors service ou déjà pris par une autre prestation.
    contenu_ignore: int = 0


class ModeleDispo(BaseModel):
    """Ligne du mode « par modèle » : un modèle, chez BPM ou chez un loueur."""

    modele_id: int
    nom: str
    marque: str | None
    # Null = matériel BPM ; sinon une ligne par prestataire de location.
    fournisseur_id: int | None = None
    fournisseur_nom: str | None = None
    # Unités ajoutables maintenant (en état, libres sur la période, pas déjà là).
    dispo: int
    # Unités du parc (hors archivées, perdues, réformées).
    total: int
    # Unités de ce modèle déjà allouées ici (y compris dans un flight alloué).
    alloues: int
    # Une allocation peut être retirée par « − » (planifiée, hors contenu de flight).
    retirable: bool


class ModeleStepIn(BaseModel):
    fournisseur_id: int | None = None


class PrestationDetail(PrestationRead):
    allocations: list[AllocationRead] = Field(default_factory=list)


# --- Clôture de prestation -------------------------------------------------

ClotureDecision = Literal["retourne", "perdu", "casse", "ouvert"]


class ClotureItem(BaseModel):
    allocation_id: int
    decision: ClotureDecision


class ClotureIn(BaseModel):
    items: list[ClotureItem] = Field(default_factory=list)


class LocationRendue(BaseModel):
    """Une location d'une prestation clôturée, vue par l'archivage en lot."""

    equipment_id: int
    nom: str
    fournisseur_nom: str | None
    raison: str | None  # None = archivable ; sinon pourquoi elle est gardée


class LocationsRendues(BaseModel):
    archivables: list[LocationRendue]
    gardes: list[LocationRendue]
