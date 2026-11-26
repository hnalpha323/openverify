# Phase 8, Workflow 8C Stage 1: dashboard-workflows

Evidence of the `dashboard-workflows` builder (C141 with C141.9, C142.4, the shared console files).
Every command ran after `source scripts/env.sh`; outputs are abbreviated, exit codes read from the
command.

## Slice 1a: the console dependencies (rule 3, C141.1, C142.3)

No behaviour, so no RED step: a `chore` commit, as Workflow 7C's `c14a8961` added Cytoscape.

Each version was read from the registry (`pnpm view <name> time --json`) and each licence from the
package's own LICENSE file under `node_modules/.pnpm` after the install, on 2026-11-03.

| Package | Version | Released | Licence (from its LICENSE file) | How it came |
|---|---|---|---|---|
| @xyflow/react | 12.12.0 | 2026-09-24 | MIT, "Copyright (c) 2019-2025 webkid GmbH" | catalog, apps/dashboard |
| @xyflow/system | 0.0.83 | 2026-09-24 | MIT, "Copyright (c) 2019-2025 webkid GmbH" | through @xyflow/react (exact) |
| zustand | 4.5.7 | 2025-05-15 | MIT, "Copyright (c) 2019 Paul Henschel" | through @xyflow/react (^4.4.0) |
| use-sync-external-store | 1.7.0 | 2026-09-09 | MIT | already in the lockfile (zustand ^1.2.2) |
| classcat | 5.0.5 | 2024-04-02 | MIT, "Copyright © Jorge Bucaran" | through @xyflow/react |
| d3-drag | 3.0.0 | 2021-06-09 | ISC, Mike Bostock | through @xyflow/system |
| d3-zoom | 3.0.0 | 2021-06-10 | ISC | through @xyflow/system |
| d3-selection | 3.0.0 | 2021-06-07 | ISC | through @xyflow/system |
| d3-interpolate | 3.0.1 | 2021-06-05 | ISC | through @xyflow/system |
| d3-transition | 3.0.1 | 2021-06-09 | ISC | through d3-zoom |
| d3-dispatch | 3.0.1 | 2021-06-05 | ISC | through d3-drag |
| d3-color | 3.1.0 | 2022-03-28 | ISC | through d3-interpolate |
| d3-ease | 3.0.1 | 2021-06-05 | BSD-3-Clause, Mike Bostock and Robert Penner | through d3-transition |
| d3-timer | 3.0.1 | 2021-06-05 | ISC | through d3-transition |
| @types/d3-color | 3.1.3 | 2023-11-07 | MIT, Microsoft | through @xyflow/system |
| @types/d3-drag | 3.0.7 | 2023-11-07 | MIT | through @xyflow/system |
| @types/d3-interpolate | 3.0.4 | 2023-11-07 | MIT | through @xyflow/system |
| @types/d3-selection | 3.0.12 | 2026-09-14 | MIT | through @xyflow/system |
| @types/d3-transition | 3.0.9 | 2024-10-07 | MIT | through @xyflow/system |
| @types/d3-zoom | 3.0.9 | 2026-09-29 | MIT | through @xyflow/system |
| @dagrejs/dagre | 3.1.1 | 2026-08-08 | MIT, "Copyright (c) 2012-2014 Chris Pettitt" | catalog, apps/dashboard |
| @dagrejs/graphlib | 4.0.5 | 2026-08-03 | MIT, "Copyright (c) 2012-2014 Chris Pettitt" | through @dagrejs/dagre (exact) |
| @panzoom/panzoom | 4.6.2 | 2026-04-02 | MIT (`MIT-License.txt`), "Copyright 2016-2019 Timmy Willison" | catalog, apps/dashboard |

**Every d3 module had a new release on 2026-11-03, the day of the install** (d3-drag 3.0.1,
d3-zoom 3.0.1, d3-selection 3.0.1, d3-interpolate 3.0.2, d3-transition 3.0.2, d3-dispatch 3.0.2,
d3-color 3.1.1, d3-ease 3.0.2, d3-timer 3.0.2, all within a few hours). pnpm 12's release-age
policy resolved each to the previous release (2021 and 2022) on its own, added no
`minimumReleaseAgeExclude` entry and no override was needed. A same-day release of nine packages
is what the release-age rule exists for; the 2026-11-03 versions are not adopted.

