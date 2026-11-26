# Phase 6, Workflow 6A Stage 2: fixtures-6 (TDD evidence)

Area: C77.5 (`@openverify/watchlist/testing`: synthetic lists in each publisher's format and in the normalised format, the sandbox lists `openverify-sandbox` and `openverify-sandbox-pep`, synthetic SPARQL answers with fictional QIDs, open-ended tenures and relatives), C78.8 (the held-out generator and customer population) and the synthetic stub answers for GDELT, HIBP, Twilio Lookup and Smarty. Owned paths: `packages/watchlist/src/testing/` (the `held-out/` folder included) and `packages/watchlist/fixtures/`.

Every unit went stub (its own `chore` commit, so the RED test compiles and typechecks), then RED (run, seen failing for its reason: `not implemented`, or an assertion on behaviour that did not exist yet), then GREEN. Commands ran after `source scripts/env.sh`. The independence rule held throughout: `packages/watchlist/src/score` and `src/match` were never opened; nothing under `src/testing/held-out/` produces a committed case.

## Unit 1: seeded stream, fictional names, identifiers, crypto addresses

- Stub `5135b8dc`, RED `338c44ed`, GREEN `0494501c`.
- RED: `pnpm --filter @openverify/watchlist exec vitest run src/testing --coverage.enabled=false`

  ```
  24 Error: not implemented (1 arguments)
   3 Error: not implemented (2 arguments)
   Test Files  4 failed (4)
        Tests  30 failed (30)
  ```
- GREEN, same command: `Test Files 4 passed (4)`, `Tests 30 passed (30)`; folder coverage 98.3% statements, 95.18% branches.
- The first GREEN run failed two tests for a reason worth recording: the BIP-173 P2WPKH constant I had typed from memory (`…g4c5r3…`) was wrong. The encoder's output (`bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`) equals the vector the repo transcribed from BIP-173/BIP-350 (`packages/checks/src/crypto/vectors/segwit-addresses.ts`), and the C57 validator accepts it, so the constant was corrected; the encoder was right.
- Oracles independent of the code under test: the Phase 5 validator `validateCryptoAddress` for every C57 format, published base58, base58check, BIP-173 and CashAddr vectors, a bech32 checksum verifier written in the test, and the plan's sandbox LEI and IMO check digits (both valid).

## Unit 2: synthetic records and the normalised import file

- Stub `4b63dcbc`, RED `06073459`, GREEN `d933deba`.
- RED: `pnpm --filter @openverify/watchlist exec vitest run src/testing/records.test.ts src/testing/normalised.test.ts --coverage.enabled=false`

  ```
  7 Error: not implemented (1 arguments)
  1 Error: not implemented (3 arguments)
   Test Files  2 failed (2)
        Tests  9 failed (9)
  ```
- GREEN, the testing folder: `Test Files 6 passed (6)`, `Tests 43 passed (43)`.

## Unit 3: synthetic PEPs, the sandbox lists, the committed fixtures

- Stub `0b78e7e4`, RED `ec5e308a`, GREEN `bd2e24c9` (writes `packages/watchlist/fixtures/*.json` with `OPENVERIFY_WRITE_FIXTURES=1`).
- RED: `vitest run src/testing/peps.test.ts src/testing/sandbox.test.ts src/testing/fixture-files.test.ts`

  ```
  4 Error: not implemented (0 arguments)
  7 Error: not implemented (1 arguments)
   Test Files  3 failed (3)
        Tests  10 failed (10)
  ```
- GREEN, the testing folder: `Test Files 9 passed (9)`, `Tests 56 passed (56)`.
- One RED assertion changed in the GREEN commit, disclosed here: "no filler shares a magic name token" now leaves out legal forms and `holdings`. Fillers are realistic company names (`… Holdings Ltd`); only the distinctive tokens must stay unique to the magic entries. The intent of the test is unchanged.
- Follow-up cycle (C89.1): the committed list held a Han-named filler built from common characters, which reads like a real name. Stub `5b4bf82a` (the `hanNames` option), RED `3ff61c17`:

  ```
  × leaves Han names out when asked, as committed lists do (C89.1)
  × carry no Han name, which common characters would make real-name-shaped (C89.1)
  AssertionError: openverify-sandbox: expected [ 'latin', 'cyrillic', 'latin', …(99) ] to not include 'han'
  ```
  GREEN `35240470`: `Tests 58 passed (58)`, the fixtures regenerated.

## Unit 4: XML writer, ZIP writer, publisher country names and dates

- Stub `7ade7cf3`, RED `3e92d385`, GREEN `014f8bac`.
- RED: `vitest run src/testing/formats`

  ```
  5 Error: not implemented (1 arguments)
  1 Error: not implemented (2 arguments)
  1 Error: not implemented (3 arguments)
   Tests  7 failed (7)
  ```
- GREEN: `Tests 7 passed (7)`. The XML is read back by `saxes`; the ZIP by an independent reader in the test, which inflates with `node:zlib` and checks the CRC-32 (whose check value `0xcbf43926` is asserted too).

## Unit 5: OFAC, EU, UK and UN writers

- Stub `8f9e110d`, RED `5e179d90`, GREEN `fd082887`.
- RED: `vitest run src/testing/formats/publishers.test.ts`: the file failed at collection, `Error: not implemented (2 arguments)`.
- GREEN: `vitest run src/testing/formats`: `Test Files 2 passed (2)`, `Tests 17 passed (17)`.
- Defect found by running the files through `watchlist-ingest`'s committed OFAC parser: OFAC states countries by `refId` into `referenceValues` (type `Country`, with `isoCode`); my writer wrote country names only, so document and address countries were lost. Fixed test-first: RED `85ea9321`

  ```
  × states countries through country reference values, by refId, as the XSD does
  AssertionError: expected 0 to be greater than 0
   Tests  1 failed | 10 passed (11)
  ```
  GREEN `db7180cf`: `Tests 11 passed (11)`.
- `d3de8d74` adds `parsers-compat.test.ts`, a characterization test written after both sides existed (not a RED step): the synthetic OFAC enhanced file and its ZIP read back through `parseOfacEnhanced` and `parseOfacEnhancedZip` on every fact both sides agree on. `Tests 2 passed (2)`.

## Unit 6: change signals and synthetic SPARQL answers

- Stub `1c3c9354`, RED `f7d881e6`, GREEN `d50efb89` (adds `fixtures/wikidata-pep.synthetic.sparql.json`).
- RED: `vitest run src/testing/sparql.test.ts src/testing/formats/signals.test.ts src/testing/fixture-files.test.ts`

  ```
  1 Error: not implemented (0 arguments)
  2 Error: not implemented (1 arguments)
  3 Error: not implemented (2 arguments)
   Tests  5 failed | 3 passed (8)
  ```
  The stub's `PepSparqlVariables` type was a literal type, which made the renaming test fail to typecheck; it became `Record<…, string>` in the RED commit, a type-only stub change.
- GREEN, the testing folder: `Test Files 13 passed (13)`, `Tests 87 passed (87)`.

## Unit 7: GDELT, HIBP, Twilio Lookup and Smarty stub answers

- Stub `6e02dd8a`, RED `33dcc471`, GREEN `f5a4e6eb`.
- RED: `vitest run src/testing/providers`: the file failed at collection, `Error: not implemented (1 arguments)`.
- GREEN: `Tests 11 passed (11)`.

## Unit 8: the held-out generator (C78.8)

- Stub `898c3cec`, RED `3b47c0df`, GREEN `33274506`.
- RED: `vitest run src/testing/held-out`: the file failed at collection, `Error: not implemented (1 arguments)`.
- GREEN: `Tests 13 passed (13)`. The tests use fictional groups in rigour's line format; no test reads `data/rigour-person_names.txt`.
- The generator parses group lines exactly as `watchlist-matcher`'s build filter does (`line.lastIndexOf(' => ')`, the id after it), so both select held-out groups through `isHeldOutGroup` by the same id.

## Refactor and docs

- `53efe378` removes the stub helper once no stub was left; `ce0c4db1` adds `packages/watchlist/fixtures/README.md`.

- `92a3de45` extends `parsers-compat.test.ts` (characterization) once `watchlist-ingest` landed its EU, UK and UN parsers: every entry of the synthetic EU FSF, UK Sanctions List and UN consolidated files reads back under its id, with the kinds and publication times each format states. `Tests 5 passed (5)`.

## Final gates (foreground, 2026-10-27)

- `pnpm --filter @openverify/watchlist typecheck`: passed. `pnpm --filter @openverify/watchlist lint`: passed.
- `pnpm --filter @openverify/watchlist test`: `Test Files 46 passed (46)`, `Tests 415 passed (415)`; coverage 98.31% statements, 89.82% branches, 97.74% functions, 98.34% lines. A first run failed one file outside these paths, `watchlist-matcher`'s RED `src/reverse-index/reverse-index.test.ts` (`not implemented`); it passed once its GREEN landed.
- `pnpm typecheck`: `Tasks: 14 successful, 14 total`. `pnpm lint`: `Tasks: 14 successful, 14 total`. `pnpm format:check`: `All matched files use Prettier code style!`
