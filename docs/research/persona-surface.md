# Persona public API surface: identifier index

Machine-extracted on 2026-10-19 from the public `persona-id/persona-openapi` repository (version `2026-09-29`).
This index holds **identifiers only**. It is the coverage checklist for OpenVerify; no documentation text is copied.
How each identifier maps to OpenVerify is in `docs/PLAN.md` §2 (feature map) and §4 (check catalog).

## Verification checks (69)

Names appearing in example payloads. The authoritative full list is behind Persona's dashboard; PLAN §4 adds checks implied by Lists (face, selfie background).

- `aamva_identification_number_comparison`
- `business_website_backlink_detection`
- `business_website_domain_age_detection`
- `business_website_malicious_website_detection`
- `crypto_wallet_address_comparison`
- `crypto_wallet_disallowed_chain_detection`
- `crypto_wallet_statement_comparison`
- `crypto_wallet_validity_detection`
- `database_address_comparison`
- `database_birthdate_comparison`
- `database_business_active_business_detection`
- `database_business_associated_persons_comparison`
- `database_business_enabled_country_detection`
- `database_business_identity_comparison`
- `database_business_service_available_detection`
- `database_name_comparison`
- `document_expired_detection`
- `document_extracted_properties_detection`
- `document_fabrication_detection`
- `document_type_detection`
- `id_aamva_database_lookup`
- `id_account_comparison`
- `id_age_comparison`
- `id_age_inconsistency_detection`
- `id_barcode_detection`
- `id_barcode_inconsistency_detection`
- `id_blur_detection`
- `id_color_inconsistency_detection`
- `id_compromised_detection`
- `id_disallowed_country_detection`
- `id_disallowed_type_detection`
- `id_double_side_detection`
- `id_electronic_replica_detection`
- `id_entity_detection`
- `id_expired_detection`
- `id_extracted_properties_detection`
- `id_extraction_inconsistency_detection`
- `id_fabrication_detection`
- `id_glare_detection`
- `id_handwriting_detection`
- `id_inconsistent_repeat_detection`
- `id_inquiry_comparison`
- `id_mrz_detection`
- `id_mrz_inconsistency_detection`
- `id_nfc_expired_detection`
- `id_number_format_inconsistency_detection`
- `id_po_box_detection`
- `id_portrait_clarity_detection`
- `id_portrait_detection`
- `id_public_figure_detection`
- `id_real_id_detection`
- `id_repeat_detection`
- `id_selfie_comparison`
- `id_tamper_detection`
- `id_unprocessable_submission_detection`
- `id_valid_dates_detection`
- `selfie_account_comparison`
- `selfie_age_comparison`
- `selfie_face_covering_detection`
- `selfie_glare_detection`
- `selfie_glasses_detection`
- `selfie_id_comparison`
- `selfie_image_quality_detection`
- `selfie_liveness_detection`
- `selfie_multiple_faces_detection`
- `selfie_pose_detection`
- `selfie_pose_repeat_detection`
- `selfie_public_figure_detection`
- `selfie_suspicious_entity_detection`


### Verification checks outside the example payloads (8)

Added 2026-10-22 (Workflow 5A Stage 1a, C67) from the public developer docs and Help Center, as listed in `docs/research/phase5-behaviour.md` ("Surface-index gaps", with its sources). Identifiers only.

- `aamva_name_comparison`
- `database_address_deliverable_detection`
- `database_address_residential_detection`
- `database_attribute_comparison`
- `database_business_ai_identity_comparison` (sunset)
- `database_identity_comparison`
- `database_inquiry_comparison`
- `database_po_box_detection`

## Verification types (60)

