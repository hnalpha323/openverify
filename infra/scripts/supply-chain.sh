#!/usr/bin/env bash
# The supply-chain checks (C259.1-C259.4, C267.2; Workflow 11C scanners-11c): one script for the
# per-push supply-chain job and for a local run before a push, one subcommand per step.
#
#   osv           osv-scanner over pnpm-lock.yaml, services/vision/uv.lock, load/uv.lock (11D's;
#                 skipped with a notice while absent), security/pip-audit/uv.lock,
#                 security/python/uv.lock, every android/**/*.lockfile (the demo's three combination
#                 lockfiles and both settings lockfiles through the Gradle lockfile parser) and both
#                 verification-metadata.xml files
#   pnpm-audit    pnpm audit --json (gated here at high, as --audit-level high would), then
#                 pnpm audit signatures (the registry's signatures against the lockfile's integrity)
#   pip-audit     pip-audit from security/pip-audit's hashed lockfile over
#                 `uv export --frozen --format requirements-txt` of services/vision and load/, with
#                 --require-hashes --disable-pip --no-deps
#   zizmor        zizmor over .github/workflows/ and .github/actions/, offline, failing at medium
#                 (actionlint runs in infra/tests/ci-workflow.test.sh)
#   trivy-config  Trivy config over infra/ and the chart rendered by helm template, failing at high,
#                 with the checks bundle pinned by digest in install-trivy.sh
#   chart         deploy/helm/openverify/ci/chart-checks.sh all (chart-policy-11c's: lint on both Helms,
#                 the unit tests, the schema checks)
#   pii           gitleaks with security/gitleaks-pii.toml and its reviewed allowlist, through
#                 security/gitleaks-pii-filter.py (sast-pii-11c's)
#   allowlist     security/allowlist.yaml against its schema and the 90-day expiry rule
#   all           every step above in that order; each runs whatever the one before returned
#
# The gate (C259.2; infra/scripts/lib/supply-chain-gate.py): every critical or high finding, and one
# the scanner gives no severity, fails unless security/allowlist.yaml holds an unexpired entry for
# it with its reason; an expired entry, or one more than 90 days ahead, fails every step; medium and
# low findings go to the step summary. Two more entry points serve release.yml's image scans:
#   supply-chain.sh gate <format> [--fail-at high|medium] [<prefix>=]<report.json>...
#   supply-chain.sh db-age <trivy-version|grype-status> <json>   (refused when older than 24 hours)
#
# Network (C259.3): osv-scanner, pnpm audit and pip-audit query OSV, the npm registry and PyPI live
# at run time, read-only and without credentials, so their view is fresh by construction; Trivy
# config uses no vulnerability database. Nothing secret may be in the environment: a set
# GITHUB_TOKEN, GH_TOKEN, NPM_TOKEN or NODE_AUTH_TOKEN is refused. This is a check, never a test:
# infra/tests/supply-chain.test.sh tests it offline over recorded reports.
#
# Honesty (C259.5): a scanner finds known, published weaknesses in what it can see; a clean run is
# not a security review.
#
# Exit status: 0 pass; 1 findings (or a scanner that failed); 2 usage (an unknown step, a missing
# tool, a token in the environment); 3 a step whose owner's files are not built yet. `all` exits
# with the highest status of its steps.
#
# Env: SUPPLY_CHAIN_TOOLS_DIR (the installed scanners, default ~/.local/bin, filled by
# infra/scripts/install-<tool>.sh); GITHUB_STEP_SUMMARY (the summary file; stdout when unset);
# SUPPLY_CHAIN_PYTHON (an interpreter with PyYAML; default python3 when it has it, else
# security/python's environment). Test-only overrides: SUPPLY_CHAIN_ALLOWLIST, SUPPLY_CHAIN_TODAY,
# SUPPLY_CHAIN_NOW, SUPPLY_CHAIN_CHART_CHECKS, SUPPLY_CHAIN_PII_CONFIG, SUPPLY_CHAIN_PII_FILTER.
set -uo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tools="${SUPPLY_CHAIN_TOOLS_DIR:-$HOME/.local/bin}"
allowlist="${SUPPLY_CHAIN_ALLOWLIST:-$repo/security/allowlist.yaml}"
schema="$repo/security/allowlist.schema.json"
gate_py="$repo/infra/scripts/lib/supply-chain-gate.py"
chart_checks="${SUPPLY_CHAIN_CHART_CHECKS:-$repo/deploy/helm/openverify/ci/chart-checks.sh}"
pii_config="${SUPPLY_CHAIN_PII_CONFIG:-$repo/security/gitleaks-pii.toml}"
pii_filter="${SUPPLY_CHAIN_PII_FILTER:-$repo/security/gitleaks-pii-filter.py}"
steps=(osv pnpm-audit pip-audit zizmor trivy-config chart pii allowlist)

