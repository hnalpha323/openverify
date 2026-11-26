# K7C-2: a transaction's relations are served and shown

TDD evidence for K7C-2, which closes the last C108 gap of Phase 7 and item 2 of "dashboard-lists-transactions" in `docs/plans/phase-7.plan.md`. The decisions are in the plan's K7C-2 amendment. The commands and outputs below were run on this tree; long output is cut to the lines that matter.

## The migration decision, measured first

The primary key is `(environment_id, transaction_id, relation_schema_key, target_id)`, and `created_at` is outside it. `transaction_status_history` and `transaction_labels` each have an index for this read; `transaction_relations` did not. A `many` relation has no cap in `TRANSACTION_LIMITS`.

A throwaway `pgvector/pgvector:pg17` container held 100,000 relations on one transaction and one each on 999 others:

```
$ docker exec -i k7c2-plan-probe psql -U postgres -q < probe.sql
=== WITHOUT the index: first page
   ->  Parallel Seq Scan on transaction_relations (actual time=0.009..8.835 rows=50000 loops=2)
   Sort Method: top-N heapsort  Memory: 26kB
   Buffers: shared hit=1584
 Execution Time: 19.490 ms
=== WITHOUT the index: a deep page
 Execution Time: 18.123 ms
=== WITH the index: first page
   ->  Index Scan using transaction_relations_transaction_created_at_idx on transaction_relations
         Index Cond: ((environment_id = 'env_a'::text) AND (transaction_id = 'txn_big'::text))
   Buffers: shared hit=1 read=3
 Execution Time: 0.059 ms
=== WITH the index: a deep page
         Index Cond: (... AND (ROW(created_at, relation_schema_key, target_id) < ROW(...)))
 Execution Time: 0.087 ms
exit=0
```

So the index is added, and the row comparison is an index condition with no sort. The probe's index had a shorter name than the one committed.

## The repository and the migration

**RED** (`b61ed6cd`):

```
$ pnpm exec vitest run --coverage.enabled=false src/repositories/transaction-repositories.test.ts src/migrate.test.ts src/migration-0026.test.ts
 FAIL  src/migrate.test.ts > migrations > adds the relations page index in 0026 and touches nothing else (K7C-2)
AssertionError: expected undefined to be '0026_transaction_relations_page_index' // Object.is equality
 FAIL  src/migration-0026.test.ts > migration 0026: the relations page index > answers a deep page from the index, in its order, with no sort
AssertionError: expected 'Limit  (cost=8.19..8.19 rows=1 width=…' to contain 'transaction_relations_transaction_cre…'
 FAIL  src/repositories/transaction-repositories.test.ts > a transaction’s relations, a page at a time (K7C-2, C108) > ... (six tests)
TypeError: listTransactionRelationsPage is not a function
 Test Files  3 failed (3)
      Tests  8 failed | 51 passed (59)
```

`applies on top of 0025, keeping the rows` passes at RED because no 0026 exists yet. It guards the upgrade once one does.

**GREEN** (`06c97ef6`): `drizzle-kit generate --name transaction_relations_page_index`, then `prettier --write drizzle`, with no hand edits. The SQL is the one `CREATE INDEX`. `listTransactionRelationsPage` reads the page, and `listTransactionRelations` stays for the cardinality check.

```
$ pnpm --filter @openverify/db test
 Test Files  103 passed (103)
      Tests  1543 passed (1543)
exit=0
```

## The route, the contract and the SDK

**RED** (`87063a97`):

```
$ pnpm exec vitest run --coverage.enabled=false src/services/transactions/relations.test.ts      # apps/api
Error: expected HTTP 200, got 404: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches GET /api/v1/transactions/txn_01M6D1N650WR33QHJQPDHSF1W3/relations.", ...}
AssertionError: expected 404 to be 403 // Object.is equality
AssertionError: expected undefined to be defined
 Test Files  1 failed (1)
      Tests  7 failed (7)

$ pnpm exec vitest run --coverage.enabled=false src/transactions.test.ts src/vocabulary.test.ts  # packages/contracts
TypeError: Cannot read properties of undefined (reading 'safeParse')
AssertionError: expected [ Array(93) ] to deeply equal [ Array(94) ]
 Test Files  2 failed (2)
      Tests  4 failed | 36 passed (40)

$ pnpm exec vitest run --coverage.enabled=false src/resources.test.ts                            # packages/node
TypeError: c.transactions.relations is not a function
 Test Files  1 failed (1)
      Tests  1 failed | 172 passed (173)
```

