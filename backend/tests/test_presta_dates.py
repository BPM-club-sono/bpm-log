"""Dates de prestation : sélection temporelle du dashboard + validation de période.

Les tests DB nettoient la table `prestations` *dans* la transaction de test
(rollback en teardown via la fixture `db_session`), pour être déterministes
malgré les données de la base clonée. Rien n'est commité.
"""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, update

from app.models import AllocationPresta, InventaireVrac, Prestation
from app.models.enums import StatutPrestation, TypePrestation
from app.routers.dashboard import _prestation_courante
from app.routers.prestations import update_prestation
from app.schemas.prestation import PrestationCreate, PrestationUpdate


async def _clear_prestations(session) -> None:
    # On dénoue les FK avant de vider la table (tout est rollbacké ensuite).
    await session.execute(update(InventaireVrac).values(presta_id=None))
    await session.execute(delete(AllocationPresta))
    await session.execute(delete(Prestation))
    await session.flush()


def _presta(
    nom: str,
    debut: date | None,
    fin: date | None,
    statut: StatutPrestation = StatutPrestation.EN_PREPARATION,
) -> Prestation:
    return Prestation(
        nom=nom,
        type=TypePrestation.INTERNE,
        statut=statut,
        date_debut=debut,
        date_fin=fin,
    )


# --- Sélection de la prestation courante (dashboard) -----------------------


async def test_courante_prefere_en_cours_aujourdhui(db_session):
    s = db_session
    await _clear_prestations(s)
    today = date.today()
    s.add_all(
        [
            _presta("Futur", today + timedelta(days=10), today + timedelta(days=11)),
            _presta("Aujourdhui", today - timedelta(days=1), today + timedelta(days=1)),
            _presta("Passe", today - timedelta(days=10), today - timedelta(days=9)),
        ]
    )
    await s.flush()

    courante = await _prestation_courante(s)
    assert courante is not None
    assert courante.nom == "Aujourdhui"
    assert courante.a_venir is False


async def test_courante_sinon_prochaine_a_venir(db_session):
    s = db_session
    await _clear_prestations(s)
    today = date.today()
    s.add_all(
        [
            _presta("Lointain", today + timedelta(days=30), None),
            _presta("Bientot", today + timedelta(days=2), today + timedelta(days=3)),
            _presta("Passe", today - timedelta(days=5), today - timedelta(days=4)),
        ]
    )
    await s.flush()

    courante = await _prestation_courante(s)
    assert courante is not None
    assert courante.nom == "Bientot"
    assert courante.a_venir is True


async def test_courante_exclut_terminee_datee(db_session):
    s = db_session
    await _clear_prestations(s)
    today = date.today()
    s.add(
        _presta(
            "TermineeFuture",
            today + timedelta(days=1),
            today + timedelta(days=2),
            statut=StatutPrestation.TERMINEE,
        )
    )
    await s.flush()

    # Aucune presta datée éligible et pas de repli (terminée ≠ en cours/préparation).
    assert await _prestation_courante(s) is None


async def test_courante_repli_sur_statut_sans_date(db_session):
    s = db_session
    await _clear_prestations(s)
    s.add(_presta("SansDate", None, None, statut=StatutPrestation.EN_PREPARATION))
    await s.flush()

    courante = await _prestation_courante(s)
    assert courante is not None
    assert courante.nom == "SansDate"
    assert courante.a_venir is True


async def test_statut_par_defaut_est_ebauche(db_session):
    s = db_session
    await _clear_prestations(s)
    # Pas de statut explicite → l'ORM applique le défaut « Ébauche ».
    presta = Prestation(nom="Neuve", type=TypePrestation.INTERNE)
    s.add(presta)
    await s.flush()
    assert presta.statut == StatutPrestation.EBAUCHE


async def test_courante_repli_inclut_ebauche(db_session):
    s = db_session
    await _clear_prestations(s)
    s.add(_presta("Brouillon", None, None, statut=StatutPrestation.EBAUCHE))
    await s.flush()

    courante = await _prestation_courante(s)
    assert courante is not None
    assert courante.nom == "Brouillon"
    # Une ébauche sans date est « à venir » (pas encore démarrée).
    assert courante.a_venir is True


# --- Validation de période (schémas Pydantic, sans DB) ---------------------


def test_create_rejette_fin_avant_debut():
    with pytest.raises(ValidationError):
        PrestationCreate(
            nom="x", date_debut=date(2026, 6, 12), date_fin=date(2026, 6, 10)
        )


def test_create_accepte_periode_valide_et_partielle():
    p = PrestationCreate(
        nom="x", date_debut=date(2026, 6, 12), date_fin=date(2026, 6, 14)
    )
    assert p.date_debut is not None and p.date_fin is not None
    # Une seule borne ou aucune reste valide.
    assert PrestationCreate(nom="x", date_debut=date(2026, 6, 12)).date_fin is None
    assert PrestationCreate(nom="x").date_debut is None


def test_update_rejette_fin_avant_debut():
    with pytest.raises(ValidationError):
        PrestationUpdate(date_debut=date(2026, 6, 12), date_fin=date(2026, 6, 10))


# --- PATCH partiel : période revalidée sur l'état final (DB + payload) ------


async def _presta_datee(s, monkeypatch) -> Prestation:
    # update_prestation commit ; on remplace commit par flush pour rester dans la
    # transaction rollback-able du test (cf. promesse « aucune écriture commitée »).
    monkeypatch.setattr(s, "commit", s.flush)
    await _clear_prestations(s)
    presta = _presta("Dejala", date(2026, 6, 12), date(2026, 6, 14))
    s.add(presta)
    await s.flush()
    return presta


async def test_patch_fin_seule_incoherente_avec_debut_existant(db_session, monkeypatch):
    s = db_session
    presta = await _presta_datee(s, monkeypatch)

    # On ne patche que date_fin, en-dessous du date_debut déjà en base.
    with pytest.raises(HTTPException) as exc:
        await update_prestation(
            presta.id, PrestationUpdate(date_fin=date(2026, 6, 10)), s, None
        )
    assert exc.value.status_code == 422


async def test_patch_debut_seul_incoherent_avec_fin_existante(db_session, monkeypatch):
    s = db_session
    presta = await _presta_datee(s, monkeypatch)

    # On ne patche que date_debut, au-delà du date_fin déjà en base.
    with pytest.raises(HTTPException) as exc:
        await update_prestation(
            presta.id, PrestationUpdate(date_debut=date(2026, 6, 20)), s, None
        )
    assert exc.value.status_code == 422


async def test_patch_borne_seule_coherente_accepte(db_session, monkeypatch):
    s = db_session
    presta = await _presta_datee(s, monkeypatch)

    # date_fin repoussée mais toujours >= date_debut existant : accepté.
    updated = await update_prestation(
        presta.id, PrestationUpdate(date_fin=date(2026, 6, 18)), s, None
    )
    assert updated.date_fin == date(2026, 6, 18)
    assert updated.date_debut == date(2026, 6, 12)