- `aamva`
- `aamvas`
- `bank-pennydrop`
- `brand-asset`
- `business-website`
- `certificate-korea`
- `credit-card`
- `crypto-wallet`
- `database`
- `database-aadhaar`
- `database-business`
- `database-business-footprint`
- `database-ecbsv`
- `database-ecbsvs`
- `database-phone-carrier`
- `database-phone-carriers`
- `database-serpro`
- `database-serpros`
- `database-standard`
- `database-standards`
- `database-tin`
- `database-tins`
- `database-uk-dvla`
- `database-vat-number`
- `databases`
- `digital-id-connect-id`
- `digital-id-e-do-app`
- `digital-id-finnish-trust-network`
- `digital-id-france-identite`
- `digital-id-generic`
- `digital-id-idin`
- `digital-id-its-me`
- `digital-id-kcb-credit-card`
- `digital-id-mit-id`
- `digital-id-northern-ireland-drivers-license-check-code`
- `digital-id-one-id`
- `digital-id-philsys`
- `digital-id-serpro`
- `digital-id-singpass`
- `digital-id-swedish-bank-id`
- `digital-id-uk-sharecode`
- `digital-id-world-id`
- `document`
- `documents`
- `email-address`
- `email-addresses`
- `government-id`
- `government-id-nfc`
- `government-id-nfcs`
- `government-ids`
- `jp-my-number-nfc-scan`
- `mdoc`
- `persona-fff-inquiry`
- `phone-number`
- `phone-number-silent-network-authentication`
- `phone-numbers`
- `qes-infocert`
- `selfie`
- `selfies`
- `verifiable-credential`


### Document resource subtypes (3)

Added 2026-10-22 (Workflow 5A Stage 1a, C67) from the OpenAPI schemas, as listed in `docs/research/phase5-behaviour.md` ("Surface-index gaps"). Identifiers only.

- `document/generic`
- `document/government-id-nfc`
- `document/mdoc`

## Report types (54)

Corrected 2026-10-27 (Workflow 6A Stage 1a, plan C87) from `docs/research/phase6-behaviour.md` ("Corrections to the repository's records"): the events page names two types this list lacked, `business-legal-history` and `ip-address`, and the sentilink scores type is `report/integration/sentilink-scores`. Identifiers only.

- `address-lookup`
- `adverse-media`
- `background-check`
- `better-business-bureau`
- `business-adverse-media`
- `business-associated-persons`
- `business-classification`
- `business-enforcement-action`
- `business-industry-classification`
- `business-legal-history`
- `business-liens-lookup`
- `business-lookup`
- `business-lookup-eu`
- `business-media-coverage`
- `business-nonprofit`
- `business-online-presence`
- `business-personnel-insights`
- `business-registrations-lookup`
- `business-search`
- `business-social-media`
- `business-watchlist`
- `business-website`
- `chainalysis-address-screening`
- `clearbit-business-lookup`
- `coinbase-check-crypto-risk`
- `community-safety`
- `comply-advantage-search`
- `comprehensive-profile`
- `crypto-address-watchlist`
- `custom-list`
- `email-address`
- `employer-lookup`
- `equifax-oneview`
- `finra-broker-check`
- `integration`
- `ip-address`
- `kyckr-business-lookup`
- `middesk`
- `mx-account`
- `nces`
- `novacredit-cash-atlas`
- `novacredit-credit-passport`
- `phone-number`
- `politically-exposed-person`
- `profile`
- `profile-non-authoritative`
- `screening`
- `sec-action-lookup`
- `sentilink-application-risk`
- `sentilink-scores`
- `social-media`
- `synthetic`
- `trm-wallet-screening`
- `watchlist`


## List-item types (11)

- `browser-fingerprints`
- `countries`
- `device-fingerprints`
- `email-addresses`
- `fields`
- `geolocations`
- `government-id-numbers`
- `ip-addresses`
- `names`
- `phone-numbers`
- `strings`


## Webhook events (142)

