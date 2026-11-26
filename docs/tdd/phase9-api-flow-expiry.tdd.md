# Phase 9, Workflow 9B, Stage 3: api-flow-expiry (TDD evidence)

The per-inquiry expiry windows (C151.10; 9A Stage 3 amendment 21; contracts B44; foundation-9b F2),
split from `api-flow-carry` by the orchestrator during Workflow 9B (2026-11-06). Run
`source scripts/env.sh` first. Every value in the tests is synthetic.

## Scope

- `POST /inquiries` `meta`: `expiration-after-create-interval-seconds` sets `expires-at` at creation;
  `expiration-after-start-interval-seconds`, `expiration-after-resume-interval-seconds` and
  `one-time-link-expiration-seconds` are stored in the three (F) columns and served on the inquiry
  (`null` when the version decides).
- The windows apply for that inquiry only, before the version's settings: at the start
  (`flow-engine/position.ts`), on `POST /inquiries/:id/resume` and on the one-time link redemption
  (both through `extendExpiryOnResumeInTx`, in their transactions).
- Link creation (`services/one-time-links.ts:99`) is outside this agent's paths (contracts B44, F6):
  `oneTimeLinkLifetimeSeconds` is built and tested here, and the one-line call is left to
  `integration-9b` (contractDeviations).

## Slice 0: stubs (d347737a)

`createdInquiryWindows` and `oneTimeLinkLifetimeSeconds` were added to `apps/api/src/flow-engine/expiry.ts`
as stubs that throw, so the RED tests compile and typecheck.

```
$ (cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json); echo $?
0
$ (cd apps/api && pnpm exec eslint src/flow-engine/expiry.ts); echo $?
0
```

## Slice 1: RED (ffd8d2ce)

Tests:
- `apps/api/src/flow-engine/expiry.test.ts`, which gains 7 tests:
  - a resume with the inquiry's own window, which never shortens the expiry and never revives an
    inquiry past its expiry;
  - the start with the inquiry's own window, and the start of an inquiry already past its expiry;
  - `createdInquiryWindows`;
  - `oneTimeLinkLifetimeSeconds`.
- `apps/api/src/flow-engine/expiry-windows.test.ts`, new, with 9 route tests:
  - `POST /inquiries` with meta: stored, served by `GET` and in `inquiry.created`;
  - a sibling inquiry and a partial meta, serving `null`;
  - C11's bounds and an unknown key refused with 400;
  - a resume with its own window, with the version's window, and without shortening the expiry;
  - a refused resume moves nothing;
  - the start through `GET /flow/session`;
  - a redemption with its own window and with the version's;
  - a refused redemption moves nothing.

```
$ (cd apps/api && pnpm exec vitest run src/flow-engine/expiry.test.ts --coverage.enabled=false --maxWorkers=2)
 × takes the inquiry’s after-resume window over its version’s, for that inquiry only
   AssertionError: expected 2026-10-20T22:00:00.000Z to deeply equal 2026-10-20T14:00:00.000Z
 × never revives an inquiry already past its expiry, whichever window decides
   AssertionError: expected 2026-10-21T12:00:00.000Z to deeply equal 2026-10-20T11:00:00.000Z
 × takes the inquiry’s own after-start window over its version’s, or where the version has none
   AssertionError: expected 2026-10-20T12:30:00.000Z to deeply equal 2026-10-20T14:00:00.000Z
 × never revives an inquiry already past its expiry when it starts
   AssertionError: expected 2026-10-20T12:30:00.000Z to deeply equal 2026-10-20T11:00:00.000Z
 × takes the creation window from meta, else the version’s, and keeps the other three
   Error: createdInquiryWindows is not built yet (api-flow-expiry; 12 inputs)
 × is the requested lifetime, else the inquiry’s own window, else the version’s
   Error: oneTimeLinkLifetimeSeconds is not built yet (api-flow-expiry; 3 inputs)
 Tests  6 failed | 5 passed (11)

$ (cd apps/api && pnpm exec vitest run src/flow-engine/expiry-windows.test.ts --coverage.enabled=false --maxWorkers=2)
 × sets expires-at from the creation window and stores and serves the other three
   -   "expiration-after-resume-interval-seconds": 172800, ... "expires-at": "2026-10-20T13:00:00.000Z"
   +   "expires-at": "2026-10-20T12:10:00.000Z"          (meta ignored, nothing served)
 × serves null for each window the inquiry left to its version, and a sibling keeps the version’s
 × takes C11’s bounds, 300 to 2,592,000 seconds, ...
   AssertionError: expected '2026-10-21T12:00:00.000Z' to be '2026-11-19T12:00:00.000Z'
 × a resume moves the expiry to now plus the inquiry’s after-resume window, served in its answer
   AssertionError: expected '2026-10-21T12:00:00.000Z' to be '2026-10-22T12:10:00.000Z'
 × a resume without an own window takes the version’s, and never shortens the expiry
   AssertionError: expected '2026-10-20T12:20:00.000Z' to be '2026-10-20T13:15:00.000Z'
 × the start moves the expiry to started-at plus the inquiry’s after-start window
   AssertionError: expected 2026-10-20T12:46:00.000Z to deeply equal 2026-10-20T14:16:00.000Z
 × moves the expiry to now plus the inquiry’s own window when the link is redeemed
   AssertionError: expected 2026-10-21T12:16:00.000Z to deeply equal 2026-10-22T12:26:00.000Z
 × takes the version’s window without an own one, and a refused redemption moves nothing
   AssertionError: expected 2026-10-20T12:36:00.000Z to deeply equal 2026-10-20T13:27:00.000Z
 Tests  8 failed | 1 passed (9)
```

