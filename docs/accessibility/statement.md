# Accessibility statement

**Date:** 2026-11-11. **Standard:** WCAG 2.2, level AA. **Status: OpenVerify's web verification flow and operator console are not yet evaluated for conformance with WCAG 2.2 level AA.** The automated part of the audit is done; the manual part, which a person runs with assistive technologies, has not been run, so this statement makes no conformance claim. Phase 9 is recorded as "WCAG 2.2 AA audit: automated part done, manual part not run, no conformance claimed", and the manual part is an open item for the release gate (Phase 11's acceptance).

The audit behind this statement, with its method, samples, results, defects and the manual checklist, is [`audit-2026-11-07.md`](audit-2026-11-07.md).

## Scope

- **Covered:** the web verification flow (`apps/flow`), hosted and embedded by `@openverify/js`, as one complete process: every client step type with its error, retry and final screens, in English, Spanish, French, German and Arabic and in two pseudo-locales, left to right and right to left, in the built-in light and dark palettes, at 320, 375 and 768 CSS px; and every page of the operator console (`apps/dashboard`), including the flow builder, the preview and simulate, the theme and translation editors, analytics and settings.
- **Not covered:** any iOS client (none is built), pages outside OpenVerify that a person is sent to (a customer's own page after completion, a wallet's window), and the flow builder's features not built yet (modules, the screen editor, copy and promote dialogs, diff badges, the builder's warnings and `waitFor` editing, loop and module authoring in the workflow editor).

## Method

We follow the five steps of WCAG-EM 2.0 (scope, exploration, a structured sample and a random one drawn from a recorded seed, evaluation, reporting), as the audit file sets out.

- **Automated checks, on every change** (axe-core 4.14.0 with the WCAG 2.0, 2.1 and 2.2 A and AA rules, failing on any violation): the flow's CI matrix, 39 states in English at 320 px light, Arabic at 320 px dark and both pseudo-locales at 320 px, and each of its 16 step types once at 768 px and once embedded (188 checks); every console page once (97 pages); and each state of the console's own end-to-end tests.
- **Automated checks, once in this audit:** the flow's full cross product, every one of the 39 states in all seven locales, both palettes, hosted and embedded, at all three widths: 3,276 checks in 4 shards, 19.9 minutes, with no violation and no exception.
- **Our own tests**, for what axe cannot decide: focus never hidden (2.4.11) on every flow step type and the console's main pages, also with a notification on screen; dragging never needed (2.5.7) in the flow builder, the workflow editor, the case layout editor, the compare viewer and the charts; targets of at least 24 by 24 CSS px (2.5.8); help in one place (3.2.6); nothing asked twice (3.3.7); codes and passwords that can be pasted (3.3.8); reflow at 320 px and text spacing (1.4.10, 1.4.12); charts and the canvas not relying on colour (1.4.1, 1.4.11); a selfie capture's time limit announced 20 seconds ahead and extendable ten times, and no timed redirect (2.2.1); and accessibility-tree snapshots of every flow step screen and the main console pages.
- **Manual checks:** a checklist of 14 rows for a person (keyboard only in Chrome and Firefox; NVDA with Firefox and Chrome; TalkBack with Chrome on an Android phone; VoiceOver with Safari on iOS and macOS; zoom, text spacing, orientation, reduced motion, timing, authentication, colour). Not run yet: its results table is empty.

## Android SDK

**Status: the native Android SDK (`android/openverify-sdk`) is not yet evaluated for conformance with WCAG 2.2 level AA.** The automated part of its audit is done; the manual part, which a person runs on a real phone with TalkBack, a large font and a hardware keyboard, has not been run, so nothing is claimed for it. The audit, with its inventory, results, defects and manual checklist, is [`android-audit-2026-11-11.md`](android-audit-2026-11-11.md).

- **Scope:** every screen and state the SDK can show (188 states of 21 screens: consent, the capture screens with their guidance and review, the selfie time warning, the one-time codes, the forms, the supporting document, the wallet, the screen step and its components, every NFC screen and phase, the share-consent screen with the withdrawal of a share, waiting, completion, failure with the contest route, the closed and error screens, and the chrome with the help slot and the language selector), in English, Spanish, French, German and Arabic, right to left, light and dark, at font scales 1.0 and 2.0. WCAG 2.2 is read for a native app through W3C's WCAG2ICT guidance. The demo app, the system's own screens and any iOS client are outside it.
- **Method:** the inventory is held as code, and the build fails when a state or a golden has no entry. All checks run on the build host, under Robolectric: Google's Accessibility Test Framework 4.1.1 on each of the 217 screenshot goldens, and the SDK's own tests over every state. No phone, emulator or CI run is evidence for this section.
- **Automated results:** the framework reports no error (and 121 warnings a person has yet to judge: 86 on text contrast, most of them on disabled buttons, and 35 on controls with the same spoken text). Our own tests pass for: a name on every control; touch targets of at least 48 dp; the heading read first, in both directions; an error summary before the fields; status and error messages as live regions with words; no text cut off and no control lost at font scale 2.0 in the five languages and a pseudo-locale (1,128 checks); announcements made once per change and never at the rate a screen updates; nothing mirrored that shows the world as it is; and no time limit but the server's, each listed with its treatment in [`docs/android/accessibility.md`](../android/accessibility.md). The four defects these checks found were fixed; the audit tables them (D1 to D4).
- **Known gaps:** the manual pass has not been run; keyboard focus order cannot be checked on the host; typed secrets use a plain keyboard that may learn them and stay in the autofill structure (a limit of Compose 1.11), and SMS code autofill is not offered; the selfie's time warning covers the screen's heading while it shows; the built-in translations are machine-drafted. The audit lists each with its tracking.

## Assistive technologies used

None yet. No person has tested OpenVerify with a screen reader, a magnifier or another assistive technology for this statement. The automated checks run in Chromium (and the theme's script policy also in Firefox and WebKit), and for the Android SDK on the build host.

## Known gaps

| Gap | Tracking |
|---|---|
| The manual pass (every row of the checklist) has not been run, so no criterion is confirmed by a person | Owner item, carried to the release gate (decisions 55, 56, 71; Phase 11's acceptance) |
| VoiceOver needs an Apple device; without one it is recorded as not tested | Owner (decision 55) |
| The flow builder's modules, screen editor, copy and promote dialogs, diff badges, warnings and `waitFor` editing, and the workflow editor's loop and module authoring are not built, so they are outside this audit | Workflow 9D `fix-builder` (K9-3 to K9-7) |
| The built-in translations are machine-drafted; their meaning is not judged by this audit | Owner (the fluent review of the four drafted catalogs) |
| Automated checks run in Chromium only; other browsers rest on the manual pass | This statement's next revision |
| The native Android SDK's manual pass has not been run (its section above) | Owner item KP10-17, carried to the release gate (Phase 11's acceptance) |
