#!/usr/bin/env bash
# Contract test for .github/workflows/release.yml (C267.1, C262, C261.3; Workflow 11C,
# sbom-release-11c). The workflow is started by hand on `main` by the orchestrator only, and never
# while the owner has no Actions minutes (rule 27), so this test holds what a dispatch would do:
#
#   1. its shape: dispatch on main with a version, a read-only token, the four jobs build, verify,
#      stage and publish, every action pinned by commit as the other workflows pin it, no
#      third-party scanner action, no persisted credentials, no secret, no expression inside a script;
#   2. build: the version checked first, the five images for linux/amd64 with the flow's no-guidance
#      variant, the chart package and the three npm tarballs;
#   3. verify: Trivy image and Grype on each image under the allowlist, with fresh vulnerability
#      databases; Syft SBOMs of every image, source tree and tarball; the licence check over each;
#      the chart's kind install and upgrade on 1.35 and 1.37; gitleaks and the forbidden-file search
#      over every artifact's unpacked contents; no DAST;
#   4. stage: SHA256SUMS, the pending-owner names and the 30-day workflow artifacts, and a notice
#      that nothing was published;
#   5. publish: behind the environment `release` and vars.OPENVERIFY_PUBLISH, with its own
#      permissions, refusing a pending-owner artifact, cosign and the provenance action only here;
#      since Workflow 11G (publish-11g; Q1-Q4 granted 2026-11-21) also: a `dry-run` input that
#      defaults to true, its own main check and concurrency group, the staged bytes checked against
#      SHA256SUMS and the build's image ids, each image pushed by digest and signed keyless, the
#      chart pushed as an OCI artifact, provenance by digest and the npm tarballs published by pnpm
#      with provenance and no stored token; its run steps are executed with stub tools, so a dry
#      run is shown to push, sign, attest and publish nothing and a real run to publish exactly the
#      staged files;
#   6. actionlint and zizmor (when installed) report nothing.
#
# Usage: infra/tests/release-workflow.test.sh
# Env:   SUPPLY_CHAIN_TOOLS_DIR (where zizmor is looked for before PATH; default ~/.local/bin)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
release="$repo_root/.github/workflows/release.yml"
passed=0
failed=0
skipped=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
skip() { printf 'skip - %s\n' "$1"; skipped=$((skipped + 1)); }
skip_unless_ci() { if [ "${CI:-}" = "true" ]; then nok "$1" "required in CI"; else skip "$1"; fi; }
finish() {
  printf '\n# %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

if [ -f "$release" ]; then ok ".github/workflows/release.yml exists"; else nok ".github/workflows/release.yml exists"; finish; fi

structure=$(python3 -I - "$release" "$repo_root" <<'PY'
import datetime
import glob
import json
import os
import re
import sys

import yaml

release_path, repo_root = sys.argv[1], sys.argv[2]
results = []


def check(desc, cond, detail=""):
    results.append(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


with open(release_path, encoding="utf-8") as fh:
    text = fh.read()
try:
    wf = yaml.safe_load(text)
    assert isinstance(wf, dict)
except (yaml.YAMLError, AssertionError) as exc:
    print("FAIL - release.yml parses as YAML (" + str(exc).replace("\n", " ") + ")")
    sys.exit(0)
check("release.yml parses as YAML", True)

# ------------------------------------------------------------------ shape ----
triggers = wf.get("on", wf.get(True))
check("it starts on workflow_dispatch only", isinstance(triggers, dict) and list(triggers) == ["workflow_dispatch"], str(triggers))
version_input = ((triggers or {}).get("workflow_dispatch") or {}).get("inputs", {}).get("version") or {}
check("the dispatch asks for the version, a required string", version_input.get("required") is True and version_input.get("type") == "string")
dispatch_inputs = ((triggers or {}).get("workflow_dispatch") or {}).get("inputs") or {}
dry_input = dispatch_inputs.get("dry-run") or {}
check("the dispatch has a dry-run input, a boolean that defaults to true, so a dispatch is a dry run unless it says false (Workflow 11G)",
      dry_input.get("type") == "boolean" and dry_input.get("default") is True and dry_input.get("required") is not True, str(dry_input))
check("the dispatch takes the version and dry-run, and nothing else", sorted(dispatch_inputs) == ["dry-run", "version"], str(sorted(dispatch_inputs)))
check("top-level permissions are contents: read", wf.get("permissions") == {"contents": "read"}, str(wf.get("permissions")))
concurrency = wf.get("concurrency") or {}
check("one release runs at a time and none is cancelled", concurrency.get("group") == "release" and concurrency.get("cancel-in-progress") is False, str(concurrency))
jobs = wf.get("jobs") or {}
check("its jobs are build, verify, stage and publish", list(jobs) == ["build", "verify", "stage", "publish"], str(list(jobs)))
check("verify needs build, stage needs verify, publish needs stage",
      [jobs.get(n, {}).get("needs") for n in ("verify", "stage", "publish")] == ["build", "verify", "stage"])
check("build runs only on main", "github.ref == 'refs/heads/main'" in str(jobs.get("build", {}).get("if", "")))
check("the skeleton marker and its not-built notices are gone",
      re.search(r"^# OPENVERIFY_SKELETON$", text, re.M) is None and "not built yet" not in text)
check("every job runs on the standard runner with a timeout",
      all(job.get("runs-on") == "ubuntu-latest" and isinstance(job.get("timeout-minutes"), int) for job in jobs.values()),
      str({n: (j.get("runs-on"), j.get("timeout-minutes")) for n, j in jobs.items()}))
check("its header gives the run's minutes as an estimate (C267.1, C267.5)", re.search(r"about 35 to 45 minutes[^\n]*estimate", text) is not None)


def steps(job):
    return [s for s in (jobs.get(job) or {}).get("steps") or [] if isinstance(s, dict)]


def runs(job):
    return [str(s.get("run", "")) for s in steps(job)]


def joined(job):
    return "\n".join(runs(job))


def first(job, pattern):
    for index, run in enumerate(runs(job)):
        if re.search(pattern, run):
            return index
    return None


def before(job, earlier, later):
    a, b = first(job, earlier), first(job, later)
    return a is not None and b is not None and a < b


all_runs = "\n".join(joined(name) for name in jobs)

# ---------------------------------------------------------------- actions ----
uses = re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)(?:[ \t]+#[ \t]*(\S+))?[ \t]*$", text, flags=re.M)
known = set()
for path in glob.glob(os.path.join(repo_root, ".github", "workflows", "*.yml")) + glob.glob(os.path.join(repo_root, ".github", "actions", "*", "action.yml")):
    if os.path.basename(path) == "release.yml":
        continue
    with open(path, encoding="utf-8") as fh:
        known |= set(re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)[ \t]+#[ \t]*(\S+)[ \t]*$", fh.read(), flags=re.M))
with open(os.path.join(repo_root, "THIRD_PARTY_LICENSES.md"), encoding="utf-8") as fh:
    ledger = fh.read()
attest = re.search(r"\| actions/attest-build-provenance \| (v[\d.]+) .*?by commit `([0-9a-f]{40})`", ledger)
if attest:
    known.add((f"actions/attest-build-provenance@{attest.group(2)}", attest.group(1)))
check("it uses actions", len(uses) >= 8, str(len(uses)))
for ref, version in sorted(set(uses)):
    if ref.startswith("./"):
        check(f"{ref} is a local action of this repository", os.path.isdir(os.path.join(repo_root, ref)))
        continue
    check(f"{ref.split('@')[0]} is pinned to a full commit SHA with its tag in a trailing comment",
          re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}", ref) is not None
          and re.fullmatch(r"v\d+(\.\d+){0,2}", version or "") is not None, f"{ref} {version}")
    check(f"{ref.split('@')[0]} is pinned as the other workflows or THIRD_PARTY_LICENSES.md pin it", (ref, version) in known, f"{ref} {version}")
check("no third-party action (a scanner, a signer, a setup action): only GitHub's own and local ones (rule 20)",
      all(ref.startswith(("actions/", "./")) for ref, _ in uses), str(sorted({r.split('@')[0] for r, _ in uses})))
check("every checkout drops its credentials",
      all((s.get("with") or {}).get("persist-credentials") is False
          for job in jobs for s in steps(job) if str(s.get("uses", "")).startswith("actions/checkout@")))
check("no expression is interpolated into a script (inputs reach it through env)", "${{" not in all_runs)
check("it names no secret (the publish job signs keyless through its OIDC token)", "secrets." not in text)
perms = {name: job.get("permissions") for name, job in jobs.items()}
check("only publish widens the token", all(p is None for n, p in perms.items() if n != "publish"), str(perms))
check("publish holds contents: read, id-token, packages and attestations: write, and nothing else",
      perms.get("publish") == {"contents": "read", "id-token": "write", "packages": "write", "attestations": "write"}, str(perms.get("publish")))
check("no pull_request_target anywhere", "pull_request_target" not in text)

# ------------------------------------------------------------------ tools ----
for tool in ("cosign", "syft", "grype", "trivy", "helm", "kind", "kubectl", "chart-testing", "gitleaks"):
    check(f"{tool} is installed only by infra/scripts/install-{tool}.sh (rule 20)", f"infra/scripts/install-{tool}.sh" in all_runs)
check("no tool arrives through curl | sh, go install, apt, brew, pip or npx",
      re.search(r"curl[^\n|]*\|\s*(ba)?sh|go install|apt(-get)? install|brew install|pip3? install|npx |npm (i|install) -g", all_runs) is None)
check("nothing is taken at `latest`", re.search(r"(:|@|=)latest\b", all_runs) is None)
check("cosign is installed before the installers that check signatures with it",
      all(before(job, r"install-cosign\.sh", rf"install-{tool}\.sh") for job in jobs
          for tool in ("syft", "grype", "trivy", "helm", "kubectl") if first(job, rf"install-{tool}\.sh") is not None))
check("no action cache in a release workflow (cache poisoning)", not any(ref.startswith("actions/cache@") for ref, _ in uses))

# ------------------------------------------------------------------ build ----
build = joined("build")
# Workflow 11G (contracts-11g, KP11-42): the packages are built and packed on the images' Node.
with open(os.path.join(repo_root, "infra", "docker", "api.Dockerfile"), encoding="utf-8") as fh:
    image_node = re.search(r"^ARG NODE_IMAGE=node:([0-9.]+)-", fh.read(), re.MULTILINE)
build_nodes = [str((s.get("with") or {}).get("node-version", "")) for s in steps("build")
               if str(s.get("uses", "")).startswith("actions/setup-node@")]
check("build: Node is the images' version (22.23.4), as setup-pnpm pins it",
      image_node is not None and build_nodes == [image_node.group(1)] == ["22.23.4"], str(build_nodes))
check("build: the version is checked as three numbers before anything is built",
      before("build", r"\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$", r"docker build"), str(first("build", r"docker build")))
dockerfiles = {
    "api": "infra/docker/api.Dockerfile",
    "dashboard": "infra/docker/dashboard.Dockerfile",
    "flow": "infra/docker/flow.Dockerfile",
    "code-runner": "infra/docker/code-runner.Dockerfile",
    "vision": "services/vision/Dockerfile",
}
# Join each shell continuation first: a greedy `[^\n]*` would swallow the trailing backslash and end
# a multi-line command at its first line.
build_lines = [line.strip() for line in re.findall(r"docker build[^\n]*", re.sub(r"\\\n\s*", " ", build))]
for name, dockerfile in dockerfiles.items():
    mine = [line for line in build_lines if f"-f {dockerfile}" in line or f"--file {dockerfile}" in line]
    check(f"build: openverify/{name} is built from {dockerfile} for linux/amd64 with its labels' arguments",
          bool(mine) and all("--platform linux/amd64" in line and all(f"--build-arg {arg}=" in line for arg in ("VERSION", "REVISION", "SOURCE_URL")) for line in mine),
          "; ".join(mine) or "no docker build line")
    check(f"build: openverify/{name} is tagged with the version", any(f'openverify/{name}:"$VERSION"' in line or f"openverify/{name}:${{VERSION}}" in line for line in mine))
vision = [line for line in build_lines if "services/vision/Dockerfile" in line]
check("build: vision is built with the named context repo=. (its image carries models/manifest.json and scripts/fetch_models.py; images-11c's handoff)",
      bool(vision) and all("--build-context repo=." in line for line in vision), "; ".join(vision))
check("build: the data the API image bakes and YuNet, which the flow image with guidance carries, are fetched before any image is built",
      before("build", r"python3 -I scripts/fetch_data\.py", r"docker build")
      and before("build", r"python3 -I scripts/fetch_models\.py --only face_detection_yunet", r"docker build"))
flow = [line for line in build_lines if "flow.Dockerfile" in line]
check("build: the flow image is built twice, the second with OPENVERIFY_FLOW_FACE_GUIDANCE=off and the -noguidance tag (C289)",
      len(flow) == 2 and sum("--build-arg OPENVERIFY_FLOW_FACE_GUIDANCE=off" in line and "-noguidance" in line for line in flow) == 1, "; ".join(flow))
check("build: no image is built for arm64 (C286) and none with VITE_OPENVERIFY_API_URL (C257.1)", "arm64" not in build and "VITE_OPENVERIFY_API_URL" not in build)
check("build: no build argument carries a secret", re.search(r"--build-arg [A-Z_]*(TOKEN|SECRET|PASSWORD|PEPPER|KEK|_KEY)\b", build) is None)
check("build: each image is saved as a tarball for the jobs after it", len(re.findall(r"docker save", build)) >= 1 and "-noguidance" in build)
check("build: the chart is packaged with the release's version", re.search(r'helm package deploy/helm/openverify[^\n]*--version "\$VERSION"[^\n]*--app-version "\$VERSION"', build) is not None)
check("build: the three npm packages are built, then packed by sdk-web-11c's release pack tool with the release's version (C266.1, C266.4, C266.5)",
      all(re.search(rf"--filter={re.escape(pkg)}\b", build) for pkg in ("@openverify/js", "@openverify/node", "@openverify/react"))
      and before("build", r"turbo run build[^\n]*--filter=@openverify/react", r"pack-release\.ts")
      and re.search(r'node packages/sdk-react/scripts/pack-release\.ts --out [^\n]*--version "\$VERSION" packages/sdk-js packages/node packages/sdk-react', build) is not None)
check("build: no workspace manifest is packed as it stands (it carries the source condition and @openverify/node's private dependencies)",
      re.search(r"pnpm (--filter \S+ )?pack\b", build) is None)
check("build: nothing is published by the build (no push, no npm publish)", re.search(r"docker push|npm publish|pnpm publish|helm push", build) is None)

# ----------------------------------------------------------------- verify ----
verify = joined("verify")
images = ["api", "dashboard", "flow", "flow-noguidance", "vision", "code-runner"]
check("verify: Trivy scans every image at critical and high and fails on a finding (C259.2)",
      re.search(r"trivy image[^\n]*--severity CRITICAL,HIGH[^\n]*--exit-code 1", verify) is not None)
check("verify: Grype scans every image and fails at high", re.search(r"grype [^\n]*--fail-on high", verify) is not None)
check("verify: the scanners' findings pass the allowlist's gate (security/allowlist.yaml, C259.2)", "security/allowlist.yaml" in verify)
verify_env = {key: str(value) for s in steps("verify") for key, value in (s.get("env") or {}).items()}
check("verify: the vulnerability databases are fresh: none skipped or cached, none older than 24 hours, the build dates in the summary (C259.3)",
      all(flag not in verify for flag in ("--skip-db-update", "--offline-scan", "--skip-java-db-update", "--cache-dir"))
      and verify_env.get("GRYPE_DB_MAX_ALLOWED_BUILT_AGE") == "24h" and verify_env.get("GRYPE_DB_VALIDATE_AGE") == "true"
      and "GITHUB_STEP_SUMMARY" in verify and re.search(r"trivy version --format json", verify) is not None, str(verify_env))
check("verify: the image loop covers the six images", all(image in verify for image in images))
check("verify: Syft writes a CycloneDX JSON SBOM of every image", re.search(r"syft scan docker-archive:[^\n]*-o cyclonedx-json=", verify) is not None)
check("verify: Syft writes the source trees' SBOMs (the workspace, vision's uv.lock, load/uv.lock when present)",
      "javascript-lock-cataloger,javascript-package-cataloger" in verify and "services/vision" in verify and "load/uv.lock" in verify)
check("verify: Syft writes each npm tarball's SBOM from its unpacked contents, with the package.json cataloguer a directory scan leaves out by default",
      re.search(r"syft scan dir:[^\n]*npm[^\n]*--override-default-catalogers javascript-package-cataloger", verify) is not None)
ids = [f"image:{name}" for name in images] + ["npm:openverify-js", "npm:openverify-node", "npm:openverify-react", "source:pnpm", "source:vision", "source:load"]
check("verify: the licence check runs over every SBOM with its artifact id (C261.2)",
      "python3 -I security/check-sbom-licences.py --artifact" in verify and all(i in verify for i in ids), str([i for i in ids if i not in verify]))
check("verify: the licence check's failure fails the job, after every SBOM was read", re.search(r"rc=0[\s\S]*check-sbom-licences\.py[\s\S]*\|\| rc=1[\s\S]*exit \"?\$rc\"?", verify) is not None)
check("verify: the weights are fetched on the runner before the kind install (C265.4)", before("verify", r"python3 -I scripts/fetch_models\.py", r"kind\.sh\" models|kind\.sh models"))
for version in ("1.35", "1.37"):
    check(f"verify: the chart is installed, smoke-tested and upgraded on kind {version} through kind.sh",
          all(re.search(rf"kind\.sh\"? {sub}", verify) for sub in (f"create {version}", "load", "fixtures", "models", "install", "smoke", "upgrade")))
check("verify: kind.sh loads the images built in this run, by the release's tag (OPENVERIFY_KIND_IMAGE_TAG)",
      re.search(r'OPENVERIFY_KIND_IMAGE_TAG="\$VERSION"', verify) is not None and "OPENVERIFY_IMAGE_TAG" not in verify)
deletes = [s for s in steps("verify") if re.search(r"kind\.sh\"? delete", str(s.get("run", "")))]
check("verify: every kind cluster is deleted, also after a failure", bool(deletes) and all("always()" in str(s.get("if", "")) for s in deletes))
check("verify: gitleaks reads every artifact's unpacked contents, image layers included (Phase 10 C217.4)",
      "gitleaks dir" in verify and re.search(r"tar -x", verify) is not None and before("verify", r"install-gitleaks\.sh", r"gitleaks dir"))
gitleaks_step = next((str(s.get("run", "")) for s in steps("verify") if "gitleaks dir" in str(s.get("run", ""))), "")
check("verify: gitleaks keeps the repository's rules and adds one entry, the base image's public GPG_KEY fingerprint, only inside an image archive's blob (both conditions)",
      '"path = \\"$GITHUB_WORKSPACE/.gitleaks.toml\\""' in gitleaks_step and "'condition = \"AND\"'" in gitleaks_step
      and "GPG_KEY=[0-9A-F]{40}" in gitleaks_step and "/archive/blobs/sha256/[0-9a-f]{64}" in gitleaks_step
      and gitleaks_step.count("regexes = ") == 1 and "stopwords" not in gitleaks_step and "useDefault = false" not in gitleaks_step)


def allowlist_script():
    for s in steps("verify"):
        run = str(s.get("run", ""))
        if "security/allowlist.yaml" in run and "<<'PY'" in run:
            return run.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    return None


def convert(entries):
    import subprocess
    import tempfile

    script = allowlist_script()
    if script is None:
        return None
    with tempfile.TemporaryDirectory() as work:
        path = os.path.join(work, "allowlist.yaml")
        with open(path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(entries, fh)
        done = subprocess.run([sys.executable, "-I", "-c", script, path, work], capture_output=True, text=True, check=False)
        outputs = {}
        for name in ("grype.yaml", "trivy-ignore.rego"):
            target = os.path.join(work, name)
            if os.path.exists(target):
                with open(target, encoding="utf-8") as fh:
                    outputs[name] = fh.read()
        return done.returncode, outputs


# The workflow reads the expiry against the UTC date (datetime.now(timezone.utc)), so the cases
# are dated in UTC too; with the local date they failed every evening west of UTC (integration-11c).
utc_today = datetime.datetime.now(datetime.timezone.utc).date()
soon = (utc_today + datetime.timedelta(days=30)).isoformat()
entry = {"id": "CVE-2026-0001", "package": "example-package", "reason": "synthetic entry for the contract test", "expires": soon, "added-by": "test"}
path_entry = {key: value for key, value in entry.items() if key != "package"} | {"id": "AVD-KSV-0001", "path": "infra/docker/api.Dockerfile"}
empty, listed = convert([]), convert([entry, path_entry])
check("verify: an empty allowlist becomes a Trivy policy with no rule and an empty Grype ignore list",
      empty is not None and empty[0] == 0 and "ignore if" not in empty[1].get("trivy-ignore.rego", "x")
      and "default ignore := false" in empty[1].get("trivy-ignore.rego", "") and json.loads(empty[1].get("grype.yaml", "null")) == {"ignore": []}, str(empty))
if listed is not None:
    listed[1]["grype.yaml"] = listed[1].get("grype.yaml", "null")
check("verify: a package entry ignores its id in its package only, in Grype and in Trivy (as the id and as a vendor id); a path entry is not an image rule",
      listed is not None and listed[0] == 0
      and json.loads(listed[1]["grype.yaml"]) == {"ignore": [{"vulnerability": "CVE-2026-0001", "package": {"name": "example-package"}}]}
      and listed[1].get("trivy-ignore.rego", "").count("ignore if {") == 2
      and 'input.VulnerabilityID == "CVE-2026-0001"' in listed[1].get("trivy-ignore.rego", "")
      and '"CVE-2026-0001" in input.VendorIDs' in listed[1].get("trivy-ignore.rego", "")
      and listed[1].get("trivy-ignore.rego", "").count('input.PkgName == "example-package"') == 2 and "AVD-KSV-0001" not in listed[1].get("trivy-ignore.rego", ""), str(listed))
past = (utc_today - datetime.timedelta(days=1)).isoformat()
far = (utc_today + datetime.timedelta(days=91)).isoformat()
for label, expires in (("an expired entry", past), ("an entry expiring more than 90 days ahead", far)):
    refused = convert([{**entry, "expires": expires}])
    check(f"verify: {label} fails the run before any scan (C259.2)", refused is not None and refused[0] == 1 and not refused[1], str(refused))
check("verify: no *.mmdb, *.mmdb.gz, stack.json or .env.e2e reaches an artifact (ADR 0006; Workflow 7A)",
      all(token in verify for token in ("*.mmdb", "*.mmdb.gz", "stack.json", ".env.e2e")))
check("verify: no DAST runs here (C283.4)", re.search(r"\bzap\b|owasp|zaproxy", all_runs, re.I) is None and re.search(r"no DAST", text, re.I) is not None)

# ------------------------------------------------------------------ stage ----
stage = joined("stage")
uploads = [s for s in steps("stage") if str(s.get("uses", "")).startswith("actions/upload-artifact@")]
check("stage: every staged upload is kept 30 days", bool(uploads) and all((s.get("with") or {}).get("retention-days") == 30 for s in uploads))
check("stage: SHA256SUMS is written before the upload", "SHA256SUMS" in stage and "sha256sum" in stage)
check("stage: an artifact whose report says pending-owner is renamed with -pending-owner (C261.2)",
      '"pending-owner"' in stage and "-pending-owner" in stage)
check("stage: release notes name the pending-owner artifacts, the base sources and that nothing is signed (C257.5, C262.4)",
      "RELEASE-NOTES" in stage and "pending-owner" in stage and "unsigned" in stage.lower())
check("stage: without the owner's switch the run ends with a notice that nothing was published",
      re.search(r"::notice[^\n]*nothing (was|is) published", stage) is not None)
check("stage: the notes say network data is the operator's own sync and that verify searched every artifact for the files that must never ship (ADR 0006; Workflow 7A)",
      "Network data is the operator's own sync" in stage and all(token in stage for token in ("*.mmdb", "*.mmdb.gz", "stack.json", ".env.e2e")))
check("stage: the notes say the staged files stay unsigned and what the first approved publication signs, never that it happened (rule 10)",
      "Staged workflow artifacts are unsigned" in stage and "first approved publication" in stage
      and re.search(r"\b(were|was|is|are) (signed|published) (by|on|to)\b", stage) is None)

# ---------------------------------------------------------------- publish ----
publish_job = jobs.get("publish") or {}
publish = joined("publish")
environment = publish_job.get("environment")
check("publish: only in the environment `release`", environment == "release" or (isinstance(environment, dict) and environment.get("name") == "release"), str(environment))
condition = str(publish_job.get("if", ""))
check("publish: only when vars.OPENVERIFY_PUBLISH is 'true', with no other way in", "vars.OPENVERIFY_PUBLISH == 'true'" in condition and "||" not in condition, condition)
# Workflow 11G (integration-11g, publish-11g's contract deviation 1): the job itself runs only for a
# dispatch of main, so another branch's dispatch never asks the release environment's reviewer to
# approve a run; the first step's check stays as defence in depth.
check("publish: only for a dispatch of main, at the job level, before the reviewer is asked", "github.ref == 'refs/heads/main'" in condition and "||" not in condition, condition)
check("publish: it refuses a pending-owner artifact before anything leaves the runner",
      before("publish", r"pending-owner", r"docker push|cosign sign"))
check("publish: cosign signs each image by digest and attests its SBOM (C262.1)",
      re.search(r"cosign sign --yes [^\n]*@\$", publish) is not None and re.search(r"cosign attest --yes --type cyclonedx", publish) is not None)
check("publish: provenance by actions/attest-build-provenance", any(str(s.get("uses", "")).startswith("actions/attest-build-provenance@") for s in steps("publish")))
check("publish: slsa-github-generator is named as the alternative", "slsa-github-generator" in text)
check("cosign signs and attests nowhere but in publish (nothing is signed in 11C, C262)",
      all("cosign sign" not in joined(n) and "cosign attest" not in joined(n) for n in ("build", "verify", "stage")))

# Workflow 11G (publish-11g; Q1-Q4 granted 2026-11-21, the gate's scope: images-and-chart,
# sign-keyless, attestations, npm; not sign-key).
publish_steps = steps("publish")
check("publish: it waits for stage, which waits for verify and build, in the same run (no other trigger reaches it)",
      publish_job.get("needs") == "stage" and jobs.get("stage", {}).get("needs") == "verify" and jobs.get("verify", {}).get("needs") == "build")
publish_concurrency = publish_job.get("concurrency") or {}
check("publish: its own concurrency group, never cancelled, so two publishes never overlap",
      publish_concurrency.get("group") == "release-publish" and publish_concurrency.get("cancel-in-progress") is False, str(publish_concurrency))
main_check = publish_steps[0] if publish_steps else {}
check("publish: its first step refuses any ref but main, before anything is downloaded (its own branch check)",
      re.search(r'"\$GITHUB_REF" != refs/heads/main', str(main_check.get("run", ""))) is not None
      and "exit 1" in str(main_check.get("run", "")) and "uses" not in main_check and "if" not in main_check, str(main_check.get("run", ""))[:120])
publish_env = {key: str(value) for key, value in (publish_job.get("env") or {}).items()}
check("publish: DRY_RUN comes from the dry-run input, and the job holds no token in its env",
      publish_env.get("DRY_RUN") == "${{ inputs.dry-run }}" and "GH_TOKEN" not in publish_env and "GITHUB_TOKEN" not in publish_env, str(sorted(publish_env)))
comparisons = re.findall(r'"\$DRY_RUN" (!?=) (\S+)', publish)
check("publish: every dry-run test compares with false, so anything but an explicit false is a dry run (fail closed)",
      bool(comparisons) and all(rhs == "false" for _, rhs in comparisons), str(comparisons))
token_steps = [s for s in publish_steps if "GH_TOKEN" in (s.get("env") or {})]
check("publish: the token reaches only the steps that log in to the registry",
      bool(token_steps) and all(re.search(r"docker login|helm registry login", str(s.get("run", ""))) for s in token_steps)
      and all(str((s.get("env") or {}).get("GH_TOKEN")) == "${{ github.token }}" for s in token_steps), str([s.get("name") for s in token_steps]))
check("publish: every staged file is checked against SHA256SUMS before anything is pushed (the staged bytes, never a rebuild)",
      before("publish", r"sha256sum --check --strict SHA256SUMS", r"docker (login|push)|helm push|pnpm publish"))
check("publish: no image is built, and nothing is published from a rebuild", re.search(r"docker build|docker buildx|turbo run build|pack-release", publish) is None)
check("publish: each loaded image must be the image the build job recorded (IMAGE-IDS.txt) before it is tagged or pushed",
      before("publish", r"IMAGE-IDS\.txt", r"docker push") and "docker load -i" in publish)
check("publish: each image is pushed with its version tag to the owner's GHCR namespace (Q2)",
      re.search(r'repository="ghcr\.io/\$owner/openverify-\$image"', publish) is not None and 'docker push "$repository:$VERSION"' in publish)
cosign_lines = [line.strip() for line in re.findall(r"cosign (?:sign|attest)[^\n]*", publish)]
check("publish: cosign signs keyless (no key, no key secret) and only by digest: sign, then attest the image's CycloneDX SBOM (sign-keyless; sign-key not in scope)",
      len(cosign_lines) == 2 and all(line.endswith('"$repository@$digest"') for line in cosign_lines)
      and re.search(r"cosign sign --yes \"\$repository@\$digest\"", publish) is not None
      and re.search(r'cosign attest --yes --type cyclonedx --predicate "\$sbom" "\$repository@\$digest"', publish) is not None
      and "--key" not in publish and "COSIGN_" not in text, str(cosign_lines))
check("publish: the chart is pushed as an OCI artifact from its staged package (helm push of the .tgz)",
      re.search(r'helm push "\$chart" "oci://ghcr\.io/\$owner/charts"', publish) is not None and 'chart="staged/chart/openverify-$VERSION.tgz"' in publish)
attest_steps = [s for s in publish_steps if str(s.get("uses", "")).startswith("actions/attest-build-provenance@")]
subjects = sorted(str((s.get("with") or {}).get("subject-checksums")) for s in attest_steps)
check("publish: build provenance by actions/attest-build-provenance over every staged file and over every pushed digest, only when dry-run is false (attestations)",
      subjects == ["staged/PUBLISHED-DIGESTS", "staged/SHA256SUMS"] and all(str(s.get("if", "")) == "inputs.dry-run == false" for s in attest_steps),
      str([(s.get("if"), (s.get("with") or {})) for s in attest_steps]))
check("publish: in a dry run a step says what the provenance would cover", any(str(s.get("if", "")) == "inputs.dry-run != false" and "dry run" in str(s.get("run", "")) for s in publish_steps))
image_node_version = image_node.group(1) if image_node else None
publish_nodes = [str((s.get("with") or {}).get("node-version", "")) for s in publish_steps if str(s.get("uses", "")).startswith("actions/setup-node@")]
check("publish: Node for pnpm is the images' version, with no package-manager cache",
      publish_nodes == [image_node_version] and all((s.get("with") or {}).get("package-manager-cache") is False
                                                    for s in publish_steps if str(s.get("uses", "")).startswith("actions/setup-node@")), str(publish_nodes))
check("publish: npm: each staged tarball is published by pnpm with provenance and public access (npm trusted publishing, no stored token; Q4, C285, Stage 1a amendment 5)",
      'pnpm publish "staged/npm/openverify-$name-$VERSION.tgz" --provenance --access public --no-git-checks' in publish
      and re.search(r"(?<![p\w])npm publish", publish) is None
      and all(name not in text for name in ("NODE_AUTH_TOKEN", "NPM_TOKEN", "_authToken")), "")
check("publish: npm: each tarball's manifest is checked and dry-run published with no OIDC token reachable, before anything is pushed",
      before("publish", r"env -u ACTIONS_ID_TOKEN_REQUEST_URL -u ACTIONS_ID_TOKEN_REQUEST_TOKEN \\?\s*pnpm publish", r"docker (login|push)")
      and "--dry-run" in publish)
check("publish: no sub-part outside the gate's scope: no key signing, no other registry, no GitHub release",
      re.search(r"docker\.io|quay\.io|registry\.npmjs\.org|gh release|softprops", publish) is None)


def search_job():
    for name, job in jobs.items():
        for s in steps(name):
            run = str(s.get("run", ""))
            if all(token in run for token in ("*.mmdb", "*.mmdb.gz", "stack.json", ".env.e2e")) and "exit 1" in run:
                return name
    return None


check("publish: it takes nothing verify has not searched: the *.mmdb, *.mmdb.gz, stack.json and .env.e2e search fails verify, which publish waits for, and stage only renames what verify read (ADR 0006; Workflow 7A)",
      search_job() == "verify" and re.search(r"\bcurl\b|\bwget\b|docker pull|docker build", stage) is None)


# ---------------------------------------------------------- publish, run ----
# The publish job's run steps executed in order, as a runner would (bash -e), on a synthetic staged
# tree, with stub docker, cosign, helm, pnpm and corepack that record each call. Nothing here
# touches a network, a registry or Sigstore.
import hashlib
import io
import subprocess
import tarfile
import tempfile

VERSION = "0.1.0"
OWNER = "Example-Owner"
REPOSITORY = "example-owner/openverify"
IMAGES = ["api", "dashboard", "flow", "flow-noguidance", "vision", "code-runner"]
STUBS = {
    "docker": r'''
case "$1" in
  login) cat >/dev/null ;;
  image)
    if [[ "$4" == *RepoDigests* ]]; then
      printf '%s@sha256:%s\n' "${5%:*}" "$(printf 'digest:%s' "$5" | sha256sum | cut -c1-64)"
    else
      printf 'sha256:%s\n' "$(printf 'id:%s' "$5" | sha256sum | cut -c1-64)"
    fi ;;
esac
''',
    "helm": r'''
case "$1" in
  registry) cat >/dev/null ;;
  show) printf 'apiVersion: v2\nname: openverify\n' ;;
  push) printf 'Pushed: x\nDigest: sha256:%s\n' "$(printf 'chart:%s' "$2" | sha256sum | cut -c1-64)" ;;
esac
''',
    "cosign": "",
    "pnpm": "",
    "corepack": "",
}


def image_id(tag):
    return "sha256:" + hashlib.sha256(f"id:{tag}".encode()).hexdigest()


def source_tag(image):
    return f"openverify/flow:{VERSION}-noguidance" if image == "flow-noguidance" else f"openverify/{image}:{VERSION}"


def write_tarball(path, manifest):
    data = json.dumps(manifest).encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        info = tarfile.TarInfo("package/package.json")
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    with open(path, "wb") as fh:
        fh.write(buffer.getvalue())


def staged_tree(work, *, pending=False, wrong_id=False, tamper=False):
    root = os.path.join(work, "ws")
    staged = os.path.join(root, "staged")
    for sub in ("images", "chart", "npm", "sbom", "scans"):
        os.makedirs(os.path.join(staged, sub))
    os.makedirs(os.path.join(root, "infra", "scripts"))
    for installer in ("install-cosign.sh", "install-helm.sh"):
        path = os.path.join(root, "infra", "scripts", installer)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("#!/usr/bin/env bash\nexit 0\n")
        os.chmod(path, 0o755)
    ids = []
    for image in IMAGES:
        with open(os.path.join(staged, "images", f"openverify-{image}-{VERSION}.tar"), "w", encoding="utf-8") as fh:
            fh.write(f"synthetic image archive {image}\n")
        with open(os.path.join(staged, "sbom", f"openverify-{image}-{VERSION}.cdx.json"), "w", encoding="utf-8") as fh:
            fh.write("{}\n")
        recorded = image_id("other") if wrong_id and image == "api" else image_id(source_tag(image))
        ids.append(f"{source_tag(image)} {recorded}")
    if pending:
        with open(os.path.join(staged, "images", f"openverify-vision-{VERSION}-pending-owner.tar"), "w", encoding="utf-8") as fh:
            fh.write("synthetic\n")
    with open(os.path.join(staged, "images", "IMAGE-IDS.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(ids) + "\n")
    with open(os.path.join(staged, "chart", f"openverify-{VERSION}.tgz"), "w", encoding="utf-8") as fh:
        fh.write("synthetic chart package\n")
    for name in ("js", "node", "react"):
        write_tarball(os.path.join(staged, "npm", f"openverify-{name}-{VERSION}.tgz"), {
            "name": f"@openverify/{name}", "version": VERSION, "license": "Apache-2.0",
            "repository": {"type": "git", "url": f"git+https://github.com/{REPOSITORY}.git", "directory": f"packages/{name}"},
            "publishConfig": {"access": "public", "provenance": True},
        })
    sums = []
    for directory, _, files in sorted(os.walk(staged)):
        for file in sorted(files):
            path = os.path.join(directory, file)
            with open(path, "rb") as fh:
                sums.append(f"{hashlib.sha256(fh.read()).hexdigest()}  ./{os.path.relpath(path, staged)}")
    with open(os.path.join(staged, "SHA256SUMS"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(sums, key=lambda line: line.split("  ", 1)[1])) + "\n")
    if tamper:
        with open(os.path.join(staged, "images", f"openverify-api-{VERSION}.tar"), "a", encoding="utf-8") as fh:
            fh.write("changed after staging\n")
    return root


def expression(value, dry_run):
    names = {"inputs.version": VERSION, "inputs.dry-run": "true" if dry_run else "false",
             "github.repository_owner": OWNER, "github.token": "synthetic-token-for-the-contract-test"}
    return re.sub(r"\$\{\{\s*([\w.-]+)\s*\}\}", lambda m: names.get(m.group(1), m.group(0)), str(value))


def condition(value, dry_run):
    if value is None:
        return True
    return {"inputs.dry-run == false": not dry_run, "inputs.dry-run != false": dry_run}.get(str(value).strip(), None)


def run_publish(dry_run, ref="refs/heads/main", **tree):
    """Each run step of publish in order until one fails: (calls, output, failed step name or None, digests)."""
    with tempfile.TemporaryDirectory() as work:
        root = staged_tree(work, **tree)
        stubs, temp = os.path.join(work, "stubs"), os.path.join(work, "runner-temp")
        os.makedirs(stubs)
        os.makedirs(temp)
        calls = os.path.join(work, "calls.txt")
        open(calls, "w", encoding="utf-8").close()
        for name, body in STUBS.items():
            path = os.path.join(stubs, name)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("#!/usr/bin/env bash\n{ printf '%s' \"$(basename \"$0\")\"; printf ' %s' \"$@\"; "
                         "printf ' [oidc=%s]\\n' \"${ACTIONS_ID_TOKEN_REQUEST_URL:+set}\"; } >> \"$OV_CALLS\"\n" + body)
            os.chmod(path, 0o755)
        base = {"PATH": stubs + os.pathsep + os.environ.get("PATH", ""), "HOME": work, "LANG": "C.UTF-8",
                "RUNNER_TEMP": temp, "GITHUB_PATH": os.path.join(work, "path"), "GITHUB_STEP_SUMMARY": os.path.join(work, "summary"),
                "GITHUB_REF": ref, "GITHUB_ACTOR": "example-actor", "GITHUB_REPOSITORY": REPOSITORY, "OV_CALLS": calls,
                "ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.example.invalid/synthetic", "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "synthetic-oidc-request"}
        base.update({key: expression(value, dry_run) for key, value in (publish_job.get("env") or {}).items()})
        output, failed = [], None
        for step in publish_steps:
            if "run" not in step:
                continue
            wanted = condition(step.get("if"), dry_run)
            if wanted is None:
                failed = f"unknown condition {step.get('if')}"
                break
            if not wanted:
                continue
            env = dict(base)
            env.update({key: expression(value, dry_run) for key, value in (step.get("env") or {}).items()})
            done = subprocess.run(["bash", "-e", "-c", str(step["run"])], cwd=root, env=env, capture_output=True, text=True, check=False)
            output.append(done.stdout + done.stderr)
            if done.returncode != 0:
                failed = str(step.get("name") or step["run"][:40])
                break
        with open(calls, encoding="utf-8") as fh:
            recorded = [line.rstrip("\n") for line in fh]
        digests_path = os.path.join(root, "staged", "PUBLISHED-DIGESTS")
        digests = []
        if os.path.exists(digests_path):
            with open(digests_path, encoding="utf-8") as fh:
                digests = [line for line in fh.read().splitlines() if line]
        return recorded, "\n".join(output), failed, digests


def called(calls, prefix):
    return [line for line in calls if line.startswith(prefix)]


PUBLISHING = ("docker login", "docker push", "cosign sign", "cosign attest", "helm registry", "helm push")
repositories = [f"ghcr.io/{OWNER.lower()}/openverify-{image}" for image in IMAGES]
dry_calls, dry_out, dry_failed, dry_digests = run_publish(True)
check("publish, run: a dry run passes every step", dry_failed is None, f"{dry_failed}: {dry_out[-400:]}")
check("publish, run: a dry run logs in nowhere, pushes nothing, signs and attests nothing",
      not any(called(dry_calls, prefix) for prefix in PUBLISHING) and dry_digests == [],
      str([line for line in dry_calls if line.startswith(PUBLISHING)][:3]))
dry_npm = called(dry_calls, "pnpm publish")
check("publish, run: a dry run calls pnpm publish only with --dry-run, once per tarball, with no OIDC token reachable",
      len(dry_npm) == 3 and all("--dry-run" in line and line.endswith("[oidc=]") for line in dry_npm), str(dry_npm))
check("publish, run: a dry run prints what it would push for each image and the chart",
      all(f"would push {repository}:{VERSION}" in dry_out for repository in repositories)
      and f"would push staged/chart/openverify-{VERSION}.tgz to oci://ghcr.io/{OWNER.lower()}/charts" in dry_out, dry_out[-600:])
real_calls, real_out, real_failed, real_digests = run_publish(False)
check("publish, run: a publication passes every step", real_failed is None, f"{real_failed}: {real_out[-400:]}")
check("publish, run: it pushes each staged image once, with its version tag",
      sorted(called(real_calls, "docker push")) == sorted(f"docker push {repository}:{VERSION} [oidc=set]" for repository in repositories),
      str(called(real_calls, "docker push")))
signed = called(real_calls, "cosign sign")
attested = called(real_calls, "cosign attest")
check("publish, run: it signs and attests each pushed image by the digest the push returned, never by tag",
      len(signed) == 6 and len(attested) == 6
      and all(re.fullmatch(rf"cosign sign --yes {re.escape(repository)}@sha256:[0-9a-f]{{64}} \[oidc=set\]", line) for repository, line in zip(repositories, signed))
      and all(f"--type cyclonedx --predicate staged/sbom/openverify-{image}-{VERSION}.cdx.json {repository}@sha256:" in line
              for image, repository, line in zip(IMAGES, repositories, attested)), str(signed + attested))
check("publish, run: it pushes the staged chart package to the owner's OCI charts path",
      called(real_calls, "helm push") == [f"helm push staged/chart/openverify-{VERSION}.tgz oci://ghcr.io/{OWNER.lower()}/charts [oidc=set]"], str(called(real_calls, "helm push")))
check("publish, run: it records every pushed digest (six images and the chart) for the provenance step",
      len(real_digests) == 7 and all(re.fullmatch(r"[0-9a-f]{64}  ghcr\.io/example-owner/(openverify-[a-z-]+|charts/openverify)", line) for line in real_digests), str(real_digests))
real_npm = [line for line in called(real_calls, "pnpm publish") if "--dry-run" not in line]
pushes = [index for index, line in enumerate(real_calls) if line.startswith(("docker push", "helm push"))]
npm_at = [index for index, line in enumerate(real_calls) if line in real_npm]
check("publish, run: it publishes each staged npm tarball once with provenance and public access, through the job's OIDC token, after the images and the chart",
      sorted(real_npm) == sorted(f"pnpm publish staged/npm/openverify-{name}-{VERSION}.tgz --provenance --access public --no-git-checks [oidc=set]" for name in ("js", "node", "react"))
      and bool(pushes) and bool(npm_at) and min(npm_at) > max(pushes), str(real_npm))
for label, arguments, step_hint in (
        ("a dispatch from another branch", {"ref": "refs/heads/feature"}, "main"),
        ("a staged file changed after SHA256SUMS", {"tamper": True}, "SHA256SUMS"),
        ("a pending-owner artifact", {"pending": True}, "pending-owner"),
        ("an image that is not the one the build recorded", {"wrong_id": True}, "image"),
):
    calls, out, failed, _ = run_publish(False, **arguments)
    check(f"publish, run: {label} stops the job before anything is pushed, signed or published",
          failed is not None and step_hint.lower() in failed.lower()
          and not any(called(calls, prefix) for prefix in PUBLISHING) and not [line for line in called(calls, "pnpm publish") if "--dry-run" not in line],
          f"{failed}: {[line for line in calls if line.startswith(PUBLISHING + ('pnpm publish',))][:3]}")

# The three published manifests name this repository, which npm's provenance checks against the
# repository that built them (a named borrowed edit of publish-11g).
manifest_repos = {}
for directory, name in (("packages/sdk-js", "@openverify/js"), ("packages/node", "@openverify/node"), ("packages/sdk-react", "@openverify/react")):
    with open(os.path.join(repo_root, directory, "package.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    repository = manifest.get("repository") or {}
    manifest_repos[name] = (repository.get("type"), repository.get("url"), repository.get("directory") == directory)
urls = {entry[1] for entry in manifest_repos.values()}
check("the three published packages name one GitHub repository, as git+https URLs with their own directory (npm provenance)",
      len(urls) == 1 and all(kind == "git" and same_dir for kind, _, same_dir in manifest_repos.values())
      and re.fullmatch(r"git\+https://github\.com/[\w.-]+/[\w.-]+\.git", next(iter(urls)) or "") is not None, str(manifest_repos))
try:
    remote = subprocess.run(["git", "-C", repo_root, "remote", "get-url", "origin"], capture_output=True, text=True, check=False).stdout.strip()
except OSError:
    remote = ""
remote_repo = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?$", remote)
if remote_repo and len(urls) == 1:
    check("the packages' repository is this checkout's GitHub repository",
          next(iter(urls)) == f"git+https://github.com/{remote_repo.group(1)}.git", f"{next(iter(urls))} vs {remote_repo.group(1)}")

print("\n".join(results))
PY
)
rc=$?
if [ "$rc" -ne 0 ]; then nok "the structural checker ran" "python exited $rc"; finish; fi
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) ok "${line#ok   - }" ;;
    "FAIL - "*) printf '%s\n' "$line"; failed=$((failed + 1)) ;;
  esac
done <<<"$structure"

if command -v actionlint >/dev/null 2>&1; then
  if lint_out=$(cd "$repo_root" && actionlint .github/workflows/release.yml 2>&1); then
    ok "actionlint reports no problems"
  else
    nok "actionlint reports no problems" "$(head -n 10 <<<"$lint_out" | tr '\n' ' ')"
  fi
else
  # No CI job installs actionlint (no installer pins it; adding a tool pin is contracts-11c's), so it
  # is skipped there as in infra/tests/ci-workflow.test.sh: the YAML parse above and zizmor below
  # still run, and every local run before a push has actionlint (integration-11c).
  skip "actionlint not installed (the YAML parse and zizmor are the fallback)"
fi

tools_dir="${SUPPLY_CHAIN_TOOLS_DIR:-$HOME/.local/bin}"
zizmor_bin=""
if [ -x "$tools_dir/zizmor" ]; then zizmor_bin="$tools_dir/zizmor"; elif command -v zizmor >/dev/null 2>&1; then zizmor_bin=$(command -v zizmor); fi
if [ -n "$zizmor_bin" ]; then
  if ziz_out=$(cd "$repo_root" && "$zizmor_bin" --offline --min-severity medium .github/workflows/release.yml 2>&1); then
    ok "zizmor finds nothing at medium or above"
  else
    nok "zizmor finds nothing at medium or above" "$(tail -n 15 <<<"$ziz_out" | tr '\n' ' ')"
  fi
else
  skip_unless_ci "zizmor not installed (infra/scripts/install-zizmor.sh)"
fi

finish
