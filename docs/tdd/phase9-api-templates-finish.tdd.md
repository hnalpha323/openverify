# Phase 9, Workflow 9B, Stage 3: api-templates-finish (TDD record)

The orchestrator split `api-templates-carry`'s area during Workflow 9B (2026-11-06). This agent took over that
agent's paths for two items, on top of its committed work:

1. C156.1, the preview resolve: `POST /inquiry-template-versions/:id/preview` answers the preview document. It
   carries the resolved theme and the contrast answer through `api-themes`' `resolveThemeForVersion` (contracts
   B46), and the copy goes through `pseudoLocalizeTree` for the pseudo-locales (C161.7). The route leaves
   `phase9a-template-plumbing.test.ts`' 501 list in the commit that builds it.
2. `flow_run_grants` (9A Stage 3 amendment 31; contracts B45; foundation-9b F3). The publish stores
   `flowActionPublishGrants(...)`, so `run-workflow.ts`' `recordedGrantOf` reads a real grant. The publish
   analyses already require `flowActionAcknowledgements(...)` (B45).

Every command ran after `source scripts/env.sh`, from `apps/api` unless noted. Every value in the tests is
synthetic.

## Commits

| Step | Commit | What |
|---|---|---|
| stub | `561d56fe` | `previewTemplateVersion`, `previewCopy`, `previewGuidance`, each throwing until built |
| RED | `e37c4992` | `services/templates/preview.test.ts` (15 tests), `services/templates/flow-run-grants.test.ts` (4 tests) |
| GREEN | `2b07816e` | `services/inquiry-templates.ts` (publish and v2 creation store the grants), `services/templates/operations.ts` (a copy keeps its source's) |
| GREEN | `31587c3f` | `services/templates/preview.ts`, the preview handler in `routes/server/inquiry-template-versions.ts`, the 501 list removed from `phase9a-template-plumbing.test.ts` |
| test | `9452b3d9` | the preview's last new exit (a stored flow it cannot read) held by a test |

## RED

The RED commit typechecked (`bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit`, exit 0 in 169 s, load 13.1)
and linted (`pnpm exec eslint` on both files, exit 0). Each test failed for its intended reason:

```text
$ pnpm exec vitest run src/services/templates/flow-run-grants.test.ts --coverage.enabled=false --maxWorkers=2
     × stores the latest published version’s grant, resolved in the publish
     × holds a latest-published target to the grant its publish recorded (review P07)
     × refuses the publish without the target’s egress acknowledgement, then records the egress
     × stores them for a flow-spec 2 template created in one call, and a copy keeps its source’s
AssertionError: expected [] to deeply equal [ { stepId: 'run_check', …(5) } ]
AssertionError: expected { state: 'done', port: 'error', …(2) } to match object { state: 'done', port: 'next', …(1) }
AssertionError: expected [] to deeply equal [ { stepId: 'run_check', …(5) } ]
AssertionError: expected [] to deeply equal [ { stepId: 'run_check', …(5) } ]

$ pnpm exec vitest run src/services/templates/preview.test.ts --coverage.enabled=false --maxWorkers=2
     × holds every renderable step’s client view, the built-in theme and the guidance
     … (15 of 15 failed)
AssertionError: {"status":501,"detail":"Previewing a template version is not built yet (api-templates)."…}: expected 501 to be 200
NotImplementedError: previewCopy is not built yet (api-templates-finish).
NotImplementedError: previewGuidance is not built yet (api-templates-finish).
      Tests  15 failed (15)
```

In the egress test, the refusal part already passed at RED, because B45's requirement half was built in 9A. The
test failed only where the egress record was missing. The widened run in the second test is the 9A behaviour:
with no record, a `latest-published` target is held to no scope.

The first preview run also failed while the tests were being set up (`field_unknown` for the fixtures' unbound
`nickname` field, and a missing `selfie` configuration). The test's draft helper was fixed to declare the field
and configure each verification type of its flow before the RED commit. After that fix every failure was the
501 or the stub's error.

## GREEN

```text
$ pnpm exec vitest run src/services/templates/flow-run-grants.test.ts --coverage.enabled=false --maxWorkers=2
      Tests  4 passed (4)

$ pnpm exec vitest run src/services/templates/preview.test.ts src/phase9a-template-plumbing.test.ts --coverage.enabled=false --maxWorkers=2
      Tests  26 passed (26)

$ pnpm exec vitest run src/routes/server/inquiry-template src/services/inquiry-templates src/services/publish \
    src/services/templates src/services/themes src/routes/server/theme src/flow-actions/grants.test.ts \
    src/phase9b-flow-carry-plumbing.test.ts src/phase9a-template-plumbing.test.ts src/phase9a-theme-plumbing.test.ts \
    src/app.test.ts --coverage.enabled=false --maxWorkers=2
 Test Files  35 passed (35)
      Tests  346 passed (346)
```

## Decisions (the plan left them open)

- **Preview copy.** For an enabled locale, the copy is the operator texts a session in that locale shows,
  following C162.5's order as far as the server can:
  - the locale's own text first;
  - for a component key, which has no built-in text, the default locale's text next;
  - a built-in key (`COPY_KEYS`) without the locale's own text is left out, so the preview's catalog fills it.

  Only enabled locales are read. A locale the version does not enable answers 422 at `/meta/locale`.

  For `en-XA` and `ar-XB`, the copy is every text an `en` session shows, put through `pseudoLocalizeTree`:
  - the built-in `en` catalog, read from `contracts/fixtures/i18n/en.json`, which `flow-i18n` exports and a test
    holds equal to the catalogs (C161.8);
  - under it, the operator's `en` texts, with the same fallbacks.

  So nothing reaches the preview untransformed. This mirrors how `consent-texts.ts` reads `consent-texts.json`.
- **Guidance** is configuration only:
  - a government ID step's sides (`front`, `back`, or `front` then `back` for `both`);
  - a selfie step's poses;
  - a consent step's `{ days, organization }`, from the environment's `face-template-retention-days` and
    `organization-display-name`, or `null` when that is unset.

  It never holds a field's value or default, so a screen gets no guidance.
- **Theme set.**
  - A body naming `theme-set-id` is checked with `checkThemeSetChoice`. A set that is not active here
    (foreign, archived or unknown) answers 422 at `/data/attributes/theme-set-id`, and `null` means none.
  - A stored version's set that has since been archived falls back silently, as C160.7's resolution does.
  - Unsaved `styles` go through `resolveThemeForVersion`. A failing palette is answered with
    `contrast.status: failed`; a contradiction answers 422 under `/data/attributes/styles`.
- **The body's `field-schemas`** change nothing in the document, which carries no field value. The masking of
  their defaults in API logs is foundation-9a's and still holds.
- **A stored flow that cannot be read** answers 422 at `/data/attributes/flow`. A body's flow previews in its
  place.
- **Grants.**
  - Each `run_workflow` step's record is resolved in the publish's transaction, after every publish rule, and
    stored with the version. This covers a draft's publish and the one-call creation of a flow-spec 2 template.
  - A copy keeps its source's records, as it keeps its acknowledgements.
  - A restored or promoted draft gets its records when it is published.
  - Re-publishing a version that is not a draft leaves its stored records as they are, and the answer is still
    409.

## Final gates

Each gate's own exit code was read, never a printed summary.

| Gate | Command | Exit | Time and load |
|---|---|---|---|
| Frozen install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` (root) | 0 | under 1 s |
| Format | `pnpm exec prettier --check --ignore-path=../../.gitignore` on the 7 changed files | 0 | |
| Typecheck | `NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm turbo run typecheck --force --filter=@openverify/api` | 0 | 203 s, load 6.3-11.7 |
| Lint | the same with `lint` (the first try was exit 75, no slot, so it was run again) | 0 | 391 s, load 15.2-10.9 |
| API unit, 12 blob shards (`--maxWorkers=3`, each through the slot) | `pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-i --shard=i/12 --reporter=blob ...` | 1 each, on partial coverage only | 243, 248, 271, 315, 223, 207, 201, 172, 172, 180, 168, 162 s, load 8.3-15.1 |
| API unit merge | `pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged` | 0 | 55 s, load 5.5: 684 files, 9,304 tests, 94.36% statements, 84.94% branches |
| Integration, db | `pnpm --filter @openverify/db test:integration` (root) | 0 | 96 s, load 21.8: 78 tests |
| Integration, graph | `pnpm exec vitest run --config vitest.integration.config.ts --project graph` | 0 | 107 s, load 23.4: 13 tests, its template built in 63.5 s of 180 s |
| Integration, api 1/3, 2/3, 3/3 | `... --project api --shard=i/3` | 0, 0, 0 | 96, 289, 88 s, load 18.4-23.1: 89, 99, 79 tests |

`<dir>` is `/tmp/openverify-finish-unit-1793989760`. Twelve shards were used rather than six: at this load, six
shards had run 570 to 749 s for `api-themes`, past the 600 s call cap, and twelve ran 162 to 315 s here.
`preview.ts` is covered at 100% of its statements and 94.1% of its branches.

No file of `apps/flow` changed, so no mocked flow suite was run. No file the watchlist benchmark imports changed.
