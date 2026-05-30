"""Envoi de notifications Web-Push (VAPID) aux abonnements des membres.

`pywebpush` est synchrone (basé sur `requests`) : les appels réseau sont
déportés dans un thread pour ne pas bloquer la boucle asyncio. Un abonnement
expiré (404/410) est supprimé automatiquement de la base.
"""

import asyncio
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Membre, PushSubscription
from app.models.enums import RoleMembre

logger = logging.getLogger("bpm.push")


def _vapid_claims() -> dict[str, str]:
    return {"sub": settings.vapid_subject}


def _send_sync(subscription_info: dict[str, object], payload: str) -> None:
    webpush(
        subscription_info=subscription_info,
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims=_vapid_claims(),
    )


async def _push_to_subscription(
    db: AsyncSession, sub: PushSubscription, payload: str
) -> bool:
    """Envoie le payload à un abonnement. Retourne False si l'abonnement est mort."""
    subscription_info = {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
    }
    try:
        await asyncio.to_thread(_send_sync, subscription_info, payload)
        return True
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            await db.delete(sub)
            return False
        logger.warning("Échec push (%s) : %s", status, exc)
        return True
    except Exception:  # noqa: BLE001 - une notification ne doit jamais casser le flux
        logger.exception("Erreur inattendue lors de l'envoi push")
        return True


async def notify_membre(
    db: AsyncSession,
    membre_id: int,
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
) -> int:
    """Pousse une notification à tous les appareils d'un membre. Retourne le nb d'envois."""
    if not settings.vapid_private_key:
        logger.info("VAPID non configuré : notification ignorée.")
        return 0

    subs = (
        await db.scalars(
            select(PushSubscription).where(PushSubscription.membre_id == membre_id)
        )
    ).all()
    if not subs:
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    for sub in subs:
        if await _push_to_subscription(db, sub, payload):
            sent += 1
    await db.commit()
    return sent


async def notify_role(
    db: AsyncSession,
    role: RoleMembre,
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
) -> int:
    """Pousse une notification à tous les membres d'un rôle donné."""
    membres = (
        await db.scalars(select(Membre.id).where(Membre.role == role))
    ).all()
    total = 0
    for membre_id in membres:
        total += await notify_membre(
            db, membre_id, title=title, body=body, url=url, tag=tag
        )
    return total
