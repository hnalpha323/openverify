package dev.openverify.sdk

import dev.openverify.sdk.model.InquiryStatus

/** How a verification flow launched with [OpenVerifyInquiry.Contract] ended. */
public sealed interface InquiryResult {
    /** `null` only when the request was too malformed to name an inquiry. */
    public val inquiryId: String?

    /**
     * The flow reached its end. [inquiryStatus] is the inquiry's status at that moment, usually
     * [InquiryStatus.COMPLETED]. Confirm the outcome on your server (webhooks or the API).
     */
    public data class Completed(override val inquiryId: String, val inquiryStatus: InquiryStatus) : InquiryResult

    /** The flow ended without completing; [reason] says why. */
    public data class Failed(override val inquiryId: String?, val reason: FailureReason) : InquiryResult

    /** The user left before the flow ended. The inquiry can be resumed later. */
    public data class Canceled(override val inquiryId: String?) : InquiryResult
}

public enum class FailureReason {
    /** The inquiry failed: the flow reached its failure step. */
    INQUIRY_FAILED,

    /** The inquiry expired before the user finished it. Create a new inquiry to verify the user. */
    INQUIRY_EXPIRED,

    /** The session token was refused or has expired. Create a new session and launch again. */
    SESSION_EXPIRED,

    /**
     * The session was canceled: its inquiry left `created` or `pending` (finished elsewhere).
     * Check the inquiry on your server before starting again. A session canceled because its
     * inquiry expired or was redacted reports [INQUIRY_EXPIRED] or [INQUIRY_REDACTED] (C25.8).
     */
    SESSION_CANCELED,

    /** The inquiry was redacted, so nothing more can be collected for it. */
    INQUIRY_REDACTED,

    /**
     * The one-time link was refused: already used, expired, revoked or unknown. Generate a new
     * link to start again.
     */
    LINK_INVALID,

    /** The inquiry ID, session token or API base URL was malformed, or they did not match. */
    INVALID_REQUEST,

    /** The flow needs a step or rule this SDK version does not support. */
    UNSUPPORTED_FLOW,

    /** The server could not be reached and the user closed the flow. */
    NETWORK_ERROR,

    /** The server refused a request or answered unexpectedly, and the user closed the flow. */
    SERVER_ERROR,

    /**
     * The photos were submitted, but the server had not yet decided them, or had not yet decided
     * the inquiry after its last attempt, when the user closed the flow. The decision still
     * happens on the server; it reaches you through webhooks.
     */
    STILL_PROCESSING,

    /**
     * The server stopped the flow at its loop limits (C151.2, C197.2): this device cannot continue
     * it. An operator must resume or expire the inquiry; check it on your server.
     */
    FLOW_HALTED,
}
