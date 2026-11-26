# Phase 11, Workflow 11D Stage 1a: contracts-11d

Evidence for `contracts-11d` (Workflow 11D Stage 1a, alone on the machine): the base, C271's
condition, the inventory's section 4, the method, `load/`, the vegeta pin, the command signatures,
the report templates, the switches and the migration decision. Each section names its commands and
their real, abbreviated output. Checkpoint commits are listed at the end.

## 0. The base, from the records (rules 20 and 25)

Run 2026-11-16, read-only:

```text
$ git merge-base --is-ancestor d44e537dba0f84a4eafc45b313264de74c2b31a4 HEAD; echo $?
0
$ git merge-base --is-ancestor 69fd529c0302efe9072cfc2f1e532a124d597b13 HEAD; echo $?
0
$ git show d44e537db:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11C done'
20:## 2026-11-16: Phase 11, Workflow 11C done (supply chain and deployment: ...)
$ grep -n '^## Orchestrator decisions before Workflow 11D' docs/plans/phase-11.plan.md
2156:## Orchestrator decisions before Workflow 11D (2026-11-16)
$ git merge-base --is-ancestor d44e537db origin/main; echo $?   # recorded, not required
0
```

- **origin/main holds the base** (the 11C push is done; the push is the orchestrator's).
- **CI, read once, never waited on** (`gh run list --branch main --limit 5`): the 11C push's run
  43843705201 (2026-11-16T09:52Z) and the four before it (43595684173, 43408690288, 43137166420,
  43018061783) are `completed / failure` in 4 to 5 s. `gh run view 43843705201 --json jobs` shows
  every one of its 19 jobs with 0 steps (16 `failure`, 3 `skipped`): no step started, so it is not a
  failed job (rule 20), and no CI failure is passed in. `release.yml` and `android-release.yml`
  dispatches stay recorded open (decision 50; the owner has no minutes, KP10-59).
- **The measured path did not move after 11C:** `git log 4758c01d5..d44e537db --` over
  `apps/api/src/watchlists apps/api/src/sync apps/api/src/jobs/reports apps/api/src/jobs/report-types
  packages/db/src packages/watchlist packages/contracts/src/index.ts apps/api/src/config.ts` prints
  nothing.

## 1. Read and record (item 1)

No code. The records read, in full: the plan's Phase 11 sections named by the prompt (C251.5,
C257-C259, C267-C272, C277, C279, C284, C286-C289, "## Workflow 11D", the Rules, Risks, Acceptance,
the decisions and Q12, every 11A-11C amendment and the orchestrator decisions before 11D), the
review resolution's F01, F06, F09, F26, H09-H11, H27, V10-V12, V16, `docs/calibration/watchlist-phase6d.md`,
PROGRESS's Phase 6 closing entry (`docs/PROGRESS.md:1482-1543`), and the Phase 6 plan's
"Owner decisions after Workflow 6C", "Workflow 6D", its Stage 1 and 2 amendments and its review
amendments.

- **C271.1: `missed`.** `watchlist-phase6d.md:291-297` and `:691-695`: 180.9 ms (+80.9) at 100,000
  names, 808.0 ms (+558.0) at 2,000,000, the re-screen 71.2 s (+11.2) after migration 0022.
  PROGRESS `:1500-1516` agrees. Candidates and their files: the plan amendment's items 3 and 4.
- **Seeds:** `grep -rni 'several seeds' docs/plans/ docs/PROGRESS.md` finds only
  `phase-6.plan.md:1999`, `:2014` and `PROGRESS.md:1516`: no owner decision. One fresh seed; the
  question is recorded open (amendment item 5).
- **Q12:** `grep -n Q12 docs/PROGRESS.md` gives `:18` ("owner items Q1–Q12 pending") and `:97`
  ("Q7, Q8 and Q12: unchanged"); no grant in any "Owner decisions" section. **Pending; Locust not
  adopted.** The passed value ("pending") agrees with the record.
- **httpx:** PyPI's JSON (read 2026-11-16): the newest release on or before 2026-10-15 is 0.28.1
  (2024-12-06); 1.0.dev1 to 1.0.dev6 (2025-07-02 to 2026-08-31) are development pre-releases and are
  not taken. Licence BSD-3-Clause.
