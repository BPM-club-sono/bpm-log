"""Énumérations métier — reflètent les ENUM PostgreSQL du MCD."""

import enum


class RoleMembre(enum.StrEnum):
    ADMIN = "Admin"
    STAFF = "Staff"
    TECH = "Tech"


class StatutEquipment(enum.StrEnum):
    FONCTIONNEL = "Fonctionnel"
    EN_PANNE = "En_Panne"
    EN_REPARATION = "En_Reparation"
    PERDU = "Perdu"
    REFORME = "Reforme"


class TypeActionScan(enum.StrEnum):
    SCAN_ENTREE = "Scan_Entree"
    SCAN_SORTIE = "Scan_Sortie"
    CHANGEMENT_STATUT = "Changement_Statut"
    INVENTAIRE_VRAC = "Inventaire_Vrac"


class AvancementTicket(enum.StrEnum):
    A_FAIRE = "A_faire"
    EN_COURS = "En_cours"
    EN_ATTENTE_DE_PIECE = "En_attente_de_piece"
    RESOLU = "Resolu"


class TypeEvenementTicket(enum.StrEnum):
    """Type d'entrée dans le fil d'activité d'un ticket (façon GitHub issue)."""

    COMMENTAIRE = "Commentaire"
    CHANGEMENT_STATUT = "Changement_Statut"
    CHANGEMENT_COUT = "Changement_Cout"
    AJOUT_PHOTO = "Ajout_Photo"
    CHANGEMENT_ASSIGNATION = "Changement_Assignation"


class TypePrestation(enum.StrEnum):
    INTERNE = "Interne"
    EXTERNE = "Externe"


class StatutPrestation(enum.StrEnum):
    EN_PREPARATION = "En_preparation"
    EN_COURS = "En_cours"
    TERMINEE = "Terminee"


class StatutAllocation(enum.StrEnum):
    PLANIFIE = "Planifie"
    SORTI = "Sorti"
    RETOURNE = "Retourne"
