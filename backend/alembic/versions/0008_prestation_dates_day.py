"""prestations : dates jour-près (timestamp -> date)

Revision ID: 0008_prestation_dates_day
Revises: 0007_flights
Create Date: 2026-06-11

- prestations.date_debut / date_fin passent de timestamptz à date : la
  temporalité d'un événement se gère au jour près, sans heure ni fuseau.
  Les colonnes restent nullable ; la troncature ::date ne perd qu'une
  composante horaire jamais réellement saisie.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_prestation_dates_day"
down_revision: str | None = "0007_flights"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "prestations",
        "date_debut",
        type_=sa.Date(),
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        postgresql_using="date_debut::date",
    )
    op.alter_column(
        "prestations",
        "date_fin",
        type_=sa.Date(),
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        postgresql_using="date_fin::date",
    )


def downgrade() -> None:
    op.alter_column(
        "prestations",
        "date_fin",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.Date(),
        existing_nullable=True,
        postgresql_using="date_fin::timestamptz",
    )
    op.alter_column(
        "prestations",
        "date_debut",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.Date(),
        existing_nullable=True,
        postgresql_using="date_debut::timestamptz",
    )
