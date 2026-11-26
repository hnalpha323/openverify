# Phase 11, Workflow 11C Stage 2: images-11c (family I)

C257 (the five production images, the compiled commands, the compose `app` profile and the e2e
images-mode override), C258.1 (digests everywhere), C263.6 (the code runner's `tcp:` transport) and
C257.1's flow run-time configuration with its no-guidance build (C289). Every timing is beside
`cat /proc/loadavg`. Commands run from the repository root after `source scripts/env.sh` unless a
`cd` is shown.

## 1. Checkpoint images

### 1.1 The compiled operator commands (C257.1, review F27)

RED `0a9bed795` (`apps/api/src/commands-build.test.ts`):

```
$ (cd apps/api && pnpm exec vitest run src/commands-build.test.ts --coverage.enabled=false)   # load 0.90
     × runs db:migrate in development with tsx over the entry it compiles
     × compiles exactly the operator commands to dist/commands/, after the server build
     × reaches the compiled src/ through #src/*: its source in development, dist/ in the image
     × leaves dist/commands/ to the commands: no module of src/ compiles there
      Tests  4 failed | 19 passed (23)
```

Why the shape differs from the frozen sentence "rootDir `.`" (a contractDeviation): with `rootDir: "."`
tsc emits `dist/commands/scripts/<file>.js` and a second copy of `src/` under `dist/commands/src/`,
whose repository-root paths (`'../../../..'` from `dist/<dir>/`, eleven resolvers: the network and
watchlist manifests, the data files, the trust anchors, the i18n fixtures) then point at `apps/api`
instead of the root. And `src/commands/{org-create,db-grant-runtime,api-keys-pepper-status,
trust-sandbox-utopia}.ts` already compile to `dist/commands/<the same name>.js`, so the frozen entry
names collide with them. GREEN therefore: `rootDir: "scripts"`, `outDir: "dist/commands"`,
`include: []`, `files` = the 19 operator entries; the entries import `#src/<module>` (the package's
`imports`: `@openverify/source` -> `./src/*.ts` for tsx, Vitest and the typecheck, `default` ->
`./dist/*.js` in the image), so tsc pulls no source into the commands build and the compiled command
shares the server's modules; `src/commands/` moved to `src/operator-commands/` (git mv, one test
import); `scripts/migrate.ts` became `scripts/db-migrate.ts` (the `db:migrate` script line). One fix
of the RED test before GREEN: `include` is `[]`, not absent (an inherited `include` would compile
`src/` too).

GREEN `9cd62f91b`:

```
$ pnpm turbo run build --filter=@openverify/api      # 97 s, rc 0; dist/commands/ holds the 19 entries
$ node apps/api/dist/commands/org-create.js           # prints the usage, rc 2 (no database touched)
$ node apps/api/dist/commands/db-grant-runtime.js     # prints the usage, rc 2
$ (cd apps/api && pnpm exec vitest run src/commands-build.test.ts src/package-scripts.test.ts src/operator-commands \
    src/kek-rewrap.test.ts src/retention-run.test.ts src/trust-anchors-sync.test.ts src/face-scan-benchmark.test.ts \
    src/face-index-rebuild.test.ts src/blind-index-rebuild.test.ts src/phase9b-exports-plumbing.test.ts --coverage.enabled=false)
      Test Files  13 passed (13)   Tests  166 passed (166)
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit)                         # rc 0, 105 s
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec eslint scripts src/commands-build.test.ts src/operator-commands ...)  # rc 0
```

### 1.2 `infra/tests/images.test.sh` (C257.4, C258.1; review P18)

RED `1937e9559`: the static half against the tree before the Dockerfiles (load 0.9):

```
$ bash infra/tests/images.test.sh static
FAIL - api: infra/docker/api.Dockerfile exists
FAIL - dashboard: infra/docker/dashboard.Dockerfile exists
FAIL - flow: infra/docker/flow.Dockerfile exists
FAIL - vision: ARG PYTHON_IMAGE defaults to the pinned digest (... got 'python:3.12-slim')
FAIL - vision: ARG UV_IMAGE defaults to the pinned digest (... got '')
FAIL - vision: no HEALTHCHECK (the chart's probes decide)
FAIL - vision: labels org.opencontainers.image.source ... (and every label, VERSION, REVISION, SOURCE_URL)
FAIL - code-runner: ARG NODE_IMAGE defaults to the pinned digest (... got 'node:22.22.1-bookworm-slim')
FAIL - code-runner: labels org.opencontainers.image.source ... (and every label and build argument)
FAIL - vision: EIGEN-SOURCE.txt names the revision and URLs of THIRD_PARTY_LICENSES.md's wheel row
FAIL - vision: copies EIGEN-SOURCE.txt beside the wheel's ThirdPartyNotices.txt under licenses/
FAIL - vision: carries models/manifest.json for the start-up digest check
FAIL - vision: carries scripts/fetch_models.py for the models-fetch Job
# 20 passed, 36 failed      (rc 1)
```

The live subcommands (`api`, `dashboard`, `flow`, `flow-noguidance`, `vision`, `code-runner`) answer
"build it first" until each image exists.

GREEN, one image at a time (each build one foreground call under the e2e lock; `images.test.sh`
refined on the way, each refinement in the GREEN commit that met it):

| Image | Commit | Build (s, load before -> after) | `images.test.sh <name>` |
|---|---|---|---|
| vision | `f17c80341` | 35 (3.27 -> 4.05) | 28 passed (first run: onnxruntime's wheel carries three example graphs under `onnxruntime/datasets/`; the check now names the manifest's weights) |
| code-runner | `ec2ab80e9` | 51 (3.57 -> 3.37) | 22 passed |
| api | `037d409b7` | 148, then 204 after the fix (4.47 -> 5.22) | first run 50 passed, 4 failed: `@openverify/watchlist`'s `dist/match/fixtures.test-support.js` (now deleted from every workspace package's `dist/`; no production module imports it), csv-parse and csv-stringify looked up from `apps/api` (they are `@openverify/checks`' dependencies; the check now reads pnpm's store), and `docker diff` naming the secret volume's mount point `/run/secrets/openverify` (Docker's, not a write); then 54 passed |
| flow | `918ca5b07` | 104 (20.2 -> 9.1), 70 after the fix | 29 passed |
| flow, no guidance | `918ca5b07` | 43, then 53 (5.9 -> 6.6) | first run: the bundle still held the guidance, because turbo's strict environment mode hid `OPENVERIFY_FLOW_FACE_GUIDANCE` from the build (the bundle is now built by Vite directly after turbo builds the workspace packages); then the main chunk named `ort-wasm` as the guidance's pinned path strings, so the check now looks for onnxruntime-web's own code (`registerBackend`), with the guided image as its control; 28 passed |
| dashboard | `0b79fb2e7` | 210 (14.1 -> 8.2) | first run: Next.js's own `next/dist/{server,lib}/typescript` folders met the denylist, which now matches packages (a directory directly under `node_modules`, or pnpm's store entry); 27 passed |

