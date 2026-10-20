"""Arbre des catégories : ancêtres, descendants et chemins via la vue récursive
`categories_lignee` (fermeture transitive, distance 0 = la catégorie elle-même)."""

from sqlalchemy import Integer, column, select, table

from app.deps import DbSession
from app.models import Categorie
from app.services.erreurs import introuvable, invalide

#: Vue SQL (migration 0015) : hors `Base.metadata`, l'autogenerate ne la voit pas.
lignee = table(
    "categories_lignee",
    column("categorie_id", Integer),
    column("ancetre_id", Integer),
    column("distance", Integer),
)

SEPARATEUR = " › "


def ids_descendants(categorie_id: int):
    """Sous-requête : la catégorie et toutes ses descendantes."""
    return select(lignee.c.categorie_id).where(lignee.c.ancetre_id == categorie_id)


async def ancetres(db: DbSession, categorie_id: int) -> list[Categorie]:
    """La catégorie et ses ancêtres, de la racine à elle-même."""
    stmt = (
        select(Categorie)
        .join(lignee, lignee.c.ancetre_id == Categorie.id)
        .where(lignee.c.categorie_id == categorie_id)
        .order_by(lignee.c.distance.desc())
    )
    return list((await db.scalars(stmt)).all())


async def chemins(db: DbSession) -> dict[int, str]:
    """Chemin complet de chaque catégorie (« Son › Ampli »)."""
    rows = await db.execute(
        select(lignee.c.categorie_id, Categorie.nom)
        .join(Categorie, Categorie.id == lignee.c.ancetre_id)
        .order_by(lignee.c.categorie_id, lignee.c.distance.desc())
    )
    parts: dict[int, list[str]] = {}
    for categorie_id, nom in rows.all():
        parts.setdefault(categorie_id, []).append(nom)
    return {cid: SEPARATEUR.join(noms) for cid, noms in parts.items()}


async def chemin(db: DbSession, categorie_id: int | None) -> str | None:
    if categorie_id is None:
        return None
    return SEPARATEUR.join(c.nom for c in await ancetres(db, categorie_id)) or None


async def verifier_parent(db: DbSession, categorie_id: int | None, parent_id: int | None) -> None:
    """404 si le parent n'existe pas ; 422 s'il est la catégorie ou l'une de ses
    descendantes (l'arbre deviendrait un cycle)."""
    if parent_id is None:
        return
    if await db.get(Categorie, parent_id) is None:
        raise introuvable("Catégorie parente introuvable.")
    if categorie_id is None:
        return
    if parent_id in set((await db.scalars(ids_descendants(categorie_id))).all()):
        raise invalide("Une catégorie ne peut pas être rangée dans elle-même ou ses enfants.")
