#!/usr/bin/env bash
# The chart's checks (Workflow 11C chart-policy-11c; C265.1-C265.3), run by
# infra/scripts/supply-chain.sh's `chart` step, release.yml and the local Validation:
#
#   chart-checks.sh lint         helm lint --strict with Helm 4.3.1 and Helm 3.22.1 over every values set
#   chart-checks.sh unittest     helm unittest (helm-unittest 1.2.1) under both Helms
#   chart-checks.sh kubeconform  each rendered set, -strict and offline, against the Kubernetes 1.35.9,
#                                1.36.5 and 1.37.1 bundles that scripts/fetch_k8s_schemas.py generates
#                                (a bundle already present is checked, not fetched)
#   chart-checks.sh trivy        Trivy config over the rendered sets with the checks bundle pinned by
#                                digest, failing at high; only the unexpired security/allowlist.yaml
#                                entries for the chart are ignored
#   chart-checks.sh all          the four in that order, every one run; fails when one fails
#
# The values sets: the defaults, each ci/*-values.yaml (ct install's), each ci/lint/*-values.yaml
# (rendered and checked, never installed) and ci/kind-values.yaml with ci/upgrade/kind-upgrade-values.yaml
# (the kind upgrade). The tools come from CHART_CHECKS_TOOLS_DIR (else SUPPLY_CHAIN_TOOLS_DIR, else
# ~/.local/bin), where infra/scripts/install-<tool>.sh puts them; a missing tool fails closed.
# A clean result means these tools found nothing they check for in what they could see, not a review.
#
# Exit codes: 0 pass, 1 a check failed or a tool is missing, 2 usage.
set -uo pipefail

usage() {
  printf 'usage: %s lint|unittest|kubeconform|trivy|all\n' "${0##*/}" >&2
  exit 2
}
[ $# -eq 1 ] || usage
case "$1" in lint | unittest | kubeconform | trivy | all) ;; *) usage ;; esac

