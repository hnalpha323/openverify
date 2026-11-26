# Phase 7, Workflow 7C Stage 1: dashboard-graph (C108's graph explorer)

The console's graph surfaces: the explorer (canvas and table view of one stored result), query
templates and their drafts, run, rerun and cancel, bulk actions with a preview and a confirmation,
the CSV export streamed as the API answers it, the audited click-to-unmask, the account page's
graph section, and the accessibility, CSP and RSC payload tests.

Every command ran after `source scripts/env.sh`. Outputs are abbreviated to the lines that matter.

## Slice 1: the graph in words

Stub `52d7d531` (the names, so the test typechecks). RED `e3e6bc11`, GREEN `fbf03987`.

RED:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/graph-words.test.ts --coverage.enabled=false
     × names every kind, and draws each node type with its own shape and colour, so no kind is told by colour alone (WCAG 1.4.1)
     × gives every node colour at least 3:1 against the canvas background (WCAG 1.4.11)
     × says every query status in words
     × says every problem code and every bulk outcome in words, never passing or failing anyone
     × titles a graph problem with its words and keeps the API detail, pointer and request id
     × names the template publish refusals in words
     × says what the caps cut and what the index lacks, in words
AssertionError: expected '' to match /^[A-Z]/
      Tests  7 failed (7)
```

GREEN:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/graph-words.test.ts --coverage.enabled=false
      Tests  7 passed (7)
```

## Slice 2: the explorer model, the result summary, the table view and the unmask

Stubs, fixtures and mock routes `3b7ba869`; RED `96e86f89`; GREEN `5e1fe152`.

RED (`src/components/graph`, the four new files; the words test stays green):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph --coverage.enabled=false
     × reads a stored result as nodes and links, each tagged with the query it came from
     × merges an expansion around an account: known accounts once, new elements added, the rest kept as they were
     × never grows past the node limit of 2,000, and says how many it left out
     × says in words that the index is still being built, which kinds it lacks, and what the caps cut
     × calls the audited unmask only on an explicit press, never on hover or focus, then shows the value
     × says a 429 in words / × says a 410 in words / × says a 404 in words
     × selects accounts by keyboard alone, one by one or all at once (WCAG 2.1.1)
     × offers to unmask a value only with pii:view
     × expands around an account by an explicit button, never around a shared value
AssertionError: expected [] to have a length of 1999 but got +0
TestingLibraryElementError: Unable to find an accessible element with the role "checkbox" and name "Select acc_01JC0000000000000000000101"
      Tests  19 failed | 7 passed (26)
```

GREEN:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph --coverage.enabled=false
      Tests  26 passed (26)
```

## Slice 3: the graph server actions

Stub `ab6aff86`'s parent (`chore(dashboard): stubs of the graph server actions`); RED `09bcb2e2`;
GREEN `ab6aff86`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/graph/actions.test.ts --coverage.enabled=false
     × asks the audited unmask route for one value
     × applies it through the node client, which sends an Idempotency-Key, and answers each outcome
     × runs it synchronously when asked, and says a refused run in words
     × expands around an account by running the template synchronously with account_id bound
     × creates a template, then a draft holding its configuration (the first draft has no route), and opens it
     × saves a draft and says, in words and at their pointers, what publishing would refuse
     × publishes a draft, and says a refusal in words at each pointer
      Tests  17 failed | 6 passed (23)
```

The six that passed against the stub are the refusals (no `pii:view`, a missing scope, a bad
node id, the export sent as JSON, not an account, no `graph:write`): the stub refuses everything,
so they pass for the wrong reason until GREEN, where they pass because the guards refuse before
any API call (each asserts no request was sent).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/graph/actions.test.ts --coverage.enabled=false
      Tests  23 passed (23)
```

## Slice 4: bulk actions

Stub `chore(dashboard): stub of the graph bulk actions panel`; RED `5310e66f`; GREEN `171d09b2`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/bulk-actions.test.tsx --coverage.enabled=false
     × offers only the actions the role may take
     × previews first, then applies after a confirmation, and says each account’s outcome in words
     × acts on every account of the result with all, and refuses all above 500 accounts
     × downloads the export through its own route after a preview, posting the same selection
      Tests  7 failed (7)
