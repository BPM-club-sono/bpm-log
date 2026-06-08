"""Routes catalogue : Parc unifié (équipements standard / vrac / consommable),
fiche détaillée, création/édition (Admin+Staff), photo, fournisseurs."""

import uuid as uuid_lib
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import (
    Categorie,
    Emplacement,
    Equipment,
    EquipmentConsommable,
    EquipmentLocation,
    EquipmentVrac,
    Fournisseur,
    InventaireVrac,
    InventoryLock,
    LogScan,
    Membre,
    TicketReparation,
)
from app.models.enums import StatutEquipment, TypeActionScan
from app.schemas.equipment import (
    CategorieRead,
    ConsoPreview,
    ContenuChild,
    EmplacementRead,
    EquipmentCreate,
    EquipmentDetail,
    EquipmentListItem,
    EquipmentRead,
    EquipmentType,
    EquipmentUpdate,
    LocationInfo,
    PathSegment,
    PhotoUploadResult,
    ScanHistoryItem,
    TicketHistoryItem,
    VracDetailInfo,
    VracPreview,
    build_photo_url,
)
from app.schemas.inventory import InventaireEntry, VracLock
from app.security.rbac import RequireStaff

router = APIRouter(tags=["catalogue"])

_ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_BYTES = 8 * 1024 * 1024  # 8 Mo


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _membre_nom(membre: Membre | None) -> str | None:
    if membre is None:
        return None
    parts = [p for p in (membre.prenom, membre.nom) if p]
    return " ".join(parts) or membre.email


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


def _derive_type(has_vrac: bool, has_conso: bool) -> EquipmentType:
    if has_vrac:
        return "vrac"
    if has_conso:
        return "consommable"
    return "standard"


async def _resolve_fournisseur(
    db: DbSession, fournisseur_id: int | None, fournisseur_nom: str | None
) -> int | None:
    """Renvoie l'id du fournisseur (existant ou créé à la volée)."""
    if fournisseur_id is not None:
        f = await db.get(Fournisseur, fournisseur_id)
        if f is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fournisseur introuvable.",
            )
        return f.id
    if fournisseur_nom and fournisseur_nom.strip():
        f = Fournisseur(nom=fournisseur_nom.strip())
        db.add(f)
        await db.flush()
        return f.id
    return None


# --------------------------------------------------------------------------- #
# Contenants imbriqués (rangement hiérarchique)
# --------------------------------------------------------------------------- #
_DEPTH_GUARD = 32  # garde anti-boucle (données corrompues) sur les remontées d'arbre


async def _check_no_cycle(db: DbSession, item_id: int | None, new_parent_id: int | None) -> None:
    """Vérifie que ranger `item_id` dans `new_parent_id` ne crée pas de boucle.

    Lève 409 si le parent est l'item lui-même ou l'un de ses descendants, 404 s'il
    n'existe pas. À appeler avant tout assignation de `contenant_id`.
    """
    if new_parent_id is None:
        return
    if new_parent_id == item_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un contenant ne peut pas se contenir lui-même.",
        )
    current_id: int | None = new_parent_id
    seen: set[int] = set()
    for _ in range(_DEPTH_GUARD):
        if current_id is None:
            return
        if current_id == item_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Déplacement impossible : cela créerait une boucle de contenants.",
            )
        if current_id in seen:
            return
        seen.add(current_id)
        parent = await db.get(Equipment, current_id)
        if parent is None:
            if current_id == new_parent_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Contenant introuvable.",
                )
            return
        current_id = parent.contenant_id


async def _compute_chemin(db: DbSession, eq: Equipment) -> list[PathSegment]:
    """Fil d'Ariane de localisation, du plus large au plus précis (exclut `eq`).

    Remonte les contenants jusqu'à la racine, puis les emplacements parents de
    celle-ci : ex. Dépôt > Étagère A > Flight MH (pour une lyre dans le Flight MH).
    """
    containers: list[Equipment] = []
    current = eq
    seen_eq: set[int] = {eq.id}
    for _ in range(_DEPTH_GUARD):
        if current.contenant_id is None or current.contenant_id in seen_eq:
            break
        parent = await db.get(Equipment, current.contenant_id)
        if parent is None:
            break
        seen_eq.add(parent.id)
        containers.append(parent)
        current = parent

    emplacements: list[Emplacement] = []
    emp_id = current.emplacement_id
    seen_emp: set[int] = set()
    for _ in range(_DEPTH_GUARD):
        if emp_id is None or emp_id in seen_emp:
            break
        emp = await db.get(Emplacement, emp_id)
        if emp is None:
            break
        seen_emp.add(emp.id)
        emplacements.append(emp)
        emp_id = emp.parent_id

    segments: list[PathSegment] = [
        PathSegment(kind="emplacement", id=emp.id, nom=emp.nom)
        for emp in reversed(emplacements)
    ]
    segments += [
        PathSegment(kind="contenant", id=cont.id, nom=cont.nom)
        for cont in reversed(containers)
    ]
    return segments


