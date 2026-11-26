#!/usr/bin/env bash
# Install a pinned Syft 1.54.1 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-syft.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/anchore/syft/releases/tag/v1.54.1 (2026-10-06, Apache-2.0)
# Asset:     syft_1.54.1_linux_amd64.tar.gz
# Checksums: syft_1.54.1_checksums.txt
# Signature: syft_1.54.1_checksums.txt.sigstore.json, identity https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main, issuer https://token.actions.githubusercontent.com
#
# Usage: infra/scripts/install-syft.sh
# Env:   INSTALL_DIR (default ~/.local/bin); SYFT_VERSION with SYFT_SHA256 (together); SYFT_CACHE_DIR
set -euo pipefail

SYFT_VERSION_DEFAULT="1.54.1"
SYFT_SHA256_DEFAULT="c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47"

ov_tool=syft
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin SYFT
ov_begin

asset="syft_${ov_version}_linux_amd64.tar.gz"
sums="syft_${ov_version}_checksums.txt"
bundle="$sums.sigstore.json"
base="https://github.com/anchore/syft/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums" || return 1
  ov_verify_bundle "$ov_dl/$sums" "$ov_dl/$bundle" \
    "https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main" \
    https://token.actions.githubusercontent.com
}
ov_obtain "${SYFT_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums" "$bundle" "$base/$bundle"
ov_extract "$ov_dl/$asset" syft
ov_install "$ov_x/syft" syft
ov_say "installed syft $("$ov_install_dir/syft" version 2>&1 | sed -n 's/^Version:[[:space:]]*//p' | head -n 1) to $ov_install_dir/syft"
