# Phase 9, Workflow 9A Stage 1a: contracts-9a

**Rerun on 2026-11-04 after the owner's decision (option (i)); see "Rerun" at the end.** The first run's record follows unchanged, except its checkpoint lines.

Base `e56e4e9c` (the Phase 9 base; its code equals `f0a32761`). `docs/PROGRESS.md` records Phase 8 done (`## 2026-11-04: Phase 8 done`, line 20), and `date -u` read `Wed Nov 4 09:14:25 UTC 2026`, past the release-age gate of 2026-11-03T02:25Z. So both preconditions held.

## Outcome: stopped at Stage 1a (PROJECTION RULES WRONG)

C151.6's v1 projection, served exactly as the plan writes it, does not keep today's Android SDK out of a `Finalizing` loop when a verification step is exhausted while the person is on it. The plan says that a red projection test means the projection rules are wrong and stops the Workflow, so nothing of C147-C179 was built or committed:
- no release-age setting;
- no id, scope or problem;
- no schema or fixture;
- no Android file.

What is committed:
- the inventory (`docs/research/phase9-inventory.md`);
- the "Workflow 9A Stage 1a amendments (contracts-9a)" section of `docs/plans/phase-9.plan.md`, whose amendment 1 states the failure and the options;
- this record.

The first run's checkpoint record, reworded on the rerun so that no waiting agent reads it as current (each line said NOT BUILT): common, (S), (T), (F) and (H) were all not built, because the C151.6 host test failed on today's SDK in case (c) (an exhausted government ID: Processing, Finalizing, Error STILL_PROCESSING), and the plan forbids weakening the test or changing production Kotlin. The rerun's checkpoints are recorded in "Rerun" below.

## The projection host test (C151.6, V02, V03): RED on the unchanged SDK

### How it was run

I ran the test early, before any other deliverable, because a red result decides whether Workflow 9A runs at all. It was written as the file the plan names, `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/flow/FlowCoordinatorProjectionTest.kt`, over the existing `FakeFlowApi`.

- **The server model.** The test wraps the fake with `FlowApi by api` and, on every session read, serves the projection C151.6 gives for the fake server's state.
- **What it changes:** no production Kotlin. `git status --short android` showed only the new test file, and `FlowCoordinator.kt` keeps sha256 `f93a62c0a8cffe9b2c6b9b4243eb8d13cd7befa0f464d8bc0fb4ea33b7d94040`, last changed in `b14e4193`.
- **Afterwards:** the file was removed again, because a red file must not be committed. Its source follows, so it can be restored as is.

### Command and result

```
$ source scripts/env.sh
$ cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorProjectionTest'
FlowCoordinatorProjectionTest > C151_6 as planned - exhausted government ID moves to the document step without Finalizing() FAILED
4 tests completed, 1 failed
> Task :openverify-sdk:testAndroidHostTest FAILED
BUILD FAILED in 22s
```

The report (`TEST-dev.openverify.sdk.flow.FlowCoordinatorProjectionTest.xml`, 2026-11-04T09:22:43Z, load `0.04 0.32 0.59`):

- `a linear flow completes only at the server's completion()`: passed (case a).
- `a branch to a v2-only step stops on the unsupported screen()`: passed (case b).
- `C151_6 as planned - exhausted government ID moves to the document step without Finalizing()`: **failed** (case c). The states recorded:

  ```
  Loading
  Consent(step=ConsentStep(id=consent, ...), submitting=false, retentionDays=365)
  Consent(step=ConsentStep(id=consent, ...), submitting=true, retentionDays=365)
  Capture(step=GovernmentIdStep(id=id_card, sides=FRONT, ..., maxAttempts=1, captureMethods=[CAMERA]), kind=FRONT, index=0, count=1, ...)
  Capture(step=GovernmentIdStep(id=id_card, ...), image=CapturedImage(image/jpeg, 3 bytes), ...)
  Processing(step=GovernmentIdStep(id=id_card, ...))
  Finalizing(step=GovernmentIdStep(id=id_card, ...))
  Error(error=STILL_PROCESSING, canRetry=true) ==> expected: <true> but was: <false>
  ```

  After the government ID's last failed attempt, the projection served was `[consent, proof (document), done]`, with the exhausted step left out as V02 says. The SDK still finalised.
- `candidate amendment - a step with an exhausted edge is a placeholder to spec 1()`: passed. With the step served as a `server-continuation` placeholder, the SDK stops on `Unsupported` after consent and creates no verification.

### Why it fails

After every processed attempt, `FlowCoordinator.process` re-reads the session (`FlowCoordinator.kt:1150`). The caller then calls `continueFrom(work.step)` (`:206-207` and the other sites listed in the inventory, section 1), which resolves from the step object it worked on (`:557-588`). That object is a `GovernmentIdStep` with its attempts used up, so `verificationState` answers `Resolution.Finalize` (`:668`), and `finalize` polls and ends on `STILL_PROCESSING` (`:1210-1220`). Leaving the step out of the new list cannot change this, because the SDK never looks it up in the list. So no rule for the `flow` member alone can satisfy C151.6's assertion for an exhaustion that happens on the step. Plan amendment 1 gives the options and proposes (i): a verification step with an `exhausted` edge has no v1 form.

