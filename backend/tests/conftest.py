"""Fixtures de test backend.

On configure l'environnement AVANT d'importer l'app pour éviter tout effet de
bord (création du dossier photos dans /var, démarrage du scheduler, etc.).
"""

import os
import tempfile
import uuid
from contextlib import contextmanager

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
from app.database import get_db  # noqa: E402
from app.deps import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Equipment, Membre  # noqa: E402
from app.models.enums import RoleMembre  # noqa: E402
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


@pytest.fixture
async def membre_id(db_session) -> int:
    """Auteur des événements rejoués : un membre jetable, rollback avec la session.

    Ne jamais supposer qu'un membre d'id 1 existe : c'est vrai sur la base de dev,
    pas sur la base vierge de la CI.
    """
    membre = Membre(email=f"test-{uuid.uuid4().hex[:8]}@test.local", role=RoleMembre.STAFF)
    db_session.add(membre)
    await db_session.flush()
    return membre.id


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


def routes_montees():
    """(chemin complet, méthodes, endpoint) des routes de l'app.

    FastAPI garde les routeurs inclus imbriqués : on parcourt `original_router`.
    """
    for incl in app.routes:
        routeur = getattr(incl, "original_router", None)
        if routeur is None:
            continue
        prefixe = incl.include_context.prefix
        for route in routeur.routes:
            yield prefixe + route.path, route.methods or set(), route.endpoint


@contextmanager
def surcharger_app(session, membre):
    """Branche l'app sur `session` et authentifie `membre`, sans jeton ni commit réel.

    Ne retire à la sortie que les deux surcharges posées ici.
    """

    async def _get_db():
        yield session

    async def _get_current_user():
        return membre

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = _get_current_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
async def staff_import(db_session, membre_id) -> Membre:
    """Le membre Staff jetable de `membre_id`, utilisé par les tests d'import."""
    return await db_session.get(Membre, membre_id)


@pytest.fixture
async def api_import(db_session, staff_import):
    """Client HTTP (base `/api`) branché sur `db_session`, connecté en Staff."""
    with surcharger_app(db_session, staff_import):
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test/api") as c:
            yield c
