# TDD evidence: Phase 0, integration verification

Slice owner: phase0-verify agent. Date: 2026-10-20.

Scope: run the full Phase 0 validation after all seven area agents finished (ts-foundation, domain-core, db-api, web-apps, vision-service, android, infra-ci). Files change only to fix integration breakage; no new features.

All output below is copied from real runs in this session. Long passing runs are trimmed, and trims are marked `[...]`.

## Plan task

- `docs/PLAN.md` §6, Phase 0, **Validate**: `pnpm -r lint typecheck test`, `uv run pytest`, Android build, and compose.
- §7: the integration agent merges and runs the full suites.

The validation runs twice:
1. **In the shared working tree** (`/home/mhnoor/persona-opensource`).
2. **In a fresh `git clone` of HEAD** under the session scratchpad, with `CI=true`. This catches anything that works only because of ignored local artifacts: `dist/`, `.next/`, `next-env.d.ts`, `.venv/`, fetched model weights and Gradle `build/` directories.

## Results

| # | Suite | Command | Result |
|---|---|---|---|
| 1 | Install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | **RED** at `905231c` (`ERR_PNPM_IGNORED_BUILDS`); GREEN after fix 1 |
| 2a | Lint | `pnpm -r lint` | 9/9 projects pass |
| 2b | Typecheck | `pnpm -r typecheck` | 9/9 projects pass |
| 2c | Unit tests + coverage | `pnpm -r test` | 981 passed, 0 failed (table below) |
| 3 | DB integration | `pnpm --filter @openverify/db test:integration` | 10 passed (Testcontainers, `pgvector/pgvector:pg17`) |
| 4 | Flow e2e smoke | `pnpm e2e` (turbo builds `^build`, then Playwright against `vite build` + `vite preview`) | 1 passed |
| 5 | Vision | `uv run ruff check`, `uv run ruff format --check`, `uv run mypy src`, `uv run pytest` | clean, clean, clean, 167 passed, 100% coverage |
| 6 | Android | `./gradlew testDebugUnitTest koverVerify assembleDebug` (forced: `--rerun-tasks --no-build-cache`) | 30 passed; Kover 100% lines (17/17), 100% branches (24/24) |
| 7 | Compose | `docker compose -f infra/docker-compose.yml --env-file .env.example config -q` | exit 0 |
| + | Format | `pnpm format:check` | **RED** (3 infra-ci YAML files); GREEN after fix 2 |
| + | Root build | `pnpm build` (clone) | 8/8 turbo tasks pass |
| + | Infra contract tests | `infra/tests/{ci-workflow,compose --static-only,pre-commit-hook,install-gitleaks}.test.sh` | 65 + 41 + 11 + 9 = 126 passed, 0 failed, 0 skipped (actionlint 1.7.12 clean) |

Unit-test coverage per project (statements / branches / functions / lines; the gate is 80% per project):

| Project | Tests | Coverage |
|---|---|---|
| packages/config | 33 | 100 / 100 / 100 / 100 |
| packages/core | 201 | 100 / 100 / 100 / 100 |
| packages/checks | 372 | 99.76 / 97.93 / 100 / 99.75 |
| packages/flow-spec | 81 | 100 / 100 / 100 / 100 |
| packages/db | 70 | 98.58 / 98 / 94.73 / 98.55 |
| packages/ui | 50 | 100 / 97.72 / 100 / 100 |
| apps/api | 50 | 99.16 / 89.36 / 100 / 99.12 |
| apps/flow | 75 | 100 / 98 / 100 / 100 |
| apps/dashboard | 49 | 100 / 100 / 100 / 100 |
| **Total** | **981** | |

In the fresh clone, every suite ran again and passed with the same counts, with three expected differences:
- **Vision:** `uv sync --locked` then pytest gives `163 passed, 4 skipped`. The 4 skipped tests are the real-YuNet tests, which skip because a clone has no fetched weights, and coverage stays 100%.
- **e2e:** passed with `CI=true` on the first attempt, with no retries.
- **Integration:** ran as root `pnpm test:integration`, which is what the CI `integration` job runs.

## Fix 1: dependency build scripts block frozen installs

**RED.** The first command of the validation, run against HEAD `905231c` with the area agents' lockfile changes still uncommitted:

```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile
Scope: all 10 workspace projects
✓ Lockfile passes supply-chain policies (verified 21m ago)
Error: ERR_PNPM_IGNORED_BUILDS

  × installing dependencies
  ╰─▶ Ignored build scripts: cpu-features@0.0.10, esbuild@0.18.20,
      esbuild@0.25.12, esbuild@0.28.2, protobufjs@7.6.6, ssh2@1.17.0
  help: Run "pnpm approve-builds" to pick which dependencies should be allowed
        to run scripts.

EXIT=1
```

