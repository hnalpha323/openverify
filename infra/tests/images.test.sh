#!/usr/bin/env bash
# Contract test for the five production images (Phase 11, Workflow 11C, images-11c; C257, C258.1,
# C263.6, C289; review F27, P18): openverify/api, openverify/dashboard, openverify/flow (and its
# no-guidance build), openverify/vision and openverify/code-runner.
#
# static (no Docker): each Dockerfile is multi-stage, takes its bases by digest through NODE_IMAGE,
#   PYTHON_IMAGE and UV_IMAGE, ends as uid 10001:10001, has no HEALTHCHECK (the chart's probes
#   decide), carries the OCI labels and dev.openverify.licence-status, bakes no VITE_OPENVERIFY_API_URL
#   and no secret, and keeps what C257.1 and Workflows 7A to 11B ask of it (the data pins re-checked
#   with sha256sum -c, the compiled commands, Eigen's source location beside the vision wheel's
#   notices, the flow's face-guidance switch).
# api | dashboard | flow | flow-noguidance | vision | code-runner (Docker): one prebuilt image by its
#   tag (openverify/<name>:${IMAGE_TAG:-11c-local}; builds are separate calls, rule 8): its uid,
#   labels and missing health check in `docker image inspect`; no secret in `docker history` or in
#   its environment; runs with --read-only --tmpfs /tmp and nothing else writable; no tsx, vitest,
#   typescript, @playwright/*, eslint or vite in any node_modules; no .env, .env.e2e, stack.json or
#   *.mmdb anywhere; its secret read from a file mounted at mode 0440 under a matching group (P18);
#   and its own smoke (/health and /ready for the API with Postgres and Valkey of its own, /login for
#   the console, the index and its CSP header for the flow, /health with the models mounted for
#   vision, the socket's handshake for the runner). Every container, volume and network this test
#   starts is its own (named openverify-images-test-*), removed at the end.
#
# pins (no Docker; C258.1, checkpoint pins): every FROM of every Dockerfile, every image: of the
#   compose files, the Testcontainers and benchmark image constants and the WebKit browser server's
#   documented image carry tag@sha256 with the pins of the plan's Workflow 11C Stage 1a amendment 6
#   (re-read on the adopting day by infra/scripts/refresh-digests.sh); no quoted Postgres, Valkey or
#   RustFS image literal outside those constants; the DAST scanner's image (security/zap/run.sh's
#   ZAP_IMAGE, Workflow 11F) is ZAP 2.17.0 by digest, and no ZAP image is named anywhere without it.
#
# override (no image needed; docker compose config): e2e/setup/docker-compose.images.yml over the app
#   profile with an env file as the e2e driver writes it: every app service on the host's network,
#   the 11c-local images never pulled, the e2e env's loopback addresses and ports, the receiver's
#   certificate and the sandbox chip's faces mounted read-only, and a missing driver port refused.
#
# Usage: infra/tests/images.test.sh static|pins|override|api|dashboard|flow|flow-noguidance|vision|code-runner
# Env:   IMAGE_TAG  the local tag to take (default 11c-local)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tag=${IMAGE_TAG:-11c-local}
mode=${1:-}
case "$mode" in
  static | pins | override | api | dashboard | flow | flow-noguidance | vision | code-runner) ;;
  *)
    echo "usage: $0 static|pins|override|api|dashboard|flow|flow-noguidance|vision|code-runner" >&2
    exit 2
    ;;
esac

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
expect() { # expect <description> <command...>: passes when the command exits 0
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else nok "$desc"; fi
}
expect_eq() { # expect_eq <description> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected '$2', got '$3'"; fi
}
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  [ "$failed" -eq 0 ]
  exit $?
}

# The bases (C258.1; plan, Workflow 11C Stage 1a amendment 6), each tag@sha256 read 2026-11-14.
# Workflow 11G (contracts-11g, KP11-42; Q5's 14-day rule covers base images): Node 22.23.4 (2026-10-20,
# the newest Node 22 at least 14 days old on 2026-11-21) on the bookworm-slim build of 2026-11-05, and
# python:3.12-slim's build of 2026-11-05 (Python 3.12.16), each index digest read 2026-11-21.
NODE_PIN='node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d'
PYTHON_PIN='python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b'
# Workflow 11G (records-11g, Q5 granted 2026-11-21): uv 0.13.7 (2026-11-03), the newest uv at least 14
# days old, its image index digest as THIRD_PARTY_LICENSES.md's uv row records it.
UV_PIN='ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490'
# The test's own Postgres and Valkey for the API's smoke: the Testcontainers pins.
POSTGRES_PIN='pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f'
VALKEY_PIN='valkey/valkey:9.1@sha256:3add1a336a920ea54770a001ab6feb3da5fceea96a40373a3a2cd469b815f0b7'

RUSTFS_PIN='rustfs/rustfs:1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b'
AWS_CLI_PIN='amazon/aws-cli:2.38.2@sha256:5d39fd52f236ed01c5c25fba66c9aebcfc6cbb88e7bb1b727c5fe1f150540597'
MAILPIT_PIN='axllent/mailpit:v1.31@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387'
PLAYWRIGHT_PIN='mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f'
# ZAP 2.17.0 (C258.3, C283; Workflow 11F, dast-11f): the project's own image at its version tag, by
# the index digest refresh-digests.sh read on 2026-11-21 (the tag's build of 2026-11-03).
ZAP_PIN='ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af'

api_df="$repo_root/infra/docker/api.Dockerfile"
dashboard_df="$repo_root/infra/docker/dashboard.Dockerfile"
flow_df="$repo_root/infra/docker/flow.Dockerfile"
runner_df="$repo_root/infra/docker/code-runner.Dockerfile"
vision_df="$repo_root/services/vision/Dockerfile"

# The instructions of a Dockerfile, comments and blank lines removed, continuations joined.
instructions() {
  python3 -I - "$1" <<'PY'
import sys

lines, current = [], ""
with open(sys.argv[1], encoding="utf-8") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        if not current and (line.strip() == "" or line.lstrip().startswith("#")):
            continue
        if line.lstrip().startswith("#"):
            continue
        if line.endswith("\\"):
            current += line[:-1] + " "
            continue
        lines.append(" ".join((current + line).split()))
        current = ""
for line in lines:
    print(line)
PY
}

# The instructions of the final stage (from its last FROM).
final_stage() { instructions "$1" | awk '/^FROM /{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}'; }

# --- static -------------------------------------------------------------------------------------

