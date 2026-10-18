# Création en série d'équipements et allocation unitaire

Date : 2026-10-18 · Branche de départ : `feat/modeles` (modèles d'équipement déjà en place)

## Pourquoi

Aujourd'hui, la modale « Ajouter du matériel (créer une fiche) » d'une prestation
crée **une seule fiche** puis l'alloue avec une « Quantité à allouer » N : six
lyres louées deviennent une fiche « MH » allouée `quantite = 6`. Une fiche ne
représente alors plus un objet physique, le pointage compte des « 3/6 » sur un
objet unique, et ça prête à confusion (une étiquette pour six objets, une panne
qui touche « la » fiche, etc.).

On normalise : **une fiche = un objet physique**, et une allocation d'un item
unitaire vaut toujours 1. Pour garder la rapidité de saisie (surtout pour la
location), le formulaire de création sait créer **N exemplaires d'un même
modèle** en un geste.

## Objectifs

1. Créer N équipements identiques (même modèle, même loueur, même rangement,
   même photo) en une seule action, depuis le Parc ou depuis une prestation.
2. Depuis une prestation, les N exemplaires créés sont alloués chacun une fois.
3. Interdire, côté serveur, une allocation de quantité > 1 sur un item unitaire.
4. Sur une prestation clôturée, archiver en un geste les locations rendues.

## Non-objectifs

- Vrac et consommables : inchangés (leur quantité garde tout son sens, y compris
  la « Quantité à allouer » dans la modale de prestation).
- Pas de rattrapage de données : en prod il n'existe pas d'allocation d'item
  unitaire avec quantité > 1 (confirmé). La migration n'en fait rien.
- Pas d'impression d'étiquettes proposée après création (les références sont
  générées, on imprime plus tard depuis le Parc si besoin).
- Pas d'archivage automatique : l'archivage des locations reste un geste.

## Anti-objectifs (échec même si « ça marche »)

- Une fiche qui représente plusieurs objets, de quelque façon que ce soit.
- Une création en série à moitié faite (3 fiches sur 6) après une erreur.
- Réutiliser le numéro d'un objet existant ou archivé (« MH 7 » doit rester
  « MH 7 » dans l'historique).
- Archiver une location perdue, cassée, en suspens, ou prévue sur une autre
  prestation à venir.

## Ce qui a été décidé

### Formulaire de création (même formulaire, partout)

- Le type **Standard** gagne un champ **« Nombre d'exemplaires »** (défaut 1,
  pas de maximum). Flight, vrac et consommable n'ont pas ce champ.
- **N = 1** : comportement actuel, le nom est utilisé tel quel.
- **N > 1** :
  - le champ « Nom » devient « Nom de base » ;
  - le champ « Code-barres personnalisé » est masqué (références auto) ;
  - un aperçu en direct affiche les noms qui seront créés : « créera MH 7 … MH 12 ».
- **Modèle** : obligatoire comme aujourd'hui (sauf location), choisi existant ou
  créé sur place (`ModeleField` existant).
- **Pré-remplissage** : choisir un modèle pré-remplit le nom (de base) avec le
  nom du modèle, éditable. *(Mon choix : seulement si le champ nom est encore
  vide, pour ne pas écraser une saisie.)*
- Champs **partagés** par les N exemplaires : modèle (donc catégorie), location
  externe + fournisseur + réf. devis, rangement (emplacement ou flight), photo,
  statut initial (Fonctionnel, comme aujourd'hui).
- Disponible dans la page Parc « Nouvel équipement » **et** dans la modale de
  prestation (même composant `EquipmentForm`).

### Nommage N > 1

- Noms = `« <base> <numéro> »`, numéros consécutifs qui **reprennent après le
  plus grand numéro existant** pour cette base.
- On compte **tous** les équipements, archivés compris, dont le nom est
  exactement `<base>` + espace + entier. Ex. existants « MH 1 » … « MH 6 » →
  création de 3 = « MH 7 », « MH 8 », « MH 9 ». Aucun existant → à partir de 1.
- Calcul côté serveur, dans la même transaction que la création (deux créations
  simultanées sur la même base ne doivent pas produire deux « MH 7 »).

### Création atomique

- Les N fiches sont créées en **une seule requête**, tout ou rien.
- Chaque fiche reçoit sa propre référence auto (préfixe du loueur pour une
  location, BPM sinon, règles actuelles de `references`).

### Photo

- Une photo choisie dans le formulaire s'applique aux N fiches. *(Mon choix :
  chaque fiche reçoit sa **propre copie** du fichier — la suppression de photo
  actuelle efface le fichier sur disque, un fichier partagé disparaîtrait pour
  les N.)*