### The test source (to restore once the owner rules)

```kotlin
package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/** EXPERIMENT (uncommitted): C151.6's projections against today's coordinator. */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorProjectionTest {

    private fun flow(vararg steps: String) = OpenVerifyJson.decodeFromString<Flow>(
        """{"metadata":{"specVersion":1,"id":"projection","version":1,"name":"Projection"},"steps":[${steps.joinToString(",")}],"transitions":[]}""",
    )

    private val consent = """{"id":"consent","type":"consent","textKeys":["consent.biometric"],"required":true}"""
    private val gid = """{"id":"id_card","type":"government_id","sides":"front","maxAttempts":1,"captureMethods":["camera"]}"""
    private val selfie = """{"id":"face","type":"selfie","poses":["center"],"liveness":"passive","maxAttempts":1}"""
    private val document = """{"id":"proof","type":"document","documentTypes":["utility_bill"],"captureMethods":["upload"]}"""
    private val done = """{"id":"done","type":"completion"}"""
    private fun continuation(n: Int) = """{"id":"continue-$n","type":"server-continuation"}"""

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")

    private fun TestScope.record(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    /** The fake server, serving the projection [at] gives for its state on every session read. */
    private fun projecting(api: FakeFlowApi, at: (FakeFlowApi) -> Flow) = object : FlowApi by api {
        override suspend fun getSession(): FlowSession {
            api.flow = at(api)
            return api.getSession()
        }
    }

    private fun FakeFlowApi.latest(type: VerificationType) =
        verifications.lastOrNull { it.verificationType == type }?.attributes?.status

    @Test
    fun `a linear flow completes only at the server's completion`() = runTest {
        val api = FakeFlowApi()
        val server = projecting(api) {
            when {
                it.latest(VerificationType.SELFIE) == VerificationStatus.PASSED -> flow(consent, gid, selfie, done)
                it.latest(VerificationType.GOVERNMENT_ID) == VerificationStatus.PASSED -> flow(consent, gid, selfie, done)
                else -> flow(consent, gid, selfie, done)
            }
        }
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings).also { it.cameraReady() }
        val states = record(coordinator)
        coordinator.start()
        coordinator.acceptConsent()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        coordinator.capture(photo)
        coordinator.confirmCapture()
        val completed = states.indexOfFirst { it is FlowState.Completed }
        assertTrue(completed > states.indexOfFirst { it is FlowState.Processing && it.step.type == "selfie" }, states.joinToString("\n"))
    }

    @Test
    fun `a branch to a v2-only step stops on the unsupported screen`() = runTest {
        val api = FakeFlowApi()
        val server = projecting(api) {
            if (it.latest(VerificationType.GOVERNMENT_ID) == VerificationStatus.PASSED) {
                flow(consent, gid, continuation(1))
            } else {
                flow(consent, gid, continuation(1))
            }
        }
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings).also { it.cameraReady() }
        val states = record(coordinator)
        coordinator.start()
        coordinator.acceptConsent()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()
        assertTrue(states.none { it is FlowState.Completed || it is FlowState.Finalizing }, states.joinToString("\n"))
        assertTrue(coordinator.state.value is FlowState.Unsupported, states.joinToString("\n"))
    }

    @Test
    fun `C151_6 as planned - exhausted government ID moves to the document step without Finalizing`() = runTest {
        val api = FakeFlowApi()
        val server = projecting(api) {
            if (it.latest(VerificationType.GOVERNMENT_ID) == VerificationStatus.FAILED) flow(consent, document, done) else flow(consent, gid, done)
        }
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings).also { it.cameraReady() }
        val states = record(coordinator)
        coordinator.start()
        coordinator.acceptConsent()
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()
        assertTrue(states.none { it is FlowState.Finalizing }, states.joinToString("\n"))
    }

    @Test
    fun `candidate amendment - a step with an exhausted edge is a placeholder to spec 1`() = runTest {
        val api = FakeFlowApi()
        val server = projecting(api) { flow(consent, continuation(1)) }
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings).also { it.cameraReady() }
        val states = record(coordinator)
        coordinator.start()
        coordinator.acceptConsent()
        assertTrue(states.none { it is FlowState.Completed || it is FlowState.Finalizing }, states.joinToString("\n"))
        assertTrue(coordinator.state.value is FlowState.Unsupported, states.joinToString("\n"))
        assertEquals(0, api.calls.count { it.startsWith("createVerification") })
    }
}
```

Once a rule is chosen, the committed form reads the successive projections from hand-written fixtures under `contracts/fixtures/api/`, as C151.6 asks, rather than from inline JSON. Case (c)'s assertion stays as C151.6 states it: no `Finalizing` and no `Completed` before the completion step. Under rule (i), case (c) instead stops on `Unsupported` at the government ID's position.

## Inventory

`docs/research/phase9-inventory.md`: read-only commands (`grep`, `sed`, `git diff --stat f0a32761 e56e4e9c`, `pnpm view eslint-plugin-jsx-a11y@latest`), each fact with its `path:line`.

## Rerun (2026-11-04, after the owner's decision on amendment 1)

Base `1fc4f384` (the owner's decision). Only `docs/plans/phase-9.plan.md` changed since `a8f0baac` (`git diff --stat a8f0baac HEAD`: 6 insertions, the decision section), so the inventory and amendments 1-14 stand. `docs/PROGRESS.md` records Phase 8 done (line 20). `date -u`: `Wed Nov  4 13:05:57 UTC 2026`, past 2026-11-03T02:25Z.

### Release age (decision 62), first

**npm.** RED `e9bca8cf`: `packages/config/src/workspace-conventions.test.ts` reads `pnpm-workspace.yaml` (asserting `/^minimumReleaseAge: 20160$/m`, no `minimumReleaseAgeExclude`, no `minimumReleaseAgeStrict: false`, no `trustLockfile: true`); `turbo.json` adds `$TURBO_ROOT$/pnpm-workspace.yaml` to `@openverify/config#test`'s inputs.

