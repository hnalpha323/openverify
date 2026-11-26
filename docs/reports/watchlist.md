# Watchlist report (`report/watchlist`)

Screens a person against the selected sanctions lists. **Tiers:** R for the lists and their versions, the normalisation and exact identifier matching; H for the fuzzy name score. **Stage:** `beta` (a calibration report is pending). See [the reports overview](README.md) for statuses, errors, coverage, monitoring and review, which every type shares.

## What a result means

- `ready` with `has-match: true`: at least one entry of a screened list matched the person at or above the template's minimum, or by an exact identifier. `matched-lists` names each list with its entries; `matches` holds each match for review, with its score, `match-types` and the evidence: the matched name pair, its levels and methods, the date, country and gender qualifiers, the preset and the thresholds.
- `ready` with `has-match: false`: every selected list was screened, fresh, by the current matcher, over every name the query gave, and nothing reached the minimum. `coverage` says how completely the names were compared: `lossy_script` means a name was compared only through a lossy transliteration (Arabic when the list holds no name in Arabic script, Han, Thai and other scripts), so a miss is weaker evidence; `truncated` means the search was cut short.
- **What complete coverage does not promise.** `coverage.complete: true` says every name was compared in its own script, through the ICAO 9303 tables or through the variant groups, and that the search reached every list name it could match. It does not say the matcher knows every way a name is written. A listed person can still be missed with complete coverage when the list writes the name:
  - in a romanisation outside the variant groups and ICAO's tables (a Cyrillic or Arabic name spelled in a national or ad hoc style the groups do not hold);
  - in a spelling the matcher has never seen (a rare name with no variant group);
  - with more typos than the preset's budget (one edit per token of at least 5 letters under `tolerant`, none under `strict`).

  Screening tools state their transliteration scope the same way; this page and the evaluation report (`docs/calibration/`) give ours.
- `errored`: something was not screened. Matches found in the lists that were screened are kept and alerted on, but the report is never "clear". The console shows "not screened".
- A match is a lead for a reviewer, never a decision: a common name can match many people, and a different person can share a listed name.

## Query

