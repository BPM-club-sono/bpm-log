# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BPM Log is an **offline-first PWA** for managing BPM's equipment inventory ("parc matériel"): scanning items via QR/barcode, tracking repair tickets ("pannes"), running event allocations ("prestations"), and bulk/consumable stock. Field technicians use it on phones, often without connectivity, so the offline sync engine is the architectural heart of the system.

Monorepo: `backend/` (FastAPI + PostgreSQL) and `frontend/` (React PWA). The domain language is **French** — models, enums, routes, comments, and UI are all in French. Match this when writing code.

## Commands

### Backend (run from `backend/`, venv lives at repo-root `.venv/`)

```bash
../.venv/bin/pip install -e ".[dev]"          # install with dev deps
../.venv/bin/uvicorn app.main:app --reload    # run API → http://localhost:8000 (Swagger at /docs only if DEBUG=true)
../.venv/bin/python -m alembic upgrade head    # apply migrations (DB must be up)
../.venv/bin/python -m alembic revision --autogenerate -m "msg"   # new migration after model change
../.venv/bin/python -m app.seed --email admin@bpm.example --password "x"   # create initial Admin
../.venv/bin/pytest                            # run tests
../.venv/bin/pytest tests/test_smoke.py::test_health_ok   # single test
../.venv/bin/ruff check .                       # lint (line-length 100, rules E/F/I/UP/B)
```

Tests require a reachable PostgreSQL at the `DATABASE_URL` (default `localhost:5432`). Start it with `docker compose up -d db` from the repo root. `conftest.py` sets `DEBUG=true` and a temp `PHOTOS_DIR` **before** importing the app — settings are `lru_cache`d at import, so env must be set first.

### Frontend (run from `frontend/`)

```bash
npm run dev         # Vite dev server → http://localhost:5173 (proxies /api → localhost:8000)
npm run build       # tsc -b + vite build (PWA service worker generated here)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run test:watch  # vitest watch
```

### Full stack via Docker (from repo root)

```bash
cp .env.example .env
docker compose up -d           # db + adminer (:8081) + api (:8000) + frontend (:80)
```

The API container runs migrations automatically on start (`backend/entrypoint.sh` → `alembic upgrade head`). `docker-compose.prod.yml` + `Caddyfile` are the production setup (Caddy reverse proxy, TLS).

### Stack par worktree (tests en parallèle)

Dans un worktree git, ne jamais utiliser `docker compose up` ni supposer les ports 5173/8000 (ils appartiennent au checkout principal). Chaque worktree a son stack isolé :

```bash
scripts/worktree-stack.sh up      # db+api docker isolés (ports dynamiques) + vite dev ; clone la DB de dev
scripts/worktree-stack.sh down    # détruit le stack du worktree courant (down --all : tous + orphelins)
scripts/worktree-stack.sh status  # liste les stacks actifs
```

`up` écrit **`.stack.json`** à la racine du worktree avec `front_url` / `api_url` : c'est là qu'il faut lire les URLs à tester. La DB du worktree est un clone de la DB de dev (`bpm_log_db` doit tourner), par-dessus lequel l'entrypoint applique les migrations du worktree ; elle est jetable (`down` la détruit).

## Architecture

### Offline-first sync — the core invariant

The client never writes domain state directly via REST. Instead, every mutation from the field is recorded as an **event** in an IndexedDB queue (Dexie, `frontend/src/lib/db.ts` → `sync_queue`) and replayed to the server through a single endpoint: `POST /api/sync/batch`.

- **Client** ([syncEngine.ts](frontend/src/lib/syncEngine.ts)): `enqueue(type, payload)` appends an event with a client-generated `uuid_client` and `offline_created_at`. A background flusher (online-event + 30s poll, exponential backoff to 5min) drains the queue in **chronological order**, batched (50). Nothing is ever lost: items are either `applied` (purged) or returned as `conflicts` (kept with `last_error` for user arbitration on the `/conflits` page). Ticket photos are stored as blobs and uploaded separately *after* their ticket syncs.
- **Server** ([sync.py](backend/app/routers/sync.py)): replays each event in `offline_created_at` order, each inside a `begin_nested()` savepoint so one bad item doesn't poison the batch. **Idempotency** is keyed on `uuid_client` — every handler first checks whether a row with that uuid already exists (in `logs_scans` or the target table) and returns early on replay. A business-rule failure raises `_Conflict` (returned to client); any other exception is caught and also returned as a conflict — an item is *never* silently dropped.

