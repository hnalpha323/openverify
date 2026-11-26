package dev.openverify.sdk.model

import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.fail

/**
 * Contract C8: every golden fixture in `contracts/fixtures/api` and `contracts/fixtures/flows`
 * decodes into the SDK's wire models, and the values the SDK relies on survive decoding.
 */
internal class ContractFixturesTest {

    /** The body of each `flows/` fixture: an inquiry template's `name` and `flow` (other keys ignored). */
    @Serializable
    private data class TemplateFixture(val name: String, val flow: Flow)

    private val decoders: Map<String, (String) -> Any> = mapOf<String, (String) -> Any>(
        "api/flow-session.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C151.5, C151.6, C178.1 (Workflow 9A Stage 1a (F)): today's SDK decodes both sessions, the
        // new members ignored and the projection's placeholder read as an unsupported step.
        "api/flow-session-v1-projection.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        "api/flow-session-v2.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // Workflow 9B (F): the session's links, which today's SDK ignores.
        "api/flow-session-links.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C96.3, owner decision 1 after 7A: the issuing session while the phone works.
        "api/flow-session-handed-off.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C128.7: the hosted flow shows the contest route; the SDK's session reads the answer around it.
        "api/flow-session-declined.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C200.2, C221.12 (Workflow 10A Stage 1a (S)): the display name that fills {organization}.
        "api/flow-session-organization.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // Workflow 10B (C211.3): the integrity challenge the SDK decodes.
        "api/flow-integrity-challenge.json" to { OpenVerifyJson.decodeFromString<FlowIntegrityChallenge>(it) },
        // Workflow 10C (C207.1, C207.9, C208.1, C221.1): the chip challenge, the client-unable and
        // sandbox-chip answers, and the session at an nfc step as a web client and as an SDK client get it.
        "api/flow-chip-challenge.json" to { OpenVerifyJson.decodeFromString<FlowChipChallenge>(it) },
        "api/flow-client-unable.json" to { OpenVerifyJson.decodeFromString<FlowClientUnable>(it) },
        "api/flow-sandbox-chip.json" to { OpenVerifyJson.decodeFromString<FlowSandboxChip>(it) },
        "api/flow-session-nfc.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        "api/flow-session-nfc-sdk.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C237.6, C238.3 (Workflow 11A Stage 1a (K)): the session at a share_consent step with the
        // withdrawable consents; today's SDK decodes it (the step until clients-connect's renderer).
        "api/flow-session-share-consent.json" to { OpenVerifyJson.decodeFromString<FlowSession>(it) },
        // C94.2, C94.7 (Phase 7): the Android signal body the SDK sends after consent.
        "api/flow-signals.json" to { OpenVerifyJson.decodeFromString<FlowSignals>(it) },
        "api/inquiry.json" to { OpenVerifyJson.decodeFromString<InquiryDocument>(it) },
        "api/inquiry-with-verifications.json" to { OpenVerifyJson.decodeFromString<InquiryDocument>(it) },
        "api/inquiry-session.json" to { OpenVerifyJson.decodeFromString<InquirySessionDocument>(it) },
        "api/problem.json" to { OpenVerifyJson.decodeFromString<Problem>(it) },
        "api/verification-government-id.json" to { OpenVerifyJson.decodeFromString<VerificationDocument>(it) },
        "api/verification-selfie.json" to { OpenVerifyJson.decodeFromString<VerificationDocument>(it) },
        "api/webhook-event-inquiry-completed.json" to { OpenVerifyJson.decodeFromString<EventDocument>(it) },
        // Workflow 9A Stage 1a (T): the new inquiry members (C151.8, C151.13) and the completed
        // event's flow outcome (C5 amended) decode in today's SDK, which ignores what it does not use.
        "api/inquiry-flow-outcome.json" to { OpenVerifyJson.decodeFromString<InquiryDocument>(it) },
        // Workflow 9B (F): the per-inquiry expiry windows, which today's SDK ignores.
        "api/inquiry-expiry-windows.json" to { OpenVerifyJson.decodeFromString<InquiryDocument>(it) },
        "api/event-inquiry-completed.json" to { OpenVerifyJson.decodeFromString<EventDocument>(it) },
        "api/event-inquiry-approved.json" to { OpenVerifyJson.decodeFromString<EventDocument>(it) },
        "api/event-account-consolidated.json" to { OpenVerifyJson.decodeFromString<EventDocument>(it) },
        "flows/default-gov-id-selfie.json" to { OpenVerifyJson.decodeFromString<TemplateFixture>(it) },
    ) + PHASE5_VERIFICATION_FIXTURES.keys.associateWith<String, (String) -> Any> {
        { text -> OpenVerifyJson.decodeFromString<VerificationDocument>(text) }
    }

