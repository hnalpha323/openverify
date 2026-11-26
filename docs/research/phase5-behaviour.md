# Phase 5 research: how Persona's other verifications behave (clean-room notes)

Prepared 2026-10-21 for OpenVerify Phase 5 ("Other verifications": phone, email, document / proof of
address, database, government ID NFC, KYB, crypto wallet, and the mDL / verifiable-credential stretch
goal). Everything is written in our own words. Field names, enum values, event names, reason codes,
configuration keys and check identifiers are reproduced only because they are short identifiers
needed for functional parity. No sentences, UI copy, display names of UI elements or hint texts are
copied: where Persona shows a check only under a display name, we describe what it does instead of
naming it. Anything the public sources do not state is marked **not documented**. Statements we infer,
but that no source states, are marked **(inference)**.

Every citation key (`[O7]`, `[H43]`, ...) is a link; the full URL of each key is in section 0.

---

## Summary

1. **Check identifiers for phone, email and NFC are not public.** The per-check table sits behind the
   dashboard login for every verification type [D3] [D5] [D6] [D7] [D14] [H3] [H13]. The only NFC identifier in any public
   source is `id_nfc_expired_detection` [O17]; no phone or email check identifier appears anywhere
   (all OpenAPI versions, docs, changelog, Help Center full dump). Our six contact and NFC check ids
   are therefore **ours** and should stay labelled that way.
2. **Persona splits our coarse types.** It has distinct verification types `aamva`,
   `database-standard`, `database-business`, `business-website`, `database-business-footprint`,
   `database-tin`, `database-vat-number`, `database-phone-carrier`,
   `phone-number-silent-network-authentication`, `mdoc` and `verifiable-credential` [O1] [D1]. Our
   registry puts the `aamva_*` checks under `database`, and all KYB checks (registry and website)
   under one `business` type.
3. **Two statuses we lack.** `tentatively_passed` applies only to `verification/document` (and a
   qualified-signature type), and `tentatively_failed` only to `verification/database-business` and
   the business footprint type, each with its own webhook event [O1] [O11] [O19] [D9].
4. **A fourth check category we cannot express.** The document checks report category `validity`
   [O11]. Our `checkType` only knows `user_behavior` and `fraud`, and our check object has no
   `category` field.
5. **Our `document_expired_detection` means something else.** At Persona that id checks whether the
   document's own expiry date has passed [H33]. The issue-date window (default 90 days, 365 advised for
   KYB papers) is a separate recency check whose identifier is not public [H32]. Our registry uses
   `document_expired_detection` for the recency window.
6. **Documents are configured per document group, not per template.** Each group has accepted or
   rejected classifications, its own extractions, checks and insights, with a catch-all group that
   never fails type detection [H27] [H28] [H29]. Type detection is always required [H30]. We have
   none of this.
7. **Document fraud is several checks, not one.** Besides `document_fabrication_detection`, Persona
   documents separate checks for PDF editing-tool metadata, inserted or altered fonts, image timestamp
   anomalies, suspicious image metadata, a JPEG-original check that is N/A on PDFs, comparison against
   known compromised documents, an asynchronous enhanced fraud score with risk levels, and a QR-code
   presence check [H26] [H27] [H31] [H38] [H39]. Their identifiers are not public.
8. **Database has more public checks than our table.** The docs list `database_identity_comparison`,
   `database_inquiry_comparison`, `database_address_deliverable_detection`,
   `database_address_residential_detection` and `database_po_box_detection` [D11]; the changelog adds
   `database_attribute_comparison` [C10] and `aamva_name_comparison` [C9]. The Help Center describes
   deceased/alive and identification-number comparisons by display name only [H49] [H78].
9. **Match configuration has a public shape we should mirror.** Per-field match requirements combine
   normalization methods (`remove_prefixes`, `remove_suffixes`, `remove_special_characters`,
   `fold_characters`) with comparison methods (`string_similarity`, `string_difference`, `nickname`,
   `substring`, `tokenization`, `date_similarity`, `date_difference_{x}`), any one requirement per
   field suffices, and match groups give alternative ways to pass [H48] [H55]. Results are
   full / partial / none / missing [H49].
10. **Crypto wallet semantics differ from our table.** Persona's address comparison checks the address
    recovered from a signed message against an optional expected address; all four checks are
    category `fraud`, and each is N/A with its own reason when its reference is absent
    (`no_expected_address`, `no_expected_statement`, `no_allowlist`) [O25] [O26]. Our registry types
    `crypto_wallet_validity_detection` as user behaviour.
11. **KYB category mismatch.** `database_business_service_available_detection` and
    `database_business_enabled_country_detection` are `user_action_required` at Persona [O19]; our
    registry types them `fraud`. The business website verification has 13 checks, of which only the 3
    identifiers we already have are public [H74] [O21].
12. **NFC: Persona names only PKI validation, not passive, active or chip authentication.** The only public
    statements are that chip data comes with optional PKI validation, that it proves the issuer created
    the data, and that it must stay a required check for IAL2's SUPERIOR pathway [M2] [H16] [H17]
    [H18]. Active authentication, chip authentication and DG1/DG2 comparisons are **not documented**.
13. **Phone and email OTP: what is public.** Code by SMS (voice also offered), a resend action, an SMS
    delivery-failure route back to number entry, a per-template maximum of code attempts (default 5),
    and a `confirmed` status [H3] [H5] [H9] [M1] [O1]. Code length, code lifetime, resend cooldown
    and an email link (instead of a code) are **not documented**.
14. **mDL and verifiable credentials exist publicly as resource schemas** (`verification/mdoc`,
    `document/mdoc`, `verification/verifiable-credential`) with ISO 18013-7 remote presentation for
    the California DMV wallet and an Entra Verified ID verifier [O27] [O28] [O29] [M5] [H82]. No check
    identifiers are public.

## Gap table

Verdicts: **MISSING** (public at Persona, absent from OpenVerify), **DIFFERS** (we have it under
another name, type, category or meaning), **OURS** (ours, no public Persona counterpart; fine, keep it
labelled), **N/D** (not documented publicly, so no parity target), **OK** (already aligned).

"OpenVerify today" means PLAN §4.3, `packages/core/src/check-registry.ts`,
`packages/core/src/enums.ts` and `packages/contracts/src/{verifications,event-names}.ts` as read on
2026-10-21. Our contracts currently support only `government_id` and `selfie` resources
(`SUPPORTED_VERIFICATION_TYPES`).

### Cross-cutting

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| X1 | Status `tentatively_passed` | Only `verification/document` (and a QES type); event `verification.tentatively-passed` | Not in `VERIFICATION_STATUSES` or event names | MISSING | [O1] [O11] [D9] |
| X2 | Status `tentatively_failed` | Only `verification/database-business` and footprint; event `verification.tentatively-failed` | Not in enum or events | MISSING | [O1] [O19] [D9] |
| X3 | Status `confirmed` | Only phone and email: a code was entered and accepted | In our enum, not wired to any lifecycle | DIFFERS (unused) | [O1] [D2] [D4] |
| X4 | Check category `validity` | Document checks use `validity`; KYB uses `user_action_required` and `fraud` | `checkType` is only `user_behavior` / `fraud`; no `category` on check objects | MISSING | [O1] [O11] [O19] |
| X5 | Type split | Separate types for AAMVA, database standard, business registry, business website, footprint, TIN, VAT, phone carrier, SNA, mdoc, verifiable credential | `database` holds `aamva_*`; one `business` type holds registry and website checks; no other types | DIFFERS | [O1] [D1] |
| X6 | `document.*` events | `document.created`, `.submitted`, `.pending`, `.processed`, `.errored`, `.extracted` (the last for government ID only) | No document resource or events | MISSING | [D9] [O35] |
| X7 | Verification creation path | Inquiry flow (recommended), workflow Run Verification step (option to continue on a tentative result, sandbox status override), direct create API (Enterprise only, discouraged) | Flow only | MISSING (workflow part is Phase 8) | [H86] [H42] |
| X8 | Investigation lock | Lock blocks redaction of a verification (409 while locked) | None | MISSING (platform) | [C13] |
| X9 | Sandbox simulation scope | Simulate actions support government ID, document, database and selfie; database emits no type-specific events | Gov ID and selfie | MISSING (document, database) | [D10] [C4] |

### Phone number

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| P1 | Check ids | Not public | `phone_number_otp_comparison` | OURS | [D5] [H3] |
| P2 | Channel | SMS code; voice call also offered | SMS adapter (Twilio) in PLAN | MISSING (voice) | [H1] [H9] [M1] |
| P3 | Max code attempts | Per-template setting, default 5 | "attempts limit" without default | DIFFERS (adopt 5) | [H3] [H4] [H5] |
| P4 | Resend and delivery failure | Resend action on code screen; a delivery-failure branch returns the user to number entry | None | MISSING | [H5] |
| P5 | Code length, lifetime, resend cooldown | Example code has 5 characters; nothing else | PLAN mentions expiry | N/D (choose and document ours) | [O4] |
| P6 | Resource attributes | `phone-number`, `confirmation-code`, a vendor risk score under `metadata` | None | MISSING (we must never expose the code) | [O2] [O4] |
| P7 | SMS-pumping defences | Per-user inquiries instead of a shared link, locking the country code, auto-decline workflow on region | Rate limits only | MISSING (country lock) | [H6] [H8] |
| P8 | Sender branding | Org display name inserted in the SMS copy | None | MISSING | [H10] |
| P9 | Silent network authentication | Separate type with `phone-number`; mobile SDK adapters | None | MISSING (behaviour N/D) | [O6] [D19] [D20] |
| P10 | Carrier ownership | Separate phone-carrier database verification: name, birthdate, address vs carrier record, full/partial/none/missing, risk 0–100, N/A when country unsupported | None | MISSING (adapter) | [H23] [H24] [H25] [O33] |
| P11 | Line type / carrier lookup | Lives in the phone risk report, not in the verification | PLAN puts libphonenumber type/carrier in the OTP row | OURS (placement) | [H22] |

