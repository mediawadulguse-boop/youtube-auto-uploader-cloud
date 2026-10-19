#!/usr/bin/env bash
# Execute from deploy/oracle directory on the Oracle VM.
set -Eeuo pipefail
umask 077
DEST="/srv/youtube-hub/backups"
mkdir -p "$DEST"
name="youtubehub-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="$DEST/.$name.tmp"
trap 'rm -f "$tmp"' EXIT
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$tmp"
docker compose exec -T db pg_restore --list < "$tmp" >/dev/null
mv "$tmp" "$DEST/$name"
sha256sum "$DEST/$name" > "$DEST/$name.sha256"
echo "Verified local dump: $DEST/$name"
echo "Copy an ENCRYPTED copy off the VM and compare SHA256; no old backups were deleted."
