# TDD evidence: Phase 5, Workflow 5C Stage 1, `dashboard-records`

Slice owner: `dashboard-records` (Workflow 5C Stage 1, in parallel with `dashboard-people` and `dashboard-documents`). Date: 2026-10-24.

**Area (C66):** the console evidence of the `database`, `aamva`, `database-business` and `business-website` verifications, with:
- the entered fields, masked without `pii:view`, beside each field's match level, methods and flags;
- each match group's met, unmet or undecidable result;
- the source and its authority, and whether it is a sandbox;
- the AAMVA source;
- the register's source, record id and status, and how the status was read;
- the associated persons;
- the website's resolution, domain registration date, listings and backlinks;
- each type's "What a pass means" line;
- words for every C51.2 reason of the four types.

**Owned paths** (`apps/dashboard/src/` unless stated):
- `lib/{database,aamva,database-business,business-website}-evidence.ts` and `lib/…-words.ts`;
- `lib/reason-words/{database,aamva,database-business,business-website}.ts` and their tests;
- `components/evidence/{database,aamva,database-business,business-website}.tsx`, replacing the 5A placeholders, and their tests;
- `testing/fixtures/{database,aamva,database-business,business-website}.ts` and `testing/routes/records.ts`;
- `e2e/tests/support/records.ts` and `e2e/tests/ui-records.spec.ts`;
- this file.

Every command below ran after `source scripts/env.sh`. The output is abbreviated to its relevant lines.

## 1. Reason words (C51.2, C66)

**Test first.** Four test files, `lib/reason-words/{database,aamva,database-business,business-website}.test.tsx`. Each one:
- reads its type's checks and every reason the contracts list for them (`DATABASE_CHECK_REASONS`, `BUSINESS_CHECK_REASONS`, filtered by the registry's `verificationType`), before anything of the console;
- asserts each reason has short words through `reasonText(reason, check)`, the console's own lookup;
- asserts each reason of the check's C51.2 row (`*_CHECK_OUTCOMES`, failed and not applicable) is worded in the type's own module;
- asserts that every explanation is one sentence;
- pins the honesty points: a non-authoritative miss, a number the register lacks and a business no register holds go to review; `not_requested` and `no_allowlist` do not count; an unavailable domain age names the subdomain case; a stale feed is `execution_error` and an empty feed list is `provider_not_configured`.

**RED** (commit `1f2c17e8`):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words/{database,aamva,database-business,business-website}.test.tsx --coverage.enabled=false
 FAIL  src/lib/reason-words/database.test.tsx > … > words database_identity_comparison’s reason record_not_found
AssertionError: address_mismatch: expected false to be true // Object.is equality
AssertionError: low_confidence_match: expected false to be true // Object.is equality
AssertionError: jurisdiction_not_participating: expected false to be true // Object.is equality
…
 Test Files  4 failed (4)
      Tests  107 failed | 73 passed (180)
```

The 73 passes are reasons whose shared words already existed (`input_missing`, `provider_not_configured`, and so on), plus the AAMVA `execution_error` pin. The new test files typecheck: `tsc --noEmit` reports nothing for them.

**GREEN** (commit `842ed5d8`): the four modules word every row reason.
- Database: `record_not_found` (authoritative) is worded apart from `no_matching_record` (not authoritative, so review); `birthdate_ambiguous` says a reviewer decides.
- AAMVA: the issuer's record, and `jurisdiction_not_participating` as review or a skip. `execution_error` keeps the shared words.
- Business registry: `registration_number_not_found` and `no_registry_record` go to review; the service check's `provider_not_configured` is "No register bound for the country".
- Business website: the listing categories, and what an unavailable age, a stale feed and an empty feed list mean.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words src/lib/check-reasons.test.ts --coverage.enabled=false
 FAIL  src/lib/reason-words/lookup.test.tsx > reasonText by check (C54.5) > takes the shared words for a check of another type, an unknown check, or none
AssertionError: expected { …(2) } to be undefined
 Test Files  1 failed | 11 passed (12)
      Tests  1 failed | 556 passed (557)
```

**The one failure is a shared test** (`lookup.test.tsx`, owned by `dashboard-people`). It pins that `reasonText('record_not_found', 'aamva_identity_comparison')` is `undefined`, which C66 changes: every AAMVA reason now has words. The exact minimal change, which keeps the test's intent (the mocked database words never reach an AAMVA check), is in the GREEN commit's message and in this agent's report:

```ts
expect(reasonText('record_not_found', 'aamva_identity_comparison')?.words).not.toBe('No record found');
```

## 2. The database evidence (C58, C59, C66)

**Stub** (commit `f31997c5`): `lib/database-words.ts` and `lib/database-evidence.ts` with their final types. The lookups answer from empty `Map`s, and `databaseEvidenceOf` reads nothing.

**Test first** (commit `d52b50f5`). The fixtures (`testing/fixtures/database.ts`) carry the metadata the evaluators write, which is not what the golden API fixture records:
- `database_identity_comparison` records `authoritative`, each match field's `level`, `methods` and `flags` (an address also its `components`), each group's `fields` and `outcome`, and `not-requested-fields`;
- the golden fixture records `matched-group`, and groups as maps of levels. It predates the evaluators, and the evidence must still read it.

The scenarios follow the sandbox tokens (C59.2): nickname, name mismatch, no birth date, not found. The tests:
- `lib/database-words.test.ts` reads from the evaluators' own source (`packages/checks/src/{matching,database}`, as `selfie-words.test.ts` does): the methods (`MATCH_METHODS`), the address components (`ADDRESS_COMPONENTS`), the component matches (`ComponentMatch`), the group outcomes (`MatchGroupOutcome`), the PO box pattern ids, and every flag a matcher records. A flag counts when it is pushed onto a flag list, given as `fieldMatch`'s third argument, given as a partial date's `result` flag, or given as a conditional one-flag list. It also reads the levels and requirements from core, and pins the authority words, the pass line, and the API member names as terms.
- `lib/database-evidence.test.ts` tests what is read and from where:
  - the identity's own field comparisons first, else the per-field results;
  - the recorded groups first, else the template's `match-groups` threshold, without an outcome;
  - malformed metadata gives nothing;
  - nothing before the checks ran.
- `components/evidence/database.test.tsx` renders the component and the verification page (through `testing/routes/records.ts`):
  - the pass line;
  - the sandbox source and what its authority means;
  - the table of entered values beside level, methods and flags, with the address components;
  - the groups table with met, unmet and undecidable;
  - the uncollected group fields, the inquiry comparison and the PO box patterns;
  - "Hidden" and "Redacted";
  - the generic view for another type;
  - no masked value in the page or the RSC payload when the inquiry document carries it unmasked (with the paired check that the payload does hold the values for a reviewer).

The scanner first read `'missing'` as a flag: it is the operand of a condition (`family.level === 'missing' ? […] : []`). The test was corrected before the RED commit, so that a match level is never counted as a flag.

**RED:**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/database-words.test.ts src/lib/database-evidence.test.ts src/components/evidence/database.test.tsx --coverage.enabled=false
TypeError: .toMatch() expects to receive a string, but got undefined                       (×12)
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Database values against the record"   (×9)
AssertionError: expected [] to deeply equal [ 'address-city', …(12) ]
AssertionError: expected { words: 'true' } to deeply equal { words: 'Yes', …(1) }
 Test Files  3 failed (3)
      Tests  118 failed | 9 passed (127)
```

The 9 tests that pass are pins: the flag scanner itself; three lookups of `constructor`-like codes; the reading before any check; the two cases the generic view already met (the "Name first" term, which the shared card and page tests read, and another type falling back to the generic view); and the payload holding the values for a reviewer.

**GREEN** (commit `abd37599`):

```
 Test Files  3 passed (3)
      Tests  127 passed (127)
$ … vitest run src/components/verification-card.test.tsx "src/app/verifications/[id]/page.test.tsx" src/components/evidence src/app/inquiries --coverage.enabled=false
 Test Files  1 failed | 11 passed (12)
      Tests  18 failed | 232 passed (250)
