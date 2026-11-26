# Plan: Phase 2, core platform depth

- **Source:** `docs/PLAN.md` §6, Phase 2; coverage checklist `docs/research/persona-surface.md`
- **Complexity:** Large
- **Runs:**
  - Workflow 2A (backend, 9 agents);
  - Workflow 2B (review, verify, fix; at most 10 agents);
  - Workflow 2C (dashboard UI for every Phase 2 feature, plus the web flow and Android changes of C19; 6 agents in three stages, see "Workflow 2C (clients)");
  - Workflow 2D (review of 2C);
  - Workflow 2E (API gaps reported by 2C, the remaining console pages and the 2D carry-over; see "Workflow 2E").
- **Builds on:** `docs/plans/phase-1.plan.md`. Contracts C1–C8 still hold. This file adds C9–C20 and changes nothing in C1–C8 except where a section below says so explicitly.

## Summary

Phase 1 proved one thin path. Phase 2 turns it into a platform that a customer could run:

1. **Lifecycle.** Operators and API callers can approve, decline, mark for review, expire, tag and redact inquiries. Inquiries expire on their own. Sessions can be listed and expired. Single-use one-time links can be sent to end users. Verifications get their own state machine.
2. **Templates.** Template versions get a draft → published lifecycle, and checks get per-template configuration.
3. **Accounts.** Accounts group a person's inquiries:
   - types, fields and tags;
   - relations between accounts;
   - consolidating duplicates;
   - redaction.
4. **Integration surface:**
   - complete webhooks: secret rotation with dual signing, filters, custom headers, an attribute blocklist, simulation, replay and a longer retry schedule;
   - the Events API, the API-keys API and API logs;
   - idempotency keys, rate limiting and a date-versioned API header;
   - sandbox simulation.
5. **Operators.** The server API also accepts dashboard user sessions, with role-based access control (built-in and custom roles). Also:
   - users and invitations;
   - user audit logs;
   - MFA with TOTP, WebAuthn and recovery codes;
   - switching between sandbox and production.
6. **Data lifecycle.** Retention policies, redaction jobs and KEK rewrap.
7. **Clients:**
   - `@openverify/node` becomes a typed API client;
   - the web flow and the Android SDK handle one-time links, expired and canceled sessions, and sandbox mode.

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Contracts | `packages/contracts/src/inquiries.ts`, `json-api.ts` | Strict zod schemas plus validated builders. Every new resource gets a golden fixture in `contracts/fixtures/api/` |
| Domain | `packages/core/src/inquiry-state-machine.ts` | Pure transition tables, `DomainError` subclasses, and the event name returned from the transition |
| Routes | `apps/api/src/routes/server/inquiries.ts` | A Fastify plugin per resource, zod type provider, scope declared per route, problem+json errors |
| Services | `apps/api/src/services/inquiries.ts`, `services/context.ts` | Environment-scoped service functions that take a context; transactions in the service, not the route |
| Events | `apps/api/src/events/index.ts` | `stage(tx, input)` inside the business transaction, then `dispatch(staged)` after commit |
| Jobs | `apps/api/src/jobs/process-verification.ts`, `apps/api/src/worker.ts` | BullMQ processors with injected ports, idempotent on retry |
| Data access | `packages/db/src/repositories/*.ts`, `tables/*.ts` | Drizzle tables with `idFormat`, `environment_id` on every row, repository functions with a Testcontainers test each |
| PII at rest | `packages/db/src/crypto.ts` (`encryptedJson`, `encryptBytes`) | Envelope encryption with an AAD context string per column |
| Auth | `apps/api/src/plugins/api-key-auth.ts`, `apps/api/src/operator-auth/` | Bearer parsing, hashed tokens, generic 401 |
| Tests | `apps/api/src/routes/server/*.test.ts`, `*.integration.test.ts`, `e2e/specs/*.spec.ts` | Vitest unit tests with the harness in `apps/api/src/test-support/harness.ts`, Testcontainers integration, full-stack Playwright |

## Locked contracts

### C9. Conventions added in Phase 2

- **New ID prefixes:**

  | Prefix | Object |
  |---|---|
  | `acc` | account |
  | `acctp` | account type |
  | `role` | role |
  | `aud` | user audit log entry |
  | `alog` | API log entry |
  | `mfa` | MFA factor |

- **New resource `type` values:**
  - `account`
  - `account-type`
  - `role`
  - `user-audit-log`
  - `api-log`
  - `inquiry-template-version`
  - `webhook-delivery`
  - `mfa-factor`
  - `rate-limit`

  `inquiry-session` already exists.
- **New tokens.** All are 43 base64url characters after the prefix. Each is stored only as a SHA-256 hash and compared in constant time.

  | Prefix | Purpose | TTL |
  |---|---|---|
  | `ovo_` | One-time link token, single use | default 24 h, at most 30 days, never past the inquiry's `expires-at` |
  | `ovm_` | MFA challenge token, issued after a correct password when MFA is on | 5 min, single use |
  | `ovi_` | Invitation token | 7 days, single use |

  Recovery codes are 10 codes per user of the form `xxxx-xxxx-xxxx` (Crockford base32). They are stored as Argon2id hashes and each can be used once.
- **Action endpoints** follow `POST /api/v1/<resource>/:id/<action>`. The body is optional: `{ "meta": { ... } }`. The response is the updated resource.
- **Tags:**
  - Unicode letters, digits, space and `_ . : - /`; 1–64 characters after trimming.
  - Case is preserved, but tags are unique per object ignoring case.
  - At most 50 per object.
  - `set-tags` replaces the whole list.
- **List filters:**
  - `filter[<attribute>]`, with comma-separated values meaning OR;
  - dates as `filter[created-at-start]` and `filter[created-at-end]` (ISO-8601, inclusive start, exclusive end);
  - all lists use the C1 cursor.
- **New problem `type` slugs**, each as `https://openverify.dev/problems/<slug>`:

  | Slug | Status |
  |---|---|
  | `invalid-transition` | 409 |
  | `template-archived` | 422 |
  | `idempotency-key-reused` | 422 |
  | `idempotency-key-in-use` | 409 |
  | `rate-limited` | 429 |
  | `unsupported-api-version` | 400 |
  | `sandbox-only` | 403 |
  | `forbidden` | 403, a user principal without the permission |
  | `mfa-required` | 401 |
  | `redacted` | 410, a redacted resource's PII or file was requested |

  Phase 1's `about:blank` types stay for the existing errors.

### C10. Inquiry, session and verification lifecycle

**Inquiry actions** (server API; the scope is `inquiries:write` unless stated):

| Method and path | Effect | Events |
|---|---|---|
| `POST /inquiries/:id/approve` | `completed`, `failed` or `needs_review` → `approved` | `inquiry.approved`, `inquiry.transitioned` |
| `POST /inquiries/:id/decline` | same sources → `declined` | `inquiry.declined`, `inquiry.transitioned` |
| `POST /inquiries/:id/mark-for-review` | `completed` or `failed` → `needs_review` | `inquiry.marked-for-review`, `inquiry.transitioned` |
| `POST /inquiries/:id/expire` | `created` or `pending` → `expired`. Active sessions become `canceled`; `initiated` verifications become `canceled` | `inquiry.expired`, `inquiry.transitioned`, `inquiry-session.canceled`, `verification.canceled` |
| `POST /inquiries/:id/add-tag`, `/remove-tag` | `meta: { tag-name }` | `inquiry.updated-tags` |
| `POST /inquiries/:id/set-tags` | `meta: { tag-names: [] }` | `inquiry.updated-tags` |
| `PATCH /inquiries/:id` | `fields` (merged; only while `created` or `pending`), `reference-id`, `note` (at most 2,000 characters, encrypted) | none |
| `POST /inquiries/:id/generate-one-time-link` | `meta: { expires-in-seconds? }`. Only for `created` or `pending` inquiries. Revokes older unused links. Returns `meta: { one-time-link, expires-at }` | none |
| `POST /inquiries/:id/redact` (scope `inquiries:redact`) | See C16 | `inquiry.redacted` |
| `POST /inquiries/:id/perform-simulate-actions` | Sandbox only (production: 403 `sandbox-only`). `meta: { actions: [{ type }] }`, with `type` one of `start_inquiry`, `complete_inquiry`, `fail_inquiry`, `expire_inquiry`, `approve_inquiry`, `decline_inquiry`, `mark_for_review_inquiry`. Actions run in order; each must be a valid transition | as for the real action |

- **Transitions.** Allowed transitions are exactly `INQUIRY_TRANSITIONS` in `packages/core`. Any other transition answers 409 `invalid-transition`. `inquiry.transitioned` carries `payload.meta: { from, to }`.
- **`GET /inquiries` gains filters:**
  - `filter[account-id]`
  - `filter[inquiry-template-id]`
  - `filter[tag]`
  - `filter[created-at-start]` and `filter[created-at-end]`
- **New inquiry attributes:**
  - `tags`
  - `note`
  - `expires-at`
  - `redacted-at`
  - `decisioned-at`
  - relationship `account`
  - relationship `inquiry-template-version` (Workflow 2E, C25.4): `{ data: { type: 'inquiry-template-version', id } }`, the version the inquiry pinned at creation. Every server and dashboard answer that returns an inquiry, and every `inquiry.*` event payload, carries it; it is optional in `inquiryRelationshipsSchema`, so earlier answers still parse. The flow API returns no inquiry resource (`GET /flow/session` has `inquiry: { id, status }`), so it is unchanged.
- **Expiry.** `expires-at` = creation time + the template version's `settings.inquiry-expiration-seconds`.
  - The default is 86,400; the range is 300–2,592,000.
  - A repeatable BullMQ job (`inquiry-expiry`, every 60 s) expires overdue `created` and `pending` inquiries with the same effects as the `expire` action.
- **One-time links:**
  - Format: `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&one-time-token=ovo_...`.
  - The flow redeems it with `POST /api/v1/flow/one-time-links/redeem`. This route needs no auth.
    - Body: `{ "inquiry-id", "one-time-token" }`.
    - Response: `{ "session-token", "expires-at" }`. It succeeds exactly once.
    - Any failure (unknown, used, expired, wrong inquiry, inquiry not `created` or `pending`) answers the same generic 401.
    - Rate-limited per IP (C12).
