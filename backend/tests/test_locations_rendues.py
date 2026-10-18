"""Archivage en lot des locations rendues d'une prestation clôturée.

Les fonctions du routeur et du service sont appelées directement dans la session
de test (rollback en fin) : les `commit()` du routeur ne relâchent qu'un savepoint.
"""

import uuid

import pytest
from conftest import make_equipment
from fastapi import HTTPException

from app.models import (
    AllocationPresta,
    Equipment,
    EquipmentLocation,
    Fournisseur,
    Membre,
    Prestation,
)
from app.models.enums import (
    DecisionCloture,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypePrestation,
)
from app.routers.prestations import archiver_locations_rendues, lire_locations_rendues
from app.services.locations_rendues import trier_locations_rendues


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


@pytest.fixture
async def fournisseur(db_session) -> Fournisseur:
    f = Fournisseur(nom=f"Loueur {uuid.uuid4().hex[:6]}")
    db_session.add(f)
    await db_session.flush()
    return f


async def _presta(session, nom: str = "Presta rendue", statut=StatutPrestation.TERMINEE):
    p = Prestation(nom=nom, type=TypePrestation.INTERNE, statut=statut)
    session.add(p)
    await session.flush()
    return p


async def _location(session, fournisseur: Fournisseur, nom: str, **kw) -> Equipment:
    eq = await make_equipment(session, nom, **kw)
    session.add(EquipmentLocation(equipment_id=eq.id, fournisseur_id=fournisseur.id))
    await session.flush()
    return eq


async def _allouer(
    session,
    presta: Prestation,
    eq: Equipment,
    *,
    sortie: int = 1,
    retournee: int = 1,
    statut: StatutAllocation = StatutAllocation.RETOURNE,
    decision: DecisionCloture | None = None,
) -> AllocationPresta:
    a = AllocationPresta(
        presta_id=presta.id,
        equipment_id=eq.id,
        quantite=1,
        quantite_sortie=sortie,
        quantite_retournee=retournee,
        statut=statut,
        decision_cloture=decision,
    )
    session.add(a)
    await session.flush()
    return a


def _raisons(tri) -> dict[int, str]:
    return {eq.id: raison for eq, raison in tri.gardes}


async def test_rendue_archivable(db_session, staff, fournisseur):
    presta = await _presta(db_session)
    loue = await _location(db_session, fournisseur, "Lyre louée")
    interne = await make_equipment(db_session, "Lyre BPM")
    deja = await _location(db_session, fournisseur, "Lyre déjà archivée", archive=True)
    for eq in (loue, interne, deja):
        await _allouer(db_session, presta, eq)

    out = await lire_locations_rendues(presta.id, db_session, staff)

    assert [r.equipment_id for r in out.archivables] == [loue.id]
    assert out.archivables[0].nom == "Lyre louée"
    assert out.archivables[0].fournisseur_nom == fournisseur.nom
    assert out.archivables[0].raison is None
    assert out.gardes == []


async def test_jamais_sortie_gardee(db_session, fournisseur):
    presta = await _presta(db_session)
    eq = await _location(db_session, fournisseur, "Jamais sortie")
    await _allouer(db_session, presta, eq, sortie=0, retournee=0, statut=StatutAllocation.PLANIFIE)

    tri = await trier_locations_rendues(db_session, presta)

    assert tri.archivables == []
    assert _raisons(tri) == {eq.id: "jamais sortie"}


async def test_pas_entierement_rendue_gardee(db_session, fournisseur):
    presta = await _presta(db_session)
    eq = await _location(db_session, fournisseur, "Partielle")
    await _allouer(db_session, presta, eq, sortie=2, retournee=1, statut=StatutAllocation.SORTI)

    tri = await trier_locations_rendues(db_session, presta)

    assert _raisons(tri) == {eq.id: "pas entièrement rendue"}


async def test_decisions_gardees(db_session, fournisseur):
    presta = await _presta(db_session)
    perdue = await _location(db_session, fournisseur, "Perdue")
    cassee = await _location(db_session, fournisseur, "Cassée")
    suspens = await _location(db_session, fournisseur, "Suspens")
    # La décision prime sur les tests suivants (quantités, statut).
    await _allouer(db_session, presta, perdue, retournee=0, decision=DecisionCloture.PERDU)
    await _allouer(db_session, presta, cassee, decision=DecisionCloture.CASSE)
    await _allouer(
        db_session, presta, suspens, retournee=0, statut=StatutAllocation.SORTI,
        decision=DecisionCloture.OUVERT,
    )
    cassee.statut_actuel = StatutEquipment.EN_PANNE
    await db_session.flush()

    tri = await trier_locations_rendues(db_session, presta)

    assert tri.archivables == []
    assert _raisons(tri) == {
        perdue.id: "perdue",
        cassee.id: "cassée",
        suspens.id: "en suspens",
    }


async def test_decision_retourne_archivable(db_session, fournisseur):
    presta = await _presta(db_session)
    eq = await _location(db_session, fournisseur, "Retour forcé")
    await _allouer(db_session, presta, eq, decision=DecisionCloture.RETOURNE)

    tri = await trier_locations_rendues(db_session, presta)

    assert [e.id for e in tri.archivables] == [eq.id]


