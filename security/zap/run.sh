#!/usr/bin/env bash
# DAST with ZAP against the reusable e2e stack in its images mode (Phase 11, Workflow 11F, dast-11f;
# C283, decision 48). Locally only, never in CI, release.yml or against a production install
# (C283.4). Each subcommand is one call that fits 10 minutes (rule 8), run by the caller under the
# e2e lock (`flock -E 75 -w 240 /tmp/openverify-e2e.lock bash security/zap/run.sh <subcommand>`),
# on a stack `OPENVERIFY_E2E_IMAGES=1 pnpm --filter @openverify/e2e e2e:stack:up` started:
#
#   prepare                    the run's credentials (security/zap/credentials.ts: a sandbox API key
#                              with every sandbox scope, two seeded-admin sessions, a hosted-flow
#                              session and a handoff it issues), the stack's /openapi.json, and the
#                              facts (the images and their ids, the machine); refused while an
#                              earlier run's credentials are not revoked
#   api [group ...]            ZAP's API scan, one group of security/zap/api-groups.tsv per ZAP run
#                              (every group but flow by default), each with the credential its
#                              operations declare
#   flow [hosted|noguidance|routes ...]
#                              the baseline (passive) scan of the hosted flow for each flow image
#                              variant (openverify/flow:11c-local, which the stack serves, and
#                              openverify/flow:11c-local-noguidance, which this starts beside it on a
#                              loopback port and stops), with the header captures the report checks,
#                              and ZAP's API scan of the flow API with the run's session and handoff
#   console                    the baseline scan of the console with the seeded admin's session cookie
#                              (a replacer rule; MFA is not scripted), forms never posted
#   report                     docs/security/dast-<date>.md from ZAP's raw reports (dast-zap.py:
#                              every header and credential removed), then gitleaks over it (the
#                              repository's rules and the PII rules); exit 1 on an open high finding
#   revoke                     the credentials revoked and checked refused; ZAP's raw reports and the
#                              per-run documents removed
#   (none)                     all of them in order: prepare api flow console report revoke
#
# Every exit that is not a success revokes the run's credentials (the EXIT trap), unless prepare
# refused to start over an earlier run's. ZAP's raw reports, which record requests, stay in the run
# directory outside the repository until revoke removes them; nothing else is written in the
# repository but the report. Every ZAP container runs the pinned image on the engine's host network
# (the images mode's containers listen on loopback there; KP11-40), with -silent (no unsolicited
# requests), against loopback URLs only, and receives each credential by environment variable name.
#
# Env: OPENVERIFY_ZAP_RUN_DIR      the run directory (default /tmp/openverify-zap/run; never inside
#                                  the repository)
#      OPENVERIFY_ZAP_REPORT_DIR   where the report goes (default docs/security)
#      OPENVERIFY_ZAP_DATE         the report's date (default `date +%F`)
#      OPENVERIFY_ZAP_SCAN_MINUTES the active scan's limit per API group (default 6)
#      OPENVERIFY_ZAP_ATTACK_STRENGTH the API scan policy's attack strength (default LOW)
#      OPENVERIFY_ZAP_CONTAINER_UID the uid ZAP's image runs as (default 1000); run.sh runs as it
# Contract test: infra/tests/zap.test.sh. The plan's Validation line `bash security/zap/run.sh` runs
# everything in one call, which does not fit 10 minutes; its subcommands stand for it.
set -uo pipefail

# ZAP 2.17.0 (released 2025-12-15, Apache-2.0; C258.3): the project's own image at its version tag,
# by the index digest infra/scripts/refresh-digests.sh printed for its 2.17.0 tag on 2026-11-21 (the
# tag's amd64 build is dated 2026-11-03, 18 days old that day: the 14-day rule holds).
# Never stable, weekly or latest. ZAP runs as an unmodified tool and is never shipped.
readonly ZAP_IMAGE='ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af'

readonly NOGUIDANCE_IMAGE='openverify/flow:11c-local-noguidance'
readonly E2E_PROJECT='openverify-e2e'

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
zap_dir="$repo_root/security/zap"
run_dir=${OPENVERIFY_ZAP_RUN_DIR:-/tmp/openverify-zap/run}
report_dir=${OPENVERIFY_ZAP_REPORT_DIR:-$repo_root/docs/security}
report_date=${OPENVERIFY_ZAP_DATE:-$(date +%F)}
scan_minutes=${OPENVERIFY_ZAP_SCAN_MINUTES:-6}
attack_strength=${OPENVERIFY_ZAP_ATTACK_STRENGTH:-LOW}
settle_seconds=${OPENVERIFY_ZAP_SETTLE_SECONDS:-30}
# The uid ZAP's image runs as (its user zap); the run directory is this user's, mode 0700.
container_uid=${OPENVERIFY_ZAP_CONTAINER_UID:-1000}
wrk="$run_dir/wrk"
credentials="$run_dir/credentials.json"