$ (GREEN)
      Tests  7 passed (7)
```

## Slice 5: the export route

Stubs `chore(dashboard): stubs of the graph export fetch and its route handler`; RED `458aadb7`;
GREEN `716db1fc` (and `9b36075a`, a lint fix in the test).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/graph.test.ts "src/app/graph/[id]/export/route.test.ts" --coverage.enabled=false
     × posts the export action with the session, an Idempotency-Key of its own and the BFF headers, and answers the raw response
     × streams the API’s CSV as it answers it, as a download that is never stored
     × refuses a post from another origin, calling nothing
     × reduces an API 403 to 403, saying it in words and never passing the problem on
      Tests  17 failed | 1 passed (18)
$ (GREEN)
      Tests  18 passed (18)
```

The one that passed against the stub is "answers null without a session" (the stub answers null).

## Slice 6: the canvas model

Stub `chore(dashboard): stub of the canvas model and the cytoscape-fcose module declaration`;
RED `513c5aa9`; GREEN `41d472c3`. The incremental layout runs the real Cytoscape.js 3.34.3 and
cytoscape-fcose 2.2.0 headless.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/canvas-model.test.ts --coverage.enabled=false
     × draws on the canvas renderer with WebGL off and lays out with fCoSE, never animating
     × labels nodes by kind and by account id only: no value ever reaches the canvas
     × gives each node type its shape and colour, and marks a selection by a thick outline as well as colour
     × adds an expansion without moving any node already laid out
Error: A `name` must be specified to make a layout
      Tests  4 failed (4)
$ (GREEN)
      Tests  4 passed (4)
```

## Slice 7: the canvas

Stub `chore(dashboard): stub of the graph canvas`; RED `0fa38a0c`; GREEN `2dbb6da6`. The test runs
the real Cytoscape.js and fCoSE headless (jsdom has no canvas) behind the component's `load`
seam, recording the options the component gave. GREEN also fixed the RED test's double, which
passed the `renderer` option through to the headless core (a canvas renderer needs a canvas).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/graph-canvas.test.tsx --coverage.enabled=false
     × loads Cytoscape.js only when it mounts, on the canvas renderer with WebGL off and fCoSE without animation
     × has a text alternative and a legend naming each kind’s shape (WCAG 1.1.1, 1.4.1)
     × shares the selection with the table: a node selected on the canvas, and a row selected in the table
     × adds an expansion to the drawing without moving the nodes already drawn
     × zooms and pans by buttons, so nothing needs a drag (WCAG 2.5.7)
      Tests  7 failed (7)
$ (GREEN)
      Tests  7 passed (7)
```

## Slice 8: the explorer

Stub `chore(dashboard): stub of the graph explorer`; RED `cf96c544`; GREEN `9f151f58`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/graph-explorer.test.tsx --coverage.enabled=false
     × opens on the table view, the default for keyboard and screen-reader users, with the canvas a press away
     × shares one selection between the views, and bulk actions act on it from either
     × expands around an account by running the template with account_id bound, merging the new result in place
      Tests  5 failed | 1 passed (6)
$ (GREEN)
      Tests  6 passed (6)
```

The first GREEN attempt failed "expands around…" (`Expanded around : 2 nodes added.`): the
action's success callback read the account from an earlier render. The account now travels with
the action's answer.

## Slice 9: the explorer page

Stub `chore(dashboard): stub of the graph query explorer page, and a synthetic list fixture`;
RED `c7de620e`; GREEN `e581c066`.

```
$ pnpm --filter @openverify/dashboard exec vitest run "src/app/graph/[id]/page.test.tsx" --coverage.enabled=false
     × shows the result’s summary, its template, and the explorer on the table view, without running anything
     × hides the unmask and the actions that need pii:view from a developer, who sees each parameter’s name only
     × offers a principal with graph:read only no run, no expansion and no bulk action
      Tests  10 failed (10)