```
$ pnpm --filter @openverify/config exec vitest run src/workspace-conventions.test.ts --coverage.enabled=false -t "release age"
     × holds every dependency to a 14-day release age, with no way around it
AssertionError: expected 'packages:\n  - apps/*\n  - packages/*…' to match /^minimumReleaseAge: 20160$/m
      Tests  1 failed | 51 skipped (52)
```

GREEN `cae84f5b`: `minimumReleaseAge: 20160` with its comment. `Tests 52 passed (52)`; `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` exit 0 ("Lockfile passes supply-chain policies"), no pin moved.

**uv.** RED `7e262152`: `services/vision/tests/test_dependencies.py::test_uv_holds_every_resolution_to_a_relative_14_day_release_age` (tool.uv.exclude-newer == "14 days", no exclude-newer-package; uv.lock `[options]` exclude-newer-span == "P14D", exclude-newer absent or `0001-01-01T00:00:00Z`).

```
$ uv run pytest tests/test_dependencies.py -q
E       KeyError: 'uv'
FAILED tests/test_dependencies.py::test_uv_holds_every_resolution_to_a_relative_14_day_release_age
1 failed, 9 passed
```

GREEN `e217a6b2`: `[tool.uv] exclude-newer = "14 days"`, then `uv lock` (uv 0.13.3, no flag): "Resolving despite existing lockfile due to addition of global exclude newer 2026-10-21T13:07:40Z; Resolved 61 packages". `git diff uv.lock` is the `[options]` table alone:

```
+[options]
+exclude-newer = "0001-01-01T00:00:00Z" # This has no effect and is included for backwards compatibility when using relative exclude-newer values.
+exclude-newer-span = "P14D"
```

`uv lock --check` exit 0; `uv sync --locked` exit 0; `uv run pytest tests/test_dependencies.py` 10 passed.

**Records** `4ae4166d`: `THIRD_PARTY_LICENSES.md`'s new "Version age" paragraph (decision 62's dated record, pnpm and uv). CLAUDE.md's "Dependency versions" bullet was **not** edited: this session's harness says no agent message can authorise changing CLAUDE.md, so the exact wording is a contract deviation for the owner.

### Common

- **Axe for apps/flow.** RED `40444386`: `e2e/src/axe.test.ts` expects the importers `['apps/flow', 'e2e']`: `AssertionError: expected [ 'e2e' ] to deeply equal [ 'apps/flow', 'e2e' ]`. GREEN `9ab3998b`: `pnpm --filter @openverify/flow add -D '@axe-core/playwright@catalog:'` (lockfile: three lines, `4.14.0(playwright-core@1.64.1)` under the flow importer, no new package); both section 5 rows and the catalog comment name apps/flow; the guard passes (5 of 5); frozen install exit 0.
- **Ids, scopes, problems.** Stub `22f8ae62` (empty problem tables, so the RED typechecks). RED `f7d33ab2`: contracts 30 failed (empty tables, missing fixtures, `theset`/`dply`/`tsa`/`ssp` absent), core 4 failed (the scope order, developer, the two C167.1 refusal tests), db 1 failed, dashboard 1 failed. GREEN `4ca69ac0`: prefixes in both tables; `theme-sets:read`, `theme-sets:write`, `deployments:read` (developer all three; viewer the two reads through `VIEWER_PERMISSIONS`; reviewer none); `PERMISSION_INFO` labels in the templates area; `FLOW_ENGINE_PROBLEM_STATUSES`, `TEMPLATE_PROBLEM_STATUSES`, `FLOW_DEFINITION_PROBLEM_CODES` with 18 golden problems generated by a script. Contracts' exact scope list (`vocabulary.test.ts`) gains the three (the plan changes the behaviour it checks).
- **ADR 0008** `87859376`. **OpenAPI** `f20fb0a3` (`openapi:write` twice; the second changed nothing).

