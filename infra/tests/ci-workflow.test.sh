#!/usr/bin/env bash
# Contract test for .github/workflows/ci.yml (and local composite actions under .github/actions).
#
#   1. YAML parses; the required jobs exist with the agreed commands (structural checks). The
#      android jobs' own step scripts (the konan cache key, the SDK host test-count floor, the
#      device test detection) also run on synthetic inputs in throwaway temp directories.
#   2. actionlint passes (when installed; otherwise the YAML parse above is the fallback).
#   3. Every third-party action is pinned to a full commit SHA with its version tag in a trailing
#      comment (`uses: owner/repo@<40 hex> # v1.2.3`), is not on the deny-list, and (when gh is
#      authenticated, or REQUIRE_REMOTE=1) that tag resolves to the pinned commit on GitHub.
#
# Usage: infra/tests/ci-workflow.test.sh
# Env:   REQUIRE_REMOTE=1  fail instead of skipping when gh cannot verify the tags
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workflow="$repo_root/.github/workflows/ci.yml"
actions_dir="$repo_root/.github/actions"

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
# KP10-33 (Workflow 10D): a check whose tool the infra job installs is skipped only on a developer
# machine. In CI (CI=true, which GitHub Actions sets) the missing tool is a failure, so the job
# cannot go green with the check never run.
skip_unless_ci() { if [ "${CI:-}" = "true" ]; then nok "$1" "required in CI"; else skip "$1"; fi; }

if [ -f "$workflow" ]; then ok ".github/workflows/ci.yml exists"; else nok ".github/workflows/ci.yml exists"; finish; fi

# ---------------------------------------------------------- structure ----
# The checker prints "ok   - ..." / "FAIL - ..." lines; the last line is the list of `uses:` refs.
structure=$(python3 -I - "$workflow" "$actions_dir" <<'PY'
import glob
import os
import re
import sys

import yaml

wf_path, actions_dir = sys.argv[1], sys.argv[2]
results = []


def check(desc, cond, detail=""):
    results.append(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


try:
    with open(wf_path, encoding="utf-8") as fh:
        wf = yaml.safe_load(fh)
    check("ci.yml parses as YAML", isinstance(wf, dict))
except yaml.YAMLError as exc:
    print("FAIL - ci.yml parses as YAML (" + str(exc).replace("\n", " ") + ")")
    print("USES:")
    sys.exit(0)

composites = {}
for path in sorted(glob.glob(os.path.join(actions_dir, "*", "action.y*ml"))):
    with open(path, encoding="utf-8") as fh:
        composites["./.github/actions/" + os.path.basename(os.path.dirname(path))] = yaml.safe_load(fh) or {}

triggers = wf.get("on", wf.get(True, {}))  # PyYAML (YAML 1.1) reads a bare `on` key as True
trigger_names = set(triggers) if isinstance(triggers, (dict, list)) else {triggers}
check("runs on pull_request and push", {"pull_request", "push"} <= trigger_names, str(sorted(trigger_names)))
check("never uses pull_request_target", "pull_request_target" not in trigger_names)
check("top-level permissions are read-only (contents: read)", wf.get("permissions") == {"contents": "read"},
      str(wf.get("permissions")))
check("concurrency cancels superseded runs", bool((wf.get("concurrency") or {}).get("cancel-in-progress")))

jobs = wf.get("jobs") or {}
required = ["node", "lint", "unit-api", "unit-api-coverage", "unit-dashboard", "unit-dashboard-coverage", "unit-db", "format", "integration", "vision",
            "android", "android-instrumented", "secrets", "e2e", "infra", "supply-chain"]
for name in required:
    check(f"job '{name}' exists", name in jobs)
for name, job in jobs.items():
    check(f"job '{name}' sets timeout-minutes", isinstance(job.get("timeout-minutes"), int))
    check(f"job '{name}' runs on an ubuntu runner", str(job.get("runs-on", "")).startswith("ubuntu-"))


def steps(job, seen=None):
    """Flatten a job's steps, inlining local composite actions."""
    out = []
    for step in job.get("steps") or []:
        out.append(step)
        uses = step.get("uses", "")
        if uses in composites:
            out.extend(steps(composites[uses].get("runs") or {}))
    return out


def runs(job):
    return "\n".join(str(s.get("run", "")) for s in steps(job))


def uses(job, prefix):
    return [s for s in steps(job) if str(s.get("uses", "")).startswith(prefix)]


def wd(job):
    return str(((job.get("defaults") or {}).get("run") or {}).get("working-directory", ""))


node = jobs.get("node", {})
node_run = runs(node)
check("node: pnpm comes from corepack", "corepack enable" in node_run)
check("node: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in node_run)
# CI run 41257053492 (2026-11-01): type-aware lint ran out of the runner's default heap (about 2 GB on
# a 7 GB runner) in @openverify/contracts (exit 134), so typecheck and the unit tests never ran. Peaks
# measured locally: lint api 3.35 GB, contracts 2.85 GB; typecheck api 2.4 GB. Lint runs in a job of its
# own, one package at a time under a 4 GB heap; typecheck keeps the node job, two at a time, same heap.
HEAP = "--max-old-space-size=4096"


def step_named(job, name):
    return next((s for s in steps(job) if s.get("name") == name), {})


def heap_of(job, step):
    env = {**(job.get("env") or {}), **(step.get("env") or {})}
    return str(env.get("NODE_OPTIONS", ""))


lint_job = jobs.get("lint", {})
lint_run = runs(lint_job)
lint_step = step_named(lint_job, "Lint")
check("lint: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in lint_run)
check("lint: runs every package's lint one at a time",
      re.search(r"(^|\n)pnpm turbo run lint --concurrency=1(\s|$)", str(lint_step.get("run", ""))) is not None,
      str(lint_step.get("run", "")))
check(f"lint: gives Node a 4 GB heap ({HEAP})", HEAP in heap_of(lint_job, lint_step), heap_of(lint_job, lint_step))
# C157 (Workflow 9A Stage 4): the flow server's own contract, from source with a stub of the API's
# internal route, where the workspace is installed (the apps image's live half stays local).
check("node: runs bash infra/tests/flow-server.test.sh",
      any(re.fullmatch(r"\s*bash infra/tests/flow-server\.test\.sh\s*", line)
          for line in node_run.splitlines()))
check("node: lint moved to the lint job", re.search(r"(^|\n|&& )pnpm (turbo run )?lint(\s|$)", node_run) is None)
typecheck_step = step_named(node, "Typecheck")
check("node: runs typecheck two packages at a time",
      re.search(r"(^|\n)pnpm turbo run typecheck --concurrency=2(\s|$)", str(typecheck_step.get("run", ""))) is not None,
      str(typecheck_step.get("run", "")))
check(f"node: typecheck gives Node a 4 GB heap ({HEAP})", HEAP in heap_of(node, typecheck_step),
      heap_of(node, typecheck_step))
check("node: uploads coverage reports", any("coverage" in str((s.get("with") or {}).get("path", ""))
                                            for s in uses(node, "actions/upload-artifact@")))

# Unit tests (Workflow 2C headroom): the api and dashboard suites run in jobs of their own and the
# node job runs every other package's, so together they test every package exactly once.
# Workflow 9A Stage 1b (0): node took 21.2 of its 25 minutes on Phase 8's push (CI 41802158981), inside
# the last 25% of its timeout (Phase 8 F08's rule). Its unit-test step took 16.7 minutes, bounded by
# @openverify/db (994 s of vitest time) and @openverify/watchlist (770 s) beside every other package on
# four cores; those two run in unit-db, so no package is tested by two jobs or by none.
split = {"unit-api": {"@openverify/api"}, "unit-dashboard": {"@openverify/dashboard"},
         "unit-db": {"@openverify/db", "@openverify/watchlist"}}
node_test = re.search(r"(^|\n)pnpm turbo run test((?: --filter='!@openverify/[a-z-]+')+)(\s|$)", node_run)
excluded = set(re.findall(r"!(@openverify/[a-z-]+)", node_test.group(2))) if node_test else set()
check("node: runs every package's unit tests except the split ones",
      excluded == set().union(*split.values()), f"excluded {sorted(excluded)}")
# Workflow 9A Stage 1b (F) (C159.1): the embed client, packages/sdk-js (@openverify/js), is a workspace
# package in no split job, so node tests it and uploads its coverage with packages/*/coverage/.
import json
sdk_manifest = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(wf_path)))),
                            "packages", "sdk-js", "package.json")
sdk_name = None
if os.path.exists(sdk_manifest):
    with open(sdk_manifest, encoding="utf-8") as manifest_file:
        sdk_name = json.load(manifest_file).get("name")
check("node: tests the embed client @openverify/js and uploads its coverage",
      sdk_name == "@openverify/js" and sdk_name not in set().union(*split.values())
      and sdk_name not in excluded
      and any("packages/*/coverage/" in str((s.get("with") or {}).get("path", ""))
              for s in uses(node, "actions/upload-artifact@")),
      f"packages/sdk-js is {sdk_name}")
