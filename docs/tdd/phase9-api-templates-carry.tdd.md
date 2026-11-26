# Phase 9, Workflow 9B, Stage 3: api-templates-carry (TDD record)

The template items Workflow 9A left open (plan S4-12; 9A Stage 3 amendments 31, 39 and 42; the owners set by
"## Orchestrator decisions before Workflow 9B (2026-11-05)", narrowed by the orchestrator's Workflow 9B prompt:
the preview resolve and `flow_run_grants` are `api-templates-finish`'s, not this agent's):

1. C156.4: `POST /inquiry-template-versions/:id/simulate` and the simulation presets (built-in and saved).
2. C158.2, C158.4: a version's `embed-origins`, `redirect-uri` and `redirect-uri-schemes` checked at publish.
3. 9A amendment 42: `biometricTemplates` exported and passed to the publish analyses.
4. C147.1: a flow-spec 2 flow on `POST /inquiry-templates`.

Every command ran after `source scripts/env.sh`, from `apps/api` unless noted. Every value in the tests is
synthetic; every origin is a reserved name.

## Commits

| Step | Commit | What |
|---|---|---|
| stub | `bf11e60e` | `simulateFlow`, `simulateTemplateVersion`, the preset functions, each throwing until built |
| RED | `6d7a02ce` | the seven test files below |
| GREEN | `873227ca` | `services/templates/simulate.ts` (the pure walk) |
| GREEN | `dd9acc68` | the simulate route and service, the presets, the dashboard preset routes, the 501 list |
| GREEN | `4203bb45` | `services/publish/flow-v2.ts` (embedding checks, biometric fact), `export` in `workflows/publish/facts.ts` |
| GREEN | `e596b45e` | `services/inquiry-templates.ts` (flow-spec 2 creation) |

## RED

The RED commit typechecked (`bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit`, exit 0 on the stub tree, load
4.18) and linted (`pnpm exec eslint <the ten files>`, exit 0). Each test failed for its intended reason:

```text
$ pnpm exec vitest run src/services/templates/simulate.test.ts --coverage.enabled=false --maxWorkers=2
     × walks the golden flow to the golden answer: a minor takes the route to the extra screen
     × takes else when no route holds, with the route result false
     … (26 of 26 failed)
Error: simulateFlow is not built yet (api-templates-carry).

$ pnpm exec vitest run src/services/publish/flow-v2.test.ts --coverage.enabled=false --maxWorkers=2
     × refuses an origin outside the environment’s list, at its position, echoing nothing
     × refuses an origin outside the grammar for the environment’s kind
     × lists the refusal in validate’s publish mode, beside the other problems
     × refuses a URI outside the allowed redirect origins, at its pointer
     × takes a custom scheme only when the version lists it
     × asks no biometric basis of a template known not to be biometric
AssertionError: expected 200 to be 422
AssertionError: expected 'valid' to be 'invalid'
AssertionError: expected [ 'spec1_unsupported', …(1) ] to not include 'biometric_basis_missing'
      Tests  6 failed | 4 passed (10)

$ pnpm exec vitest run src/routes/server/inquiry-template-flow-v2.test.ts src/services/templates/simulate-version.test.ts \
    src/services/templates/simulation-presets.test.ts src/routes/dashboard/simulation-presets.test.ts \
    src/routes/dashboard/simulation-presets-frozen.test.ts --coverage.enabled=false --maxWorkers=2
      3 Error: builtInPresetScope is not built yet (api-templates-carry).
      3 Error: saveSimulationPreset is not built yet (api-templates-carry).
      1 Error: presetScopeFor is not built yet (api-templates-carry).
        AssertionError: {"status":501,"detail":"Simulating a template version is not built yet (api-templates)."…}: expected 501 to be 200
        AssertionError: expected [ 501, 501, 501 ] to deeply equal [ 200, 201, 404 ]
        AssertionError: {"status":422,"detail":"Flow-spec 2 is not accepted yet."…}: expected 422 to be 201
        AssertionError: expected undefined to be 'definition_invalid'
      Tests  21 failed | 3 passed (24)
```

