#!/usr/bin/env bash
# Contract test for the flow server's entries (plan C157; Workflow 9A, flow-server-embed).
#
# The flow server (apps/flow/server.ts) computes each document's headers per request:
#   hosted  /             the flow policy with frame-ancestors 'none', X-Frame-Options: DENY
#   preview /preview      connect-src 'none', frame-ancestors the console origin only
#   embed   /embed/<id>   frame-ancestors the inquiry's embed policy, 'none' on any failure
# and serves dist/ with traversal refused, known extensions only, nosniff, immutable hashed
# assets and no-store documents; a malformed id answers 404 and makes no lookup; each client has a
# token bucket (60 a minute) before any lookup; the access log names the entry and the status only.
#
# By default the test starts `node --conditions=@openverify/source apps/flow/server.ts` itself, over
# a synthetic dist/ in a temporary directory, against a local stub of the API's internal route
# (GET /api/v1/internal/embed-policies/:id with the flow-server token), both on loopback ports,
# and stops both at the end. Nothing else is touched.
#
# With FLOW_SERVER_URL=<url> it checks a server that is already running (integration-9a: the
# compose app profile's flow container) instead, without the stub: the hosted and preview entries,
# the malformed and unknown ids, an asset (FLOW_SERVER_ASSET=/assets/<file>, optional) and the
# traversal refusal. FLOW_SERVER_CONSOLE_ORIGIN names the console origin it expects.
#
# Usage: infra/tests/flow-server.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected [$3], got [$2]"; fi; }
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

work=$(mktemp -d "${TMPDIR:-/tmp}/openverify-flow-server-test.XXXXXX")
stub_pid=''
server_pid=''
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  [ -n "$stub_pid" ] && kill "$stub_pid" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT

# header <file> <name>: the value of one response header (case-insensitive), CR stripped.
header() {
  awk -v name="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    { line = $0; sub(/\r$/, "", line); split(line, parts, ": ");
      if (tolower(parts[1]) == name) { sub(/^[^:]*: /, "", line); print line; exit } }' "$1"
}
status_of() { awk 'NR == 1 { print $2 }' "$1"; }
# fetch <path> <name> [curl args...]: headers in $work/<name>.h, body in $work/<name>.b.
fetch() {
  local path=$1 name=$2
  shift 2
  curl -s --path-as-is -o "$work/$name.b" -D "$work/$name.h" "$@" "$base$path"
}
frame_ancestors() {
  header "$1" Content-Security-Policy | tr ';' '\n' | sed -e 's/^ *//' | grep '^frame-ancestors' || true
}

INQUIRY_ID='inq_01M5CJXHG07XPHF3HRM6NREDH7'
UNKNOWN_ID='inq_01M5CK16P0D13FXHZSS4TCFBVH'
HOSTILE_ID='inq_01M5CK16P0D13FXHZSS4TCFBVA'
TOKEN='synthetic-flow-server-token-current-0123456789'
API_ORIGIN='http://127.0.0.1:3000'
CONSOLE_ORIGIN="${FLOW_SERVER_CONSOLE_ORIGIN:-http://localhost:3001}"

free_port() {
  node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}

if [ -n "${FLOW_SERVER_URL:-}" ]; then
  base="${FLOW_SERVER_URL%/}"
  external=true