### Email address

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| E1 | Check ids | Not public | `email_address_otp_comparison` | OURS | [D6] [H13] |
| E2 | Code delivery and config | Email code; per-template max attempts, default 5; module writes `email_address` | Mailpit adapter in PLAN | DIFFERS (adopt 5) | [H11] [H13] [H14] [H15] |
| E3 | Email link instead of a code | Not described anywhere | PLAN says OTP | N/D | — |
| E4 | Disposable domain, MX | Disposable, deliverability, domain age live in the email risk report | `email_address_disposable_detection`, `email_address_mx_detection` as checks | OURS | [H21] |
| E5 | Resource attributes | `email-address` (nullable), `confirmation-code` | None | MISSING | [O3] [O5] |
| E6 | Sender branding | Org display name in subject, preview and body of the code email | None | MISSING | [H10] |

### Document / proof of address

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| D1 | `document_type_detection` | Category `validity`; always required; passes when the classified type is accepted in the applied group; a template with only the catch-all group never fails it | R, `user_behavior`; five fixed classes | DIFFERS (category, config model) | [O11] [H28] [H29] [H30] |
| D2 | `document_extracted_properties_detection` | Category `validity`; driven by extractions marked required | R, `user_behavior`; fixed field list | DIFFERS | [O11] [H27] [H34] |
| D3 | `document_expired_detection` | The document's expiry date has passed | Used for "issued within N days" | DIFFERS (meaning) | [H33] [O11] |
| D4 | Recency check | Issue-date window, default 90 days, 365 recommended for KYB documents; id not public | Folded into D3 | MISSING (needs an id of ours) | [H32] |
| D5 | `document_fabrication_detection` | Category `fraud` | H, PDF forensics + ELA in one check | OK (id), see D6 | [O11] |
| D6 | Separate document fraud checks | PDF editor metadata; inserted/altered fonts; image timestamp inconsistency; suspicious image metadata; JPEG-original check (N/A for PDFs); compromised-document comparison; enhanced async fraud risk (High/Medium); QR-code check. Ids not public | All inside D5 | MISSING (ids ours) | [H26] [H27] [H31] [H38] [H39] |
| D7 | `document_name_comparison`, `document_address_comparison` | No such checks; comparison is an extraction mode against inquiry fields, loose or strict, with a per-result `match-level` | Two R checks | OURS | [H34] [O10] |
| D8 | Document groups and classifications | Per-group accepted/rejected types, Persona types or custom types described to an LLM | None | MISSING | [H27] [H28] [H29] [H30] |
| D9 | Extractions | Library extractions, custom AI extractions (text or JSON-schema structured), inquiry comparison, optional vision mode, save to document field, QR-linked-website source | Fixed name/address/date/issuer | MISSING (partly out of scope) | [H34] [H39] |
| D10 | Insights | LLM summaries per group (e.g. entity type, number of owners) | None | MISSING (optional) | [H26] [H27] |
| D11 | Limits and collection-only | PDF, JPEG, PNG, HEIC/HEIF, TIFF; 32 MB per file; 20 pages per request; a collection-only mode with up to 250 pages and 200 MB, no processing | None | MISSING | [H26] [H35] [H36] |
| D12 | Document resource | `document/generic` (`doc_`), `kind`, `document-type`, `files`, `files-normalized`, `extraction-responses`, `fields`; statuses `initiated`, `submitted`, `processed`, `errored` | None | MISSING | [O8] [O9] [O10] [D8] |
| D13 | Verification attributes | `fields`, `files`, `files-normalized`, `extraction-responses`, `document-type`, `document` relationship | None | MISSING | [O7] [C2] [C5] |
| D14 | Flow | Capture or upload screen; result within seconds; re-prompt on wrong type, too old, expired or missing field; a multi-document home screen | None | MISSING | [H26] [H37] [H40] |

### Database (authoritative, standard, AAMVA)

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| B1 | `database_name_comparison`, `database_address_comparison`, `database_birthdate_comparison` | Category `fraud`, required in the example | R+A | OK | [O16] |
| B2 | `database_identity_comparison` | Fraud; does the identity match a record; per-field match requirements and match groups | None | MISSING | [D11] [H43] [H44] |
| B3 | `database_inquiry_comparison` | Fraud; earlier claimed attributes vs those submitted to the database | None | MISSING | [D11] [H55] |
| B4 | `database_address_deliverable_detection`, `database_address_residential_detection`, `database_po_box_detection` | User action required | None | MISSING | [D11] |
| B5 | `database_attribute_comparison` | Exposes `comparison_input_results` metadata | None | MISSING | [C10] |
| B6 | Deceased / alive, identification-number comparison | Display names only (international results, TIN, eCBSV) | None | MISSING (ids ours) | [H49] [H62] [H78] |
| B7 | Match requirement shape | Normalization + comparison method ids, partial thresholds, any-of per field, match groups; full / partial / none / missing results; non-US fields set to full / partial / none | Jaro-Winkler + nickname table + libpostal-style normalisation | DIFFERS (expose the same config shape) | [H46] [H47] [H48] [H49] [H55] |
| B8 | Inputs and attributes | At least two attributes, full name required; `normalized-address-*`, `identification-number`, `document-number`, `document-issuing-date`, `document-expiry-date`, `document-issuing-subdivision`, phone, email | None | MISSING | [H43] [O13] [C6] [C14] |
| B9 | Lifecycle | `initiated` (stays there if API omits required fields), `submitted`, `passed`, `failed`, `canceled` (no result); module has no retry path; a toggle lets a tentative match count as passing | None | MISSING | [H51] [H52] [H53] |
| B10 | `database-standard` (non-authoritative) type | Name, address; checks not public | None | MISSING (adapter) | [O14] [D12] [C1] |
| B11 | AAMVA as its own type | `verification/aamva`; `aamva_name_comparison` (metadata `name-first-match`, `name-last-match`), `aamva_identification_number_comparison`, an identity comparison with per-field risk level, attribute checks for birthdate / issue date / expiry / postal code, an external-service-error check | `aamva_*` under `database`; `id_aamva_database_lookup` on gov ID | DIFFERS (type) + MISSING (identity, attributes) | [O15] [C9] [D13] [H59] |
| B12 | AAMVA lifecycle | `skipped` for non-participating jurisdictions; `canceled` on service outage, retried by workflow (3 times in the shipped solution) | None | MISSING | [D2] [H61] |
| B13 | Other issuing sources | eCBSV, TIN, Serpro, UK DVLA, Aadhaar | None | MISSING (adapters, out of Phase 5 core) | [O1] [D23] [D21] [D24] |
| B14 | Sandbox forcing | Transaction field `debug` = `passed` / `failed` in sandbox | None | MISSING | [D18] [D17] |

### Government ID NFC

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| N1 | `id_nfc_expired_detection` | Reason `expired` | Logic shipped in Phase 3 | OK | [O17] |
| N2 | Chip signature validation | Described as PKI validation, required for IAL2's SUPERIOR pathway; id not public | `id_nfc_passive_authentication_detection` | OURS (id) with a described counterpart | [M2] [H17] [H18] |
| N3 | Active / chip authentication | Not described | `id_nfc_chip_authentication_detection` | OURS | — |
| N4 | DG1 vs printed MRZ | Not described | `id_nfc_mrz_comparison` | OURS | — |
| N5 | Chip portrait vs selfie | The selfie match component lists NFC-portrait support; NFC verification exposes `selfie-photo-url`; no NFC-specific comparison check is named | `id_nfc_selfie_comparison` | OURS (id) | [D25] [C7] [O17] |
| N6 | Resource attributes | `birthdate`, `expiration-date`, `id-class`, `identification-number`, `name-first`, `name-last`, `sex`, address fields, `selfie-photo`, `selfie-photo-url`, `document` relationship | None | MISSING | [O17] |
| N7 | Flow | NFC capability detected; photo of the data page first, extracted fields shown for confirmation; chip unlocked automatically from those fields; read and review; fallback to photo or device handoff | Android module planned | MISSING | [M2] [M3] [H64] [H68] |
| N8 | Channels and documents | Mobile SDK only; ICAO passports, some EU ID cards and residence permits; not the US passport card; 120+ countries | Android only | OK (scope) | [H63] [H65] [M2] |

### Business (KYB)

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| K1 | Registry type | `verification/database-business` | type `business` | DIFFERS (name) | [O18] [O19] |
| K2 | `database_business_service_available_detection`, `database_business_enabled_country_detection` | Category `user_action_required` | `fraud` | DIFFERS (type) | [O19] |
| K3 | `database_business_active_business_detection`, `_identity_comparison`, `_associated_persons_comparison` | Category `fraud`; identity failure reason `low_confidence_match` | R+A `fraud` | OK (+ reason) | [O19] |
| K4 | `database_business_ai_identity_comparison` | Deprecated, folded into identity comparison | None | OK (do not add; or `sunset`) | [C11] |
| K5 | Registry matching | Country-specific default match groups; claimed / extracted / normalized values per requirement; registration number not used for US; ~130 countries | GLEIF, Companies House, EDGAR | DIFFERS (scope) | [H69] [H72] [C8] |
| K6 | Create / submit API | Public create (name, country, template id required) and submit (only `initiated`); `meta` keys `debug-forced-status`, `processing-mode` | None | MISSING | [D15] [D16] |
| K7 | Website type | `verification/business-website`; 13 checks, 3 ids public; LLM provider choice; `extracted-identity`; backlink metadata; malicious signals in `reasons` | 3 checks under `business` | DIFFERS (type) + MISSING (10 checks) | [H74] [H76] [O20] [O21] [C12] |
| K8 | Footprint, TIN, VAT, brand asset | Separate types; TIN statuses and IRS-outage retries; VAT via VIES/UK with daily downtime | None | MISSING (adapters) | [H73] [H77] [H78] [H79] [H81] |
| K9 | Associated persons | Check semantics not described; KYB-by-API sends owners either to a silent database check or to an emailed inquiry | Officers/PSC comparison | OURS (semantics) | [D17] [H70] |