- **vegeta:** GitHub's release v12.13.0, published 2025-10-31T11:34:10Z, MIT (`LICENSE`);
  `vegeta_12.13.0_checksums.txt` (SHA-256 `384239c9…16e7`) lists
  `e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61  vegeta_12.13.0_linux_amd64.tar.gz`,
  which equals the asset digest GitHub reports. The release also signs the checksum file with PGP
  (`.asc`), which the cosign-only installer pattern does not check.
- **Exclusions read:** grafana/k6 `LICENSE.md` AGPL-3.0; artilleryio/artillery `LICENSE.txt`
  MPL-2.0; mcollina/autocannon MIT, latest release v8.0.0 of 2024-10-14.
- **City Lite (method item (d)):** `https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz`
  (Last-Modified 2026-10-01), downloaded once into a fresh `/tmp` directory, measured and deleted:
  60,193,321 bytes, SHA-256 `c839d407f85a1e0bddba354cef16b2c398182d1c34ed8d985555dce134b36b14`
  (SHA-1 `71dd7ad3…5284`).
- **The reference machine:** Intel Xeon E5-1650 v3 at 3.50 GHz, 6 cores and 12 logical CPUs (one
  socket; siblings 0-1, 2-3, …, 10-11), 31 GiB, a WSL2 virtual disk on a SATA SSD (the Windows host's
  `Get-PhysicalDisk`), Linux 6.18.40.1-microsoft-standard-WSL2, Docker Desktop 29.7.2 (12 CPUs,
  31.3 GiB), Node v22.22.1.
- **Inventory:** `docs/research/phase11-inventory.md` section 4 (4.1-4.8), every claim with
  `path:line`, its cited ranges re-checked with `grep -n` after writing (five ranges corrected).
- **Plan:** "## Workflow 11D Stage 1a amendments (contracts-11d)", items 1-20, appended after the
  orchestrator decisions before 11D.

**Checkpoint "inventory"** (gate: affected scope, rule 27; filter base `69fd529c0`): documents only,
no package selected; `pnpm format:check` exit 0 (117 s, load 0.36 → idle). Commit: the one whose
subject contains "Workflow 11D contracts-11d checkpoint inventory".

## 2. The method and the report templates (items 2 and 6)

Committed before any take and before any seed (C268.6, C271.3; reviews F01, H10, H11, V16): the
Method sections of `docs/calibration/load-phase11.md`, `docs/calibration/watchlist-phase11.md` and
`docs/calibration/lists-phase11.md`, each with its results tables (every cell `pending`), "What this
does not measure", "Amendments" and its summary block (`status: template`, every row `pending` but the
background-list thresholds, `not-calibrated` by the method); the block's schema
`contracts/fixtures/calibration/summary.schema.json` and its synthetic example
`contracts/fixtures/calibration/summary.example.json`; and `load/city-lite-manifest.json`.

Figures fixed by the method (before any measurement): the schedule-lag bound (p99 ≤ 10 ms, maximum
≤ 100 ms), vegeta's achieved rate ≥ 99%, a saturated generator above 90% of its CPU, the error budget
0.1%, the idle baseline ≤ 4 with a 15-minute wait, at most six attempts for three takes, the step-up
(0.25 to 4 times the budget rate, 30 s warm-up and 120 s a step), takes of 60 s warm-up and 300 s,
the soak's 10% and 10-minute rules with a swap at minute 15, the fairness ceiling 200, the jit margin
5%, the role timeouts at 2 times the longest legitimate statement (rounded up to 10 s) and idle gap
(at least 60 s), the matcher margin 5% (6D's), the re-key heap 2 GiB, the fuzzy-name cap rule (1.5
times the 2,000 cap's p95 at 1,000,000 items, +512 MiB, identical digests), the face-list rule (0.5
stays while the FPIR interval's upper end at gallery 10,000 is ≤ 1%), and the core split (containers
on CPUs 0-9, vegeta on 10, the driver and the sampler on 11).

```text
$ python3 -I -c "...fetch_data.load_manifest(Path('load/city-lite-manifest.json'))..."
1 dbip_city_lite_2026_10 60193321 CC-BY-4.0
$ pnpm exec prettier --check contracts/fixtures/calibration/*.json load/city-lite-manifest.json
All matched files use Prettier code style!
$ grep -c 'openverify:calibration-summary:start' docs/calibration/*-phase11.md
docs/calibration/load-phase11.md:1
docs/calibration/lists-phase11.md:1
docs/calibration/watchlist-phase11.md:1
```