Corrected 2026-10-27 (Workflow 6A Stage 1a, plan C87): a report event's name is `report/<type>.<action>`, with a slash; `report_<type>.<action>` was the name of its OpenAPI webhook file. The events page lists 126 report events where this index has 50: the missing 76 are the events of the report types this index has no events for, `report/business-nonprofit.changed`, and the `.submitted` variants of the business types (associated persons, classification, enforcement action, industry classification, legal history, media coverage, online presence, personnel insights), `middesk` and the two `novacredit` types (`docs/research/phase6-behaviour.md`). They are not listed one by one here, because the events page was read in summary only. OpenVerify's own report events (plan C70.4) are `.ready`, `.errored` and `.redacted` for every Phase 6 type, plus `.matched`, `.dismissed` and `.reviewed` for the six types with match review.

- `account.added-relation`
- `account.archived`
- `account.consolidated`
- `account.consolidated-with`
- `account.created`
- `account.redacted`
- `account.removed-relation`
- `account.restored`
- `account.status-updated`
- `account.tag-added`
- `account.tag-removed`
- `account.updated-fields`
- `account.updated-tags`
- `batch-job.canceled`
- `batch-job.completed`
- `batch-job.errored`
- `batch-job.paused`
- `batch-job.resumed`
- `batch-job.started`
- `case.assigned`
- `case.created`
- `case.exported`
- `case.queue-updated`
- `case.redacted`
- `case.reopened`
- `case.resolved`
- `case.sla-expired`
- `case.status-updated`
- `case.updated-fields`
- `case.updated-tags`
- `deployment.completed`
- `document.created`
- `document.errored`
- `document.extracted`
- `document.pending`
- `document.processed`
- `document.submitted`
- `graph-query.submitted` *(added 2026-10-31: in the public event list; the OpenAPI defines no webhook for it)*
- `graph-query.cancelled`
- `graph-query.completed`
- `graph-query.errored`
- `graph-query.reran`
- `graph-query.timed-out`
- `importer-pipeline-run.canceled`
- `importer-pipeline-run.completed`
- `importer-pipeline-run.errored`
- `importer-pipeline-run.paused`
- `importer-pipeline-run.resumed`
- `importer-pipeline-run.started`
- `inquiry-session.canceled`
- `inquiry-session.expired`
- `inquiry-session.started`
- `inquiry.approved`
- `inquiry.completed`
- `inquiry.created`
- `inquiry.declined`
- `inquiry.expired`
- `inquiry.failed`
- `inquiry.marked-for-review`
- `inquiry.redacted`
- `inquiry.reusable-persona-created`
- `inquiry.reusable-persona-used`
- `inquiry.started`
- `inquiry.transitioned`
- `inquiry.updated-tags`
- `report/address-lookup.errored`
- `report/address-lookup.ready`
- `report/address-lookup.submitted`
- `report/adverse-media.dismissed`
- `report/adverse-media.errored`
- `report/adverse-media.matched`
- `report/adverse-media.ready`
- `report/business-adverse-media.dismissed`
- `report/business-adverse-media.errored`
- `report/business-adverse-media.matched`
- `report/business-adverse-media.ready`
- `report/business-associated-persons.errored`
- `report/business-associated-persons.ready`
- `report/business-lookup.errored`
- `report/business-lookup.ready`
- `report/business-registrations-lookup.errored`
- `report/business-registrations-lookup.ready`
- `report/business-watchlist.dismissed`
- `report/business-watchlist.errored`
- `report/business-watchlist.matched`
- `report/business-watchlist.ready`
- `report/crypto-address-watchlist.errored`
- `report/crypto-address-watchlist.matched`
- `report/crypto-address-watchlist.ready`
- `report/email-address.errored`
- `report/email-address.ready`
- `report/phone-number.errored`
- `report/phone-number.ready`
- `report/politically-exposed-person.dismissed`
- `report/politically-exposed-person.errored`
- `report/politically-exposed-person.matched`
- `report/politically-exposed-person.ready`
- `report/profile-non-authoritative.errored`
- `report/profile-non-authoritative.ready`
- `report/profile.errored`
- `report/profile.ready`
- `report/screening.errored`
- `report/screening.matched`
- `report/screening.ready`
- `report/screening.reviewed`
- `report/sentilink-scores.errored`
- `report/sentilink-scores.ready`
- `report/social-media.errored`
- `report/social-media.ready`
- `report/synthetic.errored`
- `report/synthetic.ready`
- `report/watchlist.dismissed`
- `report/watchlist.errored`
- `report/watchlist.matched`
- `report/watchlist.ready`
- `selfie.created`
- `selfie.errored`
- `selfie.processed`
- `selfie.submitted`
- `transaction-type.converted-field` *(added 2026-10-31: in the public event list)*
- `transaction-type.deleted-field`
- `transaction.added-relation`
- `transaction.created`
- `transaction.labeled`
- `transaction.redacted`
- `transaction.removed-relation`
- `transaction.sentinel-session-processed`
- `transaction.status-updated`
- `transaction.updated-fields`
- `verification.canceled`
- `verification.created`
- `verification.escalated`
- `verification.failed`
- `verification.passed`
- `verification.requires-retry`
- `verification.skipped`
- `verification.submitted`
- `verification.tentatively-failed`
- `verification.tentatively-passed`
- `verification.updated-tags`
- `workflow-run.completed`
- `workflow-run.created`
- `workflow-run.errored`
- `workflow-run.resumed`


