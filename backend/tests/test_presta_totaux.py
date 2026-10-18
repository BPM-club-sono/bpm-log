"""Totaux d'une prestation (poids, prix au tarif du type, connectiques), figés à la clôture.

Session non commitée (rollback en teardown) ; les routeurs sont appelés en direct.
"""

import uuid

import pytest
from conftest import make_equipment
from sqlalchemy import select

from app.models import (
    AllocationPresta,
    Connecteur,
    Connectique,
    EquipmentVrac,
    Membre,
    Modele,
    Prestation,
)
from app.models.enums import SensConnectique, TypePrestation
from app.routers.prestations import (
    add_allocation,
    cloturer_prestation,
    get_prestation,
    rouvrir_prestation,
    update_prestation,
)
from app.schemas.prestation import AllocationCreate, ClotureIn, PrestationUpdate


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


async def _modele(session, **kw) -> Modele:
    m = Modele(nom=f"MT-{uuid.uuid4().hex[:6]}", **kw)
    session.add(m)
    await session.flush()
    return m


async def _connecteur(session) -> Connecteur:
    c = Connecteur(nom=f"PowerCon {uuid.uuid4().hex[:6]}")
    session.add(c)
    await session.flush()
    return c


async def _presta(session) -> Prestation:
    p = Prestation(nom="Presta totaux", type=TypePrestation.INTERNE)
    session.add(p)
    await session.flush()
    return p


async def _allouer(session, staff, presta, *equipments, **kw) -> None:
    for eq in equipments:
        await add_allocation(presta.id, AllocationCreate(equipment_id=eq.id, **kw), session, staff)


async def _totaux(session, staff, presta):
    return (await get_prestation(presta.id, staff, session)).totaux


async def test_totaux_presta_vide(db_session, staff):
    p = await _presta(db_session)
    t = await _totaux(db_session, staff, p)
    assert (t.poids_total, t.prix_total, t.nb_sans_poids, t.nb_sans_prix) == (0, 0, 0, 0)
    assert t.connectiques == []
    assert (t.tarif, t.fige) == ("interne", False)


async def test_totaux_interne_externe(db_session, staff):
    s = db_session
    m = await _modele(s, poids=10, prix_interne=20, prix_externe=50)
    powercon = await _connecteur(s)
    s.add(
        Connectique(
            connecteur_id=powercon.id, sens=SensConnectique.ENTREE, quantite=1, modele_id=m.id
        )
    )
    p = await _presta(s)
    await _allouer(
        s,
        staff,
        p,
        await make_equipment(s, "Lyre 1", modele_id=m.id),
        await make_equipment(s, "Lyre 2", modele_id=m.id),
    )

    t = await _totaux(s, staff, p)
    assert (t.tarif, t.prix_total, t.poids_total) == ("interne", 40, 20)
    assert [(c.connecteur_id, c.connecteur_nom, c.sens, c.quantite) for c in t.connectiques] == [
        (powercon.id, powercon.nom, SensConnectique.ENTREE, 2)
    ]

    await update_prestation(p.id, PrestationUpdate(type=TypePrestation.EXTERNE), s, staff)
    t = await _totaux(s, staff, p)
    assert (t.tarif, t.prix_total) == ("externe", 100)


async def test_totaux_vrac_quantite(db_session, staff):
    s = db_session
    caisse = await make_equipment(s, "Câbles XLR", poids=0.5, prix_interne=1)
    s.add(EquipmentVrac(equipment_id=caisse.id, quantite_theorique=20))
    await s.flush()
    p = await _presta(s)
    await _allouer(s, staff, p, caisse, quantite=10)

    t = await _totaux(s, staff, p)
    assert (t.poids_total, t.prix_total) == (5, 10)


async def test_totaux_partiels(db_session, staff):
    s = db_session
    sans_poids = await _modele(s, prix_interne=3)
    p = await _presta(s)
    await _allouer(
        s,
        staff,
        p,
        await make_equipment(s, "Pied", poids=4, prix_interne=2),
        await make_equipment(s, "Lyre sans poids", modele_id=sans_poids.id),
    )

    t = await _totaux(s, staff, p)
    assert (t.poids_total, t.nb_sans_poids) == (4, 1)
    assert (t.prix_total, t.nb_sans_prix) == (5, 0)


async def test_flight_et_contenu(db_session, staff):
    s = db_session
    flight = await make_equipment(s, "Flight", est_contenant=True, poids=8)
    await make_equipment(s, "Par A", contenant_id=flight.id, poids=10)
    await make_equipment(s, "Par B", contenant_id=flight.id, poids=10)
    p = await _presta(s)
    await _allouer(s, staff, p, flight, inclure_contenu=True)

    t = await _totaux(s, staff, p)
    assert t.poids_total == 28


async def test_prix_unitaire_par_ligne(db_session, staff):
    s = db_session
    m = await _modele(s, poids=10, prix_interne=20, prix_externe=50)
    seul = await make_equipment(s, "Enceinte", poids=30, prix_interne=7, prix_externe=9)
    p = await _presta(s)
    await _allouer(s, staff, p, await make_equipment(s, "Lyre", modele_id=m.id), seul)

    detail = await get_prestation(p.id, staff, s)
    assert sorted((a.prix_unitaire, a.poids_unitaire) for a in detail.allocations) == [
        (7, 30),
        (20, 10),
    ]

    await update_prestation(p.id, PrestationUpdate(type=TypePrestation.EXTERNE), s, staff)
    detail = await get_prestation(p.id, staff, s)
    assert sorted(a.prix_unitaire for a in detail.allocations) == [9, 50]


async def test_fige_a_la_cloture(db_session, staff):
    s = db_session
    m = await _modele(s, poids=10, prix_interne=20, prix_externe=50)
    p = await _presta(s)
    await _allouer(
        s,
        staff,
        p,
        await make_equipment(s, "Lyre 1", modele_id=m.id),
        await make_equipment(s, "Lyre 2", modele_id=m.id),
    )

    t = (await cloturer_prestation(p.id, ClotureIn(), s, staff)).totaux
    assert (t.prix_total, t.poids_total, t.fige) == (40, 20, True)

    m.prix_interne = 100
    m.poids = 1
    await s.flush()
    t = await _totaux(s, staff, p)
    assert (t.prix_total, t.poids_total, t.fige) == (40, 20, True)

    t = (await rouvrir_prestation(p.id, s, staff)).totaux
    assert (t.prix_total, t.poids_total, t.fige) == (200, 2, False)
    figes = (
        await s.execute(
            select(AllocationPresta.prix_unitaire_fige, AllocationPresta.poids_unitaire_fige).where(
                AllocationPresta.presta_id == p.id
            )
        )
    ).all()
    assert figes == [(None, None), (None, None)]
