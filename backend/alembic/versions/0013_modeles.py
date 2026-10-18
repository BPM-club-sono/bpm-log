"""Modèles d'équipement (MH-100, H30V-L250…) pour l'ajout en nombre aux prestations.

Nouvelle table `modeles` et FK nullable `equipments.modele_id` : les items
existants restent sans modèle et sont rattachés au fil de l'eau depuis leur fiche.

Revision ID: 0013_modeles
Revises: 0012_allocation_decision_cloture
"""

import sqlalchemy as sa

from alembic import op

revision = "0013_modeles"
down_revision = "0012_allocation_decision_cloture"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "modeles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False, unique=True),
        sa.Column("marque", sa.String(120), nullable=True),
        sa.Column("categorie_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
    )
    op.add_column(
        "equipments",
        sa.Column("modele_id", sa.Integer(), sa.ForeignKey("modeles.id"), nullable=True),
    )
    op.create_index("ix_equipments_modele_id", "equipments", ["modele_id"])


def downgrade() -> None:
    op.drop_index("ix_equipments_modele_id", table_name="equipments")
    op.drop_column("equipments", "modele_id")
    op.drop_table("modeles")
