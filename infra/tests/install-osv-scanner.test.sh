#!/usr/bin/env bash
# Test for infra/scripts/install-osv-scanner.sh (Workflow 11C scanners-11c; C258.2, C259.1):
# osv-scanner 2.7.0, a bare release binary, checked against osv-scanner_SHA256SUMS and the pin. The
# release publishes SLSA provenance, not a cosign signature, and slsa-verifier is not adopted
# (Stage 1a amendment 5), so no signature is asked for. Offline: a synthetic release through the
# fake curl of infra/tests/lib/installer-harness.sh; network: the pinned release from GitHub.
#
# Usage: infra/tests/install-osv-scanner.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-osv-scanner.sh

asset=osv-scanner_linux_amd64
sums=osv-scanner_SHA256SUMS
h_stub_binary "$release/$asset" "osv-scanner version: 0.0.1"
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 osv-scanner_linux_arm64 "$sha" "$asset" >"$release/$sums"

run_installer good OSV_SCANNER_VERSION=0.0.1 OSV_SCANNER_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/osv-scanner" ] && [ "$(ls "$case_dir/bin")" = osv-scanner ]; then ok "the synthetic release installs osv-scanner, and only it"; else nok "the synthetic release installs osv-scanner, and only it" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/google/osv-scanner/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the release checksum file and the pin are verified" "*release checksum file: OK*pinned SHA-256: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the installed version is reported" "*installed*0.0.1*" "$case_out"
if [ -z "$case_cosign_calls" ]; then ok "no cosign signature is asked for (the release publishes SLSA provenance only)"; else nok "no cosign signature is asked for" "$case_cosign_calls"; fi

fail_closed_cases OSV_SCANNER 0.0.1 "$sha" "$sums" \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  osv-scanner_linux_arm64"

run_installer retry OSV_SCANNER_VERSION=0.0.1 OSV_SCANNER_SHA256="$sha" "plan.$asset=503 net"
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$asset")" = 3 ]; then ok "a 503 and a connection failure are retried, then the release installs"; else nok "a 503 and a connection failure are retried" "exit $case_rc, $(calls_for "$asset") calls"; fi
cache="$work/cache"
run_installer cache-fill OSV_SCANNER_VERSION=0.0.1 OSV_SCANNER_SHA256="$sha" OSV_SCANNER_CACHE_DIR="$cache"
run_installer cache-use OSV_SCANNER_VERSION=0.0.1 OSV_SCANNER_SHA256="$sha" OSV_SCANNER_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ -z "$case_calls" ]; then ok "a verified cached copy is used without a download"; else nok "a verified cached copy is used without a download" "exit $case_rc, calls: $(tr '\n' ';' <<<"$case_calls")"; fi

if [ "$offline_only" = 1 ]; then
  skip "network: osv-scanner 2.7.0 installs (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/osv-scanner" ]; then ok "network: the pinned osv-scanner installs"; else nok "network: the pinned osv-scanner installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^OSV_SCANNER_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: osv-scanner reports $pinned" "*osv-scanner version: $pinned*" "$("$net/osv-scanner" --version 2>&1)"
finish
