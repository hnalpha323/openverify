#!/usr/bin/env bash
# Contract test for the load stack (Workflow 11D load-harness; C268.4, review V10; Stage 1a amendment
# 9; decisions 12, 13 and 20 before 11D; KP11-37): infra/load/docker-compose.load.yml over the compose
# app profile, its env template infra/load/load.env.example and its generator
# infra/load/make-load-env.sh.
#
#   --static-only   the override and the template read as YAML and text, no Docker (the infra job)
#   (default)       also renders `docker compose -p openverify-load ... config` from a generated env
#                   file in a private directory: no container is started, nothing is pulled.
#
# Usage: infra/tests/load-compose.test.sh [--static-only]
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
override="$repo_root/infra/load/docker-compose.load.yml"
template="$repo_root/infra/load/load.env.example"
generator="$repo_root/infra/load/make-load-env.sh"
static_only=0
for arg in "$@"; do [ "$arg" = --static-only ] && static_only=1; done
passed=0
failed=0
skipped=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
skip() { printf 'skip - %s\n' "$1"; skipped=$((skipped + 1)); }
finish() {
  printf '\n# %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

for file in "$override" "$template" "$generator"; do
  if [ -f "$file" ]; then ok "${file#"$repo_root"/} exists"; else nok "${file#"$repo_root"/} exists"; fi
done
if [ -x "$generator" ]; then ok "make-load-env.sh is executable"; else nok "make-load-env.sh is executable"; fi
if [ ! -f "$override" ] || [ ! -f "$template" ]; then finish; fi

# The static half: the override's shape, read as YAML (python3 with PyYAML, as the skeleton test).
static_out=$(python3 -I - "$override" "$template" <<'PY'
import re
import sys

import yaml

override_path, template_path = sys.argv[1], sys.argv[2]


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


with open(override_path, encoding="utf-8") as fh:
    doc = yaml.safe_load(fh)
services = doc.get("services", {})
check("the project is openverify-load", doc.get("name") == "openverify-load", doc.get("name"))

# The core split: every container on logical CPUs 0-9 (the generators on 10 and 11).
expected = {"postgres", "redis", "objectstore", "objectstore-init", "mailpit", "migrate", "runtime-role",
            "code-runner", "api", "worker", "vision", "flow", "dashboard"}
check("every service of the app profile is in the override", expected <= set(services), sorted(expected - set(services)))
for name in sorted(expected & set(services)):
    check(f"{name} runs on cpuset 0-9", str(services[name].get("cpuset")) == "0-9", services[name].get("cpuset"))

# KP11-37: the chart's default memory limits, no CPU limit.
limits = {"api": "1g", "worker": "1536m", "dashboard": "512m", "flow": "256m", "vision": "4g", "code-runner": "1g"}
for name, limit in limits.items():
    check(f"{name}'s memory limit is the chart's {limit}", str(services.get(name, {}).get("mem_limit")) == limit,
          services.get(name, {}).get("mem_limit"))
for name, service in services.items():
    check(f"{name} sets no CPU limit", "cpus" not in service and "cpu_quota" not in service)
    check(f"{name} is never on the host network", service.get("network_mode") != "host")
    check(f"{name} adds no published port (the base's, through the env file's variables)", "ports" not in service)


def env(name):
    value = services.get(name, {}).get("environment", {})
    return value if isinstance(value, dict) else {}


command = services.get("postgres", {}).get("command", [])
check("Postgres preloads pg_stat_statements", "shared_preload_libraries=pg_stat_statements" in command, command)
check("Postgres keeps the base's parameter-logging guard", "log_parameter_max_length=0" in command)
runtime_url = re.compile(r"^postgres://openverify_runtime:\$\{OPENVERIFY_LOAD_RUNTIME_PASSWORD[^}]*\}@postgres:5432/openverify_load$")
for name in ("api", "worker"):
    check(f"{name} connects as the runtime role", bool(runtime_url.match(str(env(name).get("DATABASE_URL", "")))),
          env(name).get("DATABASE_URL"))
    check(f"{name} has Connect on", str(env(name).get("OPENVERIFY_CONNECT_ENABLED")) == "true")
    check(f"{name} runs in development mode", str(env(name).get("OPENVERIFY_MODE")) == "development")
    check(f"{name} binds the sandbox deviceIntegrity provider for sandbox environments",
          str(env(name).get("OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX")) == "sandbox")
    check(f"{name} raises no rate limit", not any(k.startswith("OPENVERIFY_RATE_LIMIT_") for k in env(name)))
    check(f"{name} sets no UN opt-in switch of its own (Q10 granted; it inherits compose's default true)", "OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED" not in env(name))
migrate = services.get("migrate", {})
migrate_command = " ".join(map(str, migrate.get("command", [])))
check("migrate runs db-migrate.js, then db-grant-runtime.js openverify_runtime",
      re.search(r"node dist/commands/db-migrate\.js && node dist/commands/db-grant-runtime\.js openverify_runtime", migrate_command) is not None,
      migrate_command)
check("migrate migrates as the migration role", "OPENVERIFY_MIGRATION_DATABASE_URL" in env("migrate"))
check("migrate waits for the runtime role", "runtime-role" in migrate.get("depends_on", {}))
proxy = str(env("api").get("OPENVERIFY_TRUST_PROXY", ""))
check("the API trusts the load network's gateway, never true or loopback",
      proxy.startswith("${OPENVERIFY_LOAD_GATEWAY") and "true" not in proxy and "127.0.0.1" not in proxy, proxy)
check("the worker may reach a private webhook receiver", str(env("worker").get("OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS")) == "true")
check("the worker resolves host.docker.internal", "host.docker.internal:host-gateway" in services.get("worker", {}).get("extra_hosts", []))
check("the worker runs at concurrency 4", str(env("worker").get("OPENVERIFY_WORKER_CONCURRENCY")) == "4")
check("the console trusts one proxy hop", str(env("dashboard").get("OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS")) == "1")
ipam = doc.get("networks", {}).get("default", {}).get("ipam", {}).get("config", [{}])[0]
check("the load network has a fixed subnet and gateway", str(ipam.get("gateway", "")).startswith("${OPENVERIFY_LOAD_GATEWAY")
      and str(ipam.get("subnet", "")).startswith("${OPENVERIFY_LOAD_SUBNET"), ipam)

with open(template_path, encoding="utf-8") as fh:
    template = dict(line.split("=", 1) for line in fh.read().splitlines() if line and not line.startswith("#") and "=" in line)
ports = {"POSTGRES_PORT": "25432", "REDIS_PORT": "26379", "S3_PORT": "29000", "S3_CONSOLE_PORT": "29001",
         "MAILPIT_SMTP_PORT": "21025", "MAILPIT_UI_PORT": "28025", "OPENVERIFY_API_PORT": "23000",
         "OPENVERIFY_FLOW_PORT": "25173", "OPENVERIFY_DASHBOARD_PORT": "23001"}
for name, port in ports.items():
    check(f"the template's {name} is {port}", template.get(name) == port, template.get(name))
check("every port binds to loopback", template.get("OPENVERIFY_BIND_ADDRESS") == "127.0.0.1")
check("the database is openverify_load", template.get("POSTGRES_DB") == "openverify_load")
secrets = [k for k, v in template.items() if v.startswith("change-me")]
check("every secret of the template is a change-me placeholder",
      {"POSTGRES_PASSWORD", "REDIS_PASSWORD", "OPENVERIFY_KEK", "OPENVERIFY_API_KEY_PEPPER",
       "OPENVERIFY_BLIND_INDEX_KEY", "OPENVERIFY_LOAD_RUNTIME_PASSWORD"} <= set(secrets), secrets)
check("the gateway is the subnet's first address",
      template.get("OPENVERIFY_LOAD_SUBNET", "").rsplit(".", 1)[0] == template.get("OPENVERIFY_LOAD_GATEWAY", "").rsplit(".", 1)[0])
check("the template raises no rate limit", not any(k.startswith("OPENVERIFY_RATE_LIMIT_") for k in template))
check("the template keeps the default queue cap ceiling", template.get("OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX", "50") == "50")
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "* | "ok  "*) ok "${line#ok  * - }" ;;
    FAIL*) nok "${line#FAIL - }" ;;
  esac
done <<<"$static_out"
if ! grep -q 'OPENVERIFY_SKELETON' "$override" "$template" "$generator" 2>/dev/null; then ok "no skeleton marker"; else nok "no skeleton marker"; fi

if [ "$static_only" = 1 ]; then
  skip "docker compose config from a generated env file (--static-only)"
  finish
fi

# The live half: a generated env file (mode 0600, no placeholder left) renders with the base.
work=$(mktemp -d)
# shellcheck disable=SC2064 # expand now: the path is fixed
trap "rm -rf '$work'" EXIT
env_file="$work/load.env"
if OPENVERIFY_LOAD_ENV="$env_file" bash "$generator" >"$work/gen.out" 2>&1; then ok "make-load-env.sh writes an env file"; else nok "make-load-env.sh writes an env file" "$(tail -n 2 "$work/gen.out")"; finish; fi
if [ "$(stat -c %a "$env_file")" = 600 ]; then ok "the env file is mode 0600"; else nok "the env file is mode 0600" "$(stat -c %a "$env_file")"; fi
if ! grep -q 'change-me' "$env_file"; then ok "no change-me placeholder is left"; else nok "no change-me placeholder is left"; fi
if ! grep -q '=' "$work/gen.out"; then ok "the generator prints no value"; else nok "the generator prints no value"; fi
if OPENVERIFY_LOAD_ENV="$env_file" bash "$generator" >/dev/null 2>&1; then nok "the generator refuses to overwrite an env file"; else ok "the generator refuses to overwrite an env file"; fi
rendered="$work/config.json"
if docker compose -p openverify-load -f "$repo_root/infra/docker-compose.yml" -f "$override" --env-file "$env_file" --profile app config --format json >"$rendered" 2>"$work/config.err"; then
  ok "docker compose renders the load stack"
else
  nok "docker compose renders the load stack" "$(tail -n 3 "$work/config.err")"
  finish
fi
live_out=$(python3 -I - "$rendered" "$env_file" <<'PY'
import json
import sys

doc = json.load(open(sys.argv[1], encoding="utf-8"))
env = dict(l.split("=", 1) for l in open(sys.argv[2], encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))
services = doc["services"]


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


check("the rendered project is openverify-load", doc.get("name") == "openverify-load")
published = sorted((p.get("host_ip"), p.get("published")) for s in services.values() for p in s.get("ports", []))
check("every published port is on 127.0.0.1", all(ip == "127.0.0.1" for ip, _ in published), published)
check("the published ports are the load stack's",
      {port for _, port in published} == {"25432", "26379", "29000", "29001", "21025", "28025", "23000", "25173", "23001"},
      published)
check("the API trusts exactly the gateway", services["api"]["environment"]["OPENVERIFY_TRUST_PROXY"] == env["OPENVERIFY_LOAD_GATEWAY"])
check("the API's database user is openverify_runtime",
      services["api"]["environment"]["DATABASE_URL"].startswith("postgres://openverify_runtime:"))
check("the database is openverify_load", services["postgres"]["environment"]["POSTGRES_DB"] == "openverify_load")
check("the API keeps the shipped API rate limit", services["api"]["environment"].get("OPENVERIFY_RATE_LIMIT_API_PER_MINUTE") == "300")
check("the images are the 11c-local tags", all(s.get("image", "").endswith(":11c-local") for n, s in services.items()
      if n in {"api", "worker", "migrate", "flow", "dashboard", "vision", "code-runner"}))
check("the worker's memory limit is 1536 MiB", int(services["worker"].get("mem_limit", 0)) == 1536 * 1024 * 1024)
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok  "*) ok "${line#ok   - }" ;;
    FAIL*) nok "${line#FAIL - }" ;;
  esac
done <<<"$live_out"
finish
