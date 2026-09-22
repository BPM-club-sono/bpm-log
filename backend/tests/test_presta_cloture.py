"""Clôture d'une prestation : décision mémorisée et historique de l'équipement.

La décision de chaque écart (`decision_cloture`) alimente le rapport de clôture ;
un équipement déclaré perdu ou cassé voit ce changement tracé dans ses logs.
"""

import uuid
from datetime import UTC, datetime

from conftest import make_equipment
from sqlalchemy import select

from app.models import AllocationPresta, Equipment, LogScan, Membre, Prestation
from app.models.enums import (
    DecisionCloture,
    RoleMembre,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypeActionScan,
    TypePrestation,
)
from app.routers.prestations import cloturer_prestation, rouvrir_prestation
from app.routers.sync import _apply_presta_check
from app.schemas.prestation import ClotureIn, ClotureItem
from app.schemas.sync import SyncItemIn


async def _membre(session) -> Membre:
    membre = Membre(email=f"cloture-{uuid.uuid4().hex[:8]}@test.local", role=RoleMembre.STAFF)
    session.add(membre)
    await session.flush()
    return membre


async def _presta_sortie(session, *equipments: Equipment) -> tuple[Prestation, list]:
    """Prestation en cours dont chaque équipement est sorti sans être revenu."""
    presta = Prestation(
        nom="Festival Test", type=TypePrestation.EXTERNE, statut=StatutPrestation.EN_COURS
    )
    session.add(presta)
    await session.flush()
    allocs = []
    for eq in equipments:
        alloc = AllocationPresta(
            presta_id=presta.id,
            equipment_id=eq.id,
            quantite=1,
            quantite_sortie=1,
            statut=StatutAllocation.SORTI,
        )
        session.add(alloc)
        allocs.append(alloc)
    await session.flush()
    return presta, allocs


async def _logs(session, eq: Equipment) -> list[LogScan]:
    return list(
        (await session.scalars(select(LogScan).where(LogScan.equipment_id == eq.id))).all()
    )


def _cloture(*pairs: tuple[AllocationPresta, str]) -> ClotureIn:
    return ClotureIn(items=[ClotureItem(allocation_id=a.id, decision=d) for a, d in pairs])


async def test_cloture_memorise_la_decision_de_chaque_ecart(db_session):
    s = db_session
    user = await _membre(s)
    perdu = await make_equipment(s, "Lyre P")
    casse = await make_equipment(s, "Lyre C")
    ouvert = await make_equipment(s, "Lyre O")
    rendu = await make_equipment(s, "Lyre R")
    presta, (a_p, a_c, a_o, a_r) = await _presta_sortie(s, perdu, casse, ouvert, rendu)

    detail = await cloturer_prestation(
        presta.id,
        _cloture((a_p, "perdu"), (a_c, "casse"), (a_o, "ouvert"), (a_r, "retourne")),
        s,
        user,
    )

    assert detail.statut == StatutPrestation.TERMINEE
    decisions = {a.equipment_id: a.decision_cloture for a in detail.allocations}
    assert decisions == {
        perdu.id: DecisionCloture.PERDU,
        casse.id: DecisionCloture.CASSE,
        ouvert.id: DecisionCloture.OUVERT,
        rendu.id: DecisionCloture.RETOURNE,
    }


async def test_perdu_et_casse_sont_traces_dans_l_historique(db_session):
    s = db_session
    user = await _membre(s)
    perdu = await make_equipment(s, "Lyre P")
    casse = await make_equipment(s, "Lyre C")
    ouvert = await make_equipment(s, "Lyre O")
    presta, (a_p, a_c, a_o) = await _presta_sortie(s, perdu, casse, ouvert)

    await cloturer_prestation(
        presta.id, _cloture((a_p, "perdu"), (a_c, "casse"), (a_o, "ouvert")), s, user
    )

    assert perdu.statut_actuel == StatutEquipment.PERDU
    (log_p,) = await _logs(s, perdu)
    assert log_p.type_action == TypeActionScan.CHANGEMENT_STATUT
    assert log_p.membre_id == user.id
    assert log_p.contexte == "→ Perdu · clôture « Festival Test »"

    (log_c,) = await _logs(s, casse)
    assert log_c.contexte == "→ En Panne · clôture « Festival Test »"

    # Laissé en suspens : le statut de l'équipement ne change pas, rien à tracer.
    assert await _logs(s, ouvert) == []


async def test_recloture_garde_les_decisions_sauf_ecart_comble(db_session):
    s = db_session
    user = await _membre(s)
    perdu = await make_equipment(s, "Lyre P")
    casse = await make_equipment(s, "Lyre C")
    retrouve = await make_equipment(s, "Lyre R")
    presta, (a_p, a_c, a_r) = await _presta_sortie(s, perdu, casse, retrouve)

    await cloturer_prestation(
        presta.id, _cloture((a_p, "perdu"), (a_c, "casse"), (a_r, "ouvert")), s, user
    )
    await rouvrir_prestation(presta.id, s, user)

    # Entre-temps, l'item en suspens a été rendu. Comme l'écran, la seconde clôture
    # ne renvoie plus rien : aucun écart ouvert ne reste.
    a_r.quantite_retournee = 1
    a_r.statut = StatutAllocation.RETOURNE
    detail = await cloturer_prestation(presta.id, ClotureIn(), s, user)

    decisions = {a.equipment_id: a.decision_cloture for a in detail.allocations}
    assert decisions == {
        perdu.id: DecisionCloture.PERDU,
        casse.id: DecisionCloture.CASSE,
        retrouve.id: None,
    }
    # Pas de nouveau changement de statut : pas de log en double.
    assert len(await _logs(s, perdu)) == 1
    assert len(await _logs(s, casse)) == 1


def _retour(presta: Prestation, eq: Equipment) -> SyncItemIn:
    return SyncItemIn(
        uuid_client=uuid.uuid4(),
        type="presta_check",
        offline_created_at=datetime.now(UTC),
        payload={"presta_id": presta.id, "equipment_id": eq.id, "sens": "retour", "delta": 1},
    )


async def test_perdu_rendu_apres_reouverture_redevient_fonctionnel(db_session):
    s = db_session
    user = await _membre(s)
    perdu = await make_equipment(s, "Lyre P")
    presta, (a_p,) = await _presta_sortie(s, perdu)

    await cloturer_prestation(presta.id, _cloture((a_p, "perdu")), s, user)
    await rouvrir_prestation(presta.id, s, user)
    assert await _apply_presta_check(s, _retour(presta, perdu), user.id) is True

    assert perdu.statut_actuel == StatutEquipment.FONCTIONNEL
    # Retrouvé : il sort du rapport de clôture.
    assert a_p.decision_cloture is None
    contextes = [log.contexte for log in await _logs(s, perdu)]
    assert "→ Fonctionnel · retrouvé sur « Festival Test »" in contextes


async def test_casse_rendu_reste_en_panne(db_session):
    s = db_session
    user = await _membre(s)
    casse = await make_equipment(s, "Lyre C")
    presta, (a_c,) = await _presta_sortie(s, casse)
    # Cassé mais pas encore physiquement rendu : l'écart est pointé après coup.
    await cloturer_prestation(presta.id, _cloture((a_c, "casse")), s, user)
    a_c.quantite_retournee = 0

    await _apply_presta_check(s, _retour(presta, casse), user.id)

    # Revenu, mais toujours à réparer : ni statut ni rapport ne bougent.
    assert casse.statut_actuel == StatutEquipment.EN_PANNE
    assert a_c.decision_cloture == DecisionCloture.CASSE
