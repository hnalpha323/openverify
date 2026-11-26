# TDD evidence: Phase 0, domain-core

Slice owner: domain-core agent. Date: 2026-10-20. Packages: `packages/core`, `packages/checks`, `packages/flow-spec`.

## Plan task

From PLAN §3 (package roles), §4 (check catalog), §5 (conventions) and §6 Phase 0, plus the slice brief:

1. `@openverify/core`: zod v4 enums, the inquiry status state machine with event names, a `CHECK_REGISTRY` covering every check in §4.1 to §4.3, and the `decideVerification` decision engine.
2. `@openverify/checks`: ICAO 9303 MRZ parsing and check digits (TD1, TD2, TD3); seven pure checks (`id_mrz_inconsistency_detection`, `id_expired_detection`, `id_valid_dates_detection`, `id_age_comparison`, `id_po_box_detection`, `id_disallowed_country_detection`, `id_disallowed_type_detection`); a name-matching utility.
3. `@openverify/flow-spec`: a zod schema for server-driven flows, `parseFlow()`, and a generated JSON Schema at `packages/flow-spec/schema/flow.schema.json`.

Dependencies added (all MIT, versions checked with `npm view` on 2026-10-20):

| Package | Version | Where | Why |
|---|---|---|---|
| zod | ^4.6.7 | core, checks, flow-spec | Schemas; `z.toJSONSchema` (draft 2020-12) |
| @openverify/core | workspace | checks, flow-spec | Enums, registry, `DomainError` |
| tsx | ^4.23.15 (dev) | flow-spec | Runs `scripts/export-json-schema.ts` |
| ajv | ^8.20.0 (dev) | flow-spec | Validates the exported JSON Schema in tests |

### Decisions taken while planning

- **MRZ: own implementation, not the `mrz` package.** `mrz` 5.0.2 (MIT, maintained) was read before deciding. ICAO 9303-5 §4.2.4 says a long TD1 document number's check digit covers positions "6 – 14, 16 – 28. Note: Position 15 contains '<' and is excluded". `mrz` also accepts the variant that includes the filler, and it has no MRV visa layouts, which Phase 3 needs. A synthetic vector where the two variants differ (1 vs 7) pins the strict rule.
- **Independent test vectors.** The ICAO "Utopia" specimens (TD1, TD1 long number, TD2, TD3) and the synthetic vectors were checked with a separate Python implementation of the 7-3-1 check digit. Jaro-Winkler expectations come from the `jellyfish` library (MIT, run in a throwaway `uv` environment). ISO 3166-1 pairs were generated from `i18n-iso-countries` (MIT) codes, with attribution in `country-codes.ts`.
- **Registry details the plan leaves open:**
  - `CheckDefinition` gains an optional `alternateTier` for the plan's compound tiers (`A/H`, `H/A`, `R+A`).
  - §4.3 has no Type column, so types were assigned and recorded in the test table.
  - §4.3 rows that are not check ids were given ids: `phone_number_otp_comparison`, `email_address_otp_comparison`, `email_address_disposable_detection`, `email_address_mx_detection`, and `id_nfc_{passive_authentication_detection,chip_authentication_detection,mrz_comparison,selfie_comparison}`.
  - `id_nfc_expired_detection` is assigned to `government_id_nfc`, because it reads chip data.
- **Fail-closed policy checks:**
  - With an age, country or ID-class policy configured, a missing or unreadable input fails.
  - An unreadable expiry date fails, while a missing expiry is `not_applicable`.
  - An unreadable MRZ is `not_applicable` in the inconsistency check, since reading it is `id_mrz_detection`'s job.

## Tests (written first)

`packages/core`:
- `enums.test.ts`: every enum's values and order, schema acceptance and rejection, snake_case.
- `inquiry-state-machine.test.ts`:
  - all 13 allowed transitions and all 51 forbidden pairs;
  - the event for each status;
  - the typed `InvalidInquiryTransitionError`;
  - prototype keys (`constructor`, `__proto__`) rejected at runtime.
