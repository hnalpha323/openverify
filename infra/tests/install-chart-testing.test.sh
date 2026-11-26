#!/usr/bin/env bash
# Test for infra/scripts/install-chart-testing.sh (Workflow 11C scanners-11c; C258.2, C265.4):
# chart-testing (ct) 3.15.0 checked against checksums.txt, the pin and the Sigstore bundle on its
# archive (cosign, identity chart-testing's release workflow on main). Only `ct` is installed:
# `ct install` only, never `ct lint` (yamllint is GPL-3.0; rule 20).
#
# Usage: infra/tests/install-chart-testing.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-chart-testing.sh

asset=chart-testing_0.0.1_linux_amd64.tar.gz
mkdir -p "$work/build/etc"
h_stub_binary "$work/build/ct" "Version:	 v0.0.1"
printf 'license\n' >"$work/build/LICENSE"
printf 'rules: {}\n' >"$work/build/etc/lintconf.yaml"
tar -czf "$release/$asset" -C "$work/build" LICENSE etc ct
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' "$sha" "$asset" 1111111111111111111111111111111111111111111111111111111111111111 "$asset.sbom.json" >"$release/checksums.txt"
printf '{"synthetic":"bundle"}\n' >"$release/$asset.sigstore.json"

run_installer good CHART_TESTING_VERSION=0.0.1 CHART_TESTING_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/ct" ] && [ "$(ls "$case_dir/bin")" = ct ]; then ok "the synthetic release installs ct, and only ct"; else nok "the synthetic release installs ct, and only ct" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/helm/chart-testing/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the release checksum file, the pin and the signature are verified" "*release checksum file: OK*pinned SHA-256: OK*signature: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the bundle is verified over the archive itself" "verify-blob --bundle */$asset.sigstore.json *$asset" "$case_cosign_calls"
expect_match "the installed version is reported" "*installed*v0.0.1*" "$case_out"

fail_closed_cases CHART_TESTING 0.0.1 "$sha" checksums.txt \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  chart-testing_0.0.1_linux_arm64.tar.gz"
signature_cases CHART_TESTING 0.0.1 "$sha" \
  https://github.com/helm/chart-testing/.github/workflows/release.yaml@refs/heads/main https://token.actions.githubusercontent.com

if [ "$offline_only" = 1 ]; then
  skip "network: chart-testing 3.15.0 installs with its signature verified (--offline-only)"
  finish
fi
net="$work/net-bin"
network_cosign "$net" || nok "network: the pinned cosign installs first" "$(tail -n 2 "$work/network-cosign.log" | tr '\n' ' ')"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/ct" ]; then ok "network: the pinned ct installs"; else nok "network: the pinned ct installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
expect_match "network: its Sigstore signature is verified" "*signature: OK*" "$out"
pinned=$(sed -n 's/^CHART_TESTING_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: ct reports v$pinned" "*Version:*v$pinned*" "$("$net/ct" version 2>&1)"
finish
