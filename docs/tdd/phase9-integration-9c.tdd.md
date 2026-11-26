# Phase 9, Workflow 9C Stage 2: integration-9c

Base `69ebd7fab17aa13ff13dbf5cf673be08678f2fff`; Stage 1 closed at `70f97bd7`. The owner: "Launch 9C right now and make decisions yourself" (2026-11-07). Every command ran after `source scripts/env.sh`; timings carry the load average (`/proc/loadavg`, 1-minute) beside them.

## Slices

| # | Slice | Stub | RED | GREEN / fix |
|---|---|---|---|---|
| 1 | WebKit CSP: the flow's theme through a stylesheet rule | 6b0f1a9e | 54b8586b | 86f4af7f, lint 45fe292c |
| 2 | AC2: PATCH never reactivates | | b50342d5 (typecheck fix 384ea3f3) | f72c1854 |
| 3 | DA1: `GET /dashboard/inquiries` applies C165.3's filters | | 24e6ccd8 | b639ed20 |
| 4 | OpenAPI regenerated (twice, same sha256) | | | ffbb8c7e |
| 5 | Console sweep route helpers | 295c6459 | 4254ef45 | f27ebb8b |
| 6 | The `console-sweep` project and `a11y-console.spec.ts` | | c1f2a926 | a2d276f8, cc3fdf74 |
| 7 | `ui-csp.spec.ts` over every dynamic page | | d823a53d | (green in the gate) |
| 8 | CI: unit-dashboard in two blob shards, unit-api's name | | 1d214a01 | 84057522 |
| 9 | Gate defect: the flow publish revalidated the route | | ce522e6d (corrected c8b84eee) | 14b1d899 |
| 10 | Gate defect: Cytoscape.js inserted an inline `<style>` | | d0b05b4c | e22175e7 |
| 11 | Gate defect: template version JSON not keyboard-scrollable | | 11f44bd0 | 4b40d337 |
| 12 | Specs the plan's changes broke | | (gate runs) | a412525d, a81b0346 |
| 13 | e2e README: four shards and the sweep | | | 543f1398 |

### 1. WebKit CSP (orchestrator decision 3 before 9C)

Cause: `apps/flow/src/theme/apply.ts` wrote every token, the radius scale and `color-scheme` through `document.documentElement.style.setProperty`. WebKit runs its `style-src-attr` check on CSSOM writes to an element's inline style; Chromium and Firefox do not.

RED (`54b8586b`):

```
$ pnpm exec vitest run src/theme/apply.test.ts --coverage.enabled=false
 × sets each light token and the radius scale on the stylesheet rule, never the root inline style
 ... 15 failed: "expected '' to be '#1f4fd1'", "expected 'color-scheme: light;' to be null"
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts theme-csp --project=chromium
 ✘ applies a theme set's palette and radius with no CSP violation
   Error: expect(received).toBeNull()  Received: "--color-primary: #2563eb; ... color-scheme: light;"
 1 failed, 4 passed
```

GREEN (`86f4af7f`): one rule `:root:root:root {}` (0,3,0, unlayered) inserted at the end of the page's last enabled same-origin stylesheet (a constructed, adopted sheet when there is none; nothing when neither exists), and every checked value set with `rule.style.setProperty`. The rule outranks the stylesheet's `:root[data-openverify-variant='dark']` (0,2,0) and Tailwind's layered tokens, as the inline style did. The value checks are kept.

```
$ pnpm exec vitest run src/theme --coverage.enabled=false        Tests 25 passed (25)
$ ... playwright test ... theme-csp --project=chromium           5 passed (4.5s)
```

Engines: `playwright install webkit firefox` exited 0, but WebKit (installed on 2026-11-06 22:07 by someone else) does not start here ("Host system is missing dependencies to run browsers"); Firefox starts. Before the config change, every local `pnpm --filter @openverify/flow e2e` therefore failed on five WebKit launches:

```
$ ... playwright test ... theme-csp --project=webkit --project=firefox
 5 failed ([webkit], Host system is missing dependencies), 5 passed ([firefox])
```