$ (GREEN)
      Tests  10 passed (10)
```

## Slice 10: the template forms

Stubs `chore(dashboard): stubs of the graph template forms`; RED `b539d6f9`; GREEN `da9cd7d5`,
then `7e731875`: the GREEN commit did not typecheck (the run action's `state: null` did not fit
`useFormAction`; the typecheck had timed out under load and was not re-run before the commit).
Found by the next typecheck and fixed at once, before anything built on it.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/template-forms.test.tsx --coverage.enabled=false
     × creates a template from a starter configuration that publishes as it is
     × shows a refusal at its pointer inside the configuration, in words
     × saves a draft, then says at each pointer and in words what publishing would refuse
     × runs a template with a labelled field for each parameter and the hint of its kind
     × keeps a person-identifying parameter from a principal without pii:view, saying why
      Tests  5 failed (5)
$ (GREEN)
      Tests  5 passed (5)
```

## Slice 11: the index, templates and version pages

Stubs `d2a227f5`; RED `cdf82a04`; GREEN `00d5ae30`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/graph/pages.test.tsx --coverage.enabled=false
     × lists the queries newest first with their status and whether the index was complete, in words
     × lists the templates and offers to create one with graph:write
     × shows a template: its published configuration, the run form, a new draft and its rename and archive
     × edits a draft as JSON and publishes it after a confirmation, with graph:write
      Tests  10 failed | 1 passed (11)
$ (GREEN)
      Tests  11 passed (11)
```

## Slice 12: the account graph section

The stub is `dashboard-signals`' (`916669ee`). RED `6f809ca0`; GREEN `f986e01c`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/graph/account-graph-section.test.tsx --coverage.enabled=false
     × offers the active, published templates that bind account_id, and runs nothing on render
     × shows the direct connections of the account on an explicit press, and opens the result in the explorer
     × puts no parameter value or node value in the RSC payload for a principal without pii:view
      Tests  7 failed (7)
$ (GREEN)
      Tests  7 passed (7)
```

## Slice 13: the RSC payload of the graph pages

`84f2c526`: a guard over code already GREEN, so it passed when written. To show it is not vacuous
it was run once against a mutated `app/graph/[id]/page.tsx` that read a node's value on render
and put it in the title (restored from a copy, never committed):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/graph/rsc-payload.test.tsx --coverage.enabled=false
     × carries, for a principal without pii:view, each parameter’s name but no parameter value and no node value
     × never carries a node value, even for a principal with pii:view: only an explicit unmask asks for one
AssertionError: expected true to be false // Object.is equality
      Tests  2 failed | 1 passed (3)
$ (unmutated)
      Tests  3 passed (3)
```

## Slice 14: the full-stack specs (C108)

`e2e/tests/ui-graph.spec.ts` and `e2e/tests/support/ui-graph.ts`, committed in `eefc3bb5` while
the CSP test was still red, so that another agent's shard would not pick up untracked files. Each
run below is rule 7(b) on a fresh stack.

The first run of the previous session (`/tmp/opencode/dg-e2e1.txt`) failed on two counts:

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-graph.spec.ts'
  ✘  1 [chromium] › tests/ui-graph.spec.ts:62:1 › a reviewer runs a template, reads, unmasks, tags and exports a result by keyboard alone, with the canvas a key press away (C102-C103, C108) (3.4s)
  ✘  2 [chromium] › tests/ui-graph.spec.ts:189:1 › a 2,000-node result opens on the canvas under a nonce script CSP with no violation (C108, F33) (53.5s)
    Error: strict mode violation: getByRole('table', { name: 'Shared values' }).getByRole('rowheader', { name: 'Address' }) resolved to 2 elements:
    +   "Loading the script 'http://localhost:37269/_next/static/chunks/0b-esmd_hbxmb.js' violates the following Content Security Policy directive: \"script-src 'self' 'nonce-aU1NqQ2lSLkfQjxDMI9kwA==' 'strict-dynamic'\". [...]",
    +   "script-src-elem http://localhost:37269/_next/static/chunks/0b-esmd_hbxmb.js",
    +   "script-src eval",
```

