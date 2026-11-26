# Workflow 9D, fix-flow: TDD evidence

Agent: `fix-flow` (Workflow 9D Stage 4a), beside `fix-builder` and `fix-console`. Paths: `apps/flow/` (its `e2e/` and locales included), `packages/flow-spec/`, `packages/sdk-js/`, `packages/ui/`, this file. Base: `ef70cead`. Every command below ran after `source scripts/env.sh`; loads are `cat /proc/loadavg`'s first three figures.

Re-verified against the code before the first commit (Handover to 9D and the orchestrator decisions before 9D):

- `apps/flow/e2e/theme-csp.spec.ts` asserted `violations()` equal to `[]` in each of its five tests; `recordViolations` kept only `violatedDirective` and `blockedURI`.
- `apps/flow/src/theme/apply.ts:7-8` and `apply.test.ts:4-5` named the root's inline style (CI 42331362147) as WebKit's cause, which decision 9 withdraws.
- `apps/flow/e2e/playwright.config.ts` keeps WebKit only when it starts, or when `OPENVERIFY_FLOW_E2E_ENGINES` names it (S9C-2).
- `apps/flow/src/steps/contest-route-words.ts:13`: `Record<'en' | 'es', ContestRouteWords>` (K9-33 open).
- `apps/flow/src/flow/json-logic.ts` and its test are still in the tree (K9-34 open).
- `apps/flow/server.ts:764`: `createReadStream(path).pipe(res)` with no error listener (R005).

## K9-35 (HIGH): WebKit's own `style-src-attr` report for a native `<select>`

The WebKit runs use Playwright's browser server in Docker (decision 3 before 9D), through a scratch wrapper that starts `mcr.microsoft.com/playwright:v1.64.1-noble` as `openverify-webkit-fix-flow` (`run-server --port 3555`, bound to 127.0.0.1), waits for "Listening on", runs `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3555/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' OPENVERIFY_FLOW_E2E_ENGINES=webkit pnpm --filter @openverify/flow e2e --project=webkit <args>`, and always ends with `docker rm -f openverify-webkit-fix-flow`. Each run held a heavy slot and the e2e lock: `bash /tmp/openverify-heavy.sh flock -E 75 -w 60 /tmp/openverify-e2e.lock <wrapper> <args>`.

### RED: the spec at `ef70cead`, exactly as CI 42382549247 failed

`<wrapper> theme-csp.spec.ts` (load 1.53 before, 2.94 after; 18 s): exit 1.

```
  5 failed
    [webkit] › e2e/theme-csp.spec.ts:53:1 › applies a theme set’s palette and radius with no CSP violation
    [webkit] › e2e/theme-csp.spec.ts:74:1 › follows prefers-color-scheme under auto, and its change
    [webkit] › e2e/theme-csp.spec.ts:86:1 › lets style-variant force the dark variant of a theme that has one
    [webkit] › e2e/theme-csp.spec.ts:98:1 › shows the built-in dark palette for style-variant=dark with no theme set
    [webkit] › e2e/theme-csp.spec.ts:110:1 › keeps the built-in light tokens with no theme and no variant
    - Array []
    + Array [
    +   "style-src-attr inline",
    + ]
