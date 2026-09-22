"""Statut d'une prestation : projection du pointage, jamais une saisie manuelle.

`Ebauche` → `En_preparation` dès le premier élément sorti → `En_cours` quand tout
le matériel prévu est sorti. `Terminee` est terminal : seule la clôture le pose,
seule la réouverture l'enlève.

Le statut est **recalculé** depuis les quantités, pas incrémenté au fil des
évènements : comme les deltas de pointage arrivent dans un ordre quelconque au
rejeu offline, seule une règle dérivée donne toujours le même résultat final.
"""

from sqlalchemy import func, select

from app.deps import DbSession
from app.models import AllocationPresta, Prestation
from app.models.enums import StatutPrestation


async def statut_derive(db: DbSession, presta_id: int) -> StatutPrestation:
    """Statut déduit des quantités prévues / sorties des allocations."""
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(AllocationPresta.quantite), 0),
                func.coalesce(func.sum(AllocationPresta.quantite_sortie), 0),
            ).where(AllocationPresta.presta_id == presta_id)
        )
    ).one()
    prevu, sorti = int(row[0]), int(row[1])
    if sorti <= 0:
        return StatutPrestation.EBAUCHE
    if prevu > 0 and sorti >= prevu:
        return StatutPrestation.EN_COURS
    return StatutPrestation.EN_PREPARATION


async def recalculer_statut(db: DbSession, presta: Prestation) -> None:
    """Réaligne le statut sur le pointage. Ne commit pas (l'appelant possède la
    transaction). Sans effet sur une prestation clôturée."""
    if presta.statut == StatutPrestation.TERMINEE:
        return
    # Les quantités modifiées par l'appelant doivent être visibles de l'agrégat.
    await db.flush()
    presta.statut = await statut_derive(db, presta.id)
