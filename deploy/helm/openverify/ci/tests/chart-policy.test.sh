#!/usr/bin/env bash
# Render-wide contract test for the chart's security (Workflow 11C chart-policy-11c; C264.1-C264.5,
# C265.2), beside the helm-unittest suites, over every values set chart-checks.sh renders and the
# models modes:
#
#   1. the names each process may hold in its Secret (openverify.secretSources in templates/_security.tpl)
#      are the configuration registry's secrets of that process (apps/api/src/config-registry.ts,
#      `processes`), less the data stores' variables, which come from external.<store>;
#   2. every pod of every set is restricted (pod and container contexts, no service-account token, only
#      the restricted profile's volume types), every Secret volume is mode 0440 under the pod's fsGroup;
#   3. no set renders a Secret, a static frame-ancestors, or the IP-reputation claim outside the API and
#      the worker (read-only there);
#   4. vision's and the runner's policies have no egress in every set.
#
# Usage: deploy/helm/openverify/ci/tests/chart-policy.test.sh   (CHART_DIR=<copy> to test a copy;
# HELM, default ~/.local/bin/helm)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
chart=${CHART_DIR:-$repo_root/deploy/helm/openverify}
helm=${HELM:-$HOME/.local/bin/helm}
passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed, 0 skipped\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}
if [ -x "$helm" ]; then ok "Helm is installed ($helm)"; else nok "Helm is installed" "infra/scripts/install-helm.sh"; finish; fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
n=0
render() {
  n=$((n + 1))
  if "$helm" template openverify "$chart" --namespace openverify "$@" >"$work/$n.yaml" 2>"$work/$n.err"; then
    printf '%s\n' "$*" >"$work/$n.label"
  else
    nok "renders with ${*:-the defaults}" "$(tail -n 2 "$work/$n.err" | tr '\n' ' ')"
  fi
}
render
render -f "$chart/ci/kind-values.yaml"
render -f "$chart/ci/kind-values.yaml" -f "$chart/ci/upgrade/kind-upgrade-values.yaml"
render -f "$chart/ci/lint/full-values.yaml"
render -f "$chart/ci/lint/full-values.yaml" --set models.source=pvc --set models.existingClaim=ov-models
render -f "$chart/ci/lint/full-values.yaml" --set codeRunner.enabled=false --set migrate.gitOps=false

out=$(python3 -I - "$repo_root" "$chart" "$work" <<'PY'
import glob
import os
import re
import sys

import yaml

root, chart, work = sys.argv[1:4]


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


# 1. The registry and the helper.
registry = open(root + "/apps/api/src/config-registry.ts", encoding="utf-8").read()
process_of = {"api": "api", "worker": "worker", "migrate": "migrate", "dashboard": "dashboard",
              "flow": "flow", "code-runner": "codeRunner", "vision": "vision"}
stores = {"DATABASE_URL", "OPENVERIFY_MIGRATION_DATABASE_URL", "REDIS_URL", "S3_SECRET_ACCESS_KEY",
          "S3_ACCESS_KEY_ID", "OPENVERIFY_SMTP_URL"}
expected = {p: set() for p in process_of.values()}
for name, secret, processes in re.findall(
        r"name: '([^']+)',[\s\S]*?secret: (true|false),[\s\S]*?processes: \[([^\]]*)\]", registry):
    if secret != "true" or "{" in name or name in stores:
        continue
    for process in re.findall(r"'([a-z-]+)'", processes):
        expected[process_of[process]].add(name)
helpers = open(chart + "/templates/_security.tpl", encoding="utf-8").read()
reads = re.search(r"\$reads := dict(.*?)-\}\}", helpers, re.S)
actual = {}
if reads:
    for process, names in re.findall(r'"(\w+)" \(list ([^)]*)\)', reads.group(1)):
        actual[process] = set(re.findall(r'"([A-Z0-9_]+)"', names))
for process in sorted(expected):
    check(f"secrets.{process}.keys may hold exactly the registry's secrets of that process",
          actual.get(process) == expected[process],
          " ".join(sorted((actual.get(process) or set()) ^ expected[process])))
check("migrate may also hold the seeded operators' passwords (the registry's pattern entry)",
      "OPENVERIFY_SEED_{ROLE}_PASSWORD" in registry and "^OPENVERIFY_SEED_[A-Z0-9_]+_PASSWORD$" in helpers)

# 2-4. Every rendered set.
allowed_volumes = {"emptyDir", "projected", "secret", "configMap", "persistentVolumeClaim",
                   "downwardAPI", "csi", "ephemeral", "name"}
restricted_container = {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]},
                        "privileged": False, "readOnlyRootFilesystem": True, "runAsNonRoot": True,
                        "seccompProfile": {"type": "RuntimeDefault"}}