```

### The change (spec only; no CSP, no flow code, no `<select>` change)

- `recordViolations` now records each report's directive, blocked value, target `nodeName` and sample.
- `engineBaseline(page, baseURL)` opens a second page in the same context on `/__csp-control` of the flow's origin, fulfilled by `route.fulfill` with `Content-Security-Policy: buildContentSecurityPolicy({ apiOrigin: API_ORIGIN })` (the builder and API origin of the build under test, so they never drift) and a script-free body holding one labelled native `<select>`; its reports are the baseline.
- Each of the five tests ends with `expectNoViolationBeyondBaseline`: every report of the flow page must match a baseline entry (same directive, blocked value and target, empty sample); `beyondBaseline` lists the rest, and that list must be empty.
- New test "pins the engine baseline": empty in Chromium and Firefox; in WebKit every entry equals `{ style-src-attr, inline, SELECT, '' }` and there is at most one. The allowance in the five tests is never keyed on the engine's name, only on what the control page measured.
- New test "counts a report beyond the baseline": `beyondBaseline` keeps a report on another element, one with a sample, another directive, and anything when the baseline is empty.
- The comments of `apply.ts` and `apply.test.ts` no longer name the root's inline style as WebKit's cause (decision 9); the spec header, `playwright.config.ts` and the new `apps/flow/e2e/README.md` hold the Docker recipe.

### A second, separate defect the Docker runs exposed: the media change test under load

`<wrapper> theme-csp.spec.ts --repeat-each=5` with the change above (load 1.60 before, 15.53 after; 53 s): exit 1, 34 passed, 1 failed: "follows prefers-color-scheme under auto, and its change", `expect.poll(--color-surface).toBe('#ffffff')` received `#101828` after 5 s. `--repeat-each=20 -g "follows prefers"` (load 9.59 before, 11.82 after; 46 s): exit 1, 14 passed, 6 failed, the first test of each of the six workers (a cold remote browser).

Instrumented once (not committed), 2.5 s after `emulateMedia({ colorScheme: 'light' })`: `matchMedia('(prefers-color-scheme: dark)').matches` was already `false` in every run, but the theme rule still held the dark surface in 6 of 8 runs. The `change` event is fired in the page's next rendering update, which an idle headless WebKit can hold back for seconds; the flow repaints on that event, as it should (a scratch page in the same server showed the event arriving within 1.5 s when idle). The test now calls `settle(page)` (two animation frames and a task) after the media change, so the event is due before the poll; no assertion and no timeout changed.

### GREEN

- `<wrapper> theme-csp.spec.ts --repeat-each=20 -g "follows prefers"` (load 5.70 before, 17.07 after; 47 s): exit 0, 20 passed.
- `<wrapper> theme-csp.spec.ts --repeat-each=5` (load 14.76 before, 18.74 after; 58 s): exit 0, 35 passed (7 tests x 5).
- Chromium and Firefox here: `flock -E 75 -w 60 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e theme-csp.spec.ts --repeat-each=3` (load 18.50 before, 20.72 after): exit 0, 42 passed (7 tests x 3 x 2 engines).

Commits: `77956b26` (the spec), `1c76ec94` (comments, recipe, this record).

## R005 (HIGH): the flow server's file streaming