unit_db = jobs.get("unit-db", {})
unit_db_run = runs(unit_db)
unit_db_test = re.search(r"(^|\n)pnpm turbo run test((?: --filter=@openverify/[a-z-]+)+)(\s|$)", unit_db_run)
unit_db_packages = set(re.findall(r"=(@openverify/[a-z-]+)", unit_db_test.group(2))) if unit_db_test else set()
check("unit-db: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in unit_db_run)
check("unit-db: runs the @openverify/db and @openverify/watchlist unit tests, and only those",
      unit_db_packages == split["unit-db"], f"runs {sorted(unit_db_packages)}")
check("unit-db: uploads its coverage reports",
      any("packages/db/coverage" in str((s.get("with") or {}).get("path", ""))
          and "packages/watchlist/coverage" in str((s.get("with") or {}).get("path", ""))
          for s in uses(unit_db, "actions/upload-artifact@")))
check("unit-db: the job's timeout keeps the db suite's 16.6 minutes out of the last 25% (at least 25)",
      isinstance(unit_db.get("timeout-minutes"), int) and unit_db["timeout-minutes"] >= 25,
      str(unit_db.get("timeout-minutes")))
dashboard_job = jobs.get("unit-dashboard", {})
dashboard_run = runs(dashboard_job)
check("unit-dashboard: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in dashboard_run)
# Workflow 9C (orchestrator decision 5 before 9C, Phase 8 F08): unit-dashboard took 16.2 of 20 minutes
# on 9B's push (CI 42331362147), inside the last 25% of its timeout, and 9C adds about 930 tests
# (6,535 locally): the suite runs as two blob shards, and unit-dashboard-coverage merges them and
# applies the 80% gate to the whole, as unit-api does.
dashboard_matrix = ((dashboard_job.get("strategy") or {}).get("matrix") or {})
check("unit-dashboard: runs as a matrix of two shards", dashboard_matrix.get("shard") == [1, 2],
      str(dashboard_matrix))
check("unit-dashboard: one failed shard does not cancel the other",
      (dashboard_job.get("strategy") or {}).get("fail-fast") is False)
dashboard_shards = [s for s in steps(dashboard_job) if "--shard=" in str(s.get("run", ""))]
dashboard_shard_run = " ".join(str(s.get("run", "")) for s in dashboard_shards)
check("unit-dashboard: each shard runs the dashboard suite in apps/dashboard with coverage, as a blob report",
      len(dashboard_shards) == 1
      and str(dashboard_shards[0].get("working-directory", "")) == "apps/dashboard"
      and re.search(r"pnpm exec vitest run --coverage\b", dashboard_shard_run) is not None
      and "--shard=${{ matrix.shard }}/2" in dashboard_shard_run
      and "--reporter=blob" in dashboard_shard_run, dashboard_shard_run)
check("unit-dashboard: a shard turns off only its own thresholds (all four), never the merge's",
      all(f"--coverage.thresholds.{name}=0" in dashboard_shard_run
          for name in ("lines", "functions", "branches", "statements")), dashboard_shard_run)
check("unit-dashboard: uploads each shard's blob report",
      any("unit-dashboard-blob-" in str((s.get("with") or {}).get("name", ""))
          and "matrix.shard" in str((s.get("with") or {}).get("name", ""))
          for s in uses(dashboard_job, "actions/upload-artifact@")))
check("unit-dashboard: the shard's name says how many shards there are",
      "of 2" in str(dashboard_job.get("name", "")), str(dashboard_job.get("name")))
check("unit-dashboard: no job runs the dashboard suite unsharded any more",
      not [name for name, job in jobs.items()
           if re.search(r"pnpm turbo run test --filter=@openverify/dashboard(\s|$)", runs(job))])
dashboard_merge = jobs.get("unit-dashboard-coverage", {})
dashboard_merge_steps = [s for s in steps(dashboard_merge) if "--merge-reports" in str(s.get("run", ""))]
dashboard_merge_cmd = " ".join(str(s.get("run", "")) for s in dashboard_merge_steps)
check("unit-dashboard-coverage: needs the two shards",
      dashboard_merge.get("needs") in ("unit-dashboard", ["unit-dashboard"]), str(dashboard_merge.get("needs")))
check("unit-dashboard-coverage: downloads every shard's blob report",
      any("unit-dashboard-blob-" in str((s.get("with") or {}).get("pattern", ""))
          and (s.get("with") or {}).get("merge-multiple") is True
          for s in uses(dashboard_merge, "actions/download-artifact@")))
check("unit-dashboard-coverage: merges the reports in apps/dashboard and applies the 80% gate to the whole",
      len(dashboard_merge_steps) == 1
      and str(dashboard_merge_steps[0].get("working-directory", "")) == "apps/dashboard"
      and re.search(r"pnpm exec vitest run --merge-reports=\S+ --coverage(\s|$)", dashboard_merge_cmd) is not None
      and "thresholds" not in dashboard_merge_cmd, dashboard_merge_cmd)
check("unit-dashboard-coverage: uploads the merged coverage report",
      any("coverage" in str((s.get("with") or {}).get("path", ""))
          for s in uses(dashboard_merge, "actions/upload-artifact@")))

# Owner decision 9 (K6A-13, Stage 4 amendment 13): the API suite runs as two shards, each a blob
# report with its coverage, and a merge job applies the 80% coverage gate to the whole. A shard
# alone covers about half the code, so its own thresholds are off; the merge keeps the config's.
unit_api = jobs.get("unit-api", {})
unit_api_run = runs(unit_api)
matrix = ((unit_api.get("strategy") or {}).get("matrix") or {})
# Workflow 9B Stage 4: shard 1 of 2 took 28.1 of 40 minutes on 9A's push (CI 42070468737) and 9B
# adds about 9% more API tests (9,304 at the Stage 3 close), so the estimate (30.6) passes the
# last 25% of 40: the suite runs as three shards (Phase 8 F08).
check("unit-api: runs as a matrix of three shards", matrix.get("shard") == [1, 2, 3], str(matrix))
# Workflow 9C (orchestrator decision 5 before 9C): the job's name counts the shards it runs.
check("unit-api: the shard's name says there are three shards",
      "of 3" in str(unit_api.get("name", "")) and "of 2" not in str(unit_api.get("name", "")),
      str(unit_api.get("name")))
check("unit-api: one failed shard does not cancel the other",
      (unit_api.get("strategy") or {}).get("fail-fast") is False)
check("unit-api: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in unit_api_run)
shard_steps = [s for s in steps(unit_api) if "--shard=" in str(s.get("run", ""))]
shard_run = " ".join(str(s.get("run", "")) for s in shard_steps)
check("unit-api: each shard runs the api suite in apps/api with coverage, as a blob report",
      len(shard_steps) == 1 and str(shard_steps[0].get("working-directory", "")) == "apps/api"
      and re.search(r"pnpm exec vitest run --coverage\b", shard_run) is not None
      and "--shard=${{ matrix.shard }}/3" in shard_run and "--reporter=blob" in shard_run, shard_run)
check("unit-api: a shard turns off only its own thresholds (all four), never the merge's",
      all(f"--coverage.thresholds.{name}=0" in shard_run
          for name in ("lines", "functions", "branches", "statements")), shard_run)
check("unit-api: uploads each shard's blob report",
      any(".vitest-reports" in str((s.get("with") or {}).get("path", ""))
          and "matrix.shard" in str((s.get("with") or {}).get("name", ""))
          for s in uses(unit_api, "actions/upload-artifact@")))
unit_api_timeout = unit_api.get("timeout-minutes")
# Workflow 8B Stage 4: shard 1 took 22.3 of 30 minutes on 8A's push (CI 41557289819), the last 25% of
# its timeout, and 8B added about 6% more API tests (8,137), so the estimate passes 22.5 minutes.
check("unit-api: each shard's timeout keeps its estimate out of the last 25% (at least 40 minutes)",
      isinstance(unit_api_timeout, int) and unit_api_timeout >= 40, str(unit_api_timeout))
# Workflow 8A Stage 1b amendment 1: past 15 minutes, node's timeout becomes 25. It took 15.9 of 20
# minutes on 8B's push (CI 41682793143), and 8C adds tests.
check("node: the job's timeout keeps its time out of the last 25% (at least 25 minutes)",
      isinstance(node.get("timeout-minutes"), int) and node["timeout-minutes"] >= 25,
      str(node.get("timeout-minutes")))
merge = jobs.get("unit-api-coverage", {})
merge_run = runs(merge)
check("unit-api-coverage: needs the two shards", merge.get("needs") in ("unit-api", ["unit-api"]),
      str(merge.get("needs")))
check("unit-api-coverage: downloads every shard's blob report",
      any("unit-api-blob-" in str((s.get("with") or {}).get("pattern", ""))
          and (s.get("with") or {}).get("merge-multiple") is True
          for s in uses(merge, "actions/download-artifact@")))
merge_steps = [s for s in steps(merge) if "--merge-reports" in str(s.get("run", ""))]
merge_cmd = " ".join(str(s.get("run", "")) for s in merge_steps)
check("unit-api-coverage: merges the reports in apps/api and applies the 80% coverage gate to the whole",
      len(merge_steps) == 1 and str(merge_steps[0].get("working-directory", "")) == "apps/api"
      and re.search(r"pnpm exec vitest run --merge-reports=\S+ --coverage(\s|$)", merge_cmd) is not None
      and "thresholds" not in merge_cmd, merge_cmd)
check("unit-api-coverage: uploads the merged coverage report",
      any("coverage" in str((s.get("with") or {}).get("path", ""))
          for s in uses(merge, "actions/upload-artifact@")))
check("unit-api: no job runs the api suite unsharded any more",
      not [name for name, job in jobs.items()
           if re.search(r"pnpm turbo run test --filter=@openverify/api(\s|$)", runs(job))])

fmt = jobs.get("format", {})
check("format: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in runs(fmt))
check("format: runs `pnpm format:check`", "pnpm format:check" in runs(fmt))

integ = jobs.get("integration", {})
check("integration: runs `pnpm test:integration` (Testcontainers)", "pnpm test:integration" in runs(integ))

# Workflow 5C review P019 (C60.2): the vision container and network contract runs in CI, so a
# change that puts vision on the default network, drops cap_drop or makes its root writable fails
# a job. Its static half needs only `docker compose config` and jq, which the runner has. Its
# live half builds the vision image and starts it with the model weights, which no CI job does
# cheaply, so it stays a local gate (docs/checks/document.md).
infra = jobs.get("infra", {})
infra_run = runs(infra)
vision_contract = [line for line in infra_run.splitlines() if "infra/tests/vision-container.test.sh" in line]
check("infra: runs the vision isolation contract's static half (bash infra/tests/vision-container.test.sh --static-only)",
      any(re.fullmatch(r"\s*bash infra/tests/vision-container\.test\.sh --static-only\s*", line)
          for line in vision_contract), str(vision_contract))
check("infra: never runs the contract's live half, which builds and starts the vision image",
      bool(vision_contract) and all("--static-only" in line for line in vision_contract), str(vision_contract))
check("infra: no other job runs the vision isolation contract (one place to read its result)",
      not [name for name, job in jobs.items()
           if name != "infra" and "vision-container.test.sh" in runs(job)])
# Phase 5 carry-forward P5-7: the static parts of the other infra tests run there too. The compose
# contract's live half and the gitleaks installer's download test stay local.
for script, args in (("compose.test.sh", " --static-only"), ("apps-image-context.test.sh", ""),
                     ("flow-headers.test.sh", " --static-only"),
                     ("check-connected-results.test.sh", ""), ("pre-commit-hook.test.sh", ""),
                     # C169.4 (Workflow 9B): the gitleaks configuration's rule and allowlist.
                     ("gitleaks-config.test.sh", ""),
                     ("ci-workflow.test.sh", ""),
                     # C123.3 (P17): the code runner's image and its container, whole: it builds
                     # alone, in about two minutes, and it is where the no-network claim is proved.
                     ("code-runner.test.sh", "")):
    check(f"infra: runs bash infra/tests/{script}{args}",
          any(re.fullmatch(rf"\s*bash infra/tests/{re.escape(script)}{re.escape(args)}\s*", line)
              for line in infra_run.splitlines()))
compose_lines = [line for line in infra_run.splitlines() if "infra/tests/compose.test.sh" in line]
check("infra: never runs the compose contract's live half",
      bool(compose_lines) and all("--static-only" in line for line in compose_lines), str(compose_lines))
infra_steps = steps(infra)
gitleaks_at = next((i for i, s in enumerate(infra_steps) if "install-gitleaks.sh" in str(s.get("run", ""))), None)
hook_at = next((i for i, s in enumerate(infra_steps) if "pre-commit-hook.test.sh" in str(s.get("run", ""))), None)
check("infra: installs the pinned gitleaks before the pre-commit hook test",
      gitleaks_at is not None and hook_at is not None and gitleaks_at < hook_at)
config_at = next((i for i, s in enumerate(infra_steps) if "gitleaks-config.test.sh" in str(s.get("run", ""))), None)
check("infra: installs the pinned gitleaks before the gitleaks configuration test",
      gitleaks_at is not None and config_at is not None and gitleaks_at < config_at)
# KP10-33 (Workflow 10D): this contract's release section scans a synthetic staged repository
# with gitleaks and skipped that scan when gitleaks was missing; the job ran this contract before
# the install, so in CI the scan never ran. The install comes first.
contract_at = next((i for i, s in enumerate(infra_steps) if "ci-workflow.test.sh" in str(s.get("run", ""))), None)
check("infra: installs the pinned gitleaks before the CI workflow contract, whose release section scans with it (KP10-33)",
      gitleaks_at is not None and contract_at is not None and gitleaks_at < contract_at,
      f"install at step {gitleaks_at}, the contract at step {contract_at}")

# Workflow 11G (records-11g, Q5 granted 2026-11-21): every setup-uv step installs the uv the vision
# image builds with (its Dockerfile's UV_IMAGE tag), which is the uv THIRD_PARTY_LICENSES.md's section 1
# row records (the newest uv at least 14 days old), and checks its linux x86_64 asset against the
# SHA-256 that row records (setup-uv's `checksum` input), never only astral's versions manifest.
_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(wf_path))))
with open(os.path.join(_root, "services", "vision", "Dockerfile"), encoding="utf-8") as fh:
    _uv_image = re.search(r"^ARG UV_IMAGE=ghcr\.io/astral-sh/uv:([0-9.]+)@sha256:[0-9a-f]{64}$", fh.read(), re.M)
with open(os.path.join(_root, "THIRD_PARTY_LICENSES.md"), encoding="utf-8") as fh:
    _ledger = fh.read()
_uv_row = re.search(r"^\| uv \| ([0-9.]+) \(", _ledger, re.M)
_uv_asset = re.search(r"uv-x86_64-unknown-linux-gnu\.tar\.gz` asset's SHA-256 `([0-9a-f]{64})`", _ledger)
_uv_steps = [(name, s) for name, job in jobs.items() for s in uses(job, "astral-sh/setup-uv@")]
check("every setup-uv step: three of them (supply-chain, vision, e2e)", len(_uv_steps) == 3, str(len(_uv_steps)))
check("the vision Dockerfile's UV_IMAGE names a uv version by tag and digest", _uv_image is not None)
check("THIRD_PARTY_LICENSES.md records the uv version and its linux asset checksum",
      _uv_row is not None and _uv_asset is not None)
for _name, _step in _uv_steps:
    _with = _step.get("with") or {}
    _version = str(_with.get("version", ""))
    check(f"{_name}: setup-uv installs the vision image's uv ({_uv_image.group(1) if _uv_image else '?'})",
          _uv_image is not None and _version == _uv_image.group(1), _version)
    check(f"{_name}: setup-uv installs the uv THIRD_PARTY_LICENSES.md records (Q5)",
          _uv_row is not None and _version == _uv_row.group(1), _version)
    check(f"{_name}: setup-uv checks the asset against the recorded SHA-256 (`checksum`)",
          _uv_asset is not None and str(_with.get("checksum", "")) == _uv_asset.group(1),
          str(_with.get("checksum", "")))

vision = jobs.get("vision", {})
vision_run = runs(vision)
check("vision: sets up uv with astral-sh/setup-uv", bool(uses(vision, "astral-sh/setup-uv@")))
check("vision: works in services/vision", wd(vision) == "services/vision")
check("vision: syncs the locked environment", "uv sync --locked" in vision_run)
for cmd in ("uv run ruff check", "uv run ruff format --check", "uv run mypy", "uv run pytest"):
    check(f"vision: runs `{cmd}`", cmd in vision_run)
check("vision: type-checks the fixture tools too (`uv run mypy src tools`)", "uv run mypy src tools" in vision_run)
check("vision: fetches the model weights and faces, so the real-model tests run",
      "fetch_models.py" in vision_run and "fetch_fixtures.py" in vision_run)
# Phase 3 (C33): models a later stage adds (OCR) reach CI only when no fixed --only list is used.
check("vision: fetches every model in models/manifest.json (no --only list)",
      "fetch_models.py" in vision_run and "--only" not in vision_run)
# Phase 3 (C32.4): the CI vision job runs the committed budget benchmark and logs it. A shared
# runner's speed is not the development machine's, so the step logs the figure and never gates
# on it, but it still fails when the benchmark itself cannot run.
bench_steps = [s for s in vision.get("steps", []) if "tools/benchmark_government_id.py" in str(s.get("run", ""))]
bench = bench_steps[0] if bench_steps else {}
bench_run = str(bench.get("run", ""))
check("vision: runs the C32.4 benchmark (tools/benchmark_government_id.py)", len(bench_steps) == 1)
check("vision: the benchmark runs after pytest",
      bool(bench_steps) and [str(s.get("run", "")) for s in vision.get("steps", [])].index(bench_run)
      > max((i for i, s in enumerate(vision.get("steps", [])) if "uv run pytest" in str(s.get("run", "")) and s.get("working-directory") != "load"), default=10**6))
check("vision: the benchmark is logged, never gated on a runner's speed (no --enforce)",
      bool(bench_steps) and "--enforce" not in bench_run)
check("vision: the benchmark appends its Markdown summary to the job summary",
      "GITHUB_STEP_SUMMARY" in bench_run)
check("vision: the benchmark step fails when the tool fails (bash with pipefail)",
      bench.get("shell") == "bash")

# Phase 4 (C41.5): the CI vision job also runs the committed selfie budget benchmark (centre,
# left and right at 1,280 pixels, median of 10) and logs it, never gating on a runner's speed.
selfie_bench_steps = [s for s in vision.get("steps", []) if "tools/benchmark_selfie.py" in str(s.get("run", ""))]
selfie_bench = selfie_bench_steps[0] if selfie_bench_steps else {}
selfie_bench_run = str(selfie_bench.get("run", ""))
check("vision: runs the C41.5 selfie benchmark (tools/benchmark_selfie.py)", len(selfie_bench_steps) == 1)
check("vision: the selfie benchmark runs after pytest",
      bool(selfie_bench_steps) and [str(s.get("run", "")) for s in vision.get("steps", [])].index(selfie_bench_run)
      > max((i for i, s in enumerate(vision.get("steps", [])) if "uv run pytest" in str(s.get("run", "")) and s.get("working-directory") != "load"), default=10**6))
check("vision: the selfie benchmark is logged, never gated on a runner's speed (no --enforce)",
      bool(selfie_bench_steps) and "--enforce" not in selfie_bench_run)
check("vision: the selfie benchmark appends its Markdown summary to the job summary",
      "GITHUB_STEP_SUMMARY" in selfie_bench_run)
check("vision: the selfie benchmark step fails when the tool fails (bash with pipefail)",
      selfie_bench.get("shell") == "bash")

# Phase 5 (C60, Workflow 5B): the CI vision job also runs the committed document budget benchmark
# (a 3-page born-digital PDF through the guarded child and the OCR of its boxes, median of 10)
# and logs it, never gating on a runner's speed (the 4 s budget is set on the development machine).
document_bench_steps = [s for s in vision.get("steps", []) if "tools/benchmark_document.py" in str(s.get("run", ""))]
document_bench = document_bench_steps[0] if document_bench_steps else {}
document_bench_run = str(document_bench.get("run", ""))
check("vision: runs the C60 document benchmark (tools/benchmark_document.py)", len(document_bench_steps) == 1)
check("vision: the document benchmark runs after pytest",
      bool(document_bench_steps) and [str(s.get("run", "")) for s in vision.get("steps", [])].index(document_bench_run)
      > max((i for i, s in enumerate(vision.get("steps", [])) if "uv run pytest" in str(s.get("run", "")) and s.get("working-directory") != "load"), default=10**6))
check("vision: the document benchmark is logged, never gated on a runner's speed (no --enforce)",
      bool(document_bench_steps) and "--enforce" not in document_bench_run)
check("vision: the document benchmark appends its Markdown summary to the job summary",
      "GITHUB_STEP_SUMMARY" in document_bench_run)
check("vision: the document benchmark step fails when the tool fails (bash with pipefail)",
      document_bench.get("shell") == "bash")
# The vision suite grew to about 2,450 tests (8 to 11 minutes locally) and runs three benchmarks.
check("vision: the job's timeout leaves room for the suite and the benchmarks (at least 30 minutes)",
      isinstance(vision.get("timeout-minutes"), int) and vision["timeout-minutes"] >= 30,
      str(vision.get("timeout-minutes")))

# Phase 5 (C60.7, fixtures-5b): scripts/fetch_fixtures.py also downloads the blank federal forms
# (pinned in fixtures/manifest.json) into fixtures/generated/federal-forms; the vision and e2e jobs
# restore them from a cache keyed on that manifest first, so an irs.gov outage cannot fail CI.
for job_name in ("vision", "e2e"):
    job = jobs.get(job_name, {})
    job_steps = steps(job)
    form_caches = [s for s in uses(job, "actions/cache@")
                   if "fixtures/generated/federal-forms" in str((s.get("with") or {}).get("path", ""))]
    form_cache = (form_caches[0].get("with") or {}) if len(form_caches) == 1 else {}
    check(f"{job_name}: caches the federal forms (fixtures/generated/federal-forms)", len(form_caches) == 1)
    check(f"{job_name}: the federal forms cache key hashes fixtures/manifest.json",
          "hashFiles('fixtures/manifest.json')" in str(form_cache.get("key", "")))
    fetch_at = next((i for i, s in enumerate(job_steps) if "fetch_fixtures.py" in str(s.get("run", ""))), None)
    cache_at = next((i for i, s in enumerate(job_steps) if form_caches and s is form_caches[0]), None)
    check(f"{job_name}: the federal forms cache is restored before fetch_fixtures.py",
          cache_at is not None and fetch_at is not None and cache_at < fetch_at)

android = jobs.get("android", {})
java = uses(android, "actions/setup-java@")
java_with = (java[0].get("with") or {}) if java else {}
check("android: Temurin JDK 21 via actions/setup-java",
      java_with.get("distribution") == "temurin" and str(java_with.get("java-version")) == "21", str(java_with))
check("android: android-actions/setup-android", bool(uses(android, "android-actions/setup-android@")))
check("android: works in android/", wd(android) == "android")

# KMP migration (docs/plans/kmp-migration.plan.md K8). The SDK is a Kotlin Multiplatform library:
# its host tests run in testAndroidHostTest (testDebugUnitTest no longer reaches it), and
# :openverify-sdk:assemble builds the AAR and cross-compiles the iOS main and test klibs on Linux.
import subprocess
import tempfile
import tomllib

repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(wf_path))))
scratch_root = os.environ.get("SCRATCH_ROOT") or os.environ.get("TMPDIR") or "/tmp"
os.makedirs(scratch_root, exist_ok=True)


def run_step(script, cwd, github_output=None):
    """Runs a step's script as a GitHub Ubuntu runner runs `shell: bash`; returns (exit code, output, outputs)."""
    env = dict(os.environ)
    if github_output:
        env["GITHUB_OUTPUT"] = github_output
    proc = subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=120)
    outputs = {}
    if github_output and os.path.exists(github_output):
        with open(github_output, encoding="utf-8") as fh:
            outputs = dict(line.rstrip("\n").split("=", 1) for line in fh if "=" in line)
    return proc.returncode, proc.stdout + proc.stderr, outputs


android_gradle = "./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint"
android_steps = steps(android)
android_runs = [str(s.get("run", "")) for s in android_steps]
gradle_at = next((i for i, text in enumerate(android_runs) if android_gradle in text), None)
check(f"android: runs {android_gradle} (KMP host tests, the iOS klibs, lint)", gradle_at is not None)

