"""Mémorise la décision de clôture de chaque allocation (rapport de clôture).

Jusqu'ici la clôture n'était visible qu'à travers ses effets : un « perdu »
laissait un écart sur une allocation `Retourne`, un « cassé » forçait le retour
(et devenait indiscernable d'un vrai retour), un « ouvert » ne touchait à rien.
La colonne `decision_cloture` conserve le choix pour afficher un rapport.

Rattrapage des prestations déjà clôturées, déduit des quantités : écart sur une
allocation `Retourne` → `perdu`, écart sur une allocation non retournée →
`ouvert`. Les « cassé » passés ne sont pas récupérables (retour forcé).

Revision ID: 0012_allocation_decision_cloture
Revises: 0011_refs_qr_v1h
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_allocation_decision_cloture"
down_revision = "0011_refs_qr_v1h"
branch_labels = None
depends_on = None

_decision = postgresql.ENUM(
    "retourne", "perdu", "casse", "ouvert", name="decision_cloture", create_type=False
)


def upgrade() -> None:
    _decision.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "allocations_presta",
        sa.Column("decision_cloture", _decision, nullable=True),
    )
    op.execute(
        """
        UPDATE allocations_presta a
        SET decision_cloture = CASE
            WHEN a.statut = 'Retourne' THEN 'perdu'::decision_cloture
            ELSE 'ouvert'::decision_cloture
        END
        FROM prestations p
        WHERE p.id = a.presta_id
          AND p.statut = 'Terminee'
          AND a.quantite_retournee < a.quantite_sortie
        """
    )


def downgrade() -> None:
    op.drop_column("allocations_presta", "decision_cloture")
    _decision.drop(op.get_bind(), checkfirst=True)
