"""Routes notifications push : clé publique VAPID et gestion des abonnements."""

from fastapi import APIRouter, status
from sqlalchemy import select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import PushSubscription
from app.schemas.notification import (
    PushSubscriptionIn,
    SubscribeResult,
    VapidKeyOut,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/vapid-public-key", response_model=VapidKeyOut)
async def vapid_public_key() -> VapidKeyOut:
    """Clé publique VAPID utilisée comme `applicationServerKey` côté navigateur."""
    return VapidKeyOut(public_key=settings.vapid_public_key)


@router.post(
    "/subscribe",
    response_model=SubscribeResult,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe(
    payload: PushSubscriptionIn,
    user: CurrentUser,
    db: DbSession,
) -> SubscribeResult:
    """Enregistre (ou réassocie) un abonnement push pour le membre courant.

    Idempotent sur l'`endpoint` : un même appareil ne crée pas de doublon et est
    réattribué au membre connecté si nécessaire (changement de compte sur l'appareil).
    """
    existing = await db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint
        )
    )
    if existing is not None:
        existing.membre_id = user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        await db.commit()
        return SubscribeResult(status="updated")

    db.add(
        PushSubscription(
            membre_id=user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
    )
    await db.commit()
    return SubscribeResult(status="created")


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    payload: PushSubscriptionIn,
    user: CurrentUser,
    db: DbSession,
) -> None:
    """Supprime l'abonnement correspondant à l'endpoint (désinscription appareil)."""
    sub = await db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.membre_id == user.id,
        )
    )
    if sub is not None:
        await db.delete(sub)
        await db.commit()
