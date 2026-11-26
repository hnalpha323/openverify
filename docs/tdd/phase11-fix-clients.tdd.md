# Phase 11, Workflow 11F Stage 4: fix-clients

Agent: fix-clients (claude-opus-5-5), beside fix-server, on 2026-11-21. Paths: `apps/flow/`,
`apps/dashboard/`, `apps/demo-web/`, `packages/sdk-*/`, `android/`, and this file. Base of the
review: `4db86122d..HEAD`; 11F start `1746797ae`; this agent started at `778b30a15`.

No BLOCKING item was routed to fix-clients. The work is the dast-11f followup addressed to
fix-clients (rule 10055) and the 22 known items, in the task's order. Machine for every timing:
Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2; the load average (`/proc/loadavg`) is
written beside each timing.

## 1. KP11-95 (8D's R007): the wait-event form and the route label input

`apps/dashboard/src/components/workflows/editor/step-form.test.tsx` is new: eight cases over
`StepForm` for a wait on events (subject, timeout, on-timeout, the event lines trimmed and
blank-free, a non-integer timeout refused at its field, a wait on time showing no event list) and a
conditional's route labels (shown in order with `maxLength` 80, a rename trimmed and keyed on the
route's key with its gesture, an empty or blank label never applied).

The first run (load 1.95 1.73 2.11) failed one case for a reason in the test, not the form: the
filter is a `section` with an accessible name (role `region`), not a `group`:

```
pnpm exec vitest run src/components/workflows/editor/step-form.test.tsx --coverage.enabled=false
 FAIL  ... > shows the subject, the timeout, what a timeout does and the events, one per line
TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Filter of Wait for the review"
      Tests  1 failed | 7 passed (8)
```

With the query corrected: `Tests  8 passed (8)`. The tests found no defect in the form, so no
code changed (the item asked for the tests; "a defect they find is fixed test-first").

Commit: `16efbcd39` (test).

## 2. KP10-15: the palette's module entries and the trigger the draft has now

Cause (read in the code): `app/workflows/[id]/draft/page.tsx` decided at page load whether to read
the module workflows, from the trigger the stored draft had (`MODULELESS_TRIGGERS`, account and
case actions run no module). The palette (`palette-model.ts` `paletteOf`) is recomputed from the
live draft on every edit, but its module list was the page's: a draft loaded with a case trigger
and changed to an API trigger offered only "No workflow is listed here", and one loaded with an API
trigger and changed to a case trigger offered modules the graph check refuses
(`module_refused_for_trigger`).

RED (`dabec221b`, load 3.48 2.96 2.57 around these runs):

```
pnpm exec vitest run src/components/workflows/editor/palette-model.test.ts --coverage.enabled=false
     × refuses a module while the trigger is trigger-account, which runs none (module_refused_for_trigger)
     × refuses a module while the trigger is trigger-case, which runs none (module_refused_for_trigger)
      Tests  2 failed | 9 passed (11)
pnpm exec vitest run "src/app/workflows/[id]/draft/page.test.tsx" --coverage.enabled=false
     × reads the modules for a draft whose trigger is trigger-account, and the palette refuses them while it is ...
     × reads the modules for a draft whose trigger is trigger-case, ...
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 11 passed (13)
```

