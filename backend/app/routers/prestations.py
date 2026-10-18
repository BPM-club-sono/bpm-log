"""Routes prestations (M6) : CRUD, allocations, préparation terrain, clôture.

La création et la gestion des allocations sont *online-only* (cf. docs/plan-initial.md §1).
Le déroulé sortie/retour sur le terrain passe par la checklist offline et le
moteur de synchronisation (`POST /sync/batch`, type `presta_check`).
"""

from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.deps import CurrentUser, DbSession
from app.models import (
    AllocationPresta,
    Equipment,
    EquipmentConsommable,
    EquipmentLocation,
    EquipmentVrac,
    Fournisseur,
    LogScan,
    Modele,
    Prestation,
    TicketReparation,
)
from app.models.enums import (
    DecisionCloture,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypeActionScan,
)
from app.routers.equipment import creer_equipements, effacer_photos, lire_donnees, lire_photo
from app.schemas.equipment import SerieCreee
from app.schemas.prestation import (
    AllocationCreate,
    AllocationRead,
    ClotureIn,
    EquipmentCreatePresta,
    ModeleDispo,
    ModeleStepIn,
    PrestationCreate,
    PrestationDetail,
    PrestationRead,
    PrestationUpdate,
    valide_periode,
)
from app.security.rbac import RequireStaff
from app.services import contenants, disponibilite
from app.services.prestation_statut import recalculer_statut, statut_derive

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
        decision_cloture=alloc.decision_cloture,
        equipment_nom=eq.nom if eq is not None else None,
        equipment_barcode=eq.barcode_uid if eq is not None else None,
        equipment_externe=loc is not None,
        fournisseur_id=loc[0] if loc is not None else None,
        fournisseur_nom=loc[1] if loc is not None else None,
        equipment_contenant_id=eq.contenant_id if eq is not None else None,
        equipment_statut=eq.statut_actuel if eq is not None else None,
    )


async def _standard_descendant_ids(db: DbSession, root_id: int) -> list[int]:
    """Ids des descendants *standard* (hors vrac/conso) d'un contenant.

    Parcours en largeur borné : on descend par tous les enfants mais on n'alloue
    que les items standard (un vrac/conso garde sa propre logique de quantité).
    """
    collected: list[int] = []
    frontier = [root_id]
    seen: set[int] = {root_id}
    for _ in range(contenants.DEPTH_GUARD):
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


async def _ids_quantitatifs(db: DbSession, ids: list[int]) -> set[int]:
    """Parmi `ids`, les vrac/consommables : des quantités, pas des unités, donc
    hors règle de chevauchement des périodes."""
    if not ids:
        return set()
    vrac = await db.execute(
        select(EquipmentVrac.equipment_id).where(EquipmentVrac.equipment_id.in_(ids))
    )
    conso = await db.execute(
        select(EquipmentConsommable.equipment_id).where(
            EquipmentConsommable.equipment_id.in_(ids)
        )
    )
    return {e for (e,) in vrac.all()} | {e for (e,) in conso.all()}


def _fmt_conflits(conflits: list[tuple[str, str]]) -> str:
    lignes = ", ".join(f"« {eq} » (pris par « {p} »)" for eq, p in conflits[:5])
    reste = len(conflits) - 5
    return lignes + (f" et {reste} autre{'s' if reste > 1 else ''}" if reste > 0 else "")


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