# The Kotlin/Native toolchain (about 820 MB in ~/.konan) is cached, keyed on the Kotlin version.
konan = [s for s in uses(android, "actions/cache@") if "~/.konan" in str((s.get("with") or {}).get("path", ""))]
check("android: caches the Kotlin/Native toolchain (~/.konan) with actions/cache", len(konan) == 1)
konan_at = next((i for i, s in enumerate(android_steps) if konan and s is konan[0]), None)
check("android: the konan cache is restored before the Gradle run",
      konan_at is not None and gradle_at is not None and konan_at < gradle_at)
konan_key = str(((konan[0].get("with") or {}) if konan else {}).get("key", ""))
key_ref = re.search(r"\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)\s*\}\}", konan_key)
version_at = next((i for i, s in enumerate(android_steps) if key_ref and s.get("id") == key_ref.group(1)), None)
check("android: the konan cache key names an earlier step's output",
      version_at is not None and konan_at is not None and version_at < konan_at, konan_key)
with open(os.path.join(repo_root, "android", "gradle", "libs.versions.toml"), "rb") as fh:
    kotlin_version = tomllib.load(fh)["versions"]["kotlin"]
key_outputs = {}
if version_at is not None:
    with tempfile.TemporaryDirectory(dir=scratch_root) as tmp:
        _, _, key_outputs = run_step(android_runs[version_at], os.path.join(repo_root, "android"),
                                     os.path.join(tmp, "github-output"))
check(f"android: the konan cache key is the catalog's Kotlin version ({kotlin_version})",
      bool(key_ref) and key_outputs.get(key_ref.group(2)) == kotlin_version, str(key_outputs))

# C220.1 (Phase 10, Workflow 10A integration-10a): the android job's second Gradle step runs the
# Roborazzi screenshot task with comparison on (a missing or changed golden fails; nothing is ever
# recorded in CI), the ABI check of every published module (KGP's checkKotlinAbi, BCV's tasks for
# openverify-nfc under the same name) and the minified demo's bundle, and uploads Roborazzi's
# comparison images with the reports.
android_extra = ":openverify-sdk:screenshotTest -Proborazzi.test.verify=true checkKotlinAbi :demo-app:bundleRelease"
extra_at = next((i for i, text in enumerate(android_runs) if android_extra in text), None)
check(f"android: runs ./gradlew {android_extra} (C220.1)", extra_at is not None)
check("android: the screenshot, ABI and bundle step runs after the host tests' Gradle step",
      extra_at is not None and gradle_at is not None and extra_at > gradle_at)
check("android: no step records screenshots (goldens are recorded only by an explicit local call)",
      not any("roborazzi.test.record" in text for text in android_runs))
reports = [s for s in uses(android, "actions/upload-artifact@") if "build/reports" in str((s.get("with") or {}).get("path", ""))]
check("android: the uploaded reports include Roborazzi's comparison images",
      len(reports) == 1 and "build/outputs/roborazzi" in str((reports[0].get("with") or {}).get("path", "")))

# The test-count floor: a silently shrunken or skipped SDK suite fails the job, as
# infra/scripts/check-connected-results.sh does for the device tests. 2739 is the count Workflow 11F
# reached (fix-clients' gate, three groups of 533, 427 and 1779: 11A's 2732 plus fix-clients' KP11-79,
# KP10-53 and KP10-56 cases; docs/tdd/phase11-fix-clients.tdd.md). 2732 is the count Workflow 11A
# reached (integration-11a's gate, three groups of 532, 427 and 1773): 10E's 2691, plus contracts-11a's
# 5 (2696), plus clients-connect's 36 (docs/tdd/phase11-integration-11a.tdd.md). 2691 is the count Workflow 10E
# reached (integration-10e's gate, three groups of 522, 416 and 1753): 10D's 2677, plus contracts-10e's
# 13 net of K10A-1's removed cases (2690), plus integration-10e's 1 (docs/tdd/phase10-integration-10e.tdd.md).
# 2677 is the count Workflow
# 10D's fixers reached (fix-sdk's final gate, three groups of 524, 414 and 1739): 10C's 2602, plus
# android-a11y-audit's 49 (2651; docs/tdd/phase10-android-a11y-audit.tdd.md), plus fix-sdk's 26
# (docs/tdd/phase10-fix-sdk.tdd.md), measured again by fix-records. 2602 is the count Workflow
# 10C reached (integration-10c's validation, three groups of 476, 401 and 1725): 10B's 2321, plus
# carry-10c's 40 and contracts-10c's 25 (2386 at Stage 1a's close), plus nfc-sdk's 113 less the 1
# stub pin it removed, privacy-checks' 90 and docs-android's 12 (2600 at the Stage 2 gates), plus
# integration-10c's 2 (docs/tdd/phase10-integration-10c.tdd.md). 2321 is the count Workflow
# 10B reached (its validation's gate call (a), three groups of 450, 394 and 1477): 10A's 1934, plus
# contracts-10b's 26 (1960), plus 352 from Stage 1b and the five Stage 2 agents (2312 at their
# gates; docs/tdd/phase10-*.tdd.md), plus integration-10b's 10, less the 1 stub test it removed with
# the wiring (docs/tdd/phase10-integration-10b.tdd.md). 1934 is the
# count Workflow 10A reached: 9B's 1366, lowered once by the 78 test invocations android-driver deleted with
# FlowNavigator, JsonLogic and the v1 projection (C219.6, docs/tdd/phase10-android-driver.tdd.md),
# to 1288, then raised by the 646 10A added (docs/tdd/phase10-integration-10a.tdd.md). 1366 is the count Workflow 9B
# reached (contracts-9b's two decoded fixtures, docs/tdd/phase9-contracts-9b.tdd.md). 1364 was 9A's,
# ended with (contracts-9a's FlowCoordinatorProjectionTest, 26 tests, and the new session fixtures in
# ContractFixturesTest; docs/tdd/phase9-contracts-9a.tdd.md), raised from Workflow 8A's 1334
# (docs/tdd/phase8-integration-8a.tdd.md), raised in turn from Workflow 7C's 1333
# (contracts-7a's 4, android-signals' 50 signal tests and flow-handoff's 9 coordinator tests over
# 5C's 1264; docs/tdd/phase7-android-signals.tdd.md), Workflow 5C's 1264,
# 5B's 1256, 5A's 1176 and the Kotlin Multiplatform migration's 928; each scenario below runs the step's
# own script on synthetic JUnit XML laid out the way Gradle writes it under android/.
# Workflow 10D review (A004; Phase 8 F08's rule): the job last ran to its end on the 10B push, in
# 21.8 minutes of 45 (CI 42762952128). On the 10C push (CI 42937477615) it had spent 27.7 minutes
# when it failed at the consumer-rules step, with the size check, both floors and the sdk,nfc call
# not reached, and 10D then added 75 host tests and 113 goldens. The whole job has not been
# measured since, so nothing is split; the timeout keeps the 27.7 measured minutes and the steps
# after them out of the last 25% (at least 60: 75% is 45 minutes). The first run that reaches the
# end gives the time a split is decided on.
check("android: the job's timeout keeps its 27.7 measured minutes and the unmeasured steps after them out of the last 25% (at least 60)",
      isinstance(android.get("timeout-minutes"), int) and android["timeout-minutes"] >= 60,
      str(android.get("timeout-minutes")))
floor_at = [i for i, text in enumerate(android_runs) if "test-results/testAndroidHostTest" in text]
check("android: one step checks the SDK host test results (the test-count floor)", len(floor_at) == 1)
floor_step = android_steps[floor_at[0]] if len(floor_at) == 1 else {}
check("android: the test-count floor runs after the Gradle step",
      bool(floor_step) and gradle_at is not None and floor_at[0] > gradle_at)
check("android: the test-count floor runs in bash with pipefail", floor_step.get("shell") == "bash")


def write_host_results(root, tests, skipped=0, failed=0):
    """Writes `tests` SDK host test cases as Gradle's JUnit XML, over two classes."""
    results = os.path.join(root, "openverify-sdk", "build", "test-results", "testAndroidHostTest")
    os.makedirs(results)
    marks = ["skipped"] * skipped + ["failure"] * failed
    for cls, count in (("dev.openverify.sdk.flow.FlowCoordinatorTest", tests // 2),
                       ("dev.openverify.sdk.ui.MessagesTest", tests - tests // 2)):
        cases, kinds = [], []
        for i in range(count):
            kind = marks.pop() if marks else None
            kinds.append(kind)
            body = f"<{kind} message=\"synthetic\"/>" if kind else ""
            cases.append(f'  <testcase name="case {i}()" classname="{cls}" time="0.001">{body}</testcase>')
        with open(os.path.join(results, f"TEST-{cls}.xml"), "w", encoding="utf-8") as fh:
            fh.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="{cls}" tests="{count}" '
                     f'skipped="{kinds.count("skipped")}" failures="{kinds.count("failure")}" errors="0" '
                     f'time="0.1">\n' + "\n".join(cases) + "\n</testsuite>\n")


floor_script = str(floor_step.get("run", ""))
floor_cases = [
    ("passes with Workflow 11F's 2739 host tests, none skipped", (2739, 0, 0), True),
    ("fails with one test fewer than 11F's floor (2738)", (2738, 0, 0), False),
    ("fails at Workflow 11A's earlier floor of 2732", (2732, 0, 0), False),
    ("fails with one test fewer than 11A's floor (2731)", (2731, 0, 0), False),
    ("fails at Workflow 10E's earlier floor of 2691", (2691, 0, 0), False),
    ("fails with one test fewer than 10E's floor (2690, Stage 1a's count)", (2690, 0, 0), False),
    ("fails at Workflow 10D's earlier floor of 2677", (2677, 0, 0), False),
    ("fails at the 2651 the 10D audit reached, before the fixers' tests", (2651, 0, 0), False),
    ("fails at Workflow 10C's earlier floor of 2602", (2602, 0, 0), False),
    ("fails at Workflow 10B's earlier floor of 2321", (2321, 0, 0), False),
    ("fails at Workflow 10A's earlier floor of 1934", (1934, 0, 0), False),
    ("fails at Workflow 10A's count after the deletions alone (1288)", (1288, 0, 0), False),
    ("fails at Workflow 9B's earlier floor of 1366", (1366, 0, 0), False),
    ("fails at Workflow 8A's earlier floor of 1334", (1334, 0, 0), False),
    ("fails at Workflow 7C's earlier floor of 1333", (1333, 0, 0), False),
    ("passes above the floor, as later phases add tests", (2750, 0, 0), True),
    ("fails at Workflow 7A's earlier floor of 1327", (1327, 0, 0), False),
    ("fails at Workflow 5C's earlier floor of 1264", (1264, 0, 0), False),
    ("fails at Workflow 5B's earlier floor of 1256", (1256, 0, 0), False),
    ("fails at Workflow 5A's earlier floor of 1176", (1176, 0, 0), False),
    ("fails at the migration's earlier floor of 928", (928, 0, 0), False),
    ("fails at the old K7 baseline of 631", (631, 0, 0), False),
    ("fails when a host test was skipped", (2739, 1, 0), False),
    ("fails when a host test failed", (2739, 0, 1), False),
    ("fails when there are no host test results", None, False),
]
with tempfile.TemporaryDirectory(dir=scratch_root) as tmp:
    for n, (desc, counts, passes) in enumerate(floor_cases):
        case_dir = os.path.join(tmp, f"case-{n}")
        os.makedirs(case_dir)
        if counts:
            write_host_results(case_dir, *counts)
        rc, out, _ = run_step(floor_script, case_dir) if floor_script else (None, "no floor step", {})
        check(f"android: the test-count floor {desc}", rc is not None and (rc == 0) == passes,
              f"exit {rc}: {out.strip()[-200:]}")

# C220.1, C216, C215 (Phase 10, Workflow 10C integration-10c): the android job fetches the pinned
# bundletool before any Gradle step, runs the release checks' own unit tests, builds the minified
# release APK beside its bundle, then runs the three static checks release-checks built: the 16 KB
# checks, the consumer rules as R8 applied them, and the SDK-only size against the committed baseline.
# The sdk,nfc configuration's merged manifest is then held to its allowlist by the demo's own tests.
# Written and held here; no run of this job is claimed (rule 28).
def step_at(needle):
    return next((i for i, text in enumerate(android_runs) if needle in text), None)


fetch_at = step_at("scripts/fetch_bundletool.py")
check("android: fetches the pinned bundletool with python3 -I (C214.7)",
      fetch_at is not None and "python3 -I scripts/fetch_bundletool.py" in android_runs[fetch_at])
check("android: the bundletool fetch runs from the repository root, before the first Gradle step",
      fetch_at is not None and gradle_at is not None and fetch_at < gradle_at
      and str(android_steps[fetch_at].get("working-directory", "")).replace(" ", "") == "${{github.workspace}}")
# C205.3 (Workflow 10E): openverify-face's asset task copies the YuNet model into the AAR and fails
# when it is absent, and its host tests and device-test compile read one fetched public-domain face.
# Both are fetched, pinned by SHA-256, from the repository root before any Gradle step.
for job_name, job_runs, job_steps_, first_gradle in (("android", android_runs, android_steps, gradle_at),):
    yunet_at = next((i for i, text in enumerate(job_runs) if "fetch_models.py --only face_detection_yunet" in text), None)
    check(f"{job_name}: fetches the pinned YuNet model with python3 -I before the first Gradle step (C205.3)",
          yunet_at is not None and first_gradle is not None and yunet_at < first_gradle
          and "python3 -I scripts/fetch_models.py --only face_detection_yunet" in job_runs[yunet_at]
          and str(job_steps_[yunet_at].get("working-directory", "")).replace(" ", "") == "${{github.workspace}}")
    check(f"{job_name}: fetches the one fixture face openverify-face's tests read (person_a_id) in the same step",
          yunet_at is not None and "python3 -I scripts/fetch_fixtures.py --only person_a_id" in job_runs[yunet_at])
unit_at = step_at("unittest discover -s scripts/tests")
check("android: runs the release checks' own unit tests (python3 -I -m unittest discover -s scripts/tests)",
      unit_at is not None and "python3 -I -m unittest discover -s scripts/tests" in android_runs[unit_at])
check("android: the screenshot, ABI and bundle step also builds the minified release APK (:demo-app:assembleRelease)",
      extra_at is not None and ":demo-app:assembleRelease" in android_runs[extra_at])
check("android: the release build step also builds openverify-nfc's release AAR, which the consumer-rules check reads",
      extra_at is not None and ":openverify-nfc:assembleRelease" in android_runs[extra_at])
check("android: the release build step also builds openverify-face's release AAR, which the consumer-rules check reads (Workflow 10E)",
      extra_at is not None and ":openverify-face:assembleRelease" in android_runs[extra_at])
elf_at = step_at("scripts/check-elf-alignment.py")
rules_at = step_at("scripts/check-consumer-rules.py")
size_at = step_at("scripts/check-size.py")
for name, at in (("the 16 KB checks (check-elf-alignment.py)", elf_at),
                 ("the consumer-rules check (check-consumer-rules.py)", rules_at),
                 ("the size check (check-size.py)", size_at)):
    check(f"android: runs {name} with python3 -I after the release build",
          at is not None and extra_at is not None and at > extra_at and "python3 -I scripts/check-" in android_runs[at])
check("android: the per-push size check measures the SDK-only configuration (sdk,nfc is the release workflow's)",
      size_at is not None and "--configuration" not in android_runs[size_at] and "--write-baseline" not in runs(android))
nfc_manifest = "./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest"
nfc_manifest_at = step_at(nfc_manifest)
check(f"android: runs {nfc_manifest} (the sdk,nfc merged manifest against its allowlist, C215.3)",
      nfc_manifest_at is not None)
check("android: the sdk,nfc manifest step runs after the size check read the default bundle",
      nfc_manifest_at is not None and size_at is not None and nfc_manifest_at > size_at)
# Workflow 10E: the two configurations with openverify-face, each against its own allowlist
# (manifest-allowlist/sdk-face.json, sdk-nfc-face.json), after sdk,nfc and last of the checks.
face_manifest_at = [step_at(f"./gradlew -PopenverifyDemoArtifacts={artifacts} :demo-app:testDebugUnitTest") for artifacts in ("sdk,face", "sdk,nfc,face")]
check("android: runs the sdk,face and sdk,nfc,face merged manifests against their allowlists, after sdk,nfc (C215.3; Workflow 10E)",
      None not in face_manifest_at and nfc_manifest_at is not None and nfc_manifest_at < face_manifest_at[0] < face_manifest_at[1],
      f"{nfc_manifest_at} {face_manifest_at}")
check("android: no demo configuration with a Play Integrity artifact exists (Phase 10 P3 declined)",
      re.search(r"openverifyDemoArtifacts=\S*(integrity|play)", runs(android)) is None and "openverify-integrity-play" not in runs(android))

# The demo's own floor (C219.6; demo-app's finding: with testBuildType = minifiedSmoke the gate once
# ran none of the demo's tests and stayed green): 81 host tests on the debug variant (10C's 80 and
# the SmokeBuildTest case Workflow 10D's KP10-32 fix added) and the smoke test's 8 host twins on
# minifiedSmoke, none skipped.
demo_floor_at = [i for i, text in enumerate(android_runs) if "demo-app/build/test-results/testDebugUnitTest" in text]
check("android: one step checks the demo's host test results (the demo's floor)", len(demo_floor_at) == 1)
demo_floor_step = android_steps[demo_floor_at[0]] if len(demo_floor_at) == 1 else {}
check("android: the demo's floor runs in bash, after the Gradle step and before the sdk,nfc step reruns the demo's tests",
      bool(demo_floor_step) and demo_floor_step.get("shell") == "bash" and gradle_at is not None
      and demo_floor_at[0] > gradle_at and nfc_manifest_at is not None and demo_floor_at[0] < nfc_manifest_at)


def write_demo_results(root, debug, smoke, skipped=0, failed=0):
    """Writes the demo's host test cases as Gradle's JUnit XML: `debug` on the debug variant, `smoke` twins."""
    marks = ["skipped"] * skipped + ["failure"] * failed
    for task, cls, count in (("testDebugUnitTest", "dev.openverify.demo.DemoFormTest", debug),
                             ("testMinifiedSmokeUnitTest", "dev.openverify.demo.smoke.SmokeTrustTest", smoke)):
        if count is None:
            continue
        results = os.path.join(root, "demo-app", "build", "test-results", task)
        os.makedirs(results)
        cases = []
        for i in range(count):
            kind = marks.pop() if marks else None
            body = f"<{kind} message=\"synthetic\"/>" if kind else ""
            cases.append(f'  <testcase name="case {i}()" classname="{cls}" time="0.001">{body}</testcase>')
        with open(os.path.join(results, f"TEST-{cls}.xml"), "w", encoding="utf-8") as fh:
            fh.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="{cls}" tests="{count}" time="0.1">\n'
                     + "\n".join(cases) + "\n</testsuite>\n")


demo_floor_script = str(demo_floor_step.get("run", ""))
demo_floor_cases = [
    ("passes with Workflow 10E's 97 debug-variant tests and the 9 smoke twins", (97, 9), True),
    ("passes above both floors", (110, 10), True),
    ("fails with one debug-variant test fewer (96)", (96, 9), False),
    ("fails with one smoke twin fewer (8)", (97, 8), False),
    ("fails at Workflow 10D's earlier floors of 81 and 8", (81, 8), False),
    ("fails at the 18 tests the demo had before 10C", (18, 9), False),
    ("fails when the smoke twins did not run", (97, None), False),
    ("fails when the debug variant's tests did not run", (None, 9), False),
    ("fails when a demo test was skipped", (97, 9, 1, 0), False),
    ("fails when a demo test failed", (97, 9, 0, 1), False),
]
with tempfile.TemporaryDirectory(dir=scratch_root) as tmp:
    for n, (desc, counts, passes) in enumerate(demo_floor_cases):
        case_dir = os.path.join(tmp, f"demo-{n}")
        os.makedirs(case_dir)
        write_demo_results(case_dir, *counts)
        rc, out, _ = run_step(demo_floor_script, case_dir) if demo_floor_script else (None, "no demo floor step", {})
        check(f"android: the demo's floor {desc}", rc is not None and (rc == 0) == passes,
              f"exit {rc}: {out.strip()[-200:]}")

# Workflow 10E (C219.6): each optional artifact has a floor of its own, beside the SDK's and the
# demo's: openverify-nfc's 116 host tests (nfc-reader's 111 and integration-10e's 5 for reviews E004
# and E005) and openverify-face's 51 (face-onnx's), none skipped. testDebugUnitTest of the gate line
# runs both; a module whose tests stop running fails here while Gradle stays green.
module_floor_at = [i for i, text in enumerate(android_runs) if "openverify-nfc/build/test-results/testDebugUnitTest" in text]
check("android: one step checks the optional artifacts' host test results (their floors)", len(module_floor_at) == 1)
module_floor_step = android_steps[module_floor_at[0]] if len(module_floor_at) == 1 else {}
module_floor_script = str(module_floor_step.get("run", ""))
check("android: the optional artifacts' floors run in bash, after the Gradle step, and name both modules",
      bool(module_floor_step) and module_floor_step.get("shell") == "bash" and gradle_at is not None and module_floor_at[0] > gradle_at
      and "openverify-nfc/build/test-results/testDebugUnitTest=116" in module_floor_script
      and "openverify-face/build/test-results/testDebugUnitTest=51" in module_floor_script)


def write_module_results(root, nfc, face, skipped=0, failed=0):
    """Writes the optional artifacts' host test cases as Gradle's JUnit XML."""
    marks = ["skipped"] * skipped + ["failure"] * failed
    for module, cls, count in (("openverify-nfc", "dev.openverify.nfc.ChipReadOrchestratorTest", nfc),
                               ("openverify-face", "dev.openverify.face.OrtFaceDetectorTest", face)):
        if count is None:
            continue
        results = os.path.join(root, module, "build", "test-results", "testDebugUnitTest")
        os.makedirs(results)
        cases = []
        for i in range(count):
            kind = marks.pop() if marks else None
            body = f"<{kind} message=\"synthetic\"/>" if kind else ""
            cases.append(f'  <testcase name="case {i}()" classname="{cls}" time="0.001">{body}</testcase>')
        with open(os.path.join(results, f"TEST-{cls}.xml"), "w", encoding="utf-8") as fh:
            fh.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="{cls}" tests="{count}" time="0.1">\n'
                     + "\n".join(cases) + "\n</testsuite>\n")


