#!/usr/bin/env bash
#
# Sauvegarde PostgreSQL de BPM Log (cron-friendly).
#
# Fait un pg_dump compressé du conteneur `bpm_log_db` vers $BACKUP_DIR,
# puis purge les sauvegardes plus vieilles que $RETENTION_DAYS jours.
#
# Cron quotidien à 3h (crontab -e) :
#   0 3 * * * /home/jonathan/git/bpm-log/scripts/backup.sh >> /var/log/bpm-backup.log 2>&1
#
set -euo pipefail

# --- Config (surchargeables par l'environnement) ---------------------------
DB_CONTAINER="${DB_CONTAINER:-bpm_log_db}"
DB_USER="${POSTGRES_USER:-bpm}"
DB_NAME="${POSTGRES_DB:-bpm_log}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/bpm-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# --- Sauvegarde ------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/bpm_log_${STAMP}.sql.gz"

echo "→ Dump de $DB_NAME depuis $DB_CONTAINER vers $OUT"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner \
  | gzip > "$OUT"

# Vérifie que le fichier n'est pas vide.
if [ ! -s "$OUT" ]; then
  echo "✗ ÉCHEC : dump vide, suppression de $OUT" >&2
  rm -f "$OUT"
  exit 1
fi
echo "✓ Sauvegarde OK ($(du -h "$OUT" | cut -f1))"

# --- Rétention -------------------------------------------------------------
echo "→ Purge des sauvegardes > ${RETENTION_DAYS} jours"
find "$BACKUP_DIR" -name 'bpm_log_*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete

# Pour restaurer :
#   gunzip -c bpm_log_YYYYMMDD_HHMMSS.sql.gz | docker exec -i bpm_log_db psql -U bpm -d bpm_log
