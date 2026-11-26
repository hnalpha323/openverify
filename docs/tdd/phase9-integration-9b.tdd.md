# Phase 9, Workflow 9B Stage 4: integration-9b

The first of Stage 4's three agents (PARALLEL RULES, 2026-11-06), after every Stage 1-3 agent, with `docs-9b` beside it. Base: `67445a8c` (api-flow-expiry's record). Every command ran after `source scripts/env.sh`. Times carry the load (`/proc/loadavg`) beside them.

## Slices (each RED committed, seen failing for the intended reason, then GREEN)

Iterating runs: `pnpm exec vitest run <files> --coverage.enabled=false --maxWorkers=2` in the package.

| Slice | Deviation settled | RED (commit: what failed) | GREEN (commit: result) |
|---|---|---|---|
| S1 | api-access: the server `GET /user-audit-logs` answered the explorer filters unfiltered (fail open) | `241e4cdd`: 3 failed (every entry listed; 200 where 403) | `4d0fd563`: 32 passed |
| S2 | api-exports: `transactionListFilters` got no blind-index key | `6a7e42dd`: 501 where 200 | `471a6831`: 12 passed |
| S3 | api-flow-expiry 1 / B44: link creation ignored the inquiry's window | `6fad7ae7`: link lived 3,600 s, not 900 | `efa1074d`: 25 passed |
| S4 | foundation U5: the template promote read only the session's rights | `5cc72469`: 201 where 403 | `433db78e`: 20 + 32 passed |
| S5 | api-themes: the promote's theme copy read the source's `theme-sets:write` | `7cb44855`: 201 where 422 | `600cd219`: 25 passed |
| S6 | api-themes 1: no vision client in `ApiDependencies` | `2c9402ce`: 42 keys copied, 43 expected | `44937cc0`: 30 passed |
| S7 | api-access: the audit IP index key not wired in the processes | `f240d22e`: 2 failed (not called) | `735cf39a`: 5 passed |
| S8 | api-flow-carry 2: the v2 phone never showed the served consent | `47a17a4e`: `waiting` where `consent` | `4b4d921c`: 255 passed |
| S9 | api-flow-carry 1: the renderer never reported the links | `caed6205`: no "Get help" link | `e2a11b8b`: 349 passed |
| S10 | api-themes 2: no asset loader, no logo in the header | stub `101a19f8`; RED `bd423683`: 4 failed | `b1f1a681`: 542 passed; regressions fixed in `519f5f8f` |
| S11 | api-cases-reports: the job ran an async expansion at the template's hops | `c4915baa`: account c reached; index complete | `fa11ec88`: 22 passed |
| S12 | api-cases-reports: a rerun of an expansion bound absent parameters | `8dee5c97`: 422 `graph_parameter_missing` | `1a4c3da5` (+ type fix `b4f0d147`): 50 passed |
| S13 | api-cases-reports: no GET of the checklist state | `35305e4a`: 404, no route | `b7272eb8`: 19 passed |
| S14 | Stage 2-3 route-schema requests: built routes still offered 501 | `b2411a76`: 53 failed | `80ed770f`: 183 passed; OpenAPI regenerated |
| S15 | api-access: an organisation setting audited in one environment | `281c30b6`: `[]` in production | `a086e092`: 27 passed |
| S16 | api-keys-webhooks: `mail-sender-name` accepted a bidi override and `=?` | `47ce169c`: accepted | `4d384520`: 4,382 passed; OpenAPI regenerated |
| CI | three API shards, Firefox and WebKit for the theme CSP spec | `5178422c`: 7 FAIL in `ci-workflow.test.sh` | `c0d0c66b`: exit 0 |
| Floor | SDK host-test floor 1,366 | `66bc2254`: the 1,365 scenario passed | `6eeb8c40`: exit 0 |

