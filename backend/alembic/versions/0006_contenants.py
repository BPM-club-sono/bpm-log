"""contenants imbriqués : rangement hiérarchique (flight cases)

Revision ID: 0006_contenants
Revises: 0005_pannes_v2
Create Date: 2026-06-09

- equipments.contenant_id : self-FK, un équipement rangé DANS un autre (flight case).
- emplacements.parent_id : self-FK, rangement fixe imbriqué (Dépôt > Étagère A).

Les deux colonnes sont nullables ; la localisation effective d'un item se dérive en
remontant contenant_id jusqu'à la racine, puis emplacement.parent_id.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_contenants"
down_revision: str | None = "0005_pannes_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "equipments",
        sa.Column("contenant_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_equipments_contenant_id"), "equipments", ["contenant_id"]
    )
    op.create_foreign_key(
        "fk_equipments_contenant_id_equipments",
        "equipments",
        "equipments",
        ["contenant_id"],
        ["id"],
    )

    op.add_column(
        "emplacements",
        sa.Column("parent_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_emplacements_parent_id"), "emplacements", ["parent_id"]
    )
    op.create_foreign_key(
        "fk_emplacements_parent_id_emplacements",
        "emplacements",
        "emplacements",
        ["parent_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_emplacements_parent_id_emplacements", "emplacements", type_="foreignkey"
    )
    op.drop_index(op.f("ix_emplacements_parent_id"), table_name="emplacements")
    op.drop_column("emplacements", "parent_id")

    op.drop_constraint(
        "fk_equipments_contenant_id_equipments", "equipments", type_="foreignkey"
    )
    op.drop_index(op.f("ix_equipments_contenant_id"), table_name="equipments")
    op.drop_column("equipments", "contenant_id")
