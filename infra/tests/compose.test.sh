#!/usr/bin/env bash
# Contract test for infra/docker-compose.yml (OpenVerify local dev services).
#
# Static checks (always run):
#   - the expected services exist, images are pinned (no :latest),
#   - every long-running service has a healthcheck and a named volume,
#   - host ports are env-configurable and bound to loopback by default,
#   - secrets are required (compose refuses to render without them),
#   - .env.example contains placeholder secrets only and declares every app setting,
#   - profile 'app' (migrate, api, worker, vision, flow, dashboard): off by default, waits for
#     objectstore-init (and migrate), pinned image names, loopback ports, service-name wiring.
# Live checks (skipped with --static-only):
#   - `up -d --wait` succeeds and every long-running service reports healthy,
#   - the one-shot bucket init exited 0,
#   - functional probes: pgvector, authenticated Redis protocol, versioned bucket,
#     Mailpit readiness, every published host port accepts TCP,
#   - `down` (WITHOUT -v) keeps the named volumes.
#
# Usage: infra/tests/compose.test.sh [--static-only] [--keep-up]
# Env:   ENV_FILE  env file to use (default: <repo>/.env.example)
#        COMPOSE_TEST_PROJECT  the compose project the live checks start (default openverify-compose-test):
#        never the developer's `openverify` project, whose volumes hold their data (Workflow 11C rule 19;
#        integration-11c). The live half removes its own project's volumes at the end.
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
compose_file="$repo_root/infra/docker-compose.yml"
env_file="${ENV_FILE:-$repo_root/.env.example}"
static_only=false
keep_up=false
for arg in "$@"; do
  case "$arg" in
    --static-only) static_only=true ;;
    --keep-up) keep_up=true ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

long_running=(postgres redis objectstore mailpit)
named_volumes=(postgres-data redis-data objectstore-data mailpit-data)
project=openverify
live_project="${COMPOSE_TEST_PROJECT:-openverify-compose-test}"

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
expect_match() { # expect_match <description> <glob> <actual>
  # shellcheck disable=SC2254 # the glob is intentionally unquoted
  case "$3" in
    $2) ok "$1" ;;
    *) nok "$1" "expected match for '$2', got '$3'" ;;
  esac
}
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}
compose() { docker compose -f "$compose_file" --env-file "$env_file" "$@"; }
envval() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }

# ---------------------------------------------------------------- static ----
if [ -f "$compose_file" ]; then ok "infra/docker-compose.yml exists"; else nok "infra/docker-compose.yml exists"; finish; fi
if [ -f "$env_file" ]; then ok "env file exists ($env_file)"; else nok "env file exists ($env_file)"; finish; fi

if config=$(compose config --format json 2>&1); then
  ok "compose config renders with the env file"
else
  nok "compose config renders with the env file" "$config"
  finish
fi

