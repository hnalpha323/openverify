#!/usr/bin/env bash
# Resolve image tags to their digests (Phase 11, Workflow 11C, images-11c; C258.1). Run by hand
# only, on the day a pin is adopted or refreshed, never from a test or CI: it asks the registry.
#
#   infra/scripts/refresh-digests.sh <image>:<tag> [<image>:<tag> ...]
#
# Prints one line per reference, in order:
#   <image>:<tag>@sha256:<digest>  # resolved <YYYY-MM-DD>
# The digest is the index (or manifest) digest `docker buildx imagetools inspect` reads, which is
# what a `tag@sha256` reference pins. Paste the reference where it belongs (the Dockerfiles' base
# ARGs, the compose files, the Testcontainers constants) and record the date and the build's age
# beside it: a pin must be at least 14 days old on its adoption day (C258.3, rule 3), which this
# script does not check. REFRESH_DIGESTS_DATE overrides the date (for the offline test).
#
# Exit: 0 every reference resolved; 1 a lookup failed or answered no digest (named on stderr);
# 2 usage (no reference, one with a digest already, `latest`, no tag, or a malformed one), before
# any lookup.
set -euo pipefail

usage() {
  echo "usage: $0 <image>:<tag> [<image>:<tag> ...]  (a tag, never latest, never a digest)" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
for ref in "$@"; do
  if ! [[ "$ref" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "not an <image>:<tag> reference: $ref" >&2
    usage
  fi
  if [ "${ref##*:}" = latest ]; then
    echo "never latest: $ref" >&2
    usage
  fi
done

day=${REFRESH_DIGESTS_DATE:-$(date -u +%Y-%m-%d)}
for ref in "$@"; do
  if ! manifest=$(docker buildx imagetools inspect "$ref" --format '{{json .Manifest}}' 2>/dev/null); then
    echo "could not resolve $ref" >&2
    exit 1
  fi
  digest=$(grep -Eo '"digest" *: *"sha256:[0-9a-f]{64}"' <<<"$manifest" | head -n 1 | grep -Eo 'sha256:[0-9a-f]{64}' || true)
  if [ -z "$digest" ]; then
    echo "no digest in the answer for $ref" >&2
    exit 1
  fi
  printf '%s@%s  # resolved %s\n' "$ref" "$digest" "$day"
done
