"""Spécifications techniques d'un modèle, ou d'un équipement sans modèle.

Une unité rattachée à un modèle n'a pas de specs propres : le modèle fait foi
(lecture des specs du modèle, écriture refusée). Les champs applicables sont ceux
de la catégorie et de tous ses ancêtres. Les valeurs des champs qui ne s'appliquent
plus (catégorie changée) restent en base mais ne sont plus renvoyées.
"""

import re

from sqlalchemy import delete, select

from app.deps import DbSession
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
from app.schemas.specs import ConnectiqueRead, SpecsRead, SpecsWrite, ValeurSpecRead
from app.services.categories import chemin, lignee
from app.services.erreurs import conflit, introuvable, invalide

_NOMBRE = re.compile(r"-?\d+(\.\d+)?")
_COLONNES = (
    "poids",
    "longueur",
    "largeur",
    "hauteur",
    "prix_interne",
    "prix_externe",
)


def _filtre_cible(table, cible: Modele | Equipment):
    """Lignes (valeurs, connectiques) de la cible : par modele_id OU equipment_id."""
    if isinstance(cible, Modele):
        return table.modele_id == cible.id
    return table.equipment_id == cible.id


async def _cible_effective(db: DbSession, cible: Modele | Equipment) -> Modele | Equipment:
    if isinstance(cible, Equipment) and cible.modele_id is not None:
        return await db.get(Modele, cible.modele_id)
    return cible


async def champs_applicables(
    db: DbSession, categorie_id: int | None
) -> list[tuple[ChampSpecification, str, int]]:
    """Champs de la catégorie et de tous ses ancêtres, avec le nom de la catégorie
    qui les définit et sa distance (0 = la catégorie elle-même). Les plus généraux
    d'abord : on lit la fiche de la racine vers la feuille."""
    if categorie_id is None:
        return []
    stmt = (
        select(ChampSpecification, Categorie.nom, lignee.c.distance)
        .join(lignee, lignee.c.ancetre_id == ChampSpecification.categorie_id)
        .join(Categorie, Categorie.id == ChampSpecification.categorie_id)
        .where(lignee.c.categorie_id == categorie_id)
        .order_by(
            lignee.c.distance.desc(),
            ChampSpecification.ordre,
            ChampSpecification.nom,
            ChampSpecification.id,
        )
    )
    return [(c, nom, distance) for c, nom, distance in (await db.execute(stmt)).all()]


async def lire_specs(db: DbSession, cible: Modele | Equipment) -> SpecsRead:
    """Specs effectives : celles du modèle pour une unité qui en a un."""
    cible = await _cible_effective(db, cible)
    champs = await champs_applicables(db, cible.categorie_id)
    valeurs = dict(
        (
            await db.execute(
                select(ValeurSpecification.champ_id, ValeurSpecification.valeur).where(
                    _filtre_cible(ValeurSpecification, cible)
                )
            )
        ).all()
    )
    connectiques = (
        await db.execute(
            select(Connectique, Connecteur.nom)
            .join(Connecteur, Connecteur.id == Connectique.connecteur_id)
            .where(_filtre_cible(Connectique, cible))
            .order_by(Connectique.sens, Connecteur.nom)
        )
    ).all()
    est_modele = isinstance(cible, Modele)
    return SpecsRead(
        source="modele" if est_modele else "equipement",
        modele_id=cible.id if est_modele else None,
        categorie_id=cible.categorie_id,
        categorie_chemin=await chemin(db, cible.categorie_id),
        poids=cible.poids,
        longueur=cible.longueur,
        largeur=cible.largeur,
        hauteur=cible.hauteur,
        prix_interne=cible.prix_interne,
        prix_externe=cible.prix_externe,
        valeurs=[
            ValeurSpecRead(
                champ_id=c.id,
                nom=c.nom,
                type=c.type,
                unite=c.unite,
                options=list(c.options or []),
                categorie_id=c.categorie_id,
                categorie_nom=categorie_nom,
                valeur=valeurs.get(c.id),
            )
            for c, categorie_nom, _distance in champs
        ],
        connectiques=[
            ConnectiqueRead(
                connecteur_id=c.connecteur_id, connecteur_nom=nom, sens=c.sens, quantite=c.quantite
            )
            for c, nom in connectiques
        ],
    )