The first was the spec's own locator (`Address` also matches "Email address (unconfirmed)"), now
`exact: true`. The second was two separate violations, slices 15 and 16.

## Slice 15: no eval probe under a script CSP (F33)

The temporary probe (never committed, removed) placed the violation at
`script-src eval .../0b5ptau8dghyt.js:1:4407` on `/graph/<id>` but not on `/accounts`: zod 4's
`allowsEval` probe, which the browser reports even though zod catches the error. The flow already
solved this in `apps/flow/src/security/csp-safe-zod.ts`, so the dashboard makes the same call in
Next's client entry, `src/instrumentation-client.ts` (an agreed exception to this area's paths).
The draft that mirrored constants and forbade value imports (`graph-limits.ts`,
`client-imports.test.ts`) is deleted: it was never committed, and it could not have cleared a
chunk that shared components reach too.

Stub `81779967`; RED `e69511a8`; GREEN `1a0442b8`:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/instrumentation-client.test.ts --coverage.enabled=false
     × turns off zod’s JIT, so it never probes eval under a script CSP 24ms
AssertionError: expected undefined to be true // Object.is equality
      Tests  1 failed | 1 passed (2)
$ (GREEN)
      Tests  2 passed (2)
```

`next` ran the file ahead of the contracts chunks, so the call did not need to move: the spec
shows it (slice 18).

**Found by measuring the build, slice 18.** `import { z } from 'zod'` in a file that runs on every
page took all of zod into a root main chunk. RED `2bff7512`; GREEN `d6102ecb`, which imports `config` from `zod/v4/core`. The setting lives on
`globalThis.__zod_globalConfig` (zod 4.6.7, `v4/core/core.js`), so every copy reads it.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/instrumentation-client.test.ts --coverage.enabled=false
     × imports zod’s config alone: this file runs on every page, and zod’s schemas would too 22ms
AssertionError: expected [ 'import { z } from \'zod\';' ] to deeply equal [ Array(1) ]
      Tests  1 failed | 2 passed (3)
$ (GREEN)
      Tests  3 passed (3)
```

## Slice 16: the injected CSP covers the bootstrap preload

The second violation, `script-src-elem .../0b-esmd_hbxmb.js` at document position `1:321`, was on
`/accounts` as well as on `/graph/<id>`, so the graph did not cause it. The document's start shows
what sits there (from `/login`, whose head is the same):

```
222 <link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/0b-esmd_hbxmb.js"/>
320 <script src="/_next/static/chunks/1m7-ngw4qoatq.js" async="">
```

It is the bootstrap script's preload link, which ends at 320, and a preload is checked against
`script-src`. The helper put a nonce only on `<script`. In a real nonce deployment React's server
renderer gives this very link the nonce (`react-dom-server.node.development.js`, in
`createRenderState`: `rel: "preload", as: "script", fetchPriority: "low", nonce: nonce`). So this
was a limit of the injection, not a script loading without a nonce, and not a finding against the
dashboard. `injectNonceCsp` now nonces the link as well. `recordCspViolations` filters nothing, and
the policy and the 2,000 nodes are unchanged.

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-graph.spec.ts'
  ✘  1 [chromium] › tests/ui-graph.spec.ts:62:1 › a reviewer runs a template, [...] (1.5m)
  ✓  2 [chromium] › tests/ui-graph.spec.ts:189:1 › a 2,000-node result opens on the canvas under a nonce script CSP with no violation (C108, F33) (25.1s)