module_floor_cases = [
    ("pass with openverify-nfc's 116 host tests and openverify-face's 51", (116, 51), True),
    ("pass above both floors", (130, 60), True),
    ("fail with one openverify-nfc test fewer (115)", (115, 51), False),
    ("fail with one openverify-face test fewer (50)", (116, 50), False),
    ("fail at the 11 and 11 the stand-ins had at Stage 1a", (11, 11), False),
    ("fail when openverify-face's tests did not run", (116, None), False),
    ("fail when openverify-nfc's tests did not run", (None, 51), False),
    ("fail when a test was skipped", (116, 51, 1, 0), False),
    ("fail when a test failed", (116, 51, 0, 1), False),
]
with tempfile.TemporaryDirectory(dir=scratch_root) as tmp:
    for n, (desc, counts, passes) in enumerate(module_floor_cases):
        case_dir = os.path.join(tmp, f"module-{n}")
        os.makedirs(case_dir)
        write_module_results(case_dir, *counts)
        rc, out, _ = run_step(module_floor_script, case_dir) if module_floor_script else (None, "no module floor step", {})
        check(f"android: the optional artifacts' floors {desc}", rc is not None and (rc == 0) == passes,
              f"exit {rc}: {out.strip()[-200:]}")

inst = jobs.get("android-instrumented", {})
check("android-instrumented: enables KVM", "/dev/kvm" in runs(inst) or "kvm" in runs(inst).lower())
emu = uses(inst, "reactivecircus/android-emulator-runner@")
emu_script = str((emu[0].get("with") or {}).get("script", "")) if emu else ""
check("android-instrumented: reactivecircus/android-emulator-runner runs :openverify-sdk:connectedAndroidDeviceTest",
      ":openverify-sdk:connectedAndroidDeviceTest" in emu_script)
# The probes' device test asserts per device kind (an emulator names an emulator indicator, a phone
# names none) and takes the kind from the run, never from the probes it tests; without the argument
# it takes the device for a phone and fails on an emulator (orchestrator, after Workflow 10C).
DEVICE_KIND = "-Pandroid.testInstrumentationRunnerArguments.openverifyDeviceKind=emulator"
check("android-instrumented: the SDK's device tests are told the device is an emulator",
      any(":openverify-sdk:connectedAndroidDeviceTest" in line and DEVICE_KIND in line for line in emu_script.splitlines()))
# Workflow 10B (C210.3, C201.2, C203.3; integration-10b): the device tests log what only an emulator
# can measure (the probes' total time under openverify-probes, the barcode frame copy costs under
# OpenVerifyCameraTest); the emulator step prints those lines after a passing run too, so the
# orchestrator reads them from the job log.
check("android-instrumented: prints the device tests' measurement lines (openverify-probes, OpenVerifyCameraTest) after the run",
      "openverify-probes" in emu_script and "OpenVerifyCameraTest" in emu_script
      and emu_script.find("openverify-probes") > emu_script.find("check-connected-results.sh"))
# C215.2, C220.1 (Workflow 10C; demo-app's hook): the demo's minifiedSmoke smoke test runs on the same
# emulator after the SDK's device tests, and check-connected-results.sh then reads both modules'
# results (a test that skipped itself fails the job).
smoke_task = "./gradlew :demo-app:connectedMinifiedSmokeAndroidTest"
check(f"android-instrumented: runs {smoke_task} (the R8-minified demo's smoke test)", smoke_task in emu_script)
check("android-instrumented: the smoke test runs after the SDK's device tests and before check-connected-results.sh",
      smoke_task in emu_script
      and emu_script.find(":openverify-sdk:connectedAndroidDeviceTest") < emu_script.find(smoke_task) < emu_script.find("check-connected-results.sh"))
check("android-instrumented: a failed smoke test prints its JUnit XML and fails the step",
      bool(re.search(re.escape(smoke_task) + r"[^\n]*\|\|[^\n]*exit 1", emu_script)))
check("android-instrumented: no longer runs :openverify-sdk:connectedDebugAndroidTest, which the KMP SDK does not have",
      bool(emu_script) and ":openverify-sdk:connectedDebugAndroidTest" not in emu_script)
# Workflow 10E (KP10-46): the optional artifacts are plain Android libraries, whose device tests are
# connectedDebugAndroidTest: the reader with whatever NFC the device has, and YuNet through ONNX
# Runtime's Android library with the telemetry window. They run after the demo's smoke test and
# before the results check, and a failure prints the JUnit XML and fails the step.
modules_task = "./gradlew :openverify-nfc:connectedDebugAndroidTest :openverify-face:connectedDebugAndroidTest"
check(f"android-instrumented: runs {modules_task} (the optional artifacts' device tests)", modules_task in emu_script)
check("android-instrumented: the optional artifacts' device tests run after the smoke test and before check-connected-results.sh",
      modules_task in emu_script and emu_script.find(smoke_task) < emu_script.find(modules_task) < emu_script.find("check-connected-results.sh"))
check("android-instrumented: a failed device test of an optional artifact prints its JUnit XML and fails the step",
      bool(re.search(re.escape(modules_task) + r"[^\n]*\|\|[^\n]*exit 1", emu_script)))
inst_runs = [str(step.get("run", "")) for step in steps(inst)]
inst_fetch_at = next((i for i, text in enumerate(inst_runs) if "fetch_models.py --only face_detection_yunet" in text), None)
inst_emu_at = next((i for i, step in enumerate(steps(inst)) if str(step.get("uses", "")).startswith("reactivecircus/android-emulator-runner@")), None)
check("android-instrumented: fetches the pinned YuNet model and the fixture face before the emulator step builds openverify-face (C205.3)",
      inst_fetch_at is not None and inst_emu_at is not None and inst_fetch_at < inst_emu_at
      and "python3 -I scripts/fetch_models.py --only face_detection_yunet" in inst_runs[inst_fetch_at]
      and "python3 -I scripts/fetch_fixtures.py --only person_a_id" in inst_runs[inst_fetch_at]
      and "steps.detect.outputs.present == 'true'" in str(steps(inst)[inst_fetch_at].get("if", "")))
check("android-instrumented: emulator step is skipped when no device test sources exist",
      bool(emu) and "if" in emu[0])
# The detection step's own script, run on synthetic trees: KMP device tests live in
# src/androidDeviceTest, plain Android modules keep src/androidTest, and host tests start nothing.
detect = next((s for s in steps(inst) if s.get("id") == "detect"), {})
detect_script = str(detect.get("run", ""))
detect_cases = [
    ("a KMP device test (src/androidDeviceTest)",
     "android/openverify-sdk/src/androidDeviceTest/kotlin/dev/openverify/sdk/camera/CameraXCaptureCameraTest.kt", "true"),
    ("an Android module's instrumented test (src/androidTest)",
     "android/demo-app/src/androidTest/java/dev/openverify/demo/SyntheticTest.java", "true"),
    ("host tests only (src/androidHostTest)",
     "android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/SyntheticTest.kt", "false"),
]
with tempfile.TemporaryDirectory(dir=scratch_root) as tmp:
    for n, (desc, source, expected) in enumerate(detect_cases):
        case_dir = os.path.join(tmp, f"case-{n}")
        os.makedirs(os.path.dirname(os.path.join(case_dir, source)))
        open(os.path.join(case_dir, source), "w", encoding="utf-8").close()
        rc, out, outputs = (run_step(detect_script, case_dir, os.path.join(tmp, f"output-{n}"))
                            if detect_script else (None, "no detect step", {}))
        check(f"android-instrumented: the detection says present={expected} for {desc}",
              rc == 0 and outputs.get("present") == expected, f"exit {rc}, outputs {outputs}: {out.strip()[-200:]}")
emu_with = (emu[0].get("with") or {}) if emu else {}
# Private repositories get 2-vCPU runners: an API 36 google_apis image never finished booting
# there within 600 s (run 39402046263), while API 34 boots in a few minutes.
api_level = str((inst.get("env") or {}).get("EMULATOR_API_LEVEL", ""))
check("android-instrumented: emulator image is API 34 or lower (boots on 2-vCPU runners)",
      api_level.isdigit() and int(api_level) <= 34, api_level)
check("android-instrumented: emulator boot timeout is at least 900 s",
      str(emu_with.get("emulator-boot-timeout", "")).isdigit() and int(emu_with.get("emulator-boot-timeout")) >= 900)
check("android-instrumented: the emulator has an emulated back camera for the CameraX test",
      "-camera-back emulated" in str(emu_with.get("emulator-options", "")))
# The runner's free disk (about 6.6 GB) is smaller than a default AVD's userdata partition
# ("FATAL | Not enough space to create userdata partition", run 39404568458).
check("android-instrumented: frees runner disk space before creating the AVD",
      "rm -rf" in runs(inst) and "/usr/share/dotnet" in runs(inst))
check("android-instrumented: the AVD has an explicit disk-size",
      bool(str(emu_with.get("disk-size", "")).strip()))
# The connected-test failure only appeared in an HTML report the runner discarded (run 39406987751).
check("android-instrumented: prints the connected test results when the run fails",
      "androidTest-results" in emu_script)
check("android-instrumented: uploads the connected test reports on failure",
      any("androidTest" in str((st.get("with") or {}).get("path", "")) and "failure()" in str(st.get("if", ""))
          for st in uses(inst, "actions/upload-artifact@")))
# A hung connected test ran until the job timeout cancelled it, which skipped the report upload
# (run 39410603628). A shorter step timeout fails the step instead, so `failure()` steps still run.
# A self-skipping test (the CameraX test on a camera-less device) would pass silently, and a
# green run prints no results (run 39421423900), so CI checks the JUnit XML after Gradle.
check("android-instrumented: fails when a connected test was skipped or none ran",
      "infra/scripts/check-connected-results.sh" in emu_script)
# Workflow 10D review (A006): "at least one test ran" let a device suite that lost most of its
# classes stay green. The checker is given a minimum per module, and each minimum is the number of
# @Test methods its device-test sources hold, counted here: a new device test raises it in this
# commit's files, and a class that stops running fails the job.
def device_tests(*source_set):
    count = 0
    for folder, _, names in os.walk(os.path.join(repo_root, "android", *source_set)):
        for name in names:
            if name.endswith(".kt"):
                with open(os.path.join(folder, name), encoding="utf-8") as fh:
                    count += len(re.findall(r"^\s*@Test\b", fh.read(), flags=re.M))
    return count


# Workflow 10E (KP10-46): every module that has device tests has its minimum, the new ones included.
DEVICE_MINIMUMS = (f"openverify-sdk={device_tests('openverify-sdk', 'src', 'androidDeviceTest')} "
                   f"demo-app={device_tests('demo-app', 'src', 'androidTest')} "
                   f"openverify-nfc={device_tests('openverify-nfc', 'src', 'androidTest')} "
                   f"openverify-face={device_tests('openverify-face', 'src', 'androidTest')}")