usage() {
  cat >&2 <<'TXT'
usage: security/zap/run.sh [prepare | api [group ...] | flow [hosted|noguidance|routes ...] | console | report | revoke]
  (no subcommand: prepare api flow console report revoke, in order)
TXT
  exit "${1:-2}"
}

say() { printf 'run.sh: %s\n' "$*" >&2; }

sub=${1:-all}
[ "$#" -gt 0 ] && shift
case "$sub" in
  prepare | api | flow | console | report | revoke | all) ;;
  -h | --help | help) usage 0 ;;
  *) usage 2 ;;
esac

# The run directory is never inside the repository (C283.2: nothing but the report is written there).
abs_run=$(realpath -m -- "$run_dir")
case "$abs_run/" in
  "$repo_root/"*) say "the run directory $abs_run is inside the repository; use one outside it"; exit 2 ;;
esac

current=$sub
keep_credentials=false
noguidance=""

stop_noguidance() {
  if [ -n "$noguidance" ]; then
    docker rm -f "$noguidance" >/dev/null 2>&1
    noguidance=""
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  stop_noguidance
  if [ "$rc" -ne 0 ] && [ "$current" != revoke ] && ! $keep_credentials && [ -e "$credentials" ]; then
    say "$current failed (exit $rc): revoking the run's credentials"
    do_revoke || say "revoke failed too: see $run_dir/revoke.json"
  fi
  exit "$rc"
}
trap on_exit EXIT

helper() { python3 -I "$zap_dir/dast-zap.py" "$@"; }

credentials_ts() {
  node --experimental-transform-types --no-warnings --conditions=@openverify/source \
    --import "$repo_root/packages/checks/scripts/register-ts.mjs" "$zap_dir/credentials.ts" "$@"
}

# json_get <file> <dotted.key>: one string field of a JSON file (empty when missing); never echoed.
json_get() {
  python3 -I -c 'import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value.get(part) if isinstance(value, dict) else None
print("" if value is None else value)' "$1" "$2"
}

