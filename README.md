# BPM Log

Application web de gestion du parc matériel du **BPM**, club son et lumière.
Elle sert à scanner le matériel (QR / code-barres), suivre les tickets de panne,
préparer les prestations et tenir les stocks vrac et consommables.

C'est une **PWA offline-first** : les technicien·nes s'en servent sur téléphone,
souvent en régie ou en camion, sans réseau. Toute action faite hors ligne est
enregistrée localement puis rejouée sur le serveur au retour de la connexion.

## Comment ça marche

Le client n'écrit jamais l'état métier directement. Chaque modification faite sur
le terrain devient un **évènement** dans une file IndexedDB, rejoué ensuite par un
unique endpoint `POST /api/sync/batch`. Rien n'est perdu : un évènement est soit
appliqué, soit rendu au client comme conflit à arbitrer.

Les quantités sont stockées en **deltas**, jamais en valeurs absolues : un delta
est commutatif, donc un rejeu dans le désordre reste juste.

Le domaine est en français — modèles, routes, enums et interface.

## Stack

| | |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 async · PostgreSQL 16 · Alembic |
| Frontend | React 18 · TypeScript · Vite · Tailwind · Dexie (IndexedDB) · vite-plugin-pwa |
| Auth | OIDC via [authentik](docs/authentik-sso.md), lui-même adossé à Google |
| Déploiement | Docker Compose derrière le nginx de la VM, TLS certbot |

## Démarrer en local

```bash
cp .env.example .env          # renseigner au moins OIDC_CLIENT_ID et VITE_OIDC_CLIENT_ID
docker compose up -d          # db + adminer (:8081) + api (:8000) + frontend (:80)
```

Ou en développement, base dans Docker et serveurs en local :

```bash
docker compose up -d db

cd backend
../.venv/bin/pip install -e ".[dev]"
../.venv/bin/python -m alembic upgrade head
../.venv/bin/uvicorn app.main:app --reload        # http://localhost:8000

cd ../frontend
npm install
npm run dev                                        # http://localhost:5173
```

Le port **5173** n'est pas négociable en dev : c'est le seul `localhost` déclaré
dans les URI de redirection du provider authentik.

Premier administrateur (un compte inconnu est sinon provisionné en `Staff`) :

```bash
cd backend && ../.venv/bin/python -m app.seed --email prenom.nom@gmail.com
```

## Tests et qualité

```bash
cd backend  && ../.venv/bin/pytest        # PostgreSQL doit tourner
cd backend  && ../.venv/bin/ruff check .
cd frontend && npm run typecheck && npm run lint && npm run test
```

## Documentation

| Fichier | Contenu |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Architecture, commandes, invariants — le plus à jour |
| [MCD.dbml](MCD.dbml) | Schéma de données de référence |
| [docs/authentik-sso.md](docs/authentik-sso.md) | Configuration SSO et déploiement, côté VM |
| [docs/adr/](docs/adr/) | Décisions d'architecture |
| [docs/plan-initial.md](docs/plan-initial.md) | Plan d'origine (mai 2026), document historique |
