"""Modèles SQLAlchemy 2.x — reflètent le MCD révisé (cf. MCD.dbml et docs/plan-initial.md §2)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import (
    AvancementTicket,
    DecisionCloture,
    RoleMembre,
    SensConnectique,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypeActionScan,
    TypeChampSpec,
    TypeEvenementTicket,
    TypePrestation,
)
from app.services.barcode import FORMAT_REFERENCE


def _enum(enum_cls: type, name: str) -> SAEnum:
    """Helper : ENUM PostgreSQL stocké par valeur (et non par nom Python)."""
    return SAEnum(
        enum_cls,
        name=name,
        values_callable=lambda e: [member.value for member in e],
    )


class Membre(Base):
    __tablename__ = "membres"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str | None] = mapped_column(String(120))
    prenom: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    role: Mapped[RoleMembre] = mapped_column(_enum(RoleMembre, "role_membre"))
    mandat: Mapped[int | None] = mapped_column(Integer)

    auth: Mapped[UserAuth | None] = relationship(back_populates="membre", uselist=False)
    push_subscriptions: Mapped[list[PushSubscription]] = relationship(back_populates="membre")


class UserAuth(Base):
    __tablename__ = "users_auth"

    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"), primary_key=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    membre: Mapped[Membre] = relationship(back_populates="auth")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    membre: Mapped[Membre] = relationship(back_populates="push_subscriptions")


class Categorie(Base):
    """Catégorie en arbre de profondeur libre (Son > Ampli > …). Une catégorie hérite
    des champs de spécification de tous ses ancêtres (vue `categories_lignee`)."""

    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint("parent_id <> id", name="ck_categories_parent"),
        # Unicité entre frères : « Contrôleur » peut exister sous Son et sous Vidéo.
        UniqueConstraint(
            "parent_id",
            "nom",
            name="uq_categories_parent_id_nom",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    # NULL = catégorie racine.
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), index=True)


class ChampSpecification(Base):
    """Champ de spécification défini par l'admin pour une catégorie, hérité par toutes
    ses descendantes. Les valeurs vivent dans `ValeurSpecification`."""

    __tablename__ = "champs_specification"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120))
    type: Mapped[TypeChampSpec] = mapped_column(_enum(TypeChampSpec, "type_champ_spec"))
    unite: Mapped[str | None] = mapped_column(String(20))
    # Choix proposés quand type = choix ; vide sinon.
    options: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    categorie_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    ordre: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ValeurSpecification(Base):
    """Valeur d'un champ pour un modèle OU pour un équipement sans modèle (XOR)."""

    __tablename__ = "valeurs_specification"
    __table_args__ = (
        CheckConstraint(
            "(modele_id IS NULL) <> (equipment_id IS NULL)",
            name="ck_valeurs_specification_cible",
        ),
        UniqueConstraint("champ_id", "modele_id"),
        UniqueConstraint("champ_id", "equipment_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    champ_id: Mapped[int] = mapped_column(ForeignKey("champs_specification.id", ondelete="CASCADE"))
    modele_id: Mapped[int | None] = mapped_column(
        ForeignKey("modeles.id", ondelete="CASCADE"), index=True
    )
    equipment_id: Mapped[int | None] = mapped_column(
        ForeignKey("equipments.id", ondelete="CASCADE"), index=True
    )
    valeur: Mapped[str] = mapped_column(Text)


class Connecteur(Base):
    __tablename__ = "connecteurs"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(80), unique=True)


class Connectique(Base):
    """Connecteurs d'un modèle OU d'un équipement sans modèle (XOR), par sens."""

    __tablename__ = "connectiques"
    __table_args__ = (
        CheckConstraint("quantite >= 1", name="ck_connectiques_quantite"),
        CheckConstraint(
            "(modele_id IS NULL) <> (equipment_id IS NULL)", name="ck_connectiques_cible"
        ),
        UniqueConstraint("connecteur_id", "sens", "modele_id"),
        UniqueConstraint("connecteur_id", "sens", "equipment_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    connecteur_id: Mapped[int] = mapped_column(ForeignKey("connecteurs.id", ondelete="CASCADE"))
    sens: Mapped[SensConnectique] = mapped_column(_enum(SensConnectique, "sens_connectique"))
    quantite: Mapped[int] = mapped_column(Integer)
    modele_id: Mapped[int | None] = mapped_column(
        ForeignKey("modeles.id", ondelete="CASCADE"), index=True
    )
    equipment_id: Mapped[int | None] = mapped_column(
        ForeignKey("equipments.id", ondelete="CASCADE"), index=True
    )


class Modele(Base):
    """Modèle commercial d'un équipement (ex. « MH-100 ») : regroupe les unités
    identiques pour les ajouter en nombre à une prestation. Fait foi pour la
    catégorie de ses unités."""

    __tablename__ = "modeles"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Unicité exacte, sans normalisation : on veut des noms de modèle propres.
    nom: Mapped[str] = mapped_column(String(120), unique=True)
    marque: Mapped[str | None] = mapped_column(String(120))
    categorie_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    poids: Mapped[float | None] = mapped_column(Numeric(8, 2, asdecimal=False))
    longueur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))
    largeur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))
    hauteur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))
    prix_interne: Mapped[float | None] = mapped_column(Numeric(10, 2, asdecimal=False))
    prix_externe: Mapped[float | None] = mapped_column(Numeric(10, 2, asdecimal=False))