Two test-side defects found while running RED were fixed before the RED commit: the golden branch flow binds a
`nickname` field, so the v2 draft in `simulate-version.test.ts` declares its `field-schemas`, and the creation test
that needs an acknowledgement uses the golden branch without its screen (a creation takes no `field-schemas`).

## GREEN

```text
$ pnpm exec vitest run src/services/templates/simulate.test.ts --coverage.enabled=false --maxWorkers=2
      Tests  26 passed (26)

$ pnpm exec vitest run <the eight files of this slice, the plumbing test included> --coverage.enabled=false --maxWorkers=2
 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 71 passed (72)
AssertionError: expected [ 'consent', 'government_id', …(4) ] to deeply equal [ 'consent', 'government_id', …(2) ]
```

The one failure was the test's expectation, not the code: a flow-spec 1 version is walked migrated, as the engine
walks it, so the default template's path holds the migrated branches `government_id-routes` and `selfie-routes`.
The expectation was corrected (in the GREEN commit `dd9acc68`, recorded here); then:

```text
$ pnpm exec vitest run src/services/templates/simulate-version.test.ts --coverage.enabled=false --maxWorkers=2
      Tests  6 passed (6)
$ pnpm exec vitest run src/routes/server/inquiry-template src/routes/server/inquiry-templates.test.ts \
    src/services/embed-origins.test.ts src/phase9a- src/workflows/publish src/services/templates \
    src/routes/dashboard/simulation-presets --coverage.enabled=false --maxWorkers=2
 Test Files  29 passed (29)
      Tests  337 passed (337)                       (load 12.58)
```

While iterating, test files that build the whole API failed to load for a while on another agent's in-flight
work (`services/themes/rules.ts` imported a `./problems.js` not yet written, `api-themes`); the run was repeated
once that file landed, as rule 6 asks, and nothing of theirs was edited.

## Final gates

Each read from its exit code, each heavy call through `/tmp/openverify-heavy.sh`, beside the other Stage 3
agents (load average beside each):

| Gate | Command | Exit | Numbers |
|---|---|---|---|
| install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | lockfile unchanged |
| format | `pnpm exec prettier --check <my files>` (and `--ignore-path=.gitignore` for those under `services/`) | 0 | 17 files |
| lint | `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --filter=@openverify/api --concurrency=1` | 0 | 395 s, load 9.8-11.5 |
| typecheck | `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck --force --filter=@openverify/api --concurrency=1` | 0 | 134 s, load 8.4-10.1 (an earlier try failed on `services/themes/resolve.test.ts` of `api-themes`' in-flight work and passed once it landed) |
| API unit | 12 blob shards (`--shard=i/12 --maxWorkers=3`), then `--merge-reports` with coverage | merge 0 | 636 files, 8,725 tests, 94.34% statements, 84.89% branches; shards 232-458 s, merge 62 s, load 11.6-26.6 |
| integration db | `pnpm --filter @openverify/db test:integration` | 0 | 78 tests, 110 s, load 25.9 |
| integration graph | `vitest run --config vitest.integration.config.ts --project graph` | 0 | 13 tests, 45 s (template 22.0 s), load 16.5 |
| integration api | `--project api --shard=i/3`, i = 1..3 | 0, 0, 0 | 81, 97, 76 tests; 83, 241, 106 s, load 17.7-28.2 |

The API unit suite first ran as six shards; shard 3 crossed the 10-minute call cap (lock wait included) and
finished in the background, so, as rule 8 asks, the suite ran again as twelve shards in a fresh directory, and
that merge is the gate. No file of rule 16's list changed, so the watchlist benchmark checks do not apply; no
file of `apps/flow` or `packages/db` changed.