- `check-registry.test.ts`:
  - **parses the §4.1 and §4.2 tables out of `docs/PLAN.md`** and asserts every row is registered with that tier, type and stage;
  - an explicit table for §4.3;
  - exact set equality and no duplicates;
  - H-tier checks are beta;
  - the default enabled/required rules;
  - immutability;
  - no third-party branding in descriptions.
- `check-result.test.ts`: the shared `CheckResult` contract, with snake_case reason codes only.
- `decision-engine.test.ts`:
  - pass, fail and pending;
  - a missing required result counts as pending;
  - failure wins over pending;
  - `not_applicable` never fails, including when every required check is not applicable;
  - disabled checks are ignored;
  - optional failures are advisory;
  - unconfigured results are ignored;
  - user_behavior hints and `retryable`;
  - conservative merging of duplicate results;
  - ordering;
  - typed input errors;
  - `defaultTemplateConfig`.

`packages/checks`:
- `mrz.test.ts`:
  - check digits, including the ICAO `520727 → 3` example;
  - all four ICAO specimens;
  - strict long-number rule;
  - TD2 long number;
  - tampering of each field;
  - TD3 empty personal number (`<` or `0`);
  - field-format issues;
  - truncated names;
  - CRLF and blank-line input;
  - unrecognized, invalid-character and unsupported (MRV, pre-2021 French ID) layouts;
  - no MRZ content in error messages.
- `name-matching.test.ts`: normalization (diacritics, ß/æ/ø/œ/þ/đ/ł/ı, apostrophes, full-width, non-Latin), Jaro and Jaro-Winkler reference values, token-set and `compareNames`.
- `dates.test.ts`:
  - strict ISO dates with leap years;
  - years below 100;
  - UTC "today";
  - age, with 29 February reached on 1 March.
- `country-codes.test.ts`: alpha-2 to alpha-3, ICAO `D` and `RKS`, 249 one-to-one pairs.
- `result.test.ts`: the check type comes from the registry; typed `InvalidCheckConfigError`.
- One test file per check covers its pass, fail and not-applicable paths, reason codes, metadata, config validation, injectable `now`, and that no PII appears in results. Highlights:
  - MRZ vs VIZ: ICAO transliteration (Müller → MUELLER or MULLER, Østergaard → OESTERGAARD) and truncation.
  - PO box: 43 positive and 12 negative addresses.

`packages/flow-spec`:
- `flow.test.ts`:
  - a flow using all 11 step types and all 6 field types;
  - opaque conditions;
  - empty steps;
  - duplicate step ids;
  - unknown `from` and `to` step ids;
  - transitions out of terminal steps;
  - metadata errors;
  - per-step and per-field validation;
  - non-object conditions;
  - the typed `FlowSpecError`.
- `json-schema.test.ts`:
  - the schema compiles under **ajv strict mode**;
  - it accepts the valid flow and rejects structural errors, as `parseFlow` does;
  - it documents that cross-references are enforced only by `parseFlow`;
  - **the committed `schema/flow.schema.json` must equal the generated schema**.

## RED

Each cycle was run in the package directory with `pnpm exec vitest run --coverage.enabled=false`, and the failing tests were committed (`test:`) before the implementation. Every run failed because the module under test did not exist yet.

Cycle 1 (core enums and state machine):

```
 FAIL  src/enums.test.ts [ src/enums.test.ts ]
Error: Cannot find module './enums.js' imported from /home/mhnoor/persona-opensource/packages/core/src/enums.test.ts
 FAIL  src/inquiry-state-machine.test.ts [ src/inquiry-state-machine.test.ts ]
Error: Cannot find module './enums.js' imported from /home/mhnoor/persona-opensource/packages/core/src/inquiry-state-machine.test.ts
 Test Files  2 failed | 1 passed (3)
```

Cycle 2 (registry):

```
 FAIL  src/check-registry.test.ts [ src/check-registry.test.ts ]
Error: Cannot find module './check-registry.js' imported from /home/mhnoor/persona-opensource/packages/core/src/check-registry.test.ts
 Test Files  1 failed | 3 passed (4)
```

Cycle 3 (check result and decision engine):

