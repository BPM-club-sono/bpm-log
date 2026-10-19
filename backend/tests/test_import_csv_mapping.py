"""Mapping pur de l'import CSV : lecture, nettoyage, fusion par modèle."""

import csv
from pathlib import Path

import pytest

from app.import_csv.mapping import lire_dossier

ENTETES = {
    "Lights": [
        "Type", "Nom", "Entrées", "Sorties", "Poids", "Prix inté", "Prix exté", "État", "Remarque",
    ],
    "Son": ["Type", "Nom", "Entrées", "Sorties", "Poids", "Prix inté", "Prix exté", "État"],
    "Structure": ["Type", "Nom", "Longueur", "Poids", "Prix inté", "Prix exté", "État"],
    "Écrans et Mapping": [
        "Type", "Nom", "Entrées", "Sorties", "Poids", "Prix inté", "Prix exté", "État", "Remarque",
    ],
    "Câbles": ["Type", "Nom", "Entrées", "Sorties", "Longueur", "Prix inté", "Prix exté", "État"],
}  # fmt: skip


def ecrire(dossier: Path, feuille: str, lignes: list[dict[str, str]]) -> None:
    entetes = ENTETES[feuille]
    with (dossier / f"Inventaire BPM - {feuille}.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(entetes)
        for ligne in lignes:
            w.writerow([ligne.get(h, "") for h in entetes])


def ligne(type_: str, nom: str, etat: str = "Bon", **autres: str) -> dict[str, str]:
    return {"Type": type_, "Nom": nom, "État": etat, **autres}


def par_nom(plan):
    return {m.nom: m for m in plan.modeles}


def test_remap_types_et_noms(tmp_path):
    ecrire(tmp_path, "Lights", [
        ligne("Stobe", "S1"), ligne("GrandMA", "G1"), ligne("Adaptateur", "A1"),
        ligne("Crochet", "Omega pixelblade"), ligne("Crochet", "Crochet EURO"),
    ])  # fmt: skip
    ecrire(tmp_path, "Écrans et Mapping", [
        ligne("Cable", "Linkcon"), ligne("Cable", "Ethercon"), ligne("Amplificateur", "VX1000"),
        ligne("Bumper", "Bumber 1m"),
    ])  # fmt: skip
    ecrire(tmp_path, "Son", [ligne("Mirco", "M1"), ligne("Cablage", "C1")])
    ecrire(tmp_path, "Câbles", [ligne("Boitier élec", "B1")])
    plan = lire_dossier(tmp_path)
    assert {(m.nom, m.categorie, m.sous_categorie) for m in plan.modeles} >= {
        ("S1", "Lights", "Strobe"),
        ("G1", "Lights", "Régie"),
        ("A1", "Lights", "Interface DMX"),
        ("Omega pixelblade", "Accroche", "Omega"),
        ("Crochet EURO", "Accroche", "Crochet"),
        ("Linkcon", "Câbles", "Linkcon écran"),
        ("Ethercon", "Câbles", "Ethernet"),
        ("VX1000", "Écrans et Mapping", "Processeur vidéo"),
        ("Bumper 1m", "Accroche", "Bumper"),
        ("M1", "Son", "Micro"),
        ("C1", "Son", "Stagebox"),
        ("B1", "Câbles", "Distribution élec"),
    }
    assert "Strobe" in plan.sous_categories["Lights"]
    assert not plan.anomalies


def test_renommages(tmp_path):
    ecrire(tmp_path, "Écrans et Mapping", [ligne("Bumper", "Bumber 1m")])
    ecrire(tmp_path, "Son", [
        ligne("Platine", "Pieneer DJM 500"), ligne("Platine", "Pioreer XDJ-XZ"),
    ])  # fmt: skip
    ecrire(tmp_path, "Lights", [ligne("Bar", "Strouke M")])
    assert set(par_nom(lire_dossier(tmp_path))) == {
        "Bumper 1m", "Pioneer DJM 500", "Pioneer XDJ-XZ", "Strike M",
    }  # fmt: skip


def test_un_modele_par_nom_une_unite_par_ligne(tmp_path):
    ecrire(tmp_path, "Lights", [ligne("Bar", "X")] * 3)
    plan = lire_dossier(tmp_path)
    assert len(plan.modeles) == 1
    assert len(plan.modeles[0].unites) == 3
    sources = [u.source for u in plan.modeles[0].unites]
    assert sources == ["Lights.csv:2", "Lights.csv:3", "Lights.csv:4"]


def test_connectiques_parsees(tmp_path):
    ecrire(tmp_path, "Lights", [
        ligne("Bar", "X", **{"Entrées": "PowerCon, DMX 3p Male", "Sorties": "LineCon"}),
    ])  # fmt: skip
    plan = lire_dossier(tmp_path)
    assert plan.modeles[0].connectiques == [
        ("PowerCon", "entree", 1), ("DMX 3p Male", "entree", 1), ("LineCon", "sortie", 1),
    ]  # fmt: skip
    assert {"PowerCon", "DMX 3p Male", "LineCon", "LinkCon"} <= set(plan.connecteurs)


def test_connecteur_doublon_fusionne(tmp_path):
    ecrire(tmp_path, "Lights", [
        ligne("Bar", "X", **{"Entrées": "XLR Male, XLR Male, PowerCon", "Sorties": "XLR Male"}),
    ])  # fmt: skip
    assert lire_dossier(tmp_path).modeles[0].connectiques == [
        ("XLR Male", "entree", 2), ("PowerCon", "entree", 1), ("XLR Male", "sortie", 1),
    ]  # fmt: skip


def test_linkcon_forcee(tmp_path):
    ecrire(tmp_path, "Écrans et Mapping", [ligne("Cable", "Linkcon")])
    assert par_nom(lire_dossier(tmp_path))["Linkcon"].connectiques == [("LinkCon", "entree", 2)]


def test_specs_longueur_poids(tmp_path):
    ecrire(tmp_path, "Structure", [ligne("Prolyte", "P", Longueur="200")])
    ecrire(tmp_path, "Son", [ligne("Sub", "S", Poids="47"), ligne("Sub", "T")])
    modeles = par_nom(lire_dossier(tmp_path))
    assert modeles["P"].specs["longueur"] == 200.0
    assert modeles["P"].specs["poids"] is None
    assert modeles["S"].specs["poids"] == 47.0
    assert modeles["T"].specs["poids"] is None
    assert modeles["S"].specs["largeur"] is None and modeles["S"].specs["hauteur"] is None


def test_nombre_virgule_et_invalide(tmp_path):
    ecrire(tmp_path, "Son", [ligne("Sub", "A", Poids="12,5"), ligne("Sub", "B", Poids="lourd")])
    plan = lire_dossier(tmp_path)
    modeles = par_nom(plan)
    assert modeles["A"].specs["poids"] == 12.5
    assert modeles["B"].specs["poids"] is None
    assert len(plan.anomalies) == 1
    assert "Son.csv:3" in plan.anomalies[0]


def test_modele_lignes_divergentes(tmp_path):
    conn = {"Entrées": "C13, DMX 3p Male"}
    ecrire(tmp_path, "Lights", [
        ligne("Beam", "MH-100", **conn), ligne("Beam", "MH-100", **conn), ligne("Beam", "MH-100"),
    ])  # fmt: skip
    plan = lire_dossier(tmp_path)
    assert plan.modeles[0].connectiques == [("C13", "entree", 1), ("DMX 3p Male", "entree", 1)]
    assert not plan.anomalies

    ecrire(tmp_path, "Son", [
        ligne("Sub", "Divergent", Poids="10"), ligne("Sub", "Divergent", Poids="10"),
        ligne("Sub", "Divergent", Poids="20"),
    ])  # fmt: skip
    plan = lire_dossier(tmp_path)
    assert par_nom(plan)["Divergent"].specs["poids"] == 10.0
    assert len(plan.anomalies) == 1
    assert "Divergent" in plan.anomalies[0]


def test_etats(tmp_path):
    ecrire(tmp_path, "Lights", [
        ligne("Bar", "Bon"),
        ligne("Bar", "Vide", ""),
        ligne("Bar", "Casse", "Cassé", Remarque="ne s'allume pas"),
        ligne("Bar", "Reparer", "À réparer"),
        ligne("Bar", "EnRep", "En réparation"),
    ])  # fmt: skip
    plan = lire_dossier(tmp_path)
    m = par_nom(plan)
    u = m["Bon"].unites[0]
    assert (u.statut, u.ticket, u.avancement) == ("Fonctionnel", None, None)
    u = m["Vide"].unites[0]
    assert (u.statut, u.ticket) == ("Fonctionnel", None)
    assert len(plan.anomalies) == 1 and "État vide" in plan.anomalies[0]
    u = m["Casse"].unites[0]
    assert u.ticket == "ne s'allume pas\n\nImporté depuis l'inventaire CSV (État : Cassé)."
    assert u.statut == "En_Panne" and u.remarque == "ne s'allume pas"
    u = m["Reparer"].unites[0]
    assert u.ticket == "Importé depuis l'inventaire CSV (État : À réparer)."
    assert u.remarque is None
    u = m["EnRep"].unites[0]
    assert (u.statut, u.avancement) == ("En_Reparation", "En_cours")
    assert u.ticket is not None


def test_etat_inconnu_anomalie(tmp_path):
    ecrire(tmp_path, "Lights", [ligne("Bar", "OK"), ligne("Bar", "Perdu", "Perdu?")])
    plan = lire_dossier(tmp_path)
    assert set(par_nom(plan)) == {"OK"}
    assert len(plan.anomalies) == 1
    assert "Lights.csv:3" in plan.anomalies[0]


def test_champs_des_categories_presentes(tmp_path):
    ecrire(tmp_path, "Lights", [ligne("Bar", "X")])
    plan = lire_dossier(tmp_path)
    assert plan.champs
    assert {c.categorie for c in plan.champs} == {"Lights"}
    assert [c.nom for c in plan.champs].count("Angle") == 4
    for c in plan.champs:
        if c.sous_categorie:
            assert c.sous_categorie in plan.sous_categories["Lights"]
    assert [c.ordre for c in plan.champs] == sorted(c.ordre for c in plan.champs)


DOSSIER_REEL = Path(__file__).resolve().parents[2] / "assets" / "sheet-log" / "clean"


@pytest.mark.skipif(not DOSSIER_REEL.is_dir(), reason="assets/ absent (CI)")
def test_donnees_reelles_si_presentes():
    plan = lire_dossier(DOSSIER_REEL)
    assert sum(len(m.unites) for m in plan.modeles) == 519
    assert [a for a in plan.anomalies if "État vide" not in a] == []
    assert set(plan.sous_categories) <= {
        "Lights", "Son", "Structure", "Câbles", "Accroche", "Écrans et Mapping", "Autre",
    }  # fmt: skip
    assert {m.categorie for m in plan.modeles} == set(plan.sous_categories)
