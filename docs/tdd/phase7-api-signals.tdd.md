# TDD record: api-signals (Phase 7, Workflow 7A Stage 3, family S)

**Area:** C90 and C91 and the server side of C94: the parsed device of a session, devices with their HMACs and key ids, `POST /flow/signals`, the collection tiers, the `inquiry-signals` job and sweep with `on-signal`, the `signal-config` publish rules, the session cap and the two session routes, and the device exits' masking.

**Base:** `06020103` (foundation-7a checkpoint (S)). Owned paths: `apps/api/src/services/signals/`, `apps/api/src/services/publish/signal-config.ts`, `apps/api/src/jobs/signals/`, `routes/server/devices.ts`, `routes/flow/signals.ts`, `packages/db/src/repositories/{devices,session-signals,signal-computations}.ts`, and the tests beside them.

**How the tests were run.** Foundation-7a's checkpoint (H) was mid-cycle in the shared tree while this ran: its schema was ahead of its migration, so every PGlite session insert failed there with a 500. Iteration therefore ran in a private worktree, `/tmp/as-wt`, at the shared `HEAD`, with this area's files copied in by a scratch `sync.sh`. Commits were always made from the shared tree, path-scoped. The final gates ran in the shared tree.

Commands, after `source scripts/env.sh`:
- db: `pnpm --filter @openverify/db exec vitest run src/repositories/signal-repositories.test.ts --coverage.enabled=false`
- API (from `apps/api`): `pnpm exec vitest run <files> --coverage.enabled=false`
- the Postgres race (from `apps/api`): `pnpm exec vitest run --config vitest.integration.config.ts src/jobs/signals/signals-races.integration.test.ts`

## Slice 1: the signal and device repositories (C90.5, C91.1, C91.2, C91.5, C94.2, C94.4, C94.5)

- **Stub `3f7f8279`:** `countInquirySessions`, `lockPendingSignalComputation`, `recordSignalComputationFailure`, `recordSessionDeviceFields`, `recordSdkSessionDeviceType` and `deviceIdentifierInputs`. These are names the tests need beside foundation's frozen stubs.
- **RED `0324d590`** (`packages/db/src/repositories/signal-repositories.test.ts`):
  ```
  × seals both members for the row, ignores a repeated sequence and keeps the first body
  × stores 200 bodies per session and counts the 201st and later ones, never storing them
  … 19 failed
  AssertionError: promise rejected "SignalRepositoryNotBuiltError: storeSessi…" instead of resolving
  SignalRepositoryNotBuiltError: listSessionSignalBodies is not built yet (api-signals)
  SignalRepositoryNotBuiltError: markSignalComputationsEnqueued is not built yet (api-signals)
  ```
  One case passed at RED for the wrong reason: "stores nothing for a session of another environment" expects a rejection, and the stub rejects. It is kept as a guard; at GREEN it rejects because the session lock finds no row.
- **GREEN `6c47f135`:** `Tests 20 passed (20)`.
  - Bodies are stored under the session's row lock, so the 200 cap holds under concurrent posts.
  - A repeat is checked before the cap, so a repeat is never counted as a drop.
  - Devices are found by the strict HMAC (web) or the `ANDROID_ID` HMAC, each under its key id. A randomised web session gets a device of its own, holding only the class.
  - The rebuild merges a device that meets its twin under the new key.

## Slice 2: the session paths (C91.1, C91.5, C93.2, C94.5)

- **RED `63ec3cab`** (`apps/api/src/services/signals/sessions.test.ts`):
  ```
  × writes the parsed browser, system and device type of the first flow call
  AssertionError: expected { status: 'active', …(34) } to match object { 'os-name': 'Windows', …(5) }
  × refuses a resume past max-sessions with 409, counting expired sessions, and creates none
  AssertionError: expected 200 to be 409 // Object.is equality
  Error: expected HTTP 200, got 501: … "Expiring the sessions of several inquiries is not built yet."
  Tests  9 failed | 2 passed (11)
  ```
  The two passing cases guard behaviour the stubs already had: an unparsable user agent leaves nulls, and an inquiry under its cap opens sessions.