    /**
     * C20 fixtures of server-API resources. The SDK holds only a session token, never an API key,
     * so it never reads them and has no model for them. The inquiry session is the exception
     * (C20): the SDK models the session it runs in.
     */
    private val serverOnly: Set<String> = setOf(
        "api/account.json",
        // C164.8 (Workflow 9B): the aggregates API answers, read with an API key, never by the SDK.
        "api/analytics-cases.json",
        "api/analytics-checks.json",
        "api/analytics-funnel.json",
        "api/analytics-inquiries.json",
        "api/analytics-signals.json",
        "api/analytics-verifications.json",
        "api/account-type.json",
        "api/api-key.json",
        // C172, C173 (Workflow 9B): case and report completions, server-API and dashboard reads.
        "api/case-checklist-state.json",
        "api/case-template-version-phase9b.json",
        "api/graph-query-expanded.json",
        "api/print-audit.json",
        "api/report-watchlist-phase9b.json",
        "api/verification-files.json",
        // C169 (Workflow 9B): keys, webhooks, notifications and their preferences, server-API reads.
        "api/api-key-phase9b.json",
        "api/api-key-rotated.json",
        "api/webhook-phase9b.json",
        "api/user-notifications-phase9b.json",
        "api/notification-preferences.json",
        "api/api-log.json",
        // C166 (Workflow 9B): exports, a server-API resource.
        "api/export.json",
        "api/exports.json",
        // C62.10: the console view of the CSCA trust store, a dashboard answer the SDK never reads.
        "api/dashboard-trust-anchors.json",
        // C72.3 (Phase 6): the console's watchlist sources page.
        "api/dashboard-watchlist-sources.json",
        // C91.2 (Phase 7): devices are server-API resources; the SDK never reads them.
        "api/device.json",
        // C128.1 (Workflow 8A): decision records and the declined event are server-API answers.
        "api/decision.json",
        // C150.7 (Workflow 9A Stage 1a): a flow failure's record, a server-API answer too.
        "api/decision-flow-failure.json",
        "api/decisions.json",
        "api/event-inquiry-declined.json",
        // C125, C126.4 (Workflow 8A): the secrets and the sandbox message searches are server-API answers.
        "api/workflow-secret.json",
        "api/sandbox-email-messages.json",
        "api/sandbox-slack-messages.json",
        "api/sandbox-workflow-sms-messages.json",
        // C101.6 (owner decision 6 after 7B): an account's graph component, a server-API read.
        "api/account-graph-component.json",
        // C112-C122, C127.12, C128.6 (Workflow 8A): workflows and their events are server-API
        // resources; the SDK runs flows, never workflows.
        "api/account-action.json",
        "api/account-available-actions.json",
        "api/account-run-action.json",
        "api/event-inquiry-reopened.json",
        "api/event-list-updated.json",
        "api/event-workflow-paused.json",
        "api/event-workflow-published.json",
        "api/event-workflow-run-canceled.json",
        "api/event-workflow-run-completed.json",
        "api/event-workflow-run-created.json",
        "api/event-workflow-run-errored.json",
        "api/event-workflow-run-resumed.json",
        "api/event-workflow-version-published.json",
        "api/workflow.json",
        "api/workflow-actions.json",
        "api/workflow-definition-check.json",
        "api/workflow-deployment.json",
        "api/workflow-manual-runs.json",
        // C129-C140 (Workflow 8B): the SDK never reads a case resource.
        "api/case.json",
        "api/case-action.json",
        "api/case-available-actions.json",
        "api/case-bulk-action.json",
        "api/case-comment.json",
        "api/case-held-objects.json",
        "api/case-history.json",
        "api/case-included.json",
        "api/case-run-action.json",
        "api/case-search.json",
        "api/case-template.json",
        "api/case-template-version.json",
        // C132, C133 (Workflow 8B, the (Q) family): queues, policies, calendars and the next case.
        "api/case-assignment-policy.json",
        "api/case-calendar.json",
        "api/case-calendar-import.json",
        "api/case-next.json",
        "api/case-queue.json",
        "api/case-sla-policy.json",
        // C135, C138 (Workflow 8B, the (F) family): exports and renditions are the server's.
        "api/case-export.json",
        "api/case-export-bundle.json",
        "api/case-rendition-pending.json",
        "api/event-case-assigned.json",
        "api/event-case-comment-created.json",
        "api/event-case-created.json",
        "api/event-case-exported.json",
        "api/event-case-print-initiated.json",
        "api/event-case-queue-updated.json",
        "api/event-case-redacted.json",
        "api/event-case-reopened.json",
        "api/event-case-resolved.json",
        "api/event-case-sla-expired.json",
        "api/event-case-status-updated.json",
        "api/event-case-template-deleted-field.json",
        "api/event-case-updated-fields.json",
        "api/event-case-updated-tags.json",
        "api/event-case-updated.json",
        "api/user-notifications.json",
        "api/workflow-recipes.json",
        "api/workflow-run.json",
        "api/workflow-run-steps.json",
        "api/workflow-trigger-deliveries.json",
        "api/workflow-version.json",
        "api/workflow-version-diff.json",
        // C102 (Workflow 7B): graph queries are server-API resources.
        "api/graph-node-value.json",
        "api/graph-query.json",
        "api/graph-query-action-result.json",
        "api/graph-query-template.json",
        "api/graph-query-template-version.json",
        // C100.1 (Workflow 7B): importers are server-API resources.
        "api/importer.json",
        "api/importer-errors.json",
        "api/inquiry-template-version.json",
        // Workflow 9A Stage 1a (T): template versions, their routes, translations, deployments,
        // presets and the template events are server-API answers.
        "api/inquiry-template-version-v2.json",
        "api/inquiry-template-version-summary.json",
        "api/inquiry-template-translations.json",
        "api/inquiry-template-usage.json",
        "api/deployment.json",
        "api/deployments.json",
        "api/simulation-presets.json",
        "api/template-preview.json",
        "api/template-simulation.json",
        "api/template-version-diff.json",
        "api/template-version-validation.json",
        "api/event-inquiry-template-version-created.json",
        "api/event-inquiry-template-version-published.json",
        "api/event-deployment-completed.json",
        // Workflow 9A Stage 1a (H): theme sets, revisions and assets are operator resources; a flow
        // reads its theme from the session (C160.7).
        "api/theme-set.json",
        "api/theme-sets.json",
        "api/theme-set-revisions.json",
        "api/theme-asset.json",
        "api/theme-asset-font.json",
        // C97, C99 (Workflow 7B): lists are server-API resources; the SDK never reads them.
        "api/list.json",
        "api/list-items.json",
        "api/list-match.json",
        "api/list-match-result.json",
        "api/rate-limit.json",
        // C70 (Phase 6): reports are server-API resources; the SDK runs flows, never reports.
        "api/report-address-lookup.json",
        "api/report-adverse-media.json",
        "api/report-business-adverse-media.json",
        "api/report-business-watchlist.json",
        "api/report-crypto-address-watchlist.json",
        // C106.2 (Workflow 7B).
        "api/report-custom-list.json",
        "api/report-email-address.json",
        "api/report-history.json",
        // C106.1 (Phase 7).
        "api/report-ip-address.json",
        // C166.5 (Workflow 9B): a bulk report job, a server-API resource.
        "api/report-bulk-job.json",
        "api/report-phone-number.json",
        "api/report-politically-exposed-person.json",
        "api/report-template.json",
        "api/report-template-version.json",
        "api/report-watchlist.json",
        "api/role.json",
        // C165.1 (Workflow 9B): saved views, a dashboard answer the SDK never reads.
        "api/saved-view.json",
        "api/saved-views.json",
        // C40.1: the selfie capture resource; the SDK reads captures through the flow API (C40.2).
        "api/selfie.json",
        // C104, C105 (Workflow 7B): transactions are server-API resources.
        "api/transaction.json",
        "api/transaction-label.json",
        // Owner decision 8 after 7B: a transaction's status history and labels, server-API reads.
        "api/transaction-labels.json",
        // K7C-2: a transaction's relations, a server-API read.
        "api/transaction-relations.json",
        "api/transaction-status-changes.json",
        "api/transaction-type.json",
        "api/transaction-type-version.json",
        "api/user-audit-log.json",
        // C167, C168 (Workflow 9B): roles per environment, grants, step-up, sessions, the users list.
        "api/user-mfa-status.json",
        "api/user-role-assignments.json",
        // K9-22 (Workflow 9D, DS8): a user's effective permissions, a dashboard read.
        "api/user-effective-permissions.json",
        "api/user-sessions.json",
        "api/user-sessions-revoked.json",
        "api/grantable.json",
        "api/step-up.json",
        // C15, owner decisions 3 after 7A and 5 after 7B: a system audit entry, as server-only as any.
        "api/user-audit-log-system.json",
        "api/webhook-delivery.json",
    )

