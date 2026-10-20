"""Référentiel des spécifications techniques : catégories (en arbre), champs de
spécification et connecteurs. Lecture pour tous, écriture Admin+Staff.

Une catégorie hérite des champs de tous ses ancêtres : un nom de champ est donc unique
sur toute une lignée (ancêtres et descendants), sans quoi la fiche d'un modèle aurait
deux champs homonymes.

Supprimer un champ ou un connecteur est toujours permis et supprime en cascade ses
valeurs / connectiques (l'UI demande confirmation avec le nombre d'usages).
"""

from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession
from app.models import (
    Categorie,
    ChampSpecification,
    Connecteur,
    Connectique,
    Equipment,
    Modele,
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
)
from app.security.rbac import RequireStaff
from app.services.categories import chemin, ids_descendants, lignee, verifier_parent
from app.services.erreurs import conflit, introuvable, invalide

router = APIRouter(tags=["referentiel"])


async def _compter(db: DbSession, stmt) -> int:
    return await db.scalar(stmt) or 0


def _ids_ancetres(categorie_id: int):
    """Sous-requête : la catégorie et tous ses ancêtres."""
    return select(lignee.c.ancetre_id).where(lignee.c.categorie_id == categorie_id)


# --- Catégories -------------------------------------------------------------


async def _categorie_or_404(db: DbSession, categorie_id: int) -> Categorie:
    cat = await db.get(Categorie, categorie_id)
    if cat is None:
        raise introuvable("Catégorie introuvable.")
    return cat


async def _read_categorie(db: DbSession, cat: Categorie) -> CategorieRead:
    return CategorieRead(
        id=cat.id,
        nom=cat.nom,
        description=cat.description,
        parent_id=cat.parent_id,
        chemin=await chemin(db, cat.id),
    )


async def _verifier_nom_categorie(
    db: DbSession, nom: str, parent_id: int | None, categorie_id: int | None
) -> None:
    """Le nom est unique entre catégories sœurs (même parent)."""
    existing = await db.scalar(
        select(Categorie).where(
            Categorie.nom == nom, Categorie.parent_id.is_not_distinct_from(parent_id)
        )
    )
    if existing is not None and existing.id != categorie_id:
        ou = "à la racine" if parent_id is None else "dans cette catégorie"
        raise conflit(f"La catégorie « {nom} » existe déjà {ou}.")


async def _verifier_heritage_deplacement(
    db: DbSession, categorie_id: int, parent_id: int | None
) -> None:
    """En changeant de parent, la catégorie et ses descendantes héritent de nouveaux
    champs : refusé si l'un porte le nom d'un champ du sous-arbre."""
    if parent_id is None:
        return
    herites = set(
        (
            await db.scalars(
                select(ChampSpecification.nom).where(
                    ChampSpecification.categorie_id.in_(_ids_ancetres(parent_id))
                )
            )
        ).all()
    )
    propres = set(
        (
            await db.scalars(
                select(ChampSpecification.nom).where(
                    ChampSpecification.categorie_id.in_(ids_descendants(categorie_id))
                )
            )
        ).all()
    )
    if doublons := sorted(herites & propres):
        raise conflit(
            f"Champ(s) déjà défini(s) dans la nouvelle catégorie parente : {', '.join(doublons)}."
        )


@router.get("/categories/{categorie_id}", response_model=CategorieRead)
async def get_categorie(categorie_id: int, _user: CurrentUser, db: DbSession) -> CategorieRead:
    return await _read_categorie(db, await _categorie_or_404(db, categorie_id))


