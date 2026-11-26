# Consent

This is not legal advice. It describes what OpenVerify records and enforces; whether a consent is valid for your purpose, in your jurisdiction, is for your own counsel. The built-in share-consent texts (`share.consent.*`, in English, with machine-drafted `es`, `fr`, `de` and `ar`) have not been reviewed by counsel: they are pending counsel's review (owner item Q7; KP11-23 on the release checklist), and the console says so (below).

Every share needs two consent records (`consent-record`, id `cnsr_…`; **ours**, reason: the source API documents no consent record, and OpenVerify will not move personal data between two controllers without a record each can show):

- a **source** record: the person's consent to disclose the data to the named recipient, cited when the source creates the token;
- a **destination** record: the person's consent for the destination to receive and process it, cited when the destination redeems.

Each controller keeps its own record in its own environment and answers for it.

## What a record holds

`side`, `purpose` (`share.reuse-kyc`), the recipient organisation and its name as shown, the `data-categories` the consent covers (`identity-fields`, `contact-fields`, `other-fields`, `document-images`, `biometric`, `check-results`), `explicit-biometric`, the text's locale, keys and SHA-256 (and the biometric text's), `method`, `witnessed`, `evidence`, `expires-at`, the withdrawal (`withdrawn-at`, `withdrawn-via`, `withdrawal-reason`), `outcome` (`accepted` or `declined`) and a derived `status` (`active`, `expired`, `withdrawn`, `redacted`, `declined`). The evidence's address, user agent and attested reference are sealed at rest and served only with `pii:view`. Routes: `GET /api/v1/connect/consent-records` and `GET /api/v1/connect/consent-records/{id}` (`connect-share-tokens:read`).

## Flow records (witnessed)

A `flow` record comes only from the `share-consent` step ([client-side](client-side.md)). The server composes the text (who discloses, the named recipient, the categories in words, the purpose, how long the consent lasts, the destination's retention term on the destination side, and how to withdraw), serves it with its digest, and on the person's accept records the session, the time, and the sealed address and user agent. The server compares the digest the client echoes with what it served (422 `consent_text_mismatch` otherwise).

A flow record shows what the server served, that the client reported showing it, and that an affirmative act happened in a session the platform witnessed. It does not prove who held the device, or that the person read the text.

## Attested records (not witnessed)

An operator can attest a consent given outside the flow: `POST /api/v1/connect/consent-records` under its own scope `connect-consent-records:attest` (held by no built-in role but `admin`, and never implied by `connect-share-tokens:write`, **ours**, reason: the key that creates tokens cannot also attest the consent that authorises them unless the operator grants both on purpose). It names the side, the connection, the subject, the categories, the biometric flag, an expiry (60 seconds to 21 days), an evidence reference (sealed), when the consent was given (within the last 30 days) and the exact text that was shown (1 to 20,000 characters, sealed on the record).

- An attested record is labelled "not witnessed" (`witnessed: false`) in the API and both consoles, and the destination sees that label through the token's `source-consent`.
- The destination's policy decides which attested source consents it accepts (`attested-consent`: `none`, `non-biometric` by default, or `all`).
- An attestation is refused (409 `consent_declined_in_flow`) within the step's `consent-valid-seconds` after the person declined in a flow for the same recipient and purpose, on the subject, on any inquiry of the subject's account, or on the subject inquiry's account.

An attested record is the operator's statement and is shown as such.

## The explicit biometric tick

A share that carries `biometric` (selfie images, ID portraits, liveness and face-match results) needs `explicit-biometric: true`. In a flow it is a separate tick, not ticked in advance, with its own text and digest; the accept is refused without it when the share needs it (422 `explicit_consent_required`). Face templates are never in any share.

## Declining

Declining never ends the flow (**ours**, reason: consent must be free, so refusing it costs the person nothing but the reuse). A decline creates a `flow` record with `outcome: declined` (session and time only); no token or redemption can cite it, both consoles show it on the subject's page, and an attestation cannot override it (above). On the destination side the token stays `created` but can no longer be redeemed through that inquiry or by API (409 `consent_declined_in_flow`).

## Withdrawal

- **Routes:** `POST /api/v1/connect/consent-records/{id}/withdraw` (`connect-share-tokens:write`, `withdrawn-via: api`), the console action (`withdrawn-via: operator`), and, while the flow session lives, the flow's withdrawal exit on every later screen (`withdrawn-via: flow`). An optional reason: `subject-request`, `operator-decision` or `other`. A second withdrawal answers 409 `consent_already_withdrawn`.
- **Effects, in one transaction:** a `created` token expires (`consent_withdrawn`); a running redemption fails at commit; a `redeemed` share recalls nothing, and the counterparty receives `connect/share-token.consent-withdrawn` so its operator can act. On the destination side, a withdrawal after redemption marks the copies (`provenance.consent-withdrawn-at`), which stop counting under `accept-cloned-results` from then on.
- **Its limits.** Withdrawal stops every future transfer under the record; a copy already made belongs to its controller, and both operators must act on the event. After the flow ends, withdrawal is operator-mediated: OpenVerify has no end-user account, so the built-in text tells the person to contact the organisation, filled from the step's required `withdrawal-contact`. A self-service withdrawal link is not built ([limits](limits.md)). Whether operator-mediated withdrawal is as easy as giving consent is a question for counsel (Q7).
- **No swap of basis.** A withdrawn record can be cited by nothing, and no route changes a record's method, purpose, recipient or categories.

## Expiry, redaction and retention

A record expires at `expires-at` (the step's `consent-valid-seconds`, default 14 days, or the attested expiry), and a token cannot outlive it. A record is redacted with the data it covers: its sealed evidence, text keys and subject link are cleared, and its bare fact (time, side, purpose, recipient, categories, digest, method, withdrawal) is kept for the environment's `consent-proof-retention-days` (0 to 3,650, default 0), then deleted. A destination record follows the copy: once the redemption commits, its subject is the destination object, so redacting the copy reaches its evidence.

## Counsel's review is pending

Until the owner records counsel's review (Q7), the English `share.consent.*` keys carry the review status `counsel-unreviewed`, the template editor shows the built-in consent texts as "not reviewed by counsel", and publishing a version whose `share-consent` step uses them needs the audited acknowledgement `share-consent-default-text`. An operator may replace them with its own reviewed copy for each key. The machine-drafted translations also await the fluent review of KP10-16.