async def _build_contenu(db: DbSession, container_id: int) -> list[ContenuChild]:
    """Enfants directs d'un contenant, avec leur type dérivé et photo."""
    children = list(
        (
            await db.scalars(
                select(Equipment)
                .where(Equipment.contenant_id == container_id)
                .order_by(Equipment.nom)
            )
        ).all()
    )
    if not children:
        return []
    child_ids = [c.id for c in children]
    vrac_ids = {
        eid
        for (eid,) in (
            await db.execute(
                select(EquipmentVrac.equipment_id).where(
                    EquipmentVrac.equipment_id.in_(child_ids)
                )
            )
        ).all()
    }
    conso_ids = {
        eid
        for (eid,) in (
            await db.execute(
                select(EquipmentConsommable.equipment_id).where(
                    EquipmentConsommable.equipment_id.in_(child_ids)
                )
            )
        ).all()
    }
    parent_ids = {
        eid
        for (eid,) in (
            await db.execute(
                select(Equipment.contenant_id)
                .where(Equipment.contenant_id.in_(child_ids))
                .distinct()
            )
        ).all()
    }
    return [
        ContenuChild(
            id=c.id,
            nom=c.nom,
            barcode_uid=c.barcode_uid,
            type=_derive_type(c.id in vrac_ids, c.id in conso_ids),
            statut_actuel=c.statut_actuel,
            photo_url=build_photo_url(c.photo_chemin),
            est_contenant=c.id in parent_ids,
        )
        for c in children
    ]