### Crypto wallet

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| W1 | `crypto_wallet_validity_detection` | Category `fraud` | `user_behavior` | DIFFERS (type) | [O26] |
| W2 | `crypto_wallet_address_comparison` | Address recovered from the signed message vs optional `expected-address`; N/A `no_expected_address` | "ownership through a signed challenge" | DIFFERS (meaning) | [O25] [O26] |
| W3 | `crypto_wallet_statement_comparison` | N/A `no_expected_statement` without an expected statement | Statement vs challenge text | OK (+ N/A reason) | [O26] |
| W4 | `crypto_wallet_disallowed_chain_detection` | N/A `no_allowlist` without an allowlist | Chain allowlist | OK (+ N/A reason) | [O26] |
| W5 | Attributes | `wallet-address`, `chain-id` (CAIP-2, e.g. `eip155:1`), `expected-address` | None | MISSING | [O25] |
| W6 | Flow, signing standard, events | Not described | Signed challenge (EIP-191, BIP-137/322) | N/D | — |

### mDL, verifiable credentials, digital ID (stretch)

| ID | Topic | Persona (public) | OpenVerify today | Verdict | Sources |
|---|---|---|---|---|---|
| M1 | `verification/mdoc` + `document/mdoc` | Holder, address, issuer, expiry, age, `meets-minimum-age`, `validated-issuer-key`, portrait; ISO 18013-7 remote presentation; works on mobile and desktop web | Stretch goal | MISSING (stretch) | [O27] [O28] [M5] |
| M2 | `verification/verifiable-credential` | Selected credential issuer, types, issuance and expiry dates; Entra Verified ID verifier with an issuer-allowlist check and required claims | Stretch goal | MISSING (stretch) | [O29] [H82] |
| M3 | Digital ID schemes | 17 `digital-id-*` types; several return no portrait, which makes a later selfie comparison N/A | None | Out of scope | [O30] [H83] |

### Surface-index gaps (persona-surface.md)

`docs/research/persona-surface.md` was built from OpenAPI example payloads only. It lacks these public
identifiers: `aamva_name_comparison` [C9], `database_attribute_comparison` [C10],
`database_identity_comparison`, `database_inquiry_comparison`,
`database_address_deliverable_detection`, `database_address_residential_detection`,
`database_po_box_detection` [D11], and the sunset `database_business_ai_identity_comparison` [C11].
It also lacks the `document/*` resource subtypes (`document/generic`, `document/government-id-nfc`,
`document/mdoc`) [O28].

---

## 0. Sources and pins

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, commit
**`805512b348af1c5d345bea8d7db7eb43d1821872`** (the same pin as the Phase 4 notes), directory
`2026-09-29/`. We read a local clone at the earlier commit `02f9d68` and byte-compared every OpenAPI
file cited here (37 schemas, examples, path and webhook files) against `805512b`: all identical. The
two commits differ only in report, connect-token and two unrelated verification schemas.

**Developer docs (D, C).** `docs.withpersona.com`, version 2026-09-29, read as Markdown (`.md` suffix).

**Help Center (H).** `help.withpersona.com/articles/<id>/`, read as Markdown (`<id>.md`), plus the
full dump `help.withpersona.com/llms-full.txt` for searches.

**Marketing site and blog (M).** `withpersona.com` returned HTTP 403 to direct fetches; the same pages
are served from `marketing.withpersona.com`, which we read instead. M6 could not be retrieved at all
and is cited only for what a search-engine summary of it reported.

| Key | What |
|---|---|
| O1 | Shared verification attributes: status list (incl. `confirmed`, `tentatively_*` scope), check object |
| O2–O5 | Phone and email verification schemas and examples |
| O6 | Phone silent network authentication schema |
| O7 | Document verification schema |
| O8–O10 | Generic document, document shared attributes, extraction responses |
| O11 | `verification.tentatively-passed` webhook example (document) |
| O13–O16 | Database, database standard, AAMVA schemas; `verification.passed` example (database) |
| O17 | Government ID NFC verification schema |
| O18–O19 | Database business schema; `verification.tentatively-failed` example |
| O20–O24 | Business website (schema, example), footprint, TIN, VAT schemas |
| O25–O26 | Crypto wallet schema and example |
| O27–O31 | mdoc, document union, verifiable credential, generic digital ID, My Number NFC |
| O32–O36 | Phone retrieve path, phone carrier, Connect source data (phone), document webhooks, brand asset |
| D1–D25 | Docs pages (verification types, lifecycle, checks, per-type API pages, guides, SDKs) |
| C1–C14 | API changelog entries |
| H1–H89 | Help Center articles |
| M1–M7 | Product pages and blog posts |