else
  external=false
  # ------------------------------------------------------------- stub API ----
  stub_port=$(free_port)
  : >"$work/stub.log"
  STUB_PORT=$stub_port STUB_LOG="$work/stub.log" TOKEN=$TOKEN INQUIRY_ID=$INQUIRY_ID HOSTILE_ID=$HOSTILE_ID \
    node -e '
      const http = require("node:http");
      const fs = require("node:fs");
      const answer = (id, ancestors) => JSON.stringify({
        "inquiry-id": id,
        "template-id": "itmpl_01M5CJXHG07XPHF3HRM6NREDH7",
        "environment-id": "env_01M5CJXHG07XPHF3HRM6NREDH7",
        "frame-ancestors": ancestors,
      });
      http.createServer((req, res) => {
        fs.appendFileSync(process.env.STUB_LOG, req.url + "\n");
        if (req.headers.authorization !== "Bearer " + process.env.TOKEN) { res.writeHead(401); res.end(); return; }
        const id = decodeURIComponent(req.url.split("/").pop());
        if (id === process.env.INQUIRY_ID) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(answer(id, ["https://shop.example.com", "http://localhost:5173"]));
        } else if (id === process.env.HOSTILE_ID) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(answer(id, ["https://shop.example.com; script-src *"]));
        } else { res.writeHead(404); res.end("{}"); }
      }).listen(Number(process.env.STUB_PORT), "127.0.0.1");
    ' &
  stub_pid=$!

  # ----------------------------------------------------- synthetic dist/ ----
  mkdir -p "$work/dist/assets"
  printf '<!doctype html><html><head></head><body>hosted</body></html>' >"$work/dist/index.html"
  printf '<!doctype html><html><head></head><body>preview</body></html>' >"$work/dist/preview.html"
  printf 'export {};' >"$work/dist/assets/index-Abc123de.js"
  printf 'outside' >"$work/secret.txt"

  # ---------------------------------------------------------- the server ----
  server_port=$(free_port)
  base="http://127.0.0.1:$server_port"
  (cd "$repo_root/apps/flow" &&
    VITE_OPENVERIFY_API_URL=$API_ORIGIN \
    OPENVERIFY_DASHBOARD_PUBLIC_URL="$CONSOLE_ORIGIN/" \
    OPENVERIFY_FLOW_SERVER_TOKEN=$TOKEN \
    OPENVERIFY_FLOW_SERVER_API_URL="http://127.0.0.1:$stub_port" \
    OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS=1 \
    exec node --conditions=@openverify/source server.ts --port "$server_port" --dist "$work/dist") \
    >"$work/server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 100); do
    curl -s -o /dev/null "$base/" && break
    sleep 0.1
  done
  if curl -s -o /dev/null "$base/"; then ok "the server starts from source"; else
    nok "the server starts from source" "$(tr '\n' ' ' <"$work/server.log")"
    finish
  fi
fi

# ------------------------------------------------------------------ hosted ----
fetch / hosted
check "hosted: 200" "$(status_of "$work/hosted.h")" 200
check "hosted: frame-ancestors 'none'" "$(frame_ancestors "$work/hosted.h")" "frame-ancestors 'none'"
check "hosted: X-Frame-Options DENY" "$(header "$work/hosted.h" X-Frame-Options)" DENY
check "hosted: Permissions-Policy" "$(header "$work/hosted.h" Permissions-Policy)" 'camera=(self), geolocation=(), microphone=()'
check "hosted: Referrer-Policy" "$(header "$work/hosted.h" Referrer-Policy)" no-referrer
check "hosted: nosniff" "$(header "$work/hosted.h" X-Content-Type-Options)" nosniff
check "hosted: no-store" "$(header "$work/hosted.h" Cache-Control)" no-store
if [ "$external" = false ]; then
  expected_policy=$(cd "$repo_root/apps/flow" && node -e "import('./src/security/csp-policy.ts').then((m) => console.log(m.buildContentSecurityPolicy({ apiOrigin: '$API_ORIGIN' })))")
  check "hosted: the flow policy as a header" "$(header "$work/hosted.h" Content-Security-Policy)" "$expected_policy; frame-ancestors 'none'"
fi
fetch /some/route hosted-route
check "hosted: every route is the hosted document" "$(frame_ancestors "$work/hosted-route.h")" "frame-ancestors 'none'"

# ----------------------------------------------------------------- preview ----
fetch /preview preview
check "preview: 200" "$(status_of "$work/preview.h")" 200
check "preview: the preview policy" "$(header "$work/preview.h" Content-Security-Policy)" \
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; frame-ancestors $CONSOLE_ORIGIN; base-uri 'none'; form-action 'none'"
check "preview: Permissions-Policy denies everything" "$(header "$work/preview.h" Permissions-Policy)" 'camera=(), microphone=(), geolocation=()'
check "preview: no X-Frame-Options" "$(header "$work/preview.h" X-Frame-Options)" ''
check "preview: no-store" "$(header "$work/preview.h" Cache-Control)" no-store
if grep -q "<meta name=\"openverify-console-origin\" content=\"$CONSOLE_ORIGIN\">" "$work/preview.b"; then
  ok "preview: the document names the console origin"
else
  nok "preview: the document names the console origin"
fi

