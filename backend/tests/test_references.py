"""Tests du format des références matériel (contenu des QR codes).

Session non commitée (rollback en teardown) : la base de dev n'est pas polluée.
La contrainte CHECK est en revanche bien vérifiée par PostgreSQL au `flush()`.
"""

import pytest
import sqlalchemy as sa
from conftest import make_equipment
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import Equipment
from app.services import barcode, references


def test_construire_produit_dix_caracteres():
    assert barcode.construire("BPM", 42) == "BPM-000042"
    assert len(barcode.construire("NOV", 999999)) == 10


def test_construire_refuse_un_trigramme_invalide():
    for mauvais in ["BP", "BPMX", "bpm", "BP1", ""]:
        with pytest.raises(ValueError):
            barcode.construire(mauvais, 1)


def test_construire_refuse_un_numero_hors_plage():
    with pytest.raises(ValueError):
        barcode.construire("BPM", barcode.NUMERO_MAX + 1)


def test_normaliser_met_en_majuscules_et_coupe_les_espaces():
    assert barcode.normaliser("  bpm-000042 ") == "BPM-000042"


def test_est_conforme():
    assert barcode.est_conforme("BPM-000042")
    # Les formats historiques débordent des 10 caractères.
    assert not barcode.est_conforme("BPM-LUM-0001")
    # Les minuscules feraient basculer le QR en mode Byte, donc en version 2.
    assert not barcode.est_conforme("bpm-000042")


@pytest.mark.parametrize(
    ("nom", "attendu"),
    [
        ("Novelty", "NOV"),
        ("Événement Loc", "EVE"),  # accents retirés
        ("AV", "AVX"),  # complété
        ("42", None),  # aucune lettre
        ("BPM Prod", None),  # réservé : l'admin doit trancher
    ],
)
def test_deriver_trigramme(nom, attendu):
    assert barcode.deriver_trigramme(nom) == attendu


async def test_reference_attribuee_est_conforme(db_session):
    eq = await make_equipment(db_session, "Équipement test")
    assert barcode.est_conforme(eq.barcode_uid)
    assert eq.barcode_uid == barcode.construire(barcode.PREFIXE_TEST, eq.id)


async def test_la_base_refuse_une_reference_trop_longue(db_session):
    """La colonne est dimensionnée sur les 10 caractères d'un QR v1 + H."""
    db_session.add(Equipment(barcode_uid="BPM-LUM-0001", nom="Ancien format"))
    with pytest.raises(DBAPIError):
        await db_session.flush()


async def test_la_base_refuse_une_reference_hors_format(db_session):
    """Le CHECK attrape ce qui passe la longueur : ici, des minuscules.

    Elles feraient basculer le QR en mode Byte, donc en version 2 — c'est
    exactement ce que le format interdit. Dernière ligne de défense,
    indépendante de l'application.
    """
    db_session.add(Equipment(barcode_uid="bpm-000042", nom="Minuscules"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_reserver_saute_un_code_deja_pris(db_session):
    """Une référence personnalisée peut occuper le code d'un id non attribué.

    Sans le saut, la création de cet équipement partirait en violation d'unicité
    — donc en 500. On préfère un trou dans la numérotation.
    """
    prochain = await db_session.scalar(
        sa.select(sa.func.nextval(sa.text("pg_get_serial_sequence('equipments','id')")))
    )
    # On pose à la main, sur un autre équipement, le code que le suivant recevrait.
    occupe = barcode.construire(barcode.PREFIXE_TEST, prochain + 1)
    squatteur = await make_equipment(db_session, "Squatteur")
    squatteur.barcode_uid = occupe
    await db_session.flush()

    _, reference = await references.reserver(db_session, barcode.PREFIXE_TEST)
    assert reference != occupe
    assert barcode.est_conforme(reference)
