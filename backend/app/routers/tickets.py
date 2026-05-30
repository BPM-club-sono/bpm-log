"""Routes tickets de réparation : déclaration en ligne, liste, fiche détaillée,
suivi de l'avancement, fil d'activité (commentaires + événements), photos."""

import uuid as uuid_lib
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import (
    Equipment,
    EvenementTicket,
    LogScan,
    Membre,
    PhotoPanne,
    TicketReparation,
)
from app.models.enums import (
    AvancementTicket,
    RoleMembre,
    StatutEquipment,
    TypeActionScan,
    TypeEvenementTicket,
)
from app.schemas.ticket import (
    CommentaireCreate,
    EvenementRead,
    MembreLite,
    PhotoRead,
    TicketCreate,
    TicketDetail,
    TicketListItem,
    TicketUpdate,
)
from app.security.rbac import require_role

router = APIRouter(prefix="/tickets", tags=["tickets"])

# Gestion d'un ticket (avancement, coût, assignation, commentaires, photos) :
# accessible aux Tech, Staff et Admin.
RequireManage = Annotated[
    CurrentUser, Depends(require_role(RoleMembre.TECH, RoleMembre.STAFF))
]

_ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_BYTES = 8 * 1024 * 1024  # 8 Mo

_AVANCEMENT_LABEL = {
    AvancementTicket.A_FAIRE: "À faire",
    AvancementTicket.EN_COURS: "En cours",
    AvancementTicket.EN_ATTENTE_DE_PIECE: "En attente de pièce",
    AvancementTicket.RESOLU: "Résolu",
}


def _membre_lite(m: Membre | None) -> MembreLite | None:
    return MembreLite.model_validate(m) if m is not None else None


def _membre_nom(m: Membre | None) -> str | None:
    if m is None:
        return None
    return " ".join(p for p in (m.prenom, m.nom) if p) or None


async def _resolve_equipment(
    db: DbSession, equipment_id: int | None, barcode_uid: str | None
) -> Equipment:
    equipment: Equipment | None = None
    if equipment_id is not None:
        equipment = await db.get(Equipment, equipment_id)
    elif barcode_uid is not None:
        equipment = await db.scalar(
            select(Equipment).where(Equipment.barcode_uid == barcode_uid)
        )
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Équipement introuvable."
        )
    return equipment


async def _build_detail(db: DbSession, ticket: TicketReparation) -> TicketDetail:
    """Construit la fiche détaillée d'un ticket (équipement, membres, photos, fil)."""
    equipment = await db.get(Equipment, ticket.equipment_id)
    declarant = await db.get(Membre, ticket.declare_par_membre_id)
    assigne = (
        await db.get(Membre, ticket.assigne_membre_id)
        if ticket.assigne_membre_id is not None
        else None
    )

    photo_rows = (
        await db.scalars(
            select(PhotoPanne)
            .where(PhotoPanne.ticket_id == ticket.id)
            .order_by(PhotoPanne.created_at.asc())
        )
    ).all()

    event_rows = (
        await db.scalars(
            select(EvenementTicket)
            .where(EvenementTicket.ticket_id == ticket.id)
            .order_by(EvenementTicket.created_at.asc())
        )
    ).all()
    auteur_ids = {e.membre_id for e in event_rows}
    auteurs: dict[int, Membre] = {}
    if auteur_ids:
        for m in (
            await db.scalars(select(Membre).where(Membre.id.in_(auteur_ids)))
        ).all():
            auteurs[m.id] = m

    evenements = [
        EvenementRead(
            id=e.id,
            type=e.type,
            commentaire=e.commentaire,
            valeur_avant=e.valeur_avant,
            valeur_apres=e.valeur_apres,
            created_at=e.created_at,
            auteur=_membre_lite(auteurs.get(e.membre_id)),
        )
        for e in event_rows
    ]

    return TicketDetail(
        id=ticket.id,
        equipment_id=ticket.equipment_id,
        equipment_nom=equipment.nom if equipment else "—",
        equipment_barcode=equipment.barcode_uid if equipment else "—",
        avancement=ticket.avancement,
        description_panne=ticket.description_panne,
        cout_estime=ticket.cout_estime,
        date_declaration=ticket.date_declaration,
        date_resolution=ticket.date_resolution,
        declarant=_membre_lite(declarant),
        assigne=_membre_lite(assigne),
        photos=[PhotoRead.model_validate(p) for p in photo_rows],
        evenements=evenements,
    )


