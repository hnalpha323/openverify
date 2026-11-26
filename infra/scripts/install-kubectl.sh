#!/usr/bin/env bash
# Install a pinned kubectl 1.35.9 release binary (linux x86_64) in install-gitleaks.sh's pattern:
# verified against the release's own checksum file and the SHA-256 pinned below, its signature
# checked with the checksummed cosign where the project publishes one, in a private temporary
# directory, with retries on 5xx answers and a verified cache (C258.2; decision 42).
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-kubectl.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://dl.k8s.io/release/v1.35.9/bin/linux/amd64/kubectl (released 2026-09-23 as Kubernetes v1.35.9) (2026-09-23, Apache-2.0)
# Asset:     kubectl (the binary itself)
# Checksums: kubectl.sha256
# Signature: kubectl.sig and kubectl.cert beside it, identity krel-staging@k8s-releng-prod.iam.gserviceaccount.com, issuer https://accounts.google.com
#
# Usage: infra/scripts/install-kubectl.sh
# Env:   INSTALL_DIR (default ~/.local/bin); KUBECTL_VERSION with KUBECTL_SHA256 (together); KUBECTL_CACHE_DIR
set -euo pipefail

KUBECTL_VERSION_DEFAULT="1.35.9"
KUBECTL_SHA256_DEFAULT="3cfeaf80be482b435b0aa214aff6e0b2c312ee23c0ff20810c75517b6004c6eb"

# The signer of Kubernetes' release binaries, as its certificate names it (plan amendment 5: not
# krel-trust), and its issuer.
KUBECTL_SIGNER_IDENTITY="krel-staging@k8s-releng-prod.iam.gserviceaccount.com"
KUBECTL_SIGNER_ISSUER="https://accounts.google.com"

ov_tool=kubectl
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin KUBECTL
ov_begin

base="https://dl.k8s.io/release/v${ov_version}/bin/linux/amd64"
verify() {
  local release_sha
  release_sha=$(ov_release_sha_only "$ov_dl/kubectl.sha256" kubectl) || return 1
  ov_check_asset "$ov_dl/kubectl" "$release_sha" kubectl.sha256 || return 1
  ov_verify_sigcert "$ov_dl/kubectl" "$ov_dl/kubectl.sig" "$ov_dl/kubectl.cert" "$KUBECTL_SIGNER_IDENTITY" "$KUBECTL_SIGNER_ISSUER"
}
ov_obtain "${KUBECTL_CACHE_DIR:-}" verify kubectl "$base/kubectl" kubectl.sha256 "$base/kubectl.sha256" \
  kubectl.sig "$base/kubectl.sig" kubectl.cert "$base/kubectl.cert"
ov_install "$ov_dl/kubectl" kubectl
ov_say "installed kubectl $("$ov_install_dir/kubectl" version --client 2>&1 | sed -n 's/^Client Version: *//p') to $ov_install_dir/kubectl"