async def _detail_response(db: DbSession, presta: Prestation) -> PrestationDetail:
    """Prestation + ses allocations à jour (relit la base après une mutation)."""
    allocs = await db.scalars(
        select(AllocationPresta)
        .where(AllocationPresta.presta_id == presta.id)
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


@router.get("/{presta_id}", response_model=PrestationDetail)
async def get_prestation(
    presta_id: int, _user: CurrentUser, db: DbSession
) -> PrestationDetail:
    presta = await _get_presta_or_404(db, presta_id)
    return await _detail_response(db, presta)


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
    # Un PATCH partiel (une seule borne) doit rester cohérent avec la valeur déjà
    # en base : on revalide la période sur l'état final fusionné, pas seulement
    # sur le payload (que le validateur du schéma ne voit que partiellement).
    try:
        valide_periode(presta.date_debut, presta.date_fin)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    # Nouvelles dates : refusées si elles font chevaucher une autre prestation
    # qui tient déjà une de nos unités (à libérer d'un côté ou de l'autre d'abord).
    if {"date_debut", "date_fin"} & data.model_fields_set and (
        presta.statut != StatutPrestation.TERMINEE
    ):
        rows = (
            await db.execute(
                select(AllocationPresta.equipment_id, Equipment.nom)
                .join(Equipment, Equipment.id == AllocationPresta.equipment_id)
                .where(
                    AllocationPresta.presta_id == presta.id,
                    AllocationPresta.statut != StatutAllocation.RETOURNE,
                )
            )
        ).all()
        noms = dict(rows)
        quantitatifs = await _ids_quantitatifs(db, list(noms))
        occ = await disponibilite.occupations(
            db, presta, [eid for eid in noms if eid not in quantitatifs]
        )
        if occ:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ces dates chevauchent une autre prestation qui tient déjà : "
                + _fmt_conflits([(noms[eid], p[1]) for eid, p in occ.items()])
                + ".",
            )
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
    presta = await _get_presta_or_404(db, presta_id)
    equipment = await db.get(Equipment, data.equipment_id)
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )
    if data.quantite > 1 and not await _ids_quantitatifs(db, [equipment.id]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Un équipement unitaire s'alloue à l'unité : crée plusieurs exemplaires.",
        )

    existing = await db.scalar(
        select(AllocationPresta).where(
            AllocationPresta.presta_id == presta_id,
            AllocationPresta.equipment_id == data.equipment_id,
        )
    )
    if existing is None:
        raison = disponibilite.raison_blocage(equipment)
        if raison is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"« {equipment.nom} » est {raison} : il ne peut pas être alloué.",
            )
        if not await _ids_quantitatifs(db, [equipment.id]):
            occ = await disponibilite.occupations(db, presta, [equipment.id])
            if occ:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"« {equipment.nom} » est déjà pris par « {occ[equipment.id][1]} » "
                    "sur ces dates.",
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

    # Contenant : on alloue aussi son contenu standard (les enfants suivent la caisse),
    # sauf les items hors service ou déjà pris ailleurs, comptés pour prévenir l'UI.
    contenu_ignore = 0
    if data.inclure_contenu:
        descendant_ids = await _standard_descendant_ids(db, data.equipment_id)
        if descendant_ids:
            enfants = (
                await db.scalars(select(Equipment).where(Equipment.id.in_(descendant_ids)))
            ).all()
            occ = await disponibilite.occupations(db, presta, descendant_ids)
            exclus = {
                e.id for e in enfants if disponibilite.raison_blocage(e) or e.id in occ
            }
            contenu_ignore = len(exclus)
            descendant_ids = [d for d in descendant_ids if d not in exclus]
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

    await recalculer_statut(db, presta)
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
    return _allocation_read(alloc, loc).model_copy(update={"contenu_ignore": contenu_ignore})


@router.post(
    "/{presta_id}/equipements",
    response_model=SerieCreee,
    status_code=status.HTTP_201_CREATED,
)
async def creer_et_allouer(
    presta_id: int,
    user: RequireStaff,
    db: DbSession,
    donnees: str = Form(..., description="JSON d'EquipmentCreatePresta."),
    photo: UploadFile | None = File(None),
) -> SerieCreee:
    """Crée N fiches et les alloue à la prestation, en une seule transaction."""
    presta = await _get_presta_or_404(db, presta_id)
    payload = lire_donnees(donnees, EquipmentCreatePresta)
    if payload.quantite_allouee > 1 and payload.type == "standard":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Un équipement unitaire s'alloue à l'unité : crée plusieurs exemplaires.",
        )
    image = await lire_photo(photo)
    eqs = await creer_equipements(db, payload, user, image)
    quantitatifs = await _ids_quantitatifs(db, [e.id for e in eqs])
    for eq in eqs:
        db.add(
            AllocationPresta(
                presta_id=presta.id,
                equipment_id=eq.id,
                quantite=payload.quantite_allouee if eq.id in quantitatifs else 1,
                statut=StatutAllocation.PLANIFIE,
            )
        )
    try:
        await db.flush()
        await recalculer_statut(db, presta)
        await db.commit()
    except BaseException:
        effacer_photos([e.photo_chemin for e in eqs if e.photo_chemin])
        raise
    return SerieCreee(
        ids=[e.id for e in eqs], noms=[e.nom for e in eqs], modele_id=payload.modele_id
    )


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
    presta = await _get_presta_or_404(db, presta_id)
    alloc = await db.get(AllocationPresta, allocation_id)
    if alloc is None or alloc.presta_id != presta_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Allocation introuvable."
        )

    await _supprimer_allocation(db, alloc)
    await recalculer_statut(db, presta)
    await db.commit()