[O1]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-shared-attributes.yaml
[O2]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-phone-number.yaml
[O3]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-email-address.yaml
[O4]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-phone-number.yaml
[O5]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-email-address.yaml
[O6]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-phone-number-silent-network-authentication.yaml
[O7]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-document.yaml
[O8]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/document-generic.yaml
[O9]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/document-shared-attributes.yaml
[O10]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/extraction-responses.yaml
[O11]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-tentatively-passed-webhook-body.yaml
[O13]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database.yaml
[O14]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-standard.yaml
[O15]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-aamva.yaml
[O16]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-passed-webhook-body.yaml
[O17]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-government-id-nfc.yaml
[O18]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-business.yaml
[O19]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-tentatively-failed-webhook-body.yaml
[O20]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-business-website.yaml
[O21]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-business-website.yaml
[O22]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-business-footprint.yaml
[O23]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-tin.yaml
[O24]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-vat-number.yaml
[O25]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-crypto-wallet.yaml
[O26]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/examples/verification-crypto-wallet.yaml
[O27]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-mdoc.yaml
[O28]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/document.yaml
[O29]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-verifiable-credential.yaml
[O30]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-digital-id-generic.yaml
[O31]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-jp-my-number-nfc-scan.yaml
[O32]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/paths/verification_phone-numbers_%7Bverification-id%7D.yaml
[O33]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-database-phone-carrier.yaml
[O34]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/source-data-verification-phone-number.yaml
[O35]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/webhooks/document.extracted.yaml
[O36]: https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/components/schemas/verification-brand-asset.yaml
[D1]: https://docs.withpersona.com/2026-09-29/verification-types.md
[D2]: https://docs.withpersona.com/2026-09-29/verification-lifecycle.md
[D3]: https://docs.withpersona.com/2026-09-29/verification-checks.md
[D4]: https://docs.withpersona.com/2026-09-29/api-reference/verifications.md
[D5]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/phone-number-verifications.md
[D6]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/email-address-verifications.md
[D7]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/document-verifications.md
[D8]: https://docs.withpersona.com/2026-09-29/api-reference/documents.md
[D9]: https://docs.withpersona.com/2026-09-29/events.md
[D10]: https://docs.withpersona.com/2026-09-29/integration-testing.md
[D11]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/database-verifications.md
[D12]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/database-standard-verifications.md
[D13]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/aamva-verifications.md
[D14]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/government-id-nfc-verifications.md
[D15]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/database-business-verifications/create-a-database-business-verification.md
[D16]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/database-business-verifications/submit-a-database-business-verification.md
[D17]: https://docs.withpersona.com/2026-09-29/integration-guide-kyb-via-api.md
[D18]: https://docs.withpersona.com/2026-09-29/integration-guide-database-verification-via-api.md
[D19]: https://docs.withpersona.com/2026-09-29/ios-sdk-v2-integration-guide.md
[D20]: https://docs.withpersona.com/2026-09-29/android-sdk-v2-integration-guide.md
[D21]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/tin-database-verifications.md
[D22]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/phone-carrier-database-verifications.md
[D23]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/ecbsv-database-verifications.md
[D24]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/serpro-database-verifications.md
[D25]: https://docs.withpersona.com/2026-09-29/api-reference/verifications/selfie-verifications.md
[C1]: https://docs.withpersona.com/2026-09-29/updates/changelog/2023/10/2.md
[C2]: https://docs.withpersona.com/2026-09-29/updates/changelog/2023/4/24.md
[C3]: https://docs.withpersona.com/2026-09-29/updates/changelog/2023/5/1.md
[C4]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/4/8.md
[C5]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/5/14.md
[C6]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/7/23.md
[C7]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/7/30.md
[C8]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/8/13.md
[C9]: https://docs.withpersona.com/2026-09-29/updates/changelog/2024/9/9.md
[C10]: https://docs.withpersona.com/2026-09-29/updates/changelog/2025/1/13.md
[C11]: https://docs.withpersona.com/2026-09-29/updates/changelog/2025/10/27.md
[C12]: https://docs.withpersona.com/2026-09-29/updates/changelog/2026/7/15.md
[C13]: https://docs.withpersona.com/2026-09-29/updates/changelog/2026/8/18.md
[C14]: https://docs.withpersona.com/2026-09-29/updates/changelog/2023/6/5.md
[H1]: https://help.withpersona.com/articles/5tWkS5L9FJclUINe6kZtz7/
[H2]: https://help.withpersona.com/articles/6rHAtqoCS0m8hKgzZcOXnP/
[H3]: https://help.withpersona.com/articles/3H1WgY3MudxrGPuWXNKUrr/
[H4]: https://help.withpersona.com/articles/b7QGmmyYmPjDHviBomQG7U/
[H5]: https://help.withpersona.com/articles/1JmZDYUOfVJLQjBmusWkbz/
[H6]: https://help.withpersona.com/articles/2UKFOwtn5lbP1re9nR0drr/
[H7]: https://help.withpersona.com/articles/4XDEOs7SsAvMw8v6fhIGxY/
[H8]: https://help.withpersona.com/articles/39ezMPrbnuFwZStP3NW7Ji/
[H9]: https://help.withpersona.com/articles/4PeqJ4Ghghk3s1xp15be7H/
[H10]: https://help.withpersona.com/articles/5UYSMJCixxdgud9jHzpN4r/
[H11]: https://help.withpersona.com/articles/2FauPy2tquCwnyeMjtpVly/
[H12]: https://help.withpersona.com/articles/5r7pN8HqOhpwlO0YTfFAse/
[H13]: https://help.withpersona.com/articles/3mzQOBIo04bdvYLxtnaf4y/
[H14]: https://help.withpersona.com/articles/WA5Fwa8YGGj06MkiHZKSnf/
[H15]: https://help.withpersona.com/articles/223MwaLShJRrbC5n5X8RQz/
[H16]: https://help.withpersona.com/articles/QC1OAt4zLihlELoVNJ5jmK/
[H17]: https://help.withpersona.com/articles/0jfM3U58A4LXRbPumx7FZb/
[H18]: https://help.withpersona.com/articles/FQRg0lhm5WyVqQ1tMLl5zU/
[H19]: https://help.withpersona.com/articles/4Bc5EGnIOwAiXZaijGISsx/
[H20]: https://help.withpersona.com/articles/ARLLoIOGw9P5nGlnC53uc/
[H21]: https://help.withpersona.com/articles/4IqHs9oWE6ihGakWUzYCcL/
[H22]: https://help.withpersona.com/articles/6MsSJ5GQjHhtIN0xxLLeby/
[H23]: https://help.withpersona.com/articles/7nbNgynP75u1YE4pLcV75L/
[H24]: https://help.withpersona.com/articles/4RXisEYAloVh6YV7HY3WO/
[H25]: https://help.withpersona.com/articles/eTURFSRPYmBE2eVzVgel7O/
[H26]: https://help.withpersona.com/articles/2ipL09vsPcus5OXuOXdeO9/
[H27]: https://help.withpersona.com/articles/0LPHPwIBZKQI8G7t24zKd/
[H28]: https://help.withpersona.com/articles/2tUC2D9VeLsyPtgBo5KYzX/
[H29]: https://help.withpersona.com/articles/CwVf9zu898TDfypOGCV4KU/
[H30]: https://help.withpersona.com/articles/4yXLA2Hk27xfNbyrMazcfW/
[H31]: https://help.withpersona.com/articles/7kp3paBWvswp335uTepePl/
[H32]: https://help.withpersona.com/articles/33Fwf26bO4YWhp0k0RJaoP/
[H33]: https://help.withpersona.com/articles/2iV2kP8Nl0duaXEZVvKiCq/
[H34]: https://help.withpersona.com/articles/7tNoY1RqC6YvEGEV1VhSZn/
[H35]: https://help.withpersona.com/articles/v3Kx7qR2mN9pW4tY8bH6jD/
[H36]: https://help.withpersona.com/articles/019opfDAiQAa5wNSQjb42P/
[H37]: https://help.withpersona.com/articles/GB3qI5b3fH7IHulsQUhVHK/
[H38]: https://help.withpersona.com/articles/77WsxmlXGQNgCfvn3B4cgr/
[H39]: https://help.withpersona.com/articles/ULKkooZJOfaKUQ2ARRruY/
[H40]: https://help.withpersona.com/articles/2GRYaWRkfwtqzqFRR1xr6/
[H41]: https://help.withpersona.com/articles/4kI3foEAJzsziQjRbK08Jw/
[H42]: https://help.withpersona.com/articles/5og9iSBjuzRbdpjHPwMUBH/
[H43]: https://help.withpersona.com/articles/7dcdaIsMttmPUZ2ZelRbZD/
[H44]: https://help.withpersona.com/articles/7x6bbb4azsh7XDTZoNk2xc/
[H45]: https://help.withpersona.com/articles/NfkigSW02zMQMUNMDT8j3r/
[H46]: https://help.withpersona.com/articles/MHeAHz7GKAUsDsDtJQzjSM/
[H47]: https://help.withpersona.com/articles/xeEDU6HFZaFR3sjrJp25F3/
[H48]: https://help.withpersona.com/articles/6BFKQvaUZOtRSsXUJp2xu9/
[H49]: https://help.withpersona.com/articles/7pCo7xatfZfIdljub260dm/
[H50]: https://help.withpersona.com/articles/1RCzLCq4tUjDUjkb2Pwrve/
[H51]: https://help.withpersona.com/articles/6VLy1pgzsurhTXEybhn2S0/
[H52]: https://help.withpersona.com/articles/382VuPIqELyr8osOxwkY3S/
[H53]: https://help.withpersona.com/articles/5a9rNXrNdKHAl4E5QWzrcQ/
[H54]: https://help.withpersona.com/articles/0LijZobUYOKNlMbQTfFhAY/
[H55]: https://help.withpersona.com/articles/2zXa85BILxtncnwdIj8jge/
[H56]: https://help.withpersona.com/articles/6q6M0oFMrqslfk6DuIyqNY/
[H57]: https://help.withpersona.com/articles/1HSUi4TdsbMzfsLullRHn5/
[H58]: https://help.withpersona.com/articles/1wiQ7wAhmnKh6mesCGopKl/
[H59]: https://help.withpersona.com/articles/2SLguSV9wCFn8Fi7m7eoPJ/
[H60]: https://help.withpersona.com/articles/1owid8I0gP7ZpGTMudVthf/
[H61]: https://help.withpersona.com/articles/76IuZmA7MC9tdemWcSb49M/
[H62]: https://help.withpersona.com/articles/20fre6ee6PAhw20p8HbJQy/
[H63]: https://help.withpersona.com/articles/1iu1Fak8y9RiOE2FddXrHJ/
[H64]: https://help.withpersona.com/articles/C6sdm6k7AnVBOmvlRP9ic/
[H65]: https://help.withpersona.com/articles/3mJXAtGCJwiwnxQ0flWs2u/
[H66]: https://help.withpersona.com/articles/M2erUVCYs6SheNHChzQtxG/
[H67]: https://help.withpersona.com/articles/Gu5sJF5D7WJE7uFWAGUXaE/
[H68]: https://help.withpersona.com/articles/SmmuLIhpRRpGKyiQBfJllA/
[H69]: https://help.withpersona.com/articles/3pkLBWKg5wIQJru7PATxBc/
[H70]: https://help.withpersona.com/articles/57OimGKJHgYJjPul24AQec/
[H71]: https://help.withpersona.com/articles/6Np8Pewsq9M1fGm6rREodJ/
[H72]: https://help.withpersona.com/articles/ivfWDBvfCJ530bWa8785dh/
[H73]: https://help.withpersona.com/articles/1y9RqYAemIZn2jFK1HlEgS/
[H74]: https://help.withpersona.com/articles/6YMwMNVZpOYO4n6bpUhokY/
[H75]: https://help.withpersona.com/articles/5EEk0Q3RxWAc5QyVmhJD72/
[H76]: https://help.withpersona.com/articles/p5KNU3JclqyJU5XxEra5uE/
[H77]: https://help.withpersona.com/articles/2lGG2fqJwUO9ziVAFZNeTG/
[H78]: https://help.withpersona.com/articles/5tzJu8YIFOIUsZ0tf6D9R2/
[H79]: https://help.withpersona.com/articles/7zCCnX7CTtGHo5PdXFgzO3/
[H80]: https://help.withpersona.com/articles/3OGe9IwySJmDvXL2DOfV7N/
[H81]: https://help.withpersona.com/articles/2idIkprjWl5OBRAb5iOvZ6/
[H82]: https://help.withpersona.com/articles/2sjBNj9gDT6ea7kShXVb5q/
[H83]: https://help.withpersona.com/articles/6nDg4pW8yK2sR9cV5tH1mQ/
[H84]: https://help.withpersona.com/articles/6n23LISjc8xg0dvSm8awNY/
[H85]: https://help.withpersona.com/articles/562IPh6XJ91ekE3kAEOrLj/
[H86]: https://help.withpersona.com/articles/3wK7xYJEsovSTTaZTAjXuU/
[H87]: https://help.withpersona.com/articles/l5oQUmnEtq4VZNAdyHfQZc/
[H88]: https://help.withpersona.com/articles/5pWQQ9DhF7llJefCDXhlxO/
[H89]: https://help.withpersona.com/articles/60rBv6Kqpek5SS38plb0Om/
[M1]: https://marketing.withpersona.com/product/verifications/phone-email-ownership
[M2]: https://marketing.withpersona.com/product/verifications/nfc
[M3]: https://marketing.withpersona.com/blog/nfc-e-passport-verification-guide
[M4]: https://marketing.withpersona.com/product/verifications/digital-id
[M5]: https://marketing.withpersona.com/blog/persona-is-one-of-the-first-verification-vendors-to-accept-californias-mobile-drivers-license
[M6]: https://withpersona.com/blog/new-at-persona-mobile-drivers-license-mdl-verification-via-apple-wallet
[M7]: https://marketing.withpersona.com/product/verifications/document-ai

**Not publicly reachable.** The per-check reference table and its fail reasons
(`app.withpersona.com/dashboard/resources/verification-checks`) and the coverage maps
(`.../resources/coverage-map/...`) need a dashboard login [D3] [D11] [H3]. Three Help Center articles
linked from public pages return 404 to anonymous readers: database results outputs
(`7Lh9MkK1DUczNlAe4EB6oW`), match groups (`1gZBzL78LmIZblpOSJNpW6`) and business matching frameworks
(`5XZjwO60QVMt9b0CPMFQn7`).

---

## 1. Shared model (applies to every type below)

