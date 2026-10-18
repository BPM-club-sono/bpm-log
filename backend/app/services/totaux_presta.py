"""Totaux d'une prestation : poids, prix au tarif de son type, connectiques.

Chaque allocation compte pour `unité × quantite` (un vrac ou un consommable alloué
en nombre compte autant de fois ; une unité standard a `quantite = 1`). Les specs
d'une unité sont celles de son modèle s'il en a un, sinon les siennes (même règle
que `services/specs.py`). Le contenu d'un flight alloué a ses propres allocations :
rien à parcourir dans l'arbre des contenants.

À la clôture, prix et poids unitaires sont figés sur chaque allocation, pour que le
rapport garde les valeurs d'alors ; les connectiques restent lues au catalogue.
"""

from collections import defaultdict

from sqlalchemy import or_, select, update

from app.deps import DbSession
from app.models import AllocationPresta, Connecteur, Connectique, Equipment, Modele, Prestation
from app.models.enums import SensConnectique, StatutPrestation, TypePrestation
from app.schemas.prestation import TotalConnectique, TotauxPresta

# (connecteur_id, connecteur_nom, sens, quantite par unité)
LigneConnectique = tuple[int, str, SensConnectique, int]
SpecsUnitaires = tuple[float | None, float | None, list[LigneConnectique]]


async def specs_unitaires(
    db: DbSession, allocs: list[AllocationPresta], type_presta: TypePrestation
) -> dict[int, SpecsUnitaires]:
    """Par allocation : (prix unitaire au tarif `type_presta`, poids unitaire, connectiques).

    Trois requêtes quel que soit le nombre d'allocations.
    """
    if not allocs:
        return {}
    equipments = {
        eq.id: eq
        for eq in await db.scalars(
            select(Equipment).where(Equipment.id.in_([a.equipment_id for a in allocs]))
        )
    }
    modele_ids = list({eq.modele_id for eq in equipments.values() if eq.modele_id is not None})
    modeles = (
        {m.id: m for m in await db.scalars(select(Modele).where(Modele.id.in_(modele_ids)))}
        if modele_ids
        else {}
    )
    sans_modele = [eid for eid, eq in equipments.items() if eq.modele_id is None]

    par_modele: dict[int, list[LigneConnectique]] = defaultdict(list)
    par_equipment: dict[int, list[LigneConnectique]] = defaultdict(list)
    rows = await db.execute(
        select(Connectique, Connecteur.nom)
        .join(Connecteur, Connecteur.id == Connectique.connecteur_id)
        .where(
            or_(
                Connectique.modele_id.in_(modele_ids),
                Connectique.equipment_id.in_(sans_modele),
            )
        )
    )
    for c, nom in rows.all():
        ligne = (c.connecteur_id, nom, c.sens, c.quantite)
        if c.modele_id is not None:
            par_modele[c.modele_id].append(ligne)
        else:
            par_equipment[c.equipment_id].append(ligne)

    externe = type_presta == TypePrestation.EXTERNE
    resultat: dict[int, SpecsUnitaires] = {}
    for a in allocs:
        eq = equipments[a.equipment_id]
        if eq.modele_id is not None:
            cible, connectiques = modeles[eq.modele_id], par_modele[eq.modele_id]
        else:
            cible, connectiques = eq, par_equipment[eq.id]
        prix = cible.prix_externe if externe else cible.prix_interne
        resultat[a.id] = (prix, cible.poids, connectiques)
    return resultat


async def calculer_totaux(
    db: DbSession, presta: Prestation, allocs: list[AllocationPresta]
) -> tuple[TotauxPresta, dict[int, tuple[float | None, float | None]]]:
    """Totaux de `presta` + (prix_unitaire, poids_unitaire) par allocation.

    Prestation terminée : prix et poids figés à la clôture.
    """
    fige = presta.statut == StatutPrestation.TERMINEE
    specs = await specs_unitaires(db, allocs, presta.type)
    unitaires: dict[int, tuple[float | None, float | None]] = {
        a.id: (a.prix_unitaire_fige, a.poids_unitaire_fige) if fige else specs[a.id][:2]
        for a in allocs
    }

    poids_total = prix_total = 0.0
    nb_sans_poids = nb_sans_prix = 0
    connectiques: dict[tuple[int, SensConnectique], int] = defaultdict(int)
    noms: dict[int, str] = {}
    for a in allocs:
        prix, poids = unitaires[a.id]
        if poids is None:
            nb_sans_poids += 1
        else:
            poids_total += poids * a.quantite
        if prix is None:
            nb_sans_prix += 1
        else:
            prix_total += prix * a.quantite
        for cid, nom, sens, quantite in specs[a.id][2]:
            connectiques[(cid, sens)] += quantite * a.quantite
            noms[cid] = nom

    totaux = TotauxPresta(
        tarif="externe" if presta.type == TypePrestation.EXTERNE else "interne",
        fige=fige,
        # Valeurs saisies au centime : on évite les résidus de l'addition flottante.
        poids_total=round(poids_total, 2),
        nb_sans_poids=nb_sans_poids,
        prix_total=round(prix_total, 2),
        nb_sans_prix=nb_sans_prix,
        connectiques=[
            TotalConnectique(connecteur_id=cid, connecteur_nom=noms[cid], sens=sens, quantite=q)
            for (cid, sens), q in sorted(
                connectiques.items(), key=lambda kv: (kv[0][1], noms[kv[0][0]])
            )
        ],
    )
    return totaux, unitaires


async def figer_allocations(db: DbSession, presta: Prestation) -> None:
    """Fige prix (au tarif du type) et poids unitaires de chaque allocation (sans commit)."""
    allocs = list(
        (
            await db.scalars(
                select(AllocationPresta).where(AllocationPresta.presta_id == presta.id)
            )
        ).all()
    )
    specs = await specs_unitaires(db, allocs, presta.type)
    for a in allocs:
        a.prix_unitaire_fige, a.poids_unitaire_fige, _ = specs[a.id]


async def defiger_allocations(db: DbSession, presta_id: int) -> None:
    """Prestation rouverte : les totaux repartent du catalogue (sans commit)."""
    await db.execute(
        update(AllocationPresta)
        .where(AllocationPresta.presta_id == presta_id)
        .values(prix_unitaire_fige=None, poids_unitaire_fige=None)
    )