check("the device-test sources hold the SDK's 14 tests, the demo's 2, openverify-nfc's 2 and openverify-face's 4 (the minimums both workflows pass)",
      DEVICE_MINIMUMS == "openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4", DEVICE_MINIMUMS)
device_test_modules = sorted(
    name for name in os.listdir(os.path.join(repo_root, "android"))
    if any(device_tests(name, "src", folder) for folder in ("androidDeviceTest", "androidTest")))
check("every android module that holds a device test has a minimum (KP10-46)",
      device_test_modules == sorted(part.split("=")[0] for part in DEVICE_MINIMUMS.split()), str(device_test_modules))
check(f"android-instrumented: the results check holds each module to its minimum ({DEVICE_MINIMUMS}; A006)",
      any(re.fullmatch(rf"bash \.\./infra/scripts/check-connected-results\.sh \. {re.escape(DEVICE_MINIMUMS)}", line.strip())
          for line in emu_script.splitlines()),
      str([line.strip() for line in emu_script.splitlines() if "check-connected-results.sh" in line]))
emu_timeout = emu[0].get("timeout-minutes") if emu else None
check("android-instrumented: the emulator step times out before the job does",
      isinstance(emu_timeout, int) and isinstance(inst.get("timeout-minutes"), int)
      and emu_timeout < inst["timeout-minutes"], str(emu_timeout))

# Workflow 3B review K103: the model cache keeps every file models/manifest.json downloads (the OCR
# dictionary is a .yml beside the .onnx weights), so no run downloads one again on a cache hit;
# its key names the manifest and changes when the cached paths do.
import fnmatch
import json

with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(wf_path)))),
                       "models", "manifest.json"), encoding="utf-8") as fh:
    manifest_files = sorted("models/" + entry["filename"] for entry in json.load(fh)["models"])


def model_cache(job):
    caches = [s for s in uses(job, "actions/cache@") if "models/" in str((s.get("with") or {}).get("path", ""))]
    return (caches[0].get("with") or {}) if len(caches) == 1 else {}


for job_name in ("vision", "e2e"):
    cache = model_cache(jobs.get(job_name, {}))
    globs = [line.strip() for line in str(cache.get("path", "")).splitlines() if line.strip()]
    missed = [name for name in manifest_files if not any(fnmatch.fnmatch(name, glob) for glob in globs)]
    check(f"{job_name}: the model cache keeps every file of models/manifest.json", bool(globs) and not missed,
          f"not cached: {missed}")
    check(f"{job_name}: the model cache key hashes models/manifest.json",
          "hashFiles('models/manifest.json')" in str(cache.get("key", "")))
    # Phase 4 (C41.1): the canonical face mesh joins the cache, under a new key prefix.
    check(f"{job_name}: the model cache key has the Phase 4 prefix models-v3-",
          str(cache.get("key", "")).startswith("models-v3-"))

e2e = jobs.get("e2e", {})
e2e_run = runs(e2e)

# Phase 5 (C56, C67): the e2e stack reads the files data/manifest.json downloads (the disposable
# email list), so the job restores them from a cache keyed on the manifest, then fetches every
# entry (no --only list), each pinned by SHA-256.
with open(os.path.join(repo_root, "data", "manifest.json"), encoding="utf-8") as fh:
    data_files = sorted("data/" + entry["filename"] for entry in json.load(fh)["data"])
e2e_steps = steps(e2e)
data_caches = [s for s in uses(e2e, "actions/cache@") if "data/" in str((s.get("with") or {}).get("path", ""))]
data_cache = (data_caches[0].get("with") or {}) if len(data_caches) == 1 else {}
data_globs = [line.strip() for line in str(data_cache.get("path", "")).splitlines() if line.strip()]
data_missed = [name for name in data_files if not any(fnmatch.fnmatch(name, glob) for glob in data_globs)]
check("e2e: the data cache keeps every file of data/manifest.json", bool(data_globs) and not data_missed,
      f"not cached: {data_missed}")
check("e2e: the data cache key hashes data/manifest.json",
      "hashFiles('data/manifest.json')" in str(data_cache.get("key", "")))
fetch_data_at = next((i for i, s in enumerate(e2e_steps) if "scripts/fetch_data.py" in str(s.get("run", ""))), None)
data_cache_at = next((i for i, s in enumerate(e2e_steps) if data_caches and s is data_caches[0]), None)
check("e2e: fetches every data file in data/manifest.json (no --only list)",
      fetch_data_at is not None and "--only" not in str(e2e_steps[fetch_data_at].get("run", "")))
check("e2e: the data cache is restored before the fetch",
      data_cache_at is not None and fetch_data_at is not None and data_cache_at < fetch_data_at)
check("e2e: the data files are fetched before the end-to-end tests run",
      fetch_data_at is not None
      and fetch_data_at < next((i for i, s in enumerate(e2e_steps)
                                if re.search(r"(^|\n)pnpm e2e(\s|$)", str(s.get("run", "")))), -1))

# Owner decision 2 after 6B (matcher-6c): the C78.7 gate in the integration job measures the real
# case, the shipped variant groups, so the job fetches the data files (cached, as the e2e job does)
# and builds data/variant-groups.json before the Testcontainers suites run.
integ_steps = steps(integ)
integ_caches = [s for s in uses(integ, "actions/cache@") if "data/" in str((s.get("with") or {}).get("path", ""))]
integ_cache = (integ_caches[0].get("with") or {}) if len(integ_caches) == 1 else {}
integ_globs = [line.strip() for line in str(integ_cache.get("path", "")).splitlines() if line.strip()]
integ_missed = [name for name in data_files if not any(fnmatch.fnmatch(name, glob) for glob in integ_globs)]
check("integration: the data cache keeps every file of data/manifest.json", bool(integ_globs) and not integ_missed,
      f"not cached: {integ_missed}")
check("integration: the data cache key hashes data/manifest.json",
      "hashFiles('data/manifest.json')" in str(integ_cache.get("key", "")))
integ_fetch_at = next((i for i, s in enumerate(integ_steps) if "scripts/fetch_data.py" in str(s.get("run", ""))), None)
integ_cache_at = next((i for i, s in enumerate(integ_steps) if integ_caches and s is integ_caches[0]), None)
integ_build_at = next((i for i, s in enumerate(integ_steps)
                       if "@openverify/watchlist build:variant-groups" in str(s.get("run", ""))), None)
integ_test_at = next((i for i, s in enumerate(integ_steps) if "pnpm test:integration" in str(s.get("run", ""))), None)
check("integration: fetches every data file in data/manifest.json (no --only list) after restoring the cache",
      integ_fetch_at is not None and "--only" not in str(integ_steps[integ_fetch_at].get("run", ""))
      and integ_cache_at is not None and integ_cache_at < integ_fetch_at)
check("integration: builds the shipped variant groups after the fetch and before the tests",
      None not in (integ_fetch_at, integ_build_at, integ_test_at)
      and integ_fetch_at < integ_build_at < integ_test_at)

# Phase 5 (C62.9, C67, F22): CI's Node is the apps image's build, not the floating major.
with open(os.path.join(repo_root, "infra", "docker", "api.Dockerfile"), encoding="utf-8") as fh:
    image_node = re.search(r"^ARG NODE_IMAGE=node:([0-9.]+)-", fh.read(), re.MULTILINE)
setup_pnpm = composites.get("./.github/actions/setup-pnpm", {})
node_default = str(((setup_pnpm.get("inputs") or {}).get("node-version") or {}).get("default", ""))
check("setup-pnpm: Node is pinned to the apps image's version (22.23.4; Workflow 11G, KP11-42)",
      image_node is not None and node_default == image_node.group(1) == "22.23.4", node_default)
overrides = [name for name, job in jobs.items()
             for s in job.get("steps") or []
             if s.get("uses") == "./.github/actions/setup-pnpm" and "node-version" in (s.get("with") or {})]
check("no job overrides the pinned Node version", not overrides, str(overrides))

# ---------------------------------------------- Workflow 11C (integration-11c) ----
# C259, C267.2 (decision 49, review F04): one per-push supply-chain job, read-only, with no secret,
# every tool from its checksummed installer (never a scanner action, curl | sh, go install or a
# package manager), the verified releases cached on the installers' pins, then each step of
# infra/scripts/supply-chain.sh in its frozen order and the static halves of 11C's own tests.
check("job 'supply-chain' exists (C267.2)", "supply-chain" in jobs)
sc = jobs.get("supply-chain", {})
sc_steps = steps(sc)
sc_run = runs(sc)
sc_text = yaml.safe_dump(sc, sort_keys=True) if sc else ""
check("supply-chain: the token is read-only (job permissions contents: read)", sc.get("permissions") == {"contents": "read"},
      str(sc.get("permissions")))
sc_checkouts = uses(sc, "actions/checkout@")
check("supply-chain: checks out without persisting credentials",
      bool(sc_checkouts) and all((s.get("with") or {}).get("persist-credentials") is False for s in sc_checkouts))
check("supply-chain: no secret and no token reaches the job (C259.3)",
      bool(sc) and "secrets." not in sc_text
      and not any(name in sc_text for name in ("GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN")))
# Local estimate (integration-11c, docs/tdd/phase11-integration-11c.tdd.md): about 2 minutes of
# checks and tests plus the setup; 20 keeps an estimated run of up to 15 minutes out of the last 25%.
check("supply-chain: timeout-minutes is 20 (the local estimate with its margin; split nothing on an estimate)",
      sc.get("timeout-minutes") == 20, str(sc.get("timeout-minutes")))
SC_TOOLS = ("cosign", "osv-scanner", "zizmor", "trivy", "helm", "helm-unittest", "kubeconform", "gitleaks")
install_at = {tool: next((i for i, s in enumerate(sc_steps)
                          if re.search(rf"infra/scripts/install-{re.escape(tool)}\.sh(\s|$)", str(s.get("run", "")))), None)
              for tool in SC_TOOLS}
for tool, at in install_at.items():
    check(f"supply-chain: installs {tool} through infra/scripts/install-{tool}.sh", at is not None)
check("supply-chain: installs cosign before any installer that verifies a signature with it",
      install_at["cosign"] is not None and all(at is None or install_at["cosign"] < at
                                               for tool, at in install_at.items() if tool != "cosign"))
install_lines = [line.strip() for line in sc_run.splitlines() if re.search(r"infra/scripts/install-[a-z-]+\.sh", line)]
check("supply-chain: every installer writes into one tools directory and reuses a verified cache",
      bool(install_lines) and all('INSTALL_DIR="$RUNNER_TEMP/bin"' in line and '_CACHE_DIR="$RUNNER_TEMP/tool-cache/' in line
                                  for line in install_lines), str(install_lines))
sc_caches = uses(sc, "actions/cache@")
check("supply-chain: the verified releases are cached, keyed on every installer's pins",
      any(str((c.get("with") or {}).get("path", "")).strip() == "${{ runner.temp }}/tool-cache"
          and "hashFiles('infra/scripts/install-*.sh', 'infra/scripts/lib/install-common.sh')" in str((c.get("with") or {}).get("key", ""))
          for c in sc_caches))
SCANNER_ACTIONS = ("aquasecurity/trivy-action", "aquasecurity/setup-trivy", "google/osv-scanner-action", "zizmorcore/zizmor-action",
                   "anchore/scan-action", "anchore/sbom-action", "github/codeql-action", "returntocorp/semgrep-action",
                   "semgrep/semgrep-action", "gitleaks/gitleaks-action", "azure/setup-helm", "helm/kind-action",
                   "helm/chart-testing-action")
# Workflow 11G (codeql-11g; C258.2 amended for C260.2 under Q1, the 11G decisions item 13): GitHub's
# own CodeQL action is allowed in .github/workflows/codeql.yml only, whose jobs run only on a public
# repository; it stays refused in every other workflow and action. An action is matched by its
# owner/repo, so a sub-action (github/codeql-action/init) is caught as the repository it comes from.
SCANNER_ALLOWED_IN = {"github/codeql-action": {".github/workflows/codeql.yml"}}


def scanner_violations(uses_by_file):
    found = []
    for rel, refs in sorted(uses_by_file.items()):
        for ref in refs:
            repo = "/".join(ref.split("@")[0].lower().split("/")[:2])
            if repo in SCANNER_ACTIONS and rel not in SCANNER_ALLOWED_IN.get(repo, set()):
                found.append(f"{rel}: {ref}")
    return found


uses_by_file = {}
for wf_file in sorted(glob.glob(os.path.join(os.path.dirname(wf_path), "*.y*ml"))
                      + glob.glob(os.path.join(actions_dir, "*", "action.y*ml"))):
    with open(wf_file, encoding="utf-8") as fh:
        uses_by_file[os.path.relpath(wf_file, repo_root)] = re.findall(r"^\s*-?\s*uses:\s*([^\s#]+)", fh.read(), re.MULTILINE)
check("no workflow uses a third-party scanner, chart or SAST action (C258.2, decision 42; CodeQL only in codeql.yml, C260.2)",
      not scanner_violations(uses_by_file), str(scanner_violations(uses_by_file)))
check("the scanner check refuses GitHub's CodeQL action, a sub-action included, outside codeql.yml",
      scanner_violations({".github/workflows/ci.yml": ["github/codeql-action/init@" + "0" * 40]}) != []
      and scanner_violations({".github/actions/setup-pnpm/action.yml": ["github/codeql-action@" + "0" * 40]}) != []
      and scanner_violations({".github/workflows/release.yml": ["GitHub/CodeQL-Action/analyze@" + "0" * 40]}) != [])
check("the scanner check allows GitHub's CodeQL action in codeql.yml and nothing else there",
      scanner_violations({".github/workflows/codeql.yml": ["github/codeql-action/init@" + "0" * 40,
                                                           "github/codeql-action/analyze@" + "0" * 40]}) == []
      and scanner_violations({".github/workflows/codeql.yml": ["aquasecurity/trivy-action@" + "0" * 40]}) != []
      and scanner_violations({".github/workflows/codeql.yml": ["semgrep/semgrep-action@" + "0" * 40]}) != [])
check("supply-chain: no tool comes from curl | sh, go install, apt, brew, pip or a global npm install",
      bool(sc) and not re.search(r"curl[^\n]*\|\s*(ba)?sh|\bgo install\b|\bapt(-get)? install\b|\bbrew install\b|\bpip3? install\b|npm (i|install) -g",
                                 sc_run))
SC_STEPS = ("osv", "pnpm-audit", "pip-audit", "zizmor", "trivy-config", "chart", "pii", "allowlist")
step_at_sc = [next((i for i, s in enumerate(sc_steps)
                    if str(s.get("run", "")).strip() == f"bash infra/scripts/supply-chain.sh {name}"), None) for name in SC_STEPS]
check("supply-chain: runs each frozen step of supply-chain.sh, one step each, in order (C259.1)",
      None not in step_at_sc and step_at_sc == sorted(step_at_sc), str(step_at_sc))
check("supply-chain: every tool is installed before the first check",
      None not in step_at_sc and all(at is not None and at < min(step_at_sc) for at in install_at.values()))
# One run shows every failing check: each step from the first check on runs after an earlier failure.
check("supply-chain: every check and contract step runs even when an earlier one failed (if: ${{ !cancelled() }})",
      None not in step_at_sc and all(str(s.get("if", "")).strip() == "${{ !cancelled() }}"
                                     for s in sc_steps[min(step_at_sc):] if "run" in s))
check("supply-chain: each check reads the tools directory it installed (SUPPLY_CHAIN_TOOLS_DIR)",
      None not in step_at_sc and all((sc_steps[i].get("env") or {}).get("SUPPLY_CHAIN_TOOLS_DIR") == "${{ runner.temp }}/bin"
                                     for i in step_at_sc))
SC_STATIC = ("bash infra/tests/supply-chain.test.sh", "bash infra/tests/supply-chain-skeletons.test.sh",
             "bash infra/tests/release-workflow.test.sh", "bash infra/tests/images.test.sh static",
             "bash infra/tests/images.test.sh pins", "bash infra/tests/images.test.sh override",
             "bash infra/tests/refresh-digests.test.sh", "bash infra/tests/chart-skeleton.test.sh",
             "bash infra/tests/adr-deployment.test.sh", "bash deploy/helm/openverify/ci/tests/chart-checks.test.sh",
             "bash deploy/helm/openverify/ci/tests/kind.test.sh", "bash deploy/helm/openverify/ci/tests/chart-policy.test.sh",
             # Workflow 11F (dast-11f; decision 16 before 11F): the DAST contract's static half.
             "bash infra/tests/zap.test.sh",
             # Workflow 11G (codeql-11g; C260.2 under Q1): codeql.yml's contract, static; CodeQL
             # itself runs only in codeql.yml on a public repository, never in this job.
             "bash infra/tests/codeql-workflow.test.sh")
