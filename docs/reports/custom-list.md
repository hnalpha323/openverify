# Custom list report (`report/custom-list`)

Screens one subject against the operator's own lists (C97). **Tiers:** R for exact, CIDR and radius matches on R-tier probes; H for fuzzy names, backgrounds and IP-derived probes, each match carrying its tier, a confidence (H only) and `approximate`. **Stage:** `beta`. Matches are reviewed one by one under the C75 semantics (dismiss, review, the ignore list), keyed by the list item. See [the reports overview](README.md) for what every type shares.

The lists themselves, their kinds, keys and matching methods are described in [lists](../lists/README.md).

## Running it

- **Query:** any of `name-first`, `name-last`, `email-address`, `phone-number`, `government-id-number` with `government-id-class`, `ip-address`, `country-code` and `string`, plus `list-ids` (1-20), or the lists pinned on the report template.
- **Template:** `seed:dev` publishes `Default custom list` in each environment with `list-ids: null`, not recurring, so each report names its own lists (a fresh environment has none to pin). `list-ids` pins 1-20 lists. An archived or deleted pinned list is refused at template publish (`report_list_unavailable`); a report with no list at all answers `report_lists_required`.
- **On inquiry completion:** the query sources follow C99.5, `government_id_country` among them. A query left without a value gives the run `errored` with `insufficient_input`.
- **Events:** `report/custom-list.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed` and `.redacted`, the six the review model `matches` derives.
- **Monitoring:** recurring reports run on their interval. Re-screening when a list's `version` changes waits for Phase 8 workflows.

## What a result means

| Field | Meaning |
|---|---|
| `matched-lists` | Each list that matched, with its version and, per item, the method, tier, confidence, `approximate` and the value compared. PII. |
| `lists-searched` | Every list the run selected. |
| `sources` | One provenance entry per list read: `list-id`, `version`, `normaliser-version`, `item-count` and `screened-at`. A list has no sync. |
| `unscreened` | Every selected list the run could not read, with its reason. Any entry here ends the run `errored` with `list_unavailable` naming the list, keeping the matches it found. |
| `not-applicable` | Every selected list the subject has no value for (`subject_has_no_value`). The list was screened, with nothing to compare, and this is no error. |

With a match: a value of the query is on one of your lists, by the method each match names. Without one: no match on the lists read. A list that could not be read errors the report.

`has-match: false` means "no match" only beside `ready`, and a report is `ready` only when no selected list went unscreened.

## Limits

- A match says that normalised values are equal or near, and nothing more. A list match never changes an inquiry or an account on its own.
- A fuzzy name reuses the C78 scorer and its threshold, and its score is a confidence, not a probability.
- An IP-derived country or point is approximate: see the [IP address report](ip-address.md).
- An archived list or one whose items wait for the embed job is `unscreened`, and the run `errored`: a report never says "no match" for a list it could not read. A key rotation or a normaliser change leaves a list `unscreened` (`key_rotated`, `normaliser_outdated`) until `blind-index:rebuild` keys its items again.
- A fuzzy name list over the candidate cap (5,000 items under one last name; `LIST_MATCH_CONSTANTS['fuzzy-name-candidate-cap']`, calibrated in Workflow 11D) is `unscreened` with `limit_exceeded`.

## Review

Each match is keyed by its list item, so a re-run finds the same match again rather than a new one. Dismissing a match puts it on the ignore list; a later run that finds the same item does not reopen it. Redacting the report nulls `matched-lists` and the stored query.

## In a sandbox

There is no sandbox list: an operator creates their own, as `e2e/tests/custom-list-report.spec.ts` does end to end (a listed address matches with the list's provenance, another answers `ready` with `has-match: false`, a report with no list answers 422 `report_lists_required`). Every value there is synthetic.
