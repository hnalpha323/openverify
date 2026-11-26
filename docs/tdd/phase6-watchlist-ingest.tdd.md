# TDD evidence: Workflow 6A Stage 2, `watchlist-ingest` (Phase 6)

- **Slice owner:** the Workflow 6A Stage 2 `watchlist-ingest` agent, beside `watchlist-matcher`, `fixtures-6`, `risk-logic` and `foundation-6`.
- **Date:** 2026-10-27.
- **Base:** `e03387fa` (Stage 1a's last commit); this slice's commits run from `0d9fbedc` to the commit that adds this file. All are path-scoped to `packages/watchlist/src/{xml,zip,parsers,diff,pep}/`, `packages/watchlist/data/pep-positions.json` and this file.
- **Input:** the plan's "watchlist-ingest" bullet: C77 against the frozen record (the four XML parsers, the single-member ZIP reader, the guards and their hostile tests, the change-signal readers, the diff) and C80.2-C80.4 (the SPARQL result parser, `pep-positions.json` with the public class numbers, open-ended tenures, relatives with their install flag and age rule, the retention rules).

Each unit follows the same cycle:
1. A stub (`chore`), so the RED commit compiles and type-checks.
2. The test, run and seen failing for the intended reason (RED, `test`).
3. The smallest change that passes it (GREEN, `feat`), then a refactor on green where one was worth making.

Where a test was written after the code, it is called a **pin** below and was not RED. Two pins and one cross-check found defects; each defect was then fixed test-first (its test committed RED, then a `fix`).

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every name, number, address, wallet, QID and article in these tests is synthetic or a published test value (Hardhat's first account); no real listed person, PEP or publisher entry appears anywhere.

## 0. Formats, checked before the parsers

- **OFAC enhanced XML.** `ENHANCED_XML.xsd` was downloaded into the scratch directory, never the repository. Its SHA-256 `0c56f9f2d5b9f1ad57dffcd379ed66824c46fbae1e8074157b2b5be46652b97f` matches the research pin. The parser follows it exactly:
  - the root `sanctionsData` in its target namespace;
  - `publicationInfo/dataAsOf`;
  - `referenceValues/referenceValue` (`type`, `value`, `isoCode`, `refId`);
  - `entities/entity`, with `generalInfo`, `sanctionsLists`, `sanctionsPrograms`, `names/name/translations/translation/nameParts`, `addresses`, `features/feature` (with `valueDate`) and `identityDocuments`.
- **UK Sanctions List.** `SanctionsListSchema-4.33.3.xsd` was downloaded into scratch (SHA-256 `073d5db327d7a43c077b1a364118dacf8b7f45a6df91559a6001e34a83c8108a`, 16,418 bytes, as the research measured). The parser follows its element names: `Designations/DateGenerated` and `Designation`, `Name1`-`Name6`, `NonLatinNames`, `IndividualDetails/Individual`, `EntityDetails/Entity`, `ShipDetails/Ship` and `CryptoWalletAddresses`.
- **EU FSF and UN.** Neither publishes a schema (the EU's sits behind EU Login; the UN's URL answers no schema). The parsers follow the research's reading of the files (`phase6-data-sources.md` §3.2 and §2.2). The EU identification and address attributes were not in the research's 64 KiB sample, so their names are our best reading; see the handoff.
- **Wikidata QIDs.** Every class QID in `pep-positions.json`, and every property the queries use, was read from `https://www.wikidata.org/wiki/Special:EntityData/<id>.json` (labels and descriptions only), as the research asked ("record each label with its ID"). No SPARQL query was sent: `query.wikidata.org/robots.txt` disallows `/sparql`, the research agent sent none, and the plan keeps Wikidata to the operator-run sync.

## 1. The guarded XML reader (C77.2)
Stub 0d9fbedc; RED 2661aa46; GREEN f3ea17f0.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/xml --coverage.enabled=false)
     × yields the root, then each captured element in document order, by local name
     × reads the same document whatever the chunk boundaries, multi-byte characters included
     × accepts an XML 1.1 declaration, a UTF-8 byte order mark and a prefixed root
     × hands over each captured element before reading further input
     × refuses a DOCTYPE, so entity expansion and external entities never happen
     × refuses an entity beyond the predefined five · × refuses nesting deeper than the cap and accepts it at the cap
     × refuses a text run, a tag, an attribute or an attribute list over its cap · × refuses a captured element holding more elements than the cap
     × refuses more bytes than the cap and stops reading the source · × refuses a truncated document, text outside the root, two roots and no root
     × refuses bytes that are not UTF-8 and declarations of another encoding · × gives positions, never content, in its messages
       Error: not implemented (2 arguments) / expected Error: not implemented (2 arguments) to be an instance of WatchlistParseError
      Test Files  1 failed (1)
      Tests  13 failed (13)
GREEN: same command, Tests 13 passed (13). A pin written after the code: a comment, an instruction or a CDATA section over the cap, `>` inside or not, is refused (14 passed). `reader.ts`: 100% statements, 95.83% branches.

## 2. The single-member ZIP reader (C77.2)
Stub a5df5fc3; RED 74cc5592 (with `zip/writer.ts`, the synthetic and hostile archive writer the tests use); GREEN a5b8bcec.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/zip --coverage.enabled=false)
     × opens a deflated member and streams exactly its bytes, in several chunks
     × opens a stored member, and members written with a data descriptor · × reads an archive from an open file
     × refuses anything but one expected, unencrypted, consistent stored or deflated member
     × refuses an archive or a declared member over its cap before inflating anything
     × refuses, while inflating, a member that inflates past what it declared, and stops there
     × refuses, while inflating, too few bytes, a wrong CRC-32 and a corrupt or short stream
       Error: not implemented (1 arguments)
      Tests  7 failed (7)