    private val allFixtures: List<String> = Fixtures.list("api") + Fixtures.list("flows")

    @TestFactory
    fun `every api and flows fixture the SDK reads decodes`(): List<DynamicTest> =
        allFixtures.filterNot { it in serverOnly }.map { path ->
            dynamicTest(path) {
                val decode = decoders[path]
                    ?: fail("No decoder for $path: a new contract fixture needs a Kotlin model and a test, or a serverOnly entry")
                decode(Fixtures.read(path))
            }
        }

    @Test
    fun `every fixture is either decoded by the SDK or listed as server-only, never both`() {
        assertEquals(emptySet<String>(), decoders.keys intersect serverOnly)
        assertEquals((decoders.keys + serverOnly).sorted(), allFixtures.sorted())
    }

    /** C20 (Workflow 2E C25.8): the 401 `session_canceled` problems, one per `reason`. */
    private val canceledSessionProblems: Map<String, SessionCanceledReason> = mapOf(
        "problems/session-canceled-inquiry-expired.json" to SessionCanceledReason.INQUIRY_EXPIRED,
        "problems/session-canceled-inquiry-finished.json" to SessionCanceledReason.INQUIRY_FINISHED,
        "problems/session-canceled-inquiry-redacted.json" to SessionCanceledReason.INQUIRY_REDACTED,
    )

    /**
     * Workflow 4B review K202: the 409 selfie capture problems as the flow API sends them, one per
     * C40 code, and whether the SDK restarts the capture or starts a new attempt on each. The SDK
     * never provokes `selfie_capture_required`, so it reads it as an ordinary conflict.
     */
    private val selfieCaptureProblems: Map<String, Pair<String, String>> = mapOf(
        "problems/selfie-capture-incomplete.json" to ("selfie_capture_incomplete" to "restart the capture"),
        "problems/selfie-capture-invalid.json" to ("selfie_capture_invalid" to "restart the capture"),
        "problems/selfie-capture-limit.json" to ("selfie_capture_limit" to "start a new attempt"),
        "problems/selfie-capture-required.json" to ("selfie_capture_required" to "conflict"),
    )

    @Test
    fun `every problems fixture has an expected reason or selfie capture code`() {
        assertEquals(
            (canceledSessionProblems.keys + selfieCaptureProblems.keys).sorted(),
            Fixtures.list("problems"),
        )
    }