async def _build_detail(db: DbSession, eq: Equipment, membre_id: int) -> EquipmentDetail:
    categorie = await db.get(Categorie, eq.categorie_id) if eq.categorie_id else None
    emplacement = await db.get(Emplacement, eq.emplacement_id) if eq.emplacement_id else None
    contenant = await db.get(Equipment, eq.contenant_id) if eq.contenant_id else None
    chemin = await _compute_chemin(db, eq)
    contenu = await _build_contenu(db, eq.id)
    vrac = await db.get(EquipmentVrac, eq.id)
    conso = await db.get(EquipmentConsommable, eq.id)
    location = await db.get(EquipmentLocation, eq.id)

    vrac_info: VracDetailInfo | None = None
    if vrac is not None:
        delta = int(
            await db.scalar(
                select(func.coalesce(func.sum(InventaireVrac.delta), 0)).where(
                    InventaireVrac.equipment_id == eq.id
                )
            )
            or 0
        )
        lock = await db.get(InventoryLock, eq.id)
        lock_nom = _membre_nom(await db.get(Membre, lock.membre_id)) if lock else None
        rows = (
            await db.execute(
                select(InventaireVrac, Membre)
                .join(Membre, Membre.id == InventaireVrac.membre_id)
                .where(InventaireVrac.equipment_id == eq.id)
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
        vrac_info = VracDetailInfo(
            quantite_theorique=vrac.quantite_theorique,
            quantite_actuelle=vrac.quantite_theorique + delta,
            ecart=delta,
            lock=_lock_view(lock, lock_nom, membre_id),
            historique=historique,
        )

    conso_info: ConsoPreview | None = None
    if conso is not None:
        conso_info = ConsoPreview(
            stock_actuel=conso.stock_actuel,
            seuil_alerte=conso.seuil_alerte,
            unite=conso.unite,
            en_alerte=conso.stock_actuel <= conso.seuil_alerte,
        )

    location_info: LocationInfo | None = None
    if location is not None:
        fournisseur = await db.get(Fournisseur, location.fournisseur_id)
        location_info = LocationInfo(
            fournisseur_id=location.fournisseur_id,
            fournisseur_nom=fournisseur.nom if fournisseur else None,
            reference_devis=location.reference_devis,
        )

    ticket_rows = (
        await db.scalars(
            select(TicketReparation)
            .where(TicketReparation.equipment_id == eq.id)
            .order_by(TicketReparation.date_declaration.desc())
        )
    ).all()
    tickets = [
        TicketHistoryItem(
            id=t.id,
            description_panne=t.description_panne,
            avancement=t.avancement,
            cout_estime=t.cout_estime,
            date_declaration=t.date_declaration,
            date_resolution=t.date_resolution,
        )
        for t in ticket_rows
    ]

    scan_rows = (
        await db.execute(
            select(LogScan, Membre)
            .join(Membre, Membre.id == LogScan.membre_id)
            .where(LogScan.equipment_id == eq.id)
            .order_by(LogScan.date_scan.desc())
            .limit(30)
        )
    ).all()
    scans = [
        ScanHistoryItem(
            id=log.id,
            type_action=log.type_action,
            contexte=log.contexte,
            membre_nom=_membre_nom(membre),
            emplacement_destination_id=log.emplacement_destination_id,
            date_scan=log.date_scan,
        )
        for log, membre in scan_rows
    ]

    return EquipmentDetail(
        id=eq.id,
        barcode_uid=eq.barcode_uid,
        nom=eq.nom,
        categorie_id=eq.categorie_id,
        categorie_nom=categorie.nom if categorie else None,
        emplacement_id=eq.emplacement_id,
        emplacement_nom=emplacement.nom if emplacement else None,
        contenant_id=eq.contenant_id,
        contenant_nom=contenant.nom if contenant else None,
        est_contenant=bool(contenu),
        chemin=chemin,
        contenu=contenu,
        statut_actuel=eq.statut_actuel,
        photo_url=build_photo_url(eq.photo_chemin),
        type=_derive_type(vrac is not None, conso is not None),
        externe=location is not None,
        archive=eq.archive,
        created_at=eq.created_at,
        vrac=vrac_info,
        conso=conso_info,
        location=location_info,
        tickets=tickets,
        scans=scans,
    )


# --------------------------------------------------------------------------- #
# Liste (Parc unifié)
# --------------------------------------------------------------------------- #
@router.get("/equipments", response_model=list[EquipmentListItem])
async def list_equipments(
    user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, description="Recherche sur le nom ou le code-barres"),
    categorie_id: int | None = Query(default=None),
    emplacement_id: int | None = Query(default=None),
    statut: StatutEquipment | None = Query(default=None),
    type: EquipmentType | None = Query(default=None, description="standard|vrac|consommable"),
    externe: bool | None = Query(default=None),
    contenant_id: int | None = Query(
        default=None, description="Filtre : contenu direct de ce contenant"
    ),
    racine: bool = Query(
        default=False, description="true = seulement les items hors contenant (racine)"
    ),
    archive: bool = Query(
        default=False,
        description="false (défaut) = matériel actif ; true = locations archivées (rendues)",
    ),
) -> list[EquipmentListItem]:
    stmt = select(Equipment)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Equipment.nom.ilike(like) | Equipment.barcode_uid.ilike(like))
    if categorie_id is not None:
        stmt = stmt.where(Equipment.categorie_id == categorie_id)
    if emplacement_id is not None:
        stmt = stmt.where(Equipment.emplacement_id == emplacement_id)
    if statut is not None:
        stmt = stmt.where(Equipment.statut_actuel == statut)
    if contenant_id is not None:
        stmt = stmt.where(Equipment.contenant_id == contenant_id)
    if racine:
        stmt = stmt.where(Equipment.contenant_id.is_(None))
    stmt = stmt.where(Equipment.archive == archive)
    stmt = stmt.order_by(Equipment.nom)

    equipments = list((await db.scalars(stmt)).all())

    # Maps en masse (parc de petite taille).
    cat_map = {c.id: c.nom for c in (await db.scalars(select(Categorie))).all()}
    emp_map = {e.id: e.nom for e in (await db.scalars(select(Emplacement))).all()}
    # Nom de chaque équipement (pour contenant_nom) + ids ayant du contenu.
    eq_rows = (
        await db.execute(select(Equipment.id, Equipment.nom, Equipment.contenant_id))
    ).all()
    eq_nom_map = {i: n for i, n, _ in eq_rows}
    container_ids = {c for _, _, c in eq_rows if c is not None}
    vrac_map = {v.equipment_id: v for v in (await db.scalars(select(EquipmentVrac))).all()}
    conso_map = {
        c.equipment_id: c for c in (await db.scalars(select(EquipmentConsommable))).all()
    }
    loc_ids = {
        eid for (eid,) in (await db.execute(select(EquipmentLocation.equipment_id))).all()
    }
    lock_map = {locks.equipment_id: locks for locks in (await db.scalars(select(InventoryLock))).all()}
    delta_map = {
        eid: int(total or 0)
        for eid, total in (
            await db.execute(
                select(InventaireVrac.equipment_id, func.sum(InventaireVrac.delta)).group_by(
                    InventaireVrac.equipment_id
                )
            )
        ).all()
    }

    now = datetime.now(timezone.utc)
    items: list[EquipmentListItem] = []
    for eq in equipments:
        has_vrac = eq.id in vrac_map
        has_conso = eq.id in conso_map
        eq_type = _derive_type(has_vrac, has_conso)
        is_externe = eq.id in loc_ids

        if type is not None and eq_type != type:
            continue
        if externe is not None and is_externe != externe:
            continue

        vrac_preview: VracPreview | None = None
        if has_vrac:
            v = vrac_map[eq.id]
            delta = delta_map.get(eq.id, 0)
            lock = lock_map.get(eq.id)
            active = lock is not None and lock.expires_at > now
            vrac_preview = VracPreview(
                quantite_theorique=v.quantite_theorique,
                quantite_actuelle=v.quantite_theorique + delta,
                ecart=delta,
                locked=active,
                lock_is_mine=bool(active and lock and lock.membre_id == user.id),
            )

        conso_preview: ConsoPreview | None = None
        if has_conso:
            c = conso_map[eq.id]
            conso_preview = ConsoPreview(
                stock_actuel=c.stock_actuel,
                seuil_alerte=c.seuil_alerte,
                unite=c.unite,
                en_alerte=c.stock_actuel <= c.seuil_alerte,
            )

        items.append(
            EquipmentListItem(
                id=eq.id,
                barcode_uid=eq.barcode_uid,
                nom=eq.nom,
                categorie_id=eq.categorie_id,
                categorie_nom=cat_map.get(eq.categorie_id) if eq.categorie_id else None,
                emplacement_id=eq.emplacement_id,
                emplacement_nom=emp_map.get(eq.emplacement_id) if eq.emplacement_id else None,
                contenant_id=eq.contenant_id,
                contenant_nom=eq_nom_map.get(eq.contenant_id) if eq.contenant_id else None,
                est_contenant=eq.id in container_ids,
                statut_actuel=eq.statut_actuel,
                photo_url=build_photo_url(eq.photo_chemin),
                type=eq_type,
                externe=is_externe,
                archive=eq.archive,
                vrac=vrac_preview,
                conso=conso_preview,
            )
        )
    return items


