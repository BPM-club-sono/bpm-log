"""Catégories en arbre : `categories.parent_id` remplace `sous_categories`.

Chaque sous-catégorie devient une catégorie enfant de sa catégorie ; les modèles,
équipements et champs de spécification qui la référençaient pointent désormais vers
cette catégorie enfant (les valeurs saisies restent donc applicables). Une catégorie
hérite des champs de tous ses ancêtres, résolus par la vue récursive
`categories_lignee` (fermeture transitive, distance 0 = la catégorie elle-même).

Revision ID: 0015_categories_arbre
Revises: 0014_specifications
"""

import sqlalchemy as sa

from alembic import op

revision = "0015_categories_arbre"
down_revision = "0014_specifications"
branch_labels = None
depends_on = None

_TABLES_SOUS_CAT = ("champs_specification", "modeles", "equipments")

_VUE_LIGNEE = """
CREATE VIEW categories_lignee AS
WITH RECURSIVE lignee(categorie_id, ancetre_id, distance) AS (
    SELECT id, id, 0 FROM categories
    UNION ALL
    SELECT l.categorie_id, c.parent_id, l.distance + 1
    FROM lignee l
    JOIN categories c ON c.id = l.ancetre_id
    WHERE c.parent_id IS NOT NULL
)
SELECT categorie_id, ancetre_id, distance FROM lignee
"""


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
    )
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])
    op.create_check_constraint("ck_categories_parent", "categories", "parent_id <> id")

    # Sous-catégorie -> catégorie enfant. (categorie_id, nom) est unique dans
    # sous_categories, ce qui permet de retrouver la correspondance par jointure.
    op.execute("CREATE TEMPORARY TABLE _sc_map (sc_id integer, cat_id integer) ON COMMIT DROP")
    op.execute(
        """
        WITH crees AS (
            INSERT INTO categories (nom, parent_id)
            SELECT nom, categorie_id FROM sous_categories ORDER BY id
            RETURNING id, nom, parent_id
        )
        INSERT INTO _sc_map (sc_id, cat_id)
        SELECT sc.id, crees.id
        FROM sous_categories sc
        JOIN crees ON crees.parent_id = sc.categorie_id AND crees.nom = sc.nom
        """
    )
    for table in _TABLES_SOUS_CAT:
        op.execute(
            f"""
            UPDATE {table} t SET categorie_id = m.cat_id
            FROM _sc_map m WHERE t.sous_categorie_id = m.sc_id
            """
        )
        op.drop_column(table, "sous_categorie_id")
    op.drop_table("sous_categories")

    op.create_unique_constraint(
        "uq_categories_parent_id_nom",
        "categories",
        ["parent_id", "nom"],
        postgresql_nulls_not_distinct=True,
    )
    op.execute(_VUE_LIGNEE)


def downgrade() -> None:
    profonde = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM categories_lignee WHERE distance >= 2")
    )
    if profonde:
        raise RuntimeError(
            "Downgrade impossible : des catégories ont plus d'un niveau de parents."
        )
    op.execute("DROP VIEW categories_lignee")
    op.drop_constraint("uq_categories_parent_id_nom", "categories", type_="unique")

    op.create_table(
        "sous_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("categorie_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.UniqueConstraint("categorie_id", "nom"),
    )
    for table in _TABLES_SOUS_CAT:
        op.add_column(
            table,
            sa.Column("sous_categorie_id", sa.Integer(), sa.ForeignKey("sous_categories.id")),
        )

    # Catégorie enfant -> sous-catégorie (même id, pour garder la correspondance simple).
    op.execute(
        """
        INSERT INTO sous_categories (id, nom, categorie_id)
        SELECT id, nom, parent_id FROM categories WHERE parent_id IS NOT NULL
        """
    )
    op.execute(
        "SELECT setval(pg_get_serial_sequence('sous_categories', 'id'), "
        "COALESCE((SELECT max(id) FROM sous_categories), 0) + 1, false)"
    )
    for table in _TABLES_SOUS_CAT:
        op.execute(
            f"""
            UPDATE {table} t SET sous_categorie_id = c.id, categorie_id = c.parent_id
            FROM categories c WHERE t.categorie_id = c.id AND c.parent_id IS NOT NULL
            """
        )
    op.execute("DELETE FROM categories WHERE parent_id IS NOT NULL")

    op.drop_constraint("ck_categories_parent", "categories", type_="check")
    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_column("categories", "parent_id")
