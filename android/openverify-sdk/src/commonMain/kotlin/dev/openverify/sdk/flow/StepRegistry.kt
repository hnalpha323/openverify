package dev.openverify.sdk.flow

import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.UnsupportedStep
import dev.openverify.sdk.ui.screen.screenCopyComplete
import dev.openverify.sdk.ui.screen.screenUnsupportedReason

/**
 * How the driver renders the client view of the step the server's position names (C194.1).
 * [Shown] steps are shown from their client view alone; [Run] steps are consent and the
 * verification steps, whose own work (create or reuse, capture or enter, upload, submit, poll) the
 * coordinator runs before it reads the session again (C193.4).
 */
internal sealed interface StepRendering {
    data class Shown(val state: FlowState) : StepRendering

    data object Run : StepRendering
}

/**
 * Turns a client view into its rendering (C194.1, decision 8). A type outside
 * [StepRegistry.renderers], a known type whose client view failed to decode ([UnsupportedStep]), or
 * a member the SDK cannot honour renders the unsupported screen, which names no step id and is
 * never skipped.
 */
internal fun interface StepRenderer {
    fun render(step: FlowStep, session: FlowSession): StepRendering
}

/**
 * The step registry (C194). Every client-view step type of flow-spec 2 has a renderer: consent and
 * the verification steps run in the coordinator, `screen`, `completion` and `failure` are shown from
 * their client views, `nfc` runs in the coordinator through `nfc-sdk`'s `NfcStepController`
 * (C207, Workflow 10C), and `device_handoff` (the server skips it for every SDK session, C221.13;
 * if served anyway) is the unsupported screen. Phase 11 adds `share_consent` without a format change,
 * shown from its server-composed client view by `clients-connect`'s renderer (C238.7, Workflow 11A).
 */
internal object StepRegistry {
    /** KP10-8: the reason of a screen whose component text no copy holds in a language the person could pick. */
    const val SCREEN_COPY: String = "screen copy"

    /** The unsupported screen, naming the type for diagnostics and never the step id. */
    val unsupported: StepRenderer = StepRenderer { step, _ -> StepRendering.Shown(FlowState.Unsupported("step ${step.type}")) }

    /** Consent and the verification steps: the coordinator runs them (C193.4). */
    private val run: StepRenderer = StepRenderer { _, _ -> StepRendering.Run }

    /**
     * C195, C151.5: a screen with the values bound on it, unless the screen model cannot render all
     * of it (a later component kind, C148.6's caps, a refused visibility rule: C194.3, C195.9), which
     * is the unsupported screen as a whole, never a partial screen.
     */
    private val screen: StepRenderer = StepRenderer { step, session ->
        val shown = step as? ScreenStep ?: return@StepRenderer unsupported.render(step, session)
        val reason = screenUnsupportedReason(shown) ?: SCREEN_COPY.takeUnless { screenCopyComplete(shown, session) }
        StepRendering.Shown(reason?.let(FlowState::Unsupported) ?: FlowState.Screen(shown, session.values.orEmpty()))
    }

    /** A terminal step the position names while it is still active; `ended` is the usual state. */
    private val completion: StepRenderer = StepRenderer { step, session ->
        StepRendering.Shown(FlowState.Completed(step as? CompletionStep, session.inquiry.status))
    }

    private val failure: StepRenderer = StepRenderer { step, session ->
        StepRendering.Shown(FlowState.Failed(step as? FailureStep, session.inquiry.status))
    }

    /** Every client-view step type of flow-spec 2 (`clientStepViewSchema`), by its renderer. */
    val renderers: Map<String, StepRenderer> = CLIENT_STEP_TYPES.associateWith { type ->
        when (type) {
            "consent", "government_id", "selfie", "document", "phone_otp", "email_otp", "database", "aamva",
            "crypto_wallet", "database_business", "business_website",
            // C207 (Workflow 10C): the coordinator routes it to nfc-sdk's NfcStepController.
            "nfc",
            -> run
            "screen" -> screen
            "completion" -> completion
            "failure" -> failure
            // C238.7 (Workflow 11A): shown from its server-composed client view (clients-connect's, flow/ShareConsent.kt).
            "share_consent" -> shareConsentRenderer
            // `device_handoff` is skipped by the server for an SDK session.
            else -> unsupported
        }
    }

    /** How [step], the session's client view, renders; `null` (no view) is unsupported too. */
    fun render(step: FlowStep?, session: FlowSession): StepRendering = when {
        step == null -> StepRendering.Shown(FlowState.Unsupported("step none"))
        step is UnsupportedStep -> unsupported.render(step, session)
        else -> (renderers[step.type] ?: unsupported).render(step, session)
    }
}

/** The seventeen step types `clientStepViewSchema` sends (`packages/flow-spec/src/v2/schemas/client-view.ts`). */
internal val CLIENT_STEP_TYPES: List<String> = listOf(
    "consent", "government_id", "selfie", "document", "phone_otp", "email_otp", "database", "aamva", "nfc",
    "crypto_wallet", "database_business", "business_website", "device_handoff", "completion", "failure", "screen",
    // C238.1 (Phase 11, Workflow 11A).
    "share_consent",
)
