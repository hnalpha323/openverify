# Phase 11, Workflow 11A: console-connect (family U)

Agent: `console-connect` (Stage 3, beside api-connect, api-redeem, api-consent, clients-connect and
workflow-connect). Owns `apps/dashboard/src/app/**/connect/` and `apps/dashboard/src/components/connect/`
with their tests; the object pages' section lines and the settings page's link are named borrowed
edits (listed in each section below).

Contract: C242 (the console), on Phase 9's shell (`renderPage`, `DataTable`, the settings pages),
with the names contracts-11a froze (`packages/contracts/src/{connect,consent-records,provenance}.ts`)
and the golden fixtures under `contracts/fixtures/api/connect/`.

Commands run from the repository root after `source scripts/env.sh`. Every timing has the load
average (`cat /proc/loadavg`) beside it. Iteration runs only this agent's test files
(`pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false`).

## Routes (all under the settings layout)

| Route | Page | Needs |
|---|---|---|
| `/settings/connect` | Connect settings and the connections in both directions | `connect-connections:read`; the settings section `settings:read` |
| `/settings/connect/connections/[id]` | one connection: the policy in words, the actions each side may take | `connect-connections:read` |

## Checkpoint 1 (connections)

Stub `1589e1c66` (names and types only; `tsc --noEmit` exit 0 in 66 s at load 2.52).

### RED (checkpoint 1)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect --coverage.enabled=false
 Test Files  8 failed (8)
      Tests  102 failed | 6 passed (108)          # rc=1, 9 s at load 4.02
```

Each failure is the missing behaviour, not a typo: the words maps are empty
(`expected [] to deeply equal [ 'active', 'archived', … ]`), the components render nothing
(`Unable to find … role "table" and name "Connections"`), the pages return null (`Expected
notFound(), but the call completed`; no `Connect` heading) and the actions answer "Not built yet"
(`expected { ok: false, … } to deeply equal { ok: true, data: undefined }`). The six that pass hold
already: the two metadata titles, an unchanged policy's empty change list, the problem words leaving a
non-Connect problem alone, and two whose subject is absent (no table rows to be wrong). `tsc --noEmit`
exit 0 before the commit.

### GREEN (checkpoint 1)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  111 passed (111)                     # rc=0, load 8.30 at the start
$ pnpm exec tsc --noEmit -p apps/dashboard/tsconfig.json        # exit 0
$ pnpm exec eslint src/components/connect src/app/settings/connect   # exit 0
```

Two fixture corrections in the RED tests, made with the GREEN code (test data, not expectations):
the step-up answer carries `mfa-verified-at` and the passkey options answer is `{options}`, as
`stepUpResponseSchema` and `dashboardWebauthnLoginOptionsResponseSchema` require; jsdom's `URL` is
not a path `fs` reads, so the goldens are read through `fileURLToPath`. `SharePolicyChanges` gained
its own three tests (`share-policy-view.test.tsx`), written with it.

### The settings page's link (named borrowed edit)

`app/settings/connect/settings-link.test.tsx` RED `bd7…` style: 1 of 2 failed (`Unable to find …
role "link" and name "Connect settings"`); then one `PageHeader` `actions` line in
`apps/dashboard/src/app/settings/page.tsx` (commit `1688cf22a`): 2 of 2, and the settings page's own
three test files (24 tests) unchanged and green.

### The dashboard suite at checkpoint 1 (two blob shards and a merge, Stage 1b amendment 1)

| Call | Wall | Load before / after | Result |
|---|---|---|---|
| shard 1/2 | 502 s | 7.63 / 15.04 | blob written (a lone shard exits 1 on partial coverage) |
| shard 2/2 | 790 s | 13.11 / 24.39 | blob written; **past the 10-minute cap** (it ran on in the background) |
| merge | 42 s | 26.06 | rc=0: 6,916 tests in 591 files, 95.59% lines, 88.38% branches |