- **Inquiry sessions** (resource `inquiry-session`):
  - **Attributes:**
    - `status`: `active`, `expired` or `canceled`;
    - `created-at`, `started-at` (the first flow API call) and `expires-at`;
    - `ip-address` and `user-agent` from the first flow call (encrypted; masked without `pii:view`, C15);
    - relationship `inquiry`.
  - **Endpoints:**

    | Method and path | Scope |
    |---|---|
    | `GET /inquiry-sessions?filter[inquiry-id]=`, `GET /inquiry-sessions/:id` | `inquiry-sessions:read` |
    | `POST /inquiry-sessions/:id/expire` | `inquiry-sessions:write` |
    | `POST /inquiry-sessions/expire-all` with `meta: { inquiry-id }` | `inquiry-sessions:write` |

  - **Events:**
    - `inquiry-session.started`, when the first flow call succeeds;
    - `inquiry-session.expired`, when the TTL passes (the job above) or the session is expired explicitly;
    - `inquiry-session.canceled`, when the inquiry leaves `created` or `pending` while the session is active.
  - **Flow API on an inactive session:** a call with an expired or canceled session token answers 401. The problem body has `code: "session_expired"` or `"session_canceled"`, so the flow can show the right screen.
    - Workflow 2E (C25.8): `session_canceled` also carries `reason`, derived from the inquiry when the call is made: `inquiry_redacted` when it is redacted, `inquiry_expired` when its status is `expired`, `inquiry_finished` otherwise. `session_expired` has no reason. `reason` is an optional, enumerated member of `problemSchema` (`SESSION_CANCELED_REASONS`, `sessionCanceledReasonSchema`). Golden problems: `contracts/fixtures/problems/session-canceled-inquiry-{expired,finished,redacted}.json`.
  - `settings.session-expiration-seconds` defaults to 86,400.
- **Verification state machine** (`packages/core/src/verification-state-machine.ts`):

  | From | To |
  |---|---|
  | `initiated` | `submitted`, `confirmed`, `canceled`, `skipped` |
  | `confirmed` | `submitted`, `passed`, `failed`, `canceled` |
  | `submitted` | `passed`, `failed` |
  | `passed`, `failed`, `canceled`, `skipped`, `requires_retry` | terminal |

  - Nothing ever enters `requires_retry` (deprecated).
  - New events: `verification.canceled` and `verification.skipped`. The skipped transition is in core now; Phase 6 workflows emit it.
  - Every status write in the API and the worker goes through `transitionVerification()`.

### C11. Templates and verification configuration

- **Template status.** `inquiry-templates` gain `status`: `active` or `archived`. `PATCH /inquiry-templates/:id` changes `name` and `status` (scope `inquiry-templates:write`). Creating an inquiry from an archived template answers 422 `template-archived`.
- **Template versions** (resource `inquiry-template-version`):
  - **Attributes:**
    - `version-number`;
    - `status`: `draft`, `published` or `superseded`;
    - `flow`, `verification-config` and `settings`;
    - `created-at` and `published-at`;
    - relationship `inquiry-template`.
  - **Endpoints:**

    | Method and path | Scope | Purpose |
    |---|---|---|
    | `POST /inquiry-template-versions` | `inquiry-templates:write` | Body attributes: `inquiry-template-id`, `flow`, `verification-config`, `settings`. Creates a draft with `version-number = max + 1`. Validation is the same as Phase 1 template creation |
    | `PATCH /inquiry-template-versions/:id` | `inquiry-templates:write` | Drafts only; anything else answers 409 `invalid-transition` |
    | `POST /inquiry-template-versions/:id/publish` | `inquiry-templates:publish` (new scope) | Drafts only. The previous published version becomes `superseded`. The template's `current-version` points at the new one |
    | `GET /inquiry-template-versions?filter[inquiry-template-id]=`, `GET /inquiry-template-versions/:id` | `inquiry-templates:read` | Read versions |

  - **Pinning.** Inquiries pin the version that was current at creation (Phase 1 behaviour). Publishing never changes existing inquiries. Since Workflow 2E (C25.4) the inquiry names that version in its relationship `inquiry-template-version` (C10).
  - `POST /inquiry-templates` still creates the template with version 1 published.
- **`settings`** (zod, all optional, defaults applied on read):

  | Setting | Default | Range |
  |---|---|---|
  | `inquiry-expiration-seconds` | 86,400 | 300–2,592,000 |
  | `session-expiration-seconds` | 86,400 | 300–2,592,000 |
  | `one-time-link-expiration-seconds` | 86,400 | 300–2,592,000 |
  | `retention-days` | `null` (the environment default applies) | 1–3,650 |

- **`verification-config` v2.** Additive; v1 documents stay valid.
  - **Per check:** `{ enabled, required, config? }`. `config` is validated by the check's `configSchema`, a new optional field on `CHECK_REGISTRY` entries.
    - Phase 2 adds config schemas for the 7 Phase 1 checks:

      | Check | Config |
      |---|---|
      | `id_blur_detection` | `{ "min-blur-score": 10–1000 }` |
      | `id_glare_detection` | `{ "max-glare-ratio": 0.001–0.5 }` |
      | `selfie_image_quality_detection` | `{ "min-blur-score", "min-brightness", "max-brightness" }` |
      | `selfie_id_comparison` | `{ "threshold": 0.25–0.6 }` |

    - The remaining three take no config.
    - The worker applies configured thresholds to vision's raw scores. A check without `config` uses the vision defaults, as in Phase 1.
  - **Per verification type:** optional `allowed-countries` (ISO 3166-1 alpha-2) and `allowed-id-classes` (core `ID_CLASSES`). These are validated now and enforced by the Phase 3 checks.
  - `maxAttempts` stays on the flow step, where Phase 1 put it.

### C12. Platform HTTP behaviour (server API)

- **Principals.** Every server API route accepts either:
  - an API key (`ov_sbx_…` / `ov_prod_…`), or
  - a dashboard user session (`ovu_…`).

  The auth plugin sets `request.principal`:
  ```ts
  type Principal =
    | { kind: 'api-key'; apiKeyId: string; organizationId: string; environmentId: string;
        environmentKind: 'sandbox' | 'production'; permissions: ReadonlySet<Permission>;
        piiMasked?: boolean /* Workflow 2B F001, see C15 masking */ }
    | { kind: 'user'; userId: string; userSessionId: string; organizationId: string; environmentId: string;
        environmentKind: 'sandbox' | 'production'; permissions: ReadonlySet<Permission>; mfaSatisfied: boolean };
  ```
  - A route declares one `Permission` (C15).
  - An API key without the permission answers 403 `forbidden`. Phase 1 answered 403 too, so the status is unchanged.
  - A user without the permission also answers 403 `forbidden`.
  - Cross-environment resources still answer 404.
  - **Includes** (Workflow 2D K001, an amendment of C12 and C15 for the owner to confirm). An `include` adds resources that have their own route, so it needs that route's permission as well. `GET /inquiries/:id?include=verifications` by a principal without `verifications:read` answers the same 403 `forbidden` problem as a missing route scope, naming `verifications:read`. The dashboard inquiry detail (`GET /dashboard/inquiries/:id`, which always includes) answers an operator without `verifications:read` with the verification relationship identifiers and an empty `included` (no verification and no file resources), and the dashboard says the verifications need that permission. These are the only routes that include verifications. Event payloads (`events:read`) and API-log bodies (`api-logs:read`) are their own views and are unchanged.
- **Idempotency.**
  - **Applies to:** `Idempotency-Key` header (1–255 printable ASCII characters) on server API `POST` and `PATCH` requests.
  - **Storage:** `idempotency_keys` (environment, principal, key) holds:
    - a request fingerprint: SHA-256 of method, route and canonical JSON body (for multipart, the part names, sizes and SHA-256 digests);
    - the stored response (status, body encrypted, `content-type`, `location`);
    - a 24 h expiry.
  - **Replay:** the same key with the same fingerprint replays the stored response with `Idempotent-Replayed: true`.
  - **Conflicts:**
    - a different fingerprint answers 422 `idempotency-key-reused`;
    - a request whose key is still in progress answers 409 `idempotency-key-in-use`.
  - **5xx:** responses are not stored; the key is released.
- **Rate limiting.** A GCRA limit in Valkey, applied atomically by one Lua script.

  | Policy name | Key | Default |
  |---|---|---|
  | `api` | API key or user session | 300 requests/min (`OPENVERIFY_RATE_LIMIT_API_PER_MINUTE`) |
  | `flow-session` | session token | 120/min |
  | `flow-ip` | client IP, flow API | 600/min |
  | `one-time-link-redeem` | client IP | 30/min |

  - **Headers.** Every server API response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds).
  - **429.** Over the limit: 429 `rate-limited` with `Retry-After`.
  - **If Valkey is down:** the limiter fails open, logs an error and adds no headers. Availability matters more than limits for a self-hosted API; the decision is recorded in the code.
  - **`GET /rate-limits`** (any principal) lists `rate-limit` resources for the caller: `name`, `limit`, `window-seconds`, `remaining`, `reset-at`.
- **API version.**
  - `API_VERSIONS = ['2026-10-01']` in contracts.
  - The request header `OpenVerify-Version` is optional. When absent, the API key's `api-version` applies; user sessions get the latest version.
  - An unknown version answers 400 `unsupported-api-version`.
  - Every server API response echoes `OpenVerify-Version`. Webhooks have an `api-version`, and deliveries send the header.