RED (`d7214571`): new `apps/flow/src/server/server-streaming.test.ts` (node environment, a real socket, a 64 MiB asset in a temporary `dist/`; `node:fs`'s `createReadStream` wrapped so the test sees each stream the server opens and can hand it one that fails after one chunk).

`pnpm --filter @openverify/flow exec vitest run src/server/server-streaming.test.ts --coverage.enabled=false` (load 5.07): exit 1.

```
 × closes the file’s stream when the client drops the connection mid-download 5029ms
     AssertionError: expected false to be true   (stream.closed, polled for 5 s after the socket was destroyed)
 × cuts the answer and logs the failure when the read fails, and keeps serving 7ms
     AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
       [Error: synthetic read failure], "uncaughtException"
 Tests  2 failed (2)
```

(A first draft of the second test waited for the socket to close and hung for its 60 s guard, because `pipe` never ends the answer after a source error; it now races the close against the uncaught exception.)

GREEN (`1313b621`, after the test refinement `240675cb`): `file()` opens the file with `fs.promises.open` before any header (an open failure is the handler's 500), takes the length from the opened handle, closes it on HEAD, and streams `createReadStream(path, { fd: handle })` through `stream.pipeline` to the response. `pipeline` destroys the read stream (closing the descriptor) when the client goes away, and destroys the response on a read error, which is logged once as `{ entry: 'error', status: 500 }`; a client that left (`ERR_STREAM_PREMATURE_CLOSE`, `ECONNRESET`, `EPIPE`) is not logged as an error.

- The refinement: on a read failure Node may destroy the socket before the buffered head is flushed, so the client sees either nothing or a head with fewer body bytes than its Content-Length (never the whole file); and a new test sends the whole 64 MiB file and asserts the log holds only its 200 and the stream closes.
- A first GREEN draft read `error.code` in the pipeline callback without checking for `undefined`: Node 22 passes `undefined`, not `null`, on success, and the server suite failed with 6 unhandled `TypeError`s (exit 1). The callback now checks both, and its comment says why.
- `pnpm --filter @openverify/flow exec vitest run src/server/ --coverage.enabled=false`, twice (load 4.90): exit 0, 4 files, 49 tests.

## K9-33 (MEDIUM, known): the contest route's words in five locales

RED (`9c15f751`): `outcome-screens.test.tsx` gains "speaks fr / de / ar in its own words on the terminal screen" (the section's name and the link's name are that language's words, no English framing word on the page) and "isolates the host and the contact, each in its own direction (C161.3)".

`vitest run src/steps/outcome-screens.test.tsx`: exit 1, 4 failed, 12 passed.

```
Unable to find an accessible element with the role "region" and name "Demander un réexamen"
Unable to find an accessible element with the role "region" and name "Überprüfung anfordern"
Unable to find an accessible element with the role "region" and name "طلب مراجعة"
Unable to find an element with the text: contest.example.com.
```

`5a1e293c` corrects the RED test's English check: it looked for any text holding "review", which the route's own contact (`review@example.com`) holds; it now looks for the English framing words.

GREEN (`a2fb8a6a`): `src/steps/contest-route-words.ts` (en and es only) is removed. The five catalogs gain `contest.heading`, `.intro`, `.host` (`{{host}}`), `.link` and `.contact` (`{{contact}}`), machine-drafted like the rest of each non-English catalog (`LOCALE_REVIEW_STATUS` unchanged: es, fr, de and ar `machine-drafted`); French puts its no-break space before the colon, and the Arabic is MSA with no gendered imperative. `ContestRoute` reads them with `t` and draws the host and the contact through `useIsolatedT`, so each is in its own `<bdi>`. No plural applies. The locale exports were regenerated by the flow's own `pnpm --filter @openverify/flow i18n:export` (borrowed: `contracts/fixtures/i18n/{en,es,fr,de,ar}.json`, generated, not hand-edited; the catalog version `web-03a9d4e06ed93f3e` and `consent-texts.json` are unchanged, since no consent or notice text changed).

- `vitest run src/i18n src/steps/outcome-screens.test.tsx src/flow/flow-renderer-contest-route.test.tsx src/flow/flow-renderer-phase9.test.tsx`: exit 0, 19 files, 256 tests (the locale-export `--check` test included).
- `apps/api`: `vitest run src/services/templates/preview.test.ts` (reads `en.json`): exit 0, 16 tests.

## K9-34 (LOW, known): `json-logic.ts` removed

`git grep -n "json-logic"` in `apps/flow` and `packages`: only `json-logic.test.ts` imported `./json-logic`; two comments in `packages/flow-spec` named the file. `22ea1f14` removes both files and updates the comments of `packages/flow-spec/src/v2/migrate.ts` and `test-v1-walk.ts` (now the only copy of the v1 rules, for C151.3's equivalence test). `tsc --noEmit` in `apps/flow` and `packages/flow-spec`: exit 0. A refactor with no behaviour change, so no RED; the coverage gate and R007's test below hold.

## R007 (MEDIUM): no test that the client bundles lack the evaluator

`c787aa27`: new `apps/flow/src/client-bundles.test.ts`. Markers: `expression_clock_missing` and `expression_conversion_failed`, error codes only `packages/workflow-engine` raises. A virtual entry importing `evaluateFlowCondition` (by path; the flow does not depend on the engine) is built first and must carry both, so their absence means something; then the hosted flow with its preview entry (`index.html`, `preview.html`, over 100,000 characters of script) and `@openverify/js` (through its own `vite.config.ts`, ESM and IIFE) must carry neither. Builds write nothing (`write: false`).

`vitest run src/client-bundles.test.ts` (load 2.72): exit 0, 3 tests in 1.8 s. It passed at once: the property already held, and the finding was the missing proof. The control test is what shows it can fail.

## Final checks (fix-flow, beside fix-builder and fix-console)

Each call's exit code read from the command itself; output in files, never through a pipe.

| Call                                                                                                                                             | Exit | Result                                                                                                                    | Time, load           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `pnpm --filter @openverify/flow test`                                                                                                            | 0    | 125 files, 1,490 tests; statements 94.75%, branches 88.01%, functions 95.61%, lines 95.03%                                | 204 s, 2.54 to 9.63  |
| `pnpm --filter @openverify/flow-spec test`                                                                                                       | 0    | 23 files, 432 tests; statements 96.27%, branches 87.52%                                                                   | 9 s                  |
| `pnpm --filter @openverify/js test` (the 6 KB size budget included)                                                                              | 0    | 4 files, 19 tests                                                                                                         | 7 s                  |
| `pnpm --filter @openverify/ui test`                                                                                                              | 0    | 8 files, 55 tests; statements 100%, branches 97.72%                                                                       | 8 s, 7.99            |
| `pnpm turbo run lint typecheck --force --filter=@openverify/flow --filter=@openverify/flow-spec --filter=@openverify/js --filter=@openverify/ui` | 0    | 8 of 8 tasks                                                                                                              | 119 s, 7.67 to 6.12  |
| `pnpm exec prettier --check` on every touched source and fixture file; `--ignore-path=.gitignore` on the two Markdown files                      | 0    | clean                                                                                                                     |                      |
| `flock -E 75 -w 60 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` (the mocked suite)                                               | 0    | 328 passed (324 before plus the two new theme-csp tests in Chromium and Firefox); WebKit skipped here as S9C-2 configures | 232 s, 5.19 to 22.43 |
| Docker WebKit, `theme-csp.spec.ts --repeat-each=5`                                                                                               | 0    | 35 passed                                                                                                                 | 58 s, 14.76 to 18.74 |

Full-stack, the specs this Workflow's changes exercise (the flow server streams every asset; `flow-arabic` reads `contracts/fixtures/i18n/ar.json`), as one call holding the e2e lock: `flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/flow-embed.spec.ts tests/flow-bundle.spec.ts tests/flow-arabic.spec.ts; ..."`.

- First call (load 19.14): exit 1 before any test. `next build` failed type-checking `apps/dashboard/src/components/workflows/editor/condition-model.ts:177`, fix-builder's work in flight at that moment; at HEAD a few minutes later the file was clean.
- Second call (load 4.34 before, 4.68 after; 244 s): **exit 1, 3 passed, 1 failed.** `flow-bundle.spec.ts` "the built flow runs a whole verification without a CSP violation or a request outside its own and the API origins (C46.1)" timed out after 90 s waiting for "Verification submitted". The page showed the selfie step at "Attempt 2 of 3" with "We could not use your last photos: Look straight at the camera for the first photo". The three photos were taken with the auto shutter (the spec's own check of `['auto', 'auto', 'auto']` passed, so the guidance model and its WebAssembly were streamed and ran), and the vision service rejected the first photo's pose. The flow server's log holds only `{"entry":"asset","status":200}` lines (17), with no `error` entry. The two `flow-embed` tests and `flow-arabic` passed.
- Diagnosis only, not counted as the gate: the same call with `tests/flow-bundle.spec.ts` alone (load 4.28 before, 6.40 after; 132 s) exited 0, the test passing in 20.1 s against 1.8 min in the failed run. So it fails beside other specs under load and passes alone: the pose of the synthetic camera frame the auto shutter catches depends on timing. The spec, its camera fixture and the vision service are outside fix-flow's paths, so it goes to fix-api and validation-9d to make deterministic, test-first, as the rules require; nothing here retried it into a pass, and this gate is reported failed by that test.