```

The 18 failures were `dashboard-documents`' own RED (`components/evidence/document.test.tsx`), in progress at the time. The shared card and page tests pass with the new component, including their "Name first" and "Redacted" cases.

## 3. The AAMVA evidence (C59.4–C59.6, C66)

**Stub** (commit `85ef57d9`): `lib/aamva-words.ts` and `lib/aamva-evidence.ts`.

**Test first** (commit `23e249f3`). The fixtures follow the sandbox endings (C59.4): a match, `0002`, an ignored difference, `9999`, `5555`, and a failure that names no field. The tests pin:
- where the values came from. For the silent step the console says the API does not name the government ID verification, rather than guess: the attempt is bound through `verification_inputs.source_verification_id`, which no attribute serves;
- the sandbox provider;
- each value beside the issuer's answer;
- "Not recorded", never "No difference reported", when a failed identity names no field;
- "Not sent" for a value that was not entered;
- the ignored fields, and the non-participation choice (always a skip for the silent step);
- a skipped attempt never compared;
- masking, redaction and the page payload.

**RED:**

```
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "AAMVA values against the issuer’s record"   (×8)
TypeError: .toMatch() expects to receive a string, but got undefined                          (×4)
AssertionError: expected {} to deeply equal { 'name-first': 'no-difference', …(7) }
 Test Files  3 failed (3)
      Tests  39 failed | 5 passed (44)
```

**GREEN** (commit `8f89afd9`), with the shared evidence, generic and page tests:

```
 Test Files  6 passed (6)
      Tests  141 passed (141)
```

## 4. The business registry evidence (C61, C66)

**Stub** (commit `479a66ce`): `lib/database-business-words.ts` and `lib/database-business-evidence.ts`.

**Test first** (commit `b8801529`). The fixtures follow the metadata shapes of the golden `verification-database-business.json`, which `integration-5b` rebuilt from the evaluators. The scenarios are the sandbox register's endings (C61.6): a match, `0000`, `8888`, `7777` with a person, `9999`, and a lapsed LEI from GLEIF.
- The words test reads the registers from the contracts and the match fields from core. It reads the status answers (`BusinessStatusAnswer`) and flags from `packages/checks/src/business/status.ts`, and the coverage flag from the service check.
- The component test pins:
  - the register, labelled sandbox, and its authority;
  - the record id, legal name and status on the register, and how the status was read, with its flags;
  - the entered business beside each field's level, and the LEI;
  - the groups;
  - the persons entered with the register's counts, as an advisory result, with who a register lists (the 25% threshold);
  - the country and service checks;
  - masking (the registration number, LEI, record id and status are not personal data and stay visible), redaction and the page payload.

**RED:**

```
TestingLibraryElementError: Unable to find an element with the text: Register, which matches selector 'dt'   (×2)
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Business registry values against the register"   (×2)
TypeError: .toMatch() expects to receive a string, but got undefined                          (×6)
 Test Files  3 failed (3)
      Tests  46 failed | 8 passed (54)
```

**GREEN** (commit `76160c1b`). The first run left 3 failures, all in the RED's own fixtures, not in the component. Both were corrected in the GREEN commit, and the commit message says so:
- **The GLEIF scenario's results named the sandbox provider.** The fixture's identity and active results kept the default provider, while the job writes each result with the register that answered. The fixture now gives every result its scenario's provider.
- **The before-the-checks case kept the register's members.** Before the job no `business_registry_records` row exists, so the API serves `registry-*` as `null`. The test now passes them as `null`.

```
 Test Files  6 passed (6)
      Tests  151 passed (151)
```

## 5. The business website evidence (C61.3–C61.5, C66)

**Stub** (commit `5f5b487a`): `lib/business-website-words.ts` and `lib/business-website-evidence.ts`.

**Test first** (commit `d9fb1430`). The fixtures follow the sandbox website names (C61.6): `new.example`, `old.example`, a subdomain, `.invalid`, a DNS answer, `malicious.example` and `backlinks.example`. Every host is a reserved name.
- The words test reads from the evaluators' own source:
  - the resolution routes, as kebab-case literals, so the compared `'not_found'` is left out;
  - the unavailable-age reasons from the port's union, kebab-cased as the evaluator writes them, plus its `future-date`.
- The component test pins:
  - the URL and host, masked as the API masks them;
  - the resolution and how it was read;
  - the public registration day, never masked;
  - the age against the minimum as an advisory result, or why the age is unavailable;
  - the listings and backlinks with their sandbox providers, or "Not checked: the template does not run this check";
  - redaction and the page payload.

**RED:**

```
TestingLibraryElementError: Unable to find an element with the text: Resolution, which matches selector 'dt'   (×4)
TypeError: .toMatch() expects to receive a string, but got undefined                          (×4)
 Test Files  3 failed (3)
      Tests  32 failed | 7 passed (39)
