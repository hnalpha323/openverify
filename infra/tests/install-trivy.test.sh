#!/usr/bin/env bash
# Test for infra/scripts/install-trivy.sh (Workflow 11C scanners-11c; C258.2, C259.1): Trivy 0.76.0
# checked against its checksum file, the pin, and the checksum file's Sigstore bundle (cosign,
# identity Trivy's reusable release workflow at the version's tag). Never trivy-action or setup-trivy (CVE-2026-33634). The checks bundle stays
# pinned by digest in the installer (TRIVY_CHECKS_BUNDLE_DEFAULT), read by infra/scripts/supply-chain.sh. Offline: a synthetic release through the fake curl of
# infra/tests/lib/installer-harness.sh; network: the pinned release from GitHub.
#
# Usage: infra/tests/install-trivy.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-trivy.sh

asset=trivy_0.0.1_Linux-64bit.tar.gz
sums=trivy_0.0.1_checksums.txt
mkdir -p "$work/build"
h_stub_binary "$work/build/trivy" "Version: 0.0.1"
printf 'license\n' >"$work/build/LICENSE"
tar -czf "$release/$asset" -C "$work/build" LICENSE trivy
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "trivy_0.0.1_Linux-ARM64.tar.gz" "$sha" "$asset" >"$release/$sums"
printf '{"synthetic":"bundle"}\n' >"$release/$sums.sigstore.json"

run_installer good TRIVY_VERSION=0.0.1 TRIVY_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/trivy" ] && [ "$(ls "$case_dir/bin")" = trivy ]; then ok "the synthetic release installs trivy, and only it"; else nok "the synthetic release installs trivy, and only it" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/aquasecurity/trivy/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the release checksum file, the pin and the signature are verified" "*release checksum file: OK*pinned SHA-256: OK*signature: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the bundle is verified over the checksum file" "verify-blob --bundle */$sums.sigstore.json *$sums" "$case_cosign_calls"
expect_match "the installed version is reported" "*installed*0.0.1*" "$case_out"
if grep -Eq '^TRIVY_CHECKS_BUNDLE_DEFAULT="ghcr.io/aquasecurity/trivy-checks:[0-9.]+@sha256:[0-9a-f]{64}"$' "$installer"; then ok "the checks bundle stays pinned by digest"; else nok "the checks bundle stays pinned by digest"; fi
expect_match "the pinned checks bundle is named in the report" "*checks bundle*@sha256:*" "$case_out"

fail_closed_cases TRIVY 0.0.1 "$sha" "$sums" \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  trivy_0.0.1_Linux-ARM64.tar.gz"
signature_cases TRIVY 0.0.1 "$sha" \
  https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.0.1 https://token.actions.githubusercontent.com

if [ "$offline_only" = 1 ]; then
  skip "network: Trivy 0.76.0 installs with its signature verified (--offline-only)"
  finish
fi
net="$work/net-bin"
network_cosign "$net" || nok "network: the pinned cosign installs first" "$(tail -n 2 "$work/network-cosign.log" | tr '\n' ' ')"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/trivy" ]; then ok "network: the pinned trivy installs"; else nok "network: the pinned trivy installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
expect_match "network: its Sigstore signature is verified" "*signature: OK*" "$out"
pinned=$(sed -n 's/^TRIVY_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: trivy reports $pinned" "*Version:*$pinned*" "$("$net/trivy" --version 2>&1)"
finish
