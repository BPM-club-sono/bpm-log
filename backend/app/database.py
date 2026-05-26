from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.config import settings

# Création du moteur de base de données asynchrone PostgreSQL (via asyncpg)
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=True,  # Utile en débug pour voir les requêtes SQL s'exécuter
    future=True
)

# Fabrique de sessions asynchrones
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Classe de base pour la déclaration des modèles SQLAlchemy
Base = declarative_base()

# Dépendance FastAPI pour obtenir une session de BDD asynchrone par requête
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
