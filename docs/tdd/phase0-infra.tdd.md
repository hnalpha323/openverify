# TDD evidence: Phase 0, infra-ci

Slice owner: infra-ci agent. Date: 2026-10-20.

Owned paths:
- `infra/`, `.github/`, `.githooks/`
- `.env.example`
- `THIRD_PARTY_LICENSES.md`
- `docs/adr/0001-stack.md`, `docs/adr/0002-check-tiers.md`
- this file

All output below is copied from real runs in this session. Long passing runs are trimmed, and trims are marked `[...]`.

## Plan task

`docs/PLAN.md` §6, Phase 0, steps 3–4 (infrastructure half):
1. `infra/docker-compose.yml`:
   - Postgres 17 + pgvector, a Redis-protocol store, S3-compatible storage with a one-shot init that creates the bucket `openverify-files` with versioning, and Mailpit;
   - every service gets a healthcheck, a named volume and env-configurable ports;
   - defaults live in `.env.example`, with placeholder secrets only.
2. `.github/workflows/ci.yml` with the jobs `node`, `integration`, `vision`, `android`, `android-instrumented` and `secrets`. Actions are pinned to current majors that were verified with `gh api`.
3. gitleaks:
   - install the latest release binary after checksum verification;
   - add a `.githooks/pre-commit` hook that scans staged changes;
   - test it in a scratch repository under `/tmp/claude-1000`.
4. `THIRD_PARTY_LICENSES.md` skeleton.
5. ADR 0001 (stack and monorepo) and ADR 0002 (check tiers and the honesty policy).

### Versions (all checked 2026-10-20)

| Item | Version | How it was verified |
|---|---|---|
| `pgvector/pgvector` | `pg17` (PG 17.11, pgvector 0.8.7) | Docker Hub tags API: the `pg17` tag is active, updated 2026-10-01 |
| `valkey/valkey` | `9.1` (9.1.2) | Docker Hub tags plus GitHub releases. `9.2` points to `9.2.0-rc1`, so it was avoided |
| `rustfs/rustfs` | `1.0.3` | Docker Hub plus GitHub release `1.0.3` (not a prerelease, 2026-10-17) |
| `amazon/aws-cli` | `2.38.2` | Docker Hub |
| `axllent/mailpit` | `v1.31` (1.31.6) | Docker Hub |
| gitleaks | 8.30.1 | GitHub `releases/latest`. SHA-256 `551f6fc8…70eb` matches both the release checksums file and the GitHub asset digest |
| actionlint | 1.7.12 | GitHub `releases/latest`. The tarball matched both the release checksums file and the asset digest |
| GitHub Actions | checkout@v7, setup-node@v7, cache@v6, setup-java@v6, upload-artifact@v7, setup-android@v4, android-emulator-runner@v2, setup-uv@v10.3.0 | `gh api repos/<r>/releases/latest` and `gh api repos/<r>/git/ref/tags/<major>`. setup-uv has no `v10` tag, so it is pinned to the exact release |
| Emulator image | `system-images;android-36;google_apis;x86_64` | Google sys-img repository index `sys-img2-4.xml` |

## Tests (written first)

All tests are plain bash and print `ok` / `FAIL` lines plus a summary. They exit non-zero on any failure.

| Test | What it asserts |
|---|---|
| `infra/tests/compose.test.sh` | **Static:** <ul><li>the five services exist;</li><li>`postgres` runs `pgvector/pgvector:pg17`;</li><li>no `:latest` images;</li><li>each long-running service has a healthcheck and a named volume;</li><li>`objectstore-init` waits for a healthy store and is one-shot;</li><li>each of the six ports publishes on `127.0.0.1` with the `.env.example` default and follows an env override;</li><li>compose refuses to render without secrets;</li><li>every secret in `.env.example` is a `change-me-*` placeholder.</li></ul> **Live:** <ul><li>`up -d --wait` succeeds and all four services are `healthy`;</li><li>the init exited 0;</li><li>the `vector` extension is installed and computes a distance;</li><li>Valkey answers PONG with auth and rejects clients without it (`NOAUTH`);</li><li>the bucket has versioning `Enabled`;</li><li>the readiness endpoints answer on host ports, and all six host ports accept TCP;</li><li>`down` without `-v` keeps all four volumes.</li></ul> |
| `infra/tests/install-gitleaks.test.sh` | <ul><li>A wrong SHA-256 pin aborts with "checksum" in the message and installs nothing.</li><li>The default install verifies the release checksums file **and** the pin, installs an executable, and the binary reports the pinned version.</li></ul> |
| `infra/tests/pre-commit-hook.test.sh` | Runs in a throwaway repository under `$SCRATCH_ROOT`, with `core.hooksPath` set to this repo's `.githooks`. <ul><li>A clean staged change commits.</li><li>A staged fake AWS key is blocked: HEAD does not move, rule `aws-access-token` is reported, and the secret is not echoed.</li><li>A secret that is only in the unstaged tree does not block a clean staged change.</li><li>Without gitleaks the hook fails closed and points to the installer.</li></ul> The fake key is generated at runtime (`AKIA` plus base32 of 10 random bytes), so no secret-shaped literal exists in this repository. |
| `infra/tests/ci-workflow.test.sh` | <ul><li>The YAML parses (PyYAML 6.0.1).</li><li>The six jobs exist, with the agreed commands.</li><li>Top-level permissions are `contents: read`; there is no `pull_request_target`; concurrency is set.</li><li>Every job has a timeout and runs on Ubuntu.</li><li>actionlint passes.</li><li>Every action is pinned to a version tag, is not on the deny-list (`gradle/actions`, `gitleaks/gitleaks-action`), and its tag exists on GitHub (`gh api`).</li></ul> |

