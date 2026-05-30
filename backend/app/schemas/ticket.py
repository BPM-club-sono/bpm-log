"""Schémas tickets de réparation."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, computed_field


class PhotoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    chemin: str
    created_at: datetime

    @computed_field
    @property
    def url(self) -> str:
        """URL publique servie par l'API."""
        return f"/api/photos/{self.chemin}"
