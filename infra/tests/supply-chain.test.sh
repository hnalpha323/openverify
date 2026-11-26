#!/usr/bin/env bash
# Test for infra/scripts/supply-chain.sh (Workflow 11C scanners-11c; C259.1-C259.4, C267.2) and
# security/allowlist.yaml (C259.2). Offline only: every scanner answer is a recorded, synthetic
# JSON report under infra/tests/fixtures/supply-chain/, served by fake tools in a scratch
# directory; no case queries OSV, the npm registry, PyPI or a container registry (the plan's rule
# "No network in tests": the real queries run only when supply-chain.sh runs as a check).
#
# Cases:
#   1. the gate: every critical, high or unscored finding fails unless an unexpired allowlist entry
#      names its id with its package or path; mediums and lows go to the step summary; zizmor's step
#      fails at medium; an expired entry, an entry more than 90 days ahead and an entry that breaks
#      security/allowlist.schema.json each fail; an unused entry is only reported;
#   2. each vulnerability database's build date is written to the summary, and a database older
#      than 24 hours, or one that names no build date, fails (C259.3);
#   3. each step runs its scanner over the inputs C259.1 names, with the pinned checks bundle, and
#      gates its report; the chart and PII steps fail closed with exit 3 while their owners' files
#      are absent; a missing tool exits 2 naming its installer; a token in the environment exits 2;
#   4. the committed security/allowlist.yaml passes the gate's schema and expiry check.
#
# Usage: infra/tests/supply-chain.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$repo_root/infra/scripts/supply-chain.sh"
fixtures="$repo_root/infra/tests/fixtures/supply-chain"
scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$scratch_root"
work=$(mktemp -d "$scratch_root/openverify-supply-chain-test.XXXXXX")
# shellcheck disable=SC2064 # expand now: the path is fixed
trap "rm -rf '$work'" EXIT