for command in SC_STATIC:
    check(f"supply-chain: runs `{command}` (the static half of an 11C contract)", command in sc_run.splitlines() or
          any(line.strip() == command for line in sc_run.splitlines()))
for test in sorted(glob.glob(os.path.join(repo_root, "infra", "tests", "install-*.test.sh"))):
    name = os.path.basename(test)
    if name == "install-gitleaks.test.sh":
        continue  # no offline half: it downloads every release, so it stays a local check (Phase 10)
    check(f"supply-chain: runs infra/tests/{name} --offline-only (the installer's static checks)",
          f"bash infra/tests/{name} --offline-only" in [line.strip() for line in sc_run.splitlines()])
check("supply-chain: runs security/python's tests, ruff and mypy --strict (contracts-11c amendment item 20)",
      "uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir ." in sc_run
      and "uv run --project security/python --frozen ruff check" in sc_run
      and "uv run --project security/python --frozen ruff format --check" in sc_run
      and "uv run --project security/python --frozen mypy --strict" in sc_run)
check("supply-chain: mypy --strict holds the DAST helper and ZAP's hooks (Workflow 11F, dast-11f)",
      bool(re.search(r"mypy --strict [^\n]*security/zap/dast-zap\.py", sc_run))
      and bool(re.search(r"mypy --strict [^\n]*security/zap/zap-hooks\.py", sc_run)))
check("supply-chain: runs the chart's models-fetch program's tests (chart-11c)",
      "-m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'" in sc_run)
check("supply-chain: sets up uv with astral-sh/setup-uv (pip-audit and the Python checks)", bool(uses(sc, "astral-sh/setup-uv@")))
# Every test script runs per push, or is named here as local-only with its reason.
LOCAL_ONLY = {
    "infra/tests/install-gitleaks.test.sh": "downloads every release; the secrets and infra jobs run the installer itself",
}
all_runs = "\n".join(runs(job) for job in jobs.values())
for test in sorted(glob.glob(os.path.join(repo_root, "infra", "tests", "*.test.sh"))
                   + glob.glob(os.path.join(repo_root, "deploy", "helm", "openverify", "ci", "tests", "*.test.sh"))):
    rel = os.path.relpath(test, repo_root)
    check(f"{rel} runs in a CI job or is named local-only with its reason", rel in all_runs or rel in LOCAL_ONLY)
# Workflow 11D (Stage 1a amendments 15 and 17; decision 17 before 11D): load/'s gate is one step of
# the vision job (it sets up uv already; no new job, decision 49), and the load compose contract's
# static half runs in the infra job.
vision_steps = steps(vision)
load_gate = [s for s in vision_steps if s.get("working-directory") == "load"]
check("vision: runs load/'s gate as one step in load/ (uv sync --frozen, ruff, ruff format, mypy, pytest)",
      len(load_gate) == 1 and all(cmd in str(load_gate[0].get("run", "")) for cmd in (
          "uv sync --frozen", "uv run ruff check", "uv run ruff format --check", "uv run mypy .",
          "uv run pytest")))
check("vision: load/'s gate is the job's last step", bool(load_gate) and vision_steps[-1] is load_gate[0])
check("infra: runs infra/tests/load-compose.test.sh --static-only (the load override's static half)",
      "bash infra/tests/load-compose.test.sh --static-only" in [line.strip() for line in runs(jobs.get("infra", {})).splitlines()])
# sast-pii-11c: the PII configuration's contract needs the pinned gitleaks, so it runs in the infra job.
infra_job = jobs.get("infra", {})
infra_steps_l = steps(infra_job)
gl_install = next((i for i, s in enumerate(infra_steps_l) if "infra/scripts/install-gitleaks.sh" in str(s.get("run", ""))), None)
pii_test = next((i for i, s in enumerate(infra_steps_l) if "infra/tests/gitleaks-pii.test.sh" in str(s.get("run", ""))), None)
check("infra: runs the PII configuration's contract after installing the pinned gitleaks (C260.3)",
      None not in (gl_install, pii_test) and gl_install < pii_test)

# scanners-11c (zizmor github-env): no local action writes $GITHUB_ENV or $GITHUB_PATH; the pnpm store
# path is a step output, and the corepack prompt is switched off by the workflows' own env.
for action_name, action in composites.items():
    action_run = runs(action.get("runs") or {})
    check(f"{action_name}: writes nothing to $GITHUB_ENV or $GITHUB_PATH (zizmor github-env)",
          "GITHUB_ENV" not in action_run and "GITHUB_PATH" not in action_run)
pnpm_caches = [s for s in steps((setup_pnpm.get("runs") or {})) if str(s.get("uses", "")).startswith("actions/cache@")]
check("setup-pnpm: the cached pnpm store path comes from a step output",
      bool(pnpm_caches) and all(str((s.get("with") or {}).get("path", "")).strip() == "${{ steps.pnpm.outputs.store-path }}"
                                for s in pnpm_caches))
check("ci.yml: the corepack download prompt is off for every job (COREPACK_ENABLE_DOWNLOAD_PROMPT '0')",
      str((wf.get("env") or {}).get("COREPACK_ENABLE_DOWNLOAD_PROMPT")) == "0")

# KP10-52's CI half (scanners-11c): the verified bundletool jar is cached on the fetch script's pin.
android_job = jobs.get("android", {})
a_steps = steps(android_job)
bt_cache = next((i for i, s in enumerate(a_steps) if str(s.get("uses", "")).startswith("actions/cache@")
                 and "hashFiles('scripts/fetch_bundletool.py')" in str((s.get("with") or {}).get("key", ""))), None)
bt_fetch = next((i for i, s in enumerate(a_steps) if "scripts/fetch_bundletool.py" in str(s.get("run", ""))), None)
check("android: the verified bundletool is cached, keyed on fetch_bundletool.py, restored before the fetch (KP10-52)",
      None not in (bt_cache, bt_fetch) and bt_cache < bt_fetch)
check("android: the bundletool fetch reuses that cache (--cache-dir)",
      bt_fetch is not None and '--cache-dir "$RUNNER_TEMP/bundletool-cache"' in str(a_steps[bt_fetch].get("run", "")))


# The e2e job uploads e2e/.artifacts/. Under the reusable stack (C111.2) it holds stack.json, the run's
# seeded credentials, so a job that starts e2e:stack:up must leave that file out of every upload.
def uploads_stack_record(job):
    if "e2e:stack:up" not in runs(job):
        return False
    for step in uses(job, "actions/upload-artifact@"):
        paths = [p.strip() for p in str((step.get("with") or {}).get("path", "")).splitlines() if p.strip()]
        carries = any(p.rstrip("/") in ("e2e", "e2e/.artifacts") or p.startswith("e2e/.artifacts/stack")
                      for p in paths if not p.startswith("!"))
        if carries and "!e2e/.artifacts/stack.json" not in paths:
            return True
    return False


check("e2e: no upload can carry the reusable stack's record (e2e/.artifacts/stack.json)", not uploads_stack_record(e2e))
shard_matrix = {"steps": [{"run": "pnpm --filter @openverify/e2e e2e:stack:up"},
                          {"uses": "actions/upload-artifact@x", "with": {"path": "e2e/.artifacts/\napps/flow/test-results/"}}]}
check("the stack-record rule catches a job that starts the reusable stack and uploads e2e/.artifacts/",
      uploads_stack_record(shard_matrix))
shard_matrix["steps"][1]["with"]["path"] += "\n!e2e/.artifacts/stack.json"
check("the stack-record rule passes that job once the upload leaves stack.json out", not uploads_stack_record(shard_matrix))

# C267.4: release.yml, the staging workflow (its full contract is infra/tests/release-workflow.test.sh).
release_path = os.path.join(os.path.dirname(wf_path), "release.yml")
with open(release_path, encoding="utf-8") as fh:
    release_text = fh.read()
release = yaml.safe_load(release_text) or {}
release_on = release.get("on", release.get(True, {}))
release_jobs = release.get("jobs") or {}
check("release.yml: runs only on workflow_dispatch", set(release_on) == {"workflow_dispatch"} if isinstance(release_on, dict) else False)
check("release.yml: the token is read-only at the top (contents: read)", release.get("permissions") == {"contents": "read"})
check("release.yml: builds only from main", "github.ref == 'refs/heads/main'" in str((release_jobs.get("build") or {}).get("if", "")))
publish = release_jobs.get("publish") or {}
check("release.yml: publish runs only in the environment 'release'",
      publish.get("environment") == "release" or (publish.get("environment") or {}).get("name") == "release")
check("release.yml: publish runs only when vars.OPENVERIFY_PUBLISH is 'true' and only for a dispatch of main (Q1-Q4; integration-11g)",
      str(publish.get("if", "")).strip() == "vars.OPENVERIFY_PUBLISH == 'true' && github.ref == 'refs/heads/main'")
release_uses = re.findall(r"^\s*-?\s*uses:\s*(\S+)(.*)$", release_text, re.MULTILINE)
check("release.yml: every action is pinned to a full commit SHA with its tag in a comment",
      bool(release_uses) and all(re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", ref) and re.search(r"#\s*v\d", rest)
                                 for ref, rest in release_uses), str([r for r, _ in release_uses]))

check("e2e: installs with a frozen lockfile", "pnpm install --frozen-lockfile" in e2e_run)
check("e2e: sets up uv with astral-sh/setup-uv", bool(uses(e2e, "astral-sh/setup-uv@")))
check("e2e: pulls the compose infrastructure images", re.search(r"docker compose .*pull", e2e_run) is not None)
check("e2e: fetches every model in models/manifest.json (no --only list, C33)",
      "scripts/fetch_models.py" in e2e_run and "--only" not in e2e_run)
check("e2e: fetches the public-domain faces", "scripts/fetch_fixtures.py" in e2e_run)
check("e2e: generates the synthetic ID and fake-camera clips", "tools/make_synthetic_fixtures.py" in e2e_run)
# Phase 5 (C65.2, C65.3): the same generator writes the proof-of-address and held-out sets and the
# chip portrait, from the federal forms fetch_fixtures.py downloads, so it runs after that fetch.
generate_at = next((i for i, s in enumerate(e2e_steps) if "tools/make_synthetic_fixtures.py" in str(s.get("run", ""))), None)
fixtures_at = next((i for i, s in enumerate(e2e_steps) if "scripts/fetch_fixtures.py" in str(s.get("run", ""))), None)
check("e2e: generates the proof-of-address set and the chip portrait after fetching the forms",
      generate_at is not None and fixtures_at is not None and fixtures_at < generate_at
      and "--" not in str(e2e_steps[generate_at].get("run", "")).split("make_synthetic_fixtures.py", 1)[-1].split("\n")[0])
# The suite timing (Workflow 5B, measured in docs/tdd/phase5-integration-5b.tdd.md): the job's
# timeout covers the Chromium install (up to about 10 minutes on a runner), the mocked suite and
# the whole Playwright globalTimeout of the full-stack suite.
with open(os.path.join(repo_root, "e2e", "playwright.config.ts"), encoding="utf-8") as fh:
    global_timeout = re.search(r"globalTimeout:\s*(\d+)\s*\*\s*60_000", fh.read())
global_minutes = int(global_timeout.group(1)) if global_timeout else None
# Workflow 9D (fix-api, review R006): measured locally on one fresh stack (load 2 to 3), the
# full-stack run is about 26 minutes (stack 97 s, four chromium shards 229 + 293 + 271 + 370 s, the
# sweep 294 s); 9A's push ran 1.45 times its local time in CI, so about 38 minutes, which is inside
# the last 25% of 45. The globalTimeout is 60, so that estimate is 63% of it.
check("e2e: the Playwright globalTimeout is at least 60 minutes (Workflow 9D, R006)",
      global_minutes is not None and global_minutes >= 60, str(global_minutes))
check("e2e: the job's timeout exceeds the globalTimeout by at least 20 minutes (install, setup, mocked suite)",
      global_minutes is not None and isinstance(e2e.get("timeout-minutes"), int)
      and e2e["timeout-minutes"] >= global_minutes + 20, f"{e2e.get('timeout-minutes')} vs {global_minutes}")
check("e2e: installs Chromium with its system dependencies", "playwright install --with-deps chromium" in e2e_run)
check("e2e: runs `pnpm e2e`", re.search(r"(^|\n)pnpm e2e(\s|$)", e2e_run) is not None)
# C160.9 (Workflow 9B, review F19): the theme CSP spec runs in Firefox and WebKit too, so the job
# installs both for the flow suite's Playwright, from a cache keyed by the lockfile, before the tests.
e2e_steps = steps(e2e)
engines_install = [i for i, s in enumerate(e2e_steps)
                   if re.search(r"@openverify/flow exec playwright install --with-deps firefox webkit",
                                str(s.get("run", ""))) is not None]
engines_cache = [i for i, s in enumerate(e2e_steps)
                 if str(s.get("uses", "")).startswith("actions/cache@")
                 and "ms-playwright" in str((s.get("with") or {}).get("path", ""))
                 and "pnpm-lock.yaml" in str((s.get("with") or {}).get("key", ""))]
e2e_tests = [i for i, s in enumerate(e2e_steps) if re.search(r"(^|\n)pnpm e2e", str(s.get("run", "")))]
check("e2e: installs Firefox and WebKit with their system dependencies for the flow suite (C160.9)",
      len(engines_install) == 1, str(engines_install))
check("e2e: caches the Playwright browsers, keyed by the lockfile, restored before the install",
      bool(engines_cache) and bool(engines_install) and engines_cache[0] < engines_install[0],
      f"{engines_cache} {engines_install}")
check("e2e: the engines are installed before the end-to-end tests run",
      bool(engines_install) and bool(e2e_tests) and engines_install[0] < e2e_tests[0])
with open(os.path.join(repo_root, "apps", "flow", "e2e", "playwright.config.ts"), encoding="utf-8") as fh:
    flow_config = fh.read()
for engine in ("firefox", "webkit"):
    project = re.search(r"name:\s*'" + engine + r"'[^}]*testMatch:\s*'[^']*theme-csp\.spec\.ts'", flow_config)
    check(f"flow e2e: a {engine} project runs the theme CSP spec only (C160.9)", project is not None)
# Since Workflow 2C the full-stack suite also holds the C24 dashboard and flow UI specs
# (e2e/tests/ui-*.spec.ts): the job runs every spec, unfiltered, and its name says so.
check("e2e: runs the whole suite, the C24 UI specs included (`pnpm e2e` with no filter)",
      re.search(r"(^|\n)pnpm e2e[ \t]*(\n|$)", e2e_run) is not None)
e2e_name = str(e2e.get("name", ""))
check("e2e: the job name covers the dashboard UI specs, not only the Phase 1 stack",
      "Phase 1" not in e2e_name and "UI" in e2e_name, e2e_name)
check("e2e: uploads the service logs and Playwright report",
      any("e2e/.artifacts" in str((s.get("with") or {}).get("path", ""))
          for s in uses(e2e, "actions/upload-artifact@")))
# KP10-1 (Workflow 10A): CI 42476248527 uploaded no full-stack trace. upload-artifact leaves hidden
# files and directories out unless include-hidden-files is true (its default since v4.4), and
# e2e/.artifacts is a dot-directory, so the traces, the report and the service logs need it.
e2e_uploads = [s for s in uses(e2e, "actions/upload-artifact@")
               if "e2e/.artifacts" in str((s.get("with") or {}).get("path", ""))]
check("e2e: the upload includes hidden files, so e2e/.artifacts (a dot-directory) is uploaded (KP10-1)",
      bool(e2e_uploads) and all((s.get("with") or {}).get("include-hidden-files") is True for s in e2e_uploads),
      str([(s.get("with") or {}).get("include-hidden-files") for s in e2e_uploads]))
check("e2e: the upload runs whenever the run was not cancelled, failures included (KP10-1)",
      bool(e2e_uploads) and all("!cancelled()" in str(s.get("if", "")) for s in e2e_uploads))

secrets = jobs.get("secrets", {})
checkout = uses(secrets, "actions/checkout@")
check("secrets: checks out the full history", bool(checkout) and (checkout[0].get("with") or {}).get("fetch-depth") == 0)
check("secrets: installs gitleaks via the pinned, checksum-verified installer",
      "infra/scripts/install-gitleaks.sh" in runs(secrets))
check("secrets: scans git history with `gitleaks git`", "gitleaks git" in runs(secrets))

