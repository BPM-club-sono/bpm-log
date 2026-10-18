"""Contraintes du modèle de données des spécifications techniques."""

import pytest
from conftest import make_equipment
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Categorie,
    ChampSpecification,
    Connecteur,
    Connectique,
    Modele,
    ValeurSpecification,
)
from app.models.enums import SensConnectique, TypeChampSpec


async def _champ(db_session) -> ChampSpecification:
    cat = Categorie(nom="Son")
    db_session.add(cat)
    await db_session.flush()
    champ = ChampSpecification(
        nom="Puissance", type=TypeChampSpec.NOMBRE, unite="W", categorie_id=cat.id
    )
    db_session.add(champ)
    await db_session.flush()
    return champ


async def test_valeur_cible_exclusive(db_session):
    champ = await _champ(db_session)
    modele = Modele(nom="M-1")
    db_session.add(modele)
    eq = await make_equipment(db_session, "Enceinte")

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                ValeurSpecification(
                    champ_id=champ.id, modele_id=modele.id, equipment_id=eq.id, valeur="1"
                )
            )
            await db_session.flush()

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(ValeurSpecification(champ_id=champ.id, valeur="1"))
            await db_session.flush()


async def test_connectique_quantite_positive(db_session):
    modele = Modele(nom="M-2")
    conn = Connecteur(nom="XLR 3 broches")
    db_session.add_all([modele, conn])
    await db_session.flush()
    with pytest.raises(IntegrityError):
        db_session.add(
            Connectique(
                connecteur_id=conn.id,
                sens=SensConnectique.ENTREE,
                quantite=0,
                modele_id=modele.id,
            )
        )
        await db_session.flush()


async def test_cascade_suppression(db_session):
    champ = await _champ(db_session)
    modele = Modele(nom="M-3")
    conn = Connecteur(nom="Speakon")
    db_session.add_all([modele, conn])
    eq = await make_equipment(db_session, "Sans modèle")
    await db_session.flush()
    db_session.add_all(
        [
            ValeurSpecification(champ_id=champ.id, modele_id=modele.id, valeur="1"),
            Connectique(
                connecteur_id=conn.id,
                sens=SensConnectique.SORTIE,
                quantite=2,
                modele_id=modele.id,
            ),
            ValeurSpecification(champ_id=champ.id, equipment_id=eq.id, valeur="2"),
            Connectique(
                connecteur_id=conn.id,
                sens=SensConnectique.SORTIE,
                quantite=1,
                equipment_id=eq.id,
            ),
        ]
    )
    await db_session.flush()

    await db_session.delete(modele)
    await db_session.delete(eq)
    await db_session.flush()

    for table in (ValeurSpecification, Connectique):
        n = await db_session.scalar(
            select(func.count())
            .select_from(table)
            .where((table.modele_id == modele.id) | (table.equipment_id == eq.id))
        )
        assert n == 0