passed=0
failed=0
skipped=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
expect_rc() { # expect_rc <description> <expected> [<detail>]
  if [ "$rc" -eq "$2" ]; then ok "$1"; else nok "$1" "exit $rc, expected $2: $(tail -n 4 <<<"$out" | tr '\n' ' ')"; fi
}
expect_match() { # expect_match <description> <glob> <actual>
  # shellcheck disable=SC2254 # the glob is intentionally unquoted
  case "$3" in
    $2) ok "$1" ;;
    *) nok "$1" "expected match for '$2', got: $(printf '%s' "$3" | tail -n 6 | tr '\n' ' ')" ;;
  esac
}
expect_no_match() {
  # shellcheck disable=SC2254
  case "$3" in
    $2) nok "$1" "unexpected match for '$2'" ;;
    *) ok "$1" ;;
  esac
}
finish() {
  printf '\n# %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

if [ -f "$script" ]; then ok "infra/scripts/supply-chain.sh exists"; else nok "infra/scripts/supply-chain.sh exists"; fi

# The day every case runs on, so expiry is deterministic.
today=2099-01-10
now=2099-01-10T12:00:00Z
summary="$work/summary.md"

# run <VAR=value ...> -- <supply-chain.sh arguments>: runs the script with a fresh summary file, no
# token in the environment, and the case's day; sets out, rc and sum.
run() {
  local env_args=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do
    env_args+=("$1")
    shift
  done
  shift
  : >"$summary"
  out=$(env -u GITHUB_TOKEN -u GH_TOKEN -u NPM_TOKEN -u NODE_AUTH_TOKEN \
    GITHUB_STEP_SUMMARY="$summary" SUPPLY_CHAIN_TODAY="$today" SUPPLY_CHAIN_NOW="$now" \
    SUPPLY_CHAIN_ALLOWLIST="${allowlist:-$work/empty.yaml}" ${env_args[@]+"${env_args[@]}"} \
    bash "$script" "$@" 2>&1)
  rc=$?
  sum=$(cat "$summary")
}
printf '[]\n' >"$work/empty.yaml"

# allow <file> <entry YAML...>: writes an allowlist.
allow() {
  local file=$1
  shift
  printf '%s\n' "$@" >"$file"
}
entry() { # entry <id> <package|path> <value> <expires> [<reason>]
  printf -- '- id: %s\n  %s: %s\n  reason: %s\n  expires: %s\n  added-by: supply-chain-test\n' \
    "$1" "$2" "$3" "${5:-synthetic reason for the test case}" "$4"
}

# ---------------------------------------------------------------- 1. the gate ----
allowlist=
run -- gate osv --root /repo/ "$fixtures/osv.json"
expect_rc "osv: a critical, a high, an advisory-rated high and an unscored finding fail the gate" 1
expect_match "osv: the high is named with its package" "*FAIL*GHSA-syn1-high-0001*synthetic-high*high*" "$out"
expect_match "osv: the critical is named" "*FAIL*GHSA-syn1-crit-0004*org.example:synthetic-critical*critical*" "$out"
expect_match "osv: a group without a score takes the advisory's own HIGH" "*FAIL*PYSEC-2099-5*synthetic-advisory-high*high*" "$out"
expect_match "osv: a finding with no severity at all fails closed as unknown" "*FAIL*PYSEC-2099-6*synthetic-unscored*unknown*" "$out"
expect_match "osv: the sources are named relative to the repository" "*synthetic-high*pnpm-lock.yaml*android/openverify-sdk/gradle.lockfile*" "$(grep 'GHSA-syn1-high-0001' <<<"$out")"
expect_no_match "osv: the medium does not fail" "*FAIL*GHSA-syn1-medi-0002*" "$out"
expect_match "osv: the medium is written to the step summary" "*GHSA-syn1-medi-0002*synthetic-medium*medium*" "$sum"
expect_match "osv: the low is written to the step summary" "*GHSA-syn1-loww-0003*synthetic-low*low*" "$sum"
expect_match "osv: the failing findings are in the step summary too" "*GHSA-syn1-crit-0004*" "$sum"

allowlist="$work/all.yaml"
allow "$allowlist" "$(entry CVE-2099-0001 package synthetic-high 2099-02-01)" \
  "$(entry GHSA-syn1-crit-0004 package org.example:synthetic-critical 2099-04-10 "no fix available; synthetic")" \
  "$(entry PYSEC-2099-5 package synthetic-advisory-high 2099-01-10)" \
  "$(entry PYSEC-2099-6 package synthetic-unscored 2099-01-11)"
run -- gate osv --root /repo/ "$fixtures/osv.json"
expect_rc "osv: every failing finding allowlisted by an alias or its id passes (expiry today and 90 days ahead included)" 0
expect_match "osv: an allowlisted finding is reported with its expiry" "*allowlisted*GHSA-syn1-crit-0004*until 2099-04-10*" "$out"
expect_match "osv: an allowlisted finding is listed in the summary with its reason" "*GHSA-syn1-crit-0004*no fix available; synthetic*" "$sum"

allowlist="$work/wrong-package.yaml"
allow "$allowlist" "$(entry GHSA-syn1-crit-0004 package org.example:another 2099-02-01)"
run -- gate osv --root /repo/ "$fixtures/osv.json"
expect_rc "an entry for the right id but another package does not cover the finding" 1
expect_match "the uncovered critical still fails" "*FAIL*GHSA-syn1-crit-0004*" "$out"
expect_match "an entry that covers nothing is reported as unused" "*unused*GHSA-syn1-crit-0004*" "$out"

# A path entry covers a lockfile finding only when every lockfile it was found in is under the path
# (integration-11c: android/consumer-check's own tooling, whose files rule 3 keeps, beside the rest).
allowlist="$work/path-scope.yaml"
allow "$allowlist" "$(entry GHSA-syn1-crit-0004 path android/openverify-sdk/ 2099-02-01)" \
  "$(entry GHSA-syn1-high-0001 path android/ 2099-02-01)"
run -- gate osv --root /repo/ "$fixtures/osv.json"
expect_match "osv: a path entry covers a finding whose every lockfile is under it" "*allowlisted*GHSA-syn1-crit-0004*until 2099-02-01*" "$out"
expect_no_match "osv: the finding a path entry covers no longer fails" "*GHSA-syn1-crit-0004*" "$(grep '^FAIL' <<<"$out")"
expect_match "osv: a path entry does not cover a finding with a lockfile outside it" "*FAIL*GHSA-syn1-high-0001*" "$out"

allowlist="$work/expired.yaml"
allow "$allowlist" "$(entry GHSA-syn9-unre-0009 package unrelated 2099-01-09)"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an expired entry fails the step, even with a clean report" 1
expect_match "the expired entry is named with its expiry" "*expired*GHSA-syn9-unre-0009*2099-01-09*" "$out"

allowlist="$work/far.yaml"
allow "$allowlist" "$(entry GHSA-syn9-unre-0009 package unrelated 2099-04-11)"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an entry more than 90 days ahead fails the step" 1
expect_match "the far entry is named" "*more than 90 days*GHSA-syn9-unre-0009*" "$out"

allowlist="$work/no-reason.yaml"
printf -- '- id: GHSA-syn9-unre-0009\n  package: unrelated\n  expires: 2099-02-01\n  added-by: supply-chain-test\n' >"$allowlist"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an entry without its reason fails the step" 1
expect_match "the missing reason is named" "*reason*" "$out"

allowlist="$work/short-reason.yaml"
allow "$allowlist" "$(entry GHSA-syn9-unre-0009 package unrelated 2099-02-01 short)"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "a reason under the schema's 10 characters fails the step" 1

allowlist="$work/both.yaml"
printf -- '- id: GHSA-syn9-unre-0009\n  package: unrelated\n  path: infra/x\n  reason: synthetic reason for the test case\n  expires: 2099-02-01\n  added-by: supply-chain-test\n' >"$allowlist"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an entry naming both a package and a path fails the step (the schema's oneOf)" 1

allowlist="$work/extra.yaml"
printf -- '- id: GHSA-syn9-unre-0009\n  package: unrelated\n  severity: high\n  reason: synthetic reason for the test case\n  expires: 2099-02-01\n  added-by: supply-chain-test\n' >"$allowlist"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an entry with a member the schema does not name fails the step" 1

allowlist="$work/bad-date.yaml"
allow "$allowlist" "$(entry GHSA-syn9-unre-0009 package unrelated 2099-13-45)"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an entry whose expiry is not a date fails the step" 1

allowlist="$work/not-a-list.yaml"
printf 'id: GHSA-syn9-unre-0009\n' >"$allowlist"
run -- gate osv --root /repo/ "$fixtures/osv-clean.json"
expect_rc "an allowlist that is not a list fails the step" 1

allowlist=
run -- gate osv --root /repo/ "$fixtures/osv-medium-only.json"
expect_rc "a report with only a medium passes" 0
expect_match "the medium is still in the summary" "*GHSA-syn1-medi-0002*" "$sum"

run -- gate pnpm-audit "$fixtures/pnpm-audit.json"
expect_rc "pnpm audit: a high advisory fails" 1
expect_match "pnpm audit: the high is named with its GHSA and module" "*FAIL*GHSA-syn2-high-0001*synthetic-high*high*" "$out"
expect_match "pnpm audit: the moderate is reported as medium in the summary" "*GHSA-syn2-mode-0002*synthetic-moderate*medium*" "$sum"
run -- gate pnpm-audit "$fixtures/pnpm-audit-clean.json"
expect_rc "pnpm audit: a clean report passes" 0

run -- gate pip-audit "$fixtures/pip-audit.json"
expect_rc "pip-audit: a finding, which pip-audit gives no severity, fails closed" 1
expect_match "pip-audit: the finding is named as unknown with its fix" "*FAIL*PYSEC-2099-7*synthetic-py*unknown*1.0.1*" "$out"
allowlist="$work/pip.yaml"
allow "$allowlist" "$(entry GHSA-syn3-pypi-0007 package synthetic-py 2099-02-01)"
run -- gate pip-audit "$fixtures/pip-audit.json"
expect_rc "pip-audit: an entry naming its alias covers it" 0
allowlist=
run -- gate pip-audit "$fixtures/pip-audit-clean.json"
expect_rc "pip-audit: a clean report passes" 0

run -- gate zizmor --fail-at medium "$fixtures/zizmor.json"
expect_rc "zizmor: a high and a medium fail at medium" 1
expect_match "zizmor: the high is named with its workflow and line (zizmor's rows are zero-based)" "*FAIL*template-injection*.github/workflows/synthetic.yml:10*high*" "$out"
expect_match "zizmor: the medium fails too" "*FAIL*excessive-permissions*medium*" "$out"
expect_match "zizmor: the low is in the summary" "*self-repository*low*" "$sum"
allowlist="$work/zizmor.yaml"
allow "$allowlist" "$(entry template-injection path .github/workflows/synthetic.yml 2099-02-01)" \
  "$(entry excessive-permissions path .github/workflows/ 2099-02-01)"
run -- gate zizmor --fail-at medium "$fixtures/zizmor.json"
expect_rc "zizmor: entries by audit and path (a directory path covers the files in it) cover both" 0
sed 's#"\.github/workflows/synthetic\.yml"#"/repo/.github/workflows/synthetic.yml"#' "$fixtures/zizmor.json" >"$work/zizmor-absolute.json"
run -- gate zizmor --fail-at medium --root /repo/ "$work/zizmor-absolute.json"
expect_rc "zizmor: an absolute location under --root is matched as its repository path" 0
allowlist=
run -- gate zizmor --fail-at medium --root /repo/ "$work/zizmor-absolute.json"
expect_match "zizmor: an absolute location is reported relative to the repository" "*FAIL template-injection .github/workflows/synthetic.yml:10 high*" "$out"
run -- gate zizmor --fail-at medium "$fixtures/zizmor-low-only.json"
expect_rc "zizmor: a low only passes" 0

run -- gate trivy-config "infra/=$fixtures/trivy-config.json"
expect_rc "Trivy config: a high and a critical misconfiguration fail" 1
expect_match "Trivy config: the high is named with its prefixed target" "*FAIL*DS-0002*infra/docker/synthetic.Dockerfile*high*" "$out"
expect_match "Trivy config: the critical is named" "*FAIL*KSV-0014*infra/templates/synthetic.yaml*critical*" "$out"
expect_no_match "Trivy config: a passed check is not a finding" "*DS-0001*" "$out$sum"
expect_match "Trivy config: the medium is in the summary" "*DS-0013*medium*" "$sum"
run -- gate trivy-config "infra/=$fixtures/trivy-config-clean.json"
expect_rc "Trivy config: a low only passes" 0

run -- gate trivy-image "$fixtures/trivy-image.json"
expect_rc "Trivy image (release.yml's gate): a high fails" 1
expect_match "Trivy image: the high is named" "*FAIL*CVE-2099-0010*libsynthetic*high*" "$out"
run -- gate grype "$fixtures/grype.json"
expect_rc "Grype (release.yml's gate): a critical fails" 1
expect_match "Grype: the critical is named with its related CVE" "*FAIL*GHSA-syn4-crit-0012*synthetic-go*critical*" "$out"
expect_match "Grype: a negligible match is in the summary as low" "*CVE-2099-0013*low*" "$sum"
allowlist="$work/grype.yaml"
allow "$allowlist" "$(entry CVE-2099-0012 package synthetic-go 2099-02-01)"
run -- gate grype "$fixtures/grype.json"
expect_rc "Grype: an entry naming the related CVE covers the match" 0
allowlist=

run -- gate osv "$work/no-such-report.json"
expect_rc "an unreadable report exits 2" 2
printf '{"unexpected": true}\n' >"$work/odd.json"
run -- gate osv "$work/odd.json"
expect_rc "a report in an unexpected shape exits 2" 2
run -- gate no-such-format "$fixtures/osv.json"
expect_rc "an unknown report format exits 2" 2

# ------------------------------------------------------- 2. database freshness ----
run -- db-age trivy-version "$fixtures/trivy-version-fresh.json"
expect_rc "Trivy's database built 6 hours ago passes" 0
expect_match "Trivy's database build date is in the summary" "*Trivy*2099-01-10T06:00:00Z*" "$sum"
run -- db-age trivy-version "$fixtures/trivy-version-stale.json"
expect_rc "Trivy's database built 54 hours ago fails (older than 24 hours)" 1
expect_match "the stale database is named with its build date" "*older than 24 hours*2099-01-08T06:00:00Z*" "$out"
run -- db-age trivy-version "$fixtures/trivy-version-nodb.json"
expect_rc "a Trivy report with no database build date fails" 1
run -- db-age grype-status "$fixtures/grype-status-fresh.json"
expect_rc "Grype's database built 11 hours ago passes" 0
expect_match "Grype's database build date is in the summary" "*Grype*2099-01-10T01:00:00Z*" "$sum"
run -- db-age grype-status "$fixtures/grype-status-stale.json"
expect_rc "Grype's database built 9 days ago fails" 1

# -------------------------------------------------------------- 3. the steps ----
tools="$work/tools"
fakebin="$work/fakebin"
calls="$work/calls"
mkdir -p "$tools" "$fakebin"
: >"$calls"
# A fake tool records "<name> <args>" and writes $FAKE_<NAME>_REPORT where the real one writes.
fake() { # fake <dir> <name> <body>
  printf '#!/usr/bin/env bash\nprintf "%%s %%s\\n" %s "$*" >>"%s"\n%s\n' "$2" "$calls" "$3" >"$1/$2"
  chmod 0755 "$1/$2"
}
# The value after a flag: flagval <flag> "$@"
flagval='flagval() { local f=$1 prev=; shift; for a in "$@"; do [ "$prev" = "$f" ] && { printf %s "$a"; return; }; prev=$a; done; }'
fake "$tools" osv-scanner "$flagval"'
cp "$FAKE_OSV_REPORT" "$(flagval --output-file "$@")"
exit "${FAKE_OSV_RC:-0}"'
fake "$tools" zizmor 'cat "$FAKE_ZIZMOR_REPORT"; exit "${FAKE_ZIZMOR_RC:-0}"'
fake "$tools" trivy "$flagval"'
cp "$FAKE_TRIVY_REPORT" "$(flagval --output "$@")"'
fake "$tools" helm "$flagval"'
d=$(flagval --output-dir "$@"); mkdir -p "$d/openverify/templates"; printf "kind: Deployment\n" >"$d/openverify/templates/x.yaml"; exit "${FAKE_HELM_RC:-0}"'
fake "$tools" gitleaks 'exit 0'
fake "$fakebin" pnpm 'case "$*" in "audit signatures"*) exit "${FAKE_SIGNATURES_RC:-0}" ;; audit*) cat "$FAKE_PNPM_REPORT"; exit 1 ;; esac; exit 9'
fake "$fakebin" uv "$flagval"'
case "$1" in
  export) printf "synthetic==1.0.0 --hash=sha256:%064d\n" 0 >"$(flagval -o "$@")" ;;
  run) cp "$FAKE_PIP_AUDIT_REPORT" "$(flagval --output "$@")"; exit "${FAKE_PIP_AUDIT_RC:-0}" ;;
