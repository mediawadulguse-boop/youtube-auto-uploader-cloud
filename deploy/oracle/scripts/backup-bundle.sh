#!/usr/bin/env bash
# Oracle VM only. Never stops or changes a service automatically.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
if [[ -n "$(docker compose ps --status running -q app)" ]]; then
  echo 'Refusing consistent bundle while app is running. Stop ALL writers first.' >&2
  exit 1
fi
dest="$(mktemp -d /srv/youtube-hub/backups/bundle-XXXXXXXX)"
echo "Building backup in $dest; incomplete bundles remain for inspection on failure."
inventory() {
  docker compose exec -T db sh -c 'exec psql -Xq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/database-manifest.sql
}
inventory > "$dest/database-before.csv"
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$dest/postgres.dump"
docker compose exec -T db pg_restore --list < "$dest/postgres.dump" > "$dest/postgres-index.txt"
inventory > "$dest/database-after.csv"
cmp "$dest/database-before.csv" "$dest/database-after.csv"
python3 scripts/data-manifest.py create /srv/youtube-hub/data "$dest/data-manifest.json"
tar -C /srv/youtube-hub/data -cpf "$dest/data.tar" .
python3 scripts/data-manifest.py verify /srv/youtube-hub/data "$dest/data-manifest.json"
mkdir "$dest/restore-check"
tar -C "$dest/restore-check" -xpf "$dest/data.tar"
python3 scripts/data-manifest.py verify "$dest/restore-check" "$dest/data-manifest.json"
# Remove only the temporary extracted verification copy, never any source data.
rm -r -- "$dest/restore-check"
(cd "$dest" && sha256sum postgres.dump postgres-index.txt database-before.csv database-after.csv data.tar data-manifest.json > SHA256SUMS && sha256sum -c SHA256SUMS)
echo 'Archive and file checks passed. PostgreSQL restore drill STILL REQUIRED.'
echo 'Encrypt an off-server copy, preserve the original APP_SECRET separately, and compare SHA256SUMS after transfer.'