The full-stack specs (`322aefba`) are acceptance specs of built behaviour: their first run on a fresh stack (load 1.3 to 2.9) failed twice on the spec's own reading (the funnel answer's `totals` has no `counts`; the export CSV quotes every cell), fixed in the spec, then passed: theme-sets 19 ms and 1.6 s, analytics 0.8 s, exports 2.3 s, bulk-reports 0.7 s, environment-roles 1.5 s, api-key-rotation 0.2 s, webhook-failure-alert 55.2 s, and flow-branching's four tests with their simulate replay 3.8, 4.8, 4.2 and 8.5 s. The stack's logs held no "not built yet" line.

Defects my own changes caused and fixed: `1a4c3da5` broke the API typecheck (found by the forced typecheck, fixed in `b4f0d147`); `471a6831` left one existing hook test expecting no key (fixed in `80ed770f`); `b1f1a681` broke two flow test files (found by the flow test script, fixed in `519f5f8f`); two test files and the e2e support needed lint fixes (`d39b969c`, `c820bab8`).

## Final gates (each read from its own exit code)

| Gate | Exit | Result | Time, load |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | | load 0.1 |
| `pnpm format:check` | 0 | | |
| `pnpm turbo run typecheck --force --filter='...[98f448bd]'` (slot 0) | 0 | 16 of 16 (first attempt exit 2 on my `queries.ts`, fixed) | 152 s, load 1.7-4.4 |
| lint, CI form, `--filter=@openverify/api` | 0 | (first attempt exit 1 on two of my test files, fixed) | 201 s, load 1.9 |
| lint, CI form, `--filter=[98f448bd] --filter=!@openverify/api` | 0 | 8 of 8 (first attempt exit 1 on my e2e support, fixed) | 466 s, load 1.8 |
| flow lint + typecheck again after `519f5f8f` | 0 | 2 of 2 | 98 s, load 2.4 |
| API unit: 8 blob shards + merge | merge 0 | 686 files, 9,372 tests, 94.36% statements, 84.98% branches | shards 262, 289, 296, 259, 194, 176, 178, 167 s; merge 37 s; load 5.2-8.9 |
| db + e2e test scripts | 0 | db 2,172 tests 91.07%; e2e 125 | 195 s, load 8.7 |
| dashboard test script | 0 | 5,595 tests, 96.38% | 356 s, load 6.9-8.6 |
| flow, checks, contracts, core, ui test scripts | flow 0 on the re-run | flow 1,508 (95.11%), checks 3,826, contracts 4,382, core 1,650, ui 54 | 160 s and 114 s, load 7.3-10.7 |
| db integration | 0 | 78 | 120 s, load 18.0 |
| graph integration | 0 | 13; template 225,000 rows built in 21.3 s of 180 s | 42 s, load 11.8 |
| api integration 1/3, 2/3, 3/3 | 0, 0, 0 | 89, 99, 79 | 93, 205, 124 s, load 7.4-15.9 |
| `openapi:write` twice | 0, 0 | sha256 `761c243b8431b3f407517dee0ed0e8170dd682d7987dc570fae1442e1efbb72e` both times | |
| `infra/tests/ci-workflow.test.sh`, `compose.test.sh --static-only`, `flow-headers.test.sh --static-only` | 0, 0, 0 | | |
| Android `:openverify-sdk:testAndroidHostTest` | 0 | 1,366 host tests, 0 skipped (CI floor now 1,366) | 16 s (up to date), load 5.4 |
| Android `testDebugUnitTest koverVerify` | 0 | | 12 s, load 4.8 |
| Android `assembleDebug :openverify-sdk:assemble lint` | 0 | | 14 s, load 4.7 |
| mocked flow suite | 0 | 163 passed (Chromium; the firefox and webkit projects skipped, not installed) | 69 s, load 2.2-9.0 |
| e2e build + `e2e:stack:up` | 0, 0 | | 101 s, load 4.6 |
| full stack shard 1/3, 2/3, 3/3 | 0, 0, 0 | 53, 51, 50 passed (154) | 277, 384, 354 s, load 2.1-4.7 |
| `e2e:stack:down` | 0 | | |

The API unit suite did not fit two shards (shard 1 of 2 reached the 600 s cap at a load of 7.8), nor four (shard 2 of 4 reached it; shard 1 of 4 took 553 s): N was doubled each time in a fresh directory, as rule 8 says, and the 8-shard merge is the gate.
