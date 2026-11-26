package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.RETENTION_DAYS
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.DeviceHandoffStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowHandoff
import dev.openverify.sdk.model.FlowHandoffContext
import dev.openverify.sdk.model.FlowMetadata
import dev.openverify.sdk.model.FlowPosition
import dev.openverify.sdk.model.FlowPositionState
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.ui.screen.requiredTextKeys

/**
 * An in-memory Phase 9 server for the coordinator suites (review F03): [steps] in, the position and
 * client view a Phase 9 server serves after each exit out. It is [FakeFlowApi] (every call, its
 * scripted decisions and failures, its records), and each session read also computes where a
 * Phase 9 engine stands on a linear flow (`apps/api/src/flow-engine/exits.ts`, `engine.ts`):
 * - a `consent` step exits once the consent is recorded;
 * - a verification step exits when the latest verification of its type is decided `passed`,
 *   `skipped` or `needs_review`, through its [routes] entry or else to the next step; when its
 *   attempts are used up (a failure without a retry hint, or as many failures as it allows), it
 *   takes its [fallbacks] entry, the `exhausted` edge, or else the flow ends on the step and the
 *   inquiry fails (C50.5, as `engine.ts` keeps it); when the inquiry has failed, declined or expired
 *   before that, the flow ends on the step;
 * - a `screen` exits once it is submitted, through the route of its button (`"<step>:<button>"`) or
 *   its own, and the submission answers the session at the new position (C148.5);
 * - a `device_handoff` step is passed for an SDK session (Phase 7 C96.1 amended, C221.13);
 * - a `completion` or `failure` step is `ended`; any other step stays `active` until it exits.
 *
 * Every session answer (a read, or a screen submission's) is recorded in [served], with the step's
 * client view as [currentStep]; [upcoming] serves its positions first, one per answer, and
 * [scripted] serves a wait, a halt or any position as it is. [signals] (C94.6) are served once consent is recorded and
 * [handoff] (C96.3) always, and every signal body sent is recorded in [sentSignals].
 * Each session also carries the position, the client view and `spec-version: 2`, as a Phase 9
 * server answers a client that declared spec 2. `android-driver` owns this file from Stage 3.
 */
