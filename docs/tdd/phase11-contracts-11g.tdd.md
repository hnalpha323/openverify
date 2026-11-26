# Phase 11, Workflow 11G Stage 1a: contracts-11g (TDD and checkpoint evidence)

Agent: `contracts-11g` (Workflow 11G Stage 1a, alone). Base `9003bc311` (the commit that adds "## 2026-11-21: Phase 11, Workflow 11F done (…)"), start `4b3a06a0f` (the "## Orchestrator decisions before Workflow 11G (2026-11-21)" commit). Host: Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2. Every command below ran in the foreground after `source scripts/env.sh`; nothing was pushed, published, signed, attested or dispatched, and no repository setting was read with anything but GET.

## 1. Deliverable 1: the base from the records (checkpoint 1)

Read-only, 2026-11-21 (about 23:25Z):

```text
$ git merge-base --is-ancestor 9003bc311cc7342c61857cc231cba5f0a4f7bda0 HEAD            -> 0
$ git merge-base --is-ancestor 4b3a06a0fd666cc6134709bb5ae66d0994a546dc HEAD            -> 0
$ git merge-base --is-ancestor 4db86122d 9003bc311cc7342c61857cc231cba5f0a4f7bda0        -> 0
$ git merge-base --is-ancestor 9003bc311cc7342c61857cc231cba5f0a4f7bda0 4b3a06a0fd666cc6134709bb5ae66d0994a546dc -> 0
$ git merge-base --is-ancestor 9003bc311cc7342c61857cc231cba5f0a4f7bda0 origin/main     -> 0   (recorded, not required: the 11F push is in origin/main)
$ git show 9003bc311…:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11F done'
20:## 2026-11-21: Phase 11, Workflow 11F done (dynamic testing, a review of all of Phase 11 and fixes: …)
$ git show 4b3a06a0f…:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11F done'
20:## 2026-11-21: Phase 11, Workflow 11F done (…)
$ git show 4b3a06a0f…:docs/plans/phase-11.plan.md | grep -n '^## Orchestrator decisions before Workflow 11G'
3154:## Orchestrator decisions before Workflow 11G (2026-11-21)
```

Every check holds, so `gate.start` is decided by the decisions (deliverable 3), not refused. HEAD at the start was `4b3a06a0f`; the working tree held only the untracked `31-Oct-openverify-session-state.txt` (not ours, untouched).

**CI, read once (rule 24), read-only:** `gh run list --branch main --limit 5`:

| Run | Commit | Workflow | Created | State |
|---|---|---|---|---|
| 44961662119 | `9003bc311` (the 11F push) | ci | 2026-11-21T23:24:42Z | completed / failure |
| 44854752893 | `b45a0a498` (the 11E push) | ci | 2026-11-21T02:14:16Z | completed / failure |
| 44785912432 | `aa00b57bb` (the 11D push) | ci | 2026-11-20T17:42:50Z | completed / failure |
| 43843705201 | `d44e537db` (the 11C push) | ci | 2026-11-16T09:52:34Z | completed / failure |
| 43595684173 | `f544fbd2c` (the 11B push) | ci | 2026-11-14T12:36:43Z | completed / failure |

