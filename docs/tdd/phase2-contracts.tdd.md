# TDD evidence: Phase 2, contracts-v2

Slice owner: contracts-v2 agent (Workflow 2A, Stage 1, in parallel with db-v2). Date: 2026-10-20.

Owned paths:
- `packages/contracts/**`;
- `packages/core/**`;
- `contracts/fixtures/{api,flows,webhooks}/**` and `contracts/README.md`.

## Plan task

From `docs/plans/phase-2.plan.md`, Stage 1 "contracts-v2": the C9 to C20 schemas and fixtures, and the core additions. api-foundation starts on this public surface, so the exported names were finished first.

1. **`@openverify/core`:**
   - `verification-state-machine.ts`: the C10 table, `transitionVerification()` returning the event name, `InvalidVerificationTransitionError`;
   - `permissions.ts`: `API_SCOPES` (C2 + C12), `PERMISSIONS`, `BUILTIN_ROLES`, `permissionsForRoles()`, `isPermission()`, `missingPermissions()`;
   - `tags.ts`: the C9 tag rules;
   - `webhook-payload.ts`: `applyAttributeBlocklist()`, `matchesWebhookFilters()`, `webhookFilterSubject()`;
   - `check-config.ts` and `CHECK_REGISTRY[].configSchema`: the four C11 config schemas;
   - `decision-engine.ts`: the per-type template config v2 (per-check `config`, `allowed-countries`, `allowed-id-classes`).
2. **`@openverify/contracts`:**
   - vocabulary: ID prefixes, `ovo_`/`ovm_`/`ovi_` tokens, recovery codes, resource types, scopes, the C17 events, `PROBLEM_TYPES`, the inactive-session codes, `API_VERSIONS`, platform headers, environment kinds, redaction, tags, list filters, action bodies, one-time link URLs;
   - every C9 to C16 resource with a validated builder, and the changes to inquiry, inquiry template, webhook, event, user and flow session;
   - request bodies, action meta and list queries for every C10 to C15 endpoint, and the C10 redeem body and response.
3. **Fixtures:** the twelve C20 API fixtures, the Phase 1 API fixtures updated to what Phase 2 servers send, and dual-signature vectors.

No new dependency. `@openverify/contracts` and `@openverify/core` still depend only on `zod` and workspace packages.

## Decisions taken while planning

- **Attributes added to Phase 1 resources are optional in the schemas.** Builders send them only when the record carries them. This applies to:
  - inquiry: `tags`, `note`, `expires-at`, `redacted-at`, `decisioned-at` and the `account` relationship;
  - inquiry template: `status`, and the embedded version's `settings`;
  - webhook: `api-version`, `custom-headers`, `filters` and `attribute-blocklist`;
  - event: `simulated`;
  - user: `name`, `status` and the `roles` relationship;
  - flow session: `environment`.

  There are two reasons. Event payloads stored before Phase 2 must still validate when they are served or replayed. Phase 1 code and tests outside my paths (apps/api, apps/dashboard, apps/flow) also keep compiling and passing until their Stage 2 and 2C owners populate the new fields. New Phase 2 resources have every attribute required.
- **Single sources of truth in core.** `API_SCOPES` and `VERIFICATION_EVENT_BY_STATUS` now live in core next to `PERMISSIONS` and the state machine; contracts re-exports them. A test checks that `contracts.API_SCOPES` is the same object.
- **`transitionVerification()` returns `null` for `→ confirmed`**, because C5 and C17 name no `verification.confirmed` event.
- **Tags.**
  - "Letters" includes combining marks (`\p{M}`), so scripts such as Devanagari can be tagged.
  - Length counts code points, as Postgres does.
  - Commas are impossible, so `filter[tag]=a,b` is unambiguous.
  - The case-insensitive key upper-cases and then lower-cases, so `Straße` and `STRASSE` are one tag.
- **List filters** stay plain strings checked by a refinement. Query schemas must convert to JSON Schema for both input and output, so they carry no transforms. `filterValues(value, schema)` gives the API typed arrays. `filter[reference-id]` stays single-valued, because reference IDs may contain commas.
- **Event payloads.**
  - `eventPayloadSchema` is the payload an event is created with.
  - `redactedEventPayloadSchema` is the C16 stub `{ data: { type, id, attributes: { redacted-at } } }`.
  - `storedEventPayloadSchema` accepts either one, and types the event resource.
  - `inquiry.transitioned` must carry `payload.meta: { from, to }`, unless its payload was redacted.
