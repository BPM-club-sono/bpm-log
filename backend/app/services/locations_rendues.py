"""Locations rendues d'une prestation clôturée : lesquelles archiver d'un coup.

Une location (équipement avec une fiche `EquipmentLocation`) allouée à la
prestation et non archivée est **archivable** si elle passe tous les tests
ci-dessous ; sinon elle est **gardée**, avec la raison du premier test qui échoue,
dans cet ordre :

1. décision de clôture `perdu` → « perdue », `casse` → « cassée »,
   `ouvert` → « en suspens » ;
2. jamais sortie (`quantite_sortie == 0`) → « jamais sortie » ;
3. pas entièrement rendue (`quantite_retournee < quantite_sortie`)
   → « pas entièrement rendue » ;
4. hors service (`disponibilite.STATUTS_BLOQUES`) → « hors service » ;
5. allocation non retournée sur une autre prestation non clôturée
   → « prévue sur « <nom> » » ;
6. flight (`est_contenant`) dont un descendant ne passerait pas 1–5 ou n'est pas
   une location de cette prestation → « contenu du flight non rendu ».

Le contenu d'un flight loué suit son flight et n'est jamais listé à part, dans
aucune des deux listes : si le flight est archivable, l'archivage en cascade
(`contenants.archiver_cascade`) l'emporte avec lui ; si le flight est gardé (pour
son contenu ou pour lui-même), tout son contenu reste gardé avec lui, même les
locations rendues — on ne laisse jamais un flight actif au contenu en partie
archivé. Vaut à toute profondeur : un flight extérieur gardé masque tout ce qu'il
contient, sous-flights compris.

Si un équipement porte plusieurs allocations sur la prestation, chaque test est
évalué sur toutes ses allocations avant de passer au suivant.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.deps import DbSession
from app.models import AllocationPresta, Equipment, EquipmentLocation, Prestation
from app.models.enums import DecisionCloture, StatutAllocation, StatutPrestation
from app.services import contenants
from app.services.disponibilite import STATUTS_BLOQUES

RAISON_DECISION = {
    DecisionCloture.PERDU: "perdue",
    DecisionCloture.CASSE: "cassée",
    DecisionCloture.OUVERT: "en suspens",
}
RAISON_CONTENU = "contenu du flight non rendu"


@dataclass
class TriLocations:
    archivables: list[Equipment] = field(default_factory=list)
    gardes: list[tuple[Equipment, str]] = field(default_factory=list)


def _raison_allocations(allocs: list[AllocationPresta], eq: Equipment) -> str | None:
    """Tests 1 à 4 (ceux qui ne demandent pas d'autre requête)."""
    for a in allocs:
        if a.decision_cloture in RAISON_DECISION:
            return RAISON_DECISION[a.decision_cloture]
    if any(a.quantite_sortie == 0 for a in allocs):
        return "jamais sortie"
    if any(a.quantite_retournee < a.quantite_sortie for a in allocs):
        return "pas entièrement rendue"
    if eq.statut_actuel in STATUTS_BLOQUES:
        return "hors service"
    return None


async def _prevues_ailleurs(
    db: DbSession, presta: Prestation, equipment_ids: list[int]
) -> dict[int, str]:
    """equipment_id → nom de l'autre prestation non clôturée qui l'attend encore."""
    if not equipment_ids:
        return {}
    rows = await db.execute(
        select(AllocationPresta.equipment_id, Prestation.nom)
        .join(Prestation, Prestation.id == AllocationPresta.presta_id)
        .where(
            AllocationPresta.equipment_id.in_(equipment_ids),
            AllocationPresta.statut != StatutAllocation.RETOURNE,
            Prestation.id != presta.id,
            Prestation.statut != StatutPrestation.TERMINEE,
        )
        .order_by(Prestation.date_debut.nulls_last(), Prestation.id)
    )
    result: dict[int, str] = {}
    for eid, nom in rows.all():
        result.setdefault(eid, nom)
    return result


async def trier_locations_rendues(db: DbSession, presta: Prestation) -> TriLocations:
    """Sépare les locations de `presta` en archivables et gardées (cf. module)."""
    allocs = (
        await db.scalars(
            select(AllocationPresta)
            .join(
                EquipmentLocation,
                EquipmentLocation.equipment_id == AllocationPresta.equipment_id,
            )
            .where(AllocationPresta.presta_id == presta.id)
            .options(selectinload(AllocationPresta.equipment))
            .order_by(AllocationPresta.id)
        )
    ).all()
    # Toutes les locations de la presta, archivées comprises : un flight
    # archivable peut contenir une location déjà archivée.
    par_eq: dict[int, list[AllocationPresta]] = {}
    equipements: dict[int, Equipment] = {}
    for a in allocs:
        par_eq.setdefault(a.equipment_id, []).append(a)
        equipements[a.equipment_id] = a.equipment

    ailleurs = await _prevues_ailleurs(db, presta, list(par_eq))
    raisons: dict[int, str | None] = {}
    for eid, eq_allocs in par_eq.items():
        raison = _raison_allocations(eq_allocs, equipements[eid])
        if raison is None and eid in ailleurs:
            raison = f"prévue sur « {ailleurs[eid]} »"
        raisons[eid] = raison

    candidats = sorted(
        (eq for eq in equipements.values() if not eq.archive),
        key=lambda eq: (eq.nom, eq.id),
    )
    finales: dict[int, str | None] = dict(raisons)
    # Contenu d'un flight candidat, archivable ou gardé : il suit son flight et
    # n'est jamais listé (ni archivé) à part.
    suivent_leur_flight: set[int] = set()
    for eq in candidats:
        if not eq.est_contenant:
            continue
        descendants = await contenants.descendant_ids(db, eq.id)
        suivent_leur_flight.update(descendants)
        if raisons[eq.id] is None and any(
            raisons.get(d, RAISON_CONTENU) is not None for d in descendants
        ):
            finales[eq.id] = RAISON_CONTENU

    tri = TriLocations()
    for eq in candidats:
        if eq.id in suivent_leur_flight:
            continue
        raison = finales[eq.id]
        if raison is not None:
            tri.gardes.append((eq, raison))
        else:
            tri.archivables.append(eq)
    return tri