`gh run view 44961662119 --json jobs`: 19 jobs, every one with 0 steps (16 `failure`, 3 `skipped`), created 23:24:42Z and updated 23:24:47Z (5 s). No step started, so it measures nothing and is not a failure of the code (the account's Actions minutes, KP10-59); no CI fix is passed to 11G. No `release.yml` or `android-release.yml` run exists.

**Open items read, none closed here.** PROGRESS's "Phase 10 done" lists ("Unproved on a device or an emulator" and "The release gate") and every Phase 11 entry's open items were read; none is contracts-11g's but the three KNOWN ITEMS (KP11-42, KP11-96, KP11-97). The orchestrator's record after 11F (PROGRESS's 11F entry, `docs/tdd/phase11-orchestrator.tdd.md`) closes 11F's nine device proofs with 22 of 22 on the phone; the checklist's DEVICE-PROOFS line is records-11g's (11G decisions item 20).

**release:check at the start** (default mode, `pnpm release:check`, exit 0): `0 errors, 75 owner items`; the owner-state findings are exactly Q6 pending (`docs/PROGRESS.md:51`), Q7 pending (`:53`) and Phase 10 P4 pending (`:17`), so the tool reads PROGRESS as the orchestrator does.

Checkpoint 1: gate "affected scope (rule 26)": this checkpoint changes only this Markdown file, which no package's lint, typecheck or test reads; `pnpm format:check` (Markdown is outside Prettier's scope by `.prettierignore`).

## 2. Deliverable 2: the 11G section of the inventory (checkpoint 2)

`docs/research/phase11-inventory.md` section 7, sections 7.1-7.12: `release.yml` as built (its jobs, the publish skeleton, the `release` environment, the `OPENVERIFY_PUBLISH` condition, its one input), how the staged images, chart and tarballs are stored (`docker save` archives, a packaged chart and packed tarballs, so each is pushable by digest without a rebuild and no OCI-layout tool is needed), every C258.3 tool and action pin with its installer and test, the licence check's `pending-owner` labelling and where its decision is read (each row's words), docs-tools' switches, generators, commands and how `release:check` reads the owner states, the checklist ids per item, every carrier of "not reviewed by counsel" and `counsel-unreviewed`, every default of `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` with the three unwired hooks, the mailer port (now `apps/api/src/ports.ts:2096`), every uv pin, `models.source`, the flow image's two variants, the Eigen rows and `SECURITY.md`'s channel line. Every claim was read with `grep -n` or `sed -n` at `4b3a06a0f` (the commands are the greps quoted in the section's paths); drift from the plan is the plan's "Workflow 11G Stage 1a amendments (contracts-11g)".

Checkpoint 2: gate "affected scope (rule 26)": Markdown only (no package reads `docs/research/`); `pnpm format:check`.

## 3. Deliverable 3: the decisions (checkpoint 3)

Inventory §7.13: Q1-Q12 and Phase 10 P1-P5 with the date, the words and the line of each in `docs/PROGRESS.md` (`:41-63` for the `**Qn:**` lines of the 11F-done entry, `:17` and `:18` for the rows) and the Phase 10 plan's item 2 (`docs/plans/phase-10.plan.md:1079-1085`). Read with `grep -n '^\*\*Q[0-9]*:\*\*' docs/PROGRESS.md` (the first such line per id is the 11F entry's; the only older one is `**Q12:** pending` at `:318`, which the newer line overrides) and `sed -n '1076,1086p' docs/plans/phase-10.plan.md`. Specifics: Q3 keyless; Q4 with provenance once public; Q6 pending (no bake); Q10 granted on ADR 0005's reading (the default's own words, `phase-11.plan.md:1220`, confirmed by the 11G decisions); Q11 granted for both MIT-0 and EPL-1.0; Q12 granted after 11D's Stage 1a, so recorded only (V16); P2 granted 2026-11-08 and unchanged, with the guidance image already the staged release flow image (`docs/release/checklist.md:13`), so its outcome is built. The orchestrator's list in the 11G prompt equals PROGRESS for all 17 items: no disagreement.

Checkpoint 3: gate "affected scope (rule 26)": Markdown only; `pnpm format:check`.

## 4. Deliverable 4: the owner steps, read-only (checkpoint 4)

```text
$ gh repo view --json visibility,nameWithOwner          -> {"nameWithOwner":"<owner>/openverify","visibility":"PRIVATE"}
$ gh api repos/<repo>/environments                      -> [] (no environment)
$ gh api repos/<repo>/environments/release              -> 404 Not Found
$ gh api repos/<repo>/environments/release/deployment-branch-policies -> 404 Not Found
$ gh api repos/<repo>/actions/variables                 -> [] (no OPENVERIFY_PUBLISH)
$ gh api repos/<repo>/actions/secrets                   -> [] (names only; none)
$ gh api repos/<repo> --jq '{private, visibility, owner_type: .owner.type, security_and_analysis}'
  -> {"owner_type":"User","private":true,"security_and_analysis":null,"visibility":"private"}
$ npm view @openverify/js --json (and @openverify/node, @openverify/react; no credentials) -> E404 each
$ curl https://registry.npmjs.org/-/v1/search?text=scope:openverify&size=5 -> {"objects":[],"total":0}
$ curl -o /dev/null -w '%{http_code}' https://ghcr.io/v2/<owner>/openverify-api/tags/list -> 401
```

