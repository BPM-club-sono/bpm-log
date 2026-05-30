"""pannes v2 : assignation des tickets + fil d'activité (commentaires & événements)

Revision ID: 0005_pannes_v2
Revises: 0004_parc_v2
Create Date: 2026-05-30

- tickets_reparation.assigne_membre_id : membre en charge de la réparation.
- evenements_ticket : fil d'activité façon GitHub issue (commentaires + événements
  système loggés : changement de statut, de coût, ajout de photo, assignation).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_pannes_v2"
down_revision: str | None = "0004_parc_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TYPE_EVENEMENT = sa.Enum(
    "Commentaire",
    "Changement_Statut",
    "Changement_Cout",
    "Ajout_Photo",
    "Changement_Assignation",
    name="type_evenement_ticket",
)


def upgrade() -> None:
    op.add_column(
        "tickets_reparation",
        sa.Column(
            "assigne_membre_id",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_tickets_assigne_membre",
        "tickets_reparation",
        "membres",
        ["assigne_membre_id"],
        ["id"],
    )

    op.create_table(
        "evenements_ticket",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("membre_id", sa.Integer(), nullable=False),
        sa.Column("type", _TYPE_EVENEMENT, nullable=False),
        sa.Column("commentaire", sa.Text(), nullable=True),
        sa.Column("valeur_avant", sa.String(length=200), nullable=True),
        sa.Column("valeur_apres", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets_reparation.id"]),
        sa.ForeignKeyConstraint(["membre_id"], ["membres.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_evenements_ticket_ticket_id",
        "evenements_ticket",
        ["ticket_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_evenements_ticket_ticket_id", table_name="evenements_ticket")
    op.drop_table("evenements_ticket")
    bind = op.get_bind()
    _TYPE_EVENEMENT.drop(bind, checkfirst=True)
    op.drop_constraint(
        "fk_tickets_assigne_membre", "tickets_reparation", type_="foreignkey"
    )
    op.drop_column("tickets_reparation", "assigne_membre_id")