async def _supprimer_allocation(db: DbSession, alloc: AllocationPresta) -> None:
    """Supprime une allocation. Supprimer un flight retire aussi les allocations de
    tout son contenu, pour ne jamais laisser d'items orphelins dans la prestation."""
    descendant_ids = await contenants.descendant_ids(db, alloc.equipment_id)
    if descendant_ids:
        await db.execute(
            AllocationPresta.__table__.delete().where(
                AllocationPresta.presta_id == alloc.presta_id,
                AllocationPresta.equipment_id.in_(descendant_ids),
            )
        )
    await db.delete(alloc)


# --- Ajout par modèle ------------------------------------------------------
#
# Le stepper « − n + » d'un modèle : le serveur choisit l'unité, l'UI ne voit que
# des compteurs. Une ligne par (modèle, prestataire) : le matériel loué d'un
# même modèle a son propre compteur.


#: Clé de `pg_advisory_xact_lock` réservée à l'ajout par modèle (2e clé = modele_id).
_VERROU_MODELE = 4201


class _UnitesModele:
    """Unités d'un ensemble de modèles vues depuis une prestation."""

    def __init__(
        self,
        unites: list[Equipment],
        loc_map: dict[int, tuple[int, str]],
        allocs: dict[int, AllocationPresta],
        occ: dict[int, tuple[int, str]],
    ) -> None:
        self.unites = unites
        self.loc_map = loc_map
        self.allocs = allocs
        self.occ = occ

    def fournisseur(self, eq: Equipment) -> int | None:
        loc = self.loc_map.get(eq.id)
        return loc[0] if loc else None

    def ajoutable(self, eq: Equipment) -> bool:
        return (
            eq.id not in self.allocs
            and disponibilite.raison_blocage(eq) is None
            and eq.id not in self.occ
        )

    def retirable(self, eq: Equipment) -> bool:
        """Planifiée et pas venue avec son flight (on retire le flight, pas l'item)."""
        alloc = self.allocs.get(eq.id)
        return (
            alloc is not None
            and alloc.statut == StatutAllocation.PLANIFIE
            and eq.contenant_id not in self.allocs
        )


async def _unites_modele(
    db: DbSession, presta: Prestation, modele_ids: list[int]
) -> _UnitesModele:
    unites = list(
        (
            await db.scalars(
                select(Equipment).where(
                    Equipment.modele_id.in_(modele_ids), Equipment.archive.is_(False)
                )
            )
        ).all()
    )
    allocs = {
        a.equipment_id: a
        for a in (
            await db.scalars(
                select(AllocationPresta).where(AllocationPresta.presta_id == presta.id)
            )
        ).all()
    }
    occ = await disponibilite.occupations(
        db, presta, [u.id for u in unites if u.id not in allocs]
    )
    return _UnitesModele(unites, await _location_map(db), allocs, occ)