- **Custom header values** are limited to printable ASCII and tab, and may not be `[REDACTED]`. HTTP clients reject control characters and non-ASCII values, so such a webhook would fail at every delivery. Refusing the placeholder stops a GET response that is sent back unchanged from overwriting the stored value. `expect` and `proxy-connection` join the reserved names.
- **API logs** also redact `flow-url`. The `resume` response's flow URL carries the session token in its fragment, and C12's key list would have stored it.
- **The C14 schedule.** `WEBHOOK_MAX_ATTEMPTS` is now 8, derived from `WEBHOOK_RETRY_OFFSETS_SECONDS`, and the jitter ratio is 0.1.
- **API keys** follow C12 exactly: `token-prefix`, `allowed-ips`, `api-version`. Phase 1's `prefix` and `revoked-at` are gone; no route served that resource.
- **Users** may be `invited`, as db-v2 stores invited users. PATCH still sets only `active` or `deactivated`.
- **WebAuthn** options and credentials use the W3C JSON serialization (camelCase). They are loose objects, because browsers and `@simplewebauthn/server` may add members.

## Tests (written first)

- **`packages/core`** (+197 tests):
  - the verification table, both ways, including prototype keys and unknown statuses;
  - every built-in role's exact permissions and the union, which fails closed on unknown stored values;
  - tag validation (Unicode, code-point length, commas, emoji, control characters), normalization, case-insensitive dedupe, and the 50 limit for add and set;
  - the blocklist at any depth, `fields`, untouched `type`, `id` and `relationships`, no mutation;
  - filter matching: absent filters, subject overrides, empty lists;
  - the four config schemas at their range edges, and v2 template config with `decideVerification` reading it.
- **`packages/contracts`** (+717 tests):
  - one test file per new module, and extended tests for inquiries, templates, webhooks, events, users, flow and dashboard;
  - `fixtures.test.ts` checks the exact C8 + C20 list, a `z.encode` round trip for every fixture, semantic checks per fixture, and an independent `node:crypto` HMAC check of every signing vector against the C5 header grammar;
  - `json-schema.test.ts` converts every exported schema (now more than 300) both ways.
- **`packages/node`**: no code change. Its golden-vector tests pick up the 1 + 7 new vectors (61 → 69 tests).

## RED and GREEN

Every run used `source scripts/env.sh` first, then `pnpm exec vitest run` in the package directory (`--coverage.enabled=false` for RED). Each RED state was committed as `test(...)` before its implementation.

### Cycle 1: core (`cf69d1f` RED, `6386cb7` GREEN)

RED:
```
 FAIL  src/check-config.test.ts [ src/check-config.test.ts ]
Error: Cannot find module './check-config.js' imported from .../packages/core/src/check-config.test.ts
 FAIL  src/permissions.test.ts / tags.test.ts / verification-state-machine.test.ts / webhook-payload.test.ts  (same: module not found)
 FAIL  src/index.test.ts > @openverify/core entry point > re-exports transitionVerification
AssertionError: expected { …(45), …(1) } to have property "transitionVerification"
 Test Files  6 failed | 5 passed (11)
      Tests  14 failed | 201 passed (215)
```

GREEN. Typecheck and lint were clean.
```
 Test Files  11 passed (11)
      Tests  398 passed (398)
Statements   : 100% ( 248/248 )
Branches     : 100% ( 125/125 )
```

On the way:
- Two tests asserted "no targets" when only the *target* status was unknown. That was a test bug, fixed by splitting the case.
- Lint refused `[...string].length` (`no-misused-spread`), so the code-point bound moved into the `u` regex quantifier.

### Cycle 2: contracts vocabulary (`dc1f0eb` RED, `17c5675` GREEN)

RED:
```
 FAIL  src/actions.test.ts [ src/actions.test.ts ]
Error: Cannot find module './actions.js' imported from .../packages/contracts/src/actions.test.ts
 FAIL  src/api-versions / http-headers / list-filters / recovery-codes / redaction / tags / vocabulary  (module not found)
 FAIL  src/flow-url.test.ts > buildOneTimeLinkUrl (C10) > puts the inquiry id and one-time token in the fragment
TypeError: buildOneTimeLinkUrl is not a function
 FAIL  src/ids.test.ts > ID_PREFIXES > maps every C1 object to its prefix
AssertionError: expected { organization: 'org', …(13) } to deeply equal { organization: 'org', …(19) }
 Test Files  13 failed | 15 passed (28)
      Tests  56 failed | 456 passed (512)
```

GREEN:
```
 Test Files  28 passed (28)
      Tests  636 passed (636)
Statements   : 100% ( 550/550 )
Branches     : 100% ( 203/203 )
```

