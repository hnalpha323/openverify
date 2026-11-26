#!/usr/bin/env bash
# Install a pinned kubeconform 0.8.0 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-kubeconform.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/yannh/kubeconform/releases/tag/v0.8.0 (2026-06-04, Apache-2.0)
# Asset:     kubeconform-linux-amd64.tar.gz
# Checksums: CHECKSUMS
# Signature: none published
#
# Usage: infra/scripts/install-kubeconform.sh
# Env:   INSTALL_DIR (default ~/.local/bin); KUBECONFORM_VERSION with KUBECONFORM_SHA256 (together); KUBECONFORM_CACHE_DIR
set -euo pipefail

KUBECONFORM_VERSION_DEFAULT="0.8.0"
KUBECONFORM_SHA256_DEFAULT="9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883"

# scripts/openapi2jsonschema.py at v0.8.0's commit 02374e583d700721f57300fae78e11acd27ee539, the converter
# scripts/fetch_k8s_schemas.py runs over each Kubernetes OpenAPI document (C265.3).
KUBECONFORM_SCHEMA_CONVERTER_COMMIT="02374e583d700721f57300fae78e11acd27ee539"
KUBECONFORM_SCHEMA_CONVERTER_SHA256="d145babfbb765004030764e1b4e518bfb7a4bd7f111691a08fa57983b81881f3"

ov_tool=kubeconform
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin KUBECONFORM
# The converter's commit and SHA-256 move together (KUBECONFORM_CONVERTER_COMMIT with
# KUBECONFORM_CONVERTER_SHA256), like a version and its SHA-256.
converter_commit="${KUBECONFORM_CONVERTER_COMMIT:-$KUBECONFORM_SCHEMA_CONVERTER_COMMIT}"
converter_sha256="${KUBECONFORM_CONVERTER_SHA256:-$KUBECONFORM_SCHEMA_CONVERTER_SHA256}"
if [ "$converter_commit" != "$KUBECONFORM_SCHEMA_CONVERTER_COMMIT" ] && [ -z "${KUBECONFORM_CONVERTER_SHA256:-}" ]; then
  ov_err "KUBECONFORM_CONVERTER_COMMIT=$converter_commit needs a matching KUBECONFORM_CONVERTER_SHA256"
  exit 2
fi
if ! ov_sha256_ok "$converter_sha256"; then
  ov_err "KUBECONFORM_CONVERTER_SHA256 must be 64 lower-case hex digits"
  exit 2
fi
ov_begin

asset=kubeconform-linux-amd64.tar.gz
sums=CHECKSUMS
converter=openapi2jsonschema.py
base="https://github.com/yannh/kubeconform/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums" || return 1
  ov_check_pin_only "$ov_dl/$converter" "$converter_sha256"
}
ov_obtain "${KUBECONFORM_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums" \
  "$converter" "https://raw.githubusercontent.com/yannh/kubeconform/$converter_commit/scripts/$converter"
ov_extract "$ov_dl/$asset" kubeconform
ov_install "$ov_x/kubeconform" kubeconform
# Read by scripts/fetch_k8s_schemas.py (run with an interpreter, so not executable).
ov_install "$ov_dl/$converter" "$converter" 0644
ov_say "installed kubeconform $("$ov_install_dir/kubeconform" -v 2>&1) to $ov_install_dir/kubeconform, and $converter at $converter_commit beside it"
