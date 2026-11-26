# TDD record: Workflow 6A Stage 4, `integration-6a`

Phase 6 integration, 2026-10-27/28, on top of the Stage 3 records (`dfe51d34`). Every slice went stub (when a test needed a name that did not exist), then RED, run and seen failing for its intended reason, then GREEN. The e2e specs are the exception: they were written after Stages 1-3 built the behaviour, passed at once, and were then shown to fail against code mutations (slice 6). Commands ran from the repository root after `source scripts/env.sh` unless stated. Output is abbreviated.

## 1. `seedReportTemplates` (C71.3, F11, V01)

The plan gave `apps/api/src/seed/report-templates.ts` to `api-reports`, the Stage 1b hook commit to `api-watchlists`, and neither built it, so `seed:dev` created no report template.

- Stub `ad7d77bd`: `DEFAULT_REPORT_TEMPLATE_NAMES`.
- RED `d096ac0f`, `apps/api/src/seed/report-templates.test.ts`:
  ```
  $ pnpm --filter @openverify/api exec vitest run src/seed/report-templates.test.ts --coverage.enabled=false
   × creates one published template per report type in each environment, ...
   × seeds templates that publish in their environment kind with the default configuration
   × finds the templates of an earlier run and creates none again
   × skips and counts a template whose resolved list would be empty
        Tests  4 failed (4)
  AssertionError: expected { created: +0, existing: +0, …(1) } to deeply equal { created: 12, existing: +0, …(1) }
  ```
