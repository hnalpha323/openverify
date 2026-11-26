# Phase 6, Workflow 6A Stage 2: `risk-logic` (TDD evidence)

Area: C82's R and H logic as pure functions (the authored email tables and their build test, SPF and
DMARC parsing, the typo suggestion, the email band table; the phone type mapping and risk table; the
address checks) and C81.3's adverse-media lexicon and relevance with the business-name rule. Owned
paths: `packages/checks/src/reports/`, `packages/checks/data/reports/`.

Every slice went stub (compiles, typechecks, lints), then RED (run and seen failing for its reason),
then GREEN. Commands run from `packages/checks` after `source scripts/env.sh`; outputs are abbreviated
to the lines that matter.

## Slice 1: risk constants, the report table loader, the authored email tables and their build test

Authoring step (not a test, never in CI): every free-mail and relay domain was resolved for MX on
2026-10-27 with a `node:dns/promises` `Resolver` (3 s, 2 tries) from a scratch script, and kept only
when its exchanges belonged to the provider. Dropped as a result: `outlook.co.uk` (MX of another
company), `hotmail.com.mx` and `yahoo.ch` (no MX), `love.com` (now Google-hosted, not AOL),
`games.com`, `yandex.ua`, `mail.ua` (no MX), `lenta.ru` (a news site), and the paid or ISP mailboxes
(`verizon.net`, `188.com`, the `vip.` subdomains), since `free_mail` means a free sign-up. The
provider pages were checked to answer over HTTPS. Result: 237 free-mail domains of 39 providers (36
typo references), 17 relay domains of 7 providers, 89 role names (15 from RFC 2142), 23 MX providers.

- Stub `38a34187`: `constants.ts`, `data.ts`, `email/tables.ts`, `build-data.ts`, exports wired.
  `pnpm exec tsc --noEmit -p .` (clean), `pnpm exec eslint src/reports` (clean),
  `pnpm exec vitest run src/index.test.ts --coverage.enabled=false`: 11 passed.
- RED `ef8fc7ba`:

  ```
  $ pnpm exec vitest run src/reports --coverage.enabled=false
  AssertionError: expected [] to deeply equal [ 'email-breach-window-days', …(34) ]
  AssertionError: expected [Function] to throw error matching /plain file name/ but got 'not implemented: ../manifest.json'
  AssertionError: expected [Function] to throw error matching /gmail\.com/ but got 'not implemented: 54 disposable_email_…'
  AssertionError: expected [Function] to throw error matching /not the pinned file/ but got 'not implemented: /tmp/openverify-repo…'
   Test Files  4 failed (4)
        Tests  41 failed | 1 passed (42)
  ```

  The one test passing is the `RISK_UNAVAILABLE_REASONS` vocabulary, a constant the stub declares.
- GREEN `2a59875a`: the constants (each `provisional` with its source), the loader, the four
  authored tables, the table functions, and the builder, then the builder run once:

  ```
  $ node --conditions=@openverify/source --import ./scripts/register-ts.mjs src/reports/build-data.ts
  wrote email-tables-check.json (648 bytes)
  $ pnpm exec vitest run src/reports --coverage.enabled=false
   Test Files  4 passed (4)
        Tests  128 passed (128)
  ```

  The build test is CI-safe without the gitignored list: `email-tables-check.json` records the
  SHA-256 of the checked domains and of the disposable list, so any edit to the tables or to the
  manifest pin fails the test until the builder runs again; the builder refuses to write while any
  domain is listed (`emailTablesCheck` throws, naming them).

## Slice 2: SPF (RFC 7208) and the DMARC tree walk (RFC 9989 §4.10)

RFC 9989's walk was read at the RFC Editor before writing it (the first query at the Author Domain;
the walk from its parent, or from the last seven labels of a name of eight or more; a stop only at
`psd=n` or `psd=y`; the Organizational Domain from `psd=n`, one label below `psd=y`, or the record
with the fewest labels; at most eight queries).

- Stub `a85f48fb`.
- RED `7d07d0da`:

  ```
  $ pnpm exec vitest run src/reports/email/spf.test.ts src/reports/email/dmarc.test.ts --coverage.enabled=false
       35 Error: not implemented
   Test Files  2 failed (2)
        Tests  54 failed (54)
  ```
- GREEN `fbcb0258`: 54 passed. While writing it, a mechanism named like an object member
  (`constructor`) read as valid through a plain-object lookup; the mechanisms became a `Map`, and the
  case was added to the invalid list in the same commit (a pin on green code, never committed broken).

## Slice 3: email domain classes, the typo suggestion, the MX heuristic, the band

- Stub `922c74c0`.
- RED `582b5f5b`:

  ```
  $ pnpm exec vitest run src/reports/email/domain.test.ts src/reports/email/report.test.ts --coverage.enabled=false
       62 Error: not implemented
   Test Files  2 failed (2)
        Tests  62 failed | 1 passed (63)
  ```