```

**GREEN** (commit `ae7d52f6`):

```
 Test Files  6 passed (6)
      Tests  136 passed (136)
```

## 6. Refactor, and pins written after the code

The first whole-suite run (`pnpm --filter @openverify/dashboard test`, 1 min 57 s) passed 2,987 tests in 223 files, at 98.13% statements and 92.52% branches. `database-business.tsx` was at 78.84% branches. Most uncovered branches were `?? code(…)` fallbacks of two kinds.

- **Unreachable** (refactor, commit `fedcd802`, behaviour unchanged). The evidence had already validated these values, so they always have words: a match level, group outcome or requirement; a match field of the row type; a register (`registry-source` is an enum attribute); an AAMVA source or field answer; a status reading. Typed overloads now say so: `matchLevelText(level: MatchLevel): WordsText`, and the string form still answers `undefined`. The components dropped those fallbacks.
- **Reachable** through untyped metadata (pins, commit `da8d99d2`, written after the code). These are shown as their codes: an unknown method, component, component match, group field, flag, route, reason or PO box pattern. The commit also pins:
  - "Not compared" when no register or source was bound;
  - "Not run by this template" when the identity has no result;
  - an empty person list, and a person's missing member;
  - singular counts ("1 day old", "1 address", "1 feed", "1 backlink");
  - redacted listing and backlink details.

```
$ … vitest run src/components/evidence src/lib/{database,aamva,database-business,business-website}-{words,evidence}.test.ts --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  394 passed (394)
```

## 7. The full-stack spec (`e2e/tests/ui-records.spec.ts`)

This was written after the components, so it pins built behaviour at full stack. It never failed first: against the 5A generic view it would stop at its first table locator. What it adds over the unit tests is the real data. The fixtures assumed the metadata shapes the evaluators write; the spec reads what the real worker wrote through the sandbox providers, and compares the console with the API (the customer's key), never with a copy of the console's logic.

Each test makes its own inquiry on its own template through the flow API (`e2e/tests/support/records.ts`), so it depends on no other spec. Nothing changes a setting, so there is nothing to restore. The cases:
- **Database, `sandbox-database-nickname`:** "Bob" beside "Partial match" and "Nickname", the birth date and address levels as recorded, group 1 "Met", the sandbox source, not authoritative. The inquiry page's card shows the same evidence. A viewer sees "Hidden" and the levels, and none of the values.
- **AAMVA form, ending `0002`:** "The AAMVA form", the sandbox provider, the postal code "Differs" and the last name "No difference reported". The issue date, never entered, is "Not sent". A viewer sees the number hidden.
- **Business, ending `7777` with Ada Placeholder (1980-04):** the sandbox register, authoritative. The record id, legal name and status are as the API served them, the status is read as active, and the name level and group outcome are as recorded. The person is not on the register, an advisory result, with the counts the check recorded. A viewer sees the names hidden and the record id.
- **Business, ending `8888`:** "dissolved", read as "Inactive", "Business not active".
- **Website, `new.example`:** the reserved-name rule, the registration day as served, "3 days old; the minimum is 90 days" as an advisory failure with the sandbox provider, and the listings "Not checked". A viewer sees the URL hidden and the day.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-records.spec.ts'
[e2e +41.3s] stack ready; logs in e2e/.artifacts/logs
Running 5 tests using 1 worker
  ✓  1 … a reviewer reads a database verification beside each field’s level and the group, and a viewer sees the values hidden and the levels (C58, C59, C66) (5.6s)
  ✓  2 … a reviewer reads an AAMVA form verification: where the values came from and the field the issuer’s record differs on (0002) (C59.4, C59.5, C66) (4.0s)
  ✓  3 … a reviewer reads a business register’s record, its status as read and a person not on it (7777), and a viewer sees the names hidden (C61, C66) (4.1s)
  ✓  4 … a reviewer reads a dissolved business’s status as inactive, the active check failing (8888) (C61.2, C66) (2.3s)
  ✓  5 … a reviewer reads a business website: a reserved name resolved by the sandbox rule, its registration day and an advisory age failure, and a viewer sees the URL hidden (C61.3, C61.4, C66) (3.9s)
  5 passed (1.1m)
```

