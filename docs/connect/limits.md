# Limits of sharing

What Connect does not do, each with its reason. A limit is stated here because a reader could assume the opposite.

## Not built

- **No sharing between installs.** Both organisations must be tenants of the same OpenVerify install. Sharing between two installs needs a key exchange, a trust bootstrap and a signed envelope (a design is recorded in `docs/research/phase11-connect.md`, section 3.4); it is the next release's (C286).
- **No report sharing.** A share copies inquiries, accounts, transactions and verifications, never a report: a cloned screening would be a "no match" for lists, versions and a matcher the destination never chose, which report honesty does not allow (ADR 0005). The destination runs its own reports on the hydrated data. A report id answers 422 `share_source_not_supported`.
- **No wallet credentials.** No verifiable credential, mobile document or wallet presentation is issued or verified (OpenID4VP, HAIP, SD-JWT VC, ISO/IEC 18013-5 and the Digital Credentials API wait for the wallet work, C286): they need per-operator registrations, real wallets on devices and libraries that were still moving when this release was planned.
- **The EU digital identity wallet relying-party registration is documentation only.** Under the EUDI Architecture and Reference Framework (version 3.0.0 as `docs/research/phase11-connect.md`, row R35, read it), a relying party registers and holds access and registration certificates before it asks a wallet for data. Each operator registers on its own; OpenVerify builds nothing for it in this release and registers no one.
- **No self-service withdrawal link.** After the flow ends, withdrawal goes through the organisation (`withdrawal-contact`), because OpenVerify has no end-user account; a self-service link is the next release's (C286). See [consent](consent.md).
- **No reusable personas** (the source API's reusable-persona identifiers and events): the source is retiring them (C286).
- **No prefetched copy** (`ready`): a cached copy would be personal data to redact for a latency gain.
- **No OAuth grants or claim-only results**: Connect covers the sharing need (C286).

## What a share cannot do

- **Recall.** A redemption copies data into the destination's own rows; withdrawing the consent or redacting the source stops future transfers and tells the counterparty, and recalls nothing. Each controller answers for its copy.
- **Reach outside the install.** The platform cannot reach a copy that left it (an export, a download), and backups keep redacted data until they expire.
- **Prove who is in the flow.** A copy says something about whoever the source verified. Only the binding rule of [provenance](provenance.md) ties it to the person in the destination's flow.
- **Stop misuse.** Scopes, the policy and the limits bound what the platform copies; they cannot stop a recipient from misusing data it was entitled to receive.
- **Copy biometric templates.** Face templates are never shared, whatever the policy says; a cloned selfie joins no repeat search at the destination.

## Caps (ours, provisional)

| Cap | Value | Basis |
|---|---|---|
| A token's lifetime | 60 seconds to 21 days, default 14 days, at most `share-token-max-seconds` | the source API's range and default |
| Peeks per token | 10 | so a peek is not a channel for watching a person's data change |
| Per redemption | 50 verifications, 200 files, 512 MiB of file bytes | the upload limits |
| `connect-redeem`, `connect-peek` | 60 a minute each, per principal and environment | about one share per onboarding |
| A consent's lifetime | `consent-valid-seconds` or the attested expiry, at most 21 days | the token cannot outlive it |

## As built: limits open after Workflow 11F (the next release)

- **The waiting position.** A destination-side accept does not wait for the redemption job, so a clone counts only on steps entered after the job commits; the skip of a step satisfied by a clone is not reliable end to end (KP11-19).
- **Markers.** The verification and check resources do not yet serve `provenance` or `cloned`, accounts and transactions not their hydrated fields, and the decision resource not `relied-on-cloned`; the console marks clones only on an inquiry that is itself a clone ([provenance](provenance.md)).
- **Clone gaps.** The extracted data of database, email-address, phone-number and selfie clones is not copied, and the default account type is used for `auto-create-account-type-id`.
- **Policy versions.** Earlier policy versions are not served, so the console cannot show a diff between versions.

## The client limits (KP11-22)

- **Android shows the built-in share-consent labels.** The client view serves only `text.body` and `biometric.body`, so the title and the accept, decline and withdraw labels come from the client's own words. An operator who overrides those labels sees the override on the web, not on Android (KP11-20, 11F's, would serve them).
- **`{expires}` is worded by the runtime's ICU.** The server words the consent's duration with `Intl.NumberFormat` (ICU 78.2 on Node 22.22.1 in Workflow 11A) and recomposes the text at the accept to compare digests. A Node upgrade between the serve and the accept can change those words, and the accept then answers `consent_text_mismatch`; the client re-reads the session and shows the newly served text, which the person accepts again. See [client-side](client-side.md).