# ------------------------------------------------------------------- embed ----
fetch "/embed/inq_short" malformed
check "embed: a malformed id answers 404" "$(status_of "$work/malformed.h")" 404
check "embed: a malformed id is framed by nothing" "$(frame_ancestors "$work/malformed.h")" "frame-ancestors 'none'"
fetch "/embed/$UNKNOWN_ID" unknown
check "embed: an unknown inquiry answers 200" "$(status_of "$work/unknown.h")" 200
check "embed: an unknown inquiry is framed by nothing" "$(frame_ancestors "$work/unknown.h")" "frame-ancestors 'none'"
check "embed: no X-Frame-Options" "$(header "$work/unknown.h" X-Frame-Options)" ''
if [ "$external" = false ]; then
  fetch "/embed/$INQUIRY_ID" known
  check "embed: the inquiry's origins" "$(frame_ancestors "$work/known.h")" 'frame-ancestors https://shop.example.com http://localhost:5173'
  check "embed: no-store" "$(header "$work/known.h" Cache-Control)" no-store
  fetch "/embed/$HOSTILE_ID" hostile
  check "embed: a hostile answer is framed by nothing" "$(frame_ancestors "$work/hostile.h")" "frame-ancestors 'none'"
  if grep -q 'inq_short' "$work/stub.log"; then
    nok "embed: a malformed id makes no lookup"
  else
    ok "embed: a malformed id makes no lookup"
  fi
  check "embed: one lookup per inquiry within a minute" "$(grep -c "$INQUIRY_ID" "$work/stub.log")" 1
  fetch "/embed/$INQUIRY_ID" known-again
  check "embed: the cached answer is used" "$(grep -c "$INQUIRY_ID" "$work/stub.log")" 1

  # Per-client limit: 60 loads at once, then 429 (one curl process, so the burst takes
  # milliseconds and the bucket's one-a-second refill cannot hide the limit); another client
  # keeps its header.
  urls=()
  for _ in $(seq 1 70); do urls+=(-o /dev/null "$base/embed/$UNKNOWN_ID"); done
  codes=$(curl -s -H 'X-Forwarded-For: 203.0.113.66' -w '%{http_code}\n' "${urls[@]}")
  check "embed: one client's first 60 loads answer 200" "$(printf '%s\n' "$codes" | head -60 | grep -c '^200$')" 60
  if printf '%s\n' "$codes" | tail -10 | grep -q '^429$'; then
    ok "embed: past 60 loads at once, one client answers 429"
  else
    nok "embed: past 60 loads at once, one client answers 429" "$(printf '%s' "$codes" | tail -10 | tr '\n' ' ')"
  fi
  fetch "/embed/$INQUIRY_ID" other-client -H 'X-Forwarded-For: 198.51.100.20'
  check "embed: another client's header is unchanged" "$(frame_ancestors "$work/other-client.h")" 'frame-ancestors https://shop.example.com http://localhost:5173'

  # The API gone: a new inquiry fails closed.
  kill "$stub_pid" 2>/dev/null
  wait "$stub_pid" 2>/dev/null
  stub_pid=''
  fetch "/embed/inq_01M5CK16P0D13FXHZSS4TCFBVB" api-down
  check "embed: with the API down, framed by nothing" "$(frame_ancestors "$work/api-down.h")" "frame-ancestors 'none'"
fi

# ----------------------------------------------------------------- dist/ ----
asset="${FLOW_SERVER_ASSET:-}"
if [ "$external" = false ]; then asset=/assets/index-Abc123de.js; fi
if [ -n "$asset" ]; then
  fetch "$asset" asset
  check "dist: a hashed asset answers 200" "$(status_of "$work/asset.h")" 200
  check "dist: a hashed asset is immutable" "$(header "$work/asset.h" Cache-Control)" 'public, max-age=31536000, immutable'
  check "dist: nosniff on files" "$(header "$work/asset.h" X-Content-Type-Options)" nosniff
fi
fetch '/../secret.txt' traversal
check "dist: path traversal is refused" "$(status_of "$work/traversal.h")" 400
fetch '/%2e%2e/secret.txt' traversal-encoded
check "dist: encoded traversal is refused" "$(status_of "$work/traversal-encoded.h")" 400
fetch '/assets/unknown.exe' unknown-extension
check "dist: an unknown extension answers 404" "$(status_of "$work/unknown-extension.h")" 404

# ------------------------------------------------------------- access log ----
if [ "$external" = false ]; then
  if grep -q '"entry":"embed","status":200' "$work/server.log" &&
    ! grep -E -q 'inq_|203\.0\.113|/assets|secret' "$work/server.log"; then
    ok "the access log names the entry and the status, never the path, id or address"
  else
    nok "the access log names the entry and the status, never the path, id or address"
  fi
fi

finish
