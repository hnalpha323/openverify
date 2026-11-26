# Phase 9, Workflow 9B, Stage 3: `api-cases-reports` (TDD evidence)

The family (C) builder. It started after foundation-9b's (C) checkpoint (`4674f412`) and built C172.1 to C172.5, K8-27, C173.1 to C173.3 and the graph node expansion (owner decision 20 after Workflow 7B, contracts B42). B40 means C173.4 needed no build.

Every run below was made from `apps/api` after `source scripts/env.sh`. Iterating runs used `pnpm exec vitest run <files> --coverage.enabled=false --maxWorkers=2`. The output is abbreviated and copied from the run.

## Slices

| # | Slice | RED | GREEN (and later) |
|---|---|---|---|
| 1 | K8-27, the three named case problems | `545530ac` | `ba9d8c53` |
| 2 | Version members: layout, checklists, preset comments, required fields (C172.1 to C172.4) | `d63a4e33` | `cd876feb` |
| 3 | `POST /cases/:id/checklist` (C172.2, C172.7) | `a64927ba` | `1131a6ab` |
| 4 | The transition guard (C172.2, C172.3) | `dde6929c` | `2d67ea20` |
| 5 | Action placements and `visible-when` in available-actions and run-action (C172.5, P28) | `08a5a541` | `68101be3` |
| 6 | `latest-run-notes` (C173.1) | `60ef8ad5` | `7260f893` |
| 7 | `include=files` and `redacted-at` (C173.2) | `679bfa4e` | `dc29d06a`, then `47f67c54` |
| 8 | The print audit (C173.3) | `6380de9f` | `4a8c338c` |
| 9 | The graph node expansion (B42) | `8d3a48df` | `73309d3b` |
| 10 | Typecheck and lint fixes, refactor | | `b4371e20`, `5121b90a` |

### 1. K8-27

RED: `vitest run src/services/cases/layout/named-problems.test.ts src/services/cases/attachments/attachments.test.ts`. Exit 1, with 5 failed and 14 passed.

```
× names a publish refusal, keeping each error’s code and pointer
AssertionError: expected undefined to be 'case_template_invalid'
× names a search the grammar refuses ...  expected undefined to be 'case_search_invalid'
× retries a scan error up to three attempts ... expected undefined to be 'attachment_scan_failed'
```

GREEN: the three throws, together with `search-bulk.test.ts` and `templates.test.ts`. Exit 0, with 35 passed.

### 2. Version members

RED: `version-members.test.ts` plus the plumbing test's fail-closed template tests, rewritten to expect the built behaviour. Exit 1, with 9 failed:

```
AssertionError: {"status":501,"detail":"A case template version's layout, checklists, preset-comments, requires-fields is not built yet (api-cases-reports)." ...}: expected 501 to be 201
AssertionError: expected [ 501, 501, 501, 501, 201 ] to deeply equal [ 201, 201, 201, 201, 201 ]
```

GREEN: `src/services/cases/layout/ src/phase9b-cases-reports-plumbing.test.ts src/services/cases/templates.test.ts`. Exit 0, with 31 passed.

### 3. The checklist route

RED: `checklist.test.ts` plus the plumbing test's 501 test, rewritten to expect 422 for a checklist the version does not hold. Exit 1, with 5 failed:

```
AssertionError: {"status":501,"detail":"Checking a case checklist item is not built yet (api-cases-reports)."...}: expected 501 to be 200
AssertionError: expected [ 501, 501, 501, 501 ] to deeply equal [ 409, 403, 404, 410 ]
```

GREEN, first run: exit 1, with 2 failed. Both were defects in the RED test, not in the service:

- `audit_logs` was empty. The harness records through a recording logger (`api.audit`), not the table.
- The redacted case answered 200. The harness's redaction port is a fake, so `DELETE /cases/:id` changed nothing.

The test was changed after its RED commit. It now reads `api.audit.withAction('case.updated')` and marks the case redacted by SQL, as `actions/service.test.ts` does. Exit 0, with 4 passed.

### 4. The transition guard

RED: `guard.test.ts`. Exit 1:

```
× refuses a status an unchecked required item names, then the fields it requires, then allows it
AssertionError: {"data":{"type":"case",...,"status":"approved",...}}: expected 200 to be 422
```

GREEN: `src/services/cases/checklists/ src/phase9b-cases-reports-plumbing.test.ts`. Exit 0, with 17 passed.

### 5. Action placements and visible-when

RED: `action-visibility.test.ts` plus the plumbing test's fail-closed action test. Past the guard, that test's workflow and action ids are unknown, so it now expects 404. Exit 1, with 5 failed:

```
AssertionError: {"status":501,"detail":"A case action's placement, visible-when is not built yet (api-cases-reports)."...}: expected 501 to be 201
AssertionError: expected [ 501, 501, 501, 501, 501, 400 ] to deeply equal [ 404, 404, 404, 404, 404, 400 ]
```

GREEN, first run: exit 1, with 1 failed. The cause was a defect in the RED test: `error: malformed array literal`, because the role assignment's `environment_ids` was bound as a JS array. The test was changed after its RED commit to `${'{<env>}'}::text[]`. Exit 0, with 40 passed, `actions/service.test.ts` included.

### 6. latest-run-notes

RED: `latest-run-notes.test.ts`. Exit 1, with 2 failed and 1 passed (the left-out case already held):

```
AssertionError: expected undefined to deeply equal [ 'report_errored', 'recurring_limit' ]
AssertionError: expected undefined to deeply equal []
```

GREEN: `src/services/reports/`. Exit 0, with 29 passed.

### 7. include=files and redacted-at

RED: `verifications-include-files.test.ts`, which replaces the 501 test. Exit 1, with 3 failed:

```
AssertionError: {"status":501,"detail":"include=files is not built yet (api-cases-reports, Workflow 9B)."...}: expected 501 to be 200
AssertionError: expected undefined to be null
```

GREEN (`dc29d06a`): exit 0, with 3 passed. In the neighbouring files, `phase5-masking.test.ts` failed 18 tests: its type-attribute helper did not exclude the new common attribute. Its helper now excludes `redacted-at`, beside `created-at`. That is an existing test changed by the plan. Those files then passed: 67 passed.

The first API unit merge then failed 27 tests in 8 files on the always-served `redacted-at: null`. One of them is `cases/includes.test.ts`, which holds K8-19's rule that an included verification reads as its own route serves it. `47f67c54` serves `redacted-at` only once the verification was redacted with its inquiry and leaves it out before. The member is optional (B38), and an unredacted verification now reads the same at every exit. The five Phase 5 exit-test helpers read it as a common attribute, which is an existing-test change. The C173.2 test was changed to expect the member left out before redaction. Rerun: exit 0, with 123 passed.

### 8. The print audit

RED: `phase9b-print-audit-routes.test.ts`, which replaces the 501 test. Exit 1, with 2 failed:

```
AssertionError: {"status":501,"detail":"Recording a print is not built yet (api-cases-reports)."...}: expected 501 to be 201
AssertionError: expected [ 501, 501, 501, 501, 501, 401 ] to deeply equal [ 404, 404, 404, 404, 201, 401 ]
```

GREEN, first run: exit 1, with 1 failed (`[404, 404, 201, 201, 201, 401]`). The cause was a defect in the RED test: the harness gives an operator `admin` unless `roles` is set, so the custom-role operator was also an admin. Two changes were made after the RED commit:

- the test passes `roles: []`;
- `recorded-at` is read from the stored entry's time, which the service answers, rather than the injected clock.

Exit 0, with 4 passed.

### 9. The graph node expansion

RED: `expand.test.ts` plus the plumbing test's 501 test, which now expects 404 for an unknown query. Exit 1, with 5 failed:

```
AssertionError: {"status":501,"detail":"Expanding a graph node (integration-9b) is not built yet."...}: expected 501 to be 201
TypeError: Cannot read properties of undefined (reading 'id')
```

GREEN, first run: exit 1, with 1 failed (`column "params_sealed" ... does not exist`). The cause was a defect in the RED test: the sealed column is `params`. The test was changed after its RED commit. Exit 0, with 16 passed.

### 10. Typecheck and lint

The forced typecheck after slice 9 failed 3 errors, all in my GREEN code:

- `checklists/service.ts` imported `AuditActor` from ports and had a switch with no ending return;
- `expand.ts` set `'max-hops'` to a value its type refuses.

`b4371e20` fixed them:

- the expansion runs at `max-hops: 2`, since a start value is hop 0 and its holders hop 1, so nothing goes past them;
- a retired key's answer is built without a search.

The forced API lint then failed 4 errors, again in my files: unnecessary assertions and conditions. `5121b90a` fixed them and asserts `isExpansionStart`.

**Process.** From `1131a6ab` to `b4371e20`, about 40 minutes, the API package did not typecheck on the shared tree because of `checklists/service.ts`, and from `73309d3b` because of `expand.ts`. I ran no typecheck between those GREEN commits.

## Final gates

Each gate was read from its own exit code.

| Gate | Result | Time and load |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | |
| `pnpm exec prettier --check` on every file written | exit 0 | |
| Forced lint, API (`NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api`) | exit 0 | 5m53s; load 17.8 at start |
| Forced lint, db and contracts | exit 0 | 2m53s; load 6.0 at start |
| Forced typecheck: api, db, contracts | exit 0 | 1m32s |
| `pnpm --filter @openverify/contracts test` | exit 0; 4,381 tests, 99.11% statements | 24 s; load 4.0 |
| `pnpm --filter @openverify/db test` | exit 0; 150 files, 2,172 tests, 91.07% statements | 2m41s; load 6.4 to 12.5 |
| API unit, 6 blob shards (`--maxWorkers=3`) | each exits 1 on partial coverage alone, as rule 8 says | 398, 429, 434, 407, 429 and 404 s; load 8 to 15 |
| API unit merge | **exit 1** (see below); 683 files, 9,277 tests, 94.26% statements, 84.8% branches | 36 s |
| `pnpm --filter @openverify/db test:integration` | exit 0; 78 tests | 107 s; load 9.2 to 19.9 |
| API integration, `--project graph` | exit 0; 13 tests; template built in 17,050 ms of its 180 s guard | 36 s; load 19.1 to 13.8 |
| API integration, `--project api`, shards 1, 2 and 3 | exit 0 each; 89, 99 and 79 tests | 81, 204 and 89 s; load 13 to 19 |

**The API unit merge failed 4 tests, none of them mine.** All four are in `services/templates/flow-run-grants.test.ts`, which is `api-templates-finish`'s RED commit `e37c4992`; its GREEN, `2b07816e`, landed during my shards. Run alone afterwards, that file exits 0 with 4 passed. No other test failed, and the 80% gate held at 94.26%.

The two unformatted files `apps/api/src/services/cases/resources.ts` and `apps/api/src/services/reports/reports.ts` were already unformatted at `4674f412`; `.prettierignore`'s bare `services/` pattern hides them. Only my own lines in them are formatted.

**The API unit gate, run again after the other agent's GREEN**, at `9452b3d9`, with all six blob shards and `--maxWorkers=3`:

- The shards took 432, 447, 457, 483, 502 and 421 s, at a load of 12 to 15. Shards 2, 4, 5 and 6 waited for a slot (exit 75) before they ran.
- **The merge exited 0:** 684 files, 9,304 tests, none failed, 94.36% statements, 84.94% branches, in 42 s.
