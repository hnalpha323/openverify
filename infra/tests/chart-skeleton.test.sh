#!/usr/bin/env bash
# Contract test for the Helm chart's frozen skeleton (Workflow 11C Stage 1a, contracts-11c; C263.1,
# C263.2, C264, OD-11C-1):
#
#   1. Chart.yaml: apiVersion v2, kubeVersion ">=1.35.0-0", the release's version, no dependency, a
#      description that claims nothing (C274.5's words never appear).
#   2. The chart-local .prettierrc.json is the root's options plus one override (templates/** need a
#      pragma, so Prettier never formats a Go template as YAML) and nothing else (rule 26).
#   3. values.yaml holds every frozen key, no secret value, the install switches off, no
#      flow.allowedFrameAncestors; values.schema.json is valid JSON Schema draft 7.
#   4. templates/_security.tpl defines every frozen helper name (chart-policy-11c fills them).
#   5. With Helm 4.3.1 and 3.22.1 (HELM4 and HELM3, or `helm` and `helm3` on PATH): `helm lint` and
#      `helm template` pass on the default values, and the schema refuses each bad value below.
#
# Usage: HELM4=<path> HELM3=<path> infra/tests/chart-skeleton.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
chart="$repo_root/deploy/helm/openverify"
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
tally() {
  while IFS= read -r line; do
    case "$line" in
      "ok   - "*) passed=$((passed + 1)); printf '%s\n' "$line" ;;
      "FAIL - "*) failed=$((failed + 1)); printf '%s\n' "$line" ;;
      *) [ -n "$line" ] && printf '%s\n' "$line" ;;
    esac
  done <<<"$1"
}

if [ -d "$chart" ]; then ok "deploy/helm/openverify exists"; else nok "deploy/helm/openverify exists"; finish; fi

