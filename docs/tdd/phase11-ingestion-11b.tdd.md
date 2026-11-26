# Phase 11, Workflow 11B Stage 2: ingestion-11b (family D)

TDD evidence of `ingestion-11b`: C252 (operator-supplied patterns: the run-time pattern lint rule,
the two entry points outside C148.3's matcher, the catastrophic-pattern tests), K7C-R009 (one Ajv
per process), the parser-backed page count of transaction PDFs (the owner decisions after Workflow
7B, "Later phases"), C254.1 (the UN list's opt-in, built locked) and C254.2 (conditional requests
with the forced full check). Commands are run from the repository root after `source scripts/env.sh`
unless a `cd` is shown; every timing has `cat /proc/loadavg` beside it. Commits are path-scoped
(rule 4); none is pushed.

## 1. C252.2: the run-time pattern lint rule

Inventory (contracts-11b's 2.8, re-run as a lint): the selectors below, applied with no allowlist
to every tracked source file that names `RegExp`, found 133 sites in 123 files: two operator
entry points (`packages/flow-spec/src/flow.ts:71`, `apps/dashboard/src/components/workflows/editor/document-model.ts:441`),
27 shipped files that build patterns from constants, and test, e2e and script files.

- Stub `fb1d7eb5e` (`packages/config/eslint/operator-patterns.js` with empty lists).
- RED `9c26717e1`: `pnpm exec vitest run src/eslint-operator-patterns.test.ts --coverage.enabled=false`
  (from `packages/config`; load 2.11): `Tests 12 failed | 12 passed (24)`: the rule is no part of
  `phase5Config()`, no line of the lint fixture is refused, the allowlist has no reason.
- GREEN `9ff92c260` (after the two entry points below): `Tests 24 passed`, config 360 of 360
  (load 5.69). The existing `eslint-phase5.test.ts` case "is part of the root ESLint configuration
  for exactly the Phase 5 folders" failed on a first GREEN that gave the Phase 5 folders a second
  block with the same array; the pattern block now takes a copy (`[...PHASE5_FOLDERS]`), so the
  Phase 5 block stays the one entry for them and that test is unchanged.
- Proof under the real root config: a probe file `packages/core/src/zz-c252-probe.ts` holding
  `new RegExp(s)` was refused by `pnpm exec eslint` with the C252 message (exit 1), then deleted.

## 2. C252.1: the two entry points outside C148.3

### A flow-spec 1 text field's `validation.pattern` (`packages/flow-spec/src/flow.ts`)

- Stub `33706f5d9` (`v1FieldPatternProblems` answering none).
- RED `9b11d957f`: `pnpm exec vitest run src/operator-patterns.test.ts` (from
  `packages/flow-spec`; load 6.17): `Tests 8 failed | 6 passed (14)`: the catastrophic `(a+)+$`
  and C148.3's reasons (`syntax`, `backreference`, `lookaround`, `named_group`,
  `quantifier_too_large`) not refused at write; a stored `([a-z` refused by the schema.
- GREEN `348d53125`: 14 of 14; flow-spec 525 of 525 (load 8.70). `flow.test.ts`' row "an invalid
  regular expression" (the native syntax check) became "a pattern past 500 characters" (rule 12:
  the plan moves the check to write time).
- `b234929c8` (held, no RED possible: built behaviour): the catastrophic pattern refused by the v2
  publish rule within 50 ms of CPU, and noted `pattern_refused` by the v2 migration.

### The workflow editor's step rename (`document-model.ts:441`)

- Stub `9406aa7ff`; RED `abd149925` (load 7.94): `Tests 9 failed | 10 passed (19)`.
- GREEN `3e2da48de`: 19 of 19; the editor folder 161 of 161 (load 6.38).

### The API's entry points (`apps/api/src/operator-patterns.test.ts`, `b1c8b36c7`)

Held, 9 of 9 at first run (built behaviour): the screen submission fails closed on the
catastrophic pattern and matches ambiguous accepted patterns over the capped input within 50 ms of
CPU; a transaction `json` schema's `pattern`, `patternProperties` and `format` are refused before
ajv; a v1 form field's pattern is refused at template creation (no v1 `form` step is a supported
template step).

## 3. K7C-R009: one Ajv per process

- Stub `1b5d2d580`; RED `10809b506` (load 12.28): `Tests 3 failed | 2 passed (5)`: two publishes
  compile one schema twice (`expected +0 to be 1`), the cache bound not observed.
