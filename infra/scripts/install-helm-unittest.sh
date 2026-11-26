#!/usr/bin/env bash
# Install the pinned helm-unittest 1.2.1 plugin (linux x86_64) in install-gitleaks.sh's pattern:
# the release archive verified against helm-unittest-checksum.sha and the SHA-256 pinned below, then
# its plugin.yaml, untt-linux-amd64 and LICENSE copied into $HELM_PLUGINS/unittest. The archive's
# install hook (install-binary.sh, which downloads) is never run. Workflow 11C spike (b): the plugin
# runs under Helm 4.3.1 (as a legacy cli/v1 plugin) and under Helm 3.22.1.
#
# Workflow 11C Stage 1a (contracts-11c) read the pins on 2026-11-14 and froze them
# (THIRD_PARTY_LICENSES.md section 1); scanners-11c built the body test-first
# (infra/tests/install-helm-unittest.test.sh) on infra/scripts/lib/install-common.sh, the shared pattern.
#
# Release:   https://github.com/helm-unittest/helm-unittest/releases/tag/v1.2.1 (2026-10-03, MIT)
# Asset:     helm-unittest-linux-amd64-1.2.1.tgz
# Checksums: helm-unittest-checksum.sha (PGP .asc beside it; no Sigstore signature)
#
# Usage: infra/scripts/install-helm-unittest.sh
# Env:   HELM_PLUGINS (default: `helm env HELM_PLUGINS`); HELM_UNITTEST_VERSION with
#        HELM_UNITTEST_SHA256 (together); HELM_UNITTEST_CACHE_DIR
set -euo pipefail

HELM_UNITTEST_VERSION_DEFAULT="1.2.1"
HELM_UNITTEST_SHA256_DEFAULT="48e86ecc1467b009630e5954375e5d8494139f73b466df5fe8c04fa45b634939"

ov_tool=helm-unittest
# shellcheck source=lib/install-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/install-common.sh"
ov_platform
ov_pin HELM_UNITTEST

# Where Helm looks for plugins: HELM_PLUGINS, else Helm's own answer (HELM_BIN, else INSTALL_DIR's
# helm, else PATH's). Helm 4.3.1 and 3.22.1 share the default directory.
plugins="${HELM_PLUGINS:-}"
if [ -z "$plugins" ]; then
  if [ -n "${HELM_BIN:-}" ]; then
    helm_bin=$HELM_BIN
  elif [ -x "$ov_install_dir/helm" ]; then
    helm_bin="$ov_install_dir/helm"
  else
    helm_bin=$(command -v helm 2>/dev/null || true)
  fi
  if [ -z "$helm_bin" ] || [ ! -x "$helm_bin" ] || ! plugins=$("$helm_bin" env HELM_PLUGINS 2>/dev/null) || [ -z "$plugins" ]; then
    ov_err "set HELM_PLUGINS, or install Helm first (infra/scripts/install-helm.sh) so \`helm env HELM_PLUGINS\` can answer"
    exit 2
  fi
fi
ov_begin

asset="helm-unittest-linux-amd64-${ov_version}.tgz"
sums=helm-unittest-checksum.sha
base="https://github.com/helm-unittest/helm-unittest/releases/download/v${ov_version}"
verify() {
  local release_sha
  release_sha=$(ov_release_sha "$ov_dl/$sums" "$asset") || return 1
  ov_check_asset "$ov_dl/$asset" "$release_sha" "$sums"
}
ov_obtain "${HELM_UNITTEST_CACHE_DIR:-}" verify "$asset" "$base/$asset" "$sums" "$base/$sums"
# Only the three files the plugin runs from: never the archive's install-binary.sh hook, which downloads.
ov_extract "$ov_dl/$asset" plugin.yaml untt-linux-amd64 LICENSE
plugin_version=$(sed -n 's/^version: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$ov_x/plugin.yaml")
mkdir -p "$plugins"
staging=$(mktemp -d "$plugins/.unittest.XXXXXX")
install -m 0644 "$ov_x/plugin.yaml" "$staging/plugin.yaml"
install -m 0755 "$ov_x/untt-linux-amd64" "$staging/untt-linux-amd64"
install -m 0644 "$ov_x/LICENSE" "$staging/LICENSE"
chmod 0755 "$staging"
rm -rf "$plugins/unittest"
mv "$staging" "$plugins/unittest"
ov_say "installed unittest $plugin_version to $plugins/unittest"
