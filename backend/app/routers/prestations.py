"""Routes prestations (M6) : CRUD, allocations, préparation terrain, clôture.

La création et la gestion des allocations sont *online-only* (cf. PLAN.md §1).
Le déroulé sortie/retour sur le terrain passe par la checklist offline et le
moteur de synchronisation (`POST /sync/batch`, type `presta_check`).
"""

from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.deps import CurrentUser, DbSession
from app.models import (
    AllocationPresta,
    Equipment,
    EquipmentConsommable,
    EquipmentLocation,
    EquipmentVrac,
    Fournisseur,
    Prestation,
    TicketReparation,
)
from app.models.enums import (
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
)
from app.schemas.prestation import (
    AllocationCreate,
    AllocationRead,
    ClotureIn,
    PrestationCreate,
    PrestationDetail,
    PrestationRead,
    PrestationUpdate,
)
from app.security.rbac import RequireStaff

router = APIRouter(prefix="/prestations", tags=["prestations"])


def _allocation_read(
    alloc: AllocationPresta, loc: tuple[int, str] | None = None
) -> AllocationRead:
    """`loc` = (fournisseur_id, fournisseur_nom) si l'équipement est loué, sinon None."""
    eq = alloc.equipment if "equipment" in alloc.__dict__ else None
    return AllocationRead(
        id=alloc.id,
        presta_id=alloc.presta_id,
        equipment_id=alloc.equipment_id,
        quantite=alloc.quantite,
        quantite_sortie=alloc.quantite_sortie,
        quantite_retournee=alloc.quantite_retournee,
        statut=alloc.statut,
        equipment_nom=eq.nom if eq is not None else None,
        equipment_barcode=eq.barcode_uid if eq is not None else None,
        equipment_externe=loc is not None,
        fournisseur_id=loc[0] if loc is not None else None,
        fournisseur_nom=loc[1] if loc is not None else None,
        equipment_contenant_id=eq.contenant_id if eq is not None else None,
    )


_DEPTH_GUARD = 32  # garde anti-boucle sur la descente de l'arbre des contenants


async def _standard_descendant_ids(db: DbSession, root_id: int) -> list[int]:
    """Ids des descendants *standard* (hors vrac/conso) d'un contenant.

    Parcours en largeur borné : on descend par tous les enfants mais on n'alloue
    que les items standard (un vrac/conso garde sa propre logique de quantité).
    """
    collected: list[int] = []
    frontier = [root_id]
    seen: set[int] = {root_id}
    for _ in range(_DEPTH_GUARD):
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
        vrac = {
            e
            for (e,) in (
                await db.execute(
                    select(EquipmentVrac.equipment_id).where(
                        EquipmentVrac.equipment_id.in_(child_ids)
                    )
                )
            ).all()
        }
        conso = {
            e
            for (e,) in (
                await db.execute(
                    select(EquipmentConsommable.equipment_id).where(
                        EquipmentConsommable.equipment_id.in_(child_ids)
                    )
                )
            ).all()
        }
        collected.extend(c for c in child_ids if c not in vrac and c not in conso)
        frontier = child_ids
    return collected


async def _descendant_ids(db: DbSession, root_id: int) -> list[int]:
    """Tous les descendants (toutes natures) d'un contenant.

    Sert à la suppression en cascade d'un flight : retirer la caisse retire aussi
    tout ce qu'elle contient (miroir de l'ajout `inclure_contenu`).
    """
    collected: list[int] = []
    frontier = [root_id]
    seen: set[int] = {root_id}
    for _ in range(_DEPTH_GUARD):
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


async def _location_map(db: DbSession) -> dict[int, tuple[int, str]]:
    """equipment_id → (fournisseur_id, fournisseur_nom) pour le matériel loué.

    Sert au filtre interne/location et au regroupement par prestataire côté UI.
    """
    rows = await db.execute(
        select(EquipmentLocation.equipment_id, Fournisseur.id, Fournisseur.nom).join(
            Fournisseur, Fournisseur.id == EquipmentLocation.fournisseur_id
        )
    )
    return {eid: (fid, fnom) for eid, fid, fnom in rows.all()}