- GREEN `a5c75cbdf`: 5 of 5; `src/services/transactions/` and `src/routes/server/transaction*`
  73 of 73 (load 9.76).

## 4. The parser-backed page count of transaction PDFs

### Vision: `POST /v1/count/document-pages`

- Stub `b6984a6a3` (the route answering 501, included with its own 20 MB body limit).
- RED `8e32f8963`: `uv run pytest tests/test_page_count.py -q --no-cov` (load 6.63):
  `20 failed, 2 passed`: every route case answers 501 "this analysis is not built yet".
- GREEN `8f1b88b77`: `UPDATE_CONTRACT_FIXTURES=1 uv run pytest tests/test_page_count.py` wrote
  `contracts/fixtures/vision/pdf-page-count.json` (then Prettier); 22 passed; with
  `tests/test_contract_fixtures.py` 59 passed (the fixture joined `MODELS` and `build_fixtures`).
  `uv run ruff check`, `ruff format --check`, `mypy src tools`: clean.

### The API

- Stubs `5f5b0a11a` (`VisionPageCounter`, the client method, `pageCountSchema`,
  `ApiDependencies.vision`, `services/transactions/page-count.ts`).
- RED `77bda0c96` (load 16.64): `Tests 25 failed | 18 passed (43)` over
  `src/vision/page-count.test.ts`, `src/services/transactions/page-count.test.ts` and
  `src/services/transactions/files.test.ts`.
- GREEN `b80ffbc19`: 43 of 43; `src/vision/` and `src/services/transactions/` 240 of 240
  (load 16.97).

## 5. C254.1: the UN list's opt-in, locked

- `c8e194bad`: `EnvironmentSettings['watchlist-un-opt-in']` (borrowed edit of `tenancy.ts`).
- Stub `849538cb0`; RED `76b4dda47` (load 15.23): `Tests 8 failed | 3 passed (11)`.
- GREEN `c8be8cc22`: 11 of 11.
- The reconcile (borrowed edit of `reconcile.ts`): stub `c8e9ce9cc` (the optional
  `optInSources`), RED `f62316278` (1 of 4 fails: an accepted opt-in source is not enabled),
  GREEN `db5715a77`: 8 of 8 with
  `reconcile.test.ts`; `pnpm --filter @openverify/watchlist benchmark:typecheck` exit 0 (load
  14.93) and `benchmark:test` 119 passed (rule 16).

## 6. C254.2: conditional requests (built before foundation-11b's (D) checkpoint)

- The stream client and a 304 (borrowed edit of `apps/api/src/http/stream.ts`): RED `4279928d7`
  (load 10.08): `Tests 2 failed | 2 passed (4)`: a 304 was refused as a redirect
  (`OutboundHttpError ... (blocked)`). GREEN `1a0504630`: 4 of 4; `src/http/` 92 of 92. The one
  redirect still keeps its port and carries no validator to the storage host.
- The conditional sources: RED `3e5c363ba` (1 of 2: no source opts in), GREEN `97834386d`
  (`watchlists/sources.json`: `uk-sanctions-list` only; reasons in
  `apps/api/src/watchlists/conditional-sources.test.ts`, from `docs/research/phase6-data-sources.md`
  sections 1.1, 2.3, 3 and 4.2); the watchlist unit tests 105 of 105.
- The check plan (`conditional-policy.ts`): stub `0149a5cfb`, RED `ebb83805d` (11 of 18 fail),
  GREEN `9bd9d526e` (18 of 18).
- The sources page (borrowed edit of the view
  `apps/dashboard/src/components/report-config/watchlist-sources-view.tsx`): RED `be880f07e`
  (load 3.08): `Tests 2 failed | 10 passed (12)` (no "Last validation (UTC)" column; the RSC
  payload without the times). GREEN `99473fab4`: the page and report-config tests 113 of 113.

### After the restart (the first run was cut off at 14:06 EST with no uncommitted file)

Foundation-11b's (D) GREEN (`747da78dc`) committed the hook in `sync.ts` (one call of
`checkSourceConditionally` under the session lock, before a publisher's download, its `not-modified`
recorded as `unchanged`), `download.ts`' optional request headers and migration 0036's
`last_validated_at`, `validated_by`, `last_full_check_at`, `last_etag` and `last_modified`. The hook
has no step after the download, so the validator step makes the check's one request itself (see
the contract deviation): a 304 or a SHA-256 equal to the applied one answers `not-modified`;
another file answers `download` and the sync fetches it again.

