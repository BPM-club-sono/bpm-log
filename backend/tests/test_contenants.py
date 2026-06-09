"""Tests des contenants imbriqués : chemin de localisation, contenu, anti-boucle.

On travaille dans une session non commitée (rollback en teardown) pour ne pas
polluer la base de dev. On exerce directement les helpers du routeur équipement.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models import Emplacement, Equipment
from app.routers.equipment import _build_contenu, _check_no_cycle, _compute_chemin


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq


async def test_chemin_contenu_et_anti_boucle(db_session):
    session = db_session
    # Dépôt > Étagère (emplacements imbriqués)
    depot = Emplacement(nom="Dépôt Test")
    session.add(depot)
    await session.flush()
    etagere = Emplacement(nom="Étagère Test", parent_id=depot.id)
    session.add(etagere)
    await session.flush()

    # Flight Test sur l'Étagère, contenant une Lyre Test
    flight = await _mk_eq(session, "Flight Test", emplacement_id=etagere.id)
    lyre = await _mk_eq(session, "Lyre Test", contenant_id=flight.id)

    # Contenu : le flight contient la lyre
    contenu = await _build_contenu(session, flight.id)
    assert [c.id for c in contenu] == [lyre.id]
    assert contenu[0].nom == "Lyre Test"

    # Chemin de la lyre : Dépôt > Étagère > Flight (exclut la lyre elle-même)
    chemin = await _compute_chemin(session, lyre)
    assert [seg.nom for seg in chemin] == ["Dépôt Test", "Étagère Test", "Flight Test"]
    assert [seg.kind for seg in chemin] == ["emplacement", "emplacement", "contenant"]

    # Anti-boucle : ranger le flight DANS la lyre (son enfant) doit échouer
    with pytest.raises(HTTPException) as exc:
        await _check_no_cycle(session, flight.id, lyre.id)
    assert exc.value.status_code == 409

    # Anti-boucle : se contenir soi-même doit échouer
    with pytest.raises(HTTPException) as exc_self:
        await _check_no_cycle(session, flight.id, flight.id)
    assert exc_self.value.status_code == 409

    # Cas valide : ranger un nouvel item dans le flight ne lève rien
    await _check_no_cycle(session, None, flight.id)