**Cause.** pnpm 12 fails an install when a dependency's build script has no `allowBuilds` decision. The other slices brought in:
- esbuild, through vite, tsx and drizzle-kit;
- protobufjs, ssh2 and cpu-features, through testcontainers and dockerode.

The domain-core, db-api and web-apps agents each reported the error, but `pnpm-workspace.yaml` was outside their paths.

**Change** (`pnpm-workspace.yaml`): an `allowBuilds` map that sets all four packages to `false`. Every slice was validated with these scripts not running, so denying them keeps the tested behaviour and runs no new third-party install code. I checked that each esbuild version loads its prebuilt platform binary without its postinstall:

```
esbuild@0.28.2 ok 0.28.2 "let x = 1;\n"
esbuild@0.25.12 ok 0.25.12 "let x = 1;\n"
esbuild@0.18.20 ok 0.18.20 "let x = 1;\n"
```

**GREEN:**

```
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile
Scope: all 10 workspace projects
✓ Lockfile passes supply-chain policies (verified 22m ago)
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 179ms using pnpm v12.14.0
EXIT=0
```

In the fresh clone (no `node_modules`) with `CI=true`, the install printed `Done in 671ms` with `INSTALL_EXIT=0` and changed no tracked files.

Commits:
- `479a581` `chore:` commits `pnpm-lock.yaml`. The domain-core, db-api and web-apps slices left it uncommitted because it was outside their paths.
- `ab1de9d` `fix:` adds `allowBuilds`.

## Fix 2: `pnpm format:check` fails on infra-ci YAML

**RED** (fresh clone at `ab1de9d`; the shared tree failed the same way):

```
$ pnpm format:check
[warn] .github/actions/setup-pnpm/action.yml
[warn] .github/workflows/ci.yml
[warn] infra/docker-compose.yml
[warn] Code style issues found in 3 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
```

**Cause.** The workspace `.prettierrc.json` (ts-foundation) sets `singleQuote: true`, which Prettier also applies to YAML. The infra-ci files used double quotes. Each slice passed its own checks, but the combination fails the root `format:check` script. CI does not run that script.

**Change:** `pnpm exec prettier --write` on the three files. Prettier changed only quote style (`"22"` became `'22'`, and so on). To prove the change has no semantic effect:
- each file was parsed with PyYAML before and after, normalised to sorted JSON, and compared;
- the rendered `docker compose config --format json` was compared before and after.

```
compose config: IDENTICAL
.github/workflows/ci.yml: IDENTICAL
.github/actions/setup-pnpm/action.yml: IDENTICAL
infra/docker-compose.yml: IDENTICAL
```

**GREEN:**

```
$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!
```

The infra contract tests after the change:

```
=== ci-workflow.test.sh
# 65 passed, 0 failed, 0 skipped
=== compose.test.sh --static-only
# 41 passed, 0 failed
=== pre-commit-hook.test.sh
# 11 passed, 0 failed
=== install-gitleaks.test.sh
# 9 passed, 0 failed
```

`ci-workflow.test.sh` includes `ok   - actionlint 1.7.12 reports no problems`.

Commit: `60770a0` `fix:`.

## Repository hygiene

- `git status --porcelain` is empty after the commits above. The only file an area agent left uncommitted was `pnpm-lock.yaml`, committed in `479a581`.
- `git ls-files | grep -E '\.(onnx|env)$'` prints nothing. No other weight or key formats are tracked (`.tflite`, `.task`, `.pt`, `.bin`, `.safetensors`, `.pem`, `.key`, and so on). `models/` tracks only `manifest.json`.
- The tracked env files are `.env.example` and `services/vision/.env.example`. Both contain placeholders only.
- `gitleaks git --redact .` over the full history: `66 commits scanned`, `no leaks found`. The repo's pre-commit hook is not enabled in this clone (`core.hooksPath` is unset), so each commit in this slice was scanned first with `gitleaks git --pre-commit --staged`.
- The word "Persona" appears in tracked non-doc files only in `packages/core/src/check-registry.test.ts`: a doc-path comment and an assertion that check descriptions never mention it.

## Not covered

- The live part of `infra/tests/compose.test.sh` (`up -d --wait`, probes, `down`) was not re-run. After fix 2 the rendered compose config is byte-identical, and step 7 only requires `config -q`.
- The CI workflow has not run on GitHub, because nothing is pushed in Phase 0 agent runs.