Each fails for the intended reason:
- `meta` is ignored and nothing is served;
- no caller extends the expiry on a resume or a redemption;
- the start reads only the version;
- a resume revives an overdue inquiry;
- the two builders are stubs.

The guards that pass already are kept as guards: a later expiry is never shortened, and a refused
resume moves nothing. The RED files typecheck. At that moment the API's `tsc` reported one error,
in another agent's in-flight `services/templates/flow-run-grants.test.ts`. ESLint and prettier pass.

## Slice 1: GREEN (b5b45a93)

- **`flow-engine/expiry.ts`:**
  - `versionExpirySettings`;
  - `startWindowSeconds` and `resumeWindowSeconds` (the inquiry's own window, else the version's);
  - `mayMoveExpiry`: open, not redacted, and not yet at its expiry;
  - `extendExpiryOnResumeInTx`, whose `Pick` gains `expirationAfterResumeSeconds`;
  - `createdInquiryWindows` and `oneTimeLinkLifetimeSeconds`.
- **`flow-engine/position.ts`:** `applyStartWindow` uses `startWindowSeconds` and `mayMoveExpiry`.
- **`services/inquiries.ts`** (borrowed lines):
  - `createInquiry` and `createInquiryInTx` take `meta` (default `{}`);
  - `expires-at` comes from `createdInquiryWindows`, and the three columns go to `insertInquiry`;
  - `inquiryResourceFor` serves the three windows;
  - `resumeInquiry` calls `extendExpiryOnResumeInTx` in its transaction after the session is made,
    and answers the moved `expires-at`.
- **`routes/server/inquiries.ts`** (borrowed line): `POST /inquiries` passes `request.body.meta`.
- **`services/one-time-links.ts`** (borrowed lines): `redeemOneTimeLink` calls
  `extendExpiryOnResumeInTx(tx, inquiry, now)` after the session is created, in the redemption's
  transaction.

```
$ (cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json); echo $?
0
$ (cd apps/api && pnpm exec vitest run src/flow-engine/expiry.test.ts src/flow-engine/expiry-windows.test.ts --coverage.enabled=false --maxWorkers=2)
 Tests  20 passed (20)
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquir src/routes/flow/one-time-links.test.ts src/flow-engine src/services/signals src/routes/handoff-routes.test.ts src/workflows/actions src/jobs/records.test.ts src/routes/server/inquiry-sessions.test.ts src/services/inquiries --coverage.enabled=false --maxWorkers=2)
 Test Files  52 passed (52)
      Tests  896 passed (896)        # 5m12s, load 13.28 12.26 11.21
$ (cd apps/api && pnpm exec eslint <the 5 sources and 2 tests>); echo $?
0
```

`services/one-time-links.ts` was never prettier-formatted: the link-creation body has an extra
indent, and the `services/` prettierignore trap hides it. Only my four added lines were checked
with `--ignore-path=.gitignore`. Nothing else was reformatted.

No refactor commit was needed: the window rules live in one module, and every caller makes one call.

## Final gates (on b5b45a93; every exit code read from the command itself)

| Gate | Exit | Result | Time and load |
|---|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | | |
| `pnpm exec prettier --check` on my files (`--ignore-path=.gitignore` for `services/inquiries.ts`) | 0 | | |
| `NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/api --concurrency=1` | 0 | 2 of 2 tasks | 488 s, load 17.0 to 8.0 |
| API unit: 12 blob shards at `--maxWorkers=3`, one per call through a heavy slot (6 shards were tried first, but shard 1/6 took 572 s of the 600 s cap, so a fresh directory with N = 12 was used) | 1 each | partial coverage only, as expected | 228, 234, 389, 290, 187, 209, 199, 172, 177, 182, 170, 149 s; load 5.9 to 15.0 |
| API unit merge: `vitest run --merge-reports=<dir>/blobs --coverage` | **0** | 684 files, 9,304 tests, 94.36% statements, 84.94% branches | 82 s, load 5.5 |
| `pnpm --filter @openverify/db test:integration` | 0 | 78 tests | 131 s, load 17.0 to 23.4 |
| `vitest run --config vitest.integration.config.ts --project graph` | 0 | 13 tests; template of 225,000 rows built in 47.7 s of its 180 s guard | 91 s, load 23.4 to 20.3 |
| `... --project api --shard=1/3` | 0 | 89 tests | 135 s, load 19.1 to 38.2 |
| `... --project api --shard=2/3` | 0 | 99 tests | 236 s, load 38.8 to 19.8 |
| `... --project api --shard=3/3` | 0 | 79 tests | 80 s, load 18.5 to 14.7 |

Not run, by the Stage 3 rules:
- No other package's tests were run: only `apps/api` changed.
- No full-stack e2e and no mocked flow suite were run, since `apps/flow` is unchanged.
- The watchlist benchmark was not run, since no file of rule 16 changed.
