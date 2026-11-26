#!/usr/bin/env bash
# Test for infra/scripts/install-kubectl.sh (Workflow 11C scanners-11c; C258.2, C265.4): kubectl
# 1.35.9 from dl.k8s.io, checked against kubectl.sha256 (one bare SHA-256), the pin, and its
# signature (kubectl.sig with kubectl.cert, verified by cosign with the Kubernetes release
# identity read by contracts-11c, plan amendment 5).
#
# Usage: infra/tests/install-kubectl.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-kubectl.sh

h_stub_binary "$release/kubectl" "Client Version: v0.0.1"
sha=$(h_sha256 "$release/kubectl")
printf '%s' "$sha" >"$release/kubectl.sha256"
printf 'synthetic-signature\n' >"$release/kubectl.sig"
printf 'synthetic-certificate\n' >"$release/kubectl.cert"
identity=$(sed -n 's/^KUBECTL_SIGNER_IDENTITY="\(.*\)"$/\1/p' "$installer")

run_installer good KUBECTL_VERSION=0.0.1 KUBECTL_SHA256="$sha"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/kubectl" ]; then ok "the synthetic release installs kubectl"; else nok "the synthetic release installs kubectl" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "it is fetched from dl.k8s.io's release path" "*https://dl.k8s.io/release/v0.0.1/bin/linux/amd64/kubectl*" "$case_calls"
expect_match "the bare SHA-256 file, the pin and the signature are verified" "*release checksum file: OK*pinned SHA-256: OK*signature: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "cosign checks kubectl.sig with kubectl.cert over the binary" "verify-blob --signature */kubectl.sig --certificate */kubectl.cert *kubectl" "$case_cosign_calls"
expect_match "the installed version is reported" "*installed*v0.0.1*" "$case_out"
if [ -n "$identity" ] && grep -qx 'KUBECTL_SIGNER_ISSUER="https://accounts.google.com"' "$installer"; then ok "the signer identity and issuer are pinned in the installer"; else nok "the signer identity and issuer are pinned in the installer"; fi

fail_closed_cases KUBECTL 0.0.1 "$sha" kubectl.sha256 \
  "1111111111111111111111111111111111111111111111111111111111111111" \
  ""
signature_cases KUBECTL 0.0.1 "$sha" "$identity" https://accounts.google.com

if [ "$offline_only" = 1 ]; then
  skip "network: kubectl 1.35.9 installs with its signature verified (--offline-only)"
  finish
fi
net="$work/net-bin"
network_cosign "$net" || nok "network: the pinned cosign installs first" "$(tail -n 2 "$work/network-cosign.log" | tr '\n' ' ')"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$net/kubectl" ]; then ok "network: the pinned kubectl installs"; else nok "network: the pinned kubectl installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
expect_match "network: its signature is verified" "*signature: OK*" "$out"
pinned=$(sed -n 's/^KUBECTL_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: kubectl reports v$pinned" "*Client Version: v$pinned*" "$("$net/kubectl" version --client 2>&1)"
finish
