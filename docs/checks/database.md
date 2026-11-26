# Database and AAMVA checks

This page describes the `database` and `aamva` verification types as Phase 5 ships them: the values a user enters, the matching library that compares them with a record, the database and AAMVA checks, the silent AAMVA step, and what a pass means. The binding contracts are C52.3, C58 and C59 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

**No real record source ships.** Both types read their records through provider ports with a deterministic sandbox provider each (A-tier, decision 27): a database source and AAMVA's Driver's License Data Verification service (DLDV) need the operator's own agreements. Without a bound provider every check that reads a record answers `provider_not_configured`, which sends the verification to review, never to a pass.

## Contents

- [What a pass means](#what-a-pass-means)
- [The steps and the entered values](#the-steps-and-the-entered-values)
- [Match levels and groups](#match-levels-and-groups)
- [The database checks](#the-database-checks)
- [The AAMVA checks](#the-aamva-checks)
- [The silent AAMVA step](#the-silent-aamva-step)
- [Providers and publishing](#providers-and-publishing)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Clients](#clients)
- [Known limits](#known-limits)

## What a pass means

- **Database:** the values the user entered match a record the bound source holds, well enough for at least one configured match group (by default name, birth date and address, each at least a partial match). A sandbox or other non-authoritative source cannot say that a person does not exist: a miss there goes to review. It does not show that the person entering the values is the person the record describes.
- **AAMVA:** the issuing jurisdiction's records hold a license or ID card with these details (every field not in `ignored-fields` matched). It does not show that the card is in the user's hands.

## The steps and the entered values

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `database` | `database` | 1 | `fields` (from `DATABASE_FIELDS`, with `name_first`, `name_last`, `address_country_code` and at least one of `birthdate`, `address_street_1`, `identification_number`, `phone_number`, `email_address`), `requiredFields` ⊆ `fields`, `maxAttempts` |
| `aamva` | `aamva` | 1 | `source`: `form` (the AAMVA form) or `government_id` (the silent step), `maxAttempts` |

The user enters values through `POST /api/v1/flow/verifications/:id/inputs` (C52.3), then submits. Bodies are kebab-case and strict:

- **Database:** `name-first`, `name-middle`, `name-last` (1–200 characters), `birthdate` (`YYYY-MM-DD`), `address-street-1`, `address-street-2`, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code` (ISO 3166-1 alpha-2), `identification-number` (at most 64), `phone-number` (E.164), `email-address`. Only the step's fields are taken; the required ones are the step's `requiredFields` and always `name-first`, `name-last` and `address-country-code` (no source can be asked without a name and a country). The flow view's guidance lists `fields` and `required-fields`.
- **AAMVA form:** `name-first`, `name-last`, `birthdate`, `identification-number`, `issuing-authority` (a US state, DC or territory code), and optionally `issue-date`, `expiration-date` and `address-postal-code` (a ZIP or ZIP+4).

The values are stripped of control and bidirectional characters, trimmed, sealed at rest and never echoed. Every refusal of a body is one 422 with a JSON Pointer per member (`/birthdate`), which the clients show at the field; a body that is not a JSON object at all is a 400. A new body replaces the earlier values while the verification is `initiated`. Submitting before values were entered answers 409 `inputs_required`.

## Match levels and groups

The matching library (`packages/checks/src/matching/`, C58) compares one field at a time and answers a level with the methods that reached it and kebab-case flags, never a value:

| Level | Meaning |
|---|---|
| `full` | the same value, once folded |
| `partial` | a close or partly equal value (a nickname, an initial, a typo within the similarity threshold, a less precise date) |
| `none` | the values differ |
| `missing` | one side has no value, or the two are in different scripts: never a mismatch |

Methods are the public ids `remove_prefixes`, `remove_suffixes`, `remove_special_characters`, `fold_characters`, `string_similarity`, `string_difference`, `nickname`, `substring`, `tokenization`, `date_similarity` and `date_difference`, reported on full and partial results.

- **Names** (C58.2): case and accents folded (in two renderings, so `ä` reads as `a` and as `ae`), titles stripped, particles joined or split. Swapped given and family names, initials (given and middle names only), nicknames and token Jaro-Winkler similarity of at least 0.92 are `partial`; `full` needs equal folded tokens. A middle name present on one side only does not lower `full`; two different middle names cap the level at `partial`. A family name given as an initial, or a name without its given or family part, is `missing`. Flags: `swapped`, `middle-name-mismatch`, `suffix-mismatch`, `family-name-missing`, `given-name-missing`, `family-name-initial`, `name-incomplete`, `script-mismatch`.
- **Nicknames** (C58.3): our own table, `packages/checks/data/nicknames.json`, 1,390 pairs: 1,341 authored and 130 from reviewed Wikidata hypocorisms (CC0; the query, date and result digest are recorded beside the table). Only direct pairs count (Bob and Robert, never Bob and Rob through Robert). Non-Latin nicknames are absent.
- **Addresses** (C58.4): a libpostal-style normaliser with dictionaries built from libpostal (MIT), OpenCage's state codes (MIT) and libaddressinput's postal-code patterns (CC BY 4.0, attributed in `packages/checks/data/NOTICE`). A part after a comma that holds only unit ids, once the street has its house number, is the unit: a Spanish or Italian floor and door (`Calle del Molino 27, 2B`) reads the same on the street line or on a line of its own, and a comma before the number (`Calle del Molino, 27`) is no unit. `full` needs the country, postal code, house number, street and city to match, with the unit equal or absent on both. `partial` needs the country, house number and street, plus the postal code or the city, and allows a one-sided unit or one fuzzy component. A different house number or postal code on both sides, a different street or a different unit (a neighbour in the same building) is `none`. A one-sided house number, two fuzzy components, a PO box against a street, or a different city without a postal code is `missing`. Flags: `city-mismatch`, `subdivision-mismatch`, `unit-one-sided`, `house-number-one-sided`, `street-missing`, `po-box-one-sided`, `too-many-fuzzy-components`.
- **Birth dates** (C58.5):

  | Rule | Example | Level | Flag |
  |---|---|---|---|
  | R1 exact | `1984-07-09` and `1984-07-09` | `full` | |
  | R2 precision-limited | `1984-07` and `1984-07-09` | `partial` | `precision-limited` |
  | R3 range or circa | a `circa` year within one year | `partial` | `approximate` |
  | R4 transposed day and month | `1984-07-09` and `1984-09-07` | `partial` | `transposed` |
  | R5 one-digit or swapped-digit typo | `1984-07-09` and `1984-07-08` | `none` | `near-match` |
  | R6 two-digit year | `84-07-09` read as `1984` | as R1 or R2 | `century-inferred` |

  R5 is stricter than the public rule that counts two of three equal parts as a match: a one-digit difference in a birth date is a different date (decision 25).
- **Match groups** (C58.1): a group maps fields to the level each needs (`partial` or `full`). A group is **met** when every field reaches its level, **unmet** when some field is `none` or below its level, and **undecidable** when nothing is below but some field is `missing`. An identity check passes when any group is met, fails only when every group is unmet, and otherwise answers `insufficient_data`: a thin file goes to review, never to a fraud failure.

## The database checks

| Check | Type | Default | Passes when | Fails with | `not_applicable` with |
|---|---|---|---|---|---|
| `database_identity_comparison` | fraud | required | a match group is met | `low_confidence_match` (every group unmet), `record_not_found` (an authoritative source has no record) | `no_matching_record` (a non-authoritative miss), `insufficient_data`, `unsupported_country`, `provider_not_configured`, `execution_error`, `input_missing` |
| `database_name_comparison` | fraud | advisory | the name reaches `min-match-level` | `name_mismatch` | `not_requested` (non-blocking), `no_reference_data`, `no_matching_record`, `provider_not_configured`, `execution_error`, `input_missing` |
| `database_address_comparison` | fraud | advisory | the address reaches `min-match-level` | `address_mismatch` | as the name check |
| `database_birthdate_comparison` | fraud | advisory | the birth date reaches `min-match-level` | `birthdate_mismatch` | as the name check, and `birthdate_ambiguous` (a transposition) |
| `database_inquiry_comparison` | fraud | advisory | the entered values match the inquiry's own `fields` | `inquiry_field_mismatch` | `not_requested` (non-blocking: the step did not collect it), `no_reference_data` (the inquiry holds none of the fields), `input_missing` |
| `database_po_box_detection` | user behaviour | advisory | the address is not a PO box | `po_box_detected` | `not_requested` (non-blocking), `input_missing` |

- **Identity metadata:** `authoritative`; per field its `level`, `methods` and `flags`; each group's `fields` and `outcome`; and `not-requested-fields`, the group fields the step did not collect.
- A precision-limited birth date counts as `partial` only with `accept-precision-limited-birthdate` (default true, research R2); a transposed one only with `accept-transposed-birthdate` (default false, R4). Otherwise it counts as `missing`, so the identity is undecidable rather than unmet.
- **Per-field checks answer**, in this order: `not_requested` when the step did not collect the field (before any provider answer); `input_missing` when it was collected but left blank; `no_matching_record` when the source found none; `no_reference_data` for a `missing` level.
- **Inquiry comparison** reads the inquiry's `fields` (`name_first`, `name_last`, `birthdate`, `address_street_1`, `identification_number`, `phone_number`, `email_address`), the values a customer prefilled.
- **PO box** uses the government ID check's mailbox patterns (`PO_BOX_PATTERNS`: post office boxes, military addresses, private mailboxes and bags, the Spanish `apartado` and `casilla` forms, among others). It is user behaviour: the user can enter the address where they live.

The worker asks the database provider only when an enabled check reads the record, and only about the country and the step's collected fields (C59.1). A record is kept in memory only.

## The AAMVA checks

| Check | Type | Default | Passes when | Fails with | `not_applicable` with |
|---|---|---|---|---|---|
| `aamva_identity_comparison` | fraud | required | every field not in `ignored-fields` matched | `record_mismatch` (with the fields named), `record_not_found` | `jurisdiction_not_participating`, `provider_not_configured`, `execution_error`, `input_missing` |
| `aamva_name_comparison` | fraud | advisory | both names matched | `name_mismatch`, `record_not_found` | as above |
| `aamva_identification_number_comparison` | fraud | advisory | the number matched | `identification_number_mismatch`, `record_not_found` | as above |

- DLDV answers per field. The identity check's `ignored-fields` (default empty) may hold `name-first`, `birthdate`, `issue-date`, `expiration-date` and `address-postal-code`, never `name-last` or `identification-number`; when every mismatched field is ignored the check passes and lists them in `ignored-mismatches`. The name check records `name-first-match` and `name-last-match`.
- **A jurisdiction outside DLDV.** The silent step is always skipped (`submitted → skipped`, `verification.skipped`). The form source answers `jurisdiction_not_participating` and goes to review, or is skipped when `on-jurisdiction-not-participating` is `skip` (C50.7, C59.5). A skipped verification counts as done for the inquiry.
- **Birth dates.** Whether DLDV verifies the birth date in every jurisdiction is not confirmed (research), so an operator who sees birth-date mismatches only in some states can add `birthdate` to `ignored-fields`.
- The worker sends DLDV the card's jurisdiction and the values alone, nothing else; only the sandbox provider also gets the inquiry's reference id.

## The silent AAMVA step

An `aamva` step with `source: government_id` has no screen: the client never creates, fills or submits it (each answers 409 `verification_created_by_server`), and the web and Android flows show "Checking your license details" until the server moves on (C59.6). In the decision transaction of every government ID decision of the inquiry (`passed`, `needs_review` or `failed`, a processing failure included), while the inquiry is `created` or `pending`:

- **An eligible ID that passed or went to review** creates an AAMVA verification bound to it (`verification_inputs.source_verification_id`), with the values copied from the extraction and re-sealed, moves it to `submitted` and enqueues its job after the commit. Eligible means: the document established a driver license or ID card, its issuer identification number (IIN) names an AAMVA issuer in the US (a state, DC or a territory; not the State Department), and the extraction holds the first and last names, the birth date and the number; the postal code is copied as a ZIP or ZIP+4 when it is one.
- **Any other final decision** (an ineligible document that passed or went to review, or a failure with no ID attempt left or that no retry can fix) creates it `skipped`, bound likewise, and the inquiry settles.
- **A retryable ID failure with attempts left** creates nothing: the ID step is not final yet.
- An ID decision never creates a second attempt for the same ID, and a later eligible ID (a second ID attempt) gets a new AAMVA attempt, even after a skip.

Server-created attempts do not count toward `maxAttempts`, and the inquiry judges the step on the attempt bound to the latest decided ID, which stays open until that attempt exists. A publish rule (C50.4) refuses a silent step without an earlier government ID step.

## Providers and publishing

| Kind | Variables | Values | Unset or empty |
|---|---|---|---|
| `database` | `OPENVERIFY_PROVIDER_DATABASE_SANDBOX`, `_PRODUCTION` | `sandbox` (sandbox environments only) | unbound |
| `aamva` | `OPENVERIFY_PROVIDER_AAMVA_SANDBOX`, `_PRODUCTION` | `sandbox` (sandbox environments only) | unbound |

Both are read by the API (for the publish rule) and by the worker. A sandbox value on a production variable stops the process (ADR 0002 §3d). In a **production** environment, publishing a template with a `database` or `aamva` step whose provider is unbound answers 422 `provider_not_configured` at the step, unless the type sets `accept-review-without-provider: true`, in which case every such verification goes to review (H28). The sandbox answers are in [the sandbox providers](sandbox-providers.md#database-provider).

## Configuration

| Key | Check | Default |
|---|---|---|
| `match-groups` | `database_identity_comparison` | `[{ name: partial, birthdate: partial, address: partial }]` (1–5 groups over `name`, `birthdate`, `address`, `identification-number`, `phone-number`, `email-address`) |
| `accept-precision-limited-birthdate` | `database_identity_comparison` | `true` |
| `accept-transposed-birthdate` | `database_identity_comparison` | `false` |
| `min-match-level` | the name, address, birth date and inquiry comparisons | `partial` |
| `ignored-fields` | `aamva_identity_comparison` | `[]` |
| `on-jurisdiction-not-participating` | `aamva_identity_comparison` (the form source; the silent step always skips) | `review` (or `skip`) |
| `accept-review-without-provider` | type option (`database`, `aamva`) | `false` |

Every field a match group names must be collected by the step (`name` is `name_first` and `name_last`, `address` is `address_street_1`), or publishing answers 422. Every default is provisional (C51.3); the matching constants (Jaro-Winkler 0.92 for names and streets, 0.90 for cities) are ours.

## Privacy

- Entered and copied values are sealed in `verification_inputs` and nulled by redaction; the AAMVA `source` survives redaction. Every entered field is a PII attribute of the verification: masked without `pii:view`, null after redaction.
- Records from a provider stay in memory. Results hold levels, methods, flags, field names and the source's authority, never a value.
- Values follow inquiry retention (`inquiry-retention-days`); the default keeps inquiries forever.

## Clients

- **Web flow:** the database form shows the step's fields (the address grouped, required fields marked, autofill tokens), checks each value with the body's own schema before sending, and shows each refused pointer at its field; a resumed attempt whose values the server already holds can be sent for checking without typing them again. The AAMVA form asks for the license as printed, with its state or territory and ZIP code. A silent step shows a processing screen.
- **Android SDK:** the same forms in Compose Multiplatform; a resumed form whose values were received is submitted at once.

## Known limits

- No real database or AAMVA adapter ships; the sandbox providers are deterministic test data.
- A US license read only from its visual zone carries no IIN, so its issuer is unknown and the silent step is skipped.
- The address normaliser covers the dictionaries' languages; unit and floor words outside them are compared as text.
- Non-Latin nicknames are absent from the table.
