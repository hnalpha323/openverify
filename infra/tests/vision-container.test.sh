#!/usr/bin/env bash
# Contract test for the vision service's isolation and image (Phase 5, C60.2, C60.3).
#
# Vision parses hostile PDFs and JPEG 2000 portraits in a guarded child. Two of the three layers
# that contain a compromised parse are the container and the network, checked here:
#
# Static checks (always run), on `docker compose --profile app config`:
#   - vision sits on its own network `vision`, which is internal (no route out, no gateway), and on
#     no other; only the API and the worker share it, and they keep the default network too;
#     Postgres, Valkey, the object store, Mailpit, the flow, the dashboard and migrate stay off it;
#   - vision runs as uid 10001, on a read-only root filesystem with a tmpfs /tmp (the multipart
#     spool), every capability dropped, no-new-privileges, Docker's default seccomp profile (never
#     `unconfined`), no published port and a memory limit;
#   - services/vision/Dockerfile runs as 10001 and installs no jbig2dec.
# Live checks (skipped with --static-only), in their own compose project
# (`openverify-vision-isolation`, removed with its volumes at the end; nothing else is touched):
#   - the vision image is built, Postgres and vision started, and a probe runs inside a second
#     vision container with its own compose settings: it reaches the running vision on their
#     network (the control: the probe can connect where the network allows), `postgres` does not
#     resolve and Postgres' address cannot be reached; it runs as 10001 with no effective capability, no-new-privileges and a seccomp
#     filter; / is read-only and /tmp writable; pypdfium2 and pypdf import at their pins and no
#     jbig2dec binary exists;
#   - Docker reports the `vision` network internal;
#   - inside a vision container, the guarded child that every PDF runs in (Workflow 5C review
#     P019): started as vision starts it, it reads back the C60.2 rlimits, no-new-privileges, an
#     empty environment, no fork and no thread, loads no pydantic, NumPy, OpenCV or onnxruntime,
#     and cannot read its non-dumpable parent's /proc entries; then one real PDF, written by the
#     probe, is analysed through the running vision (200, a PDF of one page, its visible text and
#     the OCR of it).
# No probe leaves the host: the only addresses tried are Postgres' and vision's, on the project's
# own networks. CI runs the static half only (the `infra` job); the live half needs the vision
# image built and the model weights (python3 scripts/fetch_models.py).
#
# Usage: infra/tests/vision-container.test.sh [--static-only]
# Env:   ENV_FILE  env file to use (default: <repo>/.env.example)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
compose_file="$repo_root/infra/docker-compose.yml"
env_file="${ENV_FILE:-$repo_root/.env.example}"
dockerfile="$repo_root/services/vision/Dockerfile"
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
expect_eq() { # expect_eq <description> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "expected '$2', got '$3'"; fi
}
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

# ---------------------------------------------------------------- static ----
if config=$(docker compose -f "$compose_file" --env-file "$env_file" --profile app config --format json 2>&1); then
  ok "compose config renders with --profile app"
else
  nok "compose config renders with --profile app" "$config"
  finish
fi
has() { jq -e "$1" >/dev/null <<<"$config"; }

expect "the vision network is internal (no route out)" has '.networks.vision.internal == true'
expect_eq "vision is on the vision network only" '["vision"]' \
  "$(jq -c '.services.vision.networks // {} | keys' <<<"$config")"
for s in api worker; do
  expect "$s shares the vision network and keeps the default one" \
    has ".services.$s.networks // {} | has(\"vision\") and has(\"default\")"
done
for s in postgres redis objectstore objectstore-init mailpit migrate flow dashboard; do
  expect "$s is not on the vision network" \
    has "(.services[\"$s\"].networks // {} | has(\"vision\")) | not"