# KP10-2 (Workflow 10A): one HTTP 504 from GitHub's release host failed the infra job, and the host
# flapped for an hour (validation-9d). Both jobs that install gitleaks restore a cache of the
# verified release, keyed on the installer (which holds the pinned version and SHA-256), before
# the install, and hand that directory to the installer, which verifies a cached copy again.
for job_name in ("infra", "secrets"):
    job_steps = steps(jobs.get(job_name, {}))
    install_at = next((i for i, s in enumerate(job_steps) if "install-gitleaks.sh" in str(s.get("run", ""))), None)
    cache_at = next((i for i, s in enumerate(job_steps)
                     if str(s.get("uses", "")).startswith("actions/cache@")
                     and "gitleaks-cache" in str((s.get("with") or {}).get("path", ""))), None)
    cache_with = (job_steps[cache_at].get("with") or {}) if cache_at is not None else {}
    check(f"{job_name}: restores the cache of the verified gitleaks release before the install (KP10-2)",
          install_at is not None and cache_at is not None and cache_at < install_at)
    check(f"{job_name}: the gitleaks cache is keyed on the installer, so a new version or pin misses it (KP10-2)",
          "hashFiles('infra/scripts/install-gitleaks.sh')" in str(cache_with.get("key", "")),
          str(cache_with.get("key")))
    check(f"{job_name}: the installer reads the cached directory through GITLEAKS_CACHE_DIR (KP10-2)",
          install_at is not None
          and 'GITLEAKS_CACHE_DIR="$RUNNER_TEMP/gitleaks-cache"' in str(job_steps[install_at].get("run", ""))
          and str(cache_with.get("path", "")).strip() == "${{ runner.temp }}/gitleaks-cache",
          str(cache_with.get("path")))

all_uses = set()
for job in jobs.values():
    for s in steps(job):
        if s.get("uses") and not str(s["uses"]).startswith("./"):
            all_uses.add(str(s["uses"]))
for comp in composites.values():
    for s in (comp.get("runs") or {}).get("steps") or []:
        if s.get("uses") and not str(s["uses"]).startswith("./"):
            all_uses.add(str(s["uses"]))

# YAML drops comments, so the version comment of each `uses:` line is read from the raw files.
# Every occurrence of a ref must name the same version; a missing comment is reported as "-".
versions = {}
uses_line = re.compile(r"^\s*(?:-\s+)?uses:\s*['\"]?([^\s'\"#]+)['\"]?\s*(?:#\s*(\S+))?\s*$")
for path in [wf_path, *sorted(glob.glob(os.path.join(actions_dir, "*", "action.y*ml")))]:
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            match = uses_line.match(raw)
            if match and not match.group(1).startswith("./"):
                versions.setdefault(match.group(1), set()).add(match.group(2) or "-")
for ref in sorted(all_uses):
    named = versions.get(ref, {"-"})
    if len(named) > 1:
        results.append(f"FAIL - every use of {ref} names one version ({' '.join(sorted(named))})")

for line in results:
    print(line)
print("USES:" + " ".join(f"{ref}|{sorted(versions.get(ref, {'-'}))[0]}" for ref in sorted(all_uses)))
PY
)
py_rc=$?
if [ "$py_rc" -ne 0 ]; then nok "structural checker ran" "python exited $py_rc"; finish; fi
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) ok "${line#ok   - }" ;;
    "FAIL - "*) printf '%s\n' "$line"; failed=$((failed + 1)) ;;
  esac
done <<<"$structure"
read -r -a action_refs <<<"$(sed -n 's/^USES://p' <<<"$structure")"

# ---------------------------------------------------------- actionlint ----
if command -v actionlint >/dev/null 2>&1; then
  if lint_out=$(cd "$repo_root" && actionlint .github/workflows/ci.yml 2>&1); then
    ok "actionlint $(actionlint -version | head -n 1) reports no problems"
  else
    nok "actionlint reports no problems" "$(head -n 10 <<<"$lint_out" | tr '\n' ' ')"
  fi
else
  skip "actionlint not installed (YAML parse check above is the fallback)"
fi

