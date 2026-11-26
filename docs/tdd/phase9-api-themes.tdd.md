# TDD evidence: Phase 9, Workflow 9B, `api-themes` (family H, Stage 3)

C160 on 9A's frozen theme plumbing: the contrast gate and the built-in palettes, theme sets with
revisions, restore and archive, assets with synchronous renditions, resolution, the publish and
settings checks, promote, the preview's theme export, the flow's theme application and its CSP spec,
and `docs/themes/README.md`. Run `source scripts/env.sh` first. Every RED below was seen failing for
the reason named, then GREEN; the commands are the real ones, the output abbreviated.

## Slice 1: the contrast gate and the built-in palettes (C160.4; reviews F13, H29)

- Stub: `183dd32f` (`BUILTIN_PALETTES` constant, light converted, dark a copy).
- RED `6f168c07`: `(cd packages/core && pnpm exec vitest run src/contrast --coverage.enabled=false)`

  ```
  ContrastNotBuiltError: relativeLuminance is not built yet (api-themes, Workflow 9B)
  AssertionError: expected { primary: '#1447e6', …(11) } to not deeply equal { primary: '#1447e6', …(11) }
  AssertionError: expected { …(12) } to deeply equal { primary: '#1447e6', …(11) }   (styles.css still oklch)
  Tests  28 failed | 4 passed (32)
  ```
- GREEN `6826b2b1`: the gate (luminance, unrounded ratio, `fail`/`warn` over the sixteen pairs), the
  light palette as hex in `packages/ui/src/styles.css` (converted by Chromium 156's canvas, see
  `docs/themes/README.md`), `focus` `#000000` (the converted `#155dfc` is 1.302:1 on `primary`), the
  dark palette under `:root[data-openverify-variant='dark']`. Three test values were wrong in the RED
  commit and corrected here: the 21:1 vector's upper bound (21 is not below 21), a warn example that
  was 7.005:1 (`#595959` to `#666666`), and the stylesheet check now looks for an `oklch()` value, not
  the word in a comment. `Tests  32 passed (32)`.
- `packages/ui/src/styles.test.ts` changed with the plan (hex tokens instead of `oklch()`): `Tests  21 passed (21)`.

## Slice 2: theme sets and assets (C160.1-C160.3, C160.5-C160.7)

- Stub: `0ca36f18` (`uploadThemeAsset`, `resolveThemeForVersion`, `ThemeActing`).
- RED `f7bfb169`: `(cd apps/api && pnpm exec vitest run src/routes/server/theme-sets.test.ts --coverage.enabled=false --maxWorkers=2)`

  ```
  Error: expected HTTP 201, got 501: {... "detail":"Creating a theme set is not built yet (api-themes, Workflow 9B)." ...}
  Tests  17 failed | 7 passed (24)      (the 7: the 400 schema cases and the 403 scope checks, already frozen)
  ```
- RED `d9375840`: run against the 501 route and the upload stub (the implementation was set aside in
  the scratchpad and restored after):

  ```
  AssertionError: {"status":501,"detail":"Uploading a theme asset is not built yet ..."}
  AssertionError: expected NotImplementedError: Theme assets are not… to match object { status: 503, ... }
  Tests  19 failed (19)
  ```
- GREEN `941bf5fe`: `Tests  24 passed (24)` and `Tests  19 passed (19)`. One RED value corrected in
  GREEN: the PATCH test's primary `#1a43b3` is 2.50:1 against the black focus, which the gate rightly
  refuses; it became `#2563eb`. The flow API's own `no-store` hook ran after the asset route's headers,
  so the asset plugin sets `private, max-age=3600` in an onSend hook of its own on a 200.
  `phase9a-theme-plumbing.test.ts` changed with the plan: the routes are built (404, 200, 201, 415
  instead of 501).

## Slice 3: resolution, naming a set, publish, promote, the preview export (C160.7, C160.8, C156.1)