GREEN: same command, Tests 7 passed (7). Before the code, a probe established how `node:zlib`'s raw inflate behaves: it ignores input after the deflate end and reports the bytes it consumed in `bytesWritten`, so the reader requires that count to equal the declared compressed size.

A pin written after the code covers archives patched at the byte level: shorter than an end record, a ZIP64 count, another disk, no central or local signature, a directory longer than one entry, a member on another disk, an unflagged name that is not ASCII, a flagged name that is not UTF-8, and a descriptor of the wrong length or without its signature (8 passed). `reader.ts`: 96.62% statements, 95.72% branches.

## 3. The shared record normalisation (C77.1)
Stub f377a02d; RED e7da2c25; GREEN 955c5f96.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/normalise.test.ts --coverage.enabled=false)
     × 12 (whitespace; truncation; scripts; record names; country codes and names; nulls; partial dates; birth dates; publication times; dd/mm/yyyy; finishRecord dedupe; finishRecord refusal)
       Error: not implemented (N arguments)
      Tests  12 failed (12)
GREEN, first run: Tests 1 failed | 11 passed. The failure read `2026-10-21T00:00:00-04:00: expected null to be '2026-10-21T04:00:00.000Z'`: a time without a fraction was padded to `0000` instead of `.000`. After the fix: Tests 12 passed (12). `normalise.ts`: 100% statements, 94.96% branches.

How country codes are built: `Intl.DisplayNames`' English region names, from canonical codes only. Deprecated codes such as SU, YU and ZR also resolve to names and would make "Russia" or "Serbia" ambiguous, so `Intl.getCanonicalLocales` filters them out. To these come the official long forms the lists print that `Intl` lacks (ours, 42 entries).

## 4. The XML list driver, the OFAC enhanced parser and the hostile set (C77.2, C77.4)
Stub 4e5818f2; RED bd2bfaaf; GREEN e21b61d4.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/ofac.test.ts src/parsers/hostile.test.ts --coverage.enabled=false)
     ofac: × maps a person: names by translation, weak aliases, dates, countries, documents, crypto · × maps a company, a vessel and an aircraft …
           × reads date ranges and month-precision dates · × returns the publication time and the entry count … · × reads the SDN list inside its single-member ZIP
           × refuses another root or namespace and a publication without its time (format) · × refuses an unknown entity type, an entity id given twice and a nameless entity (schema)
     hostile, OFAC enhanced XML: × on entity expansion · an external entity · deep nesting · a truncated file · an undefined entity · bytes over the cap · bytes that are not UTF-8
     hostile, the SDN ZIP: × on a 1 GiB declared member · two members · another member · a truncated archive
       Error: not implemented (2 arguments)
      Test Files  2 failed (2)
      Tests  18 failed (18)
