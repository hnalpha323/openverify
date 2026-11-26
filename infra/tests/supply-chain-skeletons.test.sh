#!/usr/bin/env bash
# Contract test for Workflow 11C Stage 1a's frozen supply-chain skeletons (contracts-11c):
#
#   1. infra/scripts/install-<tool>.sh for every tool 11C installs: version and SHA-256 pins with the
#      values read on 2026-11-14 (THIRD_PARTY_LICENSES.md section 1), and vegeta's, read on
#      2026-11-16 by Workflow 11D's contracts-11d (C258.3; load-harness fills it), in install-gitleaks.sh's
#      pattern. While an installer still carries the OPENVERIFY_SKELETON marker it fails closed:
#      a non-zero exit naming "not built" and nothing written. scanners-11c fills each one (and
#      removes the marker), test-first in its own infra/tests/install-<tool>.test.sh.
#   2. security/allowlist.yaml (an empty list) and security/allowlist.schema.json (C259.2).
#   3. .github/workflows/release.yml (C267.1): dispatch on main with a version, read-only token,
#      the jobs build, verify, stage and publish, publish behind the environment `release` and
#      vars.OPENVERIFY_PUBLISH == 'true', every action pinned by commit, no persisted credentials.
#      While it carries the OPENVERIFY_SKELETON marker every job ends with a "not built" notice;
#      sbom-release-11c fills it and moves its checks to infra/tests/release-workflow.test.sh.
#
# Usage: infra/tests/supply-chain-skeletons.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
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

# ------------------------------------------------------------ installers ----
# tool | variable prefix | pinned version | pinned SHA-256 of the linux x86_64 asset
pins=$(
  cat <<'EOF'
cosign|COSIGN|3.1.3|4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71
helm|HELM4|4.3.1|0403a88ae20913d11b10a2467b50087721fea7581736da6b9d3992f5357fe54b
helm|HELM3|3.22.1|896cf63684a42a723d61c980369d6e588330927deb13676ca0d85006dd6da0ea
helm-unittest|HELM_UNITTEST|1.2.1|48e86ecc1467b009630e5954375e5d8494139f73b466df5fe8c04fa45b634939
kubeconform|KUBECONFORM|0.8.0|9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
chart-testing|CHART_TESTING|3.15.0|467561730f25fe09d5e6cd09a3e1f6aa759871c657a57602947c716d9be2c583
kind|KIND|0.33.0|aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d
kubectl|KUBECTL|1.35.9|3cfeaf80be482b435b0aa214aff6e0b2c312ee23c0ff20810c75517b6004c6eb
trivy|TRIVY|0.76.0|e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7
syft|SYFT|1.54.1|c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47
grype|GRYPE|0.120.1|0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d
osv-scanner|OSV_SCANNER|2.7.0|160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
zizmor|ZIZMOR|1.31.1|d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99
vegeta|VEGETA|12.13.0|e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61
EOF
)

while IFS='|' read -r tool prefix version sha; do
  script="$repo_root/infra/scripts/install-$tool.sh"
  if [ ! -f "$script" ]; then
    nok "install-$tool.sh exists"
    continue
  fi
  if [ -x "$script" ]; then ok "install-$tool.sh is executable"; else nok "install-$tool.sh is executable"; fi
  if grep -qx 'set -euo pipefail' "$script"; then ok "install-$tool.sh runs with set -euo pipefail"; else nok "install-$tool.sh runs with set -euo pipefail"; fi
  if grep -qx "${prefix}_VERSION_DEFAULT=\"$version\"" "$script"; then
    ok "install-$tool.sh pins ${prefix} $version"
  else
    nok "install-$tool.sh pins ${prefix} $version"
  fi
  if grep -qx "${prefix}_SHA256_DEFAULT=\"$sha\"" "$script"; then
    ok "install-$tool.sh pins ${prefix}'s SHA-256"
  else
    nok "install-$tool.sh pins ${prefix}'s SHA-256"
  fi
done <<<"$pins"

# The extra pins: the Trivy checks bundle, kind's node images and kubeconform's schema converter.
expect_line() {
  local file=$1 line=$2 desc=$3
  if grep -qxF "$line" "$repo_root/$file" 2>/dev/null; then ok "$desc"; else nok "$desc"; fi
}
expect_line infra/scripts/install-trivy.sh 'TRIVY_CHECKS_BUNDLE_DEFAULT="ghcr.io/aquasecurity/trivy-checks:2.3.0@sha256:3eae4436560566e77115396d0221a64e0cd86d94a3b45203f8ae3f9a85c027cd"' \
  "install-trivy.sh pins the checks bundle 2.3.0 by digest"