async def _maybe_close_equipment(
    db: DbSession, equipment_id: int, user_id: int
) -> None:
    """Si plus aucun ticket ouvert, repasse l'équipement Fonctionnel (+ trace)."""
    open_count = await db.scalar(
        select(func.count(TicketReparation.id)).where(
            TicketReparation.equipment_id == equipment_id,
            TicketReparation.avancement != AvancementTicket.RESOLU,
        )
    )
    if open_count:
        return
    equipment = await db.get(Equipment, equipment_id)
    if equipment is None:
        return
    if equipment.statut_actuel in (
        StatutEquipment.EN_PANNE,
        StatutEquipment.EN_REPARATION,
    ):
        equipment.statut_actuel = StatutEquipment.FONCTIONNEL
        db.add(
            LogScan(
                uuid_client=uuid_lib.uuid4(),
                equipment_id=equipment.id,
                membre_id=user_id,
                type_action=TypeActionScan.CHANGEMENT_STATUT,
                contexte="→ Fonctionnel",
            )
        )


@router.post("", response_model=TicketDetail, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    payload: TicketCreate,
    user: CurrentUser,
    db: DbSession,
) -> TicketDetail:
    """Déclare une panne en ligne (id immédiat). Passe l'équipement En_Panne."""
    equipment = await _resolve_equipment(
        db, payload.equipment_id, payload.barcode_uid
    )
    ticket = TicketReparation(
        uuid_client=uuid_lib.uuid4(),
        equipment_id=equipment.id,
        declare_par_membre_id=user.id,
        description_panne=payload.description_panne,
        cout_estime=payload.cout_estime,
    )
    db.add(ticket)
    if equipment.statut_actuel == StatutEquipment.FONCTIONNEL:
        equipment.statut_actuel = StatutEquipment.EN_PANNE
    await db.commit()
    await db.refresh(ticket)
    return await _build_detail(db, ticket)


@router.get("", response_model=list[TicketListItem])
async def list_tickets(
    user: CurrentUser,
    db: DbSession,
    statut: str = Query(default="ouvert"),
) -> list[TicketListItem]:
    """Liste les tickets. `statut` : "ouvert" (défaut), "tous" ou une valeur d'avancement."""
    stmt = select(TicketReparation).order_by(
        TicketReparation.date_declaration.desc()
    )
    if statut == "ouvert":
        stmt = stmt.where(TicketReparation.avancement != AvancementTicket.RESOLU)
    elif statut != "tous":
        try:
            stmt = stmt.where(
                TicketReparation.avancement == AvancementTicket(statut)
            )
        except ValueError:
            pass

    tickets = (await db.scalars(stmt)).all()
    if not tickets:
        return []

    equipment_ids = {t.equipment_id for t in tickets}
    membre_ids = {t.declare_par_membre_id for t in tickets}
    membre_ids |= {t.assigne_membre_id for t in tickets if t.assigne_membre_id}

    equipments: dict[int, Equipment] = {
        e.id: e
        for e in (
            await db.scalars(
                select(Equipment).where(Equipment.id.in_(equipment_ids))
            )
        ).all()
    }
    membres: dict[int, Membre] = {
        m.id: m
        for m in (
            await db.scalars(select(Membre).where(Membre.id.in_(membre_ids)))
        ).all()
    }
    photo_counts: dict[int, int] = {
        tid: cnt
        for tid, cnt in (
            await db.execute(
                select(PhotoPanne.ticket_id, func.count(PhotoPanne.id))
                .where(PhotoPanne.ticket_id.in_([t.id for t in tickets]))
                .group_by(PhotoPanne.ticket_id)
            )
        ).all()
    }

    items: list[TicketListItem] = []
    for t in tickets:
        eq = equipments.get(t.equipment_id)
        items.append(
            TicketListItem(
                id=t.id,
                equipment_id=t.equipment_id,
                equipment_nom=eq.nom if eq else "—",
                equipment_barcode=eq.barcode_uid if eq else "—",
                avancement=t.avancement,
                description_panne=t.description_panne,
                cout_estime=t.cout_estime,
                date_declaration=t.date_declaration,
                date_resolution=t.date_resolution,
                declarant=_membre_lite(membres.get(t.declare_par_membre_id)),
                assigne=_membre_lite(
                    membres.get(t.assigne_membre_id)
                    if t.assigne_membre_id
                    else None
                ),
                nb_photos=photo_counts.get(t.id, 0),
            )
        )
    return items


@router.get("/{ticket_id}", response_model=TicketDetail)
async def get_ticket(
    ticket_id: int,
    user: CurrentUser,
    db: DbSession,
) -> TicketDetail:
    ticket = await db.get(TicketReparation, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket introuvable."
        )
    return await _build_detail(db, ticket)


