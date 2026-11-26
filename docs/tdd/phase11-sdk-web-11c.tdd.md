# Phase 11, Workflow 11C: sdk-web-11c (family W, C266)

Owner: `sdk-web-11c` (Stage 2). Paths: `packages/sdk-react/`, `apps/demo-web/`, the publish fields of
`packages/sdk-js/package.json` and `packages/node/package.json` (named borrowed edits), their READMEs
and tests. Plan: C266, C285 (Q4), amendment items 19 and 20 of "Workflow 11C Stage 1a amendments".

## 0. Continuation after the stop at 98% weekly usage (2026-11-14 15:17 EST)

The first run stopped cleanly at `f33b7783c`. Its commits (`git log 2a83a93e7..HEAD`) are kept and
nothing committed was redone:

| Commit | Step |
| --- | --- |
| `ade20fd74` | stub: the frozen names of `@openverify/react` (`useOpenVerify`, `OpenVerifyFlow`, `OpenVerifyState`, `INITIAL_OPEN_VERIFY_STATE`), each failing "not built" |
| `608311fa7` | RED: 21 failing tests (`use-open-verify.test.tsx`, `open-verify-flow.test.tsx`); `passWithNoTests` removed |
| `50eb6bea1` | GREEN: the hook and the component (21 tests, 97.6% statements) |

The first run wrote no evidence file; sections 1 and 2 are rebuilt from those commits' messages and
diffs, never from invented output. Its uncommitted work (the pack tool's stub
`packages/sdk-react/scripts/pack-release.ts`, its test support `scripts/test-build.ts`, the
`tsconfig.json` and `vitest.config.ts` lines that take `scripts/` in, and
`apps/demo-web/e2e/{playwright.config.ts,tsconfig.json}`) was reviewed with `git diff` and is finished
test-first below.

## 1. `@openverify/react` (C266.2): stub and RED (from `ade20fd74`, `608311fa7`)

- The stub exported the frozen names, each throwing "not built yet (sdk-web-11c)", so the tests
  compiled and type-checked.
- RED (commit message, as recorded): "useOpenVerify and <OpenVerifyFlow> mount the embed in their
  element, keep only the embed's own events as state, call the newest handlers without mounting
  again, mount again on a new inquiry, remove the frame on unmount, and turn refused options into an
  error state (21 failing; passWithNoTests removed)".

## 2. `@openverify/react`: GREEN (from `50eb6bea1`)

- `useOpenVerify(options)` returns `{ ref, state }`; the state is only the embed's own events:
  `mounting`, `loaded`, `ready`, `complete` (a hint, C159.6), `cancelled`, `error`; refused options
  become `error` with `invalid_config`. The newest handlers are read from a ref, so a new handler
  mounts no new frame; the frame is mounted again only when what identifies it changes.
- `<OpenVerifyFlow>` renders one container `div` (id, class, style) over the hook.
- Recorded result: 21 tests passed, 97.6% statements.

## 3. The release pack tool (C266.1, C266.4, C266.5, C285.1)

Decision (amendment item 19 left it to this area): `@openverify/node` runs on the private
`@openverify/contracts`, which runs on the private `@openverify/core` and `@openverify/flow-spec`.
Rather than publishing three more packages, the release vendors the built modules of that private
closure into the packed package (`dist/vendor/<folder>/`), copying only the modules its exports reach
and rewriting their specifiers; their published dependencies (`zod`) become the packed package's.
The workspace manifests keep `private: true` (the conventions test, and a guard against a
`pnpm publish` from the workspace that would ship the source condition); the packed manifest is
written by the tool, without `private`, scripts, dev dependencies or the `@openverify/source`
condition, with the release version, `@openverify/js` pinned to it, and `publishConfig.provenance`.
The tool stages each package in a temporary directory, runs `pnpm pack` there, then reads the
tarball back and refuses any file but `package.json`, `README.md`, `LICENSE` and `dist/**/*.{js,d.ts}`.

Stub: `33138bba0` (the frozen names, each "not built").

RED (`packages/sdk-react/scripts/pack-release.test.ts`, synthetic workspaces in temporary
directories; `scripts/pack-real.test.ts`, the three real packages built fresh into a temporary
directory through `scripts/test-build.ts`):

