# TDD evidence: Workflow 5A Stage 2, `checks-matching` (Phase 5)

- **Slice owner:** the Workflow 5A Stage 2 `checks-matching` agent, in parallel with `checks-contact-crypto`, `flow-5a` and `android-5a` (disjoint paths).
- **Date:** 2026-10-23.
- **Base:** `090eb99`; this slice's commits run from `6da2e2f` to the commit that adds this file.
- **Input:** the plan's `checks-matching` bullet (C58 in full, the C59 database and AAMVA evaluators), with the Stage 1a and 1b hand-overs. Owned paths: `packages/checks/src/matching/`, `src/database/`, `packages/checks/data/`, `packages/checks/scripts/build-*`, the database reasons file and config module (both unchanged), `THIRD_PARTY_LICENSES.md` and the matching NOTICE, and this slice's `data/manifest.json` entries.

Each unit follows the same cycle: a stub (`chore`) so the RED commit compiles and type-checks; the test, seen failing for the intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`). All commands ran after `source scripts/env.sh`, from `packages/checks` unless shown otherwise. Output is trimmed to the lines that matter. Every name, street, city, postal code, number and address in these tests is synthetic (invented surnames and places, unassigned ZIP codes, 555-01xx numbers, `example.test`).

## 0. The interrupted run's draft

An earlier run of this area stopped at the account limit with no commits and one uncommitted draft, `packages/checks/data/nicknames-authored.tsv` (737 lines). It was reviewed against C58.3 and kept, with these changes before its first commit (`a756b1b`):
- its header named a Python builder; the builder is `scripts/build-nicknames.ts`;
- its last section claimed rows "accepted in the review of the Wikidata candidates" but carried no Wikidata items, so it could not be traced. The section was removed: the Wikidata step was redone (section 3) with every accepted pair keyed by its two items. The four rows of that section that no reviewed pair covers are genuine authored knowledge and were kept as authored rows (antonia/tonia, dorothea/dora, mathew/matt, umberto/berto);
- three doubtful pairs were removed: isaac/zac, lucas/luke (a variant, not a nickname) and cornelius/neil (a separate name).

## 1. Match levels, three-valued groups, input caps (C58.1, C58.7)

Stub `6da2e2f` (`levels.ts`, `limits.ts`). RED `08af855`:
```
$ pnpm exec vitest run src/matching/levels.test.ts src/matching/limits.test.ts --coverage.enabled=false
 FAIL  src/matching/levels.test.ts > fieldMatch > keeps the level and orders methods as the public list does, without duplicates
Error: not implemented
 FAIL  src/matching/levels.test.ts > meetsRequirement > full meets full: true
      Tests  25 failed | 2 passed (27)
```
The two that passed check constants the stub already declared (the method list, the caps). GREEN `b5c6889`:
```
      Tests  27 passed (27)
```
The C58.1 cases are tests: a step that collects name and phone only (the default group is undecidable, not unmet), a record without a birthdate (undecidable), a business that left both optional inputs blank (both groups undecidable).

## 2. Partial dates R1-R6 (C58.5)

Stub `9408d8b`. RED `d7ec29a`:
```
$ pnpm exec vitest run src/matching/partial-dates.test.ts --coverage.enabled=false
 FAIL  src/matching/partial-dates.test.ts > parsePartialDate > reads "1987-04-12"
Error: not implemented (10)
      Tests  42 failed (42)
```
One expectation was corrected before the RED commit: with candidate centuries 19YY and 20YY every two-digit year resolves (1926-12-31 is aged 99, not 126), so the "no century fits" case became the case that does constrain the century, 29 February (`000229` is 2000, as 1900 had none). GREEN `8a49a7b`:
```
      Tests  69 passed (69)        # the matching folder so far