# ------------------------------------------------------- action pinning ----
denied='^(gradle/actions|gitleaks/gitleaks-action)(/|@)'
if [ "${#action_refs[@]}" -eq 0 ]; then nok "workflow uses third-party actions"; fi
remote=false
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then remote=true; fi
for entry in "${action_refs[@]}"; do
  ref=${entry%|*}
  version=${entry##*|}
  # Finding F009: a tag can be moved to other code; a full commit SHA cannot.
  if [[ "$ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$ ]]; then
    ok "$ref is pinned to a full commit SHA"
  else
    nok "$ref is pinned to a full commit SHA"
  fi
  if [[ "$version" =~ ^v[0-9]+(\.[0-9]+){0,2}$ ]]; then
    ok "${ref%@*} names its version ($version) in a trailing comment"
  else
    nok "${ref%@*} names its version in a trailing comment" "got '$version'"
  fi
  if [[ "$ref" =~ $denied ]]; then nok "$ref is allowed (deny-list: non-permissive license)"; fi
  if $remote && [ "$version" != "-" ]; then
    owner_repo=$(cut -d/ -f1-2 <<<"${ref%@*}")
    pinned=${ref##*@}
    # The commits endpoint dereferences annotated tags to the commit they point at.
    resolved=$(gh api "repos/$owner_repo/commits/$version" --jq .sha 2>/dev/null) || resolved=''
    [[ "$resolved" =~ ^[0-9a-f]{40}$ ]] || resolved=''
    if [ -n "$resolved" ] && [ "$resolved" = "$pinned" ]; then
      ok "$owner_repo $version resolves to the pinned commit on GitHub"
    else
      nok "$owner_repo $version resolves to the pinned commit on GitHub" "resolved '${resolved:-nothing}'"
    fi
  fi
done
if ! $remote; then
  if [ "${REQUIRE_REMOTE:-0}" = "1" ]; then nok "gh is authenticated to verify action pins"; else skip "gh not authenticated: action pins not verified remotely"; fi
fi

# ------------------------------------------------- android-release.yml ----
# C217.4, C220.3 (Phase 10, Workflow 10C, release-checks): the release workflow. It is started by
# hand, on `main`, by the orchestrator only; it stages the repository and uploads nothing to Maven
# Central without the owner's environment `maven-central` (Phase 10 P4). The checks hold what the
# plan promises of it: its trigger, permissions, pinned actions, the gate it runs, the size
# configurations that exist, the secret scan before the upload, the device matrix on the standard
# runner (P5 declined) and who can reach the publish job's secrets (review P18).
release="$repo_root/.github/workflows/android-release.yml"
if [ -f "$release" ]; then ok ".github/workflows/android-release.yml exists"; else nok ".github/workflows/android-release.yml exists"; finish; fi

release_structure=$(python3 -I - "$release" "$workflow" <<'PY'
import re
import sys

import yaml

release_path, ci_path = sys.argv[1], sys.argv[2]
results = []


def check(desc, cond, detail=""):
    results.append(("ok  " if cond else "FAIL") + " - release: " + desc + ("" if cond or not detail else f" ({detail})"))


with open(release_path, encoding="utf-8") as fh:
    text = fh.read()
with open(ci_path, encoding="utf-8") as fh:
    ci_text = fh.read()
try:
    wf = yaml.safe_load(text)
    assert isinstance(wf, dict)
except (yaml.YAMLError, AssertionError) as exc:
    print("FAIL - release: android-release.yml parses as YAML (" + str(exc).replace("\n", " ") + ")")
    sys.exit(0)
check("android-release.yml parses as YAML", True)

# PyYAML reads the key `on` as the boolean True.
triggers = wf.get("on", wf.get(True))
check("it starts on workflow_dispatch only (never on a push, a pull request or a schedule)",
      isinstance(triggers, dict) and list(triggers) == ["workflow_dispatch"], str(triggers))
inputs = ((triggers if isinstance(triggers, dict) else {}).get("workflow_dispatch") or {}).get("inputs") or {}
check("the dispatch asks for the version, required",
      isinstance(inputs.get("version"), dict) and inputs["version"].get("required") is True, str(inputs.get("version")))
check("the dispatch asks whether to deploy to the Central Portal, off by default",
      isinstance(inputs.get("publish"), dict) and inputs["publish"].get("type") == "boolean"
      and inputs["publish"].get("default") is False, str(inputs.get("publish")))
check("top-level permissions are contents: read and nothing else", wf.get("permissions") == {"contents": "read"},
      str(wf.get("permissions")))
jobs = wf.get("jobs") or {}
check("its jobs are gate, devices and publish", sorted(jobs) == ["devices", "gate", "publish"], str(sorted(jobs)))
check("no job adds a permission (the publish job included)", all("permissions" not in job for job in jobs.values()))
check("every job runs on the standard runner (ubuntu-latest; no larger runner, Phase 10 P5 declined)",
      all(job.get("runs-on") == "ubuntu-latest" for job in jobs.values()),
      str({name: job.get("runs-on") for name, job in jobs.items()}))
check("every job has a timeout", all(isinstance(job.get("timeout-minutes"), int) for job in jobs.values()))
check("it never names pull_request_target", "pull_request_target" not in text)


def steps(job):
    return [step for step in (jobs.get(job) or {}).get("steps") or [] if isinstance(step, dict)]


def runs(job):
    return [str(step.get("run", "")) for step in steps(job)]


def first(job, pattern):
    for index, run in enumerate(runs(job)):
        if re.search(pattern, run):
            return index
    return None


def before(job, earlier, later):
    a, b = first(job, earlier), first(job, later)
    return a is not None and b is not None and a < b


# Every action is pinned to a full commit SHA with its tag, and is one ci.yml already pins (whose
# tags the action-pinning section above resolves on GitHub when gh is authenticated).
uses = re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)(?:[ \t]+#[ \t]*(\S+))?[ \t]*$", text, flags=re.M)
ci_uses = set(re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)[ \t]+#[ \t]*(\S+)[ \t]*$", ci_text, flags=re.M))
check("it uses actions", len(uses) >= 6, str(len(uses)))
for ref, version in sorted(set(uses)):
    check(f"{ref.split('@')[0]} is pinned to a full commit SHA with its tag in a trailing comment",
          re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}", ref) is not None
          and re.fullmatch(r"v[0-9]+(\.[0-9]+){0,2}", version or "") is not None, f"{ref} {version}")
    check(f"{ref.split('@')[0]} is pinned exactly as ci.yml pins it", (ref, version) in ci_uses, f"{ref} {version}")
check("it uses neither gradle/actions nor gitleaks-action (the deny-list of ci.yml)",
      not any(re.match(r"(gradle/actions|gitleaks/gitleaks-action)(/|@)", ref) for ref, _ in uses))
check("every checkout drops its credentials",
      all((step.get("with") or {}).get("persist-credentials") is False
          for job in jobs for step in steps(job) if str(step.get("uses", "")).startswith("actions/checkout@")))

# ---- the gate job: version, the full Android gate, 16 KB, sizes, the staged repository ----
gate_run = "\n".join(runs("gate"))
check("gate: it validates the version before anything is built",
      before("gate", r"openverifyVersion", r"gradlew"), str(first("gate", r"openverifyVersion")))
check("gate: the version reaches the script through the environment, never by interpolation",
      bool(gate_run) and "${{ inputs" not in gate_run and "${{ github.event.inputs" not in gate_run)
check("gate: it verifies the Gradle wrapper JAR before Gradle runs",
      before("gate", r"gradle-wrapper\.jar\" \| sha256sum -c", r"gradlew "))
check("gate: bundletool is fetched before Gradle runs (C214.7)", before("gate", r"scripts/fetch_bundletool\.py", r"gradlew "))
# KP10-52's CI half (scanners-11c; integration-11c's borrowed edit): the verified jar is cached, keyed
# on fetch_bundletool.py's pin, restored before the fetch, and the fetch reuses it.
gate_steps = steps("gate")
bt_cache_at = next((i for i, s in enumerate(gate_steps) if str(s.get("uses", "")).startswith("actions/cache@")
                    and "hashFiles('scripts/fetch_bundletool.py')" in str((s.get("with") or {}).get("key", ""))), None)
bt_fetch_at = first("gate", r"scripts/fetch_bundletool\.py")
check("gate: the verified bundletool is cached on fetch_bundletool.py's pin and reused by the fetch (KP10-52)",
      None not in (bt_cache_at, bt_fetch_at) and bt_cache_at < bt_fetch_at
      and '--cache-dir "$RUNNER_TEMP/bundletool-cache"' in runs("gate")[bt_fetch_at])
check("gate: the release-check scripts' own tests run", re.search(r"unittest discover -s (android/)?scripts/tests", gate_run) is not None)
check("gate: it runs the Android gate as ci.yml's android job does",
      "./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint" in gate_run)
check("gate: it compares the screenshots, checks the ABI and builds the minified demo and its bundle",
      re.search(r"gradlew :openverify-sdk:screenshotTest -Proborazzi\.test\.verify=true checkKotlinAbi :demo-app:assembleRelease :demo-app:bundleRelease", gate_run) is not None)
check("gate: the pinned YuNet model and the fixture face are fetched before Gradle runs (C205.3; Workflow 10E)",
      before("gate", r"python3 -I scripts/fetch_models\.py --only face_detection_yunet", r"gradlew ")
      and before("gate", r"python3 -I scripts/fetch_fixtures\.py --only person_a_id", r"gradlew "))
check("gate: it compiles the device tests of the SDK, of the minified demo and of both optional artifacts",
      re.search(r"gradlew :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest :openverify-nfc:assembleDebugAndroidTest :openverify-face:assembleDebugAndroidTest", gate_run) is not None)
check("gate: the 16 KB checks run after the minified build (C216.1)",
      before("gate", r":demo-app:bundleRelease", r"check-elf-alignment\.py"))
check("gate: the consumer rules are read back from the minified demo (C215.4)",
      before("gate", r":demo-app:assembleRelease", r"check-consumer-rules\.py"))
check("gate: openverify-nfc's release AAR is built before the consumer-rules check reads it",
      before("gate", r":openverify-nfc:assembleRelease", r"check-consumer-rules\.py"))
check("gate: openverify-face's release AAR is built before the consumer-rules check reads it (Workflow 10E)",
      before("gate", r":openverify-face:assembleRelease", r"check-consumer-rules\.py"))
sdk_size = first("gate", r"check-size\.py(?! --configuration)")
nfc_build = first("gate", r"-PopenverifyDemoArtifacts=sdk,nfc :demo-app:bundleRelease")
nfc_size = first("gate", r"check-size\.py --configuration sdk,nfc")
check("gate: it measures the SDK-only size, then builds and measures the configuration with openverify-nfc (C216.2)",
      None not in (sdk_size, nfc_build, nfc_size) and sdk_size < nfc_build <= nfc_size, f"{sdk_size} {nfc_build} {nfc_size}")
# Workflow 10E: openverify-face exists, so its two configurations are measured too; each is built
# (bundle and minified APK) before it is measured, and the fullest build, which holds ONNX Runtime's
# native libraries, is given to the 16 KB checks (openverify-face's own AAR holds no native library).
sizes_in_order = [first("gate", rf"(?m)check-size\.py --configuration {name}$") for name in ("sdk,nfc", "sdk,face", "sdk,nfc,face")]
builds_in_order = [first("gate", rf"-PopenverifyDemoArtifacts={name} (:demo-app:assembleRelease )?:demo-app:bundleRelease") for name in ("sdk,nfc", "sdk,face", "sdk,nfc,face")]
check("gate: each size step measures the bundle its own Gradle line just built",
      all(run.count("check-size.py --configuration") <= 1 for run in runs("gate")))
check("gate: it builds and then measures sdk,nfc, sdk,face and sdk,nfc,face, in that order (C216.2; Workflow 10E)",
      None not in sizes_in_order and None not in builds_in_order and sizes_in_order == sorted(sizes_in_order)
      and all(build <= size for build, size in zip(builds_in_order, sizes_in_order)), f"{builds_in_order} {sizes_in_order}")
full_step = next((run for run in runs("gate") if "check-size.py --configuration sdk,nfc,face" in run), "")
check("gate: the build with ONNX Runtime's native libraries is given to the 16 KB checks, APK and bundle (C216.1)",
      "-PopenverifyDemoArtifacts=sdk,nfc,face :demo-app:assembleRelease :demo-app:bundleRelease" in full_step
      and full_step.find(":demo-app:assembleRelease") < full_step.find("check-elf-alignment.py"), full_step)
check("gate: it measures no configuration whose artifact does not exist (Play Integrity: P3 declined; C216.3)",
      re.search(r"openverifyDemoArtifacts=\S*(integrity|play)", text) is None
      and re.search(r"--configuration \S*(integrity|play)", text) is None and "openverify-integrity-play" not in text)
check("gate: it stages the repository, then builds the consumer check against it (C217.3)",
      before("gate", r"gradlew publishAllPublicationsToStagingRepository", r"gradlew -p consumer-check build"))
scan = first("gate", r"scan-staged-repository\.sh")
uploads = [index for index, step in enumerate(steps("gate")) if str(step.get("uses", "")).startswith("actions/upload-artifact@")
           and "android/build/staging-repo" in str((step.get("with") or {}).get("path", ""))]
check("gate: gitleaks scans the unzipped staged repository before it is uploaded as a workflow artifact (review P25)",
      scan is not None and len(uploads) == 1 and scan < uploads[0], f"{scan} {uploads}")
check("gate: the staged repository is uploaded only when every step before it passed",
      len(uploads) == 1 and "if" not in steps("gate")[uploads[0]])
check("gate: gitleaks is installed by the pinned, hash-verified script",
      before("gate", r"infra/scripts/install-gitleaks\.sh", r"scan-staged-repository\.sh"))
check("gate: it says that nothing reached Maven Central", re.search(r"::notice[^\n]*staged repository", gate_run) is not None)

# ---- the AAR SBOMs (C261.1, C261.2; review H23; Workflow 11C, sbom-release-11c's borrowed edit) ----
# One CycloneDX SBOM per published module (its release runtime classpath, Stage 1a amendment 10),
# the licence check over each with the module's artifact id, so section 6's rows are named only
# where they ship (openverify-nfc: SCUBA's two files; openverify-face: Eigen inside
# onnxruntime-android), all of it before the staged repository leaves the runner. consumer-check is
# a test build that never ships, so it gets no SBOM (orchestrator decision 5 before 11C).
sbom_step = first("gate", r"gradlew cyclonedxBom")
licence_steps = [index for index, run in enumerate(runs("gate")) if "check-sbom-licences.py" in run]
licence_run = "\n".join(runs("gate")[index] for index in licence_steps)
check("gate: cyclonedxBom writes the published modules' SBOMs after the staged repository is built and before it is uploaded",
      sbom_step is not None and len(uploads) == 1 and before("gate", r"gradlew publishAllPublicationsToStagingRepository", r"gradlew cyclonedxBom")
      and sbom_step < uploads[0], f"{sbom_step} {uploads}")
check("gate: the licence check reads each published module's SBOM with its artifact id, before the upload",
      bool(licence_steps) and len(uploads) == 1 and max(licence_steps) < uploads[0]
      and all(re.search(rf"--artifact \"?aar:{module}\"?|aar:\$module", licence_run) for module in ("openverify-sdk",))
      and all(module in licence_run for module in ("openverify-sdk", "openverify-nfc", "openverify-face"))
      and "python3 -I ../security/check-sbom-licences.py" in licence_run, licence_run)
check("gate: a failed licence check fails the job only after every module was read",
      re.search(r"rc=0[\s\S]*check-sbom-licences\.py[^\n]*\|\| rc=1[\s\S]*exit \"?\$rc\"?", licence_run) is not None)
check("gate: consumer-check gets no SBOM (a test build, never shipped)", "consumer-check" not in licence_run
      and not any("consumer-check" in run and "cyclonedxBom" in run for run in runs("gate")))
sbom_uploads = [step for step in steps("gate") if str(step.get("uses", "")).startswith("actions/upload-artifact@")
                and "android/build/sbom" in str((step.get("with") or {}).get("path", ""))]
check("gate: the SBOMs and their licence reports are kept 30 days as a workflow artifact",
      len(sbom_uploads) == 1 and (sbom_uploads[0].get("with") or {}).get("retention-days") == 30
      and (sbom_uploads[0].get("with") or {}).get("if-no-files-found") == "error")
check("gate: an AAR whose report says pending-owner is named in a warning", re.search(r"pending-owner[\s\S]*::warning", licence_run) is not None)

# ---- the device matrix (C220.3) ----
devices = jobs.get("devices") or {}
strategy = devices.get("strategy") or {}
legs = (strategy.get("matrix") or {}).get("include") or []
check("devices: the legs are API 26 google_apis, API 34 google_apis and API 35 google_apis_ps16k",
      sorted((leg.get("api-level"), leg.get("target")) for leg in legs)
      == [(26, "google_apis"), (34, "google_apis"), (35, "google_apis_ps16k")], str(legs))
check("devices: one leg failing does not cancel the others", strategy.get("fail-fast") is False)
check("devices: only the 16 KB image may fail to boot (an open item of the release gate, never a pass of its tests)",
      sorted(leg.get("api-level") for leg in legs if leg.get("boot-may-fail") is True) == [35]
      and all(leg.get("boot-may-fail") in (True, False) for leg in legs), str(legs))
check("devices: it waits for the gate", devices.get("needs") in ("gate", ["gate"]))
device_steps = steps("devices")
emulator_at = [index for index, step in enumerate(device_steps)
               if str(step.get("uses", "")).startswith("reactivecircus/android-emulator-runner@")]
emulators = [device_steps[index] for index in emulator_at]
check("devices: it boots the image once, then runs the tests", len(emulators) == 2, str(len(emulators)))
check("devices: every emulator step has the 900 s boot budget on x86_64",
      bool(emulators) and all((step.get("with") or {}).get("emulator-boot-timeout") == 900
                              and (step.get("with") or {}).get("arch") == "x86_64"
                              and str((step.get("with") or {}).get("api-level")) == "${{ matrix.api-level }}"
                              and str((step.get("with") or {}).get("target")) == "${{ matrix.target }}" for step in emulators))
avd_cache = [index for index, step in enumerate(device_steps) if str(step.get("uses", "")).startswith("actions/cache@")
             and ".android/avd" in str((step.get("with") or {}).get("path", ""))]
check("devices: the AVD and its snapshot are cached, keyed by the image, before the first boot",
      len(avd_cache) == 1 and bool(emulator_at) and avd_cache[0] < emulator_at[0]
      and "matrix.api-level" in str(device_steps[avd_cache[0]]["with"].get("key", ""))
      and "matrix.target" in str(device_steps[avd_cache[0]]["with"].get("key", "")))
boot, tests = (emulators + [{}, {}])[:2]
check("devices: only the boot step may fail, and only where the leg says so",
      str(boot.get("continue-on-error")) == "${{ matrix.boot-may-fail }}" and "continue-on-error" not in tests
      and "continue-on-error" not in devices)
check("devices: the tests run only on an image that booted", "steps.boot.outcome == 'success'" in str(tests.get("if", ""))
      and boot.get("id") == "boot")
script = str((tests.get("with") or {}).get("script", ""))
check("devices: it runs the SDK's device tests and the minified demo's smoke test",
      ":openverify-sdk:connectedAndroidDeviceTest" in script and ":demo-app:connectedAndroidTest" in script)
check("devices: it runs the optional artifacts' device tests (Workflow 10E, KP10-46)",
      ":openverify-nfc:connectedDebugAndroidTest" in script and ":openverify-face:connectedDebugAndroidTest" in script
      and script.find(":openverify-face:connectedDebugAndroidTest") < script.find("check-connected-results.sh"))
check("devices: the pinned YuNet model and the fixture face are fetched before the emulator builds openverify-face (C205.3)",
      first("devices", r"python3 -I scripts/fetch_models\.py --only face_detection_yunet") is not None and bool(emulator_at)
      and first("devices", r"python3 -I scripts/fetch_models\.py --only face_detection_yunet") < emulator_at[0]
      and first("devices", r"python3 -I scripts/fetch_fixtures\.py --only person_a_id") is not None)
check("devices: the SDK's device tests are told the device is an emulator",
      any(":openverify-sdk:connectedAndroidDeviceTest" in line
          and "-Pandroid.testInstrumentationRunnerArguments.openverifyDeviceKind=emulator" in line for line in script.splitlines()))
check("devices: a device test that skipped itself fails the leg", "check-connected-results.sh" in script)
# Workflow 10D review (A006): the same minimum per module as ci.yml's emulator step (whose numbers
# the ci.yml section counts from the device-test sources): a leg that ran one class is not a pass.
ci_results_lines = {line.strip() for line in ci_text.splitlines() if "check-connected-results.sh ." in line}
release_results_lines = {line.strip() for line in script.splitlines() if "check-connected-results.sh" in line}
check("devices: the results check holds each module to the minimum ci.yml's emulator step holds (A006)",
      len(ci_results_lines) == 1 and release_results_lines == ci_results_lines
      and bool(re.search(r"\.sh \. openverify-sdk=\d+ demo-app=\d+ openverify-nfc=\d+ openverify-face=\d+$", next(iter(ci_results_lines), ""))),
      f"{sorted(release_results_lines)} vs {sorted(ci_results_lines)}")
check("devices: an image that did not boot is reported as an open item, by a warning",
      any("steps.boot.outcome == 'failure'" in str(step.get("if", "")) and "::warning" in str(step.get("run", ""))
          for step in device_steps))
kvm = first("devices", r"99-kvm4all\.rules")
check("devices: KVM is enabled before the first boot", kvm is not None and bool(emulator_at) and kvm < emulator_at[0])

# ---- the publish job (C217.4; review P18) ----
publish = jobs.get("publish") or {}
needs = publish.get("needs")
check("publish: it waits for the gate and the device matrix", isinstance(needs, list) and sorted(needs) == ["devices", "gate"], str(needs))
condition = str(publish.get("if", ""))
check("publish: it runs only from main and only when the dispatch asks for it",
      "github.ref == 'refs/heads/main'" in condition and "inputs.publish" in condition and "||" not in condition, condition)
check("publish: it runs only inside the environment maven-central", publish.get("environment") == "maven-central",
      str(publish.get("environment")))
other = "\n".join(str(jobs.get(name)) for name in jobs if name != "publish")
check("no job but publish names a secret", "secrets." not in other)
publish_env = dict(publish.get("env") or {})
for step in steps("publish"):
    publish_env.update(step.get("env") or {})
secret_names = sorted(set(re.findall(r"secrets\.([A-Z0-9_]+)", str(publish))))
check("publish: the secrets are the Portal token and the signing key, and nothing else",
      secret_names == ["MAVEN_CENTRAL_PASSWORD", "MAVEN_CENTRAL_USERNAME", "SIGNING_IN_MEMORY_KEY", "SIGNING_IN_MEMORY_KEY_PASSWORD"],
      str(secret_names))
publish_run = "\n".join(runs("publish"))
check("publish: no secret or input is interpolated into a script", bool(publish_run) and "${{" not in publish_run)
check("publish: the key is given in memory, through the plugin's Gradle properties",
      all(name in publish_env for name in ("ORG_GRADLE_PROJECT_mavenCentralUsername", "ORG_GRADLE_PROJECT_mavenCentralPassword",
                                           "ORG_GRADLE_PROJECT_signingInMemoryKey", "ORG_GRADLE_PROJECT_signingInMemoryKeyPassword")),
      str(sorted(publish_env)))
ready = first("publish", r"::notice")
deploy = first("publish", r"gradlew[^\n]*publishToMavenCentral")
check("publish: without the owner's secrets it exits with a notice before any Gradle call",
      ready is not None and deploy is not None and ready < deploy
      and steps("publish")[ready].get("id") == "secrets"
      and all("steps.secrets.outputs.present == 'true'" in str(step.get("if", ""))
              for step in steps("publish")[ready + 1:]), f"{ready} {deploy}")
check("publish: it deploys to the Central Portal and leaves the release for a manual click",
      deploy is not None and "publishAndReleaseToMavenCentral" not in text
      and "-PmavenCentralPublishing=true" in publish_run and "-PsignAllPublications=true" in publish_run
      and "-PmavenCentralAutomaticPublishing=false" in publish_run)
version_again = first("publish", r"openverifyVersion")
check("publish: it re-checks the version against the build",
      version_again is not None and deploy is not None and version_again < deploy)

print("\n".join(results))
PY
)
release_rc=$?
if [ "$release_rc" -ne 0 ]; then nok "release: structural checker ran" "python exited $release_rc"; finish; fi
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) ok "${line#ok   - }" ;;
    "FAIL - "*) printf '%s\n' "$line"; failed=$((failed + 1)) ;;
  esac
done <<<"$release_structure"

if command -v actionlint >/dev/null 2>&1; then
  if lint_out=$(cd "$repo_root" && actionlint .github/workflows/android-release.yml 2>&1); then
    ok "release: actionlint reports no problems"
  else
    nok "release: actionlint reports no problems" "$(head -n 10 <<<"$lint_out" | tr '\n' ' ')"
  fi
else
  skip "release: actionlint not installed (the YAML parse check above is the fallback)"
fi

# The version step, run on synthetic inputs: only the version the build declares, written as a
# release (three numbers, no -SNAPSHOT), passes.
release_version_script=$(python3 -I - "$release" <<'PY'
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as fh:
    wf = yaml.safe_load(fh)
for step in ((wf.get("jobs") or {}).get("gate") or {}).get("steps") or []:
    if "openverifyVersion" in str(step.get("run", "")):
        print(step["run"])
        break
PY
)
if [ -z "$release_version_script" ]; then
  nok "release: the version step can be read"
else
  version_dir=$(mktemp -d)
  mkdir -p "$version_dir/android"
  run_version_step() { # <declared> <asked>
    printf 'openverifyVersion=%s\nopenverifyGroup=dev.example\n' "$1" >"$version_dir/android/gradle.properties"
    (cd "$version_dir/android" && VERSION="$2" GITHUB_OUTPUT=/dev/null bash -euo pipefail -c "$release_version_script") >/dev/null 2>&1
  }
  if run_version_step 1.2.3 1.2.3; then ok "release: the version the build declares passes"; else nok "release: the version the build declares passes"; fi
  if run_version_step 1.2.3 1.2.4; then nok "release: another version than the build's is refused"; else ok "release: another version than the build's is refused"; fi
  if run_version_step 1.2.3-SNAPSHOT 1.2.3-SNAPSHOT; then nok "release: a SNAPSHOT is refused"; else ok "release: a SNAPSHOT is refused"; fi
  if run_version_step 1.2 1.2; then nok "release: a version that is not three numbers is refused"; else ok "release: a version that is not three numbers is refused"; fi
  if run_version_step '1.2.3' '1.2.3; echo injected'; then nok "release: a version with shell text is refused"; else ok "release: a version with shell text is refused"; fi
  rm -rf "$version_dir"
fi

# KP10-33: the skip-or-fail rule itself, run in subshells so the counters here do not move.
if [ "$(CI=true skip_unless_ci "probe" | cut -c1-4)" = "FAIL" ]; then
  ok "a missing tool that CI installs is a failure under CI=true, not a skip (KP10-33)"
else
  nok "a missing tool that CI installs is a failure under CI=true, not a skip (KP10-33)" "$(CI=true skip_unless_ci "probe")"
fi
if [ "$(CI='' skip_unless_ci "probe" | cut -c1-4)" = "skip" ]; then
  ok "outside CI the same missing tool is a skip"
else
  nok "outside CI the same missing tool is a skip" "$(CI='' skip_unless_ci "probe")"
fi

# The staged repository's secret scan (android/scripts/scan-staged-repository.sh), on synthetic
# repositories: a private key generated here, inside a jar, fails it; a clean jar passes.
scan_script="$repo_root/android/scripts/scan-staged-repository.sh"
if [ ! -f "$scan_script" ]; then
  nok "release: android/scripts/scan-staged-repository.sh exists"
elif ! command -v gitleaks >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  skip_unless_ci "release: gitleaks or openssl not installed: the staged repository's secret scan was not run"
else
  scan_dir=$(mktemp -d)
  mkdir -p "$scan_dir/src"
  printf 'package dev.example\n' >"$scan_dir/src/A.kt"
  openssl genrsa -traditional -out "$scan_dir/src/leaked-key.pem" 2048 >/dev/null 2>&1
  python3 -I - "$scan_dir" <<'PY'
import sys
import zipfile
from pathlib import Path

root = Path(sys.argv[1])
for name, members in (("clean", ["A.kt"]), ("leaky", ["A.kt", "leaked-key.pem"])):
    folder = root / name / "dev" / "example" / "a" / "1"
    folder.mkdir(parents=True)
    (folder / "a-1.pom").write_text("<project/>\n", encoding="utf-8")
    with zipfile.ZipFile(folder / "a-1-sources.jar", "w") as jar:
        for member in members:
            jar.write(root / "src" / member, member)
PY
  if bash "$scan_script" "$scan_dir/clean" >/dev/null 2>&1; then ok "release: a staged repository without a secret passes the scan"; else nok "release: a staged repository without a secret passes the scan"; fi
  if bash "$scan_script" "$scan_dir/leaky" >/dev/null 2>&1; then nok "release: a private key inside a staged jar fails the scan"; else ok "release: a private key inside a staged jar fails the scan"; fi
  if bash "$scan_script" "$scan_dir/absent" >/dev/null 2>&1; then nok "release: a missing staged repository fails the scan"; else ok "release: a missing staged repository fails the scan"; fi
  rm -rf "$scan_dir"
fi

finish