has_service() { jq -e --arg s "$1" '.services[$s] != null' >/dev/null <<<"$config"; }
has_healthcheck() {
  jq -e --arg s "$1" '.services[$s].healthcheck as $h
    | ($h != null) and ($h.disable != true)
      and ($h.test | type == "array" and length > 1 and .[0] != "NONE")' >/dev/null <<<"$config"
}
has_named_volume() {
  jq -e --arg s "$1" '. as $root
    | [.services[$s].volumes[]? | select(.type == "volume") | .source] as $v
    | ($v | length > 0) and all($v[]; . as $n | ($root.volumes // {}) | has($n))' >/dev/null <<<"$config"
}
images_pinned() {
  jq -e '[.services[].image] | all(test(":[^:/]+$") and (test(":latest$") | not))' >/dev/null <<<"$config"
}
init_waits_for_healthy_store() {
  jq -e '.services["objectstore-init"].depends_on.objectstore.condition == "service_healthy"' >/dev/null <<<"$config"
}

expect_eq "compose project name is '$project'" "$project" "$(jq -r .name <<<"$config")"
for s in "${long_running[@]}" objectstore-init; do expect "service '$s' is defined" has_service "$s"; done
expect_eq "postgres runs pgvector/pgvector:pg17 by digest (C258.1)" "pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f" "$(jq -r .services.postgres.image <<<"$config")"
# C73.8 (P18): screening binds the subject's names as query parameters, so Postgres never logs
# bind parameters, not even with an error.
for setting in log_parameter_max_length=0 log_parameter_max_length_on_error=0; do
  expect "postgres starts with $setting" \
    jq -e --arg c "$setting" '.services.postgres.command | index($c) != null' <<<"$config"
done
expect "every image is pinned to an explicit, non-latest tag" images_pinned
for s in "${long_running[@]}"; do
  expect "service '$s' has a healthcheck" has_healthcheck "$s"
  expect "service '$s' persists to a named volume" has_named_volume "$s"
done
expect "objectstore-init waits for a healthy objectstore" init_waits_for_healthy_store
expect_eq "objectstore-init is one-shot (restart: no)" "no" "$(jq -r '.services["objectstore-init"].restart // "no"' <<<"$config")"

# Ports: defaults come from the env file, overrides from the shell environment.
published() { # published <service> <container-port> <config-json> -> "host_ip|published"
  jq -r --arg s "$1" --argjson t "$2" \
    '[.services[$s].ports[]? | select(.target == $t) | "\(.host_ip)|\(.published)"] | join(",")' <<<"$3"
}
bind=$(envval OPENVERIFY_BIND_ADDRESS)
expect_eq ".env.example binds dev services to loopback" "127.0.0.1" "$bind"
port_specs=(
  "postgres 5432 POSTGRES_PORT 15432"
  "redis 6379 REDIS_PORT 16379"
  "objectstore 9000 S3_PORT 19000"
  "objectstore 9001 S3_CONSOLE_PORT 19001"
  "mailpit 1025 MAILPIT_SMTP_PORT 11025"
  "mailpit 8025 MAILPIT_UI_PORT 18025"
)
override_env=()
for spec in "${port_specs[@]}"; do
  read -r _svc _target var alt <<<"$spec"
  override_env+=("$var=$alt")
done
if override_config=$(env "${override_env[@]}" docker compose -f "$compose_file" --env-file "$env_file" config --format json 2>&1); then
  for spec in "${port_specs[@]}"; do
    read -r svc target var alt <<<"$spec"
    default=$(envval "$var")
    expect_eq "$svc:$target publishes on $bind:\${$var} (default $default)" "$bind|$default" "$(published "$svc" "$target" "$config")"
    expect_eq "$svc:$target follows a $var override" "$bind|$alt" "$(published "$svc" "$target" "$override_config")"
  done
else
  nok "compose config renders with port overrides" "$override_config"
fi

# Secrets must be supplied explicitly; compose must refuse to render without them.
secret_vars=(POSTGRES_PASSWORD REDIS_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY)
unset_args=()
for v in "${secret_vars[@]}"; do unset_args+=(-u "$v"); done
if no_secrets=$(env "${unset_args[@]}" docker compose -f "$compose_file" --env-file /dev/null config 2>&1); then
  nok "compose refuses to render without secrets" "rendered successfully"
else
  expect_match "compose refuses to render without secrets" "*required*" "$no_secrets"
fi

# .env.example: every secret-like value is an obvious placeholder.
secret_lines=$(grep -E '^[A-Z0-9_]*(PASSWORD|SECRET|ACCESS_KEY|TOKEN)[A-Z0-9_]*=' "$env_file" || true)
if [ -z "$secret_lines" ]; then
  nok ".env.example declares the service secrets"
else
  ok ".env.example declares the service secrets"
  bad=$(grep -Ev '^[A-Z0-9_]+=change-me-[a-z0-9-]+$' <<<"$secret_lines" | cut -d= -f1 | tr '\n' ' ')
  expect_eq ".env.example secrets are change-me-* placeholders" "" "${bad% }"
fi
for v in "${secret_vars[@]}"; do
  expect_match ".env.example sets $v" "change-me-*" "$(envval "$v")"
done

# .env.example: every setting the API, worker, seed, flow build and dashboard read.
app_env_vars=(
  OPENVERIFY_MODE OPENVERIFY_LOG_LEVEL OPENVERIFY_API_HOST OPENVERIFY_API_PORT OPENVERIFY_TRUST_PROXY
  DATABASE_URL REDIS_URL S3_ENDPOINT S3_FORCE_PATH_STYLE OPENVERIFY_KEK OPENVERIFY_API_KEY_PEPPER
  # Phase 3 (C31.8): the blind index of identification numbers.
  OPENVERIFY_BLIND_INDEX_KEY
  OPENVERIFY_FLOW_PUBLIC_URL OPENVERIFY_FLOW_CORS_ORIGINS OPENVERIFY_VISION_URL
  OPENVERIFY_VISION_SERVICE_TOKEN OPENVERIFY_VISION_BRIGHTNESS_MIN OPENVERIFY_VISION_BRIGHTNESS_MAX
  OPENVERIFY_VISION_FACE_SCORE_THRESHOLD OPENVERIFY_WORKER_CONCURRENCY
  OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS OPENVERIFY_SEED_ADMIN_EMAIL OPENVERIFY_SEED_ADMIN_PASSWORD
  VITE_OPENVERIFY_API_URL OPENVERIFY_API_URL OPENVERIFY_FLOW_PORT OPENVERIFY_DASHBOARD_PORT
  # Phase 2 (C12, C15): rate limits, operator links, the BFF token, WebAuthn and invitation email.
  OPENVERIFY_RATE_LIMIT_API_PER_MINUTE OPENVERIFY_DASHBOARD_PUBLIC_URL OPENVERIFY_DASHBOARD_BFF_TOKEN
  OPENVERIFY_WEBAUTHN_RP_ID OPENVERIFY_WEBAUTHN_RP_NAME OPENVERIFY_WEBAUTHN_ORIGIN
  OPENVERIFY_SMTP_URL OPENVERIFY_MAIL_FROM
  # Workflow 2C (C21): how many proxies in front of the dashboard append X-Forwarded-For.
  OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS
  # Phase 5 (C55.7, C55.10, C57.5): the OTP SMS ceiling, Twilio and the EVM node URLs.
  OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING
  OPENVERIFY_TWILIO_ACCOUNT_SID OPENVERIFY_TWILIO_API_KEY_SID OPENVERIFY_TWILIO_API_KEY_SECRET
  OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID OPENVERIFY_TWILIO_FROM
  OPENVERIFY_EVM_RPC_URLS OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS
  # Phase 5 (C61.1, C62.7): the Companies House keys, the EDGAR contact and the trust-store flags.
  OPENVERIFY_COMPANIES_HOUSE_API_KEY OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY
  OPENVERIFY_SEC_EDGAR_USER_AGENT OPENVERIFY_NFC_ALLOW_ICAO_CRLS OPENVERIFY_TRUST_ANCHOR_REFRESH
)
# Phase 6 (C72.5, C76, C80, C81, C83): the report limits and the disabled sources (every process
# that runs reports), the list sync and PEP settings and each report adapter's credentials (the
# worker). The EU token is not here: .env.example leaves it commented out with no value.
report_env_vars=(
  OPENVERIFY_WATCHLIST_SOURCES_DISABLED OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE
  OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY
)
watchlist_sync_env_vars=(
  OPENVERIFY_WATCHLIST_REFRESH OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS
  OPENVERIFY_WIKIDATA_USER_AGENT OPENVERIFY_WIKIDATA_SPARQL_URL OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS
  OPENVERIFY_PEP_INCLUDE_RELATIVES OPENVERIFY_PEP_RETENTION_MONTHS OPENVERIFY_PEP_HEAD_RETENTION_MONTHS
)
report_credential_vars=(
  OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE OPENVERIFY_HIBP_API_KEY
  OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET OPENVERIFY_SMARTY_AUTH_ID OPENVERIFY_SMARTY_AUTH_TOKEN
)
app_env_vars+=("${report_env_vars[@]}" "${watchlist_sync_env_vars[@]}" "${report_credential_vars[@]}")
# Workflow 7A (C92.2, C92.5, C93.5, C96.3, C107.8): the network source lists (every process), the
# refresh tick (the worker only), the operator's anonymous-IP MMDB path and the handoff send budget.
network_env_vars=(OPENVERIFY_NETWORK_SOURCES_DISABLED OPENVERIFY_NETWORK_SOURCES_ENABLED)
app_env_vars+=("${network_env_vars[@]}" OPENVERIFY_NETWORK_REFRESH OPENVERIFY_IP_REPUTATION_MMDB_PATH
  OPENVERIFY_HANDOFF_SENDS_PER_HOUR)
# Workflow 8A (C143.8): the engine's install settings, read the same way by the API and the worker.
workflow_env_vars=(OPENVERIFY_WORKFLOW_CODE_ENABLED OPENVERIFY_WORKFLOW_CODE_RUNNER
  OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK OPENVERIFY_NAT64_PREFIXES OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP)
app_env_vars+=("${workflow_env_vars[@]}" OPENVERIFY_CLAMD_SOCKET)
# C35, C44, C63: each provider kind's binding per environment kind, and the process that reads it
# (apps/api/src/providers/index.ts PROCESS_PROVIDER_KINDS): the API reads sms, database and aamva;
# the worker every kind (sms since Workflow 8A, decision 76).
# C93.5 (Workflow 7A): ipReputation is read by both the API (session evaluation) and the worker.
# Stage 1b amendment 52: the API reads SLACK by name alone, to say whether a step can run.
# Workflow 8B (Stage 1b item 40): and ATTACHMENT_SCANNER by name alone, for the serving rules.
provider_kinds_api=(SMS DATABASE AAMVA IP_REPUTATION SLACK ATTACHMENT_SCANNER)
# C83 (Phase 6): the report provider kinds, bound by the worker only.
report_provider_kinds=(ADVERSE_MEDIA EMAIL_INTELLIGENCE PHONE_INTELLIGENCE ADDRESS_VERIFICATION CRYPTO_EXPOSURE)
# Workflow 8A (decision 76): the worker binds SMS too, for workflow messages.
provider_kinds_worker=(SMS DATABASE AAMVA PUBLIC_FIGURE AGE_ESTIMATE SELFIE_AGE_ESTIMATE SELFIE_PUBLIC_FIGURE
  SUSPICIOUS_ENTITY EVM_RPC BUSINESS_REGISTRY DOMAIN_AGE MALICIOUS_WEBSITE BACKLINK
  "${report_provider_kinds[@]}" IP_REPUTATION SLACK ATTACHMENT_SCANNER)
provider_kinds_all=("${provider_kinds_worker[@]}")
for kind in "${provider_kinds_all[@]}"; do
  app_env_vars+=("OPENVERIFY_PROVIDER_${kind}_SANDBOX" "OPENVERIFY_PROVIDER_${kind}_PRODUCTION")
done
# Phase 2 seed: one operator per built-in role, plus the TOTP-enrolled admin (seed:dev --mfa-admin).
seed_env_vars=(
  OPENVERIFY_SEED_ADMIN_EMAIL OPENVERIFY_SEED_ADMIN_PASSWORD
  OPENVERIFY_SEED_DEVELOPER_EMAIL OPENVERIFY_SEED_DEVELOPER_PASSWORD
  OPENVERIFY_SEED_REVIEWER_EMAIL OPENVERIFY_SEED_REVIEWER_PASSWORD
  OPENVERIFY_SEED_VIEWER_EMAIL OPENVERIFY_SEED_VIEWER_PASSWORD
  OPENVERIFY_SEED_MFA_ADMIN_EMAIL OPENVERIFY_SEED_MFA_ADMIN_PASSWORD
)
app_env_vars+=("${seed_env_vars[@]}")
# Workflow 9A (C157, C174.7): the flow server's token, its API URL and proxy hops, and the console's
# script policy mode.
app_env_vars+=(OPENVERIFY_FLOW_SERVER_TOKEN OPENVERIFY_FLOW_SERVER_API_URL
  OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS OPENVERIFY_DASHBOARD_CSP_MODE)
# Workflow 11A (C231.10, decision 71): the install switch for Connect, read by the API and the worker.
app_env_vars+=(OPENVERIFY_CONNECT_ENABLED)
for v in "${app_env_vars[@]}"; do
  expect ".env.example declares $v" grep -q "^$v=" "$env_file"
done
expect_eq ".env.example keeps webhooks off private networks" "false" "$(envval OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS)"
# C57.5, decision 22: the EVM node URLs stay public unless the operator says otherwise.
expect_eq ".env.example keeps the EVM RPC off private networks" "false" "$(envval OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS)"
expect_eq ".env.example sets the OTP SMS ceiling to its default" "1000" "$(envval OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING)"
# C63: a sandbox binding on a _PRODUCTION variable stops the process that reads it. Every
# _PRODUCTION variable is empty, so each kind keeps its default there: unbound, or GLEIF and RDAP
# for businessRegistry and domainAge (C61.1, C61.4).
sandbox_in_production=$(grep -E '^OPENVERIFY_PROVIDER_[A-Z_]+_PRODUCTION=.+' "$env_file" | cut -d= -f1 | tr '\n' ' ')
expect_eq ".env.example names no provider for production" "" "${sandbox_in_production% }"
for kind in SMS DATABASE EVM_RPC BUSINESS_REGISTRY DOMAIN_AGE MALICIOUS_WEBSITE BACKLINK SLACK \
  "${report_provider_kinds[@]}"; do
  expect_eq ".env.example binds the $kind sandbox provider in sandbox environments" "sandbox" \
    "$(envval "OPENVERIFY_PROVIDER_${kind}_SANDBOX")"
done
# The Twilio credentials are unset (sms is not bound to twilio); the secret is a placeholder.
for v in OPENVERIFY_TWILIO_ACCOUNT_SID OPENVERIFY_TWILIO_API_KEY_SID OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID \
  OPENVERIFY_TWILIO_FROM OPENVERIFY_EVM_RPC_URLS; do
  expect_eq ".env.example leaves $v empty" "" "$(envval "$v")"
done
# Decision 11: the EU token is never written, not even as a placeholder: it stays commented out.
expect ".env.example leaves OPENVERIFY_EU_FSF_TOKEN commented out without a value" \
  grep -qx '# OPENVERIFY_EU_FSF_TOKEN=' "$env_file"
expect ".env.example sets no OPENVERIFY_EU_FSF_TOKEN" bash -c "! grep -q '^OPENVERIFY_EU_FSF_TOKEN=' '$env_file'"
# Decision 7, C76.2, C80.1: GDELT is not acknowledged, the lists are never refreshed and no Wikidata
# contact is set until the operator says so.
expect_eq ".env.example does not acknowledge the GDELT disclosure" "false" "$(envval OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE)"
expect_eq ".env.example leaves the list refresh off" "false" "$(envval OPENVERIFY_WATCHLIST_REFRESH)"
# Workflow 7A: the network refresh tick is off, the sandbox environments bind the sandbox IP
# reputation (production stays unbound, above), no MMDB path is set, and the handoff send budget
# is its default (C92.2, C93.5, C96.3).
expect_eq ".env.example leaves the network refresh off" "false" "$(envval OPENVERIFY_NETWORK_REFRESH)"
expect_eq ".env.example binds the IP_REPUTATION sandbox provider in sandbox environments" "sandbox" \
  "$(envval OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX)"
expect_eq ".env.example leaves OPENVERIFY_IP_REPUTATION_MMDB_PATH empty" "" "$(envval OPENVERIFY_IP_REPUTATION_MMDB_PATH)"
expect_eq ".env.example sets the handoff send budget to its default" "200" "$(envval OPENVERIFY_HANDOFF_SENDS_PER_HOUR)"
# Workflow 11A (C231.10): a development install turns Connect on; compose keeps it off without it.
expect_eq ".env.example turns Connect on for development" "true" "$(envval OPENVERIFY_CONNECT_ENABLED)"
expect "compose keeps Connect off when the variable is unset" \
  grep -qF 'OPENVERIFY_CONNECT_ENABLED: ${OPENVERIFY_CONNECT_ENABLED:-false}' "$repo_root/infra/docker-compose.yml"
# Workflow 11B (Stage 1a amendment 25): every variable 11B adds is declared at today's behaviour:
# the UN opt-in locked (C254.1, rule 19), no previous pepper, no migration URL (C249.3: db:migrate
# falls back to DATABASE_URL), no CA file, the internal routes on the public listener, no HSTS.
for v in OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS \
  OPENVERIFY_API_KEY_PEPPER_PREVIOUS OPENVERIFY_SSO_PRIVATE_ISSUERS OPENVERIFY_POSTGRES_CA_FILE \
  OPENVERIFY_REDIS_CA_FILE OPENVERIFY_S3_CA_FILE OPENVERIFY_VISION_CA_FILE \
  OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS OPENVERIFY_WORKER_HEARTBEAT_FILE OPENVERIFY_INTERNAL_LISTEN \
  OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED OPENVERIFY_HSTS_MAX_AGE; do
  expect ".env.example declares $v" grep -q "^$v=" "$env_file"
  expect "compose hands $v to the processes that read it" grep -qF "$v: \${$v:-" "$repo_root/infra/docker-compose.yml"
done
# Q10 granted (2026-11-21; Workflow 11G records-11g): the documented default allows the opt-in, and
# each environment still needs an admin's audited acknowledgement (C254.1).
expect_eq ".env.example allows the UN opt-in (Q10 granted)" "true" "$(envval OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED)"
expect "compose allows the UN opt-in when the variable is unset (Q10 granted)" \
  grep -qF 'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: ${OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED:-true}' "$repo_root/infra/docker-compose.yml"
for v in OPENVERIFY_API_KEY_PEPPER_PREVIOUS OPENVERIFY_SSO_PRIVATE_ISSUERS OPENVERIFY_POSTGRES_CA_FILE \
  OPENVERIFY_REDIS_CA_FILE OPENVERIFY_S3_CA_FILE OPENVERIFY_VISION_CA_FILE OPENVERIFY_INTERNAL_LISTEN; do
  expect_eq ".env.example leaves $v empty" "" "$(envval "$v")"
done
expect_eq ".env.example sends no HSTS header" "0" "$(envval OPENVERIFY_HSTS_MAX_AGE)"
expect_eq ".env.example sets the queue cap ceiling to its default" "50" "$(envval OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX)"
expect_eq ".env.example sets the console idle limit to its default" "1800" "$(envval OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS)"
expect_eq ".env.example sets the console absolute limit to its default" "43200" "$(envval OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS)"
expect ".env.example names no migration URL" bash -c "! grep -q '^OPENVERIFY_MIGRATION_DATABASE_URL=' '$env_file'"
expect "compose hands migrate no migration URL" \
  bash -c "! grep -q 'OPENVERIFY_MIGRATION_DATABASE_URL' '$repo_root/infra/docker-compose.yml'"
for v in OPENVERIFY_WIKIDATA_USER_AGENT OPENVERIFY_HIBP_API_KEY OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID \
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID OPENVERIFY_SMARTY_AUTH_ID; do
  expect_eq ".env.example leaves $v empty" "" "$(envval "$v")"
done
# C61.1: a Companies House key or an EDGAR contact turns its register on, so none is set; C62.7:
# the trust store is never refreshed and ICAO PKD CRLs never fetched unless the operator says so.
for v in OPENVERIFY_COMPANIES_HOUSE_API_KEY OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY \
  OPENVERIFY_SEC_EDGAR_USER_AGENT; do
  expect_eq ".env.example leaves $v empty" "" "$(envval "$v")"
done
for v in OPENVERIFY_NFC_ALLOW_ICAO_CRLS OPENVERIFY_TRUST_ANCHOR_REFRESH; do
  expect_eq ".env.example sets $v to false" "false" "$(envval "$v")"
done
for v in OPENVERIFY_SEED_DEVELOPER_PASSWORD OPENVERIFY_SEED_REVIEWER_PASSWORD OPENVERIFY_SEED_VIEWER_PASSWORD \
  OPENVERIFY_SEED_MFA_ADMIN_PASSWORD OPENVERIFY_DASHBOARD_BFF_TOKEN OPENVERIFY_TWILIO_API_KEY_SECRET; do
  expect_match ".env.example sets $v to a change-me placeholder" "change-me-*" "$(envval "$v")"
done
# The API refuses a BFF token shorter than 32 characters, even in development.
bff_token=$(envval OPENVERIFY_DASHBOARD_BFF_TOKEN)
expect "the OPENVERIFY_DASHBOARD_BFF_TOKEN placeholder is at least 32 characters" test "${#bff_token}" -ge 32
# The API, the worker and vision each refuse a service token under 32 characters (C6), so an
# unedited copy of .env.example still starts vision.
vision_token=$(envval OPENVERIFY_VISION_SERVICE_TOKEN)
expect "the OPENVERIFY_VISION_SERVICE_TOKEN placeholder is at least 32 characters" test "${#vision_token}" -ge 32
# WebAuthn needs a domain as RP ID (never an IP), and the dashboard origin on that domain.
expect_eq ".env.example uses localhost as the WebAuthn RP ID" "localhost" "$(envval OPENVERIFY_WEBAUTHN_RP_ID)"
expect_eq ".env.example's WebAuthn origin is the dashboard URL" \
  "$(envval OPENVERIFY_DASHBOARD_PUBLIC_URL)" "$(envval OPENVERIFY_WEBAUTHN_ORIGIN)"

# App services (profile 'app'): built from this repository, off by default.
app_services=(migrate api worker vision flow dashboard)
if app_config=$(compose --profile app config --format json 2>&1); then
  ok "compose config renders with --profile app"
else
  nok "compose config renders with --profile app" "$app_config"
  app_config='{"services":{}}'
fi
app_has() { # app_has <service> <jq filter over the service as .>
  jq -e --arg s "$1" ".services[\$s] | $2" >/dev/null <<<"$app_config"
}
not_without_profile() { jq -e --arg s "$1" '.services[$s] == null' >/dev/null <<<"$config"; }
for s in "${app_services[@]}"; do
  expect "app service '$s' is in profile 'app'" app_has "$s" '(.profiles // []) | index("app") != null'
  expect "app service '$s' is not started without the profile" not_without_profile "$s"
  expect "app service '$s' waits for objectstore-init to succeed" \
    app_has "$s" '.depends_on["objectstore-init"].condition == "service_completed_successfully"'
  expect "app service '$s' has a pinned, non-latest image name" \
    app_has "$s" '(.image // "") | test(":[^:/]+$") and (test(":latest$") | not)'
done
for s in api worker; do
  expect "app service '$s' waits for migrate to succeed" \
    app_has "$s" '.depends_on.migrate.condition == "service_completed_successfully"'
done
expect_eq "migrate is one-shot (restart: no)" "no" "$(jq -r '.services.migrate.restart // "no"' <<<"$app_config")"
# C123.3 (P17): in this profile code runs in its own container, reached over a shared volume.
expect "app service 'code-runner' is in profile 'app'" app_has code-runner '(.profiles // []) | index("app") != null'
expect "app service 'code-runner' is not started without the profile" not_without_profile code-runner
expect "worker waits for the code runner to be healthy" \
  app_has worker '.depends_on["code-runner"].condition == "service_healthy"'
expect "worker shares the code runner's socket volume" \
  app_has worker '[.volumes[]? | select(.target == "/run/code-runner") | .source] == ["code-runner-socket"]'
expect_eq "worker reaches code through the socket, never the in-process pool" \
  "socket:/run/code-runner/code-runner.sock" \
  "$(jq -r '.services.worker.environment.OPENVERIFY_WORKFLOW_CODE_RUNNER' <<<"$app_config")"
# Phase 11, Workflow 11C (C257.3, images-11c): the app profile runs the five production images,
# each built from its own Dockerfile and tagged 11c-local, read-only with a tmpfs /tmp; migrate and
# seed:dev run the API image's compiled commands; the API's healthcheck reads /ready and the
# worker's runs its exec probe (orchestrator decision 20); the flow server reads the API's URL at
# start (C257.1); no service builds the retired development image.
image_specs=(
  "migrate openverify/api:11c-local infra/docker/api.Dockerfile"
  "api openverify/api:11c-local infra/docker/api.Dockerfile"
  "worker openverify/api:11c-local infra/docker/api.Dockerfile"
  "flow openverify/flow:11c-local infra/docker/flow.Dockerfile"
  "dashboard openverify/dashboard:11c-local infra/docker/dashboard.Dockerfile"
  "code-runner openverify/code-runner:11c-local infra/docker/code-runner.Dockerfile"
)
for spec in "${image_specs[@]}"; do
  read -r s image dockerfile <<<"$spec"
  expect_eq "$s runs $image" "$image" "$(jq -r --arg s "$s" '.services[$s].image' <<<"$app_config")"
  expect_eq "$s builds $dockerfile from the repository root" "$repo_root|$dockerfile" \
    "$(jq -r --arg s "$s" '.services[$s].build | "\(.context)|\(.dockerfile)"' <<<"$app_config")"
done
expect_eq "vision runs openverify/vision:11c-local" "openverify/vision:11c-local" "$(jq -r '.services.vision.image' <<<"$app_config")"
expect "vision's build takes the repository root as the named context repo" \
  app_has vision '.build.additional_contexts.repo != null and (.build.context | endswith("/services/vision"))'
expect "no service builds infra/docker/apps.Dockerfile" \
  jq -e '[.services[] | .build.dockerfile? // empty | select(test("apps\\.Dockerfile"))] | length == 0' <<<"$app_config"
expect "no service passes VITE_OPENVERIFY_API_URL as a build argument (C257.1)" \
  jq -e '[.services[] | .build.args? // {} | has("VITE_OPENVERIFY_API_URL")] | any | not' <<<"$app_config"
for s in migrate api worker flow dashboard; do
  expect "$s runs read-only with a tmpfs /tmp" \
    app_has "$s" '.read_only == true and ((.tmpfs // []) | map(split(":")[0]) | index("/tmp") != null)'
done
expect_eq "migrate runs the compiled db:migrate" "node dist/commands/db-migrate.js" \
  "$(jq -r '.services.migrate.command | join(" ")' <<<"$app_config")"
expect_eq "api runs dist/server.js" "node dist/server.js" "$(jq -r '.services.api.command | join(" ")' <<<"$app_config")"
expect_eq "worker runs dist/worker.js" "node dist/worker.js" "$(jq -r '.services.worker.command | join(" ")' <<<"$app_config")"
expect "api's healthcheck reads /ready (C250.1)" \
  app_has api '.healthcheck.test | join(" ") | test("127\\.0\\.0\\.1:3000/ready")'
expect_eq "worker's healthcheck is its exec probe (C250.2)" "CMD node dist/worker-health.js" \
  "$(jq -r '.services.worker.healthcheck.test | join(" ")' <<<"$app_config")"
expect "flow reads the API's URL at start (OPENVERIFY_FLOW_API_URL, C257.1)" \
  app_has flow '.environment | has("OPENVERIFY_FLOW_API_URL")'
expect "the header names seed:dev's compiled command" \
  grep -qF 'run --rm migrate node dist/commands/seed-dev.js' "$repo_root/infra/docker-compose.yml"
for s in api vision flow dashboard; do
  expect "app service '$s' has a healthcheck" \
    app_has "$s" '.healthcheck.test | type == "array" and length > 1 and .[0] != "NONE"'
done
# C41.4 (Phase 4): ONNX Runtime's Linux builds send Microsoft telemetry unless this is set.
expect "vision turns ONNX Runtime telemetry off (ORT_DISABLE_TELEMETRY=1)" \
  app_has vision '(.environment.ORT_DISABLE_TELEMETRY // "") == "1"'
expect "vision mounts ./models read-only at /models" \
  app_has vision '[.volumes[]? | select(.target == "/models" and .read_only == true and (.source | endswith("/models")))] | length == 1'
for s in migrate worker vision; do
  expect "app service '$s' publishes no host port" app_has "$s" '(.ports // []) | length == 0'
done
expect "api reaches postgres, valkey, the objectstore and vision by service name" \
  app_has api '.environment | (.DATABASE_URL | contains("@postgres:5432/")) and (.REDIS_URL | contains("@redis:6379"))
    and .S3_ENDPOINT == "http://objectstore:9000" and .OPENVERIFY_VISION_URL == "http://vision:8000"'
worker_shares_api_infra() {
  jq -e '.services.api.environment as $api | .services.worker.environment
    | (.DATABASE_URL == $api.DATABASE_URL) and (.REDIS_URL == $api.REDIS_URL)
      and (.S3_ENDPOINT == $api.S3_ENDPOINT) and (.OPENVERIFY_KEK == $api.OPENVERIFY_KEK)
      and (.OPENVERIFY_BLIND_INDEX_KEY == $api.OPENVERIFY_BLIND_INDEX_KEY)
      and (.DATABASE_URL != null)' >/dev/null <<<"$app_config"
}
expect "api reads the blind index key (C31.8)" \
  app_has api '.environment.OPENVERIFY_BLIND_INDEX_KEY != null'
expect "worker reads the same infrastructure settings as the api" worker_shares_api_infra
expect "dashboard calls the api over the compose network" app_has dashboard '.environment.OPENVERIFY_API_URL == "http://api:3000"'
# C21: the custom server records each request's socket peer before Next.js sees it; `next start`
# would lose it. The BFF proves itself to the API with the shared token.
expect "dashboard runs the custom server, not next start" \
  app_has dashboard '(.command | index("server.ts") != null) and (.command | index("next") == null)'
expect "dashboard listens on 0.0.0.0:3000 inside its container" \
  app_has dashboard '(.command | join(" ") | test("--hostname 0\\.0\\.0\\.0 --port 3000$"))'
expect "dashboard sends the same BFF token the api checks" \
  jq -e '.services.dashboard.environment.OPENVERIFY_DASHBOARD_BFF_TOKEN == .services.api.environment.OPENVERIFY_DASHBOARD_BFF_TOKEN
    and (.services.dashboard.environment.OPENVERIFY_DASHBOARD_BFF_TOKEN | length) >= 32' <<<"$app_config"
# C157.2, C174.7 (Workflow 9A): the API and the flow server share the flow server's token, a
# change-me placeholder of at least 32 bytes in .env.example, and only the commented-out previous one.
flow_server_token=$(envval OPENVERIFY_FLOW_SERVER_TOKEN)
expect_match ".env.example sets OPENVERIFY_FLOW_SERVER_TOKEN to a change-me placeholder" "change-me-*" "$flow_server_token"
expect "the OPENVERIFY_FLOW_SERVER_TOKEN placeholder is at least 32 bytes" test "${#flow_server_token}" -ge 32
expect ".env.example leaves OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS commented out" \
  bash -c "! grep -q '^OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS=' '$env_file' && grep -q '^# OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS=' '$env_file'"
expect "the flow server sends the token the api checks" \
  jq -e '.services.flow.environment.OPENVERIFY_FLOW_SERVER_TOKEN == .services.api.environment.OPENVERIFY_FLOW_SERVER_TOKEN
    and (.services.api.environment.OPENVERIFY_FLOW_SERVER_TOKEN | length) >= 32' <<<"$app_config"
expect "the flow server reaches the api over the compose network" \
  app_has flow '.environment.OPENVERIFY_FLOW_SERVER_API_URL == "http://api:3000"'
expect "the dashboard reads the flow origin and its script policy mode" \
  app_has dashboard '.environment.OPENVERIFY_FLOW_PUBLIC_URL != null and .environment.OPENVERIFY_DASHBOARD_CSP_MODE == "enforce"'
expect "dashboard reads OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS from the env file" \
  jq -e --arg want "$(envval OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS)" \
  '.services.dashboard.environment.OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS == $want' <<<"$app_config"
# Phase 2: invitations go to Mailpit over the compose network; the operator settings reach the API.
expect "api sends invitation email through mailpit" \
  app_has api '.environment.OPENVERIFY_SMTP_URL == "smtp://mailpit:1025"'
expect "api waits for a healthy mailpit" app_has api '.depends_on.mailpit.condition == "service_healthy"'
for v in OPENVERIFY_RATE_LIMIT_API_PER_MINUTE OPENVERIFY_DASHBOARD_PUBLIC_URL OPENVERIFY_DASHBOARD_BFF_TOKEN \
  OPENVERIFY_WEBAUTHN_RP_ID OPENVERIFY_WEBAUTHN_RP_NAME OPENVERIFY_WEBAUTHN_ORIGIN OPENVERIFY_MAIL_FROM; do
  expect "api reads $v from the env file" \
    jq -e --arg v "$v" --arg want "$(envval "$v" | sed 's/^"//; s/"$//')" \
    '.services.api.environment[$v] == $want' <<<"$app_config"
done
for v in "${seed_env_vars[@]}"; do
  expect "migrate passes $v to seed:dev" app_has migrate ".environment | has(\"$v\")"
done
# C63 (P25): each service receives only the settings and secrets of its own process: Twilio and
# the OTP ceiling to the API; the EVM node URLs, the Companies House keys, the EDGAR contact and
# the trust-store flags to the worker; each provider kind to the process that reads it.
receives() { # receives <service> <variable>
  jq -e --arg s "$1" --arg v "$2" '.services[$s].environment | has($v)' >/dev/null <<<"$app_config"
}
receives_none() { # receives_none <service> <variable regex>
  jq -e --arg s "$1" --arg re "$2" \
    '[.services[$s].environment | keys[] | select(test($re))] | length == 0' >/dev/null <<<"$app_config"
}
for v in OPENVERIFY_TWILIO_ACCOUNT_SID OPENVERIFY_TWILIO_API_KEY_SID OPENVERIFY_TWILIO_API_KEY_SECRET \
  OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID OPENVERIFY_TWILIO_FROM OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING; do
  expect "api receives $v" receives api "$v"
done
for v in OPENVERIFY_EVM_RPC_URLS OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS \
  OPENVERIFY_COMPANIES_HOUSE_API_KEY OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY \
  OPENVERIFY_SEC_EDGAR_USER_AGENT OPENVERIFY_NFC_ALLOW_ICAO_CRLS OPENVERIFY_TRUST_ANCHOR_REFRESH; do
  expect "worker receives $v" receives worker "$v"
done
# C62.7, C66 (owner decision 6 after Workflow 5B, K10): the trust-anchors route reports whether the
# refresh job runs and whether ICAO PKD CRLs are allowed, so the API reads both flags too, from the
# same variables and defaults as the worker. Neither is a secret.
for v in OPENVERIFY_NFC_ALLOW_ICAO_CRLS OPENVERIFY_TRUST_ANCHOR_REFRESH; do
  expect "api receives $v" receives api "$v"
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
# C143.8, C126.6 (Workflow 8A, decision 76; amends C83 and decision 32 for workflow messages only):
# workflow messages are sent from the worker, where the engine runs, so it now reads the SMS binding,
# Twilio's credentials and the SMTP settings too, the same way as the API. migrate still reads none.
for v in OPENVERIFY_TWILIO_ACCOUNT_SID OPENVERIFY_TWILIO_API_KEY_SID OPENVERIFY_TWILIO_API_KEY_SECRET \
  OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID OPENVERIFY_TWILIO_FROM \
  OPENVERIFY_PROVIDER_SMS_SANDBOX OPENVERIFY_PROVIDER_SMS_PRODUCTION \
  OPENVERIFY_SMTP_URL OPENVERIFY_MAIL_FROM; do
  expect "worker receives $v" receives worker "$v"
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
expect "worker receives OPENVERIFY_CLAMD_SOCKET" receives worker OPENVERIFY_CLAMD_SOCKET
# Amended by Stage 1b amendment 52: the API reads the two Slack names, never a credential, so the
# catalogue and publish can say whether a Slack step runs. Amended again by Workflow 8B (Stage 1b
# item 40, C135.5): the API reads the two scanner names alone, to apply the serving rules (only
# `clean` served while a scanner is bound); the clamd socket stays the worker's.
expect "api receives no clamd setting" receives_none api '^OPENVERIFY_CLAMD'
for v in OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION; do
  expect "api receives $v" receives api "$v"
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
expect "api receives the Slack binding's name" receives api OPENVERIFY_PROVIDER_SLACK_SANDBOX
# C211.1, C211.4 (Workflow 10B; integration-10b): deviceIntegrity is read by both processes, the API
# to say whether the session asks for a token and the worker to decode it, the same way; Play
# Integrity's settings (the service account key a secret) are the worker's alone.
for v in OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION; do
  expect ".env.example declares $v" grep -q "^$v=" "$env_file"
  expect "api receives $v" receives api "$v"
  expect "worker receives $v" receives worker "$v"
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
for v in OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS \
  OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON; do
  expect ".env.example declares $v" grep -q "^$v=" "$env_file"
  expect "worker receives $v" receives worker "$v"
done
expect "api receives no Play Integrity setting" receives_none api '^OPENVERIFY_PLAY_INTEGRITY_'
expect "migrate receives no Play Integrity setting" receives_none migrate '^OPENVERIFY_PLAY_INTEGRITY_'
# C208.1 (Workflow 10C; integration-10c): the sandbox test chip's fixture faces are never in an image,
# so no service is handed their directory; .env.example names the variable, commented out and empty.
for service in api worker migrate; do
  expect "$service receives no sandbox-chip faces directory" receives_none "$service" '^OPENVERIFY_SANDBOX_CHIP_FACES$'
done
expect ".env.example names OPENVERIFY_SANDBOX_CHIP_FACES, commented out" \
  grep -q '^# OPENVERIFY_SANDBOX_CHIP_FACES=$' "$env_file"
expect ".env.example never sets OPENVERIFY_SANDBOX_CHIP_FACES" \
  sh -c '! grep -q "^OPENVERIFY_SANDBOX_CHIP_FACES=" "$1"' sh "$env_file"
expect "migrate receives no Twilio SMS setting" receives_none migrate \
  '^OPENVERIFY_TWILIO_(ACCOUNT_SID|API_KEY_SID|API_KEY_SECRET|MESSAGING_SERVICE_SID|FROM)$'
for v in "${workflow_env_vars[@]}"; do
  expect "api receives $v" receives api "$v"
  expect "worker receives $v" receives worker "$v"
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
for v in "${report_credential_vars[@]}" "${watchlist_sync_env_vars[@]}" OPENVERIFY_EU_FSF_TOKEN; do
  expect "worker receives $v" receives worker "$v"
done
for s in api migrate; do
  expect "$s receives no report adapter credential" receives_none "$s" \
    '^OPENVERIFY_(TWILIO_LOOKUP|HIBP|SMARTY|GDELT)_'
  expect "$s receives no list sync setting or the EU token" receives_none "$s" \
    '^OPENVERIFY_(EU_FSF|WIKIDATA|PEP)_|^OPENVERIFY_WATCHLIST_(REFRESH|REMOVED_RETENTION_DAYS)$'
done
# C72.5, C76.4: every process that runs reports reads the limits and the disabled sources the same way.
for v in "${report_env_vars[@]}"; do
  for s in api worker migrate; do
    expect "$s receives $v" receives "$s" "$v"
  done
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
for s in api migrate; do
  expect "$s receives no EVM RPC setting" receives_none "$s" '^OPENVERIFY_EVM_RPC_'
  expect "$s receives no register credential" receives_none "$s" '^OPENVERIFY_(COMPANIES_HOUSE|SEC_EDGAR)_'
done
expect "migrate receives no trust-store setting" receives_none migrate '^OPENVERIFY_(NFC|TRUST_ANCHOR)_'
# Workflow 7A (C92.5): the API, the worker and migrate (seed:dev) read the network source lists the
# same way; only the worker runs the refresh tick (C92.2); the MMDB path goes to the two processes
# that bind ipReputation (C93.5), never to migrate; only the API sends handoff links (C96.3).
for v in "${network_env_vars[@]}"; do
  for s in api worker migrate; do
    expect "$s receives $v" receives "$s" "$v"
  done
  expect_eq "api and worker read $v the same way" \
    "$(jq -r --arg v "$v" '.services.worker.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
  expect_eq "migrate reads $v as the api does" \
    "$(jq -r --arg v "$v" '.services.migrate.environment[$v]' <<<"$app_config")" \
    "$(jq -r --arg v "$v" '.services.api.environment[$v]' <<<"$app_config")"
done
expect "worker receives OPENVERIFY_NETWORK_REFRESH" receives worker OPENVERIFY_NETWORK_REFRESH
for s in api migrate; do
  expect "$s does not receive OPENVERIFY_NETWORK_REFRESH" receives_none "$s" '^OPENVERIFY_NETWORK_REFRESH$'
done
for s in api worker; do
  expect "$s receives OPENVERIFY_IP_REPUTATION_MMDB_PATH" receives "$s" OPENVERIFY_IP_REPUTATION_MMDB_PATH
  expect "$s mounts ../data/ip-reputation read-only at /var/lib/openverify/ip-reputation" \
    app_has "$s" '[.volumes[]? | select(.target == "/var/lib/openverify/ip-reputation" and .read_only == true
      and (.source | endswith("/data/ip-reputation")))] | length == 1'
