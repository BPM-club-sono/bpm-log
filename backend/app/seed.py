"""Script de seed : crée le membre Admin initial.

Usage :
    python -m app.seed --email admin@bpm.example --nom Dupont --prenom Jean

L'authentification passe par authentik (cf. docs/authentik-sso.md) : ce script
ne crée aucun identifiant, seulement la ligne `membres` avec le rôle Admin.
Sans lui, un compte inconnu est provisionné en `Staff` à sa première requête et
il n'y aurait aucun Admin. L'email doit être **exactement** celui du compte
authentik, c'est la clé de rapprochement.

À lancer après `alembic upgrade head`.
"""

import argparse
import asyncio

from sqlalchemy import select

from app.database import async_session_factory
from app.models import (
    AllocationPresta,
    Categorie,
    Emplacement,
    Equipment,
    EquipmentConsommable,
    EquipmentVrac,
    Membre,
    Prestation,
    UserAuth,
)
from app.models.enums import (
    RoleMembre,
    StatutAllocation,
    StatutEquipment,
    StatutPrestation,
    TypePrestation,
)
from app.services import barcode, references


async def seed_admin(email: str, nom: str, prenom: str) -> None:
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

        # Ligne d'activation : permet de couper l'accès sans toucher à authentik.
        db.add(UserAuth(membre_id=membre.id))
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

# (nom, index catégorie, index emplacement, statut) — les références sont
# attribuées à l'insertion, à partir de l'id : elles ne peuvent pas être figées
# ici, et l'idempotence se clée donc sur le nom.
_DEMO_EQUIPMENTS = [
    ("Lyre Beam 7R", 0, 0, StatutEquipment.FONCTIONNEL),
    ("PAR LED 18x12W", 0, 0, StatutEquipment.FONCTIONNEL),
    ("Lyre Wash 19x15W", 0, 0, StatutEquipment.EN_PANNE),
    ("Ampli Crown XTi 6002", 1, 2, StatutEquipment.FONCTIONNEL),
    ("Enceinte RCF ART 745", 1, 2, StatutEquipment.FONCTIONNEL),
    ("Table Behringer X32", 1, 2, StatutEquipment.EN_REPARATION),
    ("Pied de levage 4m", 2, 0, StatutEquipment.FONCTIONNEL),
    ("Pont alu 290 - 2m", 2, 0, StatutEquipment.FONCTIONNEL),
    ("Câble XLR 10m", 3, 1, StatutEquipment.FONCTIONNEL),
    ("Câble DMX 5m", 3, 1, StatutEquipment.FONCTIONNEL),
]