On the way:
- C17 makes `inquiry.expired` a real event, so two Phase 1 tests that used it as the "unknown name" now use `inquiry.deleted`.
- A recovery-code test varied only the 4 bits the encoding drops. That was a test bug, fixed.
- A `reduce` over a one-element `API_VERSIONS` left an unreachable branch, so `LATEST_API_VERSION` is a constant with a test that it is the newest entry.
- The browser-safe build check (`tsc -p tsconfig.build.json --noEmit`) needs core's `dist`, so core was rebuilt first. `dist/` is ignored by git.

### Cycle 3: resources and request bodies (`64e3229` RED, `412e3b2` GREEN)

RED:
```
 FAIL  src/account-types.test.ts [ src/account-types.test.ts ]
Error: Cannot find module './account-types.js' imported from .../packages/contracts/src/account-types.test.ts
 FAIL  src/accounts / api-logs / events / inquiry-actions / inquiry-sessions / inquiry-template-versions /
       inquiry-templates / mfa / rate-limits / roles / template-settings / user-audit-logs / webhook-deliveries
TypeError: apiKeyTokenPrefix is not a function
AssertionError: expected { …(274), …(1) } to have property "webhookDeliveryResourceSchema"
 Test Files  21 failed | 19 passed (40)
      Tests  120 failed | 616 passed (736)
```

The first RED commit was blocked by the gitleaks hook (`generic-api-key` on a high-entropy synthetic WebAuthn `authenticatorData` value in `mfa.test.ts`). The value was replaced with `'A'.repeat(50)`; no ignore entry was added.

GREEN:
```
 Test Files  40 passed (40)
      Tests  1127 passed (1127)
Statements   : 100% ( 896/896 )
Branches     : 100% ( 300/300 )
```

On the way:
- Coverage found three unreachable or untested branches, now covered or removed:
  - the event-name guard became a non-throwing prefix comparison;
  - a test for a valid boolean field was added;
  - a test for a redacted account was added.
- `typecheck` caught that zod infers optional members as `T | undefined`, so `resolveTemplateSettings` now resolves each setting explicitly.
- `no-control-regex` would have refused the first custom-header pattern.

### Cycle 3b: stored payloads and invited users (`337dc82`)

A read-only `tsc --noEmit` in `apps/api` showed two problems:
- the redaction stub inside `eventPayloadSchema.data` broke narrowing by `type` in code that reads live payloads;
- db-v2 stores users as `invited`.

The tests were updated first. They were then run against the previous implementation, copied back in temporarily from `git show HEAD:...`:
```
$ pnpm exec vitest run --coverage.enabled=false src/events.test.ts src/users.test.ts
 FAIL  src/events.test.ts > Phase 2 events (C14, C16, C17) > rejects a stub whose id has another prefix
TypeError: Cannot read properties of undefined (reading 'safeParse')
 FAIL  src/events.test.ts > ... > keeps the payload an event is created with free of stubs
AssertionError: expected true to be false // Object.is equality
 FAIL  src/users.test.ts > Phase 2 user attributes (C15) > add the name, status and roles
AssertionError: expected [ 'active', 'deactivated' ] to deeply equal [ 'invited', 'active', 'deactivated' ]
 Test Files  2 failed (2)
      Tests  6 failed | 24 passed (30)
```

GREEN: 1132 tests, 100% statements and branches.

### Cycle 4: fixtures and vectors (`87b94af` RED, `abad2f6` GREEN)

RED (`src/fixtures.test.ts src/redaction.test.ts`):
```
 FAIL  src/fixtures.test.ts > API golden fixtures (C8, C20) > are exactly the C8 and C20 lists, each with a validating schema
AssertionError: expected [ 'flow-session.json', …(6) ] to deeply equal [ 'account-type.json', …(18) ]
Error: ENOENT: no such file or directory, open '.../contracts/fixtures/api/account.json'      (36 such)
 FAIL  ... > Phase 1 fixtures carry what Phase 2 servers send (C10, C14, C19) > inquiry.json has the C10 attributes and its account
 FAIL  ... > signs a rotation with the new secret first and the previous one second (C14)
 FAIL  ... > verifies a dual-signed delivery with either secret, or both, during the overlap
 FAIL  src/redaction.test.ts > ... > replaces the value of every C12 secret key, and the flow URL that carries a session token
 Test Files  2 failed (2)
      Tests  44 failed | 35 passed (79)
```

The first RED run also failed the independent vector check on `leading-zero-timestamp`. My checker had accepted leading zeros, which the C5 grammar forbids; the checker was fixed before the commit.

