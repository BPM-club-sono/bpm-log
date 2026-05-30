"""Moteur de synchronisation offline : POST /sync/batch.

Rejoue les évènements créés hors-ligne dans l'ordre chronologique
(`offline_created_at`), de façon idempotente (clé `uuid_client`).
Chaque item est traité dans un savepoint : un item en conflit n'empêche
pas les autres d'être appliqués. Aucun item n'est « perdu » côté serveur :
il est soit appliqué, soit retourné dans `conflicts` pour arbitrage client.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models import (
    AllocationPresta,
    Equipment,
    LogScan,
    Prestation,
    TicketReparation,
)
from app.models.enums import StatutAllocation, StatutEquipment, TypeActionScan
from app.schemas.sync import SyncBatchIn, SyncBatchOut, SyncConflict, SyncItemIn

router = APIRouter(prefix="/sync", tags=["sync"])


class _Conflict(Exception):
    """Conflit métier : l'item ne peut pas être appliqué tel quel."""


async def _resolve_equipment(db: DbSession, payload: dict[str, Any]) -> Equipment:
    equipment: Equipment | None = None
    if (eid := payload.get("equipment_id")) is not None:
        equipment = await db.get(Equipment, int(eid))
    elif (code := payload.get("barcode_uid")) is not None:
        equipment = await db.scalar(
            select(Equipment).where(Equipment.barcode_uid == code)
        )
    if equipment is None:
        raise _Conflict("Équipement introuvable.")
    return equipment


async def _apply_ticket(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Crée un ticket de réparation et passe l'équipement En_Panne. Idempotent."""
    existing = await db.scalar(
        select(TicketReparation).where(
            TicketReparation.uuid_client == item.uuid_client
        )
    )
    if existing is not None:
        return False  # déjà appliqué (replay)

    equipment = await _resolve_equipment(db, item.payload)
    ticket = TicketReparation(
        uuid_client=item.uuid_client,
        equipment_id=equipment.id,
        declare_par_membre_id=membre_id,
        description_panne=item.payload.get("description_panne"),
        cout_estime=item.payload.get("cout_estime"),
        offline_created_at=item.offline_created_at,
    )
    db.add(ticket)
    if equipment.statut_actuel == StatutEquipment.FONCTIONNEL:
        equipment.statut_actuel = StatutEquipment.EN_PANNE
    return True


async def _apply_log_scan(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Enregistre un scan et applique son effet (statut / emplacement). Idempotent."""
    existing = await db.scalar(
        select(LogScan).where(LogScan.uuid_client == item.uuid_client)
    )
    if existing is not None:
        return False

    equipment = await _resolve_equipment(db, item.payload)
    raw_type = item.payload.get("type_action", TypeActionScan.CHANGEMENT_STATUT)
    try:
        type_action = TypeActionScan(raw_type)
    except ValueError as exc:
        raise _Conflict(f"type_action inconnu : {raw_type}") from exc

    dest_id = item.payload.get("emplacement_destination_id")
    log = LogScan(
        uuid_client=item.uuid_client,
        equipment_id=equipment.id,
        membre_id=membre_id,
        type_action=type_action,
        emplacement_destination_id=dest_id,
        offline_created_at=item.offline_created_at,
    )
    db.add(log)

    if type_action == TypeActionScan.CHANGEMENT_STATUT:
        raw_statut = item.payload.get("nouveau_statut")
        if raw_statut is not None:
            try:
                equipment.statut_actuel = StatutEquipment(raw_statut)
            except ValueError as exc:
                raise _Conflict(f"statut inconnu : {raw_statut}") from exc
    if dest_id is not None:
        equipment.emplacement_id = int(dest_id)
    return True


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))


def _recompute_allocation_statut(alloc: AllocationPresta) -> None:
    if alloc.quantite_sortie == 0:
        alloc.statut = StatutAllocation.PLANIFIE
    elif alloc.quantite_retournee >= alloc.quantite_sortie:
        alloc.statut = StatutAllocation.RETOURNE
    else:
        alloc.statut = StatutAllocation.SORTI


async def _apply_presta_check(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Applique un delta sortie/retour sur une allocation. Idempotent par uuid_client.

    Un scan sortie sur un item non alloué crée une allocation ad-hoc (quantité 1).
    Chaque évènement est tracé dans `logs_scans` (clé uuid_client) pour le dédoublonnage.
    """
    existing = await db.scalar(
        select(LogScan).where(LogScan.uuid_client == item.uuid_client)
    )
    if existing is not None:
        return False

    payload = item.payload
    presta_id = payload.get("presta_id")
    if presta_id is None:
        raise _Conflict("presta_id manquant.")
    presta = await db.get(Prestation, int(presta_id))
    if presta is None:
        raise _Conflict("Prestation introuvable.")

    equipment = await _resolve_equipment(db, payload)
    sens = payload.get("sens")
    if sens not in ("sortie", "retour"):
        raise _Conflict(f"sens invalide : {sens}")
    try:
        delta = int(payload.get("delta", 0))
    except (TypeError, ValueError) as exc:
        raise _Conflict("delta invalide.") from exc

    alloc = await db.scalar(
        select(AllocationPresta).where(
            AllocationPresta.presta_id == presta.id,
            AllocationPresta.equipment_id == equipment.id,
        )
    )
    if alloc is None:
        if sens != "sortie" or delta <= 0:
            raise _Conflict("Aucune ligne à retourner pour cet équipement.")
        alloc = AllocationPresta(
            presta_id=presta.id,
            equipment_id=equipment.id,
            quantite=1,
            statut=StatutAllocation.PLANIFIE,
        )
        db.add(alloc)
        await db.flush()

    if sens == "sortie":
        alloc.quantite_sortie = _clamp(
            alloc.quantite_sortie + delta, 0, alloc.quantite
        )
    else:
        alloc.quantite_retournee = _clamp(
            alloc.quantite_retournee + delta, 0, alloc.quantite_sortie
        )
    _recompute_allocation_statut(alloc)

    db.add(
        LogScan(
            uuid_client=item.uuid_client,
            equipment_id=equipment.id,
            membre_id=membre_id,
            type_action=(
                TypeActionScan.SCAN_SORTIE
                if sens == "sortie"
                else TypeActionScan.SCAN_ENTREE
            ),
            offline_created_at=item.offline_created_at,
        )
    )
    return True


_HANDLERS = {
    "ticket_reparation": _apply_ticket,
    "log_scan": _apply_log_scan,
    "presta_check": _apply_presta_check,
}


@router.post("/batch", response_model=SyncBatchOut)
async def sync_batch(
    batch: SyncBatchIn,
    user: CurrentUser,
    db: DbSession,
) -> SyncBatchOut:
    """Rejoue un lot d'évènements offline, triés par `offline_created_at`."""
    applied: list[UUID] = []
    conflicts: list[SyncConflict] = []

    ordered = sorted(batch.items, key=lambda i: i.offline_created_at or datetime.min)

    for item in ordered:
        handler = _HANDLERS[item.type]
        try:
            async with db.begin_nested():
                await handler(db, item, user.id)
            applied.append(item.uuid_client)
        except _Conflict as exc:
            conflicts.append(SyncConflict(uuid_client=item.uuid_client, reason=str(exc)))
        except Exception as exc:  # noqa: BLE001 - on ne perd jamais un item
            conflicts.append(
                SyncConflict(
                    uuid_client=item.uuid_client,
                    reason=f"Erreur serveur : {exc.__class__.__name__}",
                )
            )

    await db.commit()
    return SyncBatchOut(applied=applied, conflicts=conflicts)
