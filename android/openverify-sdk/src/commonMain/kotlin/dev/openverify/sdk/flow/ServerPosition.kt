package dev.openverify.sdk.flow

import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.i18n.CopyReview
import dev.openverify.sdk.i18n.reviewCopy
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowPositionState
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.InquiryStatus

/**
 * What the server's position names (C193.3): a state shown as it is ([Shown]), a step whose own work
 * the coordinator runs ([Run], consent and the verification steps), or a wait after which the
 * session is read again ([Wait], C197.1).
 */
internal sealed interface PositionRendering {
    data class Shown(val state: FlowState) : PositionRendering

    data class Run(val step: FlowStep) : PositionRendering

    /** The server is deciding; read the session again after [retryAfterMs] (2 s when it names none). */
    data class Wait(val retryAfterMs: Int?) : PositionRendering
}

/**
 * The server-position driver's reading of a session (C193.2, C193.3; ADR 0008). It renders
 * `position` with the client view `step` and never reads `flow.steps`, a transition or an attempt
 * count to choose a step:
 * - a decided inquiry (finished, failed or expired) shows its end, whatever the position says, as
 *   the web flow does; a review outcome shows completion and never reveals the decision;
 * - otherwise the SDK requires `spec-version: 2` and a `position`: a server before Phase 9 shows the
 *   unsupported screen, which names the older server ([SERVER_BEFORE_SPEC_2]);
 * - `active` renders the client view through [StepRegistry]; `waiting` waits (C197.1); `halted`
 *   stops (C197.2); `ended` shows the end the position names, with the inquiry's status; a state
 *   newer than this SDK is unsupported.
 */
internal object ServerPosition {
    /** C193.2: the unsupported screen's reason for a server older than flow-spec 2. */
    const val SERVER_BEFORE_SPEC_2: String = "server before flow-spec 2"

    /** C193.2: whether [session] carries what the driver requires, `spec-version: 2` and a position. */
    internal fun drives(session: FlowSession): Boolean = session.specVersion == 2 && session.position != null

    /** The end of a decided inquiry, or `null` while the person can still act on it. */
    internal fun decided(session: FlowSession): FlowState? = when (val status = session.inquiry.status) {
        InquiryStatus.COMPLETED, InquiryStatus.APPROVED, InquiryStatus.DECLINED, InquiryStatus.NEEDS_REVIEW ->
            FlowState.Completed(session.step as? CompletionStep, status)
        InquiryStatus.FAILED -> FlowState.Failed(session.step as? FailureStep, status)
        InquiryStatus.EXPIRED -> FlowState.Expired
        InquiryStatus.CREATED, InquiryStatus.PENDING, InquiryStatus.UNKNOWN -> null
    }

    /**
     * What [session]'s position names (C193.3). [review] places the session's operator copy (C199.7,
     * decision 13): a key with a legal mark that the SDK cannot place renders the step unsupported,
     * since its own words where the operator wrote a legal text would misstate it; a key with no
     * legal mark that it cannot place keeps the SDK's text, and a constant code is logged.
     */
    internal fun render(
        session: FlowSession,
        review: (FlowCopy?) -> CopyReview = { reviewCopy(it) },
        notes: CopyNotes = CopyNotes(),
    ): PositionRendering {
        val copy = review(session.copy)
        copy.unsupported.firstOrNull()?.let { key -> return PositionRendering.Shown(FlowState.Unsupported("copy $key")) }
        if (copy.ignored.isNotEmpty()) notes.ignoredKey()
        decided(session)?.let { return PositionRendering.Shown(it) }
        val position = session.position
        if (!drives(session) || position == null) return PositionRendering.Shown(FlowState.Unsupported(SERVER_BEFORE_SPEC_2))
        return when (position.state) {
            FlowPositionState.ACTIVE -> when (val rendering = StepRegistry.render(session.step, session)) {
                is StepRendering.Shown -> PositionRendering.Shown(rendering.state)
                StepRendering.Run -> PositionRendering.Run(checkNotNull(session.step))
            }
            FlowPositionState.WAITING -> PositionRendering.Wait(position.retryAfterMs)
            FlowPositionState.HALTED -> PositionRendering.Shown(FlowState.Halted)
            FlowPositionState.ENDED -> PositionRendering.Shown(ended(session))
            FlowPositionState.UNKNOWN -> PositionRendering.Shown(FlowState.Unsupported("position unknown"))
        }
    }

    /**
     * An `ended` position of an inquiry not decided yet: its failure step, or else completion, since
     * the person's part is over and the outcome comes later (a review, a workflow).
     */
    private fun ended(session: FlowSession): FlowState = when (val step = session.step) {
        is FailureStep -> FlowState.Failed(step, session.inquiry.status)
        else -> FlowState.Completed(step as? CompletionStep, session.inquiry.status)
    }
}

/**
 * What one launch has already said about its session's operator copy (K10A-3). A launch reads its
 * session after every action and on every wait, so `flow.copy_key_ignored` is logged the first time
 * only. One flag in memory: no key and no id is kept or logged, and a new launch starts a new one.
 */
internal class CopyNotes {
    private var ignoredKeyLogged = false

    internal fun ignoredKey() {
        if (ignoredKeyLogged) return
        ignoredKeyLogged = true
        SdkLog.log("flow.copy_key_ignored")
    }
}