- **API logs** (resource `api-log`, scope `api-logs:read`):
  - **Recorded:** every server API request (not the flow or dashboard API) after the response is sent, including 4xx and 5xx.
  - **Attributes:**
    - `method`, `path`, `route` (the template), `status` and `duration-ms`;
    - `request-id`, `idempotency-key`, `api-key-id` or `user-id`;
    - `ip-address` and `user-agent` (encrypted);
    - `query`, `request-body` and `response-body` (encrypted JSON, each truncated at 64 KiB; a truncated value is `{ truncated, byte-length, preview }`, and the preview is cut from the C15-masked JSON, so it never carries PII (Workflow 2B F008));
    - `created-at`.
  - **Redaction:** before storage, the value of any key named `secret`, `token`, `session-token`, `one-time-link`, `one-time-token`, `password`, `code`, `totp-code` or `recovery-code` is replaced with `"[REDACTED]"`, at any depth. Inside a `custom-headers` member (webhook custom headers, C14) the names stay and every value becomes `"[REDACTED]"` (Workflow 2B F009). Multipart bodies are stored as part metadata only, never file bytes.
  - **Endpoints:** `GET /api-logs` with filters `method`, `status` (an exact code or a class such as `4xx`), `route`, `api-key-id`, `created-at-start` and `created-at-end`; `GET /api-logs/:id`.
    - Workflow 2E (C25.9): `filter[user-id]` (comma list of `usr_` ids) lists the requests made with a dashboard session of those users, in the caller's environment (and so organization). Served by `api_logs_environment_id_user_id_created_at_id_idx` (migration `0009_api_logs_user_id_index`), whose `DESC NULLS FIRST` order is the list's own, so a page stops after its rows.
  - **Retention:** default 30 days (C16).
- **API keys** (resource `api-key`):

  | Method and path | Scope |
  |---|---|
  | `GET /api-keys`, `GET /api-keys/:id` | `api-keys:read` |
  | `POST /api-keys`, `PATCH /api-keys/:id` (name, allowed-ips), `POST /api-keys/:id/clone`, `POST /api-keys/:id/expire` (`meta: { expires-in-seconds: 0–2,592,000 }`; 0 means now) | `api-keys:write` |

  - **Attributes:**
    - `name` and `scopes`;
    - `allowed-ips` (CIDR list);
    - `api-version`;
    - `token-prefix` (the environment prefix plus the first 4 secret characters);
    - `expires-at`, `last-used-at` and `created-at`;
    - `pii-masked` (Workflow 2E, C25.6): read only, true when the key sees PII masked (2B F001, C15). On the create, clone, list, get and update answers; optional in the schema, so earlier answers still parse. A body that sends it answers 400.
  - **Secrets:** `POST` and `clone` return `meta.token` once; it is never readable afterwards.
  - **Expiry on creation** (Workflow 2E, C25.5): `POST /api-keys` accepts `expires-in-seconds` (an integer, 1 to 2,592,000). The key expires that long after creation and is refused (401) by the existing expired-key check afterwards; the `api-key.created` audit entry records `expires-at`. Without it the key never expires, as before.
  - **No escalation:** a principal can only grant scopes it holds. A request for more answers 403 `forbidden`.
- **Events API.** `GET /events` (scope `events:read`) with filters:
  - `name` (comma list);
  - `object-id`;
  - `created-at-start` and `created-at-end`;
  - `simulated` (default `false`);
  - `inquiry-id` (Workflow 2E, C25.7, comma list): events whose object is the inquiry, one of its verifications or one of its inquiry sessions, in the caller's environment. It combines with the other filters and the cursor, and stays in `links.next`. No migration: the ids are gathered in an `ARRAY(...)` subquery through `verifications_environment_id_inquiry_id_created_at_idx` and `inquiry_sessions_environment_id_inquiry_id_idx`, and the events found through `events_environment_id_object_id_idx` (`object_id = ANY(...)`); the plan on Postgres 17 is in `docs/tdd/phase2-api-gaps.tdd.md`.
- **New API scopes:**
  - `accounts:read`, `accounts:write`, `accounts:redact`
  - `inquiries:redact`
  - `inquiry-sessions:read`, `inquiry-sessions:write`
  - `inquiry-templates:publish`
  - `api-keys:read`, `api-keys:write`
  - `api-logs:read`
  - `audit-logs:read`

  `webhook-deliveries` use the `webhooks:*` scopes.

### C13. Accounts

- **Resource `account`:**
  - `reference-id` (unique per environment when set);
  - `status`: `active` or `archived`;
  - `fields` (encrypted; masked without `pii:view`) and `tags`;
  - `consolidated-into` (account id or null);
  - `created-at`, `updated-at` and `redacted-at`;
  - relationships `account-type` and `inquiries` (ids, the latest 100).
- **Resource `account-type`:**
  - `name`, unique per environment;
  - `fields-schema`: a map of field key (`snake_case`) to `{ type: string | number | boolean | date, label }`, with at most 100 keys;
  - `created-at`.

  Each environment is seeded with the type `user`.
- **Endpoints** (scope `accounts:*`):

  | Method and path | Purpose | Events |
  |---|---|---|
  | `POST /accounts` | `reference-id?`, `account-type-id?` (default `user`), `fields?`, `tags?`. Fields are validated against the type's schema; unknown keys answer 422 | `account.created` |
  | `GET /accounts` | filters `reference-id`, `account-type-id`, `status`, `tag`, `created-at-*` | |
  | `GET /accounts/:id` | | |
  | `PATCH /accounts/:id` | `fields` (merged), `reference-id`, `status` (`active` ↔ `archived`) | `account.updated-fields`, `account.status-updated` plus `account.archived` or `account.restored` |
  | `POST /accounts/:id/add-tag`, `/remove-tag`, `/set-tags` | as for inquiries | `account.tag-added`, `account.tag-removed`, `account.updated-tags` |
  | `POST /accounts/:id/add-relation`, `/remove-relation` | `meta: { related-account-id, relation-type }`, with `relation-type` matching `^[a-z][a-z0-9_]{0,63}$` (for example `spouse`, `business_owner`). Relations are directed and unique per (from, to, type). An account cannot relate to itself | `account.added-relation`, `account.removed-relation` |
  | `GET /accounts/:id/relations` | Both directions, with `direction: outgoing \| incoming` | |
  | `POST /accounts/:id/consolidate` | `meta: { source-account-ids: [1..10] }`. Moves the sources' inquiries to the target, takes the union of tags, merges fields (target wins), moves relations (deduplicated, self-relations dropped), and marks each source `archived` with `consolidated-into`. One transaction | `account.consolidated` (target), `account.consolidated-with` (each source) |
  | `POST /accounts/:id/add-objects`, `/remove-objects` | `meta: { objects: [{ type: "inquiry", id }] }`. Links or unlinks inquiries | none |
  | `POST /accounts/:id/redact` (scope `accounts:redact`) | C16 | `account.redacted` |
  | `GET /account-types`, `GET /account-types/:id`, `POST /account-types` | scope `accounts:read` or `accounts:write` | |
  | `PATCH /account-types/:id` (Workflow 2E, C25.3) | scope `accounts:write`. `name` and `fields-schema` (the whole new schema, at least one of them). See below | none; audit `account-type.updated` |

- **Changing an account type** (Workflow 2E, C25.3).
  - `name` stays unique per environment: a taken name answers 409, as on create.
  - `fields-schema` changes are additive: keys may be added and labels changed. A change that removes a key or changes a key's `type` answers 422, with `errors[].pointer` = `/data/attributes/fields-schema/<key>` for each such key, because accounts may hold values for it (`accountTypeFieldsChangeIssues` in contracts). The 100-key limit and the key format answer 400, as on create.
  - The seeded type `user` follows the same rule. It also keeps its name (422 at `/data/attributes/name`): the API finds the default type by that name, so renaming it would make the API seed a second `user`. This is a Workflow 2E deviation, for the owner to confirm.
  - The type is locked (`lockAccountType`, `FOR UPDATE`) while the change is checked and written.

- **Inquiry ↔ account.** `POST /inquiries` accepts `account-id?`.
  - **Resolution order:**
    1. `account-id`, which must be in the same environment (else 404);
    2. otherwise `reference-id` finds the account with that reference ID, or creates it;
    3. otherwise a new account is created.
  - Every inquiry therefore has an account.
  - `AccountsService.resolveForInquiry(tx, ctx, { accountId?, referenceId? }, staged?) → accountId` is the locked function the inquiries service calls. The optional `staged` list (Workflow 2B K002) receives the events it stages in `tx` (`account.created`), which the inquiries service dispatches after its commit with `inquiry.created`. The account it resolves is read `FOR SHARE`, following `consolidated-into`, so a consolidation in flight is waited for (Workflow 2B F012).

### C14. Webhooks, complete

- **New webhook attributes:**
  - `status`: `enabled`, `disabled` or `archived`. Archived is terminal: it never delivers, and changes answer 409.
  - `api-version`.
  - `custom-headers`: at most 10.
    - Names are RFC 7230 tokens, case-insensitive, and must not be `content-type`, `content-length`, `host`, `user-agent`, `openverify-*` or hop-by-hop headers.
    - Values are at most 1,024 characters, with no CR or LF.
    - Stored encrypted. Responses show names only, with values as `"[REDACTED]"`.
  - `filters`: `{ inquiry-template-ids?: [], account-type-ids?: [] }`. An event is delivered only if its subject matches every present filter. Events without the attribute are not filtered.
  - `attribute-blocklist`: at most 100 kebab-case attribute names. They are removed from `attributes` of every resource object in `payload.data` and `payload.included`, recursively, before signing. `fields` blocks the whole fields object.
- **Endpoints** (scope `webhooks:*`):

  | Method and path | Purpose |
  |---|---|
  | `POST /webhooks/:id/enable`, `/disable`, `/archive` | Status changes |
  | `POST /webhooks/:id/clone` | Same configuration, new secret (returned once), status `disabled` |
  | `POST /webhooks/:id/rotate-secret` | `meta: { previous-secret-expires-in-seconds: 0–604,800 }`, default 86,400. Returns the new secret once. While the previous secret is valid, deliveries carry two signatures: `OpenVerify-Signature: t=<t>,v1=<new> v1=<old>` (C5 already allows this) |
  | `POST /webhooks/:id/simulate` | `meta: { event-name }`. Builds a sample event from `contracts/fixtures/api/` with `simulated: true`, persists it and delivers it to this webhook only |
  | `POST /webhooks/:id/replay` | `meta: { event-ids?: [≤100] }` or `meta: { created-at-start, created-at-end, status?: "failed" }`, at most 1,000 events. Creates new deliveries for events this webhook subscribes to. Returns `meta: { replayed-count }` |
  | `GET /webhook-deliveries`, `GET /webhook-deliveries/:id` | Filters `webhook-id`, `event-id`, `status`. A `webhook-delivery` has `status` (`pending`, `succeeded`, `failed`), `event-id`, `event-name`, `attempts: [{ attempted-at, response-status, duration-ms, error }]`, `next-attempt-at` and `created-at` |

