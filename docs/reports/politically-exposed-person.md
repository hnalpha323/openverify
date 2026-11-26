# Politically exposed person report (`report/politically-exposed-person`)

Screens a person against a local mirror of politically exposed persons built from Wikidata. **Tier:** H. **Stage:** `beta`. See [the reports overview](README.md) for what every type shares.

## What a result means

- `ready` with `has-match: true`: a holder of a public position in the selected PEP classes matched by name. `result` lists each entity with its positions (`pep-class`, country, start, end, `in-office`), `pep-type` (`pep`, or `relative`), `associates` and its Wikidata `sources`.
- `ready` with `has-match: false`: nobody in the mirror matched. **A miss is not evidence that the person is not politically exposed.** Wikidata's coverage is uneven by country and level, dates are often missing, and every result carries the `pep_coverage_uneven` notice.
- `errored` with `list_unavailable` naming `wikidata-pep`: the mirror was never synced. In production this is the answer until you set `OPENVERIFY_WIKIDATA_USER_AGENT` and run `pep:sync`.

## The source

`wikidata-pep` is built by `pnpm --filter @openverify/api pep:sync` (or the refresh job) from the Wikidata Query Service: queries paged per position class, one in flight, back-off on 429, 75 s per query, with your own contact in `OPENVERIFY_WIKIDATA_USER_AGENT` and the endpoint in `OPENVERIFY_WIKIDATA_SPARQL_URL` (a mirror or the planned v2 service). It is never queried from CI and never with an end user's name: screening runs against the local mirror. `pep:sync --import <file>` loads a recorded answers document (`openverify/wikidata-pep-answers/v1`) without any request.

The position classes are authored in `packages/watchlist/data/pep-positions.json` (23 Wikidata classes), each with its public class number and a source (FATF 2013 guidance, or authored):

| Class | Who |
|---|---|
| 1 | heads of state and government, national and regional ministers and legislators, governors, central-bank governors and boards, party leaders, the heads of the armed forces and the chief justice |
| 2 | supreme court judges, deputy ministers, prosecutors general, ambassadors, chiefs of police and police commissioners, senior religious figures, and (ours) the heads of international organisations |
| 3 | the leadership of state-owned enterprises |
| 4 | mayors and council members |

**What the table does not cover:** senior civil servants without a class of their own, and other senior staff of international bodies. Chief of police is class 2, not class 1, because Wikidata does not tell a national chief from a city's.

## The rules the sync applies

- **Open-ended tenures.** A position statement without an end counts as current only when it has no successor, no later holder of a single-holder position, and started within `OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS` (20). A statement without a start date counts as ended (`end: unknown`). A start still to come reads `in-office: unknown`.
- **Retention.** A holder whose every position ended more than `OPENVERIFY_PEP_RETENTION_MONTHS` (12) ago is left out; heads of state or government of a national position keep `OPENVERIFY_PEP_HEAD_RETENTION_MONTHS` (60). An unknown end is never kept. Deceased persons are left out.
- **Relatives** (spouse, children, parents, siblings of class 1–2 holders) are synced only with `OPENVERIFY_PEP_INCLUDE_RELATIVES=true`, only adults with a stated birth date, and only while a living, kept class 1 or 2 holder links them. A relative's record names the linked holder and carries `relative_of_class`, the most senior class of the holders it relates to; close associates are not built.
- **Names:** every distinct label and alias is kept, labels first; one-word aliases are weak and not screened by default.

## Query and configuration

Query: name parts or `term`, `birthdate`?, `country-code`?, and `additional-names`?.

| Key | Default | Meaning |
|---|---|---|
| `search-lists` | the enabled PEP sources (sandbox: the sandbox PEP list too) | Pinned at version creation. |
| `pep-classes` | `[1, 2]` | The classes screened. |
| `include-relatives` | `false` | Also screens relatives the install synced. A relative is screened when its own `relative_of_class` is among `pep-classes` (a relative synced before that member existed is read through its linked holder until the next `pep:sync`). Because the class is the most senior of its holders, `pep-classes: [2]` leaves out the spouse of a holder of both a class 1 and a class 2 position. |
| `include-unknown-class` | `false` | Also screens positions without a class. |
| `default-country` | none | The country assumed when the query states none. |
| `name-matching` | `{ preset: strict }` (minimum 0.85) | As the [watchlist report](watchlist.md#configuration). |
| `birthdate-matching`, `birthdate-filter` | `year_plus_minus_one`, `penalty` | As the watchlist report. |
| `keep-without-birthdate` | `true` | A holder with no recorded birth date is not filtered out. |
| `max-list-age-hours` | 192 | The weekly refresh plus a day. |

`topics`, `images` and `related-urls` are not served; `death-dates` is always empty.

Matching, retrieval and coverage are the [watchlist report](watchlist.md#how-it-screens)'s: a PEP mirror holds several names per person in several scripts, so the pair keys and the bound of 500 entries per key matter most here. Complete coverage does not promise a romanisation outside the variant groups and ICAO's tables, an unknown spelling or a typo beyond the budget ([what it does not promise](watchlist.md#what-a-result-means)).

**Truncation at this report's default preset.** A search is truncated or not whatever the preset, but `result_truncated` is a truncated search that kept nothing, and a stricter preset keeps less ([the watchlist report](watchlist.md#how-it-screens)). This report's default is `strict`. On the calibration's synthetic 2,000,000-name table, which is the size of a PEP mirror, 1.33% of `strict` screenings ended `result_truncated` (3.26% at `exact`, 0.55% at `tolerant`; `docs/calibration/watchlist-phase6c.md`, finding 7). Those screenings were watchlist screenings of persons, not PEP screenings. The 1% target for `result_truncated` at that scale applies to the default preset of the watchlist report, `tolerant` (owner decision 3 after Workflow 6C), so this report's `strict` default is not held to it and runs above it. A truncated screening is reported as truncated at every preset, never as no match: it errors `result_truncated` when it kept nothing, and keeps `truncated` in `coverage.limits` beside a match.

## Sandbox

The sandbox template selects `openverify-sandbox-pep`, with fictional office holders of each class (for example the head of government "Marlowe Testerton", `Q-test-1001`) and one fictional relative, the spouse "Imogen Testerton". `packages/watchlist/fixtures/wikidata-pep.synthetic.answers.json` is a synthetic answers document that `watchlists:sync --import <file> --source wikidata-pep` loads without a User-Agent (the e2e does this). See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/politically-exposed-person.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed`, `.redacted`.
