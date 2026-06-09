"""Test de l'expansion d'un contenant à l'allocation (inclure_contenu).

Session non commitée (rollback en teardown).
"""

import uuid

from app.models import Equipment, EquipmentConsommable
from app.routers.prestations import _standard_descendant_ids


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq


async def test_descendants_standard_excluent_conso(db_session):
    session = db_session
    flight = await _mk_eq(session, "Flight Test")
    lyre1 = await _mk_eq(session, "Lyre 1", contenant_id=flight.id)
    lyre2 = await _mk_eq(session, "Lyre 2", contenant_id=flight.id)
    # Un consommable rangé dans la caisse ne doit PAS être alloué en quantite=1.
    gaffer = await _mk_eq(session, "Gaffer", contenant_id=flight.id)
    session.add(EquipmentConsommable(equipment_id=gaffer.id, stock_actuel=5))
    await session.flush()
    # Sous-contenant imbriqué : ses items doivent remonter (récursif).
    sous = await _mk_eq(session, "Sous-flight", contenant_id=flight.id)
    cable = await _mk_eq(session, "Câble", contenant_id=sous.id)

    ids = set(await _standard_descendant_ids(session, flight.id))
    assert lyre1.id in ids
    assert lyre2.id in ids
    assert sous.id in ids
    assert cable.id in ids  # descendant imbriqué
    assert gaffer.id not in ids  # consommable exclu