static_dockerfile() { # static_dockerfile <name> <path> <licence status> <base ARG names...>
  local name=$1 path=$2 status=$3
  shift 3
  local rel=${path#"$repo_root"/}
  if [ ! -f "$path" ]; then
    nok "$name: $rel exists"
    return
  fi
  ok "$name: $rel exists"
  local text final
  text=$(instructions "$path")
  final=$(final_stage "$path")
  local froms
  froms=$(grep -c '^FROM ' <<<"$text")
  if [ "$froms" -ge 2 ]; then ok "$name: multi-stage ($froms stages)"; else nok "$name: multi-stage" "$froms FROM"; fi
  local arg pin value
  for arg in "$@"; do
    case "$arg" in
      NODE_IMAGE) pin=$NODE_PIN ;;
      PYTHON_IMAGE) pin=$PYTHON_PIN ;;
      UV_IMAGE) pin=$UV_PIN ;;
    esac
    value=$(sed -n "s/^ARG $arg=//p" <<<"$text" | head -n 1)
    expect_eq "$name: ARG $arg defaults to the pinned digest" "$pin" "$value"
  done
  local unpinned
  unpinned=$(grep '^FROM ' <<<"$text" | awk '{print $2}' |
    grep -Ev '^\$\{(NODE_IMAGE|PYTHON_IMAGE|UV_IMAGE)\}$' |
    grep -Ev "^($(grep '^FROM .* AS ' <<<"$text" | awk '{print $4}' | paste -sd'|' -))$" || true)
  if [ -z "$unpinned" ]; then ok "$name: every FROM is a pinned base or an earlier stage"; else nok "$name: every FROM is a pinned base or an earlier stage" "$unpinned"; fi
  expect_eq "$name: the final stage runs as 10001:10001" "USER 10001:10001" "$(grep '^USER ' <<<"$final" | tail -n 1)"
  if grep -q '^HEALTHCHECK' <<<"$text"; then nok "$name: no HEALTHCHECK (the chart's probes decide)"; else ok "$name: no HEALTHCHECK (the chart's probes decide)"; fi
  local label
  for label in org.opencontainers.image.source org.opencontainers.image.revision \
    org.opencontainers.image.version org.opencontainers.image.licenses org.opencontainers.image.title \
    dev.openverify.licence-status; do
    if grep -Eq "^LABEL .*${label//./\\.}=" <<<"$final"; then ok "$name: labels $label"; else nok "$name: labels $label"; fi
  done
  if grep -Eq '^LABEL .*org\.opencontainers\.image\.licenses="Apache-2\.0"' <<<"$final"; then ok "$name: licenses is Apache-2.0"; else nok "$name: licenses is Apache-2.0"; fi
  if grep -Eq "^LABEL .*org\\.opencontainers\\.image\\.title=\"openverify/$name\"" <<<"$final"; then ok "$name: title is openverify/$name"; else nok "$name: title is openverify/$name"; fi
  if grep -Eq "^LABEL .*dev\\.openverify\\.licence-status=\"$status\"" <<<"$final"; then ok "$name: licence-status is $status"; else nok "$name: licence-status is $status"; fi
  for arg in VERSION REVISION SOURCE_URL; do
    if grep -Eq "^ARG $arg(=|$)" <<<"$final"; then ok "$name: takes the build argument $arg"; else nok "$name: takes the build argument $arg"; fi
  done
  if grep -q 'VITE_OPENVERIFY_API_URL' <<<"$text"; then nok "$name: bakes no VITE_OPENVERIFY_API_URL (C257.1)"; else ok "$name: bakes no VITE_OPENVERIFY_API_URL (C257.1)"; fi
  local secret
  secret=$(grep -E '^(ARG|ENV) ' <<<"$text" | grep -Ei '(TOKEN|PASSWORD|SECRET|PEPPER|KEK|PRIVATE|CREDENTIAL|_KEY)[A-Z_]*=' || true)
  if [ -z "$secret" ]; then ok "$name: no build argument or environment default names a secret"; else nok "$name: no build argument or environment default names a secret" "$secret"; fi
  if grep -Eq ':latest\b' <<<"$text"; then nok "$name: never latest"; else ok "$name: never latest"; fi
  if grep -Eq 'curl[^|]*\|[[:space:]]*(ba)?sh' <<<"$text"; then nok "$name: no curl | sh"; else ok "$name: no curl | sh"; fi
}

