# TDD record: integration-9a (Workflow 9A, Stage 4)

Workflow 9A Stage 4, run alone after every other 9A agent, on the tree at `0c7eb7ca`. Each slice
below records its RED and GREEN commands with their real, abbreviated output. Every command ran
after `source scripts/env.sh`.

## Slice 1: the flow routes' missing hooks (C151.7, C153.2)

Reported by flow-renderer (contractDeviations, first item, HIGH) and api-flow-engine: the web flow
sends `OpenVerify-Flow-Spec: 1, 2` on every request, but the flow CORS neither allowed nor exposed
that header, `GET /flow/session` ignored it (so the web flow never received `step` or `values`),
and an upload's `capture-method` field was refused with 400.

RED (`apps/api/src/routes/flow/phase9a-hooks.test.ts`):

```
$ pnpm exec vitest run src/routes/flow/phase9a-hooks.test.ts --coverage.enabled=false
     × sends the step and its values to a client that declared spec 2, and names version 2
     × serves spec 1 with no step to a client that declared none, and names version 1
     × allows the header in a preflight from the flow origin
     × exposes the served version to the flow origin
     × stores the method the client reports
AssertionError: expected undefined to be '2'
Expected: "authorization, content-type, x-request-id, openverify-flow-spec"
Received: "authorization, content-type, x-request-id"
      Tests  5 failed | 1 passed (6)
```