```
$ cat /proc/loadavg
4.06 3.84 2.33 10/1060 1931364
$ pnpm exec vitest run scripts --coverage.enabled=false      (packages/sdk-react; rc=1)
     × is removed at every depth and nothing else is
     ... (every synthetic case)
     × prints each tarball with its digest and file list, and answers 1 or 2 when it cannot
 ❯ scripts/pack-real.test.ts (4 tests | 4 skipped) 25056ms
 Test Files  2 failed (2)
      Tests  29 failed | 1 passed | 4 skipped (34)
Error: workspacePackages(/tmp/openverify-pack-test-...) is not built yet (sdk-web-11c)
Error: stageModules(...) is not built yet (sdk-web-11c)        (and each other stub: 31 "not built yet")
```

Every failure is a stub's "not built yet" (the real packages' hooks built all six packages, 25 s, and
failed at `packRelease`); the one pass is the frozen `PUBLISHABLE_PACKAGES` list.

GREEN (`packages/sdk-react/scripts/pack-release.ts`; the publish fields as named borrowed edits):

- The synthetic cases passed first (`vitest run scripts/pack-release.test.ts`: 30 passed). One
  RED expectation was corrected, not weakened: the README case's synthetic workspace has no
  `LICENSE` at its root either, so the tool names both missing files
  (`'LICENSE is missing (neither the package nor the repository root has one)'` added beside
  `'README.md is missing'`).
- The real packages then failed for the intended reason, their manifests' missing publish fields:

```
$ pnpm exec vitest run scripts/pack-real.test.ts --coverage.enabled=false     (rc=1)
PackRefusedError: @openverify/js cannot be packed:
- license must be "Apache-2.0" (the repository licence), not "undefined"
- sideEffects must be false
- publishConfig.provenance must be true
(the same for @openverify/react and @openverify/node)
```

- Publish fields added to `packages/sdk-js/package.json`, `packages/node/package.json` (named
  borrowed edits, no dependency changed) and `packages/sdk-react/package.json`: `license`
  `Apache-2.0`, `sideEffects: false`, `files: ["dist"]`, `publishConfig: { access: "public",
  provenance: true }`; `@openverify/js` also exports `./openverify.iife.js` (the script-tag build)
  and names it as `unpkg` and `jsdelivr`. `private: true` stays in each workspace manifest
  (`workspace-conventions.test.ts` holds it; the packed manifest has none). READMEs: new
  `packages/sdk-js/README.md` and `packages/sdk-react/README.md`, and `packages/node/README.md`
  gains "This package is a client. The server decides every step" and an Installing section (from a
  packed tarball or from source; no registry is named, C285.3, C285.4).

```
$ cat /proc/loadavg
5.94 4.73 3.11 4/881 1963353
$ pnpm exec vitest run scripts/pack-real.test.ts --coverage.enabled=false     (rc=0)
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- The whole script with coverage first failed in the contracts' emit hook ("Hook timed out in
  60000ms", 117 s for the file): the TypeScript compiler ran inside the coverage-instrumented
  worker. The guard was not raised; `scripts/test-build.ts` now runs the emit in a child Node
  process (uninstrumented). The eslint-plugin-security rules, which landed meanwhile, warned on two
  regular expressions and one `require` of a computed path; both were rewritten (no suppression).

```
$ cat /proc/loadavg
5.52 5.17 3.63 2/740 1990372
$ pnpm exec vitest run --coverage.reportsDirectory=<tmp>/cov      (packages/sdk-react; rc=0)
 Test Files  4 passed (4)
      Tests  55 passed (55)
   Duration  53.38s
All files          |   96.18 |    89.86 |   94.18 |   96.03 |
  pack-release.ts  |   95.94 |    89.62 |   92.95 |   95.77 |
  test-build.ts    |     100 |       50 |     100 |     100 |
