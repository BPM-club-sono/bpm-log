"""Lecture et nettoyage de l'inventaire CSV : CSV -> Plan (pur, sans HTTP ni base).

Les constantes ci-dessous recopient les tables de décision du design
`docs/superpowers/specs/2026-10-18-import-inventaire-csv-design.md`.
"""

import csv
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

PREFIXE_FEUILLE = "Inventaire BPM - "

# (feuille, Type) -> (catégorie, sous-catégorie). Un couple absent garde (feuille, Type).
REMAP_TYPE: dict[tuple[str, str], tuple[str, str]] = {
    ("Lights", "Stobe"): ("Lights", "Strobe"),
    ("Lights", "Pad"): ("Lights", "Régie"),
    ("Lights", "GrandMA"): ("Lights", "Régie"),
    ("Lights", "GrandMa"): ("Lights", "Régie"),
    ("Lights", "Adaptateur"): ("Lights", "Interface DMX"),
    ("Lights", "Crochet"): ("Accroche", "Crochet"),
    ("Son", "Mirco"): ("Son", "Micro"),
    ("Son", "Cablage"): ("Son", "Stagebox"),
    ("Câbles", "Boitier élec"): ("Câbles", "Distribution élec"),
    ("Mapping", "Amplificateur"): ("Mapping", "Processeur vidéo"),
    ("Mapping", "Crochet"): ("Accroche", "Crochet"),
    ("Mapping", "Manille"): ("Accroche", "Manille"),
    ("Mapping", "Elingue"): ("Accroche", "Elingue"),
    ("Mapping", "Bumper"): ("Accroche", "Bumper"),
}

# (feuille, Type, Nom CSV) -> (catégorie, sous-catégorie), testé avant REMAP_TYPE.
REMAP_NOM: dict[tuple[str, str, str], tuple[str, str]] = {
    ("Lights", "Crochet", "Omega pixelblade"): ("Accroche", "Omega"),
    ("Lights", "Crochet", "omega H Beam 2R"): ("Accroche", "Omega"),
    ("Mapping", "Cable", "Linkcon"): ("Câbles", "Linkcon écran"),
    ("Mapping", "Cable", "Ethernet"): ("Câbles", "Ethernet"),
    ("Mapping", "Cable", "Powercon"): ("Câbles", "Powercon"),
}

# Nom CSV -> nom du modèle (coquilles corrigées).
RENOMMAGES: dict[str, str] = {
    "Bumber 1m": "Bumper 1m",
    "Bumber 0.5m": "Bumper 0.5m",
    "Pioreer XDJ-XZ": "Pioneer XDJ-XZ",
    "Pieneer DJM 500": "Pioneer DJM 500",
    "Strouke M": "Strike M",
}

# Nom final du modèle -> connectiques imposées (ignore les colonnes Entrées/Sorties).
CONNECTIQUES_FORCEES: dict[str, list[tuple[str, str, int]]] = {
    "Linkcon": [("LinkCon", "entree", 2)],
}

# État CSV -> (statut, ticket ?, avancement du ticket).
ETATS: dict[str, tuple[str, bool, str | None]] = {
    "Bon": ("Fonctionnel", False, None),
    "Cassé": ("En_Panne", True, None),
    "À réparer": ("En_Panne", True, None),
    "En réparation": ("En_Reparation", True, "En_cours"),
}

# Colonne CSV -> clé de spécification du modèle.
COLONNES_SPECS: dict[str, str] = {
    "Longueur": "longueur",
    "Poids": "poids",
    "Prix inté": "prix_interne",
    "Prix exté": "prix_externe",
}
CLES_SPECS = ("poids", "longueur", "largeur", "hauteur", "prix_interne", "prix_externe")


@dataclass(frozen=True)
class UnitePrevue:
    statut: str  # "Fonctionnel" | "En_Panne" | "En_Reparation"
    remarque: str | None
    ticket: str | None  # description_panne, None = pas de ticket
    avancement: str | None  # "En_cours" pour En réparation, sinon None
    source: str  # "Lights.csv:12", pour le rapport


@dataclass
class ModelePrevu:
    nom: str
    categorie: str
    sous_categorie: str
    specs: dict[str, float | None]
    connectiques: list[tuple[str, str, int]]  # (connecteur, "entree"|"sortie", quantite)
    unites: list[UnitePrevue] = field(default_factory=list)


@dataclass(frozen=True)
class ChampPrevu:
    categorie: str
    sous_categorie: str | None  # None = toute la catégorie
    nom: str
    type: str  # "nombre" | "texte" | "choix" | "oui_non"
    unite: str | None
    options: tuple[str, ...]
    ordre: int