No package has a build script (no `requiresBuild` in the lockfile diff), so no `allowBuilds` entry.
`elkjs` is not installed. THIRD_PARTY_LICENSES.md is not this agent's file; the rows are in the
report's followups for the API fixer.

```
$ pnpm install
✓ Lockfile passes supply-chain policies
Packages: +22
Done in 1.7s using pnpm v12.14.0                      (exit 0)
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped    (exit 0)
$ pnpm exec prettier --check pnpm-workspace.yaml apps/dashboard/package.json
All matched files use Prettier code style!            (exit 0)
```

## Slice 1b: the navigation (C141, C142; first slice)

Route scopes read from `apps/api/src/routes/server/{workflows,workflow-secrets}.ts` and the 8B route
tests (`case-routes.test.ts`, `case-queue-routes.test.ts`): `GET /workflows` workflows:read,
`GET /workflow-secrets` secrets:read, `GET /cases` cases:read, `GET /case-templates`
case-templates:read, `GET /case-queues`, `/case-assignment-policies`, `/case-sla-policies` and
`/case-calendars` case-queues:read. Two groups join after Risk: "Cases" (Cases, Case templates,
Queues, Case settings) and "Automation" (Workflows, Secrets), so `/inquiries` stays the home page.

RED (`b6166bde`):
```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/nav-items.test.ts src/components/nav.test.tsx --coverage.enabled=false
 × lists every C23 console route ...  AssertionError: expected [ …(21) ] to deeply equal [ …(27) ]
 × group the case pages ...           AssertionError: expected undefined to deeply equal [ { href: '/cases', …(2) }, …(3) ]
 × shows an admin everything; × is the console navigation, with a labelled list per group
 (exit 1)
```
GREEN (`41c632cd`): 63 passed with the proxy file below (exit 0).

## Slice 1c: the proxy matcher (C142.7, F32)

RED (`2e59653f`): `/cases/<id>/attachments` and `/cases/<id>/attachments/` matched
(`AssertionError: expected true to be false`). GREEN (`7ebd3c3e`): the matcher's negative lookahead
gains `cases/[^/]+/attachments/?$`; `/cases/<id>`, `/cases/<id>/attachments/<catt>`,
`/case-templates/x/attachments` and `/x/cases/case_1/attachments` stay matched.

## Slice 1d: the mock routes pattern (first slice)

`testing/routes/<area>.ts` stands alone over `routeApi()` (documents, graph, lists, network, people,
records, report-config, transactions at `1f0510b9`): each exports its own `serve…` helpers taking the
`RouteApi` a test made. `dashboard-cases`' `testing/routes/cases.ts` and `dashboard-reviewer`'s
`testing/routes/reviewer.ts` follow it with no registration point, so none was added.

## Slice 1e: the inquiry and account page slots (C128.1, C141.7, C142.4, F32)

Stubs (`c67a8591`): `components/workflows/inquiry-decisions-section.tsx`
(`InquiryDecisionsSection({ inquiryId, status, redacted, permissions })`) and
`components/workflows/account-actions-section.tsx` (`AccountActionsSection({ accountId,
permissions })`), each answering `null`.

RED (`a5716bd9`):
```
$ pnpm --filter @openverify/dashboard exec vitest run decisions-section.test workflow-actions-section.test --coverage.enabled=false
 × calls it with the account id and the permissions, under workflows:trigger
   AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 × calls it with the inquiry, its status, whether it was redacted and the permissions
 × tells it a redacted inquiry is redacted; × shows the forbidden panel ... (both pages)
 Tests  5 failed | 3 passed (8)   (exit 1)
```
GREEN (`713e68bd`): the inquiry page chains the slot on the inquiry read (its status decides
reopen) in the same `Promise.all`, the account page awaits it under `workflows:trigger` (the route
needs `workflows:trigger` and `accounts:read`); each is a `SlotSection` ("Decision records",
"Workflow actions"). `vitest run src/app/inquiries src/app/accounts src/components/lifecycle`:
352 passed, 1 failed, the failure being `dashboard-reviewer`'s committed RED `f8318d68` (inquiry
images through `/files/:id/rendition`), not this slice.

