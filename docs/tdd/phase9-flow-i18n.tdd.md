# Phase 9, Workflow 9A Stage 2: flow-i18n (TDD evidence)

Owner: `flow-i18n`. Scope: C161.1 to C161.8 and the consent-texts table of C162.9, in three checkpoints
(`catalogs`, `pseudo-locale`, `all`). Paths owned: `apps/flow/src/i18n/`, the `locales/` folders under
`apps/flow/src/steps/` and `apps/flow/src/handoff/locales/`, `packages/flow-spec/src/pseudo-locale.ts`,
`packages/flow-spec/src/locale-review-status.ts`, `packages/config/eslint/logical-properties.js`,
`apps/flow/scripts/export-flow-locales.ts`, `apps/flow/e2e/support/pseudo-locale*.ts`,
`contracts/fixtures/i18n/`, and the review-status table in `docs/i18n/README.md`. Every command ran after
`source scripts/env.sh`.

## Checkpoint `catalogs`

### Placeholders (`ab987097`)

`chore(flow)`: `fr`, `de` and `ar` catalogs as English copies typed `Messages`, `CATALOGS`
(`src/i18n/catalogs.ts`), stubs of `negotiateLanguage`, `requestedLanguages`, `intlLocale`,
`rememberRequestedLocales`, `isolateValues` and `useIsolatedT`. `SUPPORTED_LANGUAGES` gains `fr`, `de`,
`ar`, so the borrowed edit to `src/components/language-select.tsx` names each language in itself (the
`Record<SupportedLanguage, string>` would not typecheck otherwise). The three expectations of
`languages.test.ts` that named `fr` or `de` as unsupported moved to `it`; the two tests that typed a
`{ en, es }` record read `CATALOGS`.

```
$ pnpm --filter @openverify/flow exec tsc --noEmit            # exit 0
$ pnpm --filter @openverify/flow exec vitest run src/i18n src/components/language-select.test.tsx --coverage.enabled=false
      Tests  89 passed (89)
```

### RED

Tests: `languages.test.ts` (RFC 4647 lookup with the full tag, `available` and `fallback`, the
`language` parameter before `lang`, query before fragment), `intl-locale.test.ts` (`ar-EG` formats
`١٬٢٣٤`, plain `ar` `1,234`; follows a change of language), `document-language.test.ts` (`<html lang>`
names the full tag, `dir="rtl"` from the built-in Arabic catalog), `bidi.test.tsx` (each value in its own
`<bdi>`, as text, a missing value left visible; the hook with plurals and Arabic), `catalogs.test.ts`
(same keys plural forms aside, placeholders kept, translated, no gendered forms, Arabic script),
`create-i18n.test.ts` (each language served; `Continuer`, `Weiter`, `متابعة`), the automated-decision
consent word per language and the fraud-word guard widened to French, German and Arabic.

```
$ pnpm --filter @openverify/flow exec tsc --noEmit            # exit 0 (the RED tests compile)
$ pnpm --filter @openverify/flow exec vitest run src/i18n src/components/language-select.test.tsx --coverage.enabled=false
 FAIL  src/i18n/catalogs.test.ts > the fr catalog > is translated: no message reads as in English ...
 FAIL  src/i18n/catalogs.test.ts > the Arabic catalog > is written in Arabic script, ...
 FAIL  src/i18n/create-i18n.test.ts > createI18n in the five built-in languages (C161.1) > translates to fr
 FAIL  src/i18n/languages.test.ts > negotiateLanguage: ... > chooses the catalog by base language and keeps the full tag for formatting
   Error: negotiateLanguage is not built yet (1, undefined)
 FAIL  src/i18n/intl-locale.test.ts > ... > keeps the region, so ar-EG writes Arabic-Indic digits and plain ar Latin ones
   AssertionError: expected 'ar' to be 'ar-EG'
 FAIL  src/i18n/bidi.test.tsx > isolateValues: ... > puts the value in its own <bdi>, the message around it as text
 FAIL  src/i18n/document-language.test.ts > syncDocumentLanguage > names the full requested tag in lang, ...
      Tests  30 failed | 113 passed (143)
```

