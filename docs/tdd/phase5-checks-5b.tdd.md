# TDD evidence: Workflow 5B Stage 2, `checks-5b` (Phase 5)

- **Slice owner:** the Workflow 5B Stage 2 `checks-5b` agent, in parallel with `vision-document`, `fixtures-5b`, `emrtd` and `clients-5b` (disjoint paths).
- **Date:** 2026-10-23.
- **Base:** `2d3839f5` (the 5B Stage 1 amendments). This slice's commits run from `fee997c4` to the commit that adds this file.
- **Input:** the plan's `checks-5b` bullet: C60.5 and C60.6 (classification, extraction, the cascade, recency and expiry per class, `FABRICATION_SIGNALS`, the name and address comparisons) and C61.7 (the KYB evaluators with the C61.2 status table). Owned paths: `packages/checks/src/document/`, `packages/checks/src/business/`, the document and business reasons files (unchanged) and config modules (unchanged).

Each unit follows the same cycle: a stub (`chore`) so the RED commit compiles, type-checks and lints; the tests, seen failing for the intended reason (RED, `test`); the smallest change that passes them (GREEN, `feat`). All commands ran after `source scripts/env.sh`, from `packages/checks` unless shown otherwise. Output is trimmed to the lines that matter. Every name, street, town, postal code, issuer, IBAN and host in these tests is synthetic: the invented holder Quinn Valemont, invented Utopia issuers, the unassigned ZIP code 00000, IBANs whose check digits the tests compute over made-up account numbers, and RFC 2606 `.example` hosts. The classifier's constants are the plan's (C60.5) and were fixed before any sample was written; the samples are unit-test inputs, not the held-out set (C60.7), and no constant was tuned on them (H23).

## 1. The classifier (C60.5)