- GREEN `454caa0b`. On the way, `emailTypoSuggestionOf('gmail.com')` answered `ymail.com` (two free
  domains one edit apart); the rule now never reads a free-mail domain as a typo (the test that
  caught it was in the RED commit). The undated-breach case (`latestBreachAt: null`) was pinned in the
  GREEN commit after coverage showed it unexercised.

  ```
  $ pnpm exec vitest run src/reports --coverage.enabled=true --coverage.include='src/reports/**'
        Tests  247 passed (247)
    report.ts |   97.45 |    93.47 |     100 |   97.36
  ```
- Refactor `6420dce5`: `ContactConfirmation` moved to `constants.ts` for the phone report; 247 passed.
- RED `cba98785` (found while reviewing the API's C56 resolver, which caches exchanges as the bare
  word `exchange`): a masked MX answer gave `high`.

  ```
  AssertionError: expected { band: 'high', confidence: 0.5, …(2) } to deeply equal { band: null, confidence: null, …(2) }
        Tests  1 failed | 35 passed (36)
  ```
- GREEN `1ad57399`: exchanges without a host name leave the MX heuristic undetermined, which blocks
  `high` and `medium` (a definite `low` still stands); 382 passed.

## Slice 4: phone line type and risk table

- Stub `d8c7ef73`.
- RED `3ef07dcf`:

  ```
  $ pnpm exec vitest run src/reports/phone --coverage.enabled=false
       55 Error: not implemented
   Test Files  1 failed (1)
        Tests  58 failed | 1 passed (59)
  ```
- GREEN `fa5a3e19`: 59 passed; `report.ts` 98.95% lines.
- Pin `9fbce5d9` (written on green code, passing at once): every type C55.8's
  `REFUSED_PHONE_NUMBER_TYPES` holds maps to a high / block type.

## Slice 5: address checks and the US ZIP prefixes

- Stub `c763075c` (with the provisional `address-cmra-hint-confidence`).
- RED `6c0daeb3`:

  ```
  $ pnpm exec vitest run src/reports/address src/reports/build-data.test.ts --coverage.enabled=false
  Error: cannot read report table us-zip-prefixes.json
       15 Error: not implemented
   Test Files  3 failed (3)
        Tests  20 failed | 8 passed (28)
  ```
- GREEN `8d5e7824`: the parser, the builder entry and the generated table, then

  ```
  $ node --conditions=@openverify/source --import ./scripts/register-ts.mjs src/reports/build-data.ts
  wrote email-tables-check.json (648 bytes)
  wrote us-zip-prefixes.json (2173 bytes)
  $ pnpm exec vitest run src/reports/address src/reports/build-data.test.ts --coverage.enabled=false
   Test Files  3 passed (3)
        Tests  43 passed (43)
  ```

  `email-tables-check.json` came out byte-identical (no diff). `data/reports/NOTICE` carries the CC BY
  4.0 attribution of the libaddressinput prefixes.

## Slice 6: adverse-media lexicon and relevance

The lexicon was written in three edits (four categories each) as authored word lists; country names
come from `Intl.DisplayNames` at run time, never typed out.

- Stub `699a537d`.
- RED `53667849`:

  ```
  $ pnpm exec vitest run src/reports/media --coverage.enabled=false
       32 Error: not implemented
  TypeError: Cannot read properties of undefined (reading 'en')
   Test Files  2 failed (2)
        Tests  37 failed (37)
  ```
- GREEN `1411aa54`: 37 passed, then the name readers' edges (an empty name, a legal form written as
  initials, trailing connectors, a country code `Intl` cannot read) pinned in the same commit: 39
  passed, `relevance.ts` 100% lines. One query term (`tax evasion`) was replaced by
  `misappropriation` to keep every GDELT word at four letters or more, as the RED test asked.

## Final gates (foreground)

```
$ pnpm --filter @openverify/checks typecheck      # tsc --noEmit, clean
$ pnpm --filter @openverify/checks lint           # eslint ., clean (the Phase 5 regexp and log-key rules cover src/reports)
$ pnpm --filter @openverify/checks test
 Test Files  161 passed (161)
      Tests  3304 passed (3304)
All files          |   98.73 |    91.32 |   99.32 |   98.71
$ pnpm typecheck                                  # Tasks: 14 successful, 14 total
$ pnpm lint                                       # first run: @openverify/watchlist#lint failed in another agent's file;
                                                  # re-run a few minutes later: Tasks: 14 successful, 14 total
$ pnpm format:check                               # All matched files use Prettier code style!
```

Per file (lines / branches / functions): `build-data.ts` 82.14 / 90 / 85.71 (its command-line
`main()` is run by a person, not by a test), every other `src/reports` file 95.5-100 / 87.5-100 / 100.
