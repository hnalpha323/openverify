# Peek and redeem

## Peek

`GET /api/v1/connect/share-tokens/{id}?peek-source-data=true` lets the destination see what the source holds before it redeems: the destination only, scope `connect-share-tokens:peek`, and for a console user also `pii:view`; the token must be `created` and its connection `active`.

- **The envelope** (the source API's shape): `source-data` of type `connect/source-data/<subtype>` (`inquiry`, `account`, `transaction`, `verification/government-id`, `verification/selfie`, `verification/database`, `verification/document`, `verification/email-address`, `verification/phone-number`). Every exposed attribute is `{visibility, value}`: `full` carries the value, `presence` carries only whether the source holds one. Attributes the policy does not share are absent; an inquiry, account or transaction adds a `fields` bucket, and an inquiry adds `related-objects` (its shareable verifications, the first 50).
- **Never in a peek** (ours, reason: a peek is for deciding whether to redeem, not a copy): file bytes, images and face data. A file is at most a `presence`.
- **Built at read time** from the source's current rows; nothing is cached.
- **Limits** (ours, provisional): at most 10 peeks per token (429 `share_token_peek_limit`), so a peek is not a channel for watching a person's data change over 21 days; and the rate policy `connect-peek`, 60 a minute, which fails closed (503 `connect_peek_unavailable` when the limiter's store does not answer), as login does.
- **Audit:** an entry in the destination's environment (the peek) and in the source's (its token was peeked), never a value.

A peek shows what the source holds at that moment; the source can change or redact it before redemption, and the redemption copies what exists then.

## Redeem

`POST /api/v1/connect/share-tokens/{id}/redeem` (the destination, `connect-share-tokens:redeem`) answers 202 with the token `pending`; the copy is made by a job (queue `connect-redeem`, admitted under the per-environment queue cap since 11B). Body: optional `destination-id`, and `meta` with `field-mappings[]`, `account-id` or `auto-create-account-reference-id` and `auto-create-account-type-id`, and three members of ours:

- `meta.destination-consent-record-id`, the destination record ([consent](consent.md)), required;
- `meta.inquiry-template-id` (and optionally `meta.inquiry-template-version-id`) for a clone of an inquiry (**ours**, reason: every OpenVerify inquiry is pinned to a template version);
- `meta.inquiry-id` for a clone of a verification, which attaches to an open destination inquiry (**ours**, reason: a verification belongs to an inquiry here).

Synchronous checks, under the token's row lock: the token is `created` (409 `share_token_already_redeemed`, `share_token_expired` or `share_token_not_redeemable` otherwise), the connection is `active`, the caller's environment is the token's destination environment, the destination objects exist, and the destination consent record covers the share as the source's must. An `Idempotency-Key` repeat returns the first answer.

### Modes

| Mode | When | What is copied |
|---|---|---|
| clone | no `destination-id`; from an inquiry or a verification | a new inquiry (under the named template version) or a new verification on an open inquiry, with its status, extracted data, checks and files as the policy allows |
| hydrate | a `destination-id` (account, inquiry or transaction); from an inquiry, account or transaction | fields only: matched by name, then by `field-mappings`; no verification and no report |

Any other pairing answers 422 `share_redeem_mode_invalid`; `account-id`, `auto-create-*` and `destination-id` exclude each other (422 `share_redeem_meta_conflict`). A third mode, `fill-inquiry`, is internal to [client-side redemption](client-side.md).

- **Field mappings** (`{source-field-name, destination-field-name}`, dot notation for nested destinations) apply first. A name-matched field the destination does not declare, or of another type, is dropped and named in `redeem-summary.dropped-fields` (keys only); a mapped field that fails validation fails the job (`import_failed`).
- **Account linking:** `account-id`, `auto-create-account-reference-id` with `auto-create-account-type-id`, or the ordinary resolution of a new inquiry. As built, `auto-create-account-type-id` is checked but the environment's default account type is used (open after Workflow 11F; the next release).
- **Files** are re-encrypted under new data keys as new objects.
- **Never copied** (ours, reason: least data, and nothing that identifies a person beyond the share): face templates and their background rows, report links, signals, session records, device facts, the source's notes and tags, and any field outside the allowlist. A cloned selfie creates no face template, so it joins no repeat search at the destination.
- **As built:** the extracted data of database, email-address, phone-number and selfie clones is not copied (open after Workflow 11F; the next release).

### The job

One transaction in the destination environment re-reads the source, the connection, both consent records and the token under their locks, computes the categories of the rows it is about to copy (`consent_scope_exceeded` if any lies outside the token's stored categories), copies under the token's policy version, sets `redeemed`, and stages `connect/share-token.outbound-redeemed` (source) and `.inbound-redeemed` (destination). A transient database error is retried three times, then the token ends `unrecoverable_error`; every failure is final and stages `connect/share-token.failed` on both sides.

- **Snapshot:** the job copies what the source holds when it runs; the copies are separate rows, never references.
- **`redeem-summary`** (ours): counts of copied verifications, checks, files and fields, the dropped field keys and the policy version applied; never a value.
- **Limits** (ours, provisional, from the upload limits): at most 50 verifications, 200 files and 512 MiB of file bytes per redemption; beyond them, `import_failed`.
- **Rate policy** `connect-redeem`: 60 a minute per principal and environment.

A redemption copies evidence and re-runs nothing. A hydrated object's checks are the destination's own; a cloned object's are the source's, and [provenance](provenance.md) says so.