```
 FAIL  src/check-result.test.ts [ src/check-result.test.ts ]
Error: Cannot find module './check-result.js' imported from /home/mhnoor/persona-opensource/packages/core/src/check-result.test.ts
 FAIL  src/decision-engine.test.ts [ src/decision-engine.test.ts ]
Error: Cannot find module './decision-engine.js' imported from /home/mhnoor/persona-opensource/packages/core/src/decision-engine.test.ts
 Test Files  2 failed | 4 passed (6)
```

Cycle 4 (MRZ):

```
 FAIL  src/mrz.test.ts [ src/mrz.test.ts ]
Error: Cannot find module './mrz.js' imported from /home/mhnoor/persona-opensource/packages/checks/src/mrz.test.ts
 Test Files  1 failed | 1 passed (2)
```

Cycle 5 (name matching):

```
 FAIL  src/name-matching.test.ts [ src/name-matching.test.ts ]
Error: Cannot find module './name-matching.js' imported from /home/mhnoor/persona-opensource/packages/checks/src/name-matching.test.ts
 Test Files  1 failed | 2 passed (3)
```

Cycle 6 (the seven checks and their utilities), excerpt:

```
 FAIL  src/country-codes.test.ts [ src/country-codes.test.ts ]
Error: Cannot find module './country-codes.js' imported from /home/mhnoor/persona-opensource/packages/checks/src/country-codes.test.ts
 FAIL  src/id-mrz-inconsistency-detection.test.ts [ src/id-mrz-inconsistency-detection.test.ts ]
Error: Cannot find module './id-mrz-inconsistency-detection.js' imported from /home/mhnoor/persona-opensource/packages/checks/src/id-mrz-inconsistency-detection.test.ts
 Test Files  10 failed | 3 passed (13)
```

Cycle 7 (flow-spec):

```
 FAIL  src/flow.test.ts [ src/flow.test.ts ]
Error: Cannot find module './flow.js' imported from /home/mhnoor/persona-opensource/packages/flow-spec/src/flow.test.ts
 FAIL  src/json-schema.test.ts [ src/json-schema.test.ts ]
Error: Cannot find module './flow.js' imported from /home/mhnoor/persona-opensource/packages/flow-spec/src/json-schema.test.ts
 Test Files  2 failed | 1 passed (3)
```

**Process deviation in cycle 7:** I drafted `flow.ts` and `json-schema.ts` before running the tests. To capture a genuine RED, I moved both files out of the tree, ran the suite above, committed the tests (`3c8f32a`), and then restored the files.

### Failures during GREEN that changed tests or code

1. **Decision engine, `__proto__` key (test assumption wrong).** The test expected a `__proto__` check id in a template config to be rejected:

   ```
   AssertionError: expected undefined to be an instance of InvalidDecisionInputError
   ```

   A probe showed that zod v4 records silently drop `__proto__` keys (`true [ 'ok' ] true`). That is safe: there is no prototype pollution and no pseudo-check. The test now asserts that behaviour.

2. **Jaro-Winkler (real bug, caught by the reference values).** The first implementation applied the prefix bonus at any Jaro score:

   ```
   AssertionError: expected 0.7276767676767677 to be less than 0.7
   ```

   jellyfish gives `john smith|jones peter jw=0.6595959595959596`. Winkler's original rule applies the bonus only above a Jaro score of 0.7, which is now the default `boostThreshold`, pinned by an extra reference row. One of my own tests had used a pair below the threshold to test the four-character cap; it now uses `ABCDEFGX`/`ABCDEFGY` (Jaro ≈ 0.917).

3. **Flow with empty steps (fixture wrong).** Emptying `steps` but keeping `transitions` also produced six legitimate `unknown step id` issues, because zod v4 runs refinements after non-aborting checks such as `min(1)`. The test now clears both arrays, and a new test asserts the dangling transitions are reported.

4. **Lint fixes in GREEN commits**, with no behaviour change: a redundant constructor, string spread (twice), `startsWith`, and `Object.values` on an interface typed as `any`.

## GREEN

Command: `pnpm exec vitest run` (coverage on) in each package directory. Each cycle was committed as `feat:`.

