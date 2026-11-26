# Phase 6 research: name screening, matching libraries and algorithms

Prepared 2026-10-22 for OpenVerify Phase 6 ("Reports": watchlist ingestion and refresh, a fuzzy matcher, match review, ignore lists, continuous monitoring, PEP, and the business and crypto-address watchlists) [R1]. This note covers one question: how to match a person or a business against sanctions and PEP lists well, honestly and fast, in permissively licensed TypeScript (Node 22 API and worker, pure TypeScript in `packages/checks`), building on what Phase 5's matching library (C58) gives [R5] [R6] [R8]. List ingestion terms, PEP sourcing, adverse media, email, phone and address risk are other notes' subjects and appear here only where matching depends on them.

Everything is in our own words. OpenSanctions' MIT-licensed source (yente, nomenklatura, rigour) was read as a reference and is described, never copied. Persona appears only through short identifiers from its public OpenAPI files. Anything no public source states is marked **not documented**; statements no source states but that we infer are marked **(inference)**. Every claim carries a citation key defined in "Sources and pins"; every source was read on 2026-10-22.

**Method.**
- Licences were read from the registry metadata (npm registry documents, PyPI JSON) and from the LICENSE file at the tag or commit shown.
- List sizes and formats were measured on the publishers' own files, downloaded into a scratch directory, parsed as data by our own scripts (Python run with `-I`), and never executed or committed [X3].
- Latency was measured with our own benchmark (Node 22.22.1, one thread of an Intel Xeon E5-1650 v3 at 3.5 GHz under WSL2) [X1], and against a throwaway, network-less Postgres container started from the pinned `pgvector/pgvector:pg17` image [X2] [G4].
- Nothing in `/home/mhnoor/persona-opensource` was changed.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-08**. The tables give the latest version and the newest that passes, both computed from the registry documents' release times [X7].

Legend: ✅ passes rule 4 · ⚠️ passes on paper with a caveat · ❌ fails rule 4 or is not recommended. R / H / A are the ADR 0002 tiers: real (deterministic), heuristic (`beta` with a confidence), adapter plus a deterministic sandbox provider [R3].

---

## Summary

1. **OFAC's own tool is simple and quirky.** Sanctions List Search pre-filters candidates by the first letter and an edit-distance similarity of at least 50%, then scores with Jaro-Winkler and Soundex over the whole name and over name parts, and reports the higher of the two; its slider defaults to 100 (exact) and OFAC recommends no threshold [F1] [F2] [F3] [F4]. OpenSanctions reverse-engineered it in 2026: its Jaro-Winkler applies the prefix bonus without Winkler's 0.7 gate, gates the whole-name comparison on an equal first letter, drops query tokens of two characters or fewer, and zeroes token pairs below 0.5 [O1] [O5]. An "OFAC-like score" is therefore a compatibility metric, not a quality target.
2. **The best open reference design is OpenSanctions' `logic-v2`**: names are split into tagged parts, parts are first paired through curated cross-script and cross-language "symbols" (given and family names, organisation types, nicknames, initials, numbers, places), only the remainder is compared fuzzily, and the name score is then qualified by country, date-of-birth and gender mismatches and by identifier matches [O3] [O4] [O5]. Its defaults are a 0.7 match threshold and 0.5 cutoff, with up to 10 candidates per requested result and at most 500 candidates scored [O2] [O7].
3. **The OpenSanctions Python stack cannot run in our runtime.** `rigour` (and so `followthemoney`, `nomenklatura`, `yente`) depends on `python-stdnum`, which is LGPL-2.0-or-later ❌, and yente needs an OpenSearch or Elasticsearch cluster [Y1] [O7]. OpenSanctions' data is CC BY-NC 4.0 ❌ [D7]. Read it as a reference only; ingest lists from their publishers.
4. **Transliteration is the hard part, and Node cannot do it natively.** Node 22's `Intl` has no transliterator; no ECMA-402 proposal adds one; the ICU4X npm package (`icu@2.3.2`) exports none [X5] [A5] [N8]. OpenSanctions itself latinises only Cyrillic, Greek, Armenian, Georgian and Hangul, where romanisation is reliable, and compares other scripts in their own script or through symbols [O4] [O6].
5. **`any-ascii@0.3.3` (ISC) ✅ is the only clean, broad JS transliterator found.** Its tables are its own (based on BGN/PCGN, ALA-LC, UNGEGN, ISO and Unihan), unlike `transliteration` (labelled MIT, but its Cyrillic table equals Unidecode's in 232 of 250 positions, and Unidecode's data is under Perl or GPL terms ⚠️/❌), `unidecode` (data under the Perl licence ❌) and `unidecode-plus` (Artistic-1.0-Perl ❌) [N1] [N2] [N4] [N5] [X4]. Its output for abjads and Indic scripts is a consonant skeleton (`محمد` → `mhmd`), so it can only feed keys and low-weight comparisons (H tier).
6. **Name-variant data exists under clean terms.** rigour's `person_names.txt` (MIT repository; 157,298 groups, 157,090 of them Wikidata items, 208 manual; 569,089 forms; 8.6 MB) groups cross-script and spelling variants, for example a 57-form group joining Muhammad, Mohammed, Mohamed, Mokhammad, Магомед and Μωάμεθ [O6] [X6] [D8]. It is noisy (that group also holds Mamadou and Mehmood), so a symbol match should count less than an exact match, as logic-v2 does (0.9) [O5].
7. **Lists already disagree with themselves.** OFAC's CSV is ASCII-only, writes every individual's primary name as `FAMILY, Given`, and spells one Arabic given name nine ways (`muhammad` 560, `mohammad` 403, `mohammed` 255, `mohamed` 240, ...); its enhanced XML carries 5,799 non-Latin forms (Cyrillic 3,670, Arabic 1,500, Chinese 551, ...) [D1] [D2] [D3] [X3]. The UN list carries an original-script name on 379 of 1,010 records and grades 628 aliases `Low` [D5] [X3]. Weak ("low quality") aliases are flagged by OFAC and the UN, are not expected to be screened, and should only corroborate [F6] [A2].
8. **Exhaustive matching is too slow above sanctions scale; blocking fixes it.** Scoring one query against all 39,663 OFAC names takes 137 ms (3.5 µs per pair); against one million names, 3.9 s [X1]. A token-plus-consonant-skeleton index answers in 1–2 ms at OFAC scale and 4–12 ms at one million names with blocking recall ≥ 0.995 on our synthetic variants, except joined tokens (0.66–0.68), which a trigram path recovers (1.000) [X1]. In Postgres, a GIN index over key arrays answers in 3.2 ms p50 / 6.9 ms p95 at one million names; `pg_trgm` in 33 ms p50 / 75 ms p95 [X2].
9. **Continuous monitoring should run in reverse.** After a list update, screen only the added and changed list entries against an index of the monitored subjects: 5.4 ms per changed name against 200,000 subjects, so a typical OFAC publication (22 entity changes in the sample delta) costs well under a second after the index is built [X1] [D4]. OFAC itself advises full refreshes from the complete files rather than relying on its delta files, so diff versions ourselves by entry id and content hash [F7].
10. **Ignore lists must be keyed by what matched.** Persona's ignore-list entry snapshots the matched list entity (name, alias type, birthdates, group id) with the run it came from [P1]; keying an ignore by (list, entry id, a keyed hash of the matched evidence and of the subject's screened attributes) makes it lapse automatically when either side changes (inference).
11. **No permissively licensed public benchmark for sanctions screening was found.** OpenSanctions Pairs (755,540 labelled pairs) states no data licence on its paper page and holds real persons [O8]. Measure recall and false positives on synthetic lists and synthetic customers; thresholds stay provisional until that evaluation exists [A2] [A4].
12. **Two Phase 5 records need attention.** The UK OFSI Consolidated List closed on 28 January 2026; the FCDO's UK Sanctions List is now the only source (PLAN §3 still says "UK OFSI") [D6] [R1]. Both the OFAC export and the UN XML answer with a 302 to a pre-signed object-store URL, while the C54.6 outbound client treats every redirect as an error [D1] [D5] [R5].

## Summary of recommendations

