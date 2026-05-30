"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-29

Schéma initial complet du parc matériel BPM (cf. MCD.dbml et PLAN.md §2).
Écrit à la main car aucune base PostgreSQL n'était disponible pour l'autogenerate ;
le résultat reflète exactement les modèles SQLAlchemy de app/models/db_models.py.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# --- Types ENUM PostgreSQL (un usage chacun ; create_type=False, création explicite) ---
role_membre = postgresql.ENUM("Admin", "Staff", "Tech", name="role_membre", create_type=False)
statut_equipment = postgresql.ENUM(
    "Fonctionnel", "En_Panne", "En_Reparation", "Perdu", "Reforme",
    name="statut_equipment", create_type=False,
)
type_action_scan = postgresql.ENUM(
    "Scan_Entree", "Scan_Sortie", "Changement_Statut", "Inventaire_Vrac",
    name="type_action_scan", create_type=False,
)
avancement_ticket = postgresql.ENUM(
    "A_faire", "En_cours", "En_attente_de_piece", "Resolu",
    name="avancement_ticket", create_type=False,
)
type_prestation = postgresql.ENUM(
    "Interne", "Externe", name="type_prestation", create_type=False
)
statut_prestation = postgresql.ENUM(
    "En_preparation", "En_cours", "Terminee", name="statut_prestation", create_type=False
)
statut_allocation = postgresql.ENUM(
    "Planifie", "Sorti", "Retourne", name="statut_allocation", create_type=False
)

_ALL_ENUMS = [
    role_membre, statut_equipment, type_action_scan, avancement_ticket,
    type_prestation, statut_prestation, statut_allocation,
]


