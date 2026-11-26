package dev.openverify.sdk.flow

import dev.openverify.sdk.api.ApiBaseUrl
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.FlowHttp
import dev.openverify.sdk.flow.logic.Sha256
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowShareConsentAcceptBody
import dev.openverify.sdk.model.FlowWithdrawableShareConsent
import dev.openverify.sdk.model.ShareConsentStep
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * C238.7, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the `share_consent` step on Android, in
 * `commonMain` with no platform API (iOS-ready, C256.1).
 *
 * The step's client view is composed by the server (C238.3): the SDK shows its text as served and
 * composes none. Before it reports a digest, it takes SHA-256 over the logical text it displays with
 * its own [Sha256] (C200.2): a text, or a biometric text, whose digest is not the one served is the
 * unsupported screen, so the SDK never reports a text it did not show; so is a category it has no
 * words for, since the person could not be told what is shared. "I agree" sends both digests and
 * the separate biometric tick (asked for first when the share carries biometric data); "Do not
 * share" sends nothing else; both then render where the server moved (declining never ends the
 * flow, C238.1). The digest records which text was served and reported shown, not that it was read
 * (C238.8).
 *
 * The session's `withdrawable-share-consents` (C237.6, V02) are offered on every later screen and the
 * completion screen ([ShareConsentWithdrawals], through `StepScaffold`'s hook). A withdrawal is the
 * one exit on a step already passed: it never moves the position, so the screen shown stays.
 * Nothing here is logged, and no token, connection or consent-record id is ever held (C238.5).
 */

/** The share categories this SDK has words for (C230.4's `SHARE_CATEGORIES`), in their order. */
internal val SHARE_CATEGORIES: List<String> = listOf(
    "identity-fields",
    "contact-fields",
    "other-fields",
    "document-images",
    "biometric",
    "check-results",
)

/** What the share-consent screen shows: the step's client view, and whether a choice is on its way or the tick is missing. */
internal data class ShareConsentView(
    val step: ShareConsentStep,
    val submitting: Boolean = false,
    val tickMissing: Boolean = false,
)

/** The flow state of a `share_consent` step (C238.7). */
internal data class ShareConsentState(val view: ShareConsentView) : FlowState

/** The share-consent view [this] state shows, or `null` for any other state. */
internal fun FlowState.shareConsentView(): ShareConsentView? = (this as? ShareConsentState)?.view

/**
 * The state for [step] as served: the share-consent screen, or the unsupported screen (naming what
 * failed, never the step id) when a displayed text's digest is not the one served or a category has
 * no words here.
 */
internal fun shareConsentState(step: ShareConsentStep): FlowState = when {
    step.categories.any { it !in SHARE_CATEGORIES } -> FlowState.Unsupported("share_consent category")
    Sha256.hexOfUtf8(step.text.body) != step.text.sha256 -> FlowState.Unsupported("share_consent text")
    step.biometric?.let { Sha256.hexOfUtf8(it.body) != it.sha256 } == true -> FlowState.Unsupported("share_consent biometric text")
    else -> ShareConsentState(ShareConsentView(step))
}

/** C194.1: the step registry's renderer of `share_consent`, from its client view alone. */
internal val shareConsentRenderer: StepRenderer = StepRenderer { step, session ->
    val shown = step as? ShareConsentStep ?: return@StepRenderer StepRegistry.unsupported.render(step, session)
    StepRendering.Shown(shareConsentState(shown))
}

/**
 * C237.6: the withdrawal affordance's model: this session's withdrawable share consents, the step
 * whose withdrawal is on its way, the recipient of the last one withdrawn here, and whether the last
 * withdrawal was refused.
 */
internal data class ShareConsentWithdrawals(
    val entries: List<FlowWithdrawableShareConsent> = emptyList(),
    val busyStepId: String? = null,
    val withdrawnRecipient: String? = null,
    val failed: Boolean = false,
) {
    internal companion object {
        val NONE: ShareConsentWithdrawals = ShareConsentWithdrawals()
    }
}

/** What [ShareConsentController] needs of the coordinator. */
internal interface ShareConsentHost {
    val api: FlowApi

    /** The state shown now. */
    val shown: FlowState

    fun show(state: FlowState)

    /** Takes an exit's answer: the session at its new position, rendered. */
    suspend fun answered(session: FlowSession)

    /** Takes a withdrawal's answer: the session where it was, adopted without rendering. */
    fun adopt(session: FlowSession)

    /** Reads the session and renders its position (C193.5). */
    suspend fun readAndRender()

    /** A failed call, as every step's: the ending, a read of a moved position, or the error screen with [retry]. */
    suspend fun failed(error: FlowApiException, retry: suspend () -> Unit)
}

/** The coordinator's side of the `share_consent` step and of the withdrawal affordance. */
internal class ShareConsentController(private val host: ShareConsentHost) {

    private val mutableWithdrawals = MutableStateFlow(ShareConsentWithdrawals.NONE)

    /** This session's withdrawable share consents and the state of a withdrawal (C237.6). */
    val withdrawals: StateFlow<ShareConsentWithdrawals> = mutableWithdrawals.asStateFlow()

    /** Every session adopted: its withdrawable share consents replace the ones offered. */
    fun adopt(session: FlowSession) {
        mutableWithdrawals.value = mutableWithdrawals.value.copy(entries = session.withdrawableShareConsents.orEmpty())
    }

    /** C238.4: accepts the shown step with [biometricTicked]; the tick is asked for first when the share carries biometric data. */
    suspend fun accept(biometricTicked: Boolean) {
        val shown = host.shown as? ShareConsentState ?: return
        if (shown.view.submitting) return
        val step = shown.view.step
        val biometric = step.biometric
        if (biometric != null && !biometricTicked) {
            host.show(ShareConsentState(shown.view.copy(tickMissing = true)))
            return
        }
        // The digests of the texts as displayed, taken again here: a text that is not the one served is never reported shown.
        val text = Sha256.hexOfUtf8(step.text.body)
        val biometricText = biometric?.body?.let(Sha256::hexOfUtf8)
        if (text != step.text.sha256 || biometricText != biometric?.sha256) {
            host.show(shareConsentState(step))
            return
        }
        host.show(ShareConsentState(shown.view.copy(submitting = true, tickMissing = false)))
        val answered = try {
            host.api.acceptShareConsent(step.id, text, biometricText, explicitBiometric = biometric != null && biometricTicked)
        } catch (e: FlowApiException) {
            if (e.isTextMismatch()) host.readAndRender() else host.failed(e) { retake(shown, biometricTicked) }
            return
        } catch (_: IllegalArgumentException) {
            host.show(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false))
            return
        }
        host.answered(answered)
    }

    /** C238.1: declines the shown step; the flow goes on. */
    suspend fun decline() {
        val shown = host.shown as? ShareConsentState ?: return
        if (shown.view.submitting) return
        val step = shown.view.step
        host.show(ShareConsentState(shown.view.copy(submitting = true, tickMissing = false)))
        val answered = try {
            host.api.declineShareConsent(step.id)
        } catch (e: FlowApiException) {
            host.failed(e) { host.show(shown); decline() }
            return
        } catch (_: IllegalArgumentException) {
            host.show(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false))
            return
        }
        host.answered(answered)
    }

    /**
     * C237.6: withdraws this session's accepted share consent of [stepId], one listed in the session
     * only. The position never moves, so the screen shown stays; a refusal is said by the affordance,
     * and an answer that ends the session ends the flow as any call's does.
     */
    suspend fun withdraw(stepId: String) {
        val current = mutableWithdrawals.value
        val entry = current.entries.firstOrNull { it.stepId == stepId } ?: return
        if (current.busyStepId != null) return
        mutableWithdrawals.value = current.copy(busyStepId = stepId, failed = false)
        val answered = try {
            host.api.withdrawShareConsent(stepId)
        } catch (e: FlowApiException) {
            mutableWithdrawals.value = current.copy(busyStepId = null, failed = true)
            if (e is FlowApiException.Unauthorized || e is FlowApiException.Redacted || e is FlowApiException.LinkRefused) host.failed(e) {}
            return
        } catch (_: IllegalArgumentException) {
            mutableWithdrawals.value = current.copy(busyStepId = null, failed = true)
            return
        }
        host.adopt(answered)
        mutableWithdrawals.value = ShareConsentWithdrawals(answered.withdrawableShareConsents.orEmpty(), withdrawnRecipient = entry.recipientName)
    }

    private suspend fun retake(shown: ShareConsentState, biometricTicked: Boolean) {
        host.show(shown)
        accept(biometricTicked)
    }

    /** C238.4: the server's 422 `consent_text_mismatch`: the text changed since it was served, so the session is read again. */
    private fun FlowApiException.isTextMismatch(): Boolean =
        this is FlowApiException.Rejected && status == 422 && problem?.code == FlowProblemCodes.CONSENT_TEXT_MISMATCH
}

