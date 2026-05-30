"""Schémas tickets de réparation & fil d'activité."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, computed_field

from app.models.enums import AvancementTicket, RoleMembre, TypeEvenementTicket


class PhotoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    chemin: str
    created_at: datetime

    @computed_field
    @property
    def url(self) -> str:
        """URL publique servie par l'API."""
        return f"/api/photos/{self.chemin}"


class MembreLite(BaseModel):
    """Membre minimal pour l'affichage (déclarant, assigné, picker)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str | None
    prenom: str | None
    role: RoleMembre


class EvenementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: TypeEvenementTicket
    commentaire: str | None
    valeur_avant: str | None
    valeur_apres: str | None
    created_at: datetime
    auteur: MembreLite | None = None


class TicketListItem(BaseModel):
    """Élément de la liste des pannes / réparations."""

    id: int
    equipment_id: int
    equipment_nom: str
    equipment_barcode: str
    avancement: AvancementTicket
    description_panne: str | None
    cout_estime: float | None
    date_declaration: datetime
    date_resolution: datetime | None
    declarant: MembreLite | None
    assigne: MembreLite | None
    nb_photos: int


class TicketDetail(BaseModel):
    """Fiche détaillée d'un ticket de réparation."""

    id: int
    equipment_id: int
    equipment_nom: str
    equipment_barcode: str
    avancement: AvancementTicket
    description_panne: str | None
    cout_estime: float | None
    date_declaration: datetime
    date_resolution: datetime | None
    declarant: MembreLite | None
    assigne: MembreLite | None
    photos: list[PhotoRead]
    evenements: list[EvenementRead]


class TicketCreate(BaseModel):
    """Création d'un ticket en ligne (la déclaration offline passe par /sync)."""

    equipment_id: int | None = None
    barcode_uid: str | None = None
    description_panne: str | None = None
    cout_estime: float | None = None


class TicketUpdate(BaseModel):
    """Mise à jour de l'avancement / coût / assignation."""

    avancement: AvancementTicket | None = None
    cout_estime: float | None = None
    assigne_membre_id: int | None = None
    # Distingue « ne pas toucher » (champ absent) de « désassigner » (null explicite).
    set_assigne: bool = False


class CommentaireCreate(BaseModel):
    commentaire: str