async def _get_presta_or_404(db: DbSession, presta_id: int) -> Prestation:
    presta = await db.get(Prestation, presta_id)
    if presta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Prestation introuvable."
        )
    return presta


@router.get("", response_model=list[PrestationRead])
async def list_prestations(_user: CurrentUser, db: DbSession) -> list[Prestation]:
    # Chronologique : prestations datées d'abord (date_debut croissante), puis sans date.
    # Tri stable : date_debut, puis id.
    result = await db.scalars(
        select(Prestation).order_by(
            Prestation.date_debut.asc().nulls_last(), Prestation.id.asc()
        )
    )
    return list(result.all())


@router.post("", response_model=PrestationRead, status_code=status.HTTP_201_CREATED)
async def create_prestation(
    data: PrestationCreate,
    db: DbSession,
    _user: RequireStaff,
) -> Prestation:
    presta = Prestation(
        nom=data.nom,
        type=data.type,
        client_nom=data.client_nom,
        date_debut=data.date_debut,
        date_fin=data.date_fin,
        responsable_membre_id=data.responsable_membre_id,
        statut=StatutPrestation.EBAUCHE,
    )
    db.add(presta)
    await db.commit()
    await db.refresh(presta)
    return presta


@router.get("/{presta_id}", response_model=PrestationDetail)
async def get_prestation(
    presta_id: int, _user: CurrentUser, db: DbSession
) -> PrestationDetail:
    presta = await _get_presta_or_404(db, presta_id)
    allocs = await db.scalars(
        select(AllocationPresta)
        .where(AllocationPresta.presta_id == presta_id)
        .options(selectinload(AllocationPresta.equipment))
        .order_by(AllocationPresta.id)
    )
    loc_map = await _location_map(db)
    return PrestationDetail(
        **PrestationRead.model_validate(presta).model_dump(),
        allocations=[
            _allocation_read(a, loc_map.get(a.equipment_id)) for a in allocs.all()
        ],
    )


@router.patch("/{presta_id}", response_model=PrestationRead)
async def update_prestation(
    presta_id: int,
    data: PrestationUpdate,
    db: DbSession,
    _user: RequireStaff,
) -> Prestation:
    presta = await _get_presta_or_404(db, presta_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(presta, field, value)
    await db.commit()
    await db.refresh(presta)
    return presta


@router.delete("/{presta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prestation(
    presta_id: int,
    db: DbSession,
    _user: RequireStaff,
) -> None:
    presta = await _get_presta_or_404(db, presta_id)
    await db.execute(
        AllocationPresta.__table__.delete().where(
            AllocationPresta.presta_id == presta_id
        )
    )
    await db.delete(presta)
    await db.commit()


# --- Allocations -----------------------------------------------------------


@router.post(
    "/{presta_id}/allocations",
    response_model=AllocationRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_allocation(
    presta_id: int,
    data: AllocationCreate,
    db: DbSession,
    _user: RequireStaff,
) -> AllocationRead:
    await _get_presta_or_404(db, presta_id)
    equipment = await db.get(Equipment, data.equipment_id)
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )

    existing = await db.scalar(
        select(AllocationPresta).where(
            AllocationPresta.presta_id == presta_id,
            AllocationPresta.equipment_id == data.equipment_id,
        )
    )
    if existing is not None:
        existing.quantite = data.quantite
        alloc = existing
    else:
        alloc = AllocationPresta(
            presta_id=presta_id,
            equipment_id=data.equipment_id,
            quantite=data.quantite,
            statut=StatutAllocation.PLANIFIE,
        )
        db.add(alloc)

    # Contenant : on alloue aussi son contenu standard (les enfants suivent la caisse).
    if data.inclure_contenu:
        descendant_ids = await _standard_descendant_ids(db, data.equipment_id)
        if descendant_ids:
            already = {
                eid
                for (eid,) in (
                    await db.execute(
                        select(AllocationPresta.equipment_id).where(
                            AllocationPresta.presta_id == presta_id,
                            AllocationPresta.equipment_id.in_(descendant_ids),
                        )
                    )
                ).all()
            }
            for eid in descendant_ids:
                if eid not in already:
                    db.add(
                        AllocationPresta(
                            presta_id=presta_id,
                            equipment_id=eid,
                            quantite=1,
                            statut=StatutAllocation.PLANIFIE,
                        )
                    )

    await db.commit()
    await db.refresh(alloc, attribute_names=["equipment"])
    loc_row = (
        await db.execute(
            select(EquipmentLocation.equipment_id, Fournisseur.id, Fournisseur.nom)
            .join(Fournisseur, Fournisseur.id == EquipmentLocation.fournisseur_id)
            .where(EquipmentLocation.equipment_id == alloc.equipment_id)
        )
    ).first()
    loc = (loc_row[1], loc_row[2]) if loc_row is not None else None
    return _allocation_read(alloc, loc)


@router.delete(
    "/{presta_id}/allocations/{allocation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_allocation(
    presta_id: int,
    allocation_id: int,
    db: DbSession,
    _user: RequireStaff,
) -> None:
    alloc = await db.get(AllocationPresta, allocation_id)
    if alloc is None or alloc.presta_id != presta_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Allocation introuvable."
        )

    # Supprimer un flight retire aussi les allocations de tout son contenu, pour
    # ne jamais laisser d'items orphelins dans la prestation.
    descendant_ids = await _descendant_ids(db, alloc.equipment_id)
    if descendant_ids:
        await db.execute(
            AllocationPresta.__table__.delete().where(
                AllocationPresta.presta_id == presta_id,
                AllocationPresta.equipment_id.in_(descendant_ids),
            )
        )
    await db.delete(alloc)
    await db.commit()


