"""Schémas Pydantic pour les abonnements aux notifications Web-Push."""

from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    """Reflète l'objet renvoyé par `PushSubscription.toJSON()` côté navigateur."""

    endpoint: str
    keys: PushKeys
    expiration_time: int | None = Field(default=None, alias="expirationTime")


class VapidKeyOut(BaseModel):
    public_key: str


class SubscribeResult(BaseModel):
    status: str
