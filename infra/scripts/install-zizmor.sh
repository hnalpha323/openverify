#!/usr/bin/env bash
# Install a pinned zizmor 1.31.1 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-zizmor.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
# The release is immutable and publishes no checksum file, so the release's own checksum source is
# the asset's `digest` in the releases API (api.github.com, read without credentials).
#
# Release:   https://github.com/zizmorcore/zizmor/releases/tag/v1.31.1 (2026-10-15, MIT)
# Asset:     zizmor-x86_64-unknown-linux-gnu.tar.gz
# Checksums: none: the immutable release's asset digest (the releases API's `digest`) is its only checksum
# Signature: none published
#
# Usage: infra/scripts/install-zizmor.sh
# Env:   INSTALL_DIR (default ~/.local/bin); ZIZMOR_VERSION with ZIZMOR_SHA256 (together); ZIZMOR_CACHE_DIR
set -euo pipefail

ZIZMOR_VERSION_DEFAULT="1.31.1"
ZIZMOR_SHA256_DEFAULT="d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99"

ov_tool=zizmor
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin ZIZMOR
ov_begin

asset=zizmor-x86_64-unknown-linux-gnu.tar.gz
api="v${ov_version}"
base="https://github.com/zizmorcore/zizmor/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha_api "$ov_dl/$api" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "the releases API's asset digest"
}
ov_obtain "${ZIZMOR_CACHE_DIR:-}" verify "$asset" "$base/$asset" \
  "$api" "https://api.github.com/repos/zizmorcore/zizmor/releases/tags/v${ov_version}"
ov_extract "$ov_dl/$asset" zizmor
ov_install "$ov_x/zizmor" zizmor
ov_say "installed $("$ov_install_dir/zizmor" --version 2>&1 | head -n 1) to $ov_install_dir/zizmor"
