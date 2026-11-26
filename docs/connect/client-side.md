# Client-side redemption

Instead of redeeming by API, the destination can let the person complete the share in its own flow, on the web or with the Android SDK.

## A server-created inquiry, no token in any URL

**Ours** (reason: a token in a URL leaks through history, referrers and logs, and a forwarded link would carry it; the source API's model passes it to the flow, OpenVerify never does). Client-side redemption starts only from an inquiry the destination's backend creates with `POST /api/v1/inquiries` and `meta.share-token-id`, under the scopes `inquiries:write` and `connect-share-tokens:redeem`:

- the token must be inbound to the caller's environment, `created` and unexpired;
- the template must contain a destination-side `share-consent` step (422 `share_consent_step_missing`);
- one inquiry per token (409 `share_token_in_use`).

The person reaches that inquiry with the ordinary session or one-time-link credentials (in the URL fragment, never sent to a server). There is no template-id entry and no share-token query parameter anywhere, and the Android SDK's `Request` and one-time-link entry take no token: the mobile SDK option of the source API is replaced by `meta.share-token-id` on the server ([mapping](mapping.md)).

## The `share-consent` step

A flow-spec v2 step `{type: 'share-consent', id, side, connection-id (source side), consent-valid-seconds, withdrawal-contact, copy-keys?}`.

- **Source side:** the person consents to disclose to the named recipient; the accept creates the source's `flow` consent record.
- **Destination side:** the person consents to the destination receiving the data; the accept creates the destination's record and enqueues the redemption into this inquiry (the internal `fill-inquiry` mode: fields hydrated, every shareable verification copied as a clone with its provenance).
- **The client view** is composed by the server: the recipient's and source's names, the categories, the text `{locale, body, sha256, keys}` and, when the share carries biometric data, a separate biometric text with its own digest. No token id, connection id or source object id is in it. The client composes no consent text.
- **Exits:** `POST /api/v1/flow/share-consents/{step-id}/accept` with the digests and the biometric tick, and `.../decline`. A digest that differs from what the server served answers 422 `consent_text_mismatch`; both clients also recompute the digest of the text they display and show the unsupported screen on a mismatch, so neither reports a text it did not show.
- **Declining** never ends the flow: the flow continues as a fresh verification ([consent](consent.md)).
- **Withdrawal exit:** while the session lives, every later screen and the completion screen offer "withdraw" for each accepted share-consent of the session (`withdrawable-share-consents` in the session response; `POST /api/v1/flow/share-consents/{step-id}/withdraw`), without moving the flow's position.
- **Publish checks:** a source step's connection must be an outbound connection of the template's organisation; the step may not follow a completion; a destination step must precede every step `accept-cloned-results` lists; a withdrawal contact is required; a retention term is required when the share can carry biometric data; the step fails publish while Connect is disabled.

## Binding the person to the copy (C235.8)

The flow never renders a hydrated or cloned value to the person, so whoever opens a forwarded link learns nothing from the copy. Binding that person to the copy is the template's job: a destination template that relies on cloned results must keep a live `selfie` step whose face match runs against the cloned portrait, or carry the audited `cloned-results-unbound` acknowledgement that accepts the risk of reuse by someone else ([provenance](provenance.md)). As built, the accept does not wait for the redemption job, so a clone counts only on steps entered after the job commits; the end-to-end skip with the live selfie match is not proved (KP11-19, open after Workflow 11F: the next release), and the full-stack spec and the Android stack test drive the case with `accept-cloned-results` off, where every step runs live beside the clone.

## Web and Android

- **Web** (`apps/flow`): the text, the recipient and the categories in words, the separate unticked biometric tick when served, accept and decline, with the accessibility rules of the flow.
- **Android** (`openverify-sdk`, shared Kotlin in `commonMain`): a `share-consent` renderer with accept, decline and the withdrawal affordance on every later step and the completion screen; the biometric tick is held in memory only. The shared Kotlin is also compiled for iOS targets to stay iOS-ready; nothing for iOS is tested or published.

## Two client limits (KP11-22)

- **Android shows the built-in labels.** The client view serves only `text.body` and `biometric.body`; the screen's title and the accept, decline and withdraw labels come from each client's own catalog. An operator's override of those four labels shows on the web but not on Android, where the built-in words are shown (`ui/steps/ShareConsentStep.kt`). Serving the label members is KP11-20, open after Workflow 11F (the next release).
- **`{expires}` depends on the runtime's ICU.** The consent duration is put into words by the server's `Intl.NumberFormat` (ICU 78.2 on Node 22.22.1 when 11A built it), and the accept recomposes the text to compare digests. If the API's Node runtime, and so its ICU, changes between serving a step and the person's accept, the words can differ and the accept answers `consent_text_mismatch`; the client re-reads the session and shows the newly served text, which the person accepts again. Upgrade the API's runtime between flows, not across open share-consent steps.