| Cycle | Result | Statements / Branches / Functions / Lines |
|---|---|---|
| 1 core enums and state machine | `Test Files  3 passed (3)`, `Tests  110 passed (110)` | 100% / 100% / 100% / 100% |
| 2 core registry | `Test Files  4 passed (4)`, `Tests  160 passed (160)` | 100% / 100% / 100% / 100% |
| 3 core decision engine | `Test Files  6 passed (6)`, `Tests  201 passed (201)` | 100% (111/111) / 100% (48/48) / 100% (25/25) / 100% (108/108) |
| 4 checks MRZ | `Test Files  2 passed (2)`, `Tests  73 passed (73)` | 100% / 97.45% / 100% / 100% |
| 5 checks name matching | `Test Files  3 passed (3)`, `Tests  121 passed (121)` | 100% / 97.56% / 100% / 100% |
| 6 checks, seven checks | `Test Files  13 passed (13)`, `Tests  371 passed (371)` | 99.76% / 97.93% / 100% / 99.75% |
| 7 flow-spec | `Test Files  3 passed (3)`, `Tests  81 passed (81)` | 100% (76/76) / 100% (22/22) / 100% (19/19) / 100% (74/74) |

A `refactor:` commit then removed an unreachable transliteration entry and added a `Yıldız` test, bringing checks to 372 tests.

Final workspace run from the repo root: `pnpm --filter "./packages/*" test`, exit 0.

```
packages/core test:       Tests  201 passed (201)
packages/checks test:       Tests  371 passed (371)
packages/flow-spec test:       Tests  81 passed (81)
packages/config test:       Tests  33 passed (33)
packages/db test:       Tests  70 passed (70)
packages/ui test:       Tests  50 passed (50)
```

`pnpm exec turbo run build typecheck lint --filter=@openverify/core --filter=@openverify/checks --filter=@openverify/flow-spec`:

```
 Tasks:    9 successful, 9 total
```

`pnpm exec prettier --check packages/core packages/checks packages/flow-spec`: `All matched files use Prettier code style!`

## Coverage

The 80% gate comes from `@openverify/config/vitest`.

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| core | 100% | 100% | 100% | 100% |
| checks | 99.76% | 97.93% | 100% | 99.75% |
| flow-spec | 100% | 100% | 100% | 100% |

Uncovered branches in checks:
- `noUncheckedIndexedAccess` fallbacks (`?? 1`, `?? ''`, `?? 31`, `?? letter`) that cannot be reached;
- the rethrow of non-MRZ errors in `id_mrz_inconsistency_detection`.

flow-spec excludes only its shared test fixture (`src/test-fixtures.ts`) from coverage and from the build.

## Commits (local, not pushed)

```
5e82051 test(core): add failing tests for domain enums and inquiry state machine
aa29b46 feat(core): add domain enums and inquiry status state machine
35273ea test(core): add failing check registry tests driven by PLAN §4
4956464 feat(core): add check registry covering every PLAN §4.1-4.3 check
643c0c3 test(core): add failing check result and decision engine tests
9576da0 feat(core): add check result schema and verification decision engine
0607581 test(checks): add failing ICAO 9303 MRZ parser and check digit tests
3da80c5 feat(checks): parse ICAO 9303 TD1/TD2/TD3 MRZ with check digit validation
81f1fd7 test(checks): add failing name normalization and Jaro-Winkler tests
c93cd66 feat(checks): add name normalization, Jaro-Winkler and token-set similarity
ef2391a test(checks): add failing tests for the seven Phase 0 ID checks
7694b5b feat(checks): implement the seven Phase 0 ID checks
3c8f32a test(flow-spec): add failing flow schema and JSON Schema export tests
5084b0f feat(flow-spec): add server-driven flow schema, parseFlow and JSON Schema export
4782446 refactor: drop an unreachable MRZ transliteration entry and format fixtures
```

## Open items for other owners

- `pnpm-lock.yaml` was updated by my `flock`-serialized `pnpm add` runs, but it is outside my paths and was **not committed**. Until it is, a frozen-lockfile install will not match the committed `package.json` files.
- `pnpm add` exits with `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`. The packages are still installed, and tsx works with the prebuilt esbuild binary. Approving or ignoring the build is a workspace decision.
- zod, tsx and ajv use direct version ranges. They could move to the `catalog:` in `pnpm-workspace.yaml`.
