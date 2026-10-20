"""Erreurs HTTP et recherches par identifiant partagées entre routers et services."""

from fastapi import HTTPException, status

from app.deps import DbSession
from app.models import Modele, SousCategorie


def conflit(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def introuvable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def invalide(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def modele_or_404(db: DbSession, modele_id: int) -> Modele:
    modele = await db.get(Modele, modele_id)
    if modele is None:
        raise introuvable("Modèle introuvable.")
    return modele


async def sous_categorie_or_404(db: DbSession, sous_categorie_id: int) -> SousCategorie:
    sc = await db.get(SousCategorie, sous_categorie_id)
    if sc is None:
        raise introuvable("Sous-catégorie introuvable.")
    return sc