done
expect "migrate receives no MMDB path" receives_none migrate '^OPENVERIFY_IP_REPUTATION_'
expect "migrate mounts no IP reputation file" \
  app_has migrate '[.volumes[]? | select(.target == "/var/lib/openverify/ip-reputation")] | length == 0'
expect "api receives OPENVERIFY_HANDOFF_SENDS_PER_HOUR" receives api OPENVERIFY_HANDOFF_SENDS_PER_HOUR
for s in worker migrate; do
  expect "$s does not receive OPENVERIFY_HANDOFF_SENDS_PER_HOUR" receives_none "$s" '^OPENVERIFY_HANDOFF_SENDS_PER_HOUR$'
done
for s in api worker; do
  expect "$s receives OPENVERIFY_CONNECT_ENABLED" receives "$s" OPENVERIFY_CONNECT_ENABLED
done
expect "migrate receives no provider binding" receives_none migrate '^OPENVERIFY_PROVIDER_'
for kind in "${provider_kinds_all[@]}"; do
  for process in api worker; do
    kinds_var="provider_kinds_${process}[@]"
    reads=false
    for k in "${!kinds_var}"; do [ "$k" = "$kind" ] && reads=true; done
    for env_kind in SANDBOX PRODUCTION; do
      v="OPENVERIFY_PROVIDER_${kind}_${env_kind}"
      if $reads; then
        expect "$process receives $v" receives "$process" "$v"
      else
        expect "$process does not receive $v" receives_none "$process" "^${v}\$"
      fi
    done
  done
