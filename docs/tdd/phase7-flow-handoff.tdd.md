# TDD record: flow-handoff (Phase 7, Workflow 7A Stage 3, family H)

Agent `flow-handoff`. It built C96 (device handoff) end to end, except the full-stack spec, on top of
Stage 1b (H) (`c351ece8`). In every shell: `source scripts/env.sh`.

Every unit went stub (where a test needed a name), then RED (compiles, typechecks and lints; fails
for its reason), then GREEN. The RED corrections and the tests written after GREEN are named below
as such.

## Commits

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| 1. db repository | `4d2332cb` | `6821104a` | `ce2d0254` |
| 2. API services, routes, hooks, publish rules | (Stage 1b's) | `ca1a7cb0` | `5a22ff8c` |
| 3. Flow: client, QR, desktop step, phone flow, locales | `eb982bc9` | `07b6d258` | `f1a027aa` |
| 4. Mocked flow specs | n/a | `fa0827d6` (after GREEN, see 4) | n/a |
| 5. Races on Postgres | n/a | `aa8128a1` | `88931738` |
| 6. API cases | n/a | `3672db25` (after GREEN, see 6) | n/a |

The docs are in `704d567f` (`docs/flow/handoff.md`). This record is the last commit.

## 1. The db repository (`packages/db/src/repositories/handoff-tokens.ts`)

Stub `4d2332cb` added the names the tests needed beside Stage 1b's eight:
- `createHandoffSession`, `findActiveHandoffSession`, `latestHandoffToken`, `rejectHandoffSession`;
- `markVerificationsFromRejectedHandoff`, `hasRejectedHandoffVerifications`;
- `hasConfirmedOtpDestination`, `recordHandoffDistanceFacts`.

**RED** (`6821104a`):

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/handoff-tokens.test.ts --coverage.enabled=false
 Test Files  1 failed (1)
      Tests  16 failed (16)
HandoffRepositoryNotBuiltError: issueHandoffToken is not built yet (flow-handoff)
…
HandoffRepositoryNotBuiltError: hasConfirmedOtpDestination is not built yet (flow-handoff)
```

**GREEN** (`ce2d0254`):

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/handoff-tokens.test.ts --coverage.enabled=false
      Tests  16 passed (16)
$ pnpm --filter @openverify/db exec vitest run src/repositories/handoff-plumbing.test.ts src/phase7-handoff-tables.test.ts --coverage.enabled=false
      Tests  37 passed (37)
```

`HandoffRepositoryNotBuiltError` was removed with the stubs, since nothing imported it.

## 2. The API (`apps/api/src/services/handoff/`, `services/publish/handoff.ts`, `routes/flow/handoffs.ts`)

**RED** (`ca1a7cb0`, `services/handoff/flow-handoffs.test.ts`). Every case failed against Stage
1b's 501 services and empty publish rules, except the no-step case, which the stub already serves:

```
$ pnpm --filter @openverify/api exec vitest run src/services/handoff/flow-handoffs.test.ts --coverage.enabled=false
     × needs the environment's organization display name (422 display_name_required)
AssertionError: expected 201 to be 422
     × issues a QR handoff: the fragment, a digest at rest, the step issued and the issue audited
Error: expected HTTP 201, got 501: {…"detail":"Device handoff is not built yet."…}
      Tests  21 failed | 1 passed (22)
```

**GREEN** (`5a22ff8c`):

```
$ pnpm --filter @openverify/api exec vitest run src/services/handoff/flow-handoffs.test.ts --coverage.enabled=false
      Tests  22 passed (22)
```

Two existing tests pinned what the stubs did. Each changed with the build, as little as possible:
- **`src/routes/handoff-routes.test.ts`** (Stage 1b's) asserted 501 from every handoff route. It now
  asserts the built answers:
  - a flow without the step has none waiting: 409 `handoff_not_available`, or
    `handoff_not_redeemed` for the reject;
  - an unknown token answers 410 `handoff_token_invalid`, still counted under
    `one-time-link-redeem`.

  Its walk of the handoff routes asserted "not 409". It now asserts that none answers
  `session_handed_off`, since the built routes answer their own 409s. 13 tests pass.
- **`src/routes/flow/signals.test.ts`** (api-signals'). Its last line expected 202 for the desktop's
  `POST /flow/signals` while a phone session was active. Under F13 the desktop is now locked, so it
  asserts 409 `session_handed_off`. It is the one failure the wider run below found before the
  change. 14 tests pass.

```
$ pnpm --filter @openverify/api exec vitest run src/routes/flow src/services/inquiry-templates.test.ts src/services/handoff src/routes/server/inquiries.test.ts --coverage.enabled=false
 Test Files  1 failed | 25 passed (26)
      Tests  1 failed | 443 passed (444)      # before the signals.test.ts change
```

## 3. The flow (`apps/flow/src/handoff/`, `apps/flow/src/steps/device-handoff/`)

Stub `eb982bc9`:
- `previewHandoff`, `declineHandoff`, `redeemHandoff` (rejecting) and `QrCode` (drawing nothing);
- the handoff messages in English and Spanish, wired under `handoff` in `src/i18n/locales/{en,es}.ts`.

**RED** (`07b6d258`):

```
$ pnpm --filter @openverify/flow exec vitest run src/handoff src/steps/device-handoff --coverage.enabled=false
 Test Files  4 failed | 2 passed (6)
      Tests  25 failed | 5 passed (30)
Error: not built yet
TestingLibraryElementError: Unable to find role="img" and name "QR code that opens this verification on your phone"
```

Two RED fixtures were wrong and were corrected in the GREEN commit:
- **`qr-code.test.tsx`.** Its oracle drew the code at lean-qr's default error-correction level L,
  while the component draws at M or higher (screens add glare). The test now asks for M too. The
  failure before the correction was `expected '-4 -4 53 53' to be '-4 -4 49 49'`.
- **`handoff-redeem-flow.test.tsx`.** Its problem fixture lacked the required `detail` member, so
  the transport discarded the problem and the `session_limit_reached` code was unreadable. The API
  always sends `detail`.

**GREEN** (`f1a027aa`):

```
$ pnpm --filter @openverify/flow exec vitest run src/handoff src/steps/device-handoff --coverage.enabled=false
      Tests  30 passed (30)
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false
 Test Files  74 passed (74)
      Tests  1076 passed (1076)
```

## 4. The mocked flow specs (`apps/flow/e2e/handoff-desktop.spec.ts`, `handoff-phone.spec.ts`)

These are acceptance specs on the built flow. They were written after the unit GREEN, not RED
first, and passed on their first run:

```
$ cat /proc/loadavg   # 1.70 1.88 2.20
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts handoff-desktop handoff-phone
  5 passed (9.5s)            # real 10.8 s
$ cat /proc/loadavg   # 1.44 1.82 2.17
```

## 5. The races on Postgres (`services/handoff/handoff-races.integration.test.ts`)

**RED** (`aa8128a1`) found a real defect. An issue or a continue-here read the step as waiting before
it took the inquiry's lock, and never read it again. If a redemption committed in between, the
issue overwrote `redeemed` with `issued` and left a live token.

```
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/handoff/handoff-races.integration.test.ts)
     × refuses an issue that took the lock after a redemption committed, keeping the step redeemed
AssertionError: expected 'fulfilled' to be 'handoff_not_available'
     × refuses a continue-here that took the lock after a redemption committed
AssertionError: expected 'fulfilled' to be 'handoff_not_available'
      Tests  2 failed | 2 passed (4)
```

The other two races already held: of two simultaneous redemptions, and of a decline and a
redemption, one wins.

**GREEN** (`88931738`). `assertStepWaiting` re-reads the step under the inquiry's lock:

```
      Tests  4 passed (4)
```

## 6. The API cases (`services/handoff/flow-handoffs-cases.test.ts`)

These tests cover the branches the route walk does not reach:
- an SMS goes through the `phone_otp` rules, under the SMS-pumping guards;
- a refused send revokes its token (503);
- email needs a mail server;
- a phone neither issues nor rejects;
- the issuing country appears with its attribution;
- the organisation name falls back when the display name was cleared;
- the distance facts;
- the review on completion after a rejection.

They were written after GREEN. The first run failed only on the test's own setup: a `phone_otp` step
needs its `phone-number` configuration, and the desktop's start had already evaluated its address.
After that fix, 9 tests pass.

## The QR measurement (C96.5, decision 24)

**Method.** The flow was built with `vite build`, the component drawing through each library in
turn. A scratch config, outside git and since deleted, aliased `lean-qr` to an adapter for each
library, or to a stub drawing nothing for the baseline. Each build's JavaScript chunks were
compressed with `gzip -9` and summed. Load average 3.89 at the start, 4.14 at the end.

| Library | Bundle (gzip) | Added |
|---|---:|---:|
| none | 285,979 B | – |
| `lean-qr` 2.7.4 | 289,568 B | +3,589 B |
| `uqr` 0.1.3 | 289,972 B | +3,993 B |
| `qrcode` 1.5.4 | 295,258 B | +9,279 B |

**Cross-check.** The same encoders were bundled with esbuild alone (minified, ESM, browser, gzip
-9), with a shared 161 B renderer. The order is the same:

| Library | Added |
|---|---:|
| `lean-qr` | +3,557 B |
| `uqr` | +3,795 B |
| `qrcode` | +9,501 B |
| `qrcode/lib/core` | +7,909 B |

A sample handoff link encodes to identical matrices with `lean-qr` and `qrcode`.

**Chosen: `lean-qr` 2.7.4.**

## Final gates (foreground)

The API unit suite ran from `apps/api` as two blob shards, then a merge:

```
$ cat /proc/loadavg                                    # 11.82 6.47 4.25
$ pnpm exec vitest run --coverage --shard=1/2 --reporter=blob --outputFile=/tmp/fh-api-blobs/blob-1-2.json    # 3 min 58 s
$ pnpm exec vitest run --coverage --shard=2/2 --reporter=blob --outputFile=/tmp/fh-api-blobs/blob-2-2.json    # 3 min 18 s, load 7.63 to 8.96
$ pnpm exec vitest run --merge-reports=/tmp/fh-api-blobs --coverage
 Test Files  370 passed (370)
      Tests  4957 passed (4957)
Statements 96.17% · Branches 88.33% · Functions 97.92% · Lines 96.21%
services/handoff: Statements 89.97% · Branches 79.16% · Functions 97.43% · Lines 89.73%
```

The other packages and checks:

| Command | Result |
|---|---|
| `pnpm --filter @openverify/api typecheck` | clean |
| `pnpm --filter @openverify/api lint` | clean |
| `pnpm --filter @openverify/flow typecheck` | clean |
| `pnpm --filter @openverify/flow lint` | clean |
| `pnpm --filter @openverify/db typecheck` | clean |
| `pnpm --filter @openverify/db lint` | clean |
| `pnpm --filter @openverify/flow test` | 74 files, 1,076 tests passed; 95.24% statements, 89.24% branches (1 min 6 s, load 3.19 to 6.67) |
| `pnpm --filter @openverify/db test` | 88 files, 1,194 tests passed; 95.39% statements (1 min 18 s, load 5.79 to 11.82) |
| `pnpm test:integration` | db 65 tests in 14 files; API 172 tests in 31 files (4 min 24 s, load 6.55 to 16.39) |
| `pnpm typecheck` | 15 tasks successful (50 s) |
| `pnpm lint` | 15 tasks successful (1 min 41 s) |
| `pnpm format:check` | every file in Prettier style |

The flow files' own coverage:
- `src/handoff`: 87.4% statements, 88.05% branches;
- `src/steps/device-handoff`: 82.55% statements, 79.86% branches.

The e2e gate ran as four foreground calls, each under `/tmp/openverify-e2e.lock`:

| Call | Result | Duration | Load (before, after) |
|---|---|---|---|
| Mocked flow suite (`pnpm --filter @openverify/flow e2e`) | 79 passed | 20.7 s | 1.94, 5.75 |
| Full-stack shard 1/3 | 31 passed | 2.4 min | 5.45, 3.30 |
| Full-stack shard 2/3 | 31 passed | 5.0 min | 3.04, 1.44 |
| Full-stack shard 3/3 | 29 passed | 4.5 min | 1.32, 2.32 |

The full stack ran 91 tests in all.
