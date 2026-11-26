# @openverify/docs-tools

Private (never published). The document generators, record tests and release check of Phase 11, Workflow 11E (plan C273 to C284). Each generator reads the repository's own facts (registries, schemas, committed CSVs and reports), returns the files it would write, and has a test that fails when a committed file differs from a fresh render. A hand-written document whose facts the repository holds gets a record test instead.

## Areas and owners

| Directory | Owner | Contracts | Script |
|---|---|---|---|
| `src/security/` | `docs-security` | C273, C274, C275 | `pnpm --filter @openverify/docs-tools docs:security` |
| `src/records/` | `docs-records` | C276 | `docs:records` |
| `src/selfhost/` | `docs-selfhost` | C277 | `docs:selfhost` |
| `src/compliance/` | `docs-compliance` | C278 | `docs:compliance` |
| `src/catalog/` | `docs-catalog` | C279, C280, C281 | `docs:catalog` |
| `src/release/` | `docs-release` | C284 | `docs:release`, `release:check [--tag]` |

`docs:all` renders every area. The package scripts are the only writers: a test compares the committed file with a render held in memory and never writes (Workflow 10A rule 21). `src/index.ts` and `package.json` are contracts-11e's and shared files from 11E's Stage 2 on: an area exports what it adds from its own `src/<area>/index.ts`, which `src/index.ts` re-exports whole.

The scripts run the TypeScript sources with Node's own type stripping (`node --experimental-transform-types --conditions=@openverify/source --import ./scripts/register-ts.mjs src/cli.ts ...`), so no runner is added as a dependency. Exit codes: 0 done, 1 a check failed, 2 a usage error, 3 an entry point its owner has not built yet.

## How a generator reads each input (no product code changes in 11E)

Three ways, in this order of preference:

1. **A workspace import through the `@openverify/source` condition** (a `dependencies` entry of this package): `@openverify/core` for `CHECK_REGISTRY`, `REPORT_REGISTRY`, `SIGNAL_REGISTRY`, `VERIFICATION_TYPES`, the Connect categories (`DATA_CLASSES`, `SHARE_CATEGORIES`, `FIELD_TYPE_CLASS`, …) and `FIELD_SCHEMA_TYPES`; `@openverify/contracts` for `RATE_LIMIT_POLICIES`, `RATE_LIMIT_DEFAULTS`, `RATE_LIMIT_POLICY_WINDOWS`, `EVENT_NAMES`, `TEMPLATE_FIELD_TYPES` and `ACCOUNT_FIELD_TYPES`.
2. **A relative import of the module that holds the fact**, as the watchlist benchmark imports the API's sources (no package exports it): `packages/db/src/encrypted-columns.ts` (`ENCRYPTED_COLUMNS`; it imports nothing, so `@openverify/db`'s database code is not loaded); `apps/api/src/config-registry.ts`, `apps/api/src/metrics-registry.ts` and `apps/api/src/metrics-documents.ts` (they import nothing at run time); `apps/api/src/logger.ts` (`PERSONAL_LOG_KEYS`, `REDACT_PATHS`) and `apps/api/src/jobs/logger.ts` (`WORKER_REDACT_PATHS`); `apps/api/src/providers/index.ts` (`PROVIDER_KINDS`, `PROVIDER_NAMES_BY_KIND`, `PROCESS_PROVIDER_KINDS`); `apps/api/src/plugins/rate-limit.ts` (the routes the plugin limits by prefix or constant). A bare import inside such a module resolves from the module's own package (`apps/api/node_modules`), under Vitest and under the scripts alike. Keep these static imports to modules with few imports: `tsc` type-checks every file a static import reaches.
3. **Parsing a committed file through the `Repository`**: `docs/api/openapi.json`, `docs/research/persona-surface.md`, the calibration reports' summary blocks (validated against `contracts/fixtures/calibration/summary.schema.json` with `ajv`), `THIRD_PARTY_LICENSES.md`, `docs/PROGRESS.md`, the plans' Deferred sections and C288's tables, `deploy/helm/openverify/Chart.yaml`, `android/gradle.properties`, the `package.json` files, `.github/workflows/release.yml`, `security/allowlist.yaml`, the checklists' CSVs (`csv-parse`) and the committed ASVS and MASVS id lists.

**The hard case, C279.3's route scopes and rate policies.** Scopes live only in each route's `config.scopes`, and `apps/api/src/openapi.test.ts:346` keeps `x-openverify-` members out of the served document. They are still readable without a code change: build the app in memory as `openapi.test.ts` does (`createContainer(loadConfig(syntheticEnv({})), …).buildApp({ logger: false })`, no database touched), add an `onRoute` hook before `ready()`, and record each route's method, URL and `config.scopes` (690 routes, 596 with scopes, on 2026-11-20). Load those modules with a dynamic `import()` of a computed path, typed by a local interface, so `tsc` does not type-check the whole API. Rate policies: `api`, `flow-session` and `flow-ip` and the flow routes the plugin names by constant are readable from `apps/api/src/plugins/rate-limit.ts`; every other policy is applied by a call in a handler, and no table maps a route to it. The page renders what the routes declare (the prefix and constant policies, and each other policy listed with its limit and window but no route), and the missing route-to-policy declaration is a `contractDeviation` for 11F (`fix-server`). If the in-memory build cannot run under this package's Vitest configuration, the fallback is the same: render the paths from `openapi.json`, and report the scopes as that deviation.

## Shared parts (contracts-11e)

- `src/types.ts`: `Repository`, `GeneratedFile`, `RenderResult`, `CheckFinding`, `CheckResult`, `DOCS_AREAS`, `AREA_OWNERS`, `AREA_CONTRACTS`.
- `src/repository.ts`: `createRepository(root)`, `createMemoryRepository(files)` (fixtures), `REPOSITORY_ROOT`.
- `src/fresh-render.ts`: `staleFiles(repo, files)`, the generated-document rule.
- `src/cli.ts`: `runCli(argv, deps)` and `main()`.

Commands to re-render and to check, from the repository root:

```bash
pnpm --filter @openverify/docs-tools docs:<area>        # writes that area's generated files
pnpm --filter @openverify/docs-tools test               # every check, the 80% coverage gate
pnpm --filter @openverify/docs-tools release:check      # C284.2, the default mode
pnpm --filter @openverify/docs-tools release:check --tag   # the owner's tag step only
```
