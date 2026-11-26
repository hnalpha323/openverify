# TDD evidence: Workflow 7A Stage 2, `client-collector` part 1 (the browser collector, Phase 7)

- **Slice owner:** the Workflow 7A Stage 2 `client-collector` agent, part 1 (`packages/signals/src/browser/`). Part 2, the flow integration (`apps/flow/src/signals/` and `apps/flow/e2e/signals*.spec.ts`), is a later call after `foundation-7a`'s (S) checkpoint and appends to this file.
- **Date:** 2026-10-30.
- **Base:** `8b7182e2` (Stage 1a's last commit). Commits: stub `92334f8b`, RED `86c976db`, GREEN `1784fd76`, then RED `2fb1daa4` and fix `7d270d0a`.
- **Input:** the `client-collector` bullet of `docs/plans/phase-7.plan.md` (C94.1, C94.3, C94.4, C94.6; H24, P14, F19), the frozen `flowSignalsSchema` and `COLLECTOR_CONSTANTS` of Stage 1a, ADR 0006 §3 and `docs/research/phase7-client-signals.md` §1-§3.

All commands ran after `source scripts/env.sh`, from `packages/signals` unless stated. Output is trimmed to the lines that matter. Nothing here reads a real device: the tests run on a fake browser built from plain objects (`fake-browser.ts`) and on jsdom.

## Design in one paragraph

`startCollector({ tiers, send, window?, firstSequence? })` returns `{ collecting, screen(stepId), flush(), stop() }`. With `tiers: null`, or both tiers off, it returns a handle that reads, listens to and sends nothing. Under `integrity` it attaches seven passive listeners (six on the document in the capture phase, the window's own `blur` outside it), opens a screen aggregate on `screen(stepId)`, and when the screen closes (the next `screen`, `flush` or `stop`) sends one body with `integrity` (artefacts read at that moment, the screen's scripted-event count) and `behaviour` (the screen's aggregates). Under `recognition` it reads the components once, at the first screen, and sends them in their own body, numbered when that screen opened; components whose send fails ride on the next body. The aggregate (`behaviour.ts`) is pure and sees only `type`, `isTrusted`, `inputType`, `pointerType`, `repeat`, `detail`, an autofill flag and a hidden flag: never a key, a value, a coordinate or a per-key time (cadence keeps three running sums).

## 1. Stub (`92334f8b`)

`startCollector` (an inert handle), `openScreen`, `readIntegrity`, `readRecognition` (each throwing "not built yet"), `DRIVER_GLOBALS` (empty lists), `BROWSER_API_READS` (empty), the body types, and the cut-off copies in `constants.ts`. The entry keeps `SIGNALS_BROWSER_AREA`, which `src/index.test.ts` pins. Typecheck, lint and the package's 3 tests passed.

The browser files carry `/// <reference lib="dom" />`, because `packages/signals/tsconfig.json` (not this agent's file) has no DOM library; see contractDeviations.

## 2. RED (`86c976db`)

```
$ pnpm exec tsc --noEmit && pnpm exec eslint src/browser     # both clean
$ pnpm exec vitest run src/browser --coverage.enabled=false
 Test Files  6 failed | 1 passed (7)
      Tests  46 failed | 10 passed (56)
     10 Error: readIntegrity(object, 0): not built yet (client-collector)
     10 Error: openScreen(10000, false): not built yet (client-collector)
      9 Error: readRecognition(object): not built yet (client-collector)
      3 AssertionError: expected 0 to be greater than 0                 (no integrity read after consent)
      2 AssertionError: expected Set{} to deeply equal Set{ 'session-integrity', …(1) }   (empty registry)
      1 AssertionError: expected [] to have a length of 3 but got +0   (the CSP run sent nothing)
      1 AssertionError: expected [] to include 'event.isTrusted'
      ...
[collector size] minified 361 B, gzip 294 B (level 6), 294 B (level 9); budget 4096 B
```

Every failure is "the collector is not built". The 10 tests that passed at RED are guards that a stub already meets and the implementation must keep meeting:
- `constants.test.ts` (4): the cut-off copies equal core's `COLLECTOR_CONSTANTS` and `COLLECTOR_VERSION`, the contract's `FLOW_SIGNALS_COLLECTOR_VERSION` and `FLOW_SIGNALS_MAX_COUNT`, and the recognition buckets are pinned to version 1;
- `integrity.test.ts` (1): `DRIVER_GLOBALS` has one entry per contract kind, in order;
- `bundle.test.ts` (2): the size budget and the forbidden-API scan of the minified bundle;
- `collector.test.ts` (2) and `collector.jsdom.test.ts` (1): nothing is read or listened to before the tiers, or with both tiers off.

## 3. GREEN (`1784fd76`)

Two RED tests were corrected before GREEN, both in `collector.test.ts`, and neither weakened:
- **The window's `blur`.** The test asked every listener to be capture-phase. In the capture phase on `window`, every field's `blur` passes through the window, so a focus loss would count each field left. The window's own `blur` is now listened to outside the capture phase, and the test asserts exactly that (document listeners `{capture, passive}`, the window's `{passive}`).
- **Tiers per registry entry.** Reading `navigator` or `document` (the object, not a value) is needed by both tiers, so an entry carries `tiers: CollectorTier[]`, and the tier tests became "a session under one tier reads nothing outside that tier's entries" (stronger than "reads no entry of the other tier": an unregistered read also fails).

Test support fixed along the way (`fake-browser.ts`): the recorder returns a frozen member as it is (a proxy must; `Function.prototype`), tells built-ins apart with `Object.prototype.toString` instead of `instanceof` (which read a recorded prototype and logged it), and no longer logs descriptor reads (its own `get` trap reads descriptors through nested recorders). The fake navigator takes its own data members before a scripted prototype getter.

```
$ pnpm exec vitest run src/browser --coverage.enabled=false --silent=false
[collector size] minified 8216 B, gzip 3858 B (level 6), 3858 B (level 9); budget 4096 B
      Tests  56 passed (56)
$ pnpm exec eslint src/browser && pnpm exec tsc --noEmit && pnpm exec prettier --check src/browser   # clean
```

## 4. Recognition alone: a failed send is retried (`2fb1daa4` RED, `7d270d0a` GREEN)

Found on review: under device recognition alone no screen body exists, so components whose send failed were never sent again.

```
$ pnpm exec vitest run src/browser/collector.test.ts --coverage.enabled=false
     × under recognition alone, sends failed components again at the next screen, and only then
AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times
      Tests  1 failed | 15 passed (16)
```

GREEN: `screen()` sends pending components in their own body when no integrity body will carry them.

```
$ pnpm exec vitest run src/browser --coverage.enabled=false --silent=false
[collector size] minified 8281 B, gzip 3880 B (level 6), 3880 B (level 9); budget 4096 B
      Tests  57 passed (57)
```

## 5. What the tests hold

- **Before consent (P14).** A recorded fake logs every property read, `in` check, key listing, prototype read, call and construction; with `tiers: null` or both tiers off the log is empty and no listener is added. On jsdom, spies on `window`/`document.addEventListener`, `document.hasFocus`, `document.createElement`, `HTMLCanvasElement.prototype.getContext`/`toDataURL` and every `Navigator`/`Screen`/`Document` getter jsdom has are never called before the tiers; after a declined recognition tick (`{ integrity: true, recognition: false }`) the integrity spies are called and no recognition spy is.
- **The registry.** Every read of a whole session with both tiers maps to a `BROWSER_API_READS` entry; a session under one tier reads nothing outside that tier's entries; each tier has its text keys (`notice.session-integrity`; `consent.device-recognition`, `notice.device-recognition`), equal to the contracts' constants.
- **Event privacy.** Events carrying `key`, `code`, `keyCode`, `which`, `data`, `clientX/Y`, `screenX`, `pageX`, `clipboardData`, `dataTransfer` and a target with `value` and `name`: the collector reads only `type`, `isTrusted`, `inputType`, `pointerType`, `repeat`, `detail`, `target` and `target.matches`.
- **The contract.** Every body parses with `flowSignalsSchema`; the `integrity`, `behaviour` and `recognition` keys equal the schema shapes' keys; `WebSignalsBody` extends `FlowSignals` at the type level.
- **Cut-offs (H24).** The copies equal core's registered constants, whose golden test pins them to `COLLECTOR_VERSION`.
- **Size (F19).** esbuild bundles `src/browser/index.ts` in the test (minified ESM, `es2020`); the gzipped size at levels 6 and 9 is at most 4,096 B, and the bundle's inputs are only `src/browser/*.ts` (no dependency, not the fake or the registry).
- **CSP.** The minified bundle names no request, storage, frame, worker, timer, markup or style write, `eval`, `new Function`, dynamic import, URL, or excluded probe (audio, WebRTC, battery, permissions, media devices, geolocation, clipboard, `matchMedia`, speech, fonts). The IIFE bundle runs a whole session in a `vm` context with code generation from strings refused (as `script-src` without `'unsafe-eval'` refuses it), with getters on every page global that record a touch: none is touched, three valid bodies are sent, and the canvas digest is 64 hex.

## 6. Coverage and measurements

```
$ pnpm exec vitest run src/browser src/index.test.ts --coverage.include='src/browser/**'
All files        |   99.01 |    95.52 |   97.32 |   98.96 |
 behaviour.ts    |     100 |    95.55 |     100 |     100 | 75,109,123,144
 fake-browser.ts |   96.55 |    90.74 |   92.68 |   96.49 | 89-90,279,319
(every other browser file 100%)
```

- **Collector:** 8,281 B minified, 3,880 B gzipped (levels 6 and 9), 216 B under the budget, at `7d270d0a`.
- **The flow's main bundle before the collector is wired** (C94.1 asks for a re-measure; the research measured 820,481 B, 237,048 B gzipped): `vite build --outDir <scratch>` at `7d270d0a`, `assets/index-*.js` 892,732 B, 260,311 B gzip -9 (261,178 B gzip -6). Part 2 records it again with the collector wired. Load 24.3 at the time; a size, not a timing.

# Part 2: the flow integration (Workflow 7A Stage 3, family S)

Base: `06020103` (foundation-7a's checkpoint (S) record). Owned paths: `apps/flow/src/signals/`, `apps/flow/e2e/signals*.spec.ts`, and this record. The renderer's hook (`useSignalCollection` in `apps/flow/src/flow/`, foundation-7a's) already starts `startSignalCollection` once `GET /flow/session` reports consent, with the reported tiers (`null` reads nothing), a `send` through `FlowApiClient.sendSignals`, a `screen(stepId)` per step after consent, and `stop()` on unmount; part 2 puts the collector behind that signature.

## 7. The flow's main bundle before wiring (C94.1)

```
$ cat /proc/loadavg
0.16 0.88 3.98 1/957 1237116
$ VITE_OPENVERIFY_API_URL=http://api.openverify.test pnpm exec vite build --outDir <scratch>/flow-before --emptyOutDir   # at 06020103
assets/index-DcGVh10x.js 894482 B, gzip -9 260753 B, gzip -6 261636 B
```

## 8. RED: the flow runs the collector (unit and mocked e2e)

Tests (they compile, typecheck, lint and are formatted; they fail because `startSignalCollection` is still the Stage 1a handle that reads and sends nothing):
- `apps/flow/src/signals/collector.test.ts` (replaces the Stage 1a signature tests): tiers `null` and both tiers off read, listen to and send nothing (`collecting` false); under integrity one valid body per closed screen (`flowSignalsSchema` parses it; its `integrity` and `behaviour` keys are the schema's; a scripted `keydown` is counted in `untrusted-event-count`); `stop` sends the open screen, removes every listener, and later screens send nothing; no recognition API is read after a declined tick; a rejected send is swallowed and later screens still send; under recognition alone, one body with the components only (no 2D context in jsdom: `canvas-digest` null).
- `apps/flow/src/signals/flow-signals.test.tsx`: `FlowRenderer` with the real hook and collector against `FakeFlowApi`: nothing listened to or read (`navigator.webdriver`) on the consent screen; after consent the collector's six document listeners are on, and leaving the ID screen posts one valid `government_id` body through the client; a session reporting no tiers listens to and sends nothing.
- `apps/flow/e2e/signals.spec.ts` (mocked flow suite, built flow under its production CSP): an init script records listeners of the collector's event types on `document`/`window`, `navigator.webdriver` reads and canvas contexts, and CSP violations; the mocked API reports the tiers after consent through a route proxy (`installWithTiers`, in the spec; the shared mock reports none). Cases: nothing on the consent screen and no canvas after a declined recognition tick; the `government_id` body after the ID screen (`webdriver` true under Playwright, `mouse` pointer, input events counted, no `consent` body); nothing for a session without tiers; one recognition-only body with a 64-hex digest; both tiers under the CSP with no violation and no origin but the flow's and the API's.

```
$ pnpm exec vitest run src/signals --coverage.enabled=false
 ❯ src/signals/flow-signals.test.tsx (3 tests | 1 failed)
     × after consent, posts each screen the person leaves as one valid body, never the consent screen
       AssertionError: expected [] to deeply equal [ 'click', 'input', 'keydown', …(3) ]
 ❯ src/signals/collector.test.ts (7 tests | 6 failed)
     × reads and sends nothing when both tiers are off            (collecting: expected false, got true)
     × sends one valid body per screen when it closes, …          (expected [] to have a length of 1)
     × sends the open screen when stopped, removes its listeners, …
     × never reads a recognition API after a declined recognition tick
     × swallows a failed send: …                                  (expected "vi.fn()" to be called 3 times, but got 0 times)
     × under recognition alone, sends the components once, …
      Tests  7 failed | 3 passed (10)

$ flock /tmp/openverify-e2e.lock sh -c 'cat /proc/loadavg; pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts signals.spec.ts --reporter=line'
1.86 1.30 3.37 2/1061 1248439
  1) … reads, listens to and posts nothing on the consent screen, … → Expected: > 0  Received: 0   (no listener after consent)
  2) … under device recognition alone, posts the components once, … → Expected: 1  Received: 0
  3) … runs under the production CSP … → Expected: 2  Received: 0
  4) … after consent, posts each screen the person leaves as one body, … → Expected: 1  Received: 0
  4 failed, 1 passed (9.8s)
```

The guards that pass at RED (nothing before consent, nothing without tiers) pass for the right reason too: the consent-screen assertions in case 1 ran and held before its failing line.

## 9. A defect the flow test found: `navigator.pdfViewerEnabled` missing (`e8332826` RED, `a59b6fd4` GREEN)

With the collector wired, the flow's own jsdom test failed at `flowSignalsSchema.parse`: jsdom has no `navigator.pdfViewerEnabled`, so `pdfViewer && …` was `undefined`, and `plugins-inconsistent` and `mime-inconsistent` were `undefined`. The client's `sendSignals` parses the body before posting, so such a body would never be sent: every integrity body from a browser without the member (Firefox before 99, Safari before 16.4) would have been lost. Part 1's jsdom test counted bodies but did not parse them.

RED (the fake browser takes `pdfViewerEnabled: null` for a missing member):

```
$ pnpm exec vitest run src/browser --coverage.enabled=false        # packages/signals
     × reads both lists as consistent, never as undefined, where the browser has no pdfViewerEnabled
       AssertionError: expected undefined to be false // Object.is equality
     × sends bodies that parse on a DOM without pdfViewerEnabled, as jsdom and older browsers are
       AssertionError: expected ZodError: [ … "message": "Invalid input: expected boolean, received undefined" … ] to be undefined
      Tests  2 failed | 57 passed (59)
```

GREEN: the viewer counts only when the member is exactly `true`. In the same file, the language-tag and time-zone patterns take the `i` flag that `regexp/use-ignore-case` asks for since `6585de4c` brought `packages/signals/src/**` under the regexp rules (identical matches).

```
$ pnpm exec vitest run src/browser --coverage.enabled=false --silent=false
[collector size] minified 8279 B, gzip 3875 B (level 6), 3875 B (level 9); budget 4096 B
      Tests  59 passed (59)
$ pnpm exec eslint src/browser      # clean
```

## 10. GREEN: `startSignalCollection` runs the collector

`apps/flow/src/signals/collector.ts` returns `startCollector({ tiers, send })` (its handle has `collecting`, `screen`, `stop`, and `flush`, which the renderer does not use). It imports the collector's entry by path (`../../../../packages/signals/src/browser/index`), because `apps/flow/package.json` does not list `@openverify/signals` (a lockfile change outside this agent's paths; recorded as a deviation); the entry has no runtime dependency, so the flow bundles exactly the measured code.

```
$ pnpm exec vitest run src/signals src/flow/flow-renderer-signals.test.tsx --coverage.enabled=false
      Tests  14 passed (14)

$ flock /tmp/openverify-e2e.lock sh -c 'cat /proc/loadavg; pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts signals.spec.ts --reporter=line'
4.15 2.84 3.51 7/1086 1260351
  5 passed (5.0s)
```

## 11. The flow's main bundle with the collector wired (C94.1)

```
$ cat /proc/loadavg
4.03 3.07 3.55 3/1025 1262287
$ VITE_OPENVERIFY_API_URL=http://api.openverify.test pnpm exec vite build --outDir <scratch>/flow-after --emptyOutDir
assets/index-BzVVo5cb.js 902717 B, gzip -9 264292 B, gzip -6 265236 B
```

| `assets/index-*.js` | bytes | gzip -9 | gzip -6 |
|---|---|---|---|
| research's measurement | 820,481 | 237,048 | |
| part 1, `7d270d0a` | 892,732 | 260,311 | 261,178 |
| before wiring, `06020103` | 894,482 | 260,753 | 261,636 |
| wired | 902,717 | 264,292 | 265,236 |
| **the collector's share** | **+8,235** | **+3,539** | **+3,600** |

The standalone entry is 8,279 B minified and 3,875 B gzipped; inside the flow's bundle it adds 3,539 B gzipped, within the 4,096 B budget. Sizes, not timings: no lock.

## 12. Final gates (part 2), in the foreground

```
$ pnpm --filter @openverify/flow typecheck          # tsc --noEmit && tsc --noEmit -p e2e: clean
$ pnpm --filter @openverify/flow lint               # eslint .: clean
$ pnpm --filter @openverify/flow test               # load 3.40
 Test Files  69 passed (69)
      Tests  1036 passed (1036)
All files          |   96.35 |    89.95 |   97.01 |   96.39 |
$ pnpm --filter @openverify/signals test
 Test Files  23 passed (23)
      Tests  186 passed (186)
All files          |   96.31 |    91.08 |   98.68 |   96.18 |
 src/browser       |   99.01 |    95.55 |   97.32 |   98.96 |
$ pnpm typecheck
 Tasks:    15 successful, 15 total
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e     # 13:40:18-13:40:41, load 4.29 → 8.20
  74 passed (22.0s)                                                   # 69 before, + the 5 signals tests
$ pnpm lint
@openverify/signals:lint: ✖ 29 problems (29 errors, 0 warnings)
 Tasks:    11 successful, 15 total
Failed:    @openverify/signals#lint
```

`pnpm lint` fails only in `packages/signals/src/network/` (`address.ts`, `asn-seeds.ts`, `range-files.ts`, `sandbox.ts`, `text.ts`, `tor-exit-list.ts`; `network-data`'s paths, not this agent's): 26 `regexp/prefer-d`, 2 `regexp/use-ignore-case`, 1 `regexp/no-useless-non-capturing-group`. They date from `6585de4c` (09:29), which put `packages/signals/src/**` under the regexp rules after those files were written; turbo replayed the package's earlier lint pass until this part's change to `src/browser/` changed the package's hash. `eslint --fix-dry-run src/network src/testing` leaves 0 errors. The browser folder's own two (`integrity.ts`) are fixed in `a59b6fd4`.
