#!/usr/bin/env bash
# Contract test for deploy/helm/openverify/ci/chart-checks.sh (Workflow 11C chart-policy-11c; C265.1-C265.3,
# C259.1's chart step): over stand-in tools that log their arguments, each subcommand runs what it
# names, on every values set (the defaults, each ci/*-values.yaml, each ci/lint/*-values.yaml, and
# ci/kind-values.yaml with ci/upgrade/kind-upgrade-values.yaml), and fails closed.
#
#   lint         helm lint --strict with Helm 4 and Helm 3 over every values set
#   unittest     helm unittest with Helm 4 and Helm 3
#   kubeconform  the rendered sets, -strict, offline, against the Kubernetes 1.35.9, 1.36.5 and
#                1.37.1 bundles of scripts/fetch_k8s_schemas.py (the same pins)
#   trivy        Trivy config over the rendered sets with the checks bundle pinned by digest,
#                failing at high, with only unexpired security/allowlist.yaml entries for the chart
#   all          the four in that order, every one run, failing when one fails
#
# Usage: deploy/helm/openverify/ci/tests/chart-checks.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
script="$repo_root/deploy/helm/openverify/ci/chart-checks.sh"
passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed, 0 skipped\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}
expect_rc() { if [ "$rc" -eq "$2" ]; then ok "$1"; else nok "$1" "exit $rc, expected $2: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi; }
# shellcheck disable=SC2053 # the second argument is a glob pattern on purpose
expect_match() { if [[ $3 == $2 ]]; then ok "$1"; else nok "$1" "$(head -c 400 <<<"$3")"; fi; }
expect_no_match() { if [[ $3 == $2 ]]; then nok "$1" "$(head -c 400 <<<"$3")"; else ok "$1"; fi; }

if [ -f "$script" ]; then ok "chart-checks.sh exists"; else nok "chart-checks.sh exists"; finish; fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tools="$work/bin"
mkdir -p "$tools"
calls="$work/calls"

# A stand-in tool: logs "<name> <args>", prints a small manifest for `helm template`, and exits with
# FAKE_RC_<name>_<first argument> (default 0).
fake() {
  cat >"$tools/$1" <<'EOF'
#!/usr/bin/env bash
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >>"$CALLS"
if [ "${1:-}" = template ]; then printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: rendered\n'; fi
var="FAKE_RC_${name//[^A-Za-z0-9]/_}_${1//[^A-Za-z0-9]/_}"
exit "${!var:-0}"
EOF
  chmod +x "$tools/$1"
}
for tool in helm helm3 kubeconform trivy; do fake "$tool"; done
# The schema fetcher: records its call, and prints a location for --print-location.
cat >"$work/fetch.py" <<'EOF'
import sys
args = sys.argv[1:]
with open(__import__("os").environ["CALLS"], "a", encoding="utf-8") as fh:
    fh.write("fetch " + " ".join(args) + "\n")
if "--print-location" in args:
    print("SCHEMAS/" + args[args.index("--print-location") + 1] + "/{{ .ResourceKind }}.json")
EOF

chart="$work/chart"
mkdir -p "$chart/ci/lint" "$chart/ci/upgrade" "$chart/ci/fixtures"
printf 'apiVersion: v2\nname: openverify\nversion: 0.1.0\n' >"$chart/Chart.yaml"
printf 'a: 1\n' >"$chart/ci/kind-values.yaml"
printf 'b: 1\n' >"$chart/ci/lint/full-values.yaml"
printf 'c: 1\n' >"$chart/ci/upgrade/kind-upgrade-values.yaml"
printf 'kind: Namespace\n' >"$chart/ci/fixtures/not-values.yaml"
allowlist="$work/allowlist.yaml"
printf '[]\n' >"$allowlist"
mkdir -p "$chart/files"
printf '{"models": []}\n' >"$work/manifest.json"
cp "$work/manifest.json" "$chart/files/models-manifest.json"

run() {
  : >"$calls"
  out=$(env CALLS="$calls" CHART_DIR="$chart" CHART_CHECKS_TOOLS_DIR="$tools" FETCH_K8S_SCHEMAS="$work/fetch.py" \
    K8S_SCHEMAS_DIR="$work/schemas" ALLOWLIST="$allowlist" MODELS_MANIFEST="$work/manifest.json" "$@" bash "$script" "${args[@]}" 2>&1)
  rc=$?
  log=$(cat "$calls")
}

args=(nothing)
run
expect_rc "an unknown subcommand is a usage error" 2
expect_match "the usage lists the subcommands" "*lint*unittest*kubeconform*trivy*all*" "$out"

# lint
args=(lint)
run
expect_rc "lint passes when every helm lint passes" 0
for h in helm helm3; do
  expect_match "lint: $h lints the defaults strictly" "*$h lint --strict $chart"$'\n'"*" "$log"$'\n'
  expect_match "lint: $h lints ci/kind-values.yaml" "*$h lint --strict $chart -f $chart/ci/kind-values.yaml"$'\n'"*" "$log"$'\n'
  expect_match "lint: $h lints ci/lint/full-values.yaml" "*$h lint --strict $chart -f $chart/ci/lint/full-values.yaml*" "$log"
  expect_match "lint: $h lints the kind values with the upgrade's overlay" "*$h lint --strict $chart -f $chart/ci/kind-values.yaml -f $chart/ci/upgrade/kind-upgrade-values.yaml*" "$log"
done
expect_no_match "lint: ci/fixtures/ is no values set" "*fixtures*" "$log"
args=(lint)
run FAKE_RC_helm3_lint=1
expect_rc "lint fails when Helm 3's lint fails" 1
expect_match "lint: the failure names the Helm and the values set" "*helm3*lint*failed*" "$out"

printf '{"models": [{"name": "changed"}]}\n' >"$chart/files/models-manifest.json"
args=(lint)
run
expect_rc "lint fails when the chart's models manifest is not a byte copy of models/manifest.json" 1
expect_match "the message names both files" "*files/models-manifest.json*models/manifest.json*" "$out"
cp "$work/manifest.json" "$chart/files/models-manifest.json"

# unittest
args=(unittest)
run
expect_rc "unittest passes when both pass" 0
expect_match "unittest: Helm 4 runs the unit tests" "*helm unittest $chart*" "$log"
expect_match "unittest: Helm 3 runs the unit tests" "*helm3 unittest $chart*" "$log"
run FAKE_RC_helm_unittest=1
expect_rc "unittest fails when Helm 4's unit tests fail" 1

# kubeconform
args=(kubeconform)
run
expect_rc "kubeconform passes when every set validates" 0
expect_match "kubeconform: the bundle is fetched (or found) by scripts/fetch_k8s_schemas.py" "*fetch --dest $work/schemas*" "$log"
for minor in 1.35 1.36 1.37; do
  expect_match "kubeconform: $minor's location comes from the fetcher" "*fetch --dest $work/schemas --print-location $minor*" "$log"
done
for version in 1.35.9 1.36.5 1.37.1; do
  minor=${version%.*}
  expect_match "kubeconform: $version strictly, offline, against its bundle" "*kubeconform -strict -summary -kubernetes-version $version -schema-location SCHEMAS/$minor/{{ .ResourceKind }}.json *" "$log"
done
count=$(grep -c '^kubeconform ' <<<"$log")
if [ "$count" = 12 ]; then ok "kubeconform: four values sets times three versions"; else nok "kubeconform: four values sets times three versions" "$count"; fi
expect_no_match "kubeconform: never the default (network) schema location" "*-schema-location default*" "$log"
expect_no_match "kubeconform: never skips a kind or ignores a missing schema" "*-ignore-missing-schemas*" "$log"
pins=$(python3 -I -c 'import importlib.util,sys;s=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);sys.modules["f"]=m;s.loader.exec_module(m);print(" ".join(r.version for r in m.KUBERNETES_RELEASES.values()))' "$repo_root/scripts/fetch_k8s_schemas.py")
script_versions=$(sed -n 's/^kube_versions="\(.*\)"$/\1/p' "$script")
if [ "$(tr ' ' '\n' <<<"$pins" | sed '/^$/d' | sort | tr '\n' ' ')" = "$(tr ' ' '\n' <<<"$script_versions" | sed '/^$/d' | sort | tr '\n' ' ')" ]; then ok "kubeconform: the versions are scripts/fetch_k8s_schemas.py's pins"; else nok "kubeconform: the versions are scripts/fetch_k8s_schemas.py's pins" "$pins / $script_versions"; fi
run FAKE_RC_kubeconform__strict=1
expect_rc "kubeconform fails when a set is invalid" 1

# trivy
bundle=$(sed -n 's/^TRIVY_CHECKS_BUNDLE_DEFAULT="\(.*\)"$/\1/p' "$repo_root/infra/scripts/install-trivy.sh")
args=(trivy)
run
expect_rc "trivy passes when Trivy finds nothing at high" 0
expect_match "trivy: config with the checks bundle pinned by digest, failing at high" "*trivy config --quiet --checks-bundle-repository $bundle --severity HIGH,CRITICAL --exit-code 1 --ignorefile *" "$log"
if [ "$(grep -c '^helm template ' <<<"$log")" = 4 ]; then ok "trivy: renders the four values sets"; else nok "trivy: renders the four values sets" "$log"; fi
run FAKE_RC_trivy_config=1
expect_rc "trivy fails on a finding at high" 1
today=$(date -u +%F)
later=$(date -u -d '+30 days' +%F)
earlier=$(date -u -d '-1 day' +%F)
cat >"$allowlist" <<EOF
- id: AVD-KSV-0999
  path: deploy/helm/openverify
  reason: a synthetic chart finding for the contract test
  expires: '$later'
  added-by: chart-policy-11c
- id: AVD-KSV-0998
  path: deploy/helm/openverify/templates
  reason: a synthetic expired chart finding for the contract test
  expires: '$earlier'
  added-by: chart-policy-11c
- id: CVE-2026-0001
  package: example
  reason: a synthetic package finding that is not the chart's
  expires: '$later'
  added-by: chart-policy-11c
EOF
cat >"$tools/trivy" <<'EOF'
#!/usr/bin/env bash
printf 'trivy %s\n' "$*" >>"$CALLS"
while [ $# -gt 0 ]; do
  if [ "$1" = --ignorefile ]; then printf 'ignore:%s\n' "$(tr '\n' ' ' <"$2")" >>"$CALLS"; fi
  shift
done
EOF
chmod +x "$tools/trivy"
args=(trivy)
run
expect_match "trivy: an unexpired chart entry of the allowlist is ignored" "*ignore:*AVD-KSV-0999*" "$log"
expect_no_match "trivy: an expired entry is not" "*ignore:*AVD-KSV-0998*" "$log"
expect_no_match "trivy: a package entry is not the chart's" "*ignore:*CVE-2026-0001*" "$log"
: "$today"
fake trivy
printf '[]\n' >"$allowlist"

# all
args=(all)
run
expect_rc "all passes when the four pass" 0
order=$(grep -oE '^(helm lint|helm unittest|kubeconform|trivy config)' <<<"$log" | uniq | tr '\n' ',')
expect_match "all: lint, unittest, kubeconform, trivy, in order" "helm lint,helm unittest,kubeconform,trivy config,*" "$order"
run FAKE_RC_helm_unittest=1
expect_rc "all fails when one subcommand fails" 1
expect_match "all: the later subcommands still run" "*trivy config*" "$log"

# A missing tool fails closed and names its installer.
rm "$tools/kubeconform"
args=(kubeconform)
run
expect_rc "a missing tool fails closed" 1
expect_match "the message names the installer" "*infra/scripts/install-kubeconform.sh*" "$out"
finish
