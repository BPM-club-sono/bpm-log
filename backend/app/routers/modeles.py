"""Routes modèles d'équipement (MH-100, H30V-L250…). Lecture pour tous, création et
édition Admin+Staff, suppression Admin et seulement sans unité rattachée.

Le modèle fait foi pour la catégorie de ses unités : la changer la répercute.
"""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select, update

from app.deps import CurrentUser, DbSession
from app.models import Categorie, Equipment, Modele
from app.schemas.equipment import ModeleCreate, ModeleRead, ModeleUpdate
from app.security.rbac import RequireAdmin, RequireStaff

router = APIRouter(tags=["modeles"])


async def _get_or_404(db: DbSession, modele_id: int) -> Modele:
    modele = await db.get(Modele, modele_id)
    if modele is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modèle introuvable.")
    return modele


async def _verifier_nom(db: DbSession, nom: str, modele_id: int | None) -> None:
    existing = await db.scalar(select(Modele).where(Modele.nom == nom))
    if existing is not None and existing.id != modele_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Le modèle « {nom} » existe déjà.",
        )


async def _verifier_categorie(db: DbSession, categorie_id: int | None) -> None:
    if categorie_id is not None and await db.get(Categorie, categorie_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catégorie introuvable."
        )


async def _read(db: DbSession, modele: Modele) -> ModeleRead:
    categorie = await db.get(Categorie, modele.categorie_id) if modele.categorie_id else None
    nb = await db.scalar(
        select(func.count()).select_from(Equipment).where(Equipment.modele_id == modele.id)
    )
    return ModeleRead(
        id=modele.id,
        nom=modele.nom,
        marque=modele.marque,
        categorie_id=modele.categorie_id,
        categorie_nom=categorie.nom if categorie else None,
        nb_unites=nb or 0,
    )


@router.get("/modeles", response_model=list[ModeleRead])
async def list_modeles(
    _user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, description="Recherche sur le nom ou la marque"),
) -> list[ModeleRead]:
    stmt = (
        select(Modele, Categorie.nom, func.count(Equipment.id))
        .outerjoin(Categorie, Categorie.id == Modele.categorie_id)
        .outerjoin(Equipment, Equipment.modele_id == Modele.id)
        .group_by(Modele.id, Categorie.nom)
        .order_by(Modele.nom)
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(Modele.nom.ilike(like) | Modele.marque.ilike(like))
    rows = await db.execute(stmt)
    return [
        ModeleRead(
            id=m.id,
            nom=m.nom,
            marque=m.marque,
            categorie_id=m.categorie_id,
            categorie_nom=cat_nom,
            nb_unites=nb,
        )
        for m, cat_nom, nb in rows.all()
    ]


@router.post("/modeles", response_model=ModeleRead, status_code=status.HTTP_201_CREATED)
async def create_modele(payload: ModeleCreate, _user: RequireStaff, db: DbSession) -> ModeleRead:
    await _verifier_nom(db, payload.nom, None)
    await _verifier_categorie(db, payload.categorie_id)
    modele = Modele(
        nom=payload.nom,
        marque=(payload.marque or "").strip() or None,
        categorie_id=payload.categorie_id,
    )
    db.add(modele)
    await db.commit()
    await db.refresh(modele)
    return await _read(db, modele)


@router.patch("/modeles/{modele_id}", response_model=ModeleRead)
async def update_modele(
    modele_id: int, payload: ModeleUpdate, _user: RequireStaff, db: DbSession
) -> ModeleRead:
    modele = await _get_or_404(db, modele_id)
    champs = payload.model_fields_set
    if payload.nom is not None:
        await _verifier_nom(db, payload.nom, modele.id)
        modele.nom = payload.nom
    if "marque" in champs:
        modele.marque = (payload.marque or "").strip() or None
    if "categorie_id" in champs and payload.categorie_id != modele.categorie_id:
        await _verifier_categorie(db, payload.categorie_id)
        modele.categorie_id = payload.categorie_id
        # Une sous-catégorie appartient à une catégorie. Les valeurs saisies restent
        # en base, masquées tant que leurs champs ne s'appliquent plus.
        modele.sous_categorie_id = None
        # Le modèle fait foi : toutes ses unités suivent.
        await db.execute(
            update(Equipment)
            .where(Equipment.modele_id == modele.id)
            .values(categorie_id=payload.categorie_id)
        )
    await db.commit()
    await db.refresh(modele)
    return await _read(db, modele)


@router.delete("/modeles/{modele_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modele(modele_id: int, _user: RequireAdmin, db: DbSession) -> None:
    modele = await _get_or_404(db, modele_id)
    nb = await db.scalar(
        select(func.count()).select_from(Equipment).where(Equipment.modele_id == modele.id)
    )
    if nb:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Modèle utilisé par {nb} équipement{'s' if nb > 1 else ''} : "
            "rattache-les à un autre modèle avant de le supprimer.",
        )
    await db.delete(modele)
    await db.commit()
