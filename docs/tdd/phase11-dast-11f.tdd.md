# Phase 11, Workflow 11F Stage 1: dast-11f (C283, DAST with ZAP)

Agent: `dast-11f`, alone (no other agent edits the tree or loads the machine). Machine: the owner's
build host, Intel Xeon E5-1650 v3, 12 logical CPUs, 31 GiB, WSL2 with Docker Desktop 29.7.2
(containerised engine, 12 CPUs, 31.3 GiB). Every timing is labelled with `cat /proc/loadavg`.

## 0. Gates (read-only, 2026-11-20 EST)

- `git merge-base --is-ancestor 4db86122d b45a0a498` 0; `b45a0a498 1746797ae` 0; `1746797ae HEAD` 0.
- `git show b45a0a498:docs/PROGRESS.md` and `git show 1746797ae:docs/PROGRESS.md` each hold one
  `## ...Phase 11, Workflow 11E done` heading; `4db86122d`'s holds "Phase 10 done";
  `1746797ae:docs/plans/phase-11.plan.md` holds "## Orchestrator decisions before Workflow 11F".
- `origin/main` holds `b45a0a498` (recorded, not required).
- `gh run list --branch main --limit 5`, read once: the 11E push's run `44854752893` on
  `b45a0a4989071dde7bfd5de406c32877f33cdcb5` completed `failure` in 11 s; `gh run view --json jobs`:
  19 jobs, every one with 0 steps (16 failure, 3 skipped). No step started, so no CI failure is passed
  in (rule 25), as for the 11A to 11D pushes.

## 1. Checkpoint 1: the pin and the licence row

**The image.** ZAP's documentation (zaproxy.org/docs/docker/about/, read 2026-11-20) names the
project's registries `ghcr.io/zaproxy/zaproxy` and Docker Hub `zaproxy/zap-*`; both carry the
version tag `2.17.0`:

```
$ bash infra/scripts/refresh-digests.sh ghcr.io/zaproxy/zaproxy:2.17.0
ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af  # resolved 2026-11-21
$ bash infra/scripts/refresh-digests.sh zaproxy/zap-stable:2.17.0
zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af  # resolved 2026-11-21
```

(2026-11-21 is the UTC date; the local date was 2026-11-20 EST.) The index holds linux/amd64
(`sha256:c2d63bbb…2882`) and linux/arm64. `docker buildx imagetools inspect --format '{{json .Image}}'`:
the amd64 image's `created` is `2026-11-03T12:25:54Z`, 18 days before adoption, so the 14-day rule
(C258.3, rule 3) holds; its labels name `github.com/zaproxy/zaproxy` at commit `528bdf4c`.
`gh api repos/zaproxy/zaproxy/releases/tags/v2.17.0`: published `2025-12-15T14:41:51Z`; the `LICENSE`
at `v2.17.0` (blob `8dada3ed`, 11,357 bytes) is the Apache License 2.0. Pulled by digest in 111.6 s
(load 4.15 3.19 3.45). Inside: `/zap/zap-2.17.0.jar`, `zap-api-scan.py`, `zap-baseline.py`,
`zap-full-scan.py`, `zap_common.py`; it runs as `zap` (uid 1000); `zap.sh -help` documents `-silent`
("Ensures ZAP does not make any unsolicited requests, including check for updates").

**RED** (`811ae2507`, `test(infra)`): `infra/tests/images.test.sh pins` gains `ZAP_PIN` and two
checks (security/zap/run.sh's `readonly ZAP_IMAGE=` is the pin; no ZAP image is named in git without
it, the research, plan and TDD folders aside).

```
$ bash infra/tests/images.test.sh pins            # rc=1
FAIL - pins: security/zap/run.sh: ZAP_IMAGE is the pinned ZAP 2.17.0 image (expected 'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669d…328af', got '')
# 25 passed, 1 failed
```