async def _lignes_modeles(
    db: DbSession, presta: Prestation, modeles: list[Modele]
) -> list[ModeleDispo]:
    if not modeles:
        return []
    vue = await _unites_modele(db, presta, [m.id for m in modeles])
    lignes: dict[tuple[int, int | None], ModeleDispo] = {}

    def ligne(modele: Modele, fid: int | None, fnom: str | None) -> ModeleDispo:
        key = (modele.id, fid)
        if key not in lignes:
            lignes[key] = ModeleDispo(
                modele_id=modele.id,
                nom=modele.nom,
                marque=modele.marque,
                fournisseur_id=fid,
                fournisseur_nom=fnom,
                dispo=0,
                total=0,
                alloues=0,
                retirable=False,
            )
        return lignes[key]

    par_id = {m.id: m for m in modeles}
    for eq in vue.unites:
        loc = vue.loc_map.get(eq.id)
        row = ligne(par_id[eq.modele_id], *(loc or (None, None)))
        if eq.statut_actuel not in disponibilite.STATUTS_HORS_PARC:
            row.total += 1
        if eq.id in vue.allocs:
            row.alloues += 1
            row.retirable = row.retirable or vue.retirable(eq)
        elif vue.ajoutable(eq):
            row.dispo += 1
    # Un modèle sans unité reste listé (0/0) : on voit qu'il existe.
    for m in modeles:
        if not any(k[0] == m.id for k in lignes):
            ligne(m, None, None)
    return sorted(
        lignes.values(),
        key=lambda r: (r.nom.lower(), r.fournisseur_id is not None, r.fournisseur_nom or ""),
    )


async def _modele_or_404(db: DbSession, modele_id: int) -> Modele:
    modele = await db.get(Modele, modele_id)
    if modele is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable.")
    return modele


async def _ligne(
    db: DbSession, presta: Prestation, modele: Modele, fournisseur_id: int | None
) -> ModeleDispo:
    for row in await _lignes_modeles(db, presta, [modele]):
        if row.fournisseur_id == fournisseur_id:
            return row
    return ModeleDispo(
        modele_id=modele.id,
        nom=modele.nom,
        marque=modele.marque,
        fournisseur_id=fournisseur_id,
        dispo=0,
        total=0,
        alloues=0,
        retirable=False,
    )


@router.get("/{presta_id}/modeles", response_model=list[ModeleDispo])
async def list_modeles_presta(
    presta_id: int,
    _user: CurrentUser,
    db: DbSession,
    q: str | None = Query(
        default=None,
        description="Recherche sur le nom ou la marque ; vide = modèles déjà alloués ici",
    ),
) -> list[ModeleDispo]:
    presta = await _get_presta_or_404(db, presta_id)
    stmt = select(Modele).order_by(Modele.nom)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(Modele.nom.ilike(like) | Modele.marque.ilike(like)).limit(20)
    else:
        stmt = stmt.where(
            Modele.id.in_(
                select(Equipment.modele_id)
                .join(AllocationPresta, AllocationPresta.equipment_id == Equipment.id)
                .where(AllocationPresta.presta_id == presta.id)
            )
        )
    modeles = list((await db.scalars(stmt)).all())
    return await _lignes_modeles(db, presta, modeles)


@router.post("/{presta_id}/modeles/{modele_id}/ajout", response_model=ModeleDispo)
async def ajouter_unite_modele(
    presta_id: int,
    modele_id: int,
    data: ModeleStepIn,
    db: DbSession,
    _user: RequireStaff,
) -> ModeleDispo:
    """« + » : alloue une unité libre du modèle, choisie par le serveur.

    Ordre de choix : unités en vrac d'abord (on n'ouvre pas un flight pour une
    lyre), puis par nom et référence — déterministe, l'unité exacte se règle de
    toute façon au scan de sortie.
    """
    presta = await _get_presta_or_404(db, presta_id)
    modele = await _modele_or_404(db, modele_id)
    # Deux « + » simultanés (ici ou sur une autre prestation) ne doivent pas
    # choisir la même unité : on sérialise par modèle jusqu'au commit.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:k, :m)"), {"k": _VERROU_MODELE, "m": modele.id}
    )
    vue = await _unites_modele(db, presta, [modele.id])
    candidates = sorted(
        (
            eq
            for eq in vue.unites
            if vue.fournisseur(eq) == data.fournisseur_id and vue.ajoutable(eq)
        ),
        key=lambda eq: (eq.contenant_id is not None, eq.nom, eq.barcode_uid),
    )
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Plus aucun « {modele.nom} » disponible.",
        )
    db.add(
        AllocationPresta(
            presta_id=presta.id,
            equipment_id=candidates[0].id,
            quantite=1,
            statut=StatutAllocation.PLANIFIE,
        )
    )
    await recalculer_statut(db, presta)
    await db.commit()
    return await _ligne(db, presta, modele, data.fournisseur_id)