/** The three share-consent exits as the flow API client sends them (C238.4, C237.6), over its HTTP client, API base and authorization. */
internal object ShareConsentRequests {
    /** C147.2 `STEP_ID_PATTERN`: a step id, a path segment of every exit. */
    private val STEP_ID = Regex("[a-z][a-z0-9_-]{0,63}")

    private fun url(apiBase: ApiBaseUrl, stepId: String, exit: String): String {
        // Validated rather than only encoded: `..` would be resolved as a dot segment.
        require(STEP_ID.matches(stepId)) { "Not a step id (C147.2)" }
        return apiBase.resolve("api", "v1", "flow", "share-consents", stepId, exit)
    }

    /** `POST /api/v1/flow/share-consents/:stepId/accept` (`flowShareConsentAcceptBodySchema`). */
    suspend fun accept(
        http: FlowHttp,
        apiBase: ApiBaseUrl,
        authorization: String,
        stepId: String,
        textSha256: String,
        biometricTextSha256: String?,
        explicitBiometric: Boolean,
    ): FlowSession {
        val url = url(apiBase, stepId, "accept")
        val body = FlowShareConsentAcceptBody(textSha256, biometricTextSha256, explicitBiometric)
        return http.send(HttpMethod.Post, url, FlowSession.serializer(), authorization, http.jsonBody(FlowShareConsentAcceptBody.serializer(), body))
    }

    /** `POST /api/v1/flow/share-consents/:stepId/decline` with an empty object. */
    suspend fun decline(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String, stepId: String): FlowSession =
        http.send(HttpMethod.Post, url(apiBase, stepId, "decline"), FlowSession.serializer(), authorization, TextContent("{}", FlowHttp.JSON))

    /** `POST /api/v1/flow/share-consents/:stepId/withdraw` with an empty object. */
    suspend fun withdraw(http: FlowHttp, apiBase: ApiBaseUrl, authorization: String, stepId: String): FlowSession =
        http.send(HttpMethod.Post, url(apiBase, stepId, "withdraw"), FlowSession.serializer(), authorization, TextContent("{}", FlowHttp.JSON))
}