@dataclass
class Plan:
    sous_categories: dict[str, list[str]]  # catégorie -> sous-catégories (ordre d'apparition)
    connecteurs: list[str]
    champs: list[ChampPrevu]
    modeles: list[ModelePrevu]
    anomalies: list[str]


def _champs() -> list[ChampPrevu]:
    """Champs de spécification du design, un par sous-catégorie listée."""
    # (catégorie, nom, type, unité, options, sous-catégories ; None = toute la catégorie)
    lignes: list[tuple[str, str, str, str | None, tuple[str, ...], tuple[str, ...] | None]] = [
        ("Lights", "Puissance", "nombre", "W", (), None),
        ("Lights", "Source", "choix", None, ("LED", "Lampe", "Laser"), None),
        ("Lights", "Canaux DMX", "nombre", None, (), None),
        ("Lights", "Angle", "nombre", "°", (), ("Beam", "Wash", "Spot", "Par")),
        ("Lights", "Zoom", "oui_non", None, (), ("Beam", "Wash", "Spot")),
        ("Lights", "Pixels", "nombre", None, (), ("Bar", "Blade")),
        ("Son", "Puissance", "nombre", "W", (), None),
        ("Son", "Amplifié", "oui_non", None, (), ("Sub", "Tête", "Monitor")),
        ("Son", "Taille HP", "nombre", "pouces", (), ("Sub", "Tête", "Monitor")),
        ("Son", "Impédance", "nombre", "Ω", (), ("Sub", "Tête")),
        ("Son", "Canaux", "nombre", None, (), ("Ampli", "Console", "Mixer")),
        ("Son", "Hauteur rack", "nombre", "U", (), ("Rack",)),
        ("Structure", "Section", "choix", None, ("H30V", "H30D"), ("Prolyte",)),
        ("Câbles", "Ampérage", "nombre", "A", (), ("Distribution élec",)),
        ("Câbles", "Nb prises", "nombre", None, (), ("Distribution élec",)),
        ("Accroche", "Charge max", "nombre", "kg", (), None),
        ("Mapping", "Pitch", "nombre", "mm", (), ("Écran",)),
        ("Mapping", "Résolution", "texte", None, (), ("Écran", "Projecteur")),
        ("Mapping", "Luminosité", "nombre", "lumens", (), ("Projecteur",)),
        ("Mapping", "Capacité", "nombre", "Go", (), ("Stockage",)),
        ("Autre", "Ports", "nombre", None, (), ("Switch",)),
    ]
    champs: list[ChampPrevu] = []
    for cat, nom, type_, unite, options, scopes in lignes:
        for sc in scopes or (None,):
            champs.append(ChampPrevu(cat, sc, nom, type_, unite, options, len(champs)))
    return champs


CHAMPS: list[ChampPrevu] = _champs()


@dataclass
class _Ligne:
    """Une ligne CSV nettoyée, avant fusion par modèle."""

    specs: dict[str, float | None]
    connectiques: list[tuple[str, str, int]]


def _nombre(brut: str) -> float | None:
    """'12,5' -> 12.5 ; vide -> None ; ValueError si illisible."""
    brut = brut.strip()
    if not brut:
        return None
    return float(brut.replace(",", "."))


def _connectiques(entrees: str, sorties: str) -> list[tuple[str, str, int]]:
    """Un connecteur répété dans une cellule (« XLR Male, XLR Male ») donne quantite 2."""
    quantites: Counter[tuple[str, str]] = Counter()  # ordre d'apparition conservé
    for sens, brut in (("entree", entrees), ("sortie", sorties)):
        for nom in brut.split(","):
            nom = nom.strip()
            if nom:
                quantites[(nom, sens)] += 1
    return [(nom, sens, quantite) for (nom, sens), quantite in quantites.items()]


def _classer(feuille: str, type_: str, nom: str) -> tuple[str, str]:
    return (
        REMAP_NOM.get((feuille, type_, nom)) or REMAP_TYPE.get((feuille, type_)) or (feuille, type_)
    )


def _majoritaire(valeurs: list, libelle: str, modele: str, anomalies: list[str]):
    """Valeur non vide la plus fréquente ; anomalie si des valeurs non vides divergent."""
    non_vides = [v for v in valeurs if v not in (None, [])]
    if not non_vides:
        return None
    comptes: Counter = Counter(repr(v) for v in non_vides)
    if len(comptes) > 1:
        anomalies.append(
            f"Modèle « {modele} » : {libelle} divergent entre lignes ({len(comptes)} valeurs)"
        )
    return next(v for v in non_vides if repr(v) == comptes.most_common(1)[0][0])