    /**
     * C52.7: the problem codes Phase 5 adds, frozen in Workflow 5A Stage 1a, one golden problem each
     * in `problems/flow/`, with the status each answers with. The flow engine branches on the phone,
     * email and wallet ones ([FlowProblemCodes]); it reads the others as ordinary problems.
     */
    private val phase5FlowProblems: Map<String, Pair<String, Int>> = mapOf(
        "problems/flow/chip-challenge-invalid.json" to ("chip_challenge_invalid" to 409),
        "problems/flow/chip-data-required.json" to ("chip_data_required" to 409),
        // Workflow 10C (C207.9, C221.6): beside the Phase 5 ones.
        "problems/flow/client-unable-not-allowed.json" to ("client_unable_not_allowed" to 409),
        "problems/flow/crypto-address-invalid.json" to ("crypto_address_invalid" to 422),
        "problems/flow/crypto-chain-not-offered.json" to ("crypto_chain_not_offered" to 422),
        "problems/flow/crypto-challenge-invalid.json" to ("crypto_challenge_invalid" to 409),
        "problems/flow/crypto-expected-address-mismatch.json" to ("crypto_expected_address_mismatch" to 422),
        "problems/flow/inputs-required.json" to ("inputs_required" to 409),
        // Workflow 10B (C211.3, C221.6): beside the Phase 5 ones.
        "problems/flow/integrity-challenge-invalid.json" to ("integrity_challenge_invalid" to 409),
        "problems/flow/otp-already-confirmed.json" to ("otp_already_confirmed" to 409),
        "problems/flow/otp-attempts-exhausted.json" to ("otp_attempts_exhausted" to 409),
        "problems/flow/otp-channel-not-configured.json" to ("otp_channel_not_configured" to 422),
        "problems/flow/otp-code-exhausted.json" to ("otp_code_exhausted" to 409),
        "problems/flow/otp-delivery-failed.json" to ("otp_delivery_failed" to 502),
        "problems/flow/otp-destination-invalid.json" to ("otp_destination_invalid" to 422),
        "problems/flow/otp-destination-not-allowed.json" to ("otp_destination_not_allowed" to 422),
        "problems/flow/otp-expired.json" to ("otp_expired" to 409),
        "problems/flow/otp-incorrect.json" to ("otp_incorrect" to 422),
        "problems/flow/otp-not-confirmed.json" to ("otp_not_confirmed" to 409),
        "problems/flow/otp-not-sent.json" to ("otp_not_sent" to 409),
        "problems/flow/otp-rate-limited.json" to ("otp_rate_limited" to 429),
        "problems/flow/otp-resend-too-soon.json" to ("otp_resend_too_soon" to 429),
        "problems/flow/provider-not-configured.json" to ("provider_not_configured" to 422),
        // Workflow 10C (C208.1, C221.6): the sandbox test chip's two refusals.
        "problems/flow/sandbox-chip-anchor-missing.json" to ("sandbox_chip_anchor_missing" to 409),
        "problems/flow/sandbox-chip-scenario-unavailable.json" to ("sandbox_chip_scenario_unavailable" to 422),
        "problems/flow/verification-created-by-server.json" to ("verification_created_by_server" to 409),
    )

    @Test
    fun `every Phase 5 flow problems fixture has an expected code and status (C52_7)`() {
        assertEquals(phase5FlowProblems.keys.sorted(), Fixtures.list("problems/flow"))
    }

    /** C52.7: each problem code the flow engine branches on (C64.2), with the status it expects it with. */
    private val flowBranches: Map<String, Int> = mapOf(
        FlowProblemCodes.OTP_DESTINATION_INVALID to 422,
        FlowProblemCodes.OTP_DESTINATION_NOT_ALLOWED to 422,
        FlowProblemCodes.OTP_RESEND_TOO_SOON to 429,
        FlowProblemCodes.OTP_RATE_LIMITED to 429,
        FlowProblemCodes.OTP_DELIVERY_FAILED to 502,
        FlowProblemCodes.OTP_NOT_SENT to 409,
        FlowProblemCodes.OTP_INCORRECT to 422,
        FlowProblemCodes.OTP_EXPIRED to 409,
        FlowProblemCodes.OTP_CODE_EXHAUSTED to 409,
        FlowProblemCodes.OTP_ATTEMPTS_EXHAUSTED to 409,
        FlowProblemCodes.OTP_NOT_CONFIRMED to 409,
        FlowProblemCodes.OTP_ALREADY_CONFIRMED to 409,
        FlowProblemCodes.CRYPTO_CHAIN_NOT_OFFERED to 422,
        FlowProblemCodes.CRYPTO_ADDRESS_INVALID to 422,
        FlowProblemCodes.CRYPTO_EXPECTED_ADDRESS_MISMATCH to 422,
        FlowProblemCodes.CRYPTO_CHALLENGE_INVALID to 409,
    )

    @Test
    fun `every Phase 5 problem code the flow branches on is a golden problem, with the status it expects (C52_7)`() {
        val golden = phase5FlowProblems.values.toMap()

        assertEquals(flowBranches, flowBranches.keys.associateWith { golden[it] })
    }

    /**
     * Phase 9's flow-engine problems (C148.5, C151.4, C162.9, C171.4), one golden problem each in
     * `problems/flow-engine/` (Workflow 10A Stage 1a), with the status each answers with.
     */
    private val flowEngineProblems: Map<String, Pair<String, Int>> = mapOf(
        "problems/flow-engine/consent-text-mismatch.json" to ("consent_text_mismatch" to 422),
        "problems/flow-engine/field-unknown.json" to ("field_unknown" to 422),
        "problems/flow-engine/field-write-once.json" to ("field_write_once" to 422),
        "problems/flow-engine/fields-too-large.json" to ("fields_too_large" to 422),
        "problems/flow-engine/flow-step-not-current.json" to ("flow_step_not_current" to 409),
        "problems/flow-engine/selfie-capture-not-extendable.json" to ("selfie_capture_not_extendable" to 409),
    )

    /** The flow-engine codes the server-position driver answers on its own (C193.5, C200.5, C204.5). */
    private val driverBranches: Map<String, Int> = mapOf(
        FlowProblemCodes.FLOW_STEP_NOT_CURRENT to 409,
        FlowProblemCodes.CONSENT_TEXT_MISMATCH to 422,
        FlowProblemCodes.SELFIE_CAPTURE_NOT_EXTENDABLE to 409,
    )

    /** C207.2, C207.9, C208.1 (Workflow 10C): the problem codes the NFC step answers on its own, with their statuses. */
    private val nfcBranches: Map<String, Int> = mapOf(
        FlowProblemCodes.CHIP_CHALLENGE_INVALID to 409,
        FlowProblemCodes.CHIP_DATA_REQUIRED to 409,
        FlowProblemCodes.CLIENT_UNABLE_NOT_ALLOWED to 409,
        FlowProblemCodes.SANDBOX_CHIP_ANCHOR_MISSING to 409,
        FlowProblemCodes.SANDBOX_CHIP_SCENARIO_UNAVAILABLE to 422,
    )