### 1.1 Statuses

The shared status list [O1] [D2]:

| Status | Scope | Meaning (our words) |
|---|---|---|
| `initiated` | all | Created from a verification template; inputs can still be attached |
| `confirmed` | phone, email only | The user entered a code and it was accepted |
| `submitted` | all | Inputs frozen; processing runs |
| `tentatively_passed` | document (and a QES type) only | Provisional pass; final result still to come (**inference**: likely while an asynchronous check such as the enhanced document fraud check is outstanding [H38]) |
| `tentatively_failed` | business registry, business footprint only | Provisional failure; in the public example a required identity comparison failed with `low_confidence_match` while `completed-at` is still null [O19] |
| `passed` / `failed` | all | Every required check passed / at least one required check failed |
| `requires_retry` | all, deprecated | Kept for old integrations; Persona advises branching on pass/fail or attempt counts |
| `canceled` | all | Did not complete, usually an internal or upstream-service error |
| `skipped` | where configured | A check set to skip on failure failed; the documented example is an AAMVA run for a jurisdiction that is not covered |

The public list is open-ended: integrators are told new values may appear without a version bump [O1].
How `confirmed` sequences with `submitted` for phone and email is **not documented**; the natural
reading is initiated → confirmed → submitted → passed/failed **(inference)**.

### 1.2 Checks

Same object as in the Phase 4 notes: `name`, `status` (`passed`, `failed`, `not_applicable`, plus
`pending` for asynchronous checks [D3]), `category` (`biometrics`, `fraud`, `user_action_required`,
`validity`, or null), `reasons`, `requirement` (`required`, `not_required`, `requires_retry`) and free
`metadata` [O1]. Two points new for Phase 5:

- Some checks carry their real result in `reasons` rather than `metadata`; the website malicious-site
  check is the documented example (`malware`, `phishing`, `spam-source`) [O1] [C12].
- The dashboard shows only two "types" (fraud, user behaviour), but the API category has four values;
  documents use `validity` [O11] [H31].

### 1.3 Templates, attempts and creation

- Each check is enabled or not and required or not; required checks decide the status; some checks
  expand to sub-options [D3] [H44].
- Verifications are created by an inquiry step (recommended), by a workflow step, or directly by API
  (Enterprise only, discouraged) [H86]. The workflow step can be told to continue when the verification
  is only tentatively complete, and in sandbox can override the outcome [H42].
- Each verification is one attempt; the flow's pass/retry/fail branch decides how many attempts the
  inquiry allows (phone and email modules default to 5) [H5] [H15].
- A verification has no expiry attribute of its own (**not documented**). The inquiry link, the
  session and a device-handoff code each expire separately; links commonly last about a day and
  handoff codes about an hour, all configurable [H87].
- Any verification can be investigation-locked to block redaction (409 while locked) [C13].

### 1.4 Events

- Generic verification events (all types): `verification.created`, `.submitted`, `.passed`,
  `.failed`, `.requires-retry`, `.canceled`, `.skipped`, `.escalated`, `.updated-tags`, plus
  `.tentatively-passed` and `.tentatively-failed` for the types in 1.1 [D9].
- Document events: `document.created`, `.submitted`, `.pending`, `.processed`, `.errored`,
  `.extracted`; the last fires only for government ID documents processed without verification [D9]
  [O35].
- No phone-, email-, NFC-, wallet- or business-specific events exist [D9].
- Sandbox simulation (create passed or failed verification) is supported for government ID, document,
  database and selfie. A document emits `document.created`, `.submitted`, `.processed`, then the
  generic `verification.created`, `.submitted`, `.passed`/`.failed`; a database verification emits only
  the generic ones [D10] [C4].

### 1.5 Dashboard surfaces common to Phase 5 types

- Per-type result view: overall status header, the submitted inputs, a check table with status, type
  and required columns and hover definitions, expandable rows with metadata [H2] [H12] [H31] [H88].
- Attribute-based checks (identity comparisons) are shown inline and expanded by default; with several
  allowed match groups the reviewer can switch between group results [H88] [H43].
- The authoritative per-check list and coverage maps live behind the login (section 0).

---

## 2. Phone number (`verification/phone-number`)

### 2.1 Resource

| Attribute | What it holds | Source |
|---|---|---|
| shared attributes | status, timestamps, `country-code`, `tags`, `checks` | [O1] |
| `phone-number` | E.164 string in the example | [O2] [O4] |
| `confirmation-code` | the code; the example shows a 5-character value | [O2] [O4] |
| `metadata` | one integer risk score from Persona's phone-data vendor | [O2] |

Only a retrieve endpoint exists in the OpenAPI [O32]. Connect can share a PII-filtered snapshot of the
verification [O34]. Product version 2.0.4 [D5].

**OpenVerify note:** never return the code; a hashed code belongs in storage only.

### 2.2 Checks

**Not documented.** The docs and Help Center send readers to the dashboard table [D5] [H3]. The public
example result shows two required checks, both passed [H2]. The verification-types page says the number
is also checked against public and private databases, beyond the code [D1], which suggests at least one
number-validity or risk check **(inference)**.

### 2.3 Configuration

- Which checks are required [H3] [H4].
- Maximum code attempts: default 5; more helps typos, fewer shrinks the guessing window [H3] [H4].
- In the flow: retry count on the branch, screen copy [H5]; default country of the phone field
  (US unless the `selected_country_code` field default is changed) [H8]; locking the country code is
  possible but set by Persona support [H6].
- **Not documented:** code length, code lifetime, resend limits or cooldown, per-number or per-IP rate
  limits.

### 2.4 Flow the end user sees

From the module [H5] [H7]:

1. Number entry screen with a country selector and separate country-code field; validation that the
   number is complete.
2. Code entry screen with a resend action.
3. The verification step; a pass/retry/fail branch allowing 5 attempts by default.
4. If the SMS cannot be delivered, a dedicated branch sends the user back to number entry.

The SMS text names the customer's configured external display name (or the organisation name)
[H10]. The verification writes the number to the inquiry's `phone_number` field, overwriting any
prefilled value [H5]. The channel is SMS in the Help Center [H1]; the product page and a shipped
solution also offer a voice call [M1] [H9].

### 2.5 Abuse guidance (SMS traffic pumping)

Persona advises creating inquiries per user rather than sharing an open link, fixing the country code,
and auto-declining by number region, IP or network region in a workflow [H6].

### 2.6 Related phone products (not the OTP verification)

- **Silent network authentication**: its own type with `phone-number` only; mobile SDKs need an extra
  adapter package [O6] [D19] [D20]. Behaviour, checks and fallbacks are **not documented**.
- **Phone carrier verification** (`verification/database-phone-carrier`): number plus optional first
  name, last name, birthdate, address checked against carrier records; per-field full / partial / none
  / missing, a 0–100 risk score, and N/A for countries without carrier data [H23] [H24] [H25] [O33]
  [D22].
- **Phone risk report**: line type, carrier, risk score and an allow/flag/block recommendation; a report,
  not a verification [H22].

### 2.7 Sandbox

Preview runs no real verification and offers a pass/fail toggle per step [H19]; with the pass toggle on,
any code is accepted [H20]. The simulate-actions API does not list phone [D10].

---

## 3. Email address (`verification/email-address`)

### 3.1 Resource

`email-address` (nullable) and `confirmation-code` on top of the shared attributes [O3] [O5]. No
metadata block is defined.

### 3.2 Checks

**Not documented** [D6] [H13]; the public example shows two required checks [H12].

### 3.3 Configuration

Same two settings as phone: required checks and maximum code attempts, default 5 [H13] [H14].

### 3.4 Flow

1. Email entry screen; 2. code entry screen; 3. verification step; 4. pass/retry/fail branch, 5 attempts
   by default [H15].
   - A resend action is listed for phone [H5] but not for email (**not documented**).
   - The module writes `email_address`, overwriting prefill [H15].
   - The email's subject, preview text and instructions carry the external display name.
   - With Persona's default sender, the from-name shows Persona acting for the customer [H10].
- An email **link** (click-to-verify) is **not documented** anywhere; only a code is described.
- IAL2 templates send the enrolment code by email first, phone optional [H16] [H17].
- Persona suggests pairing email verification with the business website verification to tie a person
  to a business domain [H74].

### 3.5 Related

Disposable-domain, deliverability, spam-trap and domain-age signals belong to the email risk report,
a report rather than a verification [H21]. Sandbox behaves as for phone [H19] [H20].

---

## 4. Document / proof of address (`verification/document`)

### 4.1 Two objects

1. **The verification** (`verification/document`, `ver_`) with `fields`, `files`, `files-normalized`,
   `extraction-responses`, `document-type`, and a `document` relationship to a generic document [O7]
   [C2] [C5].
2. **The document** (`document/generic`, `doc_`) with `kind`, `document-type` (`other` when not
   classified), `files`, `files-normalized`, `extraction-responses`, `fields`, and statuses `initiated`,
   `submitted`, `processed`, `errored`; `processed-at` set when processing ends [O8] [O9] [D8].
   - The document union also includes `document/government-id`, `document/government-id-nfc` and
     `document/mdoc` [O28].

`document-type` example values: `bank_statement`, `standard_utility_bill`, `credit_card_statement`,
`proof_of_residence`, `other` [O8] [C5]. The type list is long (20+ added in 2023) and not published
[C3].

`extraction-responses` entries [O10]:
- `extraction-type` (`guided` or `unguided`) and `field-name`;
- `structured-results` (nested, with bounding boxes removed);
- `results[]`, each with `value`, 1-based `page`, `match-level` (`none`, `partial`, `full`; always full
  when unguided) and free `metadata`.

### 4.2 Lifecycle

- Shared verification statuses plus `tentatively_passed` [O1]. The public tentatively-passed example
  has all four document checks passed and required [O11].
