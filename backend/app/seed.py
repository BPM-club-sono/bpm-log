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
from app.models import Categorie, Emplacement, Equipment, Membre, UserAuth
from app.models.enums import RoleMembre, StatutEquipment
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


# Données de démonstration pour peupler le catalogue (M3).
_DEMO_CATEGORIES = [
    ("Lumière", "Projecteurs, lyres, PAR LED"),
    ("Son", "Enceintes, amplis, tables de mixage"),
    ("Structure", "Pieds, ponts, élingues"),
    ("Câblage", "XLR, DMX, alimentation"),
]

_DEMO_EMPLACEMENTS = [
    ("Étagère A", "Dépôt principal"),
    ("Bac Câbles", "Dépôt principal"),
    ("Flight Son 1", "Zone départ"),
]

# (nom, barcode_uid, index catégorie, index emplacement, statut)
_DEMO_EQUIPMENTS = [
    ("Lyre Beam 7R", "BPM-LUM-0001", 0, 0, StatutEquipment.FONCTIONNEL),
    ("PAR LED 18x12W", "BPM-LUM-0002", 0, 0, StatutEquipment.FONCTIONNEL),
    ("Lyre Wash 19x15W", "BPM-LUM-0003", 0, 0, StatutEquipment.EN_PANNE),
    ("Ampli Crown XTi 6002", "BPM-SON-0001", 1, 2, StatutEquipment.FONCTIONNEL),
    ("Enceinte RCF ART 745", "BPM-SON-0002", 1, 2, StatutEquipment.FONCTIONNEL),
    ("Table Behringer X32", "BPM-SON-0003", 1, 2, StatutEquipment.EN_REPARATION),
    ("Pied de levage 4m", "BPM-STR-0001", 2, 0, StatutEquipment.FONCTIONNEL),
    ("Pont alu 290 - 2m", "BPM-STR-0002", 2, 0, StatutEquipment.FONCTIONNEL),
    ("Câble XLR 10m", "BPM-CAB-0001", 3, 1, StatutEquipment.FONCTIONNEL),
    ("Câble DMX 5m", "BPM-CAB-0002", 3, 1, StatutEquipment.FONCTIONNEL),
]


async def seed_demo() -> None:
    """Insère un petit catalogue de démonstration (idempotent sur le code-barres)."""
    async with async_session_factory() as db:
        categories: list[Categorie] = []
        for nom, description in _DEMO_CATEGORIES:
            cat = await db.scalar(select(Categorie).where(Categorie.nom == nom))
            if cat is None:
                cat = Categorie(nom=nom, description=description)
                db.add(cat)
            categories.append(cat)

        emplacements: list[Emplacement] = []
        for nom, zone in _DEMO_EMPLACEMENTS:
            emp = await db.scalar(select(Emplacement).where(Emplacement.nom == nom))
            if emp is None:
                emp = Emplacement(nom=nom, zone_stockage=zone)
                db.add(emp)
            emplacements.append(emp)

        await db.flush()

        created = 0
        for nom, barcode, cat_idx, emp_idx, statut in _DEMO_EQUIPMENTS:
            existing = await db.scalar(
                select(Equipment).where(Equipment.barcode_uid == barcode)
            )
            if existing is not None:
                continue
            db.add(
                Equipment(
                    nom=nom,
                    barcode_uid=barcode,
                    categorie_id=categories[cat_idx].id,
                    emplacement_id=emplacements[emp_idx].id,
                    statut_actuel=statut,
                )
            )
            created += 1

        await db.commit()
        print(
            f"Catalogue de démo : {len(categories)} catégories, "
            f"{len(emplacements)} emplacements, {created} équipements ajoutés."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Crée un administrateur BPM Log.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--nom", default="Admin")
    parser.add_argument("--prenom", default="BPM")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Ajoute aussi un catalogue de démonstration.",
    )
    args = parser.parse_args()

    async def run() -> None:
        await seed_admin(args.email, args.password, args.nom, args.prenom)
        if args.demo:
            await seed_demo()

    asyncio.run(run())


if __name__ == "__main__":
    main()