Added 2026-11-02 (Workflow 8A, plan C144): the events page also lists these, which the spec's webhook files do not: `case.updated`, `case.agent-reviewed`, `case.print-initiated`, `case-comment.created`, `case-message.sent`, `case-message.received`, `case-template.converted-field`, `case-template.deleted-field`, `workflow.published`, `workflow-version.published`, `user.availability-updated` and the four `user-notification.*` events (`docs/research/phase8-behaviour.md`, Corrections 1). They are not counted in the number above.

Added 2026-11-05 (Workflow 9A, plan C176): the events page also lists `inquiry-template-version.created` and `inquiry-template-version.published`, which the spec's webhook files do not (`docs/research/phase9-behaviour.md`). OpenVerify registers both, and `deployment.completed` of its own deployment history (C154.8). They are not counted in the number above.

Sources that disagree, and what OpenVerify follows (the same Corrections):

- **Version id prefix.** The Help Center's table gives `wflv_`; every OpenAPI example uses `wfv_`. OpenVerify uses `wfv_`.
- **SLA limit.** The API caps `sla-expires-in-seconds` at 90 days; the Help Center says about 61 days for a workflow-set deadline.
- **Run list filter.** `GET /workflow-runs` has one filter, `filter[status]`, described as filtering by workflow id. OpenVerify filters by what the name says, and adds `filter[workflow-id]`.
- **Restore.** One article says restoring a version creates a draft; another says reverting publishes it. OpenVerify creates a draft, which passes every publish rule.

## API resources (path files) (183)