@router.get("/equipments/by-barcode/{barcode_uid}", response_model=EquipmentRead)
async def get_equipment_by_barcode(
    barcode_uid: str,
    _user: CurrentUser,
    db: DbSession,
) -> Equipment:
    """Résout un code-barres scanné vers son équipement (utilisé par le scanner)."""
    equipment = await db.scalar(
        select(Equipment).where(Equipment.barcode_uid == barcode_uid)
    )
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Aucun équipement avec le code-barres {barcode_uid}.",
        )
    return equipment


@router.get("/equipments/{equipment_id}", response_model=EquipmentDetail)
async def get_equipment(equipment_id: int, user: CurrentUser, db: DbSession) -> EquipmentDetail:
    """Fiche détaillée d'un équipement (infos + bloc vrac/conso + historiques)."""
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )
    return await _build_detail(db, eq, user.id)


@router.get("/equipments/{equipment_id}/contenu", response_model=list[ContenuChild])
async def get_equipment_contenu(
    equipment_id: int,
    _user: CurrentUser,
    db: DbSession,
    recursif: bool = Query(default=False, description="true = tout le sous-arbre"),
) -> list[ContenuChild]:
    """Contenu d'un contenant : enfants directs, ou tout le sous-arbre si `recursif`."""
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )
    if not recursif:
        return await _build_contenu(db, equipment_id)

    # Parcours en largeur, garde anti-boucle.
    out: list[ContenuChild] = []
    queue: list[int] = [equipment_id]
    seen: set[int] = {equipment_id}
    for _ in range(_DEPTH_GUARD):
        if not queue:
            break
        next_queue: list[int] = []
        for cid in queue:
            for child in await _build_contenu(db, cid):
                if child.id in seen:
                    continue
                seen.add(child.id)
                out.append(child)
                if child.est_contenant:
                    next_queue.append(child.id)
        queue = next_queue
    return out