# A loopback http URL, or exit 2 (C283.1: ZAP reaches only the local stack).
loopback() {
  if ! python3 -I -c 'import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
sys.exit(0 if u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost") else 1)' "$1"; then
    say "$2 is not a loopback http URL; DAST scans the local stack only"
    exit 2
  fi
}

# The origin of a URL as a regular expression, for a replacer rule's scope.
scope_of() {
  python3 -I -c 'import re, sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
print("^" + re.escape(f"{u.scheme}://{u.netloc}") + "/.*")' "$1"
}

require_prepared() {
  if [ ! -s "$credentials" ] || [ ! -s "$run_dir/facts.json" ]; then
    say "no prepared run in $run_dir: run security/zap/run.sh prepare first"
    exit 2
  fi
  api_url=$(json_get "$run_dir/facts.json" apiUrl)
  flow_url=$(json_get "$run_dir/facts.json" flowUrl)
  dashboard_url=$(json_get "$run_dir/facts.json" dashboardUrl)
  loopback "$api_url" "the API URL"
  loopback "$flow_url" "the flow URL"
  loopback "$dashboard_url" "the console URL"
}

# zap_run <scan> <kind> <header name> <header value> <scope> <script> <args...>: one ZAP container.
zap_run() {
  local scan=$1 kind=$2 header_name=$3 header_value=$4 scope=$5
  shift 5
  local started seconds load rc capped t0
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  load=$(cut -d' ' -f1-3 /proc/loadavg)
  t0=$(date +%s)
  say "ZAP $scan ($kind), load $load"
  OPENVERIFY_ZAP_HEADER_NAME=$header_name OPENVERIFY_ZAP_HEADER_VALUE=$header_value \
    OPENVERIFY_ZAP_HEADER_SCOPE=$scope OPENVERIFY_ZAP_SCAN=$scan \
    docker run --rm --name "openverify-zap-$scan-$$" --network host \
    -e JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true \
    -e OPENVERIFY_ZAP_HEADER_NAME -e OPENVERIFY_ZAP_HEADER_VALUE -e OPENVERIFY_ZAP_HEADER_SCOPE \
    -e OPENVERIFY_ZAP_SCAN -e OPENVERIFY_ZAP_EXCLUDE -e OPENVERIFY_ZAP_SEED_URLS -e OPENVERIFY_ZAP_ATTACK_STRENGTH \
    -v "$wrk:/zap/wrk:rw" "$ZAP_IMAGE" "$@" \
    -c rules.tsv -J "$scan.json" -I --hook /zap/wrk/zap-hooks.py >"$wrk/$scan.log" 2>&1
  rc=$?
  seconds=$(($(date +%s) - t0))
  capped=$(cat "$wrk/$scan-capped.txt" 2>/dev/null || echo n/a)
  # A scan run again in the same run replaces its earlier row.
  awk -F'\t' -v scan="$scan" '$1 != scan' "$run_dir/scans.tsv" >"$run_dir/scans.tsv.new" && mv "$run_dir/scans.tsv.new" "$run_dir/scans.tsv"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$scan" "$kind" "$started" "$seconds" "$load" "$rc" "$capped" >>"$run_dir/scans.tsv"
  say "ZAP $scan: exit $rc in ${seconds}s (capped: $capped); $(grep -cE '^(WARN|FAIL)-NEW: .*\[[0-9]+\]' "$wrk/$scan.log" 2>/dev/null) rule(s) alerting"
  # 0 pass, 1 a FAIL rule alerted, 2 a WARN rule alerted: the scan ran; 3 and above: it did not.
  if [ "$rc" -gt 2 ]; then
    # Kept past revoke for the diagnosis, outside the repository, token-shaped values removed.
    sed -E 's/(ov_(sbx|prod)|ov[suomih])_[A-Za-z0-9_-]{20,}/[credential removed]/g' "$wrk/$scan.log" >"$run_dir/failed-$scan.log"
    say "ZAP $scan did not complete (exit $rc); its log is $run_dir/failed-$scan.log"
    return 1
  fi
  return 0
}

# --- prepare ------------------------------------------------------------------------------------

do_prepare() {
  if [ -e "$credentials" ]; then
    keep_credentials=true
    say "an earlier run's credentials are still in $credentials: run security/zap/run.sh revoke first"
    exit 2
  fi
  if [ "$(id -u)" != "$container_uid" ]; then
    say "ZAP's image runs as uid $container_uid and writes the run directory (mode 0700); run this as that uid"
    exit 2
  fi
  mkdir -p -m 700 "$run_dir" "$wrk" && chmod 700 "$run_dir" "$wrk" || exit 1
  : >"$run_dir/scans.tsv"
  cp "$zap_dir/rules.tsv" "$zap_dir/zap-hooks.py" "$wrk/" || exit 1
  credentials_ts prepare "$abs_run" || { say "prepare failed"; exit 1; }
  require_prepared
  # The images the stack runs (C283.6: the images and their ids), the ladder rung and the machine.
  local images rows="" image id
  images=$(docker ps --filter "label=com.docker.compose.project=$E2E_PROJECT" --format '{{.Image}}' 2>/dev/null | sort -u)
  for image in $images "$NOGUIDANCE_IMAGE"; do
    id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null | head -n 1)
    rows+="$image $id"$'\n'
  done
  IMAGE_ROWS=$rows SCAN_SETTINGS="ZAP's Default Policy (every active rule but rules.tsv's IGNOREs) at attack strength $attack_strength, 2 threads 50 ms apart (under the stack's 1,200 requests a minute per key), at most $scan_minutes minutes of active scan a group; a baseline spiders 1 minute (the flow) or 2 (the console) and posts no form" python3 -I -c 'import json, os, sys
path, zap_image, day = sys.argv[1], sys.argv[2], sys.argv[3]
facts = json.load(open(path, encoding="utf-8"))
facts["date"] = day
rows = [line.split(" ", 1) for line in os.environ["IMAGE_ROWS"].splitlines() if line.strip()]
facts["images"] = [{"name": r[0], "id": (r[1] if len(r) > 1 else "").strip()} for r in rows]
facts["zapImage"] = zap_image
facts["settings"] = os.environ["SCAN_SETTINGS"]
names = [image["name"] for image in facts["images"]]
facts["ladder"] = "i" if any(n.startswith("openverify/api:") for n in names) else "iii"
model, gib = "unknown CPU", 0.0
try:
    model = next(l for l in open("/proc/cpuinfo", encoding="utf-8") if l.startswith("model name")).split(":", 1)[1].strip()
    gib = int(next(l for l in open("/proc/meminfo", encoding="utf-8") if l.startswith("MemTotal")).split()[1]) / 1048576
except (OSError, StopIteration):
    pass
facts["machine"] = f"{model}, {os.cpu_count()} logical CPUs, {gib:.1f} GiB"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(facts, handle, indent=1)
print("run.sh: ladder rung " + facts.get("ladder", "") + "; " + str(len(rows)) + " image(s) recorded", file=sys.stderr)' \
    "$run_dir/facts.json" "$ZAP_IMAGE" "$report_date" || exit 1
}

