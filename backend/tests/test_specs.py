"""Spécifications d'un modèle ou d'un item sans modèle, et remarque par unité.

Session non commitée (rollback en teardown) ; les routeurs sont appelés en direct.
"""

import typing
import uuid

import pytest
from conftest import make_equipment, routes_montees
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models import (
    Categorie,
    ChampSpecification,
    Connecteur,
    Connectique,
    Membre,
    Modele,
    SousCategorie,
    ValeurSpecification,
)
from app.models.enums import SensConnectique, TypeChampSpec
from app.routers.equipment import create_equipment, get_equipment, update_equipment
from app.routers.modeles import update_modele
from app.routers.specs import (
    ecrire_specs_equipment,
    ecrire_specs_modele,
    lire_specs_equipment,
    lire_specs_modele,
)
from app.schemas.equipment import EquipmentCreate, EquipmentUpdate, ModeleUpdate
from app.schemas.specs import ConnectiqueIn, SpecsWrite
from app.security.rbac import RequireStaff


@pytest.fixture
async def staff(db_session, membre_id) -> Membre:
    return await db_session.get(Membre, membre_id)


def _nom(prefixe: str) -> str:
    return f"{prefixe} {uuid.uuid4().hex[:6]}"


async def _ajouter(session, obj):
    session.add(obj)
    await session.flush()
    return obj


async def _categorie(session) -> Categorie:
    return await _ajouter(session, Categorie(nom=_nom("Cat")))


async def _champ(session, categorie_id: int, type_=TypeChampSpec.NOMBRE, **kw):
    return await _ajouter(
        session,
        ChampSpecification(nom=_nom("Champ"), type=type_, categorie_id=categorie_id, **kw),
    )


async def _connecteur(session, prefixe: str) -> Connecteur:
    return await _ajouter(session, Connecteur(nom=_nom(prefixe)))


async def _modele(session, **kw) -> Modele:
    return await _ajouter(session, Modele(nom=_nom("MH"), **kw))


async def _modele_avec_specs(session, staff):
    """Modèle complet : sous-catégorie, poids, prix, une valeur, deux connectiques."""
    cat = await _categorie(session)
    sc = await _ajouter(session, SousCategorie(nom=_nom("Beam"), categorie_id=cat.id))
    champ = await _champ(session, cat.id, unite="W")
    powercon = await _connecteur(session, "PowerCon")
    linecon = await _connecteur(session, "LineCon")
    modele = await _modele(session, categorie_id=cat.id)
    data = SpecsWrite(
        sous_categorie_id=sc.id,
        poids=12.5,
        longueur=200,
        prix_interne=30,
        prix_externe=60,
        valeurs={champ.id: "300"},
        connectiques=[
            ConnectiqueIn(connecteur_id=powercon.id, sens=SensConnectique.ENTREE, quantite=1),
            ConnectiqueIn(connecteur_id=linecon.id, sens=SensConnectique.SORTIE, quantite=1),
        ],
    )
    await ecrire_specs_modele(modele.id, data, staff, session)
    return modele, cat, sc, champ, powercon, linecon


async def test_modele_specs_aller_retour(db_session, staff):
    modele, cat, sc, champ, powercon, linecon = await _modele_avec_specs(db_session, staff)

    specs = await lire_specs_modele(modele.id, staff, db_session)
    assert specs.source == "modele"
    assert specs.modele_id == modele.id
    assert specs.categorie_id == cat.id
    assert (specs.sous_categorie_id, specs.sous_categorie_nom) == (sc.id, sc.nom)
    assert (specs.poids, specs.longueur, specs.largeur, specs.hauteur) == (12.5, 200, None, None)
    assert (specs.prix_interne, specs.prix_externe) == (30, 60)
    assert [(v.champ_id, v.nom, v.type, v.unite, v.valeur) for v in specs.valeurs] == [
        (champ.id, champ.nom, TypeChampSpec.NOMBRE, "W", "300")
    ]
    assert [
        (c.connecteur_id, c.connecteur_nom, c.sens, c.quantite) for c in specs.connectiques
    ] == [
        (powercon.id, powercon.nom, SensConnectique.ENTREE, 1),
        (linecon.id, linecon.nom, SensConnectique.SORTIE, 1),
    ]


async def test_valeurs_listent_les_champs_applicables(db_session, staff):
    """Champs de la catégorie + ceux de la sous-catégorie, triés (ordre, nom), vides à None."""
    cat = await _categorie(db_session)
    sc = await _ajouter(db_session, SousCategorie(nom=_nom("Beam"), categorie_id=cat.id))
    autre_sc = await _ajouter(db_session, SousCategorie(nom=_nom("Wash"), categorie_id=cat.id))
    general = await _champ(db_session, cat.id, ordre=2)
    restreint = await _champ(db_session, cat.id, ordre=1, sous_categorie_id=sc.id)
    await _champ(db_session, cat.id, sous_categorie_id=autre_sc.id)
    modele = await _modele(db_session, categorie_id=cat.id, sous_categorie_id=sc.id)

    specs = await lire_specs_modele(modele.id, staff, db_session)
    assert [(v.champ_id, v.valeur) for v in specs.valeurs] == [
        (restreint.id, None),
        (general.id, None),
    ]


