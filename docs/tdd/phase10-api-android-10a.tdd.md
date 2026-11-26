# Phase 10, Workflow 10A: api-android-10a (family S)

Agent `api-android-10a`, beside foundation-10a, android-logic, android-i18n and carry-10a, on the Workflow 10A base `c60d51b9` (10A decisions `c7bc6f49`, Stage 1a closed at `04cfac9c`). It owns the exports the Kotlin ports read, the Android request-fixture parse test, the server's borrowed edits of C221.12 and C221.13, and the Android consent rows (C200.3, C200.4). Every command ran after `source scripts/env.sh`; outputs are abbreviated.

## Checkpoint 1: copy-keys.json and builtin-palettes.json (C198.2, C199.7, C221.8)

Both exports are assert-only: the test compares the committed file with what the implementation gives and writes it only under `UPDATE_CONTRACT_FIXTURES=1`.

- `packages/flow-spec/src/export-vectors.test.ts` writes `contracts/fixtures/i18n/copy-keys.json` from `COPY_KEYS`, `COPY_LEGAL_KINDS`, `COMPONENT_COPY_ATTRIBUTES`, `COMPONENT_COPY_MAX_LENGTH` and `COPY_PLACEHOLDER_SOURCE` (`src/v2/copy-keys.ts`), keys sorted, and checks it against `copy-keys.schema.json` with Ajv 2020. Its own printer writes JSON as the repository's Prettier prints it, so `pnpm format:check` passes on the exported file; the printer has its own two tests.
- `packages/ui/src/export-palettes.test.ts` writes `contracts/fixtures/theme/builtin-palettes.json` from `styles.css` (light `@theme static`, dark `:root[data-openverify-variant='dark']`), refusing a block that is not exactly the twelve tokens as lower-case `#rrggbb`. `@openverify/ui` does not depend on `@openverify/core`, and no dependency was added: core's own contrast test already holds `BUILTIN_PALETTES` to the same stylesheet, so the file equals both.

RED (`f63be98b`):

```
$ pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false
 × contracts/fixtures/i18n/copy-keys.json (C199.7) > is the committed file
   AssertionError: expected null to be '{\n  "format": 1, ...'
 Tests  1 failed | 4 passed (5)
$ pnpm --filter @openverify/ui exec vitest run src/export-palettes.test.ts --coverage.enabled=false
 × contracts/fixtures/theme/builtin-palettes.json (C198.2) > is the committed file
 Tests  1 failed | 2 passed (3)
```

Both failed only because the files did not exist; typecheck (`tsc --noEmit` in both packages), ESLint and Prettier passed on the tests before the commit.

GREEN (`7fe8fbfd`):

```
$ UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false
 Tests  5 passed (5)
$ UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/ui exec vitest run src/export-palettes.test.ts --coverage.enabled=false
 Tests  3 passed (3)
$ (the same two without the variable)   5 passed, 3 passed
$ pnpm exec prettier --check contracts/fixtures/i18n/copy-keys.json contracts/fixtures/theme/builtin-palettes.json
All matched files use Prettier code style!
```

Checkpoint gate (the whole test scripts of both packages, each with its own coverage directory; load 14.1):

```
packages/flow-spec: vitest run --coverage   rc 0   24 files, 437 tests, 96.27% statements
packages/ui:        vitest run --coverage   rc 0   9 files, 58 tests, 100% statements
```

## Checkpoint 2: the visibility, pattern and digits vectors (C196.4, C221.8; reviews F10, V12)

`packages/flow-spec/src/export-vectors.test.ts` gained three assert-only exports, each over its own case table, importing only `evaluateVisibility`, `compilePattern`/`matchPattern` and `normalizeDigits`. No Phase 9 test file changed (`git diff c60d51b9 -- packages/flow-spec/src/v2/` is empty).

