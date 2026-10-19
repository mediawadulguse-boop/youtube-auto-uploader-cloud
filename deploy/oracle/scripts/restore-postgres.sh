#!/usr/bin/env bash
# Execute from deploy/oracle directory BEFORE starting the app.
set -Eeuo pipefail
if [[ $# -ne 1 || ! -f "${1:-}" ]]; then
  echo "Usage: bash scripts/restore-postgres.sh /path/to/railway-pg.dump" >&2
  exit 2
fi
DUMP="$1"
if [[ -n "$(docker compose ps --status running -q app)" ]]; then
  echo "Refusing restore: app is running; stop it first." >&2
  exit 1
fi
docker compose exec -T db pg_restore --list < "$DUMP" >/dev/null
count="$(docker compose exec -T db sh -c 'psql -XAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_tables WHERE schemaname='\''public'\''"' | tr -d '\r')"
if [[ "$count" != "0" ]]; then
  echo "Refusing restore: target PostgreSQL has $count public tables." >&2
  exit 1
fi
echo "Restoring verified dump to empty target in one transaction..."
docker compose exec -T db sh -c 'exec pg_restore --single-transaction --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DUMP"
docker compose exec -T db sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT key,revision,octet_length(data::text) AS bytes FROM app_documents ORDER BY key"'
echo "Restore complete. Compare rows and source checksum before activating worker."