- **Retry schedule.** At most 8 attempts, at +0, 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h after the first, with ±10% jitter. This replaces Phase 1's 5 attempts.
- **Unchanged:** the SSRF guard, the timeout and no redirects.
- **Event attribute:** events gain the attribute `simulated` (boolean).

### C15. Operators: RBAC, users, audit logs, MFA and environments

- **Permissions** (`PERMISSIONS` in `packages/core/src/permissions.ts`):
  - every API scope from C2 and C12;
  - `pii:view`, which unmasks `fields`, `note` and session IP/UA and allows file content;
  - `users:read`, `users:write`;
  - `roles:read`, `roles:write`;
  - `settings:read`, `settings:write`;
  - `environments:production`, needed to switch a session into production, and to keep using a session that is in production: a session in production whose user no longer holds it stops authenticating, so a user demoted while in production signs in again (Workflow 2B F003).
- **Built-in roles.** Seeded per organization as ordinary `role_<ULID>` rows with `builtin: true` and a stable `key`. They cannot be edited or deleted.

  | Role | Permissions |
  |---|---|
  | `admin` | all |
  | `developer` | templates `*`, webhooks `*`, api-keys `*`, api-logs, events, inquiries read and write, inquiry-sessions, `verifications:read`, accounts read, `environments:production` |
  | `reviewer` | inquiries read and write, inquiries:redact, inquiry-sessions:read, `verifications:read`, accounts `*`, events:read, `pii:view` |
  | `viewer` | every `:read` except api-logs and audit-logs. No `pii:view` |

  `verifications:read` was added to `developer` and `reviewer` by the Workflow 2B review (K001): a reviewer needs the check results behind a decision. The API syncs the built-in roles of every organization at startup, so organizations seeded earlier gain it.
