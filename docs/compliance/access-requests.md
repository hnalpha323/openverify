# Access and other requests

This is not legal advice.

Not reviewed by counsel.

How an operator answers a person who asks for their data, or asks for it to be erased, with what OpenVerify provides (C253, C16) and what the software cannot do for you (C278.4).

## Time limits

- **UK** (re-read on 2026-11-20, [S2](sources.md), [S4](sources.md)): Article 12(3) of the UK GDPR asks the controller to say what it did about a request under Articles 15 to 22D without undue delay and within the "applicable time period" of Article 12A. Section 76 of the Data (Use and Access) Act 2025 inserted Article 12A (in force from 2026-02-05): one month from the latest of receiving the request, receiving information asked for to confirm identity, and receiving a fee where one may be charged; extendable by two further months for complex or numerous requests, with notice and reasons before the first month ends; and, for an access request, the time spent waiting for information the controller reasonably needs to find the data does not count.
- **Searches** (UK, re-read): section 78 of the same Act added Article 15(1A): the right of access reaches what the controller can find after a reasonable and proportionate search (treated as in force from 2024-01-01).
- **EU:** Article 12(3) of the EU GDPR sets one month, extendable by two further months, in the Regulation as published; **not re-read on 2026-11-20: EUR-Lex returned no text** ([S1](sources.md)).
- **US states:** each law has its own period; none is summarised here.

## Access: the account export (C253)

`POST /api/v1/accounts/:id/export` (scope `account-access:export`; a user also needs `pii:view` and a step-up within the last 10 minutes) starts an export of one account. When it is `ready`, `GET /api/v1/account-exports/:id/manifest` serves one JSON document, `openverify.account-export.v1`, and `GET /api/v1/account-exports/:id/files/:fileId` serves each listed file from its live object (410 `account_export_item_redacted` once that file is redacted). Both downloads are audited. The contract is `packages/contracts/src/account-exports.ts`; the manifest is built in `apps/api/src/services/account-export/manifest.ts`.

**What it holds.** The manifest has two parts:

- `subject`: the account and its fields; its inquiries with fields, statuses and sessions (time, consent records with their texts, address and user agent); verifications with extracted data and check results; decisions; reports with their queries, matches and dispositions; devices (present with first and last seen, never their fingerprints); transactions; Connect tokens and consent records, with each recipient of a redeemed share named as the person was shown it; face templates as a count only. Each file is listed with its kind, size and SHA-256.
- `operator-review`, labelled **review before disclosure**: cases and their comments, list memberships, signals and device-integrity verdicts. Some of this may fall under an exemption you must judge before you disclose it (below).

**What it does not cover.** The manifest's `not-covered` part states each of these in a fixed sentence (`ACCOUNT_EXPORT_NOT_COVERED`):

| Kind | What it means for your answer |
|---|---|
| `api-logs` | API logs are kept a short time (`api-log-retention-days`, default 30 days) and are not indexed by account; search them yourself if your law reaches them |
| `webhook-deliveries` | The same for webhook deliveries (`webhook-delivery-retention-days`) |
| `event-payloads` | Event payloads are not included; after a redaction they hold no personal data |
| `backups` | Backups keep data until they expire and are not searched |
| `outside-install` | Data held outside the install (your own systems, a share's recipient) is not included |
| `face-templates` | Face templates are listed as present with their count, not exported (whether that holds under the right of access is a question for counsel) |

CSV exports and bulk report jobs are not in the manifest either (Workflow 11B, dsar-export amendment 5).

**The counterparty's records are excluded.** For Connect the export reads only through `listSharesTouching` (`apps/api/src/services/connect/cross-tenant.ts`): it holds the tokens on either side and only the exporting environment's own consent records, never the other organisation's records, users, keys or audit entries (Workflow 11B Stage 1a amendment 23).

**Limits.**

- One pending export per account (409 `account_export_pending`); at most 5,000 manifest items (`ACCOUNT_EXPORT_LIMITS`), beyond which the export is refused with the counts (422 `account_export_too_large`), never truncated.
- The policy `account-export` allows at most 10 exports an hour per environment and fails closed: when the rate store is unreachable the API answers 503 `account_export_unavailable` rather than export unmetered. It is provisional (ours), because one key exporting every account in turn is the platform's widest exfiltration path.
- An export is kept for `account-export-ttl-days` (1 to 30 days, default 7) after it is ready, then `expired` and deleted by the retention pass. A redaction of an item it lists deletes the export first (C253.4).
- **A known limit (KP11-27, in part fixed in Workflow 11F):** a report's or a transaction's redaction now deletes the exports that list it first, as an inquiry's does. The other retention steps that are not a redaction cascade (the collector components' nulling, the address nulling, device and list-item expiry, report, transaction, graph-query, workflow, case and decision-record retention) do not yet delete the exports that list what they remove. Until that is fixed, an export can outlive such a step by at most `account-export-ttl-days`. Shorten that window if this matters to you.

