# Full-stack end-to-end tests

The specs in `tests/` drive the real API, worker, vision service, hosted flow and dashboard in Chromium. The stack is private to the run: the compose project `openverify-e2e` (Postgres, Valkey, RustFS, Mailpit, with random secrets in the gitignored `e2e/.env.e2e`), the migrations and `seed:dev`, the builds, and the services as local processes logging to `e2e/.artifacts/logs/`. It never touches the developer's `openverify` project or its volumes. The mocked flow suite (`apps/flow/e2e`, `pnpm --filter @openverify/flow e2e`) is separate and needs no stack.

Once per machine: `pnpm --filter @openverify/e2e exec playwright install chromium`. The stack also needs Docker, `uv` and `python3`; it fetches the pinned models, data files and faces itself.

## One run, one stack

```bash
pnpm turbo run build --filter=@openverify/e2e^...                  # the workspace packages the specs import
pnpm --filter @openverify/e2e exec playwright test                   # everything: starts and stops its own stack
pnpm --filter @openverify/e2e exec playwright test tests/handoff.spec.ts   # one spec, still its own stack
```

`pnpm e2e` from the repository root runs the mocked flow suite, then this suite, as CI does. A full run takes longer than one 10-minute call, so locally use the reusable stack.

## The reusable stack (plan C111.2)

Start the stack once, run the suite in shards against it, then stop it:

```bash
pnpm turbo run build --filter=@openverify/e2e^...
pnpm --filter @openverify/e2e e2e:stack:up      # returns once the stack is ready (about 1 to 8 minutes)
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium --shard=1/4
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium --shard=2/4
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium --shard=3/4
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium --shard=4/4
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=console-sweep --no-deps
pnpm --filter @openverify/e2e e2e:stack:down
```

- **The console sweep** (Workflow 9C). `a11y-console.spec.ts` (axe once per console page) and `ui-csp.spec.ts` (the real-header CSP on every page) form the Playwright project `console-sweep`, which depends on `chromium`: `pnpm e2e` and a plain `playwright test` run it after every other spec. Locally it is its own call after the four shards, with `--no-deps` so the shards are not run again. Its pages come from the console build's route manifest; a page with a dynamic segment opens the first URL the console links to, so the sweep needs the objects the shards made, and it makes the few no spec makes (an SLA policy, an assignment policy, a bulk case action). A dynamic page no link reaches fails its test. Run on a fresh stack before the shards, it fails on those pages.

