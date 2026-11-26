# The README's screenshots (open-source release prep)

Slice: the screenshots the public README shows, in `docs/assets/screenshots/`, from an opt-in Playwright spec (`e2e/tests/docs-screenshots.spec.ts`) on the e2e stack's synthetic data. No product code changed, so there is no RED/GREEN pair: the evidence is that the spec runs on a fresh stack, is skipped otherwise, and the package's gates stay green.

## Data and privacy

- Stack: the compose project `openverify-e2e` (`e2e:stack:up`, host mode), its own volumes and `seed:dev`; never the developer's `openverify` project or the `openverify-test` project.
- The inquiries carry invented names in their reference IDs and fields; the ID is the generated SPECIMEN card (`FIXTURES.idFront`, `idBack`); the selfie is the fake camera's head-turn clip.
- Every photo of a person is blurred in the shot (`video`, `canvas` and the photo `img` elements in the flow, `main img` on the inquiry page). No shot shows an API key, a session token or a one-time token.
- The two list shots (inquiries, cases) hide the page's filter form and saved views, so the table sits under the console's header; the pages keep both.
- The three Android shots are the SDK's committed Roborazzi goldens (`android/openverify-sdk/src/androidHostTest/screenshots/android-a11y-audit/`: `consent.png`, `capture-id-guided.png`, `capture-selfie-guided.png`), recorded from synthetic content with no faces (C219.3), copied unchanged before the quantization.

## Commands

```text
$ pnpm turbo run build --filter=@openverify/e2e^...                                    # exit 0
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up            # ready
$ OPENVERIFY_DOCS_SCREENSHOTS=1 OPENVERIFY_E2E_REUSE_STACK=1 flock /tmp/openverify-e2e.lock \
    pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/docs-screenshots.spec.ts
  ✓  1 [chromium] › tests/docs-screenshots.spec.ts › the README screenshots › the hosted flow and the console, on synthetic data (38.9s)
  1 passed (41.6s)
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:down          # [e2e:stack] stopped
```

The final run was on a stack started fresh for it, so the lists hold that run's objects only. Earlier runs on the reused stack found the fixes recorded in the spec: the flow's CSP refuses an injected style (the contexts set Playwright's `bypassCSP`; the stack's headers are unchanged), the filter forms are `role="search"`, and the default template has no draft for the flow builder (the shot uses `builderDraft()` and archives it afterwards).

Optimisation: every PNG quantized to 256 colours with Pillow 11.3.0 (`uv run --no-project --with pillow==11.3.0 python -I optimize_pngs.py docs/assets/screenshots`; `image.quantize(colors=256, method=MEDIANCUT, dither=NONE).save(optimize=True)`), sizes unchanged: 14 files, 695,149 bytes in all, each under 92 KB.

## Gates

```text
$ pnpm exec prettier --check e2e/tests/docs-screenshots.spec.ts      # All matched files use Prettier code style!
$ pnpm --filter @openverify/e2e lint                                  # eslint . (exit 0)
$ pnpm --filter @openverify/e2e typecheck                             # tsc --noEmit (exit 0)
$ pnpm --filter @openverify/e2e test
 Test Files  24 passed (24)
      Tests  161 passed (161)        96.87 / 88.83 / 95.45 / 97.28
$ (e2e) pnpm exec playwright test --list --project=chromium tests/docs-screenshots.spec.ts
  [chromium] › docs-screenshots.spec.ts:185:3 › the README screenshots › the hosted flow and the console, on synthetic data
Total: 1 test in 1 file
```

Without `OPENVERIFY_DOCS_SCREENSHOTS=1` the describe's `test.skip` skips the test, so the `chromium` shards and CI report it skipped; `playwright.config.ts` and its unit test are unchanged (every spec under `tests/` stays in the `chromium` project).

## Observed, not changed

- The workflow editor's and the flow builder's canvases draw each branch label as a black bar (`dashboard-workflow-editor.png`, `dashboard-flow-builder.png`): the edge label's background, not the shot's style. Left for the console's owners.
- A full `playwright test --list` without a stack fails at `tests/ui-analytics.spec.ts:27` (`readStackInfo()` at module load); unrelated to this spec.
