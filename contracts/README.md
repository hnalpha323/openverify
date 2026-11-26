# OpenVerify contract fixtures

The JSON files under `fixtures/` are **cross-language golden files**. Each one is a real example of a locked contract from [`docs/plans/phase-1.plan.md`](../docs/plans/phase-1.plan.md) (C1 to C8) or [`docs/plans/phase-2.plan.md`](../docs/plans/phase-2.plan.md) (C9 to C20). The TypeScript, Python and Kotlin test suites all parse the same files, so a contract change breaks every language that has not caught up.

A fixture is the contract. To change one, change the plan and the zod schemas in `@openverify/contracts` first, then update every suite listed below in the same change.

## Layout

| Folder | Contents | Validated by |
|---|---|---|
| `fixtures/api/` | Server API, flow API and webhook documents (C1 to C5, C9 to C16, C19) | `packages/contracts/src/fixtures.test.ts` (zod); Android `openverify-sdk` unit tests (kotlinx.serialization) for the documents the SDK reads |
| `fixtures/flows/` | `default-gov-id-selfie.json`, the default template (C7) | `packages/contracts` (`parseFlow`, template schema), Android |
| `fixtures/vision/` | Vision service responses (C6), owned by the vision service | `services/vision` (pydantic), `apps/api` vision client (zod) |
| `fixtures/webhooks/` | `signature-vectors.json`: webhook signing and verification vectors (C5, C14) | `packages/node/src/webhook-signature.test.ts`, an independent HMAC check in `packages/contracts/src/fixtures.test.ts`, Kotlin if the SDK ever verifies |

`packages/contracts` fails if a file appears in `fixtures/api/` or `fixtures/flows/` without a schema that validates it.

## API fixtures (`fixtures/api/`)

| File | Shape | Schema in `@openverify/contracts` |
|---|---|---|
| `inquiry.json` | `GET /api/v1/inquiries/:id`, a new inquiry | `inquiryDocumentSchema` |
| `inquiry-with-verifications.json` | `GET /api/v1/inquiries/:id?include=verifications`, a completed inquiry with a failed first attempt | `inquiryDocumentSchema` |
| `verification-government-id.json` | `GET /api/v1/verifications/:id`, with its files included | `verificationDocumentSchema` |
| `verification-selfie.json` | `GET /api/v1/verifications/:id` | `verificationDocumentSchema` |
| `flow-session.json` | `GET /api/v1/flow/session` | `flowSessionResponseSchema` |
| `webhook-event-inquiry-completed.json` | `GET /api/v1/events/:id`, and the body of a webhook delivery | `eventDocumentSchema` |
| `problem.json` | An RFC 9457 validation error | `problemSchema` |

Phase 2 servers add attributes to Phase 1 resources (C10, C14, C19). The schemas keep them optional, so Phase 1 documents and event payloads stored before Phase 2 still validate; the Phase 1 fixtures above now show what Phase 2 servers send:
- inquiries carry `tags`, `note`, `expires-at`, `redacted-at`, `decisioned-at` and the `account` relationship;
- events carry `simulated`;
- the flow session carries `environment.kind`.

C20 adds:

| File | Shape | Schema in `@openverify/contracts` |
|---|---|---|
| `account.json` | `GET /api/v1/accounts/:id`, the account of `inquiry.json` | `accountDocumentSchema` |
| `account-type.json` | `GET /api/v1/account-types/:id`, the seeded `user` type | `accountTypeDocumentSchema` |
| `inquiry-template-version.json` | `GET /api/v1/inquiry-template-versions/:id`, a published version 2 with check config, allowed countries and ID classes, and settings | `inquiryTemplateVersionDocumentSchema` |
| `inquiry-session.json` | `GET /api/v1/inquiry-sessions/:id`, an active session of `inquiry.json` | `inquirySessionDocumentSchema` |
| `webhook-delivery.json` | `GET /api/v1/webhook-deliveries/:id`, pending after a 503 | `webhookDeliveryDocumentSchema` |
| `api-log.json` | `GET /api/v1/api-logs/:id`, a `resume` call with its secrets redacted | `apiLogDocumentSchema` |
| `api-key.json` | `GET /api/v1/api-keys/:id`, shown by its token prefix | `apiKeyDocumentSchema` |
| `role.json` | `GET /api/v1/dashboard/roles/:id`, the built-in `reviewer` role | `roleDocumentSchema` |
| `user-audit-log.json` | `GET /api/v1/user-audit-logs/:id`, an approval by a user | `userAuditLogDocumentSchema` |
| `rate-limit.json` | `GET /api/v1/rate-limits`, the `api` policy | `rateLimitListDocumentSchema` |
| `event-inquiry-approved.json` | An `inquiry.approved` event | `eventDocumentSchema` |
| `event-account-consolidated.json` | An `account.consolidated` event, with the archived source account included | `eventDocumentSchema` |

