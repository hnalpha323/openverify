# Phase 11, Workflow 11C: sast-pii-11c (family S; C260, decisions 2 and 16)

Stage 2 agent, beside the other 11C builders. Owned paths: `packages/config/eslint/security.js` and its tests in `packages/config/src/`, `security/gitleaks-pii.toml`, `security/gitleaks-pii-allowlist.toml`, `security/gitleaks-pii-filter.py` with `security/tests/test_gitleaks_pii_{config,filter}.py`, and `infra/tests/gitleaks-pii.test.sh`. Named borrowed edits (listed in the report's contractDeviations): the `security.js` entry in `phase5Config()` (`packages/config/eslint/phase5-rules.js`), `.githooks/pre-commit`'s second scan, `infra/tests/pre-commit-hook.test.sh`'s new cases, the filter's line in `security/python/pyproject.toml`'s coverage list, and every source fix or inline suppression. Gates are this agent's own (rule 25); every timing carries `cat /proc/loadavg`.

Checkpoint (rule 17): `hook`, the last commit, when the pre-commit hook starts to run the PII scan on staged files.

## 0. Continuation

The first run was stopped by the orchestrator at 98% weekly usage (2026-11-14 15:17 EST, HEAD `f33b7783c`) before any commit of this area: `git log 2a83a93e7..HEAD` names no sast-pii-11c commit. Its uncommitted drafts (the two TOML files, the filter, the two pytest files and the shell test) were kept in the tree and are the starting point here; no console output of the first run survived, so every result below was produced in this run. The first run had built the PII half only; nothing of the ESLint half existed (`packages/config/eslint/security.js` absent).

On resumption the drafts were reviewed before the RED commit:

- `security/tests/test_gitleaks_pii_config.py` still read a top-level `[[allowlists]]` in the allowlist file, while the draft allowlist had moved every exception under `[[rules]]` with its id (gitleaks 8.30.1 ignores `targetRules` in an extended file, but merges an extended rule's `[[rules.allowlists]]` into the main file's rule of the same id). The test was rewritten for that shape (each exception under one rule, the extended rule holding only `id` and `allowlists`, the main file's rules holding none).
- The e2e run-file entry's description now says what the files hold ("that run's seeded credentials"), which the test asks for.
- ruff format (the frozen command finds no ruff configuration above `security/`, so it formats at ruff's defaults) and the unused `noqa: S603` were fixed.

Checked on the pinned gitleaks 8.30.1: `gitleaks dir` reads files that `.gitignore` names (a scratch repository with `e2e/.artifacts/` in `.gitignore` and an address in `e2e/.artifacts/stack.json`: `gitleaks dir . --exit-code 7` exited 7), so the configuration names `e2e/.artifacts/` and `e2e/.env.e2e` itself, with the reason.

## 1. The PII-pattern scan (C260.3)

### Design

- `security/gitleaks-pii.toml`: eight rules, `pii-email`, `pii-ipv4`, `pii-ipv6`, `pii-phone`, `pii-mrz-name`, `pii-card-number`, `pii-iban`, `pii-us-ssn`, each with `secretGroup = 1` and one shared `path` scope (a gitleaks path cannot be negated, so the scope is repeated in each rule and the test holds them equal): `contracts/fixtures/`, `fixtures/`, `docs/`, `e2e/`, `load/` (11D's), every `test-support/`, `tests/`, `test/`, `testing/`, `__tests__/` and Android test source set (`androidHostTest`, `androidDeviceTest`, `androidUnitTest`, `androidTest`, `commonTest`, `jvmTest`), every test file (`*.test.*`, `*.spec.*`, `testing.ts`, `test-support.ts`, `*.test-support.*`, `test_*.py`, `*_test.py`, `conftest.py`, `*Test.kt`, `*.test.sh`) and the seed sources (`apps/api/scripts/seed-dev.ts`, `apps/api/src/seed/`; `seed:load` is 11D's and lands under `load/` or is added then). Two global allowlists: installed, generated and binary files (`node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.gradle`, `.venv`, caches, `models/`, `data/`, images, archives, fonts, certificates), and the e2e run files `e2e/.artifacts/` and `e2e/.env.e2e` with their reason.
- `security/gitleaks-pii-allowlist.toml`, joined through `[extend]`: each exception sits under the rule it serves (`[[rules]]` with the id only, `[[rules.allowlists]]` with a description that starts with the rule id and says why). Path-scoped exceptions use `condition = "AND"` with both the path and the value. The email default amends C260.3 (below).
- `security/gitleaks-pii-filter.py` (standard library, `python3 -I`): runs gitleaks with the configuration, its JSON report in a private temporary directory that is removed before exit, keeps a `pii-card-number` match only when it is Luhn-valid with a card network's prefix and a length the network issues, and a `pii-iban` match only when its mod-97 check holds; prints rule, file and line (and commit for a history scan), never the value, and a count per rule; exit 0 clean, 1 findings, 2 usage, an unreadable report or a gitleaks failure (the hook and the supply-chain step fail closed on 1 and 2). gitleaks resolves `[extend]`'s path from the working directory, so it runs from the repository root.

### RED (`8c01fda69`)

The tests were committed alone and run in a scratch worktree at that commit (`git worktree add --detach /tmp/sast-pii-red-wt 8c01fda69`, removed afterwards), where the configuration, the allowlist and the filter do not exist (load 7.47 4.45 1.79):

```
$ bash infra/tests/gitleaks-pii.test.sh
FAIL - security/gitleaks-pii.toml exists
FAIL - security/gitleaks-pii-allowlist.toml exists
FAIL - security/gitleaks-pii-filter.py exists
FAIL - both files are valid TOML
FAIL - pii-email catches its value in docs/ and in a test file (exit 2: python3: can't open file '/tmp/sast-pii-red-wt/security/gitleaks-pii-filter.py': [Errno 2] No such file or directory )
...
FAIL - the committed tree (HEAD) passes the PII scan (python3: can't open file ...gitleaks-pii-filter.py ...)
# 8 passed, 16 failed                                         (exit 1; the 8 are "does not echo the value", met by an empty output)
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . --no-cov security/tests/test_gitleaks_pii_filter.py
E   FileNotFoundError: [Errno 2] No such file or directory: '/tmp/sast-pii-red-wt/security/gitleaks-pii-filter.py'
1 error in 3.22s                                              (exit 2, at collection: the script is loaded by path)
$ ... pytest ... security/tests/test_gitleaks_pii_config.py
E       FileNotFoundError: [Errno 2] No such file or directory: '/tmp/sast-pii-red-wt/security/gitleaks-pii.toml'
E       FileNotFoundError: [Errno 2] No such file or directory: '/tmp/sast-pii-red-wt/security/gitleaks-pii-allowlist.toml'
(exit 1)
```

### GREEN (`455a2452a` the configuration, allowlist and filter; `265003940` the coverage line, a borrowed edit)

```
$ bash infra/tests/gitleaks-pii.test.sh                         (load 5.71 4.28 1.81)
ok   - pii-<rule> catches its value in docs/ and in a test file          (each of the eight)
ok   - pii-<rule>'s finding does not echo the value                      (each of the eight)
ok   - reserved, documentation, fictitious, synthetic and checksum-failing values are not reported
ok   - a source file outside the sample-data paths is not read
ok   - node_modules, e2e/.artifacts and e2e/.env.e2e are not read
ok   - the committed tree (HEAD) passes the PII scan
# 24 passed, 0 failed                                           (exit 0)
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .
security/gitleaks-pii-filter.py     119      0     36      0   100%
TOTAL                               870     18    302     18    97%
Required test coverage of 80% reached. Total coverage: 96.93%
181 passed in 2.38s                                             (exit 0; 52 of them this area's)
$ uv run --project security/python --frozen ruff check security scripts/fetch_k8s_schemas.py scripts/tests    -> All checks passed! (exit 0)
$ uv run --project security/python --frozen ruff format --check security scripts/fetch_k8s_schemas.py scripts/tests -> 8 files already formatted (exit 0)
$ uv run --project security/python --frozen mypy --strict security/gitleaks-pii-filter.py                    -> Success: no issues found in 1 source file
$ python3 -I security/gitleaks-pii-filter.py --gitleaks ~/.local/bin/gitleaks dir .                        (working tree, other agents' uncommitted files included; 8.4 s, load 5.30 1.48 0.51)
pii scan: 0 finding(s) kept of 1203 matched                     (exit 0; the 1,203 are card- and IBAN-shaped runs the checksum drops)
```

### The email default (an amendment of C260.3)

C260.3 lists `example.com`, `example.org` and `example.net` only. The allowlist also passes the reserved top-level names of RFC 2606 and RFC 6761 (`.test`, `.example`, `.invalid`, `.localhost`): the sandbox looks up MX for `example.com` (C56), so Workflow 7B moved the full-stack specs to `.test` addresses (about 130 files use `example.test`). Every other exception is listed by value or by value and path, each with its reason (`security/gitleaks-pii-allowlist.toml`): the free-mail and typo-domain checks' provider domains in two named test files, nodemailer's advisory reproduction strings, a few syntax-test addresses at unreserved domains, the Spanish UI text's `ejemplo.com` example (KP10-16's fluent review may move it to a reserved name), and three non-person identities (a curl `name@file` form, a public authority's role address on its CSCA page, and kubectl's release-signing service account, Stage 1a amendment 30, allowed by name and never reworded).

The phone ranges are read from the fixtures and generators: North America's 555-0100 to 555-0199 (and the unassigned area code 555), a messaging provider's test numbers +1 500 555 000x, Ofcom's drama ranges, ACMA's and ARCEP's fictitious mobile blocks, and libphonenumber's ascending or zero placeholders for countries with no published range. The MRZ rule passes the synthetic generators' names (`services/vision/tools/synthetic_*.py`, `packages/checks/src/document/testing.ts`, `contracts/fixtures/mrz/`) and ICAO Doc 9303's specimens. The card rule passes the networks' published test numbers; the IBAN rule the registry's published examples; the SSN rule passes the never-issued ranges in its pattern and the two numbers published as never valid.

## 2. The SAST baseline (C260.1, C260.2)

### Design

- `packages/config/eslint/security.js`: `SECURITY_RULES` gives each of eslint-plugin-security 4.2.0's fifteen rules a state and a reason; `NON_LITERAL_FS_FILENAME_FOLDERS` = `apps/api/scripts/**`, `scripts/**`, `security/**`; `SECURITY_SUPPRESSION_CEILING`; `securityConfig()` returns two flat-config blocks (the plugin and every rule for `**/*.{ts,tsx,js,mjs,cjs}`, then `detect-non-literal-fs-filename` at `error` in its folders). `security.d.ts` types it.
- `phase5Config()` (`packages/config/eslint/phase5-rules.js`) spreads `...securityConfig()` last, after the C252.2 pattern selectors and the C240.5 cross-tenant entries (named borrowed edit); the root `eslint.config.js` already spreads `phase5Config()` and is not edited (OD-11C-1, rule 26).
- On: `detect-unsafe-regex`, `detect-eval-with-expression`, `detect-child-process`, `detect-non-literal-require`, `detect-buffer-noassert`, `detect-new-buffer`, `detect-pseudoRandomBytes`, `detect-possible-timing-attacks`, `detect-bidi-characters`, `detect-disable-mustache-escape`, `detect-no-csrf-before-method-override`, and `detect-invisible-characters` (new in 4.2.0, not named by C260.1; on, beside the bidi rule: an amendment). Off: `detect-object-injection` (every keyed access in typed code), `detect-non-literal-regexp` (C252.2's rule with its reviewed allowlist covers the same calls), `detect-non-literal-fs-filename` (on only in the three folders).
- `packages/config/src/eslint-security.test.ts` (31 tests): the states and reasons against the plugin's own rule list; each rule's severity in `phase5Config()`'s output for seven paths (`ESLint.calculateConfigForFile`); a lint fixture per rule that is on, assembled in strings (the bidi and invisible characters by `String.fromCodePoint`); keyed access and run-time patterns left to the type checker and C252.2; the fs rule only in the three folders; the suppressions (every `security/` disable directive in a comment of the lint scope is a next-line or line directive of a plugin rule with a reason of at least 20 characters, per rule within the ceiling); the services' file reads (every production module that imports `node:fs` is in a reviewed list with where its paths come from, and no file-system call's argument names `request.body`, `.params`, `.query`, `.headers`, `.url` or `.raw`); and C260.2's source scan (no `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML`, `document.write` or `dangerouslySetInnerHTML` outside tests and test helpers, with each sink assembled from fragments to prove the pattern).
- ruff's `S` rules are on in `services/vision/pyproject.toml` (`select` holds `"S"`; only `S101`, `S105` and `S106` are ignored, under `tests/**`). Android lint runs with its defaults in every module (no `lint {}` block, no `lint.xml`, nothing disabled; `consumer-check` turns its own lint tasks off because the parent build's gate lints). No gap, so nothing changed there.

### Findings and their handling

A scan of the lint scope (the 19 workspace packages, every rule at `error`, no type information; `/tmp/sast-pii-11c/scan.mjs`, scratch) found, at `6f214a128`:

| rule | findings | handling |
|---|---|---|
| detect-object-injection | 3,341 | off (reason above) |
| detect-non-literal-fs-filename | 691 (5 in the three folders) | off outside the folders; the 5 suppressed: `kek-rewrap.ts` (3, the `--state-file` path), `trust-anchors-sync.ts` (the `--import` and `--root` files), `workflow-docs.ts` (the fixed `REFERENCE_DOCS` paths) |
| detect-unsafe-regex | 168 in 128 files (33 in tests) | each checked with eslint-plugin-regexp's exact analysis (`no-super-linear-backtracking`, `no-super-linear-move`, `report: potential`): 163 have no super-linear path and are suppressed with that reason; of the 5 the analysis flags, `apps/api/src/services/list-filters/transactions.ts`' number pattern was fixed test-first (below), and four are bounded inputs suppressed with their own reason (`apps/api/src/config.ts`, an operator setting of at most 200 characters; `packages/checks/scripts/build-matching-data.ts`, a development script over the pinned data; `packages/checks/src/viz.ts`, text `collapse()` has reduced to single spaces; `packages/contracts/src/report-queries.ts`, anchored at the start, open at the end, at most 500 characters). The fixed pattern still has star height 2, so its site keeps a suppression too: 168 |
| detect-non-literal-regexp | 132 | off (C252.2) |
| detect-bidi-characters | 54 in 12 files (28 in tests) | fixed: every raw bidirectional control in a string or regular-expression literal written as its `\u` escape, the same value (Trojan Source's own advice); no suppression |
| detect-possible-timing-attacks | 42 in 36 files | suppressed: 40 presence or emptiness checks against `null`, `undefined` or `''`; a policy cache key (`client-pool.ts`); a password against its own confirmation in the same submission (`actions/invitations.ts`) |
| detect-non-literal-require | 1 | sdk-web-11c's in-progress `packages/sdk-react/scripts/test-build.ts`; gone from the file when the rules went to `error` |
| the eight other rules | 0 | on |

The ceiling (`SECURITY_SUPPRESSION_CEILING`) is the tree's count at `4a3b24ba5`: `detect-unsafe-regex` 168, `detect-possible-timing-attacks` 42, `detect-non-literal-fs-filename` 5 (215 directives in all).

### RED (`0d44b9954` the stub, `6f214a128` the test, `078651060` a test fix)

```
$ (cd packages/config && pnpm exec tsc --noEmit)                          -> exit 0
$ (cd packages/config && pnpm exec vitest run src/eslint-security.test.ts --coverage.enabled=false)    (load 4.25 4.06 2.75)
 × gives every rule of the plugin a state and a reason   AssertionError: expected [] to deeply equal [ 'detect-bidi-characters', …(14) ]
 × names its reasons for the three rules that are off    TypeError: .toMatch() expects to receive a string, but got undefined
 × is spread by phase5Config(), which the root eslint.config.js spreads   AssertionError: expected 0 to be greater than 0
 × reports its lint fixture: detect-<rule>  (each of the twelve)          AssertionError: expected [] to deeply equal [ 'security/detect-<rule>' ]
 × reads non-literal file names only in apps/api/scripts/, scripts/ and security/
Tests  16 failed | 15 passed (31)                                         (exit 1)
```

`078651060`: once `security.js` described the directive form in its header, the suppression count read that description as a directive; the matcher now reads directives in comments only, and the header was reworded.

### GREEN, in a landing order that kept every other agent's lint green

1. `2d302f3ef` (landing): `security.js` with every rule's final state and reason, and `phase5Config()`'s spread (borrowed edit of `phase5-rules.js`); the five rules with findings ran at `warn` meanwhile (a disable directive naming a rule of a plugin that is not loaded is itself an ESLint error, so the plugin had to be loaded before the suppressions landed).
2. `0c3c24cce` RED, `5e7952404` GREEN: the number filter (below).
3. The fixes and suppressions, one path-scoped commit per package (each file clean before the edit, checked with `git status --porcelain`): `115573817` apps/api (46 files), `1aa184581` apps/dashboard (26), `10bb79a8f` apps/flow (2), `452fcc4ef` e2e (1), `a0f3835bf` packages/checks (23), `29d166ad3` packages/config (2), `2f1783049` packages/contracts (33), `96c37ca2f` packages/core (13), `9a5252773` packages/emrtd (3), `55b1b5a19` packages/flow-spec (6), `29816e4a2` packages/sdk-js (1), `b9fde04c6` packages/signals (4), `5c97d4819` packages/watchlist (5), `8145972a9` packages/workflow-engine (9). Prettier ran on the files `format:check` covers; five files under `.prettierignore`'s bare `services/` and `data/` were edited without it (Prettier would have reformatted unrelated lines there).
4. `4a3b24ba5`: every rule at its final state, the ceiling set. Then the whole lint scope (5,980 files) with the five rules at `error`, inline directives honoured and unused directives reported: 0 problems.

```
$ (cd packages/config && pnpm exec vitest run --coverage.enabled=false)     -> Tests 443 passed (one other failure at the time was sdk-web-11c's in-progress demo-web entry point)
$ (cd packages/config && pnpm exec eslint .)                                  -> exit 0
```

`8fdc4c3f0`: the reviewed list of modules that read files gains `apps/dashboard/server.ts`, which images-11c's `9e7cc46ee` made read its `<NAME>_FILE` secrets and the standalone configuration (the test failed on it as designed); sdk-web-11c's `6df73e2ab` added its sample site's server the same way.

### The number filter (`apps/api/src/services/list-filters/transactions.ts`)

`^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$` let `\d+` and `\d*` trade digits, so a long digit run with a rejecting suffix backtracked quadratically; a `filter[fields.<key>]` value reaches it from an API key's list call. Measured before the change with `process.cpuUsage` (load 7.04 5.69 3.90): 13.8 ms at 4,000 digits, 55.4 ms at 8,000, 248 ms at 16,000. `^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$` reads the same language (ten accepted and ten refused shapes compared) in linear time.

```
RED  0c3c24cce  $ pnpm exec vitest run src/services/list-filters/transactions-number.test.ts --coverage.enabled=false   (load 6.31 5.61 3.92)
     × refuses a long run of digits with a rejecting suffix in linear time   AssertionError: expected 877.861 to be less than 50
     Tests  1 failed | 21 passed (22)
GREEN 5e7952404 $ pnpm exec vitest run src/services/list-filters/ --coverage.enabled=false   (load 5.85 5.58 3.98)
     Test Files  3 passed (3)   Tests  38 passed (38)
```

## 3. The hook (`.githooks/pre-commit`'s second scan)

```
RED  fb8b46312  $ bash infra/tests/pre-commit-hook.test.sh
     FAIL - a staged real-looking address in docs/ blocks the commit (commit succeeded)
     FAIL - a staged Luhn-valid card number in a test file blocks the commit (commit succeeded)
     FAIL - the hook fails closed without the PII configuration (commit succeeded)
     ...
     # 16 passed, 11 failed                                          (exit 1)
GREEN 2e6ed9ddf $ bash infra/tests/pre-commit-hook.test.sh
     ok - a staged real-looking address in docs/ blocks the commit / HEAD does not move / names rule, file and line / never echoes the value
     ok - a staged Luhn-valid card number in a test file blocks the commit / names its rule / HEAD does not move
     ok - the same digits with a wrong check digit commit
     ok - synthetic values in docs/ and an address outside the sample-data paths commit / HEAD advances
     ok - the hook fails closed without the PII configuration / names it / HEAD does not move
     ok - the hook fails closed without python3 / names it / HEAD does not move
     # 27 passed, 0 failed                                           (exit 0; the first 11 cases unchanged)
```

The scratch repository of the test copies `security/gitleaks-pii.toml`, the allowlist and the filter beside `.gitleaks.toml`. The hook runs, after the secret scan, from the repository root: `python3 -I security/gitleaks-pii-filter.py --gitleaks <gitleaks> git --pre-commit --staged .`; it blocks on exit 1 (a finding) and 2 (a failure), and before that when the configuration, the filter or `python3` is missing. Its own commit ran it (`pii scan: 0 finding(s) kept of 0 matched`).

## 4. The full history

`python3 -I security/gitleaks-pii-filter.py --gitleaks ~/.local/bin/gitleaks git .` over 7,495 commits (load 5.31 5.56 4.66; 12.9 s, not under the e2e lock, so not a measurement): at `455a2452a`'s configuration, `pii-ipv6: 1`, all other rules 0 (1,641 shapes matched, 1 kept). The one finding was a documentation-range edge address (just outside 2001:db8::/32) in `apps/api/src/plugins/api-key-auth.test.ts` of commit `102672586` (2026-10-20), a file since deleted; `1952f4639` adds that path to the address-edge allowance. After it: 0 kept of 1,640 matched, every rule 0.

## 5. End gates (on the final tree, beside the other Stage 2 agents)

| call | result |
|---|---|
| `bash /tmp/openverify-heavy.sh pnpm turbo run typecheck --force` | exit 0, 19 tasks, 264 s (load 11.73 before) |
| lint `--force --concurrency=1 --filter=@openverify/api` (4 GB heap, heavy) | exit 0, 375 s (load 11.04 to 16.56) |
| lint `--filter=@openverify/dashboard --filter=@openverify/contracts` (heavy) | exit 0, 371 s (load 15.95 to 14.28) |
| lint checks, config, core, db, emrtd, flow-spec, node | exit 0, 238 s (load 12.62 to 3.71) |
| lint js, react, signals, ui, watchlist, workflow-engine, flow, demo-web, e2e | exit 0, 208 s (load 3.49 to 5.93); 19 of 19 packages, the security rules at `error` |
| `pnpm turbo run test --force` checks, config, contracts, core, emrtd, flow-spec, signals, workflow-engine, flow | exit 0, 213 s (load 21.83 to 19.14): checks 3,849, config 443, contracts 4,905, core 2,007, emrtd 338, flow-spec 527, signals 192, workflow-engine 2,022, flow passed |
| `pnpm --filter @openverify/js test` | exit 0, 19 |
| `pnpm turbo run test --force --filter=@openverify/watchlist --filter=@openverify/e2e` (heavy) | exit 0, 322 s: watchlist 820, e2e 144 |
| dashboard, 2 blob shards and the merge (heavy) | shards 256 s and 282 s (exit 1 each on partial coverage, as a lone shard does); merge exit 0: 7,235 tests in 622 files, lines 95.65% |
| API, 12 blob shards and the merge (heavy, K = 12 beside other agents) | shards 197-418 s each at load 12.96 to 19.57; merge exit 1: 10,882 passed, 2 failed of 10,884 in 858 files, lines 94.33%. The two: `config-registry.test.ts` (images-11c's `27c7b0030` added `OPENVERIFY_VISION_MODELS_MANIFEST` to vision; its owner registered it in `f9b3e4ecd`), and `operator-patterns.test.ts` "matches the catastrophic input against the ambiguous pattern ^a*a*a*a*$ within 50 ms of CPU" (`expected 114.936 to be less than 100` under the merge at load about 17; ingestion-11b's test, measured in CPU time). Both files re-run alone afterwards: 34 of 34 passed (load 5.92 11.74 17.21). Neither file is this area's |
| `pnpm --filter @openverify/db test:integration` (heavy) | exit 0, 110, 317 s (load 10.55 to 29.51) |
| integration `--project graph` (heavy) | exit 0, 13, 105 s; template 54.3 s of its 180 s guard (load 28.03) |
| integration `--project api --shard=1/3`, `2/3`, `3/3` (heavy) | exit 0 each: 123, 128 and 193 (444); 260, 366 and 236 s (load 15.84 to 29.92) |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` and `benchmark:test` (rule 16: `apps/api/src/watchlists/manifest.ts`, `packages/watchlist/src/record/schema.ts` and others of its imports gained a comment) | exit 0 both; 119 tests |
| `uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .` | exit 0, 189 passed, 97.12% (the filter 100%) |
| ruff check, ruff format --check (security, the two scripts, scripts/tests); mypy --strict on the filter | exit 0 each |
| `python3 -I security/gitleaks-pii-filter.py --gitleaks ~/.local/bin/gitleaks dir .` (e2e stack down: no `e2e/.artifacts/stack.json`) | exit 0: 0 kept of 1,204 matched (the raw `gitleaks dir --redact --config security/gitleaks-pii.toml .` reports those 1,204 card- and IBAN-shaped runs and exits 1, which is why the filter is the step) |
| the same with `git .` (history) | exit 0: 0 kept of 1,640 matched |
| `gitleaks git --redact .` (the secret scan, full history) | exit 0, no leaks found (110 MB in 10.6 s) |
| `bash infra/tests/pre-commit-hook.test.sh` | exit 0, 27 passed |
| `bash infra/tests/gitleaks-pii.test.sh` | exit 0, 24 passed |
| `pnpm format:check` | exit 0 |
| `bash infra/scripts/supply-chain.sh pii` (scanners-11c's step over this filter) | exit 0: "the PII-pattern scan kept nothing", 0 kept of 1,204 matched |
| `(cd packages/config && pnpm test)` | exit 0, 443 passed, lines 97.01% |

## Checkpoint

CHECKPOINT hook DONE at 2e6ed9ddf19191ddadcbc6c30fdf9f014d02985d

Handoff: from that commit every commit in this repository (with `core.hooksPath .githooks`) runs the PII-pattern scan on its staged changes after the secret scan, through `python3 -I security/gitleaks-pii-filter.py --gitleaks <gitleaks> git --pre-commit --staged .` from the repository root. A finding prints `<rule> <file>:<line>` and blocks; fix it with a synthetic value (an `example.com` or `.test` address, 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32, a 555-01xx number, the generators' names, a network's published test card number), or report a reviewed allowlist entry with its reason to sast-pii-11c (or, after this Workflow, the owner of `security/gitleaks-pii-allowlist.toml`). supply-chain.sh's `pii` step runs, from the repository root: `python3 -I security/gitleaks-pii-filter.py --gitleaks "$SUPPLY_CHAIN_TOOLS_DIR/gitleaks" dir .` (exit 0 clean, 1 findings, 2 failure). The ESLint security rules are at `error` everywhere `phase5Config()` applies; a new finding is fixed, or suppressed on its line with a disable-next-line comment naming `security/<rule>` and ` -- <reason>`, and a suppression past the ceiling in `packages/config/eslint/security.js` needs the ceiling raised with its reason.
