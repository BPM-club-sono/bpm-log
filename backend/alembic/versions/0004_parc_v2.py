"""parc v2 : archivage location, contexte des scans, fournisseurs favoris

Revision ID: 0004_parc_v2
Revises: 0003_equipment_photo
Create Date: 2026-05-30

- equipments.archive : masque du Parc le matériel de location rendu (trace conservée).
- logs_scans.contexte : contexte lisible de l'évènement (nom de presta, nouveau statut…).
- fournisseurs.favori : fournisseurs prioritaires affichés en accès rapide.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_parc_v2"
down_revision: str | None = "0003_equipment_photo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "equipments",
        sa.Column(
            "archive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "logs_scans",
        sa.Column("contexte", sa.String(length=300), nullable=True),
    )
    op.add_column(
        "fournisseurs",
        sa.Column(
            "favori",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("fournisseurs", "favori")
    op.drop_column("logs_scans", "contexte")
    op.drop_column("equipments", "archive")