`apps/flow/e2e/playwright.config.ts` now keeps an extra engine locally only when it is installed and launches (`launches(engine)`; the answer passes to workers in `OPENVERIFY_FLOW_E2E_ENGINES`); CI always runs both:

```
$ ... playwright test ... theme-csp      10 passed (11.8s)   (Chromium 5, Firefox 5; WebKit skipped)
```

WebKit is proven only in CI's next run.

### 2. AC2

RED `b50342d5` (four route tests: 422 with code, pointer and `/reactivate` in the detail; role ids unchanged; the 403 case for deactivation kept; the "within their reach" case now 422) and the contracts registry test (four failures). The role-ids test used a helper of another `describe` and did not typecheck; `384ea3f3` reads the roles itself.

```
$ pnpm exec vitest run src/routes/dashboard/users.test.ts --coverage.enabled=false
 × ... 4 failed: "expected 200 to be 422" (x3), "expected 403 to be 422"
$ (packages/contracts) pnpm exec vitest run src/phase9b-problems.test.ts   4 failed | 16 passed
```

GREEN `f72c1854`: `ACCESS_PROBLEM_STATUSES.user_reactivation_required: 422`, golden `contracts/fixtures/problems/access/user-reactivation-required.json`, `updateOperator` refuses before any change, the route description names it.

```
$ pnpm exec vitest run src/routes/dashboard/users.test.ts src/services/users.test.ts   Tests 23 passed
$ (contracts) phase9b-problems.test.ts                                                Tests 20 passed
```

The console never sends the PATCH form (DS6); no e2e spec does (`grep -rn reactivat e2e/tests`: none).

### 3. DA1

RED `24e6ccd8`:

```
$ pnpm exec vitest run src/routes/dashboard/index.test.ts -t "C165.3"
 × applies the server route's filters, never answering them unfiltered   expected [ …(3) ] to deeply equal [ …(2) ]
 × refuses filter[next-step-name] without pii:view (403)                  expected 200 to be 403
```

GREEN `b639ed20`: the route calls `inquiryListFilters` with the operator's PII visibility, passes `where`, and `nextPageLink` repeats the added filters. `index.test.ts`: 41 passed.

### 5 to 7. The console sweep

RED `4254ef45`: 4 of 5 route-helper tests failed on the stub; GREEN 5 passed. RED `c1f2a926`: the config test failed (`projects` was `['chromium']`); GREEN 3 passed.

First run of `a11y-console.spec.ts` on a fresh stack (before the shards): 70 passed, 27 failed, every failure "no console link reaches <route>" (no object of that kind yet), no axe violation. After the four shards of a used stack: 95 passed, 7 failed: five routes no link reached (`/case-queues/policies/[id]`, `/case-settings/sla-policies/[id]`, `/cases/bulk/[id]`, `/lists/importers/[id]`, `/workflows/runs/[id]`), and one axe defect (slice 11). `cc3fdf74` reads up to eight pages of each dynamic route for nested links and makes the three objects no spec makes; then `ui-csp.spec.ts` on the same stack: 5 passed, every dynamic route found.

Error page: probed with malformed cursors and ids on seven list pages, an unknown inquiry id and a malformed analytics window: every page answered with its own words or the 404 page, so no reliable full-stack trigger exists; carried to 9D.

### 9 to 12. Defects the gate found

- **Flow publish** (`ui-flow-builder.spec.ts`, shard 2 of the first pass): after Publish the page showed "This template has no draft" and the status never read Published. `publishFlowDraft` called `revalidatePath('/templates')`; a revalidating server action sends the current route again, and the flow page of a template without a draft has no builder. RED `ce522e6d` failed for the wrong reason (its answer lacked `published-at`); `c8b84eee` corrected it, and it was then seen failing on the old action ("expected vi.fn() to not be called at all, but actually been called 1 times") and passing on the new one (13 passed).
- **Cytoscape.js** (`ui-graph.spec.ts`, converted to the real header by DS18 and never run before): one `style-src-elem inline` violation per canvas. The library inserts `<style id="__________cytoscape_stylesheet">` unless an element of that id exists. RED `d0b05b4c` ("expected null not to be null"); GREEN `e22175e7` puts an empty `<meta>` of that id in the head first and gives the container `relative`; graph tests 75 passed.
- **Template version JSON** (`a11y-console.spec.ts`): `scrollable-region-focusable` on `/templates/[id]/versions/[versionId]`. RED `11f44bd0`, GREEN `4b40d337` (a labelled region with `tabIndex=0` and a visible focus ring).
- **`theme-sets.spec.ts`** read `document.documentElement.style`, the old mechanism: now the computed value (`a412525d`). **`ui-integrations.spec.ts`** created an unnamed webhook, refused since C169.5: now named (`a81b0346`).