- The enhanced fraud check runs asynchronously by default, and Persona tells integrators to wait for
  the final result before automating on it [H38].
- Document events and sandbox simulation: see 1.4.

### 4.3 Configuration model: document groups

- A template holds one catch-all group plus any number of named groups [H27] [H28].
  - The catch-all group accepts any type, cannot be deleted, and cannot list classifications.
  - Each named group lists document types, each marked accepted or rejected, and has its own
    extractions, checks and insights.
- The submitted file is classified to its most likely type, and the group listing that type is
  applied; otherwise the catch-all applies. A type should appear in one group only, or the choice is
  unpredictable [H29] [H30].
- Types are either Persona-managed types or custom types: a label plus a short description, given to
  an LLM as classification context [H29] [H30].
- **Type detection** [H28] [H30]:
  - always required;
  - fails when the classified type is rejected, or not accepted in the applied group;
  - a template with only the catch-all group classifies everything as other and never fails it.
- The dashboard nudges proof-of-address templates towards the expected types and extractions:
  - classifications: utility bills and bank statements;
  - extractions: name and address, marked required [H27].

### 4.4 Extractions

- Sources [H34]:
  - Persona-managed library extractions, either type-specific or type-agnostic, whose prompts Persona
    keeps improving;
  - custom extractions with a label, an auto-generated key and a required flag.
- Custom extraction methods [H34]:
  - AI extraction, with text output or structured output described by a JSON schema;
  - inquiry comparison against chosen inquiry fields (composite name/address or single fields), with a
    loose (AI-based) or strict match requirement.
- Options [H34]:
  - save to a document field;
  - vision mode, which sends the image to the model instead of OCR text. It costs about 2–5 s at the
    median and is an enhanced SKU.
- A required extraction that is not found fails the document. This is what the extracted-properties
  check reflects [H27] [H34].
- QR-linked extraction [H39]:
  - The first two pages are scanned for a QR code. Its URL is followed only if it is on a
    government-domain allowlist.
  - The page text is parsed and the extractions run against it.
  - A per-extraction source setting: document only (default), QR website with fallback to the
    document, or QR website only.
  - The first supported type is a Mexican tax certificate.

### 4.5 Checks

| Check | Public id | What it decides (our words) | Category / type | Config | Sources |
|---|---|---|---|---|---|
| Type detection | `document_type_detection` | Classified type accepted by the applied group | `validity`; always required | via classifications | [O11] [H28] [H30] |
| Required properties | `document_extracted_properties_detection` | Every required extraction found | `validity` | via required extractions | [O11] [H27] |
| Expiry | `document_expired_detection` | The document's own expiry date has passed (e.g. an ID or insurance card) | `validity` | enable / require | [O11] [H33] |
| Recency | **not public** | Document dated within a window | not public | days, default 90; 365 advised for KYB | [H32] |
| Fabrication | `document_fabrication_detection` | Signs the document was fabricated | `fraud` | — | [O11] |
| PDF editor | **not public** | PDF metadata consistent with an editing tool | fraud | — | [H27] [H26] |
| PDF fonts | **not public** | Fonts inserted or changed after creation | fraud | — | [H27] |
| Image timestamps | **not public** | Irregular or modified timestamps | fraud | — | [H27] |
| Image metadata | **not public** | Editing tools present in EXIF/metadata | fraud | — | [H27] |
| JPEG original | **not public** | Applies to JPEG uploads only; N/A for PDFs | not public | — | [H31] |
| Compromised | **not public** | Matches a set of known compromised documents | fraud (implied) | — | [H26] |
| Enhanced fraud | **not public** | Asynchronous model over visual and non-visual signals (edits, screenshots, generative AI, inconsistencies, serial reuse) returning a risk level and indicators | fraud | risk policy set by Persona; require to fail on High | [H38] [M7] |
| QR presence | **not public** | A QR code was detected | not public | — | [H39] |

Reasons for every document check are **not documented**. Persona states that these checks surface risk
indicators, not proof of fraud [H27] [H31].

### 4.6 Limits and collection-only mode

- Formats: PDF, JPG/JPEG, PNG, HEIC/HEIF, TIF/TIFF [H26]. The module's capture screen lists PDF, JPEG,
  PNG, HEIC, HEIF [H36].
- Default 32 MB per file. A request may have at most 20 pages, spread across any number of files
  [H26] [H36].
- Collection-only mode [H35]:
  - no classification, extraction or insights run; configured checks still run, so a check needing an
    extraction can still fail;
  - allows up to 250 pages and 200 MB per file, and office/spreadsheet formats;
  - turning it off cuts limits back to 20 pages (synchronous extraction) or 100 pages, and to 32 MB.

### 4.7 Flow

- The module inserts:
  - a capture/upload screen;
  - the verification step;
  - a pass/retry/fail branch.

  No classification is preset, so it accepts anything until configured [H36] [H37].
- The decision comes within seconds, so the flow can re-prompt on the spot [H26] [H37]. It re-prompts
  for:
  - the wrong type;
  - a document that is too old;
  - an expired document;
  - a missing required field.
- Capture method (camera vs upload) is set per device; the capture copy should name the accepted
  documents [H37].
- A multi-document home screen lists required and optional documents. Each opens its own sub-flow with
  pass/fail/retry; submit unlocks once all required ones are done [H40].
- Typical proof-of-address solution: government ID first, then the address document; failures open a
  review case [H41].
- Common starting flows [H37]:
  - a document only;
  - ID → selfie → document;
  - database, falling back to ID → selfie → document.

### 4.8 Dashboard

- The result view [H31]:
  - a file thumbnail that opens the document viewer;
  - the classification;
  - extracted values (guided ones compared against a known value);
  - insights;
  - the name of the group applied;
  - the checks table.
- Document viewer:
  - click a value to jump to its location;
  - transliteration of non-Latin text;
  - similar earlier documents side by side [H26];
  - overlays for enhanced fraud indicators [H38];
  - QR evidence thumbnails and a source column on extractions [H39].

---

## 5. Database (`verification/database`, `database-standard`, `aamva`)

### 5.1 Authoritative database verification

- **Inputs** [H43] [D18]:
  - at least two of: full name (always required), national ID, birthdate, address, phone, email;
  - per-country minimums apply;
  - an extra document number is used for some countries (e.g. AU).
- **Attributes** [O13] [C6] [C14]:
  - the default name, birthdate, phone and email fields;
  - `normalized-address-street-1/-2`, `-city`, `-subdivision`, `-postal-code`;
  - `identification-number` and `document-number`;
  - `document-issuing-date`, `document-expiry-date`, `document-issuing-subdivision`.
- **Statuses** [H51] [H52]:
  - `initiated`: stays there when an API caller omits required fields;
  - `submitted`: fields saved, processing;
  - `passed` / `failed`;
  - `canceled`: submitted but no result.
- **Flow (module)** [H53]:
  - a form for name, birthdate, address and SSN;
  - a silent background check;
  - a pass/fail branch with **no retry path** and no built-in success/fail screens.
- **Module defaults** [H53]:
  - partial match on first name, last name, birthdate, address and SSN; no match required on email
    and phone;
  - a toggle lets a tentative match count as passing.
- **International collection component** [H54]:
  - the user picks a country, an ID type and a value, for an individual or a business;
  - allowed ID types are set per country;
  - the country is prefilled from location unless disabled.
- **Template settings** [H44] [H45]:
  - required checks;
  - acceptable countries;
  - the per-field match requirements behind the identity comparison;
  - sub-options on some checks.
- **Country presets** ship as solutions with their own required inputs [H56] [H57]:
  - UK: name, birthdate, address;
  - Australia: those plus one national number (licence, passport or visa);
  - advanced options are plan-gated: database type, issuing-source matching, phone or email
    attributes, per-attribute match tuning.
- **Sandbox**: a `debug` transaction field forces `passed` or `failed` [D18].

### 5.2 Checks

| Check | Category / type | What it decides (our words) | Sources |
|---|---|---|---|
| `database_identity_comparison` | Fraud | The identity matches a record; holds the match requirements and match groups | [D11] [H44] |
| `database_inquiry_comparison` | Fraud | Earlier claimed values (e.g. prefilled name, birthdate) disagree with what was sent to the database | [D11] [H55] |
| `database_address_deliverable_detection` | User action required | The address can receive mail | [D11] |
| `database_address_residential_detection` | User action required | The address is residential | [D11] |
| `database_po_box_detection` | User action required | The address is a PO box | [D11] |
| `database_name_comparison` | `fraud` | Name vs record | [O16] |
| `database_address_comparison` | `fraud` | Address vs record | [O16] |
| `database_birthdate_comparison` | `fraud` | Birthdate vs record | [O16] |
| `database_attribute_comparison` | not public | Per-attribute comparison exposing `comparison_input_results` in metadata | [C10] |
| identification-number comparison | id not public | National ID vs record (international) | [H49] |
| alive / deceased | id not public | Record shows the person alive | [H49] |

Outside the US, each configurable field maps to exactly one comparison check [H47] [H49].

### 5.3 Match requirements

- **US** [H46] [H48]:
  - each field has one or more requirements, and any one being met makes the field match;
  - a requirement is a comparison method plus a partial threshold, for example a maximum edit
    distance or a minimum similarity percentage;
  - the threshold sets the partial line, not pass/fail;
  - Persona ships field-specific defaults and advises leaving them;
  - by default near matches pass, e.g. a nickname, or a birthdate one day off counting as partial
    [D11].
- **Non-US** [H47] [H49]:
  - per field: full, partial (fuzzy) or none;
  - none makes the field informational;
  - a check passes when its result meets the level, so partial-required passes on a full result.
- **Results** [H49]: full, partial, none, or missing. Missing means no data for the field, which is
  distinct from a mismatch. Thin-file users show many missing results [H50].
