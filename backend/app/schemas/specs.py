"""Schémas du référentiel des spécifications techniques (catégories en arbre, champs,
connecteurs) et des spécifications d'un modèle ou d'un équipement."""

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
    parent_id: int | None = None


class CategorieUpdate(BaseModel):
    """Champs absents = inchangés ; `parent_id` à null = remonter à la racine."""

    nom: Nom | None = None
    description: str | None = None
    parent_id: int | None = None


class ChampSpecRead(BaseModel):
    id: int
    nom: str
    type: TypeChampSpec
    unite: str | None
    options: list[str]
    categorie_id: int
    categorie_nom: str
    # Défini sur un ancêtre de la catégorie demandée (liste avec `herites=true`).
    herite: bool = False
    ordre: int
    nb_valeurs: int = 0


class ChampSpecCreate(BaseModel):
    nom: Nom
    type: TypeChampSpec
    unite: Annotated[str | None, Field(max_length=20)] = None
    options: Options = []
    categorie_id: int
    ordre: int = 0


class ChampSpecUpdate(BaseModel):
    nom: Nom | None = None
    type: TypeChampSpec | None = None
    unite: Annotated[str | None, Field(max_length=20)] = None
    options: Options | None = None
    categorie_id: int | None = None
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

def _positif(maximum: float):
    """Borne haute = capacité de la colonne Numeric (sinon 500 à l'écriture)."""
    return Annotated[float | None, Field(ge=0, le=maximum, allow_inf_nan=False)]


#: Poids (kg), dimension (cm) ou prix (€) : jamais négatif, borné à la colonne.
Poids = _positif(999_999.99)  # Numeric(8,2)
Dimension = _positif(9_999_999.9)  # Numeric(8,1)
Prix = _positif(99_999_999.99)  # Numeric(10,2)


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
    # Catégorie (la cible ou l'un de ses ancêtres) qui définit le champ.
    categorie_id: int
    categorie_nom: str
    valeur: str | None


class SpecsRead(BaseModel):
    # « modele » : specs du modèle (lues aussi pour chacune de ses unités) ;
    # « equipement » : specs propres d'un item sans modèle.
    source: Literal["modele", "equipement"]
    modele_id: int | None
    categorie_id: int | None
    categorie_chemin: str | None
    poids: float | None
    longueur: float | None
    largeur: float | None
    hauteur: float | None
    prix_interne: float | None
    prix_externe: float | None
    valeurs: list[ValeurSpecRead]
    connectiques: list[ConnectiqueRead]


class SpecsWrite(BaseModel):
    """Remplace les champs fixes et toute la connectique ; pour `valeurs`, seules
    les clés fournies sont touchées (None ou blanc = effacer)."""

    poids: Poids = None
    longueur: Dimension = None
    largeur: Dimension = None
    hauteur: Dimension = None
    prix_interne: Prix = None
    prix_externe: Prix = None
    valeurs: dict[int, str | None] = {}
    connectiques: list[ConnectiqueIn] = []