internal class FakeFlowServer(
    steps: List<FlowStep> = FakeFlowApi.DEFAULT_FLOW.steps,
    inquiryId: String = INQUIRY_ID,
    inquiryStatus: InquiryStatus = InquiryStatus.CREATED,
    consent: FlowConsent? = null,
    verifications: List<FlowVerification> = emptyList(),
    environment: FlowEnvironment? = null,
    faceTemplateRetentionDays: Int? = RETENTION_DAYS,
    /** The tiers a consented session collects under (C94.6); served as `null` before consent. */
    var signals: FlowSessionSignals? = null,
    /** The handoff step's state (C96.3), served as it is. */
    var handoff: FlowHandoff? = null,
    /**
     * Where a step leads once it exits, by step id, in place of the next step in the list: the
     * server's branches and edges, which the SDK never reads (C151.12).
     */
    val routes: Map<String, String> = emptyMap(),
    /** A verification step's `exhausted` edge (C150.6): where it leads once its attempts are used up. */
    val fallbacks: Map<String, String> = emptyMap(),
) : FakeFlowApi(
    inquiryId = inquiryId,
    flow = Flow(FlowMetadata(specVersion = 1, id = "fake-flow-server", version = 1, name = "FakeFlowServer"), steps),
    inquiryStatus = inquiryStatus,
    consent = consent,
    verifications = verifications,
    environment = environment,
    faceTemplateRetentionDays = faceTemplateRetentionDays,
) {
    /**
     * A server for [flow]'s steps, as a test that built a v1 flow for [FakeFlowApi] passes it: its
     * transitions are the server's to evaluate, so only its steps are served (C151.12).
     */
    constructor(
        flow: Flow,
        inquiryId: String = INQUIRY_ID,
        inquiryStatus: InquiryStatus = InquiryStatus.CREATED,
        consent: FlowConsent? = null,
        verifications: List<FlowVerification> = emptyList(),
        environment: FlowEnvironment? = null,
        faceTemplateRetentionDays: Int? = RETENTION_DAYS,
        signals: FlowSessionSignals? = null,
        handoff: FlowHandoff? = null,
    ) : this(flow.steps, inquiryId, inquiryStatus, consent, verifications, environment, faceTemplateRetentionDays, signals, handoff)

    /** `position.state` (C151.5). */
    enum class State(val wire: FlowPositionState) {
        ACTIVE(FlowPositionState.ACTIVE),
        WAITING(FlowPositionState.WAITING),
        HALTED(FlowPositionState.HALTED),
        ENDED(FlowPositionState.ENDED),
    }

    /** `position` as the server serves it (C151.5). */
    data class Position(val stepId: String?, val state: State, val previousStepId: String?, val retryAfterMs: Int? = null)

    /** Every position served, one per session read, in order. */
    val served: MutableList<Position> = mutableListOf()

    /** Every `POST /flow/signals` body (C94.2), in order. */
    val sentSignals: MutableList<FlowSignals> = mutableListOf()

    /** A position served in place of the computed one (a wait, a halt), until it is cleared. */
    var scripted: Position? = null

    /** A redeemed handoff session's context (C96.3), served as it is; an SDK session never gets one. */
    var handoffContext: FlowHandoffContext? = null

    /** Positions served before [scripted] or the computed one, one per session answer, in order. */
    val upcoming: ArrayDeque<Position> = ArrayDeque()

    /**
     * The session's operator copy (C162), from the served steps: by default what a published version
     * holds, every text a screen cannot be shown without, in the default language (the server refuses
     * to publish a screen whose component text is missing there; the text here is its key), and `null`
     * for a flow with no screen. A test replaces it to serve a gap (KP10-8) or an operator's words.
     */
    var copyOf: (List<FlowStep>) -> FlowCopy? = ::publishedCopy

    /** The values bound on each screen (C151.5), served with that screen's client view only. */
    val screenValues: MutableMap<String, Map<String, FlowValue>> = mutableMapOf()

    override fun sessionAnswer(): FlowSession {
        var session = super.sessionAnswer()
        // C50.5, kept by the engine (`engine.ts` leaveIfDecided): a step whose attempts are used up
        // and that has no exhausted edge ends the flow on it and fails the inquiry, in one transaction.
        if (scripted == null && upcoming.isEmpty() && walk().settles) {
            inquiry = inquiry.copy(status = InquiryStatus.FAILED)
            session = session.copy(inquiry = inquiry)
        }
        val position = upcoming.removeFirstOrNull() ?: position()
        served += position
        val step = position.stepId?.let { id -> flow.steps.firstOrNull { it.id == id } }
        return session.copy(
            copy = copyOf(flow.steps),
            signals = signals.takeIf { session.consent != null },
            handoff = handoff,
            handoffContext = handoffContext,
            position = FlowPosition(position.stepId, position.state.wire, position.previousStepId, position.retryAfterMs),
            step = step,
            values = step?.let { screenValues[it.id] },
            specVersion = 2,
        )
    }

    override suspend fun sendSignals(signals: FlowSignals) {
        calls += "sendSignals"
        sentSignals += signals
    }

    /** The position the next session read serves. */
    fun position(): Position {
        scripted?.let { return it }
        val walked = walk()
        return when (val step = walked.current) {
            null -> Position(null, State.ENDED, walked.previous)
            is CompletionStep, is FailureStep -> Position(step.id, State.ENDED, walked.previous)
            else -> Position(step.id, if (walked.ended) State.ENDED else State.ACTIVE, walked.previous)
        }
    }

    /** The client view of the step the position names; `null` for a scripted step outside [steps]. */
    fun currentStep(): FlowStep? {
        val id = position().stepId ?: return null
        return flow.steps.firstOrNull { it.id == id }
    }

    private class Walk(val current: FlowStep?, val previous: String?, val ended: Boolean, val settles: Boolean = false)

    private fun walk(): Walk {
        val steps = flow.steps
        var previous: String? = null
        var index = 0
        val visited = mutableSetOf<Int>()
        // From the entry: each step that exited leads on through its route, else to the next step.
        while (index in steps.indices && visited.add(index)) {
            val step = steps[index]
            val next = { exit: String? -> exit?.let { target -> steps.indexOfFirst { it.id == target } } ?: (index + 1) }
            when {
                step is DeviceHandoffStep -> index += 1
                step is ConsentStep && consent != null -> {
                    previous = step.id
                    index = next(routes[step.id])
                }
                step is ConsentStep -> return Walk(step, previous, ended = false)
                step is CompletionStep || step is FailureStep -> return Walk(step, previous, ended = true)
                step is ScreenStep -> {
                    val submitted = screenSubmits.lastOrNull { it.stepId == step.id } ?: return Walk(step, previous, ended = false)
                    previous = step.id
                    index = next(submitted.button?.let { routes["${step.id}:$it"] } ?: routes[step.id])
                }
                else -> {
                    val type = verificationTypeOf(step)
                    val latest = type?.let { t -> verifications.lastOrNull { it.verificationType == t } }
                    when {
                        latest?.attributes?.status in EXITED -> {
                            previous = step.id
                            index = next(routes[step.id])
                        }
                        // C207.9: a client-unable report leaves through `exhausted` whatever attempts remain.
                        step.id in fallbacks && (exhausted(step) || clientUnableReports.any { it.first == latest?.id }) -> {
                            previous = step.id
                            index = next(fallbacks.getValue(step.id))
                        }
                        inquiry.status in ENDED_INQUIRY -> return Walk(step, previous, ended = true)
                        exhausted(step) -> return Walk(step, previous, ended = true, settles = true)
                        else -> return Walk(step, previous, ended = false)
                    }
                }
            }
        }
        return Walk(null, previous, ended = true)
    }

    /**
     * Whether [step]'s attempts are used up, as the engine judges it (`verificationTypeState`): its
     * latest attempt failed without a retry hint (never retryable, C30.1), or as many attempts as the
     * step allows failed or were canceled.
     */
    private fun exhausted(step: FlowStep): Boolean {
        val type = verificationTypeOf(step) ?: return false
        val attempts = verifications.filter { it.verificationType == type }
        val latest = attempts.lastOrNull()?.attributes ?: return false
        val usedUp = attempts.count { it.attributes.status in FAILED_ATTEMPTS } >= (stepMaxAttempts(step) ?: 1)
        return when (latest.status) {
            VerificationStatus.FAILED, VerificationStatus.REQUIRES_RETRY -> latest.retryHints.isEmpty() || usedUp
            // A canceled attempt (a cap, C40.2, C57.2) is retryable while the step has attempts left.
            VerificationStatus.CANCELED -> usedUp
            else -> false
        }
    }

    private companion object {
        val EXITED = setOf(VerificationStatus.PASSED, VerificationStatus.SKIPPED, VerificationStatus.NEEDS_REVIEW)
        val ENDED_INQUIRY = setOf(InquiryStatus.FAILED, InquiryStatus.DECLINED, InquiryStatus.EXPIRED)
        val FAILED_ATTEMPTS = setOf(VerificationStatus.FAILED, VerificationStatus.REQUIRES_RETRY, VerificationStatus.CANCELED)

        /** The verification type of each verification step type (C50.1). */
        fun verificationTypeOf(step: FlowStep): VerificationType? = when (step.type) {
            "government_id" -> VerificationType.GOVERNMENT_ID
            "selfie" -> VerificationType.SELFIE
            "document" -> VerificationType.DOCUMENT
            "phone_otp" -> VerificationType.PHONE_NUMBER
            "email_otp" -> VerificationType.EMAIL_ADDRESS
            "nfc" -> VerificationType.GOVERNMENT_ID_NFC
            "database" -> VerificationType.DATABASE
            "aamva" -> VerificationType.AAMVA
            "crypto_wallet" -> VerificationType.CRYPTO_WALLET
            "database_business" -> VerificationType.DATABASE_BUSINESS
            "business_website" -> VerificationType.BUSINESS_WEBSITE
            else -> null
        }
    }
}

/** What a published version's copy holds for [steps]: each screen's required texts in the default language, the key as its text. */
internal fun publishedCopy(steps: List<FlowStep>): FlowCopy? {
    val keys = steps.filterIsInstance<ScreenStep>().flatMap(::requiredTextKeys).distinct()
    return if (keys.isEmpty()) null else FlowCopy(mapOf("en" to keys.associateWith { it }))
}

/**
 * [this] session with [steps]' required screen texts (by default its own step's) added to its default
 * language's copy where it holds none, as a published version serves them (KP10-8); the texts it holds stay.
 */
internal fun FlowSession.withPublishedCopy(steps: List<FlowStep> = listOfNotNull(step)): FlowSession {
    val published = publishedCopy(steps)?.messages?.get("en").orEmpty()
    val messages = copy?.messages.orEmpty()
    return copy(copy = FlowCopy(messages + ("en" to published + messages["en"].orEmpty())))
}
