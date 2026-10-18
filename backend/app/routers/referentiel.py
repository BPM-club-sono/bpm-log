"""Référentiel des spécifications techniques : catégories, sous-catégories, champs
de spécification et connecteurs. Lecture pour tous, écriture Admin+Staff.

Supprimer un champ ou un connecteur est toujours permis et supprime en cascade ses
valeurs / connectiques (l'UI demande confirmation avec le nombre d'usages).
"""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession
from app.models import (
    Categorie,
    ChampSpecification,
    Connecteur,
    Connectique,
    Equipment,
    Modele,
    SousCategorie,
    ValeurSpecification,
)
from app.models.enums import TypeChampSpec
from app.schemas.equipment import CategorieRead
from app.schemas.specs import (
    CategorieCreate,
    CategorieUpdate,
    ChampSpecCreate,
    ChampSpecRead,
    ChampSpecUpdate,
    ConnecteurCreate,
    ConnecteurRead,
    ConnecteurUpdate,
    SousCategorieCreate,
    SousCategorieRead,
    SousCategorieUpdate,
)
from app.security.rbac import RequireStaff

router = APIRouter(tags=["referentiel"])


def _conflit(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _introuvable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _invalide(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def _compter(db: DbSession, stmt) -> int:
    return await db.scalar(stmt) or 0


# --- Catégories -------------------------------------------------------------


async def _categorie_or_404(db: DbSession, categorie_id: int) -> Categorie:
    cat = await db.get(Categorie, categorie_id)
    if cat is None:
        raise _introuvable("Catégorie introuvable.")
    return cat


async def _verifier_nom_categorie(db: DbSession, nom: str, categorie_id: int | None) -> None:
    existing = await db.scalar(select(Categorie).where(Categorie.nom == nom))
    if existing is not None and existing.id != categorie_id:
        raise _conflit(f"La catégorie « {nom} » existe déjà.")


@router.post("/categories", response_model=CategorieRead, status_code=status.HTTP_201_CREATED)
async def create_categorie(
    payload: CategorieCreate, _user: RequireStaff, db: DbSession
) -> Categorie:
    await _verifier_nom_categorie(db, payload.nom, None)
    cat = Categorie(nom=payload.nom, description=(payload.description or "").strip() or None)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.patch("/categories/{categorie_id}", response_model=CategorieRead)
async def update_categorie(
    categorie_id: int, payload: CategorieUpdate, _user: RequireStaff, db: DbSession
) -> Categorie:
    cat = await _categorie_or_404(db, categorie_id)
    if payload.nom is not None:
        await _verifier_nom_categorie(db, payload.nom, cat.id)
        cat.nom = payload.nom
    if "description" in payload.model_fields_set:
        cat.description = (payload.description or "").strip() or None
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{categorie_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_categorie(categorie_id: int, _user: RequireStaff, db: DbSession) -> None:
    cat = await _categorie_or_404(db, categorie_id)
    utilisations = {
        "modèle": select(func.count()).select_from(Modele).where(Modele.categorie_id == cat.id),
        "équipement": select(func.count())
        .select_from(Equipment)
        .where(Equipment.categorie_id == cat.id),
        "sous-catégorie": select(func.count())
        .select_from(SousCategorie)
        .where(SousCategorie.categorie_id == cat.id),
        "champ": select(func.count())
        .select_from(ChampSpecification)
        .where(ChampSpecification.categorie_id == cat.id),
    }
    for libelle, stmt in utilisations.items():
        if nb := await _compter(db, stmt):
            raise _conflit(
                f"Catégorie utilisée par {nb} {libelle}{'s' if nb > 1 else ''} : "
                "détache-les avant de la supprimer."
            )
    await db.delete(cat)
    await db.commit()


# --- Sous-catégories --------------------------------------------------------


async def _sous_categorie_or_404(db: DbSession, sous_categorie_id: int) -> SousCategorie:
    sc = await db.get(SousCategorie, sous_categorie_id)
    if sc is None:
        raise _introuvable("Sous-catégorie introuvable.")
    return sc


async def _nb_usages_sous_categorie(db: DbSession, sous_categorie_id: int) -> int:
    nb_modeles = await _compter(
        db,
        select(func.count())
        .select_from(Modele)
        .where(Modele.sous_categorie_id == sous_categorie_id),
    )
    nb_equipements = await _compter(
        db,
        select(func.count())
        .select_from(Equipment)
        .where(Equipment.sous_categorie_id == sous_categorie_id),
    )
    return nb_modeles + nb_equipements


async def _verifier_nom_sous_categorie(
    db: DbSession, nom: str, categorie_id: int, sous_categorie_id: int | None
) -> None:
    existing = await db.scalar(
        select(SousCategorie).where(
            SousCategorie.categorie_id == categorie_id, SousCategorie.nom == nom
        )
    )
    if existing is not None and existing.id != sous_categorie_id:
        raise _conflit(f"La sous-catégorie « {nom} » existe déjà dans cette catégorie.")


async def _read_sous_categorie(db: DbSession, sc: SousCategorie) -> SousCategorieRead:
    return SousCategorieRead(
        id=sc.id,
        nom=sc.nom,
        categorie_id=sc.categorie_id,
        nb_utilisations=await _nb_usages_sous_categorie(db, sc.id),
    )


@router.get("/sous-categories", response_model=list[SousCategorieRead])
async def list_sous_categories(
    _user: CurrentUser, db: DbSession, categorie_id: int | None = Query(default=None)
) -> list[SousCategorieRead]:
    stmt = select(SousCategorie).order_by(SousCategorie.nom)
    if categorie_id is not None:
        stmt = stmt.where(SousCategorie.categorie_id == categorie_id)
    return [await _read_sous_categorie(db, sc) for sc in (await db.scalars(stmt)).all()]


@router.post(
    "/sous-categories", response_model=SousCategorieRead, status_code=status.HTTP_201_CREATED
)
async def create_sous_categorie(
    payload: SousCategorieCreate, _user: RequireStaff, db: DbSession
) -> SousCategorieRead:
    await _categorie_or_404(db, payload.categorie_id)
    await _verifier_nom_sous_categorie(db, payload.nom, payload.categorie_id, None)
    sc = SousCategorie(nom=payload.nom, categorie_id=payload.categorie_id)
    db.add(sc)
    await db.commit()
    await db.refresh(sc)
    return await _read_sous_categorie(db, sc)


@router.patch("/sous-categories/{sous_categorie_id}", response_model=SousCategorieRead)
async def update_sous_categorie(
    sous_categorie_id: int, payload: SousCategorieUpdate, _user: RequireStaff, db: DbSession
) -> SousCategorieRead:
    sc = await _sous_categorie_or_404(db, sous_categorie_id)
    await _verifier_nom_sous_categorie(db, payload.nom, sc.categorie_id, sc.id)
    sc.nom = payload.nom
    await db.commit()
    await db.refresh(sc)
    return await _read_sous_categorie(db, sc)


@router.delete("/sous-categories/{sous_categorie_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sous_categorie(sous_categorie_id: int, _user: RequireStaff, db: DbSession) -> None:
    sc = await _sous_categorie_or_404(db, sous_categorie_id)
    if nb := await _nb_usages_sous_categorie(db, sc.id):
        raise _conflit(
            f"Sous-catégorie utilisée par {nb} modèle{'s' if nb > 1 else ''} / équipement"
            f"{'s' if nb > 1 else ''} : détache-les avant de la supprimer."
        )
    if await _compter(
        db,
        select(func.count())
        .select_from(ChampSpecification)
        .where(ChampSpecification.sous_categorie_id == sc.id),
    ):
        raise _conflit("Des champs de spécification sont restreints à cette sous-catégorie.")
    await db.delete(sc)
    await db.commit()


# --- Champs de spécification ------------------------------------------------


async def _champ_or_404(db: DbSession, champ_id: int) -> ChampSpecification:
    champ = await db.get(ChampSpecification, champ_id)
    if champ is None:
        raise _introuvable("Champ introuvable.")
    return champ


async def _nb_valeurs(db: DbSession, champ_id: int) -> int:
    return await _compter(
        db,
        select(func.count())
        .select_from(ValeurSpecification)
        .where(ValeurSpecification.champ_id == champ_id),
    )


async def _read_champ(db: DbSession, champ: ChampSpecification) -> ChampSpecRead:
    return ChampSpecRead(
        id=champ.id,
        nom=champ.nom,
        type=champ.type,
        unite=champ.unite,
        options=list(champ.options or []),
        categorie_id=champ.categorie_id,
        sous_categorie_id=champ.sous_categorie_id,
        ordre=champ.ordre,
        nb_valeurs=await _nb_valeurs(db, champ.id),
    )


async def _verifier_portee(db: DbSession, categorie_id: int, sous_categorie_id: int | None) -> None:
    await _categorie_or_404(db, categorie_id)
    if sous_categorie_id is None:
        return
    sc = await _sous_categorie_or_404(db, sous_categorie_id)
    if sc.categorie_id != categorie_id:
        raise _invalide("La sous-catégorie n'appartient pas à la catégorie du champ.")


def _verifier_options(type_: TypeChampSpec, options: list[str]) -> list[str]:
    if type_ != TypeChampSpec.CHOIX:
        return []
    if not options:
        raise _invalide("Un champ à choix demande au moins une option.")
    return options


@router.get("/champs-specification", response_model=list[ChampSpecRead])
async def list_champs(
    _user: CurrentUser, db: DbSession, categorie_id: int | None = Query(default=None)
) -> list[ChampSpecRead]:
    stmt = select(ChampSpecification).order_by(
        ChampSpecification.ordre, ChampSpecification.nom, ChampSpecification.id
    )
    if categorie_id is not None:
        stmt = stmt.where(ChampSpecification.categorie_id == categorie_id)
    return [await _read_champ(db, c) for c in (await db.scalars(stmt)).all()]


@router.post(
    "/champs-specification", response_model=ChampSpecRead, status_code=status.HTTP_201_CREATED
)
async def create_champ(
    payload: ChampSpecCreate, _user: RequireStaff, db: DbSession
) -> ChampSpecRead:
    await _verifier_portee(db, payload.categorie_id, payload.sous_categorie_id)
    champ = ChampSpecification(
        nom=payload.nom,
        type=payload.type,
        unite=(payload.unite or "").strip() or None,
        options=_verifier_options(payload.type, payload.options),
        categorie_id=payload.categorie_id,
        sous_categorie_id=payload.sous_categorie_id,
        ordre=payload.ordre,
    )
    db.add(champ)
    await db.commit()
    await db.refresh(champ)
    return await _read_champ(db, champ)


@router.patch("/champs-specification/{champ_id}", response_model=ChampSpecRead)
async def update_champ(
    champ_id: int, payload: ChampSpecUpdate, _user: RequireStaff, db: DbSession
) -> ChampSpecRead:
    champ = await _champ_or_404(db, champ_id)
    fournis = payload.model_fields_set
    nb_valeurs = await _nb_valeurs(db, champ.id)

    type_ = payload.type if payload.type is not None else champ.type
    if type_ != champ.type and nb_valeurs:
        raise _conflit(
            f"Le type ne peut pas changer : {nb_valeurs} valeur{'s' if nb_valeurs > 1 else ''} "
            "déjà saisie" + ("s." if nb_valeurs > 1 else ".")
        )

    categorie_id = payload.categorie_id if payload.categorie_id is not None else champ.categorie_id
    sous_categorie_id = (
        payload.sous_categorie_id if "sous_categorie_id" in fournis else champ.sous_categorie_id
    )
    if categorie_id != champ.categorie_id and "sous_categorie_id" not in fournis:
        sous_categorie_id = None
    await _verifier_portee(db, categorie_id, sous_categorie_id)

    options = payload.options if payload.options is not None else list(champ.options or [])
    options = _verifier_options(type_, options)
    if type_ == TypeChampSpec.CHOIX:
        utilisees = (
            await db.scalars(
                select(ValeurSpecification.valeur)
                .where(ValeurSpecification.champ_id == champ.id)
                .distinct()
            )
        ).all()
        for valeur in sorted(set(utilisees) - set(options)):
            raise _conflit(f"L'option « {valeur} » est encore utilisée par des valeurs.")

    if payload.nom is not None:
        champ.nom = payload.nom
    if "unite" in fournis:
        champ.unite = (payload.unite or "").strip() or None
    if payload.ordre is not None:
        champ.ordre = payload.ordre
    champ.type = type_
    champ.options = options
    champ.categorie_id = categorie_id
    champ.sous_categorie_id = sous_categorie_id
    await db.commit()
    await db.refresh(champ)
    return await _read_champ(db, champ)


@router.delete("/champs-specification/{champ_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_champ(champ_id: int, _user: RequireStaff, db: DbSession) -> None:
    champ = await _champ_or_404(db, champ_id)
    await db.delete(champ)  # les valeurs partent en cascade (FK ON DELETE CASCADE)
    await db.commit()


# --- Connecteurs ------------------------------------------------------------


async def _connecteur_or_404(db: DbSession, connecteur_id: int) -> Connecteur:
    connecteur = await db.get(Connecteur, connecteur_id)
    if connecteur is None:
        raise _introuvable("Connecteur introuvable.")
    return connecteur


async def _verifier_nom_connecteur(db: DbSession, nom: str, connecteur_id: int | None) -> None:
    existing = await db.scalar(select(Connecteur).where(Connecteur.nom == nom))
    if existing is not None and existing.id != connecteur_id:
        raise _conflit(f"Le connecteur « {nom} » existe déjà.")


async def _nb_usages_connecteur(db: DbSession, connecteur_id: int) -> int:
    """Modèles + équipements distincts qui portent ce connecteur."""
    nb_modeles = await _compter(
        db,
        select(func.count(func.distinct(Connectique.modele_id))).where(
            Connectique.connecteur_id == connecteur_id
        ),
    )
    nb_equipements = await _compter(
        db,
        select(func.count(func.distinct(Connectique.equipment_id))).where(
            Connectique.connecteur_id == connecteur_id
        ),
    )
    return nb_modeles + nb_equipements


async def _read_connecteur(db: DbSession, connecteur: Connecteur) -> ConnecteurRead:
    return ConnecteurRead(
        id=connecteur.id,
        nom=connecteur.nom,
        nb_utilisations=await _nb_usages_connecteur(db, connecteur.id),
    )


@router.get("/connecteurs", response_model=list[ConnecteurRead])
async def list_connecteurs(_user: CurrentUser, db: DbSession) -> list[ConnecteurRead]:
    rows = (await db.scalars(select(Connecteur).order_by(Connecteur.nom))).all()
    return [await _read_connecteur(db, c) for c in rows]


@router.post("/connecteurs", response_model=ConnecteurRead, status_code=status.HTTP_201_CREATED)
async def create_connecteur(
    payload: ConnecteurCreate, _user: RequireStaff, db: DbSession
) -> ConnecteurRead:
    await _verifier_nom_connecteur(db, payload.nom, None)
    connecteur = Connecteur(nom=payload.nom)
    db.add(connecteur)
    await db.commit()
    await db.refresh(connecteur)
    return await _read_connecteur(db, connecteur)


@router.patch("/connecteurs/{connecteur_id}", response_model=ConnecteurRead)
async def update_connecteur(
    connecteur_id: int, payload: ConnecteurUpdate, _user: RequireStaff, db: DbSession
) -> ConnecteurRead:
    connecteur = await _connecteur_or_404(db, connecteur_id)
    await _verifier_nom_connecteur(db, payload.nom, connecteur.id)
    connecteur.nom = payload.nom
    await db.commit()
    await db.refresh(connecteur)
    return await _read_connecteur(db, connecteur)


@router.delete("/connecteurs/{connecteur_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connecteur(connecteur_id: int, _user: RequireStaff, db: DbSession) -> None:
    connecteur = await _connecteur_or_404(db, connecteur_id)
    await db.delete(connecteur)  # les connectiques partent en cascade (FK ON DELETE CASCADE)
    await db.commit()
