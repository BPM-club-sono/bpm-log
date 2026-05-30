"""Schémas vrac & consommables (M7)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ConsommableRead(BaseModel):
    """Un consommable avec son stock courant et son seuil d'alerte."""

    equipment_id: int
    nom: str
    barcode_uid: str
    stock_actuel: int
    seuil_alerte: int
    unite: str | None
    en_alerte: bool


class VracLock(BaseModel):
    """État du verrou d'inventaire d'une caisse vrac."""

    membre_id: int
    membre_nom: str | None
    expires_at: datetime
    is_mine: bool


class VracRead(BaseModel):
    """Une caisse vrac avec sa quantité théorique et constatée."""

    equipment_id: int
    nom: str
    barcode_uid: str
    quantite_theorique: int
    quantite_actuelle: int
    ecart: int
    lock: VracLock | None


class InventaireEntry(BaseModel):
    """Une ligne d'historique d'inventaire (delta unitaire daté et signé)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    membre_id: int
    membre_nom: str | None
    delta: int
    note: str | None
    presta_id: int | None
    date: datetime


class VracDetail(VracRead):
    historique: list[InventaireEntry]


class LockResult(BaseModel):
    """Résultat d'une acquisition de verrou."""

    equipment_id: int
    expires_at: datetime
