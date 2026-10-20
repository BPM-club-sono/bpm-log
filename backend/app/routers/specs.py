"""Spécifications techniques d'un modèle ou d'un équipement sans modèle.
Lecture pour tous, écriture Admin+Staff.

Une unité rattachée à un modèle renvoie les specs de son modèle, et refuse
l'écriture (409) : elles se modifient sur le modèle.
"""

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import Equipment, Modele
from app.schemas.specs import SpecsRead, SpecsWrite
from app.security.rbac import RequireStaff
from app.services.erreurs import introuvable, modele_or_404
from app.services.specs import ecrire_specs, lire_specs

router = APIRouter(tags=["specs"])


async def _equipment_or_404(db: DbSession, equipment_id: int) -> Equipment:
    eq = await db.get(Equipment, equipment_id)
    if eq is None:
        raise introuvable("Équipement introuvable.")
    return eq


async def _ecrire(db: DbSession, cible: Modele | Equipment, payload: SpecsWrite) -> SpecsRead:
    await ecrire_specs(db, cible, payload)
    await db.commit()
    await db.refresh(cible)
    return await lire_specs(db, cible)


@router.get("/modeles/{modele_id}/specs", response_model=SpecsRead)
async def lire_specs_modele(modele_id: int, _user: CurrentUser, db: DbSession) -> SpecsRead:
    return await lire_specs(db, await modele_or_404(db, modele_id))


@router.put("/modeles/{modele_id}/specs", response_model=SpecsRead)
async def ecrire_specs_modele(
    modele_id: int, payload: SpecsWrite, _user: RequireStaff, db: DbSession
) -> SpecsRead:
    return await _ecrire(db, await modele_or_404(db, modele_id), payload)


@router.get("/equipments/{equipment_id}/specs", response_model=SpecsRead)
async def lire_specs_equipment(equipment_id: int, _user: CurrentUser, db: DbSession) -> SpecsRead:
    return await lire_specs(db, await _equipment_or_404(db, equipment_id))


@router.put("/equipments/{equipment_id}/specs", response_model=SpecsRead)
async def ecrire_specs_equipment(
    equipment_id: int, payload: SpecsWrite, _user: RequireStaff, db: DbSession
) -> SpecsRead:
    return await _ecrire(db, await _equipment_or_404(db, equipment_id), payload)