Shard 2 crossed the cap at load 24 (six Stage 3 agents' suites), so by rule 8 it does not count as a
gate call: every later dashboard gate of this agent runs as **four** blob shards and a merge, in a
fresh directory. The tests themselves all passed.

## Checkpoint 2 (tokens and peek)

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect --coverage.enabled=false
 Test Files  6 failed | 10 passed (16)
      Tests  33 failed | 116 passed (149)         # rc=1, load 24.28
```

Every failure is the missing token family: no "Share tokens" or "Status history" table, no peek
tables, no redeem form fields, the actions answer "Not built yet". `tsc --noEmit` exit 0.

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  149 passed (149)                     # rc=0, load 6.66
tsc --noEmit exit 0; eslint (with --fix) and prettier --check clean over both folders.
```

The peek is asked of the API only when the operator follows the page's link (`?peek=true`), only on
an inbound `created` token and only with both `connect-share-tokens:peek` and `pii:view`; a refused
peek (409, 429, 503) is said in words in the peek section while the token still shows. The RSC
payload test holds that an operator without `pii:view` gets no peek value even with `?peek=true`.

### Gates for checkpoints 1 and 2 (the dashboard in four blob shards and a merge)

Run on the tree of `083800ff0`, after api-connect's "checkpoint 1 (connections)" (`7ffbe7b01`) and
api-consent's "checkpoint 1 (consent records)" (`4d54d4b37`) landed; lock waits for the heavy slot
were inside the times.

| Call | Wall | Load before / after | Result |
|---|---|---|---|
| shards 1/4 and 2/4 (one call) | 236 + 349 s | 6.32 / 18.61 | blobs written |
| shard 3/4 | 327 s | 17.22 / 14.31 | blob written |
| shard 4/4 | 327 s | 12.03 / 20.56 | blob written |
| merge | 37 s | 20.56 | **rc=0**: 6,952 tests in 597 files, 95.66% lines, 88.4% branches |
| `pnpm --filter @openverify/dashboard typecheck` | 179 s | 15.82 | rc=0 |
| `pnpm --filter @openverify/dashboard lint` (4 GB heap) | 379 s | 8.55 | rc=0 |

The connections' wiring is the frozen routes' (`GET /connect/connections`, `/:id`, `/deactivate`,
`/reactivate`, `/share-policy`, and the BFF's `POST /dashboard/connect/connections/:id/activate`),
which api-connect built in its checkpoint 1; the console's tests answer them with contracts-11a's
goldens, parsed by the same schemas.

## Checkpoint 3 (consent and provenance)

### RED

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect --coverage.enabled=false
 Test Files  7 failed | 16 passed (23)
      Tests  31 failed | 151 passed (182)         # rc=1, load 10.30
```

All 31 are the missing consent and provenance family: no consent record articles, no "Cloned"
marker or banner, the withdrawal action answers "Not built yet", no "Not reviewed by counsel" in
the template editor's text rules, the sample partner not recognised, and the three object pages
never call the Connect slot (`expected "vi.fn()" to be called with arguments`). The wiring test
mocks the decision records slot, which reads `GET /decisions`. `tsc --noEmit` exit 0.

### GREEN

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/connect src/app/settings/connect \
    src/components/translations "src/app/inquiries/[id]" "src/app/accounts/[id]" \
    "src/app/transactions/[id]" src/components/lifecycle --coverage.enabled=false
 Test Files  63 passed (63)
      Tests  503 passed (503)                     # rc=0, load 12.34
tsc --noEmit exit 0; eslint and prettier --check clean over every file touched.
```

The first GREEN run failed four checkpoint 2 tests (hrefs read `undefined`): the sample label put
`provenance.tsx` → `share-tokens-table.tsx` → `connections-table.tsx` → `provenance.tsx` in a cycle,
so a path constant was read before it was set. Fixed by `connect-paths.ts` (every Connect path in one
module) and `sample-label.tsx`; the tables re-export the paths they exported before.

Named borrowed edits, each file clean (`git status --porcelain`) before the edit and committed with
this GREEN commit: `app/inquiries/[id]/page.tsx` (one `loadSection` entry with the inquiry's
provenance and included verifications) and `components/lifecycle/inquiry-view.tsx` (the `connect`
prop and one `SlotSection`, placed before the decision records so a clone's banner is first);
`app/accounts/[id]/page.tsx` and `components/lifecycle/account-view.tsx` (the same, last on the
page); `app/transactions/[id]/page.tsx` (one entry and one `SlotSection`, the page having no slot);
`components/translations/translations-editor.tsx` (one `<li>` with `CounselReviewNote` beside the
legal weight). The three object pages' own test files ran unchanged and green.

### Final gates (checkpoint 3; rule 23, beside five other Stage 3 agents)

Run on the tree of `98edfb899`. Times include the wait for a heavy slot.

| Call | Wall | Load before / after | Result |
|---|---|---|---|
| dashboard shard 1/4 | 300 s | 22.16 / 23.33 | blob written |
| dashboard shard 2/4 | 324 s | 22.50 / 24.48 | blob written |
| dashboard shard 3/4 | 385 s | 24.25 / 24.85 | blob written |
| dashboard shard 4/4 | 425 s | 24.78 / 29.11 | blob written |
| merge | 47 s | 26.97 | **rc=0**: 6,985 tests in 604 files; 95.67% lines, 88.42% branches; `components/connect` 98.57% lines, `app/settings/connect` 92.81% |
| `pnpm --filter @openverify/dashboard typecheck` | 259 s | 25.98 | rc=0 |
| `pnpm --filter @openverify/dashboard lint` (4 GB heap) | 705 s | 26.08 / 22.98 | rc=0, **past the 10-minute cap** (it finished in the background) |
| split lint: `eslint src/app` | 223 s | 21.70 / 22.29 | rc=0 |
| split lint: `eslint . --ignore-pattern 'src/app/**'` | 636 s | 21.15 / 25.10 | rc=0, past the cap at load 25 |
| `flock … /tmp/openverify-e2e.lock pnpm --filter @openverify/dashboard build` | 386 s | 22.58 / 30.63 | rc=0; the route manifest lists `/settings/connect`, `/settings/connect/connections/[id]`, `/settings/connect/share-tokens`, `/settings/connect/share-tokens/[id]` |
| `pnpm exec prettier --check` over every file touched | – | – | clean |

The lint found nothing in any of its three runs; its wall time at load 21 to 26 (the six Stage 3
agents' suites and Gradle builds) is past the cap, and the next split for integration-11a is by the
dashboard's top folders (`src/components`, `src/lib` and the rest), each well under half.
