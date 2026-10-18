"""Disponibilité d'une unité pour une prestation : seule source des règles,
partagée par l'ajout classique, l'ajout par modèle et la recherche du Parc.

Une unité n'est pas allouable si :
- elle est hors service ou sortie du parc (`STATUTS_BLOQUES`) ou archivée ;
- elle est déjà tenue par une autre prestation non clôturée dont la période
  chevauche celle-ci (allocation pas encore retournée).

Le chevauchement ne concerne que les prestations **datées des deux côtés** : une
prestation sans date ne bloque rien et n'est bloquée par rien. Une prestation
sans `date_fin` dure un jour (`date_debut`). Vrac et consommables ne sont pas
concernés (des quantités, pas des unités) : à l'appelant de ne passer que des
items unitaires à `occupations`.
"""

from collections.abc import Iterable
from datetime import date

from sqlalchemy import func, select

from app.deps import DbSession
from app.models import AllocationPresta, Equipment, Prestation
from app.models.enums import StatutAllocation, StatutEquipment, StatutPrestation

#: Statuts qui interdisent toute nouvelle allocation.
STATUTS_BLOQUES = frozenset(
    {
        StatutEquipment.EN_PANNE,
        StatutEquipment.EN_REPARATION,
        StatutEquipment.PERDU,
        StatutEquipment.REFORME,
    }
)
#: Statuts qui sortent l'unité du total d'un modèle (on ne la reverra pas).
STATUTS_HORS_PARC = frozenset({StatutEquipment.PERDU, StatutEquipment.REFORME})


def raison_blocage(eq: Equipment) -> str | None:
    """Pourquoi l'unité ne peut pas être allouée (statut / archive), sinon None."""
    if eq.archive:
        return "archivé"
    if eq.statut_actuel in STATUTS_BLOQUES:
        return eq.statut_actuel.replace("_", " ").lower()
    return None


def periode(presta: Prestation) -> tuple[date, date] | None:
    """Période [début, fin] d'une prestation, None si elle n'est pas datée."""
    if presta.date_debut is None:
        return None
    return presta.date_debut, presta.date_fin or presta.date_debut


async def occupations(
    db: DbSession, presta: Prestation, equipment_ids: Iterable[int]
) -> dict[int, tuple[int, str]]:
    """equipment_id → (presta_id, presta_nom) de la prestation qui le tient déjà
    sur une période qui chevauche celle de `presta`. Absent = libre."""
    ids = list(set(equipment_ids))
    bornes = periode(presta)
    if bornes is None or not ids:
        return {}
    debut, fin = bornes
    autre_fin = func.coalesce(Prestation.date_fin, Prestation.date_debut)
    rows = await db.execute(
        select(AllocationPresta.equipment_id, Prestation.id, Prestation.nom)
        .join(Prestation, Prestation.id == AllocationPresta.presta_id)
        .where(
            AllocationPresta.equipment_id.in_(ids),
            AllocationPresta.statut != StatutAllocation.RETOURNE,
            Prestation.id != presta.id,
            Prestation.statut != StatutPrestation.TERMINEE,
            Prestation.date_debut.is_not(None),
            Prestation.date_debut <= fin,
            autre_fin >= debut,
        )
        .order_by(Prestation.date_debut, Prestation.id)
    )
    result: dict[int, tuple[int, str]] = {}
    for eid, pid, nom in rows.all():
        result.setdefault(eid, (pid, nom))
    return result