## Access in practice: what you still do

The export is what the install holds about the account at that moment, through the account's links (C253.6). To answer a request you still:

1. **Confirm who is asking**, before you start the clock or export anything.
2. **Search beyond the account's links**: inquiries never attached to an account, list items about the person (lists hold third-party data, [lists](lists-graph-transactions.md)), workflow runs and cases that name them by value, API logs and webhook deliveries within their windows, your own systems and any recipient's copy.
3. **Judge the `operator-review` part** before disclosure. Exemptions are the law's, not the software's. One example in the UK is tipping off: section 333A of the Proceeds of Crime Act 2002 (re-read on 2026-11-20, [S15](sources.md)) makes it an offence, for a person in the regulated sector, to disclose that a suspicious activity disclosure was made, or that an investigation is contemplated or under way, where that is likely to prejudice an investigation (subject to the exceptions of ss. 333B to 333D). A case or a list membership can reveal exactly that. Which exemptions apply is a question for counsel ([questions for counsel](questions-for-counsel.md)).
4. **Name the recipients**: Article 15(1)(c) of the UK GDPR (re-read, [S2](sources.md)) includes the recipients or categories of recipient. The export names each Connect recipient; the providers you bind are listed on [recipients](recipients.md).
5. **Answer within the time limit**, and record what you did.

## Erasure: redaction

- `POST /api/v1/inquiries/:id/redact` and `POST /api/v1/accounts/:id/redact` redact irreversibly (`apps/api/src/services/redaction.ts`): files are deleted from storage with every version; fields, notes, the sessions' and consents' address and user agent are nulled; check metadata and reasons emptied; stored event payloads become stubs and stored API log bodies about the object are dropped; `inquiry.redacted` or `account.redacted` is emitted. An account's redaction redacts its inquiries first, and either reaches the subject's transactions (owner decision 1 after Workflow 7B).
- A redaction also reaches the person's face templates and selfie backgrounds, biometric list items taken from the inquiry, list matches, network evaluations, signal bodies, integrity verdicts, reports, the graph's entries (the account is also removed from stored graph results) and the sealed evidence of Connect consent records (the subject's tables are listed in `apps/api/src/services/redaction.test-support.ts`, whose test seeds and scans each one); a case redacts only itself (`docs/cases/redaction.md`). A device row (pseudonymous fingerprints) goes by `device-retention-days`, and a graph query's parameters, the searcher's record, by `graph-query-retention-days` ([retention](retention.md)).
- Connect: a share not yet redeemed fails; a redeemed copy belongs to its destination, which receives an advisory event (C241.2; [sharing](sharing.md)).
- **Not reached:** backups until they expire ([retention](retention.md)), and anything outside the install. Under Article 19 of the UK GDPR (re-read, [S2](sources.md)) you tell each recipient of an erasure or rectification unless that is impossible or disproportionate, and tell the person who they are if asked.

## Rectification, restriction and objection

There is no rectification route for verification evidence: a verification records what was presented. Account fields can be updated through the accounts API; a wrong decision is handled through the contest route of Phase 8 ([automated decisions](automated-decisions.md)). Restriction and objection are handled by your own procedures (for example, a case and a hold on the account's workflows).