$ node packages/sdk-react/scripts/pack-release.ts        (Node 22.22.1 type stripping; rc=2)
usage: pack-release.ts --out <dir> [--version <x.y.z>] <package dir>...
```

## 4. `apps/demo-web` (C266.3): the sample customer site

Shape: a Vite page (`index.html`, `src/page/`) and a small `node:http` server (`src/server/`) that
Node 22.18+ runs from source by type stripping (`node src/server/main.ts`, after `@openverify/node`
is built). The server holds the API key, creates an inquiry and its session for the page, receives
the API's webhooks and verifies each with `@openverify/node`, keeps only the inquiry id, status and
event name, and serves the built page. The page embeds the flow with `<OpenVerifyFlow>` (over
`@openverify/js`), treats the flow's completion as a hint, and shows the result its server got from
a verified webhook or from the API.

Stub commit: the frozen names (`readDemoConfig`, `DemoConfig`, `DemoConfigError`,
`DEMO_DEFAULT_LISTEN`, `createDemoHandler`, `startDemoServer`, `DemoResult`, `App`), each failing
"not built", the page's `index.html`, `src/page/main.tsx`, `vite.config.ts`, the `tsconfig.json`
(`allowImportingTsExtensions`, since Node runs the server's `.ts` imports as written), the e2e
`tsconfig.json` (its `@playwright/test` path is the e2e package's own copy, so no dependency is
added), and the scripts `start`, `e2e` and a `typecheck` that also checks `e2e/`. Stage 1a's
`src/index.ts` placeholder is removed. `passWithNoTests` stays until the RED commit.

RED (`src/server/config.test.ts`, `src/server/app.test.ts` against a fake API through the
client's injected `fetch`, `src/page/app.test.tsx` with `@openverify/react` mocked; `passWithNoTests`
removed; and the Playwright spec `e2e/demo.spec.ts` against `e2e/fake-openverify.ts`, a fake API
and a fake flow page speaking the embed protocol on loopback ports):

```
$ cat /proc/loadavg
5.32 5.72 4.56 3/757 2051874
$ pnpm exec vitest run --coverage.enabled=false        (apps/demo-web; rc=1)
     × reads every setting from the environment, with the default listen address
     ... (18 cases)
 Test Files  3 failed (3)
      Tests  18 failed (18)
Error: readDemoConfig(5, /srv/demo) is not built yet (sdk-web-11c)
Error: startDemoServer(127.0.0.1) is not built yet (sdk-web-11c)
Error: App(5) is not built yet (sdk-web-11c)
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/demo-web...; pnpm --filter @openverify/demo-web e2e'
build=0 (7 tasks, 41 s)
  ✘  1 [chromium] › ../apps/demo-web/e2e/demo.spec.ts:85:1 › verifies through the embedded flow and shows the result its server verified
    Error: the sample server exited (1):
    Error: the sample site is not built yet (sdk-web-11c)
  1 failed
```

The first e2e attempt failed earlier, for a harness reason: the config imported `defineConfig`
from `@playwright/test`, which the e2e `tsconfig.json`'s directory mapping resolves, at run time,
to the package's CommonJS entry ("does not provide an export named 'defineConfig'"). The config now
imports only types, and the `e2e` script passes `--tsconfig e2e/tsconfig.runtime.json`, which maps
`@playwright/test` to the copy's ES module for Playwright's loader, while `e2e/tsconfig.json` keeps
the mapping TypeScript and ESLint read the types through.

GREEN (`src/server/config.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/page/app.tsx`,
`README.md`):

```
$ cat /proc/loadavg
5.29 9.57 7.84 4/1449 2085263
$ pnpm exec vitest run --coverage.reportsDirectory=<tmp>/cov        (apps/demo-web; rc=0)
 Test Files  3 passed (3)
      Tests  18 passed (18)
All files   |   94.64 |       84 |   89.18 |    95.9 |
  app.tsx   |   96.42 |    84.09 |   92.85 |   98.14 |
  app.ts    |   92.18 |    81.57 |   84.21 |   93.65 |
  config.ts |     100 |       90 |     100 |     100 |
```

The first GREEN e2e run failed on the spec's own ordering: it changed the fake API's status before
delivering the webhook, so the page's two-second poll read "approved" from the API first ("from the
API" where the spec expected the webhook's event name). That is the sample behaving as designed (the
API's answer is the server's too); the spec now delivers the webhook first and changes the fake
API's answer after it, so the result the page shows is the webhook's, deterministically.

```
$ cat /proc/loadavg
5.89 9.29 7.81 2/1232 2088709
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/demo-web e2e'   (rc=0)
✓ 22 modules transformed.
  ✓  1 [chromium] › ../apps/demo-web/e2e/demo.spec.ts:85:1 › verifies through the embedded flow and shows the result its server verified (2.9s)
  1 passed (6.7s)
```

### 4.1 The page's files: a symlink out of the build (RED)

Review of the static file path (beside sast-pii-11c's file-system review list): `normalize` keeps
`..` out but follows a symbolic link inside the build to a file outside it.

```
$ pnpm exec vitest run src/server/app.test.ts --coverage.enabled=false     (apps/demo-web; rc=1)
     × serves assets with their types and nothing outside the build
