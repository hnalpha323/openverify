# Phase 8, Workflow 8A, Stage 3: `api-egress`

C124 (Make HTTPS Request and the guard), C125 (workflow secrets), C126 (messaging) and the Evaluate
Code action over `code-sandbox`'s runner. Base `4f65134b`. Commands run from `apps/api` unless they
name a package, after `source scripts/env.sh`, with `--coverage.enabled=false` while iterating.

## Slices

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| Guard, registry fixture, `normalizeHost`, settings check | `bbde04c0` | `bf64fbf4` | `dadcd047` |
| Policy client | `43ba24bc` | `6753b5d3` | `c7e007e8` |
| HTTPS client pool | `d717478d` | `20e19f8b` | `674b2d3b` |
| Secrets repository | `e431851b` | `3aed67da` | `72e82c77` |
| Secrets service and routes | none, the routes answered 501 | `485ef965` | `b40677c9` |
| Make HTTPS Request, scrubbing, budgets, audit | `fc0dc481` | `34997b26` | `42953d4c` |
| Links, sandbox lists, Slack adapter | `6d5db618` | `33436b54` | `ec8a879e` |
| Messenger | stub of Stage 1b | `fa4504b7` | `4df894eb` |
| Email, SMS, Slack and code handlers | none | `10e9c8b6` | `dc4cfcc8` |
| The canary | none | see below | the same commit |

## RED, in order

- Guard: `pnpm exec vitest run src/webhooks/ssrf.test.ts src/webhooks/iana-special-purpose.test.ts src/workflows/actions/https`: `Test Files 3 failed | 1 passed`, `Tests 72 failed | 407 passed`. The registry fixture passed at once: the guard already held every row of 2026-10-13, and the EKS addresses, NAT64 prefixes, `allowLoopback` and `allowCidrs` were what failed.
- Policy client: `Tests 47 failed | 1 passed`, each against the stub's `not built`.
- Pool: `Tests 5 failed`, each `not built`.
- Repository: `Tests 30 failed`, each `WorkflowRepositoryNotBuiltError`.
- Secrets routes: `Tests 25 failed | 1 passed`, each a 501.
- HTTPS action and scrubber: `Test Files 2 failed`, `Tests 71 failed | 5 passed`.
- Links, lists, Slack: `Test Files 4 failed`, `Tests 31 failed | 68 passed`.
- Messenger: the test was written beside the code, so the RED was taken by putting the committed stub back in the working file for one run, then restoring the file: `Tests 88 failed`, each `The workflow messenger is not built yet`.
- Email, SMS and Slack handlers: the same way, with `EGRESS_ACTION_HANDLERS` empty for one run: `Tests 16 failed | 1 passed`, each `provider_not_configured`.
- Evaluate Code: the same way, with `execute` answering `execution_error` for one run: `Tests 25 failed`.
- Canary: run with the messenger's scrubber turned off for one run: `AssertionError: expected [ …(2) ] to deeply equal []`, the two sandbox bodies holding the link tokens; restored, `Tests 1 passed`.

## GREEN

- `pnpm exec vitest run src/webhooks src/workflows/actions/https src/http src/routes/dashboard`: `Tests 973 passed`.
- `pnpm exec vitest run src/http`: `Tests 87 passed`.
- `pnpm --filter @openverify/db exec vitest run src/repositories/workflow-secrets.test.ts src/repositories/secret-plumbing.test.ts`: `Tests 33 passed`.
- `pnpm exec vitest run src/services/workflow-secrets src/routes/secret-routes.test.ts`: `Tests 65 passed`.
- `pnpm exec vitest run src/workflows/actions/https`: `Tests 160 passed`.
- `pnpm exec vitest run src/workflows/actions/messaging src/workflows/messaging-plumbing.test.ts src/providers/slack src/http`: `Tests 139 passed`.
- `pnpm exec vitest run src/workflows/actions/messaging/messenger.test.ts`: `Tests 88 passed`.
- `pnpm exec vitest run src/workflows/actions/messaging/handlers.test.ts src/workflows/actions/code`: `Tests 42 passed`.
- `pnpm exec vitest run --config vitest.integration.config.ts --project api src/workflows/actions/messaging/canary.integration.test.ts`: `Tests 1 passed`, 16 s, Postgres 17, Valkey 9.1 and RustFS 1.0.3.
- `pnpm exec vitest run --config vitest.integration.config.ts --project api src/workflows/actions/https/guard.integration.test.ts`: `Tests 11 passed`.

## What a test caught

- A reuse test asserted one socket for two requests in a row. undici marks a client free a tick after the body ends, so the second request could open a new connection. The pool's own promise is the client it hands out, so the test asserts that identity, deterministically.
- A 429 test left a retry queued, which a later test's drain played. Each test now empties the queue first.
- `acceptMissingContentType` is pinned to the trust-store sync by a test in `http/index.test.ts`, so the policy client reads a 204 by its empty body instead of opting in.
- gitleaks refused `const SECRET = 'wsec_...'` in a test as a generic API key. It is reworded, never ignored.

## Final gates (at `e669de80`, each exit code read from the command)

| Gate | Result | Load |
|---|---|---|
| `pnpm install --frozen-lockfile` | rc 0 | 1.2 |
| `pnpm format:check` | rc 0 | 1.2 |
| `pnpm turbo run lint typecheck --force --concurrency=4` under a 4 GB heap | rc 0, 32 of 32, 5 min 17 s, at `0c791e64`; three test files changed after it, and each was linted on its own, rc 0 | 2.8 to 4.2 |
| `pnpm turbo run test --force --continue --concurrency=4 --filter=!@openverify/api` | **rc 1**: 14 of 15, 9 min 53 s; the one failure is `code-runner/pool.test.ts`, "finds no canary of an earlier evaluation in the same child", which answered `timeout` | 34.8 falling to 2.0 |
| `pnpm --filter @openverify/workflow-engine test` alone | rc 0, 1,904 tests, 97.99% statements | 1.5 |
| API suite, four blob shards and a merge | each lone shard rc 1 on its partial coverage only; merge rc 0, 7,638 tests in 525 files, 95.03% statements | 8 to 13 |
| `pnpm test:integration` | rc 0, 5 min 31 s | 3 to 15 |
| `benchmark:typecheck`, `benchmark:test` | rc 0, rc 0 | 8.5 |
| `pnpm --filter @openverify/flow e2e` | rc 0, 79 passed in 22.9 s | 8.5 |
| Full-stack gate on one fresh stack | rc 0: 38, 37 and 34 passed in 2.3, 5.0 and 4.0 minutes; `e2e:stack:down` rc 0 | 8.5 falling to 1.2 |

The one red line is not in a path of `api-egress` and was not edited: it is the test `foundation-8a` amendments 20 and 38 name.
