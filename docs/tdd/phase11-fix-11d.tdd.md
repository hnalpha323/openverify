# Workflow 11D fix-11d: evidence (the review's blocking and medium items, the verdict actions, the re-measurements, the CI wiring, the amendments and the Validation)

Agent `fix-11d` (Workflow 11D Fix; alone, after every other agent), claude-opus-5-5, from
2026-11-17 16:49 EST on `64cf94ad3` (11D base `d44e537db`, start `69fd529c0`). Every command
below ran from the repository root after `source scripts/env.sh` unless it says otherwise.

## 0. Start

- `git status --porcelain`: only the owner's untracked `31-Oct-openverify-session-state.txt`.
- CI after the 11C push (rules 20, 25): `gh run list --branch main --limit 3` (read-only) shows run
  43843705201 on `d44e537db` "completed / failure"; `gh run view 43843705201 --json jobs` gives 19
  jobs, every one with 0 steps (16 failure, 3 skipped): no step started, so it is not a failed job
  and nothing is passed in.
- Load at start 0.10; no other agent, suite or compose project running (`docker ps -a`: three
  stopped containers of the owner's and the analytics benchmark's, none of this Workflow's).

## 1. P001 (HIGH): fairness "met" without the cap (test-first)

Stubs `50bcf2cef`, `144ecee8f` (no behaviour). RED `5945d1e39`:

```
$ (cd load && uv run pytest -q --no-cov)
E       AssertionError: assert None == 125.5
E       NotImplementedError: flood_reached_cap
E       assert 2000.0 == 840.0 ± 8.4e-04
E       NotImplementedError: admissions_sql
E           argparse.ArgumentError: argument command: invalid choice: 'admissions' ...
E       assert (0, 5.0) == (500, 50.0)
E       NotImplementedError: settled_ms
E       NotImplementedError: unit_server_durations_ms
8 failed, 224 passed in 3.32s
```

The fake take's victim value was 2,000 ms (the poll's interval), not the report's own 840 ms.
GREEN `dc7ce9460`: `PlannedRequest.measure` and `Outcome.server_ms` (a duration only, never a body),
`unit_server_durations_ms`, `settled_ms` on the settled poll, `run.py`'s `SERVER_TIMED` for
fairness, `fairness.flood_times` (500 runs at 50 a second, then 5 a second), `report.flood_reached_cap`
with `FLOOD_UNDER_CAP`, and `sampler.py admissions` (report runs per environment, those admitted
more than 1 s after creation, the longest wait; bounds checked against an ISO pattern before they
enter the statement).

```
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest -q)
Success: no issues found in 50 source files
Required test coverage of 80% reached. Total coverage: 96.62%
232 passed in 7.03s
```

## 2. P002 and P003 (MEDIUM): missing webhook events; discard rules 1 and 2 in run.py