Gates at the checkpoint (load `1.04`, then `6.22`, `5.19`):
- `pnpm turbo run typecheck --force`: 16 of 16, exit 0;
- `pnpm turbo run test --force` for contracts (3,729 tests, 99.31%), core (1,392, 99.83%), db (1,998, 92.56%), config (235), e2e (118), dashboard (5,581, 96.39%): exit 0;
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=2` for the same six: exit 0;
- `apps/api` `vitest run src/openapi.test.ts src/routes/server/api-keys.test.ts`: 65 passed.

CHECKPOINT common DONE at f20fb0a30d0edf89b42c5d0cc8770556f0bf404a

Handoff (common): ids `themeSet: 'theset'`, `deployment: 'dply'`, `themeAsset: 'tsa'`, `simulationPreset: 'ssp'` in `ID_PREFIXES` of `packages/contracts/src/ids.ts` and `packages/db/src/ids.ts` (`idPattern('theset')` etc. for CHECKs). Scopes `theme-sets:read`, `theme-sets:write`, `deployments:read` (`packages/core/src/permissions.ts`). Problems in `packages/contracts/src/problem.ts`: `FLOW_ENGINE_PROBLEM_STATUSES` (+ `FlowEngineProblemCode`, `FLOW_ENGINE_PROBLEM_CODES`, `flowEngineProblemCodeSchema`), `TEMPLATE_PROBLEM_STATUSES` (+ `TemplateProblemCode`, `TEMPLATE_PROBLEM_CODES`, `templateProblemCodeSchema`), `FLOW_DEFINITION_PROBLEM_CODES`; fixtures `contracts/fixtures/problems/{flow-engine,templates}/<code-with-dashes>.json`. `@axe-core/playwright` is a dev dependency of `apps/flow`. ADR: `docs/adr/0008-flows-server-decided-branching-embedding-and-preview-origins.md`.

### (S): the spec, the Phase 8 side, signals, and the projection proof

**The projection host test first** (the gate of the whole Workflow). Restored from the record above, with case (c) asserting the owner's option (i), and reading the hand-written golden projections of `contracts/fixtures/api/flow-projections/` instead of inline JSON. It is committed green with no production Kotlin change (`1f71c210`):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorProjectionTest'
BUILD SUCCESSFUL in 29s
TEST-dev.openverify.sdk.flow.FlowCoordinatorProjectionTest.xml: tests="26" failures="0" errors="0"
FlowCoordinator.kt sha256 f93a62c0a8cffe9b2c6b9b4243eb8d13cd7befa0f464d8bc0fb4ea33b7d94040 (unchanged); git status android: only the new test file
```

A mutation check (not committed): serving `exhausted-1` and `exhausted-2` with the government ID in its v1 form, as C151.6 first read, turned case (c) red, so the test discriminates:

```
FlowCoordinatorProjectionTest > (c) a government ID with an exhausted edge stops on the unsupported screen at its position, creating nothing() FAILED
FlowCoordinatorProjectionTest > (c) a fresh start at the government ID's position stops there too, creating nothing() FAILED
26 tests completed, 2 failed
```

**flow-spec v2.** Placeholders `b66b540e` (every frozen name with an `any` placeholder value, so the RED typechecks). RED `ff3687cf`: `Tests 72 failed (72)` (`TypeError: Cannot read properties of undefined (reading 'safeParse')` x23, `FLOW_V2_STEP_TYPES is not iterable`, ...). GREEN `967711f9`: `Tests 189 passed (189)`, coverage 99.71% statements, lint clean, `schema:export` leaves `schema/flow.schema.json` unchanged. The GREEN commit also changed the RED test file for lint only (non-null assertions to an `at()` helper, callback types).

