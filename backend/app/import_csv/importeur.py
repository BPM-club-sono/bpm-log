"""Import du Plan dans l'application, uniquement par l'API REST (rejouable).

Tout passe par les mêmes routes que l'interface : mêmes validations, mêmes règles
métier. Le rejeu ne crée rien de ce qui existe déjà et ne touche jamais aux valeurs
de spécification saisies dans l'application (`valeurs` est toujours vide dans le PUT).
"""

from collections import Counter
from dataclasses import dataclass, field

import httpx

from app.import_csv.mapping import ModelePrevu, Plan

CLES = ("categories", "sous_categories", "champs", "connecteurs", "modeles", "unites", "tickets")
LIBELLES = {
    "categories": "catégories",
    "sous_categories": "sous-catégories",
    "champs": "champs de spécification",
    "connecteurs": "connecteurs",
    "modeles": "modèles",
    "unites": "unités",
    "tickets": "tickets",
}


class ErreurApi(Exception):
    """Réponse non-2xx : méthode, chemin, statut, corps. Arrête l'import."""

    def __init__(self, methode: str, chemin: str, statut: int, corps: str):
        super().__init__(f"{methode} {chemin} -> {statut} : {corps}")
        self.methode = methode
        self.chemin = chemin
        self.statut = statut
        self.corps = corps


@dataclass
class Rapport:
    crees: Counter[str] = field(default_factory=Counter)
    existants: Counter[str] = field(default_factory=Counter)
    ignores: list[str] = field(default_factory=list)
    anomalies: list[str] = field(default_factory=list)

    def texte(self) -> str:
        lignes = ["Créés (ou à créer) :"]
        lignes += [f"  {LIBELLES[c]} : {self.crees[c]}" for c in CLES]
        lignes.append("Déjà existants :")
        lignes += [f"  {LIBELLES[c]} : {self.existants[c]}" for c in CLES]
        lignes.append(f"Modèles ignorés ({len(self.ignores)}) :")
        lignes += [f"  {i}" for i in self.ignores]
        lignes.append(f"Anomalies du CSV ({len(self.anomalies)}) :")
        lignes += [f"  {a}" for a in self.anomalies]
        return "\n".join(lignes)


async def _appel(http: httpx.AsyncClient, methode: str, chemin: str, **kw) -> httpx.Response:
    """Appel API ; toute réponse non-2xx lève ErreurApi."""
    rep = await http.request(methode, chemin, **kw)
    if not 200 <= rep.status_code < 300:
        raise ErreurApi(methode, chemin, rep.status_code, rep.text)
    return rep


