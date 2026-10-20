"""Référentiel des spécifications : catégories en arbre, champs, connecteurs.

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
    ValeurSpecification,
)
from app.models.enums import TypeChampSpec
from app.routers.referentiel import (
    create_categorie,
    create_champ,
    delete_categorie,
    delete_champ,
    get_categorie,
    list_champs,
    update_categorie,
    update_champ,
)
from app.schemas.specs import (
    CategorieCreate,
    CategorieUpdate,
    ChampSpecCreate,
    ChampSpecUpdate,
)
from app.security.rbac import RequireStaff
from app.services.categories import ids_descendants


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


def _nom(prefixe: str = "Cat") -> str:
    return f"{prefixe} {uuid.uuid4().hex[:6]}"


async def _categorie(session, parent_id: int | None = None) -> Categorie:
    c = Categorie(nom=_nom(), parent_id=parent_id)
    session.add(c)
    await session.flush()
    return c


async def _champ(session, categorie_id: int, **kw) -> ChampSpecification:
    kw.setdefault("type", TypeChampSpec.TEXTE)
    kw.setdefault("nom", _nom("Champ"))
    c = ChampSpecification(categorie_id=categorie_id, **kw)
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


async def test_suppression_categorie_avec_enfant_refusee(db_session, staff):
    parent = await _categorie(db_session)
    await _categorie(db_session, parent.id)
    with pytest.raises(HTTPException) as exc:
        await delete_categorie(parent.id, staff, db_session)
    assert exc.value.status_code == 409
    assert "sous-catégorie" in exc.value.detail


async def test_nom_unique_entre_soeurs(db_session, staff):
    a, b = await _categorie(db_session), await _categorie(db_session)
    await create_categorie(CategorieCreate(nom="Beam", parent_id=a.id), staff, db_session)
    with pytest.raises(HTTPException) as exc:
        await create_categorie(CategorieCreate(nom="Beam", parent_id=a.id), staff, db_session)
    assert exc.value.status_code == 409
    autre = await create_categorie(CategorieCreate(nom="Beam", parent_id=b.id), staff, db_session)
    assert (autre.parent_id, autre.chemin) == (b.id, f"{b.nom} › Beam")


async def test_parent_introuvable(db_session, staff):
    with pytest.raises(HTTPException) as exc:
        await create_categorie(CategorieCreate(nom=_nom(), parent_id=10**9), staff, db_session)
    assert exc.value.status_code == 404


async def test_deplacement_anti_cycle(db_session, staff):
    racine = await _categorie(db_session)
    enfant = await _categorie(db_session, racine.id)
    petit = await _categorie(db_session, enfant.id)
    for parent_id in (racine.id, petit.id):
        with pytest.raises(HTTPException) as exc:
            await update_categorie(
                racine.id, CategorieUpdate(parent_id=parent_id), staff, db_session
            )
        assert exc.value.status_code == 422

    autre = await _categorie(db_session)
    res = await update_categorie(enfant.id, CategorieUpdate(parent_id=autre.id), staff, db_session)
    assert res.chemin == f"{autre.nom} › {enfant.nom}"
    assert (await get_categorie(petit.id, staff, db_session)).chemin == (
        f"{autre.nom} › {enfant.nom} › {petit.nom}"
    )
    # parent_id à null : remonte à la racine.
    res = await update_categorie(enfant.id, CategorieUpdate(parent_id=None), staff, db_session)
    assert (res.parent_id, res.chemin) == (None, enfant.nom)


async def test_champs_herites_sur_trois_niveaux(db_session, staff):
    racine = await _categorie(db_session)
    enfant = await _categorie(db_session, racine.id)
    petit = await _categorie(db_session, enfant.id)
    a = await _champ(db_session, racine.id)
    b = await _champ(db_session, enfant.id)
    c = await _champ(db_session, petit.id)
    await _champ(db_session, (await _categorie(db_session, racine.id)).id)  # branche sœur

    lus = await list_champs(staff, db_session, categorie_id=petit.id, herites=True)
    assert [(x.id, x.herite, x.categorie_nom) for x in lus] == [
        (a.id, True, racine.nom),
        (b.id, True, enfant.nom),
        (c.id, False, petit.nom),
    ]
    propres = await list_champs(staff, db_session, categorie_id=petit.id)
    assert [x.id for x in propres] == [c.id]


async def test_nom_de_champ_unique_sur_la_lignee(db_session, staff):
    racine = await _categorie(db_session)
    enfant = await _categorie(db_session, racine.id)
    soeur = await _categorie(db_session, racine.id)
    await create_champ(
        ChampSpecCreate(nom="Angle", type=TypeChampSpec.NOMBRE, categorie_id=enfant.id),
        staff,
        db_session,
    )
    # Ancêtre ou descendant : refusé ; branche sœur : permis.
    for categorie_id in (racine.id, enfant.id):
        with pytest.raises(HTTPException) as exc:
            await create_champ(
                ChampSpecCreate(nom="Angle", type=TypeChampSpec.NOMBRE, categorie_id=categorie_id),
                staff,
                db_session,
            )
        assert exc.value.status_code == 409
    await create_champ(
        ChampSpecCreate(nom="Angle", type=TypeChampSpec.NOMBRE, categorie_id=soeur.id),
        staff,
        db_session,
    )


async def test_deplacement_refuse_si_champ_homonyme(db_session, staff):
    a, b = await _categorie(db_session), await _categorie(db_session)
    champ = await _champ(db_session, a.id)
    await _champ(db_session, b.id, nom=champ.nom)
    with pytest.raises(HTTPException) as exc:
        await update_categorie(b.id, CategorieUpdate(parent_id=a.id), staff, db_session)
    assert exc.value.status_code == 409
    assert champ.nom in exc.value.detail


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
        "/api/champs-specification",
        "/api/connecteurs",
    )
    vues = 0
    for path, methods, endpoint in routes_montees():
        if path.startswith(prefixes) and methods & {"POST", "PATCH", "DELETE"}:
            hints = typing.get_type_hints(endpoint, include_extras=True)
            assert hints["_user"] is RequireStaff, path
            vues += 1
    assert vues == 9


async def test_fiche_categorie(db_session, staff):
    c = await _categorie(db_session)
    assert (await get_categorie(c.id, staff, db_session)).nom == c.nom
    with pytest.raises(HTTPException) as exc:
        await get_categorie(10**9, staff, db_session)
    assert exc.value.status_code == 404


async def test_descendants_pour_filtre_du_parc(db_session):
    racine = await _categorie(db_session)
    enfant = await _categorie(db_session, racine.id)
    petit = await _categorie(db_session, enfant.id)
    await _categorie(db_session)  # hors arbre
    ids = set((await db_session.scalars(ids_descendants(racine.id))).all())
    assert ids == {racine.id, enfant.id, petit.id}
