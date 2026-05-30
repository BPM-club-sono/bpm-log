"""Schémas Pydantic pour le catalogue : équipements, catégories, emplacements, fournisseurs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.enums import AvancementTicket, StatutEquipment, TypeActionScan
from app.schemas.inventory import InventaireEntry, VracLock

EquipmentType = Literal["standard", "vrac", "consommable"]


def build_photo_url(chemin: str | None) -> str | None:
    """Construit l'URL publique d'une photo d'équipement à partir de son chemin."""
    return f"/api/photos/{chemin}" if chemin else None


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


class FournisseurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    contact: str | None
    favori: bool = False


class FournisseurCreate(BaseModel):
    nom: str
    contact: str | None = None
    favori: bool = False


class FournisseurUpdate(BaseModel):
    nom: str | None = None
    contact: str | None = None
    favori: bool | None = None


class EquipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    barcode_uid: str
    nom: str
    categorie_id: int | None
    emplacement_id: int | None
    statut_actuel: StatutEquipment
    created_at: datetime


# --------------------------------------------------------------------------- #
# Previews par type (vue liste du Parc unifié)
# --------------------------------------------------------------------------- #
class VracPreview(BaseModel):
    quantite_theorique: int
    quantite_actuelle: int
    ecart: int
    locked: bool
    lock_is_mine: bool


class ConsoPreview(BaseModel):
    stock_actuel: int
    seuil_alerte: int
    unite: str | None
    en_alerte: bool


class EquipmentListItem(BaseModel):
    """Élément de la liste Parc : infos + nom catégorie/emplacement + preview par type."""

    id: int
    barcode_uid: str
    nom: str
    categorie_id: int | None
    categorie_nom: str | None
    emplacement_id: int | None
    emplacement_nom: str | None
    statut_actuel: StatutEquipment
    photo_url: str | None
    type: EquipmentType
    externe: bool
    archive: bool = False
    vrac: VracPreview | None = None
    conso: ConsoPreview | None = None


# --------------------------------------------------------------------------- #
# Fiche détaillée
# --------------------------------------------------------------------------- #
class VracDetailInfo(BaseModel):
    quantite_theorique: int
    quantite_actuelle: int
    ecart: int
    lock: VracLock | None
    historique: list[InventaireEntry]


class LocationInfo(BaseModel):
    fournisseur_id: int | None
    fournisseur_nom: str | None
    reference_devis: str | None


class TicketHistoryItem(BaseModel):
    id: int
    description_panne: str | None
    avancement: AvancementTicket
    cout_estime: float | None
    date_declaration: datetime
    date_resolution: datetime | None


class ScanHistoryItem(BaseModel):
    id: int
    type_action: TypeActionScan
    contexte: str | None
    membre_nom: str | None
    emplacement_destination_id: int | None
    date_scan: datetime


class EquipmentDetail(BaseModel):
    id: int
    barcode_uid: str
    nom: str
    categorie_id: int | None
    categorie_nom: str | None
    emplacement_id: int | None
    emplacement_nom: str | None
    statut_actuel: StatutEquipment
    photo_url: str | None
    type: EquipmentType
    externe: bool
    archive: bool = False
    created_at: datetime
    vrac: VracDetailInfo | None = None
    conso: ConsoPreview | None = None
    location: LocationInfo | None = None
    tickets: list[TicketHistoryItem]
    scans: list[ScanHistoryItem]


# --------------------------------------------------------------------------- #
# Création / édition
# --------------------------------------------------------------------------- #
class EquipmentCreate(BaseModel):
    nom: str
    type: EquipmentType = "standard"
    categorie_id: int | None = None
    emplacement_id: int | None = None
    statut_actuel: StatutEquipment = StatutEquipment.FONCTIONNEL
    barcode_uid: str | None = None
    # Vrac
    quantite_theorique: int | None = None
    # Consommable
    stock_actuel: int | None = None
    seuil_alerte: int | None = None
    unite: str | None = None
    # Location externe (option, pas un type)
    externe: bool = False
    fournisseur_id: int | None = None
    fournisseur_nom: str | None = None
    reference_devis: str | None = None


class EquipmentUpdate(BaseModel):
    nom: str | None = None
    categorie_id: int | None = None
    emplacement_id: int | None = None
    statut_actuel: StatutEquipment | None = None
    barcode_uid: str | None = None
    # Vrac
    quantite_theorique: int | None = None
    # Consommable
    seuil_alerte: int | None = None
    unite: str | None = None
    # Location externe
    externe: bool | None = None
    fournisseur_id: int | None = None
    fournisseur_nom: str | None = None
    reference_devis: str | None = None


class PhotoUploadResult(BaseModel):
    photo_url: str | None

