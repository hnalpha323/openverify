# Lists

Lists hold the values an operator has decided to watch for: blocked email addresses, compromised ID numbers, a country, a radius around a point, a fingerprint, a face. They are screened when an inquiry completes, on demand, and by the [`custom-list` report](../reports/custom-list.md). A list match is evidence for a reviewer. It never declines, passes or fails anything on its own; the one exception is a list opted into `id_compromised_detection` (below).

See also: [importing items from CSV](importers.md), and [face and background lists](biometric.md).

## Kinds

Thirteen kinds, each on its own path (`POST /api/v1/list/<plural>`, items on `POST /api/v1/list-item/<plural>`). The resource type is `list/<kind>` and an item's `list-item/<kind>`; `filter[type]` takes the singular kind.

| Kind | Item value | Matched by | Tier | Importer |
|---|---|---|---|---|
| `email-address` | an address, or a domain with `match-type: domain` | exact key; a probe also tries its domain and every parent domain | R | yes |
| `phone-number` | a number, read with the list's `default-region` | exact key on the E.164 form | R | yes |
| `government-id-number` | a number, with an optional ID class | exact key; an item with no class matches any class | R | yes |
| `name` | first and last name | exact key on both orders; with `allow-fuzzy-name-first`, the fuzzy name method | R exact, H fuzzy | yes |
| `ip-address` | an address or a CIDR range | exact key, or containment in the range | R; a session address from an untrusted proxy setting is not screened | yes |
| `country` | a country code | the code itself | R (H when it came from the IP address) | yes |
| `geolocation` | a point and a radius of 1 to 500,000 meters | box overlap, then the haversine distance | H, approximate | yes |
| `string` | any text, case-insensitive unless `case-sensitive` | exact key | R | yes |
| `field` | a value of one inquiry or account field (`field-key`) | exact key, by the value's form | R | yes |
| `browser-fingerprint`, `device-fingerprint` | the 64-hex fingerprint a device resource serves | exact key | R | yes |
| `face` | added from an inquiry's selfie | cosine similarity | H | no |
| `selfie-background` | added from an inquiry's selfie | layout prefilter, then ORB confirmation | H, approximate | no |

Limits (`LIST_LIMITS`, `@openverify/core`): 1,000 active lists per environment; 1,000,000 items per list (10,000 for face and background lists); a name of 255 characters; a dismissal reason of 500. A list's limits are served in the document's `meta`. Archiving a list (`DELETE /api/v1/lists/:id`) keeps it and its items readable and stops it matching; an archived list still takes a `PATCH`. `GET /api/v1/list-items` needs `filter[list-id]` (400 `filter_required` without it).

## How values are keyed

A list item is stored sealed (`list_items.value`), beside an HMAC match key under the environment's blind-index subkey and the kind's own label (`openverify/identifier-<kind>/v1`). Matching compares keys, never plaintext; a country matches on its plaintext code, which is not personal data. The normalisation (`LIST_KEYS_VERSION` `lists-1`) is the same for an item and a probe:

- **Email:** the local part lower-cased, the domain through IDNA, a trailing root dot dropped. A domain item refuses a whole address.
- **Phone:** E.164 by `libphonenumber-js`. A number must be *possible*, not *valid*, because a list may hold numbers in ranges the metadata lacks.
- **String:** NFKC, trimmed, whitespace collapsed, and lower-cased with `toLowerCase()` unless the list is `case-sensitive`. `toLowerCase()` is not a full Unicode case fold.
- **Field:** a number and a text that reads as the same canonical decimal meet (`42.50` and `42.5`), a boolean meets its word, and anything else follows the string rule; `007` stays text.
- **Name:** each name is taken whole in each of the C78 folds, so `Jurgen Mueller` does not meet `Jürgen Müller` exactly. A name in a lossy script (Arabic, Han) keys on its own script, so its Latin spelling meets it only through a fuzzy list. A generational suffix stays in the exact last name.
- **Fingerprints:** the key input is the 64-hex HMAC the device resource serves, keyed again. After `blind-index:rebuild` the device HMACs change, so an older fingerprint item cannot be re-derived: its list reports `key_rotated`, never "no match".

Every rule change bumps `LIST_KEYS_VERSION`; an item keyed under another version reports `normaliser_outdated` until `blind-index:rebuild` (which runs `rebuildListIndexes`) keys it again.

## Screening at completion

An inquiry template version carries `list-config` (C99.5):

```json
{ "screen": "all", "on-list-match": "none" }
```

- `screen`: `all` (every active list with `screen-at-completion` on, the default), `none`, or up to 50 list ids.
- `on-list-match`: `none` (the default) or `needs_review`, which moves a completed inquiry to review when a list matched or could not be read, never one already decided, and never a redacted one.