**GREEN** (`d069ad19e`, `feat(security)`): `security/zap/run.sh` holds the pin (a stub until
checkpoint 2).

```
$ bash infra/tests/images.test.sh pins            # rc=0
# 26 passed, 0 failed
```

**The licence row** (`f523b634f`, a borrowed edit of `THIRD_PARTY_LICENSES.md`, its working copy
clean first): ZAP 2.17.0 in section 1 after kubectl, Apache-2.0, released 2025-12-15, the image by
digest, an unmodified dev tool never shipped. Then:

- `pnpm --filter @openverify/docs-tools docs:release`: rc 0, `release: 1 files written`, and
  `docs/release/notes.md` unchanged (the row is neither pending nor "owner to confirm").
- `pnpm --filter @openverify/docs-tools docs:all` (18.4 s) then `git diff --exit-code --stat docs`: no diff.
- `pnpm --filter @openverify/docs-tools test`: rc 0, 51 files, 412 tests, 97.53% lines (load 1.49 1.65 2.49).
- `pnpm release:check`: rc 0, `release:check (default): 0 errors, 79 owner items`.

Gate: affected scope (rule 27): no package's source changed (the commits touch `infra/tests/`,
`security/zap/` and the licence file); the docs-tools suite, which reads the licence file, ran whole.

## 2. Checkpoint 2: security/zap/ (C283.1-C283.3) and its contracts

**What ZAP needs on this engine** (found before any code, from the pinned image against a
throwaway loopback page in a container of mine, `/tmp/openverify-zap-gen`, removed after):

