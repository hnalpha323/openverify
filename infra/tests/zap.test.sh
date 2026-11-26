#!/usr/bin/env bash
# Contract test for the DAST scans (Phase 11, Workflow 11F, dast-11f; C283; fix-records owns it
# after 11F). With no argument it runs only its static half: no Docker and no network, because every
# loop over infra/tests/*.test.sh runs it that way, and ci.yml's supply-chain job runs it so.
#
# Static half:
#   - security/zap/run.sh parses, names its subcommands and refuses an unknown one (exit 2);
#   - ZAP's image is one reference, tag@sha256 (images.test.sh pins holds which one);
#   - security/zap/rules.tsv: every line id<TAB>FAIL|WARN|IGNORE<TAB>(name)[<TAB>reason], ids
#     unique, every IGNORE with its reason; security/zap/api-groups.tsv covers every operation of
#     docs/api/openapi.json (dast-zap.py check);
#   - the report generator strips every header and credential: security/tests/fixtures/zap/'s
#     synthetic raw report (an Authorization header, a Cookie and the API key) is the positive
#     control, and the report keeps none of them;
#   - run.sh with stand-ins for docker, node, curl and gitleaks on PATH (a temporary directory, never
#     the real tools): the whole run calls prepare, the scans, report and revoke in order; a failed
#     scan still revokes the credentials and removes the raw reports; a gitleaks finding removes the
#     report; a target that is not loopback is refused before ZAP starts; no credential value is ever
#     on a command line; every ZAP container runs on the host network with -silent; and nothing is
#     written inside the repository (git status unchanged) except the report, which these runs write
#     to a temporary directory;
#   - run.sh refuses a run directory inside the repository.
# --docker: also checks that rules.tsv lists every rule the pinned image generates (zap-api-scan.py
#   -g against a throwaway loopback page; the image must be pulled).
#
# Usage: infra/tests/zap.test.sh [--docker]
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
run_sh="$repo_root/security/zap/run.sh"
helper="$repo_root/security/zap/dast-zap.py"
fixtures="$repo_root/security/tests/fixtures/zap"
docker_half=false
for arg in "$@"; do
  case "$arg" in
    --docker) docker_half=true ;;
    *) echo "usage: $0 [--docker]" >&2; exit 2 ;;
  esac
done

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
expect() { local desc=$1; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else nok "$desc"; fi; }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected '$2', got '$3'"; fi; }

tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

# --- the script and its pin ------------------------------------------------------------------------
expect "security/zap/run.sh exists and is executable" test -x "$run_sh"
expect "security/zap/run.sh parses (bash -n)" bash -n "$run_sh"
bash "$run_sh" nothing >"$tmp/usage.out" 2>&1
expect_eq "run.sh refuses an unknown subcommand (exit 2)" 2 "$?"
for sub in prepare api flow console report revoke; do
  if grep -qw "$sub" "$tmp/usage.out"; then ok "run.sh's usage names $sub"; else nok "run.sh's usage names $sub"; fi
done
refs=$(grep -c "^readonly ZAP_IMAGE=" "$run_sh")
expect_eq "run.sh names ZAP's image once" 1 "$refs"
if grep -Eq "^readonly ZAP_IMAGE='ghcr\.io/zaproxy/zaproxy:2\.17\.0@sha256:[0-9a-f]{64}'" "$run_sh"; then
  ok "ZAP's image is the 2.17.0 tag by digest"
else
  nok "ZAP's image is the 2.17.0 tag by digest"
fi

# --- the console's session cookie (KP11-78; Workflow 11F, fix-records) -----------------------------
# A production console reads only its Secure cookie's name, so a scan that sends another name runs
# unauthenticated. run.sh sends the dashboard's own SECURE_SESSION_COOKIE name.
cookie_src="$repo_root/apps/dashboard/src/lib/session-cookie.ts"
plain=$(sed -n "s/^export const SESSION_COOKIE = '\\([^']*\\)';$/\\1/p" "$cookie_src")
secure_prefix=$(sed -n 's/^export const SECURE_SESSION_COOKIE = `\([^$]*\)\${SESSION_COOKIE}`;$/\1/p' "$cookie_src")
expect_eq "the dashboard's Secure session cookie is __Host-openverify_session" "__Host-openverify_session" "$secure_prefix$plain"
sent=$(sed -n 's/^  cookie="\([^=]*\)=\$(json_get "\$credentials" users\.console\.token)"$/\1/p' "$run_sh")
expect_eq "run.sh's console scan sends the console session as the dashboard's Secure cookie" "$secure_prefix$plain" "$sent"