    @Test
    fun `every problem code the NFC step branches on is a golden problem, with the status it expects (Workflow 10C)`() {
        val golden = phase5FlowProblems.values.toMap()

        assertEquals(nfcBranches, nfcBranches.keys.associateWith { golden[it] })
        phase5FlowProblems.filterValues { it.first in nfcBranches }.forEach { (path, expected) ->
            val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))
            assertEquals(expected.first, problem.code)
            assertEquals(expected.second, problem.status)
        }
    }

    @Test
    fun `the SDK names the integrity challenge's problem code as its golden problem does (Workflow 10B)`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read("problems/flow/integrity-challenge-invalid.json"))

        assertEquals(problem.code, FlowProblemCodes.INTEGRITY_CHALLENGE_INVALID)
        assertEquals(409, problem.status)
    }

    @Test
    fun `every flow-engine problems fixture has an expected code and status (Workflow 10A)`() {
        assertEquals(flowEngineProblems.keys.sorted(), Fixtures.list("problems/flow-engine"))
    }

    @TestFactory
    fun `every flow-engine problems fixture decodes with its code and status (Workflow 10A)`(): List<DynamicTest> =
        flowEngineProblems.map { (path, expected) ->
            dynamicTest(path) {
                val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))

                assertEquals(expected.second, problem.status)
                assertEquals(expected.first, problem.code)
            }
        }

    @Test
    fun `every flow-engine code the driver answers is a golden problem, with the status it expects (C193_5)`() {
        val golden = flowEngineProblems.values.toMap()

        assertEquals(3, driverBranches.size)
        assertEquals(driverBranches, driverBranches.keys.associateWith { golden[it] })
    }

    @TestFactory
    fun `every Phase 5 flow problems fixture decodes with its code and status (C52_7)`(): List<DynamicTest> =
        phase5FlowProblems.map { (path, expected) ->
            dynamicTest(path) {
                val (code, status) = expected
                val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))

                assertEquals(status, problem.status)
                assertEquals(code, problem.code)
                assertNull(problem.reason)
            }
        }

    @TestFactory
    fun `every Phase 5 verification fixture decodes as its own type, with its files (C50_6, C52_4)`(): List<DynamicTest> =
        PHASE5_VERIFICATION_FIXTURES.map { (path, expected) ->
            dynamicTest(path) {
                val (resourceType, kinds) = expected
                val document = OpenVerifyJson.decodeFromString<VerificationDocument>(Fixtures.read(path))

                assertEquals(resourceType, document.data.type)
                assertEquals(resourceType, document.data.verificationType.resourceType)
                assertEquals(kinds, document.included.map { it.attributes.kind.wireValue })
            }
        }

    @Test
    fun `a file kind added after this SDK version decodes instead of failing the document`() {
        val original = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/verification-government-id.json")).jsonObject
        val included = buildJsonArray {
            original.getValue("included").jsonArray.forEach { file ->
                val attributes = JsonObject(
                    file.jsonObject.getValue("attributes").jsonObject + ("kind" to JsonPrimitive("kind-from-a-newer-server")),
                )
                add(JsonObject(file.jsonObject + ("attributes" to attributes)))
            }
        }

        val document = OpenVerifyJson.decodeFromJsonElement(
            VerificationDocument.serializer(),
            JsonObject(original + ("included" to included)),
        )

        assertEquals(listOf("unknown", "unknown"), document.included.map { it.attributes.kind.wireValue })
    }

    @TestFactory
    fun `every session_canceled problems fixture decodes with its code and reason (C25)`(): List<DynamicTest> =
        canceledSessionProblems.map { (path, reason) ->
            dynamicTest(path) {
                val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))

                assertEquals(401, problem.status)
                assertEquals("session_canceled", problem.code)
                assertEquals(reason, problem.reason)
            }
        }

    @TestFactory
    fun `every selfie capture problems fixture decodes as the 409 the SDK branches on (K202)`(): List<DynamicTest> =
        selfieCaptureProblems.map { (path, expected) ->
            dynamicTest(path) {
                val (code, branch) = expected
                val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))

                assertEquals(409, problem.status)
                assertEquals(code, problem.code)
                assertNull(problem.reason)
                val taken = when (problem.code) {
                    in SelfieCaptureProtocol.CAPTURE_REFUSED_CODES -> "restart the capture"
                    in SelfieCaptureProtocol.CAPTURE_LIMIT_CODES -> "start a new attempt"
                    else -> "conflict"
                }
                assertEquals(branch, taken)
            }
        }

    @Test
    fun `an approved inquiry event decodes, and its payload decodes as an approved inquiry`() {
        val document = OpenVerifyJson.decodeFromString<EventDocument>(Fixtures.read("api/event-inquiry-approved.json"))

        assertEquals("inquiry.approved", document.data.attributes.name)
        val inquiry = OpenVerifyJson.decodeFromJsonElement(
            InquiryResource.serializer(),
            document.data.attributes.payload.data,
        )
        assertEquals(InquiryStatus.APPROVED, inquiry.attributes.status)
    }

    @Test
    fun `flow-session decodes the inquiry, the flow, the verifications and the consent`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals(FlowSessionInquiry("inq_01M5CJXHG07XPHF3HRM6NREDH7", InquiryStatus.PENDING), session.inquiry)
        assertEquals(FlowConsent(acceptedAt = "2026-10-20T12:00:30.000Z"), session.consent)
        assertEquals(DEFAULT_FLOW_STEPS, session.flow.steps)
        assertEquals(
            FlowMetadata(
                specVersion = 1,
                id = "default-gov-id-selfie",
                version = 3,
                name = "Government ID and selfie",
                description = "Consent, a two-sided government ID, then a selfie compared with the ID portrait.",
            ),
            session.flow.metadata,
        )
        assertEquals(2, session.flow.transitions.size)
        val transition = session.flow.transitions.first()
        assertEquals("government_id", transition.from)
        assertEquals("failure", transition.to)
        assertEquals(FAILED_CONDITION, transition.condition)

        val (failed, initiated) = session.verifications
        assertEquals("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", failed.id)
        assertEquals(VerificationType.GOVERNMENT_ID, failed.verificationType)
        assertEquals(VerificationStatus.FAILED, failed.attributes.status)
        assertEquals(listOf(RetryHint("id_blur_detection", listOf("image_blurry"))), failed.attributes.retryHints)
        assertEquals("2026-10-20T12:01:00.000Z", failed.attributes.createdAt)
        assertEquals("2026-10-20T12:01:30.000Z", failed.attributes.updatedAt)
        assertEquals(VerificationStatus.INITIATED, initiated.attributes.status)
        assertEquals(emptyList<RetryHint>(), initiated.attributes.retryHints)
    }

    @Test
    fun `flow-session gives the face template retention days that the matching consent text names (C42_3)`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals(365, session.faceTemplateRetentionDays)
    }

    @Test
    fun `a session from a server before Phase 4 decodes without retention days or optional consent texts`() {
        val original = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val flow = original.getValue("flow").jsonObject
        val steps = buildJsonArray {
            flow.getValue("steps").jsonArray.forEach { step -> add(JsonObject(step.jsonObject - "optionalTextKeys")) }
        }
        val older = JsonObject(original - "face-template-retention-days" + ("flow" to JsonObject(flow + ("steps" to steps))))

        val session = OpenVerifyJson.decodeFromJsonElement(FlowSession.serializer(), older)

        assertNull(session.faceTemplateRetentionDays)
        assertEquals(emptyList<String>(), (session.flow.steps.first() as ConsentStep).optionalTextKeys)
    }

    @Test
    fun `flow-session says which environment the session runs in (C19)`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals(FlowEnvironment(EnvironmentKind.SANDBOX), session.environment)
    }

    @Test
    fun `a device handoff step decodes and is done only from a done state (C96_1, F01)`() {
        val step = OpenVerifyJson.decodeFromString(FlowStepSerializer, """{"id":"handoff","type":"device_handoff","methods":["qr"]}""")

        assertEquals(DeviceHandoffStep("handoff"), step)
        for (state in listOf("redeemed", "continued_here", "skipped")) {
            assertTrue(FlowHandoff("handoff", state).done, state)
        }
        for (state in listOf("pending", "issued", "rejected", "declined")) {
            assertFalse(FlowHandoff("handoff", state).done, state)
        }
    }

    @Test
    fun `the flow session reports the collector tiers after consent (C94_6)`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals(FlowSessionSignals(integrity = true, recognition = false, nextSequence = 0), session.signals)
    }

    @Test
    fun `the issuing session reads handed-off and its next sequence (K7A-5, K7A-7)`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session-handed-off.json"))

        assertEquals(FlowHandoff("handoff", "redeemed", handedOff = true), session.handoff)
        assertEquals(3, session.signals?.nextSequence)
    }

    @Test
    fun `a server before next-sequence and handed-off decodes without them`() {
        val signals = OpenVerifyJson.decodeFromString<FlowSessionSignals>("""{"integrity":true,"recognition":false}""")
        val handoff = OpenVerifyJson.decodeFromString<FlowHandoff>("""{"step-id":"handoff","state":"redeemed"}""")

        assertNull(signals.nextSequence)
        assertNull(handoff.handedOff)
    }

    @Test
    fun `the Android signal body decodes its own members and never prints the ANDROID_ID (C94_7)`() {
        val body = OpenVerifyJson.decodeFromString<FlowSignals>(Fixtures.read("api/flow-signals.json"))

        assertEquals("android", body.platform)
        assertEquals(AndroidIntegritySignals(debuggerConnected = false, appDebuggable = false), body.androidIntegrity)
        assertEquals("smartphone", body.deviceClass)
        assertFalse(body.toString().contains(checkNotNull(body.androidRecognition).androidId), body.toString())
    }

    @Test
    fun `inquiry-session decodes its status, times, client and inquiry (C20)`() {
        val document = OpenVerifyJson.decodeFromString<InquirySessionDocument>(Fixtures.read("api/inquiry-session.json"))
        val session = document.data

        assertEquals("inquiry-session", session.type)
        assertEquals("iqse_01M5CJZC30W7PFE0GD30HJWEA4", session.id)
        assertEquals(
            InquirySessionAttributes(
                status = InquirySessionStatus.ACTIVE,
                createdAt = "2026-10-20T12:00:10.000Z",
                startedAt = "2026-10-20T12:00:20.000Z",
                expiresAt = "2026-10-21T12:00:10.000Z",
                ipAddress = "203.0.113.7",
                userAgent = "Mozilla/5.0 (Linux; Android 14) OpenVerifyTest/1.0",
            ),
            session.attributes,
        )
        assertEquals(ResourceIdentifier("inquiry", "inq_01M5CJXHG07XPHF3HRM6NREDH7"), session.relationships.inquiry.data)
    }

    @Test
    fun `an inquiry session never prints its client address or user agent`() {
        val document = OpenVerifyJson.decodeFromString<InquirySessionDocument>(Fixtures.read("api/inquiry-session.json"))

        val text = document.toString()
        assertFalse(text.contains("203.0.113.7"), text)
        assertFalse(text.contains("OpenVerifyTest"), text)
    }

    @Test
    fun `an inquiry session not started yet, or masked, decodes without its client`() {
        val original = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/inquiry-session.json")).jsonObject
        val data = original.getValue("data").jsonObject
        val attributes = JsonObject(
            data.getValue("attributes").jsonObject + mapOf(
                "status" to JsonPrimitive("expired"),
                "started-at" to JsonNull,
                "ip-address" to JsonNull,
                "user-agent" to JsonNull,
            ),
        )
        val masked = JsonObject(mapOf("data" to JsonObject(data + ("attributes" to attributes))))

        val session = OpenVerifyJson.decodeFromJsonElement(InquirySessionDocument.serializer(), masked).data.attributes

        assertEquals(InquirySessionStatus.EXPIRED, session.status)
        assertNull(session.startedAt)
        assertNull(session.ipAddress)
        assertNull(session.userAgent)
    }

    @Test
    fun `inquiry decodes kebab-case attributes and relationships`() {
        val document = OpenVerifyJson.decodeFromString<InquiryDocument>(Fixtures.read("api/inquiry.json"))
        val inquiry = document.data

        assertEquals("inquiry", inquiry.type)
        assertEquals("inq_01M5CJXHG07XPHF3HRM6NREDH7", inquiry.id)
        assertEquals(InquiryStatus.CREATED, inquiry.attributes.status)
        assertEquals("ref-test-001", inquiry.attributes.referenceId)
        assertEquals(JsonPrimitive("Jane"), inquiry.attributes.fields["name_first"])
        assertEquals("2026-10-20T12:00:00.000Z", inquiry.attributes.createdAt)
        assertEquals(
            ResourceIdentifier("inquiry-template", "itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6"),
            inquiry.relationships.inquiryTemplate.data,
        )
        assertEquals(emptyList<ResourceIdentifier>(), inquiry.relationships.verifications.data)
        assertEquals(emptyList<VerificationResource>(), document.included)
    }

    @Test
    fun `inquiry with verifications decodes included verifications and their checks`() {
        val document = OpenVerifyJson.decodeFromString<InquiryDocument>(
            Fixtures.read("api/inquiry-with-verifications.json"),
        )

        assertEquals(InquiryStatus.COMPLETED, document.data.attributes.status)
        assertEquals(3, document.data.relationships.verifications.data.size)
        assertEquals(
            listOf(VerificationType.GOVERNMENT_ID, VerificationType.GOVERNMENT_ID, VerificationType.SELFIE),
            document.included.map { it.verificationType },
        )

        val firstId = document.included[0]
        assertEquals(VerificationStatus.FAILED, firstId.attributes.status)
        assertEquals("US", firstId.attributes.country)
        assertEquals("drivers_license", firstId.attributes.idClass)
        assertEquals(
            VerificationCheck(
                name = "id_blur_detection",
                status = CheckStatus.FAILED,
                reasons = listOf("image_blurry"),
                requirement = CheckRequirement.REQUIRED,
                metadata = buildJsonObject {
                    put("side", "front")
                    put("blur_score", 41.7)
                },
            ),
            firstId.attributes.checks.first(),
        )
        assertEquals(
            ResourceIdentifier("inquiry", "inq_01M5CJXHG07XPHF3HRM6NREDH7"),
            firstId.relationships.inquiry.data,
        )

        val selfie = document.included[2]
        assertEquals(VerificationStatus.PASSED, selfie.attributes.status)
        assertNull(selfie.attributes.country)
        assertEquals(
            listOf("selfie_image_quality_detection", "selfie_multiple_faces_detection", "selfie_id_comparison"),
            selfie.attributes.checks.map { it.name },
        )
        assertEquals(
            listOf(ResourceIdentifier("file", "file_01M5CK3288G5K9T8DC51K68DDZ")),
            selfie.relationships.files.data,
        )
    }

    @Test
    fun `government-id verification decodes its checks and included files`() {
        val document = OpenVerifyJson.decodeFromString<VerificationDocument>(
            Fixtures.read("api/verification-government-id.json"),
        )

        assertEquals(VerificationType.GOVERNMENT_ID, document.data.verificationType)
        assertEquals(VerificationStatus.FAILED, document.data.attributes.status)
        assertEquals(
            listOf(CheckStatus.FAILED, CheckStatus.PASSED, CheckStatus.PASSED, CheckStatus.PASSED),
            document.data.attributes.checks.map { it.status },
        )

        val (front, back) = document.included
        assertEquals("file", front.type)
        assertEquals("file_01M5CJZD282YV9958CG7ZK9ZKN", front.id)
        assertEquals(FileAttributes(FileKind.FRONT, "image/jpeg", 245_812, "2026-10-20T12:01:01.000Z"), front.attributes)
        assertEquals(
            ResourceIdentifier("verification/government-id", "ver_01M5CJZC301G4JHXZQ3PZBYH3Q"),
            front.relationships.verification.data,
        )
        assertEquals(FileKind.BACK, back.attributes.kind)
        assertEquals("image/png", back.attributes.mimeType)
    }

    @Test
    fun `selfie verification decodes without government-id attributes`() {
        val document = OpenVerifyJson.decodeFromString<VerificationDocument>(
            Fixtures.read("api/verification-selfie.json"),
        )

        assertEquals(VerificationType.SELFIE, document.data.verificationType)
        assertEquals(VerificationStatus.PASSED, document.data.attributes.status)
        assertNull(document.data.attributes.idClass)
        assertTrue(document.data.attributes.checks.all { it.requirement == CheckRequirement.REQUIRED })
        assertEquals(emptyList<FileResource>(), document.included)
    }

    @Test
    fun `webhook event decodes, and its payload decodes as an inquiry`() {
        val document = OpenVerifyJson.decodeFromString<EventDocument>(
            Fixtures.read("api/webhook-event-inquiry-completed.json"),
        )

        assertEquals("event", document.data.type)
        assertEquals("evt_01M5CK4VW0MRQ4HKKTBDT6PXEM", document.data.id)
        assertEquals("inquiry.completed", document.data.attributes.name)
        assertEquals("2026-10-20T12:04:00.000Z", document.data.attributes.createdAt)
        val inquiry = OpenVerifyJson.decodeFromJsonElement(
            InquiryResource.serializer(),
            document.data.attributes.payload.data,
        )
        assertEquals(InquiryStatus.COMPLETED, inquiry.attributes.status)
    }

    @Test
    fun `problem decodes RFC 9457 members and validation errors`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read("api/problem.json"))

        assertEquals(
            Problem(
                type = "about:blank",
                title = "Bad Request",
                status = 400,
                detail = "The request body failed validation.",
                instance = "/api/v1/inquiries",
                requestId = "00000000-0000-4000-8000-000000000001",
                errors = listOf(
                    ProblemFieldError(
                        location = "body",
                        pointer = "/data/attributes/inquiry-template-id",
                        detail = "must be a itmpl_ ID",
                    ),
                ),
            ),
            problem,
        )
    }

    @Test
    fun `the default template flow matches the flow the session serves`() {
        val template = OpenVerifyJson.decodeFromString<TemplateFixture>(Fixtures.read("flows/default-gov-id-selfie.json"))
        val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals("Government ID and selfie", template.name)
        assertEquals(session.flow, template.flow)
    }

    @Test
    fun `unknown keys are ignored at every level`() {
        val original = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val extended = original.withExtra().let { root ->
            JsonObject(
                root + mapOf(
                    "inquiry" to root.getValue("inquiry").jsonObject.withExtra(),
                    "consent" to root.getValue("consent").jsonObject.withExtra(),
                    "flow" to root.getValue("flow").jsonObject.let { flow ->
                        JsonObject(
                            flow.withExtra() + mapOf(
                                "steps" to buildJsonArray {
                                    flow.getValue("steps").jsonArray.forEach { add(it.jsonObject.withExtra()) }
                                },
                            ),
                        )
                    },
                    "verifications" to buildJsonArray {
                        root.getValue("verifications").jsonArray.forEach { verification ->
                            val attributes = verification.jsonObject.getValue("attributes").jsonObject.withExtra()
                            add(JsonObject(verification.jsonObject.withExtra() + ("attributes" to attributes)))
                        }
                    },
                ),
            )
        }

        assertEquals(
            OpenVerifyJson.decodeFromJsonElement(FlowSession.serializer(), original),
            OpenVerifyJson.decodeFromJsonElement(FlowSession.serializer(), extended),
        )
    }

    @Test
    fun `inquiry attributes never print the PII in fields`() {
        val document = OpenVerifyJson.decodeFromString<InquiryDocument>(Fixtures.read("api/inquiry.json"))

        assertFalse(document.toString().contains("Jane"), document.toString())
    }

    private fun JsonObject.withExtra(): JsonObject =
        JsonObject(this + ("x-added-by-a-newer-server" to JsonPrimitive(true) as JsonElement))

    companion object {
        /** C50.1: the golden fixture of each Phase 5 type, its resource type and its files' kinds. */
        val PHASE5_VERIFICATION_FIXTURES: Map<String, Pair<String, List<String>>> = mapOf(
            "api/verification-document.json" to ("verification/document" to listOf("document", "document-preview")),
            "api/verification-database.json" to ("verification/database" to emptyList()),
            "api/verification-aamva.json" to ("verification/aamva" to emptyList()),
            "api/verification-phone-number.json" to ("verification/phone-number" to emptyList()),
            "api/verification-email-address.json" to ("verification/email-address" to emptyList()),
            "api/verification-government-id-nfc.json" to ("verification/government-id-nfc" to emptyList()),
            "api/verification-crypto-wallet.json" to ("verification/crypto-wallet" to emptyList()),
            "api/verification-database-business.json" to ("verification/database-business" to emptyList()),
            "api/verification-business-website.json" to ("verification/business-website" to emptyList()),
        )

        val FAILED_CONDITION: JsonObject = buildJsonObject {
            put(
                "==",
                buildJsonArray {
                    add(buildJsonObject { put("var", "inquiry.status") })
                    add(JsonPrimitive("failed"))
                },
            )
        }

        val DEFAULT_FLOW_STEPS: List<FlowStep> = listOf(
            // C45.1, C42.3: the optional matching consent, with its own checkbox.
            ConsentStep(
                id = "consent",
                // C94.6: the session-integrity notice is a required text of the default template.
                textKeys = listOf("consent.biometric", "consent.processing", "notice.session-integrity"),
                required = true,
                optionalTextKeys = listOf("consent.biometric-matching"),
            ),
            GovernmentIdStep(
                id = "government_id",
                sides = DocumentSides.BOTH,
                maxAttempts = 3,
                captureMethods = listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA),
            ),
            // C45.1: three poses with active liveness.
            SelfieStep(
                id = "selfie",
                poses = listOf(SelfiePose.CENTER, SelfiePose.LEFT, SelfiePose.RIGHT),
                liveness = Liveness.ACTIVE,
                maxAttempts = 3,
            ),
            CompletionStep(id = "completion", messageKey = "flow.completion"),
            FailureStep(id = "failure", messageKey = "flow.failure"),
        )
    }
}
