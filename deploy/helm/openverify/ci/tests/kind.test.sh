#!/usr/bin/env bash
# Contract test for deploy/helm/openverify/ci/kind.sh and ci/fixtures/ (Workflow 11C chart-policy-11c;
# C265.4, review F14, verification V15, review H16), over stand-in kind, kubectl, ct, helm and docker
# that log their arguments (no cluster, no network):
#
#   create <1.35|1.37>  a cluster named openverify-11c-<version> on the node image install-kind.sh pins
#   load                the five images and the flow's no-guidance variant, local builds only
#   fixtures            the namespaces, the stores' Secrets generated per run and sent on stdin (never
#                       as arguments), Postgres, Valkey and RustFS with their bucket
#   models              the weights already in models/ copied into the node, each file checked against
#                       models/manifest.json first; no download
#   install             ct install of the chart with ci/kind-values.yaml, models.source pvc
#   smoke / upgrade     the smoke, and a helm upgrade with ci/upgrade/kind-upgrade-values.yaml
#   delete              only this script's clusters
#
# and the fixtures themselves: every image pinned by digest (the digests compose and the plan pin),
# no Secret in git, the chart's namespace enforcing the restricted Pod Security Standard, the two
# database roles of C249.3.
#
# Usage: deploy/helm/openverify/ci/tests/kind.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
chart="$repo_root/deploy/helm/openverify"
script="$chart/ci/kind.sh"
fixtures="$chart/ci/fixtures"
passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed, 0 skipped\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}
expect_rc() { if [ "$rc" -eq "$2" ]; then ok "$1"; else nok "$1" "exit $rc, expected $2: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi; }
# shellcheck disable=SC2053 # the second argument is a glob pattern on purpose
expect_match() { if [[ $3 == $2 ]]; then ok "$1"; else nok "$1" "$(head -c 500 <<<"$3")"; fi; }
expect_no_match() { if [[ $3 == $2 ]]; then nok "$1" "$(head -c 500 <<<"$3")"; else ok "$1"; fi; }

# --- The fixtures, statically. ---
for f in namespaces postgres valkey rustfs models-volume; do
  if [ -f "$fixtures/$f.yaml" ]; then ok "ci/fixtures/$f.yaml exists"; else nok "ci/fixtures/$f.yaml exists"; fi
done
static=$(python3 -I - "$repo_root" <<'PY'
import glob
import re
import sys

import yaml

root = sys.argv[1]
fixtures = root + "/deploy/helm/openverify/ci/fixtures"


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


docs = []
for path in sorted(glob.glob(fixtures + "/*.yaml")):
    with open(path, encoding="utf-8") as fh:
        docs += [d for d in yaml.safe_load_all(fh) if d]
images = []
for doc in docs:
    spec = (doc.get("spec") or {}).get("template", {}).get("spec", {})
    images += [c["image"] for c in spec.get("containers", []) + spec.get("initContainers", [])]
pinned = re.compile(r"^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$")
check("every fixture image is pinned by tag and digest", images != [] and all(pinned.match(i) for i in images), " ".join(i for i in images if not pinned.match(i)))
# The digests the plan pins (Stage 1a amendment item 6) and compose's, where compose pins the same tag.
expected = {
    "pgvector/pgvector:pg17": "sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f",
    "valkey/valkey:9.1": "sha256:3add1a336a920ea54770a001ab6feb3da5fceea96a40373a3a2cd469b815f0b7",
    "rustfs/rustfs:1.0.3": "sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b",
    "amazon/aws-cli:2.38.2": "sha256:5d39fd52f236ed01c5c25fba66c9aebcfc6cbb88e7bb1b727c5fe1f150540597",
}
with open(root + "/infra/docker-compose.yml", encoding="utf-8") as fh:
    for ref in re.findall(r"image:\s*([a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64})", fh.read()):
        name, digest = ref.split("@")
        if name in expected:
            expected[name] = digest
for image in images:
    name, _, digest = image.partition("@")
    check(f"{name} is the digest compose and the plan pin", expected.get(name) == digest, digest)
check("Postgres, Valkey, RustFS and the AWS CLI are all there", {i.partition("@")[0] for i in images} == set(expected))
check("no Secret is committed (kind.sh fixtures generates them per run)", all(d.get("kind") != "Secret" for d in docs))
namespaces = {d["metadata"]["name"]: d for d in docs if d.get("kind") == "Namespace"}
labels = (namespaces.get("openverify") or {}).get("metadata", {}).get("labels", {})
check("the chart's namespace enforces the restricted Pod Security Standard", labels.get("pod-security.kubernetes.io/enforce") == "restricted")
check("the stores have their own namespace", "openverify-fixtures" in namespaces)
init = "".join(d.get("data", {}).get("10-roles.sh", "") for d in docs if d.get("kind") == "ConfigMap")
check("Postgres creates the migration role and owns the database with it", "CREATE ROLE openverify_migrator" in init and "OWNER openverify_migrator" in init)
check("Postgres creates the runtime role, which owns nothing", "CREATE ROLE openverify_runtime" in init and "OWNER openverify_runtime" not in init and "OWNER TO openverify_runtime" not in init)
check("the public schema belongs to the migration role", "ALTER SCHEMA public OWNER TO openverify_migrator" in init)
check("no password is written in a fixture", not re.search(r"PASSWORD\s+'[^:]", init))
pvs = [d for d in docs if d.get("kind") == "PersistentVolume"]
pvcs = [d for d in docs if d.get("kind") == "PersistentVolumeClaim"]
check("the models volume is a host directory on the node, bound to the claim openverify/openverify-models",
      len(pvs) == 1 and pvs[0]["spec"]["hostPath"]["path"] == "/var/local/openverify-models"
      and len(pvcs) == 1 and pvcs[0]["metadata"] == {"name": "openverify-models", "namespace": "openverify"})
with open(root + "/deploy/helm/openverify/ci/kind-values.yaml", encoding="utf-8") as fh:
    values = yaml.safe_load(fh)
check("the kind values install in pvc mode on the fixtures' claim", values["models"] == {"source": "pvc", "existingClaim": "openverify-models", "accessMode": "ReadWriteOnce"})
check("the kind values reach the stores in openverify-fixtures by selector", values["networkPolicy"]["dataStoresInCluster"]["enabled"] is True and values["networkPolicy"]["dataStoresInCluster"]["namespaceSelector"] == {"kubernetes.io/metadata.name": "openverify-fixtures"})
check("the kind values keep network policies on", values["networkPolicy"]["enabled"] is True)
check("the kind values never pull an image (local builds, kind load)", all(values[c]["image"]["pullPolicy"] == "Never" and values[c]["image"]["tag"] == "11c-local" for c in ["api", "worker", "dashboard", "flow", "vision", "codeRunner", "migrate", "modelsFetch"]))
check("the kind values run the two database roles", values["external"]["postgres"]["migrationSecret"] and values["external"]["postgres"]["runtimeRole"] == "openverify_runtime")
with open(root + "/deploy/helm/openverify/ci/upgrade/kind-upgrade-values.yaml", encoding="utf-8") as fh:
    upgrade = yaml.safe_load(fh)
check("the upgrade moves the flow to the no-guidance image", upgrade["flow"]["image"]["tag"] == "11c-local-noguidance")
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "* | "ok  "*) ok "${line#ok* - }" ;;
    "FAIL - "*) nok "${line#FAIL - }" ;;
    *) [ -n "$line" ] && printf '%s\n' "$line" ;;
  esac
done <<<"$static"

if [ -f "$script" ]; then ok "kind.sh exists"; else nok "kind.sh exists"; finish; fi

# --- kind.sh over stand-in tools. ---
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tools="$work/bin"
mkdir -p "$tools" "$work/state"
calls="$work/calls"
for t in kind kubectl ct helm docker; do
  cat >"$tools/$t" <<'EOF'
#!/usr/bin/env bash
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >>"$CALLS"
if [ ! -t 0 ] && [[ " $* " == *" -f - "* ]]; then
  printf 'stdin:%s\n' "$(cat | tr '\n' ' ')" >>"$CALLS"
fi
case "$name $*" in
  "kind get clusters"*) printf '%s' "${FAKE_CLUSTERS:-}" ;;
  "helm "*" list "*) printf 'openverify-abc123\n' ;;
  "docker image inspect"*) for i in ${FAKE_MISSING_IMAGES:-}; do [ "${@: -1}" = "$i" ] && exit 1; done ;;