# --- the rules and the groups ----------------------------------------------------------------------
rules="$repo_root/security/zap/rules.tsv"
expect "security/zap/rules.tsv exists" test -s "$rules"
bad=$(awk -F'\t' '!/^#/ && NF > 0 {
  if (NF < 3 || NF > 4 || $1 !~ /^[0-9]+$/ || $2 !~ /^(FAIL|WARN|IGNORE)$/ || $3 == "") print NR
  else if ($2 == "IGNORE" && (NF < 4 || $4 ~ /^ *$/)) print NR
}' "$rules" | paste -sd' ' -)
expect_eq "every rules.tsv line is id, action, name[, reason] and every IGNORE has its reason" "" "$bad"
dups=$(awk -F'\t' '!/^#/ && NF > 0 {print $1}' "$rules" | sort | uniq -d | paste -sd' ' -)
expect_eq "no rule id appears twice in rules.tsv" "" "$dups"
expect "dast-zap.py check: the rules parse and api-groups.tsv covers docs/api/openapi.json" \
  python3 -I "$helper" check --rules "$rules" --groups "$repo_root/security/zap/api-groups.tsv" --spec "$repo_root/docs/api/openapi.json"

# --- the report generator strips headers (the positive control) --------------------------------------
run="$tmp/run"
mkdir -p "$run/wrk"
cp "$fixtures/raw-report.json" "$run/wrk/api-core.json"
cp "$fixtures/credentials.json" "$run/credentials.json"
cp "$repo_root/docs/api/openapi.json" "$run/openapi.json"
printf '{"date":"2026-11-20","ladder":"i","machine":"synthetic","images":[],"zapImage":"z","internalRoute":{"path":"/api/v1/internal/embed-policies/{id}","status":401}}\n' >"$run/facts.json"
printf 'api-core\tapi\t2026-11-20T00:00:00Z\t1\t0.00 0.00 0.00\t2\tno\n' >"$run/scans.tsv"
python3 -I "$helper" report --run-dir "$run" --rules "$rules" --out "$tmp/report.md" >"$tmp/report.out" 2>&1
report_rc=$?
expect "the report is written from the synthetic raw report" test -s "$tmp/report.md"
expect_eq "the synthetic SQL injection (High, not ignored) fails the report (exit 1)" 1 "$report_rc"
for needle in Authorization Cookie Bearer Set-Cookie "syntax error" \
  "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["apiKey"]["token"])' "$fixtures/credentials.json")" \
  "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["users"]["api"]["token"])' "$fixtures/credentials.json")"; do
  if grep -qF -- "$needle" "$tmp/report.md"; then nok "the report holds no '${needle:0:14}...'"; else ok "the report holds no '${needle:0:14}...'"; fi
done

# --- run.sh with stand-ins ------------------------------------------------------------------------
fake="$tmp/bin"
mkdir -p "$fake"
calls="$tmp/calls.log"
export ZAP_TEST_CALLS="$calls" ZAP_TEST_FIXTURES="$fixtures" ZAP_TEST_REPO="$repo_root"
cat >"$fake/docker" <<'SH'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >>"$ZAP_TEST_CALLS"
case "$1" in
  image) printf 'sha256:%064d\n' 0; exit 0 ;;
  rm | stop | ps | logs) exit 0 ;;
  run)
    wrk=""; report=""; prev=""; detach=false
    for a in "$@"; do
      case "$prev" in -v) case "$a" in *:/zap/wrk:*) wrk=${a%%:/zap/wrk:*} ;; esac ;; -J) report=$a ;; esac
      [ "$a" = -d ] && detach=true
      prev=$a
    done
    if $detach; then echo 0123456789ab; exit 0; fi
    [ "${ZAP_TEST_DOCKER_FAIL:-0}" = 1 ] && exit 3
    if [ -n "$report" ] && [ -n "$wrk" ]; then
      cp "${ZAP_TEST_RAW:-$ZAP_TEST_FIXTURES/raw-report.json}" "$wrk/$report"
      printf '[["GET","http://127.0.0.1:43000/api/v1/inquiries",200]]\n' >"$wrk/${report%.json}-messages.json"
    fi
    exit 2 ;;