done
expect_eq "vision runs as uid 10001" "10001:10001" "$(jq -r '.services.vision.user // ""' <<<"$config")"
expect "vision's root filesystem is read-only" has '.services.vision.read_only == true'
expect "vision has a tmpfs /tmp for its upload spool" \
  has '[.services.vision.tmpfs[]? | select(startswith("/tmp"))] | length == 1'
expect_eq "vision drops every capability" '["ALL"]' "$(jq -c '.services.vision.cap_drop // []' <<<"$config")"
expect "vision runs with no-new-privileges" \
  has '[.services.vision.security_opt[]? | select(. == "no-new-privileges:true")] | length == 1'
expect "vision keeps Docker's default seccomp profile (no unconfined profile)" \
  has '[.services.vision.security_opt[]? | select(test("unconfined"))] | length == 0'
expect "vision is not privileged" has '.services.vision.privileged != true'
expect "vision publishes no host port" has '(.services.vision.ports // []) | length == 0'
expect "vision has a memory limit" has '(.services.vision.mem_limit // "") != ""'
if grep -Eq '^USER 10001:10001$' "$dockerfile"; then
  ok "the vision image runs as 10001"
else
  nok "the vision image runs as 10001"
fi
if grep -qi 'jbig2dec' "$dockerfile"; then
  nok "the vision image installs no jbig2dec"
else
  ok "the vision image installs no jbig2dec"
fi

if $static_only; then finish; fi

# ------------------------------------------------------------------ live ----
project=openverify-vision-isolation
# Postgres on a random loopback port, so a developer's own Postgres on 5432 is no obstacle, and a
# throwaway service token of the length vision requires (the env file's is a placeholder).
token=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
pc() {
  POSTGRES_PORT=0 OPENVERIFY_VISION_SERVICE_TOKEN="$token" \
    docker compose -p "$project" -f "$compose_file" --env-file "$env_file" --profile app "$@"
}
cleanup() { pc down --volumes --remove-orphans >/dev/null 2>&1; }
trap cleanup EXIT INT TERM

if build_out=$(pc build vision 2>&1); then
  ok "the vision image builds"
else
  nok "the vision image builds" "$(tail -n 5 <<<"$build_out" | tr '\n' ' ')"
  finish
fi
if up_out=$(pc up -d --wait --wait-timeout 120 postgres 2>&1); then
  ok "postgres starts in the test project"
else
  nok "postgres starts in the test project" "$(tail -n 5 <<<"$up_out" | tr '\n' ' ')"
  finish
fi
if up_out=$(pc up -d --wait --wait-timeout 120 --no-deps vision 2>&1); then
  ok "vision starts healthy in the test project"
else
  nok "vision starts healthy in the test project" "$(tail -n 5 <<<"$up_out" | tr '\n' ' ')"
  finish
fi
postgres_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \
  "$(pc ps -q postgres)" | awk '{print $1}')
expect "postgres has an address on the project network" test -n "$postgres_ip"

read -r -d '' probe <<'PY'
import os, shutil, socket, sys, tempfile

def attempt(action):
    try:
        action()
        return "yes"
    except OSError:
        return "no"

status = {}
for line in open("/proc/self/status", encoding="ascii"):
    key, _, value = line.partition(":")
    status[key] = value.strip()

def connect():
    with socket.create_connection((sys.argv[1], 5432), timeout=3):
        pass

def connect_peer():
    with socket.create_connection(("vision", 8000), timeout=3):
        pass

def write_root():
    with open("/app/.probe", "w", encoding="ascii") as handle:
        handle.write("x")

def write_tmp():
    with tempfile.NamedTemporaryFile(dir="/tmp"):
        pass

import pypdf, pypdfium2

print("reaches-vision-peer=" + attempt(connect_peer))
print("resolves-postgres=" + attempt(lambda: socket.getaddrinfo("postgres", 5432)))
print("reaches-postgres=" + attempt(connect))
print("uid=" + str(os.getuid()))
print("cap-eff=" + status.get("CapEff", ""))
print("no-new-privs=" + status.get("NoNewPrivs", ""))
print("seccomp=" + status.get("Seccomp", ""))
print("root-writable=" + attempt(write_root))
print("tmp-writable=" + attempt(write_tmp))
print("pypdf=" + pypdf.__version__)
print("pypdfium2=" + pypdfium2.version.PYPDFIUM_INFO.version)
print("jbig2dec=" + ("present" if shutil.which("jbig2dec") else "absent"))
PY

if answers=$(pc run --rm --no-deps -T --entrypoint python vision -I -c "$probe" "$postgres_ip" 2>&1); then
  ok "the probe runs inside the vision container"
else
  nok "the probe runs inside the vision container" "$(tail -n 5 <<<"$answers" | tr '\n' ' ')"
  finish
fi
answer() { sed -n "s/^$1=//p" <<<"$answers" | tail -n 1; }
expect_eq "the probe reaches the running vision on their network (the control)" "yes" \
  "$(answer reaches-vision-peer)"
expect_eq "vision cannot resolve postgres" "no" "$(answer resolves-postgres)"
expect_eq "vision cannot reach postgres' address" "no" "$(answer reaches-postgres)"
expect_eq "vision runs as uid 10001" "10001" "$(answer uid)"
expect_eq "vision holds no effective capability" "0000000000000000" "$(answer cap-eff)"
expect_eq "vision runs with no-new-privileges" "1" "$(answer no-new-privs)"
expect_eq "vision runs under a seccomp filter (Docker's default profile)" "2" "$(answer seccomp)"
expect_eq "vision cannot write its root filesystem" "no" "$(answer root-writable)"
expect_eq "vision can write /tmp" "yes" "$(answer tmp-writable)"
expect_eq "the vision image carries pypdf 6.21.4" "6.21.4" "$(answer pypdf)"
expect_eq "the vision image carries pypdfium2 5.14.0" "5.14.0" "$(answer pypdfium2)"
expect_eq "the vision image has no jbig2dec" "absent" "$(answer jbig2dec)"
expect_eq "Docker reports the vision network internal" "true" \
  "$(docker network inspect -f '{{.Internal}}' "${project}_vision" 2>/dev/null)"

# Workflow 5C review P019: the guard itself inside the image, as vision starts it: a fresh
# `python -I -B -m openverify_vision.guarded.worker` with an empty environment, from a parent made
# non-dumpable as create_app makes it, on the read-only root as uid 10001. Then one real PDF
# analysis through the running vision, whose child must answer there too, or every PDF would be
# a 503 in the container while the unit suite stays green.
read -r -d '' guard_probe <<'PY'
import json, os, urllib.error, urllib.request
from openverify_vision.guarded.runner import protect_parent, run_guarded

protect_parent()
report = run_guarded("probe", params={"import_tasks": True, "read_parent": True}).header["probe"]
parent = report["parent"] or {}
print("guard-rlimits=" + json.dumps(report["rlimits"], sort_keys=True, separators=(",", ":")))
print("guard-no-new-privs=" + str(report["no_new_privs"]))
print("guard-environ=" + json.dumps(report["environ"]))
print("guard-fork-refused=" + json.dumps(report["fork_refused"]))
print("guard-thread-refused=" + json.dumps(report["thread_refused"]))
print("guard-heavy-modules=" + json.dumps(sorted({"cv2", "numpy", "onnxruntime", "pydantic"} & set(report["modules"]))))
print("guard-parent-readable=" + json.dumps([key for key in ("environ_readable", "token_seen", "fds_readable") if parent.get(key) is not False]))