# --- Clôture ---------------------------------------------------------------


@router.post("/{presta_id}/cloture", response_model=PrestationDetail)
async def cloturer_prestation(
    presta_id: int,
    data: ClotureIn,
    db: DbSession,
    user: RequireStaff,
) -> PrestationDetail:
    """Tranche les items non retournés et termine la prestation."""
    presta = await _get_presta_or_404(db, presta_id)
    allocs = list(
        (
            await db.scalars(
                select(AllocationPresta)
                .where(AllocationPresta.presta_id == presta_id)
                .options(selectinload(AllocationPresta.equipment))
            )
        ).all()
    )
    by_id = {a.id: a for a in allocs}

    for item in data.items:
        alloc = by_id.get(item.allocation_id)
        if alloc is None:
            continue
        equipment = alloc.equipment
        if item.decision == "retourne":
            alloc.quantite_retournee = alloc.quantite_sortie
            alloc.statut = StatutAllocation.RETOURNE
        elif item.decision == "perdu":
            alloc.statut = StatutAllocation.RETOURNE
            if equipment is not None:
                equipment.statut_actuel = StatutEquipment.PERDU
        elif item.decision == "casse":
            alloc.quantite_retournee = alloc.quantite_sortie
            alloc.statut = StatutAllocation.RETOURNE
            if equipment is not None:
                equipment.statut_actuel = StatutEquipment.EN_PANNE
                db.add(
                    TicketReparation(
                        uuid_client=uuid4(),
                        equipment_id=equipment.id,
                        declare_par_membre_id=user.id,
                        description_panne=f"Cassé / non rendu sur la presta « {presta.nom} ».",
                    )
                )
        # "ouvert" : on ne touche à rien, l'écart reste visible.

    presta.statut = StatutPrestation.TERMINEE
    await db.commit()

    refreshed = await db.scalars(
        select(AllocationPresta)
        .where(AllocationPresta.presta_id == presta_id)
        .options(selectinload(AllocationPresta.equipment))
        .order_by(AllocationPresta.id)
    )
    loc_map = await _location_map(db)
    return PrestationDetail(
        **PrestationRead.model_validate(presta).model_dump(),
        allocations=[
            _allocation_read(a, loc_map.get(a.equipment_id)) for a in refreshed.all()
        ],
    )
