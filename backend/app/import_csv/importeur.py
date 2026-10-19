"""Import du Plan dans l'application, uniquement par l'API REST (rejouable, reprenable).

Tout passe par les mêmes routes que l'interface : mêmes validations, mêmes règles
métier. Rien n'est jamais supprimé. Un rejeu, après un arrêt ou non :

- ne recrée rien de ce qui existe (catégories, champs, connecteurs, modèles par nom) ;
- reprend un modèle partiel : si ses unités sont exactement « <Nom> 1 » à « <Nom> k »
  (aucune archivée), il crée « <Nom> k+1 » à « <Nom> M » ; sinon il le signale ;
- répare les tickets : une unité prévue avec ticket qui n'en a pas en reçoit un, et
  l'avancement prévu est remis s'il diffère ;
- ne réécrit la catégorie, les specs fixes et la connectique d'un modèle que si son
  import n'est pas terminé (ou avec `reappliquer_specs`). Les valeurs des champs de
  spécification saisies dans l'application ne sont jamais touchées (`valeurs` vide).
"""

import base64
import binascii
import json
import time
from collections import Counter
from collections.abc import Callable
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
MARGE_JETON = 60  # secondes : en deçà, on s'arrête avant le modèle suivant
TAILLE_REQUETE = 500  # caractères du corps de requête recopiés dans ErreurApi


class ErreurApi(Exception):
    """Réponse non-2xx : méthode, chemin, statut, corps (+ corps JSON envoyé). Arrête l'import."""

    def __init__(
        self, methode: str, chemin: str, statut: int, corps: str, requete: object = None
    ):
        self.methode = methode
        self.chemin = chemin
        self.statut = statut
        self.corps = corps
        self.requete = (
            None
            if requete is None
            else json.dumps(requete, ensure_ascii=False)[:TAILLE_REQUETE]
        )
        message = f"{methode} {chemin} -> {statut} : {corps}"
        if self.requete is not None:
            message += f" ; requête : {self.requete}"
        super().__init__(message)


class JetonBientotExpire(Exception):
    """Levée par le vérificateur : le jeton expire dans moins de MARGE_JETON secondes."""


class ImportInterrompu(Exception):
    """Arrêt de l'import pendant `en_cours` (ex. « le modèle « X » »), à cause de `cause`.

    `cause` : ErreurApi, httpx.HTTPError ou JetonBientotExpire. `rapport` : ce qui a été
    fait avant l'arrêt.
    """

    def __init__(self, en_cours: str, cause: Exception, rapport: "Rapport"):
        super().__init__(f"{en_cours} : {cause}")
        self.en_cours = en_cours
        self.cause = cause
        self.rapport = rapport


def expiration_jwt(token: str) -> float | None:
    """Champ `exp` de la charge utile d'un JWT (base64url, signature non vérifiée).

    None si le jeton n'est pas un JWT lisible ou n'a pas d'`exp` : pas de garde-fou.
    """
    try:
        charge = token.split(".")[1]
        exp = json.loads(base64.urlsafe_b64decode(charge + "=" * (-len(charge) % 4)))["exp"]
        return float(exp)
    except (IndexError, KeyError, TypeError, ValueError, binascii.Error):
        return None


def verificateur_jeton(
    token: str, *, horloge: Callable[[], float] = time.time
) -> Callable[[], None] | None:
    """Callable qui lève JetonBientotExpire s'il reste moins de MARGE_JETON s ; None si
    l'expiration est illisible."""
    exp = expiration_jwt(token)
    if exp is None:
        return None

    def verifier() -> None:
        if exp - horloge() < MARGE_JETON:
            raise JetonBientotExpire

    return verifier