esac'
step_env=(SUPPLY_CHAIN_TOOLS_DIR="$tools" PATH="$fakebin:$PATH")
calls_of() { grep "^$1 " "$calls"; }

: >"$calls"
run "${step_env[@]}" FAKE_OSV_REPORT="$fixtures/osv-medium-only.json" FAKE_OSV_RC=1 -- osv
expect_rc "osv step: a medium only passes (osv-scanner's own exit 1 for findings is not a failure)" 0
osv_args=$(calls_of osv-scanner)
expect_match "osv step: osv-scanner scans source with JSON output" "osv-scanner scan source *--format json*" "$osv_args"
for f in pnpm-lock.yaml services/vision/uv.lock security/pip-audit/uv.lock security/python/uv.lock \
  android/openverify-sdk/gradle.lockfile android/openverify-nfc/gradle.lockfile android/openverify-face/gradle.lockfile \
  android/demo-app/gradle.lockfile android/consumer-check/gradle.lockfile android/gradle/verification-metadata.xml \
  android/consumer-check/gradle/verification-metadata.xml; do
  expect_match "osv step: reads $f" "* -L $repo_root/$f *" "$osv_args "
done
for f in android/settings-gradle.lockfile android/consumer-check/settings-gradle.lockfile \
  android/demo-app/gradle-sdk-nfc.lockfile android/demo-app/gradle-sdk-face.lockfile android/demo-app/gradle-sdk-nfc-face.lockfile; do
  expect_match "osv step: reads $f with the Gradle lockfile parser" "* -L gradle.lockfile:$repo_root/$f *" "$osv_args "
