"""Création en série : numérotation des noms."""

import uuid

from conftest import make_equipment

from app.services.serie import noms_serie, prochain_numero


def test_prochain_numero_reprend_apres_le_max():
    assert prochain_numero(["MH 1", "MH 6", "MH 3"], "MH") == 7
    assert prochain_numero([], "MH") == 1


def test_noms_serie_correspondance_exacte():
    assert prochain_numero(["MH", "MH 1a", "MHX 3", "MH 2 bis", "MH (2) 4"], "MH") == 1
    assert prochain_numero(["MH (2) 4"], "MH (2)") == 5


async def test_noms_serie_compte_les_archives(db_session):
    base = f"Base {uuid.uuid4().hex[:6]}"
    await make_equipment(db_session, f"{base} 4", archive=True)
    assert await noms_serie(db_session, f"  {base} ", 2) == [f"{base} 5", f"{base} 6"]


async def test_noms_serie_prend_le_verrou(db_session, monkeypatch):
    requetes: list[str] = []
    execute = db_session.execute

    async def espion(stmt, *a, **kw):
        requetes.append(str(stmt))
        return await execute(stmt, *a, **kw)

    monkeypatch.setattr(db_session, "execute", espion)
    await noms_serie(db_session, f"V {uuid.uuid4().hex[:6]}", 1)
    assert any("pg_advisory_xact_lock" in r for r in requetes)
