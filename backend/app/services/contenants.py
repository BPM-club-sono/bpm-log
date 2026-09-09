"""Parcours de l'arbre des contenants (flights).

Les contenants forment une liste d'adjacence (`Equipment.contenant_id`). Plusieurs
domaines ont besoin de descendre cet arbre — retirer un flight d'une prestation,
archiver un flight avec tout son contenu — d'où ce helper partagé.
"""

from sqlalchemy import select

from app.deps import DbSession
from app.models import Equipment

DEPTH_GUARD = 32  # garde anti-boucle sur la descente de l'arbre des contenants


async def descendant_ids(db: DbSession, root_id: int) -> list[int]:
    """Tous les descendants (toutes natures) d'un contenant, `root_id` exclu."""
    collected: list[int] = []
    frontier = [root_id]
    seen: set[int] = {root_id}
    for _ in range(DEPTH_GUARD):
        if not frontier:
            break
        child_ids = [
            cid
            for (cid,) in (
                await db.execute(
                    select(Equipment.id).where(Equipment.contenant_id.in_(frontier))
                )
            ).all()
            if cid not in seen
        ]
        if not child_ids:
            break
        seen.update(child_ids)
        collected.extend(child_ids)
        frontier = child_ids
    return collected
