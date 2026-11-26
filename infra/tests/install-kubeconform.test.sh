#!/usr/bin/env bash
# Test for infra/scripts/install-kubeconform.sh (Workflow 11C scanners-11c; C258.2, C265.3):
# kubeconform 0.8.0 checked against the release's CHECKSUMS and the pin (no signature is
# published), and kubeconform's scripts/openapi2jsonschema.py at the release's commit, checked
# against its own pin and installed beside it (not executable) for scripts/fetch_k8s_schemas.py.
#
# Usage: infra/tests/install-kubeconform.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-kubeconform.sh

asset=kubeconform-linux-amd64.tar.gz
mkdir -p "$work/build"
h_stub_binary "$work/build/kubeconform" "v0.0.1"
printf 'license\n' >"$work/build/LICENSE"
tar -czf "$release/$asset" -C "$work/build" LICENSE kubeconform
sha=$(h_sha256 "$release/$asset")
printf '%s  %s\n%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 kubeconform-linux-arm64.tar.gz "$sha" "$asset" >"$release/CHECKSUMS"
printf '#!/usr/bin/env python3\n# synthetic converter\n' >"$release/openapi2jsonschema.py"
conv_sha=$(h_sha256 "$release/openapi2jsonschema.py")
conv_commit=0123456789abcdef0123456789abcdef01234567
conv=(KUBECONFORM_CONVERTER_COMMIT="$conv_commit" KUBECONFORM_CONVERTER_SHA256="$conv_sha")

run_installer good KUBECONFORM_VERSION=0.0.1 KUBECONFORM_SHA256="$sha" "${conv[@]}"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/kubeconform" ]; then ok "the synthetic release installs kubeconform"; else nok "the synthetic release installs kubeconform" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
if [ -f "$case_dir/bin/openapi2jsonschema.py" ] && [ ! -x "$case_dir/bin/openapi2jsonschema.py" ]; then ok "the schema converter is installed beside it, not executable"; else nok "the schema converter is installed beside it, not executable"; fi
expect_match "kubeconform comes from the release's download path" "*github.com/yannh/kubeconform/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the converter comes from the pinned commit" "*raw.githubusercontent.com/yannh/kubeconform/$conv_commit/scripts/openapi2jsonschema.py*" "$case_calls"
expect_match "the converter's pin is verified" "*openapi2jsonschema.py*pinned SHA-256: OK*" "$(tr '\n' ' ' <<<"$case_out")"
expect_match "the installed version is reported" "*installed*v0.0.1*" "$case_out"

run_installer converter-pin KUBECONFORM_VERSION=0.0.1 KUBECONFORM_SHA256="$sha" KUBECONFORM_CONVERTER_COMMIT="$conv_commit" KUBECONFORM_CONVERTER_SHA256=0000000000000000000000000000000000000000000000000000000000000000
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a converter that does not match its pin installs nothing"; else nok "a converter that does not match its pin installs nothing" "exit $case_rc"; fi
run_installer converter-alone KUBECONFORM_VERSION=0.0.1 KUBECONFORM_SHA256="$sha" KUBECONFORM_CONVERTER_COMMIT="$conv_commit"
if [ "$case_rc" -eq 2 ] && [ -z "$case_calls" ]; then ok "a converter commit without its SHA-256 is refused (exit 2)"; else nok "a converter commit without its SHA-256 is refused (exit 2)" "exit $case_rc"; fi

h_extra=("${conv[@]}")
fail_closed_cases KUBECONFORM 0.0.1 "$sha" CHECKSUMS \
  "1111111111111111111111111111111111111111111111111111111111111111  $asset" \
  "$sha  kubeconform-linux-arm64.tar.gz"
h_extra=()

if [ "$offline_only" = 1 ]; then
  skip "network: kubeconform 0.8.0 and its converter install (--offline-only)"
  finish
fi
net="$work/net-bin"
out=$(INSTALL_DIR="$net" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$net/openapi2jsonschema.py" ]; then ok "network: the pinned kubeconform and converter install"; else nok "network: the pinned kubeconform and converter install" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^KUBECONFORM_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
expect_match "network: kubeconform reports v$pinned" "v$pinned*" "$("$net/kubeconform" -v 2>&1)"
finish