The example and the three blocks are written in the canonical form `load/report.py` renders
(`json.dumps(..., indent=2, sort_keys=True)`); item 3's pytest holds both.

**Checkpoint "method"** (gate: affected scope, rule 27; filter base `6ac2c101a`): no package selected;
`pnpm format:check` exit 0 (load 0.27 → idle). Commit: the one whose subject contains "Workflow 11D
contracts-11d checkpoint method".

## 3. load/ (item 3; KP11-36)

### 3.1 RED: load/ joins the uv tool projects (`packages/config/src/supply-chain-pins.test.ts`)

```text
$ (cd packages/config && pnpm exec vitest run src/supply-chain-pins.test.ts --coverage.enabled=false)
 FAIL  … the uv tool project load … > pins its tool exactly and takes only releases at least 14 days old
 FAIL  … the uv tool project load … > commits a hashed lockfile
 FAIL  … the uv tool project load … > records the licence of every package its lockfile resolves
      Tests  3 failed | 46 passed (49)
Error: ENOENT: no such file or directory, open '…/load/pyproject.toml'
```

The intended reason: `load/` does not exist yet. The test file typechecks (`tsc --noEmit -p
packages/config`, exit 0).

### 3.2 GREEN: the project, its lockfile, its ledger rows and the stubs

- `load/pyproject.toml` (`httpx==0.28.1`; dev `mypy==2.4.0`, `pytest==9.1.1`, `pytest-cov==7.1.0`,
  `ruff==0.17.1`, vision's versions; `[tool.uv] package = false`, `exclude-newer = "14 days"`; ruff,
  mypy `--strict`, pytest and coverage configured as `services/vision/pyproject.toml`'s, fail-under
  80), `load/.python-version` 3.12, and `load/uv.lock` from `uv lock` (uv 0.13.3; `Resolved 22
  packages`, `exclude-newer-span = "P14D"`, every file hashed).
- Every locked package's date and licence read from PyPI's JSON on 2026-11-16 (anyio 4.16.0 of
  2026-11-01 is the youngest, 15 days old): 21 rows in `THIRD_PARTY_LICENSES.md` §2.1.24; certifi
  2026.10.23 and pathspec 1.1.1 for `load/` in §5; k6 in Excluded; Artillery, autocannon and Locust
  (Q12 pending) under Not adopted. `.gitignore` gains `load/results/` and
  `packages/watchlist/results/`.