- `account-types/{account-type-id}`
- `accounts`
- `accounts/search`
- `accounts/{account-id}`
- `accounts/{account-id}/add-objects`
- `accounts/{account-id}/add-relation`
- `accounts/{account-id}/add-tag`
- `accounts/{account-id}/consolidate`
- `accounts/{account-id}/relations`
- `accounts/{account-id}/remove-objects`
- `accounts/{account-id}/remove-relation`
- `accounts/{account-id}/remove-tag`
- `accounts/{account-id}/run-action`
- `accounts/{account-id}/set-tags`
- `api-keys`
- `api-keys/{api-key-id}`
- `api-keys/{api-key-id}/clone`
- `api-keys/{api-key-id}/expire`
- `api-logs`
- `api-logs/{api-log-id}`
- `batch-jobs`
- `batch-jobs/{batch-job-id}`
- `batch-jobs/{batch-job-id}/errors`
- `case-templates/{case-template-id}`
- `cases`
- `cases/search`
- `cases/{case-id}`
- `cases/{case-id}/add-comment`
- `cases/{case-id}/add-objects`
- `cases/{case-id}/add-tag`
- `cases/{case-id}/assign`
- `cases/{case-id}/remove-objects`
- `cases/{case-id}/remove-tag`
- `cases/{case-id}/set-status`
- `cases/{case-id}/set-tags`
- `connect/connections`
- `connect/connections/{connection-id}`
- `connect/connections/{connection-id}/deactivate`
- `connect/connections/{connection-id}/reactivate`
- `connect/share-tokens`
- `connect/share-tokens/{share-token-id}`
- `connect/share-tokens/{share-token-id}/expire`
- `connect/share-tokens/{share-token-id}/redeem`
- `deployments`
- `deployments/{deployment-id}`
- `devices`
- `devices/{device-id}`
- `document/generics/{document-id}`
- `document/government-ids/{document-id}`
- `documents/{document-id}`
- `events`
- `events/{event-id}`
- `graph-queries`
- `graph-queries/{graph-query-id}`
- `importer/accounts`
- `importer/list-item/faces` *(added 2026-10-31: in the developer docs, with `image-files[]`; type `importer/list-item/face`)*
- `importer/list-item/field` *(added 2026-10-31: a type in the OpenAPI, with no path)*
- `importer/list-item/email-addresses`
- `importer/list-item/geolocations`
- `importer/list-item/government-id-numbers`
- `importer/list-item/ip-addresses`
- `importer/list-item/names`
- `importer/list-item/phone-numbers`
- `importers`
- `importers/{importer-id}`
- `inquiries`
- `inquiries/search`
- `inquiries/{inquiry-id}`
- `inquiries/{inquiry-id}/add-tag`
- `inquiries/{inquiry-id}/approve`
- `inquiries/{inquiry-id}/decline`
- `inquiries/{inquiry-id}/expire`
- `inquiries/{inquiry-id}/generate-one-time-link`
- `inquiries/{inquiry-id}/mark-for-review`
- `inquiries/{inquiry-id}/perform-simulate-actions`
- `inquiries/{inquiry-id}/print`
- `inquiries/{inquiry-id}/remove-tag`
- `inquiries/{inquiry-id}/resume`
- `inquiries/{inquiry-id}/set-tags`
- `inquiry-sessions`
- `inquiry-sessions/expire-all`
- `inquiry-sessions/{inquiry-session-id}`
- `inquiry-sessions/{inquiry-session-id}/expire`
- `inquiry-sessions/{inquiry-session-id}/generate-one-time-link`
- `inquiry-template-versions`
- `inquiry-templates`
- `inquiry-templates/{inquiry-template-id}`
- `inquiry-templates/{inquiry-template-id}/translations`
- List kinds 12 and 13 *(added 2026-10-31)*: the developer docs name face and selfie-background lists; neither has a list-item path in the OpenAPI.
- `list-item/browser-fingerprints`
- `list-item/browser-fingerprints/{list-item-id}`
- `list-item/countries`
- `list-item/countries/{list-item-id}`
- `list-item/device-fingerprints`
- `list-item/device-fingerprints/{list-item-id}`
- `list-item/email-addresses`
- `list-item/email-addresses/{list-item-id}`
- `list-item/fields`
- `list-item/fields/{list-item-id}`
- `list-item/geolocations`
- `list-item/geolocations/{list-item-id}`
- `list-item/government-id-numbers`
- `list-item/government-id-numbers/{list-item-id}`
- `list-item/ip-addresses`
- `list-item/ip-addresses/{list-item-id}`
- `list-item/names`
- `list-item/names/{list-item-id}`
- `list-item/phone-numbers`
- `list-item/phone-numbers/{list-item-id}`
- `list-item/strings`
- `list-item/strings/{list-item-id}`
- `list/browser-fingerprints`
- `list/countries`
- `list/email-addresses`
- `list/geolocations`
- `list/government-id-numbers`
- `list/ip-addresses`
- `list/names`
- `list/phone-numbers`
- `list/strings`
- `lists`
- `lists/{list-id}`
- `oauth/authorize`
- `oauth/token`
- `privacy-passes`
- `rate-limits`
- `relays`
- `relays/challenge`
- `relays/{relay-token}/generate-claim`
- `reports`
- `reports/{report-id}`
- `reports/{report-id}/add-tag`
- `reports/{report-id}/dismiss`
- `reports/{report-id}/history`
- `reports/{report-id}/pause`
- `reports/{report-id}/print`
- `reports/{report-id}/remove-tag`
- `reports/{report-id}/resume`
- `reports/{report-id}/review`
- `reports/{report-id}/run`
- `reports/{report-id}/set-tags`
- `theme-sets`
- `theme-sets/{theme-set-id}`
- `transaction-types/{transaction-type-id}`
- `transactions`
- `transactions/{transaction-id}`
- `transactions/{transaction-id}/add-objects`
- `transactions/{transaction-id}/add-relation`
- `transactions/{transaction-id}/add-tag`
- `transactions/{transaction-id}/label`
- `transactions/{transaction-id}/redact-biometrics`
- `transactions/{transaction-id}/remove-objects`
- `transactions/{transaction-id}/remove-relation`
- `transactions/{transaction-id}/remove-tag`
- `transactions/{transaction-id}/set-tags`
- `user-audit-logs`
- `user-audit-logs/{user-audit-log-id}`
- `verification/aamvas/{verification-id}`
- `verification/database-ecbsvs/{verification-id}`
- `verification/database-phone-carriers/{verification-id}`
- `verification/database-serpros/{verification-id}`
- `verification/database-standards/{verification-id}`
- `verification/database-tins/{verification-id}`
- `verification/databases/{verification-id}`
- `verification/documents/{verification-id}`
- `verification/email-addresses/{verification-id}`
- `verification/government-id-nfcs/{verification-id}`
- `verification/government-ids/{verification-id}`
- `verification/phone-numbers/{verification-id}`
- `verification/selfies/{verification-id}`
- `verifications/{verification-id}`
- `verifications/{verification-id}/investigation-lock`
- `verifications/{verification-id}/investigation-unlock`
- `verifications/{verification-id}/print`
- `webhook-events/search`
- `webhooks`
- `webhooks/{webhook-id}`
- `webhooks/{webhook-id}/archive`
- `webhooks/{webhook-id}/clone`
- `webhooks/{webhook-id}/disable`
- `webhooks/{webhook-id}/enable`
- `webhooks/{webhook-id}/rotate-secret`
- `workflow-runs`
- `workflow-runs/{workflow-run-id}`
- `workflow-versions`
- `workflows/{workflow-id}/trigger`

