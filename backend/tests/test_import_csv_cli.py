"""Commande `python -m app.import_csv` : garde-fous, simulation, confirmation."""

import base64
import json
import time
import uuid

import httpx
import pytest
from conftest import TransportEnPanne, requete, surcharger_app
from fastapi import HTTPException
from httpx import ASGITransport
from sqlalchemy import func, select

from app.deps import get_current_user
from app.import_csv.__main__ import principal
from app.import_csv.importeur import expiration_jwt
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
    dossier, _ = _dossier(tmp_path)
    with surcharger_app(db_session, tech):
        code = await principal(_argv(dossier), transport=ASGITransport(app=app))
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


async def test_401_message_reprise(jeton, capsys, db_session, staff_import, tmp_path):
    async def _refus():
        raise HTTPException(401, "Token invalide ou expiré.")

    dossier, _ = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        app.dependency_overrides[get_current_user] = _refus
        code = await principal(_argv(dossier), transport=ASGITransport(app=app))
    assert code == 1
    assert "l'import reprendra où il s'est arrêté" in capsys.readouterr().out


def _jeton(**charge) -> str:
    """JWT non signé fabriqué à la main (seule la charge utile compte ici)."""

    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    return f"{b64({'alg': 'none'})}.{b64(charge)}.signature"


def _transport_interdit() -> httpx.MockTransport:
    def refuser(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"appel API inattendu : {request.url}")

    return httpx.MockTransport(refuser)


def test_expiration_jwt():
    assert expiration_jwt(_jeton(exp=1_700_000_000, email="a@b.example")) == 1_700_000_000
    assert expiration_jwt(_jeton(email="a@b.example")) is None
    assert expiration_jwt("jeton-bidon") is None
    assert expiration_jwt("a.%%%.c") is None
    assert expiration_jwt("a.bm9uLWpzb24.c") is None


async def test_jeton_bientot_expire_apres_oui(
    monkeypatch, capsys, db_session, staff_import, tmp_path
):
    monkeypatch.setenv("BPM_TOKEN", _jeton(exp=int(time.time()) + 30))
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        code = await principal(
            _argv(dossier, "--apply", "--yes"), transport=ASGITransport(app=app)
        )
    assert code == 1
    assert "Jeton bientôt expiré : ré-exporte BPM_TOKEN et relance" in capsys.readouterr().out
    assert await _nb_modeles(db_session, nom) == 0


@pytest.mark.parametrize("vide", [True, False])
async def test_aucun_csv(jeton, capsys, tmp_path, vide):
    dossier = tmp_path if vide else tmp_path / "absent"
    code = await principal(_argv(str(dossier)), transport=_transport_interdit())
    assert code == 2
    assert f"Aucun CSV dans {dossier}." in capsys.readouterr().out


async def test_http_en_clair_refuse(jeton, capsys, tmp_path):
    dossier, _ = _dossier(tmp_path)
    code = await principal(
        ["--api", "http://bpm.example/api", "--dossier", dossier],
        transport=_transport_interdit(),
    )
    assert code == 2
    assert "Refusé : --api en http:// enverrait le jeton en clair." in capsys.readouterr().out


async def test_reponse_html_mauvaise_url(jeton, capsys, tmp_path):
    dossier, _ = _dossier(tmp_path)
    spa = httpx.MockTransport(lambda r: httpx.Response(200, text="<!doctype html><html>"))
    code = await principal(["--api", "https://bpm.example", "--dossier", dossier], transport=spa)
    assert code == 2
    assert (
        "Réponse inattendue de https://bpm.example/auth/me : l'URL doit finir par /api."
        in capsys.readouterr().out
    )


async def test_erreur_reseau_auth_me(jeton, capsys, tmp_path):
    dossier, _ = _dossier(tmp_path)

    def couper(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connexion refusée", request=request)

    code = await principal(_argv(dossier), transport=httpx.MockTransport(couper))
    assert code == 1
    sortie = capsys.readouterr().out
    assert "Erreur réseau sur GET auth/me : connexion refusée." in sortie
    assert "l'import reprendra où il s'est arrêté" in sortie


async def test_erreur_reseau_nomme_le_modele(jeton, capsys, db_session, staff_import, tmp_path):
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        code = await principal(
            _argv(dossier, "--apply", "--yes"),
            transport=TransportEnPanne(requete("POST", "equipments")),
        )
    assert code == 1
    sortie = capsys.readouterr().out
    assert f"Erreur réseau sur le modèle « {nom} » : coupure simulée." in sortie
    assert "Relance : l'import reprendra où il s'est arrêté." in sortie


async def test_option_reappliquer_specs(jeton, db_session, staff_import, tmp_path):
    dossier, nom = _dossier(tmp_path)
    with surcharger_app(db_session, staff_import):
        argv = _argv(dossier, "--apply", "--yes")
        assert await principal(argv, transport=ASGITransport(app=app)) == 0
        modele = (await db_session.execute(select(Modele).where(Modele.nom == nom))).scalar_one()
        modele.poids = 3.0
        await db_session.flush()
        assert await principal(argv, transport=ASGITransport(app=app)) == 0
        await db_session.refresh(modele)
        assert modele.poids == 3.0
        argv.append("--reappliquer-specs")
        assert await principal(argv, transport=ASGITransport(app=app)) == 0
        await db_session.refresh(modele)
        assert modele.poids is None