# --------------------------------------------------------------------------- #
# Création / édition (Admin + Staff)
# --------------------------------------------------------------------------- #
async def _assign_barcode(db: DbSession, eq: Equipment, provided: str | None) -> None:
    if provided and provided.strip():
        code = provided.strip()
        existing = await db.scalar(select(Equipment).where(Equipment.barcode_uid == code))
        if existing is not None and existing.id != eq.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Le code-barres {code} est déjà utilisé.",
            )
        eq.barcode_uid = code
    elif not eq.barcode_uid:
        eq.barcode_uid = f"BPM-{eq.id:06d}"


@router.post(
    "/equipments",
    response_model=EquipmentDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment(
    payload: EquipmentCreate,
    user: RequireStaff,
    db: DbSession,
) -> EquipmentDetail:
    """Crée un équipement (standard/vrac/consommable, option location externe)."""
    # Règle de frontière : ranger dans un contenant exclut l'emplacement fixe.
    if payload.contenant_id is not None:
        await _check_no_cycle(db, None, payload.contenant_id)
    eq = Equipment(
        barcode_uid=f"tmp-{uuid_lib.uuid4().hex}",
        nom=payload.nom,
        categorie_id=payload.categorie_id,
        emplacement_id=None if payload.contenant_id is not None else payload.emplacement_id,
        contenant_id=payload.contenant_id,
        statut_actuel=payload.statut_actuel,
        created_by_membre_id=user.id,
    )
    db.add(eq)
    await db.flush()  # obtenir l'id pour le code-barres auto
    if payload.barcode_uid and payload.barcode_uid.strip():
        await _assign_barcode(db, eq, payload.barcode_uid)
    else:
        eq.barcode_uid = f"BPM-{eq.id:06d}"

    if payload.type == "vrac":
        db.add(
            EquipmentVrac(
                equipment_id=eq.id,
                quantite_theorique=payload.quantite_theorique or 0,
            )
        )
    elif payload.type == "consommable":
        db.add(
            EquipmentConsommable(
                equipment_id=eq.id,
                stock_actuel=payload.stock_actuel or 0,
                seuil_alerte=payload.seuil_alerte or 0,
                unite=payload.unite,
            )
        )

    if payload.externe:
        fournisseur_id = await _resolve_fournisseur(
            db, payload.fournisseur_id, payload.fournisseur_nom
        )
        if fournisseur_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Un fournisseur est requis pour un matériel en location externe.",
            )
        db.add(
            EquipmentLocation(
                equipment_id=eq.id,
                fournisseur_id=fournisseur_id,
                reference_devis=payload.reference_devis,
            )
        )

    await db.commit()
    await db.refresh(eq)
    return await _build_detail(db, eq, user.id)