Inventory §7.14 records each with its checklist line. Every missing step is a release-time owner act (HARD LIMITS (8)), never a reason to skip wiring; no token was printed.

Checkpoint 4: gate "affected scope (rule 26)": Markdown only; `pnpm format:check`.

## 5. Deliverable 5: the pins and the dependency review (checkpoint 5)

Every date below was read on 2026-11-21 (UTC 23:30 to 00:20), read-only, from the publishers: `gh api` GETs of GitHub releases, tags, commits and the global advisory database; `npm view <pkg> time --json`; `https://pypi.org/pypi/uv/0.13.7/json`; `https://nodejs.org/dist/index.json`; `docker buildx imagetools inspect` for image index digests and build dates. Inventory §7.15 holds the values.

### RED (test first)

`efb49662a` then `d263b2b43` (the second replaces the npm-CLI expectation with pnpm, after the npm CLI's Artistic-2.0 was found outside rule 4's list):

```text
$ (cd packages/config && pnpm exec vitest run src/release-11g-pins.test.ts --coverage.enabled=false)   -> exit 1
  × records github/codeql-action v4.39.3 by commit, with its bundle, as tooling used only under Q1   (no row)
  × no longer lists CodeQL under Not adopted          expected '## Not adopted …' not to contain '| CodeQL |'
  × records uv 0.13.7 with its image index digest and its linux asset checksum (Q5)   (no row)
  × records pnpm 12.14.0 as the npm publisher (OIDC trusted publishing with provenance) and adopts no npm CLI (Q4)   (no row)
  × records Node.js 22.23.4 and both base images by index digest (KP11-42)
  × pins next 16.4.5 in the catalog and locks it alone     expected 'packages: …' to match /^ {2}next: 16\.4\.5$/m
  × locks fast-uri 3.x at 3.1.9 or later                    expected [ '3.1.8' ] to deeply equal []
  × locks fast-uri 4.x at 4.2.3 or later                    expected [ '4.2.2' ] to deeply equal []
  Tests  8 failed | 1 passed (9);  tsc --noEmit exit 0; eslint exit 0
$ bash infra/tests/ci-workflow.test.sh        -> exit 1: FAIL - setup-pnpm: Node is pinned to the apps image's version (22.23.4; …) (22.22.1)
$ bash infra/tests/release-workflow.test.sh   -> exit 1: FAIL - build: Node is the images' version (22.23.4), as setup-pnpm pins it (['22.22.1'])
$ bash infra/tests/images.test.sh static      -> exit 1: FAIL - api|dashboard|flow|code-runner: ARG NODE_IMAGE defaults to the pinned digest; vision: ARG PYTHON_IMAGE …
$ bash infra/tests/images.test.sh pins        -> exit 1: FAIL - pins: infra/docker/<4 files>: NODE_IMAGE is the pinned node base
```

### GREEN

`161aaa8e9`: the five section-1 rows, the Next.js row, CodeQL out of "Not adopted", the base-image paragraph; `pnpm-workspace.yaml` `next: 16.4.5`; `flock /tmp/openverify-pnpm.lock pnpm install` (5.9 s; `+3 -10`) then `flock /tmp/openverify-pnpm.lock pnpm update -r --depth Infinity fast-uri` (0.7 s; no manifest changed, checked by `cmp` against copies); the lockfile diff holds only next 16.4.5 with its ten `@next/*` packages, fast-uri 3.1.9 and 4.2.3, and the registry's new deprecation text on `@smithy/core@3.36.0`; no `minimumReleaseAgeExclude`. The four `NODE_IMAGE`s, `PYTHON_IMAGE`, setup-pnpm's default, `release.yml:92`; `supply-chain-pins.test.ts`'s `NOT_ADOPTED`; the H14 table; `docs:release`.

```text
$ (cd packages/config && pnpm exec vitest run src/release-11g-pins.test.ts src/supply-chain-pins.test.ts --coverage.enabled=false)  -> exit 0, Tests 59 passed (59)
$ bash infra/tests/ci-workflow.test.sh       -> exit 0, # 532 passed, 0 failed, 0 skipped
$ bash infra/tests/release-workflow.test.sh  -> exit 0, # 103 passed, 0 failed, 0 skipped
$ bash infra/tests/images.test.sh static     -> exit 0, # 149 passed, 0 failed
$ bash infra/tests/images.test.sh pins       -> exit 0, # 26 passed, 0 failed
$ bash infra/scripts/supply-chain.sh osv        -> exit 0: 14 findings; 0 failing, 5 allowlisted, 9 reported (glob, esbuild, minimatch x2, five Gradle); load 1.22
$ bash infra/scripts/supply-chain.sh pnpm-audit -> exit 0: 3 findings below the gate (glob, esbuild, minimatch); 840 registry signatures verified; 33.2 s, load 1.55
```

