"""equipment photo

Revision ID: 0003_equipment_photo
Revises: 0002_allocation_quantites
Create Date: 2026-05-30

Ajoute une photo optionnelle sur l'équipement (chemin du fichier sur le VPS,
servi par /api/photos). Une seule photo par équipement.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_equipment_photo"
down_revision: str | None = "0002_allocation_quantites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "equipments",
        sa.Column("photo_chemin", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("equipments", "photo_chemin")
