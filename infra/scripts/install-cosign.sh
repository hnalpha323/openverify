#!/usr/bin/env bash
# Install a pinned cosign 3.1.3 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-cosign.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/sigstore/cosign/releases/tag/v3.1.3 (2026-08-06, Apache-2.0)
# Asset:     cosign-linux-amd64
# Checksums: cosign_checksums.txt
# Signature: none: cosign is checked by SHA-256 only (C258.2); it verifies the other tools
#
# Usage: infra/scripts/install-cosign.sh
# Env:   INSTALL_DIR (default ~/.local/bin); COSIGN_VERSION with COSIGN_SHA256 (together); COSIGN_CACHE_DIR
set -euo pipefail

COSIGN_VERSION_DEFAULT="3.1.3"
COSIGN_SHA256_DEFAULT="4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71"

ov_tool=cosign
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin COSIGN
ov_begin

asset=cosign-linux-amd64
sums=cosign_checksums.txt
base="https://github.com/sigstore/cosign/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums"
}
ov_obtain "${COSIGN_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums"
ov_install "$ov_dl/$asset" cosign
ov_say "installed cosign $("$ov_install_dir/cosign" version 2>&1 | sed -n 's/^GitVersion: *//p') to $ov_install_dir/cosign"