esac
exit 0
SH
cat >"$fake/node" <<'SH'
#!/usr/bin/env bash
printf 'node %s\n' "$*" >>"$ZAP_TEST_CALLS"
cmd="" dir=""
for a in "$@"; do case "$a" in prepare | revoke) cmd=$a ;; /*) [ -n "$cmd" ] && dir=$a ;; esac; done
case "$cmd" in
  prepare)
    umask 077
    cp "$ZAP_TEST_FIXTURES/credentials.json" "$dir/credentials.json"
    api=${ZAP_TEST_API_URL:-http://127.0.0.1:43000}
    printf '{"date":"2026-11-20","machine":"synthetic","apiUrl":"%s","flowUrl":"http://127.0.0.1:43001","dashboardUrl":"http://localhost:43002","images":[],"internalRoute":{"path":"/api/v1/internal/embed-policies/{id}","status":401}}\n' "$api" >"$dir/facts.json"
    cp "$ZAP_TEST_REPO/docs/api/openapi.json" "$dir/openapi.json" ;;
  revoke) printf 'revoked\n' >>"$ZAP_TEST_CALLS" ;;
esac
exit 0
SH
cat >"$fake/curl" <<'SH'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"$ZAP_TEST_CALLS"
prev="" hdr="" out=""
for a in "$@"; do case "$prev" in -D) hdr=$a ;; -o) out=$a ;; esac; prev=$a; done
if [ -n "$hdr" ] && [ "$hdr" != /dev/null ]; then printf 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n' >"$hdr"; fi
if [ -n "$out" ] && [ "$out" != /dev/null ]; then printf '<html></html>' >"$out"; fi
printf '%s' "${ZAP_TEST_PROBE_STATUS:-200}"
exit 0
SH
cat >"$fake/gitleaks" <<'SH'
#!/usr/bin/env bash
printf 'gitleaks %s\n' "$*" >>"$ZAP_TEST_CALLS"
exit "${ZAP_TEST_GITLEAKS_RC:-0}"
SH
chmod +x "$fake"/*
clean_raw="$tmp/clean-raw.json"
python3 -I -c 'import json,sys
r=json.load(open(sys.argv[1])); r["site"][0]["alerts"]=[a for a in r["site"][0]["alerts"] if a["riskcode"]!="3"]
json.dump(r,open(sys.argv[2],"w"))' "$fixtures/raw-report.json" "$clean_raw"

status_before=$(git -C "$repo_root" status --porcelain)
stub_run() { # stub_run <name> [env...] -- <run.sh args...>
  local name=$1
  shift
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  : >"$calls"
  env PATH="$fake:$PATH" OPENVERIFY_ZAP_RUN_DIR="$tmp/runs/$name" OPENVERIFY_ZAP_REPORT_DIR="$tmp/reports/$name" \
    OPENVERIFY_ZAP_DATE=2026-11-20 OPENVERIFY_ZAP_SETTLE_SECONDS=0 OPENVERIFY_ZAP_CONTAINER_UID="$(id -u)" \
    "${envs[@]}" bash "$run_sh" "$@" >"$tmp/$name.out" 2>&1
}
order() { grep -oE '^(node .*(prepare|revoke)|docker run .*(zap-api-scan\.py|zap-baseline\.py)|gitleaks)' "$calls" |
  sed -E 's/^node .*(prepare|revoke).*/\1/; s/^docker run .*zap-api-scan\.py.*/api-scan/; s/^docker run .*zap-baseline\.py.*/baseline/; s/^gitleaks.*/gitleaks/' |
  uniq | paste -sd' ' -; }

