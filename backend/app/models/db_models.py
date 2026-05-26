import datetime
from typing import List, Optional
from sqlalchemy import String, Boolean, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

class Equipment(Base):
    __tablename__ = "equipment"

    # ex: 'BPM-EQ-001' ou 'BPM-BOX-XLR'
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    
    # ex: 'Disponible', 'En Service', 'En Réparation', 'Stocké'
    status: Mapped[str] = mapped_column(String(50), default="Disponible", nullable=False)
    
    # ex: 'Individuel', 'Vrac'
    type: Mapped[str] = mapped_column(String(30), default="Individuel", nullable=False)
    is_bulk: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # Relations
    bulk_contents: Mapped[List["BulkContent"]] = relationship(
        "BulkContent", 
        back_populates="equipment", 
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    movement_logs: Mapped[List["MovementLog"]] = relationship(
        "MovementLog", 
        back_populates="equipment",
        cascade="all, delete-orphan",
        lazy="raise"
    )


class BulkContent(Base):
    __tablename__ = "bulk_contents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    equipment_id: Mapped[str] = mapped_column(String(50), ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False)
    
    item_name: Mapped[str] = mapped_column(String(100), nullable=False)
    expected_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    actual_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relations
    equipment: Mapped["Equipment"] = relationship("Equipment", back_populates="bulk_contents")


class MovementLog(Base):
    __tablename__ = "movement_logs"

    # UUID client (ex: 'mv-a3f29b...') pour garantir l'idempotence des transactions
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    equipment_id: Mapped[str] = mapped_column(String(50), ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False)
    
    # ex: 'SORTIE', 'ENTRÉE', 'PANNE'
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    
    # Horodatage serveur de réception
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), 
        default=datetime.datetime.now, 
        nullable=False
    )
    
    # Détails sous format JSON (ex: checklist de vrac validée)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Horodatage client de l'action physique réelle (Offline-first)
    offline_created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False
    )

    # Relations
    equipment: Mapped["Equipment"] = relationship("Equipment", back_populates="movement_logs")