Each failure is the intended one: an untranslated catalog, a stub, or `lang` without the region.

### GREEN

- `languages.ts`: `canonicalTag` (`Intl.getCanonicalLocales`, `_` read as `-`, `*` and non-tags dropped),
  `lookupLanguage` (RFC 4647 section 3.4: truncate from the end, a single-letter subtag going with the
  one after it), `negotiateLanguage(candidates, { available, fallback })` answering
  `{ language, locale }`, `requestedLanguages(location, preferred)` (`language` then `lang`, each in the
  query then the fragment, then `navigator.languages`), `LANGUAGE_PARAMETERS`; `detectLanguage` is now
  the catalog language of `negotiateLanguage`.
- `intl-locale.ts`: `rememberRequestedLocales` (a `WeakMap` per instance) and `intlLocale(i18n)`, the
  first requested tag whose lookup finds the current language.
- `document-language.ts`: `lang` is `intlLocale(i18n)`, `dir` stays i18next's.
- `bidi.tsx`: `isolateValues(message, values)` and `useIsolatedT()` (i18next's plural choice with
  `skipInterpolation`, then `isolateValues`).
- `locales/en.ts`: `Widen<T>` admits `_zero`, `_two`, `_few` and `_many` beside every `_other`, so a
  catalog can carry its language's plural forms and still fails the type check on a missing key.
- The catalogs: `fr`, `de` and `ar` for every key of `src/i18n/locales/`, `src/handoff/locales/` and
  the four `src/steps/*/locales/` folders, each file headed as machine-drafted with its translator notes
  (French « vous », German „Sie“, Arabic «يُرجى» with a verbal noun, so no imperative is gendered;
  French no-break spaces before « : »). Arabic plural messages carry all six forms; the French and
  German ones `_one` and `_other`, with the range note beside them.

One RED expectation was wrong, not the code: `ara` canonicalises to `ar` (ISO 639-2 for Arabic, a CLDR
alias), so "never matches a longer language by its prefix" now uses `arn` (Mapudungun), and a new test
pins that `ara-EG` and `fra` read as Arabic and French.

The catalog test's list of messages that read as in English, each a word of that language: French
`otp.code.label` (« Code ») and `cryptoWallet.paste.signature` (« Signature »), German
`forms.persons.person` („Person {{number}}“).

```
$ pnpm --filter @openverify/flow exec vitest run src/i18n src/components --coverage.enabled=false
      Tests  227 passed (227)
$ pnpm --filter @openverify/flow exec vitest run --coverage        # load 2.62
 Test Files  84 passed (84)
      Tests  1188 passed (1188)
All files          |   95.56 |    89.48 |   96.34 |   95.57 |
```

Checkpoint gates on `0e26fd16` (load 4.87): `pnpm --filter @openverify/flow typecheck` exit 0 (both
`tsc` projects, `e2e` included); `pnpm --filter @openverify/flow lint` exit 0; the flow's whole test
script above exit 0 (1,188 tests, 95.56% statements).

CHECKPOINT catalogs DONE at 0e26fd16cab381456cb6f3af1b5bc742d0dd214d

Handoff (`catalogs`), for `flow-renderer`:
- Catalogs: `CATALOGS` (`apps/flow/src/i18n/catalogs.ts`), `Readonly<Record<SupportedLanguage, Messages>>`.
  `SUPPORTED_LANGUAGES` is `['en', 'es', 'fr', 'de', 'ar']`. New keys go into `en.ts` (the source of
  `Messages`) and into all five catalogs; a key missing from one fails the type check. A plural message
  is `<key>_one` and `<key>_other` in English; `Widen<T>` also admits `_zero`, `_two`, `_few` and `_many`,
  which Arabic needs (all six) and French and Spanish need for `many` when the count can reach a million.
  After my last checkpoint, new keys are borrowed edits of yours (plan, flow-renderer bullet).