async def test_unite_herite_du_modele(db_session, staff):
    modele, *_ = await _modele_avec_specs(db_session, staff)
    unite = await make_equipment(
        db_session, "Lyre 1", modele_id=modele.id, categorie_id=modele.categorie_id
    )

    specs = await lire_specs_equipment(unite.id, staff, db_session)
    assert specs.source == "modele"
    assert specs.modele_id == modele.id
    assert specs.poids == 12.5

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_equipment(unite.id, SpecsWrite(poids=1), staff, db_session)
    assert exc.value.status_code == 409
    assert exc.value.detail == "Les spécifications se modifient sur le modèle."


async def test_item_sans_modele_specs_propres(db_session, staff):
    flight = await make_equipment(db_session, "Flight 1", est_contenant=True)

    retour = await ecrire_specs_equipment(flight.id, SpecsWrite(poids=8), staff, db_session)
    assert retour.poids == 8

    specs = await lire_specs_equipment(flight.id, staff, db_session)
    assert specs.source == "equipement"
    assert specs.modele_id is None
    assert specs.poids == 8


async def test_nombre_virgule_francaise(db_session, staff):
    cat = await _categorie(db_session)
    champ = await _champ(db_session, cat.id)
    modele = await _modele(db_session, categorie_id=cat.id)

    await ecrire_specs_modele(modele.id, SpecsWrite(valeurs={champ.id: "1,5"}), staff, db_session)
    stockee = await db_session.scalar(
        select(ValeurSpecification.valeur).where(ValeurSpecification.modele_id == modele.id)
    )
    assert stockee == "1.5"

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_modele(
            modele.id, SpecsWrite(valeurs={champ.id: "abc"}), staff, db_session
        )
    assert exc.value.status_code == 422


async def test_choix_et_oui_non_valides(db_session, staff):
    cat = await _categorie(db_session)
    choix = await _champ(db_session, cat.id, TypeChampSpec.CHOIX, options=["Actif", "Passif"])
    oui_non = await _champ(db_session, cat.id, TypeChampSpec.OUI_NON)
    modele = await _modele(db_session, categorie_id=cat.id)

    for champ, brut in ((choix, "Autre"), (oui_non, "peut-être")):
        with pytest.raises(HTTPException) as exc:
            await ecrire_specs_modele(
                modele.id, SpecsWrite(valeurs={champ.id: brut}), staff, db_session
            )
        assert exc.value.status_code == 422

    await ecrire_specs_modele(
        modele.id, SpecsWrite(valeurs={choix.id: "Actif", oui_non.id: "true"}), staff, db_session
    )
    specs = await lire_specs_modele(modele.id, staff, db_session)
    assert {v.champ_id: v.valeur for v in specs.valeurs} == {choix.id: "Actif", oui_non.id: "true"}


async def test_valeur_vide_supprime_la_ligne(db_session, staff):
    cat = await _categorie(db_session)
    champ = await _champ(db_session, cat.id, TypeChampSpec.TEXTE)
    autre = await _champ(db_session, cat.id, TypeChampSpec.TEXTE)
    modele = await _modele(db_session, categorie_id=cat.id)
    await ecrire_specs_modele(
        modele.id, SpecsWrite(valeurs={champ.id: " DMX ", autre.id: "x"}), staff, db_session
    )

    # Seules les clés fournies sont touchées : `autre` reste.
    specs = await ecrire_specs_modele(
        modele.id, SpecsWrite(valeurs={champ.id: "  "}), staff, db_session
    )
    assert {v.champ_id: v.valeur for v in specs.valeurs} == {champ.id: None, autre.id: "x"}


async def test_valeur_champ_non_applicable_refusee(db_session, staff):
    cat, autre_cat = await _categorie(db_session), await _categorie(db_session)
    etranger = await _champ(db_session, autre_cat.id)
    modele = await _modele(db_session, categorie_id=cat.id)

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_modele(
            modele.id, SpecsWrite(valeurs={etranger.id: "3"}), staff, db_session
        )
    assert exc.value.status_code == 422


async def test_sous_categorie_hors_categorie_refusee(db_session, staff):
    cat, autre_cat = await _categorie(db_session), await _categorie(db_session)
    sc = await _ajouter(db_session, SousCategorie(nom=_nom("Sub"), categorie_id=autre_cat.id))
    modele = await _modele(db_session, categorie_id=cat.id)

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_modele(modele.id, SpecsWrite(sous_categorie_id=sc.id), staff, db_session)
    assert exc.value.status_code == 422


async def test_connectique_doublon_refuse(db_session, staff):
    powercon = await _connecteur(db_session, "PowerCon")
    modele = await _modele(db_session)
    ligne = ConnectiqueIn(connecteur_id=powercon.id, sens=SensConnectique.ENTREE, quantite=1)

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_modele(
            modele.id, SpecsWrite(connectiques=[ligne, ligne]), staff, db_session
        )
    assert exc.value.status_code == 422


