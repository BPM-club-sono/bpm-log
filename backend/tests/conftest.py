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
from app.models import Equipment  # noqa: E402
from app.services import barcode, references  # noqa: E402


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

    Aucune écriture n'est commitée, **même quand un routeur appelle `commit()`** :
    la session vit dans une transaction externe ouverte ici, et ses `commit()` ne
    font que relâcher un savepoint (`join_transaction_mode="create_savepoint"`).
    Sans ça, un test qui vide une table avant d'appeler un routeur la vide pour de
    bon dans la base de dev.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    conn = await engine.connect()
    outer = await conn.begin()
    factory = async_sessionmaker(
        bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    session = factory()
    try:
        yield session
    finally:
        await session.close()
        await outer.rollback()
        await conn.close()
        await engine.dispose()


async def make_equipment(session, nom: str, **kw) -> Equipment:
    """Crée un équipement de test avec une référence conforme au format imprimable.

    Le numéro est tiré de la vraie séquence plutôt que d'un compteur de module :
    un compteur deviendrait collisionnant dès qu'on ajouterait `pytest-xdist`, et
    ce genre de flakiness coûte cher à diagnostiquer. La contrainte CHECK est
    vérifiée au `flush()` par PostgreSQL, même si le test finit en rollback.
    """
    eq_id, reference = await references.reserver(session, barcode.PREFIXE_TEST)
    eq = Equipment(id=eq_id, barcode_uid=reference, nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq
