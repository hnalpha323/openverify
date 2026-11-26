#!/usr/bin/env bash
# Contract test for the build contexts of the production images (Phase 11, Workflow 11C, images-11c:
# C257.3; it covered infra/docker/apps.Dockerfile, the development image these replace). The
# repository root, filtered by .dockerignore, is the context of infra/docker/{api,dashboard,flow,
# code-runner}.Dockerfile; services/vision, filtered by its own .dockerignore, is vision's, with the
# repository root as its named context `repo`, from which it copies models/manifest.json and
# scripts/fetch_models.py only.
#
# The flow image builds the hosted flow, whose Vite plugin copies the pinned YuNet model into the
# bundle and checks it against its pin in models/manifest.json (C46.1, C48). .dockerignore keeps
# models/ out of the context (the other weights are large and belong to the vision image), so
# each file the build reads from models/ must be re-included explicitly. Likewise data/: the API
# reads the files scripts/fetch_data.py downloads (Phase 5, C56), so each is re-included. This
# test evaluates .dockerignore as Docker does (patterns in order, the last match wins, `!`
# re-includes, a pattern that matches a directory covers everything under it) for those files,
# and for a few that must stay out.
#
# Usage: infra/tests/apps-image-context.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

if [ -f "$repo_root/.dockerignore" ]; then ok ".dockerignore exists"; else nok ".dockerignore exists"; finish; fi

# Prints "in <path>" or "out <path>" for each path, as the given .dockerignore decides it.
decide() { decide_with "$repo_root/.dockerignore" "$@"; }
decide_with() {
  python3 -I - "$@" <<'PY'
import fnmatch
import sys

patterns = []
with open(sys.argv[1], encoding="utf-8") as fh:
    for raw in fh:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        pattern = line[1:] if negate else line
        patterns.append((negate, pattern.strip().strip("/")))


def matches(pattern, path):
    # Docker matches a pattern against the path and against each of its parent directories.
    parts = path.split("/")
    candidates = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    for candidate in candidates:
        if pattern.startswith("**/"):
            tail = pattern[3:]
            segments = candidate.split("/")
            if any(fnmatch.fnmatchcase("/".join(segments[i:]), tail) for i in range(len(segments))):
                return True
        if fnmatch.fnmatchcase(candidate, pattern):
            return True
    return False


for path in sys.argv[2:]:
    included = True
    for negate, pattern in patterns:
        if matches(pattern, path):
            included = negate
    print(("in " if included else "out ") + path)
PY
}

# What the flow build reads from models/ (apps/flow/src/vite-plugins/guidance-assets-plugin.ts).
needed=(models/face_detection_yunet_2026may.onnx models/manifest.json)
# Phase 5 (C56, C61.5, C67, F15): what the API reads from data/ at run time, so the image carries
# it: the manifest, the malicious-website feed list and the disposable email list.
needed_data=(data/manifest.json data/malicious-feeds.json data/disposable_email_blocklist.conf)
# Phase 6 (C78.3, F14, C76.6, C80.2, C82): the filtered variant groups the worker and the CLIs load,
# the synthetic sandbox lists seed:dev imports, the PEP position classes and legal forms the
# matcher reads, and the report tables the email, phone and address evaluators read.
needed_reports=(data/variant-groups.json
  packages/watchlist/fixtures/openverify-sandbox.json packages/watchlist/fixtures/openverify-sandbox-pep.json
  packages/watchlist/data/pep-positions.json packages/watchlist/data/legal-forms.json
  packages/checks/data/reports/free-mail-domains.json packages/checks/data/reports/us-zip-prefixes.json
  watchlists/sources.json)
# Workflow 7A (C92.6, ADR 0006): the pinned hosting and VPN ASN seeds (scripts/fetch_data.py) and the
# committed network manifest and overrides, which the API and the worker read.
needed_network=(data/x4bnet-datacenter-ASN.txt data/x4bnet-vpn-ASN.txt data/bad-asn-list.csv
  network/sources.json network/asn-overrides.json)
# ADR 0006: live network data reaches the database and object storage only through the operator's
# sync, and the operator's anonymous-IP file is mounted, never baked in: no MMDB, exit list, range
# file or IP reputation file enters the image.
excluded_network=(data/ip-reputation/change-me-anonymous-ip.mmdb data/dbip-country-lite-2026-10.mmdb
  data/dbip-asn-lite-2026-10.mmdb.gz packages/signals/dbip-city-lite.mmdb data/network/exit-addresses
  data/network/aws-ip-ranges.json)
# What must stay out: the other weights, generated fixtures, raw downloads, secrets, and the
# unfiltered rigour file the variant groups are built from (ADR 0005: only the filtered file ships).
excluded=(models/face_recognition_sface_2021dec.onnx models/MiniFASNetV2.onnx fixtures/generated/selfie/head-turn-a.mjpeg data/raw/street_types.txt .env
  data/rigour-person_names.txt
  # .dockerignore patterns are rooted, unlike .gitignore's: the e2e suite's seeded secrets and the
  # reusable stack's record (mode 0600, gitignored) sit in the build context of a developer's clone.
  e2e/.env.e2e e2e/.artifacts/stack.json apps/api/.env services/vision/.env.local)

while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root build context has $path (the flow build reads it)"; else nok "the root build context has $path (the flow build reads it)" "excluded by .dockerignore"; fi
done < <(decide "${needed[@]}")
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root build context has $path (the API reads it)"; else nok "the root build context has $path (the API reads it)" "excluded by .dockerignore"; fi
done < <(decide "${needed_data[@]}")
while read -r verdict path; do
  if [ "$verdict" = "out" ]; then ok "the root build context leaves out $path"; else nok "the root build context leaves out $path" "included"; fi
done < <(decide "${excluded[@]}")
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root build context has $path (reports read it)"; else nok "the root build context has $path (reports read it)" "excluded by .dockerignore"; fi
done < <(decide "${needed_reports[@]}")
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root build context has $path (network facts read it)"; else nok "the root build context has $path (network facts read it)" "excluded by .dockerignore"; fi
done < <(decide "${needed_network[@]}")
while read -r verdict path; do
  if [ "$verdict" = "out" ]; then ok "the root build context leaves out network data: $path"; else nok "the root build context leaves out network data: $path" "included"; fi
done < <(decide "${excluded_network[@]}")
# The image checks each ASN seed against its pin, as the disposable list, and fetches nothing.
for seed in x4bnet-datacenter-ASN.txt x4bnet-vpn-ASN.txt bad-asn-list.csv; do
  seed_pin=$(python3 -I - "$repo_root/data/manifest.json" "$seed" <<'PY3'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    entries = json.load(fh)["data"]
print(next(e["sha256"] for e in entries if e["filename"] == sys.argv[2]))
PY3
)
  if grep -Fq "$seed_pin  data/$seed" "$repo_root/infra/docker/api.Dockerfile"; then
    ok "the API image checks data/$seed against its pin in data/manifest.json"
  else
    nok "the API image checks data/$seed against its pin in data/manifest.json"
  fi
done
# Instructions only: the comments may name what stays out.
network_lines=$(grep -Ev '^[[:space:]]*#' "$repo_root/infra/docker/api.Dockerfile" |
  grep -Ei 'mmdb|ip-reputation|db-ip|torproject|ip-ranges|network:sync' | head -n 3)
if [ -n "$network_lines" ]; then
  nok "the API Dockerfile bakes in or fetches no network data" "$network_lines"
else
  ok "the API Dockerfile bakes in or fetches no network data"
fi

# Phase 5 (C56, F15): the image carries the disposable list it was built with, checked against
# the digest data/manifest.json pins, as the YuNet model is; and C62.7: the trust-anchor manifest
# the worker's refresh job reads.
dockerfile="$repo_root/infra/docker/api.Dockerfile"
pin=$(python3 -I - "$repo_root/data/manifest.json" <<'PY2'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    entries = json.load(fh)["data"]
print(next(e["sha256"] for e in entries if e["filename"] == "disposable_email_blocklist.conf"))
PY2
)
if grep -Fq "$pin  data/disposable_email_blocklist.conf" "$dockerfile"; then
  ok "the API image checks the disposable list against its pin in data/manifest.json"
else
  nok "the API image checks the disposable list against its pin in data/manifest.json"
fi
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root build context has $path (the worker reads it)"; else nok "the root build context has $path (the worker reads it)" "excluded by .dockerignore"; fi
done < <(decide trust-anchors/manifest.json)

# C78.3 (F14): the image checks the variant groups against the digest the matcher ships with
# (SHIPPED_VARIANT_GROUPS_SHA256), so a build with another file fails instead of every person-name
# report erroring matcher_data_unavailable.
groups_pin=$(sed -n "s/^  '\([0-9a-f]\{64\}\)';$/\1/p" "$repo_root/packages/watchlist/src/keys/variant-groups.ts" | head -n 1)
if [ -n "$groups_pin" ] && grep -Fq "$groups_pin  data/variant-groups.json" "$dockerfile"; then
  ok "the API image checks the variant groups against SHIPPED_VARIANT_GROUPS_SHA256"
else
  nok "the API image checks the variant groups against SHIPPED_VARIANT_GROUPS_SHA256" "pin '${groups_pin}'"
fi

# The flow image re-checks the YuNet model the guidance serves (C46.1, C48).
yunet_pin=$(python3 -I -c 'import json,sys; print(next(m["sha256"] for m in json.load(open(sys.argv[1]))["models"] if m["filename"] == "face_detection_yunet_2026may.onnx"))' "$repo_root/models/manifest.json")
if grep -Fq "$yunet_pin  models/face_detection_yunet_2026may.onnx" "$repo_root/infra/docker/flow.Dockerfile"; then ok "the flow image checks YuNet against its pin in models/manifest.json"; else nok "the flow image checks YuNet against its pin in models/manifest.json"; fi
# No image builds from the retired development Dockerfile, and no runtime stage copies e2e/.
if [ -e "$repo_root/infra/docker/apps.Dockerfile" ]; then nok "infra/docker/apps.Dockerfile is gone (the five images replace it)"; else ok "infra/docker/apps.Dockerfile is gone (the five images replace it)"; fi
for df in infra/docker/api.Dockerfile infra/docker/dashboard.Dockerfile infra/docker/flow.Dockerfile infra/docker/code-runner.Dockerfile services/vision/Dockerfile; do
  if grep -Ev '^[[:space:]]*#' "$repo_root/$df" | grep -Eq '(COPY|ADD)[^#]*\be2e/'; then nok "$df copies nothing from e2e/"; else ok "$df copies nothing from e2e/"; fi
done

# Vision's own context (services/vision/.dockerignore) and the two files it takes from `repo`.
vision_ignore="$repo_root/services/vision/.dockerignore"
while read -r verdict path; do
  if [ "$verdict" = "out" ]; then ok "the vision context leaves out $path"; else nok "the vision context leaves out $path" "included"; fi
done < <(decide_with "$vision_ignore" .env .env.local tests/test_app.py tools/make_fixtures.py .venv/bin/python \
  models/face_detection_yunet_2026may.onnx data/dbip-country-lite-2026-10.mmdb data/dbip-asn-lite-2026-10.mmdb.gz)
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the vision context has $path"; else nok "the vision context has $path" "excluded"; fi
done < <(decide_with "$vision_ignore" pyproject.toml uv.lock src/openverify_vision/app.py NOTICE licenses/onnxruntime/EIGEN-SOURCE.txt)
from_repo=$(grep -Eo 'COPY --from=repo [^ ]+' "$repo_root/services/vision/Dockerfile" | awk '{print $3}' | sort | paste -sd' ' -)
if [ "$from_repo" = "models/manifest.json scripts/fetch_models.py" ]; then ok "vision takes only models/manifest.json and scripts/fetch_models.py from repo"; else nok "vision takes only models/manifest.json and scripts/fetch_models.py from repo" "$from_repo"; fi
while read -r verdict path; do
  if [ "$verdict" = "in" ]; then ok "the root context has $path (vision's repo context)"; else nok "the root context has $path (vision's repo context)" "excluded"; fi
done < <(decide models/manifest.json scripts/fetch_models.py)

# The guidance plugin reads exactly these models/ paths, so a new one fails here first.
plugin="$repo_root/apps/flow/src/vite-plugins/guidance-assets-plugin.ts"
if grep -q "'models', 'manifest.json'" "$plugin"; then ok "the guidance plugin reads models/manifest.json"; else nok "the guidance plugin reads models/manifest.json"; fi

finish