expect_line infra/scripts/install-kind.sh 'KIND_NODE_IMAGE_1_35="kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0"' \
  "install-kind.sh names the 1.35 node image by digest"
expect_line infra/scripts/install-kind.sh 'KIND_NODE_IMAGE_1_37="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"' \
  "install-kind.sh names the 1.37 node image by digest"
expect_line infra/scripts/install-kubeconform.sh 'KUBECONFORM_SCHEMA_CONVERTER_SHA256="d145babfbb765004030764e1b4e518bfb7a4bd7f111691a08fa57983b81881f3"' \
  "install-kubeconform.sh pins its schema converter script at the release's commit"

# Fail closed while a skeleton: non-zero, "not built", nothing written.
for script in "$repo_root"/infra/scripts/install-*.sh; do
  name=$(basename "$script")
  [ "$name" = "install-gitleaks.sh" ] && continue
  if ! grep -q '^OPENVERIFY_SKELETON=1$' "$script"; then
    skip "$name is no longer a skeleton (its own installer test holds it)"
    continue
  fi
  dir=$(mktemp -d)
  out=$(INSTALL_DIR="$dir" HELM_PLUGINS="$dir/plugins" bash "$script" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && grep -q 'not built' <<<"$out" && [ -z "$(ls -A "$dir")" ]; then
    ok "$name fails closed as a skeleton (exit $rc, nothing written)"
  else
    nok "$name fails closed as a skeleton" "exit $rc: $out"
  fi
  rm -rf "$dir"
done

# ------------------------------------------------------------- allowlist ----
allowlist_out=$(python3 -I - "$repo_root/security/allowlist.yaml" "$repo_root/security/allowlist.schema.json" <<'PY'
import json
import sys

import yaml


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - allowlist: " + desc + ("" if cond or not detail else f" ({detail})"))


try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        entries = yaml.safe_load(fh)
    check("security/allowlist.yaml parses as YAML", True)
except (OSError, yaml.YAMLError) as exc:
    check("security/allowlist.yaml parses as YAML", False, str(exc).replace("\n", " "))
    entries = None
# Empty at Stage 1a; later entries are reviewed exceptions, each with its id, package or path, reason,
# expiry and author (the 90-day rule and the schema are infra/scripts/supply-chain.sh allowlist's).
check("security/allowlist.yaml is a list of reviewed entries (id, package or path, reason, expires, added-by)",
      isinstance(entries, list) and all(isinstance(e, dict) and {"id", "reason", "expires", "added-by"} <= set(e)
                                        and (("package" in e) != ("path" in e)) for e in entries),
      repr(entries)[:200])
try:
    with open(sys.argv[2], encoding="utf-8") as fh:
        schema = json.load(fh)
    check("security/allowlist.schema.json parses as JSON", True)
except (OSError, json.JSONDecodeError) as exc:
    check("security/allowlist.schema.json parses as JSON", False, str(exc))
    sys.exit(0)
item = schema.get("items", {})
check("the schema is draft 2020-12", schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema")
check("the allowlist is an array of entries", schema.get("type") == "array" and item.get("type") == "object")
check(
    "an entry requires id, reason, expires and added-by",
    set(item.get("required", [])) == {"id", "reason", "expires", "added-by"},
    str(item.get("required")),
)
check("an entry names a package or a path", item.get("oneOf") == [{"required": ["package"]}, {"required": ["path"]}])
check("an entry has no other member", item.get("additionalProperties") is False)
props = item.get("properties", {})
check("expires is a date", props.get("expires", {}).get("format") == "date" and props.get("expires", {}).get("type") == "string")
check("the 90-day bound is stated (the gate enforces it)", "90 days" in props.get("expires", {}).get("description", ""))
check("a reason is not empty", props.get("reason", {}).get("minLength", 0) >= 10)
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) passed=$((passed + 1)); printf '%s\n' "$line" ;;
    "FAIL - "*) failed=$((failed + 1)); printf '%s\n' "$line" ;;
    *) [ -n "$line" ] && printf '%s\n' "$line" ;;
  esac
done <<<"$allowlist_out"

