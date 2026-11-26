# Phase 9, Workflow 9B Stage 3: api-flow-carry (the flow-engine items 9A left open)

The 9A items S4-12 carried to 9B and the orchestrator gave this agent ("## Orchestrator decisions
before Workflow 9B (2026-11-05)", item 1): `comparison-source` in the two comparison checks'
evidence (9A Stage 3 amendment 21, B47), the session's `links` with the web flow's help slot and link
button (amendment 47, B43), prefill by input name (amendment 49, B48) and the handed-off v2 phone's
consent step (amendment 23, B48). The resume expiry window and the `meta.expiration-after-*` keys are
`api-flow-expiry`'s, after this agent. Started when Stage 1a returned (`98f448bd`). Every command
below was run after `source scripts/env.sh`; nothing was pushed and no dependency was added.

## Slice 1: `comparison-source` in the two comparison checks (packages/checks)

Owned: `packages/checks/src/comparison-source.ts` (the references module), the two checks.
Rule (ours, fail closed): a compared field is `initial` only when every inquiry key it read that holds
a value is named `initial` by `inquiryFieldSources`; a key the sources do not name, or one typed
later, makes it `entered`. The member is keyed as `compared-fields` is (`name`, `birthdate`,
`address`, `identification-number`, `phone-number`, `email-address`), names only, and left out when
the worker passed no sources or there was no reference. `id_account_comparison` never carries it.

### RED (`015f076e`)

```
$ pnpm --filter @openverify/checks exec vitest run src/comparison-source.test.ts --coverage.enabled=false
     × names each compared field initial or entered, keyed as compared-fields is
     × reads a field as entered when any key it compared was entered, the middle name included
     × never claims initial for a key the sources do not name
     × records the source of a mismatched field too, and only of the fields compared
     × names each compared field initial or entered
     × reads an address as entered when any of its keys was entered
     × records a mismatched field's source, and leaves the member out without sources
AssertionError: expected undefined to match object { birthdate: 'initial', …(1) }
      Tests  7 failed | 4 passed (11)
$ (cd packages/checks && pnpm exec tsc --noEmit)   # exit 0
```

### GREEN (`7259779f`), refactor (`4c151693`)

```
$ pnpm --filter @openverify/checks exec vitest run src/comparison-source.test.ts src/database src/government-id --coverage.enabled=false
      Tests  273 passed (273)
```

The refactor names the keys both checks read, `COMPARED_NAME_KEYS` and `COMPARED_ADDRESS_KEYS`.

## Slice 2: the API passes the sources (borrowed lines of the two input builders)

`jobs/government-id.ts` `referencesOf` (lines 345-351) and `jobs/types/database.ts`
`evaluateDatabase` (lines 129-138) pass `comparisonSourceFor`'s `sources` as `inquiryFieldSources`.
The job tests create an inquiry with `initialFields` (as `POST /inquiries` does) and read the stored
check's metadata.

### RED (`573c97ee`)

```
$ (cd apps/api && pnpm exec vitest run src/jobs/process-government-id.test.ts src/jobs/process-database.test.ts --coverage.enabled=false --maxWorkers=2)
     × records which compared fields were set at creation and which were entered later (C149.4)
     × records which compared fields were set at creation and which were entered later (C149.4)
-     "comparison-source": { "birthdate": "entered", "name": "initial" },
      Tests  2 failed | 47 passed (49)
$ bash /tmp/openverify-heavy.sh pnpm --filter @openverify/api typecheck   # exit 0
```

### GREEN (`260ccf70`), refactor (`ba6a8dbc`)

```
$ (cd apps/api && pnpm exec vitest run src/jobs/process-government-id.test.ts src/jobs/process-database.test.ts src/flow-engine/initial-fields.test.ts --coverage.enabled=false --maxWorkers=2)
      Tests  52 passed (52)
```

The refactor makes `flow-engine/initial-fields.ts`' `ComparisonSourceKind` the checks' own type.

## Slice 3: the session's links, prefill by input name, the v2 phone's consent (flow-engine/session.ts)

Placeholder `add1ea79`: `FlowSessionMembers` names `links`, so the tests compile.

- **Links (B43):** `links { help-url, privacy-url }` from the pinned version's `help_url` and
  `privacy_url`, for every client and both spec versions; each is `null` unless it parses with
  `flowSessionLinksSchema`'s own member (an `https:` URL of at most 2,048 characters), so a value
  written around the version contract never reaches a client.
- **Prefill by input name (B48):** a database or AAMVA form step's `prefillFrom` map is served under
  each input's name, as today's web flow reads it (`entered-values-step.tsx` looks up
  `field.name.replaceAll('-', '_')`): a database input as named (`name_first`), an AAMVA input with
  `-` read as `_` (`name-first` is served as `name_first`). The masking is unchanged: a write-once
  value is `{ set: true }`, an unset one `null`, and no field the map does not name leaves the server.
  A screen and a single-key `prefillFrom` stay keyed by field key.
- **The v2 phone's consent (B48):** a session that holds no consent of its own, on an active position
  past the flow's (first) consent step, is served that consent step's client view as `step` (its id
  differs from `position.step-id`), with no `values`; the position is unchanged. A spec-1 client gets
  no `step`, as before. Recording that consent moves nothing (`current-step.ts`, 9A): the route test
  drives a desktop through consent and a QR handoff, redeems on a phone, and checks the phone's
  session before and after its own consent.

### RED (`8de85a54`)

```
$ (cd apps/api && pnpm exec vitest run src/flow-engine/session.test.ts --coverage.enabled=false --maxWorkers=2)
     × serves the pinned version's help and privacy links to every client
     × names each link null when the version sets none, a flow-spec 1 version included
     × fails closed: a stored link that is not an https: URL of at most 2,048 characters is null
     × keys a database step's values by its input names, each the mapped field's value
     × keys an AAMVA form step's values by its input names as the web flow reads them
     × is served the passed consent step's client view first, the position unchanged
AssertionError: expected undefined to deeply equal { …(2) }
AssertionError: expected { date_of_birth: null, …(3) } to deeply equal { name_first: 'Ada', …(3) }
AssertionError: expected { id: 'about', type: 'screen', …(1) } to deeply equal { Object (id, type, ...) }
      Tests  6 failed | 28 passed (34)
$ (cd apps/api && pnpm exec vitest run src/flow-engine/handoff-consent-v2.test.ts --coverage.enabled=false --maxWorkers=2)
     × serves the phone the passed consent step first, and records its consent without moving
AssertionError: expected { id: 'about', type: 'screen', …(1) } to match object { id: 'consent', type: 'consent' }
      Tests  1 failed (1)
```

The API typecheck at this commit failed only in `routes/server/analytics.ts` (foundation-9b (A)'s
work in flight); the two test files lint and typecheck.

### GREEN (`f4eebb1a`)

```
$ (cd apps/api && pnpm exec vitest run src/flow-engine/session.test.ts src/flow-engine/handoff-consent-v2.test.ts --coverage.enabled=false --maxWorkers=2)
      Tests  35 passed (35)
$ (cd apps/api && pnpm exec vitest run src/routes/flow src/flow-engine src/services/handoff src/flow-actions src/routes/handoff-routes.test.ts src/phase9a-flow-plumbing.test.ts --coverage.enabled=false --maxWorkers=2)
 Test Files  44 passed (44)
      Tests  584 passed (584)
```

Every other test file that reads a session passed too, except `plugins/rate-limit.test.ts`, which
failed on foundation-9b (A)'s `analytics` policy in flight (not this slice).

## Slice 4: the web flow's help slot and link button (apps/flow)

Placeholders `763b4205` and `3334eb3d` (`apps/flow/src/components/flow-links.ts`: `FlowLinkName`,
`FlowLinks`, `NO_FLOW_LINKS`, `sessionLinksOf`, `FlowLinksContext`, `ReportFlowLinksContext`,
`useReportSessionLinks`). The layout holds the links the renderer reports; its help slot
(`footer[data-slot=help]`, after every step's content, 3.2.6) shows them before the language selector
with the copy keys `screen.helpLink` and `screen.privacyLink`, each `target="_blank"` and
`rel="noopener noreferrer"`; a screen's `link` button names the screen's own links (the preview's)
else the session's. A link is kept only when `new URL(url).protocol` is `https:`.

**The renderer's hook is not placed** (`flow-renderer.tsx` is shared): until `integration-9b` adds
`useReportSessionLinks()` and its call in `accept`, the live flow shows no link (contractDeviations).

### RED (`8cfd25c2`)

```
$ (cd apps/flow && pnpm exec vitest run src/components/flow-links.test.tsx --coverage.enabled=false)
     × keeps each https: link and drops a missing one
     × shows the help and privacy links a session names, after the step, opened safely
     × shows only the links the newest session names, and none that is not https:
     × gives the screens the links it knows
     × names the session's link once the layout knows it, and stays out while it does not
      Tests  5 failed | 3 passed (8)
$ (cd apps/flow && pnpm exec tsc --noEmit)   # exit 0
```

### GREEN (`bf59e180`)

```
$ (cd apps/flow && pnpm exec vitest run src/components/flow-links.test.tsx src/screens src/app.test.tsx src/flow --coverage.enabled=false)
 Test Files  20 passed (20)
      Tests  308 passed (308)
```

## Final gates

Each in the foreground, each exit read from the command itself (heavy calls through
`/tmp/openverify-heavy.sh`), with the load average beside each timing.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm --filter @openverify/checks test` | exit 0; 182 files, 3,826 tests, 98.79% statements, 91.65% branches; 34.8 s (load 11.9) |
| `pnpm --filter @openverify/flow test` | exit 0; 117 files, 1,479 tests, 95.15% statements, 88.39% branches; 2m02s (load 11.4-15.3) |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` (mocked suite) | exit 0; 158 passed in 1m05s (load 14.1-17.0) |
| API unit, 6 blob shards (`--maxWorkers=3`) | 5m49s, 7m09s, 6m08s, 6m18s, 6m40s, 8m39s (load 8-20); each exits 1 on its partial coverage alone |
| API unit merge | exit 0; 636 files, 8,721 tests, 94.24% statements, 84.68% branches, 96.6% functions, 94.41% lines (29 s, load 10-13) |
| `pnpm turbo run typecheck --force` (checks, api, flow) | exit 0; 3 of 3 tasks, 3m07s (load 10-14) |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1` (checks, api, flow) | exit 0; 3 of 3 tasks, 10m08s (load 13-16; the call outlived the 10-minute tool cap and its exit was read from its own output) |
| `pnpm --filter @openverify/db test:integration` | exit 0; 17 files, 78 tests, 2m37s (load 16.5-32) |
| `vitest --config vitest.integration.config.ts --project graph` | exit 0; 13 tests, 58 s, the template built in 28.2 s of its 180 s guard (load 20-31) |
| `--project api --shard=1/3`, `2/3`, `3/3` | each exit 0; 81, 97 and 76 tests in 1m58s, 5m10s and 2m14s (load 20-32) |
| `pnpm exec prettier --check` over every file of this agent | exit 0 |

Not run, as the bullet says: no full-stack e2e (`integration-9b` runs the 9B specs), no other
package's tests. Rule 16's benchmark checks do not apply: no file it names changed.
