# TDD evidence: Workflow 8B Stage 2, `case-logic` (Phase 8)

- **Slice owner:** the Workflow 8B Stage 2 `case-logic` agent, beside `foundation-8b`.
- **Date:** 2026-11-03.
- **Base:** `808bb32f`, the end of the second `contracts-8b` call.
- **Input:** C131.1, C132.3, C133.3 to C133.6, C137.2 and F30 of `docs/plans/phase-8.plan.md`, the "case-logic" bullet, the Workflow 8B Stage 1a amendments 1 to 45, and `docs/research/phase8-editor-cases.md` sections 3 and 4.
- **Owned paths:** `packages/core/src/cases/{case-state-machine,assignment,search,pointer}.ts` with their tests and `temporal-boundary.test.ts`; `apps/api/src/services/cases/sla/{business-time,sla-state}.ts` with their tests. The three export lines in the shared `packages/core/src/cases/index.ts` were added in the first commit, as its header says `case-logic` does.

Each slice went stub (`chore`), RED (`test`), GREEN (`feat`), then one `refactor`. Every value in the tests is synthetic: ids are made-up ULIDs, emails are at example.com, and the one identifier-shaped field value (`000-00-0000`) is there to prove a problem never quotes it. All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter, and every exit code was read from the command itself.

## Commits

| Slice | Stub | RED | GREEN | Refactor |
|---|---|---|---|---|
| Core: status machine, assignment, search (C131.1, C132.3, C137.2) | `12fa0aae` | `0e4e1719` | `6d78f32b` | `d236b099` |
| API: business time and SLA state (C133.3, C133.5) | `12fa0aae`, `0cc25c6e` | `fe3a8f9e` | `e08d603f` | |

`0cc25c6e` is a second stub: the differential test needed `resolveLocalTime`, and `expireSla` gained a `target` so a sweep's expiry folds the running segment into `consumedMs` like every other exit from `running`.

## 1. The case status machine (C131.1)

`packages/core/src/cases/case-state-machine.ts`: `decideCaseTransition(machine, current, request)`, `initialCaseStatus(machine)`, `caseTransitionMapProblems(statuses, transitions)`.

```
$ (cd packages/core && pnpm exec vitest run src/cases/case-state-machine.test.ts src/cases/assignment.test.ts src/cases/search.test.ts src/cases/temporal-boundary.test.ts --coverage.enabled=false)
RED    Test Files  3 failed | 1 passed (4)
       Tests  136 failed | 8 passed (144)          72 x "Error: not built", 1 x "expected [Function] to throw /initial/ but got 'not built'"
GREEN  (case-state-machine.test.ts alone) Tests  40 passed (40)
```

The 8 tests that passed at RED: the four temporal-boundary guards (the invariant they guard already held), and four that read constants (the refusal codes, the problem codes, the edge count and the ineligibility order).

One test was wrong on the way to GREEN, not the code: "escapes a pointer token" gave the defaults a map holding only the odd key, so `approved` and `declined` were also (correctly) unreachable. The test now spreads the default map beside that key.