| Need | Recommendation | Licence | Tier | Where |
|---|---|---|---|---|
| Normalisation and name analysis | **Extend the C58 normaliser** (NFKD, mark stripping, casefold, ICAO 9303 §6.A Latin folding) with script detection per token, titles and honorifics, particles, legal forms, `FAMILY, Given` role tagging, joined and split tokens [R5] [R6] [A1] [X3] | ours | R | `packages/watchlist` on `packages/checks` |
| Cyrillic and Arabic transliteration | **Own code from the ICAO 9303 Part 3 §6.B and §6.C tables** (facts), deterministic [A1] | ours | R | `packages/watchlist` |
| Lossy romanisation for keys (Han, Hebrew, Arabic, Indic, Thai, Hangul) | **`any-ascii@0.3.3`**, used only for blocking keys and low-weight comparisons; same-script comparison when the list carries the original script [N1] [X4] | ISC ✅ | H | runtime |
| Cross-script and spelling variant groups | **rigour `person_names.txt` @ `b0ba4ad`** (v2.5.0) through `data/manifest.json` and `scripts/fetch_data.py`, filtered at build time; symbol score 0.9 [O6] [X6] [D8] | MIT repo, Wikidata CC0 data ✅⚠️ (noise) | H | build-time data |
| Nicknames | **Phase 5's own table** (C58.3), score 0.8 [R5] | ours (CC0 seed) | H | reuse |
| Token similarity | **Keep our Jaro-Winkler** (Winkler's 0.7 gate, prefix 0.1) with a one-to-one token alignment; no new dependency [R6] [X1] | ours | H | reuse |
| Phonetic and skeleton keys | **Own consonant-skeleton key**; `double-metaphone@2.0.1` only if a measured recall gain justifies it [N9] [X2] | ours / MIT ✅ | H | keys only |
| Candidate retrieval | **Postgres GIN over a `text[]` of rare keys** (token, skeleton, symbol id, joined bigram), plus **`pg_trgm` GIN** on the normalised name as a second path for single tokens and joins [G1] [G4] [X1] [X2] | PostgreSQL ✅ | R (retrieval) | migration needs `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| Continuous re-screen | **Reverse index of monitored subjects, rebuilt in worker memory per run** from decrypted subjects; screen added and changed list entries only [X1] | ours | R | worker job |
| Version diff | **Entry id + SHA-256 of a canonical JSON of the matching-relevant fields** per list version; OFAC delta files only as a cross-check [F7] [D4] | ours | R | ingestion |
| Ignore list | **(environment, subject reference, list, entry id, HMAC evidence hash)** under the blind-index key [R9] [P1] | ours | R | API |
| Score | **Name score from the alignment, gated at 0.70, plus DOB, country, gender and identifier qualifiers; alert at 0.80 for sanctions and 0.85 for PEP**, all provisional [O3] [O5] | ours | H (`beta`) | `packages/watchlist` |
| Evaluation | **Synthetic lists and customers**, a variant generator, offline oracles `jellyfish 1.2.1` / `rapidfuzz 3.14.6`; real-list runs only as an uncommitted job publishing aggregates [Y1] [R12] [R2] | MIT (dev) ✅ | - | dev |
| Never at runtime | `transliteration`, `unidecode` (npm and PyPI), `unidecode-plus`, `text-unidecode`, `abydos`, `fuzzywuzzy`, `python-stdnum` and everything that pulls it (`rigour`, `followthemoney`, `nomenklatura`, `yente`), Postgres `dmetaphone` (Perl terms), OpenSanctions data [N2] [N4] [N5] [Y1] [G3] [D7] | - | - | - |

### Corrections to the repository's records

- **PLAN §3 "UK OFSI".** The gov.uk page says the UK Sanctions List is now the only source of UK designations and that the OFSI Consolidated List closed on 28 January 2026; it is published as CSV, XML, ODS, ODT, PDF, HTML and text under the Open Government Licence v3.0, last updated 2026-10-16 [D6] [R1].
- **C54.6 versus the publishers' redirects.** `GET https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV` answers 302 to a pre-signed URL on `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com` (valid 3,600 s); `GET https://scsanctions.un.org/resources/xml/en/consolidated.xml` answers 302 to a SAS URL on `unsolprodfiles.blob.core.windows.net`. A `HEAD` to the UN URL returned 404 and to OFAC's `ALT.CSV` 400, so probes must use `GET` [D1] [D5]. C54.6 makes a redirect an error so that a credential never follows one [R5]. These fetches carry no credential, but the rule is a security invariant, so the change needs a decision (owner item B1).
- **PLAN §6 Phase 6 "Jaro-Winkler, token-set".** Correct as far as it goes; the evidence below adds script handling, variant groups, blocking and qualifiers, without which those two metrics miss cross-script matches and over-alert on common names [O4] [X1].

### Licences met here that rule 4 does not name

| Licence | Where | Verdict |
|---|---|---|
| Unicode-3.0 | The ICU4X npm package `icu` [N8]; CLDR transform rules (only if we ever port them) | ⚠️ permissive, not on the list; not needed if we use ICAO tables and `any-ascii` |
| Perl terms (Artistic-1.0 or GPL-1.0-or-later) | The data tables of `unidecode` (npm) [N4]; `unidecode-plus` [N5]; `text-unidecode` [Y1]; Postgres `fuzzystrmatch`'s `dmetaphone.c` [G3] | ❌ at runtime |
| Open Government Licence v3.0 | The UK Sanctions List [D6] | Public-sector terms that allow commercial reuse with attribution; the lists note decides |
| CC BY-NC 4.0 | Every OpenSanctions dataset [D7] | ❌ |
| LGPL-2.0-or-later | `python-stdnum`, a hard dependency of `rigour` [Y1] [O6] | ❌ outside `android/openverify-nfc` |

---

## 1. How screening matchers work in practice

### 1.1 OFAC's Sanctions List Search (the public tool)

- **Candidate pre-filter.** The tool first keeps candidates whose first letter equals the input's and whose edit-distance similarity is at least 50% [F1].
- **Two scoring techniques, both always run.** One compares the whole entered name with whole listed names by Jaro-Winkler; the other splits the input into parts, scores each part with Jaro-Winkler and Soundex, and combines the part scores. The Score column shows the higher of the two [F1]. The score combines a phonetic comparison with a character comparison; 100 means an exact match [F2].
- **Threshold.** The "Minimum Name Score" narrows or widens results: 100 returns exact matches only, 50 returns names about half similar [F3]. Fuzzy logic applies to the name field only; other fields use character matching [F4]. OFAC gives no threshold recommendation [F3]. **Not documented:** the exact combination formula, the Soundex variant, the normalisation and alias handling.
- **What OFAC expects after a hit** (FAQ 5, updated 2026-09-09): compare the full entry with your data (full names and aliases, where a first-name-only or last-name-only hit suggests no match; date and place of birth; nationality; identifiers; address, which alone may not suffice), and treat several agreeing fields as a likely match [F5]. Dates, nationality and place of birth are for assessing alerts rather than for screening, which the Wolfsberg guidance also says [A2].
- **The reverse-engineered details** (OpenSanctions, 2026-07-01; a single vendor's finding, not an OFAC statement). An agent sampling a few hundred of the tool's scores matched about 90% of them; a Jaro-Winkler that adds the prefix bonus unconditionally, as SimMetrics does, raised that to 96% [O1]. Their emulation module adds three behaviours, each explained by an observed quirk: the whole-name score is zero unless both names start with the same letter (so a reversed name order can return nothing); query tokens of at most two characters are dropped unless that would empty the query; and the part score is the mean, over query tokens, of each token's best Jaro-Winkler against the candidate's tokens, with pairs below 0.5 counted as zero. The entity score is the best over every query-name and candidate-name pair, and the module was tuned against 164 positive cases [O5].

What this means for us (inference): OFAC's score is order-sensitive and treats a dropped short token as no evidence, so it is a poor quality target. Operators used to OFAC's 0–100 scale may still want it as an informational metric (owner item C5).

### 1.2 OpenSanctions (yente, nomenklatura, rigour), read as a reference

All three are MIT [O5] [O6] [O7]. The algorithm catalogue: `logic-v2` (rule-based, the default since 2025-12-01 and the recommended one), `ofac` (name-only emulation, added 2026-06-26), `logic-v1` (its predecessor), the deprecated `name-based` and `name-qualified` (Jaro-Winkler plus Soundex; to be retired on 2027-01-18, after which `ofac` answers requests for them), and the logistic-regression `regression-v1`/`regression-v2` [O2]. Defaults: algorithm `best` (currently `logic-v2`), threshold 0.7 (0.8 or 0.85 suggested for a low tolerance of false positives), five results [O2].

**`logic-v2` name matching, in our words** [O3] [O5]:
1. Each name becomes a list of tagged parts (given, family, stopword, ...), with an entity-type tag (person, organisation, object).
2. A literal match of the comparable forms ends the comparison at 1.0, unless the part roles contradict (a query that puts the family name in the given-name field). That case goes through full alignment, which penalises the role swap.
3. Names contained in a longer name of the same entity are dropped, so a short alias cannot outscore a longer one that would have disagreed.
4. Pairs of names are pruned before scoring. Pairs sharing a script are always kept; a cross-script pair survives only when it shares a symbol that no same-script pair already provides. Products of six pairs or fewer are not pruned.
5. For each way of pairing parts through shared symbols, the symbol pairs get a category score and weight:

   | Symbol category | Score | Weight |
   |---|---|---|
   | given or family name group | 0.9 | 1.0 |
   | nickname | 0.6 | 0.8 |
   | initial | 0.9 | 0.5 |
   | organisation class | 0.8 | 0.7 |
   | generic symbol word | 0.9 | 0.3 |
   | domain word | 0.9 | 0.7 |
   | number | 0.9 | 1.3 |
   | location | 0.9 | 0.8 |

   Equal surface forms are lifted back to 1.0.
6. The remaining parts are put in comparable order (person-name order alignment when either side is a person), then compared by a cost-folded edit distance that charges less for listed confusable pairs (`0`/`o`, `1`/`i`, `e`/`i`, `o`/`u`, `i`/`y`, `c`/`k`, `n`/`h` and others) [O6].
7. Unmatched query parts weigh 0.8 (`nm_extra_query_name`) and unmatched result parts 0.2 (`nm_extra_result_name`). Stopwords are multiplied by 0.7; family-name evidence by 1.3 (`nm_family_name_weight`). The name score is the weighted mean of the part scores, and the best pairing wins.
8. Objects (vessels, aircraft) use a strict Levenshtein ratio instead, with a 0.3 penalty when the numbers in the names differ (`nm_number_mismatch`).

**`logic-v2` score composition** [O3] [O5]:
- The main score is the best of the weighted "main" features: `name_match` 1.0; address entity 0.98; crypto wallet 0.98; ISIN 0.98; LEI, OGRN, IMO/MMSI, INN, BIC, UEI and NPI 0.95 each; any identifier 0.85; exact weak-alias equality 0.8.
- When that main score is positive, the qualifiers are added: `address_prop_match` +0.2; `country_mismatch` −0.2; `dob_year_disjoint` −0.15; `dob_day_disjoint` −0.25; `gender_mismatch` −0.2.
- **Not verified:** whether the result is clipped to [0, 1]; the function we read does not clip.
- Date handling: day-level disagreement counts half when swapping the day and month makes the dates agree. The year qualifier fires only when no birth year is shared. Countries compare through territory intersection, so a region presumably intersects its parent country (inference from the function's name; its data was not read).

**Candidate retrieval in yente** [O7]:
- An OpenSearch query whose `should` clauses include up to five representative full names, matched with AND. Fuzziness is added only for single-part names, unless fuzzy matching is configured.
- Keyword "name variants" (for example the joined form of a two-part name), boosted 2.
- One clause per name part takes the best of three keys: the comparable part, its Metaphone key (only when longer than two characters, half weight) and its symbol ids (0.7). Low-information parts are down-weighted by symbol category.
- Weak aliases are matched as exact parts at 0.9.
- Other fields are boosted: identifiers 8, dates, phones and emails 3, countries 1.5.
- It retrieves 10 candidates per requested result, at most 500, then scores them with the algorithm. Scores below the 0.5 cutoff are dropped; at or above the 0.7 threshold they count as matches.

**Transliteration policy** [O4] [O6]. rigour's Rust core uses ICU4X's experimental CLDR transliterators for exactly five scripts (Cyrillic, Greek, Armenian, Georgian, Hangul), then CLDR's Latin-ASCII rule; Han, Arabic, Thai, Devanagari and others are left to `normality` (PyICU) for lossy romanisation, or compared in their own script.

**Evaluation published:** none with numbers for `logic-v2`; its launch article's claims are qualitative [O4]. The OpenSanctions Pairs paper reports 91.3% F1 for the older production matcher `RegressionV1` on 755,540 expert-labelled pairs, and up to 99.0% for an LLM [O8].

### 1.3 What Persona's public schema shows (identifiers only)

From the OpenAPI files at `805512b` [P1] [P2] [P3] [P4] [P5]:
- **Query.** `name-first`, `name-middle`, `name-last` or a `term`, plus `birthdate` (`YYYY-MM-DD`) and `address-country-code`.
- **Results.** `matched-lists[]` with `name`, `url`, `list-type`/`list-types` (example `sanction`), `match-types` (example `name_exact`; other values **not documented**), `slug`, `flag-code` and `entities[]` (`name`, `alias-type` `primary_name` or `aka`, `birthdates[]` with `day`, `month`, `year`, `granularity`).
- **Ignore list.** `ignore-list[]` entries hold `ignored-at`, `run-history-completed-at`, a `match` snapshot with the same shape including `group-id` (example `EU:110286`), `user` and `ignore-reason`.
- **Report flags.** `has-match`, `is-continuous`, `is-recurring`; statuses `pending`, `ready`, `errored`.
- **Template.** `search-lists[]` (`slug`, `type`).

The `report_watchlist.*` events (`matched`, `ready`, `dismissed`, `errored`) and the `reports/{id}/dismiss|pause|resume|review|run` paths are in our surface index [R4]. **Not documented:** Persona's algorithm, score, thresholds and transliteration.

### 1.4 The standard pipeline, step by step

**Normalisation** (deterministic, R):
- NFKD, strip combining marks, casefold, and map the letters NFKD leaves alone (ß, æ, ø, œ, þ, ð, đ, ł, ı, ħ). Our `normalizeName` already does this; ICAO 9303 §6.A adds the expanded MRZ forms (Ä → AE) used by C31.2 [R6] [R7] [A1].
- Lowercase without a locale: plain `toLowerCase()` turns `İ` into `i` + U+0307, which mark stripping then removes, while `toLocaleLowerCase('tr')` gives `i` directly [X5]. Either works after mark stripping.
- Apostrophes are dropped (O'Brien → obrien) and other punctuation becomes a space [R6].
- Titles and honorifics are removed (rigour's stopword list has Mr, Mrs, Ms, Mx, Madame, Herr, Senor, Dr, ...) [O6].
- Generational suffixes are stripped only when one side lacks them (C58.2) [R5].
- Legal forms: canonicalise, then down-weight (C58.6) [R5]. rigour's `org_types.yml` maps hundreds of legal forms across languages to `display`/`compare`/`generic` forms (MIT; hand-curated, partly from OpenSanctions name data) [O6]. In OFAC names, `company` (4,114 names), `limited` (2,838), `ltd`, `co`, `liability`, `joint`, `stock`, `llc`, `obshchestvo` (725) and `ooo` (650) are among the 30 most frequent tokens [X3], so they must never drive retrieval.

**Transliteration** (how lists themselves romanise):
- **OFAC.** The CSV holds no non-ASCII character in any of its 39,663 names [X3]. The enhanced XML carries 50,081 name translations, 5,799 of them non-Latin: Cyrillic 3,670, Arabic 1,500, Chinese Simplified 374, Chinese Traditional 177, Korean 44 + Hangul 4, Japanese 15, Greek 9, Armenian 2, Georgian 2, Hebrew 2. 4,867 entities carry at least one non-Latin form [D3] [X3].
- **OFAC's romanisation system is not documented** and is not consistent:
  - Russian legal-form tokens appear as `ogranichennoi` 258, `ogranichennoy` 42 and `ogranichennoj` 4, and as `otvetstvennostyu` 265 and `otvetstvennostiu` 43;
  - one Arabic given name appears as `muhammad` 560, `mohammad` 403, `mohammed` 255, `mohamed` 240, `mohamad` 78, `muhammed` 32, `mohd` 17, `magomed` 4, `mhd` 3 [X3].
- **UN.** `NAME_ORIGINAL_SCRIPT` is present on 379 of 1,010 records [D5] [X3].
- **EU and UK** original-script coverage was **not measured** in this pass.
- **Passports.** ICAO 9303 Part 3 §6 gives recommended tables for Latin national characters (6.A), Cyrillic (6.B) and Arabic (6.C). Its informative Appendix B explains why Arabic is the hard case: names are written as consonants (a common given name is four consonants, roughly "Mhmd"), vowels are the transcriber's choice, that one name has at least 32 Latin spellings, and one worked example multiplies to 256 alternatives [A1].
- **Generic romanisers on synthetic common names** (`any-ascii` tables) [X4]:
  - Cyrillic `Щербаков Юрий` → `Shcherbakov Yuriy` (good);
  - Greek `Παπαδόπουλος` → `Papadopoylos` (`ου` → `oy`, where Greek names are usually written `ou`);
  - Hangul family name `김` → `Gim` (Revised Romanization, where passports and lists usually write `Kim`);
  - Arabic `محمد عبد الله` → `mhmd \`bd llh`; Hebrew `דוד כהן` → `dvd khhn`; Devanagari `राहुल शर्मा` → `rahul srma` (vowels lost);
  - Han `王小明` → `WangXiaoMing` (toneless pinyin, per character, no word breaks).
- Policy that follows (inference): compare in the original script when both sides have it; latinise deterministically only for Cyrillic (ICAO 6.B), Greek, Armenian, Georgian and Hangul; for abjads, Indic and Han scripts use the romanisation only to build keys and score it low.

**Name-part order and swaps.**
- Every OFAC individual primary name (7,519 of 7,519) is `FAMILY, Given`, so the comma gives the family role [X3]. The UN uses FIRST/SECOND/THIRD name fields [D5].
- Subjects may be entered in either order (C58 treats swapped given and family names as `partial`) [R5].
- The matcher should align tokens one to one regardless of order, and penalise a known role swap lightly rather than refuse it [O5].

**Phonetic keys.**
- Soundex and Metaphone are English-centric: rigour returns an empty key for non-ASCII input [O6], and Postgres documents that its Soundex, Metaphone and Double Metaphone do not work well with multibyte encodings [G2].
- In the pinned image, `dmetaphone('Muhammad')` = `dmetaphone('Mohammed')` = `MHMT`, Soundex gives `M530` for both, and Daitch-Mokotoff gives `{656300}` for both but nothing for `Мухаммед` [X2].
- Christen's comparison found pattern-matching techniques outperform phonetic encodings for personal names, with no single best technique [A4]. `logic-v2`'s feature list has no phonetic feature (`logic-v1` kept Soundex and Metaphone features at weight 0.0), and yente uses Metaphone only as a retrieval key [O3] [O7].
- Recommendation: use phonetic or skeleton keys for retrieval only.

**Token similarity.**
- Cohen, Ravikumar and Fienberg found a hybrid of TF-IDF token weighting with Jaro-Winkler the best overall for entity names [A3]; logic-v2 is a weighted token alignment in the same spirit [O5].
- Our token-set similarity scores 1.0 when one side's tokens are a subset of the other's, which its own comment warns against relying on alone [R6]. Screening needs the asymmetric weights instead: extra query tokens cost more than extra list tokens.

**Common name variants.**
- The cleanest broad source is rigour's Wikidata-derived groups (§2.6) [O6] [X6].
- Phase 5's nickname table covers English hypocorisms only [R5] [R12].
- The ICAO Arabic table plus a consonant skeleton covers Arabic-origin Latin spellings that no table lists (inference).

**Weak versus strong aliases.**
- OFAC flags as weak the broad or generic aliases (short ones, ones with digits, nickname words, geographic references, a very common prefix in a two-word name). It marks them in quotes in TXT and PDF, in the Remarks field in CSV, with `Type` weak/strong in legacy XML and `LowQuality` in advanced XML. It does not generally expect them to be screened. It generally will not seek a civil penalty when a weak alias is a transaction's only list reference, the processor had no other reason to know, and a risk-based compliance programme is in place [F6].
- In the enhanced XML, 4,421 names are `isLowQuality` true against 39,663 false; the CSV Remarks hold 4,276 quoted aliases in 2,594 entries [D3] [D1] [X3]. The UN grades individual aliases `Good` (1,535) or `Low` (628) [D5] [X3].
- Wolfsberg says screening weak aliases is neither expected nor typically productive [A2].
- Recommendation: never retrieve or fuzzy-score weak aliases. An exact normalised equality is surfaced below the alert threshold, as logic-v2 does with its 0.8 main feature [O3], and counts only when a date or identifier corroborates it.

**Date-of-birth handling.**
- Lists hold partial and multiple dates:
  - OFAC Remarks carry 8,174 dates of birth: 6,903 full, 1,013 year only, 49 month and year, 142 ranges and 67 "circa" [D1] [X3];
  - the UN has 751 `EXACT`, 117 `APPROXIMATELY` and 32 `BETWEEN` dates, 49 without a type, and 140 records with two to ten dates [D5] [X3].
- Reuse C58.5 rules R1–R6 (exact, precision-limited, range or circa, transposition, typo, two-digit-year century) [R5] [R12], over every pair of subject and entry dates, taking the most favourable.
- A date is a qualifier, never a reason to drop a strong name match, unless the template asks for a strict filter. Persona exposes `granularity` on list birthdates [P1].

**Country and nationality.**
- Compare the subject's countries (nationality, residence, document issuer) with the entry's (nationality, citizenship, address and birth countries) through territory intersection, as logic-v2 does [O5].
- Use a penalty by default, not a filter: sanctioned persons are often listed with one country and live in another (inference). Persona takes `address-country-code` in the query [P2].

**Entity-type filter.** Persons are compared with persons, organisations with organisations, vessels and aircraft with objects (logic-v2 uses a different matcher for objects) [O5]. OFAC types each entry as individual, entity, vessel or aircraft [X3].

**Score and threshold.** Combine the name score, gated by a floor, with additive qualifiers; alert at a threshold (§6). Every number is provisional until measured (§5).

---

## 2. Libraries

### 2.1 What the repository already has

- `packages/checks/src/name-matching.ts` provides `normalizeName`, `nameTokens`, `jaroSimilarity` (over code points), `jaroWinkler` (prefix 0.1, Winkler's 0.7 gate, four-character cap), `tokenSetSimilarity` and `compareNames` [R6].
- `extraction/agreement.ts` holds the ICAO 9303 §6.A renderings and `NAME_TOKEN_THRESHOLD = 0.92` [R7].
- Phase 5's C58, being built now (only `matching/index.ts` exists today), adds:
  - `MatchLevel` (`full`, `partial`, `none`, `missing`) and three-valued match groups;
  - names with titles, particles, swaps, initials and nicknames;
  - the nickname table; partial dates R1–R6;
  - business-name canonicalisation;
  - input caps with a 100 KB timing test [R5] [R8].
- Two scripts give `missing` with `script_mismatch` in C58, which is right for identity comparison but would miss every cross-script hit in screening; Phase 6 needs its own cross-script path [R5].

### 2.2 Transliteration (npm)

| Package | Latest (released) | Newest ≤ 2026-10-08 | Licence (read) | ESM / types / size | Verdict |
|---|---|---|---|---|---|
| **`any-ascii`** | 0.3.3 (2025-06-29) | 0.3.3 | ISC (LICENSE @ `2c07da4`, © 2020–2025 Hunter WB) | ESM (`type: module`, `exports`), `.d.ts`; 552,792 B; 0 dependencies | ✅ **use for keys**. Unicode 16.0, 124k of 155k characters; tables based on ALA-LC, BGN/PCGN, ISO, KNAB, UNGEGN, Unihan and national standards. Its Cyrillic block equals Unidecode in only 144 of 234 positions (its own table). Context-free, per character [N1] [X4] |
| `@sindresorhus/transliterate` | 2.3.1 (2026-01-08) | 2.3.1 | MIT (license @ `61e1cb9`) | ESM, `.d.ts`; 43 KB | ✅ but narrow: per-language replacements for Latin-adjacent scripts; Chinese not supported [N3] |
| `transliteration` | 2.6.2 (2026-10-20) | 2.6.1 (2026-01-20) | MIT (LICENSE.txt @ `338bdb2`) | ESM; 3.59 MB | ⚠️/❌ **provenance**: its `data/chunks/x04.ts` equals Python Unidecode's `x004.py` in 232 of 250 positions, including Unidecode's unusual number markers, so its tables appear derived from Text::Unidecode (Perl terms) **(inference)**. Its README admits wrong Chinese polyphones, Japanese kanji read as pinyin and broken Thai [N2] [N16] [X4] |
| `unidecode` (FGRibreau) | 1.1.0 (2024-06-03) | 1.1.0 | Code BSD-3-Clause; README: the `x??.js` data files derive from the Perl module and are under the Perl licence | CJS | ❌ [N4] |
| `unidecode-plus` | 1.0.5 (2025-07-25) | 1.0.5 | `MIT AND BSD-3-Clause AND Artistic-1.0-Perl` | CJS, `.d.ts` | ❌ (Artistic) [N5] |
| `pinyin-pro` | 3.29.5 (2026-10-10) | 3.29.4 (2026-09-11) | MIT (LICENSE in the 3.29.4 package) | ESM, types; 944 KB | ⚠️ Accurate Han → pinyin with a surname mode; data provenance **not documented** in its README. Only if Han-script subjects without list originals matter [N6] |
| `wanakana` | 5.3.1 (2023-11-20) | 5.3.1 | MIT | ESM, types | ⚠️ kana ↔ romaji only; kanji names need a reading dictionary (inference) [N7] |
| `hangul-romanization` / `@romanize/korean` | 1.0.1 (2022) / 0.1.3 (2025-05-24) | same | MIT | types | ⚠️ any-ascii already covers Hangul [N7] |
| `cyrillic-to-translit-js` | 3.2.1 (2022-05-05) | 3.2.1 | MIT | CJS; depends on `lodash.invert` | ⚠️ stale; ICAO 6.B in our own code is better [N7] |
| `limax` | 4.2.3 (2026-03-19) | 4.2.3 | Apache-2.0 | ESM; pulls `hepburn`, `pinyin-pro`, `speakingurl` | ⚠️ a slug generator, not needed [N7] |
| `icu` (ICU4X JS/WASM) | 2.4.0 (2026-10-22) | 2.3.2 (2026-09-09) | Unicode-3.0 | ESM; 23.3 MB unpacked, 20.5 MB WASM | ❌ for this purpose: none of its 385 files, and nothing its type declarations export, is a transliterator [N8] |
| `icu-transliterator` | 0.3.7 (2019-08-06) | 0.3.7 | MIT | Native addon (`bindings`, `node-addon-api`) on the system ICU | ⚠️ stale, native, needs an `allowBuilds` entry; not recommended [N8] |

### 2.3 Can Node's `Intl` or ICU transliterate? No.

- Node 22.22.1 bundles ICU 78.2 with Unicode 17.0, but `Intl` exposes only `getCanonicalLocales`, `supportedValuesOf`, `DateTimeFormat`, `NumberFormat`, `Collator`, `PluralRules`, `RelativeTimeFormat`, `ListFormat`, `Locale`, `DisplayNames` and `Segmenter`. There is no transliterator [X5].
- No transliteration API appears in the TC39 ECMA-402 proposal lists (active, finished, stage 0, inactive) at `07002d4` (2026-10-14) [A5]. The ICU4X npm bindings do not export one either [N8].
- What `Intl` does give us [X5]:
  - `Collator` with `sensitivity: 'base'` equates `Müller`/`Muller` and `Straße`/`Strasse` (but not `Мария`/`Maria`);
  - `normalize('NFKD')` expands compatibility forms (`Ⅻ` → `XII`);
  - `\p{Script=…}` regexes detect scripts;
  - `Segmenter('zh')` splits `王小明在北京` into `王|小明|在|北京` (word segmentation, useful for tokenising unspaced scripts).

### 2.4 Phonetic algorithms

| Package or function | Latest | ≤ 2026-10-08 | Licence | Notes | Verdict |
|---|---|---|---|---|---|
| **Own consonant skeleton** (first letter kept, later vowels and h, w, y dropped, doubles collapsed) | - | - | ours | `muhammad`, `mohammed`, `mohd` all key `md`; `magomed` keys `mgmd`. At one million names `s:md` lands on 40,374 names, so very common skeletons must be skipped as keys [X2] | ✅ **keys only** |
| `double-metaphone` (words) | 2.0.1 (2022-11-02) | 2.0.1 | MIT (license @ `f8f5dea`) | ESM, `.d.ts`, 34 KB, 0 dependencies; English rules with Slavo-Germanic and Greek cases | ✅ optional, keys only [N9] |
| `metaphone`, `soundex-code` (words) | 2.0.1 (2022-11-02 / -01) | same | MIT | ESM, `.d.ts`; `soundex-code` depends on `type-fest` | ✅ not needed [N9] |
| `talisman` | 1.1.4 (2021-01-21) | 1.1.4 | MIT (LICENSE.txt, © 2016–2020 Guillaume Plique) | 24 phonetic modules (Daitch-Mokotoff, Double Metaphone, NYSIIS, Cologne, Phonem, French Phonex/Sonnex, Caverphone, Eudex, ...); CJS, no types, 550 KB, six dependencies, stale | ⚠️ reference only [N10] |
| `natural` | 8.1.2 (2026-10-22) | 8.1.1 (2026-02-27) | MIT | 13.8 MB; dependencies include `mongoose`, `pg`, `redis`, `memjs`, `wordnet-db` | ❌ in practice [N11] |
| Postgres `fuzzystrmatch` 1.2 `soundex`, `metaphone`, `levenshtein`, `daitch_mokotoff` | PG 17.11 | in image | PostgreSQL licence | Multibyte caveats for Soundex and Metaphone; Daitch-Mokotoff added in 1.2 [G2] [G4] | ✅ available, not needed |
| Postgres `fuzzystrmatch` `dmetaphone`, `dmetaphone_alt` | same | in image | `dmetaphone.c`: Perl-module code "under the same terms as Perl itself", plus a permissive 2003 notice for the rest | - | ❌ do not call (Perl terms) [G3] |

### 2.5 Fuzzy matching and indexing (npm)

| Package | Latest | ≤ 2026-10-08 | Licence | Notes | Verdict |
|---|---|---|---|---|---|
| **Own Jaro-Winkler and alignment** | - | - | ours | 3.5 µs per name pair with our alignment scorer [X1] | ✅ **keep** |
| `fastest-levenshtein` | 1.0.16 (2022-08-02) | 1.0.16 | MIT (LICENSE.md @ `03d621b`) | ESM `module`, `.d.ts`, 21 KB | ✅ only if an edit-distance budget is wanted [N12] |
| `leven` | 4.1.0 (2025-09-11) | 4.1.0 | MIT | ESM, `.d.ts` | ✅ alternative [N12] |
| `damerau-levenshtein` / `js-levenshtein` | 1.0.8 (2022) / 1.1.6 (2019) | same | BSD-2-Clause / MIT | CJS, stale | ⚠️ not needed [N12] |
| `cmpstr` | 3.4.0 (2026-09-14) | 3.4.0 | MIT (verified in Phase 5) | 731 KB | ✅ dev-only oracle candidate [N13] [R12] |
| `fuzzball` | 2.2.6 (2026-04-30) | 2.2.6 | MIT (LICENSE.md @ `c7da422`) | CJS + ESM build; depends on `heap`, `lodash`, `setimmediate`; describes itself as a port of TheFuzz (MIT) and/or RapidFuzz, whose ancestor fuzzywuzzy was GPLv2 [Y1] | ⚠️ not needed [N14] |
| `fuse.js` | 7.5.0 (2026-07-13) | 7.5.0 | Apache-2.0 | Bitap-style scan of every item, no index (inference) | ⚠️ too slow at PEP scale [N15] |
| `minisearch` | 7.2.0 (2025-09-16) | 7.2.0 | MIT | ESM, types; inverted index with fuzzy terms; 827 KB | ✅ optional for an in-memory reverse index [N15] |
| `flexsearch` | 0.8.212 (2025-09-06) | 0.8.212 | Apache-2.0 (LICENSE @ `20b36c2`) | 2.3 MB; 0.x versions | ⚠️ [N15] |
| `@m31coding/fuzzy-search` | 2.0.0 (2025-10-27) | 2.0.0 | MIT (LICENSE @ `8dc2576`) | ESM, types; suffix array plus n-grams; 1.4 MB; single maintainer | ✅ optional [N15] |

The indexes we need are simple (a postings list per key), so a dependency buys little (inference; §3).

### 2.6 Variant and vocabulary data

| Source | Licence | What it gives | Verdict |
|---|---|---|---|
| **rigour `rust/data/names/person_names.txt` @ `b0ba4ad`** (v2.5.0, 2026-09-10) | Repository MIT (LICENSE © 2023–2025 OpenSanctions Datenbanken GmbH); groups are Wikidata Q-ids (CC0 structured data) or `X`-prefixed manual overrides [O6] [D8] | 8,610,609 B, 157,298 lines, 569,089 forms (SHA-256 `be47a435…c91c79`). Examples: Q5837762 (57 forms of Muhammad in Latin, Cyrillic and Greek, plus Mamadou and Mehmood); Q17497922 (22 forms of Yusuf in eight scripts); Q18245781 (Bill, 14 forms in ten scripts, one of them a wrong Katakana form meaning "big") [X6] | ✅⚠️ **use, filtered, scored 0.9**; noise is real, so a group match must never equal an exact match |
| rigour `resources/names/org_types.yml`, `symbols.yml`, `stopwords.yml` @ `b0ba4ad` | MIT; hand-curated, partly from OpenSanctions name data [O6] | Legal forms in many languages (126 KB); company words with homoglyph and Cyrillic variants (87 KB); person-name prefixes (5 KB) | ✅ seed for our own legal-form and stopword tables (attribute in NOTICE) |
| ICAO Doc 9303 Part 3, 8th edition (2021), §6.A–C | ICAO copyright; the tables are facts we implement in our own code, as C31.2 already does for §6.A [A1] [R7] | Latin national characters, Cyrillic and Arabic to MRZ | ✅ implement 6.B and 6.C |
| Phase 5 nickname table (C58.3) | ours, Wikidata CC0 seed [R5] | English hypocorisms | ✅ reuse |
| OpenSanctions datasets (incl. its PEP and name data) | CC BY-NC 4.0 [D7] | - | ❌ |
| Python Unidecode / Text::Unidecode tables | GPL-2.0-or-later / Perl terms [Y1] [N4] | - | ❌ |

### 2.7 Python equivalents (only if the plan puts screening in a Python job)

| Package | Latest (released) | ≤ 2026-10-08 | Licence | Verdict |
|---|---|---|---|---|
| `jellyfish` | 1.3.0 (2026-10-16) | 1.2.1 (2025-10-11) | MIT | ✅ dev oracle (already the source of our vectors) [Y1] [R12] |
| `RapidFuzz` | 3.14.6 (2026-08-30) | 3.14.6 | MIT | ✅ dev oracle [Y1] |
| `anyascii` | 0.3.3 (2025-06-29) | 0.3.3 | ISC (same repository as the npm package) | ✅ [Y1] [N1] |
| `normality` | 3.1.0 (2026-03-08) | 3.1.0 | MIT; requires `pyicu>=2.10.0`, `chardet`, `charset-normalizer`, `banal` | ⚠️ needs native ICU [Y1] |
| `PyICU` | 2.16.2 (2026-03-20) | 2.16.2 | MIT (binding); ICU under Unicode-3.0 | ⚠️ native, and a licence not on rule 4's list [Y1] |
| `fingerprints` | 1.3.1 (2025-08-01) | 1.3.1 | MIT; requires `normality` | ⚠️ (via normality) [Y1] |
| `rigour` | 2.6.1 (2026-10-21) | 2.5.0 (2026-09-10) | MIT, but requires **`python-stdnum` (LGPL-2.0-or-later)** | ❌ at runtime [Y1] [O6] |
| `followthemoney` | 4.11.1 (2026-10-21) | 4.11.0 (2026-09-03) | MIT; requires `rigour` | ❌ (via rigour) [Y1] |
| `nomenklatura` | 4.17.4 (2026-10-22) | 4.17.1 (2026-10-07) | MIT; requires `rigour`, `scikit-learn==1.9.1`, `duckdb` and others | ❌ (via rigour) [Y1] [O5] |
| `python-stdnum` | 2.2 (2026-01-04) | 2.2 | LGPL-2.0-or-later | ❌ [Y1] |
| `Unidecode` | 1.4.0 (2025-04-24) | 1.4.0 | GPL-2.0-or-later | ❌ [Y1] |
| `text-unidecode` | 1.3 (2019-08-30) | 1.3 | Artistic License / GPL | ❌ [Y1] |
| `abydos` | 0.5.0 (2020-01-11) | 0.5.0 | GPL-3.0-or-later | ❌ [Y1] |
| `Metaphone` | 0.6 (2016-08-24) | 0.6 | BSD | ⚠️ stale [Y1] |
| `fuzzywuzzy` / `thefuzz` | 0.18.0 (2020) / 0.22.1 (2024-01-19) | same | GPLv2 / MIT | ❌ / ✅ not needed [Y1] |
| `splink` | 5.0.0 (2026-09-28) | 5.0.0 | MIT | ✅ dev-only, for a Fellegi-Sunter style evaluation if wanted [Y1] |

The matching should stay in TypeScript: the API and worker are Node, C58 is TypeScript, and the Python matching stack fails rule 4 through `python-stdnum` (inference from [Y1]).

### 2.8 Postgres extensions in the pinned image

`pgvector/pgvector:pg17` (local image `ac08538c6f8b`) is PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) and ships these contrib extensions [G4]:
- `pg_trgm` 1.6: `similarity`, `word_similarity`, `strict_word_similarity`, `%`, `<%`, `<<%`, `<->`, GIN and GiST operator classes;
- `fuzzystrmatch` 1.2;
- `unaccent` 1.1 (1,650 rules);
- `btree_gin`;
- `vector` 0.8.7.

`pg_trgm` and `fuzzystrmatch` are trusted extensions, so a non-superuser with `CREATE` can install them; the migration must run `CREATE EXTENSION IF NOT EXISTS pg_trgm` itself, as CLAUDE.md requires for pgvector [G1] [G2] [R2]. Defaults: `pg_trgm.similarity_threshold` 0.3, `word_similarity_threshold` 0.6, `strict_word_similarity_threshold` 0.5; distance ordering (`ORDER BY name <-> q LIMIT k`) works with GiST, not GIN [G1]. Non-ASCII characters become hashed trigrams (`show_trgm('café')` contains `0xef5960`) [X2], so index the normalised ASCII form.

---

## 3. Candidate retrieval at scale

### 3.1 List sizes

| List | Entries | Names | Source |
|---|---|---|---|
| OFAC SDN (served 2026-10-22) | 19,471: 7,519 individuals, 10,042 entities, 1,568 vessels, 342 aircraft | 39,663 strong (19,471 primary + 19,673 aka + 502 fka + 17 nka), plus 4,421 weak; 50,081 translations | [D1] [D2] [D3] [X3] |
| UN Security Council (generated 2026-10-22T23:00Z) | 1,010: 736 individuals, 274 entities | 3,776 (1,010 primary + 2,766 aliases, 628 of them `Low`) | [D5] [X3] |
| EU FSF | 6,128 targets; 4,398 people, 1,728 organisations (OpenSanctions count) | **not measured** (the EU file needs the token published on its own page) | [D7] |
| UK Sanctions List | 6,411 targets; 4,023 people, 1,929 organisations, 412 companies, 683 vessels, 59 wallets (OpenSanctions count) | **not measured** | [D6] [D7] |
| Wikidata PEPs (OpenSanctions extraction) | 266,362 persons (266,363 is the dataset's "targets" count; corrected in fact-check) | **not measured**; roughly 0.8–2.7 million name strings at 3–10 labels and aliases each **(inference)** | [D7] |
| OpenSanctions PEP collection (context only) | 721,236 targets, 727,207 people from 214 sources | - | [D7] |

Combined sanctions lists come to roughly 85,000–110,000 names (inference: the measured 48,000 OFAC and UN names, including OFAC's weak aliases, plus 3–5 names per EU and UK target). A Wikidata PEP set adds one to three million.

OFAC names average 3.77 tokens (max 26), 23 characters at the median, 56 at p95 and 196 at most; there are 31,107 distinct tokens, 460 of them two characters or fewer [X3].

### 3.2 The cost of matching every name

| Scale | Exhaustive scoring of one query (our alignment scorer) |
|---|---|
| 39,663 OFAC names | 137 ms (3.46 µs per pair) |
| 1,000,000 names (OFAC + synthetic recombinations of OFAC given and family names) | 3,927 ms (3.93 µs per pair) |

Source: [X1]. Exhaustive scoring is acceptable for one interactive screening against sanctions lists alone, but not for PEP scale or batch re-screening.

### 3.3 Blocking options, measured

Setup [X1]:
- 400 individual names sampled from the list, each turned into eight synthetic variants by our own generator: exact, one typo, one transliteration rule (`ou`↔`u`, `kh`→`h`, `y`↔`i`, `j`→`dj`, ...), reversed order, dropped middle name, given name as an initial, first two tokens joined, typo plus reversal.
- "Recall" is blocking recall: the true entry is among the candidates. Score is the best name score of the true entry.

| Variant | Token + skeleton index, 40k names: recall / candidates / ms | Trigram (≥ 40% shared), 40k: recall / candidates / ms | Token index, 1M: recall / candidates / ms | Trigram, 1M: recall / candidates / ms | True-entry score at 40k: mean (min), share ≥ 0.85 |
|---|---|---|---|---|---|
| exact | 1.000 / 256 / 2.0 | 1.000 / 20 / 1.2 | 1.000 / 494 / 12.1 | 1.000 / 137 / 53.1 | 1.000 (1.000), 1.000 |
| typo | 1.000 / 226 / 1.7 | 1.000 / 14 / 1.1 | 0.998 / 476 / 7.6 | 1.000 / 95 / 51.6 | 0.982 (0.925), 1.000 |
| transliteration | 1.000 / 245 / 1.8 | 0.995 / 14 / 1.1 | 0.998 / 488 / 8.7 | 1.000 / 96 / 49.1 | 0.971 (0.605), 0.993 |
| swap | 1.000 / 256 / 1.9 | 1.000 / 18 / 1.2 | 1.000 / 494 / 7.3 | 1.000 / 119 / 52.9 | 1.000 (1.000), 1.000 |
| drop middle | 1.000 / 206 / 1.3 | 0.989 / 32 / 1.0 | 1.000 / 491 / 9.6 | 0.992 / 248 / 45.3 | 0.925 (0.909), 1.000 |
| initial | 1.000 / 221 / 1.4 | 1.000 / 48 / 1.0 | 0.995 / 462 / 6.0 | 0.983 / 195 / 36.6 | 0.839 (0.455), 0.595 |
| joined | **0.680** / 117 / 0.9 | 1.000 / 15 / 1.1 | **0.655** / 313 / 4.3 | 1.000 / 110 / 50.8 | 0.615 (0.000), 0.660 |
| typo + swap | 1.000 / 226 / 1.7 | 0.990 / 9 / 1.1 | 0.995 / 476 / 6.6 | 0.993 / 71 / 48.0 | 0.982 (0.925), 1.000 |

Index build [X1]:
- 284 ms for 40k names (heap 205 MiB, RSS 280 MiB in a naive object layout);
- 10.1 s for 1M names (heap 686 MiB, RSS 938 MiB).

Keys on more than 2% of names (for example the token `al` and the skeleton `md`) were skipped at query time [X1].

What the table shows:
- Token keys fail on joined forms, which a key for each adjacent-token concatenation would fix (inference, not measured).
- Trigrams catch joins but cost more at scale.
- Initials and joins also score low, so the scorer needs explicit initial and joined-token rules (C58.2 has them for identity comparison) [R5].

Postgres, same data, one connection, tmpfs, warm cache, 60 queries per method [X2]:

| Scale | Index | Size | Build | Query | p50 / p95 / max | Rows returned |
|---|---|---|---|---|---|---|
| 39,663 names | `pg_trgm` GiST (`siglen=64`) | 5.0 MB (GIN 3.1 MB; table 2.5 MB) | 0.56 s (GIN 0.31 s) | `name % q` at 0.4 | about 10 ms (single runs) | 17 for a two-token Arabic-origin query |
| 1,000,000 names | GIN over `keys text[]` | 25 MB (table 138 MB) | 11.1 s | `keys && rare_keys` (keys on ≤ 2% of rows) | 3.2 / 6.9 / 11.0 ms | mean 1,700 (cap 2,000) |
| 1,000,000 names | same | - | - | `keys && all_keys` | 8.2 / 56.7 / 93.9 ms | mean 23,415: too many without the df filter |
| 1,000,000 names | `pg_trgm` GIN | 52 MB | 6.5 s | `name % q` at 0.5, top 100 by similarity | 32.7 / 75.1 / 182.2 ms | mean 16 |

The synthetic one-million set reuses OFAC tokens, so its keys are denser than a real PEP set's; candidate counts are an upper bound (inference).

### 3.4 Latency budget (proposed)

| Operation | Estimate from the measurements | Proposed budget |
|---|---|---|
| One screening against sanctions lists (~100k names): rare-key retrieval + scoring ≤ 500 candidates × ≤ 3 query names | retrieval ~1–4 ms + scoring ~5 ms [X1] [X2] | p95 ≤ 100 ms in the worker, including hydration (inference) |
| One screening including a ~2M-name PEP set | rare-key retrieval 3–7 ms + scoring 2,000 candidates ~8–15 ms; + `pg_trgm` 33–75 ms when the second path runs [X2] | p95 ≤ 250 ms |
| Forward full re-screen of N subjects | ~5–15 ms per subject: 1M subjects ≈ 1.4–4 h on one core, ≈ 7–20 min on 12 (inference) | only after a matcher or threshold change |
| Reverse re-screen after a list update (§4) | subject index for 200k subjects in 1.2 s, 1M in about 10 s plus decryption (inference); 5.4 ms per changed list name against 200k subjects [X1] | ≤ 60 s per environment per list version |

---

## 4. Continuous monitoring

### 4.1 Versions and diffs

- **Versions.** Each fetch of a list records the publisher's publication date (OFAC's `datePublished`, the UN's `dateGenerated`), the fetch time, the file's SHA-256 and the entry count [D4] [D5].
- **Entry identity.**
  - OFAC's UID ties an entry to its addresses, aliases and identifiers; whether UIDs are ever reused is **not documented** [F7].
  - The UN carries `DATAID` and `VERSIONNUM` [D5].
  - Persona's `group-id` (example `EU:110286`) suggests source-prefixed entry ids (inference) [P1].
- **Content hash.** SHA-256 of a canonical JSON of the fields that matching reads: names with alias type and quality, scripts, dates of birth, places of birth, nationality and address countries, gender, identifiers and entity type. Program or remark edits then cause no re-screen (inference). List data is public, so a plain hash is fine.
- **Diff.** Added (new id), removed (id gone), changed (hash differs), unchanged.
- **Removals.** Removed entries mark open matches `delisted` for the operator and never auto-dismiss them (inference).
- **OFAC deltas as a cross-check only.** OFAC publishes delta files (FAQ 90): entity-level `add`/`remove`, and value-level `add`/`remove`/`update` on names, features and documents (DeltaFile.xsd). The sample delta for the 2026-10-21 publication held 22 entities, 18 added and 4 removed. OFAC nonetheless advises full refreshes from the comprehensive files, and says it cannot advise on automated download schedules [F7] [D4].

### 4.2 Re-screen on list change (reverse direction)

1. A new list version with a non-empty diff enqueues one job per environment that has monitored subjects (Persona's `is-recurring`/`is-continuous` flags mark such reports) [P5].
2. The job decrypts the monitored subjects' screened attributes, normalises them and builds an in-memory index with the same keys as the list side (§6).
3. Each added or changed entry's strong names are looked up in that index, and the candidates are scored with the same scorer and qualifiers, so the result is identical to a forward screening (inference).
4. New or changed matches above the threshold create matches and the `report/watchlist.matched` event (the event name shape our schema already accepts) [R10] [R4].

Measured: 5.4 ms per changed name against 200,000 subjects [X1].

### 4.3 Re-screen on subject change, and scheduling

- **Subject change.** A change to a monitored subject's screened attributes (name, birthdate, countries) runs one forward screening at once, in the same transaction-after-commit pattern as other jobs (inference).
- **Schedule.** A recurring full forward run is only needed after a matcher or threshold version change, or as a periodic consistency check. The Wolfsberg guidance names list additions and customer-data changes as the screening triggers [A2].
- **Staleness.** Polling cadence belongs to the lists note. Every result must record the list versions it used; a list older than twice its refresh interval makes the report `errored` with a staleness reason, never "no match" (ADR 0002 §3a) [R3].

### 4.4 Ignore lists that survive list updates

- **Key.** (environment, subject reference, list source, entry id, evidence hash), where the evidence hash covers:
  - the entry's matching-relevant content (its content hash, §4.1);
  - the matched list name;
  - the subject's screened attributes.
- **Re-runs.** The same key gives a suppressed `ignored` match, shown, not hidden.
- **Lapse.** A changed entry (new alias, new date of birth) or a changed subject gives a new key, so the match re-alerts with a reason such as `ignored_match_changed` (inference).
- **Precedent.** Persona's ignore entries snapshot the matched entity and the run they came from, which is consistent with this design [P1]. The Wolfsberg guidance treats rules that suppress hits on names already confirmed as false positives as list maintenance [A2].
- **Keyed hashing.** Subject names are low-entropy, so a plain SHA-256 over them can be reversed by dictionary. Hash the subject part with HMAC-SHA-256 under the environment's blind-index subkey, as `packages/db/src/blind-index.ts` does for document numbers [R9].

### 4.5 Privacy of the subject side

- Subject names are PII sealed with the `encrypted` helper [R2].
- A Postgres name index of subjects would put tokens in the clear, so the reverse index lives in worker memory for one run and is dropped (default).
- The alternative, persisted HMAC keys per subject token, is faster but reveals token equality and frequency patterns to anyone holding the database without the key (owner item C3).

---

## 5. Evaluation

### 5.1 Synthetic variants

- **Generator rules.** Typos (substitute, insert, delete, transpose), transliteration rules, order swaps, dropped middle names, initials, joined and split tokens, legal-form changes for organisations, cross-script forms from the variant groups.
- **Results so far.** Our first pass of these rules over OFAC individuals gave the numbers in §3.3 [X1]. They show where recall is lost (joins and initials) but measure our generator, not real-world variation.
- **Committed fixtures** use a synthetic list: invented persons and companies whose names are built from public name-frequency material and variant groups, never real list entries (rule 3) [R2].
- **Real-list evaluation** (variants of real OFAC, UN, EU and UK names generated at run time) runs only as an uncommitted job that publishes aggregate metrics (as C62.7's operator-run sync is never committed) [R5].

### 5.2 False positives without real people

- **Population.** Generate a synthetic customer population and screen it: given and family names drawn from frequency tables, mixed across cultures, plus Wikidata given-name and family-name labels (CC0) for non-Latin scripts [D8].
- **Alert rate.** Alerts per 1,000 customers at each threshold measures operational load. A synthetic customer can coincide with a listed name, and that hit counts as a name match the review must clear (inference).
- **Licences.** US public name-frequency tables (Census surnames, Social Security given names) are presumably public-domain federal works, **not verified** here.
- **Evidence of the effect.** Even our 200,000 synthetic subjects recombined from OFAC's own tokens produced 2,679 pairs at or above 0.85 against 500 listed names. That is a pessimistic illustration of why common names need the qualifiers, not a false-positive rate [X1].

### 5.3 Published benchmarks

- **Christen (2006).** Pattern-matching beats phonetic encodings for personal names; no technique wins everywhere; parameter choice is the practical difficulty [A4].
- **Cohen, Ravikumar and Fienberg (2003).** A TF-IDF and Jaro-Winkler hybrid is best overall for entity names [A3].
- **OpenSanctions Pairs** (arXiv 2603.11051, v2 2026-08-25). 755,540 labelled pairs from 293 sources in 45 jurisdictions; the older rule-based matcher scores 91.3% F1, LLMs up to 99.0%; the authors note that rules over-match. No data licence is stated on the paper page and the pairs hold real persons, so it is not usable for our fixtures, and it is not usable for evaluation without the owner (item B4) [O8].
- **OpenSanctions' OFAC emulation.** About 96% agreement on a few hundred sampled tool scores; its test fixture has 164 positives [O1] [O5].
- **No permissively licensed sanctions-screening benchmark was found.**

### 5.4 Thresholds are provisional

Every number in §6 is provisional until the held-out evaluation exists. As C60.5 does for the document classifier, the plan should fix them before the evaluation set is built and not tune them on it [R5]. Promotion of the fuzzy score from `beta` to `ga` needs a calibration report (ADR 0002 §3f) [R3]. The Wolfsberg guidance expects independent testing that the screening produces the expected alerts and that thresholds and suppression rules match the risk appetite [A2].

---

## 6. Recommendations: algorithm, parameters (provisional), data structures, tiers

**Analysis (R).**
- **Per name:** normalise (§1.4); tag parts (family, given, particle, title, legal form, generic word, number) using `FAMILY, Given` commas, structured fields and our tables; detect the script per token.
- **Additional forms:**
  - ICAO 6.B and 6.C transliterations for Cyrillic and Arabic tokens;
  - CLDR-like latinisation is not shipped; `any-ascii` gives the romanised form for every other non-Latin token, marked lossy;
  - a joined form for each adjacent pair of tokens;
  - the consonant skeleton;
  - variant-group ids (rigour groups, our nickname table).

**Retrieval keys (R).**
- Keys: `t:<token>`, `s:<skeleton>`, `g:<group id>`, `j:<joined bigram>`, kept per list name in a `text[]` with a GIN index.
- At query time, use only keys whose document frequency is ≤ 2% of names (a key-frequency table rebuilt with each version).
- Fall back to `pg_trgm` on the normalised name for single-token queries, or when the rare-key set is empty.
- Cap at 2,000 candidates, ranked by the number of shared keys.
- Weak aliases get exact-equality lookup only.

**Name score (H).**
- **Token-pair similarity:**
  - 1.0 for equal tokens or equal original-script tokens;
  - 0.9 for the same variant group;
  - 0.8 for a nickname pair;
  - 0.9 for an initial against a token it begins (weight 0.5);
  - our Jaro-Winkler when ≥ 0.88 (screening floor; C58 keeps 0.92 for identity comparison), else 0;
  - romanised-lossy pairs count at most 0.8.
- **Alignment:** one to one, any order; family-name pairs weigh 1.3, unmatched query tokens 0.8, unmatched list tokens 0.2, particles and generic words 0.5; a known given/family role swap multiplies the score by 0.95.
- **Name score:** the weighted mean, best over all (subject name, strong list name) pairs.
- **Single-token subjects** need an exact or group match, never a fuzzy one.

**Qualifiers (R rules feeding an H score).** Applied only when the name score is ≥ 0.70:

| Qualifier | Condition | Weight |
|---|---|---|
| `dob_day_disjoint` | Both sides have full dates and none agree, even transposed | −0.25 |
| `dob_transposed` | Agreement only after swapping day and month | −0.10 |
| `dob_year_disjoint` | No year in common, allowing ranges and circa ± 1 | −0.15 |
| `dob_exact` | An exact full-date agreement | +0.05 |
| `country_mismatch` | Both sides have countries and they do not intersect | −0.10 |
| `gender_mismatch` | Both sides recorded and they differ | −0.10 |
| `identifier_match` | An exact match on a passport, national id or registration number | lifts the score to at least 0.95 |

- Entity type is a hard filter. Weak-alias equality enters as 0.70 and needs `dob_exact` or `identifier_match` to reach an alert.
- **Thresholds:** below 0.70, not shown; alert at **0.80** for sanctions lists and **0.85** for PEP sets (more names, more coincidences; inference).
- **Template options:** `birthdate-filter` `off | penalty | strict` (default `penalty`), `country-filter` `off | penalty | strict` (default `penalty`), `entity-types`, `lists`, `min-score`.
- **Output:** each result carries the components, the matched name pair, the list version and the algorithm version (ADR 0002 §3f) [R3]. It maps onto `match-types` (`name_exact` when the normalised names are equal) [P1].

**Data structures (R).**
- `watchlist_sources`.
- `watchlist_versions`: source, published-at, fetched-at, SHA-256, counts, diff counts.
- `watchlist_entries`: source, entry id, content hash, type, public JSON, first-seen, last-seen, removed-at.
- `watchlist_names`: entry, name, normalised, script, quality, primary, tagged parts, `keys text[]` GIN, normalised name `gin_trgm_ops`.
- `watchlist_key_df`, rebuilt per version.
- Match rows (report, source, entry id, evidence HMAC, score, components, status `open | ignored | dismissed | delisted`) and ignore entries (§4.4).
- Subjects are never indexed in Postgres (§4.5).

**Tiers.**
- **R (deterministic):** list parsing, versioning and diffs; normalisation; ICAO-table transliteration; exact matching; entity-type filtering; date and country rules; identifier and crypto-address exact matching; ignore-list validity; re-screen triggers.
- **H (`beta`, with a confidence):** the fuzzy name score and the composite score and thresholds; lossy romanisation; skeleton and phonetic keys; variant groups; PEP matching on Wikidata's coverage. Until a calibration report exists, the confidence is the score itself, labelled uncalibrated.
- **A:** commercial PEP, adverse-media or watchlist feeds, as adapters with a deterministic sandbox provider [R3].

---

## What Phase 6 should take from this (proposed)

1. **A pure `packages/watchlist`** (TypeScript) on top of `packages/checks/src/matching` (C58). It holds:
   - parsers for the OFAC CSV and enhanced XML, the UN XML, and the EU and UK files (as data);
   - the version diff;
   - name analysis, keys and the scorer;
   - the qualifiers;
   - the evidence hash.

   Fetching stays in `apps/api` through the outbound client.
2. **Prefer OFAC's enhanced (or advanced) XML over the CSV**: it keeps weak aliases as a flag, name parts and roles, and 5,799 original-script forms the CSV drops [D3] [X3].
3. **Cross-script handling:**
   - same-script comparison when both sides have the script;
   - our own ICAO 9303 §6.B and §6.C transliteration;
   - `any-ascii@0.3.3` (ISC) only for keys and capped scores;
   - no other transliteration dependency.
4. **Variant groups** from rigour `person_names.txt` @ `b0ba4ad` (8,610,609 B, SHA-256 `be47a435969da3fa7311d8c682e462d6d20e6cf27cf90ad1473ce213c9a91c79`):
   - an entry in `data/manifest.json`, fetched by `scripts/fetch_data.py`, as C56 does for the disposable-domain list [R11] [R5];
   - filtered at build time (drop groups above a size cap and forms in scripts we do not handle);
   - scored 0.9;
   - attribution in `THIRD_PARTY_LICENSES.md` and NOTICE.
5. **Weak aliases** are never fuzzy-matched; exact equality only corroborates [F6] [A2].
6. **Postgres retrieval:**
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm` in the Phase 6 migration;
   - GIN over `keys text[]` with a per-version key-frequency table;
   - `pg_trgm` GIN as the second path;
   - scoring in TypeScript.
7. **Reverse-direction continuous monitoring** with an in-memory subject index per run; forward runs only after a matcher or threshold change.
8. **Version diffs** by entry id and content hash for every list; OFAC delta files only as a cross-check [F7].
9. **Ignore entries** keyed by the HMAC'd evidence hash, so they lapse when the entry or the subject changes; delisted entries are flagged, never auto-dismissed.
10. **Honest results:**
    - a report records the list versions, thresholds and algorithm version;
    - a stale or unloaded list gives `errored`, not "no match";
    - a subject whose script we cannot compare (no original on the list, lossy romanisation only) carries a coverage flag;
    - the fuzzy score ships `beta`.
11. **Fix the provisional numbers in the plan before evaluation** (token floor 0.88, name gate 0.70, alert 0.80 / 0.85, the qualifier weights in §6), then measure them on a synthetic held-out set built by a different agent from the scorer's author, as C60.7 does [R5].
12. **Add to the C58 scorer** the joined-token and initial rules for screening (our variants lost most there) and a key for adjacent-token concatenations [X1].
13. **Do not add** `transliteration`, `unidecode`, `unidecode-plus`, `natural`, `talisman` at runtime, Postgres `dmetaphone`, or any OpenSanctions Python package or data. Put them on the banned list beside Phase 5's.
14. **Record the UK change:** PLAN §3's "UK OFSI" becomes the FCDO UK Sanctions List (OGL v3.0) [D6].
15. **Resolve the redirect conflict with C54.6** before any list fetch is built (owner item B1).
16. **Keep the latency budgets in §3.4** as performance tests: one screening p95 ≤ 100 ms at sanctions scale and ≤ 250 ms with a PEP set, measured with a synthetic one-million-name table; reverse re-screen ≤ 60 s per environment per list version.

## Needs the owner

### A. Accounts and keys

- **A1.** None needed for matching. OFAC, UN and UK files are public downloads [D1] [D5] [D6]. The EU file needs the token from its public page (lists note).

### B. Licence, provenance and security decisions

- **B1. Redirects for list downloads.** OFAC's export and the UN XML answer 302 to pre-signed object-store URLs, while C54.6 makes any redirect an error [D1] [D5] [R5].
  - **Default:** a list-fetch client that follows exactly one redirect, HTTPS only, to an allowlisted host suffix per source (`s3.us-gov-west-1.amazonaws.com` for OFAC, `blob.core.windows.net` for the UN), with no credentials, the same size caps and the vetted lookup; every other client keeps refusing redirects. Reviewed by the security reviewer.
- **B2. rigour `person_names.txt`** (MIT repository, Wikidata CC0 groups plus 208 manual overrides, 8.6 MB, noisy) as the variant-group source.
  - **Default:** yes, fetched through the manifest, filtered at build time, not committed, attributed.
- **B3. Unicode-3.0** (ICU4X, CLDR transforms) is permissive but not on rule 4's list.
  - **Default:** do not adopt it; use the ICAO tables in our own code plus `any-ascii` (ISC).
- **B4. OpenSanctions Pairs and other OpenSanctions data** for evaluation: no data licence is stated for Pairs; OpenSanctions data is CC BY-NC; both hold real persons [O8] [D7].
  - **Default:** not used, not even locally.
- **B5. Real list names in tests.** Real people's names are not to be committed (rule 3), even though the lists are public [R2].
  - **Default:** committed fixtures use a synthetic list; real-list evaluation runs as an uncommitted job that publishes aggregate metrics only.

### C. Policy decisions

- **C1. Provisional thresholds and weights** (§6): token floor 0.88, name gate 0.70, alert 0.80 (sanctions) and 0.85 (PEP), the qualifier weights.
  - **Default:** adopt them as provisional, fixed in the plan; change them only through a calibration report.
- **C2. Weak aliases.**
  - **Default:** not screened; exact equality corroborates only. An operator option to screen them is off by default [F6] [A2].
- **C3. Subject index for continuous monitoring.**
  - **Default:** rebuilt in worker memory per run from decrypted subjects, nothing persisted.
  - The alternative, a persisted HMAC key table, is faster but reveals token-equality patterns to a database reader holding no key.
- **C4. Country and date filters.**
  - **Default:** `penalty` for both; `strict` available per template; country never a hard filter by default.
- **C5. An OFAC-compatible score** (an emulation of Sanctions List Search on its 0–100 scale) as informational metadata.
  - **Default:** not in Phase 6; revisit if operators ask. If built, it is an emulation, labelled `beta`, and never decides.

## Sources and pins

All read on 2026-10-22.

**Repository (read-only, `/home/mhnoor/persona-opensource`):**
- [R1] `docs/PLAN.md` §§2, 3, 4.4, 6
- [R2] `CLAUDE.md` rules 3–5 and the migration convention
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (Report types, the `report_*` events, the `reports/*` paths)
- [R5] `docs/plans/phase-5.plan.md` C51 (thresholds), C54.6, C56, C58, C60.5, C60.7, C61, C62.7
- [R6] `packages/checks/src/name-matching.ts`
- [R7] `packages/checks/src/extraction/agreement.ts`
- [R8] `packages/checks/src/matching/index.ts`
- [R9] `packages/db/src/blind-index.ts`
- [R10] `packages/db/src/tables/columns.ts` (event name shape `report/watchlist.matched`)
- [R11] `data/manifest.json`
- [R12] `docs/research/phase5-libraries.md` §2

**OFAC:**
- [F1] FAQ 249, released 2021-04-28: https://ofac.treasury.gov/faqs/249
- [F2] FAQ 247, released 2021-04-28: https://ofac.treasury.gov/faqs/247
- [F3] FAQ 248, released 2013-02-05: https://ofac.treasury.gov/faqs/248
- [F4] FAQ 246, released 2021-04-28: https://ofac.treasury.gov/faqs/246
- [F5] FAQ 5, released 2015-01-30, updated 2026-09-09: https://ofac.treasury.gov/faqs/5
- [F6] Weak aliases, FAQs 122–125 (2011-01-18; 123 of 2015-01-30): https://ofac.treasury.gov/faqs/topic/1646/print
- [F7] List formats, FAQs 79–1031 (FAQ 88 on schedules, FAQ 90 on delta files and full refreshes, FAQ 1031 on UIDs): https://ofac.treasury.gov/faqs/topic/1641

**Data files and publishers:**
- [D1] OFAC SDN CSV
  - URL: https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV
  - Answers 302 to a pre-signed `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com` URL (publication path `2026-10-20`, Last-Modified 2026-10-21).
  - 5,744,136 B, SHA-256 `96dade5a1cde8c9746937b4859ad75d8f2a34eed1a4046cc1f2240a830f70bda`.
  - Terms: a US federal government work; the lists note decides.
- [D2] OFAC ALT CSV
  - URL: https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV
  - The same redirect; a `HEAD` answers 400.
  - 1,063,745 B, SHA-256 `e489fe41709a1d38693c16be8448d55a05cd4b39c9c2ffa98fbcc76bb5ec8050`.
- [D3] OFAC enhanced XML
  - URL: https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ENHANCED.ZIP
  - Read from the copy a sibling research pass fetched on 2026-10-22: 6,793,008 B, SHA-256 `80d0a8de8734d9d278996e1ac5d6659f0c043a23c4e2926b4aa556f9a85b2c8b`; `SDN_ENHANCED.XML` 109,924,494 B.
- [D4] OFAC delta file and its schema
  - The copy a sibling pass fetched on 2026-10-22: `delta-latest.xml`, `datePublished` 2026-10-21, SHA-256 `b9a5875189e034f49656a9aac71fda18ce750ab2ef67351aeb9cdadba35bdc61`.
  - Namespace `https://www.treasury.gov/ofac/DeltaFile/1.0`; schema `https://www.treasury.gov/ofac/downloads/sanctions/1.0/DeltaFile.xsd` (copy SHA-256 `8651c54f3c0b33fb4cc3dcd70955f54c1269527f29fea3145744e4264c5bbd6d`).
  - The delta file's own download URL was not confirmed in this pass: `exports/DELTA.XML` returned an empty 200.
- [D5] UN Security Council Consolidated List
  - URL: https://scsanctions.un.org/resources/xml/en/consolidated.xml
  - `GET` answers 302 to a SAS URL on `unsolprodfiles.blob.core.windows.net` (`consolidatedLegacyByPRN.xml`); a `HEAD` answers 404.
  - `dateGenerated` 2026-10-22T23:00:06.809Z; 2,185,396 B, SHA-256 `a52a47a62939482afdba2ec2becb86c88a5d6a93875665b4c8f11e99cda1d2a4`.
  - Terms: for the lists note.
- [D6] The UK Sanctions List (FCDO): https://www.gov.uk/government/publications/the-uk-sanctions-list
  - The only source since the OFSI Consolidated List closed on 28 January 2026.
  - CSV, XML, ODS, ODT, PDF, HTML, text; Open Government Licence v3.0; page updated 2026-10-16.
- [D7] OpenSanctions dataset pages (counts are secondary; data licence CC BY-NC 4.0):
  - https://www.opensanctions.org/datasets/un_sc_sanctions/
  - https://www.opensanctions.org/datasets/eu_fsf/
  - https://www.opensanctions.org/datasets/gb_fcdo_sanctions/
  - https://www.opensanctions.org/datasets/wd_peps/
  - https://www.opensanctions.org/datasets/peps/
- [D8] Wikidata licensing (structured data CC0): https://www.wikidata.org/wiki/Wikidata:Licensing

**OpenSanctions code and articles (MIT code, read as reference only):**
- [O1] "How we reverse-engineered OFAC's sanctions screening algorithm", 2026-07-01: https://www.opensanctions.org/articles/2026-07-01-ofac-matcher/ (read as `.md`)
- [O2] Tuning the matching algorithm (updated 2026-08-04): https://www.opensanctions.org/docs/api/tuning/
- [O3] Matcher features, weights and options: https://www.opensanctions.org/matcher/
- [O4] logic-v2 announcement (URL dated 2025-09-11): https://www.opensanctions.org/articles/2025-09-11-logic-v2.md
- [O5] nomenklatura at tag 4.17.4, commit `9be3c29bee9129a71cb6bdc6dc3560f240d01201`: https://github.com/opensanctions/nomenklatura/tree/9be3c29bee9129a71cb6bdc6dc3560f240d01201
  - `LICENSE` (MIT), `pyproject.toml`
  - `nomenklatura/matching/name_based/ofac.py`
  - `logic_v2/model.py`
  - `logic_v2/names/{match,magic,analysis,distance,util}.py`
  - `compare/{dates,countries}.py`
- [O6] rigour at tag v2.5.0, commit `b0ba4adce7c99a5947b45d3461c69278e808521d`: https://github.com/opensanctions/rigour/tree/b0ba4adce7c99a5947b45d3461c69278e808521d
  - `LICENSE` (MIT), `pyproject.toml`, `rust/Cargo.toml`
  - `rust/src/text/{translit,phonetics,distance}.rs`
  - `rust/src/names/{compare,person_names}.rs`
  - `resources/names/{compare,org_types,stopwords,symbols}.yml`
  - `genscripts/generate_names.py`
  - `rust/data/names/person_names.txt`
- [O7] yente at tag v5.5.0, commit `258c0a1fbcd9e7f70acdb113f19c28b7eac282b8`: https://github.com/opensanctions/yente/tree/258c0a1fbcd9e7f70acdb113f19c28b7eac282b8
  - `LICENSE` (MIT), `yente/search/queries.py`, `yente/scoring.py`, `yente/settings.py`
- [O8] Smith, Sesodia, Lindenberg, Schroeder de Witt, "OpenSanctions Pairs: Large-Scale Entity Matching with LLMs", arXiv 2603.11051 (v1 2026-02-24, v2 2026-08-25): https://arxiv.org/abs/2603.11051

**Persona OpenAPI** (https://github.com/persona-id/persona-openapi at commit `805512b348af1c5d345bea8d7db7eb43d1821872`, directory `2026-09-29/components/schemas/`; identifiers only):
- [P1] `report-watchlist.yaml`
- [P2] `report-watchlist-request.yaml`
- [P3] `report-watchlist-entity.yaml`
- [P4] `report-template-watchlist.yaml`
- [P5] `report-shared-attributes.yaml`

**npm** (registry documents at `https://registry.npmjs.org/<name>`; versions and dates from `time`; licence files at the commit in the package's `gitHead`, or inside the published package through jsDelivr):
- [N1] `any-ascii`
  - https://registry.npmjs.org/any-ascii
  - https://github.com/anyascii/anyascii/blob/2c07da46be94346fecdc8f5a2c42fa7cf09fca00/LICENSE
  - `README.md` and `table.tsv` at the same commit (table SHA-256 `63d405125a149ed646b6f932be96414e2db4b9ff5c3cb1fac49f6386a6fb1fa9`)
- [N2] `transliteration`
  - https://registry.npmjs.org/transliteration
  - https://github.com/yf-hk/transliteration/blob/338bdb2ce84e6612c09d86fd7aa48afea198e0ab/LICENSE.txt
  - `README.md` and `data/chunks/x04.ts` at the same commit
- [N3] `@sindresorhus/transliterate`
  - https://registry.npmjs.org/@sindresorhus%2Ftransliterate
  - https://github.com/sindresorhus/transliterate/blob/61e1cb99c2d9bcd511db10aef2023258baffbb0d/license and `readme.md`
- [N4] `unidecode`
  - https://registry.npmjs.org/unidecode
  - https://github.com/FGRibreau/node-unidecode/blob/c16096eacd10bf9fffa97d84285a6e32dc2a9e8d/LICENSE, `README.md`, `data/x04.js`
- [N5] `unidecode-plus`: https://registry.npmjs.org/unidecode-plus
- [N6] `pinyin-pro`
  - https://registry.npmjs.org/pinyin-pro
  - https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.4/LICENSE and `README.md`
- [N7] Other transliterators:
  - https://registry.npmjs.org/wanakana
  - https://registry.npmjs.org/hangul-romanization
  - https://registry.npmjs.org/@romanize%2Fkorean
  - https://registry.npmjs.org/cyrillic-to-translit-js
  - https://registry.npmjs.org/limax
- [N8] ICU bindings
  - https://registry.npmjs.org/icu
  - https://data.jsdelivr.com/v1/packages/npm/icu@2.3.2?structure=flat
  - https://cdn.jsdelivr.net/npm/icu@2.3.2/lib/index.d.ts and `LICENSE` (Unicode License v3)
  - https://registry.npmjs.org/icu-transliterator
  - https://registry.npmjs.org/icu4x
- [N9] Phonetic packages (words)
  - https://registry.npmjs.org/double-metaphone
  - https://github.com/words/double-metaphone/blob/f8f5dea33c9d71843d504349f1d46373ed5b2b74/license, `readme.md`, and `index.js` in the 2.0.1 package
  - https://registry.npmjs.org/metaphone
  - https://registry.npmjs.org/soundex-code
  - https://github.com/words/soundex-code/blob/8c83adc47cbc00e90398479124cde39cbe178b08/license
- [N10] `talisman`
  - https://registry.npmjs.org/talisman
  - https://cdn.jsdelivr.net/npm/talisman@1.1.4/LICENSE.txt
  - https://data.jsdelivr.com/v1/packages/npm/talisman@1.1.4?structure=flat
- [N11] `natural`: https://registry.npmjs.org/natural
- [N12] Edit-distance packages
  - https://registry.npmjs.org/fastest-levenshtein
  - https://github.com/ka-weihe/fastest-levenshtein/blob/03d621ba324d0f665b3b7f557429ca622560d9a3/LICENSE.md
  - https://registry.npmjs.org/leven
  - https://registry.npmjs.org/js-levenshtein
  - https://registry.npmjs.org/damerau-levenshtein
- [N13] `cmpstr`: https://registry.npmjs.org/cmpstr
- [N14] `fuzzball`
  - https://registry.npmjs.org/fuzzball
  - https://github.com/nol13/fuzzball.js/blob/c7da422d1dab3daab72c2ce75ede07d3dd8b9068/LICENSE.md
  - https://cdn.jsdelivr.net/npm/fuzzball@2.2.6/README.md
- [N15] Search and index packages
  - https://registry.npmjs.org/fuse.js
  - https://registry.npmjs.org/minisearch
  - https://registry.npmjs.org/flexsearch
  - https://github.com/nextapps-de/flexsearch/blob/20b36c243c4f65a6dc6f97f64d4dcfc12934aa92/LICENSE
  - https://registry.npmjs.org/@m31coding%2Ffuzzy-search
  - https://github.com/m31coding/fuzzy-search/blob/8dc2576734b095f3cf367d835d882cb3dcd5debd/LICENSE
  - https://cdn.jsdelivr.net/npm/@m31coding/fuzzy-search@2.0.0/README.md
- [N16] Python Unidecode's Cyrillic table, used only for the provenance comparison: https://raw.githubusercontent.com/avian2/unidecode/master/unidecode/x004.py

**PyPI:**
- [Y1] PyPI JSON at `https://pypi.org/pypi/<name>/json` for `jellyfish`, `RapidFuzz`, `anyascii`, `normality`, `PyICU`, `fingerprints`, `rigour`, `followthemoney`, `nomenklatura`, `python-stdnum`, `Unidecode`, `text-unidecode`, `abydos`, `Metaphone`, `fuzzywuzzy`, `thefuzz` and `splink`. Licences come from `license`, `license_expression` and the classifiers. jellyfish and RapidFuzz LICENSE files were verified in Phase 5 [R12].

**PostgreSQL:**
- [G1] https://www.postgresql.org/docs/17/pgtrgm.html
- [G2] https://www.postgresql.org/docs/17/fuzzystrmatch.html
- [G3] https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/contrib/fuzzystrmatch/dmetaphone.c (licence header)
- [G4] Local image `pgvector/pgvector:pg17`, id `ac08538c6f8b`, inspected with `--network none`: `postgres --version` 17.11; extension control files `pg_trgm` 1.6, `fuzzystrmatch` 1.2, `unaccent` 1.1, `vector` 0.8.7

**Standards, guidance and papers:**
- [A1] ICAO Doc 9303 Part 3, Eighth Edition (2021), §6 and Appendix B: https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf (2,278,826 B, SHA-256 `55543aca6740140f1db0fb129f7f4815d1cf85dcfd49118cdb602f646c8a5553`)
- [A2] The Wolfsberg Group, Wolfsberg Guidance on Sanctions Screening (2019), §§3.3–3.4, 6, 6.3 and the glossary
  - https://db.wolfsberg-group.org/assets/29c751c6-f406-4329-a267-1b05aabdd241/Wolfsberg%20Guidance%20on%20Sanctions%20Screening.pdf
  - Linked from https://wolfsberg-group.org/resources/195/53; SHA-256 `415fc9bdfaee77233045c52de6cc1fb7e714bf81e7a056579319306d76f2d249`
- [A3] W. W. Cohen, P. Ravikumar, S. E. Fienberg, "A Comparison of String Distance Metrics for Name-Matching Tasks" (IIWeb workshop, 2003): https://www.cs.cmu.edu/~wcohen/postscript/ijcai-ws-2003.pdf (abstract and §1)
- [A4] P. Christen, "A Comparison of Personal Name Matching: Techniques and Practical Issues", ICDM Workshops 2006
  - Paper: https://doi.org/10.1109/icdmw.2006.2 (Crossref record)
  - Slides p. 15: https://users.cecs.anu.edu.au/~Peter.Christen/publications/mcd2006-slides.pdf
- [A5] TC39 ECMA-402 proposal lists at commit `07002d4d999558b9c7326f98e5134e0222b13808` (2026-10-14): `README.md`, `finished-proposals.md`, `stage-0-proposals.md`, `inactive-proposals.md` under https://github.com/tc39/proposals/tree/07002d4d999558b9c7326f98e5134e0222b13808/ecma402

**Local measurements** (scripts in a local scratch directory (not committed); data in the same scratch directory; nothing committed):
- [X1] `matching_bench.mjs`: Node 22.22.1, in-memory indexes, synthetic variants, scale test, reverse re-screen
- [X2] `matching_pg_synth.py` plus inline SQL: Postgres 17.11 from [G4], `--network none`, data on tmpfs, `shared_buffers` 512 MB; also the `show_trgm` and phonetic-function probes
- [X3] `matching_ofac_stats.py`, `matching_enhanced_counts.py`, `matching_zip_scan.py`, `matching_un_stats.py`, plus inline token counts over the normalised OFAC names
- [X4] `matching_anyascii_block.py` and `matching_compare_tables.py`: transliteration samples on synthetic common names; table provenance comparison
- [X5] An inline Node 22.22.1 probe of `Intl` members, `process.versions.icu` (78.2), `Collator`, `Segmenter` and case mapping
- [X6] `matching_names_groups.py`: statistics and probes of rigour `person_names.txt`
- [X7] `matching_npm_summary.py` and `matching_pypi_summary.py`: release dates and the ≤ 2026-10-08 pick from registry documents

---

## Fact-check (2026-10-22)

An independent pass re-opened each load-bearing fact at its primary source. It read registry JSON, LICENSE files at the stated commits, `git ls-remote` tag refs and the publishers' pages. It re-downloaded the OFAC CSVs, the enhanced ZIP, the delta and the UN XML (all hashes re-matched), rigour's `person_names.txt`, ICAO Doc 9303 Part 3 and the Wolfsberg guidance, each into its own empty directory, and parsed them with `python3 -I`. It ran the local `pgvector/pgvector:pg17` image offline. It sent at most one request per second per host (10 s on opensanctions.org) and no personal data. **Totals: 25 facts; 22 confirmed, 1 corrected, 2 could not be verified.** The correction is marked "(corrected in fact-check)" in the size table.

| # | Fact | Verdict | Evidence from the fact-check |
|---|---|---|---|
| 1 | any-ascii 0.3.3 (2025-06-29): ISC, (c) 2020-2025 Hunter WB, ESM with types, 552,792 B, no dependencies; Unicode 16.0, 124k of 155k characters | confirmed | npm: `gitHead` `2c07da4`, `type: module`, `unpackedSize` 552,792, no `dependencies`; `LICENSE` and README at `2c07da4` |
| 2 | transliteration 2.6.1 (latest 2.6.2 of 2026-10-20) labelled MIT; `x04.ts` equals Unidecode's `x004` in 232 of 250 positions | confirmed | npm dates and `gitHead` `338bdb2`; MIT text at that commit. Our comparison gives 232/250 when null counts as empty, and 216 of the 230 non-null entries identical |
| 3 | Licences failing rule 4 (npm unidecode, unidecode-plus, Python Unidecode, text-unidecode, abydos, fuzzywuzzy) | confirmed | npm unidecode README: the `x??.js` data files are "distributed under the perl license"; unidecode-plus `MIT AND BSD-3-Clause AND Artistic-1.0-Perl`; PyPI classifiers GPLv2+, Artistic/GPL, GPLv3+, GPLv2 |
| 4 | Node 22.22.1 (ICU 78.2, Unicode 17.0) has no `Intl` transliterator; none in the ECMA-402 lists at `07002d4` (2026-10-14); `icu@2.3.2` (Unicode-3.0, 23 MB) exports none | confirmed | Local `process.versions`; `Intl` members listed; the four ECMA-402 files contain no "translit"; `lib/index.d.ts` and the file list of `icu@2.3.2` have none. `icu` 2.4.0 appeared on 2026-10-22, too new for the 14-day rule |
| 5 | double-metaphone 2.0.1 (2022-11-02) MIT at `f8f5dea`, ESM with types | confirmed | npm `gitHead` `f8f5dea`; `license` file at that commit (MIT) |
| 6 | rigour v2.5.0 (`b0ba4ad`) `person_names.txt`: 8,610,609 B, SHA-256 `be47a435…1c79`, 157,298 groups (157,090 Q-ids, 208 manual), 569,089 forms | confirmed | Re-downloaded at the commit: identical size and hash; our count matches. `v2.5.0^{}` resolves to `b0ba4ad` |
| 7 | rigour needs python-stdnum (2.2, LGPL-2.0-or-later); Wikidata CC0 | confirmed | rigour `requires_dist` has `python-stdnum<3.0.0,>=2.0`; python-stdnum 2.2 (2026-01-04) classifier LGPLv2+; Wikidata:Licensing |
| 8 | OpenSanctions datasets CC BY-NC 4.0; the Wikidata PEP extraction has 266,363 persons | **corrected** | The licence is confirmed. The dataset page shows People 266,362; 266,363 is its "Targets" count. Corrected in the size table |
| 9 | OFAC Sanctions List Search algorithm (FAQ 249, 2021-04-28); slider defaults to 100; OFAC recommends no threshold | confirmed, with a nuance | FAQ 249 text matches. FAQ 247 (2021-04-28) gives the default 100 and FAQ 248 (2013-02-05) describes the field. Neither FAQ names a threshold value: "no threshold" means none is recommended, not that OFAC advises against using one |
| 10 | OpenSanctions' OFAC emulation: Jaro-Winkler without the 0.7 gate (96%), first-letter gate, short tokens dropped, pairs below 0.5 zeroed | confirmed | Article of 2026-07-01 ("96% accurate"); `ofac.py` at `9be3c29` (= tag 4.17.4): `PER_PAIR_JW_FLOOR = 0.5`, `SHORT_TOKEN_MAX_LEN = 2`, `query_norm[0] != candidate_norm[0]` gate |
| 11 | logic-v2 (best since 2025-12-01, threshold 0.7) weights and symbol scores | confirmed | Tuning page; matcher page (name_match 1.00, identifier_match 0.85, weak_alias_match 0.80, address_prop_match 0.20, country −0.20, dob_year −0.15, dob_day −0.25, gender −0.20, nm_extra_query_name 0.8, nm_extra_result_name 0.2, nm_family_name_weight 1.3); `SYM_SCORES` in `magic.py`: NAME 0.9, NICK 0.6 |
| 12 | yente v5.5.0 (`258c0a1`): 10 candidates per result, at most 500, `SCORE_THRESHOLD` 0.70, `SCORE_CUTOFF` 0.50; query parts | confirmed | `settings.py` (`MATCH_CANDIDATES` 10, `MAX_MATCH_CANDIDATES` 500); `search/queries.py` queries name parts, metaphone keys (length > 2), symbol ids, name variants and weak aliases |
| 13 | OFAC SDN of 2026-10-22: 19,471 entries; SDN.CSV 5,744,136 B (`96dade5a…`), ALT.CSV 1,063,745 B; 39,663 strong names, ASCII only; 4,421 weak and 5,799 non-Latin; every individual primary name "FAMILY, Given" | confirmed | Re-downloaded with identical hashes; 19,471 + 20,192 = 39,663 rows; both files pure ASCII; all 7,519 individual names contain a comma; enhanced XML: 5,799 non-Latin name translations |
| 14 | OFAC 302 to S3 (3,600 s), UN 302 to Azure SAS; C54.6 treats every redirect as an error | confirmed | Probes; `docs/plans/phase-5.plan.md` C54.6 sets `maxRedirections: 0` (read only) |
| 15 | UN list: 736 + 274; 2,766 aliases, 628 Low; 379 original-script; DOB 751 / 117 / 32 | confirmed | Re-parsed the identical file (also 49 empty `TYPE_OF_DATE`, 14 list types) |
| 16 | UK list the only source since 28 Jan 2026; formats; OGL v3.0; page updated 2026-10-16 | confirmed | GOV.UK page and content API |
| 17 | `pgvector/pgvector:pg17` (`ac08538c6f8b`): PostgreSQL 17.11, pg_trgm 1.6, fuzzystrmatch 1.2 with `daitch_mokotoff`, unaccent 1.1, vector 0.8.7; pg_trgm trusted; `dmetaphone.c` under Perl terms | confirmed | `docker run --network none`: version and control files (pg_trgm, fuzzystrmatch and unaccent are `trusted = true`); `daitch_mokotoff` in `fuzzystrmatch--1.1--1.2.sql`; PostgreSQL 17 pg_trgm docs; `dmetaphone.c` header: "same terms as Perl itself" |
| 18 | Measured latencies (137 ms / 3.9 s full scan; 1–2 ms and 4–12 ms keyed; GIN 3.2/6.9 ms, 25 MB; pg_trgm 33/75 ms, 52 MB) | could not verify | Our own benchmark on this machine, not an external fact; not re-run in this pass. Re-run [X1] [X2] before quoting these as targets |
| 19 | Reverse re-screen: index of 200,000 builds in 1.2 s, 5.4 ms per changed name; the 2026-10-21 delta held 22 entities (18 added, 4 removed) | could not verify (timings) / confirmed (delta) | The timings are our own benchmark, not re-run. The delta counts were re-parsed from the identical file |
| 20 | FAQ 90 advises full refreshes; the delta schema has entity-level add/remove and value-level add/remove/update | confirmed | FAQ topic 1641; `DeltaFile.xsd` types `elementAction` and `valueAction` |
| 21 | Weak aliases flagged in TXT/PDF, CSV Remarks and advanced XML `LowQuality`; not generally expected to be screened (FAQs 122–125); Wolfsberg 2019 "not expected, nor … typically productive" | confirmed | FAQ topic 1646 (FAQs 122–125); Wolfsberg PDF §6.3 and glossary (SHA-256 `415fc9bd…d249`, same as [A2]) |
| 22 | ICAO Doc 9303 Part 3 (8th edition, 2021) §6.A/B/C transliteration tables; Appendix B: at least 32 spellings of one Arabic given name | confirmed | Re-downloaded (2,278,826 B, identical SHA-256): "Eighth Edition, 2021"; §6 A, B and C headings; App. B: "at least 32 variants based on the name 'Mohammed' alone" |
| 23 | Persona watchlist identifiers (query fields, `match-types`, alias types, ignore-list fields) | confirmed, with a nuance | `report-watchlist-request.yaml` has `name-first`/`-middle`/`-last`, `term`, `birthdate` and `address-country-code`. The report attributes in `report-watchlist.yaml` echo the country as `country-code`. `report-watchlist-entity.yaml` has `primary_name`/`aka`; ignore entries carry `ignored-at`, `run-history-completed-at` and `ignore-reason` |
| 24 | OpenSanctions Pairs (arXiv 2603.11051, v2 2026-08-25): 755,540 pairs, RegressionV1 91.3% F1, no data licence stated | confirmed, with a nuance | Abstract page: v1 24 Feb 2026, v2 25 Aug 2026, 755,540 pairs, 91.3% F1. The paper itself is CC BY 4.0 (arXiv licence link); no licence is stated for the dataset |
| 25 | jellyfish 1.2.1 (1.3.0 of 2026-10-16 too new) and RapidFuzz 3.14.6, both MIT | confirmed | PyPI: jellyfish 1.2.1 (2025-10-11), classifier MIT; RapidFuzz 3.14.6 (2026-08-30), `license_expression` MIT |
