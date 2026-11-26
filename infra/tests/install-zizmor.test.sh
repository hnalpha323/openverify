#!/usr/bin/env bash
# Test for infra/scripts/install-zizmor.sh (Workflow 11C scanners-11c; C258.2, C259.1): zizmor
# 1.31.1. The release publishes no checksum file and no signature; it is an immutable release, so
# the release's own checksum source is the asset's `digest` in the GitHub releases API
# (sha256:<hex>), which the installer reads and checks beside the pin. Offline: a synthetic
# release and a synthetic API answer through the fake curl of infra/tests/lib/installer-harness.sh;
# network: the pinned release from GitHub.
#
# Usage: infra/tests/install-zizmor.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-zizmor.sh

asset=zizmor-x86_64-unknown-linux-gnu.tar.gz
api=v0.0.1 # the fake curl serves a URL by its last segment: .../releases/tags/v0.0.1
mkdir -p "$work/build"
h_stub_binary "$work/build/zizmor" "zizmor 0.0.1"
tar -czf "$release/$asset" -C "$work/build" zizmor
sha=$(h_sha256 "$release/$asset")
api_json() { # api_json <asset name> <digest>: a releases API answer with an arm64 asset and one more
  printf '{"tag_name":"v0.0.1","immutable":true,"assets":[{"name":"zizmor-aarch64-unknown-linux-gnu.tar.gz","digest":"sha256:%s"},{"name":"%s","digest":"sha256:%s"}]}\n' \
    1111111111111111111111111111111111111111111111111111111111111111 "$1" "$2"
}
api_json "$asset" "$sha" >"$release/$api"

run_installer good ZIZMOR_VERSION=0.0.1 ZIZMOR_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/zizmor" ] && [ "$(ls "$case_dir/bin")" = zizmor ]; then ok "the synthetic release installs zizmor, and only it"; else nok "the synthetic release installs zizmor, and only it" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/zizmorcore/zizmor/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "its digest is read from the releases API" "*api.github.com/repos/zizmorcore/zizmor/releases/tags/v0.0.1*" "$case_calls"
expect_match "the release's asset digest and the pin are verified" "*release checksum file: OK*pinned SHA-256: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the installed version is reported" "*installed*zizmor 0.0.1*" "$case_out"

fail_closed_cases ZIZMOR 0.0.1 "$sha" "$api" \
  "$(api_json "$asset" 1111111111111111111111111111111111111111111111111111111111111111)" \
  "$(api_json zizmor-x86_64-apple-darwin.tar.gz "$sha")"

cp "$release/$api" "$work/saved-api"
printf '{"message":"API rate limit exceeded"}\n' >"$release/$api"
run_installer api-garbage ZIZMOR_VERSION=0.0.1 ZIZMOR_SHA256="$sha"
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "an API answer without assets fails closed, nothing installed"; else nok "an API answer without assets fails closed, nothing installed" "exit $case_rc"; fi
printf 'not json\n' >"$release/$api"
run_installer api-not-json ZIZMOR_VERSION=0.0.1 ZIZMOR_SHA256="$sha"
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "an API answer that is not JSON fails closed, nothing installed"; else nok "an API answer that is not JSON fails closed, nothing installed" "exit $case_rc"; fi
cp "$work/saved-api" "$release/$api"

if [ "$offline_only" = 1 ]; then
  skip "network: zizmor 1.31.1 installs (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/zizmor" ]; then ok "network: the pinned zizmor installs"; else nok "network: the pinned zizmor installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^ZIZMOR_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: zizmor reports $pinned" "zizmor $pinned*" "$("$net/zizmor" --version 2>&1)"
finish