# --- api ----------------------------------------------------------------------------------------

header_for() { # header_for <auth>: the Authorization value of a group's credential
  case "$1" in
    apiKey) printf 'Bearer %s' "$(json_get "$credentials" apiKey.token)" ;;
    userSession) printf 'Bearer %s' "$(json_get "$credentials" users.api.token)" ;;
    sessionToken) printf 'Bearer %s' "$(json_get "$credentials" flow.sessionToken)" ;;
  esac
}

probe_url() { # probe_url <auth>: a read each credential may make
  case "$1" in
    apiKey) printf '%s/api/v1/inquiries?page%%5Bsize%%5D=1' "$api_url" ;;
    userSession) printf '%s/api/v1/dashboard/me' "$api_url" ;;
    sessionToken) printf '%s/api/v1/flow/session' "$api_url" ;;
  esac
}

probe() { # probe <auth>: the status the API answers the credential with (header on stdin, never argv)
  printf 'Authorization: %s\n' "$(header_for "$1")" |
    curl -s -o /dev/null --max-time 10 -w '%{http_code}' -H @- "$(probe_url "$1")"
}

# A scan with a credential the API refuses would scan the routes unauthenticated: the key (two
# hours) is renewed once, the admin sessions are signed in again, and a refused flow session stops.
require_credential() { # require_credential <auth>
  local status
  status=$(probe "$1")
  if [ "$status" = 401 ]; then
    case "$1" in
      apiKey) credentials_ts refresh-key "$abs_run" || exit 1 ;;
      userSession) credentials_ts refresh-users "$abs_run" || exit 1 ;;
    esac
    status=$(probe "$1")
  fi
  if [ "$status" = 401 ]; then
    say "the API refuses the run's $1 credential (401): run.sh revoke, then prepare again"
    exit 1
  fi
}

api_scan() { # api_scan <group> <auth>
  local group=$1 auth=$2 value
  require_credential "$auth"
  value=$(header_for "$auth")
  # Two threads 50 ms apart stay under the stack's 1,200 requests a minute per key (at 100 ms the
  # first group sent 5,806 requests in 416 s with no 429); LOW strength lets more of the policy's
  # rules finish within the call (at MEDIUM, 19 of the lists group's rules finished in 6 minutes).
  OPENVERIFY_ZAP_ATTACK_STRENGTH=$attack_strength zap_run "api-$group" api Authorization "$value" "$(scope_of "$api_url")" \
    zap-api-scan.py -t "/zap/wrk/openapi-$group.json" -f openapi -O "$api_url" \
    -z "-silent -config scanner.threadPerHost=2 -config scanner.delayInMs=50 -config scanner.maxScanDurationInMins=$scan_minutes"
}

split_groups() { # the groups' lines "<group> TAB <auth> TAB <ops>", their documents written to wrk/
  helper split --spec "$run_dir/openapi.json" --groups "$zap_dir/api-groups.tsv" --out "$wrk" --credentials "$credentials"
}

do_api() {
  require_prepared
  local lines group auth ops wanted=("$@")
  lines=$(split_groups) || exit 1
  for group in "${wanted[@]}"; do
    if [ "$group" = flow ] || ! cut -f1 <<<"$lines" | grep -qxF "$group"; then
      say "no API group $group (flow's routes are run.sh flow routes)"
      exit 2
    fi
  done
  while IFS=$'\t' read -r group auth ops; do
    [ "$group" = flow ] && continue
    if [ "${#wanted[@]}" -gt 0 ] && ! printf '%s\n' "${wanted[@]}" | grep -qxF "$group"; then continue; fi
    say "API group $group: $ops operations, $auth"
    if [ "$auth" = userSession ]; then
      credentials_ts refresh-users "$abs_run" || exit 1
    fi
    api_scan "$group" "$auth" || exit 1
  done <<<"$lines"
}

# --- flow ---------------------------------------------------------------------------------------

capture_headers() { # capture_headers <entry> <url>: the hosted entry's headers and page, for report
  curl -sS --max-time 20 -D "$wrk/headers-$1.txt" -o "$wrk/body-$1.html" "$2" >/dev/null || return 1
}