- ZAP's container on `--network host` reaches a service of another `--network host` container, and
  this WSL host reaches both (`curl` 200 each way; Docker Desktop 29.7.2). So the images mode's
  loopback services are reachable from the host: ladder rung (i) of decision 17 before 11F applies
  (KP11-40's setting appears to be on; nothing was changed by me).
- ZAP's Java refused a service bound to `127.0.0.1` ("Connect to http://127.0.0.1:38773 failed:
  Connection refused") while `curl` in the same image reached it; with
  `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` it reaches it. Every ZAP run carries it.
- `-a` (alpha rules) cannot run with `-silent`, so neither run uses `-a`.
- `zap-api-scan.py -g` over a one-route document listed 114 rules (`zap-baseline.py -g`'s 64 are
  a subset). `security/zap/rules.tsv` is written from that list by code (never by hand), each
  `WARN`, with `FAIL` for the 27 active injection-class rules ZAP rates High.

**RED** (each commit compiles, fails at run time for its reason):

- `13042aab2` and `chore(security)` METHODS: the `dast-zap.py` stub (rule 5).
- `1fdba033c` `test(security)`: `security/tests/test_dast_zap.py` and the synthetic fixtures
  (`fixtures/zap/raw-report.json`: an Authorization header, a Cookie and the API key, every token
  "synthetic"). `uv run --project security/python --frozen pytest ... test_dast_zap.py --no-cov`:
  `48 failed in 2.06s`, 41 `NotImplementedError` and the CLI tests' exit 1 from the stub's `main`.
- `7f2b5f534` `test(infra)`: `infra/tests/zap.test.sh` (a borrowed edit, fix-records' afterwards):
  rc 1, `# 32 passed, 18 failed` (no subcommands, no rules file, no report, no revoke order).
- `1a393a6bf` `test(ci)`: `ci-workflow.test.sh` gains the supply-chain step and the mypy files:
  rc 1, `# 527 passed, 3 failed, 0 skipped` (zap.test.sh in no job; mypy without security/zap/).

**GREEN:**

- `8d68c8b3e` `feat(security)`: `security/zap/run.sh` (prepare, api [group], flow
  [hosted|noguidance|routes], console, report, revoke; none = all, in order; the EXIT trap revokes on
  any failure; the run directory refused inside the repository), `rules.tsv`, `api-groups.tsv` (ten
  groups over the 48 tags: 499 operations, 2 held out), `credentials.ts`, `zap-hooks.py`
  (the replacer rule, the seeds, `[method, url, status]` per message), `dast-zap.py` (split, check,
  report). `pytest` whole: 250 passed, total 96%, `dast-zap.py` 95%; `ruff check` and
  `ruff format --check` over `security`: clean; `mypy --strict` over the five scripts: no issues.
  `credentials.ts` typechecks under e2e's compiler settings (a scratch tsconfig outside the tree);
  prettier clean. `bash infra/tests/zap.test.sh`: rc 0, `# 50 passed, 0 failed`.
- `9670ae978`: `security/python/pyproject.toml` counts `dast-zap.py` (a borrowed edit).
- `4d0e9a8ab` `ci`: ci.yml's supply-chain job runs `bash infra/tests/zap.test.sh` after the digest
  refresher, and its mypy line gains `security/zap/dast-zap.py security/zap/zap-hooks.py` (a borrowed
  edit). `bash infra/tests/ci-workflow.test.sh`: rc 0, `# 530 passed, 0 failed, 0 skipped`.
- `c150a84dd` `fix(security)`: the uid ZAP's image runs as is `OPENVERIFY_ZAP_CONTAINER_UID`
  (1000), so the stand-in runs hold on a runner with another uid; zap.test.sh 50 of 50.
- `bash infra/tests/zap.test.sh --docker` under the e2e lock (lock wait 0.004 s, load 1.95 1.90
  1.75): rc 0, `# 52 passed, 0 failed`, "rules.tsv lists exactly the rules the pinned image runs".

Gate: affected scope (rule 27), from checkpoint 1's commit `0ca2d6b97`: no workspace package's
source changed (security/, infra/tests/, .github/workflows/); format:check rc 0; security/python's
checks, zap.test.sh, images.test.sh pins and ci-workflow.test.sh as above.

## 3. Checkpoint 3: the images and the stack (2026-11-20 EST)

Each build under the e2e lock (lock wait 0.003 to 0.005 s each), `docker build -q`:

| Image | Image id | Seconds | Load at start |
|---|---|---|---|
| `openverify/api:11c-local` | `sha256:d48e71cf…1e83` | 164.9 | 1.90 1.93 1.78 |
| `openverify/dashboard:11c-local` | `sha256:e877693f…031b` | 141.5 | 3.67 2.77 2.13 |
| `openverify/flow:11c-local` | `sha256:3bfb2a70…5a89` | 38.9 | 3.91 3.15 2.37 |
| `openverify/flow:11c-local-noguidance` | `sha256:74fc4811…62b5` | 35.9 | 3.21 3.07 2.37 |
| `openverify/code-runner:11c-local` | `sha256:5db69977…ae4f` | 45.6 | 3.04 3.07 2.40 |
| `openverify/vision:11c-local` | `sha256:067ead22…c5fd4` | 3.3 (cached) | 3.48 3.21 2.48 |

The code runner and vision were built in one hold, one build after the other (a deviation from one
build per call; both fit well within it). The dashboard's `next build` did not stop on Next.js
16.4.2's notice (KP11-42 not met). Then, each under the e2e lock: `e2e:stack:down` and
`pnpm turbo run build --filter=@openverify/e2e^...` (5 of 5 cached); `OPENVERIFY_E2E_IMAGES=1
pnpm --filter @openverify/e2e e2e:stack:up` rc 0 in 54.5 s (load 3.07 3.13 2.47): the ten
containers of `openverify-e2e` healthy, and the driver's 20-second reachability check from this
host passed. **Ladder rung (i)** of decision 17 before 11F: this host reached the images-mode stack
(KP11-40's setting appears on; I changed none); ZAP ran on the engine's host network beside it.

## 4. Checkpoint 4: the scans (2026-11-20 to 2026-11-21 EST)

What the first runs taught, each fixed test-first (commits in the log, `security/zap/` and
`infra/tests/zap.test.sh`; each RED seen failing for its reason):

- the handoff template needs a verification step (the e2e handoff spec's database step);
- `zap.ascan.scans` is a property (the hook crashed with exit 3; the API scan's 7 minutes were lost);
- with a config file, zap-api-scan.py runs ZAP's Default Policy, not API-Minimal: LOW strength is
  set on it, and the rules that cannot apply to this stack are IGNOREd with their evidence (no Java,
  PHP, ASP.NET, Apache, CGI or SOAP in any image; plain HTTP on loopback); at MEDIUM, 19 of the lists
  group's rules finished in 6 minutes, at LOW 34 of 38;
- a FAIL rule's Low "weakness" variant (40014-2, a payload echoed in JSON) fails no run; Medium up does;
- the no-guidance flow's container and its scan shared a name (the run failed and revoked; the raw
  reports of nine API groups went with it, by design);
- the hook's progress list is not a report; an unexpected error exits 2, never the gate's 1 (a crash
  read as "an open high" and revoked a run);
- the per-address handoff budget (10 an hour) the previous run's flow scan spent from 127.0.0.1
  refused the next prepare (429): the run's flow calls present a documentation address (C111.1);
- the console's 30-minute idle timeout (C245.1) ended the admin sessions before the later scans:
  `refresh-users` signs them in again before each user-session scan;
- the run key lives two hours: five groups scanned after it expired answered 401 (unauthenticated
  scans). Each scan now probes its credential first, renews an expired key once
  (`refresh-key`), and refuses to scan with a credential the API answers 401;
- groups of 58 operations finished 13 to 19 of the 38 active rules within 6 minutes: the API is now
  23 groups (a `tag@/prefix` entry splits the dashboard tag), 50 ms between requests (no 429 on the
  server API's key), and every group but one finishes every rule.

**The complete run** (`/tmp/openverify-zap/run`, prepared 2026-11-21 about 06:37Z, its first scan at 06:37:14Z, its last at 09:45:37Z, revoked 09:52:46Z): each
call under the e2e lock, lock wait 0.003 to 0.006 s, timings and loads as the report's Scans table
gives them (25 to 401 s each, load 1.60 to 5.96). `prepare` (3.5 s): key with 76 scopes, two admin
sessions, the flow session and its QR handoff, the internal route answered 401. Then `flow hosted
noguidance` (25 + 24 s), `console` (65 s), `flow routes` (395 s), the 23 API groups one call each
(133 to 401 s; `cases`, `case-settings`, `case-queues`, `inquiries` and `webhooks` again after the
key expired, `platform`, `cases`, `case-settings`, `dashboard` again after the splits), `report`
(4.2 s), `revoke` (every credential then refused: key 401, both sessions 401, the flow session 401).
`bash security/zap/run.sh` with no argument does not fit one 10-minute call (about 2 hours of
scans): the subcommands stand for the Validation line.

**Result:** 117,770 requests answered, **no 5xx**; **no High alert, no alert of a FAIL rule**; 5
Medium (10202, the console's absent anti-CSRF tokens: server actions with Next.js's origin check
and C255.4's test, not a defect), 46 Low (10021 nosniff on the API's JSON, KP11-70, fix-server;
10055 the console CSP's report-uri, fix-clients; 10044 the console's redirect shell, checked: no
data; 40014-2 a payload echoed in JSON, rendered as React text, not a defect), 3,315 Informational
(100000 the API's 4xx answers, and ZAP's notes). The hosted flow's headers (both images) match
`FLOW_RESPONSE_HEADERS`, `X-Frame-Options: DENY` and a CSP `<meta>` without unsafe-inline or
unsafe-eval. Every operation of every group was requested; 22 of 23 API scans finished all 38
active rules, `api-webhooks` 34 (the four ZAP marks informational: GET for POST, the user-agent
fuzzer, script rules, Swagger UI).

## 5. Checkpoint 5: high findings

None open: the complete run's report shows 0 High and 0 FAIL alerts, so no fix in an application
path was needed and no image was rebuilt for one. No CI failure was passed in (section 0).

## 6. Checkpoint 6: the report

`docs/security/dast-2026-11-21.md` (`6c269474a`), generated by `run.sh report` (dast-zap.py, every
header, evidence, attack and body removed; the scrub refuses any credential of the run or any
token-shaped value), then `gitleaks dir` with `.gitleaks.toml` and `security/gitleaks-pii.toml`:
no leaks; the pre-commit hook's gitleaks and PII scan: no leaks. `security/zap/triage.tsv` holds each
alert's status. `docs/security/README.md` links the report (`docs-tools`' security-index record test
requires it; a borrowed edit).

## 7. Checkpoint 7: the stack down and the final gates

`e2e:stack:down` under the e2e lock reported "stopped" in 12.4 s, but the holder had crashed while
saving the containers' logs (`RangeError: Invalid string length` at `e2e/src/processes.ts:212`:
`docker compose logs` of the API after 6.6 hours of DAST exceeds V8's string limit), before its
`compose down`; the containers kept running. The same command again ("no live holder: removing the
compose project") removed them: 0 containers, 0 volumes of `openverify-e2e`. A defect of
`e2e/setup/stack.ts` (fix-server's), in followups. No container of mine is left.

Final gates on the final tree (load 2.34 to 5.85):

| Gate | Result |
|---|---|
| `bash infra/tests/zap.test.sh` | rc 0, 56 passed (36 s) |
| `bash infra/tests/zap.test.sh --docker` (checkpoint 2, under the e2e lock) | rc 0, 52 passed |
| `bash infra/tests/images.test.sh pins` | rc 0, 26 passed (`a6f1477e5` left it failing on two literal tags in my tests; `9c8ead933` fixed them) |
| `bash infra/tests/ci-workflow.test.sh` | rc 0, 530 passed, 0 skipped |
| `bash infra/tests/release-workflow.test.sh`, `refresh-digests.test.sh` | rc 0, 102 and 18 passed |
| security/python: pytest (80% gate), ruff check, ruff format --check, mypy --strict (five scripts) | rc 0 each; 258 passed, 96%, `dast-zap.py` 95% |
| `pnpm --filter @openverify/docs-tools test` | rc 0, 412 passed |
| `docs:all` then `git diff --exit-code docs` | no diff |
| `pnpm release:check` | rc 0, 0 errors, 79 owner items |
| `pnpm format:check` | rc 0 (131 s) |
| forced typecheck | rc 0, 20 tasks (178 s, load 2.39 to 5.85) |
| forced lint, three calls | rc 0: api 243 s; dashboard and contracts 227 s; the other 17 packages 380 s |

No package's source changed (`security/zap/credentials.ts` imports e2e helpers but belongs to no
package; it typechecks under e2e's compiler settings, prettier clean), so no package test script,
`test:integration`, openapi:write, Android gate or e2e gate applies (the task's final-gate list).

## Corrections (fix-records, 2026-11-21; Workflow 11F Stage 1 amendments, items 5, 12 and 13)

The verifier checked this evidence against the files on disk at `d77550af6`. These figures above are wrong and stand corrected here; the generated report `docs/security/dast-2026-11-21.md` was already right:
- `security/zap/rules.tsv` has **22** FAIL rules, not 27 (`awk -F'\t' '$2=="FAIL"' security/zap/rules.tsv | wc -l` prints 22).
- The complete run answered **117,435** requests (the report's Scans table sums to it), not 117,770.
- The server API's key did get 429 answers: api-webhooks had 356 of them, all expected rate-policy answers and none a finding.
- api-flow got **7,352** answers (the report's table), not 7,282; 5,413 of them were 429.