```

## Slice 17: the console's own export was refused (a real defect, found by the full stack)

With the locator fixed, the keyboard test ran to the export and hung on the download. The browser
had landed on the route's refusal:

```
- generic [active] [ref=f1e1]: "Your role cannot export this result: it needs accounts:read and pii:view beside graph:read."
```

The reviewer holds every scope that sentence names, and `api.log` shows three `POST
/graph-queries/:id/actions` calls (the add-tag preview, the add-tag, the export preview), so the
API never saw the export: `sameOrigin` in `app/graph/[id]/export/route.ts` refused it. The console
sends `Referrer-Policy: no-referrer`, so a browser's form post says `Origin: null`, which `new
URL()` rejects. Chromium, on a throwaway server sending the same header:

```
$ node /tmp/openverify-7c/graph/probe/origin-probe.mjs
 "sameOriginForm": { "origin": "null", "site": "same-origin", "mode": "navigate", ... },
 "crossSiteForm": { "origin": "null", "site": "cross-site", "mode": "navigate", ... }
```

Every export from the console would have failed in a real browser. The unit test could not see it:
it set `origin` itself. The server actions were not affected: the add-tag preview and the add-tag
went through in the same run. `Sec-Fetch-Site` still tells the two apart; `same-site` stays refused,
because a sibling site's post carries a Lax cookie.

RED `1a58ac6e` (the three refusals passed from the start, and guard the fix); GREEN `5c04c15a`.

```
$ (cd apps/dashboard && pnpm exec vitest run src/app/graph/ --coverage.enabled=false -t 'POST /graph/:id/export')
     × accepts the console’s own form post with Sec-Fetch-Site same-origin 9ms
     × accepts the console’s own form post with Sec-Fetch-Site absent, as on plain HTTP, where the Lax session cookie still guards 2ms
AssertionError: expected 403 to be 200 // Object.is equality
      Tests  2 failed | 18 passed | 47 skipped (67)
$ (GREEN)
      Tests  20 passed | 47 skipped (67)
```

The next run reached the CSV and failed on the spec's own assumption of an unquoted header. The
API's writer quotes every cell (C100.6, `packages/checks/src/csv`), so the spec now pins that:

```
    Expected: "account-id,reference-id,status,tags,hop-distance,linking-kinds"
    Received: "\"account-id\",\"reference-id\",\"status\",\"tags\",\"hop-distance\",\"linking-kinds\""
```

## Slice 18: the explorer's chunks, measured

From the production build (`apps/dashboard/.next/e2e`, Turbopack, `next` 16.4.2), with a script
that reads the static chunks and each route's `page_client-reference-manifest.js`. It lives in
scratch (`/tmp/openverify-7c/graph/probe/measure-chunks.py`); gzip is level 9.

| Chunk | Holds | Raw | Gzip |
|---|---|---:|---:|
| `31nlv7ips-mk5.js` | Cytoscape.js core | 430,021 B | 133,851 B |
| `0jowu5i2l3gy9.js` | cytoscape-fcose, cose-base, layout-base | 121,596 B | 32,502 B |
| **Fetched on the canvas press** | | **551,617 B** | **166,353 B** |
| `2ldntzafho73a.js` | the explorer's own client code (static on `/graph/[id]`) | 44,826 B | 15,456 B |

```
== chunks holding a marker
0jowu5i2l3gy9.js: 121596 B raw, 32502 B gzip -9; {'cytoscape': ['cytoscape'], 'fcose': ['fcose', 'layoutBase']}
2ldntzafho73a.js: 44826 B raw, 15456 B gzip -9; {'cytoscape': ['cytoscape'], 'fcose': ['fcose']}
31nlv7ips-mk5.js: 430021 B raw, 133851 B gzip -9; {'cytoscape': ['cytoscape']}
== 59 route manifests
== routes whose manifest names a marker chunk
/graph/[id]: ['2ldntzafho73a.js'] (7 chunks, 438784 B raw)
== routes naming none: 58 of 59
```

No route manifest names either library chunk, and 58 of the 59 routes name no marker chunk at all.
`2ldntzafho73a.js` matches only because its loader names the two packages. The manifests cannot
show a dynamic chunk, so the keyboard test also checks in the browser (`recordScripts`,
`holdsGraphLibrary`): no script holding either library is fetched on the template page or the table
view, and exactly two are after the Canvas view key press.

The same measurement caught the cost of slice 15's first import. Root main files, on every page:

| `instrumentation-client.ts` imports | Raw | Gzip | Zod's schemas in a root chunk |
|---|---:|---:|---|
| `{ z } from 'zod'` | 557,741 B | 164,002 B | yes (`3sp5el-6-n3uf.js`, 115,131 B) |
| `{ config } from 'zod/v4/core'` | 457,856 B | 136,950 B | no |

That saves 99,885 B raw and 27,052 B gzip on every page. Route totals on the final build: `/accounts`
43,271 B, `/inquiries` 43,272 B, `/graph` 34,994 B, `/accounts/[id]` 444,628 B, `/graph/[id]`
438,784 B (raw, route chunks only, without the root main files).

After both fixes, on a fresh stack:

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-graph.spec.ts'
  ✓  1 [chromium] › tests/ui-graph.spec.ts:65:1 › a reviewer runs a template, reads, unmasks, tags and exports a result by keyboard alone, with the canvas a key press away (C102-C103, C108) (2.7s)
  ✓  2 [chromium] › tests/ui-graph.spec.ts:199:1 › a 2,000-node result opens on the canvas under a nonce script CSP with no violation (C108, F33) (24.4s)
  2 passed (30.2s)
```