- **Shared infrastructure** [H55]. Every comparison check uses the same normalization and comparison
  machinery:
  - normalization: `remove_prefixes`, `remove_suffixes`, `remove_special_characters`,
    `fold_characters`;
  - comparison: `string_similarity`, `string_difference` (default partial = 1 edit), `nickname`,
    `substring` (minimum 3 characters), `tokenization`, `date_similarity` (default partial = 2 of 3
    date parts), `date_difference_{x}`.
- **Match groups**: alternative combinations, any satisfied group passes the identity comparison. The
  dashboard shows each group's result [H43] [H88].
- **Results view**: comparison checks appear in their own section, separate from the other checks
  [H49].
- **Why databases fail**: typos, nicknames, partial surnames, autocomplete artefacts, thin files,
  stale records [H50].

### 5.4 Database standard (non-authoritative)

Its own type with name and normalized address attributes; launched 2023-10 [O14] [C1]. Checks are
**not documented** [D12].

### 5.5 AAMVA (`verification/aamva`)

- **Attributes** [O15]:
  - `name-first`, `name-last`, `birthdate`;
  - `issue-date`, `expiration-date`;
  - `address-postal-code`, `issuing-authority`, `identification-number`.
- **Required inputs**: name, birthdate, ID number, expiry, issue date, issuing state [H58].
- **Checks**:
  - `aamva_identification_number_comparison` [O1];
  - `aamva_name_comparison`, whose metadata adds `name-first-match` and `name-last-match` [C9];
  - an identity comparison (version 2.0.0) with a per-field risk level: high, medium, low, none [D13]
    [H59];
  - when the identity comparison is not configured, per-attribute checks with full/partial/none/missing
    for birthdate, ID number, name, postal code, expiry and issue date [H59];
  - an external-service-error check (version 2.1.0) [D13].
  - Persona advises requiring name, birthdate and ID number [H58].
- **Lifecycle**:
  - `skipped` when the jurisdiction does not take part [D2];
  - `canceled` during a service outage.
  - The shipped solution runs AAMVA in a workflow after the inquiry, retries up to 3 times, and opens a
    case when all retries cancel, the state is not covered, or the result fails [H61].
- **Flow**: silent, no screens. It runs only for a US licence or state ID whose barcode check passed,
  using the ID extraction [H60].
- **Alternatives** [H58]:
  - a branch inside the inquiry, prefilled from the ID;
  - an AAMVA-only inquiry raised by a reviewer.
- **Coverage**: not AK, LA, MN, NY or UT (as of Feb 2025); California needs special pricing [H58]
  and is now supported [M5].
- **Limits**: it cannot catch a fake card whose front matches a valid barcode, cannot judge the photo
  or signature, and cannot tell that someone else is holding a real card [H58].

### 5.6 Other issuing sources (adapters only)

- eCBSV [H62] [D23]:
  - checks SSN, name and birthdate with the SSA;
  - a record-match check reports match / no match / not evaluated per attribute;
  - a death-record check also exists.
- TIN (section 7.4), Serpro (Brazil) [D24], UK DVLA and Aadhaar types exist [O1].

---

## 6. Government ID NFC (`verification/government-id-nfc`)

### 6.1 Resource

| Attribute | Notes | Source |
|---|---|---|
| shared attributes | status, timestamps, checks, tags | [O1] |
| `name-first`, `name-last`, `birthdate`, `sex` (`M`, `F`, `X`), `expiration-date`, `identification-number`, `id-class` | read from the chip | [O17] |
| address fields | shared address block | [O17] |
| `selfie-photo`, `selfie-photo-url` | added 2024-07 for parity with government ID | [O17] [C7] |
| `document` relationship | to a document; the union has `document/government-id-nfc` | [O17] [O28] |

A separate Japanese My Number NFC type exposes card, signing-certificate and authentication-certificate
expiry dates, a face image and licence data [O31]; it is not in our scope.

### 6.2 Checks

- `id_nfc_expired_detection`, reason `expired` (the only public NFC identifier) [O17].
- A PKI validation check [H16] [H17] [H18] [M2]:
  - the chip's cryptographic signature proves the issuer created the data;
  - it is offered as an optional addition;
  - IAL2 guidance says to keep it required on the passport-with-chip pathway.
  - Its identifier is **not public**. It corresponds to ICAO passive authentication **(inference)**.
- **Not documented**: active authentication, chip authentication, PACE vs BAC choice, DG1-vs-MRZ
  comparison, DG2-vs-selfie comparison, CSCA trust-list source, reason codes.
  - The iOS integration declares both TAG and PACE reader formats and three ISO 7816 application ids
    [D19]. The first of them is the ICAO eMRTD application id (our knowledge), and PACE in the
    entitlement suggests PACE is used where available **(inference)**.

### 6.3 Flow

1. The SDK detects whether the device has NFC and whether the document has a chip; if NFC is off,
   the user is guided to turn it on; without NFC, the normal photo path is used [M2] [M3].
2. The user picks a passport (or eligible ID), photographs the data page (quality-checked), and
   reviews the extracted number, birthdate and expiry; mistakes can be corrected [M3].
3. The chip is unlocked automatically from those fields; the user holds the phone to the chip [M3].
4. The phone reads the holder's data and portrait. The read takes under a minute end to end [M3].
   The data covers:
   - name, birthdate and birthplace;
   - issue and expiry dates;
   - the portrait.
5. The user reviews the chip data and submits [H64] [M2].

- **End-user hints** to cover (our wording later) [H65] [H66] [H67] [H68]:
  - turn NFC on;
  - remove the case or cover;
  - avoid metal surfaces;
  - move slowly until the read starts, then stay still until done;
  - try the cover, back cover, data page and chip page from both sides;
  - turn off low-power mode;
  - keep other cards away;
  - restart a long-running phone.
- Cancelling through the flow's own close control records the error; force-quitting the app leaves
  no record [H66].
- **Fallbacks**: device handoff to an NFC phone, or a photo of the data page when the flow offers it
  [H68].

### 6.4 Scope and channels

- Native mobile SDKs only, no web [H63]. Android needs an optional NFC package and the NFC permission
  [D20]. iOS needs [D19]:
  - an NFC package;
  - the NFC capability;
  - the TAG and PACE formats;
  - an AID list;
  - a usage string.
- **Documents** [H63] [H65] [H68] [M2]:
  - ICAO-compliant passports;
  - some EU ID cards and residence permits;
  - not the US passport card;
  - 120+ countries.
- Events: none NFC-specific [D9]. Whether a chip read creates a `document/government-id-nfc` that
  fires `document.*` events is **not documented** (plausible, given the document union) **(inference)**.

---

## 7. Business / KYB

### 7.1 Business registry verification (`verification/database-business`)

- **Create** [D15]:
  - public `POST /verification/database-businesses`;
  - required: business name, address country code, verification template id;
  - optional: registration number and address parts;
  - optional `meta.debug-forced-status` and `meta.processing-mode`.
- **Submit**: allowed only from `initiated` [D16].
- **Attributes** [D15] [O18]:
  - `business-name`, `registration-number`;
  - address parts, `address-country-code`;
  - optional person fields: names, birthdate, phone, email.
- **Statuses**: shared list plus `tentatively_failed` [O1] [O19].
- **Checks** [O19]:

| Check | Category | Meaning (our words) |
|---|---|---|
| `database_business_service_available_detection` | `user_action_required` | A registry source is available for the request |
| `database_business_enabled_country_detection` | `user_action_required` | The business's country is enabled in the template |
| `database_business_active_business_detection` | `fraud` | The registry shows the business active; can fail even when every field matched [H69] |
| `database_business_identity_comparison` | `fraud` | Inputs match a registry record under any applicable match group; reason `low_confidence_match` seen [O19] |
| `database_business_associated_persons_comparison` | `fraud` | Semantics **not documented**; N/A in the only example |
| `database_business_ai_identity_comparison` | — | Deprecated; results folded into the identity comparison [C11] |

- **Matching** [H69] [H72] [C8]:
  - default match groups per country (number formats, languages, address conventions), filterable by
    country;
  - changing them goes through Persona;
  - each requirement exposes claimed, extracted and normalized values.
- **Coverage** [H69]:
  - about 130 countries;
  - US: name and address only, no registration number;
  - tax ids are separate verifications.