@router.post("/categories", response_model=CategorieRead, status_code=status.HTTP_201_CREATED)
async def create_categorie(
    payload: CategorieCreate, _user: RequireStaff, db: DbSession
) -> CategorieRead:
    await verifier_parent(db, None, payload.parent_id)
    await _verifier_nom_categorie(db, payload.nom, payload.parent_id, None)
    cat = Categorie(
        nom=payload.nom,
        description=(payload.description or "").strip() or None,
        parent_id=payload.parent_id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return await _read_categorie(db, cat)


@router.patch("/categories/{categorie_id}", response_model=CategorieRead)
async def update_categorie(
    categorie_id: int, payload: CategorieUpdate, _user: RequireStaff, db: DbSession
) -> CategorieRead:
    cat = await _categorie_or_404(db, categorie_id)
    fournis = payload.model_fields_set
    parent_id = payload.parent_id if "parent_id" in fournis else cat.parent_id
    if parent_id != cat.parent_id:
        await verifier_parent(db, cat.id, parent_id)
        await _verifier_heritage_deplacement(db, cat.id, parent_id)
    nom = payload.nom if payload.nom is not None else cat.nom
    await _verifier_nom_categorie(db, nom, parent_id, cat.id)
    cat.nom = nom
    cat.parent_id = parent_id
    if "description" in fournis:
        cat.description = (payload.description or "").strip() or None
    await db.commit()
    await db.refresh(cat)
    return await _read_categorie(db, cat)


@router.delete("/categories/{categorie_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_categorie(categorie_id: int, _user: RequireStaff, db: DbSession) -> None:
    cat = await _categorie_or_404(db, categorie_id)
    utilisations = {
        "sous-catégorie": select(func.count())
        .select_from(Categorie)
        .where(Categorie.parent_id == cat.id),
        "modèle": select(func.count()).select_from(Modele).where(Modele.categorie_id == cat.id),
        "équipement": select(func.count())
        .select_from(Equipment)
        .where(Equipment.categorie_id == cat.id),
        "champ": select(func.count())
        .select_from(ChampSpecification)
        .where(ChampSpecification.categorie_id == cat.id),
    }
    for libelle, stmt in utilisations.items():
        if nb := await _compter(db, stmt):
            raise conflit(
                f"Catégorie utilisée par {nb} {libelle}{'s' if nb > 1 else ''} : "
                "détache-les avant de la supprimer."
            )
    await db.delete(cat)
    await db.commit()


# --- Champs de spécification ------------------------------------------------


async def _champ_or_404(db: DbSession, champ_id: int) -> ChampSpecification:
    champ = await db.get(ChampSpecification, champ_id)
    if champ is None:
        raise introuvable("Champ introuvable.")
    return champ


async def _nb_valeurs(db: DbSession, champ_id: int) -> int:
    return await _compter(
        db,
        select(func.count())
        .select_from(ValeurSpecification)
        .where(ValeurSpecification.champ_id == champ_id),
    )


async def _read_champ(
    db: DbSession, champ: ChampSpecification, herite: bool = False
) -> ChampSpecRead:
    categorie = await db.get(Categorie, champ.categorie_id)
    return ChampSpecRead(
        id=champ.id,
        nom=champ.nom,
        type=champ.type,
        unite=champ.unite,
        options=list(champ.options or []),
        categorie_id=champ.categorie_id,
        categorie_nom=categorie.nom if categorie else "",
        herite=herite,
        ordre=champ.ordre,
        nb_valeurs=await _nb_valeurs(db, champ.id),
    )


async def _verifier_nom_champ(
    db: DbSession, nom: str, categorie_id: int, champ_id: int | None
) -> None:
    """Unicité du nom sur la lignée : ancêtres (champs hérités) et descendants (qui
    hériteraient de celui-ci)."""
    lignee_ids = _ids_ancetres(categorie_id).union(ids_descendants(categorie_id))
    existing = await db.scalar(
        select(ChampSpecification).where(
            ChampSpecification.nom == nom,
            ChampSpecification.categorie_id.in_(lignee_ids),
            ChampSpecification.id != (champ_id or 0),
        )
    )
    if existing is not None:
        categorie = await db.get(Categorie, existing.categorie_id)
        raise conflit(
            f"Le champ « {nom} » existe déjà dans la lignée (catégorie « {categorie.nom} »)."
        )


def _verifier_options(type_: TypeChampSpec, options: list[str]) -> list[str]:
    if type_ != TypeChampSpec.CHOIX:
        return []
    if not options:
        raise invalide("Un champ à choix demande au moins une option.")
    return options


@router.get("/champs-specification", response_model=list[ChampSpecRead])
async def list_champs(
    _user: CurrentUser,
    db: DbSession,
    categorie_id: int | None = Query(default=None),
    herites: Annotated[bool, Query(description="Ajoute les champs des ancêtres")] = False,
) -> list[ChampSpecRead]:
    """Champs d'une catégorie (ou de toutes). Avec `herites`, ceux de ses ancêtres
    aussi, les plus généraux d'abord."""
    if categorie_id is not None and herites:
        stmt = (
            select(ChampSpecification, lignee.c.distance)
            .join(lignee, lignee.c.ancetre_id == ChampSpecification.categorie_id)
            .where(lignee.c.categorie_id == categorie_id)
            .order_by(
                lignee.c.distance.desc(),
                ChampSpecification.ordre,
                ChampSpecification.nom,
                ChampSpecification.id,
            )
        )
        return [await _read_champ(db, c, d > 0) for c, d in (await db.execute(stmt)).all()]
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
    await _categorie_or_404(db, payload.categorie_id)
    await _verifier_nom_champ(db, payload.nom, payload.categorie_id, None)
    champ = ChampSpecification(
        nom=payload.nom,
        type=payload.type,
        unite=(payload.unite or "").strip() or None,
        options=_verifier_options(payload.type, payload.options),
        categorie_id=payload.categorie_id,
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
        raise conflit(
            f"Le type ne peut pas changer : {nb_valeurs} valeur{'s' if nb_valeurs > 1 else ''} "
            "déjà saisie" + ("s." if nb_valeurs > 1 else ".")
        )

    categorie_id = payload.categorie_id if payload.categorie_id is not None else champ.categorie_id
    if categorie_id != champ.categorie_id:
        await _categorie_or_404(db, categorie_id)
    nom = payload.nom if payload.nom is not None else champ.nom
    if (nom, categorie_id) != (champ.nom, champ.categorie_id):
        await _verifier_nom_champ(db, nom, categorie_id, champ.id)

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
            raise conflit(f"L'option « {valeur} » est encore utilisée par des valeurs.")

    champ.nom = nom
    if "unite" in fournis:
        champ.unite = (payload.unite or "").strip() or None
    if payload.ordre is not None:
        champ.ordre = payload.ordre
    champ.type = type_
    champ.options = options
    champ.categorie_id = categorie_id
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
        raise introuvable("Connecteur introuvable.")
    return connecteur


async def _verifier_nom_connecteur(db: DbSession, nom: str, connecteur_id: int | None) -> None:
    existing = await db.scalar(select(Connecteur).where(Connecteur.nom == nom))
    if existing is not None and existing.id != connecteur_id:
        raise conflit(f"Le connecteur « {nom} » existe déjà.")


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
