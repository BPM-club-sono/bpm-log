"""Référentiel des spécifications : catégories, sous-catégories, champs, connecteurs.

Session non commitée (rollback en teardown) ; les routeurs sont appelés en direct.
"""

import typing
import uuid

import pytest
from conftest import routes_montees
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models import (
    Categorie,
    ChampSpecification,
    Membre,
    Modele,
    SousCategorie,
    ValeurSpecification,
)
from app.models.enums import TypeChampSpec
from app.routers.referentiel import (
    create_categorie,
    create_champ,
    create_sous_categorie,
    delete_categorie,
    delete_champ,
    delete_sous_categorie,
    get_categorie,
    list_champs,
    update_champ,
)
from app.schemas.specs import (
    CategorieCreate,
    ChampSpecCreate,
    ChampSpecUpdate,
    SousCategorieCreate,
)
from app.security.rbac import RequireStaff


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


def _nom(prefixe: str = "Cat") -> str:
    return f"{prefixe} {uuid.uuid4().hex[:6]}"


async def _categorie(session) -> Categorie:
    c = Categorie(nom=_nom())
    session.add(c)
    await session.flush()
    return c


async def _champ(session, categorie_id: int, **kw) -> ChampSpecification:
    kw.setdefault("type", TypeChampSpec.TEXTE)
    c = ChampSpecification(nom=_nom("Champ"), categorie_id=categorie_id, **kw)
    session.add(c)
    await session.flush()
    return c


async def _valeur(session, champ_id: int, valeur: str) -> ValeurSpecification:
    m = Modele(nom=_nom("MH"))
    session.add(m)
    await session.flush()
    v = ValeurSpecification(champ_id=champ_id, modele_id=m.id, valeur=valeur)
    session.add(v)
    await session.flush()
    return v


async def test_categorie_crud_et_doublon(db_session, staff):
    nom = _nom("Lights X")
    cat = await create_categorie(CategorieCreate(nom=nom), staff, db_session)
    assert cat.nom == nom
    with pytest.raises(HTTPException) as exc:
        await create_categorie(CategorieCreate(nom=nom), staff, db_session)
    assert exc.value.status_code == 409


async def test_suppression_categorie_utilisee_refusee(db_session, staff):
    cat = await _categorie(db_session)
    db_session.add(Modele(nom=_nom("MH"), categorie_id=cat.id))
    await db_session.flush()
    with pytest.raises(HTTPException) as exc:
        await delete_categorie(cat.id, staff, db_session)
    assert exc.value.status_code == 409

    vide = await _categorie(db_session)
    await delete_categorie(vide.id, staff, db_session)
    assert await db_session.get(Categorie, vide.id) is None


async def test_sous_categorie_doublon_par_categorie(db_session, staff):
    a, b = await _categorie(db_session), await _categorie(db_session)
    await create_sous_categorie(
        SousCategorieCreate(nom="Beam", categorie_id=a.id), staff, db_session
    )
    with pytest.raises(HTTPException) as exc:
        await create_sous_categorie(
            SousCategorieCreate(nom="Beam", categorie_id=a.id), staff, db_session
        )
    assert exc.value.status_code == 409
    autre = await create_sous_categorie(
        SousCategorieCreate(nom="Beam", categorie_id=b.id), staff, db_session
    )
    assert autre.categorie_id == b.id


async def test_suppression_sous_categorie_utilisee_refusee(db_session, staff):
    cat = await _categorie(db_session)
    sc = SousCategorie(nom="Beam", categorie_id=cat.id)
    db_session.add(sc)
    await db_session.flush()
    db_session.add(Modele(nom=_nom("MH"), categorie_id=cat.id, sous_categorie_id=sc.id))
    await db_session.flush()
    with pytest.raises(HTTPException) as exc:
        await delete_sous_categorie(sc.id, staff, db_session)
    assert exc.value.status_code == 409


async def test_champ_sous_categorie_hors_categorie(db_session, staff):
    a, b = await _categorie(db_session), await _categorie(db_session)
    sc = SousCategorie(nom="Beam", categorie_id=a.id)
    db_session.add(sc)
    await db_session.flush()
    with pytest.raises(HTTPException) as exc:
        await create_champ(
            ChampSpecCreate(
                nom="Poids", type=TypeChampSpec.NOMBRE, categorie_id=b.id, sous_categorie_id=sc.id
            ),
            staff,
            db_session,
        )
    assert exc.value.status_code == 422


async def test_champ_choix_sans_option(db_session, staff):
    cat = await _categorie(db_session)
    with pytest.raises(HTTPException) as exc:
        await create_champ(
            ChampSpecCreate(
                nom="Type", type=TypeChampSpec.CHOIX, options=[" "], categorie_id=cat.id
            ),
            staff,
            db_session,
        )
    assert exc.value.status_code == 422


async def test_changement_type_avec_valeurs_refuse(db_session, staff):
    cat = await _categorie(db_session)
    champ = await _champ(db_session, cat.id)
    await _valeur(db_session, champ.id, "x")
    with pytest.raises(HTTPException) as exc:
        await update_champ(champ.id, ChampSpecUpdate(type=TypeChampSpec.NOMBRE), staff, db_session)
    assert exc.value.status_code == 409

    libre = await _champ(db_session, cat.id)
    res = await update_champ(
        libre.id, ChampSpecUpdate(type=TypeChampSpec.NOMBRE), staff, db_session
    )
    assert res.type == TypeChampSpec.NOMBRE


async def test_retrait_option_utilisee_refuse(db_session, staff):
    cat = await _categorie(db_session)
    champ = await _champ(db_session, cat.id, type=TypeChampSpec.CHOIX, options=["Actif", "Passif"])
    await _valeur(db_session, champ.id, "Actif")
    with pytest.raises(HTTPException) as exc:
        await update_champ(champ.id, ChampSpecUpdate(options=["Passif"]), staff, db_session)
    assert exc.value.status_code == 409
    assert "Actif" in exc.value.detail
    res = await update_champ(
        champ.id, ChampSpecUpdate(options=["Actif", "Passif", "Autre"]), staff, db_session
    )
    assert res.options == ["Actif", "Passif", "Autre"]


async def test_suppression_champ_cascade(db_session, staff):
    cat = await _categorie(db_session)
    champ = await _champ(db_session, cat.id)
    await _valeur(db_session, champ.id, "a")
    await _valeur(db_session, champ.id, "b")
    lus = await list_champs(staff, db_session, categorie_id=cat.id)
    assert [c.nb_valeurs for c in lus if c.id == champ.id] == [2]
    await delete_champ(champ.id, staff, db_session)
    restant = await db_session.scalar(
        select(func.count())
        .select_from(ValeurSpecification)
        .where(ValeurSpecification.champ_id == champ.id)
    )
    assert restant == 0


def test_ecritures_exigent_staff():
    prefixes = (
        "/api/categories",
        "/api/sous-categories",
        "/api/champs-specification",
        "/api/connecteurs",
    )
    vues = 0
    for path, methods, endpoint in routes_montees():
        if path.startswith(prefixes) and methods & {"POST", "PATCH", "DELETE"}:
            hints = typing.get_type_hints(endpoint, include_extras=True)
            assert hints["_user"] is RequireStaff, path
            vues += 1
    assert vues == 12


async def test_fiche_categorie(db_session, staff):
    c = await _categorie(db_session)
    assert (await get_categorie(c.id, staff, db_session)).nom == c.nom
    with pytest.raises(HTTPException) as exc:
        await get_categorie(10**9, staff, db_session)
    assert exc.value.status_code == 404
