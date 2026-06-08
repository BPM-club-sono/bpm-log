"""Fixtures de test backend.

On configure l'environnement AVANT d'importer l'app pour éviter tout effet de
bord (création du dossier photos dans /var, démarrage du scheduler, etc.).
"""

import os
import tempfile

import pytest

# Doit être défini avant l'import de app.* (settings est mis en cache au import).
os.environ.setdefault("PHOTOS_DIR", tempfile.mkdtemp(prefix="bpm-photos-"))
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://bpm:bpm@localhost:5432/bpm_log"
)

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def db_session():
    """Session DB jetable, liée à la loop du test (NullPool) et rollback en fin.

    On crée un moteur dédié par test : le pool global de l'app garderait des
    connexions liées à une autre event loop (-> 'Event loop is closed' en teardown).
    Aucune écriture n'est commitée : la base de dev n'est pas polluée.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        await session.rollback()
        await session.close()
        await engine.dispose()