## RED

### Compose

The test was committed as `a8b0922`.

```
$ infra/tests/compose.test.sh
FAIL - infra/docker-compose.yml exists

# 0 passed, 1 failed
exit=1
```

### gitleaks installer and hook

The tests were committed as `351a905`. Without the hook, the fake-key commit and the "missing gitleaks" commit both went through, which is the intended reason for the failure.

```
$ infra/tests/install-gitleaks.test.sh
FAIL - infra/scripts/install-gitleaks.sh exists and is executable

# 0 passed, 1 failed
exit=1

$ infra/tests/pre-commit-hook.test.sh
FAIL - .githooks/pre-commit exists and is executable
ok   - a clean staged change is committed
ok   - HEAD advances after a clean commit
FAIL - a staged fake AWS key blocks the commit (commit succeeded)
FAIL - HEAD does not move when the commit is blocked
FAIL - the finding names the aws-access-token rule ([main bcedb54] feat: add credentials  1 file changed, 3 insertions(+)  create mode 100644 credentials.ini )
ok   - the hook output redacts the secret
ok   - an unstaged secret does not block a clean staged change
FAIL - the hook fails closed without gitleaks (commit succeeded)
FAIL - the fail-closed message points to the installer ([main 8383079] feat: more  1 file changed, 1 insertion(+)  create mode 100644 more.txt )
FAIL - HEAD does not move when gitleaks is missing

# 4 passed, 7 failed
exit=1
```

### CI workflow

The test was committed as `282ff58`.

```
$ infra/tests/ci-workflow.test.sh
FAIL - .github/workflows/ci.yml exists

# 0 passed, 1 failed, 0 skipped
exit=1
```

## GREEN

### Compose

The implementation was committed as `7b76037`. First, the exact verification command from the task, run on fresh volumes:

```
$ docker compose -f infra/docker-compose.yml --env-file .env.example up -d --wait
[...]
 Container openverify-redis-1 Healthy
 Container openverify-mailpit-1 Healthy
 Container openverify-objectstore-init-1 Healthy
 Container openverify-objectstore-1 Healthy
 Container openverify-postgres-1 Healthy

real	0m5.177s
exit=0
SERVICE            IMAGE                    STATUS                   PORTS
mailpit            axllent/mailpit:v1.31    Up 3 seconds (healthy)   127.0.0.1:1025->1025/tcp, 127.0.0.1:8025->8025/tcp
objectstore        rustfs/rustfs:1.0.3      Up 3 seconds (healthy)   127.0.0.1:9000-9001->9000-9001/tcp
objectstore-init   amazon/aws-cli:2.38.2    Up 1 second
postgres           pgvector/pgvector:pg17   Up 3 seconds (healthy)   127.0.0.1:5432->5432/tcp
redis              valkey/valkey:9.1        Up 3 seconds (healthy)   127.0.0.1:6379->6379/tcp

$ docker compose ... logs objectstore-init
objectstore-init-1  | objectstore-init: bucket openverify-files ready (versioning Enabled)
```

This run exposed a real gap: `--wait` reports a one-shot job without a healthcheck as "Healthy" while it is still running. It does not wait for the job to finish.

The fix had two parts:
- The test now polls `objectstore-init` until it exits and asserts exit code 0.
- The compose file documents that app services must declare `depends_on: objectstore-init: service_completed_successfully`.

`docker compose wait` was tried and rejected: it prints `No containers for project "openverify"` once the job has already exited.

The final full run:

```
$ infra/tests/compose.test.sh
ok   - infra/docker-compose.yml exists
[... 40 more static checks, all ok ...]
ok   - compose up -d --wait succeeds
ok   - service 'postgres' is healthy
ok   - service 'redis' is healthy
ok   - service 'objectstore' is healthy
ok   - service 'mailpit' is healthy
ok   - objectstore-init ran once and exited 0
ok   - pgvector extension is installed
ok   - pgvector computes an L2 distance
ok   - redis answers PONG to an authenticated client
ok   - redis rejects unauthenticated clients
ok   - .env.example names the bucket openverify-files
ok   - bucket 'openverify-files' has versioning Enabled
ok   - objectstore readiness endpoint answers on the host port
ok   - mailpit readiness endpoint answers on the host port
ok   - host port 127.0.0.1:5432 (postgres:5432) accepts TCP
[... 5 more host ports ok ...]
ok   - compose down (volumes kept) succeeds
ok   - volume openverify_postgres-data survives down
ok   - volume openverify_redis-data survives down
ok   - volume openverify_objectstore-data survives down
ok   - volume openverify_mailpit-data survives down

# 66 passed, 0 failed
```

The final state after the run: no containers, and the volumes `openverify_{mailpit,objectstore,postgres,redis}-data` still exist. Teardown used `down` without `-v`.

### gitleaks installer and hook

The implementation was committed as `cfde43d`.

```
$ infra/scripts/install-gitleaks.sh            # real install into ~/.local/bin
install-gitleaks: downloading gitleaks_8.30.1_linux_x64.tar.gz
install-gitleaks: release checksums file: OK
install-gitleaks: pinned SHA-256: OK (551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb)
install-gitleaks: installed 8.30.1 to /home/mhnoor/.local/bin/gitleaks

$ infra/tests/install-gitleaks.test.sh
ok   - infra/scripts/install-gitleaks.sh exists and is executable
ok   - mismatched SHA-256 pin aborts the install
ok   - mismatch is reported as a checksum failure
ok   - nothing is installed after a checksum failure
ok   - pinned install succeeds
ok   - release checksums file is verified
ok   - pinned SHA-256 is verified
ok   - gitleaks is installed as an executable
ok   - installed gitleaks reports the pinned version (8.30.1)

# 9 passed, 0 failed

$ SCRATCH_ROOT=/tmp/claude-1000/.../scratchpad infra/tests/pre-commit-hook.test.sh
ok   - .githooks/pre-commit exists and is executable
ok   - a clean staged change is committed
ok   - HEAD advances after a clean commit
ok   - a staged fake AWS key blocks the commit
ok   - HEAD does not move when the commit is blocked
ok   - the finding names the aws-access-token rule
ok   - the hook output redacts the secret
ok   - an unstaged secret does not block a clean staged change
ok   - the hook fails closed without gitleaks
ok   - the fail-closed message points to the installer
ok   - HEAD does not move when gitleaks is missing

# 11 passed, 0 failed
```

The same test also passed with `PATH=/usr/bin:/bin`, which exercises the hook's `~/.local/bin/gitleaks` fallback: `# 11 passed, 0 failed`.

Hook output for a blocked commit in a scratch repository under `/tmp/claude-1000`. The fake key was generated at runtime:

```
Finding:     REDACTED
Secret:      REDACTED
RuleID:      aws-access-token
Entropy:     3.821928
File:        creds.ini
Line:        1
Fingerprint: creds.ini:aws-access-token:1

12:35AM INF 0 commits scanned.
12:35AM INF scanned ~41 bytes (41 bytes) in 208ms
12:35AM WRN leaks found: 1
pre-commit: gitleaks reported potential secrets (or failed) on the staged changes; commit blocked.
pre-commit: remove the secret, or for a verified false positive add its fingerprint to .gitleaksignore.
commit-exit=1
fatal: your current branch 'main' does not have any commits yet
```

The hook uses the subcommand that matches the installed version:
- for gitleaks 8.30.1, `gitleaks git --pre-commit --staged <repo>`, as listed in `gitleaks git --help`: `--pre-commit  scan using git diff` and `--staged  scan staged commits (good for pre-commit)`;
- for releases older than 8.19, which lack the `git` subcommand, the deprecated `protect --staged --source <repo>`.

### CI workflow

The implementation was committed as `2ea446e`.

```
$ infra/tests/ci-workflow.test.sh
ok   - .github/workflows/ci.yml exists
ok   - ci.yml parses as YAML
[... 46 more structural checks, all ok ...]
ok   - actionlint 1.7.12 reports no problems
ok   - actions/cache@v6 is pinned to a version tag
ok   - actions/cache tag v6 exists on GitHub
ok   - actions/checkout@v7 is pinned to a version tag
ok   - actions/checkout tag v7 exists on GitHub
[...]
ok   - astral-sh/setup-uv@v10.3.0 is pinned to a version tag
ok   - astral-sh/setup-uv tag v10.3.0 exists on GitHub
ok   - reactivecircus/android-emulator-runner@v2 is pinned to a version tag
ok   - reactivecircus/android-emulator-runner tag v2 exists on GitHub

# 65 passed, 0 failed, 0 skipped
```