@router.post("/{presta_id}/modeles/{modele_id}/retrait", response_model=ModeleDispo)
async def retirer_unite_modele(
    presta_id: int,
    modele_id: int,
    data: ModeleStepIn,
    db: DbSession,
    _user: RequireStaff,
) -> ModeleDispo:
    """« − » : retire la dernière unité ajoutée du modèle, si elle est encore
    planifiée. Une unité déjà sortie se règle au pointage, pas ici."""
    presta = await _get_presta_or_404(db, presta_id)
    modele = await _modele_or_404(db, modele_id)
    vue = await _unites_modele(db, presta, [modele.id])
    retirables = [
        vue.allocs[eq.id]
        for eq in vue.unites
        if vue.fournisseur(eq) == data.fournisseur_id and vue.retirable(eq)
    ]
    if not retirables:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Aucun « {modele.nom} » planifié à retirer.",
        )
    await _supprimer_allocation(db, max(retirables, key=lambda a: a.id))
    await recalculer_statut(db, presta)
    await db.commit()
    return await _ligne(db, presta, modele, data.fournisseur_id)


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
    # Clôture rejouée après réouverture : l'écran ne renvoie que les écarts encore
    # ouverts, les décisions déjà prises restent. Seul un écart comblé entre-temps
    # par le pointage (l'item « perdu » ou « en suspens » est revenu) sort du rapport.
    for alloc in allocs:
        if (
            alloc.decision_cloture in (DecisionCloture.PERDU, DecisionCloture.OUVERT)
            and alloc.quantite_retournee >= alloc.quantite_sortie
        ):
            alloc.decision_cloture = None

    def changer_statut(equipment: Equipment, statut: StatutEquipment) -> None:
        """Change le statut et le trace dans l'historique de l'équipement."""
        if equipment.statut_actuel == statut:
            return
        equipment.statut_actuel = statut
        db.add(
            LogScan(
                uuid_client=uuid4(),
                equipment_id=equipment.id,
                membre_id=user.id,
                type_action=TypeActionScan.CHANGEMENT_STATUT,
                contexte=f"→ {statut.replace('_', ' ')} · clôture « {presta.nom} »",
            )
        )

    for item in data.items:
        alloc = by_id.get(item.allocation_id)
        if alloc is None:
            continue
        alloc.decision_cloture = DecisionCloture(item.decision)
        equipment = alloc.equipment
        if item.decision == "retourne":
            alloc.quantite_retournee = alloc.quantite_sortie
            alloc.statut = StatutAllocation.RETOURNE
        elif item.decision == "perdu":
            alloc.statut = StatutAllocation.RETOURNE
            if equipment is not None:
                changer_statut(equipment, StatutEquipment.PERDU)
        elif item.decision == "casse":
            alloc.quantite_retournee = alloc.quantite_sortie
            alloc.statut = StatutAllocation.RETOURNE
            if equipment is not None:
                changer_statut(equipment, StatutEquipment.EN_PANNE)
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
    return await _detail_response(db, presta)


@router.post("/{presta_id}/reouverture", response_model=PrestationDetail)
async def rouvrir_prestation(
    presta_id: int,
    db: DbSession,
    _user: RequireStaff,
) -> PrestationDetail:
    """Rouvre une prestation clôturée : le statut repart du pointage.

    Sortie de secours quand du matériel a été oublié après la clôture. On ne
    défait pas les effets de la clôture (matériel marqué perdu/en panne, tickets
    créés) : rouvrir sert à compléter la prestation, pas à réécrire son histoire.
    Idempotent : rappeler la route ne fait que réaligner le statut.
    """
    presta = await _get_presta_or_404(db, presta_id)
    presta.statut = await statut_derive(db, presta.id)
    await db.commit()
    return await _detail_response(db, presta)
