"""Tests des garde-fous de la gestion des emplacements (création/édition/suppression).

Comme pour les contenants, on exerce directement les helpers du routeur dans une
session non commitée : seuls les chemins qui lèvent avant `commit()` sont testés,
la base de dev n'est donc jamais modifiée.
"""

import pytest
from conftest import make_equipment
from fastapi import HTTPException

from app.models import Emplacement
from app.routers.equipment import _verifier_parent, delete_emplacement


async def _depot_etagere(session) -> tuple[Emplacement, Emplacement]:
    depot = Emplacement(nom="Dépôt Emp Test")
    session.add(depot)
    await session.flush()
    etagere = Emplacement(nom="Étagère Emp Test", parent_id=depot.id)
    session.add(etagere)
    await session.flush()
    return depot, etagere


async def test_parent_inconnu_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await _verifier_parent(db_session, 10**8, None)
    assert exc.value.status_code == 404


async def test_parent_cycle_refuse(db_session):
    depot, etagere = await _depot_etagere(db_session)

    # Se ranger dans soi-même
    with pytest.raises(HTTPException) as exc:
        await _verifier_parent(db_session, depot.id, depot.id)
    assert exc.value.status_code == 409

    # Ranger le dépôt dans son propre descendant
    with pytest.raises(HTTPException) as exc:
        await _verifier_parent(db_session, etagere.id, depot.id)
    assert exc.value.status_code == 409

    # Déplacement légitime : l'étagère reste rangeable dans le dépôt
    await _verifier_parent(db_session, depot.id, etagere.id)


async def test_suppression_refusee_si_sous_emplacement(db_session):
    depot, _etagere = await _depot_etagere(db_session)
    with pytest.raises(HTTPException) as exc:
        await delete_emplacement(depot.id, _user=None, db=db_session)
    assert exc.value.status_code == 409


async def test_suppression_refusee_si_materiel_range(db_session):
    _depot, etagere = await _depot_etagere(db_session)
    await make_equipment(db_session, "Ampli Emp Test", emplacement_id=etagere.id)
    with pytest.raises(HTTPException) as exc:
        await delete_emplacement(etagere.id, _user=None, db=db_session)
    assert exc.value.status_code == 409


async def test_suppression_emplacement_introuvable(db_session):
    with pytest.raises(HTTPException) as exc:
        await delete_emplacement(10**8, _user=None, db=db_session)
    assert exc.value.status_code == 404