- `visibility-vectors.json`: 47 cases (Phase 9's 27 evaluator cases from `visibility.test.ts`, copied as data, then 20 of ours: decimals, explicit `null`, list needles, one-operand `and`/`or`, nesting) with `evaluateVisibility`'s answer, and 23 refusals the evaluator throws `VisibilityRuleError` for (Phase 9's malformed and out-of-scope rules, six server paths, capital and digit-first names, the depth and node limits). A refusal must be an object (its schema), so Phase 9's `[true]` and `'plain'` are left out; a rule naming another screen's field is not a refusal at evaluation time (the evaluator cannot know the screen) and is not listed.
- `pattern-vectors.json`: 579 matches, Phase 9's 571 golden cases read from the data file `src/v2/pattern/vectors.json` (its generator's `RegExp` oracle) with our matcher's own answers, which the test checks agree with the golden ones, then 8 pathological cases marked `pathological`: Phase 9's six linear-time cases and the cap (10,000 characters match `[^]*`, 10,001 never do), written as `prefix` + `repeat` + `suffix`; 49 refusals with `compilePattern`'s reason (Phase 9's 44 and five of its `compilePattern` cases).
- `digits-vectors.json`: 17 cases (Phase 9's six, then a phone number, a date, Persian digits, Arabic letters, the Arabic separators, the four code points beside both ranges, Bengali, Myanmar, Devanagari, an astral digit, ASCII), every input built from code points.

The printer learnt Prettier's rule for nested lists (a list of lists stays on one line unless two or more of them each hold two or more items) when the first write of `visibility-vectors.json` failed `prettier --check` on `[[]]` and `[["x"]]`; it has a test for it.

RED (`30368b7f5`):

```
$ pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false
 × contracts/fixtures/flow-spec/visibility-vectors.json (C196.1) > is the committed file
 × contracts/fixtures/flow-spec/pattern-vectors.json (C196.2) > is the committed file
 × contracts/fixtures/flow-spec/digits-vectors.json (C196.3) > is the committed file
   AssertionError: expected null to be '{\n  "format": 1, ...'
 Tests  3 failed | 14 passed (17)
```

GREEN (`786c56e1`):

```
$ UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false
 Tests  18 passed (18)
$ pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false
 Tests  18 passed (18)
$ pnpm exec prettier --check contracts/fixtures/flow-spec/*-vectors.json contracts/fixtures/i18n/copy-keys.json
All matched files use Prettier code style!
```

Checkpoint gate (load 7.1): `packages/flow-spec` `vitest run --coverage` rc 0, 24 files, 450 tests, 96.27% statements; `tsc --noEmit` and ESLint on the test rc 0.

Update command for every file of this test: `UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts --coverage.enabled=false`.

## Checkpoint 3: the zod parse test over the Android request fixtures (C224.4; review H02)

`apps/api/src/routes/flow/flow-requests.android.test.ts` reads `contracts/fixtures/flow-requests/android/index.json` (contracts-10a's table: file, method, route, the `@openverify/contracts` export that parses it, workflow, owner) and, for every `*.json` file of the directory but `index.*`, fails when the table does not list it (`<file>: not listed in index.json`), when the named export is not a zod schema, when the file is not JSON, and when the schema refuses the body (`<file>: <schema> refuses /<path> <zod code>, ...`, never a value). It also requires every table entry to name a zod schema. The directory holds no fixture yet: android-driver adds `screen-submit*.json`, `verification-government-id.json` and `signals.json`, android-sdk-api the three `consent-*.json`, and integration-10a runs this test over all of them. A `.multipart.json` file (10B on) is parsed the same way, as the JSON its owner commits.

RED (`ffa3c4f0`): the checker read the table but parsed no body.

```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false)
 × requestFixtureProblems > fails a body its schema refuses, naming the member and the code, never the value
 × requestFixtureProblems > fails a file that is not JSON
 Tests  2 failed | 4 passed (6)
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit)   rc 0 (108 s, load 6.1)
```

GREEN (`4a6544fc`):

```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false)
 Tests  6 passed (6)
```

The first GREEN run asked for `invalid_type` where zod 4 answers `invalid_value` for the literal `accepted: true`; the expectation now names `invalid_value` and the `unrecognized_keys` of the extra member. ESLint and Prettier pass on the file. This checkpoint adds one independent test file and no product code, so the API's whole suite in shards runs at checkpoint 4, with the server changes.

## Checkpoint 4: the server changes (C221.12, C221.13, C200.2)

Each is a named borrowed edit of a file contracts-10a's inventory names (§4), with a Testcontainers test; `git status --porcelain <file>` was empty before each edit and each was committed at once.

### The device_handoff skip for a native session (C221.13; Phase 7 C96.1 amended)

- **Files:** `apps/api/src/flow-engine/engine.ts` (new `skipHandoffForNativeSession(ctx, sessionId)`) and the one call at the end of `prepareFlowSessionInTx` in `apps/api/src/flow-engine/session.ts`, which every session answer runs under the inquiry's lock (`GET /flow/session` and the screen submission's answer).
- **Behaviour:** for the reading session, while the active position rests on a `device_handoff` step, the engine leaves it through `next` with outcome `skipped` and walks on (`moveOn`), at most once per step of the flow. The rule is `skipsHandoff` (`services/handoff/steps.ts:94`) called with `skipOnMobile` set aside (`false`), so it answers for a session with `mobile-sdk-name` alone, whatever the step says; a phone's browser keeps Phase 7's view-only skip (`servedHandoffState`), the position unchanged. A redacted inquiry, a waiting or ended position, or no open entry moves nothing.
- **Test:** `apps/api/src/flow-engine/handoff-skip.android.integration.test.ts` (5 tests): an SDK session (`User-Agent: OpenVerify-Android/0.1.0`, `OpenVerify-Flow-Spec: 2`) consents and reads the session at `about`, past a handoff step with `skipOnMobile` false and true, the record holding `[handoff, next, skipped]`; a desktop browser session stops at the step for both values (`exitPort: null`); an SDK session whose flow starts with two handoff steps reads `consent`, both skipped.

RED (`abaf308b`):

```
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/flow-engine/handoff-skip.android.integration.test.ts)
 × moves an SDK session past a handoff step with skipOnMobile false
 × moves an SDK session past a handoff step with skipOnMobile true
 × skips a handoff step an SDK session meets first, and two in a row
   AssertionError: expected { 'step-id': 'handoff', …(2) } to match object { 'step-id': 'about', state: 'active' }
 Tests  3 failed | 2 passed (5)        (30 s, load 6.6)
```

GREEN (`2f6bf3a4`): `Tests 5 passed (5)`; `src/services/handoff`, `src/routes/flow` and `src/flow-engine` unit suites: 43 files, 566 tests passed; `tsc --noEmit` rc 0.

### organization-display-name, served NFC and refused on save (C200.2, C221.12; review V13)

- **Files:** `apps/api/src/services/flow.ts` (`getFlowSession` serves `'organization-display-name'`: the environment's setting NFC-normalised, `null` until set, to every client); `apps/api/src/services/settings.ts` (`updateDashboardSettings` refuses a string name for which `displayNameProblem` answers, with the existing 422 `UnprocessableContentError` and its field error `{location: body, pointer: /organization-display-name}`; no new problem code, as contracts-10a froze none); the new `apps/api/src/services/nfc-boundary.ts` (`isStableNfcBoundary(codePoint)`, `displayNameProblem(name)`).
- **The rule:** the first character must have canonical combining class 0 and `NFC_Quick_Check=Yes`. Read from the platform's own Unicode data through `normalize`, never from a typed table: NFC must leave it unchanged (No); canonical reordering must not move it past U+0334 (class 1) or before U+0345 (class 240) (any other class); and it must not be the last code point of a canonical decomposition NFC composes back (Maybe with class 0: U+1161-U+1175, U+11A8-U+11C2, U+0BBE, U+0D57 and the others), found once per process by walking the 192,862 code points from U+00C0 to U+2FA1D (23 ms). The NFC form must also fit the session's 100 characters (U+FB2C is three in NFC). A name stored decomposed is accepted when it starts with a stable boundary, and served composed.
- **Tests:** `apps/api/src/services/nfc-boundary.test.ts` (27 unit tests: ten accepted classes of character, thirteen refused ones, a junction check that `NFC(p + c) = NFC(p) + NFC(c)` for every accepted code point below U+3400 after seven leads, the problem texts); `apps/api/src/services/organization-display-name.integration.test.ts` (9 tests on Postgres 17: `null` while unset; `Cafe` + U+0301 saved, stored as saved and served as `Café`; a Korean precomposed name and an Arabic name served unchanged; refused on save, the earlier name kept, for a leading U+0301, U+1161, U+11A8, U+0BBE and U+212B; `null` still clears it).

RED (stub `55d6f18b5`, tests `dee022687`):

```
$ (cd apps/api && pnpm exec vitest run src/services/nfc-boundary.test.ts --coverage.enabled=false)
 Tests  16 failed | 11 passed (27)          (the stub accepts every character)
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/organization-display-name.integration.test.ts)
 × serves null while the setting is unset
   AssertionError: expected { inquiry: { …(2) }, …(15) } to have property "organization-display-name"
 × refuses a name that starts with a combining acute accent, and keeps the setting
   AssertionError: expected null to be an instance of UnprocessableContentError
 Tests  9 failed (9)
```

GREEN (`18455c65`): `nfc-boundary.test.ts` 27 passed; both integration files 14 passed; the related unit suites (`src/routes/flow`, `src/flow-engine`, `src/services/handoff`, `src/services/settings*`, `src/routes/dashboard`, `src/services/templates`, `src/openapi.test.ts`): 93 files, 1,044 tests passed; `tsc --noEmit` rc 0; ESLint and `prettier --check --ignore-path=.gitignore` rc 0 on every touched file under `apps/api/src/services/`.

### The consent digest check and the language query

- The digest check (`services/templates/consent-texts.ts:74-121`) already accepts any client's released rows (inventory §2.5). Its Testcontainers test needs Android rows in `consent-texts.json`, which exist only from checkpoint 5 (the rows come from the SDK's resource files after android-i18n's last checkpoint), so it is written there.
- C221.12's `language` query is not built: the 10A decisions (decision 5) and Stage 1a amendment 13 keep Phase 9's mechanism, the consent body's `locale` (`flow-engine/scope.ts:266`).

### Checkpoint gate (beside other agents, through the heavy slots)

```
API unit suite, 12 blob shards (each rc 1 alone on partial coverage, as expected): 234, 241, 261, 264, 286, 299, 269, 277, 231, 234, 214, 215 s (load 19.7 to 25.5)
merge: pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged
  rc 0, 69 s, 694 files, 9,464 tests passed, 94.30% statements, 84.96% branches
integration --project api --shard=1/3: rc 0, 93 tests, 107 s; 2/3: rc 0, 101 tests, 239 s; 3/3: rc 0, 87 tests, 117 s (load 10.9 to 23.4)
```

## Checkpoint 5: the Android consent rows and their digests (C200.1, C200.3, C200.4; review F07)

Started once foundation-10a's checkpoint 2 (`23fb58cd`, the `exportConsentTexts` task stub that applies `scripts/export-consent-texts.gradle.kts` by name) and android-i18n's checkpoint 3 (`34aeaea4`, the five locales' final texts) had landed, with foundation-10a's `openverifyVersion=0.1.0` (`7f5e6cff`). The rows are append-only for ever, so none was written before the texts were final; the tests and the script were held outside the shared tree until then (a failing test in the tree would have broken every other agent's gate).

### What was built

- **`android/openverify-sdk/scripts/export-consent-texts.gradle.kts`** (`:openverify-sdk:exportConsentTexts`): reads `i18n/key-map.json`, takes its legal (`consent` or `notice`) entries that have a flow key (eight: `consent.automated-decision`, `.biometric`, `.biometric-matching`, `.checkbox`, `.device-recognition`, `.processing`, `notice.device-recognition`, `notice.session-integrity`; every `ConsentTexts` key among them), reads each locale's `strings_catalog.xml` with an XML parser and undoes Compose's escapes (`\n`, `\t`, `\\`; any other fails), refuses a positional placeholder (`%1$s`: the texts carry the web's `{{days}}` already, so no rewrite is needed and none is guessed) and a non-NFC text, takes `catalog-version = android-<openverifyVersion>-<16 hex>` (SHA-256 over `<locale>\t<key>\t<SHA-256 of the text>\n` in locale then key order, the consent texts only), and appends each row not yet in `contracts/fixtures/i18n/consent-texts.json` for its version, client, key and locale, never changing or removing one, writing JSON as `export-flow-locales.ts` does (Prettier leaves it as it is). It is configuration-cache safe (only captured files and values), declares its inputs and output, and writes only on a change.
- **The rows:** 40 (`client: android`, eight keys in five locales) under **`android-0.1.0-75ddea08ad090412`**.
- **`contracts/fixtures/i18n/android-consent-digests.json`**: 83 cases, each Android row at 365 days (the default) and 30, plus three organisation cases (a Latin name beside the `ar` text, `Cafe` + U+0301 stored and served NFC, a Korean name of precomposed syllables), every digest `consentTextDigest(text, values, true)`, the server's own fill and hash (`apps/api/src/services/templates/consent-texts.ts`, exported by the refactor `9e9c7822`, no behaviour change). No built-in text holds `{{organization}}` (10A decision 6), so the three organisation digests equal their row's today; they hold the device to the server's fill should one ever do.
- **Phase 9's locale exporter (borrowed edit, `36cbb4b2` RED, `b4a99fcc` GREEN):** `apps/flow/src/i18n/locale-export.ts`'s table description now names the web rows and the Android rows and who writes each; the new test proves the web export keeps a non-web row in place. `appendConsentTexts` already kept every existing row, so no logic changed; the table was re-exported by `pnpm --filter @openverify/flow i18n:export` (description only).

### Tests

- `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/i18n/ConsentTextsTableTest.kt` (4): every `ConsentTexts` key is a legal consent or notice string of the key map; the current texts have their rows, in the current words, under the current catalog version in all five locales (and no extra row there); every Android row is NFC, of the version form, with only `{{days}}` or `{{organization}}`; the version changes with a consent text. The version uses the generated `OPENVERIFY_SDK_VERSION` (foundation-10a's constant of `openverifyVersion`, which the task reads). That no released row is ever removed or changed, whatever its client, is Phase 9's `locale-export.test.ts` ("has lost no entry of any committed version of itself"), which reads every committed revision of the table.
- `apps/api/src/services/templates/consent-texts.android.test.ts` (4, assert-only): the Android rows exist, are NFC with only the placeholders the server fills; each case's digest is also the SHA-256 of the text a device fills without normalising (ASCII digits); the file meets its JSON Schema (Ajv 2020); it is the committed file (written only under `UPDATE_CONTRACT_FIXTURES=1`, printed with the repository's Prettier).
- `apps/api/src/services/templates/consent-texts.android.integration.test.ts` (4, Postgres 17): `POST /api/v1/flow/consent` with the SDK's `User-Agent` accepts the Android digests of `consent.biometric`, `consent.processing` and `notice.session-integrity` in `en` and `ar` at a 30-day environment, and the optional `consent.biometric-matching` (its `{{days}}` filled) in `fr` at 365 days; a wrong digest answers 422 `consent_text_mismatch` and records no consent.

RED (`5bb4fdaf`):

```
$ (cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.i18n.ConsentTextsTableTest)
ConsentTextsTableTest > every Android row is NFC, names its version form ... FAILED   (AssertionFailedError at :103, no Android row)
ConsentTextsTableTest > the current consent texts have their rows under the current catalog version ... FAILED (:96)
4 tests completed, 2 failed    rc 1, 209 s with the lock wait, load 14.4
$ (cd apps/api && pnpm exec vitest run src/services/templates/consent-texts.android.test.ts --coverage.enabled=false)
 × has Android rows to take digests of ...   AssertionError: expected 0 to be greater than 0
 Tests  4 failed (4)
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/templates/consent-texts.android.integration.test.ts)
 FAIL  ... Error: ENOENT: no such file or directory, open '.../contracts/fixtures/i18n/android-consent-digests.json'
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit)   rc 0
```

GREEN (`07c626af`):

```
$ (cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:exportConsentTexts)   rc 0, 93 s with the lock wait
   consent-texts.json: +40 rows under android-0.1.0-75ddea08ad090412; prettier --check rc 0; node apps/flow/scripts/export-flow-locales.ts --check: "The locale exports are up to date."
$ UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/api exec vitest run src/services/templates/consent-texts.android.test.ts --coverage.enabled=false   4 passed (83 cases written)
$ (the same without the variable)   4 passed; prettier --check android-consent-digests.json rc 0
$ ... --tests dev.openverify.sdk.i18n.ConsentTextsTableTest   rc 0, 4 tests, 0 failures
$ ... --project api src/services/templates/consent-texts.android.integration.test.ts   rc 0, 4 passed
```

The script was first proven in a discarded scratch worktree (`git worktree add --detach /tmp/aa10a-spike-exp`, a temporary task registration, 164 s with the lock, then removed and pruned): the same 40 rows and version, Prettier-clean, the web `--check` up to date, and a second run `UP-TO-DATE` with no change.

## Final gates (beside other agents; rules 23 and 24)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | rc 0 (lockfile up to date); `pnpm-workspace.yaml` unchanged |
| `pnpm format:check` | rc 0, 202 s |
| `prettier --check --ignore-path=.gitignore` on my `apps/api/src/services/` files (nfc-boundary, organization-display-name, flow, settings, templates/consent-texts*) | rc 0 |
| forced lint `--filter=@openverify/flow-spec --filter=@openverify/ui --filter=@openverify/flow` (with typecheck) | rc 0, 163 s, 6 of 6 tasks |
| forced lint `--filter=@openverify/api` (`NODE_OPTIONS=--max-old-space-size=4096`, heavy slot) | rc 0, 423 s, load 15.2 |
| forced typecheck of api, flow-spec, ui, flow, contracts (heavy slot) | rc 0, 188 s, 5 of 5 |
| `pnpm turbo run test --force --concurrency=1` for flow, contracts, flow-spec, ui | rc 0, 270 s (load 23.8): flow 1,502 (94.81%), contracts 4,401 (99.11%), flow-spec 454 (96.27%), ui 58 (100%) |
| API unit suite, 12 blob shards (each rc 1 alone on partial coverage) | 302, 289, 317, 322, 346, 356, 424, 407, 413, 418, 267, 261 s (load 26.4 to 41.6) |
| API merge (`--merge-reports`, coverage in its own directory) | **rc 0**, 70 s: 696 files, 9,472 tests, 94.39% statements, 85.06% branches |
| `pnpm --filter @openverify/db test:integration` | rc 0, 78 tests, 170 s (load 39.0) |
| integration `--project graph` | rc 0, 13 tests, 59 s (template 26.9 s of its 180 s guard, load 20.0) |
| integration `--project api --shard=1/3`, `2/3`, `3/3` | rc 0: 93, 104 and 88 tests (107, 246 and 126 s) |
| `UPDATE_CONTRACT_FIXTURES` unset; `git status --porcelain contracts/` after the tests | empty |
| `:openverify-sdk:exportConsentTexts --rerun` | rc 0, 103 s with the lock wait; `git status --porcelain contracts/` empty (no change) |
| Android gate (a) `:openverify-sdk:testAndroidHostTest --rerun` | rc 0, 93 s with the lock wait (load 2.9): 1,555 tests, 0 skipped, 0 failed (a first call was `UP-TO-DATE` at 46 s, so it was re-run for real) |
| Android gate (e) `:openverify-sdk:assemble lint` | rc 0, 123 s with the lock wait (load 4.8) |
| mocked flow suite (I touched `apps/flow`) `flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | rc 0, 328 passed in 2.8 min (287 s with the lock wait, load 18.3) |

No e2e gate ran (rule 24): this area adds no full-stack spec.
