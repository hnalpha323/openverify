# TDD evidence: watchlist-matcher (Phase 6, Workflow 6A Stage 2)

Area: C78.1-C78.6 and the C79 matching rules in `packages/watchlist/src/{names,translit,keys,score,match,crypto,reverse-index}/`, the build scripts `packages/watchlist/scripts/build-*` and `packages/watchlist/data/legal-forms.json`.

Every command ran from `packages/watchlist` after `source scripts/env.sh`, unless stated. Each slice went stub (its own commit, so the RED test compiles and typechecks), then RED (run and seen failing for its reason), then GREEN.

Rule 16: nothing here read `packages/watchlist/src/testing/held-out/` or any held-out output.

## Slice 1: transliteration (C78.2)

Reference read before writing the tables: ICAO Doc 9303 Part 3, 8th edition (2021), downloaded into a scratch directory only, SHA-256 `55543aca6740140f1db0fb129f7f4815d1cf85dcfd49118cdb602f646c8a5553` (the pin of `docs/research/phase6-matching.md` [A1]); §6.B and §6.C read from the extracted text. Nothing of it is committed; the tables are facts written as our own code.

- Stub: `473580e4` `chore(watchlist): the transliteration signatures as stubs`.
- RED: `5cfe923f`.

  ```
  $ pnpm exec vitest run src/translit --coverage.enabled=false
   Test Files  1 failed (1)
        Tests  38 failed (38)
  $ ... | grep -E "^(Error|AssertionError)" | sort | uniq -c
        1 AssertionError: expected +0 to be 79 // Object.is equality
        1 AssertionError: expected [] to have a length of 49 but got +0
       11 Error: not implemented (1 arguments)
        3 Error: not implemented (2 arguments)
  ```

- GREEN: `825fd311`.

  ```
  $ pnpm exec vitest run src/translit
        Tests  38 passed (38)
  All files    |   95.65 |    89.65 |   94.44 |   95.45 |
  $ pnpm exec tsc --noEmit && pnpm exec eslint src/translit && pnpm exec prettier --check src/translit
  All matched files use Prettier code style!
  ```

  Two corrections while going GREEN, both recorded here: the RED test expected `Объедков` as `obiedkov`, but §6.B writes `Ъ` as `IE` and `Е` as `E`, so the table gives `obieedkov` (the expectation was wrong, not the code); and the shadda and harakat are of the Inherited script, so the renderer looks a character up in the §6.C table before testing its script. The lint rules of the Phase 5 folders refused a regular expression of Arabic code-point ranges (`regexp/no-obscure-range`), so the ranges are numbers.

## Slice 2: name analysis and the legal-form table (C78.1, C79.2)

