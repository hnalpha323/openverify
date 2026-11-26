# Phase 11, Workflow 11B Stage 3: integration-11b (TDD evidence)

Agent: integration-11b, alone and last (Workflow 11B Stage 3). Base `cdff9dac8`, start `9e1cb5e9e`;
this run started at `e34233202` (2026-11-14 01:18 EST, load 0.95), after the owner's PC restarted
during Stage 2. No integration-11b commit, file or scratch state existed before this run, so
nothing was salvaged or redone; every Stage 2 agent's commits were kept as they stand.

Every timing has `cat /proc/loadavg` beside it. Commands ran after `source scripts/env.sh`.

## 0. Starting point

- `git log` at start: `e34233202` (quotas' last TDD commit); `git status --porcelain`: only the
  owner's untracked `31-Oct-openverify-session-state.txt`.
- CI first step (rules 18 and 25): contracts-11b read `gh run list` at its start; the three newest
  runs started no step and no completed run had a failed job. Nothing to fix first, and no run is
  read again or waited for.

## 1. Stage 2 wiring and KP11-12 (quotas' blocker, dsar-export's and quotas' deviations)

Stubs `74b26dfe6` (installQueueLimitsOf answering 50, `StartWorkersOptions.quotas` and
`AccountExportAdmissionDeps.queueInFlightCapMax` ignored), so the tests typecheck
(`tsc --noEmit -p apps/api` exit 0, 96 s, load 0.08).

RED `11eddbf95`:
```
pnpm exec vitest run src/services/connect/redeem-admission.test.ts src/worker-quotas.test.ts src/services/account-export/admission.test.ts --coverage.enabled=false
     × holds the export again (no stamp) when the enqueue fails, for the quota sweep
     × holds an export at the environment cap: pending, unstamped, not enqueued (C251.1)
     × holds a redemption at the cap, the sweep admits it when a slot frees, and recovery leaves it alone
     × schedules the sweep every 15 s, and the recovery every 60 s once a queue recovers lost work
     × reads the ceiling and the workflow-step default from the configuration
AssertionError: expected undefined to deeply equal { every: 15000 }
AssertionError: expected { ceiling: 50 } to deeply equal { ceiling: 7, workflowDefault: 30 }
AssertionError: expected [ { …(2) }, { …(2) } ] to deeply equal [ { …(2) } ]   (x2)
      Tests  5 failed | 3 passed (8)        load 1.05
```
GREEN `144a7a1d0`. The first GREEN used `admitEnvironment` in `enqueueRedemption`; it failed three
existing workflow-action tests whose fake ports redeem made-up token ids (no row to admit), so the
redemption goes through `admitOnProduce` instead (a row it cannot see is enqueued as before, an
admitted one is enqueued again under its own job id, a held one at the cap is not). Then:
```
vitest run src/services/connect/ src/workflows/actions/connect/ src/routes/flow/share-consents ... -> Test Files 22 passed, Tests 263 passed
vitest run src/worker-quotas.test.ts src/services/account-export/ src/routes/server/account-exports src/worker -> Tests 233 passed
tsc --noEmit -p apps/api: exit 0 (99 s)
```
Dispatcher ceiling (amendment 17): RED `17175ef6d` (`expected 2 to be 1`), GREEN `abc039f52`
(engine, adapters, runs and triggers: Test Files 26 passed, Tests 367 passed).

## 2. KP11-11: GET /rate-limits lists the Connect buckets

Stub `a6243599d` (`RateLimiter.peek?` optional; the production limiter rejects "not built yet").
RED `e95b7a6d9`:
```
vitest run src/routes/server/rate-limits.test.ts src/rate-limit/index.test.ts
     × lists the API key's two Connect buckets for its environment, peeked, beside api
     × keys a user session's buckets by its session and environment, never the user alone
AssertionError: expected [ 'api' ] to deeply equal [ 'api', 'connect-redeem', …(1) ]
      Tests  2 failed | 37 passed (39)
vitest --config vitest.integration.config.ts --project api src/rate-limit/peek.integration.test.ts (Valkey 9.1)
     × (3 of 3) Error: peek is not built yet (integration-11b)          load 1.54
```
GREEN `0a3130912`: route and limiter 57 of 57; Valkey 3 of 3 (load 1.12); openapi:write 23 s (the
route's description only).

## 3. The 11B route schemas, the OpenAPI snapshot and `@openverify/node`

RED `63cc2d3d6` (`src/openapi-11b.test.ts`): 16 of 17 fail (fifteen 11B operations still document
the frozen 501; the SSO removal documents no 204, the opt-in no 422, the withdrawal no 409).
GREEN `179efa14a`: the 501s dropped, the 204, 422 and 409 documented, `openapi:write` (8 insertions,
109 deletions); route suites 82 of 82. The typecheck of that GREEN and of `0a3130912` failed
(`reply.code(204).send()` and the rate-limit resource's name type) and was fixed by `92918321e`
(tsc exit 0, 99 s; the GREEN commits had run vitest only, which does not typecheck).

Node: RED `5d82459fb` (`account-exports.test.ts` 4 of 4 and the resource groups test fail: not
built); GREEN `8847f0200` (`client.accountExports`, its types and README section); node 508 of 508,
tsc exit 0.

## 4. C255.2-C255.4 verification tests (apps/dashboard/src/security/)

`035815ac6`: `console-csp.test.ts` (123 tests: every page and route handler under `src/app` reaches
the proxy except the case attachment upload, and answers the enforced CSP whose script-src is the
nonce with `'strict-dynamic'`, without `'unsafe-inline'`, `'unsafe-eval'` or `'unsafe-hashes'`) and
`origin-checks.test.ts` (7 tests: every handler and method classified; the four state-changing POSTs
answer 403 to a foreign origin and to `Origin: null` with `Sec-Fetch-Site: cross-site`; the CSP report
sink the one exemption; the server-action modules found; `next.config.ts` never sets
`allowedOrigins`). Both passed on the tree as written: no missing check was found, so no fix was
needed. Next.js's own server-action check is proved on the stack by `e2e/tests/hardening-11b.spec.ts`
(own origin: 409 "Server Action unavailable." for an unknown id; foreign origin: 500, refused before
the lookup). The flow server's headers are held by `apps/flow/src/server/server-headers.test.ts` and
`infra/tests/flow-headers.test.sh` (platform-ops kept both green with HSTS) and read on the real flow
server by `hardening-11b.spec.ts`; no dashboard-side copy of that test was added (the dashboard
package cannot import the flow server without starting it).

## 5. The 11B full-stack specs (C287.3)

`dc0384a83`, on one fresh stack (build 33 s, up 157 s, load 1.06 -> 2.06):
```
OPENVERIFY_E2E_REUSE_STACK=1 playwright test --project=chromium tests/session-idle.spec.ts tests/account-export.spec.ts tests/hardening-11b.spec.ts tests/quota-flood.spec.ts tests/sso-oidc.spec.ts
  ✓ account-export.spec.ts (849ms)   ✓ hardening-11b.spec.ts (1.1s)   ✓ quota-flood.spec.ts (8.9s)
  ✓ session-idle.spec.ts (2.4s)      ✓ sso-oidc.spec.ts (4.2s)
  5 passed (20.2s)                   load 0.75
```
While writing them: the provider's authorization visit could not be answered with `page.route`
(the navigation after the console's 303 is not routed), so the spec reads the visit with
`waitForRequest` and answers it with `authorize`; the built-in viewer role is refused as a
just-in-time role (it holds `api-keys:read`, `users:read`, `roles:read`; C248.5 as built), so the
spec makes a narrow role; a TOTP step used by an earlier process on the same stack is refused (C15),
so the MFA sign-in sends the next step's code once (the mfa-token stays valid).

## 6. KP11-13: the pacing test under load

Stub `aefbb7c86`; RED `a73d2fcf4` (`pacing-fallback.test.ts`: a limiter command that fails once
makes three acquires across two pacers wait one interval, not two, on the injected clock; the
counting stub reports 0 failures: `expected +0 to be 1`); GREEN `9318d96fd` (the counting limiter;
the integration test's connections use a 10 s command timeout and assert no limiter failure before
the elapsed time). Business-registry 90 of 90; Valkey 2 of 2 (load 0.61). The cause stated in 11A's
amendment 49 is now shown deterministically: a failed limiter command, not slow pacing.

## 7. KP11-10: the cross-tenant probe (part)

`b408b21f0`: seeds `aexp` (directly: the probe's app has no Valkey and the export's create fails
closed), `env`, `acctp`, `txntp`, `grqt`, `wfl`, `cqueue`, `ctmpl`, `cslap` and `theset`; drops the
export's FROZEN_OPERATIONS entry; counts a principal-kind 403 before any lookup (`POST
/workflows/{id}/publish`: "an API key cannot") as it counts the validation-first 400. 115 of 257
server operations probed (75 of 253 at the 11A close), 2 of 2, 25 s (load 0.91). No oracle found.
Carried to 11F: 49 id families, `name:key`, `name:fieldKey`, `name:fileId`, the dashboard
operations (with `ssop` and end-sessions) and the flow operations, which need a user-session and a
flow-session harness in the probe.

## 8. Defects the Validation found, fixed test-first

- `ecca921ca`: the `redeem_share_token` step's admission threw inside the engine's swallowed
  afterCommit (the engine harness's services carry no clock), so nothing was enqueued. RED: the
  existing Postgres test `connect.integration.test.ts` "makes the token pending with a destination
  consent and enqueues its job" (`expected [] to deeply equal [ { …(2) } ]`, api integration shard 1,
  deterministic alone). GREEN: the step admits on the engine's own database and clock; 4 of 4.
- `0954589c6` (rule 6): K8-35's deadlock race (`queues-races.integration.test.ts`) had the entry
  aborted instead of the members change at load 13.25 ("deadlock detected"); the entry's transaction
  now sets a 30 s `deadlock_timeout`, so the members change, which waits first, is always the victim;
  4 of 4.
- `591305c54` (rule 6): the flood spec held only one of four sequential reports in shard 2 (a sandbox
  run finished before the next create); it now creates six at once; 1 of 1.
- `4999239ea` (rule 12): Phase 8's workflow-settings spec raised the workflow-step cap to 51, which
  C251.2 now refuses above the install ceiling of 50; it lowers it instead; 1 of 1.

## 9. Validation as run (one call per step; minutes and load)

| Step | Call | Result | Time | Load (1-min, start -> end) |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile`; `pnpm format:check` | exit 0; all files formatted | 1 s; 116 s | 0.39; 0.43 -> 1.38 |
| 2 | forced typecheck | 17 of 17 | 162 s | 1.38 -> 3.84 |
| 2 | forced lint: api; dashboard + contracts; the other 14 | exit 0 each | 238, 232, 331 s | 3.61 -> 1.38 |
| 3 | fetch_models, fetch_data, fetch_fixtures person_a_id | exit 0 | 1 s | 1.27 |
| 4 | build:variant-groups | exit 0 (156,706 groups) | 6 s | 1.24 |
| 5 | db unit | exit 0, 2,357 tests, 89.88% | 172 s | 1.14 -> 9.44 |
| 5 | watchlist + e2e unit | exit 0 (98.63%, 96.5%) | 266 s | 9.88 -> 1.24 |
| 5 | dashboard 2 blob shards + merge | merge exit 0: 7,222 tests in 621 files, 95.67% | 192, 205, 6 s | 1.05 -> 5.84 |
| 5 | the other 11 packages; @openverify/js | exit 0; 19 tests | 153 s; 5 s | 5.37 -> 13.38 |
| 5 | API 8 blob shards + merge (rerun on the final tree) | merge exit 0: 10,819 tests in 853 files, 94.17% | 156-193 s, merge 41 s | 2.23 -> 4.81 |
| 6 | benchmark:typecheck, benchmark:test | exit 0; 119 tests | 61 s; 11 s | 4.01 -> 2.34 |
| 7 | integration db; graph; api 1/3, 2/3, 3/3 | 110; 13; 123, 128, 193 (444) | 85, 32, 124, 166, 104 s | 2.34 -> 14.65 |
| 8 | vision static; pytest 1-58; pytest 59-109 | exit 0; 1,360 and 1,303 (2,663), 97.42% | 1, 201, 388 s | 13.47 -> 1.45 |
| 9 | Android (1) ui, flow, rest with --rerun | 532 + 427 + 1,773 = 2,732, none skipped | 150, 42, 95 s | 1.31 -> 1.93 |
| 9 | (2) screenshots; (3) kover + ABI; (4) unit + assembleDebug | 97 tests; exit 0; demo 106, nfc 116, face 51 | 50, 182, 11 s | 1.78 -> 3.48 |
| 9 | (5) release AARs; (6) sdk assemble; (7) lint; (8) device-test compile | exit 0 each | 10, 11, 10, 12 s | 3.02 -> 5.70 |
| 9 | (9) bundletool, release-check tests, three static checks | 98 tests OK; exit 0 | 0, 1, 12 s | 4.83 -> 4.35 |
| 9 | (10) staging; consumer-check; (11) sdk,nfc / sdk,face / sdk,nfc,face | exit 0 each | 10, 11, 22, 22, 22 s | 4.35 -> 3.98 |
| 9b | clean-build pass | not applicable: no lockfile or verification-metadata change (`git diff 9e1cb5e9e HEAD -- android/` empty) | | |
| 10 | openapi:write + diff; workflow-docs:write + diff | no diff | 22 s; 1 s | 3.37 -> 2.70 |
| 11 | mocked flow suite | 349 passed | 115 s | 2.49 -> 10.22 |
| 11 | fresh stack, shards 1-4, console sweep, stackTest, down | 50, 52, 47, 49 (198); sweep 109; stackTest 3 of 3 (three classes) | up 89 s; 278, 349, 278, 405 s; 304 s; 44 s | 3.47 -> 2.42 |
| 11b | WebKit theme-csp through Docker (Playwright 1.64.1) | 7 passed | 13 s | 1.66 -> 2.66 |
| 12 | apps image (tag openverify/apps:dev); code-runner; vision | exit 0 each | 224, 62, 34 s | 2.25 -> 2.40 |
| 13 | 11 infra test scripts, one call each | 1,314 checks, 0 failed (ci-workflow 411, 0 skipped) | 0-16 s each | 2.83 -> 2.87 |
| 14 | workflow benchmark (reported) | effectful 16/50/50 steps/s at 1/8/32 clients; control-flow 92/211/210 | 133 s | 2.43 -> 2.98 |
| 15 | `gitleaks git --redact .` | no leaks | 10 s | 2.74 |
| 16 | device suites on the phone | not applicable: nothing under android/ changed in 11B, so nobody touched the phone (rule 26) | | |

The first e2e pass (shards 50, 51+1 failed, 47, 47+1 failed) found the flood spec's and the
workflow-settings spec's defects above; the gate was then run whole again on a fresh stack. The API
unit suite still fits K = 8 blob shards alone (longest 196 s). A lone blob shard exits 1 on partial
coverage by design; each merge's exit code is the gate.

Skipped, each the plan's later Workflow's: load/ (11D), fetch_asvs.py and fetch_masvs.py (11E),
cyclonedxBom and infra/scripts/supply-chain.sh (11C), helm and kind.sh (11C), security/zap/run.sh
(11F), pnpm release:check (11E), gitleaks dir with security/gitleaks-pii.toml (11C, C260.3).
analytics:benchmark --measure is 11D's: 11B added migration 0036 (it did not change the rollup SQL),
so its container needs --teardown and --seed before --measure.