- `8d5fa75c2`: `conditional-policy.test.ts`' case table typed: the API typecheck (`tsc --noEmit`,
  560 s at load 26.32 / 17.76, heavy slot) had found `TS2345` at `:106`, a RED commit of mine that
  typechecked under vitest only. After the change: exit 0.
- Stub `3422880a4` (`conditional-records.ts`: the check columns, the install window, what the page
  serves), RED `5f6197762`: `pnpm exec vitest run src/watchlists/conditional.test.ts` (from
  `apps/api`; load 27.94): `Tests 14 failed | 2 passed (16)` (no request of its own, no record, the
  window 24 not 2, nothing served).
- The sources route (borrowed edit of `routes/dashboard/watchlist-sources.ts`): RED `cd8a04990`
  (load 29.16): `Tests 1 failed | 7 passed (8)` (no `conditional`, `last-validated-at`,
  `validated-by`, `last-full-check-at`). GREEN `474b45ad1` with the records module: the route 8 of 8 and
  `report-routes.test.ts`; `conditional.test.ts` 15 of 24 with the route (the step's 9 wait for
  checkpoint (D)).
- The Testcontainers conditional sync (`conditional.integration.test.ts`), RED `5459ba818`: from `apps/api`,
  `bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts
  --project api src/watchlists/conditional.integration.test.ts` (170 s with the container, load
  21.93 / 19.53; the first try exited 75, no slot): `Tests 1 failed (1)`: the first sync made one
  request (the stub makes none of its own).

- After foundation-11b's checkpoint (D) (`6b02a240d`, recorded `d20a7caa2`): GREEN `2e344a6f7`
  (`conditional.ts`; `foundation-11b-d.test.ts` loses ingestion-11b's stub case, as its header
  asks): from `apps/api`, `pnpm exec vitest run src/watchlists/ src/foundation-11b-d.test.ts
  src/routes/dashboard/watchlist-sources.test.ts` (load 24.07 / 24.89): every case of mine passed
  (`conditional.test.ts` 16 of 16); the two failures were dsar-export's stub cases, whose code its
  owner was building in the tree. The Testcontainers conditional sync: `Tests 1 passed (1)` in 88 s
  (heavy slot, load 22.20 / 17.44). Rule 16: `pnpm --filter @openverify/watchlist
  benchmark:typecheck` exit 0 (306 s, load 20.26) and `benchmark:test` 119 passed (62 s, load
  24.43).

## 6b. C254.1: the opt-in routes (after (D))

- RED `2268d9beb` (`routes/dashboard/watchlist-opt-in.test.ts`, load 26.37): `Tests 1 failed |
  1 passed (2)`: the frozen route answered 501 where the locked switch answers 409.
- GREEN `65df0e110` (the frozen `watchlist-opt-in.ts` built over `un-opt-in.ts`; the switch read
  from the route context's optional `watchlistUnOptInAllowed`, which no caller passes today, so it
  is false; the schemas and the OpenAPI document unchanged; `foundation-11b-d.test.ts` loses the
  frozen 501 case): the route 2 of 2, `un-opt-in.test.ts` 11 of 11, `openapi.test.ts` green (the
  four failures in that call were dsar-export's 501 cases of its export routes, built in the tree).

## 7. Rule 6: the CPU budgets

foundation-11b's common gate (12 API shards and a merge at load 8 to 17) counted one failure of
`apps/api/src/operator-patterns.test.ts`, which passed alone with and without coverage (9 of 9). Its
only load-dependent part is the CPU budget, so each budget in my three test files is now the least
of three runs (as `cpuRatio` takes the least of its rounds): `b5a5ba2e4`.

## 7b. Rule 6: the tree scan of the C252.2 rule

The final config gate (`vitest run --coverage`, load 21.00 / 23.72) timed out the case "holds the
shipped code of the tree to the rule" at its 60 s guard (67.8 s): it parsed all 163 files that name
`RegExp`. Alone it took 30.1 s at load 18.60. `13167aba9` parses only shipped candidates (a call or
`new` of `RegExp`, outside the exempt groups whose exemption the fixture cases hold): 5.07 s alone
at load 24.09. A probe file `packages/core/src/zz-c252-probe.ts` holding `new RegExp(s)` still failed
it (`packages/core/src/zz-c252-probe.ts:1 C252: ...`), then was deleted. Config: 360 of 360 at
97.22% (53 s, load 27.64 / 29.47), lint and typecheck exit 0.

## 8. Gates run so far (rule 24)

| Call | Result | Time | Load before / after |
| --- | --- | --- | --- |
| `packages/config`: vitest with coverage | 360 passed, 97.22% statements | 18 s | 3.91 |
| `packages/config`: tsc, eslint | exit 0, exit 0 | | |
| `packages/flow-spec`: vitest with coverage | 527 passed, 96.46% statements | 7 s | 3.37 |
| `packages/flow-spec`: tsc, eslint | exit 0, exit 0 | | |
| vision first half (54 files, `--cov-fail-under=0`), heavy slot | 1,262 passed | 349 s | 15.37 / 14.95 |
| vision second half (55 files, `--cov-append`), heavy slot | 1,401 passed, 97.42% | 545 s | 13.83 / 4.94 |
| forced lint, the other 14 packages, heavy slot | 14 of 14 | 426 s | 3.32 / 3.55 |
| forced lint, dashboard and contracts, heavy slot | 2 of 2 | 267 s | 3.34 / 4.23 |
| forced lint, api, heavy slot | exit 1: `no-meaningless-void-operator` in foundation-11b's stubs `http/hsts.ts`, `http/internal-listener.ts`, `worker-health/drain.ts`, `worker-health/heartbeat.ts` (platform-ops'); none in my paths | 469 s | 4.13 / 16.59 |

