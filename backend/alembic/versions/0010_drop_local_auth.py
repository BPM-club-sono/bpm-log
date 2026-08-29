"""Supprime les vestiges de l'authentification locale (mot de passe, WebAuthn).

L'authentification est entièrement déléguée à authentik depuis la migration OIDC
(cf. docs/authentik-sso.md) : l'API n'émet plus de token et ne vérifie plus de
mot de passe. Restaient en base la colonne `users_auth.password_hash` et la table
`webauthn_credentials`, que plus aucun code ne lit.

`users_auth` survit : `is_active` reste lu à chaque requête pour couper un accès
sans attendre l'expiration du token authentik.

Revision ID: 0010_drop_local_auth
Revises: 0009_prestation_ebauche
"""

import sqlalchemy as sa

from alembic import op

revision = "0010_drop_local_auth"
down_revision = "0009_prestation_ebauche"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("webauthn_credentials")
    op.drop_column("users_auth", "password_hash")


def downgrade() -> None:
    # Les hachages perdus ne sont pas récupérables : la colonne revient vide.
    # Un `server_default` est nécessaire pour les lignes déjà présentes, puis
    # retiré pour retrouver la contrainte NOT NULL d'origine.
    op.add_column(
        "users_auth",
        sa.Column("password_hash", sa.String(255), nullable=False, server_default=""),
    )
    op.alter_column("users_auth", "password_hash", server_default=None)

    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membre_id", sa.Integer(), sa.ForeignKey("membres.id"), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("device_name", sa.String(120)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_webauthn_credentials_membre_id", "webauthn_credentials", ["membre_id"]
    )
