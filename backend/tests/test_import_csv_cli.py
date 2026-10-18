"""Commande `python -m app.import_csv` : garde-fous, simulation, confirmation."""

import uuid

import pytest
from conftest import surcharger_app
from fastapi import HTTPException
from httpx import ASGITransport
from sqlalchemy import func, select

from app.deps import get_current_user
from app.import_csv.__main__ import principal
from app.main import app
from app.models.db_models import Membre, Modele
from app.models.enums import RoleMembre

ENTETE = "Type,Nom,Entrées,Sorties,Longueur,Poids,Prix inté,Prix exté,État,Remarque\n"


def _dossier(tmp_path) -> tuple[str, str]:
    s = uuid.uuid4().hex[:8]
    (tmp_path / "Inventaire BPM - Lights.csv").write_text(
        ENTETE + f"Stobe,Cli test {s},,,,,,,Bon,\n", encoding="utf-8"
    )
    return str(tmp_path), f"Cli test {s}"


def _argv(dossier: str, *extra: str) -> list[str]:
    return ["--api", "http://test/api", "--dossier", dossier, *extra]


async def _nb_modeles(db_session, nom: str) -> int:
    return (
        await db_session.execute(select(func.count()).select_from(Modele).where(Modele.nom == nom))
    ).scalar_one()


@pytest.fixture
def jeton(monkeypatch):
    monkeypatch.setenv("BPM_TOKEN", "jeton-bidon")


async def test_sans_token(monkeypatch, capsys, tmp_path):
    monkeypatch.delenv("BPM_TOKEN", raising=False)
    code = await principal(_argv(str(tmp_path)))
    assert code == 2
    assert "BPM_TOKEN manquant" in capsys.readouterr().out


async def test_role_tech_refuse(jeton, capsys, db_session, tmp_path):
    tech = Membre(email=f"tech-{uuid.uuid4().hex}@bpm.example", role=RoleMembre.TECH)
    db_session.add(tech)
    await db_session.flush()
    with surcharger_app(db_session, tech):
        code = await principal(_argv(str(tmp_path)), transport=ASGITransport(app=app))
    assert code == 2
    assert "il faut Staff ou Admin" in capsys.readouterr().out


async def test_simulation_par_defaut(jeton, capsys, db_session, staff_import, tmp_path):
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        code = await principal(_argv(dossier), transport=ASGITransport(app=app))
    sortie = capsys.readouterr().out
    assert code == 0
    assert "Simulation : rien n'a été écrit" in sortie
    assert f"connecté en tant que {staff_import.email}" in sortie
    assert await _nb_modeles(db_session, nom) == 0


async def test_apply_annule_sans_oui(jeton, capsys, db_session, staff_import, tmp_path):
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        code = await principal(
            _argv(dossier, "--apply"),
            entree=lambda _: "non",
            transport=ASGITransport(app=app),
        )
    assert code == 1
    assert "Annulé." in capsys.readouterr().out
    assert await _nb_modeles(db_session, nom) == 0


async def test_apply_oui(jeton, db_session, staff_import, tmp_path):
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        code = await principal(
            _argv(dossier, "--apply"),
            entree=lambda _: "oui",
            transport=ASGITransport(app=app),
        )
    assert code == 0
    assert await _nb_modeles(db_session, nom) == 1


async def test_401_message_rejouable(jeton, capsys, db_session, staff_import, tmp_path):
    async def _refus():
        raise HTTPException(401, "Token invalide ou expiré.")

    with surcharger_app(db_session, staff_import):
        app.dependency_overrides[get_current_user] = _refus
        code = await principal(_argv(str(tmp_path)), transport=ASGITransport(app=app))
    assert code == 1
    assert "l'import est rejouable" in capsys.readouterr().out
