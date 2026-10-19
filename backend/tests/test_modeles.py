"""Modèles d'équipement et ajout par modèle aux prestations.

Session non commitée (rollback en teardown) ; les routeurs sont appelés en direct.
"""

import uuid
from datetime import date

import pytest
from conftest import make_equipment
from fastapi import HTTPException
from sqlalchemy import select, update

from app.models import (
    AllocationPresta,
    Categorie,
    EquipmentLocation,
    Fournisseur,
    Membre,
    Modele,
    Prestation,
    SousCategorie,
)
from app.models.enums import StatutAllocation, StatutEquipment, TypePrestation
from app.routers.equipment import create_equipment, update_equipment
from app.routers.modeles import delete_modele, get_modele, list_modeles, update_modele
from app.routers.prestations import (
    add_allocation,
    ajouter_unite_modele,
    get_prestation,
    list_modeles_presta,
    retirer_unite_modele,
    update_prestation,
)
from app.schemas.equipment import EquipmentCreate, EquipmentUpdate, ModeleUpdate
from app.schemas.prestation import AllocationCreate, ModeleStepIn, PrestationUpdate


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


async def _modele(session, **kw) -> Modele:
    m = Modele(nom=f"MH-{uuid.uuid4().hex[:6]}", **kw)
    session.add(m)
    await session.flush()
    return m


async def _presta(session, debut: date | None = None, fin: date | None = None) -> Prestation:
    p = Prestation(nom="Presta test", type=TypePrestation.INTERNE, date_debut=debut, date_fin=fin)
    session.add(p)
    await session.flush()
    return p


async def _alloues(session, presta) -> list[int]:
    return list(
        (
            await session.scalars(
                select(AllocationPresta.equipment_id)
                .where(AllocationPresta.presta_id == presta.id)
                .order_by(AllocationPresta.id)
            )
        ).all()
    )


async def _ligne(session, presta, modele, fournisseur_id=None):
    rows = await list_modeles_presta(presta.id, None, session, modele.nom)
    return next(r for r in rows if r.fournisseur_id == fournisseur_id)


async def test_plus_moins_et_compteurs(db_session, staff):
    s = db_session
    m = await _modele(s)
    flight = await make_equipment(s, "Flight MH", est_contenant=True)
    dans_flight = await make_equipment(s, "MH A", modele_id=m.id, contenant_id=flight.id)
    libre_b = await make_equipment(s, "MH B", modele_id=m.id)
    libre_c = await make_equipment(s, "MH C", modele_id=m.id)
    await make_equipment(s, "MH HS", modele_id=m.id, statut_actuel=StatutEquipment.EN_PANNE)
    await make_equipment(s, "MH perdu", modele_id=m.id, statut_actuel=StatutEquipment.PERDU)
    await make_equipment(s, "MH archivé", modele_id=m.id, archive=True)
    p = await _presta(s)

    row = await _ligne(s, p, m)
    # Total : hors archivé/perdu/réformé ; dispo : en plus hors HS.
    assert (row.dispo, row.total, row.alloues, row.retirable) == (3, 4, 0, False)

    # « + » : les unités hors flight d'abord, par nom.
    step = ModeleStepIn()
    assert (await ajouter_unite_modele(p.id, m.id, step, s, staff)).alloues == 1
    await ajouter_unite_modele(p.id, m.id, step, s, staff)
    row = await ajouter_unite_modele(p.id, m.id, step, s, staff)
    assert (row.dispo, row.alloues, row.retirable) == (0, 3, True)
    assert await _alloues(s, p) == [libre_b.id, libre_c.id, dans_flight.id]

    with pytest.raises(HTTPException) as exc:
        await ajouter_unite_modele(p.id, m.id, step, s, staff)
    assert exc.value.status_code == 409

    # « − » : la dernière ajoutée.
    row = await retirer_unite_modele(p.id, m.id, step, s, staff)
    assert row.alloues == 2
    assert await _alloues(s, p) == [libre_b.id, libre_c.id]


async def test_moins_ignore_sortis_et_contenu_de_flight(db_session, staff):
    s = db_session
    m = await _modele(s)
    flight = await make_equipment(s, "Flight", est_contenant=True)
    await make_equipment(s, "MH dans flight", modele_id=m.id, contenant_id=flight.id)
    sorti = await make_equipment(s, "MH sorti", modele_id=m.id)
    p = await _presta(s)
    await add_allocation(
        p.id, AllocationCreate(equipment_id=flight.id, inclure_contenu=True), s, staff
    )
    s.add(AllocationPresta(
        presta_id=p.id, equipment_id=sorti.id, quantite=1, quantite_sortie=1,
        statut=StatutAllocation.SORTI,
    ))
    await s.flush()

    row = await _ligne(s, p, m)
    # Le contenu du flight compte dans n mais ne se retire pas par « − ».
    assert (row.alloues, row.retirable) == (2, False)
    with pytest.raises(HTTPException) as exc:
        await retirer_unite_modele(p.id, m.id, ModeleStepIn(), s, staff)
    assert exc.value.status_code == 409


async def test_location_ligne_par_fournisseur(db_session, staff):
    s = db_session
    m = await _modele(s)
    f = Fournisseur(nom=f"Loueur {uuid.uuid4().hex[:6]}")
    s.add(f)
    await s.flush()
    await make_equipment(s, "MH BPM", modele_id=m.id)
    loue = await make_equipment(s, "MH loué", modele_id=m.id)
    s.add(EquipmentLocation(equipment_id=loue.id, fournisseur_id=f.id))
    await s.flush()
    p = await _presta(s)

    rows = await list_modeles_presta(p.id, None, s, m.nom)
    assert [(r.fournisseur_id, r.dispo) for r in rows] == [(None, 1), (f.id, 1)]
    row = await ajouter_unite_modele(p.id, m.id, ModeleStepIn(fournisseur_id=f.id), s, staff)
    assert (row.fournisseur_id, row.alloues) == (f.id, 1)
    assert (await _ligne(s, p, m)).alloues == 0


