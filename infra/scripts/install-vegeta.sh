#!/usr/bin/env bash
# Install a pinned vegeta 12.13.0 release binary (linux x86_64) in install-gitleaks.sh's pattern
# (infra/scripts/lib/install-common.sh): verified against the release's own checksum file and the
# SHA-256 pinned below, in a private temporary directory, with retries on 5xx answers and a verified
# cache (C258.2, C258.3; decision 42). vegeta is the HTTP load harness's constant-rate generator
# (C268.1): dev tooling, never shipped, never in an image.
#
# Workflow 11D Stage 1a (contracts-11d) read the pins on 2026-11-16 and froze them
# (THIRD_PARTY_LICENSES.md section 1); load-harness built the body test-first
# (infra/tests/install-vegeta.test.sh, with an --offline-only half) on infra/scripts/lib/install-common.sh.
#
# Release:   https://github.com/tsenart/vegeta/releases/tag/v12.13.0 (2025-10-31, MIT)
# Asset:     vegeta_12.13.0_linux_amd64.tar.gz
# Checksums: vegeta_12.13.0_checksums.txt (SHA-256 384239c939594c6a4e3b1da4b336728a0d70ed8e77636af92984cdf036a816e7)
# Signature: vegeta_12.13.0_checksums.txt.asc (PGP over the checksum file; the cosign-only pattern
#            does not check it, so the pinned SHA-256 is what protects against a swapped asset)
#
# Usage: infra/scripts/install-vegeta.sh
# Env:   INSTALL_DIR (default ~/.local/bin); VEGETA_VERSION with VEGETA_SHA256 (together); VEGETA_CACHE_DIR
set -euo pipefail

VEGETA_VERSION_DEFAULT="12.13.0"
VEGETA_SHA256_DEFAULT="e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61"

ov_tool=vegeta
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin VEGETA
ov_begin

asset="vegeta_${ov_version}_linux_amd64.tar.gz"
sums="vegeta_${ov_version}_checksums.txt"
base="https://github.com/tsenart/vegeta/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums"
}
ov_obtain "${VEGETA_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums"
ov_extract "$ov_dl/$asset" vegeta
ov_install "$ov_x/vegeta" vegeta
ov_say "installed $("$ov_install_dir/vegeta" -version 2>&1 | head -n 1) to $ov_install_dir/vegeta"
