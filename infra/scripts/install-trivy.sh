#!/usr/bin/env bash
# Install a pinned Trivy 0.76.0 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-trivy.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/aquasecurity/trivy/releases/tag/v0.76.0 (2026-10-14, Apache-2.0)
# Asset:     trivy_0.76.0_Linux-64bit.tar.gz
# Checksums: trivy_0.76.0_checksums.txt
# Signature: trivy_0.76.0_checksums.txt.sigstore.json, identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.0, issuer https://token.actions.githubusercontent.com; never trivy-action or setup-trivy (CVE-2026-33634)
#
# Usage: infra/scripts/install-trivy.sh
# Env:   INSTALL_DIR (default ~/.local/bin); TRIVY_VERSION with TRIVY_SHA256 (together); TRIVY_CACHE_DIR
set -euo pipefail

TRIVY_VERSION_DEFAULT="0.76.0"
TRIVY_SHA256_DEFAULT="e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7"

# The checks bundle (policy, not vulnerability data) by digest: trivy-checks 2.3.0 (2026-10-14, MIT), the
# major Trivy 0.76.0 pulls by default (mirror.gcr.io/aquasec/trivy-checks:2). Each vulnerability database
# is fetched fresh per run, never pinned (C259.3).
TRIVY_CHECKS_BUNDLE_DEFAULT="ghcr.io/aquasecurity/trivy-checks:2.3.0@sha256:3eae4436560566e77115396d0221a64e0cd86d94a3b45203f8ae3f9a85c027cd"

ov_tool=trivy
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin TRIVY
ov_begin

asset="trivy_${ov_version}_Linux-64bit.tar.gz"
sums="trivy_${ov_version}_checksums.txt"
bundle="$sums.sigstore.json"
base="https://github.com/aquasecurity/trivy/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums" || return 1
  ov_verify_bundle "$ov_dl/$sums" "$ov_dl/$bundle" \
    "https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v${ov_version}" \
    https://token.actions.githubusercontent.com
}
ov_obtain "${TRIVY_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums" "$bundle" "$base/$bundle"
ov_extract "$ov_dl/$asset" trivy
ov_install "$ov_x/trivy" trivy
ov_say "installed trivy $("$ov_install_dir/trivy" --version 2>&1 | sed -n 's/^Version:[[:space:]]*//p' | head -n 1) to $ov_install_dir/trivy (checks bundle $TRIVY_CHECKS_BUNDLE_DEFAULT)"