- **Results view**: raw inputs (including an associated person's name), then the identity comparison
  with property, input, record, match result and status [H70].
- **Configuration**: required checks and their sub-options can be edited by the customer, both inside
  an inquiry template and on a standalone verification template [H71] [H72].

### 7.2 Business website verification (`verification/business-website`)

- **Inputs**: business name and URL required; address, phone and email recommended [H74].
- **Thirteen checks**, each optionally required [H74]. Only 3 identifiers are public:
  `business_website_backlink_detection`, `business_website_malicious_website_detection`,
  `business_website_domain_age_detection`, all category `fraud`, not required in the example [O21].
  The other ten, described by function:
  1. URL syntax;
  2. an AI identity comparison of site content vs submitted details;
  3. DNS resolvability;
  4. redirect to another domain;
  5. domain expiry (expired or expiring soon);
  6. supported site platform;
  7. enough real content (not parked, for sale or coming soon);
  8. a genuine terms-of-service page;
  9. a genuine privacy policy;
  10. a working cookie-consent banner with a reject option.
- **Metadata and reasons**:
  - backlink metadata `backlink-count` and `backlink-threshold` [O21] [C12];
  - malicious-site signals in `reasons` [C12];
  - failure reasons are described in prose for each check [H74].
- **Attribute** `extracted-identity`: business names, addresses, phones and emails found on the site,
  each with its source URL [O20] [C12].
- **Config**: required checks, and which LLM provider powers the identity comparison [H76].
- **Results view**: the submitted URL and business name, then the checks table [H75].

### 7.3 Business footprint (`verification/database-business-footprint`)

- US only. Matches name and address against commercial (non-registry) data with US-tuned match groups.
- Not advised where registry evidence is required for compliance.
- May end `tentatively_failed` [H73] [O1] [O22].

### 7.4 TIN, VAT, brand asset

- **TIN** (`verification/database-tin`) [O23] [H77] [H78]:
  - attributes `tin`, `tin-type`, names, `name-business`;
  - ITIN, EIN and SSN are supported; ATIN and PTIN are not;
  - statuses `submitted`, `passed`, `failed`;
  - the IRS source goes down, so Persona advises running it in a workflow after the inquiry, with
    hourly retries;
  - prose names a name-comparison, a format check and a deceased check;
  - on a name mismatch it may suggest names that verified before with the same TIN.
- **VAT** (`verification/database-vat-number`) [O24] [H79]:
  - VAT number and country code against VIES or the UK registry;
  - optional name/address match groups;
  - attributes for the registered name and address;
  - member states have scheduled daily downtime, so Persona advises workflow retries.
- **Brand asset** [H81] [O36]:
  - logo checks for sensitive content, for presence on the business website, and for conflicting
    trademarks;
  - asynchronous;
  - a check with no upstream answer is marked unavailable rather than passed or failed.

### 7.5 KYB orchestration

- **KYB by API** [D17]:
  - a transaction carries business name, tax id, registered and physical addresses, documents, and
    `associated_people`;
  - each person is either verified silently by a database check (needs birthdate, address, tax id) or
    emailed an inquiry link;
  - default transaction statuses: `created`, `approved`, `declined`, `needs_review`, `errored`;
  - a case gathers everything for review;
  - a sandbox `debug` field forces outcomes.
- **Overview** [H80]:
  - most KYB inputs are legal name and legal address;
  - reports enrich after verification;
  - UBO KYC runs in-flow or afterwards.

### 7.6 Events

Generic verification events only, plus `verification.tentatively-failed` [D9] [O19]. Reports (business
lookup, associated persons, watchlist, adverse media) have their own report events, which belong to
Phase 6.

---

## 8. Crypto wallet (`verification/crypto-wallet`)

- **Attributes** [O25]:
  - `wallet-address`, taken from the signed authentication message;
  - `chain-id` in CAIP-2 form (`eip155:1` for Ethereum mainnet);
  - optional `expected-address`.
- **Checks**: all category `fraud`, all required in the example [O26].

| Check | Meaning (our words) | N/A reason when its reference is missing |
|---|---|---|
| `crypto_wallet_validity_detection` | The recovered address is valid | — (passed in example) |
| `crypto_wallet_statement_comparison` | Signed message statement equals the expected statement | `no_expected_statement` |
| `crypto_wallet_address_comparison` | Recovered address equals `expected-address` | `no_expected_address` |
| `crypto_wallet_disallowed_chain_detection` | Chain is on the template allowlist | `no_allowlist` |

- **Not documented**: the message format, supported chains and signature schemes, the end-user flow
  (wallet connect vs paste), retries, and any Help Center article for this type. The vocabulary
  (statement, CAIP-2 chain id, address taken from the signed message) matches Sign-In-with-Ethereum /
  CAIP-122 style messages **(inference)**.
- What is public is a solution that only collects an address and screens it with the crypto-address
  watchlist report. That report checks OFAC sanctions and is a report, not an ownership proof
  [H84] [H85].

---

## 9. mDL, verifiable credentials, digital ID (stretch goal)

### 9.1 Mobile document (`verification/mdoc`, `document/mdoc`)

- **Attributes** [O27] [O28]:
  - names and birthdate;
  - street, city, state, postal code and country;
  - `issuing-authority`, `issuing-jurisdiction`, `issuing-country`;
  - `nationality`, `expiration-date`, `identification-number`;
  - `age-in-years`, `meets-minimum-age`;
  - `validated-issuer-key` (example `apple_wallet`);
  - `portrait-photo`.
- **Behaviour** [M5]:
  - Persona follows ISO 18013-7 for remote presentation;
  - for the California DMV wallet: detect the wallet, the user approves which attributes to share (the
    DMV may ask for consent too), Persona validates and returns structured data, then the template's
    checks run;
  - works on mobile and desktop web.
- **Apple Wallet**: an older post (2022) describes accepting Apple Wallet IDs for organisations with
  Apple's entitlement, by offering the mDL when one is found on the device. **Low confidence**: the
  page returned 403 to us, and this rests on a search-engine summary [M6].
- **Positioning**: mDLs are cryptographically signed and device-bound [M4] [M5]. Persona's paid fraud
  review lists mDL settings among the government ID options it examines, next to barcode, AAMVA and
  NFC [H89]. Check identifiers: **not documented**.

### 9.2 Verifiable credential (`verification/verifiable-credential`)

- **Attributes**: selected credential issuer, its types, issuance date and expiry date [O29].
- **Public behaviour** (Microsoft Entra Verified ID) [H82]:
  - as a verifier: send a presentation request; the user presents from their authenticator app; the
    signature is validated; then accepted issuers and required claims are checked;
  - by default any valid credential is accepted;
  - an issuer-allowlist check can narrow it with `allowed_issuers`, `allowed_organization_ids`,
    `allowed_environments_ids`, `allowed_inquiry_template_ids`;
  - required claims missing means a rejection;
  - Persona can also issue a credential after verification, with a claim set drawn from the inquiry.
- **Not documented**: OpenID4VP or the browser Digital Credentials API, and other wallets.

### 9.3 Digital ID schemes

- 17 `digital-id-*` types, e.g. a generic one with `selected-digital-id-type`, `response-status` and
  `response-country` [O30] [M4].
- Several schemes return no portrait, which makes a later selfie-to-ID comparison N/A. Order matters
  (digital ID → government ID → selfie) [H83].

---

## 10. What Phase 5 should take from this (proposed, for the Phase 5 plan)

### 10.1 Must match

1. **Statuses and events.**
   - Add `tentatively_passed` (document only) and `tentatively_failed` (business registry only).
   - Add `verification.tentatively-passed` / `-failed`.
   - Wire `confirmed` for phone and email.
   - Add the `document` resource with `document.created`, `.submitted`, `.pending`, `.processed`,
     `.errored`, plus sandbox simulation for document and database (event order as in 1.4).
2. **Check category.**
   - Add `category` (`biometrics`, `fraud`, `user_action_required`, `validity`, null) to check results.
   - Map document type, properties and expiry to `validity`.
   - Map `database_business_service_available_detection` and
     `database_business_enabled_country_detection` to `user_action_required`.
   - Map `crypto_wallet_validity_detection` to `fraud`.
   - Changing our `checkType` for these needs an ADR, since `user_behavior` drives retry hints.
3. **Fix `document_expired_detection`.**
   - Make it the expiry-date check.
   - Add our own recency check (suggested id `document_recency_detection`, marked ours) with
     `max-age-days`, default 90.
4. **Document groups.** A template-level list of groups, each with accepted/rejected types, required
   extractions and per-group check config, plus an always-present catch-all; type detection always
   required.
5. **Phone and email.**
   - `max-attempts` default 5.
   - Resend with a cooldown (ours); SMS delivery failure returns to number entry.
   - Hashed code, never serialised.
   - Optional country lock.
   - Org display name in SMS and email copy.
   - Our own code length and lifetime documented.
   - Keep our four check ids, marked ours.
6. **Database.**
   - Add `database_identity_comparison` (match groups) and `database_inquiry_comparison`.
   - Add the three address checks.
   - Use the public normalization/comparison method ids as our config vocabulary.
   - Results full/partial/none/missing; `missing` never counts as a mismatch.
   - Sandbox `debug`.
7. **AAMVA type.**
   - Model AAMVA as its own verification type with `aamva_name_comparison`,
     `aamva_identification_number_comparison` and an identity comparison.
   - `skipped` for uncovered jurisdictions; `canceled` on adapter outage, with retry guidance.
8. **Crypto.**
   - Attributes `wallet-address`, `chain-id` (CAIP-2), `expected-address`.
   - Address comparison means recovered vs expected address.
   - N/A reasons `no_expected_address`, `no_expected_statement`, `no_allowlist`.
9. **KYB.** Split into a registry type (`database-business` semantics) and a website type; add the
   `low_confidence_match` reason.

### 10.2 Ours, keep and label

- Phone and email: `phone_number_otp_comparison`, `email_address_otp_comparison`,
  `email_address_disposable_detection`, `email_address_mx_detection`.
- Document: `document_name_comparison`, `document_address_comparison` (Persona does this as an
  extraction mode).
- NFC: `id_nfc_passive_authentication_detection` (counterpart described only as PKI validation),
  `id_nfc_chip_authentication_detection`, `id_nfc_mrz_comparison`, `id_nfc_selfie_comparison`.
- Document fraud split: if we split our forensics into PDF-metadata, font, timestamp and EXIF checks
  to mirror Persona's separate checks, their ids are ours.

### 10.3 Nice to have / later

- Insights, vision mode and QR-linked extraction.
- Collection-only mode.
- Multi-document home screen.
- Enhanced asynchronous document fraud with a risk level (would use `tentatively_passed`).
- Business website's ten unnamed checks.
- TIN, VAT and footprint adapters.
- Phone carrier and SNA adapters.
- mDL (ISO 18013-7) and verifiable credential verifier.

### 10.4 Open questions (no public answer)

- All check identifiers and reason codes for phone, email, NFC, the document fraud family, database
  standard, AAMVA attribute checks, TIN, VAT and the website's ten other checks.
- OTP length, lifetime, resend limits; whether an email link variant exists.
- Which NFC protocols run (PACE vs BAC, AA, CA) and which trust list validates signatures.
- What `database_business_associated_persons_comparison` compares.
- The crypto signed-message format and supported chains.
- When exactly a document becomes `tentatively_passed`, and a business registry check
  `tentatively_failed`.