stub_run full ZAP_TEST_RAW="$clean_raw" --
rc=$?
expect_eq "the whole run (no argument) exits 0 when no scan finds a high" 0 "$rc"
expect_eq "the whole run calls prepare, the API scans, the baselines, gitleaks over the report, then revoke" \
  "prepare api-scan baseline api-scan baseline gitleaks revoke" "$(order)"
expect "the whole run writes the dated report where it is told" test -s "$tmp/reports/full/dast-2026-11-20.md"
# The console's idle timeout (C245.1, 30 minutes) ends a session the scans left idle: each scan
# that sends one signs fresh sessions in first (the dashboard API group and the console).
expect_eq "fresh admin sessions are signed in before each dashboard API group and the console" \
  "refresh-users api-dashboard-sign-in refresh-users api-dashboard-users refresh-users api-dashboard-records refresh-users api-dashboard-settings refresh-users api-dashboard refresh-users console" \
  "$(grep -oE '^(node .*refresh-users|docker run .*--name openverify-zap-(api-dashboard[a-z-]*|console)-[0-9]+)' "$calls" |
    sed -E 's/^node .*refresh-users.*/refresh-users/; s/.*--name openverify-zap-(api-dashboard[a-z-]*|console)-[0-9]+$/\1/' | paste -sd' ' -)"
expect "revoke removes the credentials file" test ! -e "$tmp/runs/full/credentials.json"
expect "revoke removes ZAP's raw reports and the per-run documents" test ! -e "$tmp/runs/full/wrk"
zap_runs=$(grep -E '^docker run .*zap-(api-scan|baseline)\.py' "$calls")
expect_eq "every ZAP container runs on the host network, with -silent and the IPv4 stack" "" \
  "$(grep -v -- '--network host' <<<"$zap_runs"; grep -v -- '-silent' <<<"$zap_runs"; grep -v 'JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true' <<<"$zap_runs")"
zap_pin=$(sed -n "s/^readonly ZAP_IMAGE='\(.*\)'.*$/\1/p" "$run_sh")
expect_eq "every ZAP container runs the pinned image" "" "$(grep -vF -- "$zap_pin" <<<"$zap_runs")"
names=$(grep -oE '^docker run .*--name [^ ]+' "$calls" | sed -E 's/.*--name //' | sort)
expect_eq "no two containers of a run share a name (the no-guidance flow's and its scan's differ)" "" "$(uniq -d <<<"$names")"
expect "the no-guidance flow's container is started" grep -qE '^docker run -d .*openverify/flow:11c-local-noguidance' "$calls"
leaks=""
for t in $(python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["apiKey"]["token"], c["users"]["api"]["token"], c["users"]["console"]["token"], c["flow"]["sessionToken"], c["handoff"]["token"])' "$fixtures/credentials.json"); do
  grep -qF -- "$t" "$calls" && leaks="$leaks ${t:0:6}"
done
expect_eq "no credential value is on any command line" "" "$leaks"
expect "the credential reaches ZAP by environment variable name only (-e OPENVERIFY_ZAP_HEADER_VALUE)" \
  grep -qE -- '-e OPENVERIFY_ZAP_HEADER_VALUE( |$)' "$calls"

stub_run failing ZAP_TEST_DOCKER_FAIL=1 --
rc=$?
if [ "$rc" -ne 0 ]; then ok "a failed scan fails the whole run"; else nok "a failed scan fails the whole run"; fi
expect_eq "a failed scan still revokes the credentials (prepare, the scan, revoke)" "prepare api-scan revoke" "$(order)"
expect "after a failed scan the credentials file is gone" test ! -e "$tmp/runs/failing/credentials.json"
expect "after a failed scan the raw reports are gone" test ! -e "$tmp/runs/failing/wrk"

stub_run high --
rc=$?
expect_eq "an open high fails the run (exit 1) and still revokes" "1 revoke" "$rc $(order | awk '{print $NF}')"

