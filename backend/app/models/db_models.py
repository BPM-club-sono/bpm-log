"""Modèles SQLAlchemy 2.x — reflètent le MCD révisé (cf. MCD.dbml et PLAN.md §2)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import (
    AvancementTicket,
    RoleMembre,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypeActionScan,
    TypePrestation,
)


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
    credentials: Mapped[list[WebauthnCredential]] = relationship(back_populates="membre")
    push_subscriptions: Mapped[list[PushSubscription]] = relationship(back_populates="membre")


class UserAuth(Base):
    __tablename__ = "users_auth"

    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    membre: Mapped[Membre] = relationship(back_populates="auth")


class WebauthnCredential(Base):
    __tablename__ = "webauthn_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    membre_id: Mapped[int] = mapped_column(ForeignKey("membres.id"), index=True)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(BigInteger, default=0)
    device_name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    membre: Mapped[Membre] = relationship(back_populates="credentials")


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
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)


class Emplacement(Base):
    __tablename__ = "emplacements"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120))
    zone_stockage: Mapped[str | None] = mapped_column(String(120))


class Equipment(Base):
    __tablename__ = "equipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    barcode_uid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    nom: Mapped[str] = mapped_column(String(200))
    categorie_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    emplacement_id: Mapped[int | None] = mapped_column(ForeignKey("emplacements.id"))
    statut_actuel: Mapped[StatutEquipment] = mapped_column(
        _enum(StatutEquipment, "statut_equipment"),
        default=StatutEquipment.FONCTIONNEL,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by_membre_id: Mapped[int | None] = mapped_column(ForeignKey("membres.id"))

    vrac: Mapped[EquipmentVrac | None] = relationship(back_populates="equipment", uselist=False)
    consommable: Mapped[EquipmentConsommable | None] = relationship(
        back_populates="equipment", uselist=False
    )


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
    offline_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    date_declaration: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    date_resolution: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list[PhotoPanne]] = relationship(back_populates="ticket")


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
    emplacement_destination_id: Mapped[int | None] = mapped_column(ForeignKey("emplacements.id"))
    offline_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    date_scan: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Fournisseur(Base):
    __tablename__ = "fournisseurs"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(200))
    contact: Mapped[str | None] = mapped_column(String(200))


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
    date_debut: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    date_fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    statut: Mapped[StatutPrestation] = mapped_column(
        _enum(StatutPrestation, "statut_prestation"),
        default=StatutPrestation.EN_PREPARATION,
    )
    responsable_membre_id: Mapped[int | None] = mapped_column(ForeignKey("membres.id"))


class AllocationPresta(Base):
    __tablename__ = "allocations_presta"

    id: Mapped[int] = mapped_column(primary_key=True)
    presta_id: Mapped[int] = mapped_column(ForeignKey("prestations.id"), index=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipments.id"), index=True)
    quantite: Mapped[int] = mapped_column(Integer, default=1)
    statut: Mapped[StatutAllocation] = mapped_column(
        _enum(StatutAllocation, "statut_allocation"),
        default=StatutAllocation.PLANIFIE,
    )
