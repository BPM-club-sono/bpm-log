"""Spécifications techniques des équipements.

Sous-catégories, champs de spécification définis par l'admin (valeurs par modèle
ou par équipement sans modèle), connecteurs et connectique, colonnes de poids,
dimensions et prix sur `modeles` et `equipments`, remarque libre sur `equipments`,
prix/poids figés sur `allocations_presta`.

Revision ID: 0014_specifications
Revises: 0013_modeles
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0014_specifications"
down_revision = "0013_modeles"
branch_labels = None
depends_on = None

_type_champ = postgresql.ENUM(
    "nombre", "texte", "choix", "oui_non", name="type_champ_spec", create_type=False
)
_sens = postgresql.ENUM("entree", "sortie", name="sens_connectique", create_type=False)

_CIBLE = "(modele_id IS NULL) <> (equipment_id IS NULL)"


def _colonnes_specs() -> list[sa.Column]:
    return [
        sa.Column("sous_categorie_id", sa.Integer(), sa.ForeignKey("sous_categories.id")),
        sa.Column("poids", sa.Numeric(8, 2)),
        sa.Column("longueur", sa.Numeric(8, 1)),
        sa.Column("largeur", sa.Numeric(8, 1)),
        sa.Column("hauteur", sa.Numeric(8, 1)),
        sa.Column("prix_interne", sa.Numeric(10, 2)),
        sa.Column("prix_externe", sa.Numeric(10, 2)),
    ]


_NOMS_SPECS = [
    "sous_categorie_id", "poids", "longueur", "largeur", "hauteur", "prix_interne", "prix_externe",
]  # fmt: skip


def upgrade() -> None:
    bind = op.get_bind()
    _type_champ.create(bind, checkfirst=True)
    _sens.create(bind, checkfirst=True)

    op.create_table(
        "sous_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("categorie_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.UniqueConstraint("categorie_id", "nom"),
    )
    op.create_table(
        "champs_specification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("type", _type_champ, nullable=False),
        sa.Column("unite", sa.String(20), nullable=True),
        sa.Column(
            "options", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("categorie_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("sous_categorie_id", sa.Integer(), sa.ForeignKey("sous_categories.id")),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "valeurs_specification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "champ_id",
            sa.Integer(),
            sa.ForeignKey("champs_specification.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("modele_id", sa.Integer(), sa.ForeignKey("modeles.id", ondelete="CASCADE")),
        sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipments.id", ondelete="CASCADE")),
        sa.Column("valeur", sa.Text(), nullable=False),
        sa.CheckConstraint(_CIBLE, name="ck_valeurs_specification_cible"),
        sa.UniqueConstraint("champ_id", "modele_id"),
        sa.UniqueConstraint("champ_id", "equipment_id"),
    )
    op.create_index("ix_valeurs_specification_modele_id", "valeurs_specification", ["modele_id"])
    op.create_index(
        "ix_valeurs_specification_equipment_id", "valeurs_specification", ["equipment_id"]
    )
    op.create_table(
        "connecteurs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(80), nullable=False, unique=True),
    )
    op.create_table(
        "connectiques",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "connecteur_id",
            sa.Integer(),
            sa.ForeignKey("connecteurs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sens", _sens, nullable=False),
        sa.Column("quantite", sa.Integer(), nullable=False),
        sa.Column("modele_id", sa.Integer(), sa.ForeignKey("modeles.id", ondelete="CASCADE")),
        sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipments.id", ondelete="CASCADE")),
        sa.CheckConstraint("quantite >= 1", name="ck_connectiques_quantite"),
        sa.CheckConstraint(_CIBLE, name="ck_connectiques_cible"),
        sa.UniqueConstraint("connecteur_id", "sens", "modele_id"),
        sa.UniqueConstraint("connecteur_id", "sens", "equipment_id"),
    )
    op.create_index("ix_connectiques_modele_id", "connectiques", ["modele_id"])
    op.create_index("ix_connectiques_equipment_id", "connectiques", ["equipment_id"])

    for table in ("modeles", "equipments"):
        for col in _colonnes_specs():
            op.add_column(table, col)
    op.add_column("equipments", sa.Column("remarque", sa.Text(), nullable=True))
    op.add_column("allocations_presta", sa.Column("prix_unitaire_fige", sa.Numeric(10, 2)))
    op.add_column("allocations_presta", sa.Column("poids_unitaire_fige", sa.Numeric(8, 2)))


def downgrade() -> None:
    op.drop_column("allocations_presta", "poids_unitaire_fige")
    op.drop_column("allocations_presta", "prix_unitaire_fige")
    op.drop_column("equipments", "remarque")
    for table in ("equipments", "modeles"):
        for nom in reversed(_NOMS_SPECS):
            op.drop_column(table, nom)

    op.drop_index("ix_connectiques_equipment_id", table_name="connectiques")
    op.drop_index("ix_connectiques_modele_id", table_name="connectiques")
    op.drop_table("connectiques")
    op.drop_table("connecteurs")
    op.drop_index("ix_valeurs_specification_equipment_id", table_name="valeurs_specification")
    op.drop_index("ix_valeurs_specification_modele_id", table_name="valeurs_specification")
    op.drop_table("valeurs_specification")
    op.drop_table("champs_specification")
    op.drop_table("sous_categories")

    bind = op.get_bind()
    _sens.drop(bind, checkfirst=True)
    _type_champ.drop(bind, checkfirst=True)