### Après création

- **Depuis le Parc**, N > 1 : redirection vers le Parc filtré sur le modèle
  (`/inventaire?modele=<id>`) + toast « N équipements créés ». N = 1 : la fiche,
  comme aujourd'hui.
- **Depuis une prestation** : les N fiches sont allouées à la prestation, une
  allocation de quantité 1 chacune, puis la modale se ferme.
- *(Mon choix)* Depuis une prestation, **création, copies de la photo et
  allocations forment une seule transaction serveur** (une requête, photo
  comprise) : une coupure réseau ne laisse jamais 6 fiches dont 3 allouées ou
  sans photo. Même principe depuis le Parc (création + photo en une requête).

### Quantité d'allocation

- Pour un item unitaire (ni vrac ni consommable), le serveur **refuse** toute
  allocation de quantité > 1 (422), quel que soit le chemin (`POST
  /prestations/{id}/allocations`).
- Dans la modale de prestation, « Quantité à allouer » ne s'affiche plus que
  pour vrac et consommable.
- Les lignes d'allocation d'items unitaires n'affichent plus « Prévu N · sorti N
  · retourné N » mais un état simple. *(Mon choix : libellé « Planifié »,
  « Sorti », « Retourné » d'après le statut de l'allocation.)*

### Archivage en lot des locations rendues

- Bouton **« Archiver les locations rendues (N) »** dans l'onglet Détail d'une
  prestation **clôturée** (`Terminee`), visible seulement s'il y a au moins une
  location archivable. Staff et Admin.
- **Archivable** = équipement loué (`EquipmentLocation`), non archivé, dont
  l'allocation sur cette prestation est **sortie puis entièrement retournée** :
  quantité sortie ≥ 1 et retournée = sortie, et décision de clôture absente ou
  `retourne`. Perdu, cassé (`casse` : la clôture force retournée = sortie, c'est
  la décision qui fait foi) et en suspens restent actifs (à régler avec le loueur).
- Une location **jamais sortie** (sortie = 0) n'est pas archivable : elle n'a
  peut-être jamais été livrée, ou reste à rendre ; on l'archive à la main.
- *(Mon choix)* Une location dans un statut bloquant
  (`disponibilite.STATUTS_BLOQUES`, ex. panne déclarée pendant la prestation)
  n'est pas archivable non plus.
- Une location rendue mais **allouée à une autre prestation non clôturée** est
  ignorée ; le résultat le dit (« MH 8 gardé : prévu sur « Gala » »).
- **Flight loué** : archivé (avec son contenu, par la cascade actuelle)
  seulement si **tout son contenu** passe la même règle ; sinon le flight entier
  est gardé et listé dans le résultat. On ne casse jamais la règle « pas d'objet
  actif dans un flight archivé ».
- Confirmation avant d'agir, avec le nombre et le détail par loueur ; le
  résultat liste archivés et gardés (avec la raison).

## Contraintes

- Création et allocations restent **en ligne uniquement** (pas de passage par la
  file de synchronisation).
- Le code, les routes et l'UI sont en français, comme le reste du dépôt.
- Toute nouvelle règle d'allocation passe par `services/disponibilite.py` ou à
  côté, pas dupliquée.
- Tests : pytest pour les règles serveur (numérotation, atomicité, refus de
  quantité > 1, sélection des locations archivables) ; e2e Playwright pour la
  création en série depuis le Parc et depuis une prestation, et pour l'archivage
  en lot.

## Laissé au constructeur

- Forme exacte de l'API de création en série (multipart avec photo ; champ
  `nombre` sur `POST /equipments` ou route dédiée ; route sous la prestation
  pour créer + allouer) et de l'archivage en lot (route sous la prestation,
  réponse listant archivés et gardés).
- Façon de sérialiser le calcul des numéros (verrou consultatif sur la base de
  nom, ou autre).
- Mise en page de l'aperçu des noms et du bouton d'archivage.
- `MCD.dbml` : aucun changement de schéma attendu ; à mettre à jour seulement si
  la mise en œuvre en introduit un.