static=$(python3 -I - "$repo_root" <<'PY'
import json
import re
import sys

import yaml

root = sys.argv[1]
chart = root + "/deploy/helm/openverify"


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


def load_yaml(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except (OSError, yaml.YAMLError) as exc:
        check(f"{path.removeprefix(root + '/')} parses", False, str(exc).replace("\n", " "))
        return None


meta = load_yaml(chart + "/Chart.yaml") or {}
check("Chart.yaml: apiVersion v2", meta.get("apiVersion") == "v2")
check("Chart.yaml: name openverify", meta.get("name") == "openverify")
check("Chart.yaml: kubeVersion >=1.35.0-0", meta.get("kubeVersion") == ">=1.35.0-0", str(meta.get("kubeVersion")))
check("Chart.yaml: version 0.1.0 and appVersion \"0.1.0\" (the release's version string)", meta.get("version") == "0.1.0" and meta.get("appVersion") == "0.1.0")
check("Chart.yaml: type application", meta.get("type") == "application")
check("Chart.yaml: no dependency (no subchart, no Bitnami)", "dependencies" not in meta)
description = str(meta.get("description", ""))
check("Chart.yaml: a description", len(description) > 40)
check("Chart.yaml: the description claims nothing", re.search(r"(?i)certif|complian|complies|guarantee", description) is None, description)

try:
    root_options = json.load(open(root + "/.prettierrc.json", encoding="utf-8"))
    local = json.load(open(chart + "/.prettierrc.json", encoding="utf-8"))
    expected = dict(root_options)
    expected["overrides"] = [{"files": "templates/**", "options": {"requirePragma": True}}]
    check("the chart-local .prettierrc.json is the root's options plus the templates override, nothing else", local == expected, json.dumps(local))
except (OSError, json.JSONDecodeError) as exc:
    check("the chart-local .prettierrc.json is the root's options plus the templates override, nothing else", False, str(exc))

values = load_yaml(chart + "/values.yaml") or {}

FROZEN = """
imagePullSecrets nameOverride fullnameOverride
install.mode install.connectEnabled install.watchlistUnOptInAllowed install.queueInFlightCapMax install.hstsMaxAge install.logLevel
publicUrls.api publicUrls.flow publicUrls.dashboard
external.postgres.existingSecret external.postgres.key external.postgres.migrationSecret external.postgres.migrationKey external.postgres.runtimeRole external.postgres.maxConnections external.postgres.ca
external.valkey.existingSecret external.valkey.key external.valkey.ca
external.s3.endpoint external.s3.region external.s3.bucket external.s3.forcePathStyle external.s3.existingSecret external.s3.ca
external.smtp.existingSecret external.smtp.key external.smtp.mailFrom
secrets.api.existingSecret secrets.api.keys secrets.worker.existingSecret secrets.worker.keys secrets.migrate.existingSecret secrets.migrate.keys
secrets.dashboard.existingSecret secrets.dashboard.keys secrets.flow.existingSecret secrets.flow.keys secrets.codeRunner.existingSecret secrets.codeRunner.keys secrets.vision.existingSecret secrets.vision.keys
ingress.enabled ingress.className ingress.hosts.api ingress.hosts.flow ingress.hosts.dashboard ingress.tls ingress.hsts.enabled ingress.hsts.maxAge ingress.hsts.includeSubDomains ingress.hsts.preload ingress.maxBodySize ingress.maxBodySizeImport ingress.maxBodySizeTransactionFile ingress.annotations gateway.httpRoute.enabled
networkPolicy.enabled networkPolicy.dns networkPolicy.dataStoresInCluster.enabled networkPolicy.publicInternetExcept networkPolicy.egress.webhooks networkPolicy.egress.providers networkPolicy.egress.listSyncs networkPolicy.egress.modelHosts networkPolicy.egress.dataStores networkPolicy.egress.smtp networkPolicy.egress.identityProviders
models.source models.existingClaim models.storageClass models.accessMode models.size
network.sourcesDisabled network.sourcesEnabled network.refresh ipReputation.existingClaim ipReputation.path
migrate.gitOps migrate.lockTimeoutSeconds migrate.activeDeadlineSeconds migrate.backoffLimit migrate.grantRuntime
api.trustProxy api.port api.internalListen.port api.handoffSendsPerHour api.console.idleTimeoutSeconds api.console.absoluteTimeoutSeconds api.ssoPrivateIssuers
worker.concurrency worker.heartbeatFile worker.extraContainers worker.extraVolumes worker.playIntegrity.packageName worker.playIntegrity.certificateDigests
dashboard.trustedProxyHops dashboard.port flow.port flow.trustedProxyHops vision.port codeRunner.enabled codeRunner.port codeRunner.poolSize
providers config.extra
""".split()
COMPONENT = "image.registry image.repository image.tag image.digest image.pullPolicy replicaCount resources autoscaling podDisruptionBudget topologySpreadConstraints priorityClassName nodeSelector tolerations affinity terminationGracePeriodSeconds extraEnv".split()
for component in ["api", "worker", "dashboard", "flow", "vision", "codeRunner"]:
    FROZEN += [f"{component}.{key}" for key in COMPONENT]
FROZEN += [f"{job}.image.{key}" for job in ["migrate", "modelsFetch"] for key in ["registry", "repository", "tag", "digest", "pullPolicy"]]


def lookup(tree, dotted):
    node = tree
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


missing = [key for key in FROZEN if not lookup(values, key)[0]]
check(f"values.yaml holds the {len(FROZEN)} frozen keys", missing == [], " ".join(missing[:20]))
check("install.connectEnabled is false (decision 71)", lookup(values, "install.connectEnabled")[1] is False)
check("install.watchlistUnOptInAllowed is true (Q10 granted 2026-11-21)", lookup(values, "install.watchlistUnOptInAllowed")[1] is True)
check("install.hstsMaxAge is 0 (HSTS comes from the ingress, C255.1)", lookup(values, "install.hstsMaxAge")[1] == 0)
check("network.refresh is false (no publisher called until the operator asks)", lookup(values, "network.refresh")[1] is False)
check("no flow.allowedFrameAncestors (C263.2)", not lookup(values, "flow.allowedFrameAncestors")[0])
check("migrate.activeDeadlineSeconds exceeds the lock's wait", (lookup(values, "migrate.activeDeadlineSeconds")[1] or 0) > (lookup(values, "migrate.lockTimeoutSeconds")[1] or 10**9))


def secret_values(node, path=""):
    if isinstance(node, dict):
        for key, child in node.items():
            yield from secret_values(child, f"{path}.{key}" if path else key)
    elif isinstance(node, str) and re.search(r"(?i)(password|secret|token|pepper|kek)$", path) and not path.endswith(("existingSecret", "migrationSecret")) and node:
        yield path


check("values.yaml holds no secret value", list(secret_values(values)) == [], ",".join(secret_values(values)))
check("no Secret is named by default (the operator's own Secrets only)", all(not lookup(values, f"secrets.{p}.existingSecret")[1] for p in ["api", "worker", "migrate", "dashboard", "flow", "codeRunner", "vision"]))

try:
    schema = json.load(open(chart + "/values.schema.json", encoding="utf-8"))
    check("values.schema.json parses", True)
    check("values.schema.json is draft 7 (Helm 3 and 4 both validate it)", schema.get("$schema") == "http://json-schema.org/draft-07/schema#")
    check("values.schema.json refuses unknown top-level keys", schema.get("additionalProperties") is False)
except (OSError, json.JSONDecodeError) as exc:
    check("values.schema.json parses", False, str(exc))

try:
    helpers = open(chart + "/templates/_security.tpl", encoding="utf-8").read()
    names = set(re.findall(r'\{\{-?\s*define\s+"([^"]+)"', helpers))
    expected_names = {
        "openverify.podSecurityContext",
        "openverify.containerSecurityContext",
        "openverify.tmpVolume",
        "openverify.tmpVolumeMount",
        "openverify.secretVolume",
        "openverify.secretVolumeMounts",
        "openverify.secretFileEnv",
        "openverify.caVolumes",
        "openverify.caVolumeMounts",
        "openverify.caFileEnv",
        "openverify.ingressAnnotations",
        "openverify.internalPathDeny",
        # chart-policy-11c's own two, shared by the Secret and CA helpers (its named borrowed edit).
        "openverify.secretSources",
        "openverify.caSources",
    }
    check("templates/_security.tpl defines the frozen helpers", names == expected_names, " ".join(sorted(names ^ expected_names)))
except OSError as exc:
    check("templates/_security.tpl defines the frozen helpers", False, str(exc))
PY
)
tally "$static"

# ------------------------------------------------------------- helm ----
helm_bin() {
  local var=$1 name=$2
  if [ -n "${!var:-}" ]; then printf '%s' "${!var}"; elif command -v "$name" >/dev/null 2>&1; then command -v "$name"; fi
}
bad_values=(
  "api.image.digest=sha256:not-a-digest|a digest that is not sha256:<64 hex>"
  "install.connectEnabled=yes|connectEnabled that is not a boolean"
  "install.queueInFlightCapMax=1001|a queue cap ceiling above 1,000"
  "migrate.lockTimeoutSeconds=3601|a lock wait above 3,600 s"
  "models.source=init|a models source other than job or pvc"
  "vision.replicaCount=2|two vision replicas on a ReadWriteOnce claim"
  "external.postgres.existingSecret=pg|an external data store without dataStores CIDRs while policies are on"
  "unknownTopLevel=1|an unknown top-level key"
)
for major in 4 3; do
  bin=$(helm_bin "HELM$major" "$([ "$major" = 4 ] && echo helm || echo helm3)")
  if [ -z "$bin" ]; then
    skip "Helm $major not installed (HELM$major unset); the chart checks run in the supply-chain job"
    continue
  fi
  version=$("$bin" version --template '{{.Version}}' 2>/dev/null)
  if out=$("$bin" lint "$chart" 2>&1); then ok "helm $version lint passes on the default values"; else nok "helm $version lint passes on the default values" "$(tail -n 5 <<<"$out" | tr '\n' ' ')"; fi
  if out=$("$bin" template smoke "$chart" 2>&1); then ok "helm $version template renders the default values"; else nok "helm $version template renders the default values" "$(tail -n 5 <<<"$out" | tr '\n' ' ')"; fi
  # Positive controls: the same rules pass once their condition is met.
  for good in "vision.replicaCount=2,models.accessMode=ReadWriteMany" \
    "external.postgres.existingSecret=pg,networkPolicy.egress.dataStores[0].cidr=192.0.2.10/32,networkPolicy.egress.dataStores[0].ports[0]=5432" \
    "external.postgres.existingSecret=pg,networkPolicy.dataStoresInCluster.enabled=true" \
    "external.postgres.existingSecret=pg,networkPolicy.enabled=false"; do
    if out=$("$bin" template smoke "$chart" --set "$good" 2>&1); then ok "helm $version: the schema accepts $good"; else nok "helm $version: the schema accepts $good" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi
  done
  for entry in "${bad_values[@]}"; do
    value=${entry%%|*}
    why=${entry#*|}
    if out=$("$bin" template smoke "$chart" --set "$value" 2>&1); then
      nok "helm $version: the schema refuses $why"
    elif grep -qi 'schema' <<<"$out"; then
      ok "helm $version: the schema refuses $why"
    else
      nok "helm $version: the schema refuses $why" "failed for another reason: $(tail -n 3 <<<"$out" | tr '\n' ' ')"
    fi
  done
done

finish
