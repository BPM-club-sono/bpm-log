"""flights explicites : equipments.est_contenant

Revision ID: 0007_flights
Revises: 0006_contenants
Create Date: 2026-06-10

- equipments.est_contenant : booléen, marque un équipement comme flight (contenant).
  Seul un équipement marqué peut recevoir du contenu (contenant_id doit pointer
  vers un flight). Backfill : tout équipement ayant déjà du contenu est flagué.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_flights"
down_revision: str | None = "0006_contenants"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "equipments",
        sa.Column("est_contenant", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Reprise de l'existant : les contenants implicites (ayant du contenu) deviennent
    # des flights, même vrac/conso — la restriction ne s'applique qu'aux nouvelles écritures.
    op.execute(
        "UPDATE equipments SET est_contenant = true WHERE id IN "
        "(SELECT DISTINCT contenant_id FROM equipments WHERE contenant_id IS NOT NULL)"
    )


def downgrade() -> None:
    op.drop_column("equipments", "est_contenant")
