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
    EquipmentConsommable,
    EquipmentLocation,
    EquipmentVrac,
    InventaireVrac,
    LogScan,
    Prestation,
    TicketReparation,
)
from app.models.enums import RoleMembre, StatutAllocation, StatutEquipment, TypeActionScan
from app.schemas.sync import SyncBatchIn, SyncBatchOut, SyncConflict, SyncItemIn
from app.services.push import notify_role

router = APIRouter(prefix="/sync", tags=["sync"])

# Mots-clés déclenchant une alerte push aux membres Tech.
_URGENCE_KEYWORDS = (
    "urgent",
    "urgence",
    "critique",
    "danger",
    "securite",
    "s\u00e9curit\u00e9",
    "incendie",
    "feu",
)


def _is_urgent(description: str | None) -> bool:
    if not description:
        return False
    texte = description.lower()
    return any(mot in texte for mot in _URGENCE_KEYWORDS)


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
    contexte: str | None = None
    if type_action == TypeActionScan.CHANGEMENT_STATUT:
        raw_statut = item.payload.get("nouveau_statut")
        if raw_statut is not None:
            contexte = f"→ {str(raw_statut).replace('_', ' ')}"
    log = LogScan(
        uuid_client=item.uuid_client,
        equipment_id=equipment.id,
        membre_id=membre_id,
        type_action=type_action,
        contexte=contexte,
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

    # Matériel de location entièrement rendu : on l'archive (trace conservée, masqué du Parc).
    if (
        sens == "retour"
        and alloc.quantite_sortie > 0
        and alloc.quantite_retournee >= alloc.quantite_sortie
    ):
        location = await db.get(EquipmentLocation, equipment.id)
        if location is not None:
            equipment.archive = True

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
            contexte=presta.nom,
            offline_created_at=item.offline_created_at,
        )
    )
    return True


