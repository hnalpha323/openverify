#!/usr/bin/env bash
# Install a pinned osv-scanner 2.7.0 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-osv-scanner.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/google/osv-scanner/releases/tag/v2.7.0 (2026-10-12, Apache-2.0)
# Asset:     osv-scanner_linux_amd64
# Checksums: osv-scanner_SHA256SUMS
# Signature: none by cosign: the release publishes SLSA provenance (multiple.intoto.jsonl), which would need slsa-verifier, not adopted
#
# Usage: infra/scripts/install-osv-scanner.sh
# Env:   INSTALL_DIR (default ~/.local/bin); OSV_SCANNER_VERSION with OSV_SCANNER_SHA256 (together); OSV_SCANNER_CACHE_DIR
set -euo pipefail

OSV_SCANNER_VERSION_DEFAULT="2.7.0"
OSV_SCANNER_SHA256_DEFAULT="160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"

ov_tool=osv-scanner
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin OSV_SCANNER
ov_begin

asset=osv-scanner_linux_amd64
sums=osv-scanner_SHA256SUMS
base="https://github.com/google/osv-scanner/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums"
}
ov_obtain "${OSV_SCANNER_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums"
ov_install "$ov_dl/$asset" osv-scanner
ov_say "installed $("$ov_install_dir/osv-scanner" --version 2>&1 | head -n 1) to $ov_install_dir/osv-scanner"