GREEN: same command, Tests 18 passed (18).

### 4b. A pin that found a defect (OFAC dates)
RED e504de6d; fix 736dac39.
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/ofac.test.ts --coverage.enabled=false)
     × reads every document kind, unusual features and dates, and skips what holds nothing
       - "precision": "year", "range": { "from": "1960-03-01", "to": "1962-06-30" }, "value": "1960"
       + "precision": "day", "value": "1962-06-30"
      Tests  1 failed | 7 passed (8)
A period whose from- and to-dates disagree had been read as its last day. After the fix: Tests 31 passed (31).

### 4c. A cross-check with `fixtures-6`'s writers (OFAC date bounds, registration, IMO)
RED dff93ea8; fix ad519926.

A scratch test, not committed, wrote `fixtures-6`'s `syntheticWatchlist` through its `ofacEnhancedXml`, `euFsfXml`, `ukSanctionsListXml` and `unConsolidatedXml`, then read each back with these parsers.
- **Inherent differences.** Most differences come from a format lacking a field the record has: the EU has no crypto addresses or vessel kind; the UK has no tax id, LEI, MMSI or aircraft kind; the UN gives no name roles.
- **The OFAC parser's own.** Three were defects:
  - a year or a month written as a start bound and an end bound (as OFAC's date periods are) was read as a ranged date;
  - `Nationality of Registration` was not read;
  - an IMO number kept its `IMO ` prefix.

$ (cd packages/watchlist && pnpm exec vitest run src/parsers/ofac.test.ts --coverage.enabled=false)
     × maps a company, a vessel and an aircraft … (the IMO value is now expected without its prefix: changed with the behaviour)
     × reads valueDate as a start bound and an end bound, keeping a year or a month whole
     × reads the nationality of registration as the registration country
      Tests  3 failed | 7 passed (10)
After the fix, the parsers folder: Tests 83 passed (83). A re-run of the OFAC cross-check left only identifier order (the hashes sort identifiers) and the `value` of a circa date that the writer widens into a range (see the handoff).

## 5. The EU Financial Sanctions Files parser (C77.2)
Stub e6047161; RED 63ba83cf; GREEN 892829b0; refactor 36bf1dbf.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/eu.test.ts src/parsers/hostile.test.ts --coverage.enabled=false)
     × maps a person … · × maps an enterprise … · × returns the generation date and the file id · × accepts an XML 1.1 declaration
     × refuses another namespace and a file without its generation date (format) · × refuses an unknown subject type and a logical id given twice (schema)
     hostile, EU FSF XML: × the seven cases (the OFAC rows still pass)
      Tests  13 failed | 11 passed (24)
GREEN: the parsers folder, Tests 44 passed (44). In the refactor, OFAC took the shared `identifierKindOf` and `calendarDate` that came with the EU GREEN; a pin tests both directly (46 passed).

## 6. The UK Sanctions List parser (C77.2)
Stub cdd27392; RED f70b095c; GREEN d2473063.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/uk.test.ts src/parsers/hostile.test.ts --coverage.enabled=false)
     × maps a person: Name1 to Name6 with roles, strength, non-Latin names, placeholder DOBs · × maps an entity … and a ship …
     × returns DateGenerated as the publication time · × refuses another root, and a list without or with an unreadable DateGenerated (format)
     × refuses an unknown kind and a unique id given twice (schema) · hostile, UK Sanctions List XML: × the seven cases
      Tests  12 failed | 18 passed (30)
GREEN: the parsers folder, Tests 58 passed (58).

