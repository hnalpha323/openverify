#!/usr/bin/env bash
# Writes the load stack's env file (Workflow 11D, C268.4): infra/load/load.env.example with every
# change-me value replaced by a fresh random one (openssl rand), then the host-side URLs seed:load,
# the sampler and the take runner read (the migration role's and the runtime role's, Valkey's and
# the object store's on the published loopback ports). The file is created mode 0600 under
# /tmp/openverify-load (OPENVERIFY_LOAD_ENV overrides the path, for the tests) and never overwritten:
# remove it, with the stack down, to start again. Nothing it writes is printed.
#
# Usage: infra/load/make-load-env.sh
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
target="${OPENVERIFY_LOAD_ENV:-/tmp/openverify-load/load.env}"
if [ -e "$target" ]; then
  echo "make-load-env: $target exists; remove it (with the load stack down) to write a new one" >&2
  exit 1
fi
mkdir -p "$(dirname "$target")"
chmod 0700 "$(dirname "$target")"
umask 077
tmp=$(mktemp "$(dirname "$target")/.load.env.XXXXXX")
# shellcheck disable=SC2064 # expand now: the path is fixed
trap "rm -f '$tmp'" EXIT
while IFS= read -r line; do
  case "$line" in
    '#'* | '') ;;
    *=change-me-base64-32) printf '%s=%s\n' "${line%%=*}" "$(openssl rand -base64 32)" ;;
    *=change-me-*) printf '%s=%s\n' "${line%%=*}" "$(openssl rand -hex 24)" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$here/load.env.example" >"$tmp"
value() { sed -n "s/^$1=//p" "$tmp" | tail -n 1; }
{
  printf '\n# Host-side URLs (generated): the published ports on loopback.\n'
  printf 'OPENVERIFY_MIGRATION_DATABASE_URL=postgres://%s:%s@127.0.0.1:%s/%s\n' \
    "$(value POSTGRES_USER)" "$(value POSTGRES_PASSWORD)" "$(value POSTGRES_PORT)" "$(value POSTGRES_DB)"
  printf 'DATABASE_URL=postgres://openverify_runtime:%s@127.0.0.1:%s/%s\n' \
    "$(value OPENVERIFY_LOAD_RUNTIME_PASSWORD)" "$(value POSTGRES_PORT)" "$(value POSTGRES_DB)"
  printf 'REDIS_URL=redis://:%s@127.0.0.1:%s\n' "$(value REDIS_PASSWORD)" "$(value REDIS_PORT)"
  printf 'S3_ENDPOINT=http://127.0.0.1:%s\nS3_REGION=us-east-1\nS3_FORCE_PATH_STYLE=true\n' "$(value S3_PORT)"
} >>"$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$target"
trap - EXIT
echo "make-load-env: wrote the load stack's env file (mode 0600)"
