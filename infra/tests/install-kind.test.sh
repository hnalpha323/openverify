#!/usr/bin/env bash
# Test for infra/scripts/install-kind.sh (Workflow 11C scanners-11c; C258.2, C265.4): kind 0.33.0
# checked against kind-linux-amd64.sha256sum and the pin (no signature is published). The node
# images stay pinned by digest in the installer for deploy/helm/openverify/ci/kind.sh.
#
# Usage: infra/tests/install-kind.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-kind.sh

h_stub_binary "$release/kind-linux-amd64" "kind v0.0.1 go1.26.7 linux/amd64"
sha=$(h_sha256 "$release/kind-linux-amd64")
printf '%s  %s\n' "$sha" kind-linux-amd64 >"$release/kind-linux-amd64.sha256sum"

run_installer good KIND_VERSION=0.0.1 KIND_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/kind" ]; then ok "the synthetic release installs kind"; else nok "the synthetic release installs kind" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from the release's download path" "*github.com/kubernetes-sigs/kind/releases/download/v0.0.1/kind-linux-amd64*" "$case_calls"
expect_match "the installed version is reported" "*installed*kind v0.0.1*" "$case_out"
for minor in 1_35 1_37; do
  if grep -Eq "^KIND_NODE_IMAGE_$minor=\"kindest/node:v[0-9.]+@sha256:[0-9a-f]{64}\"\$" "$installer"; then ok "the $minor node image stays pinned by digest"; else nok "the $minor node image stays pinned by digest"; fi
done

fail_closed_cases KIND 0.0.1 "$sha" kind-linux-amd64.sha256sum \
  "1111111111111111111111111111111111111111111111111111111111111111  kind-linux-amd64" \
  "$sha  kind-darwin-amd64"

if [ "$offline_only" = 1 ]; then
  skip "network: kind 0.33.0 installs (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/kind" ]; then ok "network: the pinned kind installs"; else nok "network: the pinned kind installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^KIND_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: kind reports v$pinned" "kind v$pinned *" "$("$net/kind" version 2>&1)"
finish
