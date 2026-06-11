"""Ajoute l'état « Ebauche » (phase de construction) avant « En_preparation ».

Nouvel état initial d'une prestation fraîchement créée : on construit/ajuste la
liste de matériel avant de la valider en préparation.

Revision ID: 0009_prestation_ebauche
Revises: 0008_prestation_dates_day
"""

from alembic import op

revision = "0009_prestation_ebauche"
down_revision = "0008_prestation_dates_day"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # On se contente d'ajouter la valeur à l'ENUM. PostgreSQL interdit d'utiliser
    # une nouvelle valeur d'ENUM (ex. `SET DEFAULT 'Ebauche'`) dans la même
    # transaction que son ADD VALUE, et cet alembic monte toutes les migrations
    # dans une seule transaction. Le défaut à la création est donc géré côté ORM
    # (`Prestation.statut default=EBAUCHE`) et par le routeur create_prestation.
    op.execute(
        "ALTER TYPE statut_prestation ADD VALUE IF NOT EXISTS 'Ebauche' "
        "BEFORE 'En_preparation'"
    )


def downgrade() -> None:
    # PostgreSQL ne sait pas retirer une valeur d'ENUM : on recrée le type sans
    # « Ebauche » après avoir replié les lignes concernées sur « En_preparation ».
    op.execute(
        "UPDATE prestations SET statut = 'En_preparation' WHERE statut = 'Ebauche'"
    )
    op.execute("ALTER TABLE prestations ALTER COLUMN statut DROP DEFAULT")
    op.execute("ALTER TYPE statut_prestation RENAME TO statut_prestation_old")
    op.execute(
        "CREATE TYPE statut_prestation AS ENUM "
        "('En_preparation', 'En_cours', 'Terminee')"
    )
    op.execute(
        "ALTER TABLE prestations ALTER COLUMN statut TYPE statut_prestation "
        "USING statut::text::statut_prestation"
    )
    op.execute(
        "ALTER TABLE prestations ALTER COLUMN statut SET DEFAULT 'En_preparation'"
    )
    op.execute("DROP TYPE statut_prestation_old")
