package dev.openverify.sdk.api

/**
 * C171.4, C204.5: what `POST /api/v1/flow/selfie-captures/:id/extend` answers that the SDK reads, the
 * capture's id and its new expiry. The answer is the `selfie` resource (`selfieCaptureDocumentSchema`),
 * which never carries the nonce: the capture's nonce stays the one its creation returned.
 */
internal data class FlowSelfieCaptureExtension(
    /** `self_` plus a ULID. */
    val id: String,
    /** The capture's new `expires-at`. */
    val expiresAt: String,
)