chart=${CHART_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
tools=${CHART_CHECKS_TOOLS_DIR:-${SUPPLY_CHAIN_TOOLS_DIR:-$HOME/.local/bin}}
fetch_k8s_schemas=${FETCH_K8S_SCHEMAS:-$repo_root/scripts/fetch_k8s_schemas.py}
schemas_dir=${K8S_SCHEMAS_DIR:-$repo_root/data/k8s-schemas}
allowlist=${ALLOWLIST:-$repo_root/security/allowlist.yaml}
models_manifest=${MODELS_MANIFEST:-$repo_root/models/manifest.json}
trivy_bundle=${TRIVY_CHECKS_BUNDLE:-$(sed -n 's/^TRIVY_CHECKS_BUNDLE_DEFAULT="\(.*\)"$/\1/p' "$repo_root/infra/scripts/install-trivy.sh")}
# scripts/fetch_k8s_schemas.py's pins (ci/tests/chart-checks.test.sh holds them equal).
kube_versions="1.35.9 1.36.5 1.37.1"
release=openverify
namespace=openverify

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# tool <name> <installer>: the binary's path, or a closed failure naming its installer.
tool() {
  if [ -x "$tools/$1" ]; then
    printf '%s\n' "$tools/$1"
  else
    printf 'chart-checks: %s is not in %s; install it with infra/scripts/install-%s.sh\n' "$1" "$tools" "$2" >&2
    return 1
  fi
}

# The values sets, one per line: a label, a tab, then the -f arguments.
values_sets() {
  printf 'defaults\t\n'
  local file
  for file in "$chart"/ci/*-values.yaml "$chart"/ci/lint/*-values.yaml; do
    [ -f "$file" ] || continue
    printf '%s\t-f %s\n' "${file#"$chart"/}" "$file"
  done
  if [ -f "$chart/ci/kind-values.yaml" ] && [ -f "$chart/ci/upgrade/kind-upgrade-values.yaml" ]; then
    printf 'ci/kind-values.yaml+ci/upgrade/kind-upgrade-values.yaml\t-f %s -f %s\n' \
      "$chart/ci/kind-values.yaml" "$chart/ci/upgrade/kind-upgrade-values.yaml"
  fi
}

step_lint() {
  local helm label flags rc=0
  # The chart's copy of the models manifest names the models directory by its SHA-256 (C263.5).
  if ! cmp -s "$models_manifest" "$chart/files/models-manifest.json"; then
    printf 'chart-checks: %s is not a byte copy of models/manifest.json (%s); copy it: its SHA-256 names /models/<digest>\n' \
      "$chart/files/models-manifest.json" "$models_manifest" >&2
    rc=1
  fi
  for name in helm helm3; do
    helm=$(tool "$name" helm) || return 1
    while IFS=$'\t' read -r label flags; do
      # shellcheck disable=SC2086 # flags are -f <path> pairs without spaces in the paths
      if ! "$helm" lint --strict "$chart" $flags; then
        printf 'chart-checks: %s lint failed on %s\n' "$name" "$label" >&2
        rc=1
      fi
    done < <(values_sets)
  done
  return "$rc"
}

step_unittest() {
  local helm rc=0
  for name in helm helm3; do
    helm=$(tool "$name" helm) || return 1
    if ! "$helm" unittest "$chart"; then
      printf 'chart-checks: %s unittest failed\n' "$name" >&2
      rc=1
    fi
  done
  return "$rc"
}

# render <dir>: each values set rendered with Helm 4 into <dir>/<n>.yaml.
render() {
  local helm label flags n=0
  helm=$(tool helm helm) || return 1
  mkdir -p "$1"
  while IFS=$'\t' read -r label flags; do
    n=$((n + 1))
    # shellcheck disable=SC2086
    if ! "$helm" template "$release" "$chart" --namespace "$namespace" $flags >"$1/$n.yaml"; then
      printf 'chart-checks: helm template failed on %s\n' "$label" >&2
      return 1
    fi
    printf '%s\n' "$label" >"$1/$n.label"
  done < <(values_sets)
}

step_kubeconform() {
  local kubeconform version minor location file rc=0
  kubeconform=$(tool kubeconform kubeconform) || return 1
  python3 -I "$fetch_k8s_schemas" --dest "$schemas_dir" || {
    printf 'chart-checks: the Kubernetes schema bundles are not in place (scripts/fetch_k8s_schemas.py)\n' >&2
    return 1
  }
  render "$work/kubeconform" || return 1
  for version in $kube_versions; do
    minor=${version%.*}
    location=$(python3 -I "$fetch_k8s_schemas" --dest "$schemas_dir" --print-location "$minor") || return 1
    for file in "$work"/kubeconform/*.yaml; do
      if ! "$kubeconform" -strict -summary -kubernetes-version "$version" -schema-location "$location" "$file"; then
        printf 'chart-checks: kubeconform %s failed on %s\n' "$version" "$(cat "${file%.yaml}.label")" >&2
        rc=1
      fi
    done
  done
  return "$rc"
}

# The unexpired allowlist entries for the chart's Trivy findings (an id of a Trivy check, a path in
# the chart); security/allowlist.yaml's own rules (reason, 90 days) are supply-chain.sh's shared check.
trivy_ignores() {
  python3 -I - "$allowlist" <<'PY'
import datetime
import re
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as fh:
    entries = yaml.safe_load(fh) or []
today = datetime.datetime.now(datetime.timezone.utc).date()  # expiry dates are UTC days
for entry in entries:
    expires = entry.get("expires")
    if isinstance(expires, str):
        expires = datetime.date.fromisoformat(expires)
    path = str(entry.get("path", ""))
    if (
        re.match(r"^(AVD-)?KSV-?[0-9]+$", str(entry.get("id", "")))
        and (path == "deploy/helm/openverify" or path.startswith("deploy/helm/openverify/"))
        and isinstance(expires, datetime.date)
        and expires >= today
    ):
        print(entry["id"])
PY
}

step_trivy() {
  local trivy
  trivy=$(tool trivy trivy) || return 1
  [ -n "$trivy_bundle" ] || {
    printf 'chart-checks: no Trivy checks bundle pin (infra/scripts/install-trivy.sh)\n' >&2
    return 1
  }
  render "$work/trivy" || return 1
  rm -f "$work"/trivy/*.label
  trivy_ignores >"$work/trivyignore" || return 1
  if ! "$trivy" config --quiet --checks-bundle-repository "$trivy_bundle" --severity HIGH,CRITICAL \
    --exit-code 1 --ignorefile "$work/trivyignore" "$work/trivy"; then
    printf 'chart-checks: Trivy config found a high or critical misconfiguration\n' >&2
    return 1
  fi
}

run_step() {
  local started rc
  started=$(date +%s)
  "step_$1"
  rc=$?
  printf 'chart-checks: %s %s in %ss\n' "$1" "$([ "$rc" -eq 0 ] && echo passed || echo FAILED)" "$(($(date +%s) - started))"
  return "$rc"
}

if [ "$1" = all ]; then
  status=0
  for step in lint unittest kubeconform trivy; do
    run_step "$step" || status=1
  done
  exit "$status"
fi
run_step "$1"