When an inquiry completes, fails or expires, a `list_screenings` row is written in the same transaction; the `list-screen-sweep` (every 15 s) enqueues the `list-screen` job, which builds the probes from what the inquiry holds (confirmed OTP destinations, fields, the government ID, the database inputs, the session's address, country, point and fingerprints, the selfie), selects the lists and writes one list match per item and source, with `list-match.created` (no value in the event). A verification that came from a rejected handoff session is left out.

The inquiry's `inquiry/list_match_count` signal (R tier, never a review rule) counts the open matches, and its `signal-details` entry carries `list-screening`: the status, the lists `unscreened` with their reasons and the lists `not-applicable`. Before the screening it is `null` with `list_screening_pending`; with no list selected, `no_lists_selected`; with a selected list unread, `list_unscreened`.

## Honesty: what "no match" means

A list that could not be read is listed in `unscreened` with one of these reasons, and is never "no match":

| Reason | Meaning |
|---|---|
| `list_items_pending` | face or background items still being embedded |
| `probe_unavailable` | the subject's value could not be read |
| `probe_too_coarse` | the value is too coarse for the kind (an IP country for a radius list) |
| `consent_not_given` | a face or background list without the inquiry's matching consent |
| `normaliser_outdated` | items keyed under another `LIST_KEYS_VERSION` or face model |
| `key_rotated` | fingerprint items keyed under an older blind-index key |
| `limit_exceeded` | a fuzzy name whose last name has more than 5,000 candidates |
| `list_archived` | the list was archived, or a named list is unknown |
| `method_not_on_demand` | `POST /lists/match` reads exact, CIDR and radius only |
| `kind_not_collected` | the environment does not collect the kind |
| `client_address_untrusted` | the session's address came from an untrusted proxy setting |

A list the subject has no value for is in `not-applicable` (`subject_has_no_value`): screened, with nothing to compare.

## On demand: `POST /api/v1/lists/match`

Up to 20 probes against the named lists, or every active list of the probes' kinds. It reads exact, CIDR and radius matches only, needs `lists:read` and `pii:view`, takes the `lists-match` policy (60 a minute) and writes no list match. The answer, `list-match-result`, carries `matches`, `unscreened` and `not-applicable`.

## List matches

`GET /api/v1/list-matches` (`filter[inquiry-id]`, `filter[account-id]`, `filter[list-id]`), and `include=list-matches` on an inquiry or an account. `matched-value` and `reason` are personal data: masked without `pii:view`. `POST /api/v1/list-matches/:id/dismiss` takes a reason (sealed); a match already dismissed or redacted answers 409 `list_match_not_open`. Each match carries its method, tier, `confidence` (H only), `approximate`, `score` (fuzzy, face, background) and `distance-meters` (radius).

## Compromised IDs (C99.9)

A government ID number list with `use-for-compromised-ids` feeds `id_compromised_detection`: a listed number fails that check, and the match is recorded as a list match. A list it could not read makes the check `not_applicable` with `compromised_list_unavailable`, never a pass.

## Fuzzy names

A `name` list with `allow-fuzzy-name-first` also stores the last-name candidate keys; a probe takes at most 5,000 candidates by its last name (`fuzzy-name-candidate-cap`) and scores the whole name with the C78 scorer and its threshold, unchanged (`scorer-2`, `names-2`). Above the cap the list is `unscreened` with `limit_exceeded`. The cap is calibrated (`docs/calibration/lists-phase11.md`, item (h); Workflow 11D): on a synthetic 1,000,000-item list with a heavy-headed name law, 5,000 is the largest cap whose probe p95 stays within 1.5 times the old 2,000 cap's (585.8 against 434.0 ms on the reference machine) and whose peak memory stays within 512 MiB more (+140 MiB), and every probe both caps screened has the same matches. Even at 5,000, 31.7% of the probes on that list stay `unscreened` (38.0% at 2,000); on a list without such a heavy head far fewer do.

## Retention and redaction

- `item-retention-days` (up to 3,650) redacts items past it in the daily retention pass; face and background lists require it.
- Redacting an inquiry nulls its matches' `matched-value` and `reason`; `ip-retention-days` nulls the value of matches from the session's address, country and point.
- List values never appear in logs, problems, events, metadata or Valkey keys.

## Jobs

| Queue | Sweep | What it does |
|---|---|---|
| `list-screen` | `list-screen-sweep`, 15 s | screens a completed inquiry |
| `list-import` | `list-import-sweep`, 15 s | runs a CSV import |
| `list-item-embed` | `list-item-embed-sweep`, 15 s | embeds face and background items, redacts items past their source's consent window, purges masked objects |

## Rate limits

`lists-write` (600 a minute) on every list, item and dismissal write; `lists-match` (60 a minute) on `POST /lists/match`; `importers` (10 an hour) on uploads.