class Emplacement(Base):
    __tablename__ = "emplacements"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120))
    zone_stockage: Mapped[str | None] = mapped_column(String(120))
    # Emplacement parent pour le rangement fixe imbriqué (Dépôt > Étagère A).
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("emplacements.id"), index=True)

    parent: Mapped[Emplacement | None] = relationship(remote_side=[id])


class Equipment(Base):
    __tablename__ = "equipments"
    __table_args__ = (
        CheckConstraint(
            f"barcode_uid ~ '{FORMAT_REFERENCE}'",
            name="ck_equipments_barcode_uid_format",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Contenu du QR code. Tient en QR version 1 + correction H, ce qui impose
    # 10 caractères majuscules — cf. app/services/barcode.py. Le préfixe est
    # figé à la création : ce n'est PAS le propriétaire actuel (un matériel
    # loué puis racheté garde son trigramme), seul EquipmentLocation fait foi.
    barcode_uid: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    nom: Mapped[str] = mapped_column(String(200))
    categorie_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    # Modèle (MH-100…) : obligatoire à la création d'un item unitaire, hors flight
    # et location. Quand il est renseigné, la catégorie de l'item suit la sienne.
    modele_id: Mapped[int | None] = mapped_column(ForeignKey("modeles.id"), index=True)
    emplacement_id: Mapped[int | None] = mapped_column(ForeignKey("emplacements.id"))
    # Contenant direct (flight case…) : un équipement rangé DANS un autre équipement.
    # Exclusif avec emplacement_id (cf. règle de frontière, PLAN). NULL = pas dans une caisse.
    contenant_id: Mapped[int | None] = mapped_column(ForeignKey("equipments.id"), index=True)
    # Flight/contenant explicite : seul un équipement marqué peut recevoir du contenu.
    est_contenant: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    statut_actuel: Mapped[StatutEquipment] = mapped_column(
        _enum(StatutEquipment, "statut_equipment"),
        default=StatutEquipment.FONCTIONNEL,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by_membre_id: Mapped[int | None] = mapped_column(ForeignKey("membres.id"))
    photo_chemin: Mapped[str | None] = mapped_column(String(500))
    # Matériel de location archivé (rendu au fournisseur) : conservé en base mais
    # masqué du Parc par défaut pour ne pas le saturer.
    archive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Specs techniques utilisées seulement sans modèle : sinon le modèle fait foi.
    poids: Mapped[float | None] = mapped_column(Numeric(8, 2, asdecimal=False))  # kg
    longueur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))  # cm
    largeur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))  # cm
    hauteur: Mapped[float | None] = mapped_column(Numeric(8, 1, asdecimal=False))  # cm
    prix_interne: Mapped[float | None] = mapped_column(Numeric(10, 2, asdecimal=False))
    prix_externe: Mapped[float | None] = mapped_column(Numeric(10, 2, asdecimal=False))
    remarque: Mapped[str | None] = mapped_column(Text)

    vrac: Mapped[EquipmentVrac | None] = relationship(back_populates="equipment", uselist=False)
    consommable: Mapped[EquipmentConsommable | None] = relationship(
        back_populates="equipment", uselist=False
    )
    # Arbre des contenants (adjacency list) : contenant = parent, contenu = enfants.
    contenant: Mapped[Equipment | None] = relationship(
        back_populates="contenu", remote_side=[id]
    )
    contenu: Mapped[list[Equipment]] = relationship(back_populates="contenant")


class EquipmentVrac(Base):
    __tablename__ = "equipments_vrac"

    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), primary_key=True)
    quantite_theorique: Mapped[int] = mapped_column(Integer, default=0)

    equipment: Mapped[Equipment] = relationship(back_populates="vrac")


class EquipmentConsommable(Base):
    __tablename__ = "equipments_consommable"

    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), primary_key=True)
    stock_actuel: Mapped[int] = mapped_column(Integer, default=0)
    seuil_alerte: Mapped[int] = mapped_column(Integer, default=0)
    unite: Mapped[str | None] = mapped_column(String(40))

    equipment: Mapped[Equipment] = relationship(back_populates="consommable")


