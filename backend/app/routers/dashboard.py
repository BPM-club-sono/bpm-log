"""Route tableau de bord d'accueil : santé du parc, presta courante, activité globale.

Un seul appel `GET /api/dashboard` agrège les indicateurs du parc, la prestation
en cours (ou la prochaine à venir) et un fil d'activité global récent
(scans, changements de statut, réparations) limité aux dernières actions.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession
from app.models import (
    AllocationPresta,
    Equipment,
    EquipmentConsommable,
    EvenementTicket,
    LogScan,
    Membre,
    Prestation,
    TicketReparation,
)
from app.models.enums import (
    AvancementTicket,
    StatutEquipment,
    StatutPrestation,
    TypeActionScan,
    TypeEvenementTicket,
)
from app.schemas.dashboard import (
    ActiviteItem,
    DashboardOut,
    ParcStats,
    PrestationCourante,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_ACTIVITE_LIMIT = 40

# Types de scan retenus dans le fil (l'inventaire vrac est exclu).
_SCAN_CATEGORIE = {
    TypeActionScan.SCAN_ENTREE: "scan",
    TypeActionScan.SCAN_SORTIE: "scan",
    TypeActionScan.CHANGEMENT_STATUT: "statut",
}
_SCAN_TITRE = {
    TypeActionScan.SCAN_ENTREE: "Entrée matériel",
    TypeActionScan.SCAN_SORTIE: "Sortie matériel",
    TypeActionScan.CHANGEMENT_STATUT: "Changement de statut",
}
_EVENT_TITRE = {
    TypeEvenementTicket.COMMENTAIRE: "Commentaire",
    TypeEvenementTicket.CHANGEMENT_STATUT: "Avancement modifié",
    TypeEvenementTicket.CHANGEMENT_COUT: "Coût modifié",
    TypeEvenementTicket.AJOUT_PHOTO: "Photo ajoutée",
    TypeEvenementTicket.CHANGEMENT_ASSIGNATION: "Assignation modifiée",
}


def _membre_nom(m: Membre | None) -> str | None:
    if m is None:
        return None
    return " ".join(p for p in (m.prenom, m.nom) if p) or None


def _tronque(texte: str | None, limite: int = 80) -> str | None:
    if not texte:
        return None
    texte = texte.strip()
    return texte if len(texte) <= limite else texte[: limite - 1] + "…"


async def _parc_stats(db: DbSession) -> ParcStats:
    """Compteurs par statut sur le parc actif (non archivé, non réformé)."""
    rows = (
        await db.execute(
            select(Equipment.statut_actuel, func.count(Equipment.id))
            .where(Equipment.archive.is_(False))
            .group_by(Equipment.statut_actuel)
        )
    ).all()
    counts = {statut: cnt for statut, cnt in rows}
    fonctionnel = counts.get(StatutEquipment.FONCTIONNEL, 0)
    en_panne = counts.get(StatutEquipment.EN_PANNE, 0)
    en_reparation = counts.get(StatutEquipment.EN_REPARATION, 0)
    perdu = counts.get(StatutEquipment.PERDU, 0)
    total_actif = fonctionnel + en_panne + en_reparation + perdu
    pourcentage = round(fonctionnel / total_actif * 100) if total_actif else 100

    tickets_non_assignes = await db.scalar(
        select(func.count(TicketReparation.id)).where(
            TicketReparation.avancement != AvancementTicket.RESOLU,
            TicketReparation.assigne_membre_id.is_(None),
        )
    )
    tickets_ouverts = await db.scalar(
        select(func.count(TicketReparation.id)).where(
            TicketReparation.avancement != AvancementTicket.RESOLU,
        )
    )
    consommables_sous_seuil = await db.scalar(
        select(func.count(EquipmentConsommable.equipment_id)).where(
            EquipmentConsommable.stock_actuel <= EquipmentConsommable.seuil_alerte
        )
    )

    return ParcStats(
        total_actif=total_actif,
        fonctionnel=fonctionnel,
        en_panne=en_panne,
        en_reparation=en_reparation,
        perdu=perdu,
        pourcentage_sante=pourcentage,
        tickets_ouverts=int(tickets_ouverts or 0),
        tickets_non_assignes=int(tickets_non_assignes or 0),
        consommables_sous_seuil=int(consommables_sous_seuil or 0),
    )


async def _prestation_courante(db: DbSession) -> PrestationCourante | None:
    """Prestation en cours ; à défaut la prochaine à venir (en préparation)."""
    a_venir = False
    presta = await db.scalar(
        select(Prestation)
        .where(Prestation.statut == StatutPrestation.EN_COURS)
        .order_by(Prestation.date_debut.asc())
        .limit(1)
    )
    if presta is None:
        a_venir = True
        presta = await db.scalar(
            select(Prestation)
            .where(Prestation.statut == StatutPrestation.EN_PREPARATION)
            .order_by(Prestation.date_debut.asc().nulls_last())
            .limit(1)
        )
    if presta is None:
        return None

    nb_objets = await db.scalar(
        select(func.count(AllocationPresta.id)).where(
            AllocationPresta.presta_id == presta.id
        )
    )
    responsable = (
        await db.get(Membre, presta.responsable_membre_id)
        if presta.responsable_membre_id
        else None
    )

    return PrestationCourante(
        id=presta.id,
        nom=presta.nom,
        type=presta.type,
        client_nom=presta.client_nom,
        date_debut=presta.date_debut,
        date_fin=presta.date_fin,
        statut=presta.statut,
        responsable_nom=_membre_nom(responsable),
        nb_objets=int(nb_objets or 0),
        a_venir=a_venir,
    )


async def _activite(db: DbSession) -> list[ActiviteItem]:
    """Fil global fusionné : scans/statuts + déclarations + événements de tickets."""
    logs = list(
        (
            await db.scalars(
                select(LogScan)
                .where(LogScan.type_action.in_(list(_SCAN_CATEGORIE)))
                .order_by(LogScan.date_scan.desc())
                .limit(_ACTIVITE_LIMIT)
            )
        ).all()
    )
    tickets = list(
        (
            await db.scalars(
                select(TicketReparation)
                .order_by(TicketReparation.date_declaration.desc())
                .limit(_ACTIVITE_LIMIT)
            )
        ).all()
    )
    events = list(
        (
            await db.scalars(
                select(EvenementTicket)
                .order_by(EvenementTicket.created_at.desc())
                .limit(_ACTIVITE_LIMIT)
            )
        ).all()
    )

    # Résolution des tickets référencés par les événements (pour l'équipement).
    ticket_map = {t.id: t for t in tickets}
    missing_ticket_ids = {e.ticket_id for e in events} - set(ticket_map)
    if missing_ticket_ids:
        for t in (
            await db.scalars(
                select(TicketReparation).where(
                    TicketReparation.id.in_(missing_ticket_ids)
                )
            )
        ).all():
            ticket_map[t.id] = t

    equipment_ids = {log.equipment_id for log in logs}
    equipment_ids |= {t.equipment_id for t in ticket_map.values()}
    membre_ids = {log.membre_id for log in logs}
    membre_ids |= {t.declare_par_membre_id for t in tickets}
    membre_ids |= {e.membre_id for e in events}

    equipments = {
        e.id: e
        for e in (
            await db.scalars(select(Equipment).where(Equipment.id.in_(equipment_ids)))
        ).all()
    }
    membres = {
        m.id: m
        for m in (
            await db.scalars(select(Membre).where(Membre.id.in_(membre_ids)))
        ).all()
    }

    def eq_nom(eid: int | None) -> str:
        eq = equipments.get(eid) if eid else None
        return eq.nom if eq else "—"

    items: list[ActiviteItem] = []

    for log in logs:
        items.append(
            ActiviteItem(
                id=f"scan-{log.id}",
                categorie=_SCAN_CATEGORIE[log.type_action],
                titre=_SCAN_TITRE[log.type_action],
                equipment_id=log.equipment_id,
                equipment_nom=eq_nom(log.equipment_id),
                membre_nom=_membre_nom(membres.get(log.membre_id)),
                contexte=_tronque(log.contexte),
                date=log.date_scan,
                ticket_id=None,
            )
        )

    for t in tickets:
        items.append(
            ActiviteItem(
                id=f"ticket-{t.id}",
                categorie="reparation",
                titre="Panne déclarée",
                equipment_id=t.equipment_id,
                equipment_nom=eq_nom(t.equipment_id),
                membre_nom=_membre_nom(membres.get(t.declare_par_membre_id)),
                contexte=_tronque(t.description_panne),
                date=t.date_declaration,
                ticket_id=t.id,
            )
        )

    for ev in events:
        ticket = ticket_map.get(ev.ticket_id)
        equipment_id = ticket.equipment_id if ticket else 0
        if ev.type == TypeEvenementTicket.COMMENTAIRE:
            contexte = _tronque(ev.commentaire)
        elif ev.valeur_avant or ev.valeur_apres:
            contexte = f"{ev.valeur_avant or '—'} → {ev.valeur_apres or '—'}"
        else:
            contexte = _tronque(ev.commentaire)
        items.append(
            ActiviteItem(
                id=f"event-{ev.id}",
                categorie="reparation",
                titre=_EVENT_TITRE.get(ev.type, "Activité réparation"),
                equipment_id=equipment_id,
                equipment_nom=eq_nom(equipment_id),
                membre_nom=_membre_nom(membres.get(ev.membre_id)),
                contexte=contexte,
                date=ev.created_at,
                ticket_id=ev.ticket_id,
            )
        )

    items.sort(key=lambda i: i.date, reverse=True)
    return items[:_ACTIVITE_LIMIT]


@router.get("", response_model=DashboardOut)
async def get_dashboard(_user: CurrentUser, db: DbSession) -> DashboardOut:
    """Agrège santé du parc, prestation courante et activité récente."""
    return DashboardOut(
        parc=await _parc_stats(db),
        prestation=await _prestation_courante(db),
        activite=await _activite(db),
    )