stub_run expired -- prepare
stub_run expired ZAP_TEST_PROBE_STATUS=401 -- api
rc=$?
if [ "$rc" -ne 0 ]; then ok "a credential the API refuses (401) stops the API scan"; else nok "a credential the API refuses (401) stops the API scan"; fi
expect "an expired run key is renewed once before the scan gives up (credentials.ts refresh-key)" grep -q 'refresh-key' "$calls"
expect_eq "no API scan runs with a refused credential" "" "$(grep -E 'zap-api-scan\.py' "$calls")"

stub_run leak ZAP_TEST_RAW="$clean_raw" ZAP_TEST_GITLEAKS_RC=1 --
rc=$?
if [ "$rc" -ne 0 ]; then ok "a gitleaks finding over the report fails the run"; else nok "a gitleaks finding over the report fails the run"; fi
expect "a gitleaks finding removes the report" test ! -e "$tmp/reports/leak/dast-2026-11-20.md"

stub_run remote ZAP_TEST_API_URL=http://192.0.2.10:43000 --
rc=$?
if [ "$rc" -ne 0 ]; then ok "a target that is not loopback is refused"; else nok "a target that is not loopback is refused"; fi
expect_eq "no ZAP container starts against a target that is not loopback" "" "$(grep -E 'zap-(api-scan|baseline)\.py' "$calls")"
expect_eq "and the credentials are revoked" "prepare revoke" "$(order)"

stub_run single -- prepare
expect "prepare alone keeps the credentials for the next subcommand" test -s "$tmp/runs/single/credentials.json"
expect "the credentials file is mode 0600" test "$(stat -c %a "$tmp/runs/single/credentials.json")" = 600
stub_run single -- prepare
expect_eq "prepare refuses while an earlier run's credentials are not revoked (exit 2)" 2 "$?"
stub_run single -- revoke
expect "revoke alone removes them" test ! -e "$tmp/runs/single/credentials.json"

: >"$calls"
env PATH="$fake:$PATH" OPENVERIFY_ZAP_RUN_DIR="$repo_root/.zap-run" bash "$run_sh" prepare >"$tmp/inside.out" 2>&1
expect_eq "run.sh refuses a run directory inside the repository (exit 2)" 2 "$?"
expect "and creates nothing there" test ! -e "$repo_root/.zap-run"
expect_eq "the stand-in runs wrote nothing inside the repository" "$status_before" "$(git -C "$repo_root" status --porcelain)"

# --- the docker half --------------------------------------------------------------------------------
if $docker_half; then
  image=$(sed -n "s/^readonly ZAP_IMAGE='\(.*\)'.*$/\1/p" "$run_sh")
  gen="$tmp/gen"
  mkdir -p "$gen/site" "$gen/wrk"
  printf '<html><head><title>x</title></head><body>x</body></html>' >"$gen/site/index.html"
  port=$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
  printf '{"openapi":"3.0.3","info":{"title":"gen","version":"1"},"servers":[{"url":"http://127.0.0.1:%s"}],"paths":{"/index.html":{"get":{"responses":{"200":{"description":"ok"}}}}}}' "$port" >"$gen/wrk/openapi.json"
  site="openverify-zap-test-site-$$"
  docker run -d --rm --name "$site" --network host -v "$gen/site:/srv:ro" python:3.12-slim python -m http.server "$port" --bind 127.0.0.1 --directory /srv >/dev/null
  sleep 4
  docker run --rm --network host -e JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true -v "$gen/wrk:/zap/wrk:rw" "$image" \
    zap-api-scan.py -t /zap/wrk/openapi.json -f openapi -g gen.conf -I -z -silent >"$tmp/gen.out" 2>&1
  docker rm -f "$site" >/dev/null 2>&1
  generated=$(awk -F'\t' '!/^#/ && NF > 0 {print $1}' "$gen/wrk/gen.conf" 2>/dev/null | sort -u)
  listed=$(awk -F'\t' '!/^#/ && NF > 0 {print $1}' "$rules" | sort -u)
  expect "the image generated its rule list" test -n "$generated"
  expect_eq "rules.tsv lists every rule the pinned image generates" "" "$(comm -23 <(printf '%s\n' "$generated") <(printf '%s\n' "$listed") | paste -sd' ' -)"
fi

printf '\n# %d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
