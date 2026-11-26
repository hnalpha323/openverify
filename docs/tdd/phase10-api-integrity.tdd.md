# Phase 10, Workflow 10B: api-integrity (family I) TDD evidence

Owner: `api-integrity` (Stage 2, after foundation-10b). Base: foundation-10b's last commit `df76d8df`.
Every step below was run in `/home/mhnoor/persona-opensource` after `source scripts/env.sh`; the
outputs are abbreviated (failing names and the summary line).

## Slice 1: the five signals and the debugger rules (C210.4, C211.5, 10B Stage 1a amendment 17)

- Stub `2e21deaf`: `packages/checks/src/signals/device-integrity.ts` (names only), the input types
  (`AndroidIntegrityInput`, `DeviceIntegrityInput`, `IntegrityVerdictProjection`).
- RED `4856a0b3`:

```
$ (cd packages/checks && pnpm exec vitest run src/signals/device-integrity.test.ts src/signals/bot-score.test.ts src/signals/compute.test.ts src/signals/rules.test.ts --coverage.enabled=false)
 × pins BOT_SCORE_RULES and its step types with inquiry/bot_score
 × places every code of the contract lists in one family, and nothing else
 × golden: an emulator is true with its codes in contract order and a two-family confidence
 × golden: a clean device is never false: every heuristic is null with no_indicator_found
 × maps UNEVALUATED to null with integrity_unevaluated, never false
 × golden: provider_not_configured when no provider is bound, with no source
 × golden: neither fact reads the low band with no_artefact_found and its capped confidence
 × golden: a connected debugger is medium evidence and an automation artefact, never strong
 ... (26 failed)
      Tests  26 failed | 62 passed (88)
   AssertionError: inquiry/device_emulated: expected 'collector_missing' to be 'no_indicator_found'
   AssertionError: expected 'collector_missing' to be 'provider_not_configured'
   AssertionError: expected null to deeply equal { score: +0, confidence: 0.2, … }
$ (cd packages/core && pnpm exec vitest run src/signal-registry.test.ts --coverage.enabled=false)
 × holds every cut-off a signal applies: the two weak rules join the bot score (K7A-12)
 × pins every entry and the collector by version (golden)
      Tests  2 failed | 16 passed (18)
```

- GREEN `b5bbe396`: `bot_score` v3 and `automation_artefact_count` v2 (inputs gain
  `android-integrity`), the two rules, the families, the Play Integrity readings.

```
$ (cd packages/checks && pnpm exec vitest run src/signals --coverage.enabled=false)
      Tests  177 passed (177)
$ (cd packages/core && pnpm exec vitest run src/signal-registry.test.ts --coverage.enabled=false)
      Tests  18 passed (18)
```

  New digest of the bot score's table (computed independently by a Python canonical-JSON script
  that first reproduced the old `63a10f39d871d54c`): `3:2e4a4601fc0a8f7e`. Changed with the plan
  (rule 12): the rule-listing test gains the two rules; the Android compute golden now reads a score
  and a count; core's version pins move to `3:` and `2:` (thresholds unchanged).

## Slice 2: the integrity repository (C211.3, C211.4)

- Stub `fbdc3570` (`readInquiryIntegrityToken`, `inquiryIntegrityTokenTaken`); RED `0e795ce9`:

```
$ (cd packages/db && pnpm exec vitest run src/repositories/inquiry-integrity.test.ts --coverage.enabled=false)
 × writes a challenge for its inquiry and session, without a token
 × takes a token once, sealed for its row, for the session that asked, before the expiry
 × takes one token per inquiry, whichever challenge it comes for
 ... IntegrityRepositoryNotBuiltError: createInquiryIntegrityChallengeInTx is not built yet (api-integrity)
      Tests  8 failed (8)
```