@dataclass
class Rapport:
    crees: Counter[str] = field(default_factory=Counter)
    existants: Counter[str] = field(default_factory=Counter)
    ignores: list[str] = field(default_factory=list)
    reprises: list[str] = field(default_factory=list)
    anomalies: list[str] = field(default_factory=list)

    def texte(self) -> str:
        lignes = ["Créés (ou à créer) :"]
        lignes += [f"  {LIBELLES[c]} : {self.crees[c]}" for c in CLES]
        lignes.append("Déjà existants :")
        lignes += [f"  {LIBELLES[c]} : {self.existants[c]}" for c in CLES]
        lignes.append(f"Modèles ignorés ({len(self.ignores)}) :")
        lignes += [f"  {i}" for i in self.ignores]
        lignes.append(f"Reprises et corrections ({len(self.reprises)}) :")
        lignes += [f"  {r}" for r in self.reprises]
        lignes.append(f"Anomalies du CSV ({len(self.anomalies)}) :")
        lignes += [f"  {a}" for a in self.anomalies]
        return "\n".join(lignes)


async def _appel(http: httpx.AsyncClient, methode: str, chemin: str, **kw) -> httpx.Response:
    """Appel API ; toute réponse non-2xx lève ErreurApi."""
    rep = await http.request(methode, chemin, **kw)
    if not 200 <= rep.status_code < 300:
        raise ErreurApi(methode, chemin, rep.status_code, rep.text, kw.get("json"))
    return rep


async def importer(
    http: httpx.AsyncClient,
    plan: Plan,
    *,
    appliquer: bool,
    reappliquer_specs: bool = False,
    verifier: Callable[[], None] | None = None,
) -> Rapport:
    """Importe le plan. Avec `appliquer=False`, ne fait que des GET et compte.

    `verifier` est appelé avant chaque modèle (garde-fou d'expiration du jeton). Toute
    erreur API, réseau ou d'expiration lève ImportInterrompu, qui nomme l'étape en cours.
    """
    imp = _Import(http, plan, appliquer, reappliquer_specs)
    try:
        await imp.executer(verifier)
    except (ErreurApi, httpx.HTTPError, JetonBientotExpire) as e:
        raise ImportInterrompu(imp.en_cours, e, imp.rap) from e
    return imp.rap


