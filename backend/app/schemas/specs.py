"""Schémas du référentiel des spécifications techniques (catégories, sous-catégories,
champs, connecteurs) et des spécifications d'un modèle ou d'un équipement."""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field

from app.models.enums import SensConnectique, TypeChampSpec


def _strip(v):
    return v.strip() if isinstance(v, str) else v


def _options_propres(v):
    """Options rognées, sans blanc ni doublon (ordre conservé)."""
    if not isinstance(v, list):
        return v
    vues: list[str] = []
    for o in v:
        o = _strip(o)
        if isinstance(o, str) and o and o not in vues:
            vues.append(o)
    return vues


Nom = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]
NomConnecteur = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=80)]
Options = Annotated[list[str], BeforeValidator(_options_propres)]


class CategorieCreate(BaseModel):
    nom: Nom
    description: str | None = None


class CategorieUpdate(BaseModel):
    nom: Nom | None = None
    description: str | None = None


class SousCategorieRead(BaseModel):
    id: int
    nom: str
    categorie_id: int
    nb_utilisations: int = 0


class SousCategorieCreate(BaseModel):
    nom: Nom
    categorie_id: int


class SousCategorieUpdate(BaseModel):
    nom: Nom


class ChampSpecRead(BaseModel):
    id: int
    nom: str
    type: TypeChampSpec
    unite: str | None
    options: list[str]
    categorie_id: int
    sous_categorie_id: int | None
    ordre: int
    nb_valeurs: int = 0


class ChampSpecCreate(BaseModel):
    nom: Nom
    type: TypeChampSpec
    unite: Annotated[str | None, Field(max_length=20)] = None
    options: Options = []
    categorie_id: int
    sous_categorie_id: int | None = None
    ordre: int = 0


class ChampSpecUpdate(BaseModel):
    nom: Nom | None = None
    type: TypeChampSpec | None = None
    unite: Annotated[str | None, Field(max_length=20)] = None
    options: Options | None = None
    categorie_id: int | None = None
    sous_categorie_id: int | None = None
    ordre: int | None = None


class ConnecteurRead(BaseModel):
    id: int
    nom: str
    nb_utilisations: int = 0


class ConnecteurCreate(BaseModel):
    nom: NomConnecteur


class ConnecteurUpdate(BaseModel):
    nom: NomConnecteur


# --- Spécifications d'un modèle / d'un équipement sans modèle ---------------

#: Poids (kg), dimension (cm) ou prix (€) : jamais négatif.
Positif = Annotated[float | None, Field(ge=0)]


class ConnectiqueIn(BaseModel):
    connecteur_id: int
    sens: SensConnectique
    quantite: int = Field(ge=1)


class ConnectiqueRead(BaseModel):
    connecteur_id: int
    connecteur_nom: str
    sens: SensConnectique
    quantite: int


class ValeurSpecRead(BaseModel):
    champ_id: int
    nom: str
    type: TypeChampSpec
    unite: str | None
    options: list[str]
    valeur: str | None


class SpecsRead(BaseModel):
    # « modele » : specs du modèle (lues aussi pour chacune de ses unités) ;
    # « equipement » : specs propres d'un item sans modèle.
    source: Literal["modele", "equipement"]
    modele_id: int | None
    categorie_id: int | None
    sous_categorie_id: int | None
    sous_categorie_nom: str | None
    poids: float | None
    longueur: float | None
    largeur: float | None
    hauteur: float | None
    prix_interne: float | None
    prix_externe: float | None
    valeurs: list[ValeurSpecRead]
    connectiques: list[ConnectiqueRead]


class SpecsWrite(BaseModel):
    """Remplace les champs fixes, la sous-catégorie et toute la connectique ; pour
    `valeurs`, seules les clés fournies sont touchées (None ou blanc = effacer)."""

    sous_categorie_id: int | None = None
    poids: Positif = None
    longueur: Positif = None
    largeur: Positif = None
    hauteur: Positif = None
    prix_interne: Positif = None
    prix_externe: Positif = None
    valeurs: dict[int, str | None] = {}
    connectiques: list[ConnectiqueIn] = []
