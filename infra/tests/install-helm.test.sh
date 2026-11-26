#!/usr/bin/env bash
# Test for infra/scripts/install-helm.sh (Workflow 11C scanners-11c; C258.2, C265.1): Helm 4.3.1 as
# `helm` and Helm 3.22.1 as `helm3`, side by side, each checked against its .sha256sum from
# get.helm.sh and its pin (Helm signs with PGP only, so no cosign step). Both are verified before
# either is installed, so a failure in one leaves nothing behind.
#
# Usage: infra/tests/install-helm.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-helm.sh

# Synthetic releases: 0.0.4 stands for Helm 4, 0.0.3 for Helm 3.
for v in 0.0.4 0.0.3; do
  mkdir -p "$work/build-$v/linux-amd64"
  h_stub_binary "$work/build-$v/linux-amd64/helm" "v$v+gsynthetic"
  printf 'license\n' >"$work/build-$v/linux-amd64/LICENSE"
  tar -czf "$release/helm-v$v-linux-amd64.tar.gz" -C "$work/build-$v" linux-amd64
  printf '%s  %s\n' "$(h_sha256 "$release/helm-v$v-linux-amd64.tar.gz")" "helm-v$v-linux-amd64.tar.gz" >"$release/helm-v$v-linux-amd64.tar.gz.sha256sum"
done
sha4=$(h_sha256 "$release/helm-v0.0.4-linux-amd64.tar.gz")
sha3=$(h_sha256 "$release/helm-v0.0.3-linux-amd64.tar.gz")
pins4=(HELM4_VERSION=0.0.4 HELM4_SHA256="$sha4")
pins3=(HELM3_VERSION=0.0.3 HELM3_SHA256="$sha3")

run_installer good "${pins4[@]}" "${pins3[@]}"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/helm" ] && [ -x "$case_dir/bin/helm3" ]; then ok "both releases install, as helm and helm3"; else nok "both releases install, as helm and helm3" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "helm is the Helm 4 release" "v0.0.4*" "$("$case_dir/bin/helm" version --short 2>&1)"
expect_match "helm3 is the Helm 3 release" "v0.0.3*" "$("$case_dir/bin/helm3" version --short 2>&1)"
expect_match "both come from get.helm.sh" "*https://get.helm.sh/helm-v0.0.4-linux-amd64.tar.gz*https://get.helm.sh/helm-v0.0.3-linux-amd64.tar.gz*" "$(tr '\n' ' ' <<<"$case_calls")"
expect_match "each .sha256sum and pin is verified" "*release checksum file: OK*pinned SHA-256: OK*release checksum file: OK*pinned SHA-256: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "both installed versions are reported" "*installed*v0.0.4*v0.0.3*" "$(tr '\n' ' ' <<<"$case_out")"

# The shared fail-closed cases on Helm 4's pins, then on Helm 3's.
h_extra=("${pins3[@]}")
fail_closed_cases HELM4 0.0.4 "$sha4" helm-v0.0.4-linux-amd64.tar.gz.sha256sum \
  "1111111111111111111111111111111111111111111111111111111111111111  helm-v0.0.4-linux-amd64.tar.gz" \
  "$sha4  helm-v0.0.4-linux-arm64.tar.gz"
h_extra=("${pins4[@]}")
run_installer helm3-wrong-pin "${pins4[@]}" HELM3_VERSION=0.0.3 HELM3_SHA256=0000000000000000000000000000000000000000000000000000000000000000
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a wrong Helm 3 pin installs neither Helm"; else nok "a wrong Helm 3 pin installs neither Helm" "exit $case_rc"; fi
run_installer helm3-alone "${pins4[@]}" HELM3_VERSION=0.0.3
if [ "$case_rc" -eq 2 ] && nothing_installed; then ok "a Helm 3 version without its SHA-256 is refused (exit 2)"; else nok "a Helm 3 version without its SHA-256 is refused (exit 2)" "exit $case_rc"; fi
h_extra=()

if [ "$offline_only" = 1 ]; then
  skip "network: Helm 4.3.1 and 3.22.1 install (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ]; then ok "network: the pinned Helm releases install"; else nok "network: the pinned Helm releases install" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
v4=$(sed -n 's/^HELM4_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
v3=$(sed -n 's/^HELM3_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: helm reports $v4" "v$v4+*" "$("$net/helm" version --short 2>&1)"
expect_match "network: helm3 reports $v3" "v$v3+*" "$("$net/helm3" version --short 2>&1)"
finish