@router.patch("/{ticket_id}", response_model=TicketDetail)
async def update_ticket(
    ticket_id: int,
    payload: TicketUpdate,
    user: RequireManage,
    db: DbSession,
) -> TicketDetail:
    """Met à jour l'avancement / le coût / l'assigné et journalise chaque changement."""
    ticket = await db.get(TicketReparation, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket introuvable."
        )

    if payload.avancement is not None and payload.avancement != ticket.avancement:
        ancien = ticket.avancement
        ticket.avancement = payload.avancement
        db.add(
            EvenementTicket(
                ticket_id=ticket.id,
                membre_id=user.id,
                type=TypeEvenementTicket.CHANGEMENT_STATUT,
                valeur_avant=_AVANCEMENT_LABEL[ancien],
                valeur_apres=_AVANCEMENT_LABEL[payload.avancement],
            )
        )
        if payload.avancement == AvancementTicket.RESOLU:
            ticket.date_resolution = datetime.now(timezone.utc)
        else:
            ticket.date_resolution = None

    if payload.cout_estime != ticket.cout_estime:
        ancien_cout = ticket.cout_estime
        ticket.cout_estime = payload.cout_estime
        db.add(
            EvenementTicket(
                ticket_id=ticket.id,
                membre_id=user.id,
                type=TypeEvenementTicket.CHANGEMENT_COUT,
                valeur_avant=None if ancien_cout is None else f"{ancien_cout:g} €",
                valeur_apres=None
                if payload.cout_estime is None
                else f"{payload.cout_estime:g} €",
            )
        )

    if payload.set_assigne and payload.assigne_membre_id != ticket.assigne_membre_id:
        ancien_assigne = (
            await db.get(Membre, ticket.assigne_membre_id)
            if ticket.assigne_membre_id is not None
            else None
        )
        nouvel_assigne = (
            await db.get(Membre, payload.assigne_membre_id)
            if payload.assigne_membre_id is not None
            else None
        )
        if payload.assigne_membre_id is not None and nouvel_assigne is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Membre introuvable."
            )
        ticket.assigne_membre_id = payload.assigne_membre_id
        db.add(
            EvenementTicket(
                ticket_id=ticket.id,
                membre_id=user.id,
                type=TypeEvenementTicket.CHANGEMENT_ASSIGNATION,
                valeur_avant=_membre_nom(ancien_assigne),
                valeur_apres=_membre_nom(nouvel_assigne),
            )
        )

    if ticket.avancement == AvancementTicket.RESOLU:
        await _maybe_close_equipment(db, ticket.equipment_id, user.id)

    await db.commit()
    await db.refresh(ticket)
    return await _build_detail(db, ticket)


@router.post(
    "/{ticket_id}/commentaires",
    response_model=TicketDetail,
    status_code=status.HTTP_201_CREATED,
)
async def add_commentaire(
    ticket_id: int,
    payload: CommentaireCreate,
    user: RequireManage,
    db: DbSession,
) -> TicketDetail:
    """Ajoute un commentaire libre au fil d'activité du ticket."""
    ticket = await db.get(TicketReparation, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket introuvable."
        )
    texte = payload.commentaire.strip()
    if not texte:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Commentaire vide."
        )
    db.add(
        EvenementTicket(
            ticket_id=ticket.id,
            membre_id=user.id,
            type=TypeEvenementTicket.COMMENTAIRE,
            commentaire=texte,
        )
    )
    await db.commit()
    await db.refresh(ticket)
    return await _build_detail(db, ticket)


@router.post(
    "/{ticket_id}/photos",
    response_model=TicketDetail,
    status_code=status.HTTP_201_CREATED,
)
async def add_ticket_photo(
    ticket_id: int,
    user: RequireManage,
    db: DbSession,
    file: UploadFile = File(...),
) -> TicketDetail:
    """Ajoute une photo à un ticket existant (en ligne, depuis la fiche)."""
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format image non supporté (jpeg, png, webp).",
        )
    ticket = await db.get(TicketReparation, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket introuvable."
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image trop volumineuse (max 8 Mo).",
        )

    photos_dir = Path(settings.photos_dir)
    photos_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid_lib.uuid4().hex}{ext}"
    (photos_dir / filename).write_bytes(data)

    db.add(PhotoPanne(ticket_id=ticket.id, membre_id=user.id, chemin=filename))
    db.add(
        EvenementTicket(
            ticket_id=ticket.id,
            membre_id=user.id,
            type=TypeEvenementTicket.AJOUT_PHOTO,
        )
    )
    await db.commit()
    await db.refresh(ticket)
    return await _build_detail(db, ticket)


@router.post(
    "/photos",
    response_model=PhotoRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_photo(
    user: CurrentUser,
    db: DbSession,
    uuid_client: str = Form(...),
    file: UploadFile = File(...),
) -> PhotoPanne:
    """Attache une photo à un ticket déjà synchronisé (identifié par uuid_client)."""
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format image non supporté (jpeg, png, webp).",
        )

    ticket = await db.scalar(
        select(TicketReparation).where(TicketReparation.uuid_client == uuid_client)
    )
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket non synchronisé : réessaie après synchronisation.",
        )

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image trop volumineuse (max 8 Mo).",
        )

    photos_dir = Path(settings.photos_dir)
    photos_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid_lib.uuid4().hex}{ext}"
    (photos_dir / filename).write_bytes(data)

    photo = PhotoPanne(
        ticket_id=ticket.id,
        membre_id=user.id,
        chemin=filename,
    )
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return photo