AssertionError: expected 200 to be 404 // Object.is equality
      Tests  1 failed | 10 passed (11)
```

GREEN: the server resolves the requested file's real path and serves it only while that stays
inside the build's real path (18 passed, 94.66% statements). Also: `contracts-11c`'s
`packages/config/src/supply-chain-pins.test.ts` ("starts apps/demo-web from an empty entry point")
holds that `apps/demo-web/src/index.ts` exists, which the stub commit had removed; it is restored as
the sample's entry for tooling (re-exporting the server's names), so that test passes unchanged.

## 5. End gates (rule 25: the touched packages only; no whole-repo gate beside the others)

Every call exited 0 unless noted; times with `cat /proc/loadavg` before and after.

| Call | Result |
| --- | --- |
| `pnpm turbo run typecheck lint test --force --filter=@openverify/react --filter=@openverify/js --filter=@openverify/node --filter=@openverify/demo-web` (load 5.68 -> 11.93, 96 s) | 12 of 12 tasks; tests: react 55 (96.18% statements, 89.86% branches), js 19 (100%), node 508 (98.48%), demo-web 18 (94.71%, 83.66% branches) |
| `flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/js --filter=@openverify/node --filter=@openverify/react; node packages/sdk-react/scripts/pack-release.ts --out <tmp> --version 0.1.0 packages/sdk-js packages/node packages/sdk-react'` (load 5.86 -> 4.72, 41 s) | build 6 of 6; pack 0 (below) |
| `flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/demo-web...; pnpm --filter @openverify/demo-web e2e'` (load 5.79 -> 5.74, 12 s) | 1 passed (7.7 s) |
| `pnpm format:check` (155 s) | all matched files use Prettier code style; the four READMEs checked with `--ignore-path=.gitignore` too |
| `pnpm exec vitest run src/eslint-security.test.ts` in `packages/config` (sast-pii-11c's test, run because this area added a file-system importer) | 1 failing: `apps/dashboard/server.ts` is not in its reviewed list (images-11c's `_FILE` read; not this area's); this area's own server was added by a named borrowed edit (`6df73e2ab`) |

The packed tarballs (version 0.1.0, nothing published):

| Tarball | Bytes | Unpacked | Files | SHA-256 |
| --- | --- | --- | --- | --- |
| `openverify-js-0.1.0.tgz` | 11,200 | 31,614 | 9 | `972a6aac8acfb204633fbe5b24f99ead6ab796082fe307d5e8214e0bb7de61bb` |
| `openverify-node-0.1.0.tgz` | 1,577,687 | 14,651,979 | 509 | `e487e9c12893a19e289f973ca5b00da64f7da5eb1c5ef9fc6fc677e5644816f5` |
| `openverify-react-0.1.0.tgz` | 7,686 | 23,708 | 9 | `a6b6a511cdeba7bf90538e418927e13621c9d6bdadab3c85e7693f069bae0a9e` |

(The digests are of this local build; a release's are its own.)

- `@openverify/js`: `LICENSE`, `README.md`, `package.json`, `dist/index.js` (ESM),
  `dist/openverify.iife.js` (global `OpenVerify`), `dist/{index,embed,frame-url,messages}.d.ts`.
- `@openverify/react`: `LICENSE`, `README.md`, `package.json`,
  `dist/{index,use-open-verify,open-verify-flow}.{js,d.ts}`; dependency `@openverify/js` `0.1.0`,
  peer `react ^19.0.0`.
- `@openverify/node`: `LICENSE`, `README.md`, `package.json`, its 14 modules
  `dist/{index,client,transport,answers,errors,types,webhook-signature,workflow-request-signature}.{js,d.ts}`,
  and 490 vendored files: `dist/vendor/contracts/` 252, `dist/vendor/core/` 158,
  `dist/vendor/flow-spec/` 80 (only modules its exports reach; the contracts' declarations are most
  of the 14.65 MB unpacked); dependency `zod ^4.6.7` only.
- In each: no source map, no `sourceMappingURL` comment, no absolute path, no test or test
  support file, no `.env`, no `@openverify/source` condition, no `private`, scripts or dev
  dependencies; `publishConfig: { access: "public", provenance: true }`.
