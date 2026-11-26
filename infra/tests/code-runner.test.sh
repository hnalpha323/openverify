#!/usr/bin/env bash
# Contract test for the code-runner image and container (Phase 8, C123.3, C123.9, F19, P17).
#
# Evaluate Code runs operator text. In the compose `app` profile the pool lives in its own container
# so that an escape from QuickJS, from WebAssembly and from the child still finds no network, no
# secret and nothing to write. Checked here:
#
# Static checks (always run), on infra/docker/code-runner.Dockerfile:
#   - the base image is the pinned one api.Dockerfile uses (Workflow 11C: apps.Dockerfile is gone),
#     the install is frozen and offline after
#     `pnpm fetch`, and it runs as uid 10001;
#   - it publishes no port, sets no secret, fetches nothing at run time and ships no package
#     manager, no source and no test fixture;
#   - the compose `app` profile holds a `code-runner` service with no
#     network, a read-only root, uid 10001, every capability dropped, no-new-privileges, memory and
#     PID limits, no published port and no variable holding a secret.
# Live checks (skipped with --static-only), with one image and throwaway containers on a volume of
# their own, all removed at the end; nothing else is touched:
#   - the image layout (F19): the entry, the QuickJS packages and the .wasm resolve to real paths
#     inside the image, and --allow-fs-read holds exactly those;
#   - the service runs with no network, a read-only root, uid 10001, no capability, no-new-privileges
#     and a seccomp filter, and the only interface is loopback;
#   - a second container on the same volume, also with no network, evaluates through the socket: a
#     value, a timeout, a memory limit;
#   - the child runs with --permission and an empty environment, and a canary in the service's
#     environment is absent from it;
#   - the image holds no .env, no secret variable, no npm and no test fixture.
# No probe leaves the host: the one address tried is from 198.51.100.0/24, on a container that has
# no route. CI runs the static half only (the `infra` job).
#
# Usage: infra/tests/code-runner.test.sh [--static-only]
# Env:   ENV_FILE          env file for `docker compose config` (default: <repo>/.env.example)
#        CODE_RUNNER_IMAGE an image already built; otherwise this builds openverify/code-runner:dev
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
dockerfile="$repo_root/infra/docker/code-runner.Dockerfile"
apps_dockerfile="$repo_root/infra/docker/api.Dockerfile"
compose_file="$repo_root/infra/docker-compose.yml"
env_file="${ENV_FILE:-$repo_root/.env.example}"
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
expect() { # expect <description> <command...>: passes when the command exits 0
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else nok "$desc"; fi
}
expect_not() { # expect_not <description> <command...>: passes when the command exits non-zero
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then nok "$desc"; else ok "$desc"; fi
}
expect_eq() { # expect_eq <description> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected '$2', got '$3'"; fi
}
finish() {
  printf '%s passed, %s failed\n' "$passed" "$failed"
  [ "$failed" -eq 0 ]
  exit $?
}

# --- static ------------------------------------------------------------------------------------

if [ ! -f "$dockerfile" ]; then
  nok "the Dockerfile exists" "$dockerfile"
  finish
fi
ok "the Dockerfile exists"

node_image() { sed -n 's/^ARG NODE_IMAGE=//p' "$1" | head -n1; }
expect_eq "the base image is the pinned one of the API image" \
  "$(node_image "$apps_dockerfile")" "$(node_image "$dockerfile")"
expect "the install is frozen and offline after pnpm fetch" \
  grep -Eq 'pnpm install --frozen-lockfile --offline' "$dockerfile"
expect "it runs as uid 10001" grep -Eq '^USER 10001:10001$' "$dockerfile"
expect_not "it publishes no port" grep -Eq '^EXPOSE' "$dockerfile"
expect_not "it sets no secret or key variable" \
  grep -Eiq '^(ENV|ARG) .*(KEK|SECRET|TOKEN|PASSWORD|DATABASE_URL|S3_)' "$dockerfile"
expect_not "it fetches nothing with curl or wget" grep -Eq '\b(curl|wget)\b' "$dockerfile"
expect "it removes the package managers from the final image" \
  grep -Eq 'rm -rf .*/usr/local/lib/node_modules' "$dockerfile"
expect "it removes the package's source and the tests' child" grep -Fq '/app/src' "$dockerfile"
expect "it removes the sources of the workspace packages" \
  grep -Fq '/app/node_modules/.pnpm/@openverify+*/node_modules/@openverify/*/src' "$dockerfile"
expect "it starts the server entry" \
  grep -Eq '^CMD \["node", "bin/code-runner-server.mjs"\]$' "$dockerfile"

compose_json=$(docker compose -f "$compose_file" --env-file "$env_file" --profile app config --format json 2>/dev/null || true)
service() { # service <jq-free python expression over `s`>
  printf '%s' "$compose_json" | python3 -c "
import json, sys
config = json.load(sys.stdin)
s = config.get('services', {}).get('code-runner')
print('absent' if s is None else ($1))"
}
if [ -z "$compose_json" ] || [ "$(service 'present')" = "absent" ] 2>/dev/null; then
  nok "the compose app profile holds the code-runner service"
