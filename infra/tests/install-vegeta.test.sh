#!/usr/bin/env bash
# Test for infra/scripts/install-vegeta.sh (Workflow 11D load-harness; C258.2, C258.3, C268.1):
# vegeta 12.13.0, a release tarball, checked against vegeta_<version>_checksums.txt and the pin. The
# release signs that checksum file with PGP only, which the cosign pattern does not check, so no
# cosign signature is asked for and the in-repository pin is what protects against a swapped asset
# (Workflow 11D Stage 1a, contracts-11d's deviation). Offline: a synthetic release through the fake
# curl of infra/tests/lib/installer-harness.sh; network: the pinned release from GitHub.
#
# Usage: infra/tests/install-vegeta.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-vegeta.sh

if grep -q '^OPENVERIFY_SKELETON=1$' "$installer"; then nok "install-vegeta.sh is built (no OPENVERIFY_SKELETON marker)"; else ok "install-vegeta.sh is built (no OPENVERIFY_SKELETON marker)"; fi

version=0.0.1
asset="vegeta_${version}_linux_amd64.tar.gz"
sums="vegeta_${version}_checksums.txt"
mkdir -p "$work/build"
h_stub_binary "$work/build/vegeta" "Version: $version"
printf 'license\n' >"$work/build/LICENSE"
printf 'readme\n' >"$work/build/README.md"
tar -czf "$release/$asset" -C "$work/build" LICENSE README.md vegeta
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "vegeta_${version}_linux_arm64.tar.gz" "$sha" "$asset" >"$release/$sums"

run_installer good VEGETA_VERSION="$version" VEGETA_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/vegeta" ] && [ "$(ls "$case_dir/bin")" = vegeta ]; then ok "the synthetic release installs vegeta, and only it"; else nok "the synthetic release installs vegeta, and only it" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/tsenart/vegeta/releases/download/v$version/$asset*" "$case_calls"
expect_match "the checksum file comes from the same release" "*github.com/tsenart/vegeta/releases/download/v$version/$sums*" "$case_calls"
expect_match "the release checksum file and the pin are verified" "*release checksum file: OK*pinned SHA-256: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the installed version is reported" "*installed*Version: $version*" "$case_out"
if [ -z "$case_cosign_calls" ]; then ok "no cosign signature is asked for (the release signs its checksum file with PGP only)"; else nok "no cosign signature is asked for" "$case_cosign_calls"; fi
expect_match "every download is HTTPS only" "*--proto =https*" "$case_calls"

fail_closed_cases VEGETA "$version" "$sha" "$sums" \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  vegeta_${version}_linux_arm64.tar.gz"

run_installer not-found VEGETA_VERSION="$version" VEGETA_SHA256="$sha" "plan.$asset=404"
if [ "$case_rc" -ne 0 ] && nothing_installed && [ "$(calls_for "$asset")" = 1 ]; then ok "a 404 fails at once, without a retry, nothing installed"; else nok "a 404 fails at once, without a retry" "exit $case_rc, $(calls_for "$asset") calls"; fi

run_installer retry VEGETA_VERSION="$version" VEGETA_SHA256="$sha" "plan.$asset=503 net"
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$asset")" = 3 ]; then ok "a 503 and a connection failure are retried, then the release installs"; else nok "a 503 and a connection failure are retried" "exit $case_rc, $(calls_for "$asset") calls"; fi

cache="$work/cache"
run_installer cache-fill VEGETA_VERSION="$version" VEGETA_SHA256="$sha" VEGETA_CACHE_DIR="$cache"
if [ -f "$cache/$asset" ] && [ -f "$cache/$sums" ]; then ok "a verified download fills the cache"; else nok "a verified download fills the cache"; fi
run_installer cache-use VEGETA_VERSION="$version" VEGETA_SHA256="$sha" VEGETA_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ -z "$case_calls" ]; then ok "a verified cached copy is used without a download"; else nok "a verified cached copy is used without a download" "exit $case_rc, calls: $(tr '\n' ';' <<<"$case_calls")"; fi
if [ -f "$cache/$asset" ]; then printf 'tampered\n' >>"$cache/$asset"; fi
run_installer cache-bad VEGETA_VERSION="$version" VEGETA_SHA256="$sha" VEGETA_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$asset")" = 1 ]; then ok "a cached copy that fails verification is discarded and downloaded again"; else nok "a cached copy that fails verification is discarded and downloaded again" "exit $case_rc, $(calls_for "$asset") calls"; fi

if [ "$offline_only" = 1 ]; then
  skip "network: vegeta 12.13.0 installs (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/vegeta" ]; then ok "network: the pinned vegeta installs"; else nok "network: the pinned vegeta installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^VEGETA_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: vegeta reports $pinned" "*$pinned*" "$("$net/vegeta" -version 2>&1)"
finish