class InventaireVrac(Base):
    __tablename__ = "inventaires_vrac"

    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipments_vrac.equipment_id"), index=True
    )
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    delta: Mapped[int] = mapped_column(Integer)
    presta_id: Mapped[int | None] = mapped_column(ForeignKey("prestations.id"))
    note: Mapped[str | None] = mapped_column(Text)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryLock(Base):
    __tablename__ = "inventory_locks"

    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipments_vrac.equipment_id"), primary_key=True
    )
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    acquired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TicketReparation(Base):
    __tablename__ = "tickets_reparation"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid_client: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), unique=True, index=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), index=True)
    declare_par_membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    description_panne: Mapped[str | None] = mapped_column(Text)
    avancement: Mapped[AvancementTicket] = mapped_column(
        _enum(AvancementTicket, "avancement_ticket"),
        default=AvancementTicket.A_FAIRE,
    )
    cout_estime: Mapped[float | None] = mapped_column(Float)
    assigne_membre_id: Mapped[int | None] = mapped_column(ForeignKey("membres.id"))
    offline_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    date_declaration: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    date_resolution: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list[PhotoPanne]] = relationship(back_populates="ticket")
    evenements: Mapped[list[EvenementTicket]] = relationship(back_populates="ticket")


class EvenementTicket(Base):
    """Fil d'activité d'un ticket : commentaires libres + événements système loggés."""

    __tablename__ = "evenements_ticket"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(
        ForeignKey("tickets_reparation.id"), index=True
    )
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    type: Mapped[TypeEvenementTicket] = mapped_column(
        _enum(TypeEvenementTicket, "type_evenement_ticket")
    )
    # Texte du commentaire (type Commentaire) ou note optionnelle accompagnant l'événement.
    commentaire: Mapped[str | None] = mapped_column(Text)
    # Valeurs lisibles avant/après pour les changements (statut, coût, assignation).
    valeur_avant: Mapped[str | None] = mapped_column(String(200))
    valeur_apres: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    ticket: Mapped[TicketReparation] = relationship(back_populates="evenements")


class PhotoPanne(Base):
    __tablename__ = "photos_panne"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets_reparation.id"), index=True)
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    chemin: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[TicketReparation] = relationship(back_populates="photos")


class LogScan(Base):
    __tablename__ = "logs_scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid_client: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), unique=True, index=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), index=True)
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"))
    type_action: Mapped[TypeActionScan] = mapped_column(_enum(TypeActionScan, "type_action_scan"))
    # Contexte lisible de l'évènement (nom de presta, nouveau statut…) pour l'historique.
    contexte: Mapped[str | None] = mapped_column(String(300))
    emplacement_destination_id: Mapped[int | None] = mapped_column(ForeignKey("emplacements.id"))
    offline_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    date_scan: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Fournisseur(Base):
    __tablename__ = "fournisseurs"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(200))
    # Trigramme qui préfixe les références du matériel loué chez ce fournisseur
    # (ex. NOV pour Novelty). Facultatif : sans lui, le matériel prend EXT.
    code: Mapped[str | None] = mapped_column(String(3), unique=True, index=True)
    contact: Mapped[str | None] = mapped_column(String(200))
    favori: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class EquipmentLocation(Base):
    __tablename__ = "equipments_location"

    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), primary_key=True)
    fournisseur_id: Mapped[int] = mapped_column(ForeignKey("fournisseurs.id"))
    reference_devis: Mapped[str | None] = mapped_column(String(120))


class Prestation(Base):
    __tablename__ = "prestations"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(200))
    type: Mapped[TypePrestation] = mapped_column(_enum(TypePrestation, "type_prestation"))
    client_nom: Mapped[str | None] = mapped_column(String(200))
    date_debut: Mapped[date | None] = mapped_column(Date)
    date_fin: Mapped[date | None] = mapped_column(Date)
    statut: Mapped[StatutPrestation] = mapped_column(
        _enum(StatutPrestation, "statut_prestation"),
        default=StatutPrestation.EBAUCHE,
    )
    responsable_membre_id: Mapped[int | None] = mapped_column(ForeignKey("membres.id"))


class AllocationPresta(Base):
    __tablename__ = "allocations_presta"

    id: Mapped[int] = mapped_column(primary_key=True)
    presta_id: Mapped[int] = mapped_column(ForeignKey("prestations.id"), index=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), index=True)
    quantite: Mapped[int] = mapped_column(Integer, default=1)
    quantite_sortie: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    quantite_retournee: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    statut: Mapped[StatutAllocation] = mapped_column(
        _enum(StatutAllocation, "statut_allocation"),
        default=StatutAllocation.PLANIFIE,
    )
    # Décision prise à la clôture (None tant que la prestation n'est pas clôturée,
    # ou si l'allocation n'avait pas d'écart). Sert au rapport de clôture : sans
    # elle, un « cassé » (retour forcé) ne se distingue plus d'un vrai retour.
    decision_cloture: Mapped[DecisionCloture | None] = mapped_column(
        _enum(DecisionCloture, "decision_cloture")
    )
    # Figés à la clôture, NULL tant que la presta est ouverte : le rapport garde
    # ainsi les valeurs d'alors même si le catalogue change ensuite.
    prix_unitaire_fige: Mapped[float | None] = mapped_column(
        Numeric(10, 2, asdecimal=False)
    )
    poids_unitaire_fige: Mapped[float | None] = mapped_column(
        Numeric(8, 2, asdecimal=False)
    )

    equipment: Mapped[Equipment] = relationship(lazy="raise")
