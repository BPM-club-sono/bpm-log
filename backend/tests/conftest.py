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

from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
