"""Modèles d'équipement : obligatoires à la création, font foi pour la catégorie.

Session non commitée (rollback en teardown) ; les routeurs sont appelés en direct.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.models import Categorie, Membre, Modele
from app.routers.equipment import create_equipment, update_equipment
from app.routers.modeles import delete_modele, update_modele
from app.schemas.equipment import EquipmentCreate, EquipmentUpdate, ModeleUpdate


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


async def _modele(session, **kw) -> Modele:
    m = Modele(nom=f"MH-{uuid.uuid4().hex[:6]}", **kw)
    session.add(m)
    await session.flush()
    return m


async def test_modele_obligatoire_a_la_creation(db_session, staff):
    s = db_session
    with pytest.raises(HTTPException) as exc:
        await create_equipment(EquipmentCreate(nom="Lyre sans modèle"), staff, s)
    assert exc.value.status_code == 422
    # Exemptés : flight, location, vrac, consommable.
    await create_equipment(EquipmentCreate(nom="Flight", est_contenant=True), staff, s)
    await create_equipment(
        EquipmentCreate(nom="Loué", externe=True, fournisseur_nom=f"L {uuid.uuid4().hex[:6]}"),
        staff,
        s,
    )
    await create_equipment(EquipmentCreate(nom="Câbles", type="vrac"), staff, s)


async def test_categorie_suit_le_modele(db_session, staff):
    s = db_session
    lumiere, son = Categorie(nom="Lumière"), Categorie(nom="Son")
    s.add_all([lumiere, son])
    await s.flush()
    m = await _modele(s, categorie_id=lumiere.id)

    detail = await create_equipment(
        EquipmentCreate(nom="MH 1", modele_id=m.id, categorie_id=son.id), staff, s
    )
    assert (detail.modele_nom, detail.categorie_id) == (m.nom, lumiere.id)

    with pytest.raises(HTTPException) as exc:
        await update_equipment(detail.id, EquipmentUpdate(categorie_id=son.id), staff, s)
    assert exc.value.status_code == 400

    await update_modele(m.id, ModeleUpdate(categorie_id=son.id), staff, s)
    detail = await update_equipment(detail.id, EquipmentUpdate(), staff, s)
    assert detail.categorie_id == son.id

    # Suppression refusée tant qu'une unité y est rattachée.
    with pytest.raises(HTTPException) as exc_del:
        await delete_modele(m.id, staff, s)
    assert exc_del.value.status_code == 409