- **Shards.** Four of the `chromium` project, so each stays under 8 minutes on a developer machine, then the console sweep. Workflow 11B's measurement (`integration-11b`, on one fresh stack, load 1.4 to 2.7): 198 tests in shards of 50, 52, 47 and 49, in 278, 349, 278 and 405 s, plus 89 s for the stack start, 304 s for the sweep's 109 tests and 44 s for the three classes of `:openverify-sdk:stackTest`; the mocked flow suite 349 tests in 1.9 minutes. 11B's five specs (`session-idle`, `sso-oidc`, `account-export`, `quota-flood`, `hardening-11b`, each with a 90 s budget, about 20 s together) send no OTP; `sso-oidc` starts the API's in-process test identity provider on loopback and `quota-flood` restores the sandbox's `report-run` cap it lowers. (Workflow 11A's, `integration-11a`: 193 tests in shards of 49, 48, 49 and 47.) Workflow 10D's measurement (`validation-10d`, on one fresh stack, load 1.7 to 4.4 during the shards and the sweep, 8.7 when the stack started): 192 tests in shards of 48, 48, 49 and 47, in 263, 332, 284 and 376 s, plus 84 s for the stack start, 284 s for the sweep's 104 tests and 154 s for the two classes of `:openverify-sdk:stackTest` on the same stack (their compilation after a clean build included); the mocked flow suite 332 tests in 1.8 minutes, the web NFC screen's four among them. The stack, the shards and the sweep took 27.1 minutes, so no shard is rebalanced. Shard 1 holds the three Phase 10 specs: `flow-android.spec.ts` (two tests), `device-integrity.spec.ts` (two) and `flow-nfc-android.spec.ts` (three). (Workflow 10B's measurement, `integration-10b`'s validation, on one fresh stack, load 1.0 to 10.3: 189 tests in shards of 51, 45, 46 and 47, in 260, 327, 296 and 361 s, plus 106 s for the stack start, 305 s for the sweep's 104 tests and 35 s for `stackTest`'s one class; the mocked flow suite 328 tests in 2.0 minutes; no OTP send added.) The 10B spec `device-integrity.spec.ts` (two tests, about 20 s, in shard 1 beside `flow-android.spec.ts`) needs the stack's sandbox `deviceIntegrity` binding (`src/env.ts`), which is also why every v2 flow's consent here shows `notice.play-integrity` (`consentStep()` in `tests/support/flow-v2.ts`; publish refuses it otherwise, C211.9). (Workflow 9D's measurement, `fix-api`, on one fresh stack, load 1.9 to 3.0: 183 tests in shards of 47, 46, 46 and 44, in 229, 293, 271 and 370 s, plus 97 s for the stack start and 294 s for the sweep's 104 tests (98 console pages under axe, `/error-probe` among them as the error page it is on purpose, and the real-header CSP spec's 6 tests); the mocked flow suite 328 tests in 1.8 minutes (Chromium plus Firefox's theme CSP tests, the CI matrix of the 9D Stage 1 amendments included); no OTP send added.) The `chromium` shards hold the console's own accessibility specs of the 9D audit (`ui-a11y-focus`, `ui-a11y-analytics`, `ui-a11y-preview`, `ui-a11y-builder`), the "Other lists" check of `ui-cases-reports` (K19, on the sandbox entity `SBX-2003`) and the dark embedding of `flow-embed` (`style-variant` in the embed page's fragment). The paged graph result table brought the sweep's `/graph/[id]` from about 140 s to 11 s. In CI, `pnpm e2e` runs both projects in one call under a `globalTimeout` of 60 minutes (about 38 projected, at 9A's ratio of 1.45). (Workflow 9C's Stage 2 pass at `integration-9c`: 175 tests in shards of 47, 42, 45 and 41, in 3.8, 4.4, 4.4 and 5.8 minutes, plus 1.5 for the stack start and 6.8 for the sweep's 102 tests, at a load of 1.0 to 3.7; the mocked flow suite 168 tests in 58 s, Chromium plus Firefox's five theme CSP tests where Firefox starts; no OTP send added) (Workflow 9B's Stage 4 pass at `integration-9b`: 154 tests in shards of 53, 51 and 50, in 4.6, 6.4 and 5.9 minutes plus 1.7 for the stack start at a load of 2.1 to 4.6, no OTP send added; the mocked flow suite 163 tests in 69 s; the 9B specs `theme-sets`, `analytics`, `exports`, `bulk-reports`, `environment-roles`, `api-key-rotation` and `webhook-failure-alert` add 8 tests, the alert's up to about 60 s for the sweep, and `flow-branching` now replays its four inquiries through simulate) (Workflow 9A's Stage 4 pass: 146 tests in shards of 49, 52 and 45, in 4.2, 5.7 and 4.6 minutes at a load of 1.2 to 3.8, and 10 OTP sends, one from its own address; see `docs/tdd/phase9-integration-9a.tdd.md` for their times) (the Workflow 8D review's measurement with Workflow 8D's `ui-*` specs, 137 tests in 66 files in shards of 46, 46 and 45, in 4.2, 5.3 and 4.6 minutes plus 1.3 for the stack start at a load of about 1 to 3, is in `docs/tdd/phase8-8d-review-fixes-api.tdd.md`). Playwright splits the specs by file in order, so a shard's time depends on which specs fall in it. Workflow 10A (`carry-10a`, KP10-1) adds two tests to `ui-a11y-focus.spec.ts` (185 `chromium` tests): its toast pass again with every animation frame late, as on a loaded CI runner, and the 2.4.11 check's own control; the check (`coveredFocus` in `tests/support/ui-a11y.ts`) judges the settled page, two animation frames after the key press and then at each frame for up to 1 s, so the spec file takes about 65 s instead of 25 (integration-10a measures the shards). In CI the e2e job uploads `e2e/.artifacts/` with `include-hidden-files: true`, so a failed test's trace, the report and the service logs are in the `e2e-artifacts` artifact.
- **A used stack holds one clean pass.** `otp-ip-hour` allows 10 OTP sends an hour per environment and address, and every spec comes from `127.0.0.1`. The full pass of the Workflow 8D review (at `c2260b50`) sent 9, as the Workflow 8C review's did (`POST /api/v1/flow/verifications/:id/otp` in `e2e/.artifacts/logs/api.log`); Workflow 8A's and 8B's specs send none (`case-review-recipe.spec.ts` completes its inquiries through simulate actions). So a shard repeated on a used stack can fail with a 429 or a mail that never arrives: repeat it on a fresh stack. A spec that adds an OTP send presents an address of its own (`presentAddress`, or `withForwardedFor` outside a browser); never raise the limit for a test. A stack down is never queued behind another agent's stack up: take down only the stack you started, the holder `e2e/.artifacts/stack.json` names.
- **One spec** against the running stack: `OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/signals.spec.ts`.
- **The 9B specs** (C178.4) in one call, about 30 s to 75 s on a stack (the webhook alert waits for the 60-second sweep): `OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/theme-sets.spec.ts tests/analytics.spec.ts tests/exports.spec.ts tests/bulk-reports.spec.ts tests/environment-roles.spec.ts tests/api-key-rotation.spec.ts tests/webhook-failure-alert.spec.ts tests/flow-branching.spec.ts`. Their shared helpers are in `tests/support/platform-9b.ts`.
- **How it works.** `e2e:stack:up` starts a detached holder process that runs the same `startStack()` as the global setup, writes `e2e/.artifacts/stack.json` (mode 0600: it holds the run's seeded credentials, like `.env.e2e`) once the stack is ready, and stops everything on SIGTERM; its own log is `e2e/.artifacts/stack-holder.log`. With `OPENVERIFY_E2E_REUSE_STACK=1`, the global setup reads that record instead of starting a stack, and stops nothing. `e2e:stack:down` signals the holder and waits; with no live holder it removes the compose project of a stack whose holder died.
- **Code changes.** The stack runs the API and worker from the sources and serves the flow and dashboard builds made at its start: after changing `apps/`, restart it (`e2e:stack:down`, then `e2e:stack:up`). After changing a package the specs import (`@openverify/node`, `@openverify/contracts`), run the `turbo run build` line again.
- **Never mix the two modes:** a run without `OPENVERIFY_E2E_REUSE_STACK` takes the `openverify-e2e` project down first, under a stack that a holder still serves.
- **Agents** run every step under `flock /tmp/openverify-e2e.lock`, one step per hold.

## The images mode (plan C257.3, Workflow 11C)

With `OPENVERIFY_E2E_IMAGES=1`, the stack runs the five production images in place of the host processes: `openverify/api` (the migrations, the compiled `seed:dev`, the API and the worker), `openverify/vision`, `openverify/flow` (with face guidance), `openverify/dashboard` and `openverify/code-runner`, all at the local tag `11c-local`, through `e2e/setup/docker-compose.images.yml` on top of `infra/docker-compose.yml`'s `app` profile, in the same compose project `openverify-e2e`. Each container joins the host's network and reads this run's `e2e/.env.e2e`, so a spec sees the same URLs as in the host mode; only the embed client is built on the host. The per-push e2e stays on host processes (review F03): this mode runs at Workflow 11C's checkpoints and before a release.

```bash
# the images first, one build per call (from the repository root; images-11c's handoff):
docker build -f infra/docker/api.Dockerfile -t openverify/api:11c-local .
docker build -f infra/docker/dashboard.Dockerfile -t openverify/dashboard:11c-local .
docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .
docker build --build-context repo=. -t openverify/vision:11c-local services/vision
docker build -f infra/docker/code-runner.Dockerfile -t openverify/code-runner:11c-local .
# then the stack and the specs, as above:
pnpm turbo run build --filter=@openverify/e2e^...
OPENVERIFY_E2E_IMAGES=1 pnpm --filter @openverify/e2e e2e:stack:up
OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/connect.spec.ts
pnpm --filter @openverify/e2e e2e:stack:down
```

- A missing image fails the start at once, naming the command that builds it; nothing is built here.
- `e2e:stack:down` reads the mode from `e2e/.env.e2e`, so the app containers go down with the project. On stop, each container's log is written to `e2e/.artifacts/logs/<service>.log`.
- After changing `apps/`, `services/vision` or a Dockerfile, rebuild the image before the next stack.
- The images' bundles are built without a fixed API origin: the flow reads it from its `/config.json` (`OPENVERIFY_FLOW_API_URL`, C257.1), and the console is built with HSTS off.

### DAST on the images mode (C283, Workflow 11F)

ZAP scans this mode's stack with `security/zap/run.sh`, one subcommand per call, each under `flock -E 75 -w 240 /tmp/openverify-e2e.lock` with the stack up: `prepare`; `api <group>` once for each group of `security/zap/api-groups.tsv` except the flow group; `flow hosted noguidance`; `flow routes`; `console`; `report`; then `revoke`, which refuses every credential the run made and deletes ZAP's raw reports. The whole run takes about two hours (Workflow 11F Stage 1 amendments, items 3 and 13). ZAP runs with `--network host` and `-silent` on the same Docker engine as the stack. The report is written to `docs/security/dast-<date>.md`, and each dated report needs its own row in `docs/security/README.md`. Saving the logs of a stack held that long no longer stops `e2e:stack:down` before its `compose down`: since Workflow 11F each container's log is streamed to its file (`e2e/src/processes.ts`'s `outputFile`).

## The mocked flow suite's extra runs (Workflow 9D)

- **The full accessibility cross product** (C171.2, the 9D Stage 1 amendments): `OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1` (exactly `1`) turns `apps/flow/e2e/step-matrix.spec.ts` into every state in every configuration, 3,276 axe runs. Run it one shard per call under the e2e lock: `OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1 flock -E 75 -w 240 /tmp/openverify-e2e.lock pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts --project=chromium e2e/step-matrix.spec.ts --shard=<i>/4` for `i` from 1 to 4 (about 4 to 6 minutes each). CI never sets it.
- **WebKit without host libraries** (K9-35): the theme CSP spec runs against a Playwright browser server in Docker; the recipe is in [`apps/flow/e2e/README.md`](../apps/flow/e2e/README.md).

## Network addresses in the specs (Workflow 7A)

The stack's API trusts its loopback proxy (`OPENVERIFY_TRUST_PROXY=127.0.0.1`). A spec that needs a session from a [sandbox address](../docs/checks/sandbox-providers.md#sandbox-addresses) gives its browser context `presentAddress(context, apiUrl, address)` (`tests/support/network.ts`), which adds a standard `X-Forwarded-For` to the context's API requests with `page.route`, below CORS. Only the documentation ranges are accepted (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`). Requests without it keep the socket peer, `127.0.0.1`. The network data is the synthetic sandbox bundle `seed:dev` imports; nothing calls a publisher, and the stack never refreshes network data.

## Workflow specs (Workflow 8A)

- **A user publishes.** `adminClient(stack)` (`tests/support/workflows.ts`) signs the seeded admin in once, because publish answers an API key 403. `runningWorkflow` creates, drafts, publishes and activates. A sign-in counts against the login limits, so a spec signs in once.
- **HTTPS.** Make HTTPS Request reaches `https:` alone. `startWebhookReceiver({ tls })` serves the stack's throwaway certificate, `RECEIVER_TLS` in `src/paths.ts`, which `e2e:stack:up` writes with `openssl` and the worker trusts through `NODE_EXTRA_CA_CERTS`. The stack sets `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK`, a sandbox environment may call `localhost`, and a spec adds its receiver's port to `workflow-http-ports`, which one spec holds at a time.
- **Slack** goes to the sandbox list (`OPENVERIFY_PROVIDER_SLACK_SANDBOX=sandbox`), read by `client.sandboxSlackMessages.search(secretId)`.
- **Evaluate Code** runs in the worker's pool on this stack. The `code-runner` container is proved by `infra/tests/code-runner.test.sh`.

## Case specs (Workflow 8B)

- **Templates of their own.** `publishedCaseTemplate(admin, name)` (`tests/support/cases.ts`) creates and publishes a case template with a random key, so no two specs share one.
- **The review recipe** (`case-review-recipe.spec.ts`) installs "Review on report match" as `seed:dev` does, narrows its trigger to its own inquiry (the recipe listens to every completion report of the environment), names its case template, fills the decline's basis and contest route, and pauses the workflow at the end. A reviewer (the seeded `reviewer` operator) resolves the case through the API.
- **The SLA spec** waits for the `case-sla` sweep, every 30 seconds, and one more period to show the event fires once: about 70 seconds. Its webhook filters on its own case template.
- **Attachments** are scanned by the sandbox scanner, which the stack binds for the API and the worker alike (`OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX=sandbox`). `withGpsExif` adds an EXIF segment with a GPS IFD to a synthetic JPEG, and `jpegMarkers` reads a rendition's segments.

## Flow specs (Workflow 9A)

- **The flow server.** The stack serves its flow build with `apps/flow/server.ts` (as the compose `app` profile does, C157.3), with a flow-server token the API shares, so each entry's headers are computed per request: hosted `frame-ancestors 'none'`, the preview framed by the console (`dashboardUrl`) only, an embed by the inquiry's allowed origins.
- **The embed page.** The stack builds `@openverify/js` into `e2e/.artifacts/embed-client` and serves `e2e/fixtures/embed-page/` with it from a loopback port of its own, `embedPageUrl` (`http://127.0.0.1:<port>`) in the stack info. The same server answers on `http://localhost:<port>`, an origin no spec allows, for the refusal. `flow-embed.spec.ts` puts `embedPageUrl` in the sandbox's `allowed-embed-origins` and restores the setting after.
- **Flow-spec 2 versions.** `publishV2` (`tests/support/flow-v2.ts`) creates a template with the default v1 flow (template creation takes v1 only in 9A), drafts the v2 flow, validates it in publish mode and has the seeded admin publish it with every acknowledgement `validate` asked for (only a person gives one). `v2Flow` drives the flow API as a spec-2 client (`OpenVerify-Flow-Spec: 1, 2`), and `stepRecord` reads the step record from Postgres (no route serves it).
- **The specs:** `flow-branching.spec.ts` (an `age-years` route to a screen, an exhausted ID falling back to a document and review, a provisional bot score flagging for review and its `null` following `onNull`), `flow-run-workflow.spec.ts` (a `run_workflow` step whose run's output picks the route), `flow-embed.spec.ts` (embedding allowed and refused; the preview frame and its headers), `flow-arabic.spec.ts` (right to left, an Arabic-Indic code typed; it presents `198.51.100.77` for its OTP send) and `flow-translations.spec.ts` (a CSV round trip). Each test's budget is 90 s. Simulate answers 501 at the end of 9A, so the replay of these inquiries through it is carried with simulate.

## Writing a spec

- Read the stack with `readStackInfo()` (`src/stack-info.ts`); create your own templates and inquiries with a random reference, as the specs share one stack.
- State the spec's budget in its header (90 seconds for each Workflow 7A and 7B spec) and set `test.setTimeout` to it.
- Every value is synthetic: fictional people, `example.com` and `.test` addresses, documentation IP ranges and ASNs.
