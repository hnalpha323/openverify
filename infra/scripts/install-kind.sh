#!/usr/bin/env bash
# Install a pinned kind 0.33.0 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-kind.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0 (2026-08-26, Apache-2.0)
# Asset:     kind-linux-amd64
# Checksums: kind-linux-amd64.sha256sum
# Signature: none published
#
# Usage: infra/scripts/install-kind.sh
# Env:   INSTALL_DIR (default ~/.local/bin); KIND_VERSION with KIND_SHA256 (together); KIND_CACHE_DIR
set -euo pipefail

KIND_VERSION_DEFAULT="0.33.0"
KIND_SHA256_DEFAULT="aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d"

# The node images C265.4 runs, by the digests kind 0.33.0's release notes give (read by deploy/helm/openverify/ci/kind.sh).
KIND_NODE_IMAGE_1_35="kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0"
KIND_NODE_IMAGE_1_37="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"

ov_tool=kind
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin KIND
ov_begin

asset=kind-linux-amd64
sums=kind-linux-amd64.sha256sum
base="https://github.com/kubernetes-sigs/kind/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums"
}
ov_obtain "${KIND_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums"
ov_install "$ov_dl/$asset" kind
ov_say "installed $("$ov_install_dir/kind" version 2>&1) to $ov_install_dir/kind (node images: $KIND_NODE_IMAGE_1_35, $KIND_NODE_IMAGE_1_37)"