## 9. Final gates (rule 24; beside the other Stage 2 agents, 2026-11-13 to 11-14)

Each heavy call through `/tmp/openverify-heavy.sh` (slots 1-3); an exit 75 (no slot in 150 s) was
run again and is not listed. The load stayed between 12 and 52 throughout.

| Call | Result | Time | Load before / after |
| --- | --- | --- | --- |
| `apps/api`: `pnpm run typecheck` | exit 0 | 390 s | 19.47 / 13.93 |
| `apps/api`: `pnpm run lint` (4 GB heap) | exit 0 | 1,401 s (past one call's cap: the call went on in the background and was waited for; one package, no smaller split) | 24.09 / 17.16 |
| `apps/api` unit, 12 blob shards | abandoned: shard 3 ran 918 s, so K was doubled in a fresh directory (rule 8) | | |
| `apps/api` unit, 24 blob shards | each exit 1 alone (partial coverage, as rule 8 says); 192-675 s each (shards 6 and 7 at 606 and 675 s, with the slot wait, at load 30-43) | | 22.50-51.54 |
| `apps/api` merge of 24 | exit 1: 10,778 passed, 6 failed, 93.87% statements; every failure in another agent's path (below) | 319 s | 27.55 / 21.43 |
| `src/services/graph/synthetic.test.ts` alone | 3 of 3 | | 23.66 / 25.68 |
| `apps/dashboard`: typecheck | exit 0 | 186 s | 29.21 / 21.10 |
| `apps/dashboard` unit, 2 blob shards and the merge | exit 0: 7,092 passed in 619 files, 95.65% | 425 s, 644 s, merge 20 s | 21.47-28.32 |
| `packages/config`: test with coverage, lint, typecheck | exit 0: 360 passed, 97.22% | 53 s | 27.64 / 29.47 |
| `packages/flow-spec`: test with coverage, lint, typecheck | exit 0: 527 passed, 96.46% | | 27.43 / 26.55 |
| forced lint, dashboard and contracts | 2 of 2 | 511 s | 21.17 / 13.09 |
| forced lint, the other 14 packages | 14 of 14 | 952 s (past the cap; waited for) | 13.23 / 20.98 |
| integration api 1/3, 2/3, 3/3 | 115, 133, 193 passed | 190, 330, 234 s | 20.46-36.82 |
| integration graph | 13 passed | 151 s | 24.54 / 11.88 |
| integration db | 110 passed | 298 s | 11.81 / 31.09 |
| `pnpm format:check` | exit 0 | 353 s | 29.16 / 27.51 |
| `benchmark:typecheck`, `benchmark:test` (rule 16) | exit 0; 119 passed | 306 s, 62 s | 20.26, 24.43 |
| vision (two pytest halves) | unchanged since `8f1b88b77`; the run of section 8 stands | | |

The API merge's six failures, none in my paths: `src/foundation-11b-d.test.ts`' four frozen-501
cases of the access export routes (dsar-export's routes answered as built in the tree: the owner
removes its cases), `src/routes/dashboard/foundation-11b-a.test.ts`' frozen-501 case of
end-sessions (auth-sessions', built: 200 `sessions-ended`), and
`src/services/graph/synthetic.test.ts` "writes the rows of the sequential build" at its 60 s guard
under load 35 (Workflow 7B's; 3 of 3 alone). Every test of mine passed in the merge.