## Signal, session, device and network identifiers (Phase 7)

Added 2026-10-30 (Workflow 7A Stage 1a, plan C109) from `docs/research/phase7-behaviour.md`, which read the public documentation pages these come from; the OpenAPI repository this index was extracted from holds none of them. Identifiers only; how each maps to OpenVerify is in `docs/plans/phase-7.plan.md` C90, C91 and C110.

- Resources: `device` (path `devices`, above) and `network` (no path: reached only as an inquiry session's relationship and through `include`).
- Inquiry session attributes: `os-name`, `os-full-version`, `browser-name`, `browser-full-version`, `device-type`, `device-name`, `mobile-sdk-name`, `mobile-sdk-full-version`, `device-handoff-method`, `is-tor`, `is-datacenter`, `is-vpn`, `is-proxy`, `threat-level`, `country-code`, `country-name`, `region-code`, `region-name`, `latitude`, `longitude`, `gps-latitude`, `gps-longitude`, `gps-precision`, `gps-country-code`, `ip-connection-type`, `ip-isp`, `network-organization`.
- Device attributes: `device-vendor-id`, `device-fingerprint`, `browser-fingerprint`.
- Network attributes: `ip-address`, `service-provider`, `service-type`, `proxy-type`, `threat-level` (with `unknown`), `country-code`, `country-name`, `region-code`, `region-name`, `latitude`, `longitude`.
- Inquiry attributes: `signals` (an array of `{ name, value }`, documented outside the OpenAPI inquiry schema) and `behaviors` (in the OpenAPI inquiry schema; its meaning is not documented, deferred in C110).
- Inquiry signal names: `inquiry/bot_score`, `inquiry/behavior_threat_level`, `inquiry/country_from_session`, `inquiry/country_comparison`, `inquiry/geolocation_to_residency_delta`, `inquiry/last_two_verifications_geolocation_delta`.
- Events: `session.created` and `session.expired` appear on the events page; their meaning beside `inquiry-session.*` is not documented, so they are not registered (C110).
- Report type `ip-address` (above) with its public result attributes `service-type`, `datacenter-ip`, `vpn-detected`, `proxy-detected`, `tor-exit-node`, `isp`, `mobile-ip`, `country-code`, `country-name`, `city`, `region`, `latitude`, `longitude`, `error`.

## Template, flow and theme identifiers (Phase 9)

Added 2026-11-05 (Workflow 9A Stage 4, plan C176) from `docs/research/phase9-behaviour.md`, which read the public documentation pages these come from. Identifiers only; how each maps to OpenVerify is in `docs/plans/phase-9.plan.md` C147 to C162.

- Id prefixes: `theset` (theme set) and `dply` (deployment); OpenVerify also uses its own `tsa` (theme asset) and `ssp` (simulation preset).
- Resource type: `inquiry-template-translations` (path `inquiry-templates/{inquiry-template-id}/translations`, above).
- The version theme holds 88 properties (corrected from "about 100" in the behaviour note's fact-check); OpenVerify's theme sets use a closed token set of its own instead (C160).

## Android SDK identifiers (Phase 10)

Added 2026-11-09 (Workflow 10A Stage 4, plan C222) from `docs/research/phase10-android-behaviour.md` (gap rows M3 to M11, M32, M38), which read the public documentation pages these come from. Identifiers only, each marked **built**, **kept** (today's behaviour, documented) or **not built**; how each maps to OpenVerify is in `docs/plans/phase-10.plan.md` C190 to C192 and `docs/android/`.

- Entry points: `fromInquiry` with `sessionToken`: kept, as `OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl)` with the token always required. `fromOneTimeLinkCode`: kept, as `fromOneTimeLink(url, apiBaseUrl)` and `OneTimeLinkContract`, the API always the host's (C190.2). `fromTemplate`, `fromTemplateVersion`: not built (inquiries are created by the customer's server; C223). `toInlineInquiryBuilder`, `createFragment`, `InlineInquiryScreen`: not built (inline mode deferred; C223).
- Builder options: `locale`: built (`Request.locale`, C190.2, C199.2). `styleVariant` (`LIGHT`, `DARK`): built as `appearance` (`SYSTEM`, `LIGHT`, `DARK`; C198.5). `environment`, `environmentId`, `referenceId`, `accountId`, `fields`: not built on the client, set when the server creates the inquiry (C190.1). `shareToken`, `fieldMappings`: not built (Phase 11 Connect).
- Result outcomes: `Complete` (`inquiryId`, `status`): kept as `InquiryResult.Completed(inquiryId, inquiryStatus)`, with no `fields`. `Cancel` (`inquiryId`): kept as `Canceled(inquiryId)`, with no `sessionToken`. `Error` (`debugMessage`, `errorCode`): built as `Failed(inquiryId, reason)` over a closed, published `FailureReason` list with `FLOW_HALTED` added (C190.4, `docs/android/failure-reasons.md`).
- Events: `onEventListener`: built as `OpenVerifyComponents.eventListener` (C192). `StartEvent`: built as `OpenVerifyEvent.Started`. `MiscInquiryEvent` (step transition, camera permission, camera failure, upload): built as `StepShown`, `CameraPermission`, `CaptureFailed`, `Submitted`, `Waiting` and `Ended`, PII-free by an allowlist test (`docs/android/events.md`).
- Resource-name overrides (images, animations, the loader's style): not built (C223).
- Optional modules (Workflow 10E, 2026-11-11): an NFC module that reads a document's chip: built as `openverify-nfc` (`OpenVerifyNfc.chipReader`, on JMRTD; proved on the build host against a synthetic chip, no real document read yet; `docs/android/nfc.md`). On-device face detection for selfie guidance: built as `openverify-face` (`OpenVerifyFace.detectorFactory`, YuNet through ONNX Runtime; guidance only, never a liveness verdict; `docs/android/capture.md`). A device-attestation client: not built (the owner declined a Google Play Integrity artifact; a host implements `IntegrityTokenProvider` itself, `docs/android/device-integrity.md`). Publication to a public Maven repository: not done (pending the owner's accounts; the staged local repository is the release).

## Connect (Phase 11, Workflow 11A; C282)

Added 2026-11-13 by Workflow 11A's integration agent. Each identifier is marked **built** (OpenVerify serves it, under its own name where shown), **kept** (indexed for coverage, served in another shape) or **not built**, with the plan's contract.

Confirmed against the code on 2026-11-20 by Workflow 11E's `integration-11e` (C282), at `cdc2a2ff0`: `EVENT_NAMES` (`packages/contracts/src/`) holds the four token events marked built below and ours, and not `connect/share-token.ready` (`packages/contracts/src/phase11a-common.test.ts` holds that); `docs/api/openapi.json` serves the eight `connect/*` paths marked built, with our `share-policy` and three `consent-records` paths beside them. Nothing in this section needed changing.

Webhook events the machine index missed (connect correction 1):

- `connect/share-token.outbound-created`: built (C239.1)
- `connect/share-token.outbound-redeemed`: built (C239.1)
- `connect/share-token.inbound-created`: built (C239.1)
- `connect/share-token.ready`: not built (a redemption's outcome is `.inbound-redeemed` or `.failed`, C234.8)
- `connect/share-token.inbound-redeemed`: built (C239.1)
- `inquiry.reusable-persona-updated`: not built (reusable personas, C286)
- `inquiry.reusable-persona-assurance-failed`: not built (C286)
- `checkpoint.reusable-persona-used`: not built (C286)

Events listed above that stay as indexed: `inquiry.reusable-persona-created` and `inquiry.reusable-persona-used` are not built (C286).

API resources:

- `connect/connections`: built (create, list; C231.1, C231.2)
- `connect/connections/{connection-id}`: built (retrieve; C231.2)
- `connect/connections/{connection-id}/deactivate`: built (C231.4)
- `connect/connections/{connection-id}/reactivate`: built (C231.5)
- `connect/share-tokens`: built (create, list; C232.1, C232.3)
- `connect/share-tokens/{share-token-id}`: built (retrieve, and `peek-source-data` in the `{visibility, value}` envelope; C232.3, C233)
- `connect/share-tokens/{share-token-id}/expire`: built (C232.4)
- `connect/share-tokens/{share-token-id}/redeem`: built, asynchronous (202 and a job; C234.1)
- Ours, beside them: `connect/connections/{id}/share-policy` (versioned policies, C231.6), the console's activation with a second factor (C231.3), `connect/consent-records` with attest, retrieve and withdraw (C236, C237), the flow's `share-consent` exits (C238.4), the inquiry create's `meta.share-token-id` (client-side redemption, C238.5), and the events `connect/connection.*`, `connect/share-token.expired`, `.failed`, `.consent-withdrawn`, `.source-redacted` and `consent-record.*` (C239.1).

Android SDK builder options (the row above): `shareToken` and `fieldMappings` are kept server-side: a customer's backend creates the inquiry with `meta.share-token-id` and the SDK renders the `share_consent` step it is given (C238.5, C238.7); no token reaches the client.
