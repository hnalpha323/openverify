#!/usr/bin/env bash
# Contract test for infra/scripts/refresh-digests.sh (Phase 11, Workflow 11C, images-11c; C258.1):
# offline. The script resolves each tag to its digest by hand (never from a test); here a fake
# `docker` on PATH stands for `docker buildx imagetools inspect`, so only the argument handling and
# the output format are checked: one line per reference, `<tag>@sha256:<digest>  # resolved
# <YYYY-MM-DD>`, the date from REFRESH_DIGESTS_DATE when set; usage (no reference, a reference
# that already has a digest, `latest`, no tag, a malformed reference) exits 2 before any lookup;
# a lookup that fails or answers no digest exits 1 naming the reference.
#
# Usage: infra/tests/refresh-digests.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/infra/scripts/refresh-digests.sh"

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected '$2', got '$3'"; fi; }

fake=$(mktemp -d)
trap 'find "$fake" -mindepth 1 -delete; rmdir "$fake"' EXIT
DIGEST_A=sha256:$(printf 'a%.0s' $(seq 64))
cat >"$fake/docker" <<FAKE
#!/bin/sh
# docker buildx imagetools inspect <ref> --format '{{json .Manifest}}'
echo "\$*" >>"$fake/calls"
case "\$4" in
  valkey/valkey:9.1) printf '{"mediaType":"application/vnd.oci.image.index.v1+json","digest":"$DIGEST_A","size":1}\n' ;;
  example.test/none:1) printf '{"mediaType":"x"}\n' ;;
  *) echo "ERROR: not found" >&2; exit 1 ;;
esac
FAKE
chmod +x "$fake/docker"
run() { PATH="$fake:$PATH" REFRESH_DIGESTS_DATE=2026-11-15 bash "$script" "$@"; }

if [ ! -f "$script" ]; then
  nok "infra/scripts/refresh-digests.sh exists"
else
  ok "infra/scripts/refresh-digests.sh exists"
fi

out=$(run valkey/valkey:9.1 2>&1)
rc=$?
expect_eq "resolves a tag to tag@digest with the date" "valkey/valkey:9.1@$DIGEST_A  # resolved 2026-11-15" "$out"
expect_eq "exits 0 on success" "0" "$rc"
expect_eq "asks buildx imagetools for the manifest" "buildx imagetools inspect valkey/valkey:9.1 --format {{json .Manifest}}" "$(tail -n 1 "$fake/calls" 2>/dev/null)"

out=$(PATH="$fake:$PATH" bash "$script" valkey/valkey:9.1 2>&1)
if grep -Eq "^valkey/valkey:9\.1@$DIGEST_A  # resolved [0-9]{4}-[0-9]{2}-[0-9]{2}$" <<<"$out"; then ok "dates the line today without REFRESH_DIGESTS_DATE"; else nok "dates the line today without REFRESH_DIGESTS_DATE" "$out"; fi

rm -f "$fake/calls"
for bad in "" "valkey/valkey:9.1@$DIGEST_A" "valkey/valkey:latest" "valkey/valkey" "Valkey/Valkey:9.1" "valkey/valkey:9.1;id"; do
  if [ -z "$bad" ]; then out=$(run 2>&1); else out=$(run "$bad" 2>&1); fi
  rc=$?
  expect_eq "refuses '${bad:-no reference}' as usage (exit 2)" "2" "$rc"
done
if [ -f "$fake/calls" ]; then nok "a usage error looks nothing up"; else ok "a usage error looks nothing up"; fi
out=$(run valkey/valkey:9.1 valkey/valkey:latest 2>&1)
rc=$?
expect_eq "checks every reference before the first lookup" "2" "$rc"
if [ -f "$fake/calls" ]; then nok "and then looks nothing up"; else ok "and then looks nothing up"; fi

out=$(run example.test/missing:1 2>&1)
rc=$?
expect_eq "a failed lookup exits 1" "1" "$rc"
if grep -q 'example.test/missing:1' <<<"$out"; then ok "and names the reference"; else nok "and names the reference" "$out"; fi
out=$(run example.test/none:1 2>&1)
rc=$?
expect_eq "an answer without a digest exits 1" "1" "$rc"

out=$(run valkey/valkey:9.1 valkey/valkey:9.1 2>&1)
expect_eq "prints one line per reference, in order" "2" "$(grep -c '@sha256:' <<<"$out")"

printf '\n# %d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
