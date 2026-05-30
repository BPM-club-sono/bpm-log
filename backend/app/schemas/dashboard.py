"""Schémas du tableau de bord d'accueil : stats parc, presta courante, activité."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.enums import StatutPrestation, TypePrestation

# Catégorie d'une ligne d'activité (sert aux filtres de l'historique).
CategorieActivite = Literal["reparation", "scan", "statut"]


class ParcStats(BaseModel):
    """Indicateurs de santé du parc (objets non archivés et non réformés)."""

    total_actif: int
    fonctionnel: int
    en_panne: int
    en_reparation: int
    perdu: int
    pourcentage_sante: int
    tickets_ouverts: int
    tickets_non_assignes: int
    consommables_sous_seuil: int


class PrestationCourante(BaseModel):
    """Prestation en cours (ou prochaine à venir si aucune en cours)."""

    id: int
    nom: str
    type: TypePrestation
    client_nom: str | None
    date_debut: datetime | None
    date_fin: datetime | None
    statut: StatutPrestation
    responsable_nom: str | None
    nb_objets: int
    a_venir: bool


class ActiviteItem(BaseModel):
    """Une ligne du fil d'activité global."""

    id: str
    categorie: CategorieActivite
    titre: str
    equipment_id: int
    equipment_nom: str
    membre_nom: str | None
    contexte: str | None
    date: datetime
    ticket_id: int | None


class DashboardOut(BaseModel):
    """Charge utile complète du tableau de bord."""

    parc: ParcStats
    prestation: PrestationCourante | None
    activite: list[ActiviteItem]