# ------------------------------------------------------------ release.yml ----
release="$repo_root/.github/workflows/release.yml"
if [ ! -f "$release" ]; then
  nok ".github/workflows/release.yml exists"
  finish
fi
ok ".github/workflows/release.yml exists"
release_out=$(python3 -I - "$release" <<'PY'
import re
import sys

import yaml


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - release.yml: " + desc + ("" if cond or not detail else f" ({detail})"))


text = open(sys.argv[1], encoding="utf-8").read()
try:
    wf = yaml.safe_load(text)
    assert isinstance(wf, dict)
except (yaml.YAMLError, AssertionError) as exc:
    check("parses as YAML", False, str(exc).replace("\n", " "))
    sys.exit(0)
check("parses as YAML", True)
on = wf.get(True, wf.get("on", {}))
check("runs on workflow_dispatch only", isinstance(on, dict) and list(on) == ["workflow_dispatch"], str(on))
version = ((on or {}).get("workflow_dispatch") or {}).get("inputs", {}).get("version", {})
check("takes a required input `version`", version.get("required") is True and version.get("type") == "string")
check("holds a read-only token at the top", wf.get("permissions") == {"contents": "read"}, str(wf.get("permissions")))
jobs = wf.get("jobs", {})
check("declares the jobs build, verify, stage and publish", list(jobs) == ["build", "verify", "stage", "publish"], str(list(jobs)))
check("verify needs build", jobs.get("verify", {}).get("needs") == "build")
check("stage needs verify", jobs.get("stage", {}).get("needs") == "verify")
check("publish needs stage", jobs.get("publish", {}).get("needs") == "stage")
guard = jobs.get("build", {}).get("if", "")
check("build runs only on main", "github.ref == 'refs/heads/main'" in guard, guard)
publish = jobs.get("publish", {})
environment = publish.get("environment")
check("publish runs in the environment `release`", environment == "release" or (isinstance(environment, dict) and environment.get("name") == "release"), str(environment))
check("publish runs only when vars.OPENVERIFY_PUBLISH is 'true'", "vars.OPENVERIFY_PUBLISH == 'true'" in str(publish.get("if", "")), str(publish.get("if")))
# C262.1 (sbom-release-11c's borrowed edit): only the owner-gated publish job holds its own token,
# and only what keyless signing, the registry push and the provenance attestation need.
PUBLISH_PERMISSIONS = {"contents": "read", "id-token": "write", "packages": "write", "attestations": "write"}
for name, job in jobs.items():
    perms = job.get("permissions")
    if name == "publish":
        check("publish widens only id-token, packages and attestations (C262.1)", perms in (None, {"contents": "read"}, PUBLISH_PERMISSIONS), str(perms))
    else:
        check(f"{name} widens no permission", perms in (None, {"contents": "read"}), str(perms))
    for step in job.get("steps", []):
        uses = step.get("uses")
        if uses is None:
            continue
        if uses.startswith("./"):
            continue
        check(f"{name}: {uses.split('@')[0]} is pinned to a commit", re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", uses) is not None, uses)
        if uses.startswith("actions/checkout@"):
            check(f"{name}: checkout persists no credentials", (step.get("with") or {}).get("persist-credentials") is False)
pinned_comment = all(re.search(r"@[0-9a-f]{40} # v\d", line) for line in text.splitlines() if re.search(r"^\s*-?\s*uses: [^.]", line))
check("every pinned action carries its version tag in a comment", pinned_comment)
check("references no secret", "secrets." not in text)
if re.search(r"^# OPENVERIFY_SKELETON$", text, re.M):
    for name, job in jobs.items():
        steps = job.get("steps", [])
        last = (steps[-1].get("run", "") if steps else "")
        check(f"{name} ends with a notice that the stage is not built", "::notice" in last and "not built" in last, last)
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) passed=$((passed + 1)); printf '%s\n' "$line" ;;
    "FAIL - "*) failed=$((failed + 1)); printf '%s\n' "$line" ;;
    *) [ -n "$line" ] && printf '%s\n' "$line" ;;
  esac
done <<<"$release_out"
if command -v actionlint >/dev/null 2>&1; then
  if lint_out=$(cd "$repo_root" && actionlint .github/workflows/release.yml 2>&1); then
    ok "release.yml: actionlint reports no problems"
  else
    nok "release.yml: actionlint reports no problems" "$(head -n 10 <<<"$lint_out" | tr '\n' ' ')"
  fi
else
  skip "release.yml: actionlint not installed"
fi

finish
