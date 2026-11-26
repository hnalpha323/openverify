#!/usr/bin/env bash
# Install a pinned Grype 0.120.1 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-grype.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/anchore/grype/releases/tag/v0.120.1 (2026-10-06, Apache-2.0)
# Asset:     grype_0.120.1_linux_amd64.tar.gz
# Checksums: grype_0.120.1_checksums.txt
# Signature: grype_0.120.1_checksums.txt.sigstore.json, identity https://github.com/anchore/grype/.github/workflows/release.yaml@refs/heads/main, issuer https://token.actions.githubusercontent.com
#
# Usage: infra/scripts/install-grype.sh
# Env:   INSTALL_DIR (default ~/.local/bin); GRYPE_VERSION with GRYPE_SHA256 (together); GRYPE_CACHE_DIR
set -euo pipefail

GRYPE_VERSION_DEFAULT="0.120.1"
GRYPE_SHA256_DEFAULT="0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d"

ov_tool=grype
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin GRYPE
ov_begin

asset="grype_${ov_version}_linux_amd64.tar.gz"
sums="grype_${ov_version}_checksums.txt"
bundle="$sums.sigstore.json"
base="https://github.com/anchore/grype/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums" || return 1
  ov_verify_bundle "$ov_dl/$sums" "$ov_dl/$bundle" \
    "https://github.com/anchore/grype/.github/workflows/release.yaml@refs/heads/main" \
    https://token.actions.githubusercontent.com
}
ov_obtain "${GRYPE_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums" "$bundle" "$base/$bundle"
ov_extract "$ov_dl/$asset" grype
ov_install "$ov_x/grype" grype
ov_say "installed grype $("$ov_install_dir/grype" version 2>&1 | sed -n 's/^Version:[[:space:]]*//p' | head -n 1) to $ov_install_dir/grype"
