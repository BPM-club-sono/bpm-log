"""allocation quantites sortie/retournee

Revision ID: 0002_allocation_quantites
Revises: 0001_initial
Create Date: 2026-05-30

Ajoute le suivi des quantités sorties / retournées sur les allocations de
prestation (checklist unifiée sortie/retour, cf. PLAN.md §3.1).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_allocation_quantites"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "allocations_presta",
        sa.Column("quantite_sortie", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "allocations_presta",
        sa.Column(
            "quantite_retournee", sa.Integer(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    op.drop_column("allocations_presta", "quantite_retournee")
    op.drop_column("allocations_presta", "quantite_sortie")