class _Import:
    """Un passage d'import : état lu de l'API, compteurs, étape en cours."""

    def __init__(
        self, http: httpx.AsyncClient, plan: Plan, appliquer: bool, reappliquer_specs: bool
    ):
        self.http = http
        self.plan = plan
        self.appliquer = appliquer
        self.reappliquer_specs = reappliquer_specs
        self.rap = Rapport(anomalies=list(plan.anomalies))
        self.en_cours = "la lecture de l'état de l'application"
        self._fictif = 0  # ids négatifs des éléments « à créer » en simulation
        self._unites: dict[int, list[dict]] | None = None  # modele_id -> unités actives
        self._archivees: set[int] = set()  # modele_id ayant des unités archivées
        self.tickets: dict[int, list[dict]] = {}  # equipment_id -> tickets, plus ancien d'abord

    async def lire(self, chemin: str, **params) -> list[dict]:
        return (await _appel(self.http, "GET", chemin, params=params or None)).json()

    async def creer(self, cle: str, chemin: str, corps: dict) -> int:
        """Crée l'élément et le compte ; en simulation, renvoie un id fictif (négatif)."""
        self.rap.crees[cle] += 1
        if not self.appliquer:
            self._fictif -= 1
            return self._fictif
        return (await _appel(self.http, "POST", chemin, json=corps)).json()["id"]

    async def executer(self, verifier: Callable[[], None] | None) -> None:
        plan, rap = self.plan, self.rap

        # 1. État actuel
        categories = {c["nom"]: c["id"] for c in await self.lire("categories")}
        sous_cats = {
            (s["categorie_id"], s["nom"]): s["id"] for s in await self.lire("sous-categories")
        }
        champs = {
            (c["categorie_id"], c["sous_categorie_id"], c["nom"])
            for c in await self.lire("champs-specification")
        }
        connecteurs = {c["nom"]: c["id"] for c in await self.lire("connecteurs")}
        modeles = {m["nom"]: m for m in await self.lire("modeles")}
        for t in sorted(await self.lire("tickets", statut="tous"), key=lambda t: t["id"]):
            self.tickets.setdefault(t["equipment_id"], []).append(t)

        # 2. Référentiel
        self.en_cours = "le référentiel (catégories, connecteurs, champs)"
        for nom in plan.sous_categories:
            if nom in categories:
                rap.existants["categories"] += 1
            else:
                categories[nom] = await self.creer("categories", "categories", {"nom": nom})

        for cat, noms in plan.sous_categories.items():
            for nom in noms:
                cle = (categories[cat], nom)
                if cle in sous_cats:
                    rap.existants["sous_categories"] += 1
                else:
                    sous_cats[cle] = await self.creer(
                        "sous_categories",
                        "sous-categories",
                        {"nom": nom, "categorie_id": categories[cat]},
                    )

        for nom in plan.connecteurs:
            if nom in connecteurs:
                rap.existants["connecteurs"] += 1
            else:
                connecteurs[nom] = await self.creer("connecteurs", "connecteurs", {"nom": nom})

        for c in plan.champs:
            cat_id = categories[c.categorie]
            sc_id = sous_cats[(cat_id, c.sous_categorie)] if c.sous_categorie else None
            if (cat_id, sc_id, c.nom) in champs:
                rap.existants["champs"] += 1
                continue
            await self.creer(
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

        # 3 à 5. Modèles, unités, tickets ; garde-fou du jeton entre deux modèles.
        for m in plan.modeles:
            self.en_cours = f"le modèle « {m.nom} »"
            if verifier is not None:
                verifier()
            await self.modele(m, categories, sous_cats, connecteurs, modeles.get(m.nom))

    async def modele(
        self,
        m: ModelePrevu,
        categories: dict[str, int],
        sous_cats: dict[tuple[int, str], int],
        connecteurs: dict[str, int],
        existant: dict | None,
    ) -> None:
        cat_id = categories[m.categorie]
        prevues = len(m.unites)
        deja = existant["nb_unites"] if existant else 0
        if existant is None:
            modele_id = await self.creer(
                "modeles", "modeles", {"nom": m.nom, "categorie_id": cat_id}
            )
        else:
            self.rap.existants["modeles"] += 1
            modele_id = existant["id"]

        # Catégorie et specs fixes : seulement tant que l'import du modèle n'est pas fini.
        if self.appliquer and (deja < prevues or self.reappliquer_specs):
            if existant is not None and existant["categorie_id"] != cat_id:
                await _appel(
                    self.http, "PATCH", f"modeles/{modele_id}", json={"categorie_id": cat_id}
                )
            sc_id = sous_cats[(cat_id, m.sous_categorie)]
            await _ecrire_specs(self.http, m, modele_id, sc_id, connecteurs)

        unites = await self.unites(m, modele_id, deja)
        if unites is not None:
            await self.tickets_modele(m, unites)

    async def unites_existantes(self, modele_id: int) -> tuple[list[dict], bool]:
        """(unités actives du modèle, a-t-il des unités archivées ?) ; lu une fois."""
        if self._unites is None:
            self._unites = {}
            for u in await self.lire("equipments"):
                self._unites.setdefault(u["modele_id"], []).append(u)
            self._archivees = {u["modele_id"] for u in await self.lire("equipments", archive=True)}
        return self._unites.get(modele_id, []), modele_id in self._archivees

    async def unites(self, m: ModelePrevu, modele_id: int, deja: int) -> dict[str, int] | None:
        """Crée les unités manquantes ; renvoie nom -> id (fictif en simulation) des unités
        « <Nom> i », ou None si le modèle est laissé de côté (rien d'écrit pour ses unités)."""
        rap, prevues = self.rap, len(m.unites)
        if deja > prevues:
            rap.ignores.append(f"{m.nom} : plus d'unités que prévu ({deja} pour {prevues})")
            return None

        noms: dict[str, int] = {}
        if deja > 0:
            actives, archivees = await self.unites_existantes(modele_id)
            noms = {u["nom"]: u["id"] for u in actives}
            if deja == prevues:
                rap.ignores.append(f"{m.nom} : déjà importé ({deja} unités)")
                rap.existants["unites"] += deja
                return noms
            attendus = {f"{m.nom} {j}" for j in range(1, deja + 1)}
            if archivees or len(actives) != deja or set(noms) != attendus:
                rap.ignores.append(
                    f"{m.nom} : incomplet ({deja} unités sur {prevues} prévues), noms non "
                    f"conformes ou unités archivées, à corriger à la main"
                )
                return None
            rap.existants["unites"] += deja

        manquants = [f"{m.nom} {j}" for j in range(deja + 1, prevues + 1)]
        if self.appliquer:
            libres = (
                await _appel(
                    self.http,
                    "GET",
                    "equipments/noms-serie",
                    params={"base": m.nom, "nombre": len(manquants)},
                )
            ).json()
            if libres != manquants:
                rap.ignores.append(
                    f"{m.nom} : noms « {manquants[0]} »… déjà pris par d'autres équipements, "
                    f"unités à créer à la main"
                )
                return None
        if deja > 0:
            rap.reprises.append(
                f"{m.nom} : reprise, {deja} unités existantes, {len(manquants)} à créer"
            )

        for nom, u in zip(manquants, m.unites[deja:], strict=True):
            rap.crees["unites"] += 1
            if not self.appliquer:
                self._fictif -= 1
                noms[nom] = self._fictif
                continue
            rep = await _appel(
                self.http,
                "POST",
                "equipments",
                json={
                    "nom": nom,
                    "type": "standard",
                    "modele_id": modele_id,
                    "statut_actuel": u.statut,
                    "remarque": u.remarque,
                    "nombre": 1,
                },
            )
            noms[nom] = rep.json()["id"]
        return noms

    async def tickets_modele(self, m: ModelePrevu, unites: dict[str, int]) -> None:
        """Ticket prévu de l'unité « <Nom> i+1 » (ligne i) : créé s'il manque, avancement
        remis s'il diffère de l'avancement prévu (aucun prévu : laissé tel quel)."""
        rap = self.rap
        for i, u in enumerate(m.unites):
            if u.ticket is None:
                continue
            nom = f"{m.nom} {i + 1}"
            equipment_id = unites.get(nom)
            if equipment_id is None:
                rap.reprises.append(f"{nom} : unité introuvable, ticket non vérifié ({u.source})")
                continue
            existants = self.tickets.get(equipment_id, [])
            if not existants:
                rap.crees["tickets"] += 1
                if self.appliquer:
                    ticket = await _appel(
                        self.http,
                        "POST",
                        "tickets",
                        json={"equipment_id": equipment_id, "description_panne": u.ticket},
                    )
                    if u.avancement:
                        await self._avancement(ticket.json()["id"], u.avancement)
                continue
            rap.existants["tickets"] += 1
            ticket = existants[0]  # le plus ancien : celui de l'import
            if u.avancement and ticket["avancement"] != u.avancement:
                rap.reprises.append(
                    f"{nom} : avancement du ticket {ticket['avancement']} -> {u.avancement}"
                )
                if self.appliquer:
                    await self._avancement(ticket["id"], u.avancement)

    async def _avancement(self, ticket_id: int, avancement: str) -> None:
        await _appel(self.http, "PATCH", f"tickets/{ticket_id}", json={"avancement": avancement})


async def _ecrire_specs(
    http: httpx.AsyncClient,
    m: ModelePrevu,
    modele_id: int,
    sous_categorie_id: int,
    connecteurs: dict[str, int],
) -> None:
    """PUT des specs fixes et de la connectique (écrasées depuis le CSV) ; `valeurs` vide :
    les valeurs des champs de spécification ne sont pas touchées."""
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