Stubs in `50bcf2cef`. RED `26719b57e` (the existing webhook test's events moved into the fake
take's window, since events outside it no longer count):

```
E       NotImplementedError: webhook_figures
E       assert True is False
E       NotImplementedError: wait_for_idle
E       NotImplementedError: wait_for_idle
E       Failed: DID NOT RAISE NotIdleError
E       NotImplementedError: container_states
E       assert True is False
7 failed, 232 passed in 3.11s
```

GREEN `252723072`: `wait_for_idle` (load at most 4, no waiting or active job, 15 minutes, else
`NotIdleError` and a `.not-started.json`; `run.py` exits 9), `stack_probe`, `container_states` and
`restart_reasons` (restart count and start time before and after), `webhook_figures` and
`receiver_events` (events created in the measured window only; a missing one makes the p95 None and
the take invalid; the receiver file is read again every 5 s for at most `--receiver-drain`, 120 s).
`239 passed`, coverage 96.6%.

## 3. calibration-load-11d's followups to fix-11d (local ones)

RED `a1304d236`:

```
E       KeyError: 'console-login'
E       AssertionError: assert {'submit': None, 'poll': None} == {'submit': '2...'203.0.113.1'}
E       assert 1 == 60
3 failed, 239 passed in 3.10s
```

GREEN `410b71a4d`: verification's submit and polls carry the session's documentation address (the
continuation receives it); the login limiter's address half sends `limiter-probe-<i>@example.com`;
`COMPLETIONS["console-login"] = "totp"`. `242 passed`.

## 4. The C271.2 verdict action: `retrieval-reach` on by default

RED `b88bfcec3` (`watchlist-switches.test.ts` and `watchlist-reads.test.ts`; the identity test's
"off" half now turns the lever off explicitly, since off is no longer the default):

```
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlist-switches.test.ts src/repositories/watchlist-reads.test.ts --coverage.enabled=false)
 × turns retrieval-reach on by default, the lever the calibration kept
 × turns a switch off again and restores nested changes in order
 × is on by default, ranking with each key made distinct inside its own lookup, and off keeps the old statement
AssertionError: expected false to be true // Object.is equality
Tests  3 failed | 41 passed (44)
```

GREEN `cd408c3ca`: `WATCHLIST_SWITCHES_ON_BY_DEFAULT = ['retrieval-reach']` seeds the enabled set.
`Tests 44 passed (44)`. The identity across 24 seeded searches × 3 seeds (`answers every seeded
search exactly as with the lever off`) still holds. `rescreen-bound-memo` (kept by rule 2 with no
measurable gain, +0.1% to +0.5%) stays off: no re-screen figure moves.

## 5. Finding 1 of watchlist-phase11: the 2,000,000-name copy

Stub `6ff49101e`. RED `47129c92b`:

```
$ (cd packages/watchlist && pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-write.test.mjs)
 × keeps each snapshot as a custom-format dump file in the container
 × dumps without compression and restores in parallel, stopping at the first error
 × copies no database by template any more
AssertionError: expected '' to be '/var/lib/postgresql/openverify-snapsh…'
Error: dumpCommand(evaluation_2m): not built yet (Workflow 11D fix-11d)
Tests  3 failed | 10 passed (13)
```

GREEN `aa0772634`: `snapshotDumpPath`, `dumpCommand`, `restoreCommand`; the steps dump the import
database in the container (`benchmarkContainer(name).exec`) and restore a take's database from the
dump (`--jobs=4 --exit-on-error`), then `vacuum analyze`. `benchmark:typecheck` exit 0;
`benchmark:test` 14 files, 133 tests, exit 0.

## 6. The list calibrations (owner decisions 3 and 4 after 7B)

RED `4bd98ed47` (`expected 2000 to be 5000`); GREEN `eeae81d9f`: `fuzzy-name-candidate-cap` 5,000 and
`face-list-threshold` 0.72, each `calibrated` with `docs/calibration/lists-phase11.md`'s basis
(the face threshold's source states FNIR 25.3% and the set's resolution), `docs/lists/README.md` and
`docs/lists/biometric.md` in the same commit. The background thresholds stay provisional and
`not-calibrated` (release checklist).

## 7. Small followups

- `apps/api/tsconfig.build.json` excludes `src/seed/load/**` and `src/seed/load-seed.ts`: RED
  `017ca78ae` (`commands-build.test.ts`, 1 failed of 25), GREEN `a3c03ca32` (25 passed); nothing
  compiled imports them (`grep`), and `tsc -p tsconfig.build.json --noEmit` reports no error in
  `src/seed/` (its other errors are the stale `dist/` of `@openverify/db`, which the build's turbo
  order rebuilds first).
- `calibration:report` with `--experimental-transform-types`: RED `551747e68`, GREEN `7dd81f736`;
  `pnpm --filter @openverify/checks calibration:report --selfie --unknown-flag` now answers
  `error: Unknown option '--unknown-flag'` (it loads core's sources).
- vegeta's ledger row in `supply-chain-pins.test.ts` (`0176506de`): a hold test of an existing row,
  shown able to fail (the date changed to 2025-10-30: `× records vegeta 12.13.0, released
  2025-10-30, under MIT`), then restored; 51 passed.
- R007: RED `f52d195cd` (`expected [ 100, … ] to deeply equal [ 50, … ]`), GREEN `78f591533`:
  dense rings of 50, the default fan-out cap. The calibration's raw output shows `skippedHubValues:
  100` for 100 runs: rings of 100 were skipped as hubs.

## 8. CI wiring (decision 17 before 11D; Stage 1a amendments 15 and 17)

RED `d86d05764`: `ci-workflow.test.sh` already failed on the vegeta and load-compose lines (3 failed
of 524); the new checks failed too:

```
FAIL - infra: runs infra/tests/load-compose.test.sh --static-only (the load override's static half)
FAIL - supply-chain: runs infra/tests/install-vegeta.test.sh --offline-only (the installer's static checks)
FAIL - vision: load/'s gate is the job's last step
FAIL - vision: runs load/'s gate as one step in load/ (uv sync --frozen, ruff, ruff format, mypy, pytest)
# 521 passed, 6 failed, 0 skipped
```

GREEN `d2ffa9ac9`: the three ci.yml lines (no job added). The vision job's three "benchmark runs
after pytest" checks read the vision suite's pytest (a step not in `load/`), since load/'s gate is
now the last step: `# 527 passed, 0 failed, 0 skipped`. `load-compose.test.sh --static-only`
103 passed, 1 skipped; `install-vegeta.test.sh --offline-only` 23 passed, 1 skipped. `UV_LOCKED=1
uv sync --frozen` warns and syncs (the job sets `UV_LOCKED`).

## 9. Method amendments before the retakes

`e28e49b2a`: `load-phase11.md` amendment 11 and `watchlist-phase11.md` amendment 9.

## 10. The load retakes (amendment 11; alone, every take under the e2e lock)

Images rebuilt from `77e851b67`, each its own `docker build` under the e2e lock (lock wait 0.003-0.004 s):

| Image | Seconds | Load | Id |
|---|---|---|---|
| api | 166 | 0.33→2.38 | `sha256:b0c5912a3b5268ff411942d947d7c30eec288edb17c278a4d0836a5e535e2b75` |
| dashboard | 126 | 2.27→2.47 | `sha256:7594832987b6b0035765fa192cf007585ebfc98241c757cfa0b9437088cd017e` |
| flow | 35 | 2.47→3.55 | `sha256:51e58ee583f70da96a2ad6574afcd9157ba448cc436ad5199199d64f0ebc0eeb` |
| code-runner | 41 | 3.26→2.57 | `sha256:d3bef02f671b154ae922eb47f20893e760377508b2a39aed40c9e6eeb7c18bef` |
| vision | 2 (cached) | 2.57→2.57 | `sha256:cec62be46312e821ec0e2bce45d2ae17d36e5219369ed67f91b41fd9ad1288ce` |

`infra/load/make-load-env.sh`; `docker compose -p openverify-load … up --detach --wait --no-build`
(rc 0, 29 s, 2.37→2.57). `seed:load --scale reference`: organisations 9 s, principals 40 s,
accounts 78 s, inquiries 1-4 168/168/163/176 s, watchlists 1 73 s (each rc 0, lock wait 0.003-0.004
s); the nine network sources imported from synthetic files (`/tmp/cl11d/tools/net-files.mjs`), each
`applied`. Takes through `/tmp/fx/take.sh` (scratch): `run.py take` (which now waits for the idle
baseline and checks restarts itself) on `taskset -c 11`, the sampler beside it, `sampler.py
statements`, `server-times`, `metrics` and `admissions` over the window. Raw files under
`load/results/fix11d/` (outside git). The figures are in `load-phase11.md`; in brief: fairness
default cap idle 113.0/101.0/110.0 ms, flood 3,196.0 (invalid)/2,946.0/2,778.0/2,926.0 ms, ratio 26.6
(missed); ceiling idle 117.0/106.0/105.0, flood one valid (3,544.0) of five (not measured);
verification steps 1.657/1.773/2.494 (invalid)/2.083 (retake)/25.42 s, take at 1/s invalid (72.65 s,
lag 1.9 s); console-login two-step 131.6/142.7/111.1 ms (one attempt not started at load 4.64, one
invalid); login half 50 × 401 then 10 × 429 (invalid on one 59.7 ms lag). Two takes outran a
10-minute call and the harness moved them to the background; nothing else ran until they ended.
The ceiling configuration was applied and removed as the calibration did it (env file and the
flooder's `queue-in-flight-caps`, API and worker recreated). Stack down: `down --volumes` rc 0 (10 s),
no container or volume left; `/tmp/openverify-load/{load.env,seed.json,cursors.json}` removed.

## 11. The matcher retakes (amendment 9; alone, the load stack down)

Worktree `/tmp/cal11d-fx` at `77e851b67`, `pnpm install --frozen-lockfile --offline`, `data/` copied
but `variant-groups.json`, built again (`29d05838…`, as the calibration's). Steps through scratch
copies of the calibration's runners (`/tmp/fx/{perf,run,inner,gate}.sh`, the load wait capped at 420 s
so a call fits 10 minutes); the seed `eab27c87…` from `/tmp/openverify-eval-11d/seed.txt`;
namespace `c11d-fx`. Long steps ran in the background under the e2e lock with heartbeats, waited for
with foreground calls, nothing else running. Results in `watchlist-phase11.md` ("`fix-11d`'s
takes"): 100k rounds 71.9/65.1/69.0 ms, 2M 335.4/314.1/308.4 ms, identity 300/300 at each scale
against the calibration's head; snapshots dumped in 41 and 45.7 s; keydf identity at 2M 4 checks with
0 differences, 300 digests identical; keydf-sync off 275.1/265.0/272.9 s, on 127.9/127.5/126.0 s;
rekey 500 2,270.5 s, 10,000 2,149.7 s, identical; eighteen gin-sync takes (all within 2 times idle;
clean every 50 the cheapest, 500.3 s); 3 of 25 restores struck by the backend's exit code 2 and run
again (untimed).

## 12. The verdict actions after the retakes

- Stub `c11987a9d`; RED `35c4c59d0`: `expected 500 to be 10000`, `expected false to be true`
  (incremental), `expected null to be 50`, and the switch registry's nested-restore list.
- GREEN `17fc4237b` (incremental on), `7915372b0` (`REKEY_BATCH` 10,000; the interrupted re-key's
  test now pages by the override, since 10,000 holds its 1,200 entries in one page), `3ecac9952`
  (`GIN_CLEAN_EVERY_BATCHES` 50).
- **The gate at `3ecac9952` failed**: `Hook timed out in 600000ms` in the 100,000-name gate's
  `beforeAll` (its import), then the runtime-role re-key test timed out behind the still-running
  sync. With `incremental-key-df` on, a 100,000-name first import does not finish in 600 s (about a
  minute off). By C271.4 the change is turned off: RED `05b832733` (the defaults' tests expect it
  off again: 3 failed), GREEN `89a508d75`. The gate then passed three times (62.8, 60.0, 64.1 ms;
  7 passed each) at `89a508d75`.

## 13. Not done, with the reason

- `lists-benchmark --measure`'s extra outputs (lists-phase11 finding 3): the published (h) figures
  came from the scratch tool, no 11D figure needs the tool's own output, and the change is
  measurement tooling only: carried to 11F.
- `lists-import`'s completion: the API serves no member for the `list-import` job's end (a frozen
  contract change): carried to 11F.
- The soak's generator (one driver CPU saturates at 56 requests a second), the write stalls in
  `transactions-write` and `api-writes`, the 0.8% errored watchlist runs, the webhook delivery lag
  and Valkey's command timeouts under overload: investigations, not local fixes: carried to 11F.
- City Lite's 403 (an owner item: the fetcher's client identification), the benchmark containers'
  250 ms health probe (shared test infrastructure, the owner's or 11F's), `stored-name-analysis` and
  `rescreen-prepared-index` (not built; beyond a local fix): carried.

## 14. The Validation (last, on the final tree; alone)

Every call in the foreground through `/tmp/fx/v.sh` (exit code, seconds, the 1-minute load at start and end); Gradle calls under the Gradle lock (lock waits 0.008-0.011 s), e2e, image, benchmark and docker-using infra calls under the e2e lock (lock waits 0.004-0.006 s). A lone coverage shard exits 1 on partial coverage by design (rule 8); its merge is the gate.

| Call | Exit | Seconds | Load |
|---|---|---|---|
| 01-install | 0 | 0 | 0.23->0.23 |
| 01-format | 0 | 116 | 0.23->1.06 |
| 02-typecheck | 0 | 151 | 0.98->5.46 |
| 02-lint-api | 0 | 239 | 3.55->1.53 |
| 02-lint-dash-contracts | 0 | 234 | 0.42->1.18 |
| 02-lint-others | 0 | 358 | 0.25->1.26 |
| 03-fetch | 0 | 1 | 0.76->0.76 |
| 04-variant-groups | 0 | 7 | 0.76->0.80 |
| 05-unit-db | 0 | 183 | 0.73->9.94 |
| 05-unit-watchlist-e2e | 0 | 285 | 8.56->1.19 |
| 05-dash-1 | 1 | 216 | 0.66->6.47 |
| 05-dash-2 | 1 | 233 | 5.04->7.10 |
| 05-dash-merge | 0 | 8 | 6.53->5.68 |
| 05-unit-others | 0 | 196 | 4.07->14.12 |
| 05-unit-js | 0 | 5 | 7.87->7.64 |
| 05-api-1 | 1 | 190 | 5.53->8.04 |
| 05-api-2 | 1 | 220 | 8.04->7.13 |
| 05-api-3 | 1 | 202 | 4.48->8.54 |
| 05-api-4 | 1 | 220 | 8.54->9.04 |
| 05-api-5 | 1 | 208 | 5.04->8.51 |
| 05-api-6 | 1 | 189 | 8.51->7.58 |
| 05-api-7 | 1 | 214 | 5.43->7.02 |
| 05-api-8 | 1 | 178 | 7.02->8.03 |
| 05-api-merge | 1 | 45 | 5.75->3.29 |
| 05-api-3-rerun | 1 | 201 | 1.43->8.06 |
| 05-api-merge-2 | 0 | 45 | 8.06->4.33 |
| 06-benchmark | 0 | 82 | 3.66->2.10 |
| 07-int-db | 0 | 165 | 1.93->19.21 |
| 07-int-graph | 0 | 70 | 17.67->7.13 |
| 07-int-api-1 | 0 | 150 | 6.04->17.01 |
| 07-int-api-2 | 0 | 223 | 15.65->9.25 |
| 07-int-api-3 | 0 | 185 | 8.51->19.86 |
| 08-vision-static | 0 | 2 | 14.36->14.36 |
| 08-vision-1 | 0 | 160 | 13.21->2.29 |
| 08-vision-2 | 0 | 186 | 1.85->2.74 |
| 08-vision-3 | 0 | 317 | 2.32->1.26 |
| 09-security-python | 1 | 4 | 0.98->0.98 |
| 09-security-python-ci | 0 | 3 | 0.83->0.92 |
| 10-1-ui | 0 | 193 | 0.79->2.86 |
| 10-1-flow | 0 | 50 | 1.22->2.15 |
| 10-1-rest | 0 | 127 | 2.15->1.73 |
| 10-2-screenshots | 0 | 72 | 1.59->2.58 |
| 10-3-kover-abi | 0 | 203 | 2.58->2.85 |
| 10-4-unit-assemble | 0 | 18 | 2.62->3.41 |
| 10-5-release | 0 | 18 | 3.21->3.04 |
| 10-6-sdk-assemble | 0 | 15 | 3.04->2.89 |
| 10-7-lint | 0 | 17 | 2.81->3.08 |
| 10-8-device-compile | 0 | 123 | 3.08->9.73 |
| 10-9-release-checks | 0 | 19 | 8.95->6.97 |
| 10-10a-staging | 0 | 15 | 6.97->5.93 |
| 10-10b-consumer | 0 | 15 | 5.93->5.13 |
| 10-11-sdk-nfc | 0 | 27 | 5.13->4.71 |
| 10-11-sdk-face | 0 | 24 | 4.71->4.17 |
| 10-11-sdk-nfc-face | 0 | 26 | 4.17->4.45 |
| 11-cyclonedx | 0 | 9 | 4.45->4.00 |
| 13-openapi | 0 | 24 | 3.68->2.90 |
| 13-workflow-docs | 0 | 2 | 2.90->2.90 |
| 14-flow-mocked | 0 | 142 | 2.67->10.19 |
| 14-stack-down-build | 0 | 33 | 7.93->5.41 |
| 14-stack-up | 1 | 153 | 4.98->2.70 |
| 14-stack-down-2 | 0 | 1 | 0.95->0.95 |
| 14-stack-up-2 | 0 | 101 | 0.95->3.13 |
| 14-shard-1 | 0 | 324 | 2.88->1.99 |
| 14-shard-2 | 0 | 416 | 1.72->3.15 |
| 14-shard-3 | 0 | 329 | 0.75->3.07 |
| 14-shard-4 | 1 | 495 | 2.60->2.81 |
| 14-console-sweep | 0 | 384 | 1.95->3.33 |
| 14-stacktest | 0 | 95 | 3.07->5.14 |
| 14-stack-down-final | 0 | 15 | 5.14->4.68 |
| 16-adr-deployment | 0 | 0 | 1.25->1.25 |
| 16-apps-image-context | 0 | 3 | 1.25->1.25 |
| 16-chart-skeleton | 0 | 8 | 1.25->1.21 |
| 16-check-connected-results | 0 | 0 | 1.21->1.21 |
| 16-ci-workflow | 0 | 19 | 1.21->1.02 |
| 16-code-runner | 0 | 27 | 1.02->1.19 |
| 16-compose | 0 | 33 | 1.09->1.76 |
| 16-flow-headers | 0 | 4 | 1.76->1.78 |
| 16-flow-server | 0 | 1 | 1.78->1.78 |
| 16-gitleaks-config | 0 | 29 | 1.78->1.74 |
| 16-gitleaks-pii | 0 | 14 | 1.74->1.58 |
| 16-images-static | 0 | 1 | 0.40->0.37 |
| 16-images-pins | 0 | 1 | 0.37->0.37 |
| 16-images-override | 0 | 0 | 0.37->0.37 |
| 16-images-api | 0 | 88 | 0.37->1.42 |
| 16-images-dashboard | 0 | 38 | 1.42->1.76 |
| 16-images-flow | 0 | 16 | 1.76->1.74 |
| 16-images-flow-noguidance | 0 | 15 | 1.74->1.57 |
| 16-images-vision | 0 | 30 | 1.57->1.42 |
| 16-images-code-runner | 0 | 15 | 1.42->1.73 |
| 16-install-chart-testing | 0 | 12 | 1.20->1.09 |
| 16-install-common | 0 | 1 | 1.09->1.08 |
| 16-install-cosign | 0 | 9 | 1.08->0.99 |
| 16-install-grype | 0 | 12 | 0.99->0.77 |
| 16-install-helm-unittest | 0 | 12 | 0.77->0.73 |
| 16-install-helm | 0 | 7 | 0.73->0.75 |
| 16-install-kind | 0 | 5 | 0.75->0.69 |
| 16-install-kubeconform | 0 | 1 | 0.69->0.71 |
| 16-install-kubectl | 0 | 15 | 0.71->0.72 |
| 16-install-osv-scanner | 0 | 6 | 0.72->0.74 |
| 16-install-syft | 0 | 10 | 0.74->0.70 |
| 16-install-trivy | 0 | 17 | 0.70->0.70 |
| 16-install-vegeta | 0 | 1 | 0.70->0.70 |
| 16-install-zizmor | 0 | 2 | 0.72->0.72 |
| 16-install-gitleaks | 0 | 11 | 0.85->0.80 |
| 16-load-compose | 0 | 0 | 0.80->0.80 |
| 16-pre-commit-hook | 0 | 16 | 0.80->0.85 |
| 16-refresh-digests | 0 | 0 | 0.85->0.85 |
| 16-release-workflow | 0 | 0 | 0.85->0.85 |
| 16-supply-chain-skeletons | 0 | 1 | 0.85->0.85 |
| 16-supply-chain | 0 | 17 | 0.85->0.89 |
| 16-vision-container | 0 | 32 | 0.89->1.35 |
| 16-chart-chart-checks | 0 | 2 | 1.14->1.13 |
| 16-chart-chart-policy | 0 | 3 | 1.13->1.13 |
| 16-chart-kind | 0 | 1 | 1.13->1.13 |
| 17-workflow-benchmark | 0 | 189 | 1.08->1.98 |
| 17-analytics-teardown | 0 | 5 | 1.43->1.39 |
| 17-analytics-seed-1 | 0 | 448 | 1.39->1.48 |
| 17-analytics-seed-2 | 0 | 435 | 1.06->2.62 |
| 17-analytics-seed-3 | 0 | 493 | 2.49->1.54 |
| 17-analytics-seed-4 | 0 | 306 | 1.54->1.89 |
| 17-analytics-measure | 0 | 496 | 1.75->1.99 |
| 17-analytics-teardown-end | 0 | 6 | 1.83->1.85 |
| 18-load-gate | 0 | 10 | 1.44->1.29 |
| 19-sc-osv | 1 | 3 | 1.27->1.25 |
| 19-sc-pnpm-audit | 1 | 40 | 1.25->1.08 |
| 19-sc-pip-audit | 0 | 4 | 1.08->0.99 |
| 19-sc-zizmor | 0 | 0 | 0.99->0.99 |
| 19-sc-osv-final | 0 | 3 | 0.58->0.53 |
| 19-sc-pnpm-audit-final | 0 | 34 | 0.53->0.82 |
| 19-sc-trivy-config-final | 0 | 5 | 0.82->1.56 |
| 19-sc-chart-final | 0 | 21 | 1.56->1.47 |
| 19-sc-pii-final | 1 | 13 | 1.47->2.18 |
| 19-sc-allowlist-final | 0 | 0 | 2.18->2.18 |
| 16-supply-chain-rerun | 0 | 13 | 2.18->1.92 |
| 19-sc-pii-final2 | 0 | 6 | 1.02->1.90 |
| 16-gitleaks-pii-rerun | 0 | 11 | 1.90->2.00 |
| 09-security-python-rerun | 0 | 3 | 2.00->1.92 |
| 20-chart-lint | 0 | 2 | 1.77->1.77 |
| 20-chart-unittest | 0 | 8 | 1.77->1.65 |
| 20-chart-kubeconform | 0 | 3 | 1.65->1.65 |
| 20-chart-trivy | 0 | 5 | 1.65->1.60 |
| 21-gitleaks-history | 0 | 10 | 1.54->2.38 |
| 21-pii-tree | 0 | 5 | 2.38->3.15 |
| 21-pii-history | 0 | 10 | 3.15->2.89 |
| 01-format-final | 0 | 120 | 2.45->1.78 |
| 02-lint-match-test | 0 | 15 | 1.78->1.61 |

Images (each its own call under the e2e lock): api 366 s `sha256:2188842f…`, dashboard 258 s `sha256:f09edfe9…`, flow 52 s `sha256:bc423198…`, flow-noguidance 45 s `sha256:bced8a72…`, code-runner 67 s `sha256:cf69719c…`, vision 4 s (cached) `sha256:a6fd601f…`.

Counts: db 2,392; watchlist 840; e2e 155; dashboard 7,235 in 622 files at 95.62%; the 13 other packages (core 2,008, checks 3,857, contracts 4,905, workflow-engine 2,042, flow 1,678, node 508, flow-spec 527, config 448, emrtd 338, signals 192, ui 58, react 55, demo-web 18); js 19; **API 10,963 in 868 files at 93.42%** (statements; the first merge failed on `match.test.ts`, which pinned the cap 2,000: fixed `0d76a0b34`, shard 3 re-run into a fresh blob set with the other seven copied, merged again: exit 0); benchmark 133; integration db 110, graph 13 (template 32.7 s), api 121 + 139 + 196 = 456; vision 904 + 827 + 957 = 2,688 at 97.45%; security/python 196 (CI's exact paths; the first call ran ruff over the whole repository by mistake and is listed); SDK host tests 532 + 427 + 1,773 = 2,732 (`--rerun`), none skipped; demo 106 (97 + 9), nfc 116, face 51; screenshots, Kover, ABI, device-test compile, release checks (98 tests; ELF alignment, consumer rules, size), staging and consumer check, the three artifact combinations; cyclonedxBom 188, 195, 190; openapi and workflow docs no diff; e2e: mocked 349; the first stack start stopped on Next.js's own security notice during `next build` (a vendor advisory print; no dependency changed: rule 3), the stack was taken down and started again (101 s); shards 50, 52, 47 passed and **shard 4: 48 passed, 1 failed** (`tests/ui-reviewer.spec.ts:202`, "Sign-in answered 503 … login_unavailable" at `support/platform.ts:121`, load 2.60→2.81: the login limiter's Valkey store timed out and it failed closed, as C246 designs; the API log shows "rate limit store unavailable" 14 times through the run; the class of KP11-33, 11F's; not retried, rule 6); console sweep 109; stackTest 3 of 3; infra 34 scripts and the chart's 3 contracts, 2,998 checks, 13 skipped (supply-chain-skeletons'), ci-workflow 527; workflow benchmark effectful 10/45/40 and control-flow 85/196/200 steps a second at 1/8/32 clients (reported); **KP11-7**: `analytics:benchmark --teardown`, `--seed` in four calls (448, 435, 493, 306 s; 20 batches), `--measure` (496 s: build of 365 days 437.7 s, the 5-minute refresh 1.9 s, after midnight 34.1 s; reads over 90 days 8 to 59 ms and over 400 days 17 to 508 ms, loads 1.75→1.99), `--teardown`; load/'s gate 242 passed at 96.62%; supply-chain.sh: osv and pnpm-audit first failed on **GHSA-fc5q-39xc-vjpf** (picomatch 4.0.7, high, no fixed release, devDependencies only): a reviewed allowlist entry (`4ac362321`), then osv 0 failing (6 allowlisted, `load/uv.lock`'s 21 packages scanned), pnpm-audit 0 failing, pip-audit 0 findings, zizmor 0 failing (offline), trivy-config 0 failing, chart pass; **pii** first failed on 93 matches in the gitignored raw takes under `load/results/` (query ids against the card pattern): test-first `3423d7bef`/`beec7bcc8`, then 0 kept of 1,205; allowlist pass; chart-checks lint, unittest, kubeconform, trivy pass; gitleaks over 7,785 commits no leaks; the PII filter 0 kept over the tree (1,205) and history (1,641).

Skipped, with the reason: the clean-build pass 9b (no lockfile or verification metadata changed in `d44e537db..HEAD`); WebKit's theme-csp (apps/flow unchanged); kind (neither `deploy/helm/` nor a Dockerfile changed); the device suites (nothing under `android/` changed). After the commits that followed a step (`match.test.ts`, the allowlist, the PII config and its test), the affected calls ran again: API shard 3 and its merge, `supply-chain.test.sh`, `gitleaks-pii.test.sh`, security/python, the osv, pnpm-audit and pii steps, `format:check`, and the ESLint of the changed test file.
