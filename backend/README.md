# BPM Log — Backend (FastAPI)

API offline-first de gestion du parc matériel BPM.
Stack : FastAPI · SQLAlchemy 2 async · asyncpg · PostgreSQL 16 · Alembic · JWT.

## Prérequis

- Python 3.12+
- PostgreSQL 16 (via Docker Compose à la racine du monorepo)

## Installation (dev local)

```bash
# Depuis la racine du monorepo
cp .env.example .env

# Backend
cd backend
python -m venv ../.venv
../.venv/bin/pip install -e ".[dev]"
```

## Base de données

Démarrer PostgreSQL (depuis la racine `bpm-log/`) :

```bash
docker compose up -d db
```

> Si `docker` refuse la connexion : ajoute ton utilisateur au groupe docker
> (`sudo usermod -aG docker $USER` puis reconnexion) ou utilise `sudo docker`.

Appliquer les migrations :

```bash
cd backend
../.venv/bin/python -m alembic upgrade head
```

Créer un premier administrateur :

```bash
../.venv/bin/python -m app.seed --email admin@bpm.example --password "change-moi"
```

## Lancer l'API

```bash
../.venv/bin/uvicorn app.main:app --reload
```

- API : http://localhost:8000
- Swagger (si `DEBUG=true`) : http://localhost:8000/docs
- Health : http://localhost:8000/health et /health/db

## Migrations

```bash
# Générer une migration après modification des modèles (DB requise)
../.venv/bin/python -m alembic revision --autogenerate -m "description"

# Appliquer
../.venv/bin/python -m alembic upgrade head

# Prévisualiser le SQL sans DB
../.venv/bin/python -m alembic upgrade head --sql
```

## Structure

```text
app/
  main.py          # App FastAPI, CORS, routers, health
  config.py        # Settings (pydantic-settings)
  database.py      # Engine + session async
  deps.py          # Dépendances (DB, current_user)
  seed.py          # Création admin initial
  models/          # Modèles ORM + enums
  schemas/         # Schémas Pydantic
  routers/         # Routes (auth, ...)
  security/        # passwords (argon2), jwt, rbac
alembic/           # Migrations
```