async def importer(http: httpx.AsyncClient, plan: Plan, *, appliquer: bool) -> Rapport:
    """Importe le plan. Avec `appliquer=False`, ne fait que des GET et compte."""
    rap = Rapport(anomalies=list(plan.anomalies))

    async def lire(chemin: str, **params) -> list[dict]:
        return (await _appel(http, "GET", chemin, params=params or None)).json()

    async def creer(cle: str, chemin: str, corps: dict) -> int | None:
        """Crée l'élément (id None en simulation) et le compte."""
        rap.crees[cle] += 1
        if not appliquer:
            return None
        return (await _appel(http, "POST", chemin, json=corps)).json()["id"]

    # 1. État actuel
    categories = {c["nom"]: c["id"] for c in await lire("categories")}
    sous_cats = {(s["categorie_id"], s["nom"]): s["id"] for s in await lire("sous-categories")}
    champs = {
        (c["categorie_id"], c["sous_categorie_id"], c["nom"])
        for c in await lire("champs-specification")
    }
    connecteurs = {c["nom"]: c["id"] for c in await lire("connecteurs")}
    modeles = {m["nom"]: m for m in await lire("modeles")}

    # 2. Référentiel
    for nom in plan.sous_categories:
        if nom in categories:
            rap.existants["categories"] += 1
        else:
            categories[nom] = await creer("categories", "categories", {"nom": nom})

    for cat, noms in plan.sous_categories.items():
        for nom in noms:
            cle = (categories[cat], nom)
            if cle in sous_cats:
                rap.existants["sous_categories"] += 1
            else:
                sous_cats[cle] = await creer(
                    "sous_categories",
                    "sous-categories",
                    {"nom": nom, "categorie_id": categories[cat]},
                )

    for nom in plan.connecteurs:
        if nom in connecteurs:
            rap.existants["connecteurs"] += 1
        else:
            connecteurs[nom] = await creer("connecteurs", "connecteurs", {"nom": nom})

    for c in plan.champs:
        cat_id = categories[c.categorie]
        sc_id = sous_cats[(cat_id, c.sous_categorie)] if c.sous_categorie else None
        if (cat_id, sc_id, c.nom) in champs:
            rap.existants["champs"] += 1
            continue
        await creer(
            "champs",
            "champs-specification",
            {
                "nom": c.nom,
                "type": c.type,
                "unite": c.unite,
                "options": list(c.options),
                "categorie_id": cat_id,
                "sous_categorie_id": sc_id,
                "ordre": c.ordre,
            },
        )

    # 3 à 5. Modèles, unités, tickets
    for m in plan.modeles:
        cat_id = categories[m.categorie]
        existant = modeles.get(m.nom)
        if existant is None:
            modele_id = await creer("modeles", "modeles", {"nom": m.nom, "categorie_id": cat_id})
        else:
            rap.existants["modeles"] += 1
            modele_id = existant["id"]
            if existant["categorie_id"] != cat_id and appliquer:
                await _appel(http, "PATCH", f"modeles/{modele_id}", json={"categorie_id": cat_id})
        if appliquer:
            sc_id = sous_cats[(cat_id, m.sous_categorie)]
            await _ecrire_specs(http, m, modele_id, sc_id, connecteurs)
        await _unites(http, rap, m, modele_id, existant, appliquer)

    return rap


async def _ecrire_specs(
    http: httpx.AsyncClient,
    m: ModelePrevu,
    modele_id: int,
    sous_categorie_id: int,
    connecteurs: dict[str, int],
) -> None:
    """PUT des specs fixes et de la connectique ; `valeurs` vide : rien d'écrasé."""
    corps = {
        "sous_categorie_id": sous_categorie_id,
        **m.specs,
        "valeurs": {},
        "connectiques": [
            {"connecteur_id": connecteurs[nom], "sens": sens, "quantite": quantite}
            for nom, sens, quantite in m.connectiques
        ],
    }
    await _appel(http, "PUT", f"modeles/{modele_id}/specs", json=corps)


async def _unites(
    http: httpx.AsyncClient,
    rap: Rapport,
    m: ModelePrevu,
    modele_id: int | None,
    existant: dict | None,
    appliquer: bool,
) -> None:
    """Crée les unités et tickets d'un modèle, sauf s'il en a déjà."""
    prevues = len(m.unites)
    deja = existant["nb_unites"] if existant else 0
    if deja == prevues:
        rap.ignores.append(f"{m.nom} : déjà importé ({deja} unités)")
        return
    if deja > 0:
        rap.ignores.append(
            f"{m.nom} : incomplet ({deja} unités sur {prevues} prévues), à corriger à la main"
        )
        return

    if appliquer:
        noms = (
            await _appel(
                http, "GET", "equipments/noms-serie", params={"base": m.nom, "nombre": prevues}
            )
        ).json()
    for i, u in enumerate(m.unites):
        rap.crees["unites"] += 1
        if u.ticket is not None:
            rap.crees["tickets"] += 1
        if not appliquer:
            continue
        rep = await _appel(
            http,
            "POST",
            "equipments",
            json={
                "nom": noms[i],
                "type": "standard",
                "modele_id": modele_id,
                "statut_actuel": u.statut,
                "remarque": u.remarque,
                "nombre": 1,
            },
        )
        if u.ticket is None:
            continue
        ticket = await _appel(
            http,
            "POST",
            "tickets",
            json={"equipment_id": rep.json()["id"], "description_panne": u.ticket},
        )
        if u.avancement:
            await _appel(
                http, "PATCH", f"tickets/{ticket.json()['id']}", json={"avancement": u.avancement}
            )
