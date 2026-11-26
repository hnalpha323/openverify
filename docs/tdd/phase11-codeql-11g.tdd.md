# Phase 11, Workflow 11G Stage 2: codeql-11g (TDD and checkpoint evidence)

Agent: `codeql-11g` (Workflow 11G Stage 2, in parallel with publish-11g and records-11g). Base `9003bc311`, start `4b3a06a0f`, Stage 1a closed at `37e4f8922` (contracts-11g). The owner items as PROGRESS records them: Q1 granted (private until the release, public at the owner's release step), Q9 declined (no Code Security licence). The gate's `codeql: run`. Host: Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2. Every command ran in the foreground after `source scripts/env.sh`. Nothing was pushed, dispatched or published, and no repository setting was changed. The `gh` calls were read-only GETs against public GitHub repositories (`github/codeql-action`, `github/codeql`). CodeQL itself was never run here: no bundle was downloaded and no database was built.

## 0. What was read and decided

- **Pin.** `github/codeql-action` v4.39.3, from `THIRD_PARTY_LICENSES.md` section 1 (contracts-11g).
  - `gh api repos/github/codeql-action/git/ref/tags/v4.39.3` gives the annotated tag `f3bbb056…`, whose object is the commit `33d7b85da1a04171e211befe2c739303b9a4c066`.
  - `src/defaults.json` at that commit names `codeql-bundle-v2.27.4` (CLI 2.27.4).
  - `init/action.yml` and `analyze/action.yml` at that commit define the inputs used here: `languages`, `build-mode` (`none`, `autobuild`, `manual`), `config-file`, `category` and `upload` (default `always`).
- **Build modes** (GitHub's "CodeQL code scanning for compiled languages", read 2026-11-21).
  - `none` is available for every interpreted language, so javascript-typescript and python use it.
  - For java-kotlin, `none` extracts only the Java: "the Kotlin code will not be analyzed and a warning will be produced". Kotlin therefore needs `autobuild` or `manual`, and this workflow uses `manual`.
  - The CodeQL CLI guide's Gradle example passes `--no-daemon`, because "a build delegated to an existing daemon cannot be detected by CodeQL", and `--no-build-cache`.
- **Kotlin version.**
  - The repository is on Kotlin 2.4.21 (`android/gradle/libs.versions.toml:13`).
  - CodeQL's supported-languages page says "Kotlin 1.8.0 to 2.4.2x".
  - The CLI changelogs: 2.26.2 added "Kotlin versions up to 2.4.10" and 2.27.1 added "Support for Kotlin 2.4.20". The bundle 2.27.4 is later than 2.27.1, so it covers 2.4.21.
- **The Kotlin build.**
  - The task is `assembleDebug`, taken from the android job's own Gradle line (`ci.yml`: `./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint`). Every artifact it resolves is therefore one the android job resolves, and `android/gradle/verification-metadata.xml` already holds it. The metadata was written from a fresh `GRADLE_USER_HOME` (`c539508d`). Verification stays on and no lenient mode is set (C214.5). No artifact is missing, so rule 3's recipe was not needed.
  - The dry run below shows that the task graph compiles the SDK's Android code (`:openverify-sdk:compileAndroidMain`, through the demo's dependency) together with `openverify-nfc`, `openverify-face` and the demo. The graph has no Kotlin/Native task, so the android job's `~/.konan` cache and bundletool are not copied.
  - `openverify-face`'s build copies the YuNet model into its AAR, so the android job's model and fixture fetch is copied unchanged.

```text
$ cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon --no-build-cache assembleDebug --dry-run
(lock wait 0.003 s; 28.7 s; load 3.17 2.42 3.50)
:openverify-sdk:compileAndroidMain SKIPPED
:demo-app:compileDebugKotlin SKIPPED
:openverify-face:compileDebugKotlin SKIPPED
:openverify-nfc:compileDebugKotlin SKIPPED
... (139 tasks; 0 that name native, konan, ios or klib)
BUILD SUCCESSFUL in 28s
```

## 1. RED (`ff8235a4a`)

`infra/tests/codeql-workflow.test.sh` is new. It covers:
- the triggers, and the public-only `if:` on every job;
- the permissions, `continue-on-error` and timeouts;
- the three languages and their build modes;
- the Kotlin build's tasks as a subset of the android job's line, with `--no-daemon` and `--no-build-cache`, and verification never lenient, off or re-written;
- the setup steps copied from the android job with the same commits;
- the CodeQL pin equal to the ledger's row, and every other pin equal to ci.yml's;
- `persist-credentials: false`, no secret or token, and no expression inside a script;
- that ci.yml never uses CodeQL;
- the config's suite, and each exclusion with its reason on the line above and a tracked file it matches;
- actionlint and zizmor at medium.

The named borrowed edit to `infra/tests/ci-workflow.test.sh` does three things:
- It allows GitHub's CodeQL action in `.github/workflows/codeql.yml` only, through `SCANNER_ALLOWED_IN`.
- It matches an action by its owner/repo, now across the composite actions too. The old check compared the whole path, so `github/codeql-action/init@…` slipped past it, and so would any scanner's sub-action. Synthetic cases hold the new behaviour.
- It requires `bash infra/tests/codeql-workflow.test.sh` in the supply-chain job.

```text
$ bash infra/tests/codeql-workflow.test.sh   -> exit 1
FAIL - .github/workflows/codeql.yml exists
# 0 passed, 1 failed, 0 skipped
$ bash infra/tests/ci-workflow.test.sh       -> exit 1
FAIL - supply-chain: runs `bash infra/tests/codeql-workflow.test.sh` (the static half of an 11C contract)
FAIL - infra/tests/codeql-workflow.test.sh runs in a CI job or is named local-only with its reason
# 546 passed, 2 failed, 0 skipped
```

## 2. GREEN (`cd29e5185`)

The commit adds `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml` and the named borrowed edit of `.github/workflows/ci.yml`. That edit is one supply-chain step, "The CodeQL workflow's contract", which runs `bash infra/tests/codeql-workflow.test.sh` with `SUPPLY_CHAIN_TOOLS_DIR`. The file was clean when edited: records-11g's ci.yml change was committed at `741d99a03`.

Two of the test's own predicates were corrected before this commit:
- The wrapper step is found by `-wrapper.jar.sha256`, because the run line is `gradle-${version}-wrapper.jar.sha256`.
- The ci.yml check now looks for a `uses:` of the workflow and for `codeql-action`, instead of matching the text `codeql.yml`, which the new ci.yml comment contains.

```text
$ bash infra/tests/codeql-workflow.test.sh   -> exit 0   # 95 passed, 0 failed, 0 skipped (actionlint and zizmor among them)
$ bash infra/tests/ci-workflow.test.sh       -> exit 0   # 548 passed, 0 failed, 0 skipped
$ actionlint .github/workflows/ci.yml .github/workflows/codeql.yml -> exit 0
$ zizmor --offline .github/workflows/codeql.yml   -> "No findings to report. Good job! (2 suppressed)"
$ bash infra/scripts/supply-chain.sh zizmor        -> exit 0 (codeql.yml has no finding at any severity)
```

**Mutations.** In a scratch copy, outside the tree, each of these edits to codeql.yml makes the contract exit 1, with the expected FAIL lines:
- a `schedule`;
- a `pull_request`;
- the private-repository condition removed;
- `--dependency-verification lenient`;
- an extra task (`publishToMavenLocal`);
- `actions: read`;
- `persist-credentials: true`;
- `@v4` instead of the commit;
- `continue-on-error` removed;
- python removed;
- a `token: ${{ secrets.X }}`.

## 3. Minutes (C267's honesty rule)

These are estimates, not measurements: no run of codeql.yml has happened. The first run is measured whenever the owner's Actions minutes allow one and the repository is public (rule 24, KP10-59).

**Runner.** `ubuntu-latest`. On a public repository it is GitHub's standard 4-CPU, 16 GB Linux runner, whose minutes are not billed. On a private repository every job's `if:` is false, so the jobs are skipped, no runner starts and nothing is billed. No Code Security licence is assumed (Q9 declined).

| Language | Basis | Estimate | Timeout |
|---|---|---|---|
| javascript-typescript | 6,164 tracked `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` files, 1,140,026 lines with the tests; extracted without a build; the security-extended suite | 15 to 30 min | 45 |
| python | 293 files, 81,660 lines; without a build | 3 to 6 min | 45 (shared matrix job) |
| java-kotlin | Temurin 21 and the Android SDK set up; a traced cold-ish `assembleDebug` (setup-java's Gradle cache is keyed as the android job's, so a main push restores it); about 27,000 lines of Kotlin main sources (SDK commonMain 22,513 and androidMain 2,534, nfc 908, face 477, demo 653) and their libraries; security-extended | 20 to 40 min | 60 |
| bundle | `codeql-bundle-v2.27.4`, taken from the runner's tool cache when present, otherwise downloaded once per job | 0 to 2 min per job | — |

That makes about 40 to 75 runner minutes a push in all. Each upper estimate stays below 75% of its timeout (30 of 45, 40 of 60), so nothing is split or raised on an estimate. There is no comparison basis for the Kotlin estimate: the android job's first Gradle step took 25.3 minutes locally from an empty home with every test, and the job has no measured whole time since the 10B push.

## 4. Final checks (all in the foreground, each exit read from its own file)

| Call | Result |
|---|---|
| `pnpm format:check` | exit 0 (142 s, load 3.17→4.33) |
| forced lint and typecheck of the packages touched | none touched: the changes are under `.github/` and `infra/tests/` only, and no package's sources or config changed (rule 21) |
| `bash infra/tests/codeql-workflow.test.sh` | exit 0, 95 passed, 0 skipped |
| `bash infra/tests/ci-workflow.test.sh` | exit 0, 548 passed, 0 skipped (actionlint, gitleaks and openssl on PATH) |
| `bash infra/scripts/supply-chain.sh osv` / `pnpm-audit` / `pip-audit` | exit 0 / 0 / 0 (2, 39 and 4 s) |
| `bash infra/scripts/supply-chain.sh zizmor` / `trivy-config` / `allowlist` | exit 0 / 0 / 0 |
| `bash infra/scripts/supply-chain.sh chart` | exit 0 (19 s) |
| `bash infra/scripts/supply-chain.sh pii` | exit 0, nothing kept (6 s) |
| `pnpm --filter @openverify/docs-tools test` | exit 0: 436 tests in 51 files, 97.69% statements (27 s, load 4.58) |
| `pnpm release:check` (default) | exit 0: 0 errors, 81 owner items; none names CodeQL |
| `gitleaks git --redact .` and `gitleaks dir --redact --config security/gitleaks-pii.toml .` | section 5 |

## 5. gitleaks

```text
$ gitleaks git --redact .                                     -> exit 0: 8076 commits scanned, no leaks found (11 s)
$ gitleaks dir --redact --config security/gitleaks-pii.toml . -> exit 1: 1205 raw pattern matches (6 s)
$ python3 -I security/gitleaks-pii-filter.py --gitleaks "$(command -v gitleaks)" dir .  -> exit 0: 0 kept of 1205 matched
$ python3 -I security/gitleaks-pii-filter.py --gitleaks "$(command -v gitleaks)" git .  -> exit 0: 0 kept of 1641 matched
```

The raw `gitleaks dir` run with the PII config exits 1 on every tree, by design (C260.3). gitleaks 8.30.1 has no Luhn or mod-97 validator, so its pattern matches are filtered by `security/gitleaks-pii-filter.py`, which keeps only checksum-valid card and IBAN numbers. That filter is the gate, and it is also what `supply-chain.sh pii` and the pre-commit hook run. Both totals, 1,205 and 1,641, are fix-records' at the 11F close, and the filter kept none of either. This agent's files add no match.

## 6. Checkpoint

Checkpoint 1 (codeql) is this file's commit, "Workflow 11G codeql-11g checkpoint 1 (codeql)". It is this area's only and last checkpoint, so the final checks above are its full gate.
