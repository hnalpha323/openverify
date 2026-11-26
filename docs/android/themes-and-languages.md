# Themes and languages

## The session theme (C198)

The flow session carries the version's theme (Phase 9 C160.7): a light palette, an optional dark palette, a corner radius, a logo and the mode. The SDK maps it onto Material 3:

- **Every Material colour role comes from the twelve palette tokens**, none from Material's baseline. `primary`, `on-primary` and `surface` map directly; `canvas` is the background and the `surfaceContainer` role; `ink` is the text on surfaces; `danger` is `error`. The error containers sit on `canvas`, so Material's content-colour lookup gives body text `ink`, never `danger`. The full table is `ThemeMapping.kt`'s `COLOR_SCHEME_ROLES`.
- **Contrast.** The server's contrast gate passed the palette when the theme was saved (Phase 9 C160.4). The SDK does not judge the palette again; a test runs every foreground and background pair its own composables draw through the mapping, against palettes at exactly the gate's minimums (4.5:1 and 3:1). That proves the mapping draws only gated pairs; it is not a per-screen audit.
- **A theme the SDK cannot use** (a token missing, a colour not lower-case `#rrggbb`, a radius outside 0 to 24) is replaced by the built-in theme for the whole session, and the SDK logs one constant code (`theme.session_theme_refused`), never a value. The built-in light and dark palettes are the web flow's own, shared through `contracts/fixtures/theme/builtin-palettes.json`.
- **Appearance.** `Appearance.SYSTEM` follows the device as the theme's mode allows; `LIGHT` and `DARK` force one; a forced dark with no dark palette uses the built-in dark palette.
- **Fonts.** The system font, always: an uploaded font is for the web only, and Android parses font bytes without the browsers' sanitiser (decision 11). Operator fonts on native clients are deferred.
- **The logo** is read from the theme-asset route with the session token and decoded only after its first bytes say PNG or JPEG (the two formats the server's rendition emits), its size is at most 256 KiB and its header says at most 2,048 px a side. It is shown with its alternative text from the operator's copy, or beside the organisation's name when decorative; a logo that cannot be fetched or decoded shows the name alone. Placement is the header, the only placement Phase 9 defines.
- **Per-component style overrides** do not exist in flow-spec 2's component schema (K9-4, deferred), so the SDK maps none.
- The status and navigation bar icons follow the surface's luminance. A host cannot inject colours or override the SDK's resources by name.

The console's preview shows the web flow; the Android app draws the same steps with the system font and Material's components, so its screens differ from the preview in type and shape.

## Languages (C199)

The SDK ships every string in five languages. The non-English ones are **machine-drafted** and nobody has reviewed them; `android/openverify-sdk/i18n/review-status.json` records each locale's status, and a reviewed record would carry per-key digests, so a changed string downgrades a reviewed locale.

| Locale | Status |
|---|---|
| `en` | Source |
| `es` | Machine-drafted |
| `fr` | Machine-drafted |
| `de` | Machine-drafted |
| `ar` | Machine-drafted, right to left |

**Legal texts are never drafted for the SDK.** Every consent, notice, decision and contest text comes from the web flow's catalogs through the key map (`android/openverify-sdk/i18n/key-map.json`) into a generated `strings_catalog.xml` in each language, so the app and the web say the same words. Two consent texts have an app wording (`closing this screen` where the web says `this page`, and the session-integrity notice), kept in the web catalogs' `nativeApp` group; the owner confirms them before the first release.

### How the language is chosen

1. The person's choice in the language selector;
2. the host's `Request.locale` (or `OneTimeLink.locale`);
3. the device's languages;
4. the version's default language;
5. English.

Each candidate is matched by RFC 4647 lookup on its base tag against the languages the version enables **and** the SDK bundles. The selector (C199.3) sits in the fixed help slot below every step, offers those languages each named in its own language, and is hidden when fewer than two are offered. The selector comes before `Request.locale` so that the person's own choice always takes effect, as on the web flow (an amendment of C199.2's order).

**The session's language** (D2): the consent body's `locale` is the base tag of the language the consent was shown in (`es-MX` is sent as `es`), and it sets the engine's `session.locale`, which a branch may read. A language chosen in the selector **after** consent is not reported to the server, as on the hosted flow.

The SDK sets its language for its own screens only: it never changes the JVM default locale or the host's configuration. Values sent to the server (dates, numbers, the OTP code, the consent's filled days) are always ASCII digits, whatever the device's locale.

### Right to left

Arabic lays out right to left even in a host without `android:supportsRtl`: the SDK sets the layout direction itself. The camera preview, document outlines, check marks and the logo never mirror. A value inserted into a sentence (an organisation's name, a destination) is isolated with U+2068 and U+2069 in the displayed text only.

### Operator copy

The session's `copy` replaces the SDK's text for each key the key map places, in the chosen language, with `{name}` placeholders filled from each key's closed list; a component's own texts (`<step>.<component>.<attribute>`) are always operator copy. When no text exists in the chosen language, the SDK falls back to the version's default language, then to the SDK's own words for keys it has them for, and never shows a raw key. An operator's text for a **legal** key the SDK cannot place, or cannot fill as written, makes the step unsupported: the SDK never shows its own words where the operator wrote a legal text. A non-legal key the SDK cannot place is ignored, with a constant log code.

## Consent evidence (C200)

Every consent the SDK records carries, beside the keys and the locale:

- `text-sha256`: the SHA-256 of each text as shown, over its logical form (the template with `days` and `organization` filled, NFC, without the display isolates), in the order of `text-keys` then the accepted optional keys;
- `copy-source`: `custom` when every text was the operator's, `built-in` when none was, and left out when they were mixed (the server then matches each text against both);
- `catalog-version`: `android-<sdk version>-<16 hex>`, a digest of the SDK's consent texts in the five languages (`android-0.1.0-6ed3979d273c180e` since Workflow 10B added `notice.play-integrity` and the probe-naming session-integrity text; the server keeps accepting the 10A version `android-0.1.0-75ddea08ad090412`). Its texts are rows of `contracts/fixtures/i18n/consent-texts.json` with `client: android`, which the server's digest check reads beside the web's.

The server refuses a consent whose digest matches no text it holds (422 `consent_text_mismatch`) and records nothing; the SDK logs a constant code, reads the session again and shows the consent again with a polite notice that the text changed (since Workflow 10B). A consent is never recorded silently.

**What the digests prove, and what they do not.** They record which built-in or operator text version the client **reports** it rendered, and that the server accepted a matching text. They do not show that a person read it, and a modified client can send a matching digest without showing anything. The console has no view of a consent record yet, so the label "client-reported" on a record's `client` and digests is carried until one exists (D4); this page and the API reference state it.