def pdf(text):
    """A one-page born-digital PDF drawing `text` in Helvetica, written out by hand."""
    content = b"BT /F1 24 Tf 72 700 Td (" + text.encode("ascii") + b") Tj ET"
    bodies = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream",
    ]
    out, offsets = bytearray(b"%PDF-1.7\n"), []
    for number, body in enumerate(bodies, start=1):
        offsets.append(len(out))
        out += str(number).encode("ascii") + b" 0 obj\n" + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(bodies) + 1).encode("ascii") + b"\n0000000000 65535 f \n"
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size " + str(len(bodies) + 1).encode("ascii") + b" /Root 1 0 R >>\n"
    out += b"startxref\n" + str(xref).encode("ascii") + b"\n%%EOF\n"
    return bytes(out)

boundary = "openverify-probe-" + os.urandom(8).hex()
body = (
    ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"document\"; filename=\"probe.pdf\"\r\n"
     "Content-Type: application/pdf\r\n\r\n").encode("ascii")
    + pdf("OpenVerify isolation probe")
    + ("\r\n--" + boundary + "--\r\n").encode("ascii")
)
request = urllib.request.Request(
    "http://vision:8000/v1/analyze/document",
    data=body,
    method="POST",
    headers={
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "x-service-token": os.environ["OPENVERIFY_VISION_SERVICE_TOKEN"],
    },
)
try:
    with urllib.request.urlopen(request, timeout=90) as response:
        status, analysis = response.status, json.load(response)
except urllib.error.HTTPError as error:
    status, analysis = error.code, {}
pages = analysis.get("pages") or [{}]
print("analysis-status=" + str(status))
print("analysis-source=" + str(analysis.get("source")))
print("analysis-page-count=" + str(analysis.get("page_count")))
print("analysis-visible-text=" + json.dumps([line["text"] for line in pages[0].get("text_layer", []) if line["visible"]]))
print("analysis-ocr-read=" + json.dumps(pages[0].get("text_layer_ocr_agreement") is not None))
PY

if guard=$(pc run --rm --no-deps -T --entrypoint python vision -I -c "$guard_probe" 2>&1); then
  ok "the guarded probe and a PDF analysis run from inside a vision container"
else
  nok "the guarded probe and a PDF analysis run from inside a vision container" \
    "$(tail -n 5 <<<"$guard" | tr '\n' ' ')"
  finish
fi
guarded() { sed -n "s/^$1=//p" <<<"$guard" | tail -n 1; }
# C60.2: 1.5 GiB of address space, 20 s of CPU (SIGKILL one second later), no file growth, no
# core dump, 64 open files, no process or thread.
expect_eq "the guarded child reads back its C60.2 rlimits in the image" \
  '{"as":[1610612736,1610612736],"core":[0,0],"cpu":[20,21],"fsize":[0,0],"nofile":[64,64],"nproc":[0,0]}' \
  "$(guarded guard-rlimits)"
expect_eq "the guarded child runs with no-new-privileges in the image" "1" "$(guarded guard-no-new-privs)"
expect_eq "the guarded child starts with an empty environment in the image" "[]" "$(guarded guard-environ)"
expect_eq "the guarded child cannot fork in the image" "true" "$(guarded guard-fork-refused)"
expect_eq "the guarded child cannot start a thread in the image" "true" "$(guarded guard-thread-refused)"
expect_eq "the guarded child loads no pydantic, NumPy, OpenCV or onnxruntime with every task" "[]" \
  "$(guarded guard-heavy-modules)"
expect_eq "the guarded child cannot read its non-dumpable parent's environ or fds (P018)" "[]" \
  "$(guarded guard-parent-readable)"
expect_eq "the running vision analyses a real PDF (200)" "200" "$(guarded analysis-status)"
expect_eq "the analysis reads it as a PDF" "pdf" "$(guarded analysis-source)"
expect_eq "the analysis counts its one page" "1" "$(guarded analysis-page-count)"
expect_eq "the guarded child reads its visible text layer" '["OpenVerify isolation probe"]' \
  "$(guarded analysis-visible-text)"
expect_eq "vision's OCR reads the line the text layer drew" "true" "$(guarded analysis-ocr-read)"

finish
