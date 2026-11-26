# Languages of the verification flow

The web flow ships five built-in languages (C161, decision 30). English is the source; the other
four were drafted by the build agents, which is machine translation, and **no built-in translation
has been reviewed by a fluent person**. This page says what each catalog's status is, how the flow
chooses a language, and how a review is recorded. Operator copy, the translations API and the
consent-copy rule are documented beside this section (C162; written by `integration-9a`).

## Review status

The table is `LOCALE_REVIEW_STATUS` of `@openverify/flow-spec`
(`packages/flow-spec/src/locale-review-status.ts`); `apps/flow/src/i18n/review-status.test.ts`
fails when the two disagree, and when a catalog changed after its review.

| Locale | Language | Direction | Status            | Reviewed by | Review date | Catalog SHA-256 |
| ------ | -------- | --------- | ----------------- | ----------- | ----------- | --------------- |
| `en`   | English  | ltr       | `source`          | n/a         | n/a         | n/a             |
| `es`   | Spanish  | ltr       | `machine-drafted` | nobody      | n/a         | n/a             |
| `fr`   | French   | ltr       | `machine-drafted` | nobody      | n/a         | n/a             |
| `de`   | German   | ltr       | `machine-drafted` | nobody      | n/a         | n/a             |
| `ar`   | Arabic   | rtl       | `machine-drafted` | nobody      | n/a         | n/a             |

What the statuses mean:

- `source`: the language the messages are written in; every other catalog translates it.
- `machine-drafted`: written by the build agents with no human review. The consent, notice,
  decision and retention texts in it carry legal weight and are drafts. Publishing a production
  template version whose enabled locales include one and whose built-in legal texts are shown
  needs the acknowledgement `locale-unreviewed:<locale>` (C161.5); sandbox warns.
- `partially-reviewed`: a fluent person reviewed the catalog, but the listed keys were added or
  changed since; those keys are drafts.
- `reviewed`: a fluent person reviewed every message of the catalog with the digest named.

No text calls a translation reviewed without such a record.

## Recording a review

1. Export the catalogs (below) and give the reviewer `contracts/fixtures/i18n/<locale>.json`. Its
   `catalog-sha256` is the SHA-256 of the sorted lines `<key><TAB><SHA-256 of the message,
NFC><LF>`, so it names exactly the messages reviewed.
2. When the review is done, copy that file to
   `contracts/fixtures/i18n/reviewed/<locale>.<catalog-sha256>.json` and set the locale in
   `LOCALE_REVIEW_STATUS` to `{ status: 'reviewed', by, date, catalogSha256 }`, then update the
   table above.
3. From then on a key added or changed in that catalog fails the review-status test until the locale
   is declared `partially-reviewed`, listing the key (with `by`, `date` and `catalogSha256` of the
   review it came from), so a later message is never shown as reviewed.

## How the flow chooses a language

1. The `language` parameter of the flow's URL, then `lang` (kept as its alias), each read in the
   query and then in the fragment; then the browser's `navigator.languages`.
2. Each candidate is matched by RFC 4647 lookup on its base language: `ar-EG` chooses the Arabic
   catalog, `fr-CA` the French one. Only the version's `enabled-locales` are candidates; with no
   match the flow uses the version's `default-locale`, then English.
