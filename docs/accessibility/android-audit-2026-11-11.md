# Android SDK accessibility audit, 2026-11-11 (Phase 10, Workflow 10D)

Written by `android-a11y-audit` (Workflow 10D Stage 1) under C212 of `docs/plans/phase-10.plan.md`, for the Android SDK (`android/openverify-sdk`) as built by Workflows 10A to 10C. The standard is WCAG 2.2 level AA, read for a native app through W3C's WCAG2ICT guidance. Evidence of every step (commands, output, timings with the load average) is in `docs/tdd/phase10-android-a11y-audit.tdd.md`.

**No person has run the manual part.** This file holds its checklist with the results table empty, and nothing here is a conformance claim (decision 47; C212.6). The automated checks ran on the build host under Robolectric: they read the semantics a screen reader is given and the layout Compose computes. They do not hear TalkBack, see a real phone's fonts or feel a real keyboard. No emulator or CI run is evidence for anything in this file, and a phone ran one thing only: the device test of fix D1's layout over the real camera preview (below).

## Method

1. **The inventory** was read from the code: every `FlowState`, every NFC view, and every message, phase, notice and error a screen can show. It is held as code (`A11yCatalog`, in `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/ui/a11y/`), and a test fails the build when a state type, an enum value or a golden on disk has no entry (`A11yInventoryTest`).
2. **Each state is drawn as the activity draws it**: inside the SDK's theme, with the brand header's place, the help slot with both links and the language selector, on a 360 by 800 dp window.
3. **Google's Accessibility Test Framework 4.1.1** runs over every golden through `verifyGolden`, failing on its errors and printing its warnings. 113 goldens were added for the states that had none after 10C, so every state has a golden or shares, by name, the layout of a state that has one (the same screen with another message).
4. **The SDK's own host tests** run over every state for what the framework does not decide (the table below).
5. **Defects** found by these checks were fixed test-first in `android/openverify-sdk`.
6. **The manual checklist** is written for the person who runs it; its results table is empty.

## The inventory