done
if [ -f "$repo_root/load/uv.lock" ]; then
  expect_match "osv step: reads load/uv.lock" "* -L $repo_root/load/uv.lock *" "$osv_args "
else
  expect_match "osv step: load/uv.lock, absent, is skipped with a notice" "*load/uv.lock*skipped*" "$out"
fi
expect_match "osv step: the summary says the OSV API was queried live" "*OSV*queried live*" "$sum"
run "${step_env[@]}" FAKE_OSV_REPORT="$fixtures/osv.json" FAKE_OSV_RC=1 -- osv
expect_rc "osv step: a high fails the step" 1
run "${step_env[@]}" FAKE_OSV_REPORT="$fixtures/osv-clean.json" FAKE_OSV_RC=127 -- osv
expect_rc "osv step: an osv-scanner error fails closed" 1

: >"$calls"
run "${step_env[@]}" FAKE_PNPM_REPORT="$fixtures/pnpm-audit-clean.json" -- pnpm-audit
expect_rc "pnpm-audit step: a clean audit with verified signatures passes" 0
expect_match "pnpm-audit step: runs pnpm audit --json" "*pnpm audit --json*" "$(calls_of pnpm)"
expect_match "pnpm-audit step: then pnpm audit signatures" "*pnpm audit signatures*" "$(calls_of pnpm)"
run "${step_env[@]}" FAKE_PNPM_REPORT="$fixtures/pnpm-audit.json" -- pnpm-audit
expect_rc "pnpm-audit step: a high fails the step" 1
run "${step_env[@]}" FAKE_PNPM_REPORT="$fixtures/pnpm-audit-clean.json" FAKE_SIGNATURES_RC=1 -- pnpm-audit
expect_rc "pnpm-audit step: a signature that does not verify fails the step" 1