**The Phase 8 side.** Placeholders `39d6eeae` (`actionServesTrigger` with Phase 8's rule, `INQUIRY_DECISION_ACTOR_TYPES` equal to `DECISION_ACTOR_TYPES`). RED `ea4afeeb`: core 5 failed (nine triggers, the creator, the kinds, the actors, the evidence kinds); contracts' new file failing (no `trigger-flow`, no `inquiry-flow`, no `flow` member); workflow-engine 2 failed; dashboard palette 1 failed; db `migration-0030.test.ts` 4 failed (`expected -1 to be 30`, each CHECK lacking its value). GREEN `ab693064`: core, contracts (3,739), workflow-engine (1,976), db migration tests (144) and the dashboard's workflow tests (498) pass; migration `0030_phase9a` generated with `pnpm --filter @openverify/core build` then `drizzle-kit generate --name phase9a`, prettier on the snapshot and journal; the API's workflow and decision tests 1,037 passed; the Android fixture list gains `api/decision-flow-failure.json` as server-only (ContractFixturesTest passes).

**Signals and checks.** Placeholders `f11b54b8`. RED `071ca161`: core 3 failed (`flowProvisional` absent, `CHECK_ERROR_REASONS` empty, the classing), contracts 1 failed (`not_yet_collected` absent). GREEN `5adcb658`: core, contracts, checks, signals pass; the contracts' exact null-reason lists gain the reason (the plan changes them).

**Lint fixes** `e353ba02` (a comment between two `case` labels; dot notation in two tests). **`migration-0029.test.ts`** `ca4b8131` (0029 is no longer the last migration).

Gates at the checkpoint (load average beside each; another process raised the load to 18 at times):
- `pnpm turbo run typecheck --force`: 16 of 16, exit 0 (load 4.07);
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=2` for flow-spec, core, contracts, checks, workflow-engine, db, e2e: exit 0; dashboard at `--concurrency=1`: exit 0 (load 2.24);
- `pnpm turbo run test --force --filter=!@openverify/api`: every package exit 0 and at least 80% (flow-spec 99.71%, core 99.83%, contracts 99.31%, db 92.57% with 2,003 tests, workflow-engine 98.0%, checks 98.77%, flow 95.48%, dashboard 96.38%, watchlist 98.63%, e2e 97.3%, node 98.53%, signals 96.37%, ui 100%, config 100%, emrtd 94.97%); db's first run failed only on `migration-0029.test.ts`, fixed and re-run alone, and dashboard and watchlist re-run after turbo stopped them (load 1.34 to 10.1);
- the API suite as two blob shards and a merge in `/tmp/claude-1000/apiS`: `Test Files 584 passed (584)`, `Tests 8253 passed (8253)`, merged coverage 94.84% statements, 85.87% branches, exit 0 (load 2.3 to 7.7);
- `pnpm --filter @openverify/db test:integration`: 78 passed, exit 0 (load 5.6);
- `./gradlew --no-daemon testAndroidHostTest` under the Gradle lock: BUILD SUCCESSFUL, SDK host tests **1,360** (1,334 before; the 26 of FlowCoordinatorProjectionTest), 0 failures (load 18.4).

CHECKPOINT (S) DONE at ca4b81316f4216f2fb7da4ab9d83bc369c72b0bc

Handoff ((S)): read `docs/plans/phase-9.plan.md`, "Workflow 9A Stage 1a amendments", items 15 to 26. In short: `@openverify/flow-spec` exports the v2 schemas (`flowV2Schema`, `stepV2Schema`, `componentSchema`, `edgeSchema`, `branchStepSchema`, `actionStepSchema`, `screenStepSchema`, `flowActionSchema`, `flowProjectionSchema`, `clientStepViewSchema`, `FLOW_V2_CAPS`, `FLOW_V2_STEP_TYPES`, `VERIFICATION_STEP_TYPES`, `V2_ONLY_STEP_TYPES`, `SERVER_STEP_TYPES`, `COMPONENT_KINDS`, `FORM_COMPONENT_KINDS`, `FLOW_ACTION_KINDS`, `DEVICE_KINDS`, `ON_FALLBACK_VALUES`, `portSchema`, `onNullSchema`, `scopePathSchema`, `conditionSchema`), `FLOW_SPEC_VERSIONS`, `flowV1Schema`, `parseAnyFlow`, `safeParseAnyFlow`, `isFlowV2`, `toJsonPointer`, the scope descriptions (`FLOW_SCOPE_PATHS`, `FLOW_SCOPE_EXTRACTIONS`, `ScopePathDescription`, `ScopeDescription`, `SCOPE_SOURCES`, `SCOPE_ROOTS`), `COPY_KEYS` and `CopyKeyDefinition` (api-templates fills), `LOCALE_REVIEW_STATUS` (flow-i18n owns), and the stubs for flow-spec-logic (`checkFlowGraph`, `canonicalFlowJson`, `migrateFlow`, `migrateFlowWithNotes`, `nextPosition`, `flowOutcome`, `projection`, `clientViewOf`, `checkVisibilityRule`, `evaluateVisibility`, `fieldReferences`, `normalizeDigits`, `deviceKindOf`, `scopeJsonSchema`, `flowV2JsonSchema`, `compilePattern`, `matchPattern`) and flow-i18n (`pseudoLocalize`). Core: `actionServesTrigger`, `isWorkflowTriggerType`, `LISTED_ONLY_TRIGGER_TYPES`, `INQUIRY_DECISION_ACTOR_TYPES`, `CHECK_ERROR_REASONS`, `checkErrorClassOf`, `SignalDefinition.flowProvisional`. Contracts: `decisionFlowSchema`, the `inquiry-flow` actor and creator, `not_yet_collected`. Migration `0030_phase9a` exists (seven CHECKs): foundation-9a extends it, adds no 0031, and adds `inquiry_decisions.flow`.

### (T): templates, versions, copy, translations, deployments, events

**Order.** I drafted the (T) implementation before its tests, then set it aside to keep the evidence honest: every changed implementation file went to `/tmp/claude-1000/T-impl`, the committed content of each changed implementation file was put back (all mine; no other agent had touched them), and each new module became a name-only placeholder. In that state every package typechecked, and the tests ran RED against the committed implementation:

```
contracts: Tests 55 failed | 591 passed (646)   TypeError: Cannot read properties of undefined (reading 'safeParse') x6; expected 100 to be 1000; expected { …(6) } to deeply equal { …(8) } (settings); ...
node:      Tests 5 failed | 284 passed (289)   (the groups list; deployments and inquiryTemplateTranslations calls)
dashboard: Tests 1 failed | 4 passed (5)       (the "Inquiry templates" and "Deployments" groups)
api:       Tests 9 failed: the three strict template subjects; a v2 flow answers 400 from the schema, not 422 at its pointer; the pinned settings lack the two C151.10 keys
```

Placeholders `17a9baa0`, RED `83503c4f` (with the 16 golden fixtures and the Android list: two decoded, fourteen server-only), GREEN `376cff7f` (the implementation restored from the backup; `openapi:write` ran three times, the third leaving the snapshot's sha256 unchanged, after the OpenAPI registry named `FlowV2` and `FlowComponent`, because the recursive component's `$defs` references did not resolve), then `ba460470` (the e2e helpers typed with `DefaultInquiryTemplateAttributes`, and lint fixes).

Gates at the checkpoint (load beside each):
- `pnpm turbo run typecheck --force`: first 12 of 16 (e2e failed on three helpers that edit the default flow), then e2e fixed and `tsc --noEmit` clean (load 4.8);
- lint, `NODE_OPTIONS=--max-old-space-size=4096 ... --force`: contracts, node, flow-spec, e2e at `--concurrency=2` exit 0; api and dashboard at `--concurrency=1` exit 0 (load 1.9);
- `pnpm turbo run test --force` for contracts (95 files, 99.27%), node (98.54%), flow-spec (99.71%), dashboard (419 files, 96.38%): exit 0 (load 0.95);
- the API suite, two blob shards and a merge in `/tmp/claude-1000/apiT`: `Test Files 586 passed`, `Tests 8261 passed`, 94.84% statements, 85.88% branches, exit 0 (load 1.0 to 6.0);
- Android `ContractFixturesTest`: BUILD SUCCESSFUL.

CHECKPOINT (T) DONE at ba460470b08dcfb03b71f3d4a6d996ece47a8481

Handoff ((T)): amendments 27 to 31. For `foundation-9a` (T): the routes to freeze are C154.4's and C156's with the schemas of `template-routes.ts`, `inquiry-template-translations.ts`, `deployments.ts` and `simulation-presets.ts`; the version columns carry the members of amendment 28 (`InquiryTemplateVersionRecord.phase9`); `deployments` rows build with `buildDeploymentResource`. For `api-templates`: remove `requireFlowV1` and change `inquiry-template-flow-v2.test.ts` when v2 drafts are built; `COPY_KEYS` is yours to fill.

### (F): the flow API, the origin module, embedding settings, messages

Placeholders `5ef81d73` (`origin-pattern.ts`, `flow-embed.ts`, `flow-messages.ts` as name-only modules, and the subpath export `./origin-pattern`), then RED `a754f227`: `phase9a-flow.test.ts`, the golden vectors `contracts/fixtures/origin-pattern/vectors.json`, the session fixtures `flow-session-v1-projection.json` and `flow-session-v2.json` (registered in `fixtures.test.ts` and decoded by the Android `ContractFixturesTest`), and the corrected pointer of `embed-origin-invalid.json` (`/allowed-embed-origins/1`, the flat settings body). Against the placeholders:

```
contracts: Tests 74 failed | 601 passed (675)
  7 AssertionError: expected false to be true
  6 TypeError: Cannot read properties of undefined (reading 'safeParse')
  1 AssertionError: expected undefined to be 1048576
  1 AssertionError: expected undefined to be 'OpenVerify-Flow-Spec'
  1 AssertionError: expected null to deeply equal { …(4) }
  1 AssertionError: expected null to be 'wildcard_too_short'   (and every other refusal code)
```

GREEN `e5166b60`. Before it, with the implementation in place, four failures named what was still wrong, each fixed in that commit:
- `json-schema.test.ts`: "consoleToPreviewMessageSchema converts to JSON Schema" threw `Custom types cannot be represented in JSON Schema` (`z.instanceof(ArrayBuffer)`), now a refinement over `unknown` (amendment 36);
- the contracts defaults test and the API's `routes/dashboard/settings.test.ts` (`expected { …(32) } to deeply equal { …(35) }`) when the three embedding defaults were inside `DASHBOARD_SETTINGS_DEFAULTS`: the API does not serve them until `foundation-9a`, so they moved to `EMBEDDING_SETTINGS_DEFAULTS` (a new test), and neither existing test changed (amendment 35);
- the dashboard's `settings-view.tsx(55,23)`: `RetentionSetting` now excludes `EmbeddingSetting`;
- the flow app's `flow-position.ts` (TS2345 at 151, 154, 320, 324, 338): the session's step may be a `server-continuation` placeholder. The new test "stops at a server-continuation placeholder of a projection instead of skipping it" fails with the case removed (`expected undefined to deeply equal { kind: 'unsupported', …(2) }`, `Tests 1 failed | 82 passed (83)`) and passes with it (83 passed).

Refactor `85f8edcc`: the embed-policy answer's three ids are checked by fixed patterns, so no pattern in the module is built at run time.

Gates at the checkpoint (load beside each):
- contracts `pnpm test` (coverage): 4,008 passed, 99.17% statements, 93.69% branches, exit 0; flow 1,106 passed, 95.48%; dashboard 5,587 passed, 96.38%, exit 0 (load 2.1);
- `pnpm turbo run typecheck --force --concurrency=4`: 16 of 16, exit 0 (load 2.1);
- eslint of contracts, flow and dashboard: exit 0; prettier `--check` of every changed file: exit 0;
- the API suite, two blob shards and a merge of `/tmp/claude-1000/apiF-blobs`: `Test Files 586 passed`, `Tests 8261 passed`, 94.84% statements, 85.88% branches, exit 0 (load 3.0);
- `openapi:write` twice: sha256 `5960dca0…11eb2` both times; no unresolved `$defs` reference;
- Android `:openverify-sdk:testAndroidHostTest --tests '*ContractFixturesTest*' --tests '*FlowCoordinatorProjectionTest*'`: exit 0, 92 and 26 tests, 0 failures.

CHECKPOINT (F) DONE at 85f8edcc860c909132eb3e4a821365ed798f0a4c

Handoff ((F)): amendments 32 to 37. For `foundation-9a` (F): freeze `GET /internal/embed-policies/:inquiry-id` with `embedPolicyParamsSchema` and `embedPolicyAnswerSchema`; serve the embedding settings and merge `EMBEDDING_SETTINGS_DEFAULTS` into `DASHBOARD_SETTINGS_DEFAULTS` (changing the two defaults tests then); `server.ts` imports only `@openverify/contracts/origin-pattern`. For `api-flow-engine`: the screen submission, the selfie extension and the session members of amendment 33; serve the projection, after which `integration-9a` narrows `flowSessionFlowSchema`. For `flow-server-embed`: `flowToParentMessageSchema`, `parentToFlowMessageSchema`, `EMBED_ERROR_CODES`, `matchesOriginPattern`. For `dashboard-preview` and `flow-server-embed` (the preview entry, C156.2): `consoleToPreviewMessageSchema`, `previewToConsoleMessageSchema`, `PREVIEW_ASSETS_MAX_BYTES`.

### (H): theme sets, assets, the theme problems and the contrast gate's signature

I drafted the implementation outside the repository (`/tmp/claude-1000/H-impl`), generated name-only placeholders from it, and committed those first (`ec6583e9`: `theme-sets.ts`, `packages/core/src/contrast/index.ts` with its export line, and three placeholder names in `problem.ts`). RED `d7492226`: `phase9a-themes.test.ts`, `packages/core/src/contrast/contrast.test.ts`, the node endpoints and raw-answer tests, five golden fixtures in `contracts/fixtures/api/` and three in `problems/themes/`, the `themes` folder in `phase9a-problems.test.ts`, the fixture registrations, the resource list, and the Android server-only entries. Against the placeholders (load 0.5):

```
contracts: Test Files 4 failed | 93 passed (97)   Tests 50 failed | 4018 passed (4068)
  7 TypeError: Cannot read properties of undefined (reading 'safeParse')
  5 TypeError: Cannot read properties of undefined (reading 'parse')
  2 AssertionError: expected {} to deeply equal { …(3) }            (the theme problem statuses)
  1 TypeError: CONTRAST_PALETTE_TOKENS is not iterable
  1 AssertionError: expected undefined to deeply equal { type: 'theme-set', …(2) }   (and the revision and asset builders)
  1 AssertionError: expected undefined to be 'file'
core:      FAIL src/contrast/contrast.test.ts  TypeError: Cannot read properties of undefined (reading 'map')
node:      Tests 11 failed | 464 passed (475)   (the seven themeSets endpoints, the two uploads, the content read, the group list)
```

GREEN `d7171663`. One RED expectation was wrong and is corrected in that commit: `listThemeSetsQuerySchema.parse({ 'filter[status]': … })` keeps the comma-separated string, as every list filter of `list-filters.ts` does, instead of the array the test first expected (`expected { 'filter[status]': 'archived' } to deeply equal { 'filter[status]': [ 'archived' ] }`). Lint asked for a checked `itemOf` helper in place of the test's `as Json` casts.

Gates at the checkpoint (load beside each):
- `pnpm test` with coverage: contracts 4,093 passed, 99.19% statements, 93.83% branches; core 1,406 passed, 99.84%; node 475 passed, 98.41%; dashboard 5,587 passed, 96.38%; flow 1,106 passed, 95.48%; each exit 0 (load 2.2);
- `pnpm turbo run typecheck --force --concurrency=4`: 16 of 16, exit 0 (load 2.8);
- eslint of contracts, core and node: exit 0; prettier `--check` of every changed file: exit 0;
- the API suite, two blob shards and a merge of `/tmp/claude-1000/apiH-blobs`: `Test Files 586 passed`, `Tests 8261 passed`, 94.84% statements, 85.88% branches, exit 0 (load 1.9);
- `openapi:write` twice: sha256 `f5efcf3e…a8d9ca` both times (the inquiry's `theme-set-id`); no unresolved reference;
- Android `ContractFixturesTest`: exit 0, 92 tests, 0 failures.

CHECKPOINT (H) DONE at d71716632d6f0569e60100880009677fb63ea916

Handoff ((H)): amendments 38 to 41. For `foundation-9a` (H): freeze `routes/server/theme-sets.ts` (the routes of amendment 38 and the asset upload and content routes of amendment 39) and `routes/flow/theme-assets.ts` with these schemas; serve `default-theme-set-id` (amendment 35). For `api-themes` (9B): build `packages/core/src/contrast/` behind the frozen names and replace `contrast.test.ts`'s stub tests; answer the three theme problems with the golden shapes; build the resources with `buildThemeSetResource`, `buildThemeSetRevisionResource` and `buildThemeAssetResource`.

### Final gates (on the final tree)

The first e2e pass found one regression from (T) (amendment 42): shard 2 failed `ui-lifecycle.spec.ts:136` ("New draft" stayed on the template page with "Check the values you entered: Some values are not valid", because the resolved `inquiry-expiration-after-start-seconds: null` was refused as input). RED `a9827fe9` (`template-settings.test.ts`: `Tests 1 failed | 11 passed (12)`, `AssertionError: expected false to be true`, and TS2322 `Type 'null' is not assignable to type 'number | undefined'`), GREEN `73f5fccf`. The gates below ran after it, except where a line says otherwise (load beside each):

- `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile`: exit 0 ("Lockfile is up to date"); `(cd services/vision && uv lock --check)`: exit 0; `pnpm format:check`: exit 0 (load 2.7, and again at the end, load 6.1);
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=2`: 16 of 16, exit 0, 6m15s (load 1.9; before the fix, whose two files then passed `eslint` on their own); `pnpm turbo run typecheck --force --concurrency=4`: 16 of 16, exit 0 (load 1.6), and 16 of 16 again after the fix;
- unit: `pnpm turbo run test --force --concurrency=3 --filter='!@openverify/api' --filter='!@openverify/dashboard'`: 14 of 14, exit 0, 7m08s (load 2.3; every package at or above 92.57% statements, db the lowest); after the fix, contracts 4,094 passed (99.19%), dashboard 5,587 passed (96.38%), and the API as two blob shards merged from `/tmp/claude-1000/apiFinal-blobs`: `Test Files 586 passed`, `Tests 8261 passed`, 94.84% statements, 85.88% branches, exit 0 (load 1.8 to 8.3);
- integration (before the fix, which touches no repository or migration): `pnpm --filter @openverify/db test:integration` 17 files, 78 tests (load 1.6); `apps/api` `--project graph` 13 tests (load 15.6); `--project api --shard=1/3` 75, `2/3` 91, `3/3` 75 tests; each exit 0 (load 10.8, 11.3, 6.2);
- Android, four calls under the Gradle lock, each exit 0: `testDebugUnitTest` (load 11.2), `testAndroidHostTest koverVerify` (SDK host tests 1,364, 0 failures; load 8.9), `assembleDebug :openverify-sdk:assemble` (load 4.6), `lint` (load 5.0);
- `openapi:write` twice after the fix: sha256 `00ede8d8…12b4ad27` both times; `pnpm --filter @openverify/flow-spec schema:export`: exit 0, no diff; `bash infra/tests/ci-workflow.test.sh`: 220 passed, 0 failed;
- e2e, after the fix, from a fresh stack: `e2e:stack:down` and `turbo run build --filter=@openverify/e2e^...` (5 tasks), `e2e:stack:up`; the mocked flow suite 79 passed (load 3.5); with `OPENVERIFY_E2E_REUSE_STACK=1`, shard 1/3 46 passed (4.3m, 18:46 to 18:50Z), 2/3 46 passed (5.0m, load 1.8), 3/3 45 passed (4.7m, load 1.5); `e2e:stack:down`; each exit 0.

Handoff (all of Stage 1a): read amendments 15 to 42. The checkpoints are common `f20fb0a3`, (S) `ca4b8131`, (T) `ba460470`, (F) `85f8edcc`, (H) `d7171663`; the fix of amendment 42 is `73f5fccf`.