## Slice 2: the inquiry decision records and reopen (C128.1, C128.6, C142.4)

Stub `49f50591` (`reopenInquiry`, fixtures, `testing/routes/workflows.ts`). RED `090548f4`:
`vitest run src/components/workflows/inquiry-decisions-section.test.tsx src/app/inquiries/actions.test.ts`
→ 11 failed (`Unable to find an accessible element with the role "article" and name "Declined"`,
`expected { ok: false, … } to deeply equal { ok: true, … }`, `expected undefined to deeply equal
[ '/comment' ]`), exit 1. GREEN `155c4ba9`: 50 passed. The test helper reads each term by its `dt`
text, because a `term` has no name from its content (changed in the GREEN commit).

`3a187541`: five existing inquiry page suites (`page.test.tsx`, `signals-section`,
`reports-section`, `reports/rsc-payload`, `testing/rsc-payload-signals`) gained
`serveDecisions(api, [])` once the slot read `GET /decisions`; no assertion changed. The whole
dashboard run after 155c4ba9 had shown 41 + 11 failures there (`Unexpected API request: GET
/decisions`), all fixed by this commit (141 passed).

## Slice 3: the account page workflow actions (C118.7, C141.7)

Stubs `6ebd2a24`. RED `45fdde83`: 14 failed (`expected 'text' to be 'number'`, `Unable to find an
accessible element with the role "group" and name "Workflow actions of this account"`), exit 1.
GREEN `aa38eb66`: 32 passed. Parameters are typed from the declared input type (C115.3 DSL), a
`null` prefill stays empty ("A value hidden from you stays empty"), a value that does not hold its
type is refused at `/data/parameters/<name>` without calling the API.

## Slice 4: the workflow and run words (C120.1, H32, C121.5)

Stub `ce…` then RED `54067ecf`: 15 failed (each list's missing words), exit 1. GREEN `bec50510`:
16 passed; each test walks the core list (`WORKFLOW_*` in `@openverify/core`) first.

## Slice 5: the workflows page, recipes and the run page (C120.6, C140.5, C141.6)

Stubs `001af904`. RED `65fea860`: 11 failed (`Unable to find … table "Workflows"`, `"Steps of this
run"`, `text: Status, which matches selector 'dt'`), exit 1. GREEN `c74b87c5`: 61 passed. In the
GREEN commit the RSC payload assertions of slices 2, 3 and 5 gained the missing `await` on
`rscPayloadOf` (async): without it they passed on a promise.

## Slice 6: the audit link of a workflow run (C121.1, C141.6)

RED `…` (3 failed: no link to `/workflows/runs/<wfr>`, `workflow` and `workflow-run` resources not
linked), GREEN `78f5568d`: 105 passed.

## Slice 7: the workflow page (C121.5, C141.5, C141.6, 8A amendment 60)

Stub, RED `85fcf770` (7 failed), GREEN `1612d839` (70 passed): the `publisher_revoked` banner,
version history with `publisher_scope_lost`, runs filtered by `has-step-errors`, pause, activate,
archive. `af40ae2c` added server-action tests written after their GREEN (no RED seen).

## Gates (foreground, exit codes read from the command)

```
$ pnpm --filter @openverify/dashboard test        (load 4.69)
 Test Files  363 passed (363)   Tests  5118 passed (5118)
 All files | 96.13 | 89.03 | 96.09 | 96.18                     (exit 0)
$ pnpm format:check                                              (exit 0)
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force \
    --filter=@openverify/dashboard --filter=@openverify/e2e
 Tasks: 4 successful, 4 total                                    (exit 0)
$ pnpm --filter @openverify/dashboard test        (final, load 5.45)
 Tests  5 failed | 5157 passed (5162)                            (exit 1)
 the 5 failures: app/graph/[id]/page.test.tsx, app/graph/actions.test.ts,
 components/graph/bulk-actions.test.tsx, dashboard-cases' create-case button (C140.6) in flight
```

No full-stack spec of this agent exists yet (`e2e/tests/ui-workflows.spec.ts` was not written), so
the one-call e2e sequence was not run and no stack was started.
