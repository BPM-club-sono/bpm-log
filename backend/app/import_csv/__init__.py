"""Import de l'inventaire CSV historique dans BPM Log, via l'API REST.

Usage (depuis `backend/`) :

    # dev : simulation (par défaut), n'écrit rien
    ../.venv/bin/python -m app.import_csv --api http://localhost:8000/api
    # prod : écriture réelle, après le rapport de simulation et une confirmation
    ../.venv/bin/python -m app.import_csv --api https://<domaine>/api --apply

Options : `--dossier PATH` (défaut `assets/sheet-log/clean`), `--yes` (sans confirmation).

Obtenir le jeton : se connecter à l'application dans le navigateur, ouvrir les devtools,
Application -> Local Storage -> clé `oidc.user:<issuer>:<client_id>` -> champ `id_token`,
puis `export BPM_TOKEN=<id_token>` (le compte doit être Staff ou Admin).

Le jeton expire vite : si l'API répond 401, ré-exporte-le et relance. Rejouer est sans
risque : ce qui existe déjà n'est pas recréé, et rien n'est jamais supprimé.

Tout passe par les mêmes routes que l'interface : mêmes validations, mêmes règles
métier. Le rejeu ne touche jamais aux valeurs de spécification saisies dans l'application.
"""