### 1.3 Vision's start-up checks (C257.1 as amended 15; amendment 13)

Stub `836b14387`; RED `f9aebf31d` (`services/vision/tests/test_startup.py`, load 5.0):

```
$ (cd services/vision && uv run pytest tests/test_startup.py -p no:cacheprovider --no-cov -q)
FAILED ... 13 failed in 0.88s        # NotImplementedError from the stub; Settings has no models_manifest
```

GREEN `27c7b0030` (`openverify_vision/startup.py`, `settings.py` `models_manifest` and
`SECRET_VARIABLES`, `app.py`'s `create_app`): `OPENVERIFY_VISION_SERVICE_TOKEN_FILE` with the API's
rules, and with `OPENVERIFY_VISION_MODELS_MANIFEST` set a fetched model whose SHA-256 differs stops
the start (a model not fetched is skipped: models load on first use). One fix of the RED test's own
helper before GREEN (it wrote one path twice, the second time over a 0440 file).

```
$ uv run pytest tests/test_startup.py tests/test_app.py --no-cov -q    # 35 passed in 1.60s
$ uv run ruff check src tests/test_startup.py && uv run ruff format --check ... && uv run mypy src tools   # clean
```

The vision image (`f17c80341`) carries `licenses/onnxruntime/EIGEN-SOURCE.txt` (committed at
`services/vision/licenses/onnxruntime/`, revision `1d8b82b0740839c0de7f1242a3585e3390ff5f33`, the
mirror and upstream URLs and ONNX Runtime's `v1.31.0` tree) beside the wheel's own
`ThirdPartyNotices.txt`, and `models/manifest.json` and `scripts/fetch_models.py` from the named
build context `repo` (the repository root), so its build command gains `--build-context repo=.`
and compose's vision build `additional_contexts: {repo: ..}`.

`apps/api/src/config-registry.test.ts` (which scans `services/vision/src`) then failed on the new
`OPENVERIFY_VISION_MODELS_MANIFEST` in the API gate's merge (the RED, quoted in 1.7); GREEN
`f9b3e4ecd` registers it for the `vision` process (a named borrowed edit).

### 1.4 The flow server's and the console's secrets as files; the no-guidance flow (C249.2, C289)

Stubs `4fcd39d4c`; RED `1f21378a3` (25 failing, load 5.2):

```
$ (cd apps/flow && pnpm exec vitest run src/security/secret-files.test.ts src/vite-plugins/face-guidance-build.test.ts src/flow/flow-environment-no-guidance.test.ts --coverage.enabled=false)
      Tests  13 failed (13)
$ (cd apps/dashboard && pnpm exec vitest run src/lib/secret-files.test.ts server.test.ts --coverage.enabled=false)
      Tests  12 failed | 13 passed (25)
```

GREEN `9e7cc46ee`: `apps/flow/src/security/secret-files.ts` and `apps/dashboard/src/lib/secret-files.ts`
(import-free copies of the API's rules, `node:fs` passed in; each server's `main()` resolves its
token's `_FILE` form, logs `{"event":"secret_file_readable",...}` and refuses the start on an issue);
`apps/flow/src/vite-plugins/face-guidance-build.ts` (with `off`: only the phone-number library's
licences among the guidance assets, `define` of `import.meta.env.OPENVERIFY_FLOW_FACE_GUIDANCE`,
`onnxruntime-web/wasm` aliased to the empty `src/guidance/no-face-guidance.ts`), wired in
`vite.config.ts`; `flow-environment.tsx`'s detector answers `null` at once when built with `off`;
`apps/dashboard/server.ts`'s `standaloneNextConfig` hands Next.js `.next/required-server-files.json`'s
configuration through `__NEXT_PRIVATE_STANDALONE_CONFIG` when no `next.config.*` is shipped.

```
$ (cd apps/flow && pnpm exec vitest run <the three> src/flow/flow-environment.test.tsx --coverage.enabled=false)   # 21 passed
$ (cd apps/dashboard && pnpm exec vitest run src/lib/secret-files.test.ts server.test.ts --coverage.enabled=false) # 25 passed
$ OPENVERIFY_FLOW_SERVER_TOKEN=x OPENVERIFY_FLOW_SERVER_TOKEN_FILE=<file> node --conditions=@openverify/source apps/flow/server.ts --port 47124
OPENVERIFY_FLOW_SERVER_TOKEN: is set together with OPENVERIFY_FLOW_SERVER_TOKEN_FILE; set one    # rc 1
```

RED `85f3032c4` (`src/next-config.test.ts`: `output` is `'standalone'`; 1 failing), GREEN
`cc7c7b87d` (`next.config.ts`, the named borrowed edit).

### 1.5 Checkpoint images: the gate (rule 25: what this checkpoint touched)

`apps/api` (the commands, the registry entry), `apps/flow`, `apps/dashboard`, `services/vision`,
`infra/`. Every row is its own foreground call; the exit code is the command's own; G =
`/tmp/img-gate-1`.

| Call | rc | Result | s | load before -> after |
|---|---|---|---|---|
| `pnpm turbo run typecheck --force --filter=@openverify/api --filter=@openverify/flow --filter=@openverify/dashboard` (heavy) | 0 | 3 tasks | 173 | 4.72 -> 9.24 |
| forced lint, `--filter=@openverify/api` (4 GB heap, heavy) | 0 | | 367 | 3.39 -> 10.62 |
| forced lint, `--filter=@openverify/dashboard --filter=@openverify/flow` | 0 | | 417 | 10.62 -> 9.94 |
| vision: ruff check, ruff format --check, mypy src tools | 0 | | 1 | 9.24 |
| vision pytest, test files 1-37 (`--cov-fail-under=0`) | 0 | 903 passed | 177 | 9.24 -> 3.87 |
| vision pytest, files 38-74 (`--cov-append`, `--cov-fail-under=0`) | 0 | 827 passed | 190 | 3.51 -> 6.10 |
| vision pytest, files 75-110 (`--cov-append`, the 80% gate) | 0 | 957 passed (2,687 in all), 97.45% | 521 | 6.10 -> 3.83 |
| `@openverify/flow` vitest with coverage | 0 | 1,664 in 139 files, 95% lines | 176 | 9.62 -> 15.07 |
| dashboard shards 1/2, 2/2 (heavy) and merge | 0 (merge) | 7,235 in 622 files, 95.62% | 432, 474, 17 | 15.07 -> 15.99 |
| API, 12 blob shards (heavy) | (partial coverage) | | 207-463 | 12.4 -> 29.2 |
| API merge | **1** | 10,883 passed, 1 failed: `config-registry.test.ts` "registers every variable a process reads", `OPENVERIFY_VISION_MODELS_MANIFEST (services/vision/src/openverify_vision/startup.py)` | 38 | 11.25 -> 7.84 |
| (fix `f9b3e4ecd`) API shard 3/12 again, then the merge | 0 | 10,884 in 858 files, 94.17% | 179, 73 | 4.74 -> 5.06 |
| `pnpm --filter @openverify/db test:integration` | 0 | 110 | 193 | 4.66 -> 11.83 |
| integration `--project graph` | 0 | 13 | 46 | 11.83 -> 7.21 |
| integration `--project api --shard=1/3`, 2/3, 3/3 | 0, 0, 0 | 123, 128, 193 (444) | 232, 253, 151 | 6.10 -> 16.89 |
| `flock ... pnpm --filter @openverify/flow e2e` (the mocked suite) | 0 | 349 passed | 147 | 15.54 -> 10.70 |
| `images.test.sh static` | 0 | 149 passed | 1 | 9.20 |
| `images.test.sh api`, `dashboard`, `flow`, `flow-noguidance`, `vision`, `code-runner` (e2e lock) | 0 each | 54, 27, 29, 28, 28, 22 | 56, 10, 10, 9, 15, 7 | 9.20 -> 3.48 |
| `apps-image-context.test.sh` | 0 | 43 | 0 | 3.20 |
| `compose.test.sh --static-only` | 0 | 584 | 4 | 3.20 |
| `vision-container.test.sh --static-only`, then live (e2e lock) | 0, 0 | 24, 55 | 0, 17 | 2.95 -> 2.09 |
| `flow-server.test.sh`; `flow-headers.test.sh --static-only` | 0, 0 | 38, 11 | 1, 0 | 2.95 |
| `pnpm format:check` | 0 | | 135 | 2.01 -> 1.74 |

Image sizes (`docker images`, load 1.7): api 604 MB, dashboard 388 MB, flow 349 MB, flow
no-guidance 330 MB, vision 707 MB, code-runner 380 MB.

CHECKPOINT images DONE at f9b3e4ecde5267848012848c97e136dd9d801cab

Handoff (for sbom-release-11c, chart-policy-11c and chart-11c):
- Builds, from the repository root, linux/amd64, each its own call under the e2e lock:
  `docker build -f infra/docker/api.Dockerfile -t openverify/api:11c-local .`;
  `docker build -f infra/docker/dashboard.Dockerfile -t openverify/dashboard:11c-local .`;
  `docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .`;
  `docker build -f infra/docker/flow.Dockerfile --build-arg OPENVERIFY_FLOW_FACE_GUIDANCE=off -t openverify/flow:11c-local-noguidance .`;
  `docker build --build-context repo=. -t openverify/vision:11c-local services/vision` (**the named
  context `repo` is required**: the image carries `models/manifest.json` and `scripts/fetch_models.py`);
  `docker build -f infra/docker/code-runner.Dockerfile -t openverify/code-runner:11c-local .`.
  Build arguments: `NODE_IMAGE`, `PYTHON_IMAGE`, `UV_IMAGE` (digest defaults), `VERSION`
  (default `0.1.0-local`), `REVISION` (`unknown`), `SOURCE_URL`, and the flow's
  `OPENVERIFY_FLOW_FACE_GUIDANCE` (`on`|`off`). Prerequisites: `python3 scripts/fetch_data.py`,
  `pnpm --filter @openverify/watchlist build:variant-groups` (api), YuNet fetched (flow with guidance).
- Stages: api, dashboard, flow and code-runner `build` then `runtime`; vision `uv`, `build`, `runtime`.
- Every image: `USER 10001:10001`, no HEALTHCHECK, read-only root with a tmpfs `/tmp`, labels
  `org.opencontainers.image.{source,revision,version,licenses=Apache-2.0,title=openverify/<name>}`
  and `dev.openverify.licence-status` (`pending-owner` on api, `decided` on the others).
- api: WORKDIR `/app/apps/api`; `CMD node dist/server.js` (ports 3000, 3101 with
  `OPENVERIFY_INTERNAL_LISTEN`); worker `node dist/worker.js`; worker probe `node dist/worker-health.js`
  (heartbeat `/tmp/openverify-worker-heartbeat`); commands `node dist/commands/<command, ':' as '-'>.js`,
  the 19 of `apps/api/tsconfig.commands.json` (`db-migrate`, `db-grant-runtime`, `seed-dev`, ...);
  repository-root data at `/app/{data,network,watchlists,trust-anchors,contracts/fixtures}`.
  Secrets through `<NAME>_FILE` as built in 11B.
- dashboard: WORKDIR `/app/apps/dashboard`; `CMD node server.ts --hostname 0.0.0.0 --port 3001`;
  `OPENVERIFY_DASHBOARD_BFF_TOKEN_FILE` read; `.next/cache` is a link to `/tmp/next-cache`.
- flow: WORKDIR `/app/apps/flow`; `CMD node server.ts --hostname 0.0.0.0 --port 4173 --dist dist`;
  `OPENVERIFY_FLOW_SERVER_TOKEN_FILE` read; the API origin is still `VITE_OPENVERIFY_API_URL` read at
  start until checkpoint flow-runtime adds `OPENVERIFY_FLOW_API_URL` and `/config.json`.
- vision: port 8000; `OPENVERIFY_VISION_MODELS_DIR=/models`,
  `OPENVERIFY_VISION_MODELS_MANIFEST=/app/models/manifest.json` (image defaults; the chart sets the
  models dir); `OPENVERIFY_VISION_SERVICE_TOKEN_FILE` read; the models-fetch Job:
  `python3 /app/scripts/fetch_models.py --manifest /app/models/manifest.json --dest <dir>`;
  `/app/licenses/onnxruntime/{EIGEN-SOURCE.txt,ThirdPartyNotices.txt}`.
- code-runner: `CMD node bin/code-runner-server.mjs` over `/run/code-runner` (socket) until checkpoint
  code-runner-tcp adds `OPENVERIFY_CODE_RUNNER_LISTEN` (port 7700) and the token.
- Tests: `bash infra/tests/images.test.sh static|api|dashboard|flow|flow-noguidance|vision|code-runner`
  (`IMAGE_TAG`, default `11c-local`; each live subcommand takes the prebuilt image).

## 2. Checkpoint flow-runtime (C257.1, verification V07, decision 73, OD-11C-3)

Stubs `23a84592a` (`apps/flow/src/api/runtime-api-url.ts`: `resolveApiBaseUrl`,
`RUNTIME_API_URL_KEY = 'api-url'`; the flow server's optional `apiBaseUrl`). RED `8972d7449`
(15 failing, load 3.4):

```
$ (cd apps/flow && pnpm exec vitest run src/api/runtime-api-url.test.ts src/server/server-runtime-config.test.ts src/security/security-meta.test.ts --coverage.enabled=false)
     × prefers OPENVERIFY_FLOW_API_URL and falls back to VITE_OPENVERIFY_API_URL
     × serves one image against two API URLs without a rebuild
     × reads /config.json when the value was unset at build
     × leaves connect-src to the flow server when no API URL is set at build (undefined)
      Tests  15 failed | 7 passed (22)
```

GREEN `b1e072202` (named borrowed edits of `apps/flow/server.ts`, `src/main.tsx`,
`src/security/security-meta.ts`; `vite.config.ts` was edited at checkpoint images):
- the flow server reads `OPENVERIFY_FLOW_API_URL` at start, `VITE_OPENVERIFY_API_URL` its fallback
  (a refusal names the variable read), keeps `connect-src` with its origin in the header, and
  serves `GET|HEAD /config.json` as `{"api-url": "<base URL or ''>"}` with `Cache-Control: no-store`
  and the base headers (access-log entry `config`);
- `main.tsx` renders after `resolveApiBaseUrl(import.meta.env.VITE_OPENVERIFY_API_URL, fetch)`: the
  build-time value as before without a request, else `/config.json` (a failed or malformed answer
  means the flow's own origin, as an unset variable always has; `vite` serves no `/config.json`);
- the build's `<meta>`, when the variable is unset at build, carries every directive of the hosted
  policy with `connect-src 'self' https: http:`. **Deviation from the plan's sentence** ("every
  directive except `connect-src`"): without a `connect-src` of its own the `<meta>`'s
  `default-src 'self'` would govern connections and block the API; the scheme sources leave the
  exact origin to the header (the two policies intersect). Built with the variable, the `<meta>` is
  unchanged.
- Existing tests changed with the plan: `security-meta.test.ts`'s "uses the same origin when no API
  URL is configured" became the unset case above; `server-headers.test.ts`'s exact config gained
  `apiBaseUrl`.

```
$ (cd apps/flow && pnpm exec vitest run src/api src/server src/security src/vite-plugins ... --coverage.enabled=false)   # 302 passed
```

`images.test.sh` RED `7bfd61729` on the image built before the change (load 2.3): the bundle's
`<meta>` still held `connect-src 'self'`, the header had no API origin (the image passes only
`OPENVERIFY_FLOW_API_URL` now), `/config.json` answered "Not found", the second container's
`/config.json` 404: `# 28 passed, 4 failed`. GREEN after rebuilding both flow images (85 s at load
2.3; the no-guidance build 343 s including the lock wait, load 2.6 -> 2.1):
`images.test.sh flow` 33 passed, `flow-noguidance` 32 passed (one image against
`https://api-a.example.test` and `https://api-b.example.test/openverify`, no rebuild).

Gate (rule 25: `apps/flow`), G = `/tmp/img-gate-2`:

| Call | rc | Result | s | load |
|---|---|---|---|---|
| `pnpm turbo run typecheck --force --filter=@openverify/flow` | 0 | | 53 | 2.75 -> 4.25 |
| `pnpm turbo run lint --force --filter=@openverify/flow` | 0 | | 68 | 4.25 -> 3.36 |
| `@openverify/flow` vitest with coverage | 0 | 1,678 in 141 files, 95.01% | 139 | 3.36 -> 8.60 |
| the mocked flow suite (e2e lock) | 0 | 349 passed | 158 | 7.99 -> 13.33 |
| `flow-server.test.sh`; `flow-headers.test.sh --static-only`; `images.test.sh static` | 0, 0, 0 | 38, 11, 149 | 1, 0, 1 | 13.3 |
| `images.test.sh flow`, `flow-noguidance` | 0, 0 | 33, 32 | | 0.4 |
| prettier --check (the changed files) | 0 | | | |

vite, vite preview, the per-push e2e and the mocked suite build with `VITE_OPENVERIFY_API_URL` as
before (no `stack.ts` or Vite dev-server edit).

CHECKPOINT flow-runtime DONE at 7bfd61729b09e1184fe3f6c686088a01feb4484e

Handoff: the flow image takes `OPENVERIFY_FLOW_API_URL` (the API's public URL, a path allowed; not a
secret; `VITE_OPENVERIFY_API_URL` read as its fallback) and serves `/config.json`; the chart sets
`OPENVERIFY_FLOW_API_URL` on the flow's ConfigMap; nothing else changes for the probes (`GET /`).

## 3. Checkpoint pins (C258.1)

RED `c21642dd1` (load 1.7): `images.test.sh pins` (no Docker): every FROM of every Dockerfile in
git a stage or `${ARG}` defaulting to tag@sha256 and the node bases the amendment's; every
`image:` of `infra/docker-compose.yml` and `e2e/setup/docker-compose.images.yml` tag@sha256 (the
locally built `openverify/*` excepted) and the five infrastructure pins named; the constants
`POSTGRES_TEST_IMAGE`, `RUSTFS_TEST_IMAGE`, `VALKEY_TEST_IMAGE` (new, `apps/api/src/test-support/
integration-valkey.ts`), the watchlist benchmark's `POSTGRES_IMAGE` and the analytics benchmark's
`IMAGE` equal to the pins; no quoted Postgres, Valkey or RustFS image literal outside those
constants' files (the constant's test and the benchmark report's fixture data excepted); the
WebKit browser server's image by digest in `apps/flow/e2e/README.md` and `theme-csp.spec.ts`.

```
$ bash infra/tests/images.test.sh pins
FAIL - pins: infra/docker/apps.Dockerfile: every FROM is a stage or tag@sha256 (${NODE_IMAGE})
FAIL - pins: infra/docker-compose.yml: every image: is tag@sha256 (pgvector/pgvector:pg17 valkey/valkey:9.1 rustfs/rustfs:1.0.3 amazon/aws-cli:2.38.2 axllent/mailpit:v1.31)
FAIL - pins: packages/db/src/integration-postgres.ts: POSTGRES_TEST_IMAGE (expected 'pgvector/pgvector:pg17@sha256:cf134a76...', got 'pgvector/pgvector:pg17')
FAIL - pins: no Postgres, Valkey or RustFS image literal outside the constants ... (apps/api/src/cache/index.integration.test.ts:10:const VALKEY_IMAGE = 'valkey/valkey:9.1'; ...)
FAIL - pins: apps/flow/e2e/README.md names the browser server by digest
# 9 passed, 15 failed
$ bash infra/tests/refresh-digests.test.sh        # 2 passed, 16 failed (no script)
```

The digests, re-read by hand on the adoption day (2026-11-15) with the new script:

```
$ bash infra/scripts/refresh-digests.sh valkey/valkey:9.1 rustfs/rustfs:1.0.3 amazon/aws-cli:2.38.2 axllent/mailpit:v1.31 mcr.microsoft.com/playwright:v1.64.1-noble node:22.22.1-bookworm-slim ghcr.io/astral-sh/uv:0.13.3 pgvector/pgvector:pg17 python:3.12-slim
valkey/valkey:9.1@sha256:3add1a33...0b7, rustfs/rustfs:1.0.3@sha256:9ca95595...88b, amazon/aws-cli:2.38.2@sha256:5d39fd52...597,
axllent/mailpit:v1.31@sha256:23fe39e8...387, mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a7...68f,
node:22.22.1-bookworm-slim@sha256:4f77a690...f3d, ghcr.io/astral-sh/uv:0.13.3@sha256:bee0a2a4...1d1   # each the amendment's pin
pgvector/pgvector:pg17@sha256:b513c485...8fd, python:3.12-slim@sha256:5e2bdb1b...a5b                  # the tags moved to builds under 14 days old
```

So every pin is amendment 6's as written; `pgvector/pgvector:pg17` and `python:3.12-slim` keep the
older digests the amendment chose (their tags now point at builds under 14 days old), and the
Playwright image is pinned today, 14 days after its 2026-11-01 build.

GREEN: `de8ed59fb` (`infra/scripts/refresh-digests.sh`: `<image>:<tag>...` -> `<tag>@sha256:<digest>  #
resolved <date>` from `docker buildx imagetools inspect --format '{{json .Manifest}}'`; exit 2 for a
usage error before any lookup, 1 for a failed lookup; `refresh-digests.test.sh` 18 passed);
`d01991e28` (`POSTGRES_TEST_IMAGE` and its test; rule 16: `benchmark:typecheck` and
`benchmark:test` 119 passed); `ced987fb8` (`VALKEY_TEST_IMAGE`, the fifteen files, `RUSTFS_TEST_IMAGE`,
the analytics benchmark); `5c20097b1` (the watchlist benchmark); `82d40d0a2` (compose, compose.test.sh's
Postgres assertion, apps.Dockerfile's base, the test reading a constant Prettier wraps); `890921197`
(the WebKit docs); `7ea598b6f` (`integration-rustfs.test.ts` checked the constant's tag alone: it
failed in the gate's `src/test-support` run, 1 of 71, and now holds the tag with its digest).
`images.test.sh pins`: 24 passed.

Gate (affected scope: `apps/api`'s integration tests, test support and analytics script,
`packages/db`, the watchlist benchmark, `infra/`, the flow's docs; the whole API unit suite runs at
this agent's last checkpoint), G = `/tmp/img-gate-3`:

| Call | rc | Result | s | load |
|---|---|---|---|---|
| `pnpm turbo run typecheck --force --filter=@openverify/api --filter=@openverify/db --filter=@openverify/watchlist` | 0 | | 101 | 0.90 -> 1.63 |
| forced lint, the same three (4 GB heap) | 0 | | 348 | 1.63 -> 1.30 |
| `pnpm turbo run test --force --filter=@openverify/db` | 0 | 2,357, 89.88% | 184 | 1.19 -> 9.77 |
| `pnpm --filter @openverify/db test:integration` | 0 | 110 | 127 | 9.07 -> 17.67 |
| integration `--project graph`; `--project api --shard=1/3`, 2/3, 3/3 | 0 each | 13; 123, 128, 193 | 45; 156, 214, 143 | 16.3 -> 18.4 |
| `apps/api` `src/test-support` (vitest) | 1, then 0 after `7ea598b6f` | 70 of 71, then 71 | 21 | 18.4 |
| `benchmark:typecheck`, `benchmark:test` (watchlist) | 0, 0 | 119 | | 1-2 |
| `images.test.sh pins`, `static`; `refresh-digests.test.sh`; `compose.test.sh --static-only`; `vision-container.test.sh --static-only`; `apps-image-context.test.sh` | 0 each | 24, 149, 18, 584, 24, 43 | 0-3 | 12.9 |

The integration calls pulled the pinned digests (`docker image ls --digests`: `pgvector/pgvector` at
`sha256:cf134a76...` and `valkey/valkey` at `sha256:3add1a33...`, untagged beside the moved tags).

CHECKPOINT pins DONE at 7ea598b6fb3ae917764c2ecdabd4341b73b03e12

Handoff: `VALKEY_TEST_IMAGE` (`apps/api/src/test-support/integration-valkey.ts`), `RUSTFS_TEST_IMAGE`
and `POSTGRES_TEST_IMAGE` carry the digests; a new Valkey test imports the constant. Refresh a pin with
`bash infra/scripts/refresh-digests.sh <image>:<tag>` by hand, check the build's age (14 days),
then change the constant, compose and `images.test.sh`'s pin together. The chart's references are
chart-policy-11c's test.

## 4. Checkpoint compose (C257.3, orchestrator decision 20, plan amendment 14)

### 4.1 db:migrate's backfill with the KEK as a file; the migration role's files (amendment 14)

RED `7c2ff257e` (`migrate.integration.test.ts`, a real Postgres): an event sealed under a KEK before
schema v2, then `runMigrateCommand({DATABASE_URL, OPENVERIFY_KEK_FILE})` -> `expected 1 to be +0`
(the backfill opens sealed payloads with the process keyring, which reads `OPENVERIFY_KEK` only).
RED `aa7a7dd8d` (`migrate.test.ts`): `migrationRoleEnv` reads the migration URL, the KEK and the
pepper from their files and refuses both forms (2 failing). GREEN `6f2319489`: `runMigrateCommand`
installs the keyring from the resolved environment for its run when the KEK is given as a file;
`migrationRoleEnv` resolves every secret's `_FILE` form (`ConfigError` on an issue), so `seed:dev`
and `kek:rewrap` (its keyring now from that environment) read the chart's files.
`refactor d883eb7d8`: the keyring is installed only for the file form, so a KEK in the environment
keeps its lazy reading (the live app-profile check below first met the example's placeholder KEK in
migrate, where a run with nothing to backfill never parsed it before). migrate integration 4 passed;
`migrate.test.ts` 15 passed.

### 4.2 The app profile on the five images; the context test; the images-mode override

RED `2bb82e42a` (`compose.test.sh`, a named borrowed edit; 26 failing on the old profile: the images,
the Dockerfiles, read-only with a tmpfs `/tmp`, migrate's `node dist/commands/db-migrate.js`, `/ready`,
the worker's `node dist/worker-health.js`, `OPENVERIFY_FLOW_API_URL`, no apps.Dockerfile, no VITE build
argument, seed:dev's compiled command in the header). RED `04cb9cc28` (`apps-image-context.test.sh`
moved to the new Dockerfiles' contexts: the root's, vision's own and the two files vision takes from
`repo`; 4 failing: apps.Dockerfile still there, vision's context holding a weight and two MMDBs).
GREEN `b78c82f93`: `infra/docker-compose.yml` (migrate, api and worker on `openverify/api:11c-local`, flow,
dashboard, vision and code-runner on theirs; every Node service read-only, a tmpfs `/tmp`, every
capability dropped, no new privileges; the ip-reputation mount, the providers and every 7A-11B
variable kept where they were), `infra/docker/apps.Dockerfile` deleted, `services/vision/.dockerignore`
(`models`, `**/*.onnx`, `**/*.mmdb`, `**/*.mmdb.gz`), the root `.dockerignore`'s header, and
`flow-headers.test.sh` (its live half on `openverify/flow:11c-local`, `FLOW_IMAGE`; its command the
image's). Borrowed edits for the removal: `code-runner.test.sh` (`3088ab6cf`) and integration-11c's
`ci-workflow.test.sh` (`3617c7ec6`, one line: CI's Node read from api.Dockerfile). compose.test.sh
static 612 passed; apps-image-context 66 passed.

RED `9f570af2c` (`images.test.sh override`, the file missing), GREEN `d40bd15e3`:
`e2e/setup/docker-compose.images.yml` (every app service on the host's network reading the e2e env's
loopback addresses and ports, the 11c-local images never pulled, the receiver's certificate and the
sandbox chip's faces read-only, `OPENVERIFY_E2E_FLOW_PORT`, `_DASHBOARD_PORT`, `_VISION_PORT` required);
33 passed.

### 4.3 The app profile live, in a project of its own

`app-profile-check.sh` (scratch; project `openverify-11c-appcheck`, its own ports, `.env.example` with
synthetic keys and seed passwords in place of the placeholders, `up -d --wait --no-build`, removed with
its volumes after), the API image rebuilt first (211 s, load 1.8), e2e lock, 60 s, load 1.8 -> 3.2:

```
ok   up: every service healthy (api /ready, worker exec probe, flow, dashboard, vision, runner)
migrate exited 0; api, worker, flow, dashboard, vision, code-runner running healthy
api /ready 200
flow / 200 config.json {"api-url":"http://127.0.0.1:33000"}
dashboard /login 200
ok   seed:dev from the API image's compiled command
ok   api, flow and dashboard wrote nothing outside /tmp; the worker's only change is its socket
     volume's mount point /run/code-runner (and the API's and the worker's the ip-reputation mount point)
```

`compose.test.sh`'s live half was **not run**: it starts the infrastructure as the project `openverify`
(its `project=openverify` and the file's `name:`), which is the developer's (four `openverify_*` volumes
exist), and rule 19 forbids touching it; the pinned infrastructure images were pulled by digest
instead (`docker pull` of aws-cli, mailpit and rustfs; pgvector and valkey by the integration run).

### 4.4 Gate (affected scope: `apps/api` migrate and kek:rewrap, `infra/`, `e2e/setup/`; the whole API suite at the last checkpoint), G = `/tmp/img-gate-4`

| Call | rc | Result | s | load |
|---|---|---|---|---|
| `pnpm turbo run typecheck --force --filter=@openverify/api` | 0 | | 136 | 2.69 -> 1.29 |
| forced lint `--filter=@openverify/api` | 0 | | 355 | 1.29 -> 1.64 |
| vitest: migrate, kek-rewrap, commands-build, package-scripts, seed/, config-registry | 0 | 147 | 67 | 1.51 -> 6.71 |
| integration `src/migrate.integration.test.ts` | 0 | 4 | 30 | 6.71 -> 4.84 |
| `images.test.sh static`, `pins`, `override` | 0 | 149, 24, 33 | 0-2 | 4.8 |
| `apps-image-context`, `compose --static-only`, `vision-container --static-only`, `flow-headers --static-only`, `code-runner --static-only`, `ci-workflow` | 0 each | 66, 612, 24, 12, 21, 417 | 0-12 | 4.5 -> 3.8 |
| `flow-headers.test.sh` live (the flow image) | 0 | 26 | 3 | 3.52 |
| `images.test.sh api` (the rebuilt image) | 0 | 54 | 71 | 3.40 -> 2.70 |

CHECKPOINT compose DONE at d883eb7d8ee3d6dd76cfe1ad79e5597459f7710f

Handoff (integration-11c, chart-11c): the compose app profile's services and images: `migrate`,
`api`, `worker` (`openverify/api:11c-local`, commands `node dist/commands/db-migrate.js`,
`node dist/server.js`, `node dist/worker.js`; healthchecks `/ready` and `node dist/worker-health.js`),
`flow` (`openverify/flow:11c-local`, `OPENVERIFY_FLOW_API_URL` else `VITE_OPENVERIFY_API_URL`),
`dashboard` (`openverify/dashboard:11c-local`, port 3000 in its container), `vision`
(`openverify/vision:11c-local`, build context `../services/vision` with `additional_contexts: {repo: ..}`),
`code-runner` (`openverify/code-runner:11c-local`, socket). seed:dev: `docker compose ... --profile app
run --rm migrate node dist/commands/seed-dev.js`. The images mode: `--file infra/docker-compose.yml --file
e2e/setup/docker-compose.images.yml --env-file e2e/.env.e2e --profile app up -d --wait --no-build`, with
`OPENVERIFY_E2E_FLOW_PORT`, `OPENVERIFY_E2E_DASHBOARD_PORT` and `OPENVERIFY_E2E_VISION_PORT` added to the
env file by the driver; seed with `run --rm --no-deps migrate node dist/commands/seed-dev.js --json`.

## 5. Checkpoint code-runner-tcp (C263.6, Phase 8 P17) and the final gate

Stubs `4d92e5e93` (`serveCodeRunner`'s `listen` option and `address`; `readCodeRunnerToken`). RED
`5d5a1759b` (`tcp.test.ts`, `runner-token.test.ts`; `transport.test.ts`'s "no client yet" case became
"builds a client"): 21 failing. GREEN `bd8f08ec5` (named borrowed edit of Phase 8's runner):
- `connectCodeRunnerOverTcp` (`createTcpRunner` in `socket-client.ts`): the socket client over TCP,
  its first frame `{kind: 'auth', token}`; a token under 32 bytes is a `TypeError` naming
  `OPENVERIFY_CODE_RUNNER_TOKEN`, never the value;
- `serveCodeRunner({listen: {host, port, token}})`: each connection's first frame alone (1 KiB cap,
  5 s) must be that frame with the token, compared as SHA-256 digests with `timingSafeEqual`; anything
  else closes the connection without a word; then the socket's `serveConnection` (its frame cap,
  depth limit, schemas and `evaluateRequestAllowed`) unchanged;
- `readCodeRunnerToken` (the runner's `OPENVERIFY_CODE_RUNNER_TOKEN` or `_FILE` with the API's rules);
- `bin/code-runner-server.mjs`: `OPENVERIFY_CODE_RUNNER_LISTEN=<host>:<port>` listens on TCP with the
  token (refusing to start without one, naming the variable), and `--health` proves the token too.
One fix of the RED's own race before GREEN: its oversized-frame case wrote behind the token in one
chunk, which the gate refuses as pipelined; it now writes after `ready`, as a client does.

```
$ (cd packages/workflow-engine && pnpm exec vitest run src/code-runner --coverage.enabled=false)   # 267 passed
$ OPENVERIFY_CODE_RUNNER_LISTEN=127.0.0.1:47700 OPENVERIFY_CODE_RUNNER_TOKEN=<synthetic> node bin/code-runner-server.mjs --health   # 0
  ... with another token: 1; OPENVERIFY_CODE_RUNNER_TOKEN=short: "OPENVERIFY_CODE_RUNNER_TOKEN: must be at least 32 bytes", 1
```

`images.test.sh code-runner` RED `162e89427` (3 failing on the old image, whose `docker run` without a
token served the socket forever: the case is now bounded and named), GREEN with the rebuilt image
(27 passed: the token from a file at 0440, another token and no token refused, never logged).
`ffa71921e` added `EXPOSE 7700`, which Phase 8's `code-runner.test.sh` refuses ("it publishes no
port", met in the final gate); `83abb29b7` removed it (the chart's Service names 7700) and holds it.
`3597a4c24`: contracts-11c's `egress-config-tcp.test.ts` expected the stub's "not built yet"; it now
checks that the worker builds the client (a borrowed edit; the behaviour changed as planned).

### 5.1 The final gate (this agent's last checkpoint: the proof for every earlier one), G = `/tmp/img-gate-final`

Every call its own foreground call; each exit code the command's own (a lone blob shard exits 1 on its
partial coverage; the merge is the gate):

```
    build-api rc=0 secs=152 load=1.36 0.74 1.11 -> 2.94 1.70 1.42
    build-dashboard rc=0 secs=127 load=2.94 1.70 1.42 -> 3.93 2.48 1.74
    build-flow rc=0 secs=36 load=3.86 2.49 1.75 -> 3.84 2.65 1.84
    build-flow-noguidance rc=0 secs=34 load=3.84 2.65 1.84 -> 2.93 2.54 1.82
    build-vision rc=0 secs=2 load=2.93 2.54 1.82 -> 3.10 2.58 1.84
    build-code-runner rc=0 secs=42 load=3.10 2.58 1.84 -> 2.21 2.41 1.81
    images-static rc=0 secs=1 load=2.03 2.37 1.80 -> 2.03 2.37 1.80
    images-pins rc=0 secs=1 load=2.03 2.37 1.80 -> 2.03 2.37 1.80
    images-override rc=0 secs=0 load=2.03 2.37 1.80 -> 2.03 2.37 1.81
    images-api rc=0 secs=60 load=2.03 2.37 1.81 -> 2.08 2.32 1.83
    images-dashboard rc=0 secs=11 load=2.08 2.32 1.83 -> 2.23 2.35 1.84
    images-flow rc=0 secs=11 load=2.23 2.35 1.84 -> 2.04 2.30 1.83
    images-flow-noguidance rc=0 secs=11 load=2.04 2.30 1.83 -> 2.25 2.34 1.85
    images-vision rc=0 secs=15 load=2.25 2.34 1.85 -> 2.58 2.42 1.88
    images-code-runner rc=0 secs=11 load=2.58 2.42 1.88 -> 3.36 2.59 1.94
    apps-image-context rc=0 secs=0 load=2.92 2.52 1.93 -> 2.77 2.49 1.92
    compose-static rc=0 secs=3 load=2.77 2.49 1.92 -> 2.77 2.49 1.92
    vision-container-static rc=0 secs=1 load=2.77 2.49 1.92 -> 2.77 2.49 1.92
    flow-headers-static rc=0 secs=0 load=2.77 2.49 1.92 -> 2.77 2.49 1.92
    flow-server rc=0 secs=0 load=2.77 2.49 1.92 -> 2.77 2.49 1.92
    refresh-digests rc=0 secs=0 load=2.77 2.49 1.92 -> 2.77 2.49 1.92
    ci-workflow rc=0 secs=10 load=2.77 2.49 1.92 -> 2.57 2.46 1.92
    code-runner-static rc=1 secs=1 load=2.57 2.46 1.92 -> 2.57 2.46 1.92
    vision-container-live rc=0 secs=16 load=2.57 2.46 1.92 -> 2.78 2.50 1.94
    flow-headers-live rc=0 secs=3 load=2.78 2.50 1.94 -> 2.78 2.50 1.94
    code-runner-live rc=69 secs=0 load=2.78 2.50 1.94 -> 2.78 2.50 1.94
    code-runner-static rc=0 secs=1 load=2.23 2.39 1.91 -> 2.23 2.39 1.91
    build-code-runner rc=0 secs=46 load=2.23 2.39 1.91 -> 1.67 2.22 1.88
    images-code-runner rc=0 secs=11 load=1.67 2.22 1.88 -> 2.06 2.29 1.91
    code-runner-live rc=69 secs=0 load=2.06 2.29 1.91 -> 2.06 2.29 1.91
    code-runner-live rc=0 secs=11 load=1.90 2.25 1.90 -> 1.93 2.24 1.90
    typecheck rc=0 secs=135 load=1.63 2.17 1.88 -> 3.23 3.23 2.36
    lint-api rc=0 secs=266 load=2.81 3.14 2.34 -> 2.09 2.32 2.17
    lint-rest rc=0 secs=175 load=2.09 2.32 2.17 -> 1.45 1.94 2.05
    lint-dashboard rc=0 secs=173 load=1.45 1.94 2.05 -> 1.44 1.73 1.95
    we-test rc=0 secs=21 load=1.44 1.73 1.95 -> 2.40 1.93 2.01
    flow-test rc=0 secs=103 load=1.86 1.83 1.98 -> 7.13 3.62 2.60
    db-test rc=0 secs=173 load=7.13 3.62 2.60 -> 10.12 6.76 4.01
    watchlist-test rc=0 secs=273 load=10.12 6.76 4.01 -> 1.19 3.61 3.39
    dash-1 rc=1 secs=219 load=1.19 3.61 3.39 -> 7.05 5.82 4.35
    dash-2 rc=1 secs=227 load=7.05 5.82 4.35 -> 6.96 6.88 5.14
    dash-merge rc=0 secs=6 load=6.96 6.88 5.14 -> 6.48 6.78 5.12
    api-1 rc=1 secs=139 load=4.64 6.34 5.01 -> 7.17 6.97 5.44
    api-2 rc=1 secs=122 load=7.17 6.97 5.44 -> 7.31 7.34 5.78
    api-3 rc=1 secs=165 load=7.31 7.34 5.78 -> 7.34 7.68 6.18
    api-4 rc=1 secs=135 load=7.34 7.68 6.18 -> 6.83 7.54 6.34
    api-5 rc=1 secs=145 load=6.83 7.54 6.34 -> 8.39 7.98 6.68
    api-6 rc=1 secs=147 load=8.39 7.98 6.68 -> 7.85 8.03 6.89
    api-7 rc=1 secs=145 load=7.85 8.03 6.89 -> 6.99 7.94 7.04
    api-8 rc=1 secs=125 load=6.99 7.94 7.04 -> 7.62 7.90 7.13
    api-9 rc=1 secs=124 load=7.62 7.90 7.13 -> 7.88 7.97 7.26
    api-10 rc=1 secs=138 load=7.88 7.97 7.26 -> 7.83 8.22 7.46
    api-11 rc=1 secs=119 load=7.83 8.22 7.46 -> 8.16 8.33 7.60
    api-12 rc=1 secs=123 load=8.16 8.33 7.60 -> 7.97 8.40 7.72
    api-merge rc=0 secs=66 load=7.97 8.40 7.72 -> 3.35 6.95 7.27
    int-db rc=0 secs=120 load=2.21 6.39 7.07 -> 18.58 11.09 8.70
    int-graph rc=0 secs=48 load=18.58 11.09 8.70 -> 10.42 10.02 8.45
    int-api-1 rc=0 secs=126 load=10.42 10.02 8.45 -> 17.48 12.81 9.68
    int-api-2 rc=0 secs=190 load=17.48 12.81 9.68 -> 10.29 13.77 10.78
    int-api-3 rc=0 secs=127 load=10.29 13.77 10.78 -> 15.72 14.57 11.43
    vision-static rc=0 secs=1 load=15.72 14.57 11.43 -> 14.54 14.35 11.37
    vision-1 rc=0 secs=157 load=14.54 14.35 11.37 -> 2.15 8.99 9.79
    vision-2 rc=0 secs=184 load=2.15 8.99 9.79 -> 2.77 5.77 8.36
    vision-3 rc=0 secs=307 load=2.77 5.77 8.36 -> 1.69 3.16 6.47
    flow-e2e rc=0 secs=125 load=1.69 3.16 6.47 -> 10.97 6.24 7.19
    format-check rc=0 secs=117 load=10.97 6.24 7.19 -> 2.88 4.76 6.53
```

Results: images.test.sh static 149, pins 24, override 33, api 54, dashboard 27, flow 33,
flow-noguidance 32, vision 28, code-runner 27; apps-image-context 66; compose static 612 (live half not
run: rule 19, the developer's project; the app profile was proven live in 4.3); vision-container 24
static and 55 live; flow-headers 12 static and 26 live (the flow image); flow-server 38;
refresh-digests 18; ci-workflow 417 (0 skipped); code-runner 21 static and 55 live. Typecheck (6
packages) and lint (api; flow, workflow-engine, db, watchlist; dashboard) forced, rc 0.
workflow-engine 2,042 at 97.9%; flow 1,678 at 95.01%; db 2,357 at 89.88%; watchlist 820 at 98.63%;
dashboard 7,235 in 622 files at 95.62%; API 10,886 in 858 files at 94.16% (12 shards, 119-165 s each
at load 4.6 to 8.4, merge 66 s); integration db 110, graph 13, api 123 + 129 + 193 (445); vision
903 + 827 + 957 = 2,687 at 97.45%; mocked flow suite 349; pnpm format:check clean.

Final image sizes (`docker images`, load 2-3): api 604 MB, dashboard 388 MB, flow 349 MB, flow
no-guidance 330 MB, vision 707 MB, code-runner 380 MB; build times as the table shows (warm cache).

CHECKPOINT code-runner-tcp DONE at 83abb29b729a1dfb3a3b159a04f07b5a967a29ef

Handoff: the worker's `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<host>:<port>` with
`OPENVERIFY_CODE_RUNNER_TOKEN` (or `_FILE`, at least 32 bytes) reaches the runner image started with
`OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:7700` and the same token (or `_FILE`); its probe is
`node bin/code-runner-server.mjs --health` in either mode; the image exposes no port (the chart's
Service names 7700). The socket form is unchanged and stays compose's.
