"""Schémas du moteur de synchronisation offline (POST /sync/batch)."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SyncItemType = Literal["ticket_reparation", "log_scan", "presta_check"]


class SyncItemIn(BaseModel):
    """Un item de la file de synchronisation côté client."""

    uuid_client: UUID
    type: SyncItemType
    offline_created_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncBatchIn(BaseModel):
    items: list[SyncItemIn]


class SyncConflict(BaseModel):
    uuid_client: UUID
    reason: str


class SyncBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    applied: list[UUID]
    conflicts: list[SyncConflict]
