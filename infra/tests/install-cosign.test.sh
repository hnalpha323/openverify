#!/usr/bin/env bash
# Test for infra/scripts/install-cosign.sh (Workflow 11C scanners-11c; C258.2): cosign 3.1.3,
# checked by SHA-256 only (the release checksum file and the pin; it is the tool that checks the
# others' signatures). Offline: a synthetic release through the fake curl of
# infra/tests/lib/installer-harness.sh; network: the pinned release from GitHub.
#
# Usage: infra/tests/install-cosign.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-cosign.sh

# The synthetic release v0.0.1.
h_stub_binary "$release/cosign-linux-amd64" "GitVersion:    v0.0.1"
sha=$(h_sha256 "$release/cosign-linux-amd64")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 cosign-linux-arm64 "$sha" cosign-linux-amd64 >"$release/cosign_checksums.txt"

run_installer good COSIGN_VERSION=0.0.1 COSIGN_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/cosign" ]; then ok "the synthetic release installs cosign into INSTALL_DIR"; else nok "the synthetic release installs cosign into INSTALL_DIR" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/sigstore/cosign/releases/download/v0.0.1/cosign-linux-amd64*" "$case_calls"
expect_match "the release checksum file is verified" "*release checksum file: OK*" "$case_out"
expect_match "the pinned SHA-256 is verified" "*pinned SHA-256: OK*" "$case_out"
expect_match "the installed version is reported" "*installed*v0.0.1*" "$case_out"
if [ -z "$case_cosign_calls" ]; then ok "cosign is checked by SHA-256 only (no signature step)"; else nok "cosign is checked by SHA-256 only (no signature step)"; fi

fail_closed_cases COSIGN 0.0.1 "$sha" cosign_checksums.txt \
  "1111111111111111111111111111111111111111111111111111111111111111  cosign-linux-amd64" \
  "$sha  cosign-linux-arm64"

if [ "$offline_only" = 1 ]; then
  skip "network: the pinned cosign 3.1.3 installs (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/cosign" ]; then ok "network: the pinned cosign installs"; else nok "network: the pinned cosign installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^COSIGN_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: the installed cosign reports the pinned version ($pinned)" "*GitVersion:*v$pinned*" "$("$net/cosign" version 2>&1)"
finish
