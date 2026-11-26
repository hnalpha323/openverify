# Phase 7, Workflow 7C Stage 1: dashboard-lists-transactions (TDD record)

Agent `dashboard-lists-transactions` builds C108's lists and transactions consoles: the lists
index, creation, a list's page with items and imports, an import's page with its errors and their
CSV, the transactions index and detail, the transaction types editor, and the account page's
transactions section. Every slice went stub (where a test needed a name), RED, then GREEN. Each
RED below compiled, type-checked and linted, and failed at run time for the reason named.

Commands are run after `source scripts/env.sh`, from `apps/dashboard` unless said otherwise.

## Slice L: the lists console

- Stub `2a3162bf`: the page, action, words and CSV modules with empty bodies, the synthetic
  fixtures (`src/testing/lists-fixtures.ts`) and the mock routes (`src/testing/routes/lists.ts`).

### RED

```
$ pnpm exec vitest run src/app/lists src/components/lists --coverage.enabled=false
 Test Files  8 failed (8)
      Tests  54 failed | 4 passed (58)
```

Every failure is the stub's: the pages render nothing (`Unable to find role="heading"`), the
actions answer `{ ok: false, problem: { title: 'Not built' } }`, the words are empty records
(`expected undefined to match /^[A-Z][a-z]/`), the CSV writer returns its input, and the route
answers 501. The four passes are behaviour the stubs already had by accident: the CSV writer
leaving plain text alone (its identity stub), and three "asks the API nothing" checks.

### GREEN

```
$ pnpm exec vitest run src/app/lists src/components/lists --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  58 passed (58)
```

Three RED tests were wrong and were corrected in the GREEN commit, none weakened:
- the words test required `^[A-Z][a-z]` of every kind label, which "IP address" breaks; it now
  requires a capital first letter;
- the `retention_exceeds_consent` action test sent 9,999 days, which the contract schema refuses
  before the API is called; it now sends 400, which the schema passes and the API refuses;
- the list page tests render the import form, whose `useRouter` needs the navigation mock the
  creation page test already had; the face list test now also serves the settings it reads, and
  checks that the retention field's maximum is the face template window.

Files: `src/lib/api/lists.ts` (the reads, and `readBiometricAcknowledgement`), the pages under
`src/app/lists/`, the actions, `src/app/lists/importers/[id]/errors.csv/route.ts`, and the
components under `src/components/lists/`.

## Slice T: transactions, the types editor and the account section

- Stub `3a4716c4`: the transaction and type pages, the content route, the two action modules and
  the words module with empty bodies; the synthetic fixtures
  (`src/testing/transactions-fixtures.ts`) and mock routes (`src/testing/routes/transactions.ts`).
  `dashboard-signals` created the stub of `components/transactions/account-transactions-section.tsx`
  with its props frozen (`57c02981`); its body is this slice's.

### RED

```
$ pnpm exec vitest run src/app/transactions src/app/transaction-types src/components/transactions --coverage.enabled=false
 Test Files  10 failed (10)
      Tests  45 failed | 3 passed (48)
```

The failures are the stubs': the actions answer `Not built` (`expected { ok: false, … } to deeply
equal { ok: true, … }`), the pages render nothing (`Unable to find … role "table" and name
"Fields"`, `… "heading" and name "Transactions"`), the not-found checks resolve `null` instead of
throwing, the content route answers 501, the account section returns `null`, and the words are an
empty record. The three passes are "asks nothing" checks the stubs meet by doing nothing.

### GREEN

```
$ pnpm exec vitest run src/app/transactions src/app/transaction-types src/components/transactions --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  48 passed (48)
```

No RED test changed. Files: `src/lib/api/transactions.ts`, the pages and actions under
`src/app/transactions/` and `src/app/transaction-types/`, the content route
`src/app/transactions/[id]/files/[fileId]/content/route.ts` (through `getBffFetch`, `pii:view`
checked before the API is asked), the components under `src/components/transactions/` and
`src/components/transaction-types/`, and the body of
`src/components/transactions/account-transactions-section.tsx`.

## The full-stack UI specs

`e2e/tests/ui-lists.spec.ts` and `e2e/tests/ui-transactions.spec.ts`, with
`e2e/tests/support/ui-lists.ts` (roles signed in once per file through `signInAs`, kept browser
states, the API as a seeded operator through `sessionTokenAs`) and `e2e/tests/support/ui-transactions.ts`
(a published type made through the API, as the 7B spec makes one). Each test makes its own list,
type, account and transaction with random names and archives its list or type in `finally`; no
setting is changed. Budget 90 s each.

First run on a fresh reusable stack (`e2e:stack:up` after the build line):

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-lists.spec.ts tests/ui-transactions.spec.ts'
  1 failed
    [chromium] › tests/ui-transactions.spec.ts:88:1 › a transaction is masked for a developer, and a reviewer …
  3 passed (18.5s)
```

