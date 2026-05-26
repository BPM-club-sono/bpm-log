import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict

class MovementLogBase(BaseModel):
    id: str  # UUID généré par le client
    equipment_id: str
    action: str
    details: Optional[str] = None
    offline_created_at: datetime.datetime

class MovementLogCreate(MovementLogBase):
    pass

class MovementLogRead(MovementLogBase):
    timestamp: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


# Schema du batch envoyé par le client lors du rétablissement de la connexion
class SyncQueueBatch(BaseModel):
    movements: List[MovementLogCreate]
