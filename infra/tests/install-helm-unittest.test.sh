#!/usr/bin/env bash
# Test for infra/scripts/install-helm-unittest.sh (Workflow 11C scanners-11c; C258.2, C265.2): the
# helm-unittest 1.2.1 plugin from its release archive, checked against helm-unittest-checksum.sha
# and the pin (PGP only, so no cosign step), installed by copying plugin.yaml, the linux amd64
# binary and LICENSE into $HELM_PLUGINS/unittest. The archive's downloading install hook is never
# run or copied. Network: the plugin runs a unit test under Helm 4.3.1 and 3.22.1 (spike (b)).
#
# Usage: infra/tests/install-helm-unittest.test.sh [--offline-only]
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"
h_init infra/scripts/install-helm-unittest.sh

asset=helm-unittest-linux-amd64-0.0.1.tgz
mkdir -p "$work/build"
printf 'name: "unittest"\nversion: "0.0.1"\nplatformCommand:\n  - os: linux\n    arch: amd64\n    command: "$HELM_PLUGIN_DIR/untt-linux-amd64"\n' >"$work/build/plugin.yaml"
h_stub_binary "$work/build/untt-linux-amd64" "unittest synthetic"
printf 'license\n' >"$work/build/LICENSE"
printf '#!/bin/sh\necho synthetic-install-hook-ran >&2\nexit 9\n' >"$work/build/install-binary.sh"
chmod 0755 "$work/build/install-binary.sh"
tar -czf "$release/$asset" -C "$work/build" plugin.yaml untt-linux-amd64 LICENSE install-binary.sh
sha=$(h_sha256 "$release/$asset")
printf '%s *./_dist/%s\n%s *./_dist/%s\n' 1111111111111111111111111111111111111111111111111111111111111111 helm-unittest-linux-arm64-0.0.1.tgz "$sha" "$asset" >"$release/helm-unittest-checksum.sha"

run_installer good HELM_UNITTEST_VERSION=0.0.1 HELM_UNITTEST_SHA256="$sha"
plugin="$case_dir/plugins/unittest"
if [ "$case_rc" -eq 0 ] && [ -f "$plugin/plugin.yaml" ] && [ -x "$plugin/untt-linux-amd64" ] && [ -f "$plugin/LICENSE" ]; then
  ok "the plugin's plugin.yaml, binary and LICENSE are copied into \$HELM_PLUGINS/unittest"
else
  nok "the plugin's plugin.yaml, binary and LICENSE are copied into \$HELM_PLUGINS/unittest" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"
fi
if [ ! -e "$plugin/install-binary.sh" ] && [ "$(find "$plugin" -type f | wc -l)" = 3 ]; then ok "the downloading install hook is never copied, and nothing else is"; else nok "the downloading install hook is never copied, and nothing else is" "$(ls "$plugin" 2>&1 | tr '\n' ' ')"; fi
expect_no_match "the install hook never ran" "*synthetic-install-hook-ran*" "$case_out"
expect_match "it is fetched from the release's download path" "*github.com/helm-unittest/helm-unittest/releases/download/v0.0.1/$asset*" "$case_calls"
expect_match "the release checksum file (its ./_dist/ form) is verified" "*release checksum file: OK*" "$case_out"
expect_match "the installed plugin version is reported" "*installed*unittest 0.0.1*" "$case_out"
if [ -z "$case_cosign_calls" ]; then ok "no cosign step (the project signs with PGP only)"; else nok "no cosign step (the project signs with PGP only)"; fi

# An earlier plugin version is replaced as a whole, not merged.
mkdir -p "$work/case-replace-pre/unittest"
printf 'stale\n' >"$work/case-replace-pre/unittest/stale-file"
run_installer replace HELM_UNITTEST_VERSION=0.0.1 HELM_UNITTEST_SHA256="$sha" HELM_PLUGINS="$work/case-replace-pre"
if [ "$case_rc" -eq 0 ] && [ ! -e "$work/case-replace-pre/unittest/stale-file" ] && [ -f "$work/case-replace-pre/unittest/plugin.yaml" ]; then ok "an earlier copy of the plugin is replaced as a whole"; else nok "an earlier copy of the plugin is replaced as a whole" "exit $case_rc"; fi

