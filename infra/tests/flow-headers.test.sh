#!/usr/bin/env bash
# Contract test for the hosted flow's response headers as the compose app profile serves them
# (plan C157.3; C107.9 before it, carried since Phase 1A).
#
# Since Workflow 9A the app profile's flow service is the flow server (apps/flow/server.ts), which
# computes each entry's headers per request (C157.1):
#   hosted  /            Content-Security-Policy = the flow policy plus frame-ancestors 'none',
#                        X-Frame-Options: DENY, Permissions-Policy: camera=(self), geolocation=(),
#                        microphone=(), Referrer-Policy: no-referrer, X-Content-Type-Options: nosniff
#   preview /preview     connect-src 'none', frame-ancestors the console origin only, no camera
#   embed   /embed/<id>  frame-ancestors 'none' here, since no flow-server token is configured
#   every entry          Strict-Transport-Security while OPENVERIFY_HSTS_MAX_AGE is above 0 (C255.1;
#                        the live container sets it to a year)
# Development keeps `vite preview` with Phase 7's fixed FLOW_RESPONSE_HEADERS
# (apps/flow/src/security/response-headers.ts).
#
# Static checks (always run): compose's flow service runs the flow server, never `vite preview`;
# the header module still holds exactly the four C107.9 headers, which vite.config.ts hands to
# `preview.headers`.
# Live checks (skipped with --static-only): the flow image (Phase 11, Workflow 11C, C257.1: the
# development apps image it replaces is gone) runs the flow service's command in one container of
# its own, named openverify-flow-headers-<pid> and removed at the end (nothing else is touched), on
# a loopback port; each entry answers with its headers; then infra/tests/flow-server.test.sh
# (flow-server-embed's) checks that container through FLOW_SERVER_URL. The image must exist:
# `docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .` (or FLOW_IMAGE=<tag>).
#
# Usage: infra/tests/flow-headers.test.sh [--static-only]
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
headers_file="$repo_root/apps/flow/src/security/response-headers.ts"
vite_config="$repo_root/apps/flow/vite.config.ts"
compose_file="$repo_root/infra/docker-compose.yml"
image="${FLOW_IMAGE:-openverify/flow:11c-local}"
console_origin='http://localhost:3001'
static_only=false
for arg in "$@"; do
  case "$arg" in
    --static-only) static_only=true ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

# The flow service's command, as compose runs it and as the live half runs it (the flow image's
# own command: the server's source by Node's type stripping, over the built bundle).
flow_command=(node server.ts --hostname 0.0.0.0 --port 4173 --dist dist)

# name|value, one per line: what vite preview sends in development (C107.9).
expected_headers() {
  printf '%s\n' \
    "Content-Security-Policy|frame-ancestors 'none'" \
    'Permissions-Policy|camera=(self), geolocation=(), microphone=()' \
    'Referrer-Policy|no-referrer' \
    'X-Content-Type-Options|nosniff'
}

# ---------------------------------------------------------------- static ----
# The flow service's block: from `  flow:` to the next service at the same indentation.
flow_block=$(awk '/^  flow:$/ { inside = 1; print; next } inside && /^  [a-z][a-z0-9_-]*:$/ { exit } inside { print }' "$compose_file")
command_line=$(printf '%s\n' "$flow_block" | tr -d ' \n' | grep -oE 'command:\[[^]]*\]' | head -n 1)
expected_command="command:[$(printf '%s,' "${flow_command[@]}" | sed -E 's/,$//')]"
# Compose may quote an item and end the list with a comma; compare without either.
if [ "$(printf '%s' "$command_line" | tr -d "'\"" | sed -E 's/,\]$/]/')" = "$expected_command" ]; then
  ok "compose's flow service runs the flow server (C157.3)"
else
  nok "compose's flow service runs the flow server (C157.3)" "found: ${command_line:-none}"
fi
if printf '%s\n' "$flow_block" | grep -q 'vite'; then
  nok "compose's flow service no longer runs vite preview"
else
  ok "compose's flow service no longer runs vite preview"
fi
for variable in OPENVERIFY_FLOW_SERVER_TOKEN OPENVERIFY_FLOW_SERVER_API_URL \
  OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS OPENVERIFY_DASHBOARD_PUBLIC_URL OPENVERIFY_FLOW_API_URL \
  VITE_OPENVERIFY_API_URL; do
  if printf '%s\n' "$flow_block" | grep -qE "^[[:space:]]+${variable}:"; then
    ok "the flow service reads $variable"
  else
    nok "the flow service reads $variable"
  fi
done

# The module's entries, as `'Name': 'value',` or `'Name': "value",` lines.
declared=$(grep -E "^[[:space:]]*'[A-Za-z-]+':[[:space:]]*['\"]" "$headers_file" |
  sed -E "s/^[[:space:]]*'([A-Za-z-]+)':[[:space:]]*['\"](.*)['\"],?[[:space:]]*$/\1|\2/")
if [ "$declared" = "$(expected_headers)" ]; then
  ok "FLOW_RESPONSE_HEADERS holds exactly the four C107.9 headers (development)"
else
  nok "FLOW_RESPONSE_HEADERS holds exactly the four C107.9 headers (development)" "found: ${declared//$'\n'/; }"
fi
if tr -d ' \n' <"$vite_config" | grep -q 'preview:{headers:{...FLOW_RESPONSE_HEADERS}}\|preview:{headers:FLOW_RESPONSE_HEADERS'; then
  ok "vite.config.ts hands them to preview.headers"