- **Custom roles.** Organization-level, with `name` and `permissions` (a subset of `PERMISSIONS`). Users hold one or more roles, and their permissions are the union.
  - The organization's last active admin cannot be demoted or deactivated (409).
  - **Changing access needs holding it** (Workflow 2D K002, an amendment of C15 for the owner to confirm). The no-escalation rule applies symmetrically: an operator may change only access it holds itself. Removing a role from a user (`PATCH /users/:id` `role-ids`, or a fresh invitation that replaces an invited user's roles) needs every permission of each removed role; changing a user's `status` (deactivating, which also revokes their sessions, or reactivating) needs every permission the user holds; removing permissions from a custom role needs each removed permission (renaming needs nothing more); deleting a custom role needs every permission it grants. Refusals answer the same 403 `forbidden` problem as a grant beyond reach, with a detail naming the permissions. The dashboard has no route that revokes another user's sessions or resets their MFA (that is the `user:reset-mfa` CLI), so nothing else needed the rule. The dashboard offers none of these changes beyond the operator's reach and says why.
- **Masking.** For a user principal without `pii:view`, serializers replace:
  - each value in `fields` with `null`;
  - `note`, `ip-address` and `user-agent` with `null`.

  File content answers 403 `forbidden`. API keys are not masked: scopes already gate them. One exception (Workflow 2B F001): a key minted or cloned by a principal without `pii:view`, or cloned from such a key, is stored with `api_keys.pii_masked = true` and sees PII masked as its creator does, file content included. Keys created before that change keep seeing PII.
- **Dashboard API additions** (user session only; prefix `/api/v1/dashboard`):

  | Method and path | Permission | Purpose |
  |---|---|---|
  | `POST /sessions` | — | Unchanged when the user has no MFA. With MFA: `202 { mfa-token, factors: [{ id, type }] }` |
  | `POST /sessions/mfa` | — | `{ mfa-token, totp-code \| recovery-code }` → `201` session |
  | `POST /sessions/mfa/webauthn/options`, `POST /sessions/mfa/webauthn/verify` | — | WebAuthn assertion with `mfa-token` |
  | `PUT /sessions/current/environment` | `environments:production` for production | `{ environment-id }`. Switches the session's environment and writes an audit entry |
  | `GET /me/mfa-factors`, `POST /me/mfa-factors/totp`, `POST /me/mfa-factors/totp/confirm`, `POST /me/mfa-factors/webauthn/options`, `POST /me/mfa-factors/webauthn/verify`, `DELETE /me/mfa-factors/:id`, `POST /me/recovery-codes` | — | Enrolment and removal (see below) |
  | `GET /users`, `POST /users/invitations`, `PATCH /users/:id` | `users:read` / `users:write` | `POST /users/invitations` sends an email with `${OPENVERIFY_DASHBOARD_PUBLIC_URL}/accept-invitation#token=ovi_…`. `PATCH` changes `role-ids` and `status` (`active`, `deactivated`; deactivation revokes the user's sessions). Since Workflow 2C each user in `GET /users` also carries `mfa-enabled` (an active, confirmed factor), for the C23 users list |
  | `POST /invitations/accept` | — | `{ token, password, name }` |
  | `GET /roles`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` | `roles:*` | A role in use cannot be deleted (409) |
  | `GET /roles/:id` (Workflow 2E, C25.2) | `roles:read` | One built-in or custom role (`roleDocumentSchema`); 404 for an unknown role or another organization's |
  | `GET /audit-logs`, `GET /audit-logs/:id` | `audit-logs:read` | |
  | `GET /settings`, `PATCH /settings` | `settings:*` | `require-mfa` (org) and the environment's `retention` (C16) |

  - **Login with MFA.** Requires a valid `mfa-token` plus one factor. Five wrong codes revoke the `mfa-token`.
    - Workflow 2E (C25.1): `POST /sessions/mfa` and `POST /sessions/mfa/webauthn/verify` answer 401 with a `code` (`MFA_SIGN_IN_PROBLEM_CODES` in contracts): `mfa_code_invalid` for a wrong TOTP code, recovery code or assertion while the token is still usable; `mfa_attempts_exhausted` for the wrong attempt that revoked the token (the fifth); `mfa_token_invalid` for an unknown, expired, used or revoked token, including a wrong attempt that finds the token already revoked by a parallel one. `POST /sessions/mfa/webauthn/options` answers `mfa_token_invalid` too. Status and problem shape are unchanged.
  - **TOTP enrolment.** `POST /me/mfa-factors/totp` returns `otpauth-uri` and `secret` once. The factor is active only after `confirm` with a valid code.
  - **Recovery codes.** `POST /me/recovery-codes` regenerates them and returns them once; the previous codes stop working.
  - **Required MFA.** When the organization sets `require-mfa`, a user without a factor gets a session with `mfaSatisfied: false`. That session can reach only `/me`, `/me/mfa-factors*` and `DELETE /sessions/current`; anything else answers 401 `mfa-required`. Once the user has an active factor, such a session (for example one opened before the enrolment) may no longer enrol or remove factors either (401 `mfa-required`): it must log in with the factor (Workflow 2B F002).
- **Operator client address** (Workflow 1B findings F003 and F007). The login rate limiter must key on the operator's real address, not the BFF's.
  - `OPENVERIFY_TRUST_PROXY` accepts `false`, a hop count, or a comma-separated CIDR list, passed to Fastify `trustProxy`.
  - The dashboard BFF sends `x-openverify-client-ip` and `x-openverify-bff-token`. The client IP is derived from `x-forwarded-for` using `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` (default 0: the socket peer, so a client-chosen header is never trusted).
  - The API uses `x-openverify-client-ip` for the login limiter and audit entries only when `x-openverify-bff-token` matches `OPENVERIFY_DASHBOARD_BFF_TOKEN` (constant-time). Otherwise it uses `request.ip`.
- **TOTP:**
  - RFC 6238 with SHA-1, 6 digits, 30 s steps and ±1 step;
  - the last used step is stored to stop replay;
  - implemented on `node:crypto` (no dependency) and tested against the RFC 6238 vectors.
- **WebAuthn:**
  - `@simplewebauthn/server` (MIT);
  - RP ID, name and origin from `OPENVERIFY_WEBAUTHN_RP_ID`, `OPENVERIFY_WEBAUTHN_RP_NAME` and `OPENVERIFY_WEBAUTHN_ORIGIN`;
  - user verification preferred;
  - counter checked;
  - challenges stored hashed, 5 min TTL.
- **Server API `GET /user-audit-logs` and `GET /user-audit-logs/:id`** (scope `audit-logs:read`).
  - Resource `user-audit-log`:
    - `action` (dotted, for example `inquiry.approved`, `file.viewed`, `webhook.secret-rotated`);
    - `actor: { type: user | api-key, id }`;
    - `resource-type` and `resource-id`;
    - `ip-address` and `user-agent` (encrypted);
    - `metadata`;
    - `created-at`.
  - **What is recorded.** Every state-changing call by any principal, plus `file.viewed`, logins, logouts, MFA changes and environment switches.
  - **The locked port:** `AuditLogger.record(tx, entry)`.

### C16. Retention, redaction and key rotation

- **Redaction** (`RedactionService.redactInquiry(ctx, id, actor)` and `redactAccount(...)`, both locked) is irreversible and idempotent.
  - **What it removes:**
    - every file object of the inquiry from storage, with the `files` rows marked `deleted-at`;
    - `fields`, `note`, consent IP/UA and session IP/UA, set to null;
    - check `metadata` and `reasons`, emptied;
    - every stored event payload that embeds the object, replaced by a minimal stub `{ data: { type, id, attributes: { redacted-at } } }`;
    - the query and bodies of every API log, and every stored idempotent response, that mention the object anywhere: each such row records the inquiry, verification, session and account ids its stored text mentions (`subject_ids`, Workflow 2B F005 and F017), so list answers and event reads are cleared too.
  - **Result:** `redacted-at` is set. Later requests for PII or files answer 410 `redacted`.
  - **Open inquiries** (Workflow 2B F018): the redaction also cancels the inquiry's active sessions (`inquiry-session.canceled`) and revokes its unused one-time links, in the same transaction. Flow API writes (consent, new verifications, uploads, submits), `resume` and `generate-one-time-link` on a redacted inquiry answer 410 `redacted`, so no new PII is collected after an erasure.
  - **Accounts:** redacting an account also redacts its inquiries, and every account consolidated into it (C13 `consolidated-into`), which keeps the same person's fields and events (Workflow 2B F007).
- **Retention:**
  - **Environment settings** (`PATCH /dashboard/settings`), with defaults:
    - `inquiry-retention-days`: null means keep forever;
    - `api-log-retention-days`: 30;
    - `webhook-delivery-retention-days`: 30;
    - `event-retention-days`: 90.
  - **Template override:** a template version's `settings.retention-days` overrides `inquiry-retention-days` for its inquiries.
  - **Job:** a daily repeatable BullMQ job `retention`, which runs in batches of 500 and is idempotent.
    - It redacts inquiries in a terminal status (`completed`, `failed`, `expired`, `approved`, `declined`) whose `updated-at` is older than their retention.
    - It deletes api logs, webhook deliveries, idempotency keys and events past their windows. Events still referenced by a `pending` delivery are kept.
    - A run that could not redact an inquiry, or could not delete a file of a redacted inquiry, finishes the rest and then fails the job, so BullMQ records and retries it; `retention:run` exits with status 1. The report counts `failedRedactions` and `failedPurges` (Workflow 2B F031).
    - It deletes dashboard user sessions and one-time links 30 days past their expiry (Workflow 2B F022), and expired MFA login and WebAuthn registration challenges (Workflow 2B F032). Audit logs are append-only and kept. Inquiry sessions hold their inquiry's consent record and stay with the inquiry; redaction clears their PII.
- **KEK rotation.** `pnpm --filter @openverify/api kek:rewrap` rewraps every stored DEK under the current `OPENVERIFY_KEK`, in batches, resumably. Afterwards `OPENVERIFY_KEK_PREVIOUS` can be removed. The command takes `--dry-run`.

### C17. Event names added in Phase 2

- **Inquiry:**
  - `inquiry.approved`, `inquiry.declined`, `inquiry.marked-for-review`, `inquiry.expired`
  - `inquiry.transitioned`, `inquiry.updated-tags`, `inquiry.redacted`
- **Inquiry session:** `inquiry-session.started`, `inquiry-session.expired`, `inquiry-session.canceled`
- **Verification:** `verification.canceled`, `verification.skipped`
- **Account:**
  - `account.created`, `account.updated-fields`, `account.updated-tags`
  - `account.tag-added`, `account.tag-removed`
  - `account.added-relation`, `account.removed-relation`
  - `account.consolidated`, `account.consolidated-with`
  - `account.archived`, `account.restored`, `account.status-updated`, `account.redacted`

All are in `EVENT_NAMES`. Webhooks may subscribe to any of them or to `*`.

### C18. `@openverify/node` client

- **Constructor:** `createClient({ apiKey, baseUrl, apiVersion?, fetch?, maxRetries = 2, timeoutMs = 30_000 })`.
- **Methods:** one per C2, C10–C14 server endpoint, grouped by resource: `client.inquiries.create(...)`, `.approve(id)`, `.list({ filter })`, and so on. They return parsed zod types from `@openverify/contracts`.
- **Lists:** `list()` returns one page; `listAll()` is an async iterator over every page.
- **Idempotency:** every `POST` and `PATCH` sends an `Idempotency-Key` (a ULID unless the caller passes one), so retries are safe.
- **Retries:** on network errors, 429 and 5xx, with exponential backoff and jitter, honouring `Retry-After`. Errors are `OpenVerifyApiError` (status plus problem).
- **Additive changes:** a success answer is parsed with the strict contract schemas, but members the client does not know (added by a newer server) are dropped instead of failing the call; everything it knows is still validated (Workflow 2B F028).
- **Webhooks:** `signWebhookPayload` and `verifyWebhookSignature` stay as they are.
- **Runtime:** Node 22+; `fetch` is injectable for tests.

### C19. Web flow and Android changes

- **C3 session additions.** `GET /flow/session` adds `environment: { kind: 'sandbox' | 'production' }`. Sandbox shows a banner and allows a selfie upload fallback.
- **One-time links.** When the fragment carries `one-time-token`, the client calls `/flow/one-time-links/redeem`, keeps the session token in memory only, and clears the fragment.
  - Android: `OpenVerifyInquiry.fromOneTimeLink(url)`, plus the existing session-token launcher.
- **Inactive sessions.** On 401 `session_expired` or `session_canceled`, the client shows a dedicated screen with no retry.
- **Re-upload.** The Workflow 1B rule is "last write wins on an initiated verification"; clients rely on it after a reload.

### C20. Fixtures added in Phase 2

`contracts/fixtures/api/` gains:
- `account.json`, `account-type.json`, `inquiry-template-version.json`, `inquiry-session.json`;
- `webhook-delivery.json`, `api-log.json`, `api-key.json`, `role.json`, `user-audit-log.json`, `rate-limit.json`;
- `event-inquiry-approved.json`, `event-account-consolidated.json`.

`contracts/fixtures/webhooks/signature-vectors.json` gains dual-signature vectors.

Workflow 2E (C25): `api/inquiry.json` and `api/inquiry-with-verifications.json` name their `inquiry-template-version`; `api/api-key.json` has `pii-masked: false`; the new folder `contracts/fixtures/problems/` holds `session-canceled-inquiry-{expired,finished,redacted}.json` (C25.8). The folder is new rather than inside `api/` because the Android contract test requires a decoder for every `api/*.json`; the clients read `problems/` from the same classpath and folder.

Validated by zod, and by Kotlin where the SDK reads the resource (the inquiry session only).

## Files to change (Workflow 2A)

| Path | Action | Owner |
|---|---|---|
| `packages/contracts/**`, `contracts/fixtures/**` (except vision), `packages/core/src/{verification-state-machine,permissions,tags,webhook-payload,api-versions}.ts` and `check-registry.ts` (`configSchema`) | CREATE/UPDATE | contracts-v2 |
| `apps/api/src/ports.ts` (`Principal`, `PrincipalResolver`, `RateLimiter`, `Mailer`, `AuditLogger`, `AccountsService`, `RedactionService`) plus stub factories and stub route plugins with locked names, registered in `routes/server/index.ts` and `routes/dashboard/index.ts`; `apps/api/src/plugins/principal-auth.ts` (replaces `api-key-auth.ts`: API-key principals now, a pluggable user-session resolver), `apps/api/src/auth/pii.ts` (`canViewPii`, masking helpers), the new problem types in `problem-details.ts`/`errors.ts`, and principal support in `apps/api/src/test-support/**` | CREATE/UPDATE | api-foundation |
| `packages/db/**`: migration `0003_schema_v2.sql`, tables, repositories, Testcontainers tests | UPDATE | db-v2 |
| `apps/api/src/{routes/server/{inquiries,inquiry-sessions,inquiry-template-versions,inquiry-templates,verifications}.ts,services/{inquiries,inquiry-sessions,inquiry-templates,one-time-links,simulate}.ts,jobs/{process-verification,inquiry-expiry}.ts}`, `apps/api/src/routes/flow/**` (redeem, session states) | UPDATE/CREATE | api-inquiries |
| `apps/api/src/{routes/server/{accounts,account-types}.ts,services/{accounts,redaction,retention}.ts,jobs/retention.ts}`, `apps/api/scripts/kek-rewrap.ts` | CREATE | api-lifecycle |
| `apps/api/src/plugins/{idempotency,rate-limit,api-version,api-logs}.ts`, `apps/api/src/routes/server/{api-keys,api-logs,rate-limits,events}.ts`, `apps/api/src/{app,server,config,container}.ts` | CREATE/UPDATE | api-platform |
| `apps/api/src/{webhooks/**,events/**,routes/server/{webhooks,webhook-deliveries}.ts,services/webhooks.ts}`, `packages/node/**` (C18 client) | UPDATE/CREATE | api-integrations |
| `apps/api/src/{operator-auth/** (including the user-session principal resolver),routes/dashboard/**,services/{users,roles,audit-log,mfa,settings}.ts,mail/**}`, `routes/server/user-audit-logs.ts` | UPDATE/CREATE | api-operators |
| `apps/flow/**`, `android/**` | UPDATE | Workflow 2C (clients) |
| `e2e/**`, `infra/**`, `.github/workflows/ci.yml`, `.env.example`, `THIRD_PARTY_LICENSES.md`, `docs/PROGRESS.md`, `apps/api/src/test-support/**`, the OpenAPI snapshot | UPDATE | e2e-integration |

**Shared files.**
- `container.ts` and `config.ts` belong to api-platform; `apps/api/src/worker.ts` belongs to api-inquiries.
- Another Stage 2 agent may add only its own factory call, job registration or config keys, inside a block marked `// <agent>: begin` … `// <agent>: end`, and must commit that edit promptly under the git lock.

**Carried over from Workflow 1B (LOW findings), by owner:**

| Finding | Owner |
|---|---|
| F005: flow sessions are not revoked when an inquiry finishes (now part of C10's `inquiry-session.canceled`) | api-inquiries |
| F015: worker shutdown ignores a rejected `close()` | api-inquiries |
| F004: encrypted columns use a static AAD context; bind new Phase 2 encrypted columns to their row id, and record the migration path for existing columns | db-v2 |
| F009: pin GitHub Actions to commit SHAs | e2e-integration |
| F018: flow fetches have no timeout | Workflow 2C clients |
| F025: Android `takePicture` failures beyond the two handled exception types crash the host app | Workflow 2C clients |
| F026: the demo app loses the session on rotation | Workflow 2C clients |
| F021: vision inference errors map to a generic 500 | Phase 3 vision |
| F022: the vision service token is checked after the multipart body is parsed | Phase 3 vision |

## Tasks

**Workflow 2A**
- **Stage 1 (contracts-v2 and db-v2 in parallel; api-foundation starts when contracts-v2 is done):**
  - **contracts-v2:** C9–C20 schemas and fixtures, and the core additions.
  - **api-foundation:** the principal plugin (API keys behave exactly as in Phase 1; user sessions through an injected `PrincipalResolver`), PII masking helpers, the new problem types, the ports with stubs, and harness support for user principals.
  - **db-v2:**
    - every table and column C9–C16 need;
    - indexes for every filter;
    - encrypted columns for PII;
    - a repository per aggregate, with Testcontainers tests.
- **Stage 2 (parallel, after Stage 1):**
  - **api-inquiries:** C10, C11, and the worker's use of check config.
  - **api-lifecycle:** C13 and C16.
  - **api-platform:** C12, except the principal plugin.
  - **api-integrations:** C14, plus the dispatcher's dual signing, headers, blocklist, filters and schedule; the C18 `@openverify/node` client.
  - **api-operators:** C15, the user-session `PrincipalResolver`, and Mailer (SMTP via `nodemailer`, Mailpit in dev).
- **Stage 3:** **e2e-integration.**
  - **Wiring:**
    - wire everything;
    - extend the seed with one user per built-in role, plus an MFA-enrolled admin;
    - add compose and CI changes.
  - **API-level e2e using `@openverify/node`:**
    1. Create a template, draft a version, publish it; an inquiry pins the version.
    2. A one-time link is redeemed once through the flow API, and a second redeem answers 401. (The browser path is tested in 2C.)
    3. An idempotent replay returns the stored response; reusing the key with another body answers 422.
    4. Rate-limit headers are present.
    5. Webhook rotation: both signatures verify during the overlap.
    6. Replay and simulate deliver.
    7. Account consolidate moves the inquiries.
    8. Approve, decline and mark-for-review emit their events.
    9. A reviewer can approve but cannot create API keys (403); a viewer sees masked fields.
    10. TOTP login through the dashboard API.
    11. Redaction deletes the stored files (S3 `HeadObject` answers 404) and the events are stubbed.
    12. The retention job, run with an injected clock, redacts an old inquiry.
  - **Phase 1 e2e** still passes.

**Workflow 2C:** C19 in `apps/flow` and `android`, and dashboard pages for every Phase 2 feature:
- inquiry actions, tags, timeline and sessions;
- accounts (list, detail, relations, consolidate, redact);
- templates (versions, JSON editor, publish);
- webhooks (CRUD, rotate, deliveries, replay, simulate);
- API keys;
- API logs;
- events;
- users and roles;
- audit logs;
- settings (retention, require MFA);
- MFA enrolment and MFA login (TOTP and WebAuthn);
- the environment switcher.

Plus Playwright UI e2e. Contracts C21–C24 and the agents are in "Workflow 2C (clients)" below.

### Workflow 2C (clients)

Written after Workflow 2B, against the reviewed API (C9–C20 as amended by the 2B fixes above). 2C runs **6 agents in three stages** (the first draft of this plan estimated at most 4). C1–C20 stay locked; C21–C24 below are the client contracts.

#### C21. Dashboard BFF

- **Server-side only.** The dashboard calls the API from server components and server actions only. The `ovu_` session token stays in its httpOnly cookie. It never reaches browser JavaScript, a URL or a log.
- **One typed client.** `apps/dashboard/src/lib/api/` wraps both API surfaces:
  - the server API (`/api/v1/*`), which accepts the session token as a bearer since C12, through `@openverify/node` (`createClient({ apiKey: <session token>, maxRetries: 0 })`);
  - the dashboard API (`/api/v1/dashboard/*`) through the existing `dashboard-api.ts` fetch helper.

  Every response is parsed with its `@openverify/contracts` schema.
- **Client address** (F003, F007). Every BFF request to the API sends `x-openverify-client-ip` and `x-openverify-bff-token` (`OPENVERIFY_DASHBOARD_BFF_TOKEN`).
  - Next.js 16 sets `x-forwarded-for` only when the request has none (`base-server.js`: `req.headers['x-forwarded-for'] ??= socket.remoteAddress`). Behind no proxy, a client-sent value therefore passes through, and the socket peer is lost.
  - So the dashboard runs under a small custom Node server, `apps/dashboard/server.ts`, using Next's programmatic `next()` and `getRequestHandler()`. It deletes any incoming `x-openverify-peer-ip` and sets it from `req.socket.remoteAddress` before handing the request to Next.
  - The e2e stack and the compose dashboard service start this server instead of `next start`.
  - With `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` = 0 (the default), the client address is `x-openverify-peer-ip`. With N > 0, it is the Nth entry from the right of `x-forwarded-for`, and missing or malformed entries mean no address.
  - A client-chosen `x-forwarded-for` is never forwarded verbatim. This replaces Phase 1's `clientAddress()`. Without an address, the BFF sends no `x-openverify-client-ip`, and the API uses `request.ip`.
  - `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` and `OPENVERIFY_DASHBOARD_BFF_TOKEN` go into `.env.example`, compose and the e2e stack. Unit tests cover spoofed, short and malformed chains.
- **Mutations.** Every mutation is a server action, which gets Next.js's Origin check.
  - It validates its form data with the contract's request schema.
  - It returns `{ ok } | { problem }`. Errors render the problem's `title` and `detail`, never a stack.
  - A 401 sends the operator to `/login`. A 401 `mfa-required` sends them to `/account/security`.
- **Permissions.** `GET /dashboard/me` gives `permissions`, `environment` and `mfa-satisfied` once per request (React `cache`).
  - Navigation and action buttons are hidden without the permission. This is UX only: the API enforces.
  - A 403 renders an inline "You do not have access" panel, not the error boundary.
- **Masked values.** `null` because of masking (no `pii:view`) renders as "Hidden", with a tooltip. Missing data renders as "—".
- **One-time secrets.** Secrets shown once:
  - API key tokens;
  - webhook secrets on create and rotate;
  - TOTP secrets and otpauth URIs;
  - recovery codes;
  - one-time-link URLs.

  Each is shown once in a dialog with a copy button. It is never written to a URL, `localStorage` or a log, and is dropped when the dialog closes.
- **Environment.** A switcher in the header calls `PUT /sessions/current/environment`. Production needs `environments:production`.
  - Workflow 2C: no route named the organization's environments, so the switcher could not learn the other environment's id. `GET /dashboard/me` meta now also carries `environments: [{ id, kind }]`, every environment of the organization, oldest first (optional in `dashboardSessionContextSchema`, so earlier answers still parse). Listing one is not permission to enter it.
  - A persistent banner names the environment: amber "Sandbox", or a neutral bar for production. Every page shows it.

#### C22. Dashboard MFA and invitations

- **Login.** `POST /sessions` answering 202 sends the operator to `/login/mfa`. The `mfa-token` lives in a short-lived httpOnly, SameSite=Strict cookie scoped to `/login`.
  - The page offers each factor type the user has: a TOTP code, a recovery code, and WebAuthn through `@simplewebauthn/browser` (MIT), with `options` and `verify` going through server actions.
  - Five wrong codes revoke the token (C15). The page then sends the operator back to `/login` with a message.
- **Security page** (`/account/security`):
  - lists factors;
  - adds a TOTP factor: shows a QR code rendered server-side as SVG with `qrcode` (MIT) plus the secret, and activates it only after confirm;
  - adds a WebAuthn factor;
  - removes a factor;
  - regenerates recovery codes, shown once.

  With `require-mfa` and no factor, every page redirects here (C15 allows only `/me*` and logout).
- **Invitations.** `/accept-invitation` reads `token` from the URL fragment in a client component, clears the fragment at once, and posts `{ token, password, name }` through a server action. It then signs the operator in.

#### C23. Dashboard pages

| Route | API | Permission |
|---|---|---|
| `/inquiries` (Phase 1, plus filters for status list, tags, account, reference id, created range) | `GET /inquiries` | `inquiries:read` |
| `/inquiries/[id]`: actions (approve, decline, mark for review, expire, redact with confirmation), tags, note, fields, one-time link, sessions (list and expire), timeline, sandbox simulate actions | C10 endpoints, `GET /events?filter[object-id]=`, `GET /inquiry-sessions` | `inquiries:read`/`write`/`redact`, `inquiry-sessions:*`, `events:read`, `verifications:read` for the verifications, their checks and images (Workflow 2D K001, see C12) |
| `/accounts`, `/accounts/[id]`: fields, tags, status, relations, inquiries, consolidate, add/remove objects, redact | C13 | `accounts:*` |
| `/account-types` | C13 | `accounts:read`/`write` |
| `/account-types/[id]`: the fields and an edit form (Workflow 2E, C26) | `GET` and `PATCH /account-types/:id` (C25.3) | `accounts:read`/`write` |
| `/verifications/[id]`: status, checks, files (Workflow 2E, C26) | `GET /verifications/:id`, and `GET /dashboard/inquiries/:id` for the file kinds and the redaction | `verifications:read`; the images also need `inquiries:read` and `pii:view`, as the file content route does |
| `/templates`, `/templates/[id]`: versions, draft editor (flow and settings JSON, validated by the API, with errors shown per path), publish | C11 | `inquiry-templates:*` |
| `/webhooks`, `/webhooks/new`, `/webhooks/[id]`: edit, enable, disable, archive, clone, rotate secret (overlap seconds), simulate, replay; deliveries list and detail | C14 | `webhooks:*` |
| `/api-keys`: create (scopes limited to the operator's own), allowed IPs, expire, clone, rename | C12 | `api-keys:*` |
| `/api-logs`, `/api-logs/[id]` | C12 | `api-logs:read` |
| `/events`, `/events/[id]` | C12 | `events:read` |
| `/users`: invite, roles, deactivate | C15 | `users:*` |
| `/roles`: custom roles, permission checklist | C15 | `roles:*` |
| `/audit-logs`, `/audit-logs/[id]` | C15 | `audit-logs:read` |
| `/settings`: require MFA, environment retention (C16) | C15 | `settings:*` |
| `/account/security`, `/login/mfa`, `/accept-invitation` | C15 | session |

- Lists use the C1 cursor with the existing `pagination.tsx`, and keep filters in the URL query.
- Each page has a loading state, an empty state and an error state.
- Forms are keyboard operable and labelled; dialogs trap focus and restore it.
- The JSON editor is a monospaced `<textarea>` with format and validate buttons. No editor dependency.

#### C24. UI end-to-end (Playwright, full stack)

1. MFA: TOTP login through the UI. WebAuthn enrolment and login with Chromium's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`).
2. An admin invites a user, the email arrives in Mailpit, the invitee accepts and signs in with the given role.
3. A reviewer approves an inquiry from its page. A viewer sees "Hidden" fields and no action buttons.
4. Webhooks: create, rotate the secret, simulate; the delivery shows in the deliveries list.
5. API keys: create; the token is shown once and works against the API; expire it.
6. Templates: draft, edit the JSON, publish; a new inquiry pins the version.
7. Accounts: consolidate two accounts in the UI; the inquiries move.
8. A developer switches to production and the banner changes; a reviewer cannot switch.
9. Redact an inquiry in the UI; its files then answer 410 and the fields show as redacted.
10. Flow (C19):
    - a one-time link opened in the browser redeems and the flow runs;
    - opening it again shows the invalid-link screen;
    - sandbox shows its banner;
    - an expired session shows the inactive-session screen.
11. Phase 1 and Workflow 2A specs still pass.

#### Agents

- **Stage 1: `dashboard-shell`.**
  - C21 in full: API client, client-address headers, layout and navigation, permissions, environment switcher and banner.
  - Shared components: dialog, confirm, one-time-secret dialog, masked value, form field, JSON editor, toasts, problem display.
  - C22 in full.
  - e2e helpers for UI specs: sign in as each seeded role, TOTP, virtual authenticator, Mailpit.
  - UI spec 1.
- **Stage 2 (parallel):**
  - **`dashboard-operators`:** users, invitations, roles, audit logs and settings. Specs 2 and 8.
  - **`dashboard-lifecycle`:** inquiry page actions, tags, timeline, sessions, one-time links and simulate; accounts; account types; templates. Specs 3, 6, 7 and 9.
  - **`dashboard-integrations`:** webhooks and deliveries, API keys, API logs, events. Specs 4 and 5.
  - **`clients`** (starts with Stage 1: it does not depend on the dashboard shell, and shares only the e2e stack, which runs under the e2e lock):
    - C19 in `apps/flow`, with 1B F018 (fetch timeouts);
    - C19 in `android` (`OpenVerifyInquiry.fromOneTimeLink`, the inactive-session screen, the sandbox banner and upload fallback), with 1B F025 and 1B F026;
    - Kotlin decoding of `inquiry-session.json`;
    - spec 10, plus mocked flow specs.
- **Stage 3: `e2e-ui-integration`.**
  - Wire everything and run the whole validation list.
  - Fix integration defects test-first.
  - Update `docs/PROGRESS.md`, including the `persona-surface.md` tick list, and the CI workflow if the UI specs need it.
  - CI headroom: with Workflow 2A, the CI node job took 11 min 50 s of its 20-minute limit, 8.5 min of it unit tests (preview run 39438436695).
    - If the 2C dashboard tests push that step past about 14 min, move the api package's unit tests into their own job rather than raising the limit.
    - Rename the e2e job, which still says "the full Phase 1 stack", along with its `ci-workflow.test.sh` check.

**Carried over from Workflow 2B** (not blocking; `docs/tdd/phase2-review-fixes.tdd.md` has the detail):

| Finding | Owner |
|---|---|
| 2B F026 (MEDIUM): the OpenAPI document omits the C12 behaviour every server operation has (`Idempotency-Key`, `OpenVerify-Version`, the `RateLimit` headers, 429, the idempotency problems) | `e2e-ui-integration`, with a regenerated snapshot. **Done in 2C** (`apps/api/src/plugins/openapi-platform.ts`) |
| 2B F027 (LOW): `POST /inquiries/{id}/redact` documents neither the 503 of an unfinished redaction (`RedactionIncompleteError`) nor 410 | `e2e-ui-integration`, with F026. **Done in 2C**: the redact route documents its 503. It never answers 410 (a second redaction answers 200), so 410 `redacted` is documented where it is answered: `resume`, `generate-one-time-link` and the flow writes (consent, verifications, files, submit) |
| 2B F029 (LOW): the `@openverify/node` list types accept `filter[created-at-*]` on lists that reject it | `dashboard-shell` |
| 2B F035 (LOW): a lost idempotency lease on complete is neither detected nor logged | `e2e-ui-integration`. **Done in 2C**: a warning with the key's row id only, on complete and on release |
| 2B F015, F016, F025 (LOW): lock gaps in `submitVerification`, `resumeInquiry` and the add/remove-objects lock order | Phase 3 (the Gov ID slice changes the same verification paths) |

Accepted as they are, for the owner to confirm:
- 2B F024 (MEDIUM): the invitation email is sent inside the transaction, on purpose. A failed send leaves no invited user; the remaining risk is a link that answers 404.
- The crypto-shred part of 2B F010 (null `files.wrapped_dek` on redaction) needs a constraint change and a kek:rewrap change. It is deferred; storage deletion is fixed.
- The re-execution part of 2B F014 (a retry runs a request again after its stored answer was lost) would change C12. It is deferred; stale-holder fencing is fixed.
- 2B F030 (LOW): Stage 3 scenario 12 drives `runRetention` through the CLI, not the worker's job registration. The job wrapper has its own unit tests.

**Shared-resource rules.**
- `pnpm e2e` starts the compose project `openverify-e2e`, so full-stack runs are serialized with `flock /tmp/openverify-e2e.lock`. Run a single spec with `pnpm --filter @openverify/e2e exec playwright test tests/<spec>.spec.ts`, after `pnpm turbo run build --filter=@openverify/e2e^...` (corrected in Workflow 2C: pnpm 12 forwards the `--` of `e2e -- <file>` to Playwright, which then runs the whole suite).
- Dashboard navigation (`apps/dashboard/src/components/nav*.tsx`) belongs to `dashboard-shell`. It lists every C23 route from the start, so Stage 2 agents only add pages.
- `apps/dashboard/src/lib/api/` belongs to `dashboard-shell`. Stage 2 agents add their own resource modules (`lib/api/<resource>.ts`) and touch nothing else there.
- Git: path-scoped commits under `flock /tmp/openverify-git.lock`, as in 2A.

### Workflow 2E (API gaps and the remaining console pages)

Written after Workflow 2D. Workflow 2C reported API gaps it worked around, and the console still has no page for 4 of the 50 API path files. 2E closes them. C1–C24 stay locked except where C25 amends them, additively. 2E runs in three stages.

#### C25. API additions (all additive; earlier answers still parse)

1. **MFA sign-in problem codes** (C15).
   - `POST /dashboard/sessions/mfa` and `POST /dashboard/sessions/mfa/webauthn/verify` answer 401 with a `code`:
     - `mfa_code_invalid`: a wrong TOTP code, recovery code or assertion; the `mfa-token` is still usable;
     - `mfa_attempts_exhausted`: the wrong attempt that revoked the token (the fifth, per C15);
     - `mfa_token_invalid`: an unknown, expired, used or revoked `mfa-token`.
   - The dashboard stays on `/login/mfa` for the first code, and returns to `/login` with a message for the other two. Its own attempt counter in the challenge cookie is removed: the API is the source of truth.
2. **`GET /dashboard/roles/:id`** (`roles:read`). Answers one role, and 404 for an unknown role or another organization's role. `/roles/[id]` uses it instead of searching the list.
3. **`PATCH /account-types/:id`** (`accounts:write`): `name` and `fields-schema`.
   - `name` stays unique per environment, with the same conflict answer as create.
   - `fields-schema` changes are additive. A change may add keys and change labels. A request that removes a key or changes a key's `type` answers 422, with a JSON Pointer to the key, because accounts may hold values for it.
   - The 100-key limit and the key format of C13 apply. The seeded `user` type follows the same rule.
4. **The inquiry names its pinned version** (C10/C11). The inquiry resource gains relationship `inquiry-template-version: { data: { type: 'inquiry-template-version', id } }`. It is optional in the zod schema, like other Phase 2 attributes on Phase 1 resources.
5. **API key expiry on creation** (C12). `POST /api-keys` accepts an optional `expires-in-seconds` (1–2,592,000). Without it, the key never expires, as now. The console creates a key with an expiry in one call, and its two-call warning is removed.
6. **`pii-masked` on API keys** (C12, 2B F001). The `api-key` resource gains a read-only boolean `pii-masked`. The key page and list show it.
7. **The timeline of an inquiry** (C12 events). `GET /events` gains `filter[inquiry-id]`: events whose subject is the inquiry, one of its verifications or one of its inquiry sessions. It combines with the other filters and the cursor. The query must use an index (add a migration if the plan of the query needs one). The inquiry page's timeline uses it.
8. **Why a session was canceled** (C10, C19). The flow API's 401 `session_canceled` problem gains `reason`, derived from the inquiry when the call is made:
   - `inquiry_redacted` when the inquiry is redacted;
   - `inquiry_expired` when it is `expired`;
   - `inquiry_finished` otherwise.

   `session_expired` is unchanged. The web flow and Android show the link-expired screen for `inquiry_expired`, the redacted screen for `inquiry_redacted`, and the existing ended screen otherwise.
9. **API logs by user** (C12). `GET /api-logs` gains `filter[user-id]`, so requests made with dashboard sessions can be singled out. `/api-logs` offers it.

Each addition updates the `@openverify/contracts` schemas and fixtures, `@openverify/node` types, the regenerated `docs/api/openapi.json` and the C-section it amends (marked "Workflow 2E").

**Landed (Stage 1, `api-gaps`; evidence in `docs/tdd/phase2-api-gaps.tdd.md`).** Names for Stage 2:
- contracts: `MFA_SIGN_IN_PROBLEM_CODES`, `mfaSignInProblemCodeSchema`, `MfaSignInProblemCode`; `SESSION_CANCELED_REASONS`, `sessionCanceledReasonSchema`, `SessionCanceledReason`, and `problemSchema.reason`; `inquiryTemplateVersionIdentifierSchema` and the relationship `inquiry-template-version`; `updateAccountTypeBodySchema`, `UpdateAccountTypeBody`, `accountTypeFieldsChangeIssues`, `AccountTypeFieldsChangeIssue`; `createApiKeyBodySchema` `expires-in-seconds`; api-key attribute `pii-masked`; `listEventsQuerySchema` `filter[inquiry-id]`; `listApiLogsQuerySchema` `filter[user-id]`.
- node: `client.accountTypes.update(id, attributes, options?)`; `apiKeys.create({ ..., 'expires-in-seconds' })`; `events.list({ filter: { 'inquiry-id' } })`; `apiLogs.list({ filter: { 'user-id' } })`; `OpenVerifyApiError.code` and `.reason`. `GET /dashboard/roles/:id` is a dashboard API route, which C18's server client does not cover; the dashboard reads it with `apiRequest({ method: 'GET', path: '/dashboard/roles/<id>', schema: roleDocumentSchema })`.

**Deviations, for the owner to confirm:**
- C25.3: `fields-schema` in `PATCH` is the whole new schema (a key left out is a removal); the seeded `user` also keeps its name (422).
- C25.8: the golden problems live in `contracts/fixtures/problems/`, not `api/` (see C20).
- C25.9: the new index is `DESC NULLS FIRST`; the 53 older descending list-index columns are `NULLS LAST` and still sort (a follow-up).

#### C26. Console additions

- `/verifications/[id]` (`verifications:read`): status, checks with their reasons and metadata, and the files, with images "Hidden" without `pii:view`. Linked from the inquiry page's verification cards.
- `/account-types/[id]`: the fields and an edit form (name, and the fields schema in the JSON editor, with errors shown by path).
- The inquiry page:
  - links its pinned template version;
  - its timeline lists the verification and session events (C25.7);
  - it offers no resume. `POST /inquiries/:id/resume` hands a session token to a client integration, and the console hands off with one-time links.
- `/api-keys`:
  - creation with an expiry in one call;
  - `pii-masked` shown on the list and the key page;
  - the caller's rate limits (`GET /rate-limits`) as an information panel.
- `/api-logs`: a user filter.
- `/login/mfa`: the C25.1 codes.

Inquiry sessions keep their list on the inquiry page; a session detail page adds nothing the list does not show.

**Landed (Stage 2, `console-gaps`; evidence in `docs/tdd/phase2-console-gaps.tdd.md`).** Deviations, for the owner to confirm:
- C25.1 in the console:
  - a 401 without a known code counts as `mfa_token_invalid`, and a 400 as `mfa_code_invalid`;
  - a 401 from `webauthn/options` returns to `/login?reason=mfa-invalid`;
  - a challenge cookie written before 2E (it holds an attempt count) decodes as no challenge, so within five minutes of a deploy the operator signs in again;
  - the refusal no longer says how many attempts are left, since the API does not tell.
- `/api-keys` adds an "At a date and time (UTC)" expiry choice (`expires-in-seconds` until that time, within 30 days). The rate-limit panel shows the caller's own limit.
- `/verifications/[id]` reads the file kinds and the redaction from the inquiry, so without `inquiries:read` it lists files by id. After the review (E001), the page names `inquiries:read` as the missing permission and links no inquiry the operator cannot open.
- Shared components gain `ConfirmActionButton.accessibleLabel`, `VerificationCard.title`/`linked`, `InquiryTimeline.linkVerifications` and `ApiKeyActions.maskedKey`; `CreatedApiKey.expiryProblem` is removed with the two-call path.
- API gap, left for a later phase: `GET /verifications/:id` includes no file resources and no redaction state (an `include=files`, or file kinds and `redacted-at` on the verification, would let the page skip the inquiry read).

#### C27. UI end-to-end additions

- An account type is edited. Adding a key works; removing one shows the API's error at its path.
- The inquiry timeline shows a verification event, and the verification page shows its checks.
- An API key created with an expiry shows that expiry and answers 401 once it has passed; a pii-masked key is labelled.
- A wrong TOTP code keeps the operator on `/login/mfa`; a spent `mfa-token` returns them to `/login`.

#### C28. Workflow 2D carry-over

Workflow 2D fixed its HIGH and MEDIUM findings except one half of F018, and left its LOW findings (its K003 fix also settled F001: the TOTP secret and the recovery codes leave component state when their dialogs close). 2E fixes the rest test-first:

- **F018, Android half.** `FlowCoordinator` retries `createVerification` after a network error (OkHttp timeouts included) as a fresh create, which can use up an attempt. It follows the web flow's fix (`apps/flow/src/flow/submit-verification.ts`, Workflow 2D): after a lost answer, read the session and reuse the newest `initiated` verification of that type; when the session cannot be read either, the next attempt reads it first.
- **F012.** Edit note, Cancel, Save note and the custom-header Remove button move focus to a control that remains (WCAG 2.4.3).
- **F013.** The JSON editor's `aria-describedby` also names the error details.
- **F014.** Account-relation row actions and their dialog titles name their target (WCAG 2.4.6).
- **F015.** Retried verifications of one type have distinct region names and headings (for example "Government ID, attempt 2").
- **F010, web flow.** The flow's language select (`apps/flow/src/components/language-select.tsx`) is outlined with `border-line` (1.47:1); it uses the `border-control` token 2D added (WCAG 1.4.11), like every other control.
- **F016.** The one-time-link flow keeps focus on Retry and moves it to the next screen's heading, as `FlowRenderer` does.
- **F022.** "A refused link stays refused" (`OneTimeLinkFlowApiTest`) detects a second redeem.
- **F023.** The picked-photo metadata test gives its input metadata (EXIF GPS and a camera model) and shows none survives.

#### Agents

- **Stage 1: `api-gaps`.** C25 in contracts, db, api and node, test-first, with the OpenAPI snapshot and the plan amendments.
- **Stage 2 (parallel):**
  - **`console-gaps`:** C26 and C27 in `apps/dashboard` and `e2e/`, and the C28 dashboard items (F012–F015);
  - **`clients-reason`:** C25.8 in `apps/flow` and `android/`, with mocked flow specs and Kotlin tests, and the C28 client items (F018 on Android, F010 and F016 in the web flow, F022, F023).
- **Stage 3: review.**
  - Two read-only reviewers: API (security and correctness) and clients (dashboard, flow and Android).
  - One verifier for CRITICAL/HIGH findings.
  - One fixer, test-first.
  - The orchestrator re-runs the whole validation list.

**Landed (Stage 2, `clients-reason`; evidence in `docs/tdd/phase2-clients-reason.tdd.md`).** Deviations, for the owner to confirm:
- The web flow parses a problem whose only schema issue is an unknown `reason` without that member, so its `code` survives and an unknown reason falls back to the ended screen. `problemSchema` is unchanged.
- On Android, a session canceled because its inquiry expired now ends in `FlowState.Expired` (host result `FailureReason.INQUIRY_EXPIRED`), and a redacted one in `FlowState.Redacted` (`INQUIRY_REDACTED`). Both reported `SESSION_CANCELED` before.
- Android public API, additive: the enum `SessionCanceledReason`, and `Problem` gains a defaulted `reason` parameter (source-compatible; a binary change to its constructor, `copy` and `componentN`, worth a release note).

**Result (Stage 3).** Two read-only reviewers found 0 CRITICAL, 0 HIGH, 1 MEDIUM and 2 LOW. The MEDIUM (E001, the verification page blamed `pii:view` for images hidden by a missing `inquiries:read`) was fixed test-first (`docs/tdd/phase2-review-2e-fixes.tdd.md`). Carried into Phase 3, none blocking:
- E002 (LOW): the F010 browser test's guard `control !== ''` cannot fail; check the `--color-control` property itself, and that the border differs from `--color-line`.
- E003 (LOW): `/api-keys` validates a custom expiry before the key attributes, so a form with both errors reports them one at a time.
- The 53 older descending list-index columns are `DESC NULLS LAST` while every list orders `DESC` (nulls first), so each list sorts after the index scan instead of stopping at the page size. A migration recreating them `DESC NULLS FIRST` fixes it (EXPLAIN in `docs/tdd/phase2-api-gaps.tdd.md`).
- The web flow's `FlowRenderer` retry after a failed session load still swaps the error screen for the loading card, so focus falls to the page while it runs (F016 covered the one-time-link flow only).
- Both clients treat a 2xx create with an unexpected body as a refusal, so a retry creates again.
- The event fixtures `api/event-inquiry-approved.json` and `api/webhook-event-inquiry-completed.json` lack the `inquiry-template-version` relationship servers now send.

## Validation

```bash
source scripts/env.sh
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                                     # every package ≥80%
pnpm test:integration                         # Testcontainers: db, api
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)
pnpm e2e                                      # Phase 1 + Phase 2 full-stack specs
gitleaks git --redact .
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Five agents editing `apps/api` at once | High | Path ownership, stubs with locked names in Stage 1, marked blocks in the shared `container.ts` and `config.ts`, `flock` on git |
| The unified principal changes every route's auth | Med | Locked `Principal` type in Stage 1. api-operators owns the plugin and keeps API-key behaviour byte-for-byte (the Phase 1 route tests must pass unchanged) |
| Redaction misses a PII copy (event payloads, API logs, deliveries) | High impact | The redaction service enumerates every table that stores encrypted PII. A test seeds every one and asserts that nothing of the subject remains. API logs are redacted at write time and expire after 30 days |
| Idempotency stores responses with PII | Med | Bodies encrypted, 24 h TTL, deleted by the retention job |
| Rate limiter outage blocks the API | Med | Fails open with an error log (decision recorded) |
| MFA lockout of the only admin | Med | Recovery codes. A `pnpm --filter @openverify/api user:reset-mfa <email>` CLI for self-hosters, which writes an audit entry |
| WebAuthn needs a secure context | Low | `localhost` counts as secure. e2e uses Chromium's virtual authenticator through CDP |
| Scope creep into Phase 6 (workflows) or Phase 8 (cases) | Med | `run-action`, cases, lists and reports stay out of scope |

## Acceptance

- [ ] Every Validation command passes locally and in CI on GitHub.
- [ ] Every C9–C20 endpoint and event exists, is in the OpenAPI snapshot, and has route tests including cross-environment 404 and a missing scope or permission.
- [ ] Every Workflow 2B finding rated CRITICAL or HIGH is fixed or refuted, with evidence.
- [ ] `docs/tdd/phase2-*.tdd.md` exists for each slice, and `docs/PROGRESS.md` is updated.
- [ ] The `docs/research/persona-surface.md` items covered by Phase 2 are ticked in `docs/PROGRESS.md`.