- Stub: `ac499d11` (`PromoteThemeReference.assets`).
- RED `77f9fea9` (against the 9A stubs):

  ```
  AssertionError: expected undefined to deeply equal { …(9) }                 (session theme)
  AssertionError: promise rejected "UnprocessableContentError: Theme sets are…" instead of resolving
  AssertionError: expected [ { pointer: '/theme-set-id', …(1) } ] to deeply equal []
  AssertionError: expected NotImplementedError: Promoting a theme se… to match object { code: 'promote_unresolved' }
  Tests  14 failed | 2 passed (16)      (the 2: no set anywhere, and a foreign set, both null already)
  ```
- GREEN `ef019bc6`: `Tests  31 passed (31)` with the plumbing test (promote of an unknown set is now
  `promote_unresolved`). Neighbours: `phase9a-template-plumbing`, `inquiry-template-operations`,
  `settings-embedding`, `jobs/records`: `Tests  63 passed (63)`.
- `e148e601`: characterisation tests of the header readers (written after the code, all green at once).

## Slice 4: the flow's theme application (C160.9, C160.6)

- Stubs: `bf35aa96`, `f1cd61d6`.
- RED `02590d95`: `(cd apps/flow && pnpm exec vitest run src/theme --coverage.enabled=false --maxWorkers=2)`

  ```
  × sets each light token with setProperty, and the radius scale
  × shows a logo from a blob: URL with its alt text
  × reads the asset with the session token and answers its bytes and type
  Tests  15 failed | 7 passed (22)
  ```
- GREEN `6bc8a7e4`: `Tests  42 passed (42)` with `app-parameters`, `phase9a-theme-slot` and
  `flow-renderer-phase9`. jsdom has no `matchMedia`: an engine without it states no preference.

## Slice 5: `theme-csp.spec.ts` (C160.9, C178.3)

- RED, run against the stub module of `f1cd61d6` (set aside and restored):
  `flock /tmp/openverify-e2e.lock sh -c 'cd apps/flow && pnpm exec playwright test -c e2e/playwright.config.ts e2e/theme-csp.spec.ts'`

  ```
  Expected: "dark"  Received: ""   (data-openverify-variant)
  4 failed, 1 passed (15.0s)       load 10.72
  ```
- GREEN at `6bc8a7e4`, committed `8c6a9267`: `5 passed (9.4s)`, load 11.88. Chromium only here.

## Final gates (each read from its exit code; load averages beside each)

| Gate | Result |
|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | exit 0 |
| `pnpm exec prettier --check` (every file of mine) | exit 0 |
| `pnpm turbo run lint typecheck --force --filter=@openverify/core --filter=@openverify/ui --filter=@openverify/flow` | exit 0, 6 tasks (load 13.9 to 21.0) |
| `NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/api --concurrency=1` | exit 0, 2 tasks, 10m27s (load 21.4 to 14.7) |
| `pnpm --filter @openverify/core test` | exit 0, 1,650 tests, 99.21% statements |
| `pnpm --filter @openverify/ui test` | exit 0, 54 tests, 100% statements |
| `pnpm --filter @openverify/flow test` | exit 0, 1,501 tests in 120 files, 95.15% statements |
| API unit, 6 blob shards (`--maxWorkers=3`, each through the slot lock) | 570 s, 749 s, 654 s, 604 s, 392 s, 485 s (load 12 to 31); each exits 1 on its partial coverage alone, no failed test |
| the merge (`--merge-reports`, coverage) | exit 0: 8,725 tests in 636 files, 94.34% statements, 84.89% branches |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests, 158 s (load 16 to 30) |
| integration `--project graph` | exit 0, 13 tests, 56 s; template built in 31.3 s of its 180 s guard (load 20 to 17) |
| integration `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 81, 97 and 76 tests in 273 s, 518 s, 132 s (load 18 to 31) |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | exit 0, 163 tests (158 plus theme-csp's 5) in 2.3 min, 142 s with the build (load 20.6 to 30.9) |

Shard 2 ran past the 10-minute call cap (749 s); it was not lost (the call moved to the background and
wrote its blob), and shards 3 to 6 ran in one background call each, so N stayed 6.