flow_baseline() { # flow_baseline <scan> <flow origin>
  local scan=$1 origin=$2 inquiry
  inquiry=$(json_get "$run_dir/facts.json" inquiryId)
  capture_headers "$scan-root" "$origin/" || { say "the flow at $origin did not answer"; return 1; }
  OPENVERIFY_ZAP_SEED_URLS=$(printf '%s\n' "$origin/preview" "$origin/embed/$inquiry" "$origin/config.json") \
    zap_run "$scan" baseline "" "" "" zap-baseline.py -t "$origin/" -m 1 -z "-silent -config spider.postform=false"
}

do_flow() {
  require_prepared
  local parts=("$@") part port origin waited
  [ "${#parts[@]}" -eq 0 ] && parts=(hosted noguidance routes)
  for part in "${parts[@]}"; do
    case "$part" in
      hosted) flow_baseline flow-guidance "$flow_url" || exit 1 ;;
      noguidance)
        port=$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
        origin="http://127.0.0.1:$port"
        noguidance="openverify-dast-flow-noguidance-$$"
        docker run -d --rm --name "$noguidance" --network host --read-only --tmpfs /tmp \
          -e OPENVERIFY_FLOW_API_URL="$api_url" -e OPENVERIFY_DASHBOARD_PUBLIC_URL="$dashboard_url" \
          "$NOGUIDANCE_IMAGE" node server.ts --hostname 127.0.0.1 --port "$port" --dist dist >/dev/null || exit 1
        waited=0
        until curl -s -o /dev/null --max-time 2 "$origin/"; do
          waited=$((waited + 1))
          [ "$waited" -gt "$settle_seconds" ] && { say "the no-guidance flow did not answer on $origin"; exit 1; }
          sleep 1
        done
        flow_baseline flow-noguidance "$origin" || exit 1
        stop_noguidance ;;
      routes)
        split_groups >/dev/null || exit 1
        api_scan flow sessionToken || exit 1 ;;
      *) say "no flow part $part (hosted, noguidance, routes)"; exit 2 ;;
    esac
  done
}

# --- console ------------------------------------------------------------------------------------

do_console() {
  require_prepared
  local cookie
  credentials_ts refresh-users "$abs_run" || exit 1
  # The production console reads only its Secure cookie (KP11-78: __Host-, apps/dashboard/src/lib/session-cookie.ts).
  cookie="__Host-openverify_session=$(json_get "$credentials" users.console.token)"
  zap_run console baseline Cookie "$cookie" "$(scope_of "$dashboard_url")" \
    zap-baseline.py -t "$dashboard_url/" -m 2 -z "-silent -config spider.postform=false" || exit 1
}

# --- report -------------------------------------------------------------------------------------

do_report() {
  require_prepared
  local out="$report_dir/dast-$report_date.md" rc triage=()
  [ -s "$zap_dir/triage.tsv" ] && triage=(--triage "$zap_dir/triage.tsv")
  helper report --run-dir "$abs_run" --rules "$zap_dir/rules.tsv" \
    --flow-headers "$repo_root/apps/flow/src/security/response-headers.ts" "${triage[@]}" --out "$out"
  rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || exit "$rc"
  [ -s "$out" ] || { say "no report was written"; exit 2; }
  # C283.2: gitleaks over the generated file before it is committed (the repository's rules, then
  # the PII-pattern rules).
  if ! gitleaks dir --no-banner --redact --exit-code 1 --config "$repo_root/.gitleaks.toml" "$out" >&2 ||
    ! gitleaks dir --no-banner --redact --exit-code 1 --config "$repo_root/security/gitleaks-pii.toml" "$out" >&2; then
    rm -f -- "$out"
    say "gitleaks found something in the report; it was removed"
    exit 1
  fi
  say "report: $out"
  [ "$rc" -eq 0 ] || { say "the report shows an open high finding"; exit 1; }
}

# --- revoke -------------------------------------------------------------------------------------

do_revoke() {
  local rc=0
  stop_noguidance
  if [ -e "$credentials" ]; then
    credentials_ts revoke "$abs_run" || rc=1
    [ "$rc" -eq 0 ] && rm -f -- "$credentials"
  fi
  # ZAP's raw reports and the per-run documents (the flow group's holds the run's handoff).
  rm -rf -- "$wrk"
  return "$rc"
}

case "$sub" in
  prepare) do_prepare ;;
  api) do_api "$@" ;;
  flow) do_flow "$@" ;;
  console) do_console ;;
  report) do_report ;;
  revoke) do_revoke || exit 1 ;;
  all)
    current=prepare
    do_prepare
    current=api
    do_api
    current=flow
    do_flow
    current=console
    do_console
    current=report
    do_report
    current=revoke
    do_revoke || exit 1 ;;
esac
exit 0