The public watchlist request: `name-first`, `name-middle`?, `name-last` or `term` (1–300 characters), `birthdate`? (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), `address-country-code`?, `gender`?, `identification-number`? with `identification-type`? (`passport`, `national_id`, `tax_id`) and `identification-country-code`?, and ours: `additional-names`? (up to 3 more names of the same shape, every one screened). A completion report fills them from the verified ID first ([the overview](README.md#reports-on-inquiry-completion)).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `search-lists` | every enabled sanctions source (sandbox: the sandbox list too), resolved and pinned when the version is created | The sources screened. An empty list is refused at publish (`watchlist_sources_empty`); a sandbox-only list is refused in production. |
| `name-matching` | `{ preset: tolerant }` | `exact`: a list name equal to a subject name after normalisation, in any order. `strict` (minimum 0.85): equal tokens, original-script and ICAO-transliterated equality, cross-script variant groups, initials, joined tokens, the subset rule. `tolerant` (minimum 0.80): `strict` plus nicknames, same-script spelling variants and one typo per token of at least 5 characters, a typo being one inserted, deleted or substituted letter or two adjacent letters swapped. `custom`: `min-score` 0.70–1.0 with `allow-nicknames`, `allow-variants` and `typo-budget` (`none`, `low` 18, `medium` 5, `high` 3 characters). |
| `birthdate-matching` | `year_plus_minus_one` | What counts as agreement: `exact_date`, `exact_year`, `year_plus_minus_one`. |
| `birthdate-filter` | `penalty` | `off`, `penalty` (a disagreeing date lowers the score), `strict` (drops the entry). |
| `country-fields` | birthplace, citizenship, nationality, residency | The entry's countries compared with `address-country-code`. |
| `country-filter` | `penalty` | `off`, `penalty`, `strict`. |
| `screen-weak-aliases` | `false` | Weak (low-quality) aliases are not screened by default. When true, a weak alias equal to a subject name matches only with an exact birth date or an agreeing identifier, at a fixed 0.90 (`weak_alias`). |
| `max-list-age-hours` | 48 | A selected source not checked successfully within this many hours (or its own stale limit) errors `list_stale`. |
| `recurrence-interval-days`, `pause-on-match`, `resume-delay-minutes` | `null`, `false`, 30 | [Monitoring](README.md#monitoring). |

Every score and minimum is provisional, ours, and changes only through a calibration report.

## How it screens

1. The names are analysed on the C58 matching library: both Latin folds (so "Müller" meets "MUELLER" and "MULLER"), titles dropped, suffixes and particles tagged, `FAMILY, Given` commas read; Cyrillic through the ICAO 9303 table (reliable), Arabic through the ICAO table and other scripts through `any-ascii` (both lossy: they feed keys and a score capped at 0.8). Names in the same original script are also compared in that script.
2. Candidates come from three paths in Postgres, in one statement for the keys:
   - **Name keys:** tokens, consonant skeletons, cross-script variant groups, joined pairs, and the unordered **pair** of every two tokens of a list name, in each spelling and through their variant groups, so "Garcia Maria" and a variant spelling of either name still meet. A key is used only when at most 500 live entries of the source hold it (a quarter of the 2,000-candidate cap, whatever the size of the list), so no key alone floods the search. A common name is then reached through its pairs with the subject's other names: "Maria Elena Garcia" finds the listed "Maria Garcia" through the pair {maria, garcia} even when "maria" and "garcia" are each held by thousands of entries.
   - **Trigram similarity** for single-word names, names with no key within the bound, and names some of whose tokens cannot be reached.
   - **Exact identifiers** whatever the name says.

   At most 2,000 candidates. A search says `truncated` when the cap cut it, or when two of the subject's tokens are held together by more entries than the bound, so it could not reach every list name holding them (it then still screens the names most like the subject, by trigrams). A truncated search that matched nothing errors `result_truncated`: it is never read as "no match".

   **Truncation and the preset.** Whether a search is truncated depends on the list and the subject's names, never on the preset. `result_truncated` is a truncated search that *kept nothing*, and a stricter preset keeps less from the same candidates, so `strict` and `exact` end `result_truncated` more often than `tolerant` on the same list. On the calibration's synthetic 2,000,000-name table (`docs/calibration/watchlist-phase6c.md`, finding 7), 0.55% of `tolerant` screenings ended `result_truncated`, 1.33% of `strict` and 3.26% of `exact`. The 1% target for `result_truncated` at that scale applies to the default preset, `tolerant` (owner decision 3 after Workflow 6C); the stricter presets are above it, and say so. At every preset a truncated screening is reported as truncated, never as no match: it errors `result_truncated` when it kept nothing, and a report that kept a match carries `truncated` in `coverage.limits`.
3. Each candidate is scored: a one-to-one token alignment, family names weighing more, a role swap and the subset rule allowed, then the date, country and gender qualifiers (`dob_exact` +0.05, `dob_day_disjoint` −0.25, `dob_transposed` −0.10, `dob_year_disjoint` −0.15, `country_mismatch` −0.10, `gender_mismatch` −0.10). An identifier of the same kind (and country, when both state one) matches at the higher of the name score and 0.95. A name pair whose upper bound cannot reach the preset's minimum (less the best qualifier) is not aligned: that saves time and never changes a match.
4. Entities are filtered by kind: a person screens individuals only.

## Monitoring after a list update

After a sync adds or changes entries, the re-screen finds every recurring report whose own search could reach a changed entry (it keys each subject as that report's search would, against the list's frequencies after the sync), scores the entry against the report's own configuration (its preset, its filters), and gives a `list_update` run only to a report whose own screening keeps a match. It also gives one to every report with an open or delisted match on a changed entry, so its next run re-scores evidence that may no longer hold (a removed alias, a corrected birth date: `match_not_found_in_run`, `evidence_changed`). A `list_update` run screens the changed entries of its sync beside its own retrieval, so it finds what the re-screen found.

## Sandbox

The sandbox template selects `openverify-sandbox`, the synthetic list `seed:dev` imports. Its listed person is the fictional "Avery Sandbox Quillfeather", born 1980-04-12 (entry `SBX-1001`). The monitored person "Rowan Fixturedale" (`SBX-1002`) is added by version 2 of the list and changed by version 3, for monitoring tests. See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Limits

- No ownership or 50%-rule screening.
- The sources are OFAC (SDN and Consolidated), the EU Financial Sanctions Files, the UK Sanctions List and, opt-in, the UN list. Others (Canada, Australia, Switzerland, the US Consolidated Screening List) are not built in.
- Matching is evaluated on synthetic data only (`docs/calibration/`).
- **After an upgrade that changes the keys** (this release's pair keys, `names-2`, and the variant groups' new digest), every source must be re-keyed (`watchlists:rekey`, or its next sync); until then its reports error `matcher_data_unavailable`. See [the overview](README.md).

## Events

`report/watchlist.ready`, `.errored`, `.matched` (a run that creates, re-opens or re-alerts a match), `.dismissed`, `.reviewed`, `.redacted`.
