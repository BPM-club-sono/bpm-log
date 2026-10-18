"""Point d'entrée : `python -m app.import_csv --api URL [--apply]` (voir __init__)."""

import argparse
import asyncio
import os
import sys
from collections.abc import Callable
from pathlib import Path

import httpx

from app.import_csv.importeur import ErreurApi, importer
from app.import_csv.mapping import lire_dossier
from app.models.enums import RoleMembre

DOSSIER_DEFAUT = Path(__file__).resolve().parents[3] / "assets" / "sheet-log" / "clean"
ROLES_AUTORISES = {RoleMembre.ADMIN.value, RoleMembre.STAFF.value}


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
    return p


async def principal(
    argv: list[str],
    *,
    entree: Callable[[str], str] = input,
    transport: httpx.AsyncBaseTransport | None = None,
) -> int:
    """Exécute la commande et renvoie le code de sortie."""
    args = _parser().parse_args(argv)
    token = os.environ.get("BPM_TOKEN")
    if not token:
        print(
            "BPM_TOKEN manquant : copie l'id_token depuis le navigateur "
            "(voir python -m app.import_csv --help)."
        )
        return 2

    async with httpx.AsyncClient(
        base_url=args.api,
        transport=transport,
        timeout=30,
        headers={"Authorization": f"Bearer {token}"},
    ) as http:
        try:
            rep = await http.get("auth/me")
            if rep.status_code != 200:
                raise ErreurApi("GET", "auth/me", rep.status_code, rep.text)
            moi = rep.json()
            if moi["role"] not in ROLES_AUTORISES:
                print(f"Compte {moi['email']} : rôle {moi['role']}, il faut Staff ou Admin.")
                return 2
            print(f"Cible : {args.api} — connecté en tant que {moi['email']} ({moi['role']})")

            plan = lire_dossier(args.dossier)
            rapport = await importer(http, plan, appliquer=False)
            print(rapport.texte())
            if not args.apply:
                print("Simulation : rien n'a été écrit. Relance avec --apply.")
                return 0

            question = f"Écrire dans {args.api} ? Tape oui pour continuer : "
            if not args.yes and entree(question) != "oui":
                print("Annulé.")
                return 1
            print((await importer(http, plan, appliquer=True)).texte())
            return 0
        except ErreurApi as e:
            print(f"Erreur API {e.statut} sur {e.methode} {e.chemin} : {e.corps}")
            if e.statut == 401:
                print("Token expiré ? Ré-exporte BPM_TOKEN et relance : l'import est rejouable.")
            return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
