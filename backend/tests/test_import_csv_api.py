"""Import de l'inventaire CSV par l'API : création, rejeu, dry-run, erreurs."""

import uuid

import httpx
import pytest
from conftest import TransportEnPanne, requete
from fastapi import HTTPException

from app.deps import get_current_user
from app.import_csv.importeur import ErreurApi, ImportInterrompu, JetonBientotExpire, importer
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
    """Unités existantes non conformes (« <Nom> 1..k ») : signalé, rien n'est écrit."""
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s, 2))
    await importer(api, lire_dossier(tmp_path), appliquer=True)
    modele = (await _modeles(api, s))[f"Eurolite led {s}"]
    intrus = {"nom": f"Intrus {s}", "type": "standard", "modele_id": modele["id"], "nombre": 1}
    assert (await api.post("equipments", json=intrus)).status_code == 201
    _ecrire(tmp_path, _lights(s, 4))
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)
    assert any("incomplet (3 unités sur 4 prévues)" in i for i in r.ignores)
    assert r.crees["unites"] == 0 and r.crees["tickets"] == 0
    assert (await _modeles(api, s))[f"Eurolite led {s}"]["nb_unites"] == 3


async def test_plus_d_unites_que_prevu(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s, 3))
    await importer(api, lire_dossier(tmp_path), appliquer=True)
    _ecrire(tmp_path, _lights(s, 2))
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)
    assert f"Eurolite led {s} : plus d'unités que prévu (3 pour 2)" in r.ignores
    assert sum(r.crees.values()) == 0


async def test_modele_partiel_complete(api_import, tmp_path):
    """Unités « <Nom> 1..k » existantes : les unités k+1..M manquantes sont créées."""
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s, 2))
    await importer(api, lire_dossier(tmp_path), appliquer=True)
    _ecrire(tmp_path, _lights(s, 4))
    r = await importer(api, lire_dossier(tmp_path), appliquer=True)
    assert r.crees["unites"] == 2 and r.existants["unites"] == 2
    await _verifier_unites(api, f"Eurolite led {s}", 4)


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
    with pytest.raises(ImportInterrompu) as exc:
        await importer(api_import, lire_dossier(tmp_path), appliquer=True)
    assert isinstance(exc.value.cause, ErreurApi) and exc.value.cause.statut == 401
    assert "categories" in str(exc.value.cause)


async def test_erreur_api_nomme_modele_et_requete(api_import, tmp_path):
    s = _suffixe()
    _ecrire(tmp_path, _lights(s))
    transport = TransportEnPanne(requete("POST", "equipments"), statut=401)
    async with _client(transport) as http:
        with pytest.raises(ImportInterrompu) as exc:
            await importer(http, lire_dossier(tmp_path), appliquer=True)
    assert f"Eurolite led {s}" in exc.value.en_cours
    assert isinstance(exc.value.cause, ErreurApi) and exc.value.cause.statut == 401
    assert f'"nom": "Eurolite led {s} 1"' in str(exc.value.cause)


# --- Reprise après un arrêt en cours d'import ---------------------------------


def _client(transport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=transport, base_url="http://test/api")


def _lignes_reprise(s: str) -> list[str]:
    """4 unités : Bon, Cassé (ticket), Bon, En réparation (ticket En_cours)."""
    return [
        f"Stobe,Reprise {s},,,,,,,Bon,\n",
        f"Stobe,Reprise {s},,,,,,,Cassé,lampe\n",
        f"Stobe,Reprise {s},,,,,,,Bon,\n",
        f"Stobe,Reprise {s},,,,,,,En réparation,\n",
    ]


async def _verifier_unites(api, nom: str, nombre: int) -> dict[str, int]:
    """Les unités du modèle sont exactement « <nom> 1..nombre » ; renvoie nom -> id."""
    modeles = (await api.get("modeles", params={"q": nom})).json()
    modele = next(m for m in modeles if m["nom"] == nom)
    unites = (await api.get("equipments", params={"modele_id": modele["id"]})).json()
    assert sorted(u["nom"] for u in unites) == sorted(f"{nom} {j}" for j in range(1, nombre + 1))
    assert modele["nb_unites"] == nombre
    return {u["nom"]: u["id"] for u in unites}


async def _tickets(api, ids) -> dict[int, list[dict]]:
    tickets = (await api.get("tickets", params={"statut": "tous"})).json()
    par_unite: dict[int, list[dict]] = {}
    for t in tickets:
        if t["equipment_id"] in ids:
            par_unite.setdefault(t["equipment_id"], []).append(t)
    return par_unite


