"""Point d'entrée : `python -m app.import_csv --api URL [--apply]` (voir __init__)."""

import argparse
import asyncio
import os
import sys
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.import_csv.importeur import (
    ErreurApi,
    ImportInterrompu,
    JetonBientotExpire,
    importer,
    verificateur_jeton,
)
from app.import_csv.mapping import lire_dossier
from app.models.enums import RoleMembre

DOSSIER_DEFAUT = Path(__file__).resolve().parents[3] / "assets" / "sheet-log"
ROLES_AUTORISES = {RoleMembre.ADMIN.value, RoleMembre.STAFF.value}
# Hôtes où http:// est admis : la machine locale, et la base des tests en process.
HOTES_HTTP = {"localhost", "127.0.0.1", "::1", "test"}
REPRISE = "l'import reprendra où il s'est arrêté"


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m app.import_csv",
        description="Importe l'inventaire CSV par l'API (simulation par défaut). "
        "Le jeton est lu dans la variable BPM_TOKEN (id_token authentik).",
    )
    p.add_argument("--api", required=True, help="URL de l'API, ex. http://localhost:8000/api")
    p.add_argument("--dossier", type=Path, default=DOSSIER_DEFAUT, help="dossier des CSV")
    p.add_argument("--apply", action="store_true", help="écrire réellement (sinon simulation)")
    p.add_argument("--yes", action="store_true", help="ne pas demander confirmation")
    p.add_argument(
        "--reappliquer-specs",
        action="store_true",
        help="réécrire depuis le CSV la catégorie, les specs fixes et la connectique de tous "
        "les modèles, même déjà importés (usage dev, après une correction du mapping) : "
        "écrase ce qui a été modifié dans l'application",
    )
    return p


def _signaler(e: Exception, en_cours: str) -> int:
    """Message d'arrêt (code 1) ; nomme l'étape en cours."""
    if isinstance(e, JetonBientotExpire):
        print(f"Arrêt avant {en_cours}.")
        print(f"Jeton bientôt expiré : ré-exporte BPM_TOKEN et relance, {REPRISE}.")
    elif isinstance(e, ErreurApi):
        print(f"Erreur API {e.statut} sur {e.methode} {e.chemin} ({en_cours}) : {e.corps}")
        if e.requete is not None:
            print(f"  requête : {e.requete}")
        if e.statut == 401:
            print(
                f"Jeton expiré ? Ré-exporte BPM_TOKEN et relance : {REPRISE} (unités "
                "manquantes créées, tickets manquants réparés, rien n'est supprimé)."
            )
    else:
        print(f"Erreur réseau sur {en_cours} : {e}. Relance : {REPRISE}.")
    return 1


async def principal(
    argv: list[str],
    *,
    entree: Callable[[str], str] = input,
    transport: httpx.AsyncBaseTransport | None = None,
) -> int:
    """Exécute la commande et renvoie le code de sortie."""
    args = _parser().parse_args(argv)
    url = urlsplit(args.api)
    if url.scheme == "http" and url.hostname not in HOTES_HTTP:
        print("Refusé : --api en http:// enverrait le jeton en clair.")
        return 2
    token = os.environ.get("BPM_TOKEN")
    if not token:
        print(
            "BPM_TOKEN manquant : copie l'id_token depuis le navigateur "
            "(voir python -m app.import_csv --help)."
        )
        return 2
    if not args.dossier.is_dir() or not any(args.dossier.glob("*.csv")):
        print(f"Aucun CSV dans {args.dossier}.")
        return 2
    plan = lire_dossier(args.dossier)
    verifier = verificateur_jeton(token)

    async with httpx.AsyncClient(
        base_url=args.api,
        transport=transport,
        timeout=30,
        headers={"Authorization": f"Bearer {token}"},
    ) as http:
        en_cours = "GET auth/me"
        try:
            rep = await http.get("auth/me")
            if rep.status_code != 200:
                raise ErreurApi("GET", "auth/me", rep.status_code, rep.text)
            try:
                moi = rep.json()
                role, email = moi["role"], moi["email"]
            except (ValueError, KeyError, TypeError):
                print(
                    f"Réponse inattendue de {args.api.rstrip('/')}/auth/me : "
                    "l'URL doit finir par /api."
                )
                return 2
            if role not in ROLES_AUTORISES:
                print(f"Compte {email} : rôle {role}, il faut Staff ou Admin.")
                return 2
            print(f"Cible : {args.api} — connecté en tant que {email} ({role})")

            rapport = await importer(http, plan, appliquer=False)
            print(rapport.texte())
            if not args.apply:
                print("Simulation : rien n'a été écrit. Relance avec --apply.")
                return 0

            question = f"Écrire dans {args.api} ? Tape oui pour continuer : "
            if not args.yes and entree(question) != "oui":
                print("Annulé.")
                return 1
            en_cours = "le début de l'écriture"
            if verifier is not None:
                verifier()
            rapport = await importer(
                http,
                plan,
                appliquer=True,
                reappliquer_specs=args.reappliquer_specs,
                verifier=verifier,
            )
            print(rapport.texte())
            return 0
        except ImportInterrompu as e:
            print(e.rapport.texte())
            print("Import interrompu : le rapport ci-dessus s'arrête là.")
            return _signaler(e.cause, e.en_cours)
        except (ErreurApi, httpx.HTTPError, JetonBientotExpire) as e:
            return _signaler(e, en_cours)


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