def lire_dossier(dossier: Path) -> Plan:
    """Lit tous les CSV du dossier (triés par nom) et construit le plan d'import."""
    anomalies: list[str] = []
    modeles: dict[str, ModelePrevu] = {}
    lignes: dict[str, list[_Ligne]] = {}
    sous_categories: dict[str, list[str]] = {}
    connecteurs: list[str] = []

    def ajouter_sc(categorie: str, sous_categorie: str) -> None:
        liste = sous_categories.setdefault(categorie, [])
        if sous_categorie not in liste:
            liste.append(sous_categorie)

    for chemin in sorted(dossier.glob("*.csv")):
        nom_fichier = unicodedata.normalize("NFC", chemin.name)
        court = nom_fichier.removeprefix(PREFIXE_FEUILLE)
        feuille = court.removesuffix(".csv")
        with chemin.open(encoding="utf-8", newline="") as f:
            lecteur = csv.DictReader(f)
            for ligne in lecteur:
                cellules = {
                    unicodedata.normalize("NFC", k): (v or "").strip()
                    for k, v in ligne.items()
                    if k is not None
                }
                source = f"{court}:{lecteur.line_num}"
                nom_csv = cellules.get("Nom", "")
                if not nom_csv:
                    anomalies.append(f"{source} : nom vide, ligne ignorée")
                    continue

                etat = cellules.get("État", "")
                if etat == "":
                    etat_def = ETATS["Bon"]
                    anomalies.append(f"{source} : État vide ({nom_csv}), traité comme Fonctionnel")
                elif etat in ETATS:
                    etat_def = ETATS[etat]
                else:
                    anomalies.append(
                        f"{source} : État inconnu « {etat} » ({nom_csv}), ligne ignorée"
                    )
                    continue
                statut, avec_ticket, avancement = etat_def

                remarque = cellules.get("Remarque") or None
                ticket = None
                if avec_ticket:
                    note = f"Importé depuis l'inventaire CSV (État : {etat})."
                    ticket = f"{remarque}\n\n{note}" if remarque else note

                nom = RENOMMAGES.get(nom_csv, nom_csv)
                categorie, sous_categorie = _classer(feuille, cellules.get("Type", ""), nom_csv)

                specs: dict[str, float | None] = dict.fromkeys(CLES_SPECS)
                for colonne, cle in COLONNES_SPECS.items():
                    try:
                        specs[cle] = _nombre(cellules.get(colonne, ""))
                    except ValueError:
                        anomalies.append(
                            f"{source} : {colonne} illisible « {cellules[colonne]} » ({nom})"
                        )
                conn = _connectiques(cellules.get("Entrées", ""), cellules.get("Sorties", ""))

                modele = modeles.get(nom)
                if modele is None:
                    modele = modeles[nom] = ModelePrevu(nom, categorie, sous_categorie, {}, [])
                    lignes[nom] = []
                elif (modele.categorie, modele.sous_categorie) != (categorie, sous_categorie):
                    anomalies.append(
                        f"{source} : « {nom} » déjà classé en {modele.categorie} / "
                        f"{modele.sous_categorie}, classement {categorie} / {sous_categorie} ignoré"
                    )
                lignes[nom].append(_Ligne(specs, conn))
                modele.unites.append(UnitePrevue(statut, remarque, ticket, avancement, source))
                ajouter_sc(modele.categorie, modele.sous_categorie)

    # Fusion des lignes de chaque modèle.
    for nom, modele in modeles.items():
        rows = lignes[nom]
        modele.specs = {
            cle: _majoritaire([r.specs[cle] for r in rows], cle, nom, anomalies)
            for cle in CLES_SPECS
        }
        if nom in CONNECTIQUES_FORCEES:
            modele.connectiques = list(CONNECTIQUES_FORCEES[nom])
        else:
            modele.connectiques = (
                _majoritaire([r.connectiques for r in rows], "connectiques", nom, anomalies) or []
            )
        for conn, _, _ in modele.connectiques:
            if conn not in connecteurs:
                connecteurs.append(conn)
    if "LinkCon" not in connecteurs:
        connecteurs.append("LinkCon")

    # Champs des catégories présentes ; leurs sous-catégories existent même sans unité.
    champs = [c for c in CHAMPS if c.categorie in sous_categories]
    for c in champs:
        if c.sous_categorie:
            ajouter_sc(c.categorie, c.sous_categorie)

    return Plan(sous_categories, connecteurs, champs, list(modeles.values()), anomalies)
