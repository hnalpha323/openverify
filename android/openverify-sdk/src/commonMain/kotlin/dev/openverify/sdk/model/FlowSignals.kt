package dev.openverify.sdk.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * C96.3 (Phase 7): the inquiry's handoff step state on `GET /api/v1/flow/session` (`handoff`), kept
 * per inquiry and step (V05): `pending`, `issued`, `redeemed`, `continued_here`, `skipped`,
 * `rejected` or `declined`.
 */
@Serializable
internal data class FlowHandoff(
    @SerialName("step-id") val stepId: String,
    val state: String,
    /** K7A-5: `true` for the issuing session while the phone works; an SDK session never reads it. */
    @SerialName("handed-off") val handedOff: Boolean? = null,
) {
    /** Whether the step is done (redeemed, continued here or skipped, F01). */
    val done: Boolean get() = state in DONE_STATES

    private companion object {
        val DONE_STATES = setOf("redeemed", "continued_here", "skipped")
    }
}

/**
 * The tiers `GET /api/v1/flow/session` reports once consent is recorded (contract
 * `flowSessionSignalsSchema`, C94.6): `null` before, so nothing is read before then.
 */
@Serializable
internal data class FlowSessionSignals(
    val integrity: Boolean,
    val recognition: Boolean,
    /** K7A-7: one past the session's highest body, so a later launch is not ignored as a repeat. */
    @SerialName("next-sequence") val nextSequence: Int? = null,
)

/**
 * The Android body of `POST /api/v1/flow/signals` (contract `flowSignalsSchema`, C94.2, C94.7):
 * the platform, the collector version, the screen and a sequence, then Android's own members.
 * The browser members are web-only and never sent from here.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
internal data class FlowSignals(
    /** Always sent: the contract requires it, and [OpenVerifyJson] leaves other defaults out. */
    @EncodeDefault val platform: String = "android",
    @SerialName("collector-version") val collectorVersion: Int,
    val screen: String,
    val sequence: Int,
    @SerialName("android-integrity") val androidIntegrity: AndroidIntegritySignals? = null,
    @SerialName("android-recognition") val androidRecognition: AndroidRecognitionSignals? = null,
    /** `smartphone` or `tablet`: an SDK session's `device-type` (C94.5). */
    @SerialName("device-class") val deviceClass: String? = null,
    /** Sandbox environments only (C90.9): `bot` or `human`. */
    @SerialName("sandbox-outcome") val sandboxOutcome: String? = null,
)

/**
 * Session integrity on Android (C94.7): the debugger facts; and (C210.2, Workflow 10B) the indicator
 * codes of the emulator, root and hooking probes, each null (left out) when no probe ran and empty when
 * the probes found nothing. Codes only, each from `AndroidSignalContract`'s closed lists.
 */
@Serializable
internal data class AndroidIntegritySignals(
    @SerialName("debugger-connected") val debuggerConnected: Boolean,
    @SerialName("app-debuggable") val appDebuggable: Boolean,
    @SerialName("emulator-indicators") val emulatorIndicators: List<String>? = null,
    @SerialName("root-indicators") val rootIndicators: List<String>? = null,
    @SerialName("hooking-indicators") val hookingIndicators: List<String>? = null,
)

/** Device recognition on Android (C94.7): `Settings.Secure.ANDROID_ID`, only under its tier. */
@Serializable
internal data class AndroidRecognitionSignals(
    @SerialName("android-id") val androidId: String,
) {
    /** The identifier is personal data: never printed (C91.6). */
    override fun toString(): String = "AndroidRecognitionSignals(androidId=<redacted>)"
}