def normaliser_valeur(champ: ChampSpecification, brut: str) -> str:
    """Valeur stockée pour `champ` ; 422 si elle ne respecte pas son type."""
    valeur = brut.strip()
    if champ.type == TypeChampSpec.NOMBRE:
        # Virgule décimale française acceptée, stockée avec un point.
        nombre = valeur.replace(",", ".")
        if not _NOMBRE.fullmatch(nombre):
            raise invalide(f"« {champ.nom} » attend un nombre (ex. 1,5).")
        return nombre
    if champ.type == TypeChampSpec.OUI_NON:
        if valeur not in ("true", "false"):
            raise invalide(f"« {champ.nom} » attend oui ou non.")
        return valeur
    if champ.type == TypeChampSpec.CHOIX:
        if valeur not in (champ.options or []):
            raise invalide(f"« {valeur} » n'est pas un choix proposé pour « {champ.nom} ».")
        return valeur
    return valeur


async def _valeurs_normalisees(
    db: DbSession, cible: Modele | Equipment, data: SpecsWrite
) -> dict[int, str | None]:
    """Valeurs fournies, validées et normalisées ; None = ligne à supprimer."""
    if not data.valeurs:
        return {}
    champs = {c.id: c for c, _nom, _distance in await champs_applicables(db, cible.categorie_id)}
    if hors_portee := sorted(set(data.valeurs) - set(champs)):
        raise invalide(f"Champ(s) non applicable(s) ici : {', '.join(map(str, hors_portee))}.")
    return {
        cid: normaliser_valeur(champs[cid], brut) if brut and brut.strip() else None
        for cid, brut in data.valeurs.items()
    }


async def _verifier_connectiques(db: DbSession, data: SpecsWrite) -> None:
    cles = [(c.connecteur_id, c.sens) for c in data.connectiques]
    if len(set(cles)) != len(cles):
        raise invalide("Un même connecteur est saisi deux fois dans le même sens.")
    ids = {c.connecteur_id for c in data.connectiques}
    connus = set((await db.scalars(select(Connecteur.id).where(Connecteur.id.in_(ids)))).all())
    if ids - connus:
        raise introuvable("Connecteur introuvable.")


def _cible_kw(cible: Modele | Equipment) -> dict[str, int]:
    return {"modele_id": cible.id} if isinstance(cible, Modele) else {"equipment_id": cible.id}


async def ecrire_specs(db: DbSession, cible: Modele | Equipment, data: SpecsWrite) -> None:
    """Écrit les specs de `cible` (sans commit). Tout est validé avant la moindre
    écriture. 409 sur une unité rattachée à un modèle."""
    if isinstance(cible, Equipment) and cible.modele_id is not None:
        raise conflit("Les spécifications se modifient sur le modèle.")
    valeurs = await _valeurs_normalisees(db, cible, data)
    await _verifier_connectiques(db, data)

    existantes = {
        v.champ_id: v
        for v in (
            await db.scalars(
                select(ValeurSpecification).where(
                    _filtre_cible(ValeurSpecification, cible),
                    ValeurSpecification.champ_id.in_(list(valeurs)),
                )
            )
        ).all()
    }
    for champ_id, valeur in valeurs.items():
        ligne = existantes.get(champ_id)
        if valeur is None:
            if ligne is not None:
                await db.delete(ligne)
        elif ligne is not None:
            ligne.valeur = valeur
        else:
            db.add(ValeurSpecification(champ_id=champ_id, valeur=valeur, **_cible_kw(cible)))

    # DELETE immédiat : dans un flush, l'ORM insère avant de supprimer, ce qui
    # heurterait l'unicité (connecteur, sens, cible) des lignes reprises telles quelles.
    await db.execute(delete(Connectique).where(_filtre_cible(Connectique, cible)))
    for c in data.connectiques:
        db.add(
            Connectique(
                connecteur_id=c.connecteur_id, sens=c.sens, quantite=c.quantite, **_cible_kw(cible)
            )
        )

    for colonne in _COLONNES:
        setattr(cible, colonne, getattr(data, colonne))
    await db.flush()


async def effacer_specs_propres(db: DbSession, eq: Equipment) -> None:
    """Efface les specs propres de `eq` (colonnes, valeurs, connectiques) : à
    appeler quand il prend un modèle, qui fait désormais foi."""
    for colonne in _COLONNES:
        setattr(eq, colonne, None)
    await db.execute(delete(ValeurSpecification).where(ValeurSpecification.equipment_id == eq.id))
    await db.execute(delete(Connectique).where(Connectique.equipment_id == eq.id))
