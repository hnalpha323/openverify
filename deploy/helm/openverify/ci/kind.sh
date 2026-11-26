#!/usr/bin/env bash
# The chart's install and upgrade on kind (Workflow 11C chart-policy-11c; C265.4, review F14,
# verification V15, review H16). Each subcommand is one call, run under the e2e lock locally
# (flock -E 75 -w 240 /tmp/openverify-e2e.lock bash deploy/helm/openverify/ci/kind.sh <subcommand>)
# and by release.yml's verify job, never per push:
#
#   create <1.35|1.37>  a kind cluster openverify-11c-<version> on the node image pinned by digest in
#                       infra/scripts/install-kind.sh, with its own kubeconfig (never ~/.kube/config)
#   load                kind load docker-image of openverify/{api,dashboard,flow,vision,code-runner}:<tag>
#                       and openverify/flow:<tag>-noguidance, built locally (tag 11c-local, or
#                       OPENVERIFY_KIND_IMAGE_TAG); nothing is pulled or pushed
#   fixtures            ci/fixtures/: the namespaces (openverify enforces the restricted Pod Security
#                       Standard), the Secrets generated at random for this run and sent on stdin,
#                       Postgres with the migration and runtime roles, Valkey, RustFS and its bucket
#   models              the weights python3 scripts/fetch_models.py already put in models/, each checked
#                       against models/manifest.json, copied into the node under
#                       /var/local/openverify-models/<manifest digest>/ and bound by ci/fixtures'
#                       PersistentVolume and claim; nothing is downloaded
#   install             ct install of the chart with ci/kind-values.yaml (models.source pvc), kept
#   smoke               the migrate hook succeeded (db:migrate's migrations all applied, db:grant-runtime's
#                       rights on the runtime role, the Job's completion), every Deployment available and
#                       every pod ready, the worker's exec probe, GET /ready 200, and a sandbox inquiry
#                       created through the API with a key the API image's compiled seed command makes
#                       (non-production mode; the key is never printed)
#   upgrade             helm upgrade of the same chart with ci/upgrade/kind-upgrade-values.yaml on top,
#                       which re-runs the pre-upgrade hook, then the smoke again
#   delete [<version>]  kind delete cluster for this script's clusters only (always the last call, also
#                       after a failure)
#
# Every subcommand but create and delete finds the one openverify-11c-* cluster (or the version given).
# A kind install proves the chart renders, installs, starts and upgrades on kind's own network plugin
# and storage, not its behaviour under a real cloud (C265.5).
#
# Exit codes: 0 pass, 1 failure, 2 usage.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
chart=$(cd "$here/.." && pwd)
repo_root=$(cd "$chart/../../.." && pwd)
tools=${KIND_TOOLS_DIR:-${SUPPLY_CHAIN_TOOLS_DIR:-$HOME/.local/bin}}
export PATH="$tools:$PATH"
state=${OPENVERIFY_KIND_STATE_DIR:-${TMPDIR:-/tmp}/openverify-kind-$(id -u)}
tag=${OPENVERIFY_KIND_IMAGE_TAG:-11c-local}
models_dir=${OPENVERIFY_KIND_MODELS_DIR:-$repo_root/models}
namespace=openverify
stores=openverify-fixtures
prefix=openverify-11c-
started=$(date +%s)

usage() {
  printf 'usage: %s create <1.35|1.37> | load | fixtures | models | install | smoke | upgrade | delete [<1.35|1.37>]\n' "${0##*/}" >&2
  exit 2
}
die() {
  printf 'kind.sh %s: %s\n' "$subcommand" "$*" >&2
  exit 1
}
note() { printf 'kind.sh %s: %s\n' "$subcommand" "$*"; }

[ $# -ge 1 ] || usage
subcommand=$1
shift
version=${1:-}
case "$subcommand" in
  create) [ -n "$version" ] || usage ;;
  load | fixtures | models | install | smoke | upgrade | delete) ;;
  *) usage ;;
esac
case "$version" in '' | 1.35 | 1.37) ;; *) usage ;; esac

# This script's clusters: openverify-11c-1.35 and openverify-11c-1.37.
our_clusters() { kind get clusters 2>/dev/null | grep -E "^${prefix}1\.3[57]\$" || true; }

