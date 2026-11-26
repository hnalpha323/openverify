# TDD evidence: Phase 1, contracts

Slice owner: contracts agent (Workflow 1A, Stage 1). Date: 2026-10-20.

Owned paths:
- `packages/contracts` (new, `@openverify/contracts`);
- `packages/node` (new, `@openverify/node`);
- `contracts/fixtures/{api,flows,webhooks}` and `contracts/README.md`;
- `apps/api/src/ports.ts` and the stubs `apps/api/src/{events,jobs,vision,storage}/index.ts` and `apps/api/src/routes/dashboard/index.ts`, with their tests;
- `apps/api/package.json` (workspace dependencies only).

## Plan task

From `docs/plans/phase-1.plan.md`, Stage 1 "contracts": C1 to C5 and C7 to C8 (except the vision fixtures) as zod schemas with tests, `packages/node`, `ports.ts` and the stubs.

1. **`@openverify/contracts`** (browser-safe):
   - ULID-based IDs (`newId`, `isId`, `idSchema`, `ID_PREFIXES`);
   - session tokens, user session tokens and webhook secrets, with the flow URL helpers;
   - JSON:API envelopes, pagination and problem+json;
   - resources: inquiry, inquiry template (with its current version), verification (government ID and selfie, full and flow views), file, event, webhook (write-once secret), user, API key;
   - request bodies and queries for C2 to C4, the flow session response (C3) and the dashboard session response (C4);
   - `EVENT_NAMES`, `RESOURCE_TYPES`, `API_SCOPES`, file kinds, accepted MIME types and the 10 MiB limit;
   - pure domain-to-API mappers and validated resource builders.
2. **`@openverify/node`** (server-only): `signWebhookPayload`, `verifyWebhookSignature` and `computeWebhookSignature`, with golden vectors.
3. **Fixtures**: the seven C8 API fixtures, `flows/default-gov-id-selfie.json` and `webhooks/signature-vectors.json`.
4. **`apps/api`**: `ports.ts` (`FileStorage`, `VerificationQueue`, `EventPublisher`, `VisionClient`, `Clock`, `IdGenerator`) and the fixed-name stubs.

Dependencies. No new third-party package. `@openverify/contracts` depends on `zod` (already in the workspace, MIT, checked with `pnpm view zod@4.6.7 license`), `@openverify/core` and `@openverify/flow-spec`. `@openverify/node` has no runtime dependency. `apps/api` gains the workspace dependencies `@openverify/contracts` and `@openverify/node`.

## Decisions taken while planning

- **IDs.** Own ULID encoder: 48-bit time and 80 random bits from `globalThis.crypto`, as 26 Crockford base32 characters. The pattern is strict, so the first character is `0` to `7`. Reference vectors came from an independent Python encoder; the spec timestamp `1469918176385` gives `01ARYZ6S41`. `idSchema` returns a plain `z.ZodString`, so database rows map onto it without casts.
- **Browser safety.** It is enforced twice. `tsconfig.build.json` builds with `types: []` and the DOM lib, so a Node global cannot compile. `browser-safety.test.ts` also scans every runtime source for `node:` imports, `require`, `Buffer` and `process.`.
- **No transforms in response schemas.** `fastify-type-provider-zod` serializes with `z.encode`, which rejects one-way transforms. The fixture test round-trips every fixture through `z.encode`. `json-schema.test.ts` converts every exported schema with `unrepresentable: 'throw'`, for both input and output.
- **Defensive refinements.** Probing zod 4.6.7 showed that object refinements still run after a *format* failure: an invalid URL is continuable, a wrong type is not. A `new URL()` inside a refinement threw out of `safeParse`. Every refinement therefore uses non-throwing helpers (`safeUrl`, `Map` lookups).
- **Enum values** stay the `@openverify/core` values (`needs_review`, `not_applicable`, `drivers_license`). Only verification types change spelling: `government-id` in bodies and config keys, `verification/government-id` as a resource type. The DB enum `check_requirement` uses the same `required` / `not_required` values.
- **The flow view hides fraud details.** `GET /flow/session` verifications and `GET /flow/verifications/:id` carry only `status`, `retry-hints` and timestamps. `retryHintSchema` rejects any hint naming a non-`user_behavior` check, so a leak fails serialization.
- **The webhook secret is write-once.** Read schemas are strict and have no `secret` member. Only the creation schema has it, and it must end with `secret-last4`.
- **Template rules beyond C2:**
  - only the step types Phase 1 clients run (consent, government_id, selfie, completion, failure);
  - one step per verification type;
  - the flow and the config must name the same verifications;
  - at least one verification step;
  - at least one enabled, required check per configured type, so no verification can pass unchecked.
