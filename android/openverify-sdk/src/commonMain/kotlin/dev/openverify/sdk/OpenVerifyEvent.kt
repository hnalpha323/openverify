package dev.openverify.sdk

/**
 * What the flow tells an installed [OpenVerifyEventListener] (C192), for UI coordination only.
 * Events can be missed (process death, a crash), and the server is the source of truth: read the
 * inquiry on your server. No event carries a field value, token, image, chip byte, MRZ, signal,
 * check result, server message, URL or step id; a step is named by its flow-spec **type** only,
 * such as `government_id`.
 */
public sealed interface OpenVerifyEvent {
    /** The flow started for [inquiryId]. */
    public data class Started(val inquiryId: String) : OpenVerifyEvent

    /** A step of flow-spec type [stepType] is shown. */
    public data class StepShown(val stepType: String) : OpenVerifyEvent

    /** The person answered the camera permission. */
    public data class CameraPermission(val granted: Boolean) : OpenVerifyEvent

    /** A capture failed on the device for [reason]. */
    public data class CaptureFailed(val reason: CaptureFailureReason) : OpenVerifyEvent

    /** The person submitted a step of flow-spec type [stepType]. */
    public data class Submitted(val stepType: String) : OpenVerifyEvent

    /** The server is deciding; the person waits. */
    public data object Waiting : OpenVerifyEvent

    /** The flow ended on this device with [result]. */
    public data class Ended(val result: InquiryResultKind) : OpenVerifyEvent
}

/** Why a capture failed on the device (C192.2), a closed list. */
public enum class CaptureFailureReason {
    CAMERA_UNAVAILABLE,
    CAMERA_ERROR,
    OUT_OF_MEMORY,
}

/** The kind of [InquiryResult] a flow ended with (C192.2). */
public enum class InquiryResultKind {
    COMPLETED,
    FAILED,
    CANCELED,
}

/**
 * Receives [OpenVerifyEvent]s on the main thread (C192.1). It must not block; an exception it
 * throws is caught and dropped, so it never stops the flow.
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = { event -> analytics.track(event) }))
 * ```
 */
public fun interface OpenVerifyEventListener {
    public fun onEvent(event: OpenVerifyEvent)
}