# The cluster a subcommand acts on: the version given, or the only one of ours.
pick_cluster() {
  local list
  list=$(our_clusters)
  if [ -n "$version" ]; then
    grep -qx "$prefix$version" <<<"$list" || die "no cluster $prefix$version (run: kind.sh create $version)"
    cluster=$prefix$version
  else
    case "$(grep -c . <<<"$list")" in
      1) cluster=$list ;;
      0) die "no openverify-11c-* cluster (run: kind.sh create <1.35|1.37>)" ;;
      *) die "several openverify-11c-* clusters; name the version" ;;
    esac
  fi
  kubeconfig="$state/$cluster.kubeconfig"
  [ -f "$kubeconfig" ] || kind get kubeconfig --name "$cluster" >"$kubeconfig" 2>/dev/null || true
  chmod 600 "$kubeconfig" 2>/dev/null || true
}
kc() { kubectl --kubeconfig "$kubeconfig" "$@"; }
hc() { helm --kubeconfig "$kubeconfig" "$@"; }

images() {
  printf '%s\n' "openverify/api:$tag" "openverify/dashboard:$tag" "openverify/flow:$tag" \
    "openverify/flow:$tag-noguidance" "openverify/vision:$tag" "openverify/code-runner:$tag"
}

# The image tags as --set arguments when they are not the ci values' own; `tag_sets upgrade` keeps
# the upgrade overlay's move of the flow server to the no-guidance image.
tag_sets() {
  [ "$tag" = 11c-local ] && return 0
  local c
  for c in api worker dashboard vision codeRunner migrate modelsFetch; do printf -- '--set=%s.image.tag=%s ' "$c" "$tag"; done
  printf -- '--set=flow.image.tag=%s%s ' "$tag" "$([ "${1:-}" = upgrade ] && echo -noguidance)"
}

do_create() {
  local var image
  case "$version" in 1.35) var=KIND_NODE_IMAGE_1_35 ;; 1.37) var=KIND_NODE_IMAGE_1_37 ;; esac
  image=$(sed -n "s/^$var=\"\\(.*\\)\"\$/\\1/p" "$repo_root/infra/scripts/install-kind.sh")
  [ -n "$image" ] || die "no $var in infra/scripts/install-kind.sh"
  cluster=$prefix$version
  if our_clusters | grep -qx "$cluster"; then die "$cluster exists already (run: kind.sh delete $version)"; fi
  mkdir -p "$state" && chmod 700 "$state"
  kubeconfig="$state/$cluster.kubeconfig"
  kind create cluster --name "$cluster" --image "$image" --kubeconfig "$kubeconfig" --wait 180s || die "kind create cluster failed"
  chmod 600 "$kubeconfig" 2>/dev/null || true
  note "created $cluster on $image"
}

do_load() {
  pick_cluster
  local missing="" image
  while read -r image; do
    docker image inspect "$image" >/dev/null 2>&1 || missing="$missing $image"
  done < <(images)
  [ -z "$missing" ] || die "not built:$missing (images-11c's builds: docker build ... -t <name>:$tag)"
  # shellcheck disable=SC2046 # one image reference per word
  kind load docker-image --name "$cluster" $(images) || die "kind load docker-image failed"
  note "loaded $(images | tr '\n' ' ')"
}