done
app_port_specs=(
  "api 3000 OPENVERIFY_API_PORT 13000"
  "flow 4173 OPENVERIFY_FLOW_PORT 14173"
  "dashboard 3000 OPENVERIFY_DASHBOARD_PORT 13001"
)
app_override_env=()
for spec in "${app_port_specs[@]}"; do
  read -r _svc _target var alt <<<"$spec"
  app_override_env+=("$var=$alt")
done
if app_override=$(env "${app_override_env[@]}" docker compose -f "$compose_file" --env-file "$env_file" --profile app config --format json 2>&1); then
  for spec in "${app_port_specs[@]}"; do
    read -r svc target var alt <<<"$spec"
    default=$(envval "$var")
    expect_eq "$svc:$target publishes on $bind:\${$var} (default $default)" "$bind|$default" "$(published "$svc" "$target" "$app_config")"
    expect_eq "$svc:$target follows a $var override" "$bind|$alt" "$(published "$svc" "$target" "$app_override")"
  done
else
  nok "compose config renders --profile app with port overrides" "$app_override"
fi

if $static_only; then finish; fi

# ------------------------------------------------------------------ live ----
# The live checks run as a project of their own, never the developer's (the file names `openverify`).
if [ "$live_project" = "$project" ]; then
  nok "the live checks run as their own compose project" "COMPOSE_TEST_PROJECT must not be '$project'"
  finish
