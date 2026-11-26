#!/usr/bin/env bash
# C62.7: fills the CSCA trust store of government ID NFC checks from the sources of
# trust-anchors/manifest.json (each master list verified against its pinned root CSCA), or
# imports one master list from a file:
#
#   scripts/fetch_trust_anchors.sh [--source <id>] [--import <file> --root <pem>]
#
# It runs `pnpm --filter @openverify/api trust-anchors:sync` with the same arguments, against the
# database of DATABASE_URL (the repository's .env when present). Nothing it fetches is committed
# or shipped, and it never runs in CI.
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm --filter @openverify/api trust-anchors:sync "$@"