: >"$calls"
run "${step_env[@]}" FAKE_PIP_AUDIT_REPORT="$fixtures/pip-audit-clean.json" -- pip-audit
expect_rc "pip-audit step: a clean audit passes" 0
expect_match "pip-audit step: exports vision's frozen lock as hashed requirements" "*uv export --frozen --format requirements-txt*" "$(calls_of uv)"
expect_match "pip-audit step: runs the hashed security/pip-audit project with --require-hashes --disable-pip --no-deps" \
  "*uv run --project $repo_root/security/pip-audit --frozen pip-audit --require-hashes --disable-pip --no-deps*" "$(calls_of uv)"
if [ ! -f "$repo_root/load/uv.lock" ]; then
  expect_match "pip-audit step: load/, absent, is skipped with a notice" "*load/*skipped*" "$out"
fi
run "${step_env[@]}" FAKE_PIP_AUDIT_REPORT="$fixtures/pip-audit.json" FAKE_PIP_AUDIT_RC=1 -- pip-audit
expect_rc "pip-audit step: a finding fails the step" 1

: >"$calls"
run "${step_env[@]}" FAKE_ZIZMOR_REPORT="$fixtures/zizmor-low-only.json" FAKE_ZIZMOR_RC=12 -- zizmor
expect_rc "zizmor step: a low only passes (zizmor's own finding exit codes are not failures)" 0
expect_match "zizmor step: audits .github/workflows and .github/actions offline, as JSON" \
  "zizmor *--offline*--format json*$repo_root/.github/workflows*$repo_root/.github/actions*" "$(calls_of zizmor)"
