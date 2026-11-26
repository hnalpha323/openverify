#!/usr/bin/env bash
# Install the two pinned Helm releases (linux x86_64) in install-gitleaks.sh's pattern: Helm 4.3.1 as
# `helm` and Helm 3.22.1 as `helm3`, each verified against its `.sha256sum` from get.helm.sh and the
# SHA-256 pinned below, in a private temporary directory, with retries and a verified cache (C258.2,
# C265.1: lint and template on both majors). Helm signs with PGP (`.asc`), not Sigstore.
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-helm.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Releases:  https://github.com/helm/helm/releases/tag/v4.3.1 (2026-10-15, Apache-2.0)
#            https://github.com/helm/helm/releases/tag/v3.22.1 (2026-10-15, Apache-2.0)
# Assets:    https://get.helm.sh/helm-v<version>-linux-amd64.tar.gz, checksum file <asset>.sha256sum
#
# Usage: infra/scripts/install-helm.sh
# Env:   INSTALL_DIR (default ~/.local/bin); HELM4_VERSION with HELM4_SHA256 and HELM3_VERSION with
#        HELM3_SHA256 (each pair together); HELM_CACHE_DIR
set -euo pipefail

HELM4_VERSION_DEFAULT="4.3.1"
HELM4_SHA256_DEFAULT="0403a88ae20913d11b10a2467b50087721fea7581736da6b9d3992f5357fe54b"
HELM3_VERSION_DEFAULT="3.22.1"
HELM3_SHA256_DEFAULT="896cf63684a42a723d61c980369d6e588330927deb13676ca0d85006dd6da0ea"

ov_tool=helm
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin HELM3
helm3_version=$ov_version
helm3_sha256=$ov_sha256
ov_pin HELM4
helm4_version=$ov_version
helm4_sha256=$ov_sha256
ov_begin

asset4="helm-v${helm4_version}-linux-amd64.tar.gz"
asset3="helm-v${helm3_version}-linux-amd64.tar.gz"
verify() {
  local asset release_sha pinned
  for asset in "$asset4" "$asset3"; do
    pinned=$helm4_sha256
    [ "$asset" = "$asset3" ] && pinned=$helm3_sha256
    release_sha=$(ov_release_sha "$ov_dl/$asset.sha256sum" "$asset") || return 1
    ov_check_asset "$ov_dl/$asset" "$release_sha" "$asset.sha256sum" "$pinned" || return 1
  done
}
# Both releases are verified before either is installed.
ov_obtain "${HELM_CACHE_DIR:-}" verify \
  "$asset4" "https://get.helm.sh/$asset4" "$asset4.sha256sum" "https://get.helm.sh/$asset4.sha256sum" \
  "$asset3" "https://get.helm.sh/$asset3" "$asset3.sha256sum" "https://get.helm.sh/$asset3.sha256sum"
mkdir -p "$ov_x/4" "$ov_x/3"
tar -xzf "$ov_dl/$asset4" -C "$ov_x/4" linux-amd64/helm
tar -xzf "$ov_dl/$asset3" -C "$ov_x/3" linux-amd64/helm
ov_install "$ov_x/4/linux-amd64/helm" helm
ov_install "$ov_x/3/linux-amd64/helm" helm3
ov_say "installed helm $("$ov_install_dir/helm" version --short 2>&1) to $ov_install_dir/helm"
ov_say "installed helm3 $("$ov_install_dir/helm3" version --short 2>&1) to $ov_install_dir/helm3"