`8b9dd46f3`: the five stale ASVS rows reviewed again (`release:check` had reported them as `security/stale-evidence` after the GREEN commit: 80 owner items), `docs:security`, `docs:selfhost`, `docs:release`; then `pnpm release:check` exit 0, 0 errors, 75 owner items.

### The images and the C259.2 gate, on this tree

Each build one foreground call under `flock -E 75 -w 240 /tmp/openverify-e2e.lock` (lock wait 0.003 s): api 198.7 s (load 1.31 → 3.52), dashboard 163.4 s (3.20 → 4.32; `next build` on 16.4.5 completed with no security notice), flow 38.5 s, flow-noguidance 36.1 s, code-runner 42.1 s (load 3.7-4.1), vision 44.3 s (4.03 → 3.00). `images.test.sh` live, one subcommand per lock hold: override 33, api 58, dashboard 27, flow 33, flow-noguidance 32, vision 28, code-runner 27 checks, every one exit 0.

Trivy 0.76.0 (database 2026-11-21T18:38Z) and Grype 0.120.1 (database 2026-11-21T06:20Z), with `security/allowlist.yaml` turned into their ignore rules by `release.yml:228-269`'s own script (extracted to the scratchpad, 6 entries, 1 by package): every image still fails (Trivy 1, Grype 2), as recorded in the plan's Stage 1a amendment 8: Node images Trivy 1 critical / 37 high (0 fixable), Grype 2 / 56 (4 fixable: Node 22.23.4's binary, fixed in 22.23.5); vision Trivy 51 high (1 fixable), Grype 134 high (11 fixable; FFmpeg in OpenCV, KP11-39, and zlib1g).

### Node 22.23.4 in its own image (the host stays on 22.22.1)

```text
$ docker run --rm --network none -v "$PWD":/repo:ro -w /repo/packages/emrtd node:22.23.4-bookworm-slim@sha256:5ec23b7c… \
    node ../../node_modules/vitest/vitest.mjs run --configLoader runner --coverage.enabled=false --cache=false
  v22.23.4, OpenSSL 3.5.9:  Test Files 20 passed (20); Tests 338 passed (338)   (the brainpool self-test among them)
$ (the same, -w /repo/apps/api, src/services/cases/sla/)   ICU 78.3, tz 2026e:  Test Files 4 passed (4); Tests 94 passed (94)
```

Checkpoint 5 is the pins and the dependency review; it changes the root toolchain (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), so rule 26's exception keeps the full gate for it. That full gate is section 6, run on the final tree.

## 6. The full gate on the final tree (checkpoint 6, the last; the proof for checkpoints 1-5)

Run alone, every call in the foreground, heavy calls through `OPENVERIFY_HEAVY_RESERVED=1 bash /tmp/openverify-heavy.sh`, on the tree at `82f65a34e` (nothing but this file changed after it). Every result below is the command's own exit code, read from its output file.

| Step | Call | Exit | Result | Time | Load (1-minute, before → after) |
|---|---|---|---|---|---|
| install | `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | lockfile up to date | 0 s | |
| format | `pnpm format:check` | 0 | all matched files formatted | 120 s | 2.42 |
| typecheck | `pnpm turbo run typecheck --force` | 0 | 20 of 20 tasks | 183 s | 2.31 → 6.70 |
| lint | `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1` in three calls: api; dashboard and contracts; the other 17 | 0, 0, 0 | 1, 2 and 17 tasks | 249, 239, 417 s | 6.24 → 3.11; 2.94 → 2.97; 2.81 → 2.28 |
| unit db | `pnpm turbo run test --force --filter=@openverify/db` | 0 | 2,395 (lines 90%) | 223 s | 2.18 → 11.03 |
| unit watchlist, e2e | the same with both filters | 0 | 840 and 161 | 298 s | 10.23 → 2.17 |
| unit dashboard | two blob shards and a merge (each shard exits 1 on partial coverage by design) | merge 0 | 7,384 tests in 623 files, 95.67% lines | 243, 267, 7 s | 2.08 → 8.70 → 8.16 |
| unit, the other 14 | one forced turbo call | 0 | 14 of 14 (config 459 with the new pins test, docs-tools 428, contracts 4,905, checks 3,858, workflow-engine 2,042, core 2,008, flow 1,678, flow-spec 527, node 508, emrtd 338, signals 192, ui 58, react 55, demo-web 18) | 252 s | 6.72 → 15.22 |
| unit js | `pnpm --filter @openverify/js test` | 0 | 19 | 5 s | 13.19 |
| unit api | 8 blob shards and a merge | merge 0 | 10,992 tests in 872 files, 93.43% lines; no failure line in any shard (KP11-38 not met) | 185, 215, 202, 212, 201, 186, 205, 179 s; merge 46 s | 1.88 → 8.3-10.6 during the shards |
| integration | db; graph; api 1/3, 2/3, 3/3 | 0 ×5 | 110; 13 (template 16.2 s, copied in 1.5 s); 121; 139; 196 | 96, 35, 128, 189, 115 s | 4.30 → 20.66 |
| infra | each `infra/tests/*.test.sh` but images, one per call | 0 ×34 | ci-workflow 532, release-workflow 103, compose 639, supply-chain 141, supply-chain-skeletons 112 (13 skipped, as before), zap 58, every installer test | 0-73 s each | 2.04 at the end |
| images | `images.test.sh` static, pins (final tree); override, api, dashboard, flow, flow-noguidance, vision, code-runner (on the six images rebuilt from `161aaa8e9`'s Dockerfiles, which the final tree keeps) | 0 ×9 | 149, 26, 33, 58, 27, 33, 32, 28, 27 | 1-59 s | 2.7-3.9 |
| chart | `deploy/helm/openverify/ci/tests/{chart-checks,chart-policy,kind}.test.sh` | 0 ×3 | 47, 44, 72 | 1-3 s | |
| supply chain | `bash infra/scripts/supply-chain.sh <step>` for osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist | 0 ×8 | osv 14 (0 failing, 5 allowlisted, 9 reported); pnpm-audit 3 reported; pip-audit 0; zizmor 11 below medium; the rest pass | 0-36 s | 17.03 → 7.62 |
| e2e mocked | `flock … pnpm --filter @openverify/flow e2e` | 0 | 349 passed | 132.4 s (lock wait 0.004 s) | 5.74 → 10.95 |
| e2e stack | `e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...`; then `e2e:stack:up` | 0; 0 | 5 tasks; **up on the first start, no Next.js security stop** (`grep -c SecurityFatalError` 0) | 32.1 s; 154.6 s (lock wait 0.003 s) | 10.15 → 7.27; 6.31 → 4.62 |
| e2e shards | `--project=chromium --shard=<i>/4`, i 1-4 | 0 ×4 | 50, 52, 47, 49 passed | 278.9, 361.4, 297.5, 428.0 s (lock waits 0.003-0.004 s) | 4.33 → 3.82 |
| console sweep | `--project=console-sweep --no-deps` on the used stack | 0 | 109 passed | 341.3 s | 3.55 → 4.03 |
| stackTest | `:openverify-sdk:stackTest` (e2e lock outside, Gradle lock inside) | 0 | 3 of 3 by the XML (AndroidFlowStackTest, AndroidNfcFlowStackTest, AndroidConnectFlowStackTest; 0 failures, errors or skips) | 54.3 s (lock waits 0.003 s each) | 3.56 → 3.64 |
| stack down | `e2e:stack:down` | 0 | stopped | 2.4 s | |
| release:check | `pnpm release:check` (default) | 0 | 0 errors, 75 owner items (checklist-state 56, version 6, medium-advisory 5, licence-row 4, owner-state 3, staged-run 1) | | |
| secrets | `gitleaks git --redact .` | 0 | 8,065 commits, no leaks | 12 s | |

Not run, by the rules: the Android gate (no commit reached `android/` or `contracts/fixtures/`), the clean-build pass (no Gradle lockfile or verification metadata changed), the device suites (contracts-11g never uses the phone), WebKit, kind, DAST and the benchmarks (integration-11g's Validation; no benchmark path changed).