Stub `fee997c4` (every document module: inputs mirroring vision's answer, tokens, lexicon types and empty lexicons, lines, language, layout, classifier, dates, extraction, feature table, fabrication, context, seven evaluators, reasons, evaluator map, runner). RED `5de6d26c`:
```
$ pnpm exec vitest run src/document --coverage.enabled=false
Error: not implemented (1 arguments)          # 50 times
 Test Files  6 failed (6)
      Tests  212 failed | 15 passed (227)
```
The 15 that passed are the constants' test and structural properties that hold vacuously over the empty stub lexicons (no anchor names two classes, no phrase repeats).

GREEN `b1d52cab`. The first run:
```
     × en: Form W-2 is an anchor for tax_document
     × scores an anchor 3 and runs the softmax with other at 2
     × answers unknown when two classes tie (margin under 0.15)
      Tests  3 failed | 224 passed (227)
```
- The W-2 anchor was written `w 2`; the research anchor is "Form W-2", so the lexicon now holds `form w 2`.
- **Two test defects were corrected in this GREEN commit.** The softmax subtracts the largest score before `exp` (so a page listing every cue three times cannot overflow), which changes the last bit of each probability, so the test now compares to 12 places instead of exactly. And with integer cue weights, T = 1 and θ = 2, two tied classes can never reach the default `min-confidence` of 0.5 (a tie gives each at most e^s / (2e^s + 3 + e²) < 0.5), so the confidence rule answers first: the test now checks that, and reaches the margin rule with `min-confidence` 0.3. The margin rule binds only when an operator sets `min-confidence` below 0.5 (an observation recorded for the plan; nothing changed).

Lint then refused `.flat()` over readonly lists (unsafe `any`), an obscure character range and a literal no-break space; each was rewritten before the commit.
```
 Test Files  6 passed (6)
      Tests  227 passed (227)
```

## 2. Dates and extraction (C60.5)

RED `8a991c6d`. The first run failed at collection, because one `describe` computed the bill's extraction at definition time; it was moved into the tests so each fails on its own:
```
$ pnpm exec vitest run src/document/dates.test.ts src/document/extract.test.ts --coverage.enabled=false
Error: not implemented (2 arguments)          # 34 times
 Test Files  2 failed (2)
      Tests  72 failed (72)
```
GREEN `913eb26a`:
```
 Test Files  1 passed (1)
      Tests  41 passed (41)                    # dates
 Test Files  1 passed (1)
      Tests  31 passed (31)                    # extraction, first run
```
With the suite green, the address-block search was bounded to the first 20 postal-code lines per country (otherwise every line holding a postal code costs a quadratic scan of the page), and a timing case of 600 such lines was **written with the cap**, so it never failed first; it pins the bound. Lint then refused three trailing-punctuation patterns as super-linear (`regexp/no-super-linear-move`); they became `trimTrailingCharacters`, a loop.
```
 Test Files  8 passed (8)
      Tests  300 passed (300)
```

## 3. The feature table and the fabrication score (C60.6, H11)

RED `04ef4a8a`:
```
$ pnpm exec vitest run src/document/fabrication.test.ts src/document/feature-table.test.ts --coverage.enabled=false
Error: not implemented (2 arguments)          # 15 times
AssertionError: expected [] to deeply equal [ …(14) ]
AssertionError: expected { expiry: 'none', …(1) } to deeply equal { expiry: 'lease-end', …(1) }
      Tests  35 failed | 6 passed (41)
```
The 6 that passed: the three classes whose stub row already equals its final row, the row-per-class check, the constants and the weight-range property (vacuous over the empty stub table).

GREEN `45cc7760`; lint refused a super-linear font-style pattern and a string spread, both rewritten:
```
 Test Files  10 passed (10)
      Tests  341 passed (341)
```

## 4. The evaluators, the runner and the cascade (C60.6, H22)

Stub `f20f5c3b`: the extraction's `issueDateFound`, `false` until built. RED `7cc11c9e`:
```
$ pnpm exec vitest run src/document/document-checks.test.ts src/document/evaluate.test.ts src/document/extract.test.ts --coverage.enabled=false
Error: not implemented (2 arguments)          # 55 times
AssertionError: expected false to be true     # issueDateFound, twice
AssertionError: expected {} to deeply equal { …(7) }
AssertionError: expected error to be instance of InvalidCheckConfigError
      Tests  101 failed | 34 passed (135)
```
The 34 that passed are the extraction tests of section 2, the "no issue date" case and the evaluator map's coverage of the registry.

GREEN `04a7f96d`. While building recency, the extraction was changed to read numeric dates by the **reference country only**: the country an address block was guessed from (many countries share five-digit postal codes) no longer decides the date order. The tests passed on the first run:
```
 Test Files  12 passed (12)
      Tests  444 passed (444)
$ pnpm exec vitest run src/document --coverage.enabled=true --coverage.include='src/document/**'
All files          |    98.3 |    90.08 |   98.46 |   98.24 |
$ pnpm exec vitest run --coverage.enabled=false     # the whole package, before the nfc work landed
 Test Files  134 passed (134)
      Tests  2670 passed (2670)
```
Then:
- `add67d79` runs the golden vision answers (`contracts/fixtures/vision/analyze-document-{pdf,image}.json`) through the evaluators. It was **written after the code** and pins built behaviour: the fixture holder's born-digital bill passes every required check while its covered page-1 line fails the advisory fabrication check as hidden text; the photo passes from OCR (2 passed).
- `c809883f` (refactor, suite green) drops the empty-lexicon helper only the stubs needed.

## 5. KYB (C61.2-C61.7)

Stub `243ad786`. Before the RED commit, two identity cases were aligned with the matching library's real levels, probed once in a scratch test (removed): legal-form canonicalisation makes "Ltd" and "LIMITED" equal (`full`), and "Utopia Orchards" against the legal name is `partial`. RED `9415bdcb`:
```
$ pnpm exec vitest run src/business --coverage.enabled=false
Error: not implemented (2 arguments)          # 65 times
AssertionError: expected {} to deeply equal { …(9) }
AssertionError: expected error to be instance of InvalidCheckConfigError
      Tests  139 failed | 1 passed (140)
```
The one that passed is the evaluator maps' coverage of the registry.

GREEN `e1c4fe08`. The first run:
```
     × passes persons who match active officers or PSCs by name and birth month
     × honours min-match-level
      Tests  2 failed | 138 passed (140)
```
Two equal `YYYY-MM` months are `partial` (precision-limited) to `matchPartialDates`, because neither side has a day; the birth months are now compared exactly as `YYYY-MM`, which is the evidence a register publishes.
```
 Test Files  5 passed (5)
      Tests  140 passed (140)
$ pnpm exec vitest run src/business --coverage.enabled=true --coverage.include='src/business/**'
All files          |   98.57 |    91.97 |   96.61 |   99.12 |
```

## 6. Final gates

`8453bcea` (refactor, suite green) drops the extraction's unused inline-only read. Then, in the foreground, from the repository root:
```
$ pnpm --filter @openverify/checks typecheck      # $ tsc --noEmit, no output
$ pnpm --filter @openverify/checks lint           # $ eslint ., no output
$ pnpm --filter @openverify/checks test
 Test Files  148 passed (148)
      Tests  2893 passed (2893)
All files          |   98.72 |     90.9 |   99.41 |   98.69 |
$ pnpm --filter @openverify/core test
 Test Files  16 passed (16)
      Tests  711 passed (711)
All files          |     100 |    96.61 |     100 |     100 |
$ pnpm typecheck
 Tasks:    13 successful, 13 total
$ pnpm lint
 Tasks:    13 successful, 13 total
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   68 passed (24.2s)
@openverify/e2e:e2e:   60 passed (7.8m)
exit 0 after 494 s
```
An earlier run of the package script, while the parallel `emrtd` agent's NFC tests were still RED and uncommitted in the shared tree, failed 27 tests and one lint error, all in `src/nfc/` (not this slice's paths); with this slice's folders alone it passed 2,812 tests at 98.71% statements and 90.9% branches. The runs above are after `emrtd` committed its GREEN (`ee842e23`).

## What this slice decided (recorded as plan amendments by `integration-5b`)

The decisions and the provisional constants this slice added are listed in its report's `contractDeviations`; the code documents each where it is used (`classify.ts`, `constants.ts`, `layout.ts`, `language.ts`, `dates.ts`, `extract.ts`, `feature-table.ts`, `fabrication.ts`, the evaluators, `status.ts`, `website.ts`). No reasons file, config module, registry entry or existing test outside the two owned folders changed.
