#!/usr/bin/env bash
# Contract test for .github/workflows/codeql.yml and .github/codeql/codeql-config.yml (Workflow 11G,
# codeql-11g; C260.2 as Q1 and Q9 decide it, 2026-11-21: Q1 granted, the repository public at the
# owner's release step; Q9 declined, no GitHub Code Security licence). CodeQL is informational and
# never a required gate, and it may run only on a public repository, so this test holds what a run
# would do; no CodeQL run is counted on (rule 24) and nothing here downloads the CodeQL bundle:
#
#   1. its shape: push to main and workflow_dispatch only (no schedule, no pull_request, no
#      pull_request_target), top-level contents: read, every job skipped unless the repository is
#      public, security-events: write only on the analysis jobs, never actions, id-token, packages or
#      attestations, every job informational (continue-on-error) with a timeout;
#   2. the three languages: javascript-typescript and python with build-mode none, java-kotlin with
#      build-mode manual and a Gradle build that is a subset of ci.yml's android job's own Gradle
#      line, with dependency verification on (never lenient, never off, never re-written here), its
#      setup steps copied from the android job and pinned the same way;
#   3. the pins: github/codeql-action by the commit THIRD_PARTY_LICENSES.md records, every other
#      action by the same commit ci.yml uses, persist-credentials false, no secret, no token, no
#      expression inside a script;
#   4. the configuration: .github/codeql/codeql-config.yml with the query suite and every excluded
#      path preceded by its reason, each path matching a tracked file;
#   5. actionlint (when installed) and zizmor at medium or above (when installed; required in CI)
#      report nothing.
#
# Usage: infra/tests/codeql-workflow.test.sh
# Env:   SUPPLY_CHAIN_TOOLS_DIR (where zizmor is looked for before PATH; default ~/.local/bin)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
codeql="$repo_root/.github/workflows/codeql.yml"
config="$repo_root/.github/codeql/codeql-config.yml"
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

if [ -f "$codeql" ]; then ok ".github/workflows/codeql.yml exists"; else nok ".github/workflows/codeql.yml exists"; finish; fi
if [ -f "$config" ]; then ok ".github/codeql/codeql-config.yml exists"; else nok ".github/codeql/codeql-config.yml exists"; finish; fi