async def test_connecteur_inconnu_404(db_session, staff):
    modele = await _modele(db_session)
    ligne = ConnectiqueIn(connecteur_id=-1, sens=SensConnectique.SORTIE, quantite=2)

    with pytest.raises(HTTPException) as exc:
        await ecrire_specs_modele(modele.id, SpecsWrite(connectiques=[ligne]), staff, db_session)
    assert exc.value.status_code == 404


async def test_connectiques_remplacees(db_session, staff):
    modele, _, _, _, powercon, _ = await _modele_avec_specs(db_session, staff)
    ligne = ConnectiqueIn(connecteur_id=powercon.id, sens=SensConnectique.ENTREE, quantite=3)

    specs = await ecrire_specs_modele(
        modele.id, SpecsWrite(connectiques=[ligne]), staff, db_session
    )
    assert [(c.connecteur_id, c.sens, c.quantite) for c in specs.connectiques] == [
        (powercon.id, SensConnectique.ENTREE, 3)
    ]


async def test_changement_categorie_masque_valeurs(db_session, staff):
    modele, _, _, champ, *_ = await _modele_avec_specs(db_session, staff)
    autre_cat = await _categorie(db_session)

    await update_modele(modele.id, ModeleUpdate(categorie_id=autre_cat.id), staff, db_session)

    assert modele.sous_categorie_id is None
    specs = await lire_specs_modele(modele.id, staff, db_session)
    assert champ.id not in [v.champ_id for v in specs.valeurs]
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ValeurSpecification)
            .where(ValeurSpecification.modele_id == modele.id)
        )
        == 1
    )


async def test_changement_categorie_item_sans_modele(db_session, staff):
    cat, autre_cat = await _categorie(db_session), await _categorie(db_session)
    sc = await _ajouter(db_session, SousCategorie(nom=_nom("Bar"), categorie_id=cat.id))
    champ = await _champ(db_session, cat.id)
    flight = await make_equipment(db_session, "Flight cat", est_contenant=True, categorie_id=cat.id)
    await ecrire_specs_equipment(
        flight.id, SpecsWrite(sous_categorie_id=sc.id, valeurs={champ.id: "2"}), staff, db_session
    )

    await update_equipment(flight.id, EquipmentUpdate(categorie_id=autre_cat.id), staff, db_session)

    assert flight.sous_categorie_id is None
    specs = await lire_specs_equipment(flight.id, staff, db_session)
    assert champ.id not in [v.champ_id for v in specs.valeurs]
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ValeurSpecification)
            .where(ValeurSpecification.equipment_id == flight.id)
        )
        == 1
    )


async def test_rattacher_modele_efface_specs_propres(db_session, staff):
    modele, *_ = await _modele_avec_specs(db_session, staff)
    cat = await _categorie(db_session)
    sc = await _ajouter(db_session, SousCategorie(nom=_nom("Bar"), categorie_id=cat.id))
    champ = await _champ(db_session, cat.id)
    connecteur = await _connecteur(db_session, "DMX")
    item = await make_equipment(db_session, "Lyre orpheline", categorie_id=cat.id)
    await ecrire_specs_equipment(
        item.id,
        SpecsWrite(
            sous_categorie_id=sc.id,
            poids=4,
            longueur=1,
            largeur=2,
            hauteur=3,
            prix_interne=5,
            prix_externe=6,
            valeurs={champ.id: "7"},
            connectiques=[
                ConnectiqueIn(connecteur_id=connecteur.id, sens=SensConnectique.ENTREE, quantite=1)
            ],
        ),
        staff,
        db_session,
    )

    await update_equipment(item.id, EquipmentUpdate(modele_id=modele.id), staff, db_session)

    assert (
        item.sous_categorie_id,
        item.poids,
        item.longueur,
        item.largeur,
        item.hauteur,
        item.prix_interne,
        item.prix_externe,
    ) == (None,) * 7
    for table in (ValeurSpecification, Connectique):
        assert (
            await db_session.scalar(
                select(func.count()).select_from(table).where(table.equipment_id == item.id)
            )
            == 0
        )
    specs = await lire_specs_equipment(item.id, staff, db_session)
    assert specs.source == "modele"
    assert specs.poids == 12.5


async def test_remarque_equipment(db_session, staff):
    modele = await _modele(db_session)
    detail = await create_equipment(
        EquipmentCreate(nom="Lyre 7", modele_id=modele.id, remarque="Lampe faible"),
        staff,
        db_session,
    )
    assert detail.remarque == "Lampe faible"
    assert (await get_equipment(detail.id, staff, db_session)).remarque == "Lampe faible"

    detail = await update_equipment(detail.id, EquipmentUpdate(remarque="  "), staff, db_session)
    assert detail.remarque is None


def test_ecriture_specs_exige_staff():
    vues = 0
    for path, methods, endpoint in routes_montees():
        if path.endswith("/specs") and "PUT" in methods:
            hints = typing.get_type_hints(endpoint, include_extras=True)
            assert hints["_user"] is RequireStaff, path
            vues += 1
    assert vues == 2