async def seed_demo() -> None:
    """Insère un petit catalogue de démonstration (idempotent sur le nom)."""
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
        for nom, cat_idx, emp_idx, statut in _DEMO_EQUIPMENTS:
            existing = await db.scalar(select(Equipment).where(Equipment.nom == nom))
            if existing is not None:
                continue
            eq_id, reference = await references.reserver(db, barcode.PREFIXE_INTERNE)
            db.add(
                Equipment(
                    id=eq_id,
                    nom=nom,
                    barcode_uid=reference,
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


async def seed_demo_prestation() -> None:
    """Crée une prestation de démonstration avec quelques allocations (idempotent)."""
    async with async_session_factory() as db:
        existing = await db.scalar(
            select(Prestation).where(Prestation.nom == "Nuketown 2026")
        )
        if existing is not None:
            print("Prestation de démo déjà présente.")
            return

        presta = Prestation(
            nom="Nuketown 2026",
            type=TypePrestation.INTERNE,
            client_nom="BDE",
            statut=StatutPrestation.EN_PREPARATION,
        )
        db.add(presta)
        await db.flush()

        # (nom de l'équipement, quantité prévue)
        plan = [
            ("Lyre Beam 7R", 2),
            ("Enceinte RCF ART 745", 2),
            ("Câble XLR 10m", 6),
            ("Pied de levage 4m", 1),
        ]
        added = 0
        for nom_eq, quantite in plan:
            eq = await db.scalar(select(Equipment).where(Equipment.nom == nom_eq))
            if eq is None:
                continue
            db.add(
                AllocationPresta(
                    presta_id=presta.id,
                    equipment_id=eq.id,
                    quantite=quantite,
                    statut=StatutAllocation.PLANIFIE,
                )
            )
            added += 1

        await db.commit()
        print(f"Prestation de démo « Nuketown 2026 » créée avec {added} allocations.")


# Caisses vrac de démo : (nom, catégorie idx, emplacement idx, qté théorique)
_DEMO_VRAC = [
    ("Caisse câbles XLR 3m", 3, 1, 50),
    ("Caisse multipaires", 3, 1, 12),
]

# Consommables de démo : (nom, cat idx, emp idx, stock, seuil, unité)
_DEMO_CONSO = [
    ("Gaffer noir 50mm", 3, 0, 24, 5, "rouleau"),
    ("Piles AA", 0, 0, 40, 12, "pile"),
    ("Colliers Rilsan", 3, 0, 3, 20, "sachet"),
]


async def seed_demo_inventaire() -> None:
    """Crée des caisses vrac et des consommables de démonstration (idempotent)."""
    async with async_session_factory() as db:
        cats = {
            c.nom: c
            for c in (await db.scalars(select(Categorie))).all()
        }
        emps = list((await db.scalars(select(Emplacement).order_by(Emplacement.id))).all())
        cat_list = [cats.get(nom) for nom, _ in _DEMO_CATEGORIES]

        vrac_n = 0
        for nom, cat_idx, emp_idx, theorique in _DEMO_VRAC:
            existing = await db.scalar(select(Equipment).where(Equipment.nom == nom))
            if existing is not None:
                continue
            eq_id, reference = await references.reserver(db, barcode.PREFIXE_INTERNE)
            eq = Equipment(
                id=eq_id,
                nom=nom,
                barcode_uid=reference,
                categorie_id=cat_list[cat_idx].id if cat_list[cat_idx] else None,
                emplacement_id=emps[emp_idx].id if emp_idx < len(emps) else None,
                statut_actuel=StatutEquipment.FONCTIONNEL,
            )
            db.add(eq)
            await db.flush()
            db.add(EquipmentVrac(equipment_id=eq.id, quantite_theorique=theorique))
            vrac_n += 1

        conso_n = 0
        for nom, cat_idx, emp_idx, stock, seuil, unite in _DEMO_CONSO:
            existing = await db.scalar(select(Equipment).where(Equipment.nom == nom))
            if existing is not None:
                continue
            eq_id, reference = await references.reserver(db, barcode.PREFIXE_INTERNE)
            eq = Equipment(
                id=eq_id,
                nom=nom,
                barcode_uid=reference,
                categorie_id=cat_list[cat_idx].id if cat_list[cat_idx] else None,
                emplacement_id=emps[emp_idx].id if emp_idx < len(emps) else None,
                statut_actuel=StatutEquipment.FONCTIONNEL,
            )
            db.add(eq)
            await db.flush()
            db.add(
                EquipmentConsommable(
                    equipment_id=eq.id,
                    stock_actuel=stock,
                    seuil_alerte=seuil,
                    unite=unite,
                )
            )
            conso_n += 1

        await db.commit()
        print(f"Inventaire de démo : {vrac_n} caisses vrac, {conso_n} consommables ajoutés.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Crée un administrateur BPM Log.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--nom", default="Admin")
    parser.add_argument("--prenom", default="BPM")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Ajoute aussi un catalogue de démonstration.",
    )
    args = parser.parse_args()

    async def run() -> None:
        await seed_admin(args.email, args.nom, args.prenom)
        if args.demo:
            await seed_demo()
            await seed_demo_prestation()
            await seed_demo_inventaire()

    asyncio.run(run())


if __name__ == "__main__":
    main()