esac
exit 0
EOF
  chmod +x "$tools/$t"
done
run() {
  : >"$calls"
  out=$(env CALLS="$calls" KIND_TOOLS_DIR="$tools" PATH="$tools:$PATH" OPENVERIFY_KIND_STATE_DIR="$work/state" "$@" 2>&1 </dev/null)
  rc=$?
  log=$(cat "$calls")
}

run bash "$script"
expect_rc "no subcommand is a usage error" 2
expect_match "the usage lists the subcommands" "*create*load*fixtures*models*install*smoke*upgrade*delete*" "$out"
run bash "$script" create 1.36
expect_rc "create refuses a version without a pinned node image" 2

node35=$(sed -n 's/^KIND_NODE_IMAGE_1_35="\(.*\)"$/\1/p' "$repo_root/infra/scripts/install-kind.sh")
node37=$(sed -n 's/^KIND_NODE_IMAGE_1_37="\(.*\)"$/\1/p' "$repo_root/infra/scripts/install-kind.sh")
run bash "$script" create 1.35
expect_rc "create 1.35 passes" 0
expect_match "create 1.35 names the cluster openverify-11c-1.35 on the pinned node image" "*kind create cluster --name openverify-11c-1.35 --image $node35 *" "$log"
expect_match "create keeps its own kubeconfig, not the user's" "*--kubeconfig $work/state/openverify-11c-1.35.kubeconfig*" "$log"
run bash "$script" create 1.37
expect_match "create 1.37 uses the 1.37 node image" "*kind create cluster --name openverify-11c-1.37 --image $node37 *" "$log"
run env FAKE_CLUSTERS=openverify-11c-1.35 bash "$script" create 1.35
expect_rc "create refuses a cluster that already exists" 1