## 7. The UN consolidated list parser (C77.2)
Stub 2f5683d9; RED 1583aeb6; GREEN 96bb0f3b.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/un.test.ts src/parsers/hostile.test.ts --coverage.enabled=false)
     × maps an individual: positional names without roles, alias quality, typed dates · × maps an entity with its alias and an address in an unknown country
     × returns dateGenerated as the publication time · × refuses another root and a list without dateGenerated (format)
     × refuses a reference number given twice or missing (schema) · hostile, UN consolidated XML: × the seven cases
      Tests  12 failed | 25 passed (37)
GREEN: the parsers folder, Tests 70 passed (70).

## 8. The change signals and the guarded JSON reader (C77.4)
Stub ff26ebef; RED 825ac568; GREEN 1f9fa447.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/parsers/signals.test.ts --coverage.enabled=false)
     × parses JSON from text or bytes · × counts nesting outside strings only, and refuses past the cap · × refuses bodies over the cap, not UTF-8, or not JSON …
     × reads the newest delta file name, and only it, from the redirect · × prefers the publication id … · × answers null when nothing readable is given
     × reads the newest pubDate and nothing from the links · × answers null for a feed without a readable date, and refuses a hostile feed
     × reads public_updated_at · × answers null without a readable time … · × says unchanged only for a read signal equal to the last token
      Tests  11 failed (11)
GREEN: the parsers folder, Tests 81 passed (81).

## 9. The publication diff and the mass-removal guard (C77.6, C76.2)
Stub 3bb80038; RED bffdf1d2; GREEN 851a64f3.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/diff --coverage.enabled=false)
     × classifies each record by entry id and both hashes · × refuses an entry id given twice in one publication
     × diffs a whole publication from a sync or an async source · × allows up to 10% of a source of 100 or more, and refuses more
     × refuses only the removal of every entry of a source with fewer than 100
      Tests  5 failed (5)
GREEN: same command, Tests 5 passed (5).

## 10. The PEP position classes (C80.2)
Stub 7bd39bdc; RED d95d9d52; GREEN b33feaaf (with `data/pep-positions.json`).
RED, first run: the table loaded at describe level failed collection ("no tests"), so the load moved into each test. Then:
$ (cd packages/watchlist && pnpm exec vitest run src/pep --coverage.enabled=false)
     × parses, names each QID once, and refines only rows it holds · × covers the four public classes
     × puts heads of state and government in class 1 with the head retention · × puts the heads of international organisations in class 2 and state enterprises in 3
     × keeps mayors in class 4 although a mayor heads a municipal government · × takes the lowest class of the rows that decide
     × lets a refining row override the broader one · × holds one holder when any deciding row says so, but never for a class item itself
     × answers null when no known row reached the position
      Tests  9 failed (9)
GREEN: same command, Tests 9 passed (9). A pin written after the code: the file schema refuses a QID listed twice, a dangling `refines` and a fictional QID (10 passed).

## 11. The PEP SPARQL queries and their answer readers (C80.1-C80.3)
Stub 2c6bde65; RED bf5615db; GREEN f39216ab.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/pep/sparql.test.ts --coverage.enabled=false)
     × pages the statements of the positions a subclass row reaches · × reaches the positions that direct an organisation …
     × names a batch of persons, or their relatives, by QID only · × refuses anything that is not a QID, an empty batch and an odd page
     × reads the bindings of an answer · × refuses an answer over the cap, too deep, malformed or of another shape
     × reads statements with dates at their precision, stated ends and successors · × refuses a row without its statement, person or position …
     × reads labels, aliases, births, deaths, sex and citizenship, one fact a row · × reads family links
      Tests  10 failed (10)
GREEN: the pep folder, Tests 20 passed (20).

## 12. The PEP tenure, retention and relative rules (C80.2-C80.4)
Stub 1b61ba2c; RED bb21cb53; GREEN 7072bdd4.
RED:
$ (cd packages/watchlist && pnpm exec vitest run src/pep/rules.test.ts --coverage.enabled=false)
     × 14 (bounds of partial dates; stated, unknown and future ends; open tenures current, past the 20-year limit, without a start, ended by a successor or a later single holder; current and incoming tenures kept; 12 months and five years; unknown ends; relatives 18 or older; never a possible minor or one without a birth date)
     ✓ PEP_RULE_DEFAULTS fixes the plan values (the defaults are data in the stub, so this one passed in RED)
      Tests  14 failed | 1 passed (15)
