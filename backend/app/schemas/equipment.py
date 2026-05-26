from typing import List, Optional
from pydantic import BaseModel, ConfigDict

class BulkContentBase(BaseModel):
    item_name: str
    expected_quantity: int
    actual_quantity: int

class BulkContentCreate(BulkContentBase):
    pass

class BulkContentRead(BulkContentBase):
    id: int
    equipment_id: str

    model_config = ConfigDict(from_attributes=True)


class EquipmentBase(BaseModel):
    id: str
    name: str
    category: str
    status: str = "Disponible"
    type: str = "Individuel"
    is_bulk: bool = False

class EquipmentCreate(EquipmentBase):
    bulk_contents: Optional[List[BulkContentCreate]] = None

class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
    is_bulk: Optional[bool] = None

class EquipmentRead(EquipmentBase):
    bulk_contents: List[BulkContentRead] = []

    model_config = ConfigDict(from_attributes=True)