Both fit the 90 s budget, so the CSP test needs no budget of its own.

## Slice 19: the final gates

Each passed on the command's own exit code, read from the shell, with its output sent to a file.
All ran on commit `bf286d49` or on code identical to it (the only later commit is this record).

```
$ pnpm --filter @openverify/dashboard typecheck                                       exit 0
$ pnpm --filter @openverify/dashboard lint                                            exit 0
$ pnpm --filter @openverify/dashboard test --coverage.reportsDirectory=/tmp/openverify-7c/graph-coverage    exit 0
 Test Files  326 passed (326)
      Tests  4705 passed (4705)
All files          |   97.91 |    91.93 |   98.26 |   97.87 |
 ...mponents/graph |   94.73 |     85.2 |   95.83 |   94.41 |
 .../src/app/graph |   97.95 |    93.22 |     100 |    97.9 |
 ...app/graph/[id] |     100 |    96.77 |     100 |     100 |
 ...ph/[id]/export |   93.33 |    89.47 |     100 |   93.18 |
$ pnpm format:check                                                                   exit 0
$ pnpm turbo run lint typecheck --force                                               exit 0
 Tasks:    30 successful, 30 total
Cached:    0 cached, 30 total
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e                   exit 0
  79 passed (31.6s)
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --shard=1/3'    exit 0
  37 passed (2.7m)
$ ... --shard=2/3    exit 0
  37 passed (5.1m)
$ ... --shard=3/3    exit 0
  32 passed (8.9m)
```

**The three shards did not run on one stack.** Three agents ran this gate at once, and each one's
"fresh stack" step took down the stack another had just started, which rule 7 allows for. Shard 1
ran on one stack; shards 2 and 3 ran on a later one, built from the same tree.

**A shard 2 run failed first, and that failure is explained here rather than retried away:**

```
  ✘   4 [chromium] › tests/report-inquiry.spec.ts:58:1 › reports run when an inquiry completes, [...]
    Error: No email to e2e-report-d6e8d68d@example.test arrived in Mailpit within 30000 ms
  1 failed
  36 passed (5.0m)
```

The page read "We cannot send you a code right now", and `api.log` held one 429 on `POST
/api/v1/flow/verifications/:id/otp`, the eleventh send on that stack. `otp-ip-hour` allows 10 sends
an hour per environment and address (`OTP_LIMITS`, C55.7), and every spec shares 127.0.0.1.
`dashboard-signals`' `shard-1b.log` ended at 15:23:59, between my shard 1 and my shard 2 on that
stack, so shard 1 had run twice on it. No spec sorting before `report-inquiry` changed
since Workflow 7B. The rerun on a fresh stack made one send, answered 200, and passed. So the
budget was spent by running a shard twice on one stack; neither a test nor the product was at
fault, and nothing was changed for it. The API log of that first run was lost with its stack, so
the eleven sends are not attributed one by one.
