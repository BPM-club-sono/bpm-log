"""Tests du handler de synchronisation `deplacement` (re-parentage offline).

Session non commitée (rollback en teardown) pour ne pas polluer la base.
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.models import Emplacement, Equipment
from app.routers.sync import _apply_deplacement, _Conflict
from app.schemas.sync import SyncItemIn


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    eq = Equipment(barcode_uid=f"test-{uuid.uuid4().hex}", nom=nom, **kw)
    session.add(eq)
    await session.flush()
    return eq


def _item(payload: dict) -> SyncItemIn:
    return SyncItemIn(
        uuid_client=uuid.uuid4(),
        type="deplacement",
        offline_created_at=datetime.now(UTC),
        payload=payload,
    )


async def test_deplacement_dans_contenant_et_idempotence(db_session):
    session = db_session
    etagere = Emplacement(nom="Étagère Test")
    session.add(etagere)
    await session.flush()
    flight = await _mk_eq(
        session, "Flight Test", emplacement_id=etagere.id, est_contenant=True
    )
    lyre = await _mk_eq(session, "Lyre Test", emplacement_id=etagere.id)

    item = _item({"equipment_id": lyre.id, "contenant_destination_id": flight.id})

    # 1er passage : range la lyre dans le flight, efface l'emplacement fixe.
    assert await _apply_deplacement(session, item, membre_id=1) is True
    assert lyre.contenant_id == flight.id
    assert lyre.emplacement_id is None

    # Rejouer le même uuid_client est un no-op (idempotence).
    assert await _apply_deplacement(session, item, membre_id=1) is False

    # Déplacement inverse vers un emplacement : efface le contenant.
    back = _item({"equipment_id": lyre.id, "emplacement_destination_id": etagere.id})
    assert await _apply_deplacement(session, back, membre_id=1) is True
    assert lyre.emplacement_id == etagere.id
    assert lyre.contenant_id is None


async def test_deplacement_boucle_refusee(db_session):
    session = db_session
    flight = await _mk_eq(session, "Flight Test", est_contenant=True)
    sous_flight = await _mk_eq(
        session, "Sous-flight Test", contenant_id=flight.id, est_contenant=True
    )

    # Ranger le flight DANS son propre enfant doit lever un conflit.
    item = _item({"equipment_id": flight.id, "contenant_destination_id": sous_flight.id})
    with pytest.raises(_Conflict):
        await _apply_deplacement(session, item, membre_id=1)


async def test_deplacement_vers_non_flight_refuse(db_session):
    session = db_session
    lyre = await _mk_eq(session, "Lyre Test")
    ampli = await _mk_eq(session, "Ampli Test")

    # La destination n'est pas un flight (est_contenant=False) : conflit arbitrable.
    item = _item({"equipment_id": ampli.id, "contenant_destination_id": lyre.id})
    with pytest.raises(_Conflict):
        await _apply_deplacement(session, item, membre_id=1)
    assert ampli.contenant_id is None