- GREEN `e463c2b5`: `Tests  21 passed (21)` (with foundation-10b's table test, whose stub test left).

## Slice 3: the routes and the session member (C211.1, C211.3)

- Stub `583fd232`'s parent `440d4049` carries the RED with the `challenges.ts` stub:

```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/integrity.test.ts --coverage.enabled=false)
 × asks for a token only after consent under the session-integrity tier
 × draws a challenge bound to the session, expiring in 600 s
 × takes the token once, sealed, and enqueues the decode with ids only
 ...  Error: expected HTTP 201, got 501: {"title":"Not Implemented","status":501,...}
      Tests  9 failed | 1 passed (10)
```

- GREEN `583fd232`: `Tests  20 passed (20)` (with foundation-10b's route and member tests). The
  routes keep the frozen 501 in their documented problems (route schemas and the snapshot are
  integration-10b's), so `src/openapi.test.ts` stays green.

## Slice 4: the providers (C211.4, review P12)

- Stub `2bd7993e`; RED `74f98ce6`: `Tests  12 failed (12)` ("play-integrity is not built yet").
- GREEN `50e826cf`: `Tests  18 passed (18)` (with foundation-10b's binding test, now decoding a
  magic token).

## Slice 5: the decode job (C211.4, owner decision 5 after 6C)

- RED `6bfd147b`: `Tests  7 failed (7)` (the stub's `integrity_decode_not_built`), including
  "writes nothing for an inquiry redacted after its token was posted" and "... while its token was
  being decoded".
- GREEN `85db9c84`: `Tests  13 passed (13)` (with foundation-10b's worker test, off the stub).

## Slice 6: the signal computation's Play Integrity facts and C211.7

- Stub `5c0bd01b`; RED `b28c37e5`: `Tests  4 failed | 3 passed (7)` (the C211.7 guards pass from
  the start: they hold today's code to the rule).
- GREEN `d2f4bd00`: `Tests  19 passed (19)` (the device-integrity service folder).

## Slice 7: play-integrity's settings (foundation-10b amendment 8)

- Stub `8463b8e5` (the config member answering `null`, the binding option); RED `27a13e7d`:

```
$ (cd apps/api && pnpm exec vitest run src/play-integrity-config.test.ts src/config.test.ts --coverage.enabled=false)
 × are read by the worker while play-integrity is bound
 × stop the worker when one is missing while play-integrity is bound
 × refuse a malformed value without echoing it
      Tests  3 failed | 98 passed (101)
```

- GREEN `e8e76d74`: `Tests  101 passed (101)`; `bash infra/tests/compose.test.sh`: 541 passed.
  The implementation was written before its test; it was set aside (my own uncommitted edits, by
  copying the committed files back) to watch the test fail first, then restored.

Checkpoint 1: `1a687648`.

## Slice 8: the publish rules (C210.5, C211.5, C211.9; review V05)

- Stub `53f76ed3` (borrowed edits: the analyses' `deviceIntegrityBound`, the adverse step's
  `nonDecisiveSignals` and `undecidedSignals`, the publish report's flag); RED `18f7ca07`:

```
$ (cd packages/flow-spec && pnpm exec vitest run src/v2/analyses-integrity.test.ts --coverage.enabled=false)
 × golden: refuses a failure right after a route on a device heuristic
 × golden: and with a trivially true fact changes nothing
 × golden: or with an unrelated fact changes nothing
 × golden: refuses a Play Integrity signal, A-tier, the same way
 × golden: refuses a failure behind else: the routes after the signal’s depend on it
 × golden: a verification with no route on its outcome is not enough
 × golden: asks it for an A-tier Play Integrity route that skips a step
 × refuses a route on a Play Integrity signal where no provider is bound
 × golden: refuses a bound environment’s collection without notice.play-integrity
      Tests  9 failed | 6 passed (15)
$ (cd packages/workflow-engine && pnpm exec vitest run src/graph/analysis-integrity.test.ts --coverage.enabled=false)
      Tests  5 failed | 1 passed (6)
$ (cd apps/api && pnpm exec vitest run src/workflows/publish/rules-integrity.test.ts --coverage.enabled=false)
   AssertionError: production: expected [] to deeply equal [ ObjectContaining{…} ]
      Tests  3 failed | 1 passed (4)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/device-integrity/publish-rules.integration.test.ts)
   AssertionError: expected [ Array(1) ] to include 'play_integrity_notice_missing /flow/s…'
   AssertionError: expected [ …(3) ] to include 'signal_not_decisive_alone /flow/steps…'
      Tests  2 failed | 1 passed (3)
```

  (The passing cases are the ones a rule must leave alone: a verification gate, a route before the
  signal's, the coupled limit, a decisive signal.)
- GREEN `ca192d63`: flow-spec 28 passed (with Phase 9's analyses tests); workflow-engine
  `src/graph` 200 passed; API `src/workflows/publish src/services/publish` 152 passed; the
  Testcontainers file 3 passed.
- `provider_not_bound` for a review rule: RED `65a8df954`:
  `Tests  1 failed | 1 passed (2)` (`expected [] to deeply equal [ Array(2) ]`); GREEN `97214327`:
  14 passed with Phase 7's signal-config tests.

## Slice 9: the request fixtures (C224.4)

- `da4b1c47`: device-integrity-android's three fixtures parse, draw a challenge and post a token
  through the built routes, and reach the device signals (3 passed; a guard over committed files).

## Formatting trap

`.prettierignore`'s bare `services/` skips `apps/api/src/services/`, so the device-integrity files
are checked with `pnpm exec prettier --check --ignore-path=.gitignore` (formatted in `97214327`).
`signal-config.ts` was unformatted at the base and stays so outside the lines this agent added.

Checkpoint 2: `9c7d217c`.

## Final gates (rule 24, this agent's packages; each exit code read from the command)

| Gate | Result | Time | Load |
|---|---|---|---|
| `pnpm format:check` | exit 0 (after `f84d01d9` formatted the decode test) | | 1.1 |
| forced typecheck and lint: checks, core, db, flow-spec, workflow-engine | exit 0, 10 tasks | 151 s | 1.5 |
| forced typecheck and lint: api (heavy) | exit 0, 2 tasks | 271 s | 2.1 |
| forced typecheck: dashboard (heavy) | exit 0 | 51 s | 1.3 |
| checks | 3,849 passed, 98.79 % lines | 23 s | 1.2 |
| core | 1,659 passed, 99.14 % | 9 s | |
| flow-spec | 469 passed, 97.15 % | 5 s | |
| workflow-engine | 1,990 passed, 98.24 % | 18 s | |
| db (heavy) | 2,205 passed, 91.16 % | 161 s | 3.7 |
| API, 12 blob shards (heavy) | each exits 1 on its partial coverage only | 98-132 s | 6.8-9.9 |
| API merge | exit 0: 710 files, 9,560 tests, 94.41 % statements | 46 s | 7.8 |
| `pnpm --filter @openverify/db test:integration` | 81 passed | 95 s | 3.9 |
| integration `--project graph` | 13 passed (template 16,020 ms of 180 s) | 34 s | 15.5 |
| integration `--project api --shard=1/3`, `2/3`, `3/3` | 97, 101, 90 passed | 79, 168, 85 s | 9.9, 15.7, 9.3 |