# The Secrets of one run, random, as a kubectl List on stdout (never on a command line or in git).
secrets_manifest() {
  python3 -I -c '
import base64, json, secrets
t = lambda: secrets.token_urlsafe(32)
key = lambda: base64.b64encode(secrets.token_bytes(32)).decode()
pg, mig, rt, vk = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(24)
s3id, s3secret = "ci" + secrets.token_hex(8), t()
kek, blind, pepper, vision, bff, flow, runner = key(), key(), t(), t(), t(), t(), t()
pg_host, valkey_host = "postgres.openverify-fixtures.svc", "valkey.openverify-fixtures.svc"
def secret(name, namespace, data):
    return {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": name, "namespace": namespace}, "stringData": data}
stores, ns = "openverify-fixtures", "openverify"
items = [
    secret("openverify-ci-postgres-auth", stores, {"POSTGRES_PASSWORD": pg, "MIGRATOR_PASSWORD": mig, "RUNTIME_PASSWORD": rt}),
    secret("openverify-ci-valkey-auth", stores, {"VALKEY_PASSWORD": vk}),
    secret("openverify-ci-rustfs-auth", stores, {"S3_ACCESS_KEY_ID": s3id, "S3_SECRET_ACCESS_KEY": s3secret}),
    secret("openverify-ci-postgres", ns, {"DATABASE_URL": f"postgresql://openverify_runtime:{rt}@{pg_host}:5432/openverify"}),
    secret("openverify-ci-postgres-migration", ns, {"OPENVERIFY_MIGRATION_DATABASE_URL": f"postgresql://openverify_migrator:{mig}@{pg_host}:5432/openverify"}),
    secret("openverify-ci-valkey", ns, {"REDIS_URL": f"redis://:{vk}@{valkey_host}:6379"}),
    secret("openverify-ci-s3", ns, {"S3_ACCESS_KEY_ID": s3id, "S3_SECRET_ACCESS_KEY": s3secret}),
    secret("openverify-ci-api", ns, {"OPENVERIFY_KEK": kek, "OPENVERIFY_BLIND_INDEX_KEY": blind, "OPENVERIFY_API_KEY_PEPPER": pepper,
        "OPENVERIFY_VISION_SERVICE_TOKEN": vision, "OPENVERIFY_DASHBOARD_BFF_TOKEN": bff, "OPENVERIFY_FLOW_SERVER_TOKEN": flow}),
    secret("openverify-ci-worker", ns, {"OPENVERIFY_KEK": kek, "OPENVERIFY_BLIND_INDEX_KEY": blind, "OPENVERIFY_API_KEY_PEPPER": pepper,
        "OPENVERIFY_VISION_SERVICE_TOKEN": vision, "OPENVERIFY_CODE_RUNNER_TOKEN": runner}),
    secret("openverify-ci-migrate", ns, {"OPENVERIFY_KEK": kek}),
    secret("openverify-ci-dashboard", ns, {"OPENVERIFY_DASHBOARD_BFF_TOKEN": bff}),
    secret("openverify-ci-flow", ns, {"OPENVERIFY_FLOW_SERVER_TOKEN": flow}),
    secret("openverify-ci-code-runner", ns, {"OPENVERIFY_CODE_RUNNER_TOKEN": runner}),
    secret("openverify-ci-vision", ns, {"OPENVERIFY_VISION_SERVICE_TOKEN": vision}),
    secret("openverify-ci-seed", ns, {f"OPENVERIFY_SEED_{r}_PASSWORD": secrets.token_urlsafe(24) for r in ("ADMIN", "DEVELOPER", "REVIEWER", "VIEWER")}),
]
print(json.dumps({"apiVersion": "v1", "kind": "List", "items": items}))
'
}

do_fixtures() {
  pick_cluster
  kc apply -f "$here/fixtures/namespaces.yaml" || die "the namespaces failed"
  if [ -n "$(kc -n "$stores" get secret openverify-ci-postgres-auth -o name --ignore-not-found 2>/dev/null)" ]; then
    note "the Secrets exist already; kept (a store's first start holds their passwords)"
  else
    secrets_manifest | kc apply -f - >/dev/null || die "the Secrets failed"
  fi
  local f
  for f in postgres valkey rustfs; do
    kc apply -f "$here/fixtures/$f.yaml" || die "ci/fixtures/$f.yaml failed"
  done
  for f in postgres valkey rustfs; do
    kc -n "$stores" rollout status "deploy/$f" --timeout=300s || die "$f is not ready"
  done
  kc -n "$stores" wait --for=condition=complete job/rustfs-bucket --timeout=300s || die "the bucket Job did not complete"
  note "Postgres (migration and runtime roles), Valkey and RustFS with its bucket are ready"
}

do_models() {
  pick_cluster
  local manifest="$repo_root/models/manifest.json" digest node files
  cmp -s "$manifest" "$chart/files/models-manifest.json" || die "deploy/helm/openverify/files/models-manifest.json is not a byte copy of models/manifest.json"
  files=$(python3 -I -c '
import hashlib, json, os, sys
manifest, folder = sys.argv[1], sys.argv[2]
bad = []
for entry in json.load(open(manifest, encoding="utf-8"))["models"]:
    path = os.path.join(folder, entry["filename"])
    try:
        digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    except OSError:
        bad.append(entry["filename"] + " (missing)")
        continue
    if digest != entry["sha256"]:
        bad.append(entry["filename"] + " (sha256 differs)")
    print(entry["filename"])
if bad:
    sys.exit("not the pinned weights: " + ", ".join(bad))
' "$manifest" "$models_dir") || die "run python3 -I scripts/fetch_models.py first (into $models_dir)"
  digest=$(sha256sum "$manifest" | cut -d' ' -f1)
  node="$cluster-control-plane"
  docker exec "$node" mkdir -p "/var/local/openverify-models/$digest" || die "cannot make the models directory on $node"
  local f
  while read -r f; do
    docker cp "$models_dir/$f" "$node:/var/local/openverify-models/$digest/$f" >/dev/null || die "cannot copy $f"
  done <<<"$files"
  docker exec "$node" chown -R 10001:10001 /var/local/openverify-models || die "chown failed"
  docker exec "$node" chmod -R u=rwX,g=rX,o= /var/local/openverify-models || die "chmod failed"
  kc apply -f "$here/fixtures/models-volume.yaml" || die "the models volume failed"
  kc -n "$namespace" wait --for=jsonpath='{.status.phase}'=Bound pvc/openverify-models --timeout=120s || die "the models claim is not bound"
  note "copied $(grep -c . <<<"$files") weights to /var/local/openverify-models/$digest on $node; claim openverify-models bound"
}

do_install() {
  pick_cluster
  # shellcheck disable=SC2046
  (cd "$repo_root" && KUBECONFIG="$kubeconfig" ct install --charts "$chart" --namespace "$namespace" --skip-clean-up \
    --helm-extra-args "--timeout 480s" $( [ "$tag" = 11c-local ] || printf -- '--helm-extra-set-args %s' "$(tag_sets | sed 's/ $//')" )) ||
    die "ct install failed"
  note "installed release $(hc list -n "$namespace" -q)"
}

find_release() {
  release=$(hc list -n "$namespace" -q 2>/dev/null | head -n 1)
  [ -n "$release" ] || die "no release in the namespace $namespace (run: kind.sh install)"
}

# deployment <component>: the release's Deployment of one component.
deployment() { kc -n "$namespace" get deploy -l "app.kubernetes.io/instance=$release,app.kubernetes.io/component=$1" -o name | head -n 1; }

psql_value() { kc -n "$stores" exec deploy/postgres -- psql -U postgres -d openverify -tAc "$1"; }

forward_pid=""
stop_forward() { [ -z "$forward_pid" ] || kill "$forward_pid" 2>/dev/null || true; }
trap stop_forward EXIT

# The smoke: since=<epoch seconds> keeps only the migrate Job's completions after it (the upgrade's).
smoke() {
  local since=$1 journal applied value deploy api port worker log
  find_release
  [ "$(hc status "$release" -n "$namespace" -o json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["info"]["status"])')" = deployed ] ||
    die "release $release is not deployed"
  # The migrate hook: its Job completed after $since, every migration applied, the runtime role's rights.
  kc -n "$namespace" get events -o json | python3 -I -c '
import datetime, json, sys
since = float(sys.argv[1])
done = [e for e in json.load(sys.stdin)["items"]
        if e["involvedObject"]["kind"] == "Job" and e["involvedObject"]["name"].endswith("-migrate")
        and e.get("reason") == "Completed"
        and datetime.datetime.fromisoformat((e.get("lastTimestamp") or e["eventTime"]).replace("Z", "+00:00")).timestamp() >= since]
sys.exit(0 if done else "no Completed event of the migrate Job since the call began")
' "$since" || die "the migrate hook's completion is not recorded"
  journal=$(python3 -I -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["entries"]))' "$repo_root/packages/db/drizzle/meta/_journal.json")
  applied=$(psql_value 'select count(*) from drizzle.__drizzle_migrations') || die "cannot read the migrations table"
  [ "$applied" = "$journal" ] || die "db:migrate applied $applied of $journal migrations"
  note "migrate hook completed; $applied of $journal migrations applied"
  value=$(psql_value "select has_table_privilege('openverify_runtime','public.inquiries','SELECT,INSERT,UPDATE,DELETE')::text || has_schema_privilege('openverify_runtime','public','CREATE')::text || has_table_privilege('openverify_runtime','public.audit_logs','UPDATE')::text || (select tableowner from pg_tables where schemaname='public' and tablename='inquiries')")
  [ "$value" = truefalsefalseopenverify_migrator ] || die "db:grant-runtime's rights are not in place ($value)"
  note "db:grant-runtime: the runtime role reads and writes, cannot create or update audit_logs, owns nothing"
  # Every Deployment available and every pod of the release ready.
  for deploy in $(kc -n "$namespace" get deploy -l "app.kubernetes.io/instance=$release" -o name); do
    kc -n "$namespace" rollout status "$deploy" --timeout=600s >/dev/null || die "$deploy did not roll out"
  done
  # Every pod of the release that is not being deleted (an old ReplicaSet's pod may still be inside
  # the worker's long grace period after a rollout) is ready.
  local ready=""
  for _ in $(seq 1 60); do
    ready=$(kc -n "$namespace" get pods -l "app.kubernetes.io/instance=$release" -o json | python3 -I -c '
import json, sys
pods = [p for p in json.load(sys.stdin)["items"] if not p["metadata"].get("deletionTimestamp")
        and p["status"].get("phase") != "Succeeded"]
ready = [p for p in pods if any(c["type"] == "Ready" and c["status"] == "True" for c in p["status"].get("conditions", []))]
print(f"{len(ready)} of {len(pods)}" if pods and len(ready) == len(pods) else "")
')
    [ -n "$ready" ] && break
    sleep 5
  done
  [ -n "$ready" ] || die "a pod of $release is not ready"
  note "pods ready: $ready"
  # The worker's exec probe, as its liveness probe runs it.
  worker=$(deployment worker)
  kc -n "$namespace" exec "$worker" -- node dist/worker-health.js || die "the worker's exec probe failed"
  # GET /ready through the API's public port.
  api=$(deployment api)
  log=$(mktemp)
  # kubectl itself, not the kc function: $! is then its pid, and the EXIT trap stops it, so it never
  # keeps the e2e lock's descriptor (flock's child) after the call.
  kubectl --kubeconfig "$kubeconfig" -n "$namespace" port-forward --address 127.0.0.1 "$api" :3000 >"$log" 2>&1 &
  forward_pid=$!
  port=""
  for _ in $(seq 1 60); do
    port=$(sed -n 's/^Forwarding from 127\.0\.0\.1:\([0-9]*\) .*/\1/p' "$log" | head -n 1)
    [ -n "$port" ] && break
    sleep 1
  done
  rm -f "$log"
  [ -n "$port" ] || die "kubectl port-forward to $api did not start"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/ready")" = 200 ] || die "GET /ready did not answer 200"
  note "GET /ready answered 200"
  # A sandbox API key from the API image's compiled seed command, then an inquiry through the API.
  seed_job | kc -n "$namespace" apply -f - >/dev/null || die "the seed Job failed to start"
  if ! kc -n "$namespace" wait --for=condition=complete job/openverify-ci-seed --timeout=300s >/dev/null; then
    kc -n "$namespace" logs job/openverify-ci-seed --tail=20 2>&1 | grep -v '^{' >&2
    kc -n "$namespace" delete job openverify-ci-seed --wait=true >/dev/null 2>&1
    die "the seed command failed"
  fi
  kc -n "$namespace" logs job/openverify-ci-seed | python3 -I -c '
import json, sys, urllib.request
seeded = None
for line in sys.stdin:
    if line.startswith("{"):
        seeded = json.loads(line)
if seeded is None:
    sys.exit("the seed printed no result")
body = json.dumps({"data": {"type": "inquiry", "attributes": {
    "inquiry-template-id": seeded["template"]["id"], "reference-id": "kind-smoke"}}}).encode()
request = urllib.request.Request("http://127.0.0.1:" + sys.argv[1] + "/api/v1/inquiries", data=body, method="POST", headers={
    "authorization": "Bearer " + seeded["apiKey"]["token"], "content-type": "application/json", "accept": "application/json"})
with urllib.request.urlopen(request, timeout=30) as response:
    created = json.load(response)
    status = response.status
inquiry = created["data"]
if status != 201 or not inquiry["id"].startswith("inq_"):
    sys.exit(f"POST /api/v1/inquiries answered {status}")
print("kind.sh smoke: inquiry " + inquiry["id"] + " created through the API (status " + str(inquiry["attributes"].get("status")) + ")")
' "$port" || {
    kc -n "$namespace" delete job openverify-ci-seed --wait=true >/dev/null 2>&1
    die "no sandbox inquiry was created through the API"
  }
  kc -n "$namespace" delete job openverify-ci-seed --wait=true >/dev/null 2>&1
  stop_forward
  forward_pid=""
}