if [ "$mode" = static ]; then
  # Q11 granted (2026-11-21; Workflow 11G records-11g): nodemailer's MIT-0 is accepted, so the API
  # image's licence status is decided.
  static_dockerfile api "$api_df" decided NODE_IMAGE
  static_dockerfile dashboard "$dashboard_df" decided NODE_IMAGE
  static_dockerfile flow "$flow_df" decided NODE_IMAGE
  # F004 (Workflow 11F review): vision is pending-owner while KP11-39 (FFmpeg, libquadmath and
  # libgfortran inside opencv-python-headless) waits on the owner, as the API is while Q11 does.
  static_dockerfile vision "$vision_df" pending-owner PYTHON_IMAGE UV_IMAGE
  static_dockerfile code-runner "$runner_df" decided NODE_IMAGE
  # Production dependencies only: the API and the runner by pnpm deploy --prod, the console by
  # Next.js's standalone output (the production files it traced), the flow by no node_modules at all
  # beyond the one workspace link its server imports.
  for df in "$api_df" "$runner_df"; do
    [ -f "$df" ] || continue
    rel=${df#"$repo_root"/}
    if instructions "$df" | grep -q 'deploy --prod'; then ok "$rel: production dependencies only (pnpm deploy --prod)"; else nok "$rel: production dependencies only (pnpm deploy --prod)"; fi
  done
  if [ -f "$flow_df" ]; then
    if instructions "$flow_df" | grep -E 'cp .*node_modules' | grep -qv 'node_modules/@openverify'; then nok "infra/docker/flow.Dockerfile: copies no node_modules (production dependencies only)"; else ok "infra/docker/flow.Dockerfile: copies no node_modules (production dependencies only)"; fi
  fi
  for df in "$api_df" "$dashboard_df" "$flow_df" "$runner_df"; do
    [ -f "$df" ] || continue
    rel=${df#"$repo_root"/}
    if final_stage "$df" | grep -q 'NODE_ENV=production'; then ok "$rel: NODE_ENV=production"; else nok "$rel: NODE_ENV=production"; fi
  done

  # The API (C257.1; Workflow 7A (a), 7B (f), 10C, 11B (i); amendments 14, 16, 17).
  if [ -f "$api_df" ]; then
    api_text=$(instructions "$api_df")
    pin_of() {
      python3 -I - "$repo_root/data/manifest.json" "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    entries = json.load(fh)["data"]
print(next(e["sha256"] for e in entries if e["filename"] == sys.argv[2]))
PY
    }
    for file in disposable_email_blocklist.conf x4bnet-datacenter-ASN.txt x4bnet-vpn-ASN.txt bad-asn-list.csv; do
      if grep -Fq "$(pin_of "$file")  data/$file" "$api_df"; then ok "api: re-checks data/$file against data/manifest.json"; else nok "api: re-checks data/$file against data/manifest.json"; fi
    done
    groups_pin=$(sed -n "s/^  '\([0-9a-f]\{64\}\)';$/\1/p" "$repo_root/packages/watchlist/src/keys/variant-groups.ts" | head -n 1)
    if [ -n "$groups_pin" ] && grep -Fq "$groups_pin  data/variant-groups.json" "$api_df"; then ok "api: re-checks the variant groups against SHIPPED_VARIANT_GROUPS_SHA256"; else nok "api: re-checks the variant groups against SHIPPED_VARIANT_GROUPS_SHA256"; fi
    if grep -q 'sha256sum -c' <<<"$api_text"; then ok "api: the checks run sha256sum -c"; else nok "api: the checks run sha256sum -c"; fi
    if grep -q 'tsconfig.commands.json\|turbo run build --filter=@openverify/api' <<<"$api_text"; then ok "api: builds the server and the compiled commands"; else nok "api: builds the server and the compiled commands"; fi
    if grep -q 'dist/test-support' <<<"$api_text"; then ok "api: leaves dist/test-support/ out (decision 24)"; else nok "api: leaves dist/test-support/ out (decision 24)"; fi
    expect_eq "api: the default command is the server" 'CMD ["node", "dist/server.js"]' "$(grep '^CMD ' <<<"$api_text" | tail -n 1)"
    if grep -Eq 'mmdb|ip-reputation|torproject|ip-ranges' <<<"$api_text"; then nok "api: bakes in or fetches no network data (ADR 0006)"; else ok "api: bakes in or fetches no network data (ADR 0006)"; fi
    for path in network/sources.json network/asn-overrides.json watchlists/sources.json trust-anchors/manifest.json contracts/fixtures/i18n contracts/fixtures/flows contracts/fixtures/api; do
      if grep -Fq "$path" <<<"$api_text"; then ok "api: carries $path at the image root"; else nok "api: carries $path at the image root"; fi
    done
    if grep -q 'OPENVERIFY_CONNECT_ENABLED=true\|OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED=true\|OPENVERIFY_SANDBOX_CHIP_FACES' <<<"$api_text"; then nok "api: sets no install switch and no face directory (rule 21)"; else ok "api: sets no install switch and no face directory (rule 21)"; fi
  fi

  # The flow (C257.1, C289): the face-guidance switch, YuNet re-checked, the server over the bundle.
  if [ -f "$flow_df" ]; then
    flow_text=$(instructions "$flow_df")
    if grep -Eq '^ARG OPENVERIFY_FLOW_FACE_GUIDANCE=on$' <<<"$flow_text"; then ok "flow: ARG OPENVERIFY_FLOW_FACE_GUIDANCE defaults to on"; else nok "flow: ARG OPENVERIFY_FLOW_FACE_GUIDANCE defaults to on"; fi
    if grep -Fq "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0  models/face_detection_yunet_2026may.onnx" "$flow_df"; then ok "flow: re-checks YuNet against models/manifest.json"; else nok "flow: re-checks YuNet against models/manifest.json"; fi
    expect_eq "flow: runs the flow server over the built bundle" \
      'CMD ["node", "server.ts", "--hostname", "0.0.0.0", "--port", "4173", "--dist", "dist"]' \
      "$(grep '^CMD ' <<<"$flow_text" | tail -n 1)"
  fi

  # The console (C257.1, amendment 12, orchestrator decision 22).
  if [ -f "$dashboard_df" ]; then
    dash_text=$(instructions "$dashboard_df")
    if grep -q 'NEXT_TELEMETRY_DISABLED=1' <<<"$dash_text"; then ok "dashboard: NEXT_TELEMETRY_DISABLED=1"; else nok "dashboard: NEXT_TELEMETRY_DISABLED=1"; fi
    if grep -Eq 'OPENVERIFY_HSTS_MAX_AGE=[1-9]' <<<"$dash_text"; then nok "dashboard: built with OPENVERIFY_HSTS_MAX_AGE unset (HSTS from the ingress)"; else ok "dashboard: built with OPENVERIFY_HSTS_MAX_AGE unset (HSTS from the ingress)"; fi
    if grep -q '\.next/standalone' <<<"$dash_text"; then ok "dashboard: runs over the standalone output"; else nok "dashboard: runs over the standalone output"; fi
    expect_eq "dashboard: runs the custom server (C21), never Next's generated one" \
      'CMD ["node", "server.ts", "--hostname", "0.0.0.0", "--port", "3001"]' \
      "$(grep '^CMD ' <<<"$dash_text" | tail -n 1)"
  fi

  # Vision (C257.1, amendment 15; orchestrator decision 8: Eigen's source location, P2).
  if [ -f "$vision_df" ]; then
    vision_text=$(instructions "$vision_df")
    eigen="$repo_root/services/vision/licenses/onnxruntime/EIGEN-SOURCE.txt"
    if [ -f "$eigen" ] && grep -q '1d8b82b0740839c0de7f1242a3585e3390ff5f33' "$eigen" &&
      grep -q 'https://github.com/eigen-mirror/eigen' "$eigen" && grep -q 'https://gitlab.com/libeigen/eigen' "$eigen" &&
      grep -q 'v1.31.0' "$eigen"; then
      ok "vision: EIGEN-SOURCE.txt names the revision and URLs of THIRD_PARTY_LICENSES.md's wheel row"
    else
      nok "vision: EIGEN-SOURCE.txt names the revision and URLs of THIRD_PARTY_LICENSES.md's wheel row"
    fi
    if grep -q '1d8b82b0740839c0de7f1242a3585e3390ff5f33' <(grep 'onnxruntime. wheel 1.31.0' "$repo_root/THIRD_PARTY_LICENSES.md"); then ok "vision: THIRD_PARTY_LICENSES.md's wheel row names the same revision"; else nok "vision: THIRD_PARTY_LICENSES.md's wheel row names the same revision"; fi
    if grep -q 'licenses/onnxruntime' <<<"$vision_text" && grep -q 'ThirdPartyNotices.txt' <<<"$vision_text"; then ok "vision: copies EIGEN-SOURCE.txt beside the wheel's ThirdPartyNotices.txt under licenses/"; else nok "vision: copies EIGEN-SOURCE.txt beside the wheel's ThirdPartyNotices.txt under licenses/"; fi
    if grep -q 'OPENVERIFY_VISION_MODELS_MANIFEST=' <<<"$vision_text" && grep -q 'models/manifest.json' <<<"$vision_text"; then ok "vision: carries models/manifest.json for the start-up digest check"; else nok "vision: carries models/manifest.json for the start-up digest check"; fi
    if grep -q 'fetch_models.py' <<<"$vision_text"; then ok "vision: carries scripts/fetch_models.py for the models-fetch Job"; else nok "vision: carries scripts/fetch_models.py for the models-fetch Job"; fi
    if grep -Eq '\.onnx|fetch_models.py ' <<<"$(grep '^RUN ' <<<"$vision_text")"; then nok "vision: never bakes a model (Q6, decision 5)"; else ok "vision: never bakes a model (Q6, decision 5)"; fi
  fi
  finish
fi

# --- pins (C258.1) ---------------------------------------------------------------------------------

if [ "$mode" = pins ]; then
  digest_ref='^[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$'
  # Every Dockerfile in git: each FROM a stage or ${ARG} whose default is tag@sha256.
  while IFS= read -r df; do
    text=$(instructions "$repo_root/$df")
    stages=$(grep -E '^FROM .* AS ' <<<"$text" | awk '{print $4}')
    bad=""
    while read -r ref; do
      [ -n "$ref" ] || continue
      if grep -qxF "$ref" <<<"$stages"; then continue; fi
      arg=$(sed -n 's/^\${\([A-Z_]*\)}$/\1/p' <<<"$ref")
      value=$ref
      [ -n "$arg" ] && value=$(sed -n "s/^ARG $arg=//p" <<<"$text" | head -n 1)
      grep -Eq "$digest_ref" <<<"$value" || bad="$bad $ref"
    done < <(grep '^FROM ' <<<"$text" | awk '{print $2}')
    if [ -z "$bad" ]; then ok "pins: $df: every FROM is a stage or tag@sha256"; else nok "pins: $df: every FROM is a stage or tag@sha256" "${bad# }"; fi
  done < <(git -C "$repo_root" ls-files | grep -E '(^|/)([A-Za-z0-9.-]*\.)?Dockerfile$')
  # The bases themselves are the amendment's.
  for df in "$api_df" "$dashboard_df" "$flow_df" "$runner_df"; do
    expect_eq "pins: ${df#"$repo_root"/}: NODE_IMAGE is the pinned node base" "$NODE_PIN" "$(instructions "$df" | sed -n 's/^ARG NODE_IMAGE=//p' | head -n 1)"
  done
  # Q5 (Workflow 11G, records-11g): the vision build's uv is the pinned one, which is the image the
  # ledger's uv row records.
  expect_eq "pins: services/vision/Dockerfile: UV_IMAGE is the pinned uv" "$UV_PIN" "$(instructions "$vision_df" | sed -n 's/^ARG UV_IMAGE=//p' | head -n 1)"
  if grep -qF "\`$UV_PIN\`" "$repo_root/THIRD_PARTY_LICENSES.md"; then ok "pins: THIRD_PARTY_LICENSES.md's uv row records $UV_PIN"; else nok "pins: THIRD_PARTY_LICENSES.md's uv row records $UV_PIN"; fi
  # Every image: of the compose files (the locally built openverify/* images have no digest).
  for compose in infra/docker-compose.yml e2e/setup/docker-compose.images.yml; do
    [ -f "$repo_root/$compose" ] || continue
    unpinned=$(sed -n 's/^ *image: *//p' "$repo_root/$compose" | tr -d "'\"" | grep -v '^openverify/' | grep -Ev "$digest_ref" || true)
    if [ -z "$unpinned" ]; then ok "pins: $compose: every image: is tag@sha256"; else nok "pins: $compose: every image: is tag@sha256" "$(paste -sd' ' <<<"$unpinned")"; fi
  done
  for pin in "$POSTGRES_PIN" "$VALKEY_PIN" "$RUSTFS_PIN" "$AWS_CLI_PIN" "$MAILPIT_PIN"; do
    if sed -n 's/^ *image: *//p' "$repo_root/infra/docker-compose.yml" | tr -d "'\"" | grep -qxF "$pin"; then ok "pins: compose names $pin"; else nok "pins: compose names $pin"; fi
  done
  # The Testcontainers and benchmark constants, each written once.
  const_is() { # const_is <file> <name> <pin>
    local value
    # One statement, which Prettier may wrap after the `=`.
    value=$(python3 -I -c 'import re, sys
try:
    text = open(sys.argv[1], encoding="utf-8").read()
except OSError:
    text = ""
m = re.search(r"^(?:export )?const " + sys.argv[2] + r" =\s*\x27([^\x27]*)\x27;", text, re.M)
print(m.group(1) if m else "")' "$repo_root/$1" "$2")
    expect_eq "pins: $1: $2" "$3" "$value"
  }
  const_is packages/db/src/integration-postgres.ts POSTGRES_TEST_IMAGE "$POSTGRES_PIN"
  const_is apps/api/src/test-support/integration-rustfs.ts RUSTFS_TEST_IMAGE "$RUSTFS_PIN"
  const_is apps/api/src/test-support/integration-valkey.ts VALKEY_TEST_IMAGE "$VALKEY_PIN"
  const_is packages/watchlist/scripts/benchmark-postgres.mjs POSTGRES_IMAGE "$POSTGRES_PIN"
  const_is apps/api/scripts/analytics-benchmark.ts IMAGE "$POSTGRES_PIN"
  # Quoted string literals only (comments name the images in backticks); the constants' own files, the constant's
  # test and the benchmark report's fixture data are where a literal belongs.
  literals=$(cd "$repo_root" && git ls-files 'apps/*.ts' 'apps/*.mjs' 'packages/*.ts' 'packages/*.mjs' |
    xargs grep -nE "['\"](pgvector/pgvector|valkey/valkey|rustfs/rustfs):" 2>/dev/null |
    grep -Ev '^(packages/db/src/integration-postgres(\.test)?\.ts|apps/api/src/test-support/integration-(rustfs|valkey)\.ts|packages/watchlist/scripts/benchmark-(postgres|report\.test)\.mjs|apps/api/scripts/analytics-benchmark\.ts):' |
    head -n 5)
  expect_eq "pins: no Postgres, Valkey or RustFS image literal outside the constants (each digest written once)" "" "$literals"
  # The WebKit browser server of the flow's theme-csp run (a local run, documented).
  for doc in apps/flow/e2e/README.md apps/flow/e2e/theme-csp.spec.ts; do
    if grep -qF "$PLAYWRIGHT_PIN" "$repo_root/$doc"; then ok "pins: $doc names the browser server by digest"; else nok "pins: $doc names the browser server by digest"; fi
  done
  # The DAST scanner (C283.1; Workflow 11F): security/zap/run.sh holds the one reference, by digest,
  # and nothing in git names a ZAP image by a tag without one (a tag such as stable or weekly moves;
  # the repository's bare name, as the licence row gives it, is not a reference).
  zap_ref=$(sed -n "s/^readonly ZAP_IMAGE='\(.*\)'.*$/\1/p" "$repo_root/security/zap/run.sh" 2>/dev/null | head -n 1)
  expect_eq "pins: security/zap/run.sh: ZAP_IMAGE is the pinned ZAP 2.17.0 image" "$ZAP_PIN" "$zap_ref"
  zap_unpinned=$(cd "$repo_root" && git ls-files -- ':!docs/research/' ':!docs/plans/' ':!docs/tdd/' |
    xargs grep -hoE '(ghcr\.io/zaproxy/zaproxy|zaproxy/zap-[a-z]+|owasp/zap2docker-[a-z]+|softwaresecurityproject/zap-[a-z]+):[A-Za-z0-9._-]+(@sha256:[0-9a-f]{64})?' 2>/dev/null |
    grep -vxF "$ZAP_PIN" | sort -u | paste -sd' ' -)
  expect_eq "pins: no ZAP image is named without the pinned digest" "" "$zap_unpinned"
  finish
fi

# --- override (C257.3: the e2e images mode) ----------------------------------------------------------

if [ "$mode" = override ]; then
  override="$repo_root/e2e/setup/docker-compose.images.yml"
  if [ ! -f "$override" ]; then
    nok "e2e/setup/docker-compose.images.yml exists"
    finish
  fi
  ok "e2e/setup/docker-compose.images.yml exists"
  # An env file as the e2e driver writes it (synthetic; loopback addresses and free ports).
  envdir=$(mktemp -d)
  trap 'find "$envdir" -mindepth 1 -delete; rmdir "$envdir"' EXIT
  touch "$envdir/receiver.pem"
  mkdir "$envdir/faces"
  {
    grep -v '^#' "$repo_root/.env.example" | grep '='
    printf '%s\n' \
      'DATABASE_URL=postgres://openverify:synthetic-e2e@127.0.0.1:25432/openverify' \
      'REDIS_URL=redis://:synthetic-e2e@127.0.0.1:26379' \
      'S3_ENDPOINT=http://127.0.0.1:29000' \
      'OPENVERIFY_VISION_URL=http://127.0.0.1:28000' \
      'OPENVERIFY_SMTP_URL=smtp://127.0.0.1:21025' \
      'OPENVERIFY_API_HOST=127.0.0.1' \
      'OPENVERIFY_API_PORT=23000' \
      'VITE_OPENVERIFY_API_URL=http://127.0.0.1:23000' \
      'OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true' \
      "NODE_EXTRA_CA_CERTS=$envdir/receiver.pem" \
      "OPENVERIFY_SANDBOX_CHIP_FACES=$envdir/faces" \
      'OPENVERIFY_E2E_FLOW_PORT=24173' \
      'OPENVERIFY_E2E_DASHBOARD_PORT=23001' \
      'OPENVERIFY_E2E_VISION_PORT=28000'
  } >"$envdir/env"
  compose_images() { docker compose --project-name openverify-images-test -f "$repo_root/infra/docker-compose.yml" -f "$override" --env-file "$envdir/env" --profile app "$@"; }
  if rendered=$(compose_images config --format json 2>&1); then ok "the images mode renders over the app profile"; else nok "the images mode renders over the app profile" "$(tail -n 3 <<<"$rendered")"; finish; fi
  q() { jq -r "$1" <<<"$rendered"; }
  for s in api worker migrate flow dashboard; do
    expect_eq "images mode: $s joins the host's network (the e2e env's loopback addresses)" "host" "$(q ".services[\"$s\"].network_mode")"
  done
  expect_eq "images mode: vision joins the host's network too (a test stack; C60.2 stays the app profile's)" "host" "$(q '.services.vision.network_mode')"
  for spec in "migrate openverify/api:11c-local" "api openverify/api:11c-local" "worker openverify/api:11c-local" \
    "flow openverify/flow:11c-local" "dashboard openverify/dashboard:11c-local" "vision openverify/vision:11c-local" \
    "code-runner openverify/code-runner:11c-local"; do
    read -r s image <<<"$spec"
    expect_eq "images mode: $s runs $image, never pulled" "$image|never" "$(q ".services[\"$s\"] | \"\(.image)|\(.pull_policy)\"")"
  done
  expect_eq "images mode: no app service publishes a port (each listens on the host's loopback)" "0" \
    "$(q '[.services | to_entries[] | select(.key | IN("migrate", "api", "worker", "vision", "flow", "dashboard", "code-runner")) | .value.ports // [] | length] | add')"
  expect_eq "images mode: the API reads the e2e env's database, not the compose service name" \
    "postgres://openverify:synthetic-e2e@127.0.0.1:25432/openverify" "$(q '.services.api.environment.DATABASE_URL')"
  for s in migrate api worker; do
    expect_eq "images mode: $s reaches Valkey, RustFS, vision and Mailpit on loopback" \
      "redis://:synthetic-e2e@127.0.0.1:26379|http://127.0.0.1:29000|http://127.0.0.1:28000|smtp://127.0.0.1:21025" \
      "$(q ".services[\"$s\"].environment | \"\(.REDIS_URL)|\(.S3_ENDPOINT)|\(.OPENVERIFY_VISION_URL)|\(.OPENVERIFY_SMTP_URL)\"")"
  done
  expect_eq "images mode: the API listens on the e2e API port" "127.0.0.1|23000" "$(q '.services.api.environment | "\(.OPENVERIFY_API_HOST)|\(.OPENVERIFY_API_PORT)"')"
  expect "images mode: the flow server listens on the e2e flow port and serves the e2e API's URL" \
    jq -e '.services.flow | (.command | join(" ") | test("--port 24173 --dist dist$")) and .environment.OPENVERIFY_FLOW_API_URL == "http://127.0.0.1:23000"' <<<"$rendered"
  expect "images mode: the console listens on the e2e console port and calls the e2e API" \
    jq -e '.services.dashboard | (.command | join(" ") | test("--port 23001$")) and .environment.OPENVERIFY_API_URL == "http://127.0.0.1:23000"' <<<"$rendered"
  expect "images mode: vision listens on the e2e vision port with the models mounted read-only" \
    jq -e '.services.vision | (.command | join(" ") | test("--port 28000")) and ([.volumes[] | select(.target == "/models" and .read_only == true)] | length == 1)' <<<"$rendered"
  for s in api worker; do
    expect "images mode: $s mounts the receiver's certificate and the sandbox chip's faces read-only" \
      jq -e --arg s "$s" '.services[$s] | ([.volumes[] | select((.target == "/run/openverify-e2e/receiver.pem" or .target == "/run/openverify-e2e/sandbox-chip-faces") and .read_only == true)] | length == 2)
        and .environment.NODE_EXTRA_CA_CERTS == "/run/openverify-e2e/receiver.pem"' <<<"$rendered"
  done
  expect "images mode: the worker keeps the code runner's socket volume" \
    jq -e '[.services.worker.volumes[] | select(.target == "/run/code-runner")] | length == 1' <<<"$rendered"
  for s in api worker migrate flow dashboard; do
    expect "images mode: $s stays read-only with a tmpfs /tmp" \
      jq -e --arg s "$s" '.services[$s] | .read_only == true and ((.tmpfs // []) | map(split(":")[0]) | index("/tmp") != null)' <<<"$rendered"
  done
  missing_port=$(grep -v '^OPENVERIFY_E2E_VISION_PORT=' "$envdir/env" >"$envdir/env-short"; docker compose -f "$repo_root/infra/docker-compose.yml" -f "$override" --env-file "$envdir/env-short" --profile app config -q 2>&1)
  if grep -q 'OPENVERIFY_E2E_VISION_PORT is required' <<<"$missing_port"; then ok "images mode: refuses to render without a port the driver must add"; else nok "images mode: refuses to render without a port the driver must add" "$missing_port"; fi
  finish
fi

# --- live: one prebuilt image --------------------------------------------------------------------

case "$mode" in
  flow-noguidance) name=flow image="openverify/flow:${tag}-noguidance" ;;
  *) name=$mode image="openverify/$mode:$tag" ;;
esac
if ! docker image inspect "$image" >/dev/null 2>&1; then
  nok "$image is built" "build it first, one call per image (rule 8): see the Dockerfile's header"
  finish
fi
ok "$image is built"

run_id="openverify-images-test-$$"
secrets_dir=$(mktemp -d)
cleanup() {
  local ids
  ids=$(docker ps -aq --filter "name=^${run_id}")
  [ -z "$ids" ] || docker rm -f $ids >/dev/null 2>&1
  docker network rm "$run_id" >/dev/null 2>&1 || true
  find "$secrets_dir" -type f -exec chmod u+w {} + 2>/dev/null
  find "$secrets_dir" -mindepth 1 -delete 2>/dev/null
  rmdir "$secrets_dir" 2>/dev/null
}
trap cleanup EXIT

inspect() { docker image inspect -f "$1" "$image"; }
expect_eq "$name: runs as 10001:10001" "10001:10001" "$(inspect '{{.Config.User}}')"
expect_eq "$name: linux/amd64" "linux/amd64" "$(inspect '{{.Os}}/{{.Architecture}}')"
expect_eq "$name: no health check (the chart's probes decide)" "<nil>" "$(inspect '{{.Config.Healthcheck}}')"
label() { inspect "{{index .Config.Labels \"$1\"}}"; }
for key in org.opencontainers.image.source org.opencontainers.image.revision org.opencontainers.image.version; do
  value=$(label "$key")
  if [ -n "$value" ] && [ "$value" != "<no value>" ]; then ok "$name: label $key ($value)"; else nok "$name: label $key"; fi
done
expect_eq "$name: label org.opencontainers.image.licenses" "Apache-2.0" "$(label org.opencontainers.image.licenses)"
expect_eq "$name: label org.opencontainers.image.title" "openverify/$name" "$(label org.opencontainers.image.title)"
expected_status=decided
# Q11 granted (2026-11-21): the API image is decided; vision alone stays pending-owner (F004).
[ "$name" = vision ] && expected_status=pending-owner # F004, while KP11-39 is open
expect_eq "$name: label dev.openverify.licence-status" "$expected_status" "$(label dev.openverify.licence-status)"

secret_pattern='(TOKEN|PASSWORD|SECRET|PEPPER|KEK|PRIVATE_KEY|CREDENTIAL|BLIND_INDEX_KEY|SERVICE_ACCOUNT_JSON)[A-Z_]*=[^ "$]|change-me|VITE_OPENVERIFY_API_URL'
history=$(docker history --no-trunc --format '{{.CreatedBy}}' "$image")
leak=$(grep -Eo "$secret_pattern" <<<"$history" | head -n 3)
if [ -z "$leak" ]; then ok "$name: docker history shows no secret"; else nok "$name: docker history shows no secret" "$leak"; fi
leak=$(inspect '{{range .Config.Env}}{{println .}}{{end}}' | grep -Eo "$secret_pattern" | head -n 3)
if [ -z "$leak" ]; then ok "$name: its environment holds no secret"; else nok "$name: its environment holds no secret" "$leak"; fi
for switch in OPENVERIFY_CONNECT_ENABLED=true OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED=true OPENVERIFY_SANDBOX_CHIP_FACES=; do
  if inspect '{{range .Config.Env}}{{println .}}{{end}}' | grep -q "^$switch"; then nok "$name: sets no $switch (rule 21)"; else ok "$name: sets no $switch (rule 21)"; fi
done

# A throwaway container of the image: read-only root, tmpfs /tmp, no network, every capability dropped.
in_image() { docker run --rm --read-only --tmpfs /tmp --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint "" "$image" "$@"; }
expect_eq "$name: runs as uid 10001 with --read-only --tmpfs /tmp" "10001" "$(in_image id -u 2>/dev/null)"
expect "$name: /tmp is writable" in_image sh -c 'echo x > /tmp/probe'
expect_eq "$name: nothing outside /tmp is writable" "" "$(in_image sh -c 'for d in / /app /app/* /home /var /etc /usr /root; do [ -d "$d" ] && touch "$d/.probe" 2>/dev/null && echo "$d"; done' 2>/dev/null)"
found=$(in_image sh -c 'find / -xdev \( -name ".env" -o -name ".env.*" -o -name "*.mmdb" -o -name "*.mmdb.gz" -o -name ".env.e2e" -o -name "stack.json" \) -not -path "/proc/*" -print 2>/dev/null | head -n 5')
expect_eq "$name: no .env, .env.e2e, stack.json or *.mmdb anywhere (ADR 0006)" "" "$found"
# Packages only: a directory directly under node_modules, or pnpm's store entry of one (Next.js has
# folders of its own named typescript under next/dist/, which are not the compiler).
denied=$(in_image sh -c 'find / -xdev \( -path "*/node_modules/tsx" -o -path "*/node_modules/vitest" -o -path "*/node_modules/typescript" -o -path "*/node_modules/eslint" -o -path "*/node_modules/vite" -o -path "*/node_modules/@playwright" -o -path "*/node_modules/.pnpm/tsx@*" -o -path "*/node_modules/.pnpm/vitest@*" -o -path "*/node_modules/.pnpm/typescript@*" -o -path "*/node_modules/.pnpm/eslint@*" -o -path "*/node_modules/.pnpm/vite@*" -o -path "*/node_modules/.pnpm/@playwright+*" \) -prune -print 2>/dev/null | head -n 5')
expect_eq "$name: no tsx, vitest, typescript, @playwright/*, eslint or vite in node_modules" "" "$denied"

# P18: a secret file at mode 0440, owned by the host user's group, which the container joins as the
# chart's fsGroup makes it join the Secret volume's group.
secret_file() { # secret_file <name> <value>: writes the file, prints its path inside the container
  printf '%s\n' "$2" >"$secrets_dir/$1"
  chmod 0440 "$secrets_dir/$1"
  chmod 0750 "$secrets_dir"
  printf '/run/secrets/openverify/%s' "$1"
}
secret_mount=(-v "$secrets_dir:/run/secrets/openverify:ro" --group-add "$(id -g)")
token_a='synthetic-images-test-token-0123456789abcdef'

http_status() { # http_status <container> <url>: the status, read from inside the container
  docker exec "$1" node -e "fetch(process.argv[1]).then((r) => { console.log(r.status); }, () => { console.log(0); })" "$2" 2>/dev/null
}
http_header() { # http_header <container> <url> <header>
  docker exec "$1" node -e "fetch(process.argv[1]).then((r) => { console.log(r.headers.get(process.argv[2]) ?? ''); }, () => {})" "$2" "$3" 2>/dev/null
}
wait_for() { # wait_for <seconds> <command...>
  local deadline=$((SECONDS + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    sleep 1
  done
}
status_is() { [ "$(http_status "$1" "$2")" = "$3" ]; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
hardened=(--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges)

case "$mode" in
api)
  # C257.1, review F27, amendments 14, 16, 17; Workflows 7A (a), 7B (f), 10C, 11B (i).
  commands=$(python3 -I -c 'import json,sys; print(" ".join(f.split("/")[-1][:-3] for f in json.load(open(sys.argv[1]))["files"]))' "$repo_root/apps/api/tsconfig.commands.json")
  missing=$(in_image sh -c "cd /app/apps/api && for c in $commands; do [ -f dist/commands/\$c.js ] || echo \$c; done")
  expect_eq "api: every operator command is compiled (dist/commands/<name>.js)" "" "$missing"
  # face-scan-benchmark: a development tool since Workflow 11F (KP11-71).
  for tool in graph-benchmark analytics-benchmark workflow-docs workflow-benchmark seed-load lists-benchmark network-benchmark face-scan-benchmark; do
    if in_image test -e "/app/apps/api/dist/commands/$tool.js"; then nok "api: leaves the development tool $tool out"; else ok "api: leaves the development tool $tool out"; fi
  done
  out=$(in_image node /app/apps/api/dist/commands/org-create.js 2>&1)
  rc=$?
  expect_eq "api: a compiled command runs (org:create with no argument prints its usage, 2)" "2" "$rc"
  # Ours only: the API and the workspace packages (third-party packages ship their own tests).
  test_support=$(in_image sh -c 'ls -d /app/apps/api/src /app/apps/api/scripts 2>/dev/null; find /app/apps/api/dist /app/apps/api/node_modules/.pnpm/@openverify+*/node_modules/@openverify/*/ \( -path "*/dist/test-support" -o -name "*.test-support.js" -o -name "*.test.js" -o -type d -name src \) -print 2>/dev/null | head -n 3')
  expect_eq "api: no test support, test, source or script tsx would run (decision 24)" "" "$test_support"
  expect "api: keeps @openverify/emrtd's dist/testing/ (trust:sandbox-utopia, the sandbox chip)" \
    in_image sh -c 'cd /app/apps/api && node -e "import(\"@openverify/emrtd/testing\").then(() => process.exit(0), () => process.exit(1))"'
  for dep in csv-parse csv-stringify ajv openid-client oauth4webapi jose nodemailer; do
    # Installed for whichever package declares it (csv-parse and csv-stringify are @openverify/checks').
    expect "api: the production dependency $dep is there" \
      in_image sh -c "ls -d /app/apps/api/node_modules/.pnpm/$dep@*/node_modules/$dep/package.json"
  done
  pins=$(python3 -I - "$repo_root/data/manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    entries = {e["filename"]: e["sha256"] for e in json.load(fh)["data"]}
for name in ("disposable_email_blocklist.conf", "x4bnet-datacenter-ASN.txt", "x4bnet-vpn-ASN.txt", "bad-asn-list.csv"):
    print(f"{entries[name]}  /app/data/{name}")
PY
)
  groups_pin=$(sed -n "s/^  '\([0-9a-f]\{64\}\)';$/\1/p" "$repo_root/packages/watchlist/src/keys/variant-groups.ts" | head -n 1)
  expect "api: the baked data files match their pins (sha256sum -c)" \
    in_image sh -c "printf '%s\n%s  /app/data/variant-groups.json\n' \"$pins\" $groups_pin | sha256sum -c -"
  for path in data/manifest.json data/malicious-feeds.json network/sources.json network/asn-overrides.json watchlists/sources.json trust-anchors/manifest.json contracts/fixtures/i18n/en.json contracts/fixtures/i18n/consent-texts.json contracts/fixtures/flows/default-gov-id-selfie.json; do
    expect "api: carries /app/$path" in_image test -f "/app/$path"
  done
  if in_image sh -c 'find / -xdev -type d -name faces -not -path "/proc/*" | grep -q .'; then nok "api: holds no face"; else ok "api: holds no face"; fi

  # The image's own Postgres and Valkey on a network of their own.
  docker network create "$run_id" >/dev/null
  pg_password=synthetic-images-test-postgres
  docker run -d --name "$run_id-postgres" --network "$run_id" -e POSTGRES_USER=openverify \
    -e POSTGRES_PASSWORD="$pg_password" -e POSTGRES_DB=openverify "$POSTGRES_PIN" >/dev/null
  docker run -d --name "$run_id-valkey" --network "$run_id" "$VALKEY_PIN" >/dev/null
  expect "api: the test's Postgres is ready" wait_for 90 docker exec "$run_id-postgres" pg_isready -U openverify -d openverify -h 127.0.0.1
  env=(
    -e OPENVERIFY_MODE=production
    -e OPENVERIFY_API_HOST=0.0.0.0
    -e "DATABASE_URL_FILE=$(secret_file DATABASE_URL "postgres://openverify:$pg_password@$run_id-postgres:5432/openverify")"
    -e "REDIS_URL=redis://$run_id-valkey:6379"
    -e "OPENVERIFY_KEK_FILE=$(secret_file OPENVERIFY_KEK "$(openssl rand -base64 32)")"
    -e "OPENVERIFY_BLIND_INDEX_KEY_FILE=$(secret_file OPENVERIFY_BLIND_INDEX_KEY "$(openssl rand -base64 32)")"
    -e "OPENVERIFY_API_KEY_PEPPER_FILE=$(secret_file OPENVERIFY_API_KEY_PEPPER "synthetic-$(openssl rand -hex 24)")"
    -e "OPENVERIFY_VISION_SERVICE_TOKEN_FILE=$(secret_file OPENVERIFY_VISION_SERVICE_TOKEN "synthetic-$(openssl rand -hex 24)")"
    -e "S3_SECRET_ACCESS_KEY_FILE=$(secret_file S3_SECRET_ACCESS_KEY "synthetic-$(openssl rand -hex 16)")"
    -e S3_ACCESS_KEY_ID=synthetic-images-test -e S3_BUCKET=openverify -e S3_REGION=us-east-1
    -e "S3_ENDPOINT=http://$run_id-s3.invalid:9000" -e S3_FORCE_PATH_STYLE=true
    -e OPENVERIFY_FLOW_PUBLIC_URL=https://flow.example.test
    -e OPENVERIFY_VISION_URL=http://vision.example.test:8000
  )
  out=$(docker run --rm --name "$run_id-migrate" --network "$run_id" "${hardened[@]}" "${secret_mount[@]}" "${env[@]}" "$image" node dist/commands/db-migrate.js 2>&1)
  rc=$?
  expect_eq "api: db:migrate runs from the compiled command, its secrets read from files at 0440" "0" "$rc"
  [ "$rc" -eq 0 ] || printf '%s\n' "$out" | tail -n 5
  out=$(docker run --rm --name "$run_id-seed" --network "$run_id" "${hardened[@]}" "${secret_mount[@]}" "${env[@]}" "$image" node dist/commands/seed-dev.js 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && grep -qi production <<<"$out"; then ok "api: seed:dev still refuses production mode"; else nok "api: seed:dev still refuses production mode" "rc $rc"; fi
  docker run -d --name "$run_id-api" --network "$run_id" "${hardened[@]}" "${secret_mount[@]}" "${env[@]}" "$image" >/dev/null
  if wait_for 90 status_is "$run_id-api" http://127.0.0.1:3000/health 200; then ok "api: GET /health answers 200 (read-only root, tmpfs /tmp)"; else nok "api: GET /health answers 200 (read-only root, tmpfs /tmp)" "$(docker logs "$run_id-api" 2>&1 | tail -n 3)"; fi
  if wait_for 30 status_is "$run_id-api" http://127.0.0.1:3000/ready 200; then ok "api: GET /ready answers 200 with Postgres and Valkey up"; else nok "api: GET /ready answers 200 with Postgres and Valkey up"; fi
  docker run -d --name "$run_id-worker" --network "$run_id" "${hardened[@]}" "${secret_mount[@]}" "${env[@]}" "$image" node dist/worker.js >/dev/null
  if wait_for 90 docker exec "$run_id-worker" node dist/worker-health.js; then ok "api: the worker's heartbeat under the tmpfs /tmp passes node dist/worker-health.js"; else nok "api: the worker's heartbeat under the tmpfs /tmp passes node dist/worker-health.js" "$(docker logs "$run_id-worker" 2>&1 | tail -n 3)"; fi
  # The secret volume's mount point (/run/secrets/openverify) is Docker's, not a write of the process.
  expect_eq "api: no process wrote outside /tmp" "" "$( (docker diff "$run_id-api"; docker diff "$run_id-worker") 2>/dev/null | grep -v '^[ACD] /tmp' | grep -Ev '^[ACD] /run(/secrets(/openverify)?)?$' || true)"
  leak=$( (docker logs "$run_id-api" 2>&1; docker logs "$run_id-worker" 2>&1) | grep -F -e "$pg_password" -e synthetic- | head -n 1)
  expect_eq "api: no secret value in the logs" "" "$leak"
  ;;

dashboard)
  # C257.1, amendment 12: the custom server (C21) over the standalone output; nothing written
  # outside /tmp; the BFF token read from a file (amendment 13).
  if in_image test -e /app/apps/dashboard/server.js; then nok "dashboard: Next's generated server.js is not shipped (it drops the peer header)"; else ok "dashboard: Next's generated server.js is not shipped (it drops the peer header)"; fi
  expect "dashboard: the custom server is there" in_image test -f /app/apps/dashboard/server.ts
  docker run -d --name "$run_id-dashboard" --network none "${hardened[@]}" "${secret_mount[@]}" \
    -e OPENVERIFY_API_URL=http://127.0.0.1:9 \
    -e "OPENVERIFY_DASHBOARD_BFF_TOKEN_FILE=$(secret_file OPENVERIFY_DASHBOARD_BFF_TOKEN "$token_a")" \
    "$image" >/dev/null
  if wait_for 90 status_is "$run_id-dashboard" http://127.0.0.1:3001/login 200; then ok "dashboard: GET /login answers 200 (read-only root, tmpfs /tmp)"; else nok "dashboard: GET /login answers 200 (read-only root, tmpfs /tmp)" "$(docker logs "$run_id-dashboard" 2>&1 | tail -n 3)"; fi
  csp=$(http_header "$run_id-dashboard" http://127.0.0.1:3001/login content-security-policy)
  if grep -q "'nonce-" <<<"$csp" && grep -q "frame-ancestors 'none'" <<<"$csp"; then ok "dashboard: /login carries the nonce script policy (C170)"; else nok "dashboard: /login carries the nonce script policy (C170)" "$csp"; fi
  expect_eq "dashboard: no Strict-Transport-Security from the image (the ingress sends it, C255.1)" "" "$(http_header "$run_id-dashboard" http://127.0.0.1:3001/login strict-transport-security)"
  expect "dashboard: still running" running "$run_id-dashboard"
  leak=$(docker logs "$run_id-dashboard" 2>&1 | grep -F "$token_a" | head -n 1)
  expect_eq "dashboard: the BFF token is never logged" "" "$leak"
  ;;

flow | flow-noguidance)
  # C157 as built, C257.1, C289: the flow server over the bundle; its token from a file.
  expect "$name: the bundle's index is there" in_image test -f /app/apps/flow/dist/index.html
  expect "$name: no TypeScript compiler or Vite beside the server" in_image sh -c '! find / -xdev -name "tsc" -path "*/bin/*" -o -name "vite.js" | grep -q .'
  wasm=$(in_image sh -c 'find /app/apps/flow/dist -name "ort-*" -o -name "*.wasm" -o -name "*.onnx" | head -n 3')
  if [ "$mode" = flow ]; then
    if [ -n "$wasm" ]; then ok "flow: the bundle holds onnxruntime-web's WASM and YuNet"; else nok "flow: the bundle holds onnxruntime-web's WASM and YuNet"; fi
  else
    expect_eq "flow (no guidance, C289): the bundle holds no onnxruntime-web file, WASM or model" "" "$wasm"
    # onnxruntime-web's own code (its backend registry); the guidance's pinned file names stay as
    # strings in the main chunk and fetch nothing.
    expect_eq "flow (no guidance): no chunk holds onnxruntime-web's code" "" "$(in_image sh -c 'grep -rl "registerBackend" /app/apps/flow/dist 2>/dev/null | head -n 3')"
  fi
  if [ "$mode" = flow ]; then
    expect "flow: the bundle holds onnxruntime-web's code (the control of the check above)" in_image sh -c 'grep -rlq "registerBackend" /app/apps/flow/dist'
  fi
  # C257.1 (decision 73): the bundle carries no API origin of its own; its <meta> leaves connect-src
  # to the server's header.
  meta=$(in_image sh -c 'grep -o "Content-Security-Policy\" content=\"[^\"]*" /app/apps/flow/dist/index.html' | sed "s/&#39;/'/g")
  if grep -q "connect-src 'self' https: http:" <<<"$meta" && ! grep -q 'example' <<<"$meta"; then ok "$name: the bundle's <meta> leaves connect-src to the server's header (C257.1)"; else nok "$name: the bundle's <meta> leaves connect-src to the server's header (C257.1)" "$meta"; fi
  docker run -d --name "$run_id-flow" --network none "${hardened[@]}" "${secret_mount[@]}" \
    -e OPENVERIFY_FLOW_API_URL=https://api-a.example.test \
    -e OPENVERIFY_FLOW_SERVER_API_URL=http://127.0.0.1:9 \
    -e "OPENVERIFY_FLOW_SERVER_TOKEN_FILE=$(secret_file OPENVERIFY_FLOW_SERVER_TOKEN "$token_a")" \
    "$image" >/dev/null
  if wait_for 60 status_is "$run_id-flow" http://127.0.0.1:4173/ 200; then ok "$name: GET / answers the static index (read-only root, tmpfs /tmp)"; else nok "$name: GET / answers the static index (read-only root, tmpfs /tmp)" "$(docker logs "$run_id-flow" 2>&1 | tail -n 3)"; fi
  csp=$(http_header "$run_id-flow" http://127.0.0.1:4173/ content-security-policy)
  if grep -q "connect-src 'self' https://api-a.example.test" <<<"$csp" && grep -q "frame-ancestors 'none'" <<<"$csp"; then ok "$name: the CSP header names the API's origin and frame-ancestors 'none'"; else nok "$name: the CSP header names the API's origin and frame-ancestors 'none'" "$csp"; fi
  if [ "$mode" = flow ]; then
    expect_eq "flow: serves Eigen's source location beside the WASM" 200 "$(http_status "$run_id-flow" http://127.0.0.1:4173/licenses/onnxruntime-web/EIGEN-SOURCE.txt)"
  fi
  # One image against two API URLs without a rebuild (C257.1, verification V07).
  config_of() { docker exec "$1" node -e "fetch('http://127.0.0.1:4173/config.json').then((r) => r.text()).then((t) => console.log(t), () => console.log(''))" 2>/dev/null; }
  expect_eq "$name: /config.json names the first install's API" '{"api-url":"https://api-a.example.test"}' "$(config_of "$run_id-flow")"
  docker run -d --name "$run_id-flow-b" --network none "${hardened[@]}" \
    -e OPENVERIFY_FLOW_API_URL=https://api-b.example.test/openverify "$image" >/dev/null
  if wait_for 60 status_is "$run_id-flow-b" http://127.0.0.1:4173/config.json 200; then
    expect_eq "$name: the same image names a second install's API" '{"api-url":"https://api-b.example.test/openverify"}' "$(config_of "$run_id-flow-b")"
    csp_b=$(http_header "$run_id-flow-b" http://127.0.0.1:4173/ content-security-policy)
    if grep -q "connect-src 'self' https://api-b.example.test;" <<<"$csp_b"; then ok "$name: and sends its origin in connect-src"; else nok "$name: and sends its origin in connect-src" "$csp_b"; fi
  else
    nok "$name: a second container of the same image starts" "$(docker logs "$run_id-flow-b" 2>&1 | tail -n 3)"
  fi
  leak=$(docker logs "$run_id-flow" 2>&1 | grep -F "$token_a" | head -n 1)
  expect_eq "$name: the flow server's token is never logged" "" "$leak"
  if docker logs "$run_id-flow" 2>&1 | grep -q 'OPENVERIFY_FLOW_SERVER_TOKEN is not set'; then nok "$name: the token from the file is used"; else ok "$name: the token from the file is used"; fi
  ;;

vision)
  # C257.1 as amended (15), decision 8 (Eigen's source location, P2), C60.2 on /v1/mask/background.
  expect "vision: licenses/onnxruntime/ holds the wheel's ThirdPartyNotices.txt" in_image test -s /app/licenses/onnxruntime/ThirdPartyNotices.txt
  expect_eq "vision: licenses/onnxruntime/EIGEN-SOURCE.txt is the committed file" \
    "$(sha256sum <"$repo_root/services/vision/licenses/onnxruntime/EIGEN-SOURCE.txt" | cut -d' ' -f1)" \
    "$(in_image sh -c 'sha256sum < /app/licenses/onnxruntime/EIGEN-SOURCE.txt' | cut -d' ' -f1)"
  expect "vision: carries models/manifest.json and scripts/fetch_models.py" in_image test -f /app/models/manifest.json -a -f /app/scripts/fetch_models.py
  # The weights models/manifest.json pins, by name (onnxruntime's wheel carries three tiny example
  # graphs of its own under onnxruntime/datasets/, which are not weights of ours).
  weights=$(python3 -I -c 'import json,sys; print(" ".join("-o -name " + m["filename"] for m in json.load(open(sys.argv[1]))["models"])[3:])' "$repo_root/models/manifest.json")
  expect_eq "vision: holds no model weight of models/manifest.json (Q6, decision 5)" "" "$(in_image sh -c "find / -xdev \( $weights \) -not -path '/proc/*' 2>/dev/null | head -n 3")"
  if [ ! -f "$repo_root/models/face_detection_yunet_2026may.onnx" ]; then
    nok "vision: the models are fetched (python3 -I scripts/fetch_models.py)"
    finish
  fi
  token_file=$(secret_file OPENVERIFY_VISION_SERVICE_TOKEN "$token_a")
  docker run -d --name "$run_id-vision" --network none "${hardened[@]}" "${secret_mount[@]}" \
    -v "$repo_root/models:/models:ro" -e "OPENVERIFY_VISION_SERVICE_TOKEN_FILE=$token_file" "$image" >/dev/null
  probe() { # probe <python>: run inside the vision container
    docker exec "$run_id-vision" python -c "$1"
  }
  health='import sys, urllib.request; sys.exit(0 if urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=4).status == 200 else 1)'
  if wait_for 90 probe "$health"; then ok "vision: /health with the models mounted read-only and no network"; else nok "vision: /health with the models mounted read-only and no network" "$(docker logs "$run_id-vision" 2>&1 | tail -n 3)"; fi
  mask='
import sys, urllib.error, urllib.request
import cv2, numpy as np
ok, png = cv2.imencode(".png", np.full((64, 64, 3), 200, np.uint8))
boundary = "openverifyimagestest"
def post(body, token):
    req = urllib.request.Request("http://127.0.0.1:8000/v1/mask/background", data=body, method="POST")
    req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
    if token:
        req.add_header("x-service-token", token)
    try:
        return urllib.request.urlopen(req, timeout=20).status
    except urllib.error.HTTPError as error:
        return error.code
def form(data):
    head = f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"f.png\"\r\nContent-Type: image/png\r\n\r\n".encode()
    return head + data + f"\r\n--{boundary}--\r\n".encode()
token = open(sys.argv[1]).read().strip()
print(post(form(png.tobytes()), None), post(form(png.tobytes()), token), post(form(b"\0" * (11 * 1024 * 1024)), token))
'
  expect_eq "vision: /v1/mask/background needs the token, names a frame without a face, and keeps its body limit" \
    "401 422 413" "$(docker exec "$run_id-vision" python -c "$mask" "$token_file" 2>/dev/null)"
  leak=$(docker logs "$run_id-vision" 2>&1 | grep -F "$token_a" | head -n 1)
  expect_eq "vision: the service token is never logged" "" "$leak"
  # The start-up digest check: one model whose bytes differ from models/manifest.json.
  tampered=$(mktemp -d)
  cp "$repo_root/models/face_detection_yunet_2026may.onnx" "$tampered/"
  printf 'x' >>"$tampered/face_detection_yunet_2026may.onnx"
  chmod -R a+rX "$tampered"
  out=$(timeout 60 docker run --rm --name "$run_id-tampered" --network none "${hardened[@]}" "${secret_mount[@]}" \
    -v "$tampered:/models:ro" -e "OPENVERIFY_VISION_SERVICE_TOKEN_FILE=$token_file" "$image" 2>&1)
  rc=$?
  find "$tampered" -mindepth 1 -delete
  rmdir "$tampered"
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ] && grep -q 'face_detection_yunet_2026may.onnx' <<<"$out"; then ok "vision: refuses to start when a model's SHA-256 differs from models/manifest.json"; else nok "vision: refuses to start when a model's SHA-256 differs from models/manifest.json" "rc $rc"; fi
  ;;

code-runner)
  # C123.3 as built (Phase 8 P17): the pool behind its socket, with no network and nothing writable
  # but its socket volume and /tmp.
  docker run -d --name "$run_id-runner" --network none "${hardened[@]}" "$image" >/dev/null
  if wait_for 30 docker exec "$run_id-runner" node bin/code-runner-server.mjs --health; then ok "code-runner: answers its socket's handshake (--health)"; else nok "code-runner: answers its socket's handshake (--health)" "$(docker logs "$run_id-runner" 2>&1 | tail -n 3)"; fi
  expect "code-runner: no package manager" in_image sh -c '! command -v npm && ! command -v corepack && ! command -v pnpm'
  # C263.6 (Phase 11, Workflow 11C): the tcp: listener, its token read from a file at 0440 (P18).
  runner_token=$(secret_file OPENVERIFY_CODE_RUNNER_TOKEN "$token_a")
  docker run -d --name "$run_id-runner-tcp" --network none "${hardened[@]}" "${secret_mount[@]}" \
    -e OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:7700 -e "OPENVERIFY_CODE_RUNNER_TOKEN_FILE=$runner_token" \
    -e OPENVERIFY_CODE_RUNNER_POOL_SIZE=1 "$image" >/dev/null
  if wait_for 30 docker exec "$run_id-runner-tcp" node bin/code-runner-server.mjs --health; then ok "code-runner: listens on tcp 7700 and answers a client holding the token (--health)"; else nok "code-runner: listens on tcp 7700 and answers a client holding the token (--health)" "$(docker logs "$run_id-runner-tcp" 2>&1 | tail -n 3)"; fi
  if docker exec -e OPENVERIFY_CODE_RUNNER_TOKEN_FILE= -e OPENVERIFY_CODE_RUNNER_TOKEN=synthetic-wrong-runner-token-0123456789 "$run_id-runner-tcp" node bin/code-runner-server.mjs --health >/dev/null 2>&1; then nok "code-runner: refuses a client with another token"; else ok "code-runner: refuses a client with another token"; fi
  # No EXPOSE: Phase 8's contract (infra/tests/code-runner.test.sh) keeps the image publishing no port.
  expect_eq "code-runner: exposes no port of its own (the chart's Service names 7700)" "" "$(inspect '{{range $p, $_ := .Config.ExposedPorts}}{{$p}}{{end}}')"
  # Bounded and named, so a runner that serves anyway is stopped and removed with the others.
  out=$(timeout 30 docker run --rm --name "$run_id-runner-notoken" --network none "${hardened[@]}" -e OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:7700 "$image" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && grep -q 'OPENVERIFY_CODE_RUNNER_TOKEN: is required' <<<"$out"; then ok "code-runner: refuses to listen on tcp without a token"; else nok "code-runner: refuses to listen on tcp without a token" "rc $rc"; fi
  leak=$(docker logs "$run_id-runner-tcp" 2>&1 | grep -F "$token_a" | head -n 1)
  expect_eq "code-runner: the token is never logged" "" "$leak"
  ;;
esac
finish