**GREEN** (`94287ffd`):

```
 Test Files  1 passed (1)        Tests  7 passed (7)        # the route
 Test Files  3 passed (3)        Tests  356 passed (356)    # transactions, vocabulary, fixtures
 Test Files  1 passed (1)        Tests  173 passed (173)    # resources
```

The new golden fixture is named in the Android contract test's list of server-only fixtures, as K7B-4's were:

```
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*ContractFixturesTest*'
BUILD SUCCESSFUL in 41s
exit=0
```

## The console

**RED** (`d17531a1`):

```
$ pnpm exec vitest run --coverage.enabled=false 'src/app/transactions/[id]/page.test.tsx'
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Relations"    (five tests)
AssertionError: expected undefined to be '2026-10-30T10:30:00.123456Z~payer~acc…' // Object.is equality
AssertionError: expected undefined to be null
 Test Files  1 failed (1)
      Tests  7 failed | 15 passed (22)
```

The last two fail because the page never asks for the relations, so `api.find` finds no such request.

`ui-transactions.spec.ts` was also run RED, on a fresh stack with the API built and the console change set aside:

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e exec playwright test tests/ui-transactions.spec.ts'
    Error: expect(locator).toContainText(expected) failed
    Locator: getByRole('table', { name: 'Relations' })
    Expected substring: "No relation is set."
    Error: element(s) not found
  1 failed
    [chromium] › tests/ui-transactions.spec.ts:166:1 › a relation that was set is shown linked to its target, and gone once removed (C105, C108, K7C-2)
  2 passed (1.9m)
e2e exit=1
```

**GREEN** (`3985f13f`). One correction to the RED test on the way: a `DataTable` is itself a region named by its caption, so `getByRole('region', { name: 'Relations' })` matched two elements, the table's and the section's, as "Related objects" would. The note's absence is now asserted on the whole page, which is the stronger check.

```
$ pnpm exec vitest run --coverage.enabled=false 'src/app/transactions/[id]/page.test.tsx'
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

Test changes outside the new tests: `offers the status, label, objects, relations and tags…` lost its assertion that the "serves no list" note is visible, because the brief removes that note. `shows a viewer the list and no form…` and `shows an operator…` now pin its absence. No other test changed, and none was weakened.

## The final gates, at `3985f13f`, in the brief's order

```
$ pnpm turbo run lint typecheck --force
 Tasks:    30 successful, 30 total
lint-typecheck exit=0

$ pnpm --filter @openverify/db test
 Test Files  103 passed (103)    Tests  1543 passed (1543)    Lines 94.97%    exit=0
$ pnpm --filter @openverify/contracts test
 Test Files  72 passed (72)      Tests  2665 passed (2665)    Lines 99.12%    exit=0
$ pnpm --filter @openverify/node test
 Test Files  8 passed (8)        Tests  321 passed (321)      Lines 99%       exit=0
$ pnpm --filter @openverify/api test
 Test Files  444 passed (444)    Tests  5964 passed (5964)    Lines 95.71%    exit=0
$ pnpm --filter @openverify/dashboard test
 Test Files  327 passed (327)    Tests  4782 passed (4782)    Lines 97.92%    exit=0

$ pnpm format:check
All matched files use Prettier code style!
format exit=0

$ pnpm --filter @openverify/api openapi:write
openapi:write exit=0
$ git diff --exit-code docs/api/openapi.json
openapi diff exit=0

$ pnpm turbo run build --filter=@openverify/e2e^...
build exit=0
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e exec playwright test tests/ui-transactions.spec.ts'
[e2e +62.5s] stack ready; logs in e2e/.artifacts/logs
Running 3 tests using 1 worker
  ✓  1 tests/ui-transactions.spec.ts:36:1 › a developer creates a type, opens its first draft, ... (3.0s)
  ✓  2 tests/ui-transactions.spec.ts:93:1 › a transaction is masked for a developer, ... (4.8s)
  ✓  3 tests/ui-transactions.spec.ts:166:1 › a relation that was set is shown linked to its target, and gone once removed (C105, C108, K7C-2) (1.9s)
[e2e +75.8s] removing the openverify-e2e compose project and its volumes
  3 passed (1.3m)
e2e exit=0
stack containers left: 0
```

That stack ran the migrations on real Postgres, so 0026 applied there as well as on PGlite.
