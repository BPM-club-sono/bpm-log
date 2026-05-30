"""Planificateur de tâches de fond (APScheduler) et job de relance des prestations.

`presta_overdue` tourne toutes les heures : il détecte les prestations terminées
dont des allocations n'ont pas été intégralement retournées et pousse une
notification au responsable. Un anti-spam mémoire évite de re-notifier une même
prestation tant qu'elle reste en retard.
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.database import async_session_factory
from app.models import AllocationPresta, Prestation
from app.models.enums import StatutAllocation, StatutPrestation
from app.services.push import notify_membre

logger = logging.getLogger("bpm.scheduler")

_scheduler: AsyncIOScheduler | None = None
_notified_prestas: set[int] = set()


async def presta_overdue() -> None:
    """Relance les responsables des prestations terminées avec du matériel non rendu."""
    async with async_session_factory() as db:
        prestas = (
            await db.scalars(
                select(Prestation).where(
                    Prestation.statut == StatutPrestation.TERMINEE
                )
            )
        ).all()

        still_overdue: set[int] = set()
        for presta in prestas:
            allocations = (
                await db.scalars(
                    select(AllocationPresta).where(
                        AllocationPresta.presta_id == presta.id,
                        AllocationPresta.statut != StatutAllocation.RETOURNE,
                    )
                )
            ).all()
            manquants = [
                a
                for a in allocations
                if a.quantite_retournee < a.quantite_sortie
            ]
            if not manquants:
                continue

            still_overdue.add(presta.id)
            if presta.id in _notified_prestas or presta.responsable_membre_id is None:
                continue

            total = sum(a.quantite_sortie - a.quantite_retournee for a in manquants)
            await notify_membre(
                db,
                presta.responsable_membre_id,
                title="Matériel non retourné",
                body=(
                    f"La prestation « {presta.nom} » est terminée mais "
                    f"{total} élément(s) ne sont pas encore rentrés."
                ),
                url="/prestations",
                tag=f"presta-overdue-{presta.id}",
            )
            _notified_prestas.add(presta.id)

        # Réarme l'alerte pour les prestations redevenues en règle.
        _notified_prestas.intersection_update(still_overdue)


def start_scheduler() -> None:
    """Démarre le planificateur (idempotent)."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        presta_overdue,
        trigger="interval",
        hours=1,
        id="presta_overdue",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Planificateur démarré (presta_overdue toutes les heures).")


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