Event types (`SyncItemType`): `ticket_reparation`, `log_scan`, `presta_check`, `vrac_delta`, `conso_delta`, each with a handler in `_HANDLERS`.

**Design rule for stock/quantities: store deltas, not absolutes.** Bulk-bin ("vrac") inventory is `quantite_theorique + Σ deltas` (append-only `InventaireVrac` rows); consumable stock applies bounded deltas. Deltas are commutative, so out-of-order offline replay is always correct. Preserve this — don't introduce absolute-value writes for quantities synced offline.

When adding a new offline action: add the type to `SyncItemType` (db.ts), write an idempotent `_apply_*` handler keyed on `uuid_client`, and register it in `_HANDLERS`.

### Backend layout (`backend/app/`)

`main.py` (app, CORS, router wiring, `/health`, static photo mount at `/api/photos`, scheduler lifespan) · `config.py` (pydantic-settings, env-driven) · `database.py` (async engine/session) · `deps.py` (`DbSession`, `CurrentUser`) · `models/` (SQLAlchemy 2 async ORM in `db_models.py`, business enums in `enums.py` mirroring PG ENUMs) · `schemas/` (Pydantic I/O) · `routers/` (one per domain) · `security/` (argon2 passwords, JWT, RBAC) · `services/` (web-push, APScheduler) · `alembic/versions/` (hand-maintained migrations).

- **Auth**: JWT access (30min) + refresh (30d). `CurrentUser` decodes the bearer token, loads the `Membre`, and checks the linked `UserAuth.is_active`. Also supports WebAuthn (passkeys) via `routers/webauthn.py`.
- **RBAC** ([rbac.py](backend/app/security/rbac.py)): `require_role(...)` dependency; `RequireAdmin/RequireStaff/RequireTech` shortcuts. **Admin implicitly passes every role check.** Roles: Admin, Staff, Tech.
- **Equipment polymorphism**: a base `Equipment` row optionally has a `EquipmentVrac` (bulk bin), `EquipmentConsommable` (consumable stock), or `EquipmentLocation` (rented) extension, joined 1:1 on `equipment_id`. Handlers resolve which kind via `db.get(EquipmentVrac, id)` etc.
- **Data model authority**: `MCD.dbml` / `MCD.dbdiagram` at the repo root are the canonical entity-relationship spec; `PLAN.md` is the full product/architecture plan (sync scenarios A/B/C referenced in code comments live there). **Keep `MCD.dbml` up to date**: whenever you change the data model (new/renamed tables, columns, enums, or relationships in `db_models.py` / migrations), update `MCD.dbml` in the same change so it stays an accurate, reviewable mirror of the schema — it's the reference used during code review.

### Frontend layout (`frontend/src/`)

- `app/` — `AppRouter` (route table, **all pages lazy-loaded** for per-route code-splitting cached by the SW), `AppLayout`, `AuthContext`, `ProtectedRoute`.
- `features/<domain>/` — page components (auth, catalog, equipment, prestations, pannes, scan, labels, fournisseurs, profile, sync).
- `lib/` — `api.ts` (fetch wrapper with auto 401→refresh retry), `syncEngine.ts`, `db.ts` (Dexie schema), `tokenStore.ts`, `webauthn.ts`, `push.ts`, `useSync.ts`, `types.ts`. Path alias `@/` → `src/`.
- `shared/` — reusable UI (Button, Icon, StatusBadge, TabBar, Toast, OfflineIndicator).
- PWA via `vite-plugin-pwa` (autoUpdate). `/api/*` uses NetworkFirst (5s timeout) runtime caching; `push-sw.js` is imported into the generated service worker for web-push.

All API access goes through `api()` in [api.ts](frontend/src/lib/api.ts) — it injects the bearer token and transparently refreshes on 401. Don't call `fetch` directly for API routes.

### Vérification navigateur

Après avoir terminé une modification frontend significative (nouvelle page, changement de flux, refonte de composant — pas pour un ajustement de style trivial), lancer le subagent `ui-tester` (outil Agent, `subagent_type: ui-tester`) avec la description de ce qui a changé et le parcours à vérifier, et inclure son verdict dans le rapport final. Pour un test manuel : `/uitest <flux>`.
