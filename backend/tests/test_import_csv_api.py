"""Import de l'inventaire CSV par l'API : création, rejeu, dry-run, erreurs."""

import uuid

import pytest
from fastapi import HTTPException

from app.deps import get_current_user
from app.import_csv.importeur import ErreurApi, importer
from app.import_csv.mapping import lire_dossier
from app.main import app

ENTETE = "Type,Nom,Entrées,Sorties,Longueur,Poids,Prix inté,Prix exté,État,Remarque\n"


def _suffixe() -> str:
    return uuid.uuid4().hex[:8]


def _ecrire(dossier, lights: list[str], son: list[str] | None = None) -> None:
    (dossier / "Inventaire BPM - Lights.csv").write_text(ENTETE + "".join(lights), encoding="utf-8")
    if son is not None:
        (dossier / "Inventaire BPM - Son.csv").write_text(ENTETE + "".join(son), encoding="utf-8")


def _lights(s: str, n: int = 2) -> list[str]:
    lignes = [f'Stobe,Eurolite led {s},"PowerCon, DMX 3p Male",,,,,,Bon,\n']
    lignes += [f"Stobe,Eurolite led {s},\"PowerCon, DMX 3p Male\",,,,,,Cassé,ne s'allume pas\n"]
    return (lignes + [lignes[0]] * (n - 2))[:n]


def _son(s: str) -> list[str]:
    return [f"Sub,Sub {s},,,,47,,,En réparation,\n"]


async def _modeles(api, s: str) -> dict[str, dict]:
    r = await api.get("modeles", params={"q": s})
    assert r.status_code == 200
    return {m["nom"]: m for m in r.json()}


async def test_import_complet(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s), _son(s))
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)

    modeles = await _modeles(api, s)
    eurolite, sub = modeles[f"Eurolite led {s}"], modeles[f"Sub {s}"]
    assert (eurolite["nb_unites"], sub["nb_unites"]) == (2, 1)

    specs = (await api.get(f"modeles/{eurolite['id']}/specs")).json()
    assert specs["sous_categorie_nom"] == "Strobe"
    assert len(specs["connectiques"]) == 2
    assert {c["sens"] for c in specs["connectiques"]} == {"entree"}
    assert (await api.get(f"modeles/{sub['id']}/specs")).json()["poids"] == 47

    unites = (await api.get("equipments", params={"modele_id": eurolite["id"]})).json()
    assert sorted(u["nom"] for u in unites) == [f"Eurolite led {s} 1", f"Eurolite led {s} 2"]
    assert {u["statut_actuel"] for u in unites} == {"Fonctionnel", "En_Panne"}
    sub_unite = (await api.get("equipments", params={"modele_id": sub["id"]})).json()[0]
    assert sub_unite["statut_actuel"] == "En_Reparation"

    tickets = (await api.get("tickets", params={"statut": "tous"})).json()
    ids = {u["id"] for u in unites} | {sub_unite["id"]}
    mes = [t for t in tickets if t["equipment_id"] in ids]
    assert len(mes) == 2
    descriptions = {t["description_panne"] for t in mes}
    assert (
        "ne s'allume pas\n\nImporté depuis l'inventaire CSV (État : Cassé)." in descriptions
    )
    assert any(
        t["avancement"] == "En_cours" for t in mes if t["equipment_id"] == sub_unite["id"]
    )

    champs = (await api.get("champs-specification")).json()
    cats = {c["id"]: c["nom"] for c in (await api.get("categories")).json()}
    scs = {c["id"]: c["nom"] for c in (await api.get("sous-categories")).json()}
    assert any(c["nom"] == "Puissance" and cats[c["categorie_id"]] == "Lights" for c in champs)
    assert any(
        c["nom"] == "Hauteur rack"
        and cats[c["categorie_id"]] == "Son"
        and scs.get(c["sous_categorie_id"]) == "Rack"
        for c in champs
    )
    assert r.crees["unites"] == 3 and r.crees["tickets"] == 2


async def test_reimport_ne_cree_rien(api_import, tmp_path):
    s = _suffixe()
    _ecrire(tmp_path, _lights(s), _son(s))
    plan = lire_dossier(tmp_path)
    await importer(api_import, plan, appliquer=True)
    r = await importer(api_import, plan, appliquer=True)
    assert sum(r.crees.values()) == 0
    assert any(f"Eurolite led {s} : déjà importé (2 unités)" in i for i in r.ignores)
    assert any(f"Sub {s} : déjà importé (1 unités)" in i for i in r.ignores)


async def test_reimport_garde_valeurs_saisies(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s))
    plan = lire_dossier(tmp_path)
    await importer(api, plan, appliquer=True)

    modele = (await _modeles(api, s))[f"Eurolite led {s}"]
    specs = (await api.get(f"modeles/{modele['id']}/specs")).json()
    champ = next(v for v in specs["valeurs"] if v["nom"] == "Puissance")
    corps = {
        k: specs[k]
        for k in ("poids", "longueur", "largeur", "hauteur", "prix_interne", "prix_externe")
    }
    corps["sous_categorie_id"] = specs["sous_categorie_id"]
    corps["connectiques"] = [
        {k: c[k] for k in ("connecteur_id", "sens", "quantite")} for c in specs["connectiques"]
    ]
    corps["valeurs"] = {str(champ["champ_id"]): "250"}
    assert (await api.put(f"modeles/{modele['id']}/specs", json=corps)).status_code == 200

    await importer(api, plan, appliquer=True)
    apres = (await api.get(f"modeles/{modele['id']}/specs")).json()
    assert next(v for v in apres["valeurs"] if v["nom"] == "Puissance")["valeur"] == "250"


async def test_modele_incomplet_signale(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s, 2))
    await importer(api, lire_dossier(tmp_path), appliquer=True)
    _ecrire(tmp_path, _lights(s, 3))
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)
    assert any("incomplet (2 unités sur 3 prévues)" in i for i in r.ignores)
    assert r.crees["unites"] == 0
    assert (await _modeles(api, s))[f"Eurolite led {s}"]["nb_unites"] == 2


async def test_dry_run_n_ecrit_rien(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s), _son(s))
    r = await importer(api, lire_dossier(tmp_path), appliquer=False)
    assert r.crees["modeles"] == 2 and r.crees["unites"] == 3
    assert r.crees["tickets"] == 2
    assert await _modeles(api, s) == {}
    assert "modèles" in r.texte() or "modeles" in r.texte()


async def test_erreur_api_arrete_avec_message(api_import, tmp_path):
    _ecrire(tmp_path, _lights(_suffixe()))

    async def _refus():
        raise HTTPException(status_code=401, detail="Non authentifié")

    app.dependency_overrides[get_current_user] = _refus
    with pytest.raises(ErreurApi) as exc:
        await importer(api_import, lire_dossier(tmp_path), appliquer=True)
    assert exc.value.statut == 401
    assert "categories" in str(exc.value)