fi
compose() { docker compose -p "$live_project" -f "$compose_file" --env-file "$env_file" "$@"; }
trap 'compose down --volumes >/dev/null 2>&1' INT TERM
if up_out=$(compose up -d --wait --wait-timeout 240 2>&1); then
  ok "compose up -d --wait succeeds"
else
  nok "compose up -d --wait succeeds" "$(tail -n 5 <<<"$up_out" | tr '\n' ' ')"
fi

health() {
  local id
  id=$(compose ps -q "$1" 2>/dev/null)
  [ -n "$id" ] || { echo "not-running"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$id"
}
for s in "${long_running[@]}"; do expect_eq "service '$s' is healthy" "healthy" "$(health "$s")"; done

# `up --wait` does not wait for one-shot jobs that nothing depends on, so poll until it exits.
init_state=""
for _ in $(seq 1 60); do
  init_state=$(compose ps -a --format json objectstore-init 2>/dev/null | jq -rs 'map("\(.State) \(.ExitCode)") | join(",")')
  case "$init_state" in exited*) break ;; esac
  sleep 1
done
expect_eq "objectstore-init ran once and exited 0" "exited 0" "$init_state"

pg_user=$(envval POSTGRES_USER)
pg_db=$(envval POSTGRES_DB)
psql_q() { compose exec -T postgres psql -U "$pg_user" -d "$pg_db" -tAc "$1" 2>&1 | tr -d '\r'; }
expect_eq "pgvector extension is installed" "vector" "$(psql_q "select extname from pg_extension where extname = 'vector'")"
expect_eq "pgvector computes an L2 distance" "1" "$(psql_q "select '[1,2,3]'::vector <-> '[1,2,4]'::vector")"
expect_eq "postgres logs no bind parameter (C73.8)" "0|0" \
  "$(psql_q "select current_setting('log_parameter_max_length') || '|' || current_setting('log_parameter_max_length_on_error')")"