async def test_hors_service_gardee(db_session, fournisseur):
    presta = await _presta(db_session)
    eq = await _location(
        db_session, fournisseur, "En panne", statut_actuel=StatutEquipment.EN_PANNE
    )
    await _allouer(db_session, presta, eq)

    tri = await trier_locations_rendues(db_session, presta)

    assert _raisons(tri) == {eq.id: "hors service"}


async def test_prevue_ailleurs_gardee(db_session, fournisseur):
    presta = await _presta(db_session)
    gala = await _presta(db_session, "Gala", StatutPrestation.EN_PREPARATION)
    close = await _presta(db_session, "Close", StatutPrestation.TERMINEE)
    prevue = await _location(db_session, fournisseur, "Prévue ailleurs")
    libre = await _location(db_session, fournisseur, "Retournée ailleurs")
    await _allouer(db_session, presta, prevue)
    await _allouer(
        db_session, gala, prevue, sortie=0, retournee=0, statut=StatutAllocation.PLANIFIE
    )
    # Déjà retournée sur une presta ouverte, ou réservée sur une presta close : libre.
    await _allouer(db_session, presta, libre)
    await _allouer(db_session, gala, libre)
    await _allouer(
        db_session, close, libre, sortie=0, retournee=0, statut=StatutAllocation.PLANIFIE
    )

    tri = await trier_locations_rendues(db_session, presta)

    assert _raisons(tri) == {prevue.id: "prévue sur « Gala »"}
    assert [e.id for e in tri.archivables] == [libre.id]


async def test_flight_loue_garde_si_contenu_non_rendu(db_session, fournisseur):
    presta = await _presta(db_session)
    flight = await _location(db_session, fournisseur, "Flight loué", est_contenant=True)
    item_bpm = await make_equipment(db_session, "Câble BPM", contenant_id=flight.id)
    await _allouer(db_session, presta, flight)
    await _allouer(db_session, presta, item_bpm)

    tri = await trier_locations_rendues(db_session, presta)

    assert tri.archivables == []
    assert _raisons(tri) == {flight.id: "contenu du flight non rendu"}


async def test_flight_loue_garde_si_contenu_loue_garde(db_session, fournisseur):
    presta = await _presta(db_session)
    flight = await _location(db_session, fournisseur, "Flight loué 2", est_contenant=True)
    sous = await _location(
        db_session, fournisseur, "Sous-flight", est_contenant=True, contenant_id=flight.id
    )
    perdu = await _location(db_session, fournisseur, "Lyre perdue", contenant_id=sous.id)
    await _allouer(db_session, presta, flight)
    await _allouer(db_session, presta, sous)
    await _allouer(db_session, presta, perdu, retournee=0, decision=DecisionCloture.PERDU)

    tri = await trier_locations_rendues(db_session, presta)

    assert tri.archivables == []
    assert _raisons(tri) == {
        flight.id: "contenu du flight non rendu",
        sous.id: "contenu du flight non rendu",
        perdu.id: "perdue",
    }


async def test_flight_loue_archive_avec_contenu(db_session, staff, fournisseur):
    presta = await _presta(db_session)
    flight = await _location(db_session, fournisseur, "Flight loué 3", est_contenant=True)
    lyre = await _location(db_session, fournisseur, "Lyre du flight", contenant_id=flight.id)
    await _allouer(db_session, presta, flight)
    await _allouer(db_session, presta, lyre)

    apercu = await lire_locations_rendues(presta.id, db_session, staff)
    # Le contenu n'est pas listé à part : la cascade l'archive avec le flight.
    assert [r.equipment_id for r in apercu.archivables] == [flight.id]

    out = await archiver_locations_rendues(presta.id, db_session, staff)

    assert [r.equipment_id for r in out.archivables] == [flight.id]
    await db_session.refresh(flight)
    await db_session.refresh(lyre)
    assert flight.archive is True
    assert lyre.archive is True
    # Rejouer ne trouve plus rien à archiver.
    again = await archiver_locations_rendues(presta.id, db_session, staff)
    assert again.archivables == []


async def test_archivage_laisse_les_gardes(db_session, staff, fournisseur):
    presta = await _presta(db_session)
    ok = await _location(db_session, fournisseur, "Rendue")
    ko = await _location(db_session, fournisseur, "Perdue en route")
    await _allouer(db_session, presta, ok)
    await _allouer(db_session, presta, ko, retournee=0, decision=DecisionCloture.PERDU)

    out = await archiver_locations_rendues(presta.id, db_session, staff)

    assert [r.equipment_id for r in out.archivables] == [ok.id]
    assert [(r.equipment_id, r.raison) for r in out.gardes] == [(ko.id, "perdue")]
    await db_session.refresh(ok)
    await db_session.refresh(ko)
    assert ok.archive is True
    assert ko.archive is False


async def test_archivage_refuse_si_presta_ouverte(db_session, staff, fournisseur):
    presta = await _presta(db_session, statut=StatutPrestation.EN_COURS)
    eq = await _location(db_session, fournisseur, "Rendue presta ouverte")
    await _allouer(db_session, presta, eq)

    with pytest.raises(HTTPException) as exc:
        await archiver_locations_rendues(presta.id, db_session, staff)

    assert exc.value.status_code == 409
    assert exc.value.detail == "La prestation n'est pas clôturée."
    await db_session.refresh(eq)
    assert eq.archive is False
