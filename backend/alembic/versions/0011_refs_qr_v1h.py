"""Références matériel au format PPP-NNNNNN, imprimables en QR v1 + correction H.

Les étiquettes partent en tournée sur du matériel qui s'use : les QR passent en
correction d'erreur H (~30 % de récupération) et doivent rester en version 1
(21×21 modules) pour ne pas grossir. Un QR v1 en H tient exactement
**10 caractères** en mode alphanumérique, et ce mode n'accepte pas les
minuscules — toute minuscule bascule le symbole en mode Byte et force la v2.

D'où le format `PPP-NNNNNN` : trigramme du propriétaire (`BPM` en interne, le
code du fournisseur pour du matériel loué, `EXT` à défaut) puis l'id sur
6 chiffres. Voir `app/services/barcode.py`.

La réécriture se fait en **deux passes**. L'unicité de `barcode_uid` est portée
par un index unique non déférable, vérifié ligne à ligne pendant l'UPDATE : une
passe unique échoue dès qu'une référence existante occupe la valeur cible d'un
autre équipement, alors même que l'état final serait cohérent.

Revision ID: 0011_refs_qr_v1h
Revises: 0010_drop_local_auth
"""

import sqlalchemy as sa

from alembic import op

revision = "0011_refs_qr_v1h"
down_revision = "0010_drop_local_auth"
branch_labels = None
depends_on = None

_FORMAT_REFERENCE = r"^[A-Z]{3}-[0-9]{6}$"
_FORMAT_TRIGRAMME = r"^[A-Z]{3}$"


def upgrade() -> None:
    op.add_column("fournisseurs", sa.Column("code", sa.String(3), nullable=True))
    op.create_check_constraint(
        "ck_fournisseurs_code_format",
        "fournisseurs",
        f"code ~ '{_FORMAT_TRIGRAMME}'",
    )
    op.create_index(
        "ix_fournisseurs_code", "fournisseurs", ["code"], unique=True
    )

    # Passe 1 — valeurs transitoires dérivées de l'id, donc uniques, et hors du
    # format cible : aucun chevauchement possible avec la passe 2.
    op.execute("UPDATE equipments SET barcode_uid = '~' || id::text")

    # Passe 2 — format définitif. Un équipement sans location est interne ; avec
    # location, il prend le trigramme du fournisseur, ou EXT si celui-ci n'en a
    # pas encore (la colonne vient d'être créée, donc c'est le cas de tous).
    op.execute(
        """
        UPDATE equipments e SET barcode_uid =
            CASE WHEN loc.equipment_id IS NULL THEN 'BPM'
                 ELSE COALESCE(f.code, 'EXT') END
            || '-' || LPAD(e.id::text, 6, '0')
          FROM equipments el
          LEFT JOIN equipments_location loc ON loc.equipment_id = el.id
          LEFT JOIN fournisseurs f ON f.id = loc.fournisseur_id
         WHERE el.id = e.id
        """
    )

    op.alter_column(
        "equipments",
        "barcode_uid",
        type_=sa.String(10),
        existing_type=sa.String(64),
        existing_nullable=False,
    )
    op.create_check_constraint(
        "ck_equipments_barcode_uid_format",
        "equipments",
        f"barcode_uid ~ '{_FORMAT_REFERENCE}'",
    )


def downgrade() -> None:
    # Les anciennes références ne sont pas conservées : elles sont écrasées par
    # la passe 2 et rien n'en garde trace. Le downgrade ne peut donc que
    # relâcher les contraintes, en laissant les valeurs réécrites en place.
    op.drop_constraint("ck_equipments_barcode_uid_format", "equipments", type_="check")
    op.alter_column(
        "equipments",
        "barcode_uid",
        type_=sa.String(64),
        existing_type=sa.String(10),
        existing_nullable=False,
    )
    op.drop_index("ix_fournisseurs_code", table_name="fournisseurs")
    op.drop_constraint("ck_fournisseurs_code_format", "fournisseurs", type_="check")
    op.drop_column("fournisseurs", "code")