The workflow's own shell steps were also run locally against the real repository:

```
== wrapper verification step (android/)
gradle/wrapper/gradle-wrapper.jar: OK
== detect step
present=false
== secrets job steps
install-gitleaks: installed 8.30.1 to /tmp/claude-1000/.../runner-temp.zfIXlL/bin/gitleaks
12:40AM INF 22 commits scanned.
12:40AM INF scanned ~457502 bytes (457.50 KB) in 305ms
12:40AM INF no leaks found
```

### Final regression run

This ran after all commits, on the committed state:

```
compose exit=0 # 66 passed, 0 failed
install-gitleaks exit=0 # 9 passed, 0 failed
pre-commit-hook exit=0 # 11 passed, 0 failed
ci-workflow exit=0 # 65 passed, 0 failed, 0 skipped
```

## Coverage

This slice is configuration and shell, so line coverage tools do not apply: there is no kcov or bashcov in the toolchain. Coverage is reported as **requirement coverage**, meaning each task requirement maps to at least one passing assertion.

| Requirement | Assertions | Status |
|---|---|---|
| pgvector `pg17`, Redis-protocol store, S3 store + versioned `openverify-files` init, Mailpit | compose: services and image checks, pgvector probes, NOAUTH/PONG, versioning `Enabled`, mailpit readyz | covered |
| Healthcheck, named volume, env-configurable ports per service | compose: 4 healthcheck, 4 volume and 12 port assertions | covered |
| `.env.example` placeholder secrets only | compose: placeholder regex over every secret-like key; secrets required | covered |
| `up -d --wait` healthy, then `down` keeps volumes | compose live section; 4 volume-survival assertions | covered |
| CI jobs and commands, pinned and verified actions | ci-workflow: 48 structural (including file exists and YAML parses), 1 actionlint and 16 pinning/remote assertions | covered **statically**. The workflow has **not run on GitHub yet** (no push in this slice) |
| gitleaks latest release, checksum-verified, in `~/.local/bin` | install-gitleaks: 9 assertions; real install shown above | covered |
| Pre-commit hook blocks staged secrets, correct subcommand | pre-commit-hook: 11 assertions in a scratch repo | covered. The `protect` fallback for gitleaks < 8.19 is **not exercised**, because no old binary is installed |
| THIRD_PARTY_LICENSES skeleton; ADR 0001 and 0002 | documents (no executable test) | delivered, reviewed manually |

## Other checks

- **Secret scanning of this repository** with `gitleaks git` over the history: `no leaks found`, at 14 commits and again at 22.
- **No `.gitleaks.toml` was added, because none is needed.**
  - `gitleaks dir` over the working tree reported 8 findings, all in git-ignored Next.js build output under `apps/dashboard/.next/`. `git check-ignore` returned yes for every file.
  - git-mode scanning, which is what the hook and CI use, never sees those files.
  - `.env.example` does not trigger any rule.
- **actionlint** ran without shellcheck integration, because shellcheck is not installed. Shell bodies of `run:` steps were not linted by shellcheck.

## Deviations and decisions

| Task wording | What was done | Why |
|---|---|---|
| "redis: latest stable major" | Service `redis` runs **Valkey 9.1** (BSD-3) | The latest Redis major (8.10.2) is RSALv2/SSPLv1/AGPLv3, which fails the permissive-only rule. Valkey is wire-compatible. See ADR 0001 |
| "minio, plus a one-shot minio/mc init" | Service `objectstore` runs **RustFS 1.0.3** (Apache-2.0). `objectstore-init` uses the **AWS CLI** | The `minio/minio` and `minio/mc` images return 404 on Docker Hub, the upstream repositories are archived, and MinIO is AGPL-3.0. See ADR 0001 |
| `pg17` vs. "Postgres 16" in `docs/PLAN.md` §3 | `pg17`, as the task says | The plan text needs updating (follow-up) |
| `pnpm -r test -- --coverage` in `docs/PLAN.md` §8 | CI runs `pnpm test`; each package's `test` script is already `vitest run --coverage` | A local check showed that pnpm 12 forwards the literal `--` to the script (`$ node -e ... -- --coverage`), which vitest would not treat as a flag |
| gitleaks via `gitleaks/gitleaks-action` | Binary via `infra/scripts/install-gitleaks.sh` | The action's license is custom (GitHub: NOASSERTION; organizations need a key) |
| Gradle caching via `gradle/actions` | `actions/setup-java` with `cache: gradle`, plus a wrapper-JAR SHA-256 check | `gradle/actions` bundles a proprietary caching component (its LICENSE says so) |