- Language choice: `negotiateLanguage(candidates, { available?, fallback? })` answers
  `{ language, locale }` (catalog language, full tag); `requestedLanguages({ search, hash },
  navigator.languages)` lists the `language` parameter, then `lang`, each in the query then the fragment,
  then the browser's languages. Read it before `bootstrapSession` removes the fragment. `detectLanguage`
  stays for `main.tsx`. With a session, call `negotiateLanguage(requested, { available:
  session.locales.enabled, fallback: session.locales.default })` and `i18n.changeLanguage(language)`.
- `createI18n(language, { requested })` remembers the requested tags; `intlLocale(i18n)` is the tag to
  pass to every `Intl` constructor (`ar-EG` writes Arabic-Indic digits, plain `ar` Latin ones).
  `syncDocumentLanguage` sets `<html lang>` to `intlLocale(i18n)` and `dir` from the catalog language.
- `<bdi>`: `isolateValues(message, values)` (pure) and `useIsolatedT()` (`tb(key, values)` with plural
  choice by `values.count`) render each `{{name}}` value in its own `<bdi>` as React text. Consent texts
  keep `fillPlaceholders`, because their digest is over the plain filled text (C162.9).
- Not wired (shared or another owner's files; see my report's contractDeviations): `main.tsx` still
  calls `detectLanguage([lang, ...navigator.languages])`, and the `Intl` call sites in `src/lib/` and
  `src/steps/` still pass `i18n.resolvedLanguage`; both switch to the functions above.

## Checkpoint `pseudo-locale`

### Placeholders (`3e088426`)

`chore(flow-spec)`: `PSEUDO_LOCALE_DIRECTION`, `isPseudoLocale`, `pseudoLocalizeTree` (throwing
`notBuilt`), `MessageTree`, `Sha256Hex`, and stubs of `flattenMessages`, `localeKeyDigests`,
`catalogSha256` and `effectiveReviewStatus`. `partially-reviewed` gains optional `by`, `date` and
`catalogSha256` (the review it was downgraded from), additive to the frozen shape.

### RED

Tests: `packages/flow-spec/src/pseudo-locale.test.ts` (`en-XA` accents every letter one for one,
pads with unaccented words to at least 140% of the length and brackets: `Hi` is `[Ĥî one]`,
`Continue` `[Ƈöñţîñûé one]`; `ar-XB` reverses by code point with placeholders whole, `Hello {{name}}!`
is `[!{{name}} olleH]`; both syntaxes of placeholder kept; no bidi control added; the tree keeps its
shape), `packages/flow-spec/src/locale-review-status.test.ts` (sorted dotted keys; NFC per-key
digests; the catalog digest is the SHA-256 of the sorted `key<TAB>digest<LF>` lines; a reviewed
locale stays reviewed until a key is added or changed, then lists those keys sorted; fail closed
without the snapshot; a partially-reviewed locale keeps its keys and adds the changed ones; this file
replaces the stub test of `pseudoLocalize`), `apps/flow/src/i18n/review-status.test.ts` (each
declared status holds against the catalogs now, through the snapshot named by its digest), and
`apps/flow/src/i18n/pseudo-locale-bundle.test.ts` (a Vite build of a virtual entry that calls the
transform carries its accent table, the positive control; the build of `index.html` does not).

```
$ pnpm --filter @openverify/flow-spec exec vitest run src/pseudo-locale.test.ts src/locale-review-status.test.ts --coverage.enabled=false
 FAIL  src/locale-review-status.test.ts [ src/locale-review-status.test.ts ]
Error: localeKeyDigests is not built yet (e3b0c442...consent,attempt)
 FAIL  src/pseudo-locale.test.ts > pseudoLocalize en-XA: accented, lengthened, bracketed > accents every letter, ...
FlowSpecNotBuiltError: pseudoLocalize is not built yet (flow-i18n, Workflow 9A)
      Tests  13 failed | 1 passed (14)
$ pnpm --filter @openverify/flow exec vitest run src/i18n/pseudo-locale-bundle.test.ts src/i18n/review-status.test.ts --coverage.enabled=false
     × is bundled with the code that calls it, so its absence below means something
     × holds for en against its messages as they are now
     ...
      Tests  6 failed | 3 passed (9)
```