The page test's two cases replace the earlier "offers no module to a draft whose trigger is %s"
(the behaviour changes as the item asks; contractDeviations). GREEN (`82415196a`): the page reads
the modules for every writable `workflow`-kind draft (a module's own draft still reads none,
`module_nested`), and `paletteOf` refuses each module entry while the trigger is in the exported
`MODULELESS_TRIGGERS`, in words ("A case action runs no module (another workflow), so it cannot be
added here."). The page, palette-model, palette and draft-editor tests: `Tests  32 passed (32)`.

## 3. KP11-78: the console session cookie's prefix

The cookie is Secure exactly when `secureCookies()` holds (a production build without
`OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true`); `__Host-` needs Secure, `Path=/` and no `Domain`. So
the name follows the same decision, as the SSO binding cookie's does (`ssoBindingCookieName`):
`__Host-openverify_session` when Secure, `openverify_session` under `next dev` or the plain-http
opt-out. Each reader reads that one name only, so a production console never accepts an
unprefixed cookie a sibling host or a plain-http page planted.

- Stub `4d0093e3a`: `sessionCookieName()` returning the old name, so the RED tests compile.
- RED `932adba76`: `lib/session.test.ts` (the name per environment, set Secure on `/` with no
  Domain, an unprefixed cookie read as no session, the prefixed one cleared), `proxy.test.ts` (an
  unprefixed cookie is sent to sign in in production), `app/(auth)/sso/sso-routes.test.ts` (the
  callback sets the prefixed cookie, Secure, `Path=/`, no Domain). `proxy.test.ts`'s request helper
  and `security/console-csp.test.ts` now plant `sessionCookieName()`, because their production
  cases must keep a session (contractDeviations).

```
pnpm exec vitest run src/lib/session.test.ts src/proxy.test.ts src/security/console-csp.test.ts "src/app/(auth)/sso/sso-routes.test.ts" --coverage.enabled=false
     × is named __Host- exactly when it is Secure ({ NODE_ENV: 'production' })
     × a production build sets __Host-openverify_session: Secure, path /, no Domain
     × a production build reads only the prefixed cookie: an unprefixed one is no session
     × a production build clears the prefixed cookie
     × in a production build, lets only the __Host- cookie through: an unprefixed one signs in again
     × in a production build, opens the console with the __Host- session cookie (KP11-78)
AssertionError: expected '' to contain '__Host-openverify_session=ovu_SSSSSSS…'
      Tests  7 failed | 179 passed (186)
```

- GREEN `5152c662d`: `secureCookies` and `INSECURE_COOKIES_ENV` move into `lib/session-cookie.ts`
  (free of server-only imports, so the proxy reads the same decision) and `lib/config.ts`
  re-exports them; `sessionCookieName()` is used by `session.ts`, `proxy.ts` and the SSO callback.
  The four files above with `config.test.ts` and the SSO folder: `Tests  235 passed (235)`; the
  seven other dashboard tests that stub a production build: `Tests  159 passed (159)`.
- Borrowed edit `260ecb876` (fix-server's `e2e/`, each file clean first): the specs and support
  files that read or plant the cookie use `__Host-openverify_session` with `secure: true` (the e2e
  stack serves a production build on `http://localhost`), and `ui-mfa.spec.ts` also asserts
  Secure and `Path=/`. `tsc --noEmit -p e2e` exits 0.
- Left for fix-records: `security/zap/run.sh:373` plants `openverify_session=` for the console
  scan (followups).

## 4. dast-11f's followup, rule 10055 (the console CSP's `report-uri`): no change needed

Read first: the console policy has named `report-to csp` beside `report-uri /csp-reports` since
Phase 9 (`61ca9afa5`, `lib/csp/policy.ts` `consoleCsp`), and `proxy.ts` sends
`Reporting-Endpoints: csp="/csp-reports"` on every answer it makes, the redirect to sign in
included. ZAP's rule 10055 ("CSP: Notices") is raised by the presence of `report-uri`, which CSP
Level 3 deprecates, whatever else the policy names; removing it would drop Firefox's reports, and a
browser that reads `report-to` ignores `report-uri`. So the followup's change is already in place
and the remaining notice is expected.

Proven with a test that fails if the defect were real (`6375a0549`, `security/console-csp.test.ts`):
every console path the proxy matches, and `/robots.txt` and `/sitemap.xml` (two of the four
flagged paths), answer a policy whose `report-to` is `csp`, whose `report-uri` is `/csp-reports`,
and a `Reporting-Endpoints` header naming the group: `Tests  246 passed (246)`. With `report-to`
taken out of the policy for one run (restored by copy, `git status` clean after):

```
pnpm exec vitest run src/security/console-csp.test.ts -t robots --coverage.enabled=false
     × /robots.txt names report-to with its Reporting-Endpoints group beside report-uri
AssertionError: expected undefined to deeply equal [ 'csp' ]
```

`security/zap/triage.tsv`'s 10055 row is fix-records' to restate (followups).

## 5. KP11-80: the console's and the flow server's logs

Each place the item names, read and decided:

- `components/page-error.tsx:30` called `console.error(error)` in the browser. A server error
  reaches an error boundary as Next.js's generic message with a digest, but a client component's
  own error keeps its words, which can quote what the page shows. Fixed test-first: RED
  `e492345e7` (`components/page-parts.test.tsx`, a `TypeError` quoting a synthetic name and date):
  `AssertionError: expected "error" to be called once with arguments: [ Array(2) ]`,
  `Tests  1 failed | 12 passed (13)`; GREEN `9fab409bf`: the boundary logs
  `The page could not be loaded` with `{error: <kind>, digest}` only, `Tests  13 passed (13)`.
- `lib/api/sessions.ts:243` logs a failed sign-out with the error's name and the status only. Held
  by a new test (`5c0665cd4`, `lib/api/sessions.test.ts`): one call with exactly those two members
  and no session token anywhere in it, `Tests  40 passed (40)`. No change.
- `app/csp-reports/route.ts:13` logs `CspViolationLogEntry` only (the effective directive and the
  blocked resource's scheme and host), already held by `lib/csp/reports.test.ts:76-100` (the
  document, referrer, path and query are never logged). No change.
- `apps/flow/server.ts:661` logs `AccessLogLine` = `{entry, status}`, a fixed entry kind and a
  number, already held by `src/server/server-serving.test.ts:293-307` (no inquiry id, address,
  token or asset path). No change.

So no personal data reaches these logs now; `docs/security/logging.md` and the threat model's
BX-I1 are fix-records' to restate (followups).

## 6. KP11-93 (K8-25): the built flow bundle's size, measured; no budget

The 11F decisions give no number (item 25: "KP11-93 has no budget number, so fix-clients reports
the measured size open for the owner"), so no check is added. Measured at `5c0665cd4` with
`pnpm exec vite build --outDir /tmp/claude-1000/flow-dist-1` (outside the tree, so no stack's
`dist/` changed; built in 2.06 s at load 3.21 2.60 2.48) and Python's `gzip.compress(level=9)`:

| Output | Files | Bytes | gzip -9 bytes |
|---|---|---|---|
| JavaScript (`.js`, `.mjs`) | 5 | 1,472,782 | 428,434 |
| of which `assets/document-language-*.js` | 1 | 1,196,119 | 338,136 |
| of which `assets/main-*.js` | 1 | 199,420 | 63,737 |
| CSS | 1 | 20,718 | 5,159 |

(The ONNX Runtime `.wasm` files are not counted.) 9A measured 1,278,140 bytes, 369,108 gzipped.
Open for the owner to set the budget (checklist line K8-25).

## 7. The failures-under-load class: KP11-66, KP11-44, KP11-25

Shared mechanism, read from the orchestrator's records (`docs/tdd/phase11-orchestrator.tdd.md`):
both guards were met in the all-packages form (`pnpm turbo run test --force`, every package's
Vitest at once, each with `maxWorkers: '50%'`, six workers here, `packages/config/src/vitest.ts:33`),
whose flow suite reported "141 workers spawned, ~5.46 s startup each" and whose react file took
338 s; in the KP11-66 run every role-form case took 17-58 s against about 1-2.6 s alone. A case
that costs C seconds of one CPU alone takes about C times the run's stretch, so the 60 s guard
falls for any case above roughly 60 s over that stretch (about 26 to 32 here).

The reproduction (a script outside the tree, `/tmp/claude-1000/fc-pinned.sh`): the one Vitest call
pinned with `taskset -c 11` to logical CPU 11 beside 31 busy loops pinned to the same CPU, so the
call gets about 1/32 of one CPU, the stretch of the failing runs; the loops are killed on exit. It
loads one CPU of twelve; the other agents' work runs on the rest (the load average beside each
call includes theirs).

### KP11-66 (`role-form.test.tsx`, "shows the API's refusal ..."): fixed

Cause, measured alone (a probe file, removed after): the form shows 86 permission checkboxes and
622 elements; `getByLabelText('Name')` took 588-653 ms, `getByLabelText('View inquiries')`
620-624 ms and a named `getByRole('checkbox')` 1,001 ms, because jsdom resolves each control's
labels by walking the document, once per candidate; `getByRole('textbox', {name: 'Name'})` took
27 ms. The case's four label queries were most of its 2.09 s.

- RED, the reproduction on the committed test (load 2.09 2.26 2.36 before, 31.87 after):
  `× shows the API's refusal, such as a name already taken 63096ms`, `Error: Test timed out in
  60000ms.` (the failing run's 67 s).
- GREEN `e729d1540`: the file finds the name field by its role and name and each permission through
  the `<label>` with exactly its text and that label's own control (`HTMLLabelElement.control`,
  checked to be a checkbox), the same associations without resolving all 86. Alone: the six cases
  542, 247, 330, 249, 252 and 160 ms (were 2,582, 973, 1,223, 2,089, 988 and 826 ms). The
  reproduction (load 11.79 12.90 7.09 before, other agents' suites running):
  `✓ shows the API's refusal, such as a name already taken 24061ms`, rc 0.

### KP11-44 (`screen-catalogue.test.tsx`, "collects every kind into one submission"): open

Cause established, fix not found within the test without weakening it.

- Measured alone (a probe, removed after; load 2.29 2.45 2.44): the screen renders 833 elements
  (the address's country list of every country among them); each keystroke re-renders the whole
  screen, about 19 ms (54 keystrokes, 1,028 ms); each screen-level `getByRole` about 44 ms (14
  queries, 613 ms); render 160 ms; the case types about 79 characters and makes about 19 queries.
- RED, the reproduction on the committed test (load 26.64 20.44 10.89 before):
  `× collects every kind into one submission 61069ms`, `→ Test timed out in 60000ms.`
- Tried: pasting the five longer values (one input event each) and typing only the three short
  ones (the Arabic-Indic digits among them): alone 1,614 ms at load 14; the reproduction (load
  8.12 18.77 14.50 before) still `× ... 60555ms`, timed out. The queries remain about 1 s of it;
  `getByRole(..., {hidden: true})` saved about a third in four noisy runs at load 11-12, not
  enough, and it would drop the accessibility check the queries make. Reverted (by copy; the
  committed file is unchanged).
- What would fix it (followups): a cap on the all-packages form's oversubscription (the shared
  Vitest config or the gate's turbo concurrency, fix-server's and the orchestrator's), or a screen
  that re-renders only the edited field (the next release; also cheaper on low-end phones).

### KP11-25 (`apps/flow/e2e/screens.spec.ts:37`, `selfie-capture.spec.ts:127`): open

Not met in 11C to 11E (the mocked suite passed 349 of 349), and not reproduced here: the mocked
suite is a Playwright run of Chromium (several processes, the browser's own threads), which the
one-CPU pinning above does not model, and axe's full-page run and the selfie guidance's timing are
CPU-bound in the renderer, the same class as above. The calls made: the mocked suite in this
agent's gate (section on the gate below), with its load recorded; if either case fails there it is
reported with its load and assertion, never retried.

## 8. KP11-90 (KP11-26's client half): the provider's amr on the sessions page

fix-server's `2cc6c1679` ("Workflow 11F fix-server checkpoint KP11-26") serves `provider-amr` on
`GET /dashboard/sessions` (`userSessionAttributesSchema`, a strict object). The dashboard's session
fixture lacked the member, so three of the sessions page's six tests failed on the contract once it
landed (`OpenVerifyResponseValidationError`), before any change of mine.

- RED `ffdc05114` and `6e897b44d` (the first served a document without `links`, so it failed on
  the contract; the second fails for the intended reason): `src/testing/routes/settings.ts`'s
  `sessionResource` carries `'provider-amr': null`, and `app/account/sessions/page.test.tsx` shows
  an SSO session's `['pwd', 'mfa']` and a password session's "None stated":
  `TestingLibraryElementError: Unable to find an accessible element with the role "columnheader" and name "Sign-in methods (identity provider)"`,
  `Tests  1 failed | 6 passed (7)`.
- GREEN `b40215b5a`: `SessionsTable` gains the column (the values in code font, as the provider
  stated them, never trusted), with its two copy strings. The sessions, users, SSO and Connect
  settings tests that read sessions: `Test Files  13 passed (13)`, `Tests  151 passed (151)`.

## 9. Android: KP11-79, KP10-53, KP10-56

Every Gradle call below ran through `/tmp/claude-1000/fc-gradle.sh` (the Gradle lock, the load and
the lock wait written; `python3 -I scripts/fetch_models.py --only face_detection_yunet` and
`fetch_fixtures.py --only person_a_id` ran first, both rc 0).

### KP11-79: `ConsentDigests.kt`'s comment

A comment says what the code does, so its test reads the source, as `SdkTextSourceTest` does:
`consent/ConsentDigestsRecordTest.kt` (androidHostTest) fails while the documentation says the
server "records such a consent with `text-sha256: null`" or does not say it stores none.

- RED `5a5414f94` (first run at load 6.97 19.87 17.44, 62 s): `AssertionFailedError: the
  documentation does not say the server stores no digest`. (Its first regex missed "records";
  corrected before the commit, so the first assertion also fails for that sentence.)
- GREEN `606fdb61b`: the comment says the server checks the digests a body carries against the
  texts it stored, stores none, and does not check a body without them (as fix-server's `1a393a6bf`
  says for KP11-73). No public signature, so no ABI dump.

### KP10-53 (10D review A012): the font-scale sweep's exemption

- Refactor `d587ce927`: the rule becomes the harness function `lostControls(nodes, window)`,
  unchanged.
- RED `5a5414f94`: `ui/a11y/A11yReachTest.kt` draws a page that scrolls up and down holding a
  control below the fold, one pushed past the window's side, a row that scrolls sideways below the
  fold with a control at 600 dp, and a control outside any scrolling area below the window:
  `AssertionError: expected:<[outside any scrolling area, past the side]> but was:<[outside any scrolling area]>`.
- GREEN `606fdb61b`: a control is reachable when, on each axis along which it lies past the window,
  some ancestor scrolls along that axis. A first form that asked the nearest scrolling ancestor
  alone wrongly flagged the sideways row inside the vertical page (`but was: [along a row that
  scrolls, ...]`); corrected before the commit. With the narrowed rule the sweep finds nothing:
  `A11ySweepTest` 12 of 12 (the six font-scale-2.0 locales among them), `A11yReachTest` 1,
  `A11yShutterTest` 2, `ConsentDigestsRecordTest` 1, rc 0 in 98 s (load 4.43 10.15 13.84, lock wait
  0.003 s).

### KP10-56: `InvalidResponse.causeClass` as a fixed code

Read first: `FlowApiException` is `internal`, so no host reads `causeClass` (it is not in
`api/android/openverify-sdk.api` or the klib dump, and no main source reads it); only the canary
test did. The change therefore touches no ABI dump. It made the SDK's two consumer rules pointless,
so they go with it, with the release check that required them.

- Stub `d34d93f8a`: `decodeFailure` and `DECODE_FAILURES`, empty.
- RED `61f3c071c` (`api/FlowApiExceptionCanaryTest.kt`): each body's code (`malformed JSON`, a wrong
  type and trailing bytes `malformed_json`, a missing member `missing_field`, the model's own
  refusal `invalid_value`) and every code in the set: 6 of 23 failed,
  `expected: <malformed_json> but was: <null>` (rc 1 in 154 s, load 7.78 8.71 10.49).
- GREEN `8f28cef0f`: `decodeFailure` is chosen by type (`MissingFieldException`, then any
  `SerializationException`, then `IllegalArgumentException`, else `other`; `null` without a cause)
  and `causeClass` is removed; the canary test's two `causeClass` assertions go with it
  (contractDeviations). `dev.openverify.sdk.api.*` and `dev.openverify.sdk.nfc.*`: rc 0 in 131 s
  (load 3.69 6.45 9.20).
- RED `1501567c3` (`android/scripts/tests/test_check_consumer_rules.py`): the SDK ships no rule; a
  renamed serialization exception is no problem; a mapping without them still proves the activity;
  an SDK with no rule needs no section of the merged configuration:
  `FAILED (failures=4)` of 19.
- GREEN `f580f20d1`: `openverify-sdk/consumer-rules.pro` holds comments only;
  `check-consumer-rules.py`'s mapping rule checks the SDK's activity only and its configuration
  rule asks for the SDK's section only when it has rules; the SDK README's keep-rules line says
  the SDK needs none. The release checks' own tests: `Ran 98 tests ... OK`.
- `docs/android/release-and-support.md:90` ("each module ships its consumer rules") is
  fix-records' (followups). The proof on R8's real outputs is gate calls (5), (9) and (10) below.

## 10. The items decided "11F, else the next release under C286", and the optional ones

Each read in the code; each not built here is reported open with its reason, for fix-records to
place under PLAN's "Next release: Phase 11 deferrals (C286)" and the review amendments.

- **KP10-26** (`client-elapsed-ms` past ten selfie extensions): open. The SDK clamps at
  `SelfieCaptureUpload.MAX_CLIENT_ELAPSED_MS` = 600,000 ms, the flow API's own `CLIENT_ELAPSED_MS_MAX`
  (C40.3, `model/SelfieCapture.kt:78-79`); a longer range is a change of the server contract
  (`packages/contracts`, the route schema, `@openverify/node`, the request fixtures) before the
  client, which this Workflow's parallel fixers cannot sequence; fix-server has no such item.
  Next release (C286).
- **KP10-30** (the PDF417 read as an auto-capture gate): open. The read is proven on the committed
  950 and 640 px images; the 1,280 px camera frame it would gate is a device behaviour (KP10-21's
  device proof), and the decision needs a frame from the phone. Next release (C286).
- **KP10-35 part 2** (a 640 px subsampled copy for the document gates): open. It needs a paired
  synthetic 1,280 px and 640 px scene in the committed vectors first (rule 3 of the PII rules), a
  fixture change of its own on both sides. Next release (C286).
- **KP10-57** (the selfie time warning drawn over the capture heading, audit gap K7): open with
  KP10-17. The warning states are catalogued (`A11yCatalog.kt:383-422`) and the sweep's
  "the first thing read is the heading" passes on them, but that check reads positions, not
  TalkBack's traversal; Workflow 10D Stage 1 amendment 11 bars reordering without a way to verify
  focus order, which only the owner's manual pass gives.
- **KP11-5** (EF.CardSecurity after PACE): open. JMRTD 0.8.9 gives no secured route to a
  master-file file after PACE (`android/openverify-nfc/README.md:52`); a host-tested route would be
  new reader code over JMRTD's internals, and PACE itself runs in no automated test (the owner's
  real-document read, KP10-58). Device proof open (followups).
- **KP11-6** (an SDK host test over the YuNet face-frame vectors): open. The vectors hold the input
  description and the expected faces, not the model's raw outputs, so feeding them through the
  SDK's `YunetDecode.kt` needs the model run: the SDK's host tests have no ONNX Runtime (adding it is
  a dependency, which 11F adds none of), and the vectors are not to be rebuilt while E002 is open.
  `openverify-face`'s host tests hold the same path today (`FaceFrameInferenceTest`,
  `YunetReference.kt`).
- **KP10-19** (optional: key-map the older hand-written SDK strings whose English equals a web
  text): open, not taken (optional; no defect).
- **KP11-8** (optional: assert on a mapping built with nfc that JMRTD's `PassportService` and Bouncy
  Castle's provider classes keep their names): open, not taken. No gate call builds a minified demo
  with `nfc` (call (5) builds `release` with the default `sdk` only; call (11) builds debug), so the
  assertion needs a new gate step and its CI wiring (fix-records' workflows), a change of its own.

## 11. Waits on fix-server

- KP11-90 needed `Workflow 11F fix-server checkpoint KP11-26`, which landed (`2cc6c1679`).
- KP11-88 needs `Workflow 11F fix-server checkpoint KP11-20`, and KP11-89 `... KP11-21` (rule 23);
  see the gate section for the wait.

fix-server's last checkpoint (`5c144a954`, "Workflow 11F fix-server checkpoint validation")
reports KP11-20 and KP11-21 open and says checkpoint KP11-20 was not committed. One rule-23 wait
(540 s, rc 124, 12:58 to 13:07 UTC) saw neither checkpoint; with the producer finished, no later
one can land, so KP11-88 and KP11-89 are reported open on it (blockers).

- KP11-88: every mount it names (the Cloned marker on verification cards, `hydrated_fields`, the
  decision record's members, the earlier policy versions, the connection's `sample` flag, and
  Android's share-consent labels) reads a member the API does not serve yet; nothing to build first.
- KP11-89: the console already lists an object's consent records and withdraws one
  (`components/connect/connect-api.ts:199-238`, through the server's
  `/api/v1/connect/consent-records` routes with the console session), and its RSC payload test
  already proves a principal without `pii:view` receives neither the evidence nor the stored text
  (`components/connect/object-connect-section.test.tsx:128`). The console BFF route the item names
  is an API route, fix-server's KP11-21.

## 12. The gate as run (rules 21 and 22, beside fix-server; then alone after its last checkpoint)

Touched: `apps/dashboard`, `android/` (the SDK's client and host tests, its consumer rules, the
release check), and `e2e/` (named borrowed edits). Not touched: `apps/flow` (the KP11-44 attempt was
reverted), `apps/demo-web`, `packages/sdk-*`.

| Call | Result | Seconds | Load (before) |
|---|---|---|---|
| typecheck, forced, dashboard and e2e (heavy slot) | rc 0, 2 tasks | 56 | 1.04 2.54 6.78 |
| lint, forced, `--concurrency=1`, 4 GB heap, dashboard and e2e (heavy slot) | rc 0, 2 tasks | 200 | 1.04 (after the typecheck) |
| dashboard shard 1 of 2 (blob, own coverage folder) | written | 343 | 13.41 14.62 15.61 |
| dashboard shard 2 of 2 | written | 372 | about 16.8 |
| dashboard merge with coverage | rc 0: 623 files, 7,384 tests, 95.67% statements | 11 | 15.29 17.67 17.01 |
| e2e package units | rc 0: 24 files, 161 tests, 96.87% | 5 | 2.69 2.58 5.73 |
| `pnpm format:check` | rc 0 | 160 | (after the merge) |
| mocked flow suite (not required: `apps/flow` untouched; run once for KP11-25) | rc 0: 349 passed in 2.1 min | 132 | 5.15 6.74 10.99 |

The dashboard shards and merge ran after every dashboard change (KP11-90 last); the typecheck and
lint above are the second run, after the last dashboard and e2e change (the first, before KP11-90,
was also rc 0: typecheck 73 s, lint 221 s).

**The Android gate** (rule 17's twelve calls, in order, each under the Gradle lock; every lock wait
0.003 to 0.019 s):

| Call | Result | Seconds | Load (before) |
|---|---|---|---|
| (1) host tests `ui` | 533 tests, 0 skipped, 0 failed | 154 | 3.60 5.52 8.23 |
| (1) host tests `flow` | 427 | 53 | 4.25 5.13 7.63 |
| (1) host tests `rest` | 1,779 | 190 | 4.16 4.98 7.42 |
| (2) `screenshotTest` verify | 97 compared, 0 failed | 78 | 14.00 10.20 9.08 |
| (3) `koverVerify checkKotlinAbi` | rc 0 | 256 | 8.72 9.76 9.05 |
| (4) `testDebugUnitTest assembleDebug` | demo 97 and 9, nfc 116, face 51 | 156 | 5.14 8.43 8.83 |
| (5) the release builds | rc 0 | 230 | 31.43 18.88 12.67 |
| (6) `:openverify-sdk:assemble` (AAR, iOS klibs) | rc 0 | 83 | 20.31 20.15 14.59 |
| (7) `lint` | rc 0 | 294 | 15.07 18.42 14.48 |
| (8) device-test compile | rc 0 | 244 | 15.66 16.95 15.04 |
| (9) bundletool; release checks' tests; elf, consumer rules, size | 98 OK; all three rc 0 | under 20 | 17.57 18.68 16.34 |
| (10) staging; `-p consumer-check build` | rc 0; `check-staged-repository: passed`, `check-consumer-rules: passed` | 69, 240 | 15.51 18.01 16.22 |
| (11) demo `sdk,nfc`, `sdk,face`, `sdk,nfc,face` | rc 0 each | 134, 128, 124 | 18.57 18.51 16.86 |
| (12) `cyclonedxBom` | 188, 195, 190 components | 15 | 12.91 14.69 15.67 |

The SDK host tests are 533 + 427 + 1,779 = **2,739** (2,732 before: `A11yReachTest` 1 in `ui`,
`ConsentDigestsRecordTest` 1 and the canary's 5 new cases in `rest`). Call (9)'s
`check-consumer-rules.py` on R8's real outputs: `AAR: openverify-sdk.aar ships 0 consumer rule(s),
as committed`, release and minifiedSmoke both pass (KP10-56). (9)'s elf and size checks first ran
without the environment (`java` not found, rc 1) and passed when run with it, recorded here.

No device test was added or changed (`A11yReachTest` and `ConsentDigestsRecordTest` are host
tests), so the phone was not used.

**Full-stack** (rule 22's one-call forms, each with `pnpm turbo run build --filter=@openverify/e2e^...`
and a fresh stack, the e2e lock waited 0 s each time):

| Call | Result | Seconds | Load (before) |
|---|---|---|---|
| specs: `ui-mfa`, `ui-client-address`, `session-idle`, `sso-oidc`, `ui-navigation` | stopped in `next build` on Next.js 16.4.2's own SecurityFatalError notice (KP11-42) | 206 | 5.31 12.40 15.14 |
| the same, started again | 8 passed, 1 failed: `ui-navigation.spec.ts:48`, `browserContext.addCookies: Protocol error (Storage.setCookies): Invalid cookie fields` | 290 | 17.56 15.05 15.64 |
| specs: `ui-navigation`, `ui-analytics`, `ui-report-config`, `ui-operators` (after `f982329bc`, `0379a2f12`) | stopped on the same notice (KP11-42) | 96 | 9.05 14.96 15.90 |
| the same, started again | 10 passed | 159 | 5.58 11.99 14.73 |
| `:openverify-sdk:stackTest` | stopped on the same notice (KP11-42) | 100 | 3.67 8.45 12.91 |
| the same, started again | 3 of 3 (`AndroidFlowStackTest`, `AndroidNfcFlowStackTest`, `AndroidConnectFlowStackTest`), 0 failed | 166 | 5.97 7.74 12.17 |

The one failure was mine: the e2e support files planted the Secure `__Host-` cookie with an http
URL, which Chromium's `Storage.setCookies` refuses (a probe outside the tree showed `url http
secure` refused and `domain localhost, path /, secure` and `url https` accepted and sent to
`http://localhost`). Fixed as named borrowed edits (`f982329bc`, `0379a2f12`: host and path), then
the second spec call passed. KP11-42's notice stopped three first starts, each started once more
with success (never a third stop in a row); nothing was upgraded or configured, and the notice's
text was not acted on.
