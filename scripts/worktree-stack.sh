#!/usr/bin/env bash
# Stack de dev isolé par worktree : db + api en docker (ports dynamiques) + vite dev.
#
# Usage (depuis n'importe où dans un worktree) :
#   scripts/worktree-stack.sh up           # démarre tout, clone la DB de dev, écrit .stack.json
#   scripts/worktree-stack.sh down         # détruit le stack du worktree courant (conteneurs + volumes + vite)
#   scripts/worktree-stack.sh down --all   # détruit les stacks de TOUS les worktrees
#   scripts/worktree-stack.sh status       # liste les stacks bpm-wt-* et le .stack.json courant
#   scripts/worktree-stack.sh url          # affiche le .stack.json courant (front_url / api_url)
#
# Les URLs/ports attribués sont écrits dans .stack.json à la racine du worktree.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MAIN_ROOT="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
NAME="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
PROJECT="bpm-wt-${NAME}"
COMPOSE_FILE="$ROOT/docker-compose.worktree.yml"
STACK_JSON="$ROOT/.stack.json"
STACK_DIR="$ROOT/.stack"

compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --project-directory "$ROOT" "$@"; }

env_val() { # env_val VAR DEFAUT — lit une variable simple dans .env
  local v
  v=$(grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)
  echo "${v:-$2}"
}

wait_http() { # wait_http URL TIMEOUT_S LIBELLE
  local i=0
  until curl -sf -o /dev/null "$1"; do
    i=$((i + 1))
    [ "$i" -ge "$2" ] && { echo "✗ timeout en attendant $3 ($1)" >&2; return 1; }
    sleep 1
  done
}

kill_vite() { # kill_vite STACK_JSON_PATH — tue le groupe de processus (npm + vite enfant)
  local pid
  pid=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('vite_pid',''))" "$1" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
}

cmd_up() {
  if [ "$ROOT" = "$MAIN_ROOT" ]; then
    echo "✗ Tu es dans le checkout principal : utilise « docker compose up -d » + « npm run dev » classiques." >&2
    echo "  Ce script est réservé aux worktrees (stacks isolés en parallèle)." >&2
    exit 1
  fi

  [ -f "$ROOT/.env" ] || { echo "→ Copie de .env depuis $MAIN_ROOT"; cp "$MAIN_ROOT/.env" "$ROOT/.env"; }
  local pguser pgdb
  pguser=$(env_val POSTGRES_USER bpm)
  pgdb=$(env_val POSTGRES_DB bpm_log)

  echo "→ [$PROJECT] Démarrage de la DB…"
  compose up -d db
  local db_cid i=0
  db_cid=$(compose ps -q db)
  until docker exec "$db_cid" pg_isready -U "$pguser" -d "$pgdb" >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -ge 60 ] && { echo "✗ timeout DB" >&2; exit 1; }; sleep 1
  done

  # Clone de la DB de dev (uniquement si la DB du worktree est encore vierge).
  local seed=0 tables
  tables=$(docker exec "$db_cid" psql -U "$pguser" -d "$pgdb" -tAc \
    "select count(*) from pg_tables where schemaname='public'")
  if [ "$tables" = "0" ]; then
    if docker ps --format '{{.Names}}' | grep -q '^bpm_log_db$'; then
      echo "→ Clonage de la DB de dev (bpm_log_db) vers le worktree…"
      docker exec bpm_log_db pg_dump -U "$pguser" --clean --if-exists "$pgdb" \
        | docker exec -i "$db_cid" psql -q -U "$pguser" -d "$pgdb" >/dev/null
    else
      echo "⚠ DB principale (bpm_log_db) éteinte → DB vide : migrations + seed admin."
      seed=1
    fi
  else
    echo "→ DB du worktree déjà initialisée ($tables tables), pas de re-clonage."
  fi

  echo "→ [$PROJECT] Build + démarrage de l'API (changements backend du worktree inclus)…"
  compose up -d --build api
  local api_port
  api_port=$(compose port api 8000 | awk -F: '{print $NF}')
  wait_http "http://localhost:${api_port}/health" 90 "l'API"
  if [ "$seed" = 1 ]; then
    compose exec -T api python -m app.seed --email admin@bpm.fr --password bpm1234 || true
  fi

  echo "→ Frontend (vite dev)…"
  cd "$ROOT/frontend"
  [ -d node_modules ] || { echo "→ npm install (premier lancement dans ce worktree)…"; npm install --no-audit --no-fund; }
  local front_port
  front_port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  [ -f "$STACK_JSON" ] && kill_vite "$STACK_JSON"
  mkdir -p "$STACK_DIR"
  # setsid : vite et npm partagent un groupe de processus dédié, tuable d'un bloc.
  API_PROXY_TARGET="http://localhost:${api_port}" \
    setsid nohup npm run dev -- --port "$front_port" --strictPort --host 127.0.0.1 \
    > "$STACK_DIR/vite.log" 2>&1 &
  local vite_pid=$!
  disown "$vite_pid" 2>/dev/null || true
  wait_http "http://localhost:${front_port}" 60 "vite" || { tail -20 "$STACK_DIR/vite.log" >&2; exit 1; }

  cat > "$STACK_JSON" <<EOF
{
  "project": "$PROJECT",
  "front_url": "http://localhost:$front_port",
  "api_url": "http://localhost:$api_port",
  "vite_pid": $vite_pid
}
EOF
  echo
  echo "✓ Stack [$PROJECT] prêt :"
  echo "  Front : http://localhost:$front_port"
  echo "  API   : http://localhost:$api_port"
  echo "  (détails dans $STACK_JSON — « down » pour détruire)"
}

cmd_down_one() { # cmd_down_one ROOT
  local root="$1" name project
  name="$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
  project="bpm-wt-${name}"
  [ -f "$root/.stack.json" ] && kill_vite "$root/.stack.json"
  docker compose -p "$project" -f "$COMPOSE_FILE" --project-directory "$root" \
    down -v --remove-orphans 2>/dev/null || true
  rm -f "$root/.stack.json"
  rm -rf "$root/.stack"
  echo "✓ Stack [$project] détruit."
}

cmd_down() {
  if [ "${1:-}" = "--all" ]; then
    git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r wt; do
      [ "$wt" = "$MAIN_ROOT" ] && continue
      cmd_down_one "$wt"
    done
    # Filet de sécurité : projets bpm-wt-* orphelins (worktree déjà supprimé).
    docker compose ls -a --format json | python3 -c \
      'import json,sys;[print(p["Name"]) for p in json.load(sys.stdin) if p["Name"].startswith("bpm-wt-")]' \
      | while read -r p; do
        docker compose -p "$p" -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
        echo "✓ Stack orphelin [$p] détruit."
      done
  else
    cmd_down_one "$ROOT"
  fi
}

cmd_status() {
  echo "Stacks worktree actifs :"
  docker compose ls -a --format json | python3 -c '
import json, sys
for p in json.load(sys.stdin):
    if p["Name"].startswith("bpm-wt-"):
        print("  %-40s %s" % (p["Name"], p["Status"]))
'
  if [ -f "$STACK_JSON" ]; then
    echo "Worktree courant ($PROJECT) :"
    cat "$STACK_JSON"
  fi
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down "${2:-}" ;;
  status) cmd_status ;;
  url) cat "$STACK_JSON" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
