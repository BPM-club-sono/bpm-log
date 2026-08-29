"""Attribution des références matériel.

Séparé de `app.services.barcode`, qui reste sans dépendance (le modèle ORM y
puise le format de sa contrainte CHECK, donc l'importer depuis la couche
données ne doit rien entraîner). Ici on touche la base.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Equipment
from app.services import barcode

#: Sauts tolérés dans la séquence quand une référence personnalisée occupe déjà
#: le code d'un id non encore attribué.
MAX_ESSAIS = 50

_NEXTVAL = sa.select(
    sa.func.nextval(sa.text("pg_get_serial_sequence('equipments','id')"))
)


class ReferenceIndisponible(RuntimeError):
    """Aucune référence libre n'a pu être attribuée."""


class NumerotationEpuisee(RuntimeError):
    """La séquence dépasse ce qu'un numéro à 6 chiffres peut porter."""


async def reserver(db: AsyncSession, prefixe: str) -> tuple[int, str]:
    """Réserve un id et compose sa référence, en sautant les codes déjà pris.

    L'id est tiré de la séquence *avant* l'INSERT, pour que la référence
    définitive soit connue d'emblée — sinon il faudrait écrire un placeholder en
    base, ce que la contrainte de format interdit désormais.

    Une référence personnalisée saisie à la main peut occuper le code d'un id
    encore non attribué ; on saute alors le numéro, ce qui transforme une
    violation d'unicité en 500 en un simple trou dans la numérotation.
    """
    for _ in range(MAX_ESSAIS):
        eq_id = await db.scalar(_NEXTVAL)
        if eq_id is None or eq_id > barcode.NUMERO_MAX:
            raise NumerotationEpuisee(
                f"Le numéro {eq_id} dépasse le maximum de {barcode.NUMERO_MAX}."
            )
        code = barcode.construire(prefixe, int(eq_id))
        deja_pris = await db.scalar(
            sa.select(Equipment.id).where(Equipment.barcode_uid == code)
        )
        if deja_pris is None:
            return int(eq_id), code
    raise ReferenceIndisponible(
        f"Aucune référence libre après {MAX_ESSAIS} essais sur le préfixe {prefixe}."
    )