- The skeleton, every body a typed stub raising `NotBuiltError` ("not built yet (Workflow 11D
  load-harness)"): `load/driver/` (`PlannedRequest`, `Outcome`, `Driver`, `OpenModelDriver`, the lag
  bound constants and `lag_within_bound`), `load/limits.py` (the limits the scenarios meet),
  `load/scenarios/` (`spec.py` with `PolicyLoad`, `Budget`, `ScenarioSpec`; one module per scenario
  id with its `SPEC` and `plan`; `SCENARIOS`), `load/vegeta/`, `load/sampler.py` (`QUEUES`),
  `load/report.py` (the summary block's constants and functions).

```text
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy .)
All checks passed!
28 files already formatted
Success: no issues found in 28 source files
$ (cd packages/config && pnpm exec vitest run src/supply-chain-pins.test.ts --coverage.enabled=false)
      Tests  49 passed (49)
```

### 3.3 RED: load/'s contract tests

`load/tests/`: `test_report.py` (the example is the declared record rendered, written only under
`UPDATE_CONTRACT_FIXTURES=1`; the three reports' blocks hold the schema's rules; the block round
trips; a report with no block or two is refused; 23 broken records each named; the constants are the
schema's), `test_scenarios.py` (one module per scenario of the method; the shipped limits only; every
principal at most at half its limit at the top step; the refusal scenario past them; the documentation
ranges only), `test_limits.py` (each mirror equal to `rate-limits.ts` and `login-rate-limiter.ts`),
`test_driver.py` (the lag bound: p99 ≤ 10 ms, maximum ≤ 100 ms), `test_sampler.py` (every queue one
`apps/api/src` registers; the method's queues), `test_vegeta.py`.

```text
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy .)
All checks passed!   34 files already formatted   Success: no issues found in 34 source files
$ (cd load && uv run pytest -q)
53 failed, 44 passed in 1.13s
     25 driver.interface.NotBuiltError: report.check_summary: not built yet (Workflow 11D load-harness)
     19 driver.interface.NotBuiltError: PolicyLoad.share: not built yet (Workflow 11D load-harness)
      3 driver.interface.NotBuiltError: report.parse_summary: not built yet (…)
      3 driver.interface.NotBuiltError: lag_within_bound: not built yet (…)
      2 driver.interface.NotBuiltError: report.summary_block: not built yet (…)
      1 driver.interface.NotBuiltError: report.summary_json: not built yet (…)
```

Every failure is a stub's refusal; the 44 that pass are the guards (the mirrors, the queue names, the
stubs that stay `load-harness`'s).

### 3.4 GREEN: the summary block, the share and the lag bound

`report.summary_json`, `summary_block`, `parse_summary` and `check_summary` (the schema's rules, by
hand: no JSON Schema library enters `load/`); `PolicyLoad.share`; `lag_within_bound` (nearest-rank
p99 and the maximum).

```text
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)
All checks passed!   34 files already formatted   Success: no issues found in 34 source files
TOTAL   386   12   94   12   95%
Required test coverage of 80% reached. Total coverage: 95.00%
97 passed in 0.50s
$ git status --porcelain contracts/          # a plain pytest changes nothing (rule 24)
(empty)
```

### 3.5 KP11-36: supply-chain.sh reads load/uv.lock (each its own call, 2026-11-16 ~10:22Z)

```text
$ bash infra/scripts/supply-chain.sh osv
Scanned load/uv.lock file and found 21 packages
supply-chain: OSV: the OSV API was queried live at 2026-11-16T10:21:53Z for 17 lockfiles (no local database)
osv: 22 findings; 0 failing (critical, high or no severity), 5 allowlisted, 17 reported.
-- supply-chain: osv: exit 0
$ bash infra/scripts/supply-chain.sh pip-audit
supply-chain: pip-audit: PyPI's vulnerability service was queried live at 2026-11-16T10:21:59Z; …
pip-audit: 0 findings; 0 failing (critical, high or no severity), 0 allowlisted, 0 reported.
-- supply-chain: pip-audit: exit 0
```

No finding on a `load/` package; the 5 allowlisted are the existing `android/consumer-check/`
entries, and no allowlist entry was added. Without the "has no uv.lock yet" notice, pip-audit
audited `load/` beside vision.

**Checkpoint "load"** (gate: affected scope, rule 27; filter base `ac3fc1558`): the only package
change is `packages/config/src/supply-chain-pins.test.ts`, a test file no package imports, so the
filter was narrowed from `...[ac3fc1558]` (every package depends on `@openverify/config`) to
`--filter=@openverify/config` (recorded as a deviation; the last checkpoint's full gate covers every
package): `pnpm turbo run lint typecheck test --force --filter=@openverify/config` exit 0 (446 tests,
97.22% statements; load 0.28 → 0.40); `load/`'s gate above exit 0. Commit: the one whose subject
contains "Workflow 11D contracts-11d checkpoint load".

## 4. The vegeta pin (item 4; C258.3)

### 4.1 RED

`infra/tests/supply-chain-skeletons.test.sh`'s pin list gains
`vegeta|VEGETA|12.13.0|e8759ce4…2e61`; `load/tests/test_vegeta.py` reads the installer's version.

```text
$ bash infra/tests/supply-chain-skeletons.test.sh
FAIL - install-vegeta.sh exists
# 108 passed, 1 failed, 12 skipped
$ (cd load && uv run pytest tests/test_vegeta.py --no-cov)
E       FileNotFoundError: … infra/scripts/install-vegeta.sh
1 failed, 1 passed
```

### 4.2 GREEN

`infra/scripts/install-vegeta.sh`, executable, in 11C's skeleton pattern: `set -euo pipefail`,
`VEGETA_VERSION_DEFAULT="12.13.0"`, `VEGETA_SHA256_DEFAULT="e8759ce4…2e61"`, then
`OPENVERIFY_SKELETON=1` and a "not built yet" exit 3 until `load-harness` fills it in
`infra/scripts/lib/install-common.sh`'s pattern with `infra/tests/install-vegeta.test.sh`. Its row
in `THIRD_PARTY_LICENSES.md` §1 (MIT, 2025-10-31, 381 days old on 2026-11-16; the PGP signature of the
checksum file noted as not checked by the cosign-only pattern).

```text
$ bash infra/tests/supply-chain-skeletons.test.sh
ok   - install-vegeta.sh is executable
ok   - install-vegeta.sh runs with set -euo pipefail
ok   - install-vegeta.sh pins VEGETA 12.13.0
ok   - install-vegeta.sh pins VEGETA's SHA-256
ok   - install-vegeta.sh fails closed as a skeleton (exit 3, nothing written)
# 113 passed, 0 failed, 12 skipped
$ (cd load && uv run pytest tests/test_vegeta.py --no-cov)
2 passed
```

`shellcheck` is not installed on this host (exit 127), as for 11C's skeletons; the shell contract
tests hold the script.

**Checkpoint "vegeta"** (gate: affected scope, rule 27; filter base `4150d275e`): no package changed;
`bash infra/tests/supply-chain-skeletons.test.sh` exit 0 and `load/`'s gate exit 0. Commit: the one
whose subject contains "Workflow 11D contracts-11d checkpoint vegeta".

## 5. The command signatures (item 5; C268.3, C270.1; KP11-35)

### 5.1 RED

- `apps/api/src/commands-build.test.ts`: `watchlists:rebuild-key-df` joins the operator commands and
  the count goes 19 → 20; `seed:load` joins `DEVELOPMENT_TOOLS` with its reason.
- `security/tests/test_gitleaks_pii_config.py`: `apps/api/scripts/seed-load.ts` joins the scope's
  inside cases (KP11-35).
- `infra/tests/gitleaks-pii.test.sh`: case 4b, a positive value in `apps/api/scripts/seed-load.ts`
  is caught.

```text
$ (cd apps/api && pnpm exec vitest run src/commands-build.test.ts --coverage.enabled=false)
AssertionError: expected [ 'api-keys:pepper-status', …(18) ] to deeply equal ArrayContaining{…}
      Tests  1 failed | 22 passed (23)
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . security/tests/test_gitleaks_pii_config.py --no-cov
E       AssertionError: assert ['apps/api/sc...seed-load.ts'] == []
1 failed, 8 passed
$ bash infra/tests/gitleaks-pii.test.sh
FAIL - the load seed's source (apps/api/scripts/seed-load.ts) is read (exit 0)
# 24 passed, 1 failed
$ (cd apps/api && pnpm exec tsc --noEmit -p .)      # the RED typechecks
exit 0 (95 s)
```

### 5.2 GREEN

- `apps/api/package.json`: `"watchlists:rebuild-key-df"` and `"seed:load"`, each `tsx
  --conditions=@openverify/source --env-file-if-exists=../../.env scripts/<name>.ts`.
- `apps/api/tsconfig.commands.json`'s `files` gains `scripts/watchlists-rebuild-key-df.ts` (20
  entries); `seed:load` is not compiled.
- `apps/api/scripts/watchlists-rebuild-key-df.ts` and `apps/api/scripts/seed-load.ts`: stubs that
  write "not built yet" to stderr and exit 2, each header holding its interface (flags, refusals, the
  role it runs as). Neither reads a variable yet; the variables they will read are registered
  already (inventory 4.5), so `config-registry.ts` gains no entry.
- `security/gitleaks-pii.toml`: each of the eight rules' path gains
  `(?:^|/)apps/api/scripts/seed-load\.ts$` (KP11-35), and the scope comment names it.
- `infra/tests/images.test.sh api`: `seed-load` joins the development tools that must be absent from
  the image (the live run needs the image rebuilt from this tree: section 8).

```text
$ (cd apps/api && pnpm exec vitest run src/commands-build.test.ts src/config-registry.test.ts --coverage.enabled=false)
      Tests  49 passed (49)
$ uv run --project security/python --frozen pytest … security/tests/test_gitleaks_pii_config.py --no-cov
9 passed
$ bash infra/tests/gitleaks-pii.test.sh
ok   - the load seed's source (apps/api/scripts/seed-load.ts) is read
# 25 passed, 0 failed
$ pnpm --filter @openverify/api seed:load
seed:load: not built yet (Workflow 11D load-harness builds it)      (exit 2; pnpm reports 1)
$ pnpm --filter @openverify/api watchlists:rebuild-key-df
watchlists:rebuild-key-df: not built yet (Workflow 11D matcher-write-11d builds it)
```

Item 5's checkpoint gate is the last checkpoint's full gate (section 8), since items 5 and 7 change
`apps/api` and `packages/db`, whose affected scope is the API's and the db's whole suites anyway.

## 6. The switches (item 7; C270.4, C271.2) and the migration decision (item 8)

### 6.1 Stub

`packages/db/src/repositories/watchlist-switches.ts` (exported from `repositories/index.ts`): the
names `WATCHLIST_WRITE_SWITCHES`, `WATCHLIST_C787_LEVERS`, `WATCHLIST_PHASE11_SWITCHES`,
`WatchlistPhase11Switch`, `WatchlistWriteTuning`, `WATCHLIST_WRITE_TUNING_DEFAULTS`, and the four
functions as stubs that throw "not built yet", so the RED test compiles. `tsc --noEmit -p
packages/db` exit 0; `eslint` on the two files exit 0.

### 6.2 RED

`packages/db/src/repositories/watchlist-switches.test.ts`: the names (two C270 switches, four C271
levers); every switch off by default; one turned on alone and restored; nested changes restored in
order; every tuning `null` by default and the defaults frozen; tunings set, turned off with `null`
and restored; a frozen copy handed out; seven out-of-range tunings refused with nothing changed; the
bounds of each range accepted.

```text
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlist-switches.test.ts --coverage.enabled=false)
Error: watchlistSwitchEnabled: not built yet (Workflow 11D contracts-11d)
Error: useWatchlistSwitches: not built yet (Workflow 11D contracts-11d)
Error: useWatchlistWriteTuning: not built yet (Workflow 11D contracts-11d)
      Tests  19 failed | 1 passed (20)
```

The one that passes checks the constants' names. Prettier, eslint and `tsc --noEmit -p packages/db`
exit 0.

### 6.3 GREEN

The registry as Stage 1a amendment 7 describes it: a module-level set of enabled switches (empty by
default) and a frozen tuning object (every member `null`), each `use*` returning a restore
function; tunings checked before anything changes (`rekeyBatch` 1-100,000, `ginPendingListLimitKb`
64 to Postgres's maximum, `ginCleanEveryBatches` at least 1, whole numbers), with a `RangeError`
otherwise.

```text
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlist-switches.test.ts --coverage.enabled=false)
      Tests  20 passed (20)
$ (cd packages/db && pnpm exec eslint src/repositories/watchlist-switches.ts src/repositories/watchlist-switches.test.ts)
exit 0
```

No call site reads a switch yet: `matcher-write-11d` and `matcher-c787-11d` wire each one, test-first,
behind its name. The benchmark imports the registry only in the steps that need it (Stage 1a
amendment 7), so the base without it still runs.

### 6.4 The migration (item 8): none created

11D needs no migration to measure (amendment 8). If a change ships DDL, it is
`packages/db/drizzle/0037_phase11d_watchlist.sql` (the base's newest is `0036_phase11_hardening.sql`;
no pgvector, so no `CREATE EXTENSION`), owned by `matcher-write-11d`, with `matcher-c787-11d`'s
`stored-name-analysis` column as its named borrowed edit after `matcher-write-11d`'s checkpoint
"migration", and `fix-11d` adding `fastupdate = off` there if the calibration takes it.

## 7. Known items

- **KP11-35: fixed.** RED `5708bf649` (`security/tests/test_gitleaks_pii_config.py` and
  `infra/tests/gitleaks-pii.test.sh` case 4b), GREEN `c87d90fab` (`apps/api/scripts/seed-load.ts` in
  every rule's path of `security/gitleaks-pii.toml`). seed:load's stub lives in `apps/api/scripts/`,
  so its path joins the scope; its logic will live in `apps/api/src/seed/`, already in scope.
- **KP11-36: fixed.** From `6ec479ef4` (the commit that adds `load/uv.lock`), `supply-chain.sh osv`
  and `pip-audit` scan it, each exit 0 (section 3.5, again in section 8): 21 packages, no finding,
  no allowlist entry added.

## 8. The full gate on the final tree (the last checkpoint, rule 27)

Run 2026-11-16, alone on the machine, at `99fe02678` plus this file (documents only). Every call
exited 0 unless a lone coverage shard (by design exit 1, its merge the gate). Lock waits were 0 s.

| Call | Result | Time | Load (start → end) |
|---|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | exit 0; no `minimumReleaseAgeExclude` | | 0.86 |
| `pnpm format:check` | exit 0 | 111 s | 0.86 → 1.26 |
| `pnpm turbo run typecheck --force` (heavy slot 0) | 19 of 19 | 157 s | 1.24 → 4.59 |
| lint `--filter=@openverify/api` (4 GB heap, `--concurrency=1`) | 1 of 1 | 229 s | 4.22 → 2.25 |
| lint `--filter=@openverify/dashboard --filter=@openverify/contracts` | 2 of 2 | 221 s | 2.07 → 1.58 |
| lint, the other 16 packages | 16 of 16 | 334 s | 1.46 → 1.51 |
| `turbo run test --force --filter=@openverify/db` | 2,377 tests, 89.92% | 161 s | 1.51 → 10.03 |
| `… --filter=@openverify/watchlist --filter=@openverify/e2e` | 820 and 155 tests | 275 s | 9.38 → 1.17 |
| dashboard, 2 blob shards and a merge | 7,235 tests in 622 files, 95.62% | 201, 219 and 6 s | 1.07 → 7.33 |
| the other 13 packages, one forced call | 13 of 13 (contracts 4,905, checks 3,849, workflow-engine 2,042, core 2,007, flow 1,678, flow-spec 527, node 508, config 446, emrtd 338, signals 192, ui 58, react 55, demo-web 18) | 177 s | 6.75 → 14.34 |
| `pnpm --filter @openverify/js test` | 19 tests | 5 s | 12.37 |
| API, 8 blob shards and a merge | **10,887 tests in 858 files, 94.16%** (11C's 10,886 and the new command's case) | 163-200 s each, merge 40 s | 11.38 → 4.48 |
| `load/`: ruff, format, mypy, pytest | 97 tests, 95% | | |
| `benchmark:typecheck`, `benchmark:test` | exit 0; 119 tests | 63 s, 11 s | |
| security/python: pytest, ruff, format, mypy `--strict` | 196 tests | | |
| integration db; graph; api 1/3, 2/3, 3/3 | 110; 13; 123, 129, 193 (445) | 96; 33; 104, 172, 113 s | 1.78 → 15.73 |
| `infra/tests/install-gitleaks.test.sh` | 31 passed | 3 s | |
| `infra/tests/supply-chain-skeletons.test.sh` | 113 passed, 12 skipped (the filled installers) | | |
| `infra/tests/gitleaks-pii.test.sh` | 25 passed | 11 s | |
| `images.test.sh static`, `pins`, `override` | 149, 24, 33 passed | | |
| `docker build -f infra/docker/api.Dockerfile -t openverify/api:11c-local .` (e2e lock) | exit 0, `sha256:3a071c49…0513` | 158 s | 9.74 → 2.68 |
| `images.test.sh api` (e2e lock) | 55 passed: every command compiled, `seed-load` absent | 62 s | 2.54 → 2.08 |
| `node dist/commands/watchlists-rebuild-key-df.js` in the image | "not built yet", exit 2 | | |
| `supply-chain.sh osv`; `supply-chain.sh pip-audit` | exit 0 (21 load/ packages; 0 findings) | | |
| mocked flow suite (e2e lock) | 349 passed | 120 s | 1.56 → 11.14 |
| stack down and the e2e build; a fresh stack up | exit 0; ready | 30 s; 99 s | 10.25 → 3.66 |
| chromium shards 1-4 | 50, 52, 47, 49 (198) | 280, 343, 287, 403 s | 3.37 → 1.92 |
| console sweep (`--no-deps`, the used stack) | 109 passed | 311 s | 1.76 → 2.11 |
| `:openverify-sdk:stackTest` (e2e lock outside, Gradle lock inside) | 3 of 3 from the XML (tests 1, skipped 0, failures 0, errors 0 each) | 49 s | 2.02 → 2.48 |
| `e2e:stack:down` | exit 0, the record removed | 2 s | |

`infra/tests/ci-workflow.test.sh` was not run (decision 17 before 11D: `fix-11d` alone runs and
edits it). Nothing under `android/` changed, so no Android gate call beyond stackTest and no device.

**Checkpoint "switches"** (the last; the full gate above): items 5, 7 and 8. Commit: the one whose
subject contains "Workflow 11D contracts-11d checkpoint switches".

**Checkpoints:** inventory `6ac2c101a`; method `ac3fc15583558d1ad256c44fb9e39eee7ebce871`; load
`4150d275e`; vegeta `1a468cbad`; switches (this file's commit).