- **The default flow (C7)** routes a failed inquiry to the `failure` step with JSONLogic over `{ inquiry: { status } }` (`flowConditionContext`). The fixture is the attributes of a create-template request, so seeds and e2e can post it as-is.
- **Reason codes** for the seven C7 checks are listed in `PHASE1_CHECK_REASONS`, so the worker (producer) and the clients (translators) agree. `NOT_IMPLEMENTED_REASON` is `not_implemented`.
- **Webhook signatures:**
  - `verifyWebhookSignature` **throws** `WebhookSignatureError` (`malformed_header`, `no_matching_signature`, `timestamp_outside_tolerance`) and returns `{ timestamp }` only on success. A result object is truthy, so a forgotten check would accept forged deliveries; a throw fails closed.
  - Invalid arguments throw `TypeError` or `RangeError`.
  - The tolerance applies in both directions.
  - The header grammar is strict: no leading zeros, at most 12 digits (which also catches milliseconds), and at most 8 space-separated `v1` values.
  - Every secret and candidate pair is compared with `timingSafeEqual`.
  - The vectors were generated with Python's `hmac` and cross-checked with `openssl dgst -sha256 -hmac`.
- **Stubs** are factories returning objects whose methods reject with `NotImplementedError(feature, owner)`. A throwing factory would break any Stage 2 wiring that builds a container before the owner lands. `dashboardRoutes` is a plugin that registers nothing.
- **gitleaks.** The first cycle-2 commit was blocked: `generic-api-key` matched the property name `apiKey:` holding the synthetic ID `key_01M5...`. The property was renamed (`serverIntegration`) instead of adding an ignore entry.

## Tests (written first)

`packages/contracts` (466 tests, 21 files):
- `ids.test.ts`: the prefix map; ULID vectors (spec, zero, max, sequence, mixed); lexicographic time order; range and length errors; `ulidTime`; `isId` with prefix confusion (`itmpl` vs `itmplv`), lowercase, `U`, overflow, UUIDs and newlines; the JSON Schema pattern.
- `tokens.test.ts`: RFC 4648 base64url vectors; `ovs_`, `ovu_` and `wbhsec_` formats with 43 characters; injected randomness; TTLs; `webhookSecretLast4`.
- `flow-url.test.ts`: the fragment (never the query); base path and trailing slashes; rejected bases (relative, `javascript:`, query, fragment, credentials); a round trip; duplicates and malformed values return `null`.
- `json-api.test.ts`, `problem.test.ts`: timestamps in UTC only; strict resource objects and relationships; single, list and request documents; `page[size]` coercion; problem members and extension members.
- `vocabulary.test.ts`, `verification-types.test.ts`: resource types, scopes and event names, which reuse `INQUIRY_EVENT_BY_STATUS`; `isEventName`; `PHASE1_CHECKS` against `CHECK_REGISTRY`; reason codes; every mapper both ways; prototype keys; the typed `UnsupportedVerificationTypeError`; decision to status; requirement.
- `files.test.ts`: kinds per type; `requiredFileKinds` for sides and poses; magic-byte sniffing of JPEG, PNG and WebP plus 7 rejects; the file resource without filename; kind and verification-type agreement; the builder.
- `inquiry-templates.test.ts`: config key spelling; unknown and wrong-type checks; the `id_selfie_comparison` mirror; the enabled-and-required rule; flow-spec errors; config and step agreement; unsupported steps; duplicate steps; no verification step; the default template (`parseFlow`, steps, transitions, the exact C7 checks, fresh copies); the version resource and builder; the list query.
- `inquiries.test.ts`, `verifications.test.ts`, `events.test.ts`, `webhooks.test.ts`, `users.test.ts`, `api-keys.test.ts`: each resource and builder; strictness (no camelCase, no leaked `secret`, `token`, `password` or check `type`); fields; reference IDs; queries; resume meta (the token sits in a matching fragment, and the URL names the same inquiry); retry hints never name fraud checks; events must match their payload type; webhook URLs, events, bodies and constants.
- `flow-api.test.ts`, `dashboard-api.test.ts`: the session response, which has no checks or config; consent, locale, create-verification and upload fields; the condition context; login bounds (Argon2id DoS); session and detail documents.
- `fixtures.test.ts`: the C8 list is exact; every fixture parses and survives `z.encode` unchanged; synthetic-data guards (`@example.test` emails only, no `embedding`); semantic checks per fixture; the default flow fixture passes `parseFlow`, enables exactly C7 and equals `defaultInquiryTemplateAttributes()`.
- `json-schema.test.ts`: every exported schema (more than 50) converts to JSON Schema for both input and output.
- `browser-safety.test.ts`, `index.test.ts`.