run bash "$script" load
expect_rc "a subcommand without a cluster fails" 1
run env FAKE_CLUSTERS=$'openverify-11c-1.35\nopenverify-11c-1.37\n' bash "$script" load
expect_rc "a subcommand with two clusters and no version fails" 1

clusters=$'openverify-11c-1.35\nsomeone-else\n'
run env FAKE_CLUSTERS="$clusters" bash "$script" load
expect_rc "load passes with the six images present" 0
for image in openverify/api:11c-local openverify/dashboard:11c-local openverify/flow:11c-local openverify/flow:11c-local-noguidance openverify/vision:11c-local openverify/code-runner:11c-local; do
  expect_match "load sends $image to the node" "*kind load docker-image --name openverify-11c-1.35 *$image*" "$log"
done
run env FAKE_CLUSTERS="$clusters" FAKE_MISSING_IMAGES=openverify/vision:11c-local bash "$script" load
expect_rc "load fails closed when an image was not built" 1
expect_match "the message names the missing image" "*openverify/vision:11c-local*" "$out"
run env FAKE_CLUSTERS="$clusters" OPENVERIFY_KIND_IMAGE_TAG=0.1.0 bash "$script" load
expect_match "load takes another tag from OPENVERIFY_KIND_IMAGE_TAG (release.yml)" "*openverify/flow:0.1.0-noguidance*" "$log"

run env FAKE_CLUSTERS="$clusters" bash "$script" fixtures
expect_rc "fixtures passes" 0
for f in namespaces postgres valkey rustfs; do
  expect_match "fixtures applies ci/fixtures/$f.yaml" "*kubectl --kubeconfig * apply -f $fixtures/$f.yaml*" "$log"
done
expect_match "fixtures sends the generated Secrets on stdin" "*stdin:*openverify-ci-api*" "$log"
expect_no_match "no generated value is an argument" "*kubectl*--from-literal*" "$log"
expect_match "fixtures waits for the bucket Job" "*kubectl --kubeconfig * wait *job/rustfs-bucket*" "$log"
expect_match "every kubectl call uses the cluster's own kubeconfig" "*kubectl --kubeconfig $work/state/openverify-11c-1.35.kubeconfig*" "$log"
if grep '^kubectl ' <<<"$log" | grep -qv -- "--kubeconfig $work/state/openverify-11c-1.35.kubeconfig"; then nok "no kubectl call without the cluster's kubeconfig"; else ok "no kubectl call without the cluster's kubeconfig"; fi