- **GREEN `b5875436`:** `Tests 11 passed (11)`.
  - **Defect, and how it was fixed:** the GREEN run that preceded this commit combined my test with foundation's `routes/flow/session-signal-hooks.test.ts`. That run showed `6 failed | 14 passed`, and the commit went in anyway, because my command chain grepped for "Tests " rather than for a pass.
  - **Cause:** `sessions.ts` imported `services/inquiries.ts`, `inquiry-sessions.ts` and `one-time-links.ts`, and each of those imports `sessions.ts`. The hooks test's `vi.mock(…, importOriginal)` then bound the real `assertSessionCapInTx` inside `inquiries.ts`.
  - **Fix `0a284fd2`:** the three are loaded with `await import()` when called. `Tests 20 passed (20)` over both files.

## Slice 3: the device routes and masking (C91.2, C91.6, C107.5)

- **RED `6a74f464`** (`apps/api/src/routes/server/devices.test.ts`):
  ```
  × refuses a request without filter[inquiry-session-id] with 400 filter_required
  AssertionError: expected 501 to be 400 // Object.is equality
  Error: expected HTTP 200, got 501: … "Devices are not built yet."
  Tests  5 failed | 3 passed (8)
  ```
  The three passing cases are exits foundation-7a built: the 403 scope, the masked `included` device and the masked stored API log. They are guarded here.
- **GREEN `f871b873`:** `Tests 8 passed (8)`.

## Slice 4: the collection tiers and `POST /flow/signals` (C90.9, C94.2, C94.4, C94.6, P14, P23, V13, V15)

- **RED `2935c53d`** (`apps/api/src/routes/flow/signals.test.ts`). The first run failed on my helper, because consent answers 201, not 200. With the helper fixed before the commit:
  ```
  AssertionError: expected null to deeply equal { integrity: true, recognition: false }
  AssertionError: expected 501 to be 409 // Object.is equality
  Error: expected HTTP 202, got 501: … "Flow signals are not built yet."
  Tests  13 failed (13)
  ```
- **GREEN `f4d6680f`:** `Tests 13 passed (13)`. The test's `accept-language` example also changed: `zz-invalid-tag-value` is a well-formed BCP 47 tag, so `*` stands in for the dropped value.
- **Foundation's frozen-route test, `bbb1bc70`:** four assertions of 501 now assert the built answers. They are an empty device list, 404 for an unknown device or session, 409 `consent_required` before consent, and expire-all by `meta.inquiry-ids`. `Tests 8 passed (8)`.
- **The exempt case, `6a53ec2e`:** slice 5's publish rule now refuses a template without the notice in exempt mode. The case therefore makes its un-noticed template before the switch, and still checks that the run time collects no recognition.
- **The handoff session (V03).**
  - RED `a9d2b693`. Its fixture broke `inquiry_sessions_handoff_fields_together`, a failure for the wrong reason. It was corrected in `31ac3de7`, after which it failed for its reason:
    ```
    AssertionError: expected 202 to be 409 // Object.is equality
    Tests  1 failed | 13 skipped (14)
    ```
  - GREEN `f7090ba6`: `recordFlowSignals` reads `getEffectiveConsent`, which had landed at `HEAD` by then. `Tests 24 passed (24)` over the flow-signals and job files.

## Slice 5: the `signal-config` publish rules (C90.6, C90.7, C94.6, F31)

- **Stub `84848a7c`:** `reviewRuleProblems(rules, collected, definitionOf)` is pure and takes the registry lookup. This lets `signal_not_reviewable` be tested before 7B registers `list_match_count`, its first such signal.
- **RED `49b079b9`:**
  ```
  × refuses an unknown name with unknown_signal at its index
  × refuses a comparison that does not fit the value type
  × answers 422 with the first problem's code and every pointer
  Tests  8 failed | 3 passed (11)
  ```
  The three passing cases are the "passes" cases, which a stub that refuses nothing already meets.
- **Corrected RED `62bd874f`:** the API case had posted `signal-config` on the template create body, which refuses the member with 400 `Unrecognized key: "signal-config"`. It now publishes a draft version.
- **GREEN `fe304950`:** `Tests 11 passed (11)`.