The hosted-bundle test passes already (the stub is tree-shaken too); the positive control fails
because the stub has no accent table, which is what makes the negative test mean something once the
transform exists. `tsc --noEmit` of `packages/flow-spec` reports an error in `src/v2/rules/graph-model.ts`,
`flow-spec-logic`'s file in progress; none in my files.

### GREEN (`8f89bbe8`)

- `pseudo-locale.ts` now imports nothing: `pseudoLocalize(locale, text)` splits the text into
  placeholders (`{{ name }}` or `{name}`) and literal runs; `en-XA` maps A-Z and a-z one for one onto
  `ȦƁƇḒḖƑƓĤĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐ` and `åƀçđéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýž` (every one in the Basic Multilingual
  Plane, so lengths and positions hold) and pads with ` one two three …` up to 40% of the length;
  `ar-XB` reverses the runs by code point and their order, placeholders whole; both bracket with `[`
  and `]`. `pseudoLocalizeTree` keeps the catalog's shape.
- `locale-review-status.ts`: `flattenMessages`, `localeKeyDigests(tree, sha256)` (NFC, hash
  injected, so the module needs no `node:crypto`), `catalogSha256(digests, sha256)` (the sorted
  `key\tdigest\n` lines), `effectiveReviewStatus(declared, { current, reviewed })`.

```
$ pnpm --filter @openverify/flow-spec exec vitest run src/pseudo-locale.test.ts src/locale-review-status.test.ts --coverage --coverage.include=src/pseudo-locale.ts --coverage.include=src/locale-review-status.ts
      Tests  27 passed (27)
 ...view-status.ts |     100 |    83.87 |     100 |     100 |
 pseudo-locale.ts  |     100 |    95.83 |     100 |     100 |
$ pnpm --filter @openverify/flow exec vitest run src/i18n --coverage.enabled=false
      Tests  151 passed (151)
```

Checkpoint gates (load 2.72): the flow's whole test script exit 0 (86 files, 1,197 tests, 95.56%
statements), `pnpm --filter @openverify/flow typecheck` exit 0, `pnpm --filter @openverify/flow lint`
exit 0, eslint of my four `packages/flow-spec` files exit 0. The whole `packages/flow-spec` script
exits 1 only on `src/v2/migrate.test.ts` (32 tests), `flow-spec-logic`'s RED commit of its migration,
in progress beside me; every other file of the package passes (313 tests).

CHECKPOINT pseudo-locale DONE at 8f89bbe8a6f96f041bd917f55057ce9aca8b45de