3. Numbers, dates and lists are formatted with the full tag the person asked for, so `ar-EG` shows
   Arabic-Indic digits and plain `ar` Latin ones (CLDR's choice per region).
4. `<html lang dir>` follows the language: `lang` names that full tag, `dir` is `rtl` for Arabic.

The code is `apps/flow/src/i18n/` (`negotiateLanguage`, `requestedLanguages`, `intlLocale`,
`syncDocumentLanguage`).

## Right to left

- Layout uses logical properties only. The lint rule `openverify-i18n/logical-properties`
  (`packages/config/eslint/logical-properties.js`) refuses Tailwind's `ml-`, `mr-`, `pl-`, `pr-`,
  `left-`, `right-`, `text-left` and `text-right` in `apps/flow` and `packages/ui`, and names the
  logical utility to use (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`).
  A utility under an explicit `rtl:` or `ltr:` variant passes, for the rare physical case.
- Every interpolated value is rendered inside `<bdi>` (`isolateValues`, `useIsolatedT`), so an
  email address or a Latin name inside Arabic text keeps its own direction.
- Directional icons (back, next, chevrons) mirror with `rtl:-scale-x-100`; the selfie pose prompts
  never do, because "turn left" means the person's own left in every language, and neither do the
  camera, check marks, document outlines, logos or the QR code (`iconDirectionClass`).
- Digits typed on an Arabic keyboard (U+0660 to U+0669 and U+06F0 to U+06F9) are normalised to
  ASCII before validation, in the flow and again on the server (`normalizeDigits`, C161.4).

## Plurals and gender

Every plural message defines each category `Intl.PluralRules` names for its language: Arabic six
(zero, one, two, few, many, other), French and Spanish one, many and other, German and English one
and other. French and Spanish leave out `many` only where the message's count cannot reach a
million (days up to 3,650 and pages up to 50), which `apps/flow/src/i18n/plurals.test.ts` proves.
No message is gendered: the flow knows nothing reliable about a person's gender. French addresses
the person as « vous », German as „Sie“, and Arabic writes instructions with «يُرجى» and a verbal
noun, so no imperative is gendered.

## Pseudo-locales

`en-XA` (accented, lengthened by about 40% with unaccented words, bracketed) and `ar-XB` (reversed,
right to left, bracketed) are generated from English by `pseudoLocalize` of `@openverify/flow-spec`,
in tests and in the console preview only; a build test keeps the transform out of the hosted
flow's bundle. The mocked suite renders each step in both at 320 CSS px and fails on sideways
scrolling, cut text and text outside a bracket (`apps/flow/e2e/support/pseudo-locale*.ts`).

## Exports and the consent texts

```bash
node apps/flow/scripts/export-flow-locales.ts           # write
node apps/flow/scripts/export-flow-locales.ts --check   # exit 1 when a file is out of date
```

- `contracts/fixtures/i18n/<locale>.json`: the catalog's messages, its `catalog-version`,
  `catalog-sha256` and `review-status`, the source of the Android SDK's catalogs in Phase 10.
- `contracts/fixtures/i18n/consent-texts.json`: append-only. Every built-in consent and notice
  text as written (placeholders unfilled, `{{name}}`), one entry per catalog version, client, key
  and locale. The server fills an entry's placeholders with the session's values, normalises it to
  NFC and hashes it to check the digest a consent carries (C162.9). An entry is never edited or
  removed, so a consent given to earlier words stays verifiable; a test reads every committed
  revision of the table.
- `apps/flow/src/i18n/catalog-version.ts`: `FLOW_CATALOG_VERSION`, `web-` and 16 hex digits of the
  digest of the consent texts, which the flow sends with every consent.

A test fails when a committed file differs from the catalogs, so run the script after changing a
message and commit what it writes.

## Operator copy (C162.1 to C162.6)

A template version may replace built-in texts and give its screens' texts with `copy`:
`{ "messages": { "<locale>": { "<key>": "<text>" } } }`, for the five base locales only. A key is
either one of `COPY_KEYS` (`packages/flow-spec/src/v2/copy-keys.ts`: the overridable built-in
texts, each with the placeholders it may hold) or a screen component's own text,
`<step id>.<component id>.<attribute>` (`label`, `hint`, `title` and the others of
`COMPONENT_COPY_ATTRIBUTES`; an option's `<step>.<component>.option.<key>`). The rules, checked on
save and publish (`copy_*` codes, each at its pointer, never echoing the text):

- plain text only: no markup, control characters, bidi overrides or format characters (none at
  all in a legal text), isolates balanced;
- placeholders are `{name}` and only the ones a key declares (`{organization}` for most texts,
  `{days}` in a biometric consent, none in button labels);
- the version's `enabled-locales` and `default-locale` say which languages the flow offers;
  a locale outside the five is `locale_unsupported`.

**Fallbacks.** The session carries only the current step's texts (`copy`), in the language
negotiated among `locales.enabled`. The flow reads a text in this order (C162.5;
`copyText` in `apps/flow/src/session/session-copy.ts`): the operator's text in the person's
language, the built-in text of that language, the operator's text in the version's default locale,
then the built-in text of the default locale. There is no separate English step unless English is
the default locale. A raw key is never shown: when nothing holds the text, `copyText` answers
`null` and the renderer does not put the key in its place.

## The consent-copy rule (C162.4, C162.9)

Consent words carry legal weight, so:

- a version that overrides a consent text must give it in **every** enabled locale
  (`consent_copy_incomplete`), and a biometric consent override must state the retention with
  `{days}` (`consent_copy_missing_placeholder`);
- overriding a legal text in production needs the acknowledgement `legal-copy:<key>`, and enabling
  a locale that is not reviewed (every built-in one but English today) where its built-in legal
  texts are shown needs `locale-unreviewed:<locale>`; sandbox warns;
- every consent the flow records carries the SHA-256 of the exact words shown (`text-sha256`, one
  per text key, NFC), their source (`copy-source`: `custom` or `built-in`) and the catalog version.
  The server accepts it only when each digest is a stored text: the version's custom copy, or an
  entry of `consent-texts.json`, with `{days}` and `{organization}` filled from the session;
  otherwise 422 `consent_text_mismatch`. Today's Android SDK sends no digest, and a consent step
  that uses custom copy is a placeholder it stops at, so it never records consent to words it did
  not show;
- the template diff flags a changed consent text (`consent_text_changed`).

## Translations as JSON and CSV (C162.7)

`GET /api/v1/inquiry-templates/:id/translations` answers the template's texts from its latest
draft, else its latest published version: one row per step, component and attribute, with a value
per enabled locale (`inquiry-templates:read`). `POST` takes rows and writes them into the draft
(one is made from the published version when there is none), skipping blank values; it never
publishes (`inquiry-templates:write`, policy `translations-import`, 30 an hour per environment).

The same routes with `.csv` speak CSV: the header `step,component,attribute,<enabled locales>`,
every cell quoted, written by the formula-safe writer of C107 (a cell a spreadsheet would run as a
formula, starting `=`, `+`, `-` or `@`, is written so it does not), read by `readCsv` with its
size and record limits, and the neutraliser removed on import, so a text that starts with `=` or
`-` survives an export and an import unchanged. A refused file names the row and the column of
each problem, never the value; a header or parse problem refuses the whole file. The full-stack
`e2e/tests/flow-translations.spec.ts` round-trips an English formula-like text and an Arabic text.