async def _apply_vrac_delta(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Enregistre un delta unitaire d'inventaire vrac (append-only). Idempotent.

    La quantité courante d'une caisse n'est jamais stockée en valeur absolue :
    c'est `quantite_theorique + Σ deltas`. Les deltas sont commutatifs, donc
    l'ordre d'arrivée n'a aucune importance (scénario C du plan).
    """
    existing = await db.scalar(
        select(LogScan).where(LogScan.uuid_client == item.uuid_client)
    )
    if existing is not None:
        return False

    equipment = await _resolve_equipment(db, item.payload)
    vrac = await db.get(EquipmentVrac, equipment.id)
    if vrac is None:
        raise _Conflict("Cet équipement n'est pas une caisse vrac.")

    try:
        delta = int(item.payload.get("delta", 0))
    except (TypeError, ValueError) as exc:
        raise _Conflict("delta invalide.") from exc
    if delta == 0:
        raise _Conflict("delta nul.")

    presta_id = item.payload.get("presta_id")
    db.add(
        InventaireVrac(
            equipment_id=equipment.id,
            membre_id=membre_id,
            delta=delta,
            presta_id=int(presta_id) if presta_id is not None else None,
            note=item.payload.get("note"),
            date=item.offline_created_at,
        )
    )
    db.add(
        LogScan(
            uuid_client=item.uuid_client,
            equipment_id=equipment.id,
            membre_id=membre_id,
            type_action=TypeActionScan.INVENTAIRE_VRAC,
            offline_created_at=item.offline_created_at,
        )
    )
    return True


async def _apply_conso_delta(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Applique un réappro / une consommation sur le stock d'un consommable. Idempotent.

    `stock_actuel` est borné à 0. Le dédoublonnage passe par `logs_scans`
    (clé `uuid_client`) pour ne jamais appliquer deux fois le même delta.
    """
    existing = await db.scalar(
        select(LogScan).where(LogScan.uuid_client == item.uuid_client)
    )
    if existing is not None:
        return False

    equipment = await _resolve_equipment(db, item.payload)
    conso = await db.get(EquipmentConsommable, equipment.id)
    if conso is None:
        raise _Conflict("Cet équipement n'est pas un consommable.")

    try:
        delta = int(item.payload.get("delta", 0))
    except (TypeError, ValueError) as exc:
        raise _Conflict("delta invalide.") from exc
    if delta == 0:
        raise _Conflict("delta nul.")

    conso.stock_actuel = max(0, conso.stock_actuel + delta)
    db.add(
        LogScan(
            uuid_client=item.uuid_client,
            equipment_id=equipment.id,
            membre_id=membre_id,
            type_action=TypeActionScan.CHANGEMENT_STATUT,
            offline_created_at=item.offline_created_at,
        )
    )
    return True


_DEPTH_GUARD = 32  # garde anti-boucle sur la remontée de l'arbre des contenants


async def _ensure_no_cycle(db: DbSession, item_id: int, new_parent_id: int) -> None:
    """Lève `_Conflict` si ranger `item_id` dans `new_parent_id` crée une boucle."""
    if new_parent_id == item_id:
        raise _Conflict("Un contenant ne peut pas se contenir lui-même.")
    current: int | None = new_parent_id
    seen: set[int] = set()
    for _ in range(_DEPTH_GUARD):
        if current is None:
            return
        if current == item_id:
            raise _Conflict("Déplacement impossible : cela créerait une boucle de contenants.")
        if current in seen:
            return
        seen.add(current)
        parent = await db.get(Equipment, current)
        if parent is None:
            return
        current = parent.contenant_id


async def _apply_deplacement(
    db: DbSession, item: SyncItemIn, membre_id: int
) -> bool:
    """Déplace un équipement vers un contenant OU un emplacement fixe. Idempotent.

    Re-parente la racine uniquement : le contenu suit par dérivation (la localisation
    effective d'un item se calcule en remontant l'arbre). Un seul champ change, donc
    l'opération est commutative-safe et déterministe par `offline_created_at`.
    Les deux cibles sont exclusives (règle de frontière).
    """
    existing = await db.scalar(
        select(LogScan).where(LogScan.uuid_client == item.uuid_client)
    )
    if existing is not None:
        return False

    equipment = await _resolve_equipment(db, item.payload)
    contenant_dest = item.payload.get("contenant_destination_id")
    emplacement_dest = item.payload.get("emplacement_destination_id")

    if contenant_dest is not None:
        cid = int(contenant_dest)
        contenant = await db.get(Equipment, cid)
        if contenant is None:
            raise _Conflict("Contenant de destination introuvable.")
        await _ensure_no_cycle(db, equipment.id, cid)
        equipment.contenant_id = cid
        equipment.emplacement_id = None
        contexte = f"Rangé dans {contenant.nom}"
        dest_emplacement_id = None
    elif emplacement_dest is not None:
        eid = int(emplacement_dest)
        equipment.emplacement_id = eid
        equipment.contenant_id = None
        contexte = "Déplacé"
        dest_emplacement_id = eid
    else:
        raise _Conflict("Destination de déplacement manquante.")

    db.add(
        LogScan(
            uuid_client=item.uuid_client,
            equipment_id=equipment.id,
            membre_id=membre_id,
            type_action=TypeActionScan.CHANGEMENT_STATUT,
            contexte=contexte,
            emplacement_destination_id=dest_emplacement_id,
            offline_created_at=item.offline_created_at,
        )
    )
    return True


_HANDLERS = {
    "ticket_reparation": _apply_ticket,
    "log_scan": _apply_log_scan,
    "presta_check": _apply_presta_check,
    "vrac_delta": _apply_vrac_delta,
    "conso_delta": _apply_conso_delta,
    "deplacement": _apply_deplacement,
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
    urgent_equipment_ids: list[int] = []

    ordered = sorted(batch.items, key=lambda i: i.offline_created_at or datetime.min)

    for item in ordered:
        handler = _HANDLERS[item.type]
        try:
            async with db.begin_nested():
                created = await handler(db, item, user.id)
            applied.append(item.uuid_client)
            if (
                created
                and item.type == "ticket_reparation"
                and _is_urgent(item.payload.get("description_panne"))
            ):
                eid = item.payload.get("equipment_id")
                if eid is not None:
                    urgent_equipment_ids.append(int(eid))
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
    await _notify_urgent_tickets(db, urgent_equipment_ids)
    return SyncBatchOut(applied=applied, conflicts=conflicts)


async def _notify_urgent_tickets(db: DbSession, equipment_ids: list[int]) -> None:
    """Alerte les membres Tech après synchronisation d'un ticket urgent."""
    for equipment_id in equipment_ids:
        equipment = await db.get(Equipment, equipment_id)
        nom = equipment.nom if equipment else "un équipement"
        await notify_role(
            db,
            RoleMembre.TECH,
            title="Panne urgente signalée",
            body=f"« {nom} » nécessite une intervention rapide.",
            url="/pannes",
            tag=f"ticket-urgent-{equipment_id}",
        )