```
Lint first refused `[Xx]` classes (`regexp/use-ignore-case`) and an alternation of single characters; both were rewritten before the GREEN commit.

## 3. Text folding, the nickname table and its builder (C58.2, C58.3)

**The Wikidata query** (dev only, in a scratch folder, never in CI). The final query, `packages/checks/data/nicknames.sparql`, asks for hypocorism items (P31 Q1130279) linked by P460 in either direction to a given-name item that is not itself a hypocorism, both with a native label in the same language:
```
$ curl -G https://query.wikidata.org/sparql --data-urlencode query@nicknames.sparql \
    -H 'Accept: application/sparql-results+json' -o result.json -w '%{http_code} %{size_download}\n'
200 1221274
$ date -u   # retrieved-at
2026-10-23T13:54:47Z
$ sha256sum nicknames.sparql result.json
95c285e99f01b6ff8d14f83ad340d3641bebf3ea4089ab0c4cb2f7f3efb682a7  nicknames.sparql
bbbf758e1b4e891795524d05c61cc9f796dff2ed0fa8fb8dc77147717c8d09e3  result.json
2519 rows; languages: mul 2243, el 242, en 13, pl 8, es 6, uk 2, eu 1, fr 1, grc 1, it 1, pt 1
```
Most native labels are language `mul`, so the language filter does not separate translations from diminutives (P460 links Bill to William, Willem, Guillaume, Wilhelm ...). The review therefore read every Latin-script candidate (2,114 rows, 203 hypocorism items) by hand and accepted only diminutives used in the language it assigned, rejecting translations, spelling variants and nickname-to-nickname links; Greek and other scripts were left out (not reviewable here). 132 rows were accepted (130 pairs: two pairs have two items each), each resolved to its items from the saved result by a script, which found every accepted pair. The result is not committed; `nicknames-wikidata.tsv` records the endpoint, date, digest and counts.

Stub `a756b1b` (`text.ts`, `data-files.ts`, `nicknames.ts`, `scripts/build-nicknames.ts`, and the three source files). RED `c3880d5`:
```
$ pnpm exec vitest run src/matching/text.test.ts src/matching/nicknames.test.ts src/matching/data-files.test.ts src/matching/build-nicknames.test.ts --coverage.enabled=false
 FAIL  src/matching/nicknames.test.ts [ src/matching/nicknames.test.ts ]
Error: not implemented (0 arguments)
 FAIL  src/matching/build-nicknames.test.ts [ src/matching/build-nicknames.test.ts ]
Error: not implemented (1 arguments)
 Test Files  4 failed (4)
      Tests  27 failed (27)
```
GREEN `7847c87`, with the table built from the committed inputs and the saved result checked:
```
$ node --conditions=@openverify/source --import ./scripts/register-ts.mjs scripts/build-nicknames.ts \
    --wikidata-result <scratch>/result.json
checked <scratch>/result.json against the recorded SHA-256 and every accepted pair
wrote nicknames.json: {"pairs":1390,"formal-names":686,"authored":1341,"wikidata":130}
$ pnpm exec vitest run src/matching --coverage.enabled=false
      Tests  129 passed (129)
```
The first output was 222 KB of two-space JSON; the serializer now writes one pair per line (125 KB). The test `the committed nicknames.json is exactly what the builder makes of the committed inputs` keeps the table and its sources in step.

## 4. The matching tables from pinned sources (C58.4, C67)

The 48 sources (46 libpostal dictionaries at `25099c5`, OpenCage `conf/state_codes.yaml` at `cbf2348`, libaddressinput `testdata/countryinfo.txt` at `81eb962`) were read at their commits, their licences checked (MIT, MIT, CC BY 4.0 for the data), and their entries written into `data/manifest.json` from the downloaded bytes (digest and size). Then:
```
$ python3 scripts/fetch_data.py   # from the repository root
libpostal_en_street_types: downloaded data/libpostal-en-street_types.txt (MIT)
...
opencage_state_codes: downloaded data/opencage-state_codes.yaml (MIT)
libaddressinput_countryinfo: downloaded data/libaddressinput-countryinfo.txt (CC-BY-4.0)
$ (cd services/vision && uv run --no-sync pytest tests/test_fetch_data.py -q --no-cov)
36 passed in 1.47s
```
Stub `34ddd78` (the manifest entries and `scripts/build-matching-data.ts`). RED `3fc524e`:
```
$ pnpm exec vitest run src/matching/build-matching-data.test.ts --coverage.enabled=false
 Test Files  1 failed (1)
      Tests  13 failed | 1 passed (14)