for path in sorted(glob.glob(work + "/*.yaml"), key=lambda p: int(os.path.basename(p)[:-5])):
    label = open(path[:-5] + ".label", encoding="utf-8").read().strip() or "the defaults"
    label = label.replace(chart + "/", "")
    text = open(path, encoding="utf-8").read()
    docs = [d for d in yaml.safe_load_all(text) if d]
    problems = []
    pods = 0
    for doc in docs:
        spec = (doc.get("spec") or {}).get("template", {}).get("spec")
        if doc.get("kind") not in ("Deployment", "Job") or spec is None:
            continue
        pods += 1
        name = doc["metadata"]["name"]
        ctx = spec.get("securityContext") or {}
        if not (ctx.get("runAsNonRoot") is True and int(ctx.get("runAsUser") or 0) > 0
                and ctx.get("seccompProfile") == {"type": "RuntimeDefault"}
                and ctx.get("fsGroup") == ctx.get("runAsGroup")):
            problems.append(f"{name}: pod context {ctx}")
        if spec.get("automountServiceAccountToken") is not False:
            problems.append(f"{name}: service-account token")
        for c in spec.get("containers", []) + spec.get("initContainers", []):
            if c.get("securityContext") != restricted_container:
                problems.append(f"{name}/{c['name']}: container context")
            if not any(m.get("mountPath") == "/tmp" for m in c.get("volumeMounts", [])):
                problems.append(f"{name}/{c['name']}: no /tmp")
        for v in spec.get("volumes", []):
            if set(v) - allowed_volumes:
                problems.append(f"{name}: volume {v['name']} of type {sorted(set(v) - allowed_volumes)}")
            if "projected" in v and v["name"] == "secrets" and v["projected"].get("defaultMode") != 288:
                problems.append(f"{name}: secrets mode {v['projected'].get('defaultMode')}")
            if "secret" in v and v["secret"].get("defaultMode") not in (None, 288, 292):
                problems.append(f"{name}: secret volume mode")
            claim = (v.get("persistentVolumeClaim") or {}).get("claimName", "")
            if claim == "ov-ip-reputation":
                component = doc["metadata"]["labels"].get("app.kubernetes.io/component")
                mounts = [m for c in spec.get("containers", []) for m in c.get("volumeMounts", []) if m["name"] == v["name"]]
                if component not in ("api", "worker") or not all(m.get("readOnly") is True for m in mounts):
                    problems.append(f"{name}: the IP-reputation claim on {component}, read-only {[m.get('readOnly') for m in mounts]}")
    check(f"[{label}] every pod and container is restricted, with only allowed volumes", pods > 0 and not problems, "; ".join(problems[:4]))
    check(f"[{label}] renders no Secret", all(d.get("kind") != "Secret" for d in docs))
    check(f"[{label}] carries no static frame-ancestors", "frame-ancestors" not in text.lower() and "FRAME_ANCESTORS" not in text)
    policies = {d["metadata"]["name"].removeprefix("openverify-"): d for d in docs if d.get("kind") == "NetworkPolicy"}
    if policies:
        check(f"[{label}] vision has no egress", policies.get("vision", {}).get("spec", {}).get("egress") == [])
        if "code-runner" in policies:
            check(f"[{label}] the runner has no egress", policies["code-runner"]["spec"].get("egress") == [])
        check(f"[{label}] the default deny selects the release's pods both ways",
              policies.get("default-deny", {}).get("spec", {}).get("policyTypes") == ["Ingress", "Egress"])
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) ok "${line#ok   - }" ;;
    "FAIL - "*) nok "${line#FAIL - }" ;;
    *) [ -n "$line" ] && printf '%s\n' "$line" ;;
  esac
done <<<"$out"
finish
