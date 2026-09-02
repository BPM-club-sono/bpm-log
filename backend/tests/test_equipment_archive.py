"""Tests de l'archivage en cascade et des garde-fous de la suppression définitive.

Comme pour les contenants et les emplacements, on exerce directement les fonctions
du routeur dans une session non commitée : seuls les chemins qui lèvent avant
`commit()` sont testés, la base de dev n'est donc pas polluée. Le seul test qui
laisse passer un `commit()` (`test_delete_ok…`) ne crée que l'équipement qu'il
supprime : après le commit il ne reste rien en base.
"""

import uuid

import pytest
from conftest import make_equipment
from fastapi import HTTPException

from app.models import (
    Equipment,
    EquipmentVrac,
    LogScan,
    Membre,
    TicketReparation,
)
from app.models.enums import RoleMembre, TypeActionScan
from app.routers.equipment import (
    _archiver_cascade,
    delete_equipment,
    desarchiver_equipment,
)


async def _mk_eq(session, nom: str, **kw) -> Equipment:
    return await make_equipment(session, nom, **kw)


async def _mk_membre(session) -> Membre:
    membre = Membre(
        email=f"archive-{uuid.uuid4()}@test.local", role=RoleMembre.TECH
    )
    session.add(membre)
    await session.flush()
    return membre


async def _flight_avec_contenu(session) -> tuple[Equipment, Equipment, Equipment, Equipment]:
    """Flight > (lyre, sous-flight > câble)."""
    flight = await _mk_eq(session, "Flight Archive Test", est_contenant=True)
    lyre = await _mk_eq(session, "Lyre Archive Test", contenant_id=flight.id)
    sous_flight = await _mk_eq(
        session, "Sous-flight Archive Test", est_contenant=True, contenant_id=flight.id
    )
    cable = await _mk_eq(session, "Câble Archive Test", contenant_id=sous_flight.id)
    await session.flush()
    return flight, lyre, sous_flight, cable


async def test_archive_cascade_flight(db_session):
    session = db_session
    flight, lyre, sous_flight, cable = await _flight_avec_contenu(session)

    touches = await _archiver_cascade(session, flight, True)

    assert touches == 4
    assert all(e.archive for e in (flight, lyre, sous_flight, cable))
    # Le rangement reste intact : le flight est reconstituable au désarchivage.
    assert lyre.contenant_id == flight.id
    assert cable.contenant_id == sous_flight.id


async def test_desarchive_cascade_flight(db_session):
    session = db_session
    flight, lyre, sous_flight, cable = await _flight_avec_contenu(session)
    await _archiver_cascade(session, flight, True)

    touches = await _archiver_cascade(session, flight, False)

    assert touches == 4
    assert not any(e.archive for e in (flight, lyre, sous_flight, cable))


async def test_archive_n_affecte_pas_les_voisins(db_session):
    session = db_session
    flight, lyre, _sous_flight, _cable = await _flight_avec_contenu(session)
    dehors = await _mk_eq(session, "Ampli Hors Flight Test")
    await session.flush()

    await _archiver_cascade(session, flight, True)

    assert lyre.archive is True
    assert dehors.archive is False


async def test_desarchive_enfant_dans_flight_archive_409(db_session):
    session = db_session
    flight, lyre, _sous_flight, _cable = await _flight_avec_contenu(session)
    await _archiver_cascade(session, flight, True)

    # Désarchiver la lyre seule la rendrait invisible : rangée dans un flight archivé.
    with pytest.raises(HTTPException) as exc:
        await desarchiver_equipment(lyre.id, None, session)
    assert exc.value.status_code == 409


async def test_delete_non_archive_409(db_session):
    session = db_session
    lyre = await _mk_eq(session, "Lyre Suppression Test")
    await session.flush()

    with pytest.raises(HTTPException) as exc:
        await delete_equipment(lyre.id, None, session)
    assert exc.value.status_code == 409


async def test_delete_introuvable_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await delete_equipment(99_999_999, None, db_session)
    assert exc.value.status_code == 404


async def test_delete_flight_non_vide_409(db_session):
    session = db_session
    flight, _lyre, _sous_flight, _cable = await _flight_avec_contenu(session)
    await _archiver_cascade(session, flight, True)

    with pytest.raises(HTTPException) as exc:
        await delete_equipment(flight.id, None, session)
    assert exc.value.status_code == 409


async def test_delete_avec_historique_de_scan_409(db_session):
    session = db_session
    membre = await _mk_membre(session)
    lyre = await _mk_eq(session, "Lyre Scannée Test", archive=True)
    session.add(
        LogScan(
            uuid_client=uuid.uuid4(),
            equipment_id=lyre.id,
            membre_id=membre.id,
            type_action=TypeActionScan.SCAN_SORTIE,
        )
    )
    await session.flush()

    with pytest.raises(HTTPException) as exc:
        await delete_equipment(lyre.id, None, session)
    assert exc.value.status_code == 409


async def test_delete_avec_historique_de_panne_409(db_session):
    session = db_session
    membre = await _mk_membre(session)
    lyre = await _mk_eq(session, "Lyre Cassée Test", archive=True)
    session.add(
        TicketReparation(
            uuid_client=uuid.uuid4(),
            equipment_id=lyre.id,
            declare_par_membre_id=membre.id,
            description_panne="Ne s'allume plus",
        )
    )
    await session.flush()

    with pytest.raises(HTTPException) as exc:
        await delete_equipment(lyre.id, None, session)
    assert exc.value.status_code == 409


async def test_delete_ok_supprime_la_ligne_vrac(db_session):
    """Seul test qui laisse commiter : il ne crée que l'objet qu'il supprime."""
    session = db_session
    caisse = await _mk_eq(session, "Caisse Vrac Suppression Test", archive=True)
    session.add(EquipmentVrac(equipment_id=caisse.id, quantite_theorique=12))
    await session.flush()
    caisse_id = caisse.id

    await delete_equipment(caisse_id, None, session)

    assert await session.get(Equipment, caisse_id) is None
    assert await session.get(EquipmentVrac, caisse_id) is None