Commit `fac8a659`. Each test is far inside the 90 s budget of C65.5.

## 8. The pass lines say what the docs say (C66)

`dashboard-people` checks each people pass line against its `docs/checks` page, sentence by sentence (`testing/check-docs.ts`). My first lines were paraphrases, which can drift from what the docs promise, so the records lines adopted the same guard, test first.

**RED** (commit `e044bf26`): each words test requires every sentence of its line in the page's "What a pass means" section, lower-cased, with the Markdown code marks removed. The component tests read the docs' wording. The same commit drops the optional chains that the typed overloads of `fedcd802` had made unnecessary in these tests. `eslint` refused them, and I had linted only the source files at the refactor.

```
$ … vitest run src/lib/{database,aamva,database-business,business-website}-words.test.ts src/components/evidence/{aamva,database}.test.tsx --coverage.enabled=false
AssertionError: The issuing jurisdiction’s records hold a licence or ID card with these details: every field outside the template’s ignored fields matched.: expected '- database: the values the user e…' to contain …
AssertionError: The website’s host resolves to a public internet address; that is the required core.: expected '- business registry: a public registe…' to contain …
 Test Files  6 failed (6)
      Tests  6 failed | 184 passed (190)
```

**GREEN** (commit `5e410e3a`): the four lines are the docs' sentences. The database line now also says that a non-authoritative miss goes to review; the business line, that a register that does not list a business gives no failure. The AAMVA words spell "license" as the docs and the flow do.

```
$ … vitest run src/lib/{…}-words.test.ts src/components/evidence src/lib/reason-words --coverage.enabled=false
 Test Files  27 passed (27)
      Tests  761 passed (761)
```

## 9. Final gates (all in the foreground)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/dashboard typecheck` (`next typegen && tsc --noEmit`) | pass (21.6 s) |
| `pnpm --filter @openverify/dashboard lint` | pass (59.9 s) |
| `pnpm --filter @openverify/dashboard test` (the 80% gate) | 3,022 tests in 225 files, all passed (3 min 21 s). Coverage 98.54% statements, 93.55% branches, 99.09% functions, 98.53% lines |
| `pnpm typecheck && pnpm lint && pnpm format:check` | pass (13 of 13 turbo tasks each; Prettier clean; 2 min 4 s) |
| e2e, mocked flow suite (`pnpm turbo run e2e --filter=@openverify/flow`) | 68 passed (18.8 s) |
| e2e, full stack (`playwright test --shard=1/3`, `2/3`, `3/3`) | 28 + 28 + 26 = 82 of 82 passed (2.0, 3.3 and 4.7 min), `ui-records` 5 of 5 |

**Coverage of this area's files** (statements and branches): every file is at least 97.5% statements and 91.3% branches.
- At 100% statements: the four `lib/reason-words/` modules, the four words modules, three of the four evidence modules, the four fixtures and `testing/routes/records.ts`. The exception is `lib/aamva-evidence.ts`, at 97.5% statements and 91.3% branches.
- The components: `components/evidence/database.tsx` 100% statements, 98.68% branches; `aamva.tsx` 97.95% and 95.83%; `database-business.tsx` 100% and 93.61%; `business-website.tsx` 100% and 98.64%.

**How the e2e ran.** `pnpm e2e` is `turbo run e2e`: the mocked flow suite, then the full-stack suite, each after its `^build`. 5B measured the whole run at more than one 10-minute foreground call, and three `ui-*` specs have joined it since (82 full-stack tests, up from 70). So, as `integration-5b` did:
- a background `flock /tmp/openverify-e2e.lock` held the lock for the whole run, and released it on a marker file (with a two-hour cap of its own);
- under it, the same parts ran in the foreground: the flow suite through turbo, the `^build` of `@openverify/e2e`, then three shards of the full-stack suite, each starting its own stack.

**One infrastructure failure, not a test.** The first start of shard 3 stopped in `docker compose up`, before any test ran: `Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:46867 -> 127.0.0.1:0: /forwards/expose returned unexpected status: 500`. That is Docker Desktop's port forwarder, right after shard 2 released its ports. The setup removed its own project, which I checked (no `openverify-e2e` container or network was left). The same shard then ran in full and passed.
