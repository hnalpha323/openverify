# Phase 8, Workflow 8C Stage 1: dashboard-cases (C142.1, C142.7, C140.6)

The case console's lists and settings: the case list with the C129.5 filters, a column choice kept in the browser, bulk actions with each case's outcome, "next case", notifications; queues with their members, assignment policies; case templates and the version editor with publish in words; SLA policies and calendars (week, holidays, the CSV import, the two-year check); exports and the exports list; the graph explorer's "create case" button. Base `1f0510b9`; every commit path-scoped under `/tmp/openverify-git.lock`; nothing pushed.

Every shell ran `source scripts/env.sh` first. Unit runs while iterating: `pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false` (from `apps/dashboard`, `pnpm exec vitest run ...`). Each RED commit typechecked (`pnpm exec tsc --noEmit` in `apps/dashboard`, my files clean; the errors printed during the Workflow were other agents' in-flight files: `testing/routes/reviewer.ts`, `testing/workflow-fixtures.ts`) and failed at run time on its stubs.

## Slices

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| 1. Templates, a template, the version editor, publish in words (C130) | `828a512a` | `639c33f6` | `4d952ddb` |
| 2. Queues, members (capacity, paused), assignment policies (C132) | `fc732da4` | `67ab67f4` | `56440fd8` |
| 3. SLA policies, calendars, holiday CSV import, the two-year check (C133) | `3a72d37d` | `23120ede` | `6d6e3571` |
| 4. Case list, filters, columns, bulk actions and outcomes, next case, notifications (C129.5, C137, C134.4) | `7cf65d45` | `0680d365` | `7d03c579` |
| 5. Exports, the exports list, the download route (C138) | `1e2ba3cd` | `54d1d065` | `de409302` |
| 6. The graph explorer's create-case button (C140.6) | `135a0212` | `c1616d22` | `75a5782a` |
| 7. RSC payload of the list, templates and exports (P38) | (none) | `d1fb6806` (passed at once; see below) | (none) |
| 8. Next case from the queue the list is filtered by (C132.3) | `0b7e1c6f` | `e832cd4f` | `5cde0922` |
| 9. Full-stack spec `e2e/tests/ui-cases.spec.ts` | (none) | `d77ab6b3` (passed at once on the stack; see below) | (none) |

## Evidence

### Slice 1 (templates)

RED: `pnpm --filter @openverify/dashboard exec vitest run src/app/case-templates --coverage.enabled=false`, rc 1:

```
× creates a template by name and key, and answers its id
...
× answers not found for a version of another template
AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Case templates"
TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Version 2"
Tests  20 failed (20)
```

GREEN: same command, rc 0, `Tests 20 passed (20)`. A first GREEN run of `tsc` found `FIELD_TYPE_LABELS[field.type]` indexed by a plain string and lint found two `any` assignments of `expect.*` matchers in the RED test; both fixed before the GREEN commit (the test change is `as unknown` on two matchers).

### Slice 2 (queues and policies)

RED: `vitest run src/app/case-queues src/components/cases`, rc 1, `Tests 22 failed (22)` (`Unable to find ... "table" and name "Case queues"`, `expected { ok: false ... }`). GREEN: rc 0, `Tests 42 passed (42)` with slice 1. Lint then refused `as HTMLElement` on `T | undefined` and `!` in two RED tests; they now use an `nth` helper and a typed `vi.fn`, committed with GREEN (named in its message).

### Slice 3 (SLA and calendars)

RED: `vitest run src/app/case-settings src/components/cases/sla-forms.test.tsx`, rc 1, `Tests 14 failed (14)`. GREEN first run: 2 failed: the settings page asked for the calendar choices without `case-queues:write` (`expected { 'page[size]': '100' }`), and the file input's `required` kept jsdom from submitting (`expected "vi.fn()" to be called 1 times, but got 0 times`); both fixed in the implementation, then rc 0, `Tests 16 passed (16)`.

### Slice 4 (the case list)

RED: `vitest run src/app/cases/page.test.tsx src/app/cases/actions.test.ts src/app/cases/bulk src/app/cases/notifications src/components/cases/case-list.test.tsx src/components/cases/case-query.test.ts`, rc 1, `Tests 25 failed | 2 passed (27)` (the two that passed were refusals the stub also refuses). GREEN first run: 1 failed, the bulk body lacked `data.type`; added, then rc 0, `Tests 30 passed (30)`.

### Slice 5 (exports)

RED: `vitest run src/app/cases/exports src/components/cases/export-form.test.tsx`, rc 1, `Tests 12 failed (12)`. GREEN first run: 1 failed, the download passed on the client's `text/csv` without a charset; the route now names `text/csv; charset=utf-8` or `application/json; charset=utf-8` (the API writes both in UTF-8); rc 0, `Tests 12 passed (12)`.

### Slice 6 (graph create-case)

RED: `vitest run src/app/graph src/components/graph`, rc 1, `Tests 5 failed | 142 passed (147)`; the guard "does not offer it without cases:write" passed already. GREEN: rc 0, `Tests 147 passed (147)`. Only `app/graph/actions.ts`, `components/graph/bulk-actions.tsx`, `components/graph/graph-explorer.tsx` and `app/graph/[id]/page.tsx` changed, and their tests gained tests only (no existing assertion changed): `abilities.cases` is optional, so the Phase 7 tests' `abilities` literals stand.

### Slice 7 (RSC payload)

`vitest run src/app/cases/rsc-payload.test.tsx`: `Tests 4 passed (4)` on the built pages. A mutation that put `fields` in a list row made the second test fail (`× carries no field value and no filename on the case list even when the API answered them`), and the page was restored byte for byte. Recorded as a test written after its GREEN, as earlier Workflows recorded theirs.

### Slice 8 (next case from one queue)

RED: `vitest run src/components/cases/case-list.test.tsx`, `Tests 1 failed | 7 passed (8)`. GREEN: with the page test, `Tests 13 passed (13)`.

### Slice 9 (full stack)

The spec was written after the unit slices were GREEN and passed on its first run:

```
cat /proc/loadavg   # 1.64 4.86 5.54
flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-cases.spec.ts; rc=$?; pnpm --filter @openverify/e2e e2e:stack:down; exit $rc"
rc=0   18:47:09 to 18:48:56 UTC (107 s), load after 3.31 4.50 5.33
  ✓ a developer creates a template, meets a file field and a refused publish in words, and publishes (3.0s)
  ✓ a reviewer sets the status of a queue's cases in bulk, reads each outcome, and pulls the next case of the queue (5.6s)
  ✓ an admin exports a template's cases with personal data after the confirmation, and downloads the file (2.9s)
  ✓ a developer creates a calendar and imports holidays from a CSV, a bad row refused by number and reason (1.3s)
  4 passed (17.9s)
```

## Gates

Each read from its exit code, output to a file under the session scratchpad:

- `pnpm exec vitest run --coverage` in `apps/dashboard` (the package's test script with its 80% gate): rc 0, 374 files, 5,192 tests; all files 97.02% statements, 90.06% branches.
- `pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e`: rc 0, 4 of 4 tasks.
- `pnpm format:check`: rc 0.
- The full-stack spec sequence above: rc 0. The final run is in the report.

## Decisions and records

- **Publish problems in words.** `displayProblemOf` (a shared file) keeps each error's pointer and detail but not its `code`, so `publishCaseTemplateDraft` reads the API's 422 itself and words each code (`TRANSITION_MAP_WORDS`, the field codes) with its place ("Status 4: ..."). A code the console does not know keeps the API's detail. The same holds for `calendar_invalid`'s `dates` member, which the calendar actions read and name.
- **The case subset (F37)** is refused in words at each field's place before the API is asked (`caseFieldTypeProblems`), rather than through the contract's one message for the whole array.
- **The column choice** lives in `localStorage` (`openverify:case-list-columns`) through `useSyncExternalStore`, with the server snapshot as every column, so hydration never mismatches; every read and write is guarded, and a value the console did not write shows every column.
- **The list never carries a field or a filename:** each case is projected to ids, keys and words before it reaches the client component (`rowOf`), which the RSC payload test proves for a principal with `pii:view`.
- **Bulk outcomes** are read on their own page (`/cases/bulk/<cblk_>`), since the job is asynchronous; while pending or running the page says the outcomes are not known, never that nothing happened, with a refresh link (the console does not poll).
- **Next case** takes the queue the list is filtered by (`meta.case-queue-ids`), so a reviewer of several queues pulls where they look; without a queue filter it pulls from all of theirs.
- **Exports**: personal data is offered only with `pii:view` and sent only with the form's confirmation flag (`personal-data-confirmed`), which the action checks. The download is a `GET` route handler under `app/cases/exports/[id]/download/` that passes the API's status on (401, 403, 404 before completion, 410 after 24 hours) with no body.
- **Assignment policy sources** are typed one id per line and typed by prefix (`ctmpl_` or `cqueue_`); anything else is refused at its place.
- **Calendar closures** are shown read-only and kept as they are on save: C142.1 asks for the week, holidays, the import and the two-year result, and no closure editor.
- **`app/cases/layout.tsx`** wraps every case page in the console layout, `dashboard-reviewer`'s `app/cases/[id]/` included; it needs no layout of its own.
- **Process.** `components/cases/case-words.ts` was committed with the slice-1 stubs rather than after a RED test of its own: its tables are exhaustive `Record`s over the vocabularies, so typecheck holds them, and every function in it is exercised by the page and action tests that followed.