Phase 5 (C50.6) adds a golden full resource of each new verification type, built with `buildVerificationResource` and served as Phase 5 servers serve it (every check with its C50.8 `category`; the two Phase 1 verification fixtures gained it too):

| File | Shape | Schema in `@openverify/contracts` |
|---|---|---|
| `verification-document.json` | `GET /api/v1/verifications/:id`, a utility bill PDF with its preview included | `verificationDocumentSchema` |
| `verification-database.json` | A sandbox record matched through the default match group | `verificationDocumentSchema` |
| `verification-aamva.json` | The silent AAMVA step skipped for a jurisdiction that does not take part | `verificationDocumentSchema` |
| `verification-phone-number.json` | A phone number confirmed on its second code | `verificationDocumentSchema` |
| `verification-email-address.json` | An email address confirmed | `verificationDocumentSchema` |
| `verification-government-id-nfc.json` | A synthetic Utopia chip, every required check passed | `verificationDocumentSchema` |
| `verification-crypto-wallet.json` | An EVM signature that recovers to the claimed address | `verificationDocumentSchema` |
| `verification-database-business.json` | A sandbox registry record found and active | `verificationDocumentSchema` |
| `verification-business-website.json` | A resolving website whose advisory domain age failed | `verificationDocumentSchema` |

`problems/flow/` (C52.7) holds one golden problem per frozen Phase 5 problem code (`PHASE5_PROBLEM_STATUSES`), named by the code with hyphens.

Phase 6 (C70) adds a golden report of each type, the report template resources, a history page and the console's watchlist sources. Every value is synthetic: fictional persons and companies, the sandbox lists (`openverify-sandbox`, `openverify-sandbox-pep`, with fictional `Q-test-…` ids), `*.example` and `example.test` domains, a NANP `555` number and an address derived from a published test key:

| File | Shape | Schema in `@openverify/contracts` |
|---|---|---|
| `report-watchlist.json` | `GET /api/v1/reports/:id`, a recurring person screening with one open match in the sandbox list | `reportDocumentSchema` |
| `report-business-watchlist.json` | A company matched by name and LEI; the warning and fitness-and-probity lists `null` with `list_not_configured` | `reportDocumentSchema` |
| `report-crypto-address-watchlist.json` | An exact canonical match on an EVM address, no exposure provider | `reportDocumentSchema` |
| `report-politically-exposed-person.json` | A fictional office holder of class 1 in the sandbox PEP list | `reportDocumentSchema` |
| `report-adverse-media.json` | A person named in one synthetic sandbox article, with the media coverage limits | `reportDocumentSchema` |
| `report-business-adverse-media.json` | The same for a company | `reportDocumentSchema` |
| `report-email-address.json` | A `sandbox-breached` address: band `medium` for a recent breach, deliverability `not_linked` | `reportDocumentSchema` |
| `report-phone-number.json` | A `555 0103` number: SIM swap within 24 h, `high` | `reportDocumentSchema` |
| `report-address-lookup.json` | House number `1002`: not confirmed | `reportDocumentSchema` |
| `report-template.json` | `GET /api/v1/report-templates/:id`, the seeded sandbox watchlist template, monthly | `reportTemplateDocumentSchema` |
| `report-template-version.json` | `GET /api/v1/report-template-versions/:id`, its published version 1 | `reportTemplateVersionDocumentSchema` |
| `report-history.json` | `GET /api/v1/reports/:id/history`, a review action and the initial run, newest first | `reportHistoryDocumentSchema` |
| `dashboard-watchlist-sources.json` | `GET /api/v1/dashboard/watchlist-sources`, a synced, an unconfigured and a sandbox source | `dashboardWatchlistSourcesSchema` |

`problems/reports/` (C72.4) holds one golden problem per frozen report problem code (`REPORT_PROBLEM_STATUSES`), named by the code with hyphens.

