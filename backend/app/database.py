"""Configuration du moteur SQLAlchemy asynchrone et de la session."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncAttrs,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(AsyncAttrs, DeclarativeBase):
    """Classe de base pour tous les modèles ORM."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dépendance FastAPI : fournit une session de base de données par requête."""
    async with async_session_factory() as session:
        yield session