The failure was the spec's own: after the redaction it searched `page.content()`, and the document
still held the first load's payload, which the reviewer (with `pii:view`) was entitled to. The
spec now reloads before it searches. Second run:

```
  4 passed (15.2s)
```

## Characterisation tests of every list kind

`src/components/lists/list-items-table.test.tsx` and `src/components/lists/add-item-form.test.tsx`
walk `LIST_KINDS`: each kind's value as served with `pii:view`, Hidden for each masked value (the
class and country, not PII, still shown), and each kind's required fields. They were written after
GREEN and passed at once (15 tests); they pin the per-kind branches the page tests reach for one
kind only.

## A comment corrected

`6d8f36a8` (`docs(dashboard)`) corrects the doc comment of `RelatedObjects`, which said accounts join
`related-objects` "by reference or relation". `add-relation` writes no `transaction_objects` row, so
a relation is never a related object; only the `reference-id` on create adds an account. No behaviour
changed: an account row already offers no Detach, pinned by `app/transactions/[id]/page.test.tsx`.

## Final gates

Run after `source scripts/env.sh`, from the repository root, each with its output sent to a file and
its exit code read. Source files last changed at `1e036646`; only docs followed, to `b4ecd6c9`.

```
$ pnpm --filter @openverify/dashboard test --coverage.reportsDirectory=/tmp/openverify-7c/lists/coverage    # at bf286d49
exit 0
 Test Files  326 passed (326)
      Tests  4705 passed (4705)
All files          |   97.91 |    91.93 |   98.26 |   97.87 |

$ pnpm --filter @openverify/dashboard typecheck    # exit 0, at bf286d49
$ pnpm --filter @openverify/dashboard lint         # exit 0, at bf286d49

$ pnpm format:check                                # exit 0, at 1e036646
All matched files use Prettier code style!

$ pnpm turbo run lint typecheck --force            # exit 0, at 1e036646
 Tasks:    30 successful, 30 total
Cached:    0 cached, 30 total
  Time:    4m48.284s

$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e    # at 10390144
exit 0
  79 passed (23.4s)
```

`git diff 10390144 HEAD -- apps/flow packages` is empty, so the flow run stands.

The full-stack gate, on one stack (`stack.json` 15:52:41 local, unchanged through all three shards),
built at `b4ecd6c9`, with no other agent's run in between:

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...'    # exit 0
$ flock -w 120 /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up                                                          # exit 0
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --shard=1/3'
exit 0
  37 passed (3.0m)
$ ... --shard=2/3
exit 0
  37 passed (5.6m)
$ ... --shard=3/3
exit 0
  32 passed (5.5m)
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:down    # exit 0
```

That is 106 tests. `ui-lists` (2 tests, shard 2), `ui-transactions` (2, shard 3) and `ui-selfie` (2,
shard 3, fixed by `dashboard-signals` in `10390144`) all pass, each test under 7 s.

## Why earlier attempts at this gate failed

Three agents ran this gate at once, on one working tree and one stack. None of these was a defect in
the product or in this area's specs.

- **The stack went away (twice).** Shard 2 at 19:38 and shard 3 at 19:51 stopped with `no reusable e2e
  stack is running`: another agent's rule 7(a) restart, after it changed `apps/`. No test ran.
- **Mixed builds.** Shards 1 and 2 passed on one stack and shard 3 (32 passed) on the next, after
  `d6102ecb` changed every page's client entry. These were not counted as a gate. On that next stack
  shard 3 ran before shard 1, which rule 7(c) does not allow.
- **Two tests failed on a stack that had already run shard 1.** Shard 1 at 20:05 answered:

  ```
  exit 1
    ✘  33 tests/operators.spec.ts:55:1 › an admin enrolled in TOTP signs in with password and code …
    ✘  35 tests/phone-otp.spec.ts:36:1 › a phone number is confirmed with the code the sandbox sender …
    2 failed
    35 passed (2.9m)
  ```

  - `phone-otp`: the send answered 429 `otp_rate_limited` ("Too many codes were asked for"), so the
    flow stayed on the number form. The stack's `api.log` shows 12 sends allowed from 19:53:40, and
    the 13th refused at 20:07:18: `dashboard-signals`' shard 1 (5), this agent's shard 3 (2),
    `dashboard-signals`' shard 2 (1), and this shard 1's first 4, which then reached `phone-otp`.
  - `operators`: line 104 expects the default template on the first page of
    `inquiryTemplates.list()`, newest first. Every earlier run's templates push it off that page.

  The log names the code, not the rule. The counts fit `otp-ip-hour` (10 an hour, every spec from
  loopback): 10 plus the 2 a 13.6-minute span refills. That is an inference, not a logged fact. The
  second agent's shard 1 on the next stack (`signals/shard-1b.log`) failed `operators` the same way
  with no shard 3 before it, so the trigger is a repeated shard 1, not the order of the shards.

A clean gate makes 8 sends (5, 1 and 2 by shard), so it stays inside the limit when it has the stack
alone.
