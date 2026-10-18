"""Numérotation des créations en série : « MH 7 », « MH 8 », « MH 9 »…

Un nom de série est exactement `f"{base} {n}"` (n entier, chiffres seulement).
Le numéro suivant est 1 + le plus grand n déjà pris, **archivés compris** (un nom
archivé ne doit pas être réattribué). La lecture et la création doivent être
sérialisées par base (verrou consultatif jusqu'au commit), sinon deux créations
simultanées prendraient les mêmes numéros.
"""

from collections.abc import Iterable

from sqlalchemy import select, text

from app.deps import DbSession
from app.models import Equipment

#: Clé de `pg_advisory_xact_lock` réservée à la numérotation (2e clé = hash de la base).
_VERROU_SERIE = 4202


def prochain_numero(noms: Iterable[str], base: str) -> int:
    """1 + max des n pour les noms exactement `f"{base} {n}"`, 1 si aucun."""
    prefixe = f"{base} "
    maxi = 0
    for nom in noms:
        suffixe = nom[len(prefixe) :] if nom.startswith(prefixe) else ""
        if suffixe.isascii() and suffixe.isdigit():
            maxi = max(maxi, int(suffixe))
    return maxi + 1


async def noms_serie(db: DbSession, base: str, nombre: int) -> list[str]:
    """Les `nombre` prochains noms libres pour `base` (verrou pris jusqu'au commit)."""
    base = base.strip()
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:k, hashtext(:base))"),
        {"k": _VERROU_SERIE, "base": base},
    )
    noms = (
        await db.scalars(
            select(Equipment.nom).where(Equipment.nom.startswith(base + " ", autoescape=True))
        )
    ).all()
    debut = prochain_numero(noms, base)
    return [f"{base} {k}" for k in range(debut, debut + nombre)]