Dual-signature vectors: Python `hmac` with secrets `...004` (new) and `...001` (previous), timestamp `1792498200`. Cross-checked with:
```
$ printf '%s' '1792498200.{"data":{"type":"event","id":"evt_01M5CKFVE0A1DPCWBWGY99VA5K","attributes":{"name":"inquiry.approved"}}}' \
    | openssl dgst -sha256 -hmac wbhsec_test_ONLY_not_a_real_secret_000000000000004
SHA2-256(stdin)= 9ec004aa9c51e4132f94fabaf63b2fd1cd087329997e0d9b5a4b568ba5fd9f58
  (…000000000000001 → b6abc1e5052ca7b11370f516f73bd4c927f1ff0d7f79a60b09ae786d082880bf)
```

The new entries were appended as text. `diff` against the previous file shows no removed line; the only change to an existing entry is the comma that separates it from the new one. The Phase 1 API fixtures were edited by inserting lines (+26/−2 across 4 files), not regenerated.

GREEN:
```
 Test Files  40 passed (40)
      Tests  1181 passed (1181)
Statements   : 100% ( 900/900 )
Branches     : 100% ( 302/302 )
$ pnpm --filter @openverify/node test
 Test Files  3 passed (3)
      Tests  69 passed (69)
Statements/Branches/Functions/Lines: 100%
```

### Refactor (`600e48f`)

The nullable-timestamp and distinct-values helpers were duplicated across eight modules. They now live in `json-api.ts` as `toNullableTimestamp` and `hasDistinctValues`, with their own tests.
```
 Test Files  40 passed (40)
      Tests  1183 passed (1183)
Statements   : 100% ( 892/892 )
Branches     : 100% ( 290/290 )
```

## Final verification (shared tree, 2026-10-20)

```
$ pnpm --filter @openverify/contracts --filter @openverify/core --filter @openverify/node test
 core:      Test Files 11 passed, Tests 398 passed,  Statements/Branches/Functions/Lines 100%
 contracts: Test Files 40 passed, Tests 1183 passed, Statements/Branches/Functions/Lines 100%
 node:      Test Files 3 passed,  Tests 69 passed,   Statements/Branches/Functions/Lines 100%
$ pnpm --filter @openverify/contracts --filter @openverify/core --filter @openverify/node typecheck   # clean
$ pnpm --filter @openverify/contracts --filter @openverify/core --filter @openverify/node lint        # clean
$ (cd packages/contracts && pnpm exec tsc -p tsconfig.build.json --noEmit)                             # clean (browser-safe build)
$ (cd packages/config && pnpm exec vitest run src/workspace-conventions.test.ts)                        # 37 passed
$ pnpm exec prettier --check packages/contracts/src packages/core/src contracts/README.md contracts/fixtures/api contracts/fixtures/webhooks   # clean
```

## Effect on code outside my paths (read-only runs, for the Stage 2 owners)

`apps/api`: `vitest run --exclude src/openapi.test.ts` gives 846 passed and 5 failed. Each failure follows from a locked contract:

| File and test | Cause | Owner |
|---|---|---|
| `webhooks/dispatcher.test.ts` "gives up after the fifth attempt" and "grows exponentially" | C14: `WEBHOOK_MAX_ATTEMPTS` is 8 (`WEBHOOK_RETRY_OFFSETS_SECONDS`) | api-integrations |
| `webhooks/dispatcher.test.ts` "fails a delivery whose event is not a Phase 1 event" | C17: the stored name is now a valid event, so the builder sees the fixture's payload | api-integrations |
| `routes/server/events.test.ts` "answers 500 rather than serve a stored event outside the C5 contract" | C17: `inquiry.marked-for-review` is a valid event | api-platform |
| `routes/dashboard/index.test.ts` "signs an operator in…" | db-v2 user rows now have `name` and `status`; `buildUserResource(row)` sends them (C15) | api-operators |

`apps/api` `tsc --noEmit` reports two errors from the C9 comma lists:
- `services/inquiries.ts:168`;
- `routes/dashboard/inquiries.ts:81`.

`filter[status]` is now a string. Use `filterValues(query['filter[status]'], inquiryStatusSchema)`. A third error, in `jobs/records.test.ts`, comes from the db-v2 `Inquiry` row type.

Android, for Workflow 2C: `ContractFixturesTest` requires a decoder for every file in `contracts/fixtures/api/`, so the twelve C20 files fail it until the SDK test decodes `inquiry-session.json` and skips or decodes the rest. C20 says Kotlin validates the inquiry session only. The SDK ignores unknown keys, so the Phase 2 attributes added to the Phase 1 fixtures need no change.