```
(the stubs answered "not implemented"; the committed-table tests found no table: "cannot read matching table"; the one passing test checks that no CC BY-SA list is a source, true of the stub's empty role list.) The first build stopped on upstream data:
```
Error: BY: the postal-code pattern does not match its example 20050
```
Three examples at the pinned commit contradict their own patterns (BY 20050 for a six-digit pattern, EE 1001 for five, GB RH6 OHP with the letter O). They are listed as reviewed errata in the builder, left out, and named in the NOTICE as a change; any other mismatch still stops the build. GREEN `e7b66f8`:
```
$ node --conditions=@openverify/source --import ./scripts/register-ts.mjs scripts/build-matching-data.ts
wrote matching-dictionaries.json (75976 bytes)
wrote subdivisions.json (62924 bytes)
wrote postal-codes.json (13602 bytes)
$ sha256sum data/*.json > first; <build again>; sha256sum data/*.json | diff - first && echo DETERMINISTIC
DETERMINISTIC
$ pnpm exec vitest run src/matching --coverage.enabled=false
      Tests  143 passed (143)
```
One RED assertion was corrected in this GREEN commit, as its message says: it looked for `saint|st` among libpostal's toponyms, where libpostal lists it among personal titles; the test now checks `california|ca` in the toponyms and `saint|st` in the titles.

## 5. Person names (C58.2)

Stub `48f8329` (`dictionaries.ts`, `names.ts`). RED `fb9964f`:
```
$ pnpm exec vitest run src/matching/names.test.ts src/matching/dictionaries.test.ts --coverage.enabled=false
     17 Error: not implemented (2 arguments)
      Tests  41 failed (41)
```
GREEN `4703848`:
```
$ pnpm exec vitest run src/matching --coverage.enabled=false
      Tests  184 passed (184)
```
Corrected in this GREEN commit: the RED test expected `apt` to stand for `apartment` alone; the merged classes of every language also give `apartamento` and `appartement`, so it now checks that `apartment` is one of them.

## 6. Postal codes and addresses (C58.4)

Stub `f9917a0`. RED `7fcb831`:
```
$ pnpm exec vitest run src/matching/addresses.test.ts src/matching/postal-codes.test.ts --coverage.enabled=false
     24 Error: not implemented (2 arguments)
      Tests  41 failed (41)
```
GREEN `b48318a`: the 41 passed on the first run of the implementation. Lint then refused the first tokenizer (`regexp/no-super-linear-move`: a long run of digits followed by a letter could be rescanned; the 500-character cap bounded it, but the rule is right), so tokens are now chunks of one linear pattern, classified afterwards:
```
$ pnpm exec eslint src/matching && pnpm exec vitest run src/matching --coverage.enabled=false
      Tests  225 passed (225)
```
The C58.4 cases are tests: a neighbour's number is `none`; a one-sided unit is `partial`.

## 7. Business names and exact identifiers (C58.6, C59.3)

Stub `c64a8d9`. RED `9488dbb`:
```
     11 Error: not implemented (2 arguments)
      Tests  28 failed (28)
```
GREEN `183ebf6` (lint first flagged a condition TypeScript could not see change inside a callback; the loop became a plain `for`):
```
 Test Files  2 passed (2)
      Tests  28 passed (28)
```

## 8. Jaro-Winkler vectors (C58.7)

`scripts/build-jaro-winkler-vectors.py` (PEP 723, `jellyfish==1.2.1`, `rapidfuzz==3.14.6`, both MIT and older than 14 days) computes 54 pairs of our own and writes a pair only when both oracles agree to 1e-12:
```
$ flock /tmp/openverify-uv.lock uv run --script packages/checks/scripts/build-jaro-winkler-vectors.py
wrote 54 vectors to packages/checks/data/jaro-winkler-vectors.json
$ pnpm exec vitest run src/matching/jaro-winkler-vectors.test.ts --coverage.enabled=false
      Tests  54 passed (54)
```
Commit `0642000` (`test`). **A characterization test, not RED first:** it pins an implementation that already existed (`src/name-matching.ts`, outside this slice's paths), and the implementation agrees with both oracles on every pair, so it passed on its first run. Ruff flagged the astral character in the source (RUF001); it is written as an escape now, and a rebuild gave the same digest.

## 9. Database and AAMVA evaluators (C59)

Stub `0921a8b`; `cd1596f` renamed the config helpers (`databaseCheckConfig`, `databaseResultOptions`) and kept them inside the folder, because the contact folder has helpers of the same purpose and a shared export name would break the package entry point. RED `e43a47b`:
```
$ pnpm exec vitest run src/database --coverage.enabled=false
     58 Error: not implemented (2 arguments)
 Test Files  6 failed (6)
      Tests  74 failed (74)
```
GREEN `02ac542` (two compile fixes on the way: `isCheckResult` is already a package export of the government ID folder, so the database one is `isStandInResult`; `addressOf` takes any object):
```
$ pnpm exec vitest run src/database src/matching --coverage.enabled=false
      Tests  381 passed (381)
```
The contract test checks that each evaluator declares exactly its C51.2 row, that 24 database and AAMVA inputs reach at least 35 distinct (check, reason) pairs and none outside the table, that no provider-backed check passes without the provider answering, and that the default template decides the sandbox endings as C65.5 expects (echo passed, nickname passed, another surname failed, a thin file and an unbound provider in review).

## 10. Coverage hardening

`f312c11` (`test`): tests for branches the first tests left out (a house number in the other order for its country, trailing directionals, ordinal words, a street name joined on one side, ZIP+4 extensions, two fuzzy components, a house number without a street, a middle name inside the first name, the other side's normalisation). Written on a green suite, they passed on their first run.

## 11. Records

`178146e` (`docs`): `THIRD_PARTY_LICENSES.md` §2.1.8 (the dev-only oracles) and §4.3 (the four sources of the matching tables). `packages/checks/data/NOTICE` (added in `e7b66f8`) carries the two MIT texts verbatim, the CC BY 4.0 attribution with its change, and the Wikidata CC0 note.
```
$ bash infra/tests/ci-workflow.test.sh
# 157 passed, 0 failed, 0 skipped
$ bash infra/tests/apps-image-context.test.sh
# 12 passed, 0 failed
$ (cd services/vision && uv run --no-sync pytest tests/test_ocr_notice.py -q --no-cov)
11 passed in 0.05s
```

## 12. Final gates (foreground, on the tree after `178146e`)

```
$ pnpm --filter @openverify/checks typecheck    # exit 0
$ pnpm --filter @openverify/checks lint         # exit 0
$ pnpm --filter @openverify/checks test         # exit 0
 Test Files  122 passed (122)
      Tests  2223 passed (2223)
All files          |   98.76 |    90.91 |   99.69 |   98.68 |
 src/database      |   98.66 |    93.54 |     100 |   98.55 |
 src/matching      |   98.93 |    92.37 |     100 |   98.85 |
$ pnpm --filter @openverify/core test           # exit 0
      Tests  711 passed (711)
All files          |     100 |    96.61 |     100 |     100 |
$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks:    12 successful, 12 total     (typecheck; 11 cached)
 Tasks:    12 successful, 12 total     (lint; 11 cached)
All matched files use Prettier code style!
$ pnpm exec turbo run typecheck lint --force    # the cache can hide errors, so once more without it
 Tasks:    24 successful, 24 total
Cached:    0 cached, 24 total
$ flock /tmp/openverify-e2e.lock pnpm e2e       # 433 s
@openverify/flow:e2e:   38 passed (12.7s)
@openverify/e2e:e2e:   50 passed (7.0m)
```
The checks package figures include the parallel `checks-contact-crypto` agent's tests that were committed at the time.