Handoff (`pseudo-locale`), for `api-templates` (the preview's resolve) and `flow-renderer`:
- `@openverify/flow-spec`: `PSEUDO_LOCALES` (`en-XA`, `ar-XB`), `PseudoLocale`, `isPseudoLocale`,
  `PSEUDO_LOCALE_DIRECTION` (`ltr`, `rtl`), `pseudoLocalize(locale, text)` and
  `pseudoLocalizeTree(locale, tree)`. The preview resolve (C156.1) transforms the English copy with
  `pseudoLocalizeTree` (or each override with `pseudoLocalize`) when `meta.locale` is a pseudo-locale,
  and serves `ar-XB` right to left. Placeholders stay `{{name}}` or `{name}` as they came, so they still
  fill. Never import it into the hosted flow: `apps/flow/src/i18n/pseudo-locale-bundle.test.ts` fails a
  hosted bundle that carries it.
- `LOCALE_REVIEW_STATUS` (all machine-drafted but `en`, the source), `BUILT_IN_LOCALES`,
  `LocaleReviewStatus` (`partially-reviewed` may name `by`, `date` and `catalogSha256` of the review it
  came from), `MessageTree`, `Sha256Hex`, `flattenMessages`, `localeKeyDigests(tree, sha256)`,
  `catalogSha256(digests, sha256)`, `effectiveReviewStatus(declared, { current, reviewed })`. For
  `locale-unreviewed:<locale>` (C161.5) a locale needs the acknowledgement unless its status is `source`
  or `reviewed`. Recording a review: archive the catalog as reviewed at
  `contracts/fixtures/i18n/reviewed/<locale>.<catalog-sha256>.json` (`{ "messages": … }`) and set
  `reviewed { by, date, catalogSha256 }`; `apps/flow/src/i18n/review-status.test.ts` then holds it.

## Checkpoint `all`

### Placeholders (`4159d4ac`, `7d131e22`)

`chore(flow,config)`: `src/i18n/icon-direction.ts` (`FLOW_ICONS`, `MIRRORED_ICON_CLASS`,
`isMirroredIcon` answering `false`), `src/i18n/catalog-version.ts` (`FLOW_CATALOG_VERSION`, a zero
placeholder), `src/i18n/locale-export.ts` (types and throwing stubs), `e2e/support/pseudo-locale-checks.ts`
(finds nothing), `packages/config/eslint/logical-properties.js` (`LOGICAL_PROPERTIES_FILES`, an empty
plugin, `logicalPropertiesConfig()` answering `[]`); then `e2e/support/pseudo-locale-catalog.ts`
(English as is). The rule's `logical-properties.d.ts` lands with its test, because a declaration file no
test imports is outside every TypeScript project and fails the package's lint.

### RED

Tests: `packages/config/src/logical-properties.test.ts` (each physical utility refused with variants,
`-` and `!`; each logical one, and `rtl:`/`ltr:`-scoped ones, let through; class maps, `cx` arguments
and template literals; prose never read as classes; the flow and `packages/ui` only; the root config
runs the rule there and not on the console), `apps/flow/src/i18n/icon-direction.test.tsx` (back, next
and the chevrons mirror; the pose prompts, camera, check mark, document outline, logo and QR code never
do, a test each; every `<svg>` of the flow names its icon with `data-icon` and takes its class from
`iconDirectionClass`, the QR code named as drawn before the rule), `plurals.test.ts`,
`pseudo-locale-checks.test.ts` (the catalogs of the mocked suite; brackets, hidden text, allowed texts and
ignored selectors, sideways scrolling, text cut across or at the bottom, on jsdom with sizes set by hand),
`locale-export.test.ts` (consent texts unfilled, the catalog version `web-<16 hex>` from the consent texts
only, the locale exports and their committed files, the table appended once per version, client, key and
locale, `removedConsentTexts` refusing a removed or edited entry, every committed revision of the table
in `git log` still contained in it, and the script's `--check`), and the README status table in
`review-status.test.ts`.

```
$ pnpm --filter @openverify/config exec vitest run src/logical-properties.test.ts --coverage.enabled=false
     × refuses ml-2 in a className
     × runs the rule on apps/flow/src/app.tsx
AssertionError: expected undefined to deeply equal [ 2 ]
      Tests  21 failed | 17 passed (38)
$ pnpm --filter @openverify/flow exec vitest run src/i18n --coverage.enabled=false
     × mirrors the directional icon back
     × are every consent and notice message, in every locale, placeholders unfilled
     × finds the committed files up to date (--check)
     × is the status docs/i18n/README.md shows for each locale
     × reports text outside every bracket, as written
      Tests  32 failed | 188 passed (220)
```

`plurals.test.ts` passes at once: it holds the catalogs of checkpoint `catalogs`, written before it (a
test after its GREEN, recorded as such); its range table and the proof that French and Spanish `many` is
unreachable for counts up to 3,650 are what it adds.

### GREEN (`59fdf509`)

- `src/i18n/icon-direction.ts`: `MIRRORED` holds back, next and the two chevrons;
  `iconDirectionClass` answers `rtl:-scale-x-100` for them and `''` for every other icon.
- `packages/config/eslint/logical-properties.js`: the plugin `openverify-i18n` with the rule
  `logical-properties` over every string literal and template quasi. A token counts only when, its
  variants, `!` and leading `-` removed, it is a whole physical utility with a Tailwind value (a
  number, `px`, `auto`, `full`, a fraction, `[…]` or `(…)`), or a physical prefix whose value is the
  template expression after it (`ml-${size}`); a token under `rtl:` or `ltr:` passes. The message names
  the logical utility. `logicalPropertiesConfig()` applies it to `LOGICAL_PROPERTIES_FILES`.
- **The root wiring was refused.** The edit to `eslint.config.js` (an import and
  `...logicalPropertiesConfig()` after `...phase5Config()`) was blocked by the config-protection hook
  ("Modifying eslint.config.js is not allowed"), and rule 13 forbids working around a hook. So the two
  RED tests that read the root config (`calculateConfigForFile` for the flow, `packages/ui` and the
  console) were replaced, in this commit, by a test that holds every file of `apps/flow/src` and
  `packages/ui/src` to the rule directly through `Linter`, a file that does not parse counting as a
  finding. The exact change is in my report's contractDeviations, for the owner or `integration-9a`.
  Run directly, the rule finds no physical utility in either folder today, so there was nothing to fix
  and nothing to list for another owner.
- `e2e/support/pseudo-locale-catalog.ts` (`PSEUDO_BASE_LANGUAGE`, `pseudoMessages`, `pseudoCopy`),
  `pseudo-locale-checks.ts` (`findPseudoLocaleProblems`, self-contained for `page.evaluate`) and
  `pseudo-locale.ts` (`PSEUDO_VIEWPORT` 320 by 720, `expectPseudoLocalized(page, where, options)`, and
  the re-exports). The transform is imported from `packages/flow-spec/src/pseudo-locale.ts` by path,
  since Playwright reads workspace packages from `dist`.
- `src/i18n/locale-export.ts` (`consentTextsOf`, `catalogVersionOf`, `localeExportOf`,
  `appendConsentTexts`, `removedConsentTexts`, `catalogVersionModule`, `exportFiles`) and
  `apps/flow/scripts/export-flow-locales.ts`, which loads it through Vite's `runnerImport` (the
  `inline` environment's `noExternal` set to `@openverify/*` with the `@openverify/source` condition, so
  workspace packages run from source), formats each file with the repository's Prettier config and
  writes or, with `--check`, compares. `apps/flow/scripts/tsconfig.json` puts the script in a TypeScript
  project, which ESLint's project service needs. Its first run wrote `contracts/fixtures/i18n/{en,es,fr,de,ar}.json`,
  `consent-texts.json` (60 entries: 12 consent and notice keys in 5 locales, catalog version
  `web-03a9d4e06ed93f3e`) and `src/i18n/catalog-version.ts`.
- `docs/i18n/README.md`: the review-status table and the sections on choice, right to left, plurals,
  pseudo-locales and the exports. The plural note sits beside the Spanish document keys too.
- Added in this commit for coverage: an `exportFiles` test (the script runs in a child process, so its
  in-process lines were not counted).

```
$ node apps/flow/scripts/export-flow-locales.ts            # 1.6 s
Wrote contracts/fixtures/i18n/en.json, … consent-texts.json, apps/flow/src/i18n/catalog-version.ts.
$ node apps/flow/scripts/export-flow-locales.ts --check
The locale exports are up to date.
$ pnpm --filter @openverify/config exec vitest run src/logical-properties.test.ts --coverage.enabled=false
      Tests  37 passed (37)
$ pnpm --filter @openverify/flow exec vitest run src/i18n --coverage.enabled=false
      Tests  220 passed (220)
```

### Final gates (on `59fdf509`, every exit code read from the command)

| Gate                                                                                                                                        | Exit | Result                                                    | Load (1 min) |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------- | ------------ |
| `pnpm --filter @openverify/flow typecheck`                                                                                                  | 0    | both projects                                             | 6.4          |
| `pnpm --filter @openverify/flow lint`                                                                                                       | 0    |                                                           | 6.4          |
| `pnpm --filter @openverify/flow test`                                                                                                       | 0    | 90 files, 1,267 tests, 95.6% statements, 89.5% branches   | 6.35         |
| `pnpm --filter @openverify/flow-spec test`                                                                                                  | 0    | 22 files, 431 tests, 96.17% statements                    | 9.45         |
| `pnpm --filter @openverify/config test`                                                                                                     | 0    | 272 tests                                                 | 6.35         |
| `pnpm --filter @openverify/ui lint`                                                                                                         | 0    |                                                           | 6.35         |
| `pnpm exec prettier --check <my files>`                                                                                                     | 0    |                                                           |              |
| `pnpm turbo run lint typecheck --force --filter=@openverify/flow --filter=@openverify/flow-spec --filter=@openverify/config --filter=@openverify/ui` | 0    | 8 of 8 tasks, 66 s                                        | 8.90         |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e`                                                                         | 0    | 79 passed in 31.0 s (with the `vite build`: 33 s)         | 4.56 → 10.73 |

The first forced turbo run (15:24, load 3.75) exited 1 on `packages/flow-spec/src/v2/analyses.ts`, an
uncommitted file of `flow-spec-logic` in progress beside me; run again at 15:29 it passed 8 of 8.

CHECKPOINT all DONE at 59fdf509f00952537a7f3a420a91c9b3aa6c6c5b

Handoff (`all`), for `flow-renderer` and the integration agent:
- Icons: `FLOW_ICONS`, `FlowIcon`, `MIRRORED_ICON_CLASS` (`rtl:-scale-x-100`), `isMirroredIcon`,
  `iconDirectionClass` (`apps/flow/src/i18n/icon-direction.ts`). Every new `<svg>` in `apps/flow/src`
  carries `data-icon="<kind>"` and `className={iconDirectionClass('<kind>')}`, or
  `icon-direction.test.tsx` fails; a new kind joins `FLOW_ICONS` and the test.
- Lint: rule `openverify-i18n/logical-properties`, config `logicalPropertiesConfig()` and
  `LOGICAL_PROPERTIES_FILES` in `packages/config/eslint/logical-properties.js` (types in
  `logical-properties.d.ts`); `foundation-9a` exports it from `@openverify/config`; the root wiring is
  pending (contractDeviations). Use `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`,
  `text-end`.
- Pseudo-locale pass (`apps/flow/e2e/support/pseudo-locale.ts`): `PSEUDO_LOCALES`,
  `PSEUDO_VIEWPORT`, `PSEUDO_BASE_LANGUAGE`, `pseudoMessages(locale)`, `pseudoCopy(locale)` (the
  session's `copy` with every built-in message by dotted key under `en` or `ar`), and
  `expectPseudoLocalized(page, where, { allowedTexts?, ignoreSelectors? })`. The renderer must apply a
  session's `copy` over the built-in messages for the pass to see brackets.
- Exports: `node apps/flow/scripts/export-flow-locales.ts` (`--check` to verify). After adding keys,
  run it and commit `contracts/fixtures/i18n/` and `src/i18n/catalog-version.ts`; `locale-export.test.ts`
  fails until then. `FLOW_CATALOG_VERSION` is the consent's `catalog-version`; `copy-source` is
  `built-in` for these texts.
- `consent-texts.json`: `{ format: 1, description, entries: [{ "catalog-version", client: "web", key,
  locale, text }] }`, the text unfilled (`{{days}}`, `{{organization}}`). `api-templates`' consent check
  (C162.9) takes every entry for a recorded key and locale as a candidate, fills `{{name}}` with the
  session's values, normalises to NFC and hashes.