GREEN (`routes/flow/index.ts`: the CORS lists, the session route's negotiation, the upload's
`capture-method` field read with `FILE_CAPTURE_METHODS`; `auth.test.ts`'s two CORS expectations
follow the plan's header):

```
$ pnpm exec vitest run src/routes/flow/phase9a-hooks.test.ts src/routes/flow/auth.test.ts \
    src/services/flow-upload-capture-method.test.ts src/routes/flow/phase5-create-upload.test.ts \
    --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  42 passed (42)
```

## Slice 2: the e2e stack serves the flow with the flow server, and the embed page (C157.3, C178.4)

Placeholder `e2e/src/embed-page.ts` (bfe44368), then RED (36884056):

```
$ pnpm exec vitest run src/embed-page.test.ts src/env.test.ts --coverage.enabled=false
     × serves the flow through the flow server, which reaches the API with a token both share (C157)
     × generates every secret at random, long enough for the services that check
Error: not built: /tmp/embed-page-z28fzp 0
AssertionError: OPENVERIFY_FLOW_SERVER_TOKEN: expected undefined to be defined
      Tests  2 failed | 22 passed | 5 skipped (29)
```

GREEN (0ab9dd1a): `generateE2eEnv` sets `OPENVERIFY_FLOW_SERVER_TOKEN` (32 random bytes, hex),
`OPENVERIFY_FLOW_SERVER_API_URL` and `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`;
`startEmbedPageServer` serves `/`, `/index.html`, `/embed-page.js` and `/openverify.iife.js` from
fixed files and nothing else; `setup/stack.ts` builds `@openverify/js` into
`e2e/.artifacts/embed-client`, runs the flow with `node --conditions=@openverify/source server.ts
--dist <flow-dist>` instead of `vite preview`, and serves the page on a port of its own, named
`embedPageUrl` in the stack info (`stack-info.test.ts` gained its case with the member).

```
$ pnpm exec vitest run src --coverage.enabled=false        # e2e
      Tests  125 passed (125)
```

First full-stack pass on a fresh stack with these changes (load 1.0 to 3.2): shard 1 43 passed and
3 failed (`handoff.spec.ts`, all three), shard 2 45 passed and 1 failed (`signals.spec.ts`, the CORS
list), shard 3 42 passed, 1 failed and 2 not run (`ui-reviewer.spec.ts:68`, `flow_step_not_current`).

## Slice 3: a redeemed phone consents first again (C94.6, C96.5)

The web flow now renders the server's position (flow-renderer), which is past the consent step
when a handoff is redeemed, so the phone never showed its own consent and `handoff.spec.ts` waited
for it. RED (ab2f5bcd):

```
$ pnpm exec vitest run src/flow/flow-position-server.test.ts --coverage.enabled=false
     × asks a session with no consent of its own (a phone a handoff redeemed) for the flow consent before the served step (C94.6, C96.5)
      Tests  1 failed | 12 passed (13)
```

GREEN (02c7c7fb): an active position on a session whose `consent` is `null` shows the flow's
consent step first (the server takes that consent and it moves nothing,
`flow-engine/current-step.ts:83`). Two of flow-renderer's tests that served a step to a session
without consent now give the session a consent (the property each tests is unchanged).

```
$ pnpm exec vitest run src --coverage.enabled=false        # flow
      Tests  1469 passed (1469)
```

## Slice 4: shared specs changed by the plan (C151.4, C151.7)

`e2e/tests/support/ui-reviewer.ts` submits and decides the government ID before the selfie (only
the current step takes input), and `signals.spec.ts`' CORS list holds `openverify-flow-spec`
(f523da25):

```
$ OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-reviewer.spec.ts tests/signals.spec.ts
  4 passed (29.9s)
```

## Slice 5: the inquiry's flow attributes and inquiry.completed's meta (C151.8, C151.13)

RED (0673a76c):

```
$ pnpm exec vitest run src/services/inquiry-flow-attributes.test.ts --coverage.enabled=false
     × names the step left and the step the person is on, with no outcome while the flow goes on
     × hides a step reached through a sensitive exit from a reader without PII visibility
     × serves the flow outcome on a read and in a list
     × carries the flow outcome as inquiry.completed’s meta
      Tests  4 failed (4)
```

GREEN (fb04683d): `InquiryRecord` gains `previousStepName`, `nextStepName` and `flowOutcome`;
`inquiryResourceFor` serves `flow-outcome` on every read; the single read
(`getInquiryDocument`) and `inquiryResourceOf` name the steps through `flowInquiryAttributes`, an
event payload or a job failing closed (`visible: false`); `transitionInquiryInTx` adds
`meta.flow-outcome` to `inquiry.completed`.

```
      Tests  4 passed (4)
$ (API suite, 2 blob shards and a merge, load 2.2 to 8.0)
      Tests  2 failed | 8544 passed (8546)
 FAIL  src/openapi.test.ts > OpenAPI document > matches the committed snapshot
 FAIL  src/routes/selfie-stubs.test.ts > the upload limits (C40.3) > take five fields and six parts
```

The snapshot is regenerated once, at the end (slice "OpenAPI"); the upload limits test follows
C153.2 (fb9f12a4).

## Slice 6: the flow-action-sweep delivers at once (C152.2)

Placeholder signature (0fa53e63), RED (bacf0f04):

```
$ pnpm exec vitest run src/worker-flow.test.ts --coverage.enabled=false
     × passes the event publisher and the workflow step producer to each pass
      Tests  1 failed | 9 passed (10)
```

GREEN (fa261031): `phase9RepeatableJobs(deps, flow | { events, workflowSteps }, runPass)` and
`flowActionSweepJob(deps, producers, runPass)`; `worker.ts` passes its publisher and
`workflows.steps`.

```
$ pnpm exec vitest run src/worker-flow.test.ts src/jobs/repeatable/flow-actions.test.ts src/worker.test.ts --coverage.enabled=false
      Tests  65 passed (65)
```

## Slice 7: the flow action step errors in docs/workflows/errors.md (C152, C174.8)

RED (f15aacdd): `expected '\n' to contain '| \`workflow_not_found\` |'`. GREEN (84b6d7c6):
`FLOW_ACTION_ERROR_TYPES` in `reference-docs.ts` and a "Flow action steps" section, the page
regenerated with `workflow-docs:write`; `reference-docs.test.ts` 4 passed, the console's
`workflow-words.test.ts` 22 passed (it reads only the Engine and Actions sections).

## Slice 8: smaller hooks in the flow app (C161.2, C159.4, C161.8)

- `intlLocale` keyed by the instance store (RED a4db7f24: `Expected: "ar-EG" Received: "ar"`;
  GREEN 400499fd; flow 1,470 passed).
- `reportEmbedCancel` (placeholder d5975bd9; RED 4869b17e: the bridge posts nothing and the
  renderer never calls it; GREEN 17948697; flow 1,471 passed).
- The flow's typecheck runs `tsc -p scripts`, and `i18n:export` runs the locale export (a312310a).

## Slice 9: the 9A full-stack specs (C178.4)

Specs are tests, so each is its own evidence. First runs on a fresh stack (load 2.0 to 2.5):

```
$ OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/flow-branching.spec.ts
  the draft was refused: ... copy_key_unknown at /data/attributes/copy/messages/en/intro.title
  (a component text is overridden on <step>.<component>.<attribute>: fixed in the spec)
  the draft was refused: ... "the flow needs a verification step" (the version contract: the bot flow takes an ID first)
  Expected: ArrayContaining [StringMatching /^fallback:/]  Received: ["heuristic:age_route"]
  (a fallback to review needs no acknowledgement, C150.6: the expectation was wrong)
  4 passed (25.2s)
$ ... tests/flow-run-workflow.spec.ts
    Expected: {"id": "inq_...", "type": "inquiry-flow"}   Received: null
```

The last is a defect (slice 10). After it, on a restarted stack:

```
$ ... tests/flow-run-workflow.spec.ts tests/flow-embed.spec.ts tests/flow-arabic.spec.ts tests/flow-translations.spec.ts
  5 passed (15.2s)
```

Each test states 90 s as its budget. Simulate answers 501, so no inquiry is replayed through it
(carried, plan S4-12).

## Slice 10: a flow-started run names its creator (C120.1, C152.2)

RED (b667ab61), a test per creator type of `WORKFLOW_RUN_CREATOR_TYPES`:

```
$ pnpm exec vitest run src/workflows/engine/run-events-creator.test.ts --coverage.enabled=false
     × names a case-action creator
     × names a inquiry-flow creator
      Tests  2 failed | 7 passed (9)
```

GREEN (1f79b801): `CREATORS` typed by the vocabulary, `inquiry-flow` and `case-action` named.
`src/workflows/engine` and `src/workflows/runs`: 147 passed.

## Slice 11: strip-html on every write path (C149.5)

RED (6739d74a):

```
     × stores a PATCH without the tags
     × stores a screen submission without the tags
AssertionError: expected { bio: '<b>Synthetic</b> bio' } to match object { bio: 'Synthetic bio' }
```

GREEN (0b244efd): the create, `PATCH`, screen submission and `copy_extractions` write the answered
values; 172 passed across the affected folders.

## Slice 12: the compose app profile and the flow headers test (C157.3)

RED (018871bd), `bash infra/tests/flow-headers.test.sh --static-only`:

```
FAIL - compose's flow service runs the flow server (C157.3) (found: command:[pnpm,--filter,'@openverify/flow',exec,vite,preview,...])
FAIL - compose's flow service no longer runs vite preview
FAIL - the flow service reads VITE_OPENVERIFY_API_URL
# 6 passed, 3 failed
```

GREEN (221ebc9c): compose runs `node --conditions=@openverify/source apps/flow/server.ts`; static
9 passed; `compose.test.sh` 541 passed. The live half (after the apps image build): 21 passed,
`flow-server.test.sh` against the container included.

## Slice 13: CI (C151.6, C157)

RED (a8fc1868), `bash infra/tests/ci-workflow.test.sh`:

```
FAIL - node: runs bash infra/tests/flow-server.test.sh
FAIL - android: the test-count floor fails at Workflow 8A's earlier floor of 1334
FAIL - android: the test-count floor fails with one test fewer than the floor (1363)
# 227 passed, 3 failed, 0 skipped
```

GREEN (228ad6f4): the floor is 1,364 and `node` runs the flow server's contract (38 passed
locally); 230 passed.