expect_match "zizmor step: the summary says which audits did not run offline" "*offline*" "$sum"
run "${step_env[@]}" FAKE_ZIZMOR_REPORT="$fixtures/zizmor.json" FAKE_ZIZMOR_RC=14 -- zizmor
expect_rc "zizmor step: a medium fails the step" 1
run "${step_env[@]}" FAKE_ZIZMOR_REPORT="$fixtures/zizmor-low-only.json" FAKE_ZIZMOR_RC=2 -- zizmor
expect_rc "zizmor step: a zizmor error fails closed" 1

: >"$calls"
bundle=$(sed -n 's/^TRIVY_CHECKS_BUNDLE_DEFAULT="\(.*\)"$/\1/p' "$repo_root/infra/scripts/install-trivy.sh")
run "${step_env[@]}" FAKE_TRIVY_REPORT="$fixtures/trivy-config-clean.json" -- trivy-config
expect_rc "trivy-config step: lows only pass" 0
trivy_args=$(calls_of trivy)
expect_match "trivy-config step: scans infra/ with the checks bundle pinned by digest" "*trivy config *--checks-bundle-repository $bundle *$repo_root/infra*" "$trivy_args"
expect_match "trivy-config step: renders the chart with helm template" "*helm template *$repo_root/deploy/helm/openverify*" "$(calls_of helm)"
if [ "$(grep -c '^trivy config ' <<<"$trivy_args")" = 2 ]; then ok "trivy-config step: scans the rendered chart too"; else nok "trivy-config step: scans the rendered chart too" "$trivy_args"; fi
expect_match "trivy-config step: the summary names the checks bundle and says no vulnerability database is used" "*$bundle*" "$sum"
run "${step_env[@]}" FAKE_TRIVY_REPORT="$fixtures/trivy-config.json" -- trivy-config
expect_rc "trivy-config step: a high fails the step" 1
run "${step_env[@]}" FAKE_TRIVY_REPORT="$fixtures/trivy-config-clean.json" FAKE_HELM_RC=1 -- trivy-config
expect_rc "trivy-config step: a chart that does not render fails closed" 1