What it decides, a test per edge (the twelve default edges, then the review desk's map):
- the status must exist; the map must allow the move; then the entered status's rules: the resolution, the status tag, the comment, in that order;
- into `end`: `case.status-updated` then `case.resolved`, with `meta.resolution` (exact match), else the status label when it is a resolution, else `null`;
- out of `end`: `case.status-updated` then `case.reopened`, resolution cleared;
- the same status: `no_change`;
- `caseTransitionMapProblems`: one `initial`, an `end`, distinct keys, map keys and targets known, no move to itself or repeated, every `end` reachable from `initial` (a walk). Pointers follow RFC 6901.

## 2. Assignment selection (C132.3, C132.4)

`packages/core/src/cases/assignment.ts`: `assigneeCapacity`, `assigneeIneligibility`, `manualAssigneeIneligibility`, `selectRoundRobin`, `selectFewestOpen`, `selectCreator`, `selectAssignee`, `compareUnassignedCases`.

```
GREEN  (assignment.test.ts alone) Tests  30 passed (30)
```

- Eligibility, checked in order: `inactive`, `no_permission`, `template_hidden`, `paused`, `at_capacity`. Capacity is the lower of the member's `max-open` and the policy's `max-capacity`, or `member-max-open-default` (50) for a policy user who is no member.
- A manual assignment checks only the first three (C132.3).
- Round-robin: user-id order (code units), the first eligible after the cursor, wrapping; a cursor of a member who left still reads as a place; nobody eligible leaves the case unassigned and the cursor unmoved. A six-turn test shows one turn per member per cycle.
- Fewest-open: fewest open, then least recently assigned (never assigned first), then user id, whatever order the candidates came in.
- The creators: that user if they are an eligible agent of the policy, else `creator_unknown` or `creator_ineligible`.
- History inputs are ids and counts only: `cursor`, `eligible`, `candidates`, `open-count`, `tied`, `creator`.
- `compareUnassignedCases('sla-expires-at')`: earliest deadline, none last, then `created_at`, then id. It is the pull's order too (C132.3).

## 3. The search parser (C137.2)

`packages/core/src/cases/search.ts`: `parseCaseSearchQuery(query, { isSearchableField }, pointer = '/query')` answers `{ ok, predicate, fieldKeys }` or `{ ok: false, problems }`.

```
GREEN  (search.test.ts alone) Tests  70 passed (70)
```

- A typed tree: `and`, `or`, `not`, and leaves `time`, `missing`, `equals`, `holds`, `tagged` and `field`, each attribute with its value's type.
- The checks:
  - depth (a group past two is refused without walking it; a 100,000-deep `not` chain answers at once);
  - 1 to 20 clauses;
  - exact leaf keys, read as own properties only;
  - the attribute, then the operator: ordering only on the four timestamps;
  - then the value: RFC 3339 with an offset, the right id prefix, status-key and tag formats, `eq null` only on the seven nullable attributes.
- `fields.<key>` must be searchable (the context says), compares by equality only, and is listed in `fieldKeys` for the PII rule (P25).
- Problems carry a code and a pointer, never the value, at most twenty.

## 4. temporal-polyfill outside core and the flow (F30)

`packages/core/src/cases/temporal-boundary.test.ts`, which passes from the start, because the invariant it guards already held:
- core declares no Temporal package;
- no source under `packages/core/src` imports one;
- no workspace package the flow can reach (`@openverify/flow` and the workspace packages it declares, transitively) declares one at run time, and that set holds neither `@openverify/api` nor `@openverify/workflow-engine`;
- only `@openverify/api` and `@openverify/workflow-engine` declare it.

## 5. Business time (C133.3)

`apps/api/src/services/cases/sla/business-time.ts`: `addBusinessTime(start, ms, calendar)`, `businessTimeBetween(a, b, calendar)`, `calendarProblems(calendar, now)`, `resolveLocalTime(timeZone, local)`, `BusinessTimeError` (`business_time_scan_exceeded`, `business_time_zone_unknown`, `business_time_invalid`). A `null` calendar is `24x7`.

```
$ (cd apps/api && pnpm exec vitest run src/services/cases/sla --coverage.enabled=false)
RED    Test Files  2 failed (2)
       Tests  76 failed | 7 passed (83)            57 x "Error: not built"; the rest expected a BusinessTimeError and received "not built"
GREEN  Tests  83 passed (83)
```

The 7 tests that passed at RED are the six fixture zones' offset assertions (they read Temporal alone) and the error's own shape.

The design choice, measured before writing it: one `PlainDateTime.toZonedDateTime` through the polyfill took 65 µs here (7,320 conversions in 475 ms, load 5.6). A ten-year scan converts every day's boundaries, which would have cost about half a second a call, and a two-year calendar check about two seconds. So a computation lists the zone's transitions once through `getTimeZoneTransition` (22 transitions in ten years read in 4.9 ms) and resolves each local time from them, as Temporal's own algorithm does: the offsets a day either side, a gap shifted forward (`compatible`), a repeat taking the earlier (`compatible`) or refused (`reject`). The differential test holds it to Temporal: every quarter hour of twelve dates around each 2026 transition, in seven zones (America/Santiago added), compared for the instant and the fold. It found no mismatch.

The tz fixtures each assert the runtime's offsets first: America/New_York (2026 and 2027), Europe/London, Asia/Kolkata, Australia/Lord_Howe (a 30-minute shift), Pacific/Chatham (+12:45 and +13:45), and America/Havana, which changes at midnight (2026 and 2027). The runtime: Node 22.22.1, ICU 78.2, tz 2025c.

The properties run on seeded random starts in 2026 and 2027 (mulberry32, seed `0x0c133`), 150 samples for each of seven calendars, `24x7` included:
- adding then measuring returns the input;
- the answer is the first such instant;
- adding is monotonic and composes (`add(add(s, x), y) = add(s, x + y)`);
- measuring is monotonic and additive.

Validation reads two years from the local date of `now`, holidays have no boundary, `24:00` is the next day's `00:00`, and closures count where they reach into the window.

## 6. The SLA state (C133.4, C133.5, C133.6)

`apps/api/src/services/cases/sla/sla-state.ts`: `CaseSla`, `NO_SLA`, `SlaTarget`, `SlaChange` (`{ changed: false }` or `{ changed, sla, history, fires }`), `startSla`, `pauseSla`, `resumeSla`, `resolveSla`, `reopenSla`, `recomputeSla`, `expireSla`, `clearSla`, `slaOnStatusChange`, `slaSecondsProblem`, `slaDurationSeconds`, `slaSecondsTarget`.

```
GREEN  (with business time) Tests  83 passed (83)
```

A seeded invariant test runs 200 random histories of 25 operations each (seed `0xc1335`). It holds four things:
- `expiresAt` is null exactly in `none` and `paused`, as the contract's refine says;
- the epoch never falls, and a segment is set exactly while the SLA is `running`;
- `fires` comes only with `expired`, and never twice in one epoch;
- `consumedMs` never goes below 0.

## Coverage of the owned files

```
$ (cd packages/core && pnpm exec vitest run src/cases --coverage.include='src/cases/{case-state-machine,assignment,search}.ts' ...)
assignment.ts 100 / 98.11 / 100 / 100     search.ts 100 / 99.21 / 100 / 100     case-state-machine.ts 100
$ (cd apps/api && pnpm exec vitest run src/services/cases/sla --coverage.include='src/services/cases/sla/{business-time,sla-state}.ts' ...)
business-time.ts 97.15 / 91.39 / 100 / 97.05     sla-state.ts 100 / 98.59 / 100 / 100     (statements / branches / functions / lines)
```

## Timings (each under `/tmp/openverify-e2e.lock`, with the load average)

- `src/services/cases/sla`, 83 tests: 3.17 s, load 8.65 before and 8.28 after. Differential test 149 to 302 ms a zone. Properties 71 to 166 ms a calendar. The full 3,660-day scan that ends in `business_time_scan_exceeded`: 51 ms. Havana's two-year check: 14 ms. The SLA invariants: 16 ms.
- `packages/core` `src/cases`, 171 tests (the 144 of this slice and the 27 of `contracts-8b`): 1.39 s, load 7.86 before and 7.95 after.

## Final gates (at `d236b099`, other agents running beside; each read from its exit code)

```
$ pnpm --filter @openverify/core typecheck        rc 0
$ pnpm --filter @openverify/core lint             rc 0
$ pnpm --filter @openverify/core test             rc 0   43 files, 1,390 tests, 99.83 / 98.4 / 100 / 99.83   (load 5.5 to 6.2)
$ pnpm --filter @openverify/api typecheck         rc 0
$ pnpm --filter @openverify/api lint              rc 0   (NODE_OPTIONS=--max-old-space-size=4096)
$ (cd apps/api && pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-i --shard=i/4 --reporter=blob --outputFile=<dir>/blobs/blob-i-4.json)
    shard 1: 3 min 54 s, load 2.7 to 11.7     shard 2: 4 min 1 s, load 10.0 to 10.9
    shard 3: 4 min 35 s, load 10.1 to 21.0    shard 4: 5 min 39 s, load 21.0 to 15.4
    each rc 1 on its partial coverage alone, with no failed test
$ (cd apps/api && pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged)
    rc 0   544 files, 7,978 tests; 94.86% statements, 86.08% branches, 96.55% functions, 94.99% lines   (12 s)
$ pnpm format:check                               rc 0
$ pnpm turbo run lint typecheck --force           rc 0   32 of 32 tasks, 6 min 45 s at load 30.2 to 7.3 (NODE_OPTIONS=--max-old-space-size=4096)
```