def upgrade() -> None:
    bind = op.get_bind()
    for enum in _ALL_ENUMS:
        enum.create(bind, checkfirst=True)

    op.create_table(
        "membres",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120)),
        sa.Column("prenom", sa.String(120)),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("role", role_membre, nullable=False),
        sa.Column("mandat", sa.Integer()),
    )
    op.create_index("ix_membres_email", "membres", ["email"], unique=True)

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("description", sa.Text()),
    )

    op.create_table(
        "emplacements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("zone_stockage", sa.String(120)),
    )

    op.create_table(
        "fournisseurs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(200), nullable=False),
        sa.Column("contact", sa.String(200)),
    )

    op.create_table(
        "users_auth",
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), primary_key=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("last_login", sa.DateTime(timezone=True)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("device_name", sa.String(120)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_webauthn_credentials_membre_id", "webauthn_credentials", ["membre_id"]
    )

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_push_subscriptions_membre_id", "push_subscriptions", ["membre_id"])

    op.create_table(
        "equipments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("barcode_uid", sa.String(64), nullable=False, unique=True),
        sa.Column("nom", sa.String(200), nullable=False),
        sa.Column("categorie_id", sa.Integer(), sa.ForeignKey("categories.id")),
        sa.Column("emplacement_id", sa.Integer(), sa.ForeignKey("emplacements.id")),
        sa.Column(
            "statut_actuel", statut_equipment, nullable=False, server_default="Fonctionnel"
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by_membre_id", sa.Integer(), sa.ForeignKey("membres.id")),
    )
    op.create_index("ix_equipments_barcode_uid", "equipments", ["barcode_uid"], unique=True)

    op.create_table(
        "equipments_vrac",
        sa.Column(
            "equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), primary_key=True
        ),
        sa.Column("quantite_theorique", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "equipments_consommable",
        sa.Column(
            "equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), primary_key=True
        ),
        sa.Column("stock_actuel", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seuil_alerte", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unite", sa.String(40)),
    )

    op.create_table(
        "equipments_location",
        sa.Column(
            "equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), primary_key=True
        ),
        sa.Column("fournisseur_id", sa.Integer(), sa.ForeignKey("fournisseurs.id"), nullable=False),
        sa.Column("reference_devis", sa.String(120)),
    )

    op.create_table(
        "prestations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(200), nullable=False),
        sa.Column("type", type_prestation, nullable=False),
        sa.Column("client_nom", sa.String(200)),
        sa.Column("date_debut", sa.DateTime(timezone=True)),
        sa.Column("date_fin", sa.DateTime(timezone=True)),
        sa.Column(
            "statut", statut_prestation, nullable=False, server_default="En_preparation"
        ),
        sa.Column("responsable_membre_id", sa.Integer(), sa.ForeignKey("membres.id")),
    )

    op.create_table(
        "allocations_presta",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("presta_id", sa.Integer(), sa.ForeignKey("prestations.id"), nullable=False),
        sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), nullable=False),
        sa.Column("quantite", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("statut", statut_allocation, nullable=False, server_default="Planifie"),
    )
    op.create_index("ix_allocations_presta_presta_id", "allocations_presta", ["presta_id"])
    op.create_index("ix_allocations_presta_equipment_id", "allocations_presta", ["equipment_id"])

    op.create_table(
        "inventaires_vrac",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "equipment_id",
            sa.Integer(),
            sa.ForeignKey("equipments_vrac.equipment_id"),
            nullable=False,
        ),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("presta_id", sa.Integer(), sa.ForeignKey("prestations.id")),
        sa.Column("note", sa.Text()),
        sa.Column("date", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_inventaires_vrac_equipment_id", "inventaires_vrac", ["equipment_id"])

    op.create_table(
        "inventory_locks",
        sa.Column(
            "equipment_id",
            sa.Integer(),
            sa.ForeignKey("equipments_vrac.equipment_id"),
            primary_key=True,
        ),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "tickets_reparation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "uuid_client", postgresql.UUID(as_uuid=True), nullable=False, unique=True
        ),
        sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), nullable=False),
        sa.Column(
            "declare_par_membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False
        ),
        sa.Column("description_panne", sa.Text()),
        sa.Column("avancement", avancement_ticket, nullable=False, server_default="A_faire"),
        sa.Column("cout_estime", sa.Float()),
        sa.Column("offline_created_at", sa.DateTime(timezone=True)),
        sa.Column("date_declaration", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("date_resolution", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_tickets_reparation_uuid_client", "tickets_reparation", ["uuid_client"], unique=True
    )
    op.create_index("ix_tickets_reparation_equipment_id", "tickets_reparation", ["equipment_id"])

    op.create_table(
        "photos_panne",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ticket_id", sa.Integer(), sa.ForeignKey("tickets_reparation.id"), nullable=False
        ),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("chemin", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_photos_panne_ticket_id", "photos_panne", ["ticket_id"])

    op.create_table(
        "logs_scans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "uuid_client", postgresql.UUID(as_uuid=True), nullable=False, unique=True
        ),
        sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipments.id"), nullable=False),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("type_action", type_action_scan, nullable=False),
        sa.Column(
            "emplacement_destination_id", sa.Integer(), sa.ForeignKey("emplacements.id")
        ),
        sa.Column("offline_created_at", sa.DateTime(timezone=True)),
        sa.Column("date_scan", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_logs_scans_uuid_client", "logs_scans", ["uuid_client"], unique=True)
    op.create_index("ix_logs_scans_equipment_id", "logs_scans", ["equipment_id"])
    op.create_index("ix_logs_scans_offline_created_at", "logs_scans", ["offline_created_at"])


def downgrade() -> None:
    op.drop_table("logs_scans")
    op.drop_table("photos_panne")
    op.drop_table("tickets_reparation")
    op.drop_table("inventory_locks")
    op.drop_table("inventaires_vrac")
    op.drop_table("allocations_presta")
    op.drop_table("prestations")
    op.drop_table("equipments_location")
    op.drop_table("equipments_consommable")
    op.drop_table("equipments_vrac")
    op.drop_table("equipments")
    op.drop_table("push_subscriptions")
    op.drop_table("webauthn_credentials")
    op.drop_table("users_auth")
    op.drop_table("fournisseurs")
    op.drop_table("emplacements")
    op.drop_table("categories")
    op.drop_table("membres")

    bind = op.get_bind()
    for enum in reversed(_ALL_ENUMS):
        enum.drop(bind, checkfirst=True)