run "${step_env[@]}" SUPPLY_CHAIN_CHART_CHECKS="$work/no-chart-checks.sh" -- chart
expect_rc "chart step: without deploy/helm/openverify/ci/chart-checks.sh it fails closed with exit 3" 3
expect_match "chart step: the notice names its owner" "*chart-checks.sh*chart-policy-11c*" "$out"
# Like the real chart-checks.sh (chart-policy-11c's), the fake answers its usage with exit 2 unless it
# is given a subcommand (integration-11c: the step once ran it with none, and exited 2 on the tree).
printf '#!/usr/bin/env bash\n[ "$#" -eq 1 ] && [ "$1" = all ] || { echo "usage: chart-checks.sh lint|unittest|kubeconform|trivy|all" >&2; exit 2; }\necho "chart checks: synthetic $1"; exit "${FAKE_CHART_RC:-0}"\n' >"$work/chart-checks.sh"
run "${step_env[@]}" SUPPLY_CHAIN_CHART_CHECKS="$work/chart-checks.sh" -- chart
expect_rc "chart step: passes when chart-checks.sh passes" 0
expect_match "chart step: runs every chart check (chart-checks.sh all)" "*chart checks: synthetic all*" "$out"
run "${step_env[@]}" SUPPLY_CHAIN_CHART_CHECKS="$work/chart-checks.sh" FAKE_CHART_RC=1 -- chart
expect_rc "chart step: fails when chart-checks.sh fails" 1

run "${step_env[@]}" SUPPLY_CHAIN_PII_CONFIG="$work/no-pii.toml" -- pii
expect_rc "pii step: without security/gitleaks-pii.toml it fails closed with exit 3" 3
expect_match "pii step: the notice names its owner" "*gitleaks-pii.toml*sast-pii-11c*" "$out"
printf 'title = "synthetic"\n' >"$work/pii.toml"
printf 'import sys\nprint("pii filter:", " ".join(sys.argv[1:]))\nsys.exit(int(__import__("os").environ.get("FAKE_PII_RC", "0")))\n' >"$work/pii-filter.py"
run "${step_env[@]}" SUPPLY_CHAIN_PII_CONFIG="$work/pii.toml" SUPPLY_CHAIN_PII_FILTER="$work/pii-filter.py" -- pii
expect_rc "pii step: passes when the PII filter keeps nothing" 0
expect_match "pii step: runs the filter with the pinned gitleaks over the tree" "*pii filter: --gitleaks $tools/gitleaks dir .*" "$out"
run "${step_env[@]}" SUPPLY_CHAIN_PII_CONFIG="$work/pii.toml" SUPPLY_CHAIN_PII_FILTER="$work/pii-filter.py" FAKE_PII_RC=1 -- pii
expect_rc "pii step: a kept finding fails the step" 1
run "${step_env[@]}" SUPPLY_CHAIN_PII_CONFIG="$work/pii.toml" SUPPLY_CHAIN_PII_FILTER="$work/pii-filter.py" FAKE_PII_RC=2 -- pii
expect_rc "pii step: a filter error fails closed" 1

