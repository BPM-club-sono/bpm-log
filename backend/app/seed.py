"""Script de seed : crée un membre Admin initial avec un compte de connexion.

Usage :
    python -m app.seed --email admin@bpm.example --password "motdepasse" \
        --nom Dupont --prenom Jean

À lancer après `alembic upgrade head`.
"""

import argparse
import asyncio

from sqlalchemy import select

from app.database import async_session_factory
from app.models import Membre, UserAuth
from app.models.enums import RoleMembre
from app.security.passwords import hash_password


async def seed_admin(email: str, password: str, nom: str, prenom: str) -> None:
    async with async_session_factory() as db:
        existing = await db.scalar(select(Membre).where(Membre.email == email))
        if existing is not None:
            print(f"Un membre avec l'email {email} existe déjà (id={existing.id}).")
            return

        membre = Membre(
            nom=nom,
            prenom=prenom,
            email=email,
            role=RoleMembre.ADMIN,
        )
        db.add(membre)
        await db.flush()

        db.add(UserAuth(membre_id=membre.id, password_hash=hash_password(password)))
        await db.commit()
        print(f"Admin créé : {email} (membre id={membre.id}).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Crée un administrateur BPM Log.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--nom", default="Admin")
    parser.add_argument("--prenom", default="BPM")
    args = parser.parse_args()

    asyncio.run(seed_admin(args.email, args.password, args.nom, args.prenom))


if __name__ == "__main__":
    main()