## Slice 14: rule 6, the logical-properties scan (C161.3)

The first forced non-API unit gate failed only on
`packages/config/src/logical-properties.test.ts > apps/flow/src uses no physical utility`:
`Test timed out in 60000ms` (109 s, the turbo run at load 51). The scan now lints only the files
holding a candidate token (5 of 287), a superset a new case holds every refused utility to
(55e57306): the file runs in 1.4 s, 38 passed.

## Final gates

The code under test is `55e57306`'s; every later commit is documentation (the plan, this record,
the e2e README), and `pnpm format:check` passed again on the final tree. The forced typecheck ran
at `bd86653d` and the forced lint at `c9bafbb1`, before the two test-only fixes (`c9bafbb1` in
e2e, `55e57306` in config), which were each checked with `tsc --noEmit` and `eslint` on their
package (both 0).

Each read from its exit code; the load average beside each time.

| Step | Command | Result |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile`; `pnpm format:check` | 0; 0 |
| 2 | forced typecheck, `--concurrency=2`, 4 GB heap | 0, 17 tasks, 170 s (load 0.9) |
| 2 | forced lint but api, `--concurrency=2`, 4 GB heap | 0, 16 tasks, 270 s (load 1.8 to 3.1) |
| 2 | forced lint api, `--concurrency=1`, 4 GB heap | 0, 172 s (load 3.0 to 1.5) |
| 3, 4 | `fetch_models.py`, `fetch_data.py`, `build:variant-groups` | 0, 0, 0 (7 s) |
| 5 | non-API unit gate, one call | **124: reached the 595 s cap** (load 13 to 19; every package that finished passed) |
| 5 | `--filter` watchlist, e2e, db | 0, 3 tasks, 342 s (load 6 to 2) |
| 5 | every other package but api | 0, 13 tasks, 382 s (load 1.6 to 7.5) |
| 5 | API, 2 blob shards and a merge | shards 499 s and 439 s (load 6 to 7), merge 0: 622 files, **8,558 tests**, 94.33% statements, 84.82% branches |
| 5 | `pnpm --filter @openverify/js test` | 0, 19 tests, 100% (size budget included) |
| 6 | `benchmark:typecheck`; `benchmark:test` | 0; 0 (52 s) |
| 7 | db; graph; api 1/3, 2/3, 3/3 | 0 (78, 93 s); 0 (13, 32 s, template 15.1 s); 0 (81, 58 s); 0 (97, 160 s); 0 (76, 71 s); load 2.7 to 15 |
| 8 | `uv lock --check`, ruff, format, mypy | 0 |
| 8 | pytest files 1 to 58; 59 to 103 | 0 (1,471, 253 s, load 14 to 2); 0 (1,130, 325 s, load 2 to 1): 2,601 tests, 97.48% |
| 9 | the Android gate's four calls | 0 (85 s), 0 (26 s), 0 (21 s), 0 (21 s); 1,364 host tests, none skipped |
| 10 | `openapi:write` + diff; `workflow-docs:write` + diff | 0, 0; 0, 0 (snapshot sha256 `0295349b…44ff`) |
| 11 | mocked flow suite | 0, 158 passed in 50.6 s (52 s with the build; load 3.0 to 7.4) |
| 11 | stack down and build; stack up | 0 (28 s); 0 (80 s; load 6.8 to 3.5) |
| 11 | shards 1/3, 2/3, 3/3 | 0, 49 passed, 4.2 min (load 3.3 to 1.3); 0, 52 passed, 5.7 min (load 1.2 to 3.1); 0, 45 passed, 4.6 min (load 2.8 to 3.8); 10 OTP sends, 9 from 127.0.0.1 |
| 11 | stack down | 0 |
| 12 | apps image; vision image; code-runner image | 0 (209 s); 0 (44 s); 0 (72 s) |
| 13 | flow-headers (live), apps-image-context, check-connected-results, ci-workflow, flow-server, pre-commit-hook, compose, code-runner, vision-container, install-gitleaks | each 0: 21, 43, 11, 230, 38, 11, 541, 55, 55, 9 passed |
| 14 | workflow benchmark, under the e2e lock | 0 (130 s, load 2.3 to 3.0): effectful 17, 48, 48 and control-flow 92, 205, 208 steps/s at 1, 8 and 32 clients |
| 15 | `gitleaks git --redact .` | 0, 5,198 commits, no leaks |

Non-API unit tests: db 2,057 (92.61%), watchlist 819 (98.63%), e2e 125 (96.93%), ui 54 (100%),
js 19 (100%), flow-spec 432 (96.27%), config 289 (97.22%), node 475 (98.41%), signals 192
(96.37%), core 1,406 (99.84%), emrtd 318 (94.97%), workflow-engine 1,984 (98.02%), contracts
4,094 (99.19%), checks 3,815 (98.77%), flow 1,471 (95.14%), dashboard 5,587 (96.39%): 23,137;
with the API, 31,695.