else
  expect_eq "compose: reached only through its socket volume" \
    "['code-runner-socket:/run/code-runner:rw']" \
    "$(service "[f\"{v['source']}:{v['target']}:rw\" for v in s.get('volumes', [])]")"
  expect_eq "compose: no network" "none" "$(service "s.get('network_mode')")"
  expect_eq "compose: a read-only root" "True" "$(service "s.get('read_only')")"
  expect_eq "compose: uid 10001" "10001:10001" "$(service "s.get('user')")"
  expect_eq "compose: every capability dropped" "['ALL']" "$(service "s.get('cap_drop')")"
  expect_eq "compose: no-new-privileges" "True" \
    "$(service "'no-new-privileges:true' in s.get('security_opt', [])")"
  expect_eq "compose: a memory limit" "True" "$(service "bool(s.get('mem_limit'))")"
  expect_eq "compose: a PID limit" "True" "$(service "bool(s.get('pids_limit'))")"
  expect_eq "compose: no published port" "None" "$(service "s.get('ports')")"
  expect_eq "compose: no secret variable" "[]" \
    "$(service "[k for k in s.get('environment', {}) if any(w in k for w in ('KEK', 'SECRET', 'TOKEN', 'PASSWORD', 'DATABASE', 'S3_', 'SMTP', 'TWILIO'))]")"
fi

if [ "$static_only" = true ]; then
  finish
fi

# --- live --------------------------------------------------------------------------------------

image="${CODE_RUNNER_IMAGE:-openverify/code-runner:dev}"
if [ -z "${CODE_RUNNER_IMAGE:-}" ]; then
  if ! docker build -q -f "$dockerfile" -t "$image" "$repo_root" >/dev/null; then
    nok "the image builds"
    finish
  fi
fi
ok "the image builds"

