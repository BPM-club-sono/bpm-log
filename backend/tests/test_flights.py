"""Tests du marquage flight (est_contenant) : cible de rangement et transitions.

Session non commitée (rollback en teardown) pour ne pas polluer la base. On
exerce directement les helpers du routeur équipement, comme test_contenants.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models import Equipment, EquipmentVrac
from app.routers.equipment import _apply_est_contenant, _ensure_flight


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq


async def test_ensure_flight(db_session):
    session = db_session
    flight = await _mk_eq(session, "Flight Test", est_contenant=True)
    lyre = await _mk_eq(session, "Lyre Test")

    # Cible valide : renvoie le contenant.
    assert (await _ensure_flight(session, flight.id)).id == flight.id

    # Cible non-flight : 400.
    with pytest.raises(HTTPException) as exc:
        await _ensure_flight(session, lyre.id)
    assert exc.value.status_code == 400

    # Cible inexistante : 404.
    with pytest.raises(HTTPException) as exc_404:
        await _ensure_flight(session, 99_999_999)
    assert exc_404.value.status_code == 404


async def test_apply_est_contenant_transitions(db_session):
    session = db_session

    # Marquer un standard : OK ; démarquer un flight vide : OK.
    lyre = await _mk_eq(session, "Lyre Test")
    await _apply_est_contenant(session, lyre, True)
    assert lyre.est_contenant is True
    await _apply_est_contenant(session, lyre, False)
    assert lyre.est_contenant is False

    # Démarquer un flight qui contient encore du matériel : 409.
    flight = await _mk_eq(session, "Flight Test", est_contenant=True)
    await _mk_eq(session, "Ampli Test", contenant_id=flight.id)
    with pytest.raises(HTTPException) as exc:
        await _apply_est_contenant(session, flight, False)
    assert exc.value.status_code == 409
    assert flight.est_contenant is True

    # Marquer un vrac : 400 (seul un équipement standard peut être un flight).
    caisse = await _mk_eq(session, "Caisse Vrac Test")
    session.add(EquipmentVrac(equipment_id=caisse.id, quantite_theorique=10))
    await session.flush()
    with pytest.raises(HTTPException) as exc_vrac:
        await _apply_est_contenant(session, caisse, True)
    assert exc_vrac.value.status_code == 400
    assert caisse.est_contenant is False