usage() {
  echo "usage: infra/scripts/supply-chain.sh <step>|all   (steps: ${steps[*]})" >&2
  echo "       infra/scripts/supply-chain.sh gate <format> [--fail-at high|medium] [<prefix>=]<report.json>..." >&2
  echo "       infra/scripts/supply-chain.sh db-age <trivy-version|grype-status> <json>" >&2
}
say() { printf 'supply-chain: %s\n' "$*"; }
notice() {
  say "$*"
  summary_line "$*"
}
summary_line() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi
}

# The interpreter that runs the gate: it needs PyYAML for the allowlist.
python_cmd=()
pick_python() {
  if [ ${#python_cmd[@]} -gt 0 ]; then return 0; fi
  if [ -n "${SUPPLY_CHAIN_PYTHON:-}" ]; then
    python_cmd=("$SUPPLY_CHAIN_PYTHON" -I)
  elif python3 -I -c 'import yaml' >/dev/null 2>&1; then
    python_cmd=(python3 -I)
  elif [ -x "$repo/security/python/.venv/bin/python" ]; then
    python_cmd=("$repo/security/python/.venv/bin/python" -I)
  else
    python_cmd=(uv run --project "$repo/security/python" --frozen --quiet python -I)
  fi
}
gate() { # gate <label> <gate.py arguments...>
  local label=$1
  shift
  pick_python
  local now_args=()
  if [ -n "${SUPPLY_CHAIN_TODAY:-}" ]; then now_args+=(--today "$SUPPLY_CHAIN_TODAY"); fi
  if [ -n "${SUPPLY_CHAIN_NOW:-}" ]; then now_args+=(--now "$SUPPLY_CHAIN_NOW"); fi
  "${python_cmd[@]}" "$gate_py" --allowlist "$allowlist" --schema "$schema" --label "$label" \
    ${GITHUB_STEP_SUMMARY:+--summary "$GITHUB_STEP_SUMMARY"} ${now_args[@]+"${now_args[@]}"} "$@"
}

refuse_tokens() {
  local name
  for name in GITHUB_TOKEN GH_TOKEN NPM_TOKEN NODE_AUTH_TOKEN; do
    if [ -n "${!name:-}" ]; then
      echo "supply-chain: $name is set; nothing secret may be in the supply-chain environment (C259.3)" >&2
      return 2
    fi
  done
}
need_tool() { # need_tool <name> <installer>: sets tool_path
  tool_path="$tools/$1"
  if [ ! -x "$tool_path" ]; then
    echo "supply-chain: $1 is not installed in $tools; run infra/scripts/$2 (INSTALL_DIR=$tools)" >&2
    return 2
  fi
}
# One private temporary directory for the run, removed on exit; each step takes its own inside it.
run_tmp=$(mktemp -d)
chmod 0700 "$run_tmp"
# shellcheck disable=SC2064 # expand now: the path is fixed
trap "rm -rf '$run_tmp'" EXIT
scratch() { step_tmp=$(mktemp -d "$run_tmp/step.XXXXXX"); }
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

step_osv() {
  need_tool osv-scanner install-osv-scanner.sh || return 2
  local args=() f name
  for f in pnpm-lock.yaml services/vision/uv.lock security/pip-audit/uv.lock security/python/uv.lock; do
    if [ ! -f "$repo/$f" ]; then
      say "FAIL $f is missing"
      return 1
    fi
    args+=(-L "$repo/$f")
  done
  if [ -f "$repo/load/uv.lock" ]; then
    args+=(-L "$repo/load/uv.lock")
  else
    notice "load/uv.lock does not exist yet (Workflow 11D's load/): skipped"
  fi
  while IFS= read -r f; do
    name=$(basename "$f")
    if [ "$name" = gradle.lockfile ]; then args+=(-L "$f"); else args+=(-L "gradle.lockfile:$f"); fi
  done < <(find "$repo/android" \( -name build -o -name .gradle -o -name .kotlin \) -prune -o -type f -name '*.lockfile' -print | LC_ALL=C sort)
  for f in android/gradle/verification-metadata.xml android/consumer-check/gradle/verification-metadata.xml; do
    if [ ! -f "$repo/$f" ]; then
      say "FAIL $f is missing"
      return 1
    fi
    args+=(-L "$repo/$f")
  done
  scratch
  local rc=0
  "$tool_path" scan source "${args[@]}" --format json --output-file "$step_tmp/osv.json" >"$step_tmp/osv.log" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
    tail -n 20 "$step_tmp/osv.log"
    say "FAIL osv-scanner exited $rc"
    return 1
  fi
  grep -E '^Scanned ' "$step_tmp/osv.log" | sed "s#$repo/##"
  notice "OSV: the OSV API was queried live at $(now_utc) for $((${#args[@]} / 2)) lockfiles (no local database)"
  gate osv gate osv --fail-at high --root "$repo/" "$step_tmp/osv.json"
}

step_pnpm_audit() {
  scratch
  local rc=0
  (cd "$repo" && pnpm audit --json) >"$step_tmp/audit.json" 2>"$step_tmp/audit.err" || rc=$?
  notice "pnpm audit: the npm registry's advisories were queried live at $(now_utc)"
  if ! gate pnpm-audit gate pnpm-audit --fail-at high "$step_tmp/audit.json"; then
    if [ "$rc" -gt 1 ]; then tail -n 5 "$step_tmp/audit.err"; fi
    rc=1
  else
    rc=0
  fi
  if (cd "$repo" && pnpm audit signatures) >"$step_tmp/sig.log" 2>&1; then
    tail -n 3 "$step_tmp/sig.log"
    notice "pnpm audit signatures: every package's registry signature verified"
  else
    tail -n 20 "$step_tmp/sig.log"
    notice "pnpm audit signatures: FAILED"
    rc=1
  fi
  return "$rc"
}

step_pip_audit() {
  scratch
  local project reports=() rc
  for project in services/vision load; do
    if [ ! -f "$repo/$project/uv.lock" ]; then
      notice "$project/ has no uv.lock yet (Workflow 11D's load/): skipped"
      continue
    fi
    (cd "$repo/$project" && uv export --frozen --format requirements-txt --no-emit-project -o "$step_tmp/${project//\//-}.txt") >/dev/null || {
      say "FAIL uv export of $project failed"
      return 1
    }
    rc=0
    (cd "$repo" && uv run --project "$repo/security/pip-audit" --frozen pip-audit --require-hashes --disable-pip --no-deps \
      -r "$step_tmp/${project//\//-}.txt" --format json --output "$step_tmp/${project//\//-}.json") >"$step_tmp/pa.log" 2>&1 || rc=$?
    if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
      tail -n 20 "$step_tmp/pa.log"
      say "FAIL pip-audit exited $rc for $project"
      return 1
    fi
    reports+=("$project/=$step_tmp/${project//\//-}.json")
  done
  notice "pip-audit: PyPI's vulnerability service was queried live at $(now_utc); pip-audit gives no severity, so every finding fails closed unless allowlisted"
  gate pip-audit gate pip-audit --fail-at high "${reports[@]}"
}

step_zizmor() {
  need_tool zizmor install-zizmor.sh || return 2
  scratch
  local rc=0
  "$tool_path" --offline --format json "$repo/.github/workflows" "$repo/.github/actions" >"$step_tmp/zizmor.json" 2>"$step_tmp/zizmor.log" || rc=$?
  # zizmor exits 10-14 for findings by their highest severity; anything else non-zero is its failure.
  if [ "$rc" -ne 0 ] && { [ "$rc" -lt 10 ] || [ "$rc" -gt 14 ]; }; then
    tail -n 20 "$step_tmp/zizmor.log"
    say "FAIL zizmor exited $rc"
    return 1
  fi
  notice "zizmor: offline audits only (no token in this job, C259.3): impostor-commit, ref-confusion, known-vulnerable-actions and the other online audits did not run"
  gate zizmor gate zizmor --fail-at medium --root "$repo/" "$step_tmp/zizmor.json"
}

step_trivy_config() {
  need_tool trivy install-trivy.sh || return 2
  local helm_bin="$tools/helm"
  if [ ! -x "$helm_bin" ]; then
    echo "supply-chain: helm is not installed in $tools; run infra/scripts/install-helm.sh (INSTALL_DIR=$tools)" >&2
    return 2
  fi
  local bundle
  bundle=$(sed -n 's/^TRIVY_CHECKS_BUNDLE_DEFAULT="\(.*\)"$/\1/p' "$repo/infra/scripts/install-trivy.sh")
  if [ -z "$bundle" ]; then
    say "FAIL no checks bundle is pinned in infra/scripts/install-trivy.sh"
    return 1
  fi
  scratch
  if ! "$helm_bin" template openverify "$repo/deploy/helm/openverify" --output-dir "$step_tmp/chart" >"$step_tmp/helm.log" 2>&1; then
    tail -n 20 "$step_tmp/helm.log"
    say "FAIL the chart does not render (helm template)"
    return 1
  fi
  local target out
  for target in infra chart; do
    if [ "$target" = infra ]; then out="$repo/infra"; else out="$step_tmp/chart"; fi
    if ! "$tool_path" config --skip-version-check --quiet --checks-bundle-repository "$bundle" \
      --format json --output "$step_tmp/trivy-$target.json" "$out" >"$step_tmp/trivy.log" 2>&1; then
      tail -n 20 "$step_tmp/trivy.log"
      say "FAIL trivy config failed on $target"
      return 1
    fi
  done
  notice "Trivy config: checks bundle $bundle (pinned by digest); misconfiguration checks only, no vulnerability database"
  gate trivy-config gate trivy-config --fail-at high "infra/=$step_tmp/trivy-infra.json" "rendered-chart/=$step_tmp/trivy-chart.json"
}

step_chart() {
  if [ ! -f "$chart_checks" ]; then
    notice "chart: ${chart_checks#"$repo/"} is not built yet (chart-policy-11c's): failing closed"
    return 3
  fi
  PATH="$tools:$PATH" bash "$chart_checks" all
}

step_pii() {
  if [ ! -f "$pii_config" ] || [ ! -f "$pii_filter" ]; then
    notice "pii: security/gitleaks-pii.toml and security/gitleaks-pii-filter.py (sast-pii-11c's) are not built yet (${pii_config#"$repo/"}, ${pii_filter#"$repo/"}): failing closed"
    return 3
  fi
  local rc=0
  (cd "$repo" && python3 -I "$pii_filter" --gitleaks "$tools/gitleaks" dir .) || rc=$?
  if [ "$rc" -ne 0 ]; then
    notice "pii: the PII-pattern scan kept findings or failed (exit $rc): failing"
    return 1
  fi
  notice "pii: the PII-pattern scan kept nothing"
}

step_allowlist() {
  gate allowlist check-allowlist
}

run_step() { # run_step <step>: the shared allowlist check, then the step
  local step=$1 rc
  printf '== supply-chain: %s\n' "$step"
  summary_line "### supply-chain: $step"
  if [ "$step" != allowlist ]; then
    gate allowlist check-allowlist >/dev/null || {
      gate allowlist check-allowlist
      return 1
    }
  fi
  case "$step" in
    osv) step_osv ;;
    pnpm-audit) step_pnpm_audit ;;
    pip-audit) step_pip_audit ;;
    zizmor) step_zizmor ;;
    trivy-config) step_trivy_config ;;
    chart) step_chart ;;
    pii) step_pii ;;
    allowlist) step_allowlist ;;
  esac
  rc=$?
  printf -- '-- supply-chain: %s: exit %s\n' "$step" "$rc"
  return "$rc"
}

if [ $# -lt 1 ]; then
  usage
  exit 2
fi
refuse_tokens || exit 2
case "$1" in
  gate)
    shift
    [ $# -ge 2 ] || {
      usage
      exit 2
    }
    gate "gate $1" gate "$@"
    exit $?
    ;;
  db-age)
    shift
    [ $# -eq 2 ] || {
      usage
      exit 2
    }
    gate "db-age $1" db-age "$@"
    exit $?
    ;;
  all)
    worst=0
    for step in "${steps[@]}"; do
      run_step "$step"
      rc=$?
      if [ "$rc" -gt "$worst" ]; then worst=$rc; fi
    done
    say "all: exit $worst"
    exit "$worst"
    ;;
  *)
    for step in "${steps[@]}"; do
      if [ "$1" = "$step" ]; then
        run_step "$step"
        exit $?
      fi
    done
    echo "supply-chain: unknown step $1" >&2
    usage
    exit 2
    ;;
esac
