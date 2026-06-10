"""Test de l'enrichissement prestataire des allocations (_location_map).

Session non commitée (rollback en teardown).
"""

import uuid

from app.models import Equipment, EquipmentLocation, Fournisseur
from app.routers.prestations import _location_map


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq


async def test_location_map_lie_equipement_a_son_prestataire(db_session):
    session = db_session
    fournisseur = Fournisseur(nom="Trocadéro")
    session.add(fournisseur)
    await session.flush()

    loue = await _mk_eq(session, "Enceinte louée")
    session.add(
        EquipmentLocation(equipment_id=loue.id, fournisseur_id=fournisseur.id)
    )
    bpm = await _mk_eq(session, "Enceinte BPM")
    await session.flush()

    loc_map = await _location_map(session)

    assert loc_map.get(loue.id) == (fournisseur.id, "Trocadéro")
    assert bpm.id not in loc_map  # matériel BPM : pas de prestataire