models="$work/models"
mkdir -p "$models"
manifest="$repo_root/models/manifest.json"
run env FAKE_CLUSTERS="$clusters" OPENVERIFY_KIND_MODELS_DIR="$models" bash "$script" models
expect_rc "models refuses when the weights were never fetched" 1
expect_match "the message says to run scripts/fetch_models.py" "*scripts/fetch_models.py*" "$out"
python3 -I - "$manifest" "$models" <<'PY'
import json, sys
for entry in json.load(open(sys.argv[1], encoding="utf-8"))["models"]:
    open(f"{sys.argv[2]}/{entry['filename']}", "wb").write(b"not the pinned bytes")
PY
run env FAKE_CLUSTERS="$clusters" OPENVERIFY_KIND_MODELS_DIR="$models" bash "$script" models
expect_rc "models refuses a file whose SHA-256 is not the manifest's" 1
expect_no_match "nothing is copied before every file is checked" "*docker cp*" "$log"
expect_no_match "models never downloads" "*fetch_models.py --*" "$log"

run env FAKE_CLUSTERS="$clusters" bash "$script" install
expect_rc "install passes" 0
expect_match "install runs ct install on the chart in the namespace openverify, kept for the smoke" "*ct install --charts $chart --namespace openverify --skip-clean-up *" "$log"
run env FAKE_CLUSTERS="$clusters" bash "$script" upgrade
expect_match "upgrade runs helm upgrade with the kind values and the upgrade overlay" "*helm --kubeconfig * upgrade * $chart --namespace openverify -f $chart/ci/kind-values.yaml -f $chart/ci/upgrade/kind-upgrade-values.yaml *--wait*" "$log"

run env FAKE_CLUSTERS="$clusters" OPENVERIFY_KIND_IMAGE_TAG=0.1.0 bash "$script" upgrade
expect_match "upgrade with another tag keeps the flow server's move to the no-guidance image" "*helm --kubeconfig * upgrade *--set=api.image.tag=0.1.0 *--set=flow.image.tag=0.1.0-noguidance *" "$log"
run env FAKE_CLUSTERS="$clusters" OPENVERIFY_KIND_IMAGE_TAG=0.1.0 bash "$script" install
expect_match "install with another tag sets every image's tag" "*ct install *--helm-extra-set-args --set=api.image.tag=0.1.0 *--set=flow.image.tag=0.1.0*" "$log"

run env FAKE_CLUSTERS="$clusters" bash "$script" delete
expect_rc "delete passes" 0
expect_match "delete removes this script's cluster" "*kind delete cluster --name openverify-11c-1.35*" "$log"
expect_no_match "delete never touches another cluster" "*kind delete cluster --name someone-else*" "$log"
run env FAKE_CLUSTERS='' bash "$script" delete
expect_rc "delete with nothing to delete passes" 0

# A port-forward left running would keep the e2e lock's descriptor (flock's child) open after the call:
# it is started as kubectl itself, so $! is its pid and the EXIT trap stops it.
if grep -qE '^\s*kubectl --kubeconfig "\$kubeconfig" -n "\$namespace" port-forward .*&$' "$script" && ! grep -qE '^\s*kc .*port-forward.*&$' "$script" && grep -q "trap stop_forward EXIT" "$script"; then ok "the port-forward is kubectl itself, stopped by the EXIT trap"; else nok "the port-forward is kubectl itself, stopped by the EXIT trap"; fi
if grep -nE 'set -x|echo .*(TOKEN|token|PASSWORD|password)' "$script" >/dev/null; then nok "kind.sh never traces or echoes a secret" "$(grep -nE 'set -x|echo .*(TOKEN|token|PASSWORD|password)' "$script" | head -3)"; else ok "kind.sh never traces or echoes a secret"; fi
finish