structure=$(python3 -I - "$codeql" "$config" "$repo_root" <<'PY'
import glob
import os
import re
import subprocess
import sys

import yaml

codeql_path, config_path, repo_root = sys.argv[1], sys.argv[2], sys.argv[3]
results = []


def check(desc, cond, detail=""):
    results.append(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


def load(path, label):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    try:
        data = yaml.safe_load(text)
        assert isinstance(data, dict)
    except (yaml.YAMLError, AssertionError) as exc:
        print(f"FAIL - {label} parses as YAML (" + str(exc).replace("\n", " ") + ")")
        sys.exit(0)
    check(f"{label} parses as YAML", True)
    return text, data


text, wf = load(codeql_path, "codeql.yml")
config_text, config = load(config_path, "codeql-config.yml")
with open(os.path.join(repo_root, ".github", "workflows", "ci.yml"), encoding="utf-8") as fh:
    ci_text = fh.read()
ci = yaml.safe_load(ci_text)
with open(os.path.join(repo_root, "THIRD_PARTY_LICENSES.md"), encoding="utf-8") as fh:
    ledger = fh.read()

# ------------------------------------------------------------------ shape ----
triggers = wf.get("on", wf.get(True))  # PyYAML (YAML 1.1) reads a bare `on` key as True
names = sorted(triggers) if isinstance(triggers, dict) else [str(triggers)]
check("it starts on push and workflow_dispatch only (no schedule, no pull_request: rule 11, decision 50)",
      names == ["push", "workflow_dispatch"], str(names))
push = (triggers or {}).get("push") if isinstance(triggers, dict) else None
check("push runs on main only", isinstance(push, dict) and push.get("branches") == ["main"], str(push))
check("no schedule, pull_request, pull_request_target or workflow_run anywhere",
      re.search(r"^\s*(schedule|pull_request|pull_request_target|workflow_run)\s*:", text, re.M) is None)
check("top-level permissions are contents: read", wf.get("permissions") == {"contents": "read"}, str(wf.get("permissions")))
jobs = wf.get("jobs") or {}
check("its jobs are analyze (javascript-typescript, python) and analyze-java-kotlin",
      list(jobs) == ["analyze", "analyze-java-kotlin"], str(list(jobs)))
PUBLIC = ("github.event.repository.private == false", "github.event.repository.visibility == 'public'")
for name, job in jobs.items():
    condition = str(job.get("if", ""))
    check(f"{name}: runs only on a public repository, so a private one skips it and bills nothing (HARD LIMITS (5), Q9 declined)",
          all(part in condition for part in PUBLIC) and "||" not in condition, condition)
    check(f"{name}: its token is contents: read and security-events: write, nothing more",
          job.get("permissions") == {"contents": "read", "security-events": "write"}, str(job.get("permissions")))
    check(f"{name}: informational, never failing the run (continue-on-error: true)", job.get("continue-on-error") is True,
          str(job.get("continue-on-error")))
    check(f"{name}: on the standard runner with a timeout of at most 60 minutes",
          job.get("runs-on") == "ubuntu-latest" and isinstance(job.get("timeout-minutes"), int) and 0 < job["timeout-minutes"] <= 60,
          str((job.get("runs-on"), job.get("timeout-minutes"))))
    check(f"{name}: needs no other job", "needs" not in job)
for permission in ("id-token", "packages", "attestations", "actions", "pull-requests", "deployments"):
    check(f"no job asks for {permission}", re.search(rf"^\s*{permission}\s*:", text, re.M) is None)
check("its header gives the minutes as an estimate, measured on the first run (C267's honesty rule)",
      re.search(r"estimate", text, re.I) is not None and re.search(r"first run", text, re.I) is not None)


def steps(job):
    return [s for s in (jobs.get(job) or {}).get("steps") or [] if isinstance(s, dict)]


def index_of(job, predicate):
    return next((i for i, s in enumerate(steps(job)) if predicate(s)), None)


def uses_of(step):
    return str(step.get("uses", ""))


# -------------------------------------------------------------- languages ----
matrix = ((jobs.get("analyze") or {}).get("strategy") or {}).get("matrix") or {}
include = matrix.get("include") or []
pairs = sorted((str(e.get("language")), str(e.get("build-mode"))) for e in include if isinstance(e, dict))
check("analyze: javascript-typescript and python, each with build-mode none",
      pairs == [("javascript-typescript", "none"), ("python", "none")], str(pairs))
check("analyze: one language failing never cancels the other (fail-fast: false)",
      ((jobs.get("analyze") or {}).get("strategy") or {}).get("fail-fast") is False)
languages = set()
for job in jobs:
    for step in steps(job):
        if uses_of(step).startswith("github/codeql-action/init@"):
            languages.add(str((step.get("with") or {}).get("languages")))
check("the three languages are analysed (javascript-typescript, python, java-kotlin)",
      languages == {"${{ matrix.language }}", "java-kotlin"}, str(sorted(languages)))
for job in jobs:
    init_at = index_of(job, lambda s: uses_of(s).startswith("github/codeql-action/init@"))
    analyze_at = index_of(job, lambda s: uses_of(s).startswith("github/codeql-action/analyze@"))
    check(f"{job}: init comes before analyze, each once",
          init_at is not None and analyze_at is not None and init_at < analyze_at
          and sum(uses_of(s).startswith("github/codeql-action/") for s in steps(job)) == 2)
    init = (steps(job)[init_at].get("with") or {}) if init_at is not None else {}
    check(f"{job}: init reads ./.github/codeql/codeql-config.yml", init.get("config-file") == "./.github/codeql/codeql-config.yml",
          str(init.get("config-file")))
    check(f"{job}: init never overrides the bundle the pinned action names (no tools input)", "tools" not in init)
    analyze = (steps(job)[analyze_at].get("with") or {}) if analyze_at is not None else {}
    check(f"{job}: findings go to code scanning (upload not turned off) under a per-language category",
          str(analyze.get("upload", "always")) == "always" and str(analyze.get("category", "")).startswith("/language:"),
          str(analyze))
mode_init = next((s.get("with") or {} for s in steps("analyze") if uses_of(s).startswith("github/codeql-action/init@")), {})
check("analyze: build-mode comes from the matrix", mode_init.get("build-mode") == "${{ matrix.build-mode }}", str(mode_init))
kt_init = next((s.get("with") or {} for s in steps("analyze-java-kotlin") if uses_of(s).startswith("github/codeql-action/init@")), {})
check("analyze-java-kotlin: build-mode manual (Kotlin is not extracted without a build)", kt_init.get("build-mode") == "manual",
      str(kt_init))

# ------------------------------------------------------ the Kotlin build ----
kt_steps = steps("analyze-java-kotlin")
kt_defaults = ((jobs.get("analyze-java-kotlin") or {}).get("defaults") or {}).get("run") or {}
gradle_steps = [(i, s) for i, s in enumerate(kt_steps) if "./gradlew" in str(s.get("run", ""))]
check("analyze-java-kotlin: one Gradle build step", len(gradle_steps) == 1, str(len(gradle_steps)))
android_steps = [s for s in ((ci.get("jobs") or {}).get("android") or {}).get("steps") or [] if isinstance(s, dict)]
android_line = next((str(s.get("run", "")).strip() for s in android_steps
                     if str(s.get("run", "")).strip().startswith("./gradlew testDebugUnitTest")), "")
android_tasks = {t for t in android_line.split()[1:] if not t.startswith("-")}
check("ci.yml's android job has its Gradle line", bool(android_tasks), android_line)
if gradle_steps:
    at, build = gradle_steps[0]
    line = str(build.get("run", "")).strip()
    tokens = line.split()
    tasks = {t for t in tokens[1:] if not t.startswith("-")}
    check("analyze-java-kotlin: the build is one ./gradlew line", "\n" not in line and tokens[0] == "./gradlew", line)
    check("analyze-java-kotlin: its tasks are a subset of the android job's own Gradle line, so dependency verification "
          "covers every artifact it resolves (verification-metadata.xml from a fresh GRADLE_USER_HOME, c539508d)",
          bool(tasks) and tasks <= android_tasks, f"{sorted(tasks)} not in {sorted(android_tasks)}")
    check("analyze-java-kotlin: the build compiles the Android code (assembleDebug)", "assembleDebug" in tasks, str(sorted(tasks)))
    check("analyze-java-kotlin: --no-daemon and --no-build-cache (a daemon's or a cached build is not traced)",
          "--no-daemon" in tokens and "--no-build-cache" in tokens, line)
    check("analyze-java-kotlin: dependency verification stays on (never lenient, off or re-written for CodeQL; C214.5)",
          re.search(r"dependency-verification|dependency\.verification|write-verification-metadata|write-locks|--offline", line) is None,
          line)
    check("analyze-java-kotlin: the build runs in android/",
          build.get("working-directory", kt_defaults.get("working-directory")) == "android")
    kt_init_at = index_of("analyze-java-kotlin", lambda s: uses_of(s).startswith("github/codeql-action/init@"))
    kt_analyze_at = index_of("analyze-java-kotlin", lambda s: uses_of(s).startswith("github/codeql-action/analyze@"))
    check("analyze-java-kotlin: the build runs between init and analyze, so it is traced",
          kt_init_at is not None and kt_analyze_at is not None and kt_init_at < at < kt_analyze_at)
check("no step anywhere switches Gradle's dependency verification off or to lenient",
      re.search(r"dependency\.verification|dependency-verification\s*=?\s*(lenient|off)", text) is None)


def copied(predicate, label):
    mine = next((s for s in kt_steps if predicate(s)), None)
    theirs = next((s for s in android_steps if predicate(s)), None)
    same = mine is not None and theirs is not None and mine.get("uses") == theirs.get("uses") and mine.get("with") == theirs.get("with") \
        and str(mine.get("run", "")).strip() == str(theirs.get("run", "")).strip()
    check(f"analyze-java-kotlin: {label}, copied from ci.yml's android job and pinned the same way", same,
          f"{mine} != {theirs}")
    return mine


copied(lambda s: "-wrapper.jar.sha256" in str(s.get("run", "")), "verifies the Gradle wrapper JAR against services.gradle.org")
copied(lambda s: uses_of(s).startswith("actions/setup-java@"), "sets up Temurin 21 (actions/setup-java)")
copied(lambda s: uses_of(s).startswith("android-actions/setup-android@"), "sets up the Android SDK (android-actions/setup-android)")
fetch = copied(lambda s: "scripts/fetch_models.py --only face_detection_yunet" in str(s.get("run", "")),
               "fetches the YuNet model openverify-face's build copies into its AAR (and the fixture face), pinned by SHA-256")
fetch_at = index_of("analyze-java-kotlin", lambda s: "scripts/fetch_models.py" in str(s.get("run", "")))
check("analyze-java-kotlin: the model is fetched before the build",
      fetch_at is not None and bool(gradle_steps) and fetch_at < gradle_steps[0][0])

# ---------------------------------------------------------------- actions ----
uses = re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)(?:[ \t]+#[ \t]*(\S+))?[ \t]*$", text, flags=re.M)
check("it uses actions", len(uses) >= 6, str(len(uses)))
codeql_row = re.search(r"^\| github/codeql-action \| (v[\d.]+) .*?by commit `([0-9a-f]{40})`", ledger, re.M)
check("THIRD_PARTY_LICENSES.md records github/codeql-action by commit (contracts-11g)", codeql_row is not None)
ci_pins = set(re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)[ \t]+#[ \t]*(\S+)[ \t]*$", ci_text, flags=re.M))
for ref, version in sorted(set(uses)):
    action = ref.split("@")[0]
    sha = ref.split("@")[1] if "@" in ref else ""
    check(f"{ref.split('@')[0]}: pinned to a full commit with its version in a comment",
          re.fullmatch(r"[0-9a-f]{40}", sha) is not None and re.fullmatch(r"v\d+(\.\d+)*", version or "") is not None, ref)
    if action.startswith("github/codeql-action/"):
        check(f"{action}: the commit and version THIRD_PARTY_LICENSES.md records",
              codeql_row is not None and sha == codeql_row.group(2) and version == codeql_row.group(1), f"{ref} # {version}")
    else:
        check(f"{action}: the same commit and version ci.yml pins", (ref, version) in ci_pins, f"{ref} # {version}")
check("github/codeql-action is GitHub's own action (C258.2 amended for C260.2): init and analyze only",
      {u.split("@")[0] for u, _ in uses if u.startswith("github/codeql-action")} == {"github/codeql-action/init", "github/codeql-action/analyze"})
others = []
for path in sorted(glob.glob(os.path.join(repo_root, ".github", "workflows", "*.y*ml"))
                   + glob.glob(os.path.join(repo_root, ".github", "actions", "*", "action.y*ml"))):
    if os.path.abspath(path) == os.path.abspath(codeql_path):
        continue
    with open(path, encoding="utf-8") as fh:
        if re.search(r"^\s*(?:-\s+)?uses:\s*github/codeql-action", fh.read(), re.M):
            others.append(os.path.relpath(path, repo_root))
check("no other workflow or action uses github/codeql-action", not others, str(others))
checkouts = [s for job in jobs for s in steps(job) if uses_of(s).startswith("actions/checkout@")]
check("every job checks out without persisting credentials",
      len(checkouts) == len(jobs) and all((s.get("with") or {}).get("persist-credentials") is False for s in checkouts))
check("no secret and no token reach the workflow",
      "secrets." not in text and not re.search(r"\b(GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|github\.token)\b", text)
      and not any("token" in (s.get("with") or {}) for job in jobs for s in steps(job)))
scripts = [str(s.get("run", "")) for job in jobs for s in steps(job)]
check("no expression inside a script (zizmor template-injection)", not any("${{" in script for script in scripts))
check("ci.yml never needs or calls CodeQL: it is no part of the push's gate (decision 69 excludes it)",
      "codeql-action" not in ci_text
      and re.search(r"^\s*(?:-\s+)?uses:\s*\./\.github/workflows/codeql\.ya?ml", ci_text, re.M) is None
      and "workflow_call" not in text)

# ---------------------------------------------------------- configuration ----
suites = [q.get("uses") for q in config.get("queries") or [] if isinstance(q, dict)]
check("codeql-config.yml: the security-extended suite (informational, so the wider suite costs only triage)",
      suites == ["security-extended"], str(suites))
check("codeql-config.yml: no disable-default-queries and no packs from outside the bundle",
      "disable-default-queries" not in config and "packs" not in config)
ignored = config.get("paths-ignore") or []
check("codeql-config.yml: paths-ignore names the excluded paths", isinstance(ignored, list) and len(ignored) >= 4, str(ignored))
lines = config_text.splitlines()
tracked = subprocess.run(["git", "-C", repo_root, "ls-files"], capture_output=True, text=True, check=False).stdout.splitlines()
for entry in ignored:
    at = next((i for i, line in enumerate(lines) if re.fullmatch(rf"\s*-\s*['\"]?{re.escape(str(entry))}['\"]?\s*", line)), None)
    reason = at is not None and at > 0 and lines[at - 1].strip().startswith("#") and len(lines[at - 1].strip()) > 12
    check(f"codeql-config.yml: `{entry}` is excluded with its reason on the line above", reason)
    prefix = str(entry).rstrip("*").rstrip("/")
    check(f"codeql-config.yml: `{entry}` matches a tracked file (no stale exclusion)",
          any(f == prefix or f.startswith(prefix + "/") for f in tracked), prefix)
for kept in ("apps/", "packages/", "services/", "e2e/tests/", "load/", "security/", "scripts/"):
    check(f"codeql-config.yml: `{kept}` stays analysed",
          not any(kept.startswith(str(e).rstrip("*")) or str(e).rstrip("*").rstrip("/") + "/" == kept for e in ignored))
check("codeql-config.yml: says that paths-ignore does not reach the compiled java-kotlin analysis",
      re.search(r"java-kotlin", config_text) is not None and re.search(r"compiled", config_text, re.I) is not None)

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
  if lint_out=$(cd "$repo_root" && actionlint .github/workflows/codeql.yml 2>&1); then
    ok "actionlint reports no problems"
  else
    nok "actionlint reports no problems" "$(head -n 10 <<<"$lint_out" | tr '\n' ' ')"
  fi
else
  # No installer pins actionlint, so no CI job has it: the YAML parse above and zizmor below stay the
  # fallback there, as in infra/tests/ci-workflow.test.sh and release-workflow.test.sh.
  skip "actionlint not installed (the YAML parse and zizmor are the fallback)"
fi

tools_dir="${SUPPLY_CHAIN_TOOLS_DIR:-$HOME/.local/bin}"
zizmor_bin=""
if [ -x "$tools_dir/zizmor" ]; then zizmor_bin="$tools_dir/zizmor"; elif command -v zizmor >/dev/null 2>&1; then zizmor_bin=$(command -v zizmor); fi
if [ -n "$zizmor_bin" ]; then
  if ziz_out=$(cd "$repo_root" && "$zizmor_bin" --offline --min-severity medium .github/workflows/codeql.yml 2>&1); then
    ok "zizmor finds nothing at medium or above"
  else
    nok "zizmor finds nothing at medium or above" "$(tail -n 15 <<<"$ziz_out" | tr '\n' ' ')"
  fi
else
  skip_unless_ci "zizmor not installed (infra/scripts/install-zizmor.sh)"
fi

finish