async def test_reprise_apres_coupure_entre_unites(api_import, tmp_path):
    api, s = api_import, _suffixe()
    (tmp_path / "Inventaire BPM - Lights.csv").write_text(
        ENTETE + "".join(_lignes_reprise(s)), encoding="utf-8"
    )
    plan = lire_dossier(tmp_path)
    transport = TransportEnPanne(requete("POST", "equipments"), n=3)
    async with _client(transport) as http:
        with pytest.raises(ImportInterrompu) as exc:
            await importer(http, plan, appliquer=True)
    assert isinstance(exc.value.cause, httpx.ConnectError)
    assert f"Reprise {s}" in exc.value.en_cours
    await _verifier_unites(api, f"Reprise {s}", 2)

    r = await importer(api, plan, appliquer=True)
    assert (r.crees["unites"], r.existants["unites"]) == (2, 2)
    # Les tickets d'un modèle sont posés après ses unités : aucun n'existait encore.
    assert (r.crees["tickets"], r.existants["tickets"]) == (2, 0)
    ids = await _verifier_unites(api, f"Reprise {s}", 4)
    tickets = await _tickets(api, set(ids.values()))
    assert set(tickets) == {ids[f"Reprise {s} 2"], ids[f"Reprise {s} 4"]}
    assert all(len(t) == 1 for t in tickets.values())
    assert tickets[ids[f"Reprise {s} 4"]][0]["avancement"] == "En_cours"

    r = await importer(api, plan, appliquer=True)
    assert sum(r.crees.values()) == 0


async def test_reprise_ticket_perdu_entre_unite_et_ticket(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s))
    plan = lire_dossier(tmp_path)
    async with _client(TransportEnPanne(requete("POST", "tickets"))) as http:
        with pytest.raises(ImportInterrompu):
            await importer(http, plan, appliquer=True)
    ids = await _verifier_unites(api, f"Eurolite led {s}", 2)
    assert await _tickets(api, set(ids.values())) == {}

    r = await importer(api, plan, appliquer=True)
    assert (r.crees["unites"], r.crees["tickets"]) == (0, 1)
    tickets = await _tickets(api, set(ids.values()))
    assert set(tickets) == {ids[f"Eurolite led {s} 2"]}
    assert len(tickets[ids[f"Eurolite led {s} 2"]]) == 1


async def test_reprise_avancement_corrige(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, [], _son(s))
    plan = lire_dossier(tmp_path)
    async with _client(TransportEnPanne(requete("PATCH", r"tickets/\d+"))) as http:
        with pytest.raises(ImportInterrompu):
            await importer(http, plan, appliquer=True)
    ids = await _verifier_unites(api, f"Sub {s}", 1)
    (ticket,) = (await _tickets(api, set(ids.values())))[ids[f"Sub {s} 1"]]
    assert ticket["avancement"] == "A_faire"

    simulation = await importer(api, plan, appliquer=False)
    assert simulation.existants["tickets"] == 1
    assert any("A_faire -> En_cours" in c for c in simulation.reprises)
    r = await importer(api, plan, appliquer=True)
    assert (r.crees["tickets"], r.existants["tickets"]) == (0, 1)
    (ticket,) = (await _tickets(api, set(ids.values())))[ids[f"Sub {s} 1"]]
    assert ticket["avancement"] == "En_cours"


async def test_jeton_expire_arret_entre_modeles(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s), _son(s))
    appels = []

    def verifier() -> None:
        appels.append(1)
        if len(appels) == 2:
            raise JetonBientotExpire

    with pytest.raises(ImportInterrompu) as exc:
        await importer(api, lire_dossier(tmp_path), appliquer=True, verifier=verifier)
    assert isinstance(exc.value.cause, JetonBientotExpire)
    assert f"Sub {s}" in exc.value.en_cours
    modeles = await _modeles(api, s)
    assert set(modeles) == {f"Eurolite led {s}"}
    assert modeles[f"Eurolite led {s}"]["nb_unites"] == 2


# --- Specs fixes et simulation -------------------------------------------------


async def test_rejeu_garde_specs_fixes_sauf_reappliquer(api_import, tmp_path):
    api, s = api_import, _suffixe()
    _ecrire(tmp_path, _lights(s))
    plan = lire_dossier(tmp_path)
    await importer(api, plan, appliquer=True)
    modele = (await _modeles(api, s))[f"Eurolite led {s}"]
    specs = (await api.get(f"modeles/{modele['id']}/specs")).json()
    corps = {
        "sous_categorie_id": specs["sous_categorie_id"],
        "poids": 12.5,
        "valeurs": {},
        "connectiques": [],
    }
    assert (await api.put(f"modeles/{modele['id']}/specs", json=corps)).status_code == 200

    await importer(api, plan, appliquer=True)
    apres = (await api.get(f"modeles/{modele['id']}/specs")).json()
    assert (apres["poids"], apres["connectiques"]) == (12.5, [])

    await importer(api, plan, appliquer=True, reappliquer_specs=True)
    apres = (await api.get(f"modeles/{modele['id']}/specs")).json()
    assert apres["poids"] is None and len(apres["connectiques"]) == 2


async def test_dry_run_categories_nouvelles_meme_sous_categorie(api_import, tmp_path):
    s = _suffixe()
    for feuille in (f"A{s}", f"B{s}"):
        (tmp_path / f"Inventaire BPM - {feuille}.csv").write_text(
            ENTETE + f"Controleur,Ctrl {feuille},,,,,,,Bon,\n", encoding="utf-8"
        )
    r = await importer(api_import, lire_dossier(tmp_path), appliquer=False)
    assert (r.crees["categories"], r.existants["categories"]) == (2, 0)
    assert (r.crees["sous_categories"], r.existants["sous_categories"]) == (2, 0)