# The seed Job: the API image's compiled seed:dev under the restricted profile, non-production mode,
# the migration role, the seeded operators at example.com with this run's random passwords.
seed_job() {
  python3 -I -c '
import json, sys
image = sys.argv[1]
name_of = {
    "DATABASE_URL": "openverify-ci-postgres", "OPENVERIFY_MIGRATION_DATABASE_URL": "openverify-ci-postgres-migration",
    "OPENVERIFY_API_KEY_PEPPER": "openverify-ci-api", "OPENVERIFY_KEK": "openverify-ci-api",
    "OPENVERIFY_BLIND_INDEX_KEY": "openverify-ci-api", "S3_ACCESS_KEY_ID": "openverify-ci-s3",
    "S3_SECRET_ACCESS_KEY": "openverify-ci-s3",
}
for role in ("ADMIN", "DEVELOPER", "REVIEWER", "VIEWER"):
    name_of[f"OPENVERIFY_SEED_{role}_PASSWORD"] = "openverify-ci-seed"
env = [{"name": key, "valueFrom": {"secretKeyRef": {"name": secret, "key": key}}} for key, secret in name_of.items()]
env += [{"name": "OPENVERIFY_MODE", "value": "development"},
        {"name": "S3_ENDPOINT", "value": "http://rustfs.openverify-fixtures.svc:9000"},
        {"name": "S3_REGION", "value": "us-east-1"}, {"name": "S3_BUCKET", "value": "openverify-files"},
        {"name": "S3_FORCE_PATH_STYLE", "value": "true"}]
env += [{"name": f"OPENVERIFY_SEED_{r}_EMAIL", "value": f"{r.lower()}@example.com"} for r in ("ADMIN", "DEVELOPER", "REVIEWER", "VIEWER")]
restricted = {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}, "privileged": False,
              "readOnlyRootFilesystem": True, "runAsNonRoot": True, "seccompProfile": {"type": "RuntimeDefault"}}