## Slice 6: the `inquiry-signals` job, its sweep and `on-signal` (C90.2-C90.5, C90.7, C90.9; owner decision 5 after 6C)

- **RED `28690a0b`** (`apps/api/src/jobs/signals/process.test.ts`):
  ```
  Error: the inquiry-signals job is not built yet (api-signals)   (× 9)
  AssertionError: expected [] to deeply equal [ { …(2) } ]         (the sweep)
  Tests  10 failed (10)
  ```
- **Corrected RED `c7efc082`:** the first GREEN run failed one case:
  ```
  AssertionError: expected 'completed' to be 'needs_review'
  ```
  The injected loopback address reads `address_not_public`, an `ignore` reason. The case now starts its session from `203.0.113.70`, which no loaded data covers here, giving `list_unavailable`, a gap. It asserts that reason.
- **GREEN `f53015a5`:** `Tests 10 passed (10)`. The db repository file passed again (`20 passed`) after the pending row gained `inquiryRedacted`. The worker, queue, repeatable and hook tests also passed (`33 passed`).
- **The Postgres race, `97bf5e99`:** written after the implementation.
  - With the redaction check removed from a copy of `process.ts` in the private worktree, it failed:
    ```
    × a job that meets the redaction waits for its commit, then skips: nothing computed, not moved
    AssertionError: expected { outcome: 'computed', …(2) } to deeply equal { outcome: 'skipped', …(2) }
    Tests  1 failed | 1 passed (2)
    ```
  - Against the real code: `Tests 2 passed (2)`, `Duration 10.19s`.
- **Handoff sessions in the job, `8e0ef497`:** written after `f7090ba6`. With the handoff and rejection checks removed from a copy, it failed:
  ```
  AssertionError: expected 95 to be 5 // Object.is equality
  ```
  `Tests 11 passed (11)` against the real code.

## Decisions taken here

- **The collection tiers (`collectionTiersOf`).**
  - Integrity needs the setting `on` and `notice.session-integrity` among the consent's shown keys.
  - Recognition in `consent` mode needs the ticked `consent.device-recognition`. In `exempt` mode it needs `notice.device-recognition` shown, with the optional tick not offered.
  - After consent the member is an object even when no tier applies (`{ integrity: false, recognition: false }`); `null` means "before consent".
  - `POST /flow/signals` answers 409 `consent_required` whenever no tier applies.
- **`signals-collected`** is recorded when `GET /flow/session` reports the tiers, and again with each body. The signals job can then tell `collector_missing` from `collection_disabled` for a consented session that sent nothing.
- **What a body keeps:**
  - integrity keeps `integrity` or `android-integrity`, the behaviour, and the request's header facts (`components.request`, from `parseSignalRequestHeaders`);
  - recognition keeps `recognition` or `android-recognition`;
  - `device-class` and a sandbox `sandbox-outcome` ride with whichever tier applies.
- **The device identifier texts** are canonical JSON with sorted keys.
  - Strict: the screen bucket, concurrency, memory, touch points, the GPU strings and the canvas digest, with `platform: web`.
  - Class: the same without the canvas.
  - Android: the lower-case `ANDROID_ID`.
  - `deviceHmacs` (db) gives the write path and the rebuild one implementation.
- **A consented session (job):**
  - it recorded consent itself; or
  - it was not created by a handoff and was created after the effective consent it inherits.

  A handoff session counts only on its own consent, and a rejected one never.
- **The sweep** re-enqueues a row not enqueued within 2 minutes, 500 rows a tick. It marks a redacted inquiry's row `skipped` without enqueuing it.
- **`on-signal`:**
  - only `completed` moves, to `needs_review`;
  - `approved`, `declined` and `needs_review` record `inquiry_already_decided` with the matched rules;
  - `failed` and `expired` record the match's cause without a move;
  - the result, `review` included, is checked against `signalDetailsSchema` and `signalAttributeIssues` before anything is frozen or moved.
- **The publish rules:**
  - a `false` operand on a never-false flag is `signal_rule_invalid`;
  - a country operand must be an upper-case alpha-2 code;
  - `consent_text_missing` in exempt mode points at the step's `textKeys` (no notice), and in consent mode at its `optionalTextKeys`.