`POST /webhooks/:id/simulate` builds its sample events from these files: `inquiry.json` for `inquiry.*`, `inquiry-session.json` for `inquiry-session.*`, the verification fixtures for `verification.*`, `account.json` for `account.*` and `report-<type>.json` for `report/<type>.*` (C70.4).

Each file must parse and re-serialize (`z.encode`) to exactly the same JSON, which is what the API's response serializer does.

## Flow fixture (`fixtures/flows/default-gov-id-selfie.json`)

The file holds the attributes of a `POST /api/v1/inquiry-templates` request: `{ name, flow, verification-config }`.

- `flow` passes `parseFlow()` from `@openverify/flow-spec`: consent, a two-sided government ID, a center selfie with passive liveness, completion, and a failure step.
- Transition conditions are JSONLogic over `{ "inquiry": { "status": ... } }`, built by `flowConditionContext()` from the latest `GET /api/v1/flow/session`. A failed inquiry routes to the `failure` step; otherwise the next step in the list runs.
- `verification-config` enables and requires exactly the seven C7 checks. A check that is not listed is disabled.
- `defaultInquiryTemplateAttributes()` returns the same object in TypeScript, for seeds and tests.
- Translation keys the clients need: `consent.biometric`, `consent.processing`, `flow.completion`, `flow.failure`.

## Webhook vectors (`fixtures/webhooks/signature-vectors.json`)

The vectors were generated independently with Python's `hmac` module and cross-checked with `openssl dgst -sha256 -hmac`. They cover signing, rotation (two `v1=` values), tolerance edges in both directions, tampering, re-encoded bodies and malformed headers.

- `sign[]`: `secret`, `timestamp`, `body` and the expected `signature` and `header`.
- `signMultiple[]`: one header signed with several secrets, one `v1=` per secret in order. `rotation-new-then-previous-secret` is the C14 dual signature during a secret rotation: `t=<t>,v1=<new> v1=<old>`.
- The `dual-*` entries of `verify[]` (C14) check that a dual-signed delivery verifies with the new secret, with the previous one, with both, and with the signatures in either order, and that a wrong secret, a tampered body or an old timestamp still fails.
- `verify[]`: `secrets`, `body`, `header`, `now` (unix seconds), an optional `toleranceSeconds`, and the expected outcome. An invalid outcome names its reason: `malformed_header`, `no_matching_signature` or `timestamp_outside_tolerance`, checked in that order.

Bodies are raw strings. The HMAC covers the exact bytes received, so a verifier must never re-serialize the JSON before checking.

## Conventions the fixtures pin down

- **IDs** are `<prefix>_<ULID>` with 26 uppercase Crockford base32 characters (`newId`, `isId` and `idSchema` in `@openverify/contracts`). Phase 2 adds `acc`, `acctp`, `role`, `aud`, `alog` and `mfa` (C9).
- **Attribute names** are kebab-case. **Enum values** are the `@openverify/core` values unchanged (`needs_review`, `not_applicable`, `drivers_license`), except verification types: `government-id` in request bodies and config keys, `verification/government-id` as a resource type.
- **Timestamps** are ISO-8601 UTC with a `Z` suffix.
- **Problem documents** keep the Phase 0 `requestId` extension member, in camelCase. Phase 2 problem types are `https://openverify.dev/problems/<slug>` (`PROBLEM_TYPES`), and an inactive flow session answers 401 with `code: "session_expired"` or `"session_canceled"`.
- **Secrets** are never readable after creation: webhook secrets show `secret-last4`, API keys their `token-prefix`, and webhook custom header values `[REDACTED]`.
- **Flow views of a verification** carry only `status` and `retry-hints`. Hints name only `user_behavior` checks, never fraud checks.
- **Reason codes** for the Phase 1 checks are listed in `PHASE1_CHECK_REASONS`. An enabled check with no implementation reports `pending` with reason `not_implemented`. Clients fall back to a generic message for a code they do not know.

## Synthetic data only

Every value is invented for tests: names such as "Jane Sample", references such as `ref-test-001`, emails under `example.test`, IP addresses from the documentation ranges (`203.0.113.0/24`, `198.51.100.0/24`), and webhook secrets labelled `wbhsec_test_...`. Fixtures never contain real personal data, face images or biometric embeddings. The vision fixtures' embeddings are synthetic numbers, and the API fixtures contain none.