`packages/node` (61 tests): all 3 sign vectors, the rotation vector and 24 verify vectors from `contracts/fixtures/webhooks/signature-vectors.json`; bytes vs string vs `Buffer`; timestamp and secret argument errors; header edge cases (missing, null, repeated, too long, too many signatures, the maximum); error hygiene (no secret or signature in the message); constants against `@openverify/contracts`. `webhook-signature.timing.test.ts` mocks `node:crypto` and checks that every candidate goes through `timingSafeEqual` with 32-byte buffers.

`apps/api` (+12 tests): `NotImplementedError`, `systemClock`, `ulidIdGenerator`. A compile-time to runtime bridge (`Record<keyof T, true>`) checks that the vision port types list exactly the keys of `contracts/fixtures/vision/*.json`. One test per stub checks the rejection and its owner, and that `dashboardRoutes` registers no routes.

## RED and GREEN

Every RED run used `pnpm exec vitest run --coverage.enabled=false` in the package directory (`source scripts/env.sh` first). Each RED state was committed as `test(...)` before its implementation.

### Cycle 1: IDs, tokens, flow URL, envelopes, problem (`packages/contracts`)

RED (commit `0c165fe`):
```
 FAIL  src/flow-url.test.ts [ src/flow-url.test.ts ]
Error: Cannot find module './flow-url.js' imported from .../packages/contracts/src/flow-url.test.ts
 FAIL  src/ids.test.ts [ src/ids.test.ts ]
Error: Cannot find module './ids.js' imported from .../packages/contracts/src/ids.test.ts
 FAIL  src/json-api.test.ts [ src/json-api.test.ts ]
Error: Cannot find module './json-api.js' imported from .../packages/contracts/src/json-api.test.ts
 FAIL  src/problem.test.ts [ src/problem.test.ts ]
Error: Cannot find module './problem.js' imported from .../packages/contracts/src/problem.test.ts
 FAIL  src/tokens.test.ts [ src/tokens.test.ts ]
Error: Cannot find module './tokens.js' imported from .../packages/contracts/src/tokens.test.ts
 FAIL  src/browser-safety.test.ts > @openverify/contracts is browser-safe > has runtime sources to check
AssertionError: expected [] to include 'index.ts'
 Test Files  6 failed (6)
      Tests  1 failed (1)
```

GREEN (commit `04ba7ba`). `pnpm exec vitest run`, `pnpm run typecheck`, `pnpm run lint` and `pnpm run build` (no Node types) all passed:
```
 Test Files  6 passed (6)
      Tests  116 passed (116)
Branches     : 100% ( 58/58 )
```

### Cycle 2: C1 to C5 resources, bodies, events and golden fixtures (`packages/contracts`, `contracts/fixtures/{api,flows}`)

RED (commit `bed855b`, abbreviated):
```
 FAIL  src/api-keys.test.ts [ src/api-keys.test.ts ]
Error: Cannot find module './api-keys.js' imported from .../packages/contracts/src/api-keys.test.ts
 FAIL  src/dashboard-api.test.ts [ src/dashboard-api.test.ts ]
Error: Cannot find module './dashboard-api.js' ...
 FAIL  src/events.test.ts / files / fixtures / flow-api / inquiries / inquiry-templates / users /
       verification-types / verifications / vocabulary / webhooks  (same: module not found)
⎯⎯⎯⎯⎯⎯ Failed Tests 16 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/index.test.ts > @openverify/contracts entry point > re-exports RESOURCE_TYPES
AssertionError: expected { …(43), …(1) } to have property "RESOURCE_TYPES"
```

GREEN (commit `dfc369b`):
```
 Test Files  21 passed (21)
      Tests  465 passed (465)
Statements   : 100% ( 406/406 )
Branches     : 100% ( 141/141 )
Functions    : 100% ( 97/97 )
Lines        : 100% ( 403/403 )
```
The first typecheck after GREEN found three test-typing errors: a readonly tuple in a step literal, an optional config entry, and a type predicate over the module namespace. It also found one lint suggestion (`prefer-optional-chain`). All were fixed before the commit.

### Cycle 3: `@openverify/node` (`packages/node`, `contracts/fixtures/webhooks`)

