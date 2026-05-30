"""Routes inventaire : consommables et caisses vrac (lecture + verrous). M7.

Les **deltas** d'inventaire et de réappro passent par le moteur de
synchronisation offline (`POST /sync/batch`, types `vrac_delta` / `conso_delta`).
Ces routes-ci servent la lecture (stocks, quantités constatées, historique) et
la gestion des verrous d'inventaire (online requis).
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession
from app.models import (
    Equipment,
    EquipmentConsommable,
    EquipmentVrac,
    InventaireVrac,
    InventoryLock,
    Membre,
)
from app.models.enums import RoleMembre
from app.schemas.inventory import (
    ConsommableRead,
    InventaireEntry,
    LockResult,
    VracDetail,
    VracLock,
    VracRead,
)

router = APIRouter(tags=["inventaire"])

LOCK_TTL = timedelta(hours=2)


# --------------------------------------------------------------------------- #
# Consommables
# --------------------------------------------------------------------------- #
@router.get("/consommables", response_model=list[ConsommableRead])
async def list_consommables(_user: CurrentUser, db: DbSession) -> list[ConsommableRead]:
    """Liste les consommables avec leur stock courant et alerte de seuil."""
    rows = (
        await db.execute(
            select(EquipmentConsommable, Equipment)
            .join(Equipment, Equipment.id == EquipmentConsommable.equipment_id)
            .order_by(Equipment.nom)
        )
    ).all()
    return [
        ConsommableRead(
            equipment_id=conso.equipment_id,
            nom=eq.nom,
            barcode_uid=eq.barcode_uid,
            stock_actuel=conso.stock_actuel,
            seuil_alerte=conso.seuil_alerte,
            unite=conso.unite,
            en_alerte=conso.stock_actuel <= conso.seuil_alerte,
        )
        for conso, eq in rows
    ]


# --------------------------------------------------------------------------- #
# Vrac
# --------------------------------------------------------------------------- #
async def _sum_deltas(db: DbSession, equipment_id: int) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(InventaireVrac.delta), 0)).where(
            InventaireVrac.equipment_id == equipment_id
        )
    )
    return int(total or 0)


def _lock_view(lock: InventoryLock | None, nom: str | None, membre_id: int) -> VracLock | None:
    now = datetime.now(timezone.utc)
    if lock is None or lock.expires_at <= now:
        return None
    return VracLock(
        membre_id=lock.membre_id,
        membre_nom=nom,
        expires_at=lock.expires_at,
        is_mine=lock.membre_id == membre_id,
    )


@router.get("/vrac", response_model=list[VracRead])
async def list_vrac(user: CurrentUser, db: DbSession) -> list[VracRead]:
    """Liste les caisses vrac avec quantité théorique, constatée et verrou éventuel."""
    rows = (
        await db.execute(
            select(EquipmentVrac, Equipment)
            .join(Equipment, Equipment.id == EquipmentVrac.equipment_id)
            .order_by(Equipment.nom)
        )
    ).all()

    out: list[VracRead] = []
    for vrac, eq in rows:
        delta = await _sum_deltas(db, vrac.equipment_id)
        actuelle = vrac.quantite_theorique + delta
        lock = await db.get(InventoryLock, vrac.equipment_id)
        nom = None
        if lock is not None:
            membre = await db.get(Membre, lock.membre_id)
            nom = _membre_nom(membre)
        out.append(
            VracRead(
                equipment_id=vrac.equipment_id,
                nom=eq.nom,
                barcode_uid=eq.barcode_uid,
                quantite_theorique=vrac.quantite_theorique,
                quantite_actuelle=actuelle,
                ecart=delta,
                lock=_lock_view(lock, nom, user.id),
            )
        )
    return out


def _membre_nom(membre: Membre | None) -> str | None:
    if membre is None:
        return None
    parts = [p for p in (membre.prenom, membre.nom) if p]
    return " ".join(parts) or membre.email


async def _get_vrac_or_404(db: DbSession, equipment_id: int) -> tuple[EquipmentVrac, Equipment]:
    vrac = await db.get(EquipmentVrac, equipment_id)
    eq = await db.get(Equipment, equipment_id)
    if vrac is None or eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caisse vrac introuvable.",
        )
    return vrac, eq


@router.get("/vrac/{equipment_id}", response_model=VracDetail)
async def get_vrac(equipment_id: int, user: CurrentUser, db: DbSession) -> VracDetail:
    """Détail d'une caisse : quantité constatée, verrou, historique des deltas."""
    vrac, eq = await _get_vrac_or_404(db, equipment_id)
    delta = await _sum_deltas(db, equipment_id)

    lock = await db.get(InventoryLock, equipment_id)
    lock_nom = _membre_nom(await db.get(Membre, lock.membre_id)) if lock else None

    rows = (
        await db.execute(
            select(InventaireVrac, Membre)
            .join(Membre, Membre.id == InventaireVrac.membre_id)
            .where(InventaireVrac.equipment_id == equipment_id)
            .order_by(InventaireVrac.date.desc(), InventaireVrac.id.desc())
        )
    ).all()
    historique = [
        InventaireEntry(
            id=inv.id,
            membre_id=inv.membre_id,
            membre_nom=_membre_nom(membre),
            delta=inv.delta,
            note=inv.note,
            presta_id=inv.presta_id,
            date=inv.date,
        )
        for inv, membre in rows
    ]

    return VracDetail(
        equipment_id=equipment_id,
        nom=eq.nom,
        barcode_uid=eq.barcode_uid,
        quantite_theorique=vrac.quantite_theorique,
        quantite_actuelle=vrac.quantite_theorique + delta,
        ecart=delta,
        lock=_lock_view(lock, lock_nom, user.id),
        historique=historique,
    )


@router.post("/vrac/{equipment_id}/lock", response_model=LockResult)
async def acquire_lock(equipment_id: int, user: CurrentUser, db: DbSession) -> LockResult:
    """Pose (ou prolonge) le verrou d'inventaire d'une caisse. Online requis."""
    await _get_vrac_or_404(db, equipment_id)
    now = datetime.now(timezone.utc)
    expires = now + LOCK_TTL

    lock = await db.get(InventoryLock, equipment_id)
    if lock is None:
        db.add(
            InventoryLock(
                equipment_id=equipment_id,
                membre_id=user.id,
                acquired_at=now,
                expires_at=expires,
            )
        )
    elif lock.membre_id == user.id or lock.expires_at <= now:
        # Le mien : on prolonge. Expiré : on s'en empare.
        lock.membre_id = user.id
        lock.acquired_at = now
        lock.expires_at = expires
    else:
        membre = await db.get(Membre, lock.membre_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Inventaire déjà en cours par {_membre_nom(membre) or 'un autre membre'}.",
        )

    await db.commit()
    return LockResult(equipment_id=equipment_id, expires_at=expires)


@router.delete("/vrac/{equipment_id}/lock", status_code=status.HTTP_204_NO_CONTENT)
async def release_lock(equipment_id: int, user: CurrentUser, db: DbSession) -> None:
    """Libère le verrou (titulaire ou admin uniquement)."""
    lock = await db.get(InventoryLock, equipment_id)
    if lock is None:
        return
    if lock.membre_id != user.id and user.role != RoleMembre.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seul le titulaire du verrou peut le libérer.",
        )
    await db.delete(lock)
    await db.commit()
