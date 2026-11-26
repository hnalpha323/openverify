#!/usr/bin/env bash
# Install a pinned chart-testing (ct) 3.15.0 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-chart-testing.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/helm/chart-testing/releases/tag/v3.15.0 (2026-10-06, Apache-2.0)
# Asset:     chart-testing_3.15.0_linux_amd64.tar.gz
# Checksums: checksums.txt
# Signature: chart-testing_3.15.0_linux_amd64.tar.gz.sigstore.json, identity https://github.com/helm/chart-testing/.github/workflows/release.yaml@refs/heads/main, issuer https://token.actions.githubusercontent.com; `ct install` only, never `ct lint` (yamllint is GPL-3.0)
#
# Usage: infra/scripts/install-chart-testing.sh
# Env:   INSTALL_DIR (default ~/.local/bin); CHART_TESTING_VERSION with CHART_TESTING_SHA256 (together); CHART_TESTING_CACHE_DIR
set -euo pipefail

CHART_TESTING_VERSION_DEFAULT="3.15.0"
CHART_TESTING_SHA256_DEFAULT="467561730f25fe09d5e6cd09a3e1f6aa759871c657a57602947c716d9be2c583"

ov_tool=chart-testing
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin CHART_TESTING
ov_begin

asset="chart-testing_${ov_version}_linux_amd64.tar.gz"
sums=checksums.txt
bundle="$asset.sigstore.json"
base="https://github.com/helm/chart-testing/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums" || return 1
  ov_verify_bundle "$ov_dl/$asset" "$ov_dl/$bundle" \
    https://github.com/helm/chart-testing/.github/workflows/release.yaml@refs/heads/main \
    https://token.actions.githubusercontent.com
}
ov_obtain "${CHART_TESTING_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums" "$bundle" "$base/$bundle"
# Only ct: `ct install` needs no lint configuration, and `ct lint` is never run (yamllint is GPL-3.0).
ov_extract "$ov_dl/$asset" ct
ov_install "$ov_x/ct" ct
ov_say "installed ct $("$ov_install_dir/ct" version 2>&1 | sed -n 's/^Version:[[:space:]]*//p') to $ov_install_dir/ct"