188 states of 21 screens; 110 have goldens of their own (216 goldens; the 217th on disk is the screenshot task's own wiring golden), and 78 are the same layout with another message. Phase 11's Workflow 11A (`clients-connect`) added the share-consent screen and the withdrawal under the completion screen: eight states, twelve goldens in `clients-connect/` (C238.7, C256.1), each through the same checks; no other row changed. "Host sweep" is every rule of the next section that applies to the state; "ATF" is the framework's run on the golden.

<!-- inventory:start -->
| Screen | State | Goldens | Checks run | Result |
|---|---|---|---|---|
| The chrome: brand header, sandbox banner, help slot, language selector | `chrome` | 6: `android-theme/` chrome-builtin-light, chrome-builtin-dark-ar, chrome-operator-light, chrome-operator-dark, chrome-operator-light-ar, chrome-operator-dark-ar | host sweep; ATF on each golden | pass |
| The chrome: brand header, sandbox banner, help slot, language selector | `chrome-sandbox-banner` | 1: `android-a11y-audit/` chrome-sandbox-banner | host sweep; ATF on each golden | pass |
| The chrome: brand header, sandbox banner, help slot, language selector | `chrome-language-menu` | 1: `android-a11y-audit/` chrome-language-menu | host sweep; ATF on each golden | pass |
| Loading and processing | `loading` | 4: `android-a11y-audit/` status-loading, status-loading-ar-dark-2x, status-loading-operator-light, status-loading-operator-dark | host sweep; ATF on each golden | pass |
| Loading and processing | `awaiting-camera` | none of its own: the layout of `loading` | host sweep | pass |
| Loading and processing | `processing-photos` | 1: `android-a11y-audit/` status-processing | host sweep; ATF on each golden | pass |
| Loading and processing | `processing-verification` | none of its own: the layout of `processing-photos` | host sweep | pass |
| Loading and processing | `nfc-checking` | none of its own: the layout of `processing-photos` | host sweep | pass |
| Consent | `consent` | 13: `android-a11y-audit/` consent, consent-es, consent-fr, consent-de, consent-ar, consent-en-2x, consent-es-2x, consent-fr-2x, consent-de-2x, consent-ar-2x, consent-ar-dark-2x, consent-operator-light, consent-operator-dark | host sweep; ATF on each golden | pass |
| Consent | `consent-submitting` | 1: `android-a11y-audit/` consent-submitting | host sweep; ATF on each golden | pass |
| Consent | `consent-text-changed` | 1: `android-a11y-audit/` consent-text-changed | host sweep; ATF on each golden | pass |
| Camera permission | `camera-rationale` | 4: `android-a11y-audit/` camera-rationale, camera-rationale-ar-dark-2x, camera-rationale-operator-light, camera-rationale-operator-dark | host sweep; ATF on each golden | pass |
| Camera permission | `camera-denied` | 1: `android-a11y-audit/` camera-denied | host sweep; ATF on each golden | pass |
| Camera permission | `camera-unavailable` | 1: `android-a11y-audit/` camera-unavailable | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-id-front` | 4: `android-a11y-audit/` capture-id-front, capture-id-front-ar-dark-2x, capture-id-front-operator-light, capture-id-front-operator-dark | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-id-back` | none of its own: the layout of `capture-id-front` | host sweep | pass |
| Capture: the preview with its guide and the shutter | `capture-id-retry-hints` | 1: `android-a11y-audit/` capture-id-retry-hints | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-id-upload-offered` | 1: `android-a11y-audit/` capture-id-upload-offered | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-failed` | 1: `android-a11y-audit/` capture-failed | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-selfie` | 1: `android-a11y-audit/` capture-selfie | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-selfie-left` | none of its own: the layout of `capture-selfie` | host sweep | pass |
| Capture: the preview with its guide and the shutter | `capture-selfie-right` | none of its own: the layout of `capture-selfie` | host sweep | pass |
| Capture: the preview with its guide and the shutter | `capture-selfie-restarted` | 1: `android-a11y-audit/` capture-selfie-restarted | host sweep; ATF on each golden | pass |
| Capture: the preview with its guide and the shutter | `capture-document-page` | 1: `android-a11y-audit/` capture-document-page | host sweep; ATF on each golden | pass |
| Capture: the photo's review | `capture-review` | 4: `android-a11y-audit/` capture-review, capture-review-ar-dark-2x, capture-review-operator-light, capture-review-operator-dark | host sweep; ATF on each golden | pass |
| Capture: the photo's review | `capture-review-sending` | 1: `android-a11y-audit/` capture-review-sending | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-no-hint` | 1: `document-guidance/` document-guidance-no-hint | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-move-closer` | 1: `document-guidance/` document-guidance-move-closer | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-hold-still` | 4: `document-guidance/` document-guidance-hold-still, document-guidance-ar-dark-large; `android-a11y-audit/` capture-id-guided, capture-id-guided-ar-dark-2x | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-tilt-away` | 1: `document-guidance/` document-guidance-tilt-away | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-more-light` | 1: `document-guidance/` document-guidance-more-light | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-fit-card` | 1: `document-guidance/` document-guidance-fit-card | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-show-mrz` | 1: `document-guidance/` document-guidance-show-mrz | host sweep; ATF on each golden | pass |
| Capture guidance: an ID's side | `document-guidance-fit-page` | none of its own: the layout of `document-guidance-fit-card` | host sweep | pass |
| Capture guidance: the PDF417 side | `barcode-searching` | 2: `pdf417-guidance/` barcode-guide-searching; `android-a11y-audit/` capture-id-barcode | host sweep; ATF on each golden | pass |
| Capture guidance: the PDF417 side | `barcode-found` | 2: `pdf417-guidance/` barcode-guide-found, barcode-guide-found-ar-dark | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-starting` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-manual` | 1: `selfie-guidance/` selfie-guidance-manual | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-no-face` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-multiple-faces` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-too-far` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-too-close` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-off-centre` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-look-straight` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-turn-left` | 1: `selfie-guidance/` selfie-guidance-turn-left | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-turn-right` | none of its own: the layout of `selfie-guidance-hold-still` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-guidance-hold-still` | 3: `selfie-guidance/` selfie-guidance-hold-still; `android-a11y-audit/` capture-selfie-guided, capture-selfie-guided-ar-dark-2x | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-time-warning` | 3: `selfie-guidance/` selfie-guidance-time-warning, selfie-guidance-ar-dark-large; `android-a11y-audit/` capture-selfie-time-warning | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-time-extending` | none of its own: the layout of `selfie-time-warning` | host sweep | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-time-extended` | 1: `android-a11y-audit/` capture-selfie-time-extended | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-time-failed` | 1: `selfie-guidance/` selfie-guidance-more-time-failed | host sweep; ATF on each golden | pass |
| Capture guidance: a selfie pose, and the 2.2.1 time warning | `selfie-time-already-sent` | none of its own: the layout of `selfie-time-failed` | host sweep | pass |
| Phone and email codes | `otp-phone-entry` | 4: `android-a11y-audit/` otp-phone-entry, otp-phone-entry-ar-dark-2x, otp-phone-entry-operator-light, otp-phone-entry-operator-dark | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-phone-country-menu` | 1: `android-a11y-audit/` otp-phone-country-menu | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-email-entry` | 1: `android-a11y-audit/` otp-email-entry | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-entry-retry-hints` | 1: `android-a11y-audit/` otp-entry-retry-hints | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-entry-sending` | 1: `android-a11y-audit/` otp-entry-sending | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-code-entry` | 1: `android-a11y-audit/` otp-code-entry | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-code-resent` | 1: `android-a11y-audit/` otp-code-resent | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-code-expired` | 1: `android-a11y-audit/` otp-code-expired | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-code-no-sends-left` | 1: `android-a11y-audit/` otp-code-no-sends-left | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-code-checking` | none of its own: the layout of `otp-entry-sending` | host sweep | pass |
| Phone and email codes | `otp-limited` | 1: `android-a11y-audit/` otp-limited | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-limited-refused` | none of its own: the layout of `otp-limited` | host sweep | pass |
| Phone and email codes | `otp-error-destination-invalid-phone` | 1: `android-a11y-audit/` otp-entry-error | host sweep; ATF on each golden | pass |
| Phone and email codes | `otp-error-destination-invalid-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-destination-not-allowed-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-destination-not-allowed-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-delivery-failed-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-delivery-failed-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-incorrect-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-incorrect-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-expired-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-expired-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-exhausted-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-exhausted-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-not-sent-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-code-not-sent-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-resend-too-soon-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-resend-too-soon-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-destination-too-long-phone` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Phone and email codes | `otp-error-destination-too-long-email` | none of its own: the layout of `otp-error-destination-invalid-phone` | host sweep | pass |
| Entered values: database, AAMVA, business registry, website | `form-database` | 4: `android-a11y-audit/` form-database, form-database-ar-dark-2x, form-database-operator-light, form-database-operator-dark | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-database-errors` | 1: `android-a11y-audit/` form-database-errors | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-database-retry-hints` | 1: `android-a11y-audit/` form-database-retry-hints | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-database-submitting` | 1: `android-a11y-audit/` form-database-submitting | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-country-menu` | 1: `android-a11y-audit/` form-country-menu | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-aamva` | 1: `android-a11y-audit/` form-aamva | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-business-with-person` | 1: `android-a11y-audit/` form-business-with-person | host sweep; ATF on each golden | pass |
| Entered values: database, AAMVA, business registry, website | `form-website` | 1: `android-a11y-audit/` form-website | host sweep; ATF on each golden | pass |
| Supporting document | `document-choose` | 4: `android-a11y-audit/` document-choose, document-choose-ar-dark-2x, document-choose-operator-light, document-choose-operator-dark | host sweep; ATF on each golden | pass |
| Supporting document | `document-camera-only` | none of its own: the layout of `document-choose` | host sweep | pass |
| Supporting document | `document-unavailable` | 1: `android-a11y-audit/` document-unavailable | host sweep; ATF on each golden | pass |
| Supporting document | `document-picked` | 1: `android-a11y-audit/` document-picked | host sweep; ATF on each golden | pass |
| Supporting document | `document-uploading` | 1: `android-a11y-audit/` document-uploading | host sweep; ATF on each golden | pass |
| Supporting document | `document-retry-hints` | 1: `android-a11y-audit/` document-retry-hints | host sweep; ATF on each golden | pass |
| Supporting document | `document-error-empty` | 1: `android-a11y-audit/` document-error | host sweep; ATF on each golden | pass |
| Supporting document | `document-error-too-large` | none of its own: the layout of `document-error-empty` | host sweep | pass |
| Supporting document | `document-error-unsupported-type` | none of its own: the layout of `document-error-empty` | host sweep | pass |
| Supporting document | `document-error-unreadable` | none of its own: the layout of `document-error-empty` | host sweep | pass |
| Crypto wallet | `wallet-entry` | 4: `android-a11y-audit/` wallet-entry, wallet-entry-ar-dark-2x, wallet-entry-operator-light, wallet-entry-operator-dark | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-entry-restarted` | 1: `android-a11y-audit/` wallet-entry-restarted | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-entry-busy` | none of its own: the layout of `wallet-message-busy` | host sweep | pass |
| Crypto wallet | `wallet-message` | 1: `android-a11y-audit/` wallet-message | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-message-solana` | 1: `android-a11y-audit/` wallet-message-solana | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-message-expired` | 1: `android-a11y-audit/` wallet-message-expired | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-message-busy` | 1: `android-a11y-audit/` wallet-message-busy | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-error-chain-not-offered` | 1: `android-a11y-audit/` wallet-error | host sweep; ATF on each golden | pass |
| Crypto wallet | `wallet-error-address-invalid` | none of its own: the layout of `wallet-error-chain-not-offered` | host sweep | pass |
| Crypto wallet | `wallet-error-expected-address-mismatch` | none of its own: the layout of `wallet-error-chain-not-offered` | host sweep | pass |
| Crypto wallet | `wallet-error-challenge-invalid` | none of its own: the layout of `wallet-error-chain-not-offered` | host sweep | pass |
| Crypto wallet | `wallet-error-signature-too-long` | none of its own: the layout of `wallet-error-chain-not-offered` | host sweep | pass |
| Crypto wallet | `wallet-error-signed-message-too-long` | none of its own: the layout of `wallet-error-chain-not-offered` | host sweep | pass |
| The screen step and its components | `screen-content` | 1: `android-screens/` screen-content | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-empty` | 1: `android-screens/` screen-form-empty | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-filled` | 1: `android-screens/` screen-form-filled | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-errors` | 4: `android-screens/` screen-form-errors, screen-form-errors-ar-dark-2x, screen-form-errors-operator-light, screen-form-errors-operator-dark | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-submitting` | 1: `android-screens/` screen-form-submitting | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-refused` | 1: `android-screens/` screen-form-refused | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-form-matrix` | 10: `android-screens/` screen-form-matrix-en, screen-form-matrix-en-2x, screen-form-matrix-es, screen-form-matrix-es-2x, screen-form-matrix-fr, screen-form-matrix-fr-2x, screen-form-matrix-de, screen-form-matrix-de-2x, screen-form-matrix-ar, screen-form-matrix-ar-2x | host sweep; ATF on each golden | pass |
| The screen step and its components | `screen-cancel-confirm` | 1: `android-screens/` screen-cancel-confirm | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-mrz` | 3: `nfc-sdk/` nfc-entry-mrz, nfc-entry-mrz-operator-light, nfc-entry-mrz-operator-dark | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-can` | 1: `nfc-sdk/` nfc-entry-can | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-error-document-number` | none of its own: the layout of `nfc-entry-error-refused-by-chip` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-error-birth-date` | 1: `nfc-sdk/` nfc-entry-mrz-ar-dark-2x | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-error-expiry-date` | none of its own: the layout of `nfc-entry-error-refused-by-chip` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-error-can` | none of its own: the layout of `nfc-entry-error-refused-by-chip` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-error-refused-by-chip` | 1: `nfc-sdk/` nfc-entry-mrz-refused-sandbox | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-entry-retry-hints` | 1: `android-a11y-audit/` nfc-entry-retry-hints | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-sandbox-scenario-menu` | 1: `android-a11y-audit/` nfc-sandbox-scenario-menu | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-ready` | 3: `nfc-sdk/` nfc-tap-ready, nfc-tap-ready-operator-light, nfc-tap-ready-operator-dark | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-ready-sandbox` | 1: `nfc-sdk/` nfc-tap-ready-sandbox | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-challenge-expired` | 1: `nfc-sdk/` nfc-tap-expired | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-keep-still` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-lifted` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-unsupported-document` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-timeout` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-reader-busy` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-read-failed` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-one-more-tap` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-notice-reading-again` | none of its own: the layout of `nfc-tap-notice-challenge-expired` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-requesting` | none of its own: the layout of `nfc-tap-waiting` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-waiting` | 1: `nfc-sdk/` nfc-tap-waiting | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-keep-still` | 1: `nfc-sdk/` nfc-tap-keep-still | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-connecting` | none of its own: the layout of `nfc-tap-signing` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-reading-chip-dg1` | 1: `nfc-sdk/` nfc-tap-reading-ar-dark-2x | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-reading-chip-dg2` | 1: `nfc-sdk/` nfc-tap-reading | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-reading-chip-com` | none of its own: the layout of `nfc-tap-reading-chip-dg2` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-reading-chip-sod` | none of its own: the layout of `nfc-tap-reading-chip-dg2` | host sweep | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-signing` | 1: `nfc-sdk/` nfc-tap-signing | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tap-read` | 1: `nfc-sdk/` nfc-tap-read | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-review` | 4: `nfc-sdk/` nfc-review, nfc-review-ar-dark-2x, nfc-review-operator-light, nfc-review-operator-dark | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-review-again` | 1: `nfc-sdk/` nfc-review-again | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-tips` | 4: `nfc-sdk/` nfc-tips, nfc-tips-ar-dark-2x, nfc-tips-operator-light, nfc-tips-operator-dark | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-unable-reader` | 1: `nfc-sdk/` nfc-unable-reader | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-unable-phone` | 1: `nfc-sdk/` nfc-unable-phone | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-unable-off` | 4: `nfc-sdk/` nfc-unable-off, nfc-unable-off-ar-dark-2x, nfc-unable-off-operator-light, nfc-unable-off-operator-dark | host sweep; ATF on each golden | pass |
| NFC: access entry, tap, progress, review, tips, cannot read | `nfc-unable-spent` | 1: `nfc-sdk/` nfc-unable-spent | host sweep; ATF on each golden | pass |
| Share consent: the server's text, the biometric box, the choice | `share-consent` | 4: `clients-connect/` share-consent, share-consent-ar-dark-2x, share-consent-operator-light, share-consent-operator-dark | host sweep; ATF on each golden | pass |
| Share consent: the server's text, the biometric box, the choice | `share-consent-no-biometric` | none of its own: the layout of `share-consent` | host sweep | pass |
| Share consent: the server's text, the biometric box, the choice | `share-consent-tick-missing` | 2: `clients-connect/` share-consent-tick-missing, share-consent-tick-missing-ar-dark-2x | host sweep; ATF on each golden | pass |
| Share consent: the server's text, the biometric box, the choice | `share-consent-submitting` | 2: `clients-connect/` share-consent-submitting, share-consent-submitting-ar-dark-2x | host sweep; ATF on each golden | pass |
| Completion (final) | `completed-share-withdraw` | 2: `clients-connect/` completed-share-withdraw, completed-share-withdraw-ar-dark-2x | host sweep; ATF on each golden | pass |
| Completion (final) | `completed-share-withdrawing` | none of its own: the layout of `completed-share-withdraw` | host sweep | pass |
| Completion (final) | `completed-share-withdraw-failed` | none of its own: the layout of `completed-share-withdraw` | host sweep | pass |
| Completion (final) | `completed-share-withdrawn` | 2: `clients-connect/` completed-share-withdrawn, completed-share-withdrawn-ar-dark-2x | host sweep; ATF on each golden | pass |
| Waiting for the server | `waiting` | 4: `android-a11y-audit/` waiting, waiting-ar-dark-2x, waiting-operator-light, waiting-operator-dark | host sweep; ATF on each golden | pass |
| Completion (final) | `completed` | 4: `android-a11y-audit/` completed, completed-ar-dark-2x, completed-operator-light, completed-operator-dark | host sweep; ATF on each golden | pass |
| Failure with the contest route (final) | `failed` | 1: `android-screens/` failure-plain | host sweep; ATF on each golden | pass |
| Failure with the contest route (final) | `failed-contest-link` | 13: `android-screens/` failure-contest-link-en, failure-contest-link-en-2x, failure-contest-link-es, failure-contest-link-es-2x, failure-contest-link-fr, failure-contest-link-fr-2x, failure-contest-link-de, failure-contest-link-de-2x, failure-contest-link-ar, failure-contest-link-ar-2x, failure-contest-link-ar-dark-2x, failure-contest-link-operator-light, failure-contest-link-operator-dark | host sweep; ATF on each golden | pass |
| Failure with the contest route (final) | `failed-contest-contact` | 1: `android-screens/` failure-contest-contact | host sweep; ATF on each golden | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `expired` | 4: `android-a11y-audit/` closed-expired, closed-expired-ar-dark-2x, closed-expired-operator-light, closed-expired-operator-dark | host sweep; ATF on each golden | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `session-expired` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `session-canceled` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `redacted` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `link-refused` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `halted` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `unsupported` | none of its own: the layout of `expired` | host sweep | pass |
| Expired, session ended, redacted, link refused, halted, unsupported | `unsupported-server` | none of its own: the layout of `expired` | host sweep | pass |
| Error with retry | `error-network` | 4: `android-a11y-audit/` error-retry, error-retry-ar-dark-2x, error-retry-operator-light, error-retry-operator-dark | host sweep; ATF on each golden | pass |
| Error with retry | `error-session-expired` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-inquiry-mismatch` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-rejected` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-out-of-sync` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-server` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-invalid-response` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-still-processing` | none of its own: the layout of `error-network` | host sweep | pass |
| Error with retry | `error-final` | 1: `android-a11y-audit/` error-final | host sweep; ATF on each golden | pass |
<!-- inventory:end -->

**States with no golden of their own**, and why that is enough for the framework's checks: each differs from the state it names only in the words of one message (an error's text, a notice's, a phase's, a title's), and each is still drawn and checked by the host sweep in every language at both font sizes.

**Not in the inventory:**

- Material's date picker dialog, which the screen step's date field opens. It is Material's own component in its own window; the typed date beside it is in the inventory.
- The system's screens the SDK sends a person to: the camera permission prompt, the file and photo pickers, the NFC settings, the browser for a help, privacy or contest link.
- The real camera preview. A fake camera draws an empty box, so a hint's contrast over a real picture is not measured.
- The demo app (`android/demo-app`), which is a test harness and not part of the SDK.

## Automated checks and results

Run at `HEAD` of this Workflow's Stage 1, on the host. A "check" is one state drawn in one look.

| # | Rule | WCAG 2.2 criterion (number, short name in our words) | Where | Checks | Result |
|---|---|---|---|---|---|
| C1 | Google's Accessibility Test Framework, latest preset, errors fail | 1.1.1 text alternatives, 1.4.3 contrast (as warnings), 2.5.8 target size, 4.1.2 name and role | `verifyGolden` on every golden (`:openverify-sdk:screenshotTest`) | 217 goldens | no error; 121 warnings, see below |
| C2 | Every control has text or a content description | 4.1.2 name, role, value; 1.1.1 | `A11ySweepTest` | 188 | pass |
| C3 | Every control's touch target is at least 48 dp each way | 2.5.8 target size (stricter than its 24 px) | `A11ySweepTest` | 188 | pass |
| C4 | The first thing read on a screen is its heading | 1.3.2 meaningful sequence, 2.4.6 headings | `A11ySweepTest`, English and Arabic | 376 | pass after fix D2 |
| C5 | An error summary comes after the heading and before every field | 1.3.2, 3.3.1 error identification | `A11ySweepTest` | 2 | pass |
| C6 | Every status and error node is a live region with words; a field's error is said in words | 4.1.3 status messages, 1.4.1 use of colour (the narrow rule) | `A11ySweepTest` | 188 | pass after fix D3 |
| C7 | No text is cut off and no control is lost at font scale 2.0, in English, Spanish, French, German, Arabic and the `en-XA` pseudo-locale | 1.4.4 resize text, 1.4.10 reflow | `A11ySweepTest` over the SDK's one text composable (`ui/text/SdkText.kt`) | 1,128 | pass after fix D1 |
| C8 | Every text is drawn by the SDK's one text composable, so C7 sees it | (supports C7) | `SdkTextSourceTest`, `SdkTextTest` | all shipped sources | pass after the move |
| C9 | Announcements are made once per change: an NFC phase, the waiting message, a selfie hint, a document and barcode hint, the time warning, a capture's title; a countdown announces nothing | 4.1.3, 2.2.1 timing | `A11yAnnouncementsTest` (counts what the live regions hold) | 7 tests | pass |
| C10 | In Arabic a heading starts at the right; the preview, the outlines, the barcode guide and the review photo sit as in English; a selfie's left and right are the person's own; no shipped source draws an icon or flips what it draws | 1.3.2, 1.3.4 orientation of content (ours: C199.5) | `A11yRightToLeftTest` | 4 tests | pass |
| C11 | Every usable control can take focus | 2.1.1 keyboard (the precondition only) | `A11yKeyboardTest` | 188 | pass |
| C12 | The shutter is on screen in every preview state at 1.0 in five languages, and on the scrolling page at 2.0 | 2.2.1 (C212.3) | `A11yShutterTest` | 2 tests | pass |
| C13 | No duration in the shipped sources but those `docs/android/accessibility.md` classifies; each lifetime's row cites host tests that exist | 2.2.1 timing adjustable | `A11yTimingTest` | 3 tests | pass |
| C14 | The statement's Android part claims nothing beyond this file's manual results | (honesty, C212.6) | `apps/dashboard/src/accessibility-statement-records.test.ts` | 5 tests | pass |

**The framework's warnings.** 121 over the 217 goldens, none of which it counts as an error:

- **86 on text contrast.** 39 are on the audit's own 113 goldens, over 19 different texts, 37 of them marked by the framework as possibly obscured. Most are the words of a button that is disabled in that state ("Continue" before the agreement is ticked, "Send code" before a number is typed, "Confirm" before the code is whole), which 1.4.3 leaves out as inactive components. The others are a menu item, a text inside the document step's list and buttons in a dark or sending state. The other 44 are on 10A's screen-step goldens and 10C's NFC goldens. Workflow 11A added 3, on the share-consent goldens: the words of the two buttons while the choice is sent, when both are disabled.
- **35 on two controls with the same spoken text**, all on 10A's screen-step goldens (the form with every component repeats option names across its groups).

This audit does not fail on them either: a person judges each in rows A1 and A9.

## Defects found and fixed

| # | Defect | Found by | Fix | Commit |
|---|---|---|---|---|
| D1 | The capture screen did not scroll. At font scale 2.0, in every language, text around the preview was cut off, the guidance's hint and note were cut inside the preview, and "Cancel" (in some states the shutter too) was pushed off the screen with no way to reach it | C7: 7 findings in English, 13 in Arabic, 53 in French, 54 in Spanish, 57 in German, 76 in `en-XA` | The capture screen is one scrolling column; the preview takes the height left and is never lower than 120 dp or than its guidance's words need. `CaptureScreenLayoutDeviceTest` lays it out over the real CameraX preview: 2 of 2 on a Pixel 9, Android 17 | `1af3397c6`, `ae97bf949` |
| D2 | The first thing read was not the heading: on the capture screens "Photo 1 of 2" came first (38 states), and on the loading, processing, finalizing and waiting screens an unnamed progress indicator did (8 states); the loading screen had no heading at all | C4: 46 findings in each direction | The capture's heading is first and its progress line second; a status screen's spinner is not read (the words beside it say what is happening); the loading message is that screen's heading | `1af3397c6` |
| D3 | "Saving your consent" was not announced: it was not a live region | C6: 1 finding | It is a polite live region, merged with its spinner, as every other request on its way | `1af3397c6` |
| D4 | Texts were drawn by Material's `Text` directly in 22 files, so nothing recorded a cut-off text | C8 | Every text goes through `ui/text/SdkText.kt`, which records `hasVisualOverflow` and `didOverflowHeight` in a test-only semantics property | `18e1661f4` |

No golden of an earlier owner changed: the 92 goldens recorded by 10A to 10C still compare equal.

## Manual checklist (not run)

For the person who runs the pass (the owner or a contracted auditor; never an agent). Use a real phone, say which one and which Android and TalkBack versions, and the demo app's sandbox flows with synthetic data only. Fill one row of "Manual results" per checklist row.

| # | What to do | What to look for | WCAG 2.2 criteria |
|---|---|---|---|
| A1 | TalkBack on, English. Walk every screen of the inventory by swiping, from launch to the final screen: consent, capture, review, codes, forms, the document, the wallet, the screen step with every component, waiting, completion, failure with the contest route, the closed and error screens | Each screen starts at its heading; every control says its name, role and state; nothing is read twice or skipped; nothing unlabelled; where two controls say the same words (the framework's warning on the screen step's option groups), their group tells them apart; the help slot is in the same place on every screen | 1.1.1, 1.3.1 info and relationships, 1.3.2, 2.4.3 focus order, 2.4.6, 3.2.6 consistent help, 4.1.2 |
| A2 | TalkBack on, a selfie with a face detector installed (10E) or the manual shutter until then. Move in and out of the oval; let the capture run to 20 s before its end | The hint speaks only settled announcements, never several a second; the time warning's count is said once, not every second; "More time" is reached and works; the photo's review is announced | 4.1.3 status messages, 2.2.1 timing adjustable |
| A3 | TalkBack on, the NFC step with the sandbox test chip (and a real reader from 10E): the access entry, "I'm ready", the tap, the progress, the review, the tips, NFC off | Each phase is said once; the progress bar does not chatter; a notice ("keep it still", "the time ran out") is said when it appears; the review reads each label with its value | 4.1.3, 1.3.1, 2.2.1 |
| A4 | TalkBack on, make errors: an empty required field on a screen step, a wrong code, a refused document, a failed photo, no network | The error summary is announced and takes focus; each summary line moves to its field; a field's error is read with the field; an error screen says what happened and offers a way on | 3.3.1 error identification, 3.3.3 error suggestion, 4.1.3 |
| A5 | TalkBack on, switch the language in the selector to Spanish, French, German and Arabic and repeat A1 on the consent, capture and one form screen | TalkBack speaks each language in its own voice; the selector's language names are spoken in their own language; no English is left on screen | 3.1.1 language of page, 3.1.2 language of parts |
| A6 | Arabic, with and without TalkBack | Layout and reading order run right to left; the camera preview, the card and face outlines, the barcode guide and the logo are not mirrored; a selfie's "turn left" means the person's own left | 1.3.2 |
| A7 | Font size at its largest (200%) and display size at its largest, each language, every screen | No text is cut off or overlaps; every screen scrolls; on the capture screen the preview and the shutter can be brought on screen together; the selfie's time warning, which is drawn over the top of the screen, hides nothing that is needed | 1.4.4 resize text, 1.4.10 reflow, 2.4.11 focus not obscured |
| A8 | A hardware keyboard (Bluetooth or USB), TalkBack off: Tab, Shift+Tab, Enter, Space, the arrow keys, Escape | Every control is reached in reading order; the focus highlight is always visible; menus and the date picker open, are used and close by keys; nothing traps focus; on a selfie, "More time" is reached within the warning's 20 s | 2.1.1 keyboard, 2.1.2 no keyboard trap, 2.4.3, 2.4.7 focus visible, 2.4.11 |
| A9 | Light and dark, the built-in palette and an operator's; look at errors, disabled buttons and the hints over a real camera picture | The texts the framework warned about (above) can be read; an error is never shown by colour alone; a hint over a bright or dark picture can be read | 1.4.1 use of colour, 1.4.3 contrast, 1.4.11 non-text contrast |
| A10 | TalkBack on, on Android 14 or later and on an older phone: every typed field (a form field, a code, a masked text, the MRZ and CAN fields) and the NFC review | `FLAG_SECURE`, the hidden overlays and the accessibility-data-sensitive fields hide nothing from TalkBack: each field's label, value and error are read | 4.1.2, 1.3.1 |
| A11 | The secret fields (a masked text, the code, a document number, the MRZ fields, the CAN) with the phone's keyboard | The keyboard is a plain text or number keyboard with autocorrect off. Note what the keyboard learns or suggests and whether an autofill service offers to save or fill the field (known gaps K3 to K5) | 1.3.5 identify input purpose, 3.3.8 accessible authentication |
| A12 | Let each time limit run out, with TalkBack on and again with a switch or a keyboard: a selfie capture (extend it ten times, then let it end), a chip challenge, a code, a wallet message, the session | Each is said before or when it ends as `docs/android/accessibility.md` tables it; nothing typed is lost without warning; more time or a new start is always offered | 2.2.1 |
| A13 | Rotate the phone on each screen; turn "Remove animations" on; leave a capture and the waiting screen alone for a minute | Every screen works in both orientations; no essential motion; the screen stays on during a capture and the wait | 1.3.4 orientation, 2.3.3 (AAA, noted only), 2.2.1 |
| A14 | The system screens the SDK opens: the camera permission prompt, the file and photo pickers, the date picker, the NFC settings, a help link in the browser | On return, focus is back on the control that opened them and the screen is announced | 2.4.3, 3.2.2 on input |

### Manual results

Empty until a person has run the pass. One row per checklist row; "Result" is `pass`, `fail` or `not tested`.

| Row | Who | Date | Phone, Android, assistive technology | Result | Notes or defect |
|---|---|---|---|---|---|

## Known gaps

| # | Gap | Tracking |
|---|---|---|
| K1 | The manual pass (rows A1 to A14) has not been run, so no criterion is confirmed by a person | Owner item KP10-17, carried to the release gate (Phase 11's acceptance; decision 47) |
| K2 | On the host a key event moves no focus, so the Tab order, the focus highlight and keyboard use of menus are unchecked by any automated test (C11 holds only that controls can take focus) | Row A8 |
| K3 | Secret fields (`masked_text`, the one-time code, a document number) use a plain text or number keyboard with autocorrect off. A password keyboard would declare them passwords to every autofill service; Compose 1.11 cannot set `IME_FLAG_NO_PERSONALIZED_LEARNING` or mark one node not important for autofill, so a keyboard may still learn what is typed and the field stays in the autofill structure (Workflow 10A Stage 3, android-screens 3) | Row A11; a later Compose version |
| K4 | SMS code autofill is no longer offered: the code field dropped its one-time-code content type with the number-password keyboard (Workflow 10A Stage 3, android-screens 4) | Row A11 |
| K5 | The NFC step's MRZ and CAN fields have the same two limits as K3 (Workflow 10C Stage 2, nfc-sdk 11) | Row A11 |
| K6 | With TalkBack on a real phone, the selfie hint's live region must speak only settled announcements and the time warning's count must be said once. The host counts what the regions hold (C9); it does not hear TalkBack (Workflow 10B, selfie-guidance) | Row A2 |
| K7 | The selfie's time warning is a card drawn over the top of the capture screen. While it shows (up to 20 s, or until more time is given) it covers the pose's heading, and at a large font more of the screen; the hint inside the preview still says the pose | Row A7; a redesign is a decision for Phase 11 |
| K8 | At font scale 2.0 the capture screen scrolls, so the shutter can be below the fold until the person scrolls | Row A7; `docs/android/accessibility.md` |
| K9 | Fixed after the audit (Workflow 10D, `fix-sdk`, `eee35a282`): the wallet step's expired message said "get a new message" while the only control that led there was named "Use another wallet". The expired state now has its own "Get a new message" button, and the golden `wallet-message-expired` was recorded again with it | Closed; the button's Spanish, French, German and Arabic texts are machine-drafted (K13) |
| K10 | The framework's 121 warnings (86 on text contrast, 35 on controls with the same spoken text) are not judged | Rows A1 and A9 |
| K11 | The pseudo-locale lengthens the SDK's own strings only. An operator's copy (a screen step's labels, the consent's custom title) is as long as the operator writes it; the goldens use short synthetic copy | The operator's preview (Phase 9) |
| K12 | The host draws with Robolectric's fonts and a fake camera. A phone's fonts, a real preview and Material's date picker dialog are not measured | Rows A7, A9, A14 |
| K13 | The built-in Spanish, French, German and Arabic texts are machine-drafted; what an announcement means in them is not judged here | Owner item KP10-16 |

## Measurements

In `docs/tdd/phase10-android-a11y-audit.tdd.md`, with each Gradle call's duration, lock wait and load average.
