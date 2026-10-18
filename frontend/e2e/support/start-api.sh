#!/usr/bin/env bash
# API pour les tests e2e : base jetable recréée, migrée et seedée, puis uvicorn.
#
# Lancé par playwright.config.ts (webServer) avec dans l'environnement :
#   E2E_DB_NAME, E2E_API_PORT, E2E_ADMIN_EMAIL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_JWKS_URL
# Optionnels :
#   E2E_PG       postgres://user:pass@host:port (défaut : la DB de dev docker compose)
#   E2E_PYTHON   interpréteur Python avec le backend installé
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MAIN_ROOT="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
PG="${E2E_PG:-postgresql://bpm:bpm@localhost:5432}"

# Le venv vit à la racine du checkout principal ; un worktree n'en a pas.
PYTHON="${E2E_PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for candidat in "$ROOT/.venv/bin/python" "$MAIN_ROOT/.venv/bin/python"; do
    [ -x "$candidat" ] && { PYTHON="$candidat"; break; }
  done
fi
PYTHON="${PYTHON:-python3}"

cd "$ROOT/backend"

# Base vierge à chaque lancement : les tests ne dépendent d'aucun état antérieur.
"$PYTHON" - "$PG" "$E2E_DB_NAME" <<'EOF'
import asyncio, sys
import asyncpg

async def main(pg: str, nom: str) -> None:
    conn = await asyncpg.connect(f"{pg}/postgres")
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{nom}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{nom}"')
    finally:
        await conn.close()

asyncio.run(main(*sys.argv[1:]))
EOF

export DATABASE_URL="${PG/postgresql:/postgresql+asyncpg:}/$E2E_DB_NAME"
export DEBUG=false
export PHOTOS_DIR="$(mktemp -d -t bpm-e2e-photos-XXXX)"
# Pas de web-push en e2e.
export VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY=""

"$PYTHON" -m alembic upgrade head
# Admin seul : chaque test crée les données dont il a besoin (fixtures.ts).
"$PYTHON" -m app.seed --email "$E2E_ADMIN_EMAIL"

exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$E2E_API_PORT"
