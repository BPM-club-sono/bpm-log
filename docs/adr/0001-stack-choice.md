# 0001 — Choix de la stack technique

- **Statut** : Accepté
- **Date** : 2026-05-29
- **Contexte** : Application PWA offline-first de gestion du parc matériel de l'association BPM.

## Décision

| Couche | Choix | Raison |
|---|---|---|
| Base de données | PostgreSQL 16 | Multi-utilisateurs concurrents, ENUM natifs, `ON CONFLICT`, `TIMESTAMPTZ` |
| Driver DB | `asyncpg` | Asynchrone, évite de bloquer l'event loop FastAPI (jamais `psycopg2` synchrone) |
| ORM | SQLAlchemy 2.x (style async) | Mature, typé, compatible Alembic |
| API | FastAPI + Uvicorn | Validation Pydantic v2, OpenAPI auto, async natif |
| Migrations | Alembic | Standard, migrations versionnées et réversibles |
| Auth | JWT (access + refresh) + WebAuthn/Passkey | Mot de passe au 1er login, puis biométrie via Passkey |
| Hash mot de passe | Argon2 (`argon2-cffi`) | Recommandation OWASP actuelle |
| RBAC | Rôles `Admin` / `Staff` / `Tech` | Contrôle d'accès dès la V1 |
| Frontend | React 18 + TypeScript + Vite | Cohérent avec Site-BPM |
| Styles | Tailwind CSS | Productivité, design system noir/blanc sobre |
| Offline local | Dexie.js (IndexedDB) | File de sync persistante, cache catalogue |
| PWA | `vite-plugin-pwa` (Workbox) | Installable, précache du shell |
| Notifications | Web-Push (VAPID) | Alertes matos non retourné / ticket urgent |
| Déploiement | Docker Compose sur VPS asso | Simple, reproductible |

## Conséquences

- L'idempotence de la sync repose sur un `uuid_client` généré côté client (cf. PLAN.md §3.3).
- L'état dérivé (statuts, stocks) est recalculé par replay chronologique du log d'évènements.
- Toute évolution de schéma passe par une nouvelle migration Alembic, jamais par édition d'une migration appliquée.