@router.patch("/equipments/{equipment_id}", response_model=EquipmentDetail)
async def update_equipment(
    equipment_id: int,
    payload: EquipmentUpdate,
    user: RequireStaff,
    db: DbSession,
) -> EquipmentDetail:
    """Met à jour un équipement (champs, sous-lignes vrac/conso, location)."""
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )

    if payload.nom is not None:
        eq.nom = payload.nom
    if payload.categorie_id is not None:
        eq.categorie_id = payload.categorie_id
    # Localisation : emplacement fixe et contenant sont exclusifs (règle de frontière).
    # Poser l'un efface l'autre ; si les deux sont fournis, le contenant l'emporte.
    if payload.emplacement_id is not None:
        eq.emplacement_id = payload.emplacement_id
        eq.contenant_id = None
    if payload.contenant_id is not None:
        await _check_no_cycle(db, eq.id, payload.contenant_id)
        eq.contenant_id = payload.contenant_id
        eq.emplacement_id = None
    if payload.statut_actuel is not None:
        if payload.statut_actuel != eq.statut_actuel:
            # Trace le changement de statut dans l'historique d'activité.
            db.add(
                LogScan(
                    uuid_client=uuid_lib.uuid4(),
                    equipment_id=eq.id,
                    membre_id=user.id,
                    type_action=TypeActionScan.CHANGEMENT_STATUT,
                    contexte=f"→ {payload.statut_actuel.replace('_', ' ')}",
                )
            )
        eq.statut_actuel = payload.statut_actuel
    if payload.barcode_uid is not None:
        await _assign_barcode(db, eq, payload.barcode_uid)

    if payload.quantite_theorique is not None:
        vrac = await db.get(EquipmentVrac, eq.id)
        if vrac is not None:
            vrac.quantite_theorique = payload.quantite_theorique

    conso = await db.get(EquipmentConsommable, eq.id)
    if conso is not None:
        if payload.seuil_alerte is not None:
            conso.seuil_alerte = payload.seuil_alerte
        if payload.unite is not None:
            conso.unite = payload.unite

    if payload.externe is not None:
        location = await db.get(EquipmentLocation, eq.id)
        if payload.externe:
            fournisseur_id = await _resolve_fournisseur(
                db, payload.fournisseur_id, payload.fournisseur_nom
            )
            if location is None:
                if fournisseur_id is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Un fournisseur est requis pour un matériel en location externe.",
                    )
                db.add(
                    EquipmentLocation(
                        equipment_id=eq.id,
                        fournisseur_id=fournisseur_id,
                        reference_devis=payload.reference_devis,
                    )
                )
            else:
                if fournisseur_id is not None:
                    location.fournisseur_id = fournisseur_id
                if payload.reference_devis is not None:
                    location.reference_devis = payload.reference_devis
        elif location is not None:
            await db.delete(location)
    elif payload.reference_devis is not None:
        location = await db.get(EquipmentLocation, eq.id)
        if location is not None:
            location.reference_devis = payload.reference_devis

    await db.commit()
    await db.refresh(eq)
    return await _build_detail(db, eq, user.id)


@router.post("/equipments/{equipment_id}/photo", response_model=PhotoUploadResult)
async def upload_equipment_photo(
    equipment_id: int,
    user: RequireStaff,
    db: DbSession,
    file: UploadFile = File(...),
) -> PhotoUploadResult:
    """Téléverse (ou remplace) la photo d'un équipement."""
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )

    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format image non supporté (jpeg, png, webp).",
        )
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image trop volumineuse (max 8 Mo).",
        )

    photos_dir = Path(settings.photos_dir)
    photos_dir.mkdir(parents=True, exist_ok=True)
    old = eq.photo_chemin
    filename = f"{uuid_lib.uuid4().hex}{ext}"
    (photos_dir / filename).write_bytes(data)
    eq.photo_chemin = filename
    await db.commit()

    if old:
        old_path = photos_dir / old
        if old_path.exists():
            old_path.unlink(missing_ok=True)

    return PhotoUploadResult(photo_url=build_photo_url(filename))


@router.delete("/equipments/{equipment_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_equipment_photo(
    equipment_id: int, _user: RequireStaff, db: DbSession
) -> None:
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )
    if eq.photo_chemin:
        path = Path(settings.photos_dir) / eq.photo_chemin
        path.unlink(missing_ok=True)
        eq.photo_chemin = None
        await db.commit()


# --------------------------------------------------------------------------- #
# Catégories / emplacements
# --------------------------------------------------------------------------- #
@router.get("/categories", response_model=list[CategorieRead])
async def list_categories(_user: CurrentUser, db: DbSession) -> list[Categorie]:
    result = await db.scalars(select(Categorie).order_by(Categorie.nom))
    return list(result.all())


@router.get("/emplacements", response_model=list[EmplacementRead])
async def list_emplacements(_user: CurrentUser, db: DbSession) -> list[Emplacement]:
    result = await db.scalars(select(Emplacement).order_by(Emplacement.nom))
    return list(result.all())