expect_eq "redis answers PONG to an authenticated client" "PONG" "$(compose exec -T redis valkey-cli ping 2>&1 | tr -d '\r')"
expect_match "redis rejects unauthenticated clients" "*NOAUTH*" \
  "$(compose exec -T redis sh -c 'unset REDISCLI_AUTH VALKEYCLI_AUTH; valkey-cli ping' 2>&1)"

bucket=$(envval S3_BUCKET)
expect_eq ".env.example names the bucket openverify-files" "openverify-files" "$bucket"
versioning=$(compose run --rm --no-deps -T --entrypoint aws objectstore-init \
  s3api get-bucket-versioning --bucket "$bucket" --query Status --output text 2>/dev/null | tr -d '\r')
expect_eq "bucket '$bucket' has versioning Enabled" "Enabled" "$versioning"

expect "objectstore readiness endpoint answers on the host port" \
  curl -fsS --max-time 5 "http://$bind:$(envval S3_PORT)/health/ready"
expect "mailpit readiness endpoint answers on the host port" \
  curl -fsS --max-time 5 "http://$bind:$(envval MAILPIT_UI_PORT)/readyz"
for spec in "${port_specs[@]}"; do
  read -r svc target var _alt <<<"$spec"
  port=$(envval "$var")
  expect "host port $bind:$port ($svc:$target) accepts TCP" timeout 5 bash -c "exec 3<>/dev/tcp/$bind/$port"
done

if $keep_up; then finish; fi

# ------------------------------------------------------------- teardown ----
if down_out=$(compose down 2>&1); then ok "compose down (volumes kept) succeeds"; else nok "compose down (volumes kept) succeeds" "$down_out"; fi
trap - INT TERM
volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$live_project")
for v in "${named_volumes[@]}"; do
  expect_match "volume ${live_project}_$v survives down" "*${live_project}_$v*" "$volumes"
done
# The test project's own volumes go now that their survival is shown.
if cleanup_out=$(compose down --volumes 2>&1); then ok "the test project's volumes are removed"; else nok "the test project's volumes are removed" "$cleanup_out"; fi

finish