RED (commit `5e33b0b`):
```
 FAIL  src/index.test.ts [ src/index.test.ts ]
Error: Cannot find module './index.js' imported from .../packages/node/src/index.test.ts
 FAIL  src/webhook-signature.test.ts [ src/webhook-signature.test.ts ]
Error: Cannot find module './webhook-signature.js' imported from .../packages/node/src/webhook-signature.test.ts
 FAIL  src/webhook-signature.timing.test.ts [ src/webhook-signature.timing.test.ts ]
Error: Cannot find module '/src/webhook-signature.js' imported from .../packages/node/src/webhook-signature.timing.test.ts
 Test Files  3 failed (3)
      Tests  no tests
```

GREEN (commit `9890bef`). The first draft had three unreachable branches: a length check the regex already guarantees, destructuring defaults, and a `?? ''`. They were replaced with straight-line parsing, so 100% branch coverage is real coverage.
```
 Test Files  3 passed (3)
      Tests  61 passed (61)
Statements   : 100% ( 67/67 )
Branches     : 100% ( 46/46 )
```

Independent check of the first vector:
```
$ printf '%s' '1792497600.{"data":{"type":"event","id":"evt_01M5CJXHG0041061050R3GG28A","attributes":{"name":"inquiry.completed"}}}' \
    | openssl dgst -sha256 -hmac wbhsec_test_ONLY_not_a_real_secret_000000000000001
SHA2-256(stdin)= f587c9b9ce4808782b55e3df7f7cb6ec2697342bff845bd51cf8fb613ce45637
```

### Cycle 4: ports and stubs (`apps/api`)

RED (commit `cc0a8f4`), with `pnpm exec vitest run --coverage.enabled=false src/ports.test.ts src/events src/jobs src/vision src/storage src/routes/dashboard`:
```
 FAIL  src/ports.test.ts [ src/ports.test.ts ]
Error: Cannot find module './ports.js' imported from .../apps/api/src/ports.test.ts
 FAIL  src/events/index.test.ts / jobs / storage / vision  (Cannot find module '../ports.js')
 FAIL  src/routes/dashboard/index.test.ts [ src/routes/dashboard/index.test.ts ]
Error: Cannot find module './index.js' imported from .../apps/api/src/routes/dashboard/index.test.ts
 Test Files  6 failed (6)
      Tests  no tests
```

GREEN (commit `6a3eb35`): the whole `apps/api` suite passed, and every new file is 100% covered.
```
 Test Files  10 passed (10)
      Tests  65 passed (65)
Statements   : 99.28% ( 139/140 )
Branches     : 89.36% ( 84/94 )     (uncovered branches are all in Phase 0 files)
```

### Refactor (commit `974048b`)

The refactor removed three type casts from production code:
- `isEventName` (a new type guard, first seen failing with `TypeError: isEventName is not a function`);
- a `CheckOutcome` input type for `retryHintsFromChecks`;
- a file-kind owner map derived from `SUPPORTED_VERIFICATION_TYPES`.
```
      Tests  466 passed (466)
Branches     : 100% ( 142/142 )
```

## Final verification (shared tree, 2026-10-20)

```
$ pnpm --filter @openverify/contracts --filter @openverify/node --filter @openverify/api test
 contracts: Test Files 21 passed, Tests 466 passed, Statements/Branches/Functions/Lines 100%
 node:      Test Files 3 passed,  Tests 61 passed,  Statements/Branches/Functions/Lines 100%
 api:       Test Files 10 passed, Tests 65 passed,  Statements 99.28%, Branches 89.36%, Functions 100%, Lines 99.24%
$ pnpm --filter @openverify/contracts --filter @openverify/node --filter @openverify/api typecheck   # tsc --noEmit x3, no errors
$ pnpm --filter @openverify/contracts --filter @openverify/node --filter @openverify/api lint        # eslint . x3, no problems
$ pnpm --filter @openverify/config test
 Test Files  2 passed (2)
      Tests  39 passed (39)      # includes @openverify/contracts and @openverify/node conventions
$ (packages/contracts) pnpm run build    # tsc -p tsconfig.build.json with types: [] -> OK
$ (packages/node) pnpm run build         # OK
$ (apps/api) pnpm run build              # OK
$ pnpm exec prettier --check <owned files>   # All matched files use Prettier code style!
```
gitleaks ran on every commit through the pre-commit hook: `no leaks found`.

## Not done here (see the report's follow-ups)

- `pnpm-lock.yaml` was updated by `pnpm install` but not committed. The same file also held the db agent's uncommitted dependency changes, and the plan gives the final lockfile commit to the integration agent.
- `docs/PROGRESS.md` is outside this slice's paths.
