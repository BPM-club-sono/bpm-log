"""Tests des locations sur une prestation : enrichissement prestataire des
allocations (_location_map) et retour d'une location au pointage.

Session non commitée (rollback en teardown).
"""

import uuid
from datetime import UTC, datetime

from conftest import make_equipment

from app.models import AllocationPresta, Equipment, EquipmentLocation, Fournisseur, Prestation
from app.models.enums import StatutAllocation, StatutPrestation, TypePrestation
from app.routers.prestations import _location_map
from app.routers.sync import _apply_presta_check
from app.schemas.sync import SyncItemIn


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    return await make_equipment(session, nom, **kw)


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


def _check(presta: Prestation, eq: Equipment, sens: str) -> SyncItemIn:
    return SyncItemIn(
        uuid_client=uuid.uuid4(),
        type="presta_check",
        offline_created_at=datetime.now(UTC),
        payload={"presta_id": presta.id, "equipment_id": eq.id, "sens": sens, "delta": 1},
    )


async def test_retour_d_une_location_ne_l_archive_pas(db_session, membre_id):
    """L'archivage d'une location reste un geste : le retour au pointage ne la masque pas."""
    session = db_session
    fournisseur = Fournisseur(nom="Loueur retour")
    session.add(fournisseur)
    await session.flush()
    loue = await _mk_eq(session, "Lyre louée rendue")
    session.add(EquipmentLocation(equipment_id=loue.id, fournisseur_id=fournisseur.id))
    presta = Prestation(
        nom="Presta retour location",
        type=TypePrestation.EXTERNE,
        statut=StatutPrestation.EBAUCHE,
    )
    session.add(presta)
    await session.flush()
    alloc = AllocationPresta(
        presta_id=presta.id,
        equipment_id=loue.id,
        quantite=1,
        statut=StatutAllocation.PLANIFIE,
    )
    session.add(alloc)
    await session.flush()

    assert await _apply_presta_check(session, _check(presta, loue, "sortie"), membre_id)
    assert await _apply_presta_check(session, _check(presta, loue, "retour"), membre_id)

    assert alloc.statut == StatutAllocation.RETOURNE
    assert loue.archive is False
