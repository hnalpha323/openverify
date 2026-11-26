# Share tokens

A share token (`connect/share-token`, id `cnst_…`) is a one-time permission to copy one object from the source to the connection's destination. It is created in the source environment (`POST /api/v1/connect/share-tokens`, `connect-share-tokens:write`) with `connection-id`, `source-id`, `consent-record-id` and, optionally, `expires-in-seconds`.

## What a create checks

In this order, each with its own answer:

1. the connection exists, the caller's organisation is its source, and it is `active`;
2. the destination organisation has an environment of the caller's kind (422 `environment_kind_mismatch`): sandbox shares go only to sandbox, production only to production;
3. the source object exists in the caller's environment, is not redacted (409 `source_redacted`), a verification is decided (409 `source_not_decided`), and it is not a copy and holds none (409 `source_is_copy`): a cloned inquiry or verification is never passed on under a new organisation's name (**ours**, reason: a copy carries another organisation's checks, and re-sharing it would hide where they came from); and a field the object lists in `hydrated_fields` (data hydrated from another organisation) is left out of what is shared, at peek, at create and at the redemption's re-check (**ours**, the same reason; Workflow 11F);
4. the policy shares this source type and, for a verification, its type (422 `share_source_not_allowed`); a report id answers 422 `share_source_not_supported` (report sharing is not built, [limits](limits.md));
5. the consent record covers this share: the source side, accepted, its subject the object or the inquiry that holds it, its recipient the connection's destination, its purpose and categories covering the share, the explicit biometric consent when the share carries biometric data, not withdrawn, not expired, and not cited by another token (422 `consent_required` with a `reason`). **Ours** (reason: one consent authorises one token, so a consent is specific to one disclosure; [consent](consent.md));
6. the lifetime is 60 seconds to 21 days (default 14 days), at most the environment's `share-token-max-seconds` setting, and never past the consent's expiry (422 `share_token_outlives_consent`).

The token stores the data categories computed at creation; a redemption copies nothing outside them.

## Lifetime and statuses

| Status | Meaning | Final |
|---|---|---|
| `created` | waiting for the destination | no |
| `pending` | a redemption is running | no |
| `redeemed` | the copy was made | yes |
| `expired` | ended before redemption; `expiry-reason` says why | yes |
| `failed` | a redemption failed; `failure-reason` says why | yes |

- **Single use.** A second redemption answers 409 `share_token_already_redeemed`.
- **Expiry** (`expiry-reason`, ours: the source API names no reason): `time` (a minute sweep, and a redemption also refuses a token past `expires-at` before the sweep reaches it); `source_expired` (the source's `POST /api/v1/connect/share-tokens/{id}/expire`); `connection_deactivated`; `consent_withdrawn`.
- **Failure reasons:** `source_not_found`, `source_redacted`, `import_failed`, `unrecoverable_error`, and ours `connection_inactive`, `consent_withdrawn`, `consent_expired`, `consent_scope_exceeded` (the source gained data outside the stored categories, such as a selfie added after creation) and `source_is_copy`. Every failure is final.
- **No `ready` status** (ours, reason: no copy is prefetched and cached ahead of redemption, so there is no cached personal data to redact; the source API's `ready` event is not emitted).
- Ended rows: `expired` and `failed` tokens are deleted 30 days after they ended. A `redeemed` token is the disclosure record: it holds ids only, and is kept while the source object or any destination copy exists, so a later redaction or withdrawal still reaches the counterparty and a source-side access export still names the recipient.

## The handle model

A token id is a handle, not a secret: it is a ULID, not hashed at rest, and it grants nothing on its own. Every call is authenticated and bound to the token's connection, the caller's organisation and side, and the environment kind. Every refusal of a token the caller may not see (unknown, another organisation's, the other environment kind's, a third party's) is the same 404 body. A token is a permission to copy, bound to one recipient; it proves nothing about the person.

## What each side sees

`GET /api/v1/connect/share-tokens` lists outbound tokens of the caller's environment and inbound tokens whose destination environment is the caller's (filters `connection-id`, `status`, `direction`). On retrieve, the source sees the creator, the source object and the consent record; the destination sees neither the creator nor the source object, and after redemption its own destination object. Both see `data-categories` and `source-consent` (the method, whether it was witnessed, its categories, the biometric flag and the text digest), so the destination can see when a share rests on an attested consent. The source object's ids are never disclosed to the destination.

## Environment kinds

A token is bound to the destination environment of its own kind at creation. A caller in the other kind gets the generic 404, so a sandbox integration can never redeem production data.