## Final gates

| Gate | Exit | Time | Load |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 0 s | |
| `pnpm format:check` | 0 | 95 s | |
| dashboard vitest shard 1/2 (blob, thresholds off) | 0 | 166 s | 1.1 to 7.1 |
| dashboard vitest shard 2/2 | 0 | 184 s | 6.5 to 7.1 |
| dashboard merge with coverage (6,538 tests; 95.58 / 88.53 / 94.92 / 95.61 %) | 0 | 7 s | |
| `pnpm turbo run test --force` flow, contracts, e2e (1,510; 4,384; 131 tests) | 0 | 95 s | 6.1 to 8.3 |
| flow test script again after the lint refactor | 0 | 84 s | |
| API vitest shards 1 to 8 of 8 (blob; each exits 1 on its partial coverage only) | 1 each | 134, 150, 153, 154, 143, 133, 133, 122 s | 7.6 to 9.0 |
| API merge with coverage (9,375 tests in 686 files; 94.36 / 84.97 / 96.64 / 94.52 %) | 0 | 32 s | 7.6 |
| `pnpm --filter @openverify/db test:integration` (78) | 0 | 84 s | 4.7 to 13.5 |
| api integration `--project graph` (13) | 0 | 32 s | 11.8 |
| api integration `--project api --shard=1/3`, 2/3, 3/3 (89, 99, 79) | 0, 0, 0 | 65, 161, 81 s | 8 to 16 |
| `pnpm turbo run typecheck --force --concurrency=2 --filter='...[69ebd7fa]'` (4 GB heap; 11 tasks) | 0 | 144 s | 13.1 to 3.7 |
| `pnpm turbo run lint --force --concurrency=1 --filter='[69ebd7fa]'` (4 GB heap; 5 tasks) | 1, then 0 | 118 s, 448 s | 3.4; 1.4 to 1.1 |
| `pnpm --filter @openverify/api openapi:write` twice | 0, 0 | | sha256 0ccb2cf2... both |
| `bash infra/tests/ci-workflow.test.sh` (250 passed) | 0 | | |
| mocked flow suite `pnpm --filter @openverify/flow e2e` (168: 163 Chromium + 5 Firefox) | 0 | 60 s; again after the refactor 60 s | 1.0 to 8.3 |
| e2e stack down and build | 0 | 3 s | |
| e2e stack up | 0 | 87 s | 1.8 to 3.4 |
| shard 1/4 `--project=chromium` (47) | 0 | 228 s | 3.1 to 3.2 |
| shard 2/4 (42) | 0 | 265 s | 3.2 to 3.7 |
| shard 3/4 (45) | 0 | 266 s | 3.7 to 1.9 |
| shard 4/4 (41) | 0 | 348 s | 2.0 to 1.3 |
| console sweep `--project=console-sweep --no-deps` (102: 97 pages of axe, 5 CSP tests) | 0 | 409 s | 1.2 to 2.5 |
| e2e stack down | 0 | | |
| Android `:openverify-sdk:testAndroidHostTest` | 0 | 73 s | 7.0 |
| Android `testDebugUnitTest koverVerify` | 0 | 11 s | 4.0 |
| Android `assembleDebug :openverify-sdk:assemble lint` | 0 | 11 s | 3.8 |

The first forced lint failed on two errors in this agent's slice 1 (`apply.test.ts:96` a cast, `apply.ts:128` a `void`), fixed in `45fe292c`. The full-stack shards ran before that refactor, which changes no behaviour; the flow's unit and mocked suites ran again after it.