- GREEN `4bbd5516`: one published `Default <type>` template per type in each environment; sandbox list types pin only the enabled sandbox-only lists, production ones `defaultSearchLists` (the enabled real sources, so the production PEP template pins `wikidata-pep` before any sync); every seeded config passes `assertPublishableConfig`; a later run finds them by name; an empty list is skipped and counted. `dev-seed.test.ts` now expects `{ created: 18, existing: 0, skipped: 0 }` (it expected the stub's zeros).
  ```
  $ pnpm --filter @openverify/api exec vitest run src/seed/report-templates.test.ts src/seed/dev-seed.test.ts --coverage.enabled=false
   Test Files  2 passed (2)
        Tests  36 passed (36)
  ```

## 2. The media name at creation (C81.2, C81.3, H13)

api-providers reported a missing hook in api-reports' create path: a business-adverse-media name that is one generic word once its legal form is stripped was created and errored later.

- RED `9b93ff69`, `apps/api/src/routes/server/report-media-query.test.ts`:
  ```
   × refuses a business name that is one generic word once its legal form is stripped
  Error: expected HTTP 422, got 201: {"data":{"type":"report/business-adverse-media", ...
        Tests  1 failed | 2 passed (3)
  ```
  The person case already passed: the person query schema refuses a name without a letter. **Mistake:** the RED commit did not typecheck (`TS2352`, the problem read without `unknown`); `5df46c70` fixed it before GREEN.
- GREEN `ba5362fd`: `createBodyOf` (`routes/server/reports.ts`) calls `mediaQueryProblem` for both media types and answers 422 `report_query_invalid` at the name's pointer.
  ```
   Test Files  2 passed (2)   (report-media-query, reports)
        Tests  17 passed (17)
  ```

## 3. The e2e stack (C83, C78.3, F14, C89.2)

- RED `a8d04ab2` (`e2e/src/env.test.ts`): the Phase 6 report providers bound to `sandbox` for sandbox environments only, no vendor credential, EU token or Wikidata contact, refresh and GDELT acknowledgement off, whatever the shell says.
  ```
  AssertionError: ADVERSE_MEDIA: expected undefined to be 'sandbox'
        Tests  1 failed | 17 passed (18)
  ```
  GREEN `34897da2` (`e2e/src/env.ts`): `Tests  18 passed (18)`.
- Stub `c9bcedcf`: the `build:variant-groups` script in `packages/watchlist/package.json` and an empty `BUILD_VARIANT_GROUPS_ARGS`. RED `0c9887e0` (`e2e/src/assets.test.ts`):
  ```
  AssertionError: expected [] to deeply equal [ '--filter', …(2) ]
        Tests  1 failed | 10 passed (11)
  ```
  GREEN `9b655523`: the arguments, and `e2e/setup/stack.ts` builds the variant groups after `fetch_data.py` (8 s), so `seed:dev` imports the sandbox lists. `Tests  11 passed (11)`.

## 4. The PEP import answers (C80.2, C89.2)

The committed `wikidata-pep.synthetic.sparql.json` is a wide answer with fictional classes, which the PEP importer refuses (it reads `openverify/wikidata-pep-answers/v1`).

- Stub `7b3771e0`: `SANDBOX_PEP_CLASS_QIDS` (one `pep-positions.json` class per public class) and `pepImportAnswers`. **Mistake:** the stub kept an unused parameter, which lint refuses; GREEN removed it.
- RED `59208cd3` (`packages/watchlist/src/testing/sparql.test.ts`):
  ```
  AssertionError: expected [] to deeply equal [ 'Q-test-1001', 'Q-test-1004', …(3) ]
  AssertionError: expected undefined to deeply equal []
        Tests  2 failed | 8 passed (10)
  ```
  GREEN `24932c5d`: the document per class row, persons and relatives with the live queries' variables. `Tests  10 passed (10)`.
- RED `a66a78b6` (`fixture-files.test.ts`): `expected undefined to be '{\n  "format": "openverify/wikidata-p…'`. GREEN `309695b2`: `fixtures/wikidata-pep.synthetic.answers.json`, generated with `OPENVERIFY_WRITE_FIXTURES=1`, kept by the drift test; the README says the wide answer is not an import.

## 5. The four C89.2 specs

`d57f0633`: `e2e/tests/report-watchlist.spec.ts`, `report-monitoring.spec.ts`, `report-inquiry.spec.ts`, `report-risk.spec.ts`, with `e2e/tests/support/reports.ts` and `importWatchlist` in `support/commands.ts`. Each states "Budget: 90 s" and sets it.

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e exec playwright test tests/report-watchlist.spec.ts tests/report-monitoring.spec.ts tests/report-inquiry.spec.ts tests/report-risk.spec.ts
  ✓  1 tests/report-inquiry.spec.ts ... (14.1s)
  ✓  2 tests/report-monitoring.spec.ts ... (30.1s)
  ✓  3 tests/report-risk.spec.ts ... (5.8s)
  ✓  4 tests/report-watchlist.spec.ts ... (920ms)
  4 passed (1.9m)
```

They were written after the behaviour existed and passed at once.

## 6. The specs fail when the behaviour breaks (mutation check)

Two mutations in the working tree, restored from copies afterwards (`git status` showed only the new spec files): the seeded sandbox templates select every enabled sanctions source (unsynced, so `list_unavailable`), and the re-screen inserts no runs.

```
  ✘  1 report-inquiry.spec.ts (13.6s)       Error: expect(received).toMatchObject(expected)
  ✘  2 report-monitoring.spec.ts (1.1m)     Error: No webhook matching report/watchlist.matched for rep_… within 60000 ms (0 received)
  ✘  3 report-risk.spec.ts (5.5s)           Error: expect(received).toMatchObject(expected)
  ✘  4 report-watchlist.spec.ts (264ms)     Error: expect(received).toMatchObject(expected)
  4 failed
```

## 7. The missing matcher data said once at worker start (C78.3, F14)

- Stub `e5eb77d6`: `logMatcherDataAtStart`, logging only a loaded file. RED `87eef660` (`worker-startup.test.ts`):
  ```
   × warns once, naming how to build the file, when the variant groups are missing or not the shipped ones
  AssertionError: expected [] to deeply equal [ { level: 'warn', …(2) } ]
        Tests  1 failed | 3 passed (4)
  ```
- GREEN `88c046a9`: the warning names `fetch_data.py` and `build:variant-groups`; `main()` calls it before reconciling the sources. `Tests  49 passed (49)` (worker-startup, worker).

## 8. `crypto-address-watchlist` is `ga` (C69.1, Stage 1a amendment 11)

- RED `15998962` (`report-registry.test.ts`; the "every type beta" test now excludes crypto, a change the plan makes): `AssertionError: expected 'beta' to be 'ga'`, `Tests  1 failed | 10 passed (11)`.
- GREEN `8a85d4b9`: `stage: 'ga'`. `Tests  11 passed (11)`.

## 9. Compose (C83, C72.5, C76.4, C73.8; foundation-6 item 17)

- RED `6ef287dc` (`infra/tests/compose.test.sh`): the SMS-only Twilio rule for the worker and migrate, the worker's Lookup credentials and list settings, none of them for the API and migrate, the report limits read alike by every process, the EU token commented out without a value, the Phase 6 settings in `.env.example`, the report kinds, and `log_parameter_max_length=0` and `_on_error=0` in the Postgres command (plus a live probe).
  ```
  $ bash infra/tests/compose.test.sh --static-only
  FAIL - worker receives OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID
  FAIL - worker receives OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID
  FAIL - worker receives OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET
  # 402 passed, 3 failed
  ```
- GREEN `eb848bb7`: the three variables in `x-worker-provider-environment`. `# 405 passed, 0 failed`.

## 10. The apps image (C78.3, F14)

- RED `9de962eb` (`infra/tests/apps-image-context.test.sh`): the variant groups, the sandbox lists, the PEP classes, the legal forms, the report tables and the manifest in the context; the unfiltered rigour file out; the Dockerfile's variant-group digest equal to `SHIPPED_VARIANT_GROUPS_SHA256`.
  ```
  FAIL - the apps image context has data/variant-groups.json (reports read it) (excluded by .dockerignore)
  FAIL - the apps image checks the variant groups against SHIPPED_VARIANT_GROUPS_SHA256 (pin '529216c9…7324')
  # 22 passed, 2 failed
  ```
- GREEN `ab09110b`: `!data/variant-groups.json` and a `sha256sum -c` step. `# 24 passed, 0 failed`.

## 11. CI: the API suite's job (unit-api)

CI run 40540937935 (end of Phase 5) used 19.7 of the job's 20 minutes for 3,786 API tests; Phase 6 has 4,471.

- RED `e77f27b2` (`ci-workflow.test.sh`): `FAIL - unit-api: the job's timeout leaves room for the grown API suite (at least 40 minutes) (20)`, `# 181 passed, 1 failed`.
- GREEN `dea832ba`: `timeout-minutes: 45`. `# 182 passed, 0 failed`.

## 12. `@openverify/node` `accounts.retrieve` with `include` (C70.5, Stage 1a amendment 21)

- Stub `6eeda6a8`: the signature `(id, params?: { include?: 'reports' }, options?)` answering the include document, not sending it.
- RED `ae678baf` (`resources.test.ts`): `AssertionError: expected 'https://api.example.test/api/v1/accou…' to be 'https://api.example.test/api/v1/accou…'`, `Tests  1 failed | 106 passed (107)`.
- GREEN `ae8e2c6e`: `includeQuery(params?.include)`. `Tests  107 passed (107)`. The dashboard caller still typechecks.

## 13. The golden provider-backed reports (risk-logic and api-providers follow-ups)

- RED `ddd193d1` (`apps/api/src/jobs/report-types/report-golden-fixtures.test.ts`): each fixture's decided attributes against the job's served result over the sandbox providers. All five failed: the fixtures held Stage 1a's guesses (`phone-risk-confidence` 0.5 for a SIM swap, thresholds `null`, invented articles; the business media query matched nothing).
  ```
        Tests  5 failed (5)
  ```
- GREEN `6ecac345`: the fixtures rewritten with `OPENVERIFY_WRITE_REPORT_FIXTURES=1` (the business query names a second distinctive word, as the H13 rule needs), then formatted. `Tests  5 passed (5)`; the tests that read them stay green:
  ```
  contracts fixtures, reports, accounts: Tests  266 passed (266)
  dashboard report-type-coverage:        Tests  11 passed (11)
  api report-includes, report-masking, samples: Tests  99 passed (99)
  ```

## 14. `docs/reports/` and the registry's docs half (C69.1, C87)

- RED `2913123c` (`apps/api/src/report-docs.test.ts`), run with the uncommitted pages moved aside:
  ```
   × has a page for watchlist that says what a result means and its stage  (… 9 types)
   × holds the lawful-basis note, the adapter disclosures, the completion window, the logging warning and the retention setting
        Tests  10 failed (10)
  ```
  Back in place, `business-adverse-media.md` lacked "What a result means" (`Tests  1 failed | 9 passed`); added.
- GREEN `b4c07d8f`: the overview and nine pages, and the Phase 6 section of `docs/checks/sandbox-providers.md`. `Tests  10 passed (10)`.
- `03206617`: `THIRD_PARTY_LICENSES.md` rows for the rigour legal forms and the libaddressinput US ZIP prefixes.

## 15. Without the gitignored data, as CI runs

`data/variant-groups.json` and `data/rigour-person_names.txt` moved aside, then restored (digest checked):

```
$ pnpm --filter @openverify/api exec vitest run src/watchlists src/jobs/reports src/jobs/report-types src/jobs/repeatable src/routes/dashboard src/seed src/services/reports src/routes/server/report src/worker --coverage.enabled=false
 Test Files  58 passed (58)
      Tests  603 passed (603)
```

## 16. Report creation against account redaction on Postgres (C74.6, C73.7, P06)

`e103679e` adds two races to `apps/api/src/jobs/reports/report-races.integration.test.ts`, mirroring api-reports' inquiry pair. They were written after the behaviour existed and passed at once:

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
      Tests  12 passed (12)
```

Shown to fail against mutations, each restored from a copy:
- the creation ignoring a redacted account: `× a creation during an account redaction waits for it and answers 410` (`expected 'settled' to be 'pending'`);
- the account redaction skipping the account's reports: `× an account redaction during a creation waits for it and redacts the new report` (`expected null not to be null`).

Reading the account without the share lock did not make the second fail: inserting the report's foreign key to the account takes a key-share lock that the redaction's update waits for anyway.

## Final gates (the plan's Validation list, in order, in the foreground, 2026-10-28)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm format:check` | rc 0, 54 s |
| `pnpm turbo run lint typecheck --force` | 28 of 28 tasks, 4 min |
| `pnpm test`, API as two blob shards and `vitest run --merge-reports --coverage` | 316 files, 4,471 tests passed; 96.36% statements, 88.26% branches, 98.08% functions, 96.4% lines; shards 4 min 56 s and 4 min 21 s |
| `pnpm turbo run test --filter='!@openverify/api'` | 13 of 13 (7 cached): contracts 2,071, checks 3,304, dashboard 3,056, flow 1,012, db 962, core 769, watchlist 467, emrtd 318, node 250, flow-spec 113, e2e 92, config 91, ui 54; each package ≥ 80% |
| `pnpm test:integration` | db 59, api 139; the C78.7 gate p95 73.3 ms at 105,517 names; 3 min 18 s. Run again after slice 16: db 59, api 141, p95 73.3 ms, 3 min 16 s |
| `python3 scripts/fetch_models.py && python3 scripts/fetch_data.py` | rc 0 |
| vision: ruff, format, mypy, pytest | 2,532 passed, 97.42% coverage, 9 min 4 s |
| Android gate | BUILD SUCCESSFUL in 1 min 17 s; SDK host tests 1,264, demo 18, none skipped |
| e2e: mocked flow | 69 passed, 19.1 s |
| e2e: full stack `--shard=1/2` | 43 passed, 4.0 min |
| e2e: full stack `--shard=2/2` | 43 passed, 6.5 min |
| `docker build -f infra/docker/apps.Dockerfile .` | rc 0 (`data/variant-groups.json: OK`); the image holds the report data files and not the rigour file |
| `docker build services/vision` | rc 0 |
| `infra/tests/*.test.sh` | apps-image-context 24, check-connected-results 11, ci-workflow 182, compose 431 (live, the C73.8 probe included), install-gitleaks 9, pre-commit-hook 11, vision-container 55 (live); all passed |
| `gitleaks git --redact .` | no leaks found |
| `openapi:write` then `git diff --exit-code docs/api/openapi.json` | rc 0: no route schema changed in Stages 2-4 |