Source of the table, downloaded into a scratch directory only: rigour `resources/names/org_types.yml` at `607fa82b1ba3338c5e2e04f81c3a77e8cbbe0ee7` (2026-09-21), 126,592 bytes, SHA-256 `772d6c6cf48af7a5b4832ac9aab1e293f0002111f2abb9588377a0459f087f20` (the research's pin `772d6c6c…9f087f20`), and its `LICENSE` (MIT, "Copyright (c) 2023-2025: OpenSanctions Datenbanken GmbH"), SHA-256 `099eeaff53a618bbd4420fa4746311ff72e418816bb21133781af0493d63c6d1`.

- Stub: `5fb6ab3b`.
- RED: `00e13203`.

  ```
  $ pnpm exec vitest run src/names --coverage.enabled=false | grep -E "^(Error|AssertionError)|Tests " | sort | uniq -c
        1       Tests  20 failed (20)
        1 AssertionError: expected [Function] to throw error matching /line 1/ but got 'not implemented (1 arguments)'
        1 Error: not implemented (0 arguments)
       13 Error: not implemented (1 arguments)
        4 Error: not implemented (2 arguments)
        1 Error: not implemented (3 arguments)
  ```

- GREEN: `631772ba` (with `scripts/build-legal-forms.mjs` and the generated `data/legal-forms.json`).

  ```
  $ node --experimental-transform-types --no-warnings --conditions=@openverify/source \
      --import ../checks/scripts/register-ts.mjs scripts/build-legal-forms.mjs <dir>/org_types.yml <dir>/LICENSE
  wrote 433 legal forms to .../packages/watchlist/data/legal-forms.json
  $ ... scripts/build-legal-forms.mjs <dir>/bad.yml <dir>/LICENSE; echo "exit $?"
  refused: a file is not the pinned one (check the commit and both SHA-256)
  exit 1
  $ pnpm exec vitest run src/names --coverage.include='src/names/**'
        Tests  20 passed (20)
  All files          |   97.45 |    83.62 |   98.27 |    97.6 |
  ```

  466 entries fold into 433 forms and 1,960 phrases (entries with one id and one generic tag merge; an id met with two tags becomes `id/tag`, seven of them). `--experimental-transform-types` is needed because `@openverify/checks` sources hold parameter properties, which Node's strip-only mode refuses. The type checker refused the first YAML reader (a `never` helper inside a closure does not narrow), so it became a loop that throws; the tests were unchanged.

## Slice 3: variant groups, keys, identifiers and keysVersion (C78.3, V04, V12)

- Stubs: `d6cb60bb` (variant groups, name keys, identifiers, `keysVersion`, `CRYPTO_NORMALISER_VERSION`) and `a16f7ae5` (the `watchlist_names` and `watchlist_identifiers` row builders).
- RED: `5304544d`.

  ```
  $ pnpm exec vitest run src/keys --coverage.enabled=false | grep -E "FAIL|Test Files|Tests |Error:"
   FAIL  src/keys/name-keys.test.ts [ src/keys/name-keys.test.ts ]
  Error: not implemented (2 arguments)
   FAIL  src/keys/variant-groups.test.ts [ src/keys/variant-groups.test.ts ]
  Error: not implemented (2 arguments)
   FAIL  src/keys/identifiers.test.ts > normaliseIdentifier > ... (5 tests)
  Error: not implemented (3 arguments)
   FAIL  src/keys/keys-version.test.ts > keysVersion > refuses anything but a lower-case SHA-256
  AssertionError: expected [Function] to throw error matching /SHA-256/ but got 'not implemented (3 arguments)'
   Test Files  4 failed (4)
        Tests  8 failed (8)
  ```

  Two files fail at collection: their module-level groups call a stub (`variantGroupsFrom`, `serialiseVariantGroups`), which throws "not implemented".

- GREEN: `f0375a20` (with `scripts/build-variant-groups.mjs`). `src/stubs.test.ts` (Stage 1a's) asserted that the `keysVersion` stub throws; the plan has this agent implement it, so that one assertion now checks the version's digest part instead (listed in the report's contract deviations).

  ```
  $ node --experimental-transform-types --no-warnings --conditions=@openverify/source \
      --import ../checks/scripts/register-ts.mjs scripts/build-variant-groups.mjs
  refused: the shipped build's digest 529216c9da43b57323b66b2b8ae98e7997e1b5972be34457f6042b0eb6f27324 is not SHIPPED_VARIANT_GROUPS_SHA256; ...
  real 0m8.455s   exit 1
  $ ... scripts/build-variant-groups.mjs --accept-new-digest
  {"output":".../data/variant-groups.json","sha256":"529216c9...27324","heldOut":false,"inputGroups":157298,"keptGroups":156706,"keptForms":547306,"droppedOversize":4,"droppedHeldOut":0,"droppedTooFewForms":588,"droppedForms":1579}
  (SHIPPED_VARIANT_GROUPS_SHA256 set to 529216c9...27324; the plain build then exits 0)
  $ ... scripts/build-variant-groups.mjs --hold-out some-scratch-seed
  refused: --hold-out needs --output, so the shipped file is never replaced     exit 2
  $ ... scripts/build-variant-groups.mjs --hold-out some-scratch-seed --output <scratch>/vg-holdout.json
  {"sha256":"2ef55d67...","heldOut":true,"keptGroups":140724,"droppedHeldOut":16038,...}   (10.2% of the groups; the file was deleted)
  $ loadVariantGroups('../../data/variant-groups.json')
  loaded [ 156706, 443900, 2 ]      (groups, distinct forms, the groups of one common given name)
  $ pnpm exec vitest run src/keys src/stubs.test.ts --coverage.include='src/keys/**'
        Tests  37 passed (37)
  All files          |   98.62 |    89.86 |     100 |   98.55 |
  ```

  The shipped file is 9,618,116 bytes and stays in the gitignored `data/`. `regexp/prefer-d` asked for `\d` in two character classes (fixed with `eslint --fix`).

## Slice 4: crypto canonicalisation and the golden test (C79.3, V04)

- Stub: `6c6e643d`.
- RED: `70243daa`.

  ```
  $ pnpm exec vitest run src/crypto src/keys/keys-golden.test.ts --coverage.enabled=false | grep -E "^(Error|AssertionError)|Tests |Test Files" | sort | uniq -c
        1       Tests  16 failed (16)
        1  Test Files  2 failed (2)
        2 Error: not implemented (1 arguments)
       10 Error: not implemented (2 arguments)
  ```

- GREEN: `9063b285`. Every row of the C79.3 table passed on the first run, the CashAddr specification vectors included (the polymod checksum verifies them, so a mistyped vector would have failed). The golden digest was pinned from the first GREEN run after reading every output by eye (the analysis, keys and canonical forms printed for the golden inputs), as a characterisation test:

  ```
  $ pnpm exec vitest run src/keys/keys-golden.test.ts
  -   "digest": "0000000000000000000000000000000000000000000000000000000000000000",
  +   "digest": "9bf0bfe63d7da9fdd9238ac46b0d02cbc8b22228a2575ddbf9d57d89003f76b0",
  (pinned for names-1;identifiers-1;crypto-1)
  $ pnpm exec vitest run src/crypto src/keys src/names src/translit src/stubs.test.ts --coverage.include='src/{crypto,keys,names,translit}/**'
        Tests  111 passed (111)
  All files          |   97.97 |    87.89 |   98.52 |      98 |
  ```

  The golden test can fail: with `h` taken out of the skeleton's dropped letters (a scratch edit, reverted), it failed with the digest diff above; with `y` taken out it passed, because no golden input has a `y` after its first letter.

## Slice 5: the presets, the name score and the qualifiers (C78.4, C79.1)

- Stub: `737e9224`.
- RED: `d1a213c0`. Expected scores are worked out in the tests from the C78.4 constants (pair score times weight, over matched and unmatched weights), never read off the code.

  ```
  $ pnpm exec vitest run src/score --coverage.enabled=false | grep -E "^(Error|AssertionError)|Tests |Test Files" | sort | uniq -c
        1       Tests  13 failed (13)
        1  Test Files  3 failed (3)
        5 Error: not implemented (1 arguments)
        9 Error: not implemented (2 arguments)
  ```

  `name-score.test.ts` fails at collection: its presets are resolved at module level through the `resolveNameMatching` stub.

- GREEN: the scorer, `score/assignment.ts` (the Hungarian method and Dinkelbach's ratio iteration) and the qualifiers.

  ```
  $ pnpm exec vitest run src/score --coverage.include='src/score/**'
        Tests  30 passed (30)
  All files      |    97.9 |    86.79 |   97.01 |   98.34 |
  $ pnpm exec tsc --noEmit; pnpm exec eslint src/score     (no output)
  ```

## Slice 6: subjects, screening, coverage, evidence input, crypto screening (C78.4, C78.5, C79)

- Stubs: `ae860e48` (the `match/` folder) and `68d7a1b7` (`AnalysedName.text`, set to `''`, so the RED test that reads it typechecks).
- RED: `6e3a1151`.

  ```
  $ pnpm exec vitest run src/match --coverage.enabled=false | grep -E "^(Error|AssertionError)|Tests |Test Files" | sort | uniq -c
        1       Tests  25 failed (25)
        1  Test Files  3 failed (3)
        4 Error: not implemented (1 arguments)
       21 Error: not implemented (2 arguments)
  ```

- GREEN: the subject builders, `screenCandidates`, `screeningCoverage`, `entryKey` and `evidenceHashInput`, `screenCryptoAddress`, `retrievalQuery`, and the name text.

  ```
  $ pnpm exec vitest run src/match src/names --coverage.enabled=false
   FAIL  src/match/coverage.test.ts > the evidence-hash input (C75.3) > frames entry key, ...
  ReferenceError: canonicalJson is not defined        (a missing import; added)
  $ pnpm exec vitest run src/match src/names --coverage.include='src/{match,names}/**'
        Tests  45 passed (45)
  All files          |   98.19 |     88.5 |   98.14 |   98.28 |
  $ pnpm exec tsc --noEmit; pnpm exec eslint src/match src/names     (no output)
  ```

  One test expectation was corrected before the RED commit: `matchTypes` follow the core `REPORT_MATCH_TYPES` order, so a corroborated weak alias reads `['birthdate_exact', 'weak_alias']`.

## Slice 7: the reverse index (C78.6)

- Stub: `3ad1dcd8`.
- RED: `f3275367`.

  ```
  $ pnpm exec vitest run src/reverse-index --coverage.enabled=false | grep -E "^(Error|AssertionError)|Tests |Test Files" | sort | uniq -c
        1       Tests  no tests
        1  Test Files  1 failed (1)
        1 Error: not implemented (2 arguments)
  ```

  The file fails at collection: its index is built at module level through the stub.

- GREEN:

  ```
  $ pnpm exec vitest run src/reverse-index --coverage.include='src/reverse-index/**'
        Tests  4 passed (4)
  All files |   96.36 |       90 |   88.88 |   96.15 |
  ```

  `@typescript-eslint/no-confusing-void-expression` asked for braces in one arrow (fixed with `eslint --fix`).

## Slice 8: the matcher version (C69.4 provenance)

- Stub `a495cf7e`, RED `47977bcc` (`Error: not implemented (2 arguments)`, 1 failed), GREEN `eb3d9f17` (1 passed).

## Slice 9: the C78.7 budgets, profiling and the name-score bound

Scratch benchmarks (`<scratchpad>/bench/*.mjs`, never committed) on synthetic tables from a seeded generator of our own (30 syllables: two make a given name, three a family name; 40% of entries carry an alias; no held-out data, rule 16). Node 22.22.1 on the dev machine, one thread, the shipped variant-group file loaded.

First measurement, after slice 7:

```
{"step":"list name rows","names":100000,"records":71344,"ms":5408.64,"usPerName":54.09,"keysPerName":5.3,"distinctKeys":140642}
{"step":"screening (in-memory retrieval + scoring, tolerant)","names":100000,"subjects":300,"retrievalP50":0.32,"retrievalP95":0.83,"scoreP50":45.74,"scoreP95":160,"totalP95":160.55,"candidatesP50":269,"candidatesP95":867,"capped":0,"withMatch":64}
{"step":"scoring the 2,000-candidate cap","p50":235.28,"p95":328.56,"usPerCandidate":117.64}
```

The scoring p95 alone (160 ms) was over the C78.7 budget of 100 ms. A CPU profile of 15 screenings of 2,000 candidates put 16% inclusive in C58's `areNicknames` (it folds both tokens on every call), 13% in the per-candidate name analysis (C58's fold of plain ASCII tokens) and the rest in alignments of pairs that could never reach the display floor. Three changes, each with the 171-test suite green before and after (the golden digest unchanged):

- `9d46f398` refactor: the C58 nickname table folded once into links (checked against C58's `areNicknames` on 17,390 pairs, the whole table and cross pairs: 0 differences), ASCII letters and digits read without folding (C58's fold only lower-cases them), qualifiers computed only for a candidate that can use them, identifier rows only when the subject has identifiers. 235 to 143 ms per 2,000-candidate screening.
- `0a4f8d55` stub, `b772c880` RED (`Error: not implemented (4 arguments)`, 2 failed), `87b0e316` GREEN: `nameScoreUpperBound`, an upper bound from the tokens that can pair alone or joined, tested never to fall below the score on every pair of 23 person and 6 business names under strict, tolerant and a loose custom preset (1,695 pairs).
- `802a2a07` refactor: the screening skips the exact alignment of a pair whose bound is below the display floor or below the best pair so far, and recomputes exactly when an identifier or a weak alias returns the entry; a join is tried only when its lengths or groups allow a pair. 173 tests green.

After the changes:

```
{"step":"variant groups load","ms":1597.85,"groups":156706,"forms":443900,"heapMiB":241}
{"step":"list name rows","names":100000,"records":71344,"ms":3915,"usPerName":39.15,"keysPerName":5.3,"distinctKeys":140642}
{"step":"screening (in-memory retrieval + scoring, tolerant)","names":100000,"subjects":300,"retrievalP50":0.27,"retrievalP95":0.66,"scoreP50":11.26,"scoreP95":40.12,"totalP95":41.04,"candidatesP50":269,"candidatesP95":867,"capped":0,"withMatch":64}
{"step":"scoring the 2,000-candidate cap","p50":49.57,"p95":63.87,"usPerCandidate":24.78}
1,000,000 names:
{"step":"list name rows","names":1000000,"records":713955,"ms":32457.77,"usPerName":32.46,"keysPerName":5.3,"distinctKeys":1021371}
{"step":"screening (in-memory retrieval + scoring, tolerant)","names":1000000,"subjects":300,"retrievalP50":2.37,"retrievalP95":8.97,"scoreP50":78.87,"scoreP95":143.97,"totalP95":149.84,"candidatesP50":2000,"candidatesP95":2000,"capped":180,"withMatch":97}
{"step":"scoring the 2,000-candidate cap","p50":61.09,"p95":81.43,"usPerCandidate":30.55}
re-screen (C74.4), 200,000 subjects in four chunks of 50,000, 500 changed entries:
{"subjects":200000,"chunks":4,"changedEntries":500,"buildMsTotal":5091,"lookupMsTotal":256,"scoreMsTotal":10146,"candidatesPerEntry":650,"matches":175,"msPerChangedEntryP50":14.97,"msPerChangedEntryP95":52.95,"heapMiB":709}
```

The in-memory retrieval stands in for Postgres (rare keys at most 2% of the names, the 2,000 cap); `api-watchlists` gates the 100,000-name p95 with the real `retrieveCandidates`. The synthetic million reuses 30 syllables, so its keys are far denser than a real list's: the cap bound in 180 of 300 screenings there, an upper bound on how often it binds.

## Final gates

```
$ pnpm --filter @openverify/watchlist typecheck
$ tsc --noEmit                                   (passes)
$ pnpm --filter @openverify/watchlist lint
$ eslint .                                       (passes)
$ pnpm exec vitest run src/translit src/names src/keys src/crypto src/score src/match src/reverse-index src/stubs.test.ts \
    --coverage.include='src/{translit,names,keys,crypto,score,match,reverse-index}/**'
      Tests  173 passed (173)
All files          |   98.35 |    89.51 |   97.88 |   98.47 |
$ pnpm typecheck        Tasks: 14 successful, 14 total
$ pnpm lint             Tasks: 14 successful, 14 total   (a first run failed in @openverify/api#lint on a file another agent was editing; the rerun passed)
$ pnpm format:check     All matched files use Prettier code style!
```

The package's whole test script, once `watchlist-ingest`'s PEP slice had gone GREEN (`a9070fd1`, `620950a1`):

```
$ pnpm --filter @openverify/watchlist test
 Test Files  51 passed (51)
      Tests  457 passed (457)
All files          |   98.69 |    90.28 |   98.68 |   98.73 |
```