suffix="$$"
volume="openverify-code-runner-test-$suffix"
service_name="openverify-code-runner-test-$suffix"
canary="CANARY-SERVICE-ENV-3fd1a9c2-synthetic"
cleanup() {
  docker rm -f "$service_name" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hardened=(--network none --read-only --user 10001:10001 --cap-drop ALL
  --security-opt no-new-privileges --memory 256m --pids-limit 64
  -v "$volume:/run/code-runner")

docker volume create "$volume" >/dev/null
if ! docker run -d --name "$service_name" "${hardened[@]}" -e "OPENVERIFY_TEST_CANARY=$canary" \
  "$image" >/dev/null; then
  nok "the service starts"
  finish
fi

in_service() { docker exec "$service_name" "$@"; }
in_worker() { docker run --rm "${hardened[@]}" "$image" "$@"; }

for _ in $(seq 1 100); do
  if in_service node bin/code-runner-server.mjs --health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
expect "the service answers its health check" in_service node bin/code-runner-server.mjs --health

layout=$(in_service node --input-type=module -e '
  import { resolveRunnerPaths } from "/app/dist/code-runner/paths.js";
  import { accessSync, realpathSync } from "node:fs";
  const paths = resolveRunnerPaths();
  for (const path of [paths.entry, paths.core, paths.variant, paths.wasm, paths.manifest]) {
    accessSync(path);
    if (realpathSync(path) !== path) throw new Error("not real: " + path);
  }
  const outside = paths.fsRead.filter((path) => !/quickjs|code-runner-child\.mjs$/.test(path));
  console.log(JSON.stringify({ label: paths.label, wasm: paths.wasm, outside, count: paths.fsRead.length }));
' 2>&1)
expect_eq "layout: the variant is the pinned one" "True" \
  "$(printf '%s' "$layout" | python3 -c "import json,sys; print(json.load(sys.stdin)['label'] == '@jitl/quickjs-wasmfile-release-sync@0.32.0')" 2>&1)"
expect_eq "layout: the .wasm is under /app/node_modules" "True" \
  "$(printf '%s' "$layout" | python3 -c "import json,sys; print(json.load(sys.stdin)['wasm'].startswith('/app/node_modules/'))" 2>&1)"
expect_eq "layout: --allow-fs-read holds nothing else" "[]" \
  "$(printf '%s' "$layout" | python3 -c "import json,sys; print(json.load(sys.stdin)['outside'])" 2>&1)"

expect_eq "the service has no network" "none" \
  "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$service_name")"
expect_eq "its only interface is loopback" "lo" "$(in_service ls /sys/class/net | tr -d '\r' | xargs)"
network_probe=$(in_service node -e '
  const socket = require("node:net").connect({ host: "198.51.100.1", port: 443, timeout: 2000 });
  socket.on("connect", () => { console.log("connected"); process.exit(0); });
  socket.on("timeout", () => { console.log("timeout"); process.exit(0); });
  socket.on("error", (error) => { console.log(error.code); process.exit(0); });
' 2>&1)
expect_eq "a connection out is refused by the kernel" "ENETUNREACH" "$network_probe"

expect_eq "it runs as uid 10001" "10001" "$(in_service id -u)"
expect_eq "it holds no capability" "0000000000000000" \
  "$(in_service sh -c "sed -n 's/^CapEff:\t//p' /proc/1/status")"
expect_eq "no-new-privileges is set" "1" \
  "$(in_service sh -c "sed -n 's/^NoNewPrivs:\t//p' /proc/1/status")"
expect_not "seccomp is not off" test "$(in_service sh -c "sed -n 's/^Seccomp:\t//p' /proc/1/status")" = "0"
expect_not "the root is read-only" in_service sh -c 'echo x > /app/written'
expect_not "/tmp is read-only too" in_service sh -c 'echo x > /tmp/written'
expect "the socket volume is writable" in_service sh -c 'echo x > /run/code-runner/written && rm /run/code-runner/written'

evaluate='
  import { connectCodeRunner } from "/app/dist/code-runner/index.js";
  const runner = connectCodeRunner("/run/code-runner/code-runner.sock");
  const environmentId = "env_01M5CJXHG07XPHF3HRM6NREDH8";
  const run = (body, limits) => runner.evaluate({
    environmentId,
    source: `export default function (input) {${body}}`,
    input: { a: 1 },
    limits,
  });
  const results = {
    value: await run("return input.a + 1;", { timeMs: 5000 }),
    timeout: await run("for (;;) {}", { timeMs: 50 }),
    memory: await run("const a = []; for (;;) a.push(\"x\".repeat(65536) + a.length);", { timeMs: 5000, memoryBytes: 2097152 }),
    globals: await run("return [typeof require, typeof process, typeof fetch].join();", { timeMs: 5000 }),
  };
  await runner.close();
  console.log(JSON.stringify(results));
'
results=$(in_worker node --input-type=module -e "$evaluate" 2>&1)
field() { printf '%s' "$results" | python3 -c "import json,sys; r=json.load(sys.stdin); print($1)" 2>&1; }
expect_eq "a second container evaluates through the socket" "2" "$(field "r['value']['value']")"
expect_eq "a loop ends in a timeout through the socket" "timeout" "$(field "r['timeout']['code']")"
expect_eq "an allocation ends in memory_limit through the socket" "memory_limit" "$(field "r['memory']['code']")"
expect_eq "the guest sees no host" "undefined,undefined,undefined" "$(field "r['globals']['value']")"
# In compose the worker is the apps image's `node` (uid 1000) and this service uid 10001, so the
# socket's own mode is all that joins them.
results=$(docker run --rm "${hardened[@]/10001:10001/1000:1000}" "$image" \
  node --input-type=module -e "$evaluate" 2>&1)
expect_eq "another uid, as the worker's is, evaluates through the socket" "2" "$(field "r['value']['value']")"

# A child is alive between evaluations, unless the last one recycled it: start one with a value.
in_worker node --input-type=module -e '
  import { connectCodeRunner } from "/app/dist/code-runner/index.js";
  const runner = connectCodeRunner("/run/code-runner/code-runner.sock");
  await runner.evaluate({ environmentId: "env_01M5CJXHG07XPHF3HRM6NREDH8", source: "export default function () { return 1; }", input: {} });
  await runner.close();
' >/dev/null 2>&1
child=$(in_service sh -c 'for p in /proc/[0-9]*; do if tr "\0" " " < "$p/cmdline" 2>/dev/null | grep -q code-runner-child; then echo "${p#/proc/}"; fi; done | head -n1')
if [ -z "$child" ]; then
  nok "a child is running"
else
  ok "a child is running"
  expect "the child runs with --permission" in_service sh -c "tr '\0' ' ' < /proc/$child/cmdline | grep -q -- --permission"
  expect "the child has a heap cap" in_service sh -c "tr '\0' ' ' < /proc/$child/cmdline | grep -q -- --max-old-space-size=64"
  expect "the child has no IPC channel" in_service sh -c "! grep -qz NODE_CHANNEL_FD /proc/$child/environ"
  expect_eq "the child's environment is empty" "0" "$(in_service sh -c "wc -c < /proc/$child/environ" | tr -d ' ')"
  expect "the canary is in the service" in_service sh -c "tr '\0' '\n' < /proc/1/environ | grep -q '$canary'"
  expect_not "the canary is not in the child" in_service sh -c "grep -q '$canary' /proc/$child/environ"
fi

expect_not "the image holds no .env" in_service sh -c 'find /app -name ".env*" -not -name ".env.example" -not -path "*/node_modules/*" | grep -q .'
expect_not "the image holds no npm" in_service sh -c 'command -v npm'
expect_not "the image holds no corepack" in_service sh -c 'command -v corepack'
expect_not "the image holds no test fixture" in_service sh -c 'find /app -name "fake-child.mjs" | grep -q .'
expect_not "the image holds none of our sources" in_service sh -c 'find /app -path "*/@openverify/*/src/*" | grep -q .'
expect_not "the image holds no package source of ours" in_service test -e /app/src
config_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image")
expect_not "the image sets no secret variable" \
  grep -Eiq '(KEK|SECRET|TOKEN|PASSWORD|DATABASE_URL|S3_)' <<<"$config_env"

finish