GREEN: the pep folder, Tests 35 passed (35).

## 13. The PEP build (C80.1-C80.4)
Stub c118e30a; RED ff0f96ca; GREEN 2bcdcc88; refactor ae7f6712.
While writing the RED expectations, an ordering flaw showed. A holder's death is known only from the persons pass, which runs after the relatives question, so a living relative could have been linked to a dead PEP. The relatives query therefore leaves out deceased PEPs (`FILTER NOT EXISTS` on P570), and the SPARQL test asserts it.
$ (cd packages/watchlist && pnpm exec vitest run src/pep --coverage.enabled=false)
     build: × keeps current holders, holders within retention and adult relatives of class 1-2 holders · × writes a current national head …
            × keeps a head five years after office, a refined mayor in class 4, and a holder who is also a relative · × writes relatives without positions …
            × asks only for the relatives of kept holders of class 1 or 2, the query dropping the deceased · × syncs no relative and sends no relatives query without the install flag
            × pages each class until a short page … · × refuses a class that needs more pages than allowed, and an answer it cannot read
     sparql: × names a batch of persons, or their relatives, by QID only (FILTER NOT EXISTS: expected 'PREFIX wd: …' to contain 'FILTER NOT EXISTS')
      Tests  9 failed | 34 passed (43)
GREEN: same command, Tests 43 passed (43).

### 13b. A pin that found a defect (family links of PEPs that were not asked about)
RED e98afe7b; fix a9070fd1.
     × takes family links only for the PEPs it asked about, never a self-link, the first relation of a pair
       + [ "Q-test-1205", [ { "entity_id": "Q-test-1201", "relation": "spouse" } ] ]
      Tests  1 failed | 45 passed (46)
The driver trusted any `?person` in a relatives answer, so a relative of a PEP that is not kept could be synced, against V13. The two other new cases in that commit are pins: a statement repeated with several successors, and a multilingual primary label with over-long names dropped and the label capped. After the fix: Tests 46 passed (46). Refactor 620950a1 then dropped the stub helper, once nothing used it.

## 14. The PEP answer sources: live, or one recorded import (C76.2, C89.2)
Stub 5d893ba0; RED 374ec6b1; GREEN c29496f9.
$ (cd packages/watchlist && pnpm exec vitest run src/pep --coverage.enabled=false)
     × builds from one recorded document what the live service gives, the dead PEP's links left out
     × answers no family links when the document records none · × refuses another format, a body over its cap and a class key that is no QID
       Error: not implemented (2 arguments)
      Tests  3 failed | 46 passed (49)
GREEN: same command, Tests 49 passed (49).

## 15. Pins on the EU and UK parsers' less common shapes (not RED)
Commit 970811fa: the parsers folder, Tests 85 passed (85). Branch coverage rose from 72.7% to 84.41% in `eu.ts`, and from 75.5% to 91.83% in `uk.ts`.

## Final gates (foreground)
$ pnpm --filter @openverify/watchlist typecheck   → tsc --noEmit, exit 0
$ pnpm --filter @openverify/watchlist lint        → eslint ., exit 0
$ pnpm --filter @openverify/watchlist test
      Test Files  50 passed (50)
      Tests  463 passed (463)
      All files  |   98.75 |    90.72 |   98.81 |   98.79 |
  This slice's folders (`xml`, `zip`, `parsers`, `diff`, `pep`): 98.91% statements (1361/1376), 92.71% branches (1068/1152), 98.56% functions, 98.95% lines; 131 `it` blocks.
$ pnpm typecheck      → Tasks: 14 successful, 14 total (43 s)
$ pnpm lint           → Tasks: 14 successful, 14 total (96 s)
$ pnpm format:check   → All matched files use Prettier code style!