allowlist="$work/expired.yaml"
run "${step_env[@]}" FAKE_ZIZMOR_REPORT="$fixtures/zizmor-low-only.json" -- zizmor
expect_rc "every step applies the shared allowlist check: an expired entry fails the zizmor step" 1
run "${step_env[@]}" SUPPLY_CHAIN_CHART_CHECKS="$work/chart-checks.sh" -- chart
expect_rc "an expired entry fails the chart step too" 1
run -- allowlist
expect_rc "the allowlist step fails on an expired entry" 1
allowlist=
run -- allowlist
expect_rc "the allowlist step passes an empty list" 0

run "${step_env[@]}" SUPPLY_CHAIN_TOOLS_DIR="$work/no-tools" -- osv
expect_rc "a missing scanner exits 2" 2
expect_match "the message names the installer" "*install-osv-scanner.sh*" "$out"
run "${step_env[@]}" GITHUB_TOKEN=synthetic-token-not-a-secret FAKE_OSV_REPORT="$fixtures/osv-clean.json" -- osv
expect_rc "a token in the environment is refused with exit 2 (C259.3: nothing secret in the job)" 2
run -- no-such-step
expect_rc "an unknown step exits 2" 2
run --
expect_rc "no step exits 2 with the usage" 2
expect_match "the usage lists the steps in order" "*osv*pnpm-audit*pip-audit*zizmor*trivy-config*chart*pii*allowlist*" "$out"

: >"$calls"
run "${step_env[@]}" FAKE_OSV_REPORT="$fixtures/osv-clean.json" FAKE_PNPM_REPORT="$fixtures/pnpm-audit-clean.json" \
  FAKE_PIP_AUDIT_REPORT="$fixtures/pip-audit-clean.json" FAKE_ZIZMOR_REPORT="$fixtures/zizmor-low-only.json" \
  FAKE_TRIVY_REPORT="$fixtures/trivy-config-clean.json" SUPPLY_CHAIN_CHART_CHECKS="$work/chart-checks.sh" \
  SUPPLY_CHAIN_PII_CONFIG="$work/pii.toml" SUPPLY_CHAIN_PII_FILTER="$work/pii-filter.py" -- all
expect_rc "all: every step clean passes" 0
order=$(grep -o '^== supply-chain: [a-z-]*' <<<"$out" | sed 's/^== supply-chain: //' | tr '\n' ' ')
if [ "$order" = "osv pnpm-audit pip-audit zizmor trivy-config chart pii allowlist " ]; then ok "all: the steps run in the frozen order"; else nok "all: the steps run in the frozen order" "$order"; fi
run "${step_env[@]}" FAKE_OSV_REPORT="$fixtures/osv.json" FAKE_PNPM_REPORT="$fixtures/pnpm-audit-clean.json" \
  FAKE_PIP_AUDIT_REPORT="$fixtures/pip-audit-clean.json" FAKE_ZIZMOR_REPORT="$fixtures/zizmor-low-only.json" \
  FAKE_TRIVY_REPORT="$fixtures/trivy-config-clean.json" SUPPLY_CHAIN_CHART_CHECKS="$work/no-chart-checks.sh" \
  SUPPLY_CHAIN_PII_CONFIG="$work/pii.toml" SUPPLY_CHAIN_PII_FILTER="$work/pii-filter.py" -- all
expect_rc "all: runs every step after a failure and exits with the highest code (3, a step not built)" 3
expect_match "all: the steps after the failing one still ran" "*== supply-chain: allowlist*" "$out"

# ------------------------------------------------- 4. the committed allowlist ----
allowlist="$repo_root/security/allowlist.yaml"
today=$(date -u +%Y-%m-%d)
run -- allowlist
expect_rc "security/allowlist.yaml passes the schema and expiry check today" 0
finish