print(json.dumps({"apiVersion": "batch/v1", "kind": "Job",
    "metadata": {"name": "openverify-ci-seed", "namespace": "openverify", "labels": {"app": "openverify-ci-seed"}},
    "spec": {"backoffLimit": 0, "template": {"metadata": {"labels": {"app": "openverify-ci-seed"}}, "spec": {
        "restartPolicy": "Never", "automountServiceAccountToken": False, "enableServiceLinks": False,
        "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001, "fsGroup": 10001,
                            "seccompProfile": {"type": "RuntimeDefault"}},
        "containers": [{"name": "seed", "image": image, "imagePullPolicy": "Never",
                        "command": ["node", "dist/commands/seed-dev.js", "--json"], "env": env,
                        "securityContext": restricted, "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}]}],
        "volumes": [{"name": "tmp", "emptyDir": {}}]}}}}))
' "openverify/api:$tag"
}

do_smoke() {
  pick_cluster
  smoke 0
  note "passed"
}

do_upgrade() {
  pick_cluster
  find_release
  local since before after
  since=$(date +%s)
  before=$(hc history "$release" -n "$namespace" --max 1 -o json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)[-1]["revision"])' 2>/dev/null)
  # shellcheck disable=SC2046
  hc upgrade "$release" "$chart" --namespace "$namespace" -f "$chart/ci/kind-values.yaml" \
    -f "$chart/ci/upgrade/kind-upgrade-values.yaml" $(tag_sets upgrade) --wait --timeout 480s || die "helm upgrade failed"
  after=$(hc history "$release" -n "$namespace" --max 1 -o json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)[-1]["revision"])')
  [ -n "$before" ] && [ "$after" -gt "$before" ] || die "the revision did not move ($before to $after)"
  [ "$(kc -n "$namespace" get "$(deployment flow)" -o jsonpath='{.spec.template.spec.containers[0].image}')" = "openverify/flow:$tag-noguidance" ] ||
    die "the flow server is not on the no-guidance image"
  note "revision $before to $after; the flow server on openverify/flow:$tag-noguidance"
  smoke "$since"
  note "passed"
}

do_delete() {
  local names name
  if [ -n "$version" ]; then names=$(our_clusters | grep -x "$prefix$version" || true); else names=$(our_clusters); fi
  [ -n "$names" ] || {
    note "no openverify-11c-* cluster to delete"
    return 0
  }
  for name in $names; do
    kind delete cluster --name "$name" || die "kind delete cluster --name $name failed"
    rm -f "$state/$name.kubeconfig"
    note "deleted $name"
  done
}

"do_$subcommand"
note "done in $(($(date +%s) - started))s"
