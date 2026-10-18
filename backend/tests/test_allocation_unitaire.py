"""Un item unitaire s'alloue à l'unité ; seuls vrac et consommables ont une quantité."""

from datetime import date

import pytest
from conftest import make_equipment
from fastapi import HTTPException

from app.models import EquipmentVrac, Membre, Prestation
from app.models.enums import TypePrestation
from app.routers.prestations import add_allocation
from app.schemas.prestation import AllocationCreate


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


async def _presta(session, debut: date | None = None, fin: date | None = None) -> Prestation:
    p = Prestation(nom="Presta test", type=TypePrestation.INTERNE, date_debut=debut, date_fin=fin)
    session.add(p)
    await session.flush()
    return p


async def test_unitaire_refuse_quantite_superieure_a_1(db_session, staff):
    eq = await make_equipment(db_session, "Lyre")
    p = await _presta(db_session)
    with pytest.raises(HTTPException) as exc:
        await add_allocation(
            p.id, AllocationCreate(equipment_id=eq.id, quantite=2), db_session, staff
        )
    assert exc.value.status_code == 422


async def test_unitaire_refuse_maj_quantite_superieure_a_1(db_session, staff):
    eq = await make_equipment(db_session, "Lyre")
    p = await _presta(db_session)
    await add_allocation(p.id, AllocationCreate(equipment_id=eq.id, quantite=1), db_session, staff)
    with pytest.raises(HTTPException) as exc:
        await add_allocation(
            p.id, AllocationCreate(equipment_id=eq.id, quantite=3), db_session, staff
        )
    assert exc.value.status_code == 422


async def test_vrac_accepte_quantite(db_session, staff):
    caisse = await make_equipment(db_session, "XLR")
    db_session.add(EquipmentVrac(equipment_id=caisse.id, quantite_theorique=20))
    await db_session.flush()
    p = await _presta(db_session)
    res = await add_allocation(
        p.id, AllocationCreate(equipment_id=caisse.id, quantite=8), db_session, staff
    )
    assert res.quantite == 8
