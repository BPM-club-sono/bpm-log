"""Import de l'inventaire CSV historique dans BPM Log, via l'API REST.

Usage (depuis `backend/`) :

    # dev : simulation (par défaut), n'écrit rien
    ../.venv/bin/python -m app.import_csv --api http://localhost:8000/api
    # prod : écriture réelle, après le rapport de simulation et une confirmation
    ../.venv/bin/python -m app.import_csv --api https://<domaine>/api --apply

Options : `--dossier PATH` (défaut `assets/sheet-log/clean`), `--yes` (sans confirmation),
`--reappliquer-specs` (voir plus bas). `--api` doit finir par `/api` ; http:// n'est
accepté que vers localhost (sinon le jeton passerait en clair).

Obtenir le jeton : se connecter à l'application dans le navigateur, ouvrir les devtools,
Application -> Local Storage -> clé `oidc.user:<issuer>:<client_id>` -> champ `id_token`,
puis `export BPM_TOKEN=<id_token>` (le compte doit être Staff ou Admin).

Le jeton ne vit que 5 minutes. La commande lit son expiration et, s'il reste moins
d'une minute, s'arrête proprement entre deux modèles. Après cet arrêt, ou après un 401
ou une erreur réseau, ré-exporte BPM_TOKEN et relance la même commande : l'import
reprend où il s'est arrêté. Ce que fait un rejeu (rien n'est jamais supprimé) :

- ce qui existe déjà (catégories, sous-catégories, champs, connecteurs, modèles) n'est
  pas recréé ;
- un modèle partiel dont les unités sont exactement « <Nom> 1 » à « <Nom> k » est
  complété avec « <Nom> k+1 » à « <Nom> M » ; sinon il est signalé, à corriger à la main ;
- les tickets sont réparés : une unité prévue avec ticket qui n'en a pas en reçoit un,
  et l'avancement prévu (« En_cours » pour « En réparation ») est remis s'il diffère ;
- la catégorie, les specs fixes (poids, dimensions, prix) et la connectique d'un modèle
  ne sont écrites que tant que son import n'est pas terminé. Avec `--reappliquer-specs`
  (usage dev, après une correction du mapping), elles sont réécrites depuis le CSV pour
  tous les modèles : ce qui a été modifié dans l'application est écrasé.

Les valeurs des champs de spécification saisies dans l'application ne sont jamais
touchées. Tout passe par les mêmes routes que l'interface : mêmes validations, mêmes
règles métier.

Check-list prod (instance vide) :

1. recharger l'application dans le navigateur pour obtenir un jeton neuf, l'exporter ;
2. lancer d'abord une simulation (sans `--apply`) et lire le rapport ;
3. puis `--apply --yes` (re-exporter un jeton neuf juste avant) ;
4. en cas de problème sur la prod encore vide, la solution propre est de réinitialiser
   la base de prod et de recommencer.
"""