else
  nok "vite.config.ts hands them to preview.headers"
fi

# C255.1 (Phase 11, Workflow 11B, platform-ops): OPENVERIFY_HSTS_MAX_AGE adds
# Strict-Transport-Security in the server's base headers, on top of FLOW_RESPONSE_HEADERS (never a
# second list), and the development headers never carry it.
server_file="$repo_root/apps/flow/server.ts"
base_block=$(awk '/^const baseHeaders = / { inside = 1 } inside { print } inside && /^\}\);$/ { exit }' "$server_file")
if printf '%s\n' "$base_block" | grep -q '\.\.\.FLOW_RESPONSE_HEADERS' &&
  printf '%s\n' "$base_block" | grep -q "'Strict-Transport-Security': \`max-age=" &&
  grep -q "read('OPENVERIFY_HSTS_MAX_AGE')" "$server_file"; then
  ok "the flow server adds Strict-Transport-Security from OPENVERIFY_HSTS_MAX_AGE on top of FLOW_RESPONSE_HEADERS (C255.1)"
else
  nok "the flow server adds Strict-Transport-Security from OPENVERIFY_HSTS_MAX_AGE on top of FLOW_RESPONSE_HEADERS (C255.1)"
fi
if grep -q 'Strict-Transport-Security' "$headers_file"; then
  nok "FLOW_RESPONSE_HEADERS leaves Strict-Transport-Security to the server's setting (C255.1)"
else
  ok "FLOW_RESPONSE_HEADERS leaves Strict-Transport-Security to the server's setting (C255.1)"
fi

if [ "$static_only" = true ]; then
  finish
fi

# ------------------------------------------------------------------ live ----
if ! docker image inspect "$image" >/dev/null 2>&1; then
  nok "the flow image $image exists" "build it: docker build -f infra/docker/flow.Dockerfile -t $image ."
  finish
fi
name="openverify-flow-headers-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if ! docker run -d --rm --name "$name" -p 127.0.0.1::4173 \
  -e OPENVERIFY_DASHBOARD_PUBLIC_URL="$console_origin" \
  -e OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS=0 \
  -e OPENVERIFY_HSTS_MAX_AGE=31536000 \
  "$image" "${flow_command[@]}" >/dev/null; then
  nok "the flow container starts"
  finish
fi
port=$(docker port "$name" 4173/tcp | head -n 1 | sed -E 's/.*:([0-9]+)$/\1/')
url="http://127.0.0.1:${port}"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$url/"; then break; fi
  sleep 1
done

# value_of <response> <header>: one header's value, CR stripped.
value_of() {
  printf '%s\n' "$1" | tr -d '\r' | grep -i "^$2:" | head -n 1 | sed -E 's/^[^:]+:[[:space:]]*//'
}
expect_header() {
  local label=$1 response=$2 header=$3 expected=$4 got
  got=$(value_of "$response" "$header")
  if [ "$got" = "$expected" ]; then ok "$label sends $header: $expected"; else nok "$label sends $header: $expected" "got '$got'"; fi
}
expect_csp() {
  local label=$1 response=$2 directive=$3 got
  got=$(value_of "$response" 'Content-Security-Policy')
  case "; $got;" in
    *"; $directive;"*) ok "$label's policy holds $directive" ;;
    *) nok "$label's policy holds $directive" "got '$got'" ;;
  esac
}

hosted=$(curl -fsS -D - -o /dev/null "$url/" 2>&1) || { nok "the flow answers on $url/" "$hosted"; finish; }
ok "the flow server answers on its container port"
expect_csp 'the hosted page' "$hosted" "frame-ancestors 'none'"
expect_csp 'the hosted page' "$hosted" "default-src 'self'"
expect_header 'the hosted page' "$hosted" 'X-Frame-Options' 'DENY'
while IFS='|' read -r header value; do
  [ "$header" = 'Content-Security-Policy' ] && continue
  expect_header 'the hosted page' "$hosted" "$header" "$value"
done < <(expected_headers)

expect_header 'the hosted page' "$hosted" 'Strict-Transport-Security' 'max-age=31536000; includeSubDomains'

preview=$(curl -fsS -D - -o /dev/null "$url/preview" 2>&1) || nok "the preview answers" "$preview"
expect_csp 'the preview' "$preview" "connect-src 'none'"
expect_csp 'the preview' "$preview" "frame-ancestors $console_origin"
expect_header 'the preview' "$preview" 'Permissions-Policy' 'camera=(), microphone=(), geolocation=()'
expect_header 'the preview' "$preview" 'Strict-Transport-Security' 'max-age=31536000; includeSubDomains'

embed=$(curl -sS -D - -o /dev/null "$url/embed/inq_01JAAAAAAAAAAAAAAAAAAAAAAA" 2>&1)
expect_csp 'an embed with no lookup configured' "$embed" "frame-ancestors 'none'"

# flow-server-embed's contract test, against this container.
if FLOW_SERVER_URL="$url" FLOW_SERVER_CONSOLE_ORIGIN="$console_origin" \
  bash "$repo_root/infra/tests/flow-server.test.sh" >"${TMPDIR:-/tmp}/$name.flow-server.log" 2>&1; then
  ok "infra/tests/flow-server.test.sh passes against the container"
else
  nok "infra/tests/flow-server.test.sh passes against the container" "$(tail -n 5 "${TMPDIR:-/tmp}/$name.flow-server.log" | tr '\n' ' ')"
fi
rm -f "${TMPDIR:-/tmp}/$name.flow-server.log"
finish