# Without HELM_PLUGINS, Helm's own answer to `helm env HELM_PLUGINS` is used.
fake_helm="$work/fake-helm"
printf '#!/bin/sh\n[ "$1 $2" = "env HELM_PLUGINS" ] && echo "%s" && exit 0\nexit 1\n' "$work/from-helm-env" >"$fake_helm"
chmod 0755 "$fake_helm"
run_installer helm-env HELM_UNITTEST_VERSION=0.0.1 HELM_UNITTEST_SHA256="$sha" HELM_PLUGINS= HELM_BIN="$fake_helm"
if [ "$case_rc" -eq 0 ] && [ -f "$work/from-helm-env/unittest/plugin.yaml" ]; then ok "without HELM_PLUGINS the plugin goes where \`helm env HELM_PLUGINS\` says"; else nok "without HELM_PLUGINS the plugin goes where \`helm env HELM_PLUGINS\` says" "exit $case_rc: $(tail -n 2 <<<"$case_out" | tr '\n' ' ')"; fi
run_installer no-helm HELM_UNITTEST_VERSION=0.0.1 HELM_UNITTEST_SHA256="$sha" HELM_PLUGINS= HELM_BIN="$work/no-such-helm"
if [ "$case_rc" -eq 2 ] && [ -z "$case_calls" ]; then ok "with neither HELM_PLUGINS nor a Helm to ask, it exits 2 before any download"; else nok "with neither HELM_PLUGINS nor a Helm to ask, it exits 2 before any download" "exit $case_rc"; fi

fail_closed_cases HELM_UNITTEST 0.0.1 "$sha" helm-unittest-checksum.sha \
  "1111111111111111111111111111111111111111111111111111111111111111 *./_dist/$asset" \
  "$sha *./_dist/helm-unittest-linux-arm64-0.0.1.tgz"

if [ "$offline_only" = 1 ]; then
  skip "network: helm-unittest 1.2.1 runs under Helm 4.3.1 and 3.22.1 (--offline-only)"
  finish
fi
net="$work/net-bin"
plugins="$work/net-plugins"
helm_out=$(INSTALL_DIR="$net" bash "$h_repo_root/infra/scripts/install-helm.sh" 2>&1) || nok "network: the pinned Helm releases install first" "$(tail -n 2 <<<"$helm_out" | tr '\n' ' ')"
out=$(INSTALL_DIR="$net" HELM_PLUGINS="$plugins" bash "$installer" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -x "$plugins/unittest/untt-linux-amd64" ]; then ok "network: the pinned plugin installs"; else nok "network: the pinned plugin installs" "exit $rc: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
pinned=$(sed -n 's/^HELM_UNITTEST_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
chart="$work/chart"
mkdir -p "$chart/templates" "$chart/tests"
printf 'apiVersion: v2\nname: probe\nversion: 0.0.1\n' >"$chart/Chart.yaml"
printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: probe\ndata:\n  value: "{{ .Values.value }}"\n' >"$chart/templates/cm.yaml"
printf 'value: synthetic\n' >"$chart/values.yaml"
printf 'suite: probe\ntemplates: [cm.yaml]\ntests:\n  - it: renders the value\n    asserts:\n      - equal: {path: data.value, value: synthetic}\n' >"$chart/tests/cm_test.yaml"
for helm in helm helm3; do
  listed=$(HELM_PLUGINS="$plugins" "$net/$helm" plugin list 2>&1)
  expect_match "network: $helm lists unittest $pinned" "*unittest*$pinned*" "$listed"
  if run=$(HELM_PLUGINS="$plugins" "$net/$helm" unittest "$chart" 2>&1); then ok "network: a unit test passes under $helm"; else nok "network: a unit test passes under $helm" "$(tail -n 3 <<<"$run" | tr '\n' ' ')"; fi
done
finish