async def test_allocation_refusee_si_hors_service(db_session, staff):
    s = db_session
    p = await _presta(s)
    for statut in (
        StatutEquipment.EN_PANNE,
        StatutEquipment.EN_REPARATION,
        StatutEquipment.PERDU,
        StatutEquipment.REFORME,
    ):
        eq = await make_equipment(s, f"HS {statut}", statut_actuel=statut)
        with pytest.raises(HTTPException) as exc:
            await add_allocation(p.id, AllocationCreate(equipment_id=eq.id), s, staff)
        assert exc.value.status_code == 409
    archive = await make_equipment(s, "Archivé", archive=True)
    with pytest.raises(HTTPException):
        await add_allocation(p.id, AllocationCreate(equipment_id=archive.id), s, staff)


async def test_flight_ignore_contenu_hors_service(db_session, staff):
    s = db_session
    flight = await make_equipment(s, "Flight", est_contenant=True)
    ok = await make_equipment(s, "Ok", contenant_id=flight.id)
    hs = await make_equipment(
        s, "HS", contenant_id=flight.id, statut_actuel=StatutEquipment.EN_PANNE
    )
    p = await _presta(s)
    res = await add_allocation(
        p.id, AllocationCreate(equipment_id=flight.id, inclure_contenu=True), s, staff
    )
    assert res.contenu_ignore == 1
    ids = await _alloues(s, p)
    assert ok.id in ids and hs.id not in ids


async def test_chevauchement_de_dates(db_session, staff):
    s = db_session
    m = await _modele(s)
    eq = await make_equipment(s, "MH", modele_id=m.id)
    a = await _presta(s, date(2030, 6, 1), date(2030, 6, 3))
    await add_allocation(a.id, AllocationCreate(equipment_id=eq.id), s, staff)

    chevauche = await _presta(s, date(2030, 6, 3))  # sans fin : un jour
    with pytest.raises(HTTPException) as exc:
        await add_allocation(chevauche.id, AllocationCreate(equipment_id=eq.id), s, staff)
    assert exc.value.status_code == 409
    assert (await _ligne(s, chevauche, m)).dispo == 0

    # Après, ou sans date : libre.
    apres = await _presta(s, date(2030, 6, 4), date(2030, 6, 5))
    await add_allocation(apres.id, AllocationCreate(equipment_id=eq.id), s, staff)
    sans_date = await _presta(s)
    await add_allocation(sans_date.id, AllocationCreate(equipment_id=eq.id), s, staff)

    # Déplacer « après » sur la période de « a » : refusé.
    with pytest.raises(HTTPException) as exc_dates:
        await update_prestation(
            apres.id, PrestationUpdate(date_debut=date(2030, 6, 2)), s, staff
        )
    assert exc_dates.value.status_code == 409
    # Une vraie requête jetterait sa session ; ici on défait le setattr du PATCH.
    apres.date_debut = date(2030, 6, 4)
    await s.flush()

    # Une allocation retournée ne bloque plus.
    await s.execute(
        update(AllocationPresta)
        .where(AllocationPresta.presta_id == a.id)
        .values(statut=StatutAllocation.RETOURNE)
    )
    await add_allocation(chevauche.id, AllocationCreate(equipment_id=eq.id), s, staff)


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


async def test_detail_presta_expose_le_modele_des_unites(db_session, staff):
    s = db_session
    m = await _modele(s, marque="Robe")
    avec = await make_equipment(s, "MH 1", modele_id=m.id)
    sans = await make_equipment(s, "Console")
    p = await _presta(s)
    for eq in (avec, sans):
        await add_allocation(p.id, AllocationCreate(equipment_id=eq.id), s, staff)

    detail = await get_prestation(p.id, staff, s)
    par_eq = {a.equipment_id: a for a in detail.allocations}
    assert (
        par_eq[avec.id].equipment_modele_id,
        par_eq[avec.id].equipment_modele_nom,
        par_eq[avec.id].equipment_modele_marque,
    ) == (m.id, m.nom, "Robe")
    assert par_eq[sans.id].equipment_modele_id is None


async def test_fiche_modele_sous_categorie_et_unites(db_session, staff):
    s = db_session
    cat = Categorie(nom=f"Lights {uuid.uuid4().hex[:6]}")
    s.add(cat)
    await s.flush()
    sc = SousCategorie(nom="Beam", categorie_id=cat.id)
    s.add(sc)
    await s.flush()
    m = await _modele(s, categorie_id=cat.id, sous_categorie_id=sc.id)
    await make_equipment(s, "MH fiche A", modele_id=m.id)
    await make_equipment(s, "MH fiche B", modele_id=m.id)

    fiche = await get_modele(m.id, staff, s)
    assert (fiche.categorie_nom, fiche.sous_categorie_id, fiche.sous_categorie_nom) == (
        cat.nom,
        sc.id,
        "Beam",
    )
    assert fiche.nb_unites == 2

    liste = await list_modeles(staff, s, m.nom)
    assert [(x.id, x.sous_categorie_nom, x.nb_unites) for x in liste] == [(m.id, "Beam", 2)]

    with pytest.raises(HTTPException) as exc:
        await get_modele(10**9, staff, s)
    assert exc.value.status_code == 404
