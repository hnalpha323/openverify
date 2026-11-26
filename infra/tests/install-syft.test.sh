#!/usr/bin/env bash
# Test for infra/scripts/install-syft.sh (Workflow 11C scanners-11c; C258.2, C261.1): Syft 1.54.1
# checked against its checksum file, the pin, and the checksum file's Sigstore bundle (cosign,
# identity Syft's release workflow on main). Offline: a synthetic release through the fake curl of
# infra/tests/lib/installer-harness.sh; network: the pinned release from GitHub.
#
# Usage: infra/tests/install-syft.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-syft.sh

asset=syft_0.0.1_linux_amd64.tar.gz
sums=syft_0.0.1_checksums.txt
mkdir -p "$work/build"
h_stub_binary "$work/build/syft" "Version:       0.0.1"
printf 'license\n' >"$work/build/LICENSE"
tar -czf "$release/$asset" -C "$work/build" LICENSE syft
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "syft_0.0.1_linux_arm64.tar.gz" "$sha" "$asset" >"$release/$sums"
printf '{"synthetic":"bundle"}\n' >"$release/$sums.sigstore.json"

run_installer good SYFT_VERSION=0.0.1 SYFT_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/syft" ] && [ "$(ls "$case_dir/bin")" = syft ]; then ok "the synthetic release installs syft, and only it"; else nok "the synthetic release installs syft, and only it" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/anchore/syft/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the release checksum file, the pin and the signature are verified" "*release checksum file: OK*pinned SHA-256: OK*signature: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the bundle is verified over the checksum file" "verify-blob --bundle */$sums.sigstore.json *$sums" "$case_cosign_calls"
expect_match "the installed version is reported" "*installed*0.0.1*" "$case_out"

fail_closed_cases SYFT 0.0.1 "$sha" "$sums" \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  syft_0.0.1_linux_arm64.tar.gz"
signature_cases SYFT 0.0.1 "$sha" \
  https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main https://token.actions.githubusercontent.com

if [ "$offline_only" = 1 ]; then
  skip "network: Syft 1.54.1 installs with its signature verified (--offline-only)"
  finish
fi
net="$work/net-bin"
network_cosign "$net" || nok "network: the pinned cosign installs first" "$(tail -n 2 "$work/network-cosign.log" | tr '\n' ' ')"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/syft" ]; then ok "network: the pinned syft installs"; else nok "network: the pinned syft installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
expect_match "network: its Sigstore signature is verified" "*signature: OK*" "$out"
pinned=$(sed -n 's/^SYFT_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: syft reports $pinned" "*Version:*$pinned*" "$("$net/syft" version 2>&1)"
finish
