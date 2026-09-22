"""Statut de prestation dérivé du pointage (app/services/prestation_statut.py).

Ébauche → En préparation au premier élément sorti → En cours quand tout le
matériel prévu est sorti. `Terminee` est terminal : posé par la clôture, retiré
par la réouverture.

Session de test rollbackée en teardown ; les tests qui passent par un routeur
(qui commite) vident d'abord la table pour rester déterministes.
"""

import uuid
from datetime import UTC, datetime

from conftest import make_equipment
from sqlalchemy import delete, select, update

from app.models import AllocationPresta, Equipment, InventaireVrac, Prestation
from app.models.enums import StatutAllocation, StatutPrestation, TypePrestation
from app.routers.prestations import add_allocation, remove_allocation, rouvrir_prestation
from app.routers.sync import _apply_presta_check
from app.schemas.prestation import AllocationCreate
from app.schemas.sync import SyncItemIn
from app.services.prestation_statut import statut_derive


async def _clear_prestations(session) -> None:
    await session.execute(update(InventaireVrac).values(presta_id=None))
    await session.execute(delete(AllocationPresta))
    await session.execute(delete(Prestation))
    await session.flush()


async def _presta(session, nom: str = "Presta Statut") -> Prestation:
    presta = Prestation(
        nom=nom, type=TypePrestation.EXTERNE, statut=StatutPrestation.EBAUCHE
    )
    session.add(presta)
    await session.flush()
    return presta


async def _alloc(session, presta: Prestation, eq: Equipment, quantite: int = 1):
    alloc = AllocationPresta(
        presta_id=presta.id,
        equipment_id=eq.id,
        quantite=quantite,
        statut=StatutAllocation.PLANIFIE,
    )
    session.add(alloc)
    await session.flush()
    return alloc


def _check(presta: Prestation, eq: Equipment, sens: str, delta: int) -> SyncItemIn:
    return SyncItemIn(
        uuid_client=uuid.uuid4(),
        type="presta_check",
        offline_created_at=datetime.now(UTC),
        payload={
            "presta_id": presta.id,
            "equipment_id": eq.id,
            "sens": sens,
            "delta": delta,
        },
    )


# --- Progression automatique du statut -------------------------------------


async def test_premier_pointage_passe_en_preparation(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    b = await make_equipment(s, "Lyre B")
    await _alloc(s, presta, a)
    await _alloc(s, presta, b)

    assert presta.statut == StatutPrestation.EBAUCHE
    assert await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1) is True
    assert presta.statut == StatutPrestation.EN_PREPARATION


async def test_tout_sorti_passe_en_cours(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    b = await make_equipment(s, "Lyre B")
    await _alloc(s, presta, a)
    await _alloc(s, presta, b)

    await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1)
    await _apply_presta_check(s, _check(presta, b, "sortie", 1), 1)
    assert presta.statut == StatutPrestation.EN_COURS


async def test_depointage_redescend_le_statut(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    await _alloc(s, presta, a)

    await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1)
    assert presta.statut == StatutPrestation.EN_COURS
    # Un dé-pointage ramène la prestation à l'état « rien n'est parti ».
    await _apply_presta_check(s, _check(presta, a, "sortie", -1), 1)
    assert presta.statut == StatutPrestation.EBAUCHE


async def test_retour_ne_change_pas_le_statut(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    await _alloc(s, presta, a)

    await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1)
    await _apply_presta_check(s, _check(presta, a, "retour", 1), 1)
    # Le retour ne referme pas la prestation : seule la clôture le fait.
    assert presta.statut == StatutPrestation.EN_COURS


async def test_rejeu_meme_uuid_ne_touche_pas_au_statut(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    b = await make_equipment(s, "Lyre B")
    await _alloc(s, presta, a)
    await _alloc(s, presta, b)

    item = _check(presta, a, "sortie", 1)
    assert await _apply_presta_check(s, item, 1) is True
    assert await _apply_presta_check(s, item, 1) is False
    assert presta.statut == StatutPrestation.EN_PREPARATION


async def test_prestation_terminee_reste_terminee(db_session):
    s = db_session
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    alloc = await _alloc(s, presta, a)
    presta.statut = StatutPrestation.TERMINEE
    await s.flush()

    assert await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1) is True
    # Le pointage s'applique quand même, mais l'état terminal ne bouge pas.
    assert alloc.quantite_sortie == 1
    assert presta.statut == StatutPrestation.TERMINEE


async def test_prestation_sans_allocation_reste_ebauche(db_session):
    s = db_session
    presta = await _presta(s)
    assert await statut_derive(s, presta.id) == StatutPrestation.EBAUCHE


# --- Allocations et réouverture (passent par les routeurs, donc commitent) ---


async def test_ajout_allocation_fait_retomber_en_preparation(db_session):
    s = db_session
    await _clear_prestations(s)
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    b = await make_equipment(s, "Lyre B")
    await _alloc(s, presta, a)

    await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1)
    assert presta.statut == StatutPrestation.EN_COURS

    # Une ligne ajoutée après coup n'est pas encore sortie : on repasse en prépa.
    await add_allocation(
        presta.id, AllocationCreate(equipment_id=b.id, quantite=1), s, None
    )
    assert presta.statut == StatutPrestation.EN_PREPARATION

    # La retirer referme l'écart : tout le prévu est de nouveau sorti.
    alloc_b = await s.scalar(
        select(AllocationPresta).where(
            AllocationPresta.presta_id == presta.id,
            AllocationPresta.equipment_id == b.id,
        )
    )
    await remove_allocation(presta.id, alloc_b.id, s, None)
    assert presta.statut == StatutPrestation.EN_COURS


async def test_reouverture_recalcule_le_statut_et_est_idempotente(db_session):
    s = db_session
    await _clear_prestations(s)
    presta = await _presta(s)
    a = await make_equipment(s, "Lyre A")
    b = await make_equipment(s, "Lyre B")
    await _alloc(s, presta, a)
    await _alloc(s, presta, b)
    await _apply_presta_check(s, _check(presta, a, "sortie", 1), 1)
    presta.statut = StatutPrestation.TERMINEE
    await s.flush()

    detail = await rouvrir_prestation(presta.id, s, None)
    assert detail.statut == StatutPrestation.EN_PREPARATION
    assert presta.statut == StatutPrestation.EN_PREPARATION

    # Rappeler la route ne fait que réaligner : aucun effet supplémentaire.
    again = await rouvrir_prestation(presta.id, s, None)
    assert again.statut == StatutPrestation.EN_PREPARATION


async def test_update_prestation_ne_peut_plus_forcer_le_statut():
    from app.schemas.prestation import PrestationUpdate

    # Le champ n'existe plus : un client qui l'envoie se le voit ignorer.
    data = PrestationUpdate.model_validate({"statut": "Terminee", "nom": "Renommée"})
    assert "statut" not in data.model_dump(exclude_unset=True)


# --- Câblage HTTP (le schéma OpenAPI reflète les routes réellement montées) --


async def test_route_reouverture_montee_et_statut_absent_du_patch(client):
    schema = (await client.get("/openapi.json")).json()
    assert "/api/prestations/{presta_id}/reouverture" in schema["paths"]
    props = schema["components"]["schemas"]["PrestationUpdate"]["properties"]
    assert "statut" not in props
