# OpenVerify: agent guide

OpenVerify is an open-source, self-hostable identity-verification platform (web + Android). Its feature set is modelled on Persona. It is **not affiliated with Persona**: never use Persona's name in product UI, branding, logos, or copied text.

- **Master plan:** `docs/PLAN.md`. Section 4 is the check catalog; section 6 lists the phases.
- **Progress log:** `docs/PROGRESS.md`. Update it at the end of every phase or slice.
- **Persona surface index** (coverage checklist): `docs/research/persona-surface.md`.
- **Android integrator guide:** `docs/android/` (start at `docs/android/README.md`).

## Environment

Run `source scripts/env.sh` first. It sets JAVA_HOME (Temurin 21) and ANDROID_HOME (`~/Android/Sdk`), and puts the following on PATH:
- `pnpm`
- `uv`
- `java`
- `adb`

Docker Desktop provides `docker` and `docker compose`. There is no KVM, so no local Android emulator; instrumented tests run in CI only.

Local services (`infra/docker-compose.yml`, see ADR 0001):
- Postgres 17 + pgvector;
- **Valkey** for the Redis protocol, instead of Redis 8, whose licence is not permissive;
- **RustFS** for the S3 API, instead of MinIO, which is AGPL and archived;
- Mailpit.

Code talks only to the Redis protocol and the S3 API, never to a product-specific API. Testcontainers must pin these images:
- `pgvector/pgvector:pg17`
- `valkey/valkey:9.1`
- `rustfs/rustfs:1.0.3`

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify + TypeScript REST API, BullMQ workers, webhook dispatcher |
| `apps/dashboard` | Next.js operator console |
| `apps/flow` | Vite + React end-user verification flow (hosted / embedded) |
| `apps/demo-web` | Sample customer site |
| `packages/*` | `core` (domain, state machines, check registry), `checks` (pure check logic), `db` (Drizzle), `flow-spec`, `workflow-engine`, `watchlist`, `signals`, `sdk-js`, `sdk-react`, `node`, `ui`, `config` |
| `services/vision` | Python 3.12 FastAPI ML service (uv) |
| `android/` | Gradle: `openverify-sdk` (Kotlin Multiplatform with Compose Multiplatform: Android now, iOS later, ADR 0004; shared code in `src/commonMain`), `openverify-nfc` (Android only, LGPL, optional), `openverify-face` (Android only, optional: ONNX Runtime), `demo-app` |
| `infra/` | docker-compose, Dockerfiles |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck        # turbo, all packages
pnpm test                          # Vitest unit tests; each package's script gates coverage at 80%
pnpm test:integration              # Testcontainers (Docker required)
pnpm e2e                           # full-stack Playwright (Docker, uv, python3; see below)
pnpm format:check
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
(cd load && uv sync --frozen && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)   # the HTTP load harness's own gate (load/, vegeta from infra/scripts/install-vegeta.sh); takes (load/run.py) run only on the load stack under the e2e lock, method in docs/calibration/load-phase11.md
bash infra/scripts/install-vegeta.sh && infra/load/make-load-env.sh   # vegeta 12.13.0, and the load stack's environment file (/tmp/openverify-load/load.env, mode 0600)
flock -E 75 -w 120 /tmp/openverify-e2e.lock docker compose -p openverify-load -f infra/docker-compose.yml -f infra/load/docker-compose.load.yml --env-file /tmp/openverify-load/load.env --profile app up --detach --wait --no-build   # the load stack on the production images, alone on the machine
(cd load && uv run python run.py take --scenario <id> --rate <r> --duration <s> --seed-file /tmp/openverify-load/seed.json --env-file /tmp/openverify-load/load.env --out <file>)   # one load take, under the e2e lock, alone
python3 -I scripts/fetch_models.py --only face_detection_yunet && python3 -I scripts/fetch_fixtures.py --only person_a_id   # openverify-face's build and tests need both
(cd android && ./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)   # SDK tests run in testAndroidHostTest; testDebugUnitTest runs the demo's tests and is finalized by :demo-app:testMinifiedSmokeUnitTest (the smoke test's host twins); assemble also compiles the iOS klibs
cp .env.example .env               # then replace every change-me-* value
docker compose -f infra/docker-compose.yml --env-file .env up -d --wait
pnpm --filter @openverify/api db:migrate    # apply migrations to DATABASE_URL, then backfill event object ids (needs OPENVERIFY_KEK)
pnpm --filter @openverify/api db:grant-runtime <role>   # after every db:migrate, as the migration role (OPENVERIFY_MIGRATION_DATABASE_URL): the runtime role's privileges
pnpm --filter @openverify/api seed:dev      # dev org, sandbox + production envs, one operator per built-in role, default template; prints a new API key once
pnpm --filter @openverify/api seed:dev --mfa-admin       # also a TOTP-enrolled admin (OPENVERIFY_SEED_MFA_ADMIN_*); prints its secret once
pnpm --filter @openverify/api seed:load --scale <small|reference> --step <organisations|principals|accounts|inquiries|lists|transactions|graph|connect|watchlists|verify> [--part <n>]   # the load stack's synthetic seed (a dev tool, not in the image; env from /tmp/openverify-load/load.env); refuses production mode and any database but openverify_load; secrets only to --secrets-file
pnpm --filter @openverify/api retention:run [--now=<ISO-8601>] [--json]   # one C16 retention pass; --now moves only the cutoff
pnpm --filter @openverify/api kek:rewrap [--dry-run]   # after moving the old KEK to OPENVERIFY_KEK_PREVIOUS: re-wrap every data key
pnpm --filter @openverify/api user:reset-mfa <email> [--organization <org_...>]   # remove an operator's MFA (system audit entry)
pnpm --filter @openverify/api trust:sandbox-utopia   # install or refresh the sandbox-only Utopia test anchor (needs DATABASE_URL only; seed:dev installs it too, but refuses production mode); the sandbox test chip answers 409 sandbox_chip_anchor_missing without it
pnpm --filter @openverify/api org:create --name <name> --admin-email <email> [--slug <sign-in name>] [--print-invitation]   # the first organisation of a production install, with a single-use admin invitation (runtime role)
pnpm --filter @openverify/api api-keys:pepper-status [--json]   # how many API keys each pepper holds, while OPENVERIFY_API_KEY_PEPPER_PREVIOUS is set
pnpm --filter @openverify/api user:allow-password <email> [--organization <org_...>]   # break-glass: one password sign-in within 24 hours where the organisation's SSO is enforced
pnpm --filter @openverify/api watchlists:rebuild-key-df [--source <id>] [--json]   # rebuild a watchlist source's key frequencies in full (runtime role)
bash infra/scripts/supply-chain.sh <osv|pnpm-audit|pip-audit|zizmor|trivy-config|chart|pii|allowlist|all>   # the per-push supply-chain checks; tools from infra/scripts/install-<tool>.sh into SUPPLY_CHAIN_TOOLS_DIR (default ~/.local/bin); findings gate through security/allowlist.yaml
docker build -f infra/docker/<api|dashboard|flow|code-runner>.Dockerfile -t openverify/<name>:11c-local .   # the production images (the flow again with --build-arg OPENVERIFY_FLOW_FACE_GUIDANCE=off -t openverify/flow:11c-local-noguidance)
docker build --build-context repo=. -t openverify/vision:11c-local services/vision
bash infra/tests/images.test.sh <static|pins|override|api|dashboard|flow|flow-noguidance|vision|code-runner>   # one subcommand per call
bash deploy/helm/openverify/ci/chart-checks.sh <lint|unittest|kubeconform|trivy|all>   # the Helm chart (Helm 4 and 3, helm-unittest, kubeconform 1.35-1.37, Trivy)
bash deploy/helm/openverify/ci/kind.sh <create 1.35|create 1.37|load|fixtures|models|install|smoke|upgrade|delete>   # chart install and upgrade on kind, one call each under the e2e lock; delete last
OPENVERIFY_E2E_IMAGES=1 pnpm --filter @openverify/e2e e2e:stack:up   # the e2e stack on the production images (needs Docker Desktop's host networking or a Linux Docker engine)
flock -E 75 -w 240 /tmp/openverify-e2e.lock bash security/zap/run.sh <prepare|api [group ...]|flow [hosted|noguidance|routes]|console|report|revoke>   # the DAST pass (ZAP 2.17.0 by digest) against the images-mode e2e stack, one subcommand per call; prepare first, revoke last; report in docs/security/dast-<date>.md
bash infra/tests/zap.test.sh [--docker]   # the DAST tooling's contract tests (static; --docker also checks rules.tsv against the pinned image)
node packages/sdk-react/scripts/pack-release.ts --out <dir> --version <x.y.z> packages/sdk-js packages/node packages/sdk-react   # pack the publishable web packages (nothing is published)
python3 -I scripts/fetch_asvs.py --verify-ids && python3 -I scripts/fetch_masvs.py --verify-ids   # the committed ASVS and MASVS id lists against the pinned exports
pnpm --filter @openverify/docs-tools docs:<security|records|selfhost|compliance|catalog|release|all>   # re-render an area's generated documents; docs:catalog and docs:all collect the API's route table into docs/api/route-table.json first
pnpm release:check [--tag]   # the release checklist's machine-checkable rules (C284.2); the default mode is every Validation's gate, --tag only at the owner's tag step
```

- **Full-stack e2e** (`e2e/`). Install Chromium once with `pnpm --filter @openverify/e2e exec playwright install chromium`. The suite starts its own infrastructure as the compose project `openverify-e2e`, fetches the pinned models and faces, and tears everything down afterwards. It never touches the developer's `openverify` volumes.
- **Whole stack in containers.** Fetch the weights first (`python3 scripts/fetch_models.py`), then `docker compose -f infra/docker-compose.yml --env-file .env --profile app up -d --wait --build`. The `app` profile builds and runs the five production images (`openverify/{api,dashboard,flow,vision,code-runner}:11c-local`, read-only; secrets reach them as environment variables from `.env` through `x-api-environment`, and each process also reads a secret's `<NAME>_FILE` form, which the Helm chart uses). Seed with `... --profile app run --rm migrate node dist/commands/seed-dev.js`. Every port binds to loopback.

## Workspace conventions (established in Phase 0)

- **Running untranspiled sources.** Library packages export a `@openverify/source` condition that points at `src/index.ts`. Typecheck and Vitest resolve it, so neither needs a build first. Each package's `tsconfig.build.json` resets `customConditions`, so built output uses its dependencies' `dist`.
- **Test config.** Every `vitest.config.ts` calls `createVitestConfig()` from `@openverify/config/vitest`, which carries the 80% coverage gate. A conventions test fails any package that skips it.
- **Dependency versions.**
  - Shared dependency versions go in the pnpm catalog in `pnpm-workspace.yaml`.
  - pnpm 12 enforces a minimum release age. If it adds `minimumReleaseAgeExclude` entries, remove them and pin an older version instead.
  - Every dependency build script needs an explicit `allowBuilds` entry.
- **TypeScript.** Stays on 6.0.x until typescript-eslint supports a newer version.
- **Fastify routes.** Register routes as plugins (`app.register`). Only plugin-registered routes appear in `/openapi.json`.
- **Migrations.** A migration that needs pgvector must run `CREATE EXTENSION IF NOT EXISTS vector` itself.
- **Kotlin filenames.** Kotlin sources follow the Kotlin convention (`PascalCase.kt`), not kebab-case.
- **Git hooks.** Enable the gitleaks pre-commit hook once per clone with `git config core.hooksPath .githooks`.

## Rules

1. **TDD is mandatory.** Write a failing test, run it and see it fail for the intended reason (RED), implement the minimum to pass (GREEN), then refactor.
   - Each slice records its evidence in `docs/tdd/<slice>.tdd.md`, including the commands actually run and their output.
   - Coverage must be ≥80% per package.
2. **Conventions:**
   - kebab-case filenames;
   - TypeScript strict mode;
   - zod schemas are the source of truth for API contracts, and the OpenAPI spec is generated from them;
   - errors are RFC 9457 problem+json;
   - logging uses pino with PII redaction;
   - check IDs are `snake_case`, matching the catalog in PLAN §4.
3. **PII and secrets:**
   - Never commit real personal data. Test IDs are synthetic, generated by our fixtures. Test faces come only from public-domain sources.
   - PII is encrypted at rest through the `encrypted` column helper.
   - No secrets in git: use `.env.example` with placeholders only.
4. **Licenses:**
   - Dependencies and model weights must be permissive: MIT, Apache-2.0, BSD, ISC, PostgreSQL, CC0, CC-BY, BlueOak-1.0.0, PSF-2.0, MIT-CMU.
   - **Exception for build, test and dev tooling only.** Tools under file-level weak copyleft (MPL-2.0, EPL-2.0) are allowed when:
     - they are used unmodified, and
     - they are never shipped in a runtime artifact.

     Examples: lightningcss via Vite and Tailwind, JUnit 5 in test scope, certifi and pathspec as vision dev dependencies. List each one in `THIRD_PARTY_LICENSES.md` §5.
   - **Two recorded owner exceptions for shipped code** (Phase 10 P1 and P2, 2026-11-08; `THIRD_PARTY_LICENSES.md` section 6). Neither is a precedent.
     - SCUBA's two `GPL-2.0-only WITH Classpath-exception-2.0` files (`CommandAPDU.java`, `ResponseAPDU.java` in `net.sf.scuba:scuba-smartcards`): unmodified, from Maven Central, only in `android/openverify-nfc`, with the GPL-2.0 and Classpath-exception texts and the files' source location in its `NOTICE` and in `THIRD_PARTY_LICENSES.md`.
     - Eigen (MPL-2.0), unmodified, only inside ONNX Runtime: `onnxruntime-android` in `android/openverify-face`, `onnxruntime-web`'s WASM in `apps/flow`, and the vision image's `onnxruntime` wheel, each with ONNX Runtime's third-party notices and Eigen's source location.
   - **No non-commercial or BSL-licensed weights or libraries.** For example, InsightFace pretrained packs and FingerprintJS v4+ are not allowed.
   - LGPL code (JMRTD) lives only in `android/openverify-nfc`.
   - Model and data downloads go through `scripts/fetch-*` with pinned SHA-256 hashes.
5. **Honesty in checks:**
   - Heuristic checks ship as `stage: beta` with a confidence score.
   - Checks that need licensed data sources ship as adapters plus a deterministic sandbox provider.
   - Never fake a "passed" result.
6. **Git:**
   - Conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`).
   - Never force-push.
   - Never commit `.env`, model weights, or downloaded datasets.
