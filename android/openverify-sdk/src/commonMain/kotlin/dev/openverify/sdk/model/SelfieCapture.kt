package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The selfie capture protocol (C40.2-C40.4). Member names are kebab-case on the wire, as in
// `@openverify/contracts` (`selfie-captures.ts`).

/** `POST /api/v1/flow/verifications/:id/selfies`, answered 201: the only place the nonce appears. */
@Serializable
internal data class FlowSelfieCaptureDocument(val data: FlowSelfieCapture)

/**
 * A selfie capture as the flow sees it when it is created (C40.2): the poses to prompt for, in
 * the server's order, when it expires, and its nonce. Each pose is uploaded with the capture's id
 * and nonce before the next prompt, and submit names the capture once.
 */
@Serializable
internal data class FlowSelfieCapture(
    /** Always `selfie`. */
    val type: String,
    /** `self_` plus a ULID. */
    val id: String,
    val attributes: FlowSelfieCaptureAttributes,
) {
    init {
        requireCaptureId(id)
    }
}

@Serializable
internal data class FlowSelfieCaptureAttributes(
    /** The poses to prompt for, in this order: `center` first, each pose once. */
    val prompts: List<SelfiePose>,
    @SerialName("expires-at") val expiresAt: String,
    /** Proves possession of this answer. It is kept in memory only, so [toString] leaves it out. */
    val nonce: String,
    /** The server's pose thresholds; on-device guidance uses them (Phase 10). */
    val guidance: SelfieCaptureGuidance,
) {
    init {
        requireNonce(nonce)
        require(prompts.firstOrNull() == SelfiePose.CENTER) { "A capture prompts for center first" }
        require(prompts.toSet().size == prompts.size) { "A capture prompts for each pose once" }
    }

    override fun toString(): String =
        "FlowSelfieCaptureAttributes(prompts=$prompts, expiresAt=$expiresAt, nonce=<redacted>, guidance=$guidance)"
}

/** C40.2 `guidance`, from the template's pose config and C40.11. */
@Serializable
internal data class SelfieCaptureGuidance(
    @SerialName("max-center-yaw-ratio") val maxCenterYawRatio: Double,
    @SerialName("min-side-yaw-ratio-change") val minSideYawRatioChange: Double,
    @SerialName("hold-ms") val holdMs: Int,
)

/** The C40.3 multipart fields that tie a selfie pose upload to its capture. */
internal data class SelfieCaptureUpload(
    /** The capture's `self_` id. */
    val captureId: String,
    /** The capture's nonce. */
    val nonce: String,
    /** Milliseconds from the capture's creation to the photo, on the device's monotonic clock. */
    val clientElapsedMs: Long,
) {
    init {
        requireCaptureId(captureId)
        requireNonce(nonce)
        require(clientElapsedMs in 0..MAX_CLIENT_ELAPSED_MS) { "client-elapsed-ms must be 0 to $MAX_CLIENT_ELAPSED_MS" }
    }

    override fun toString(): String =
        "SelfieCaptureUpload(captureId=$captureId, nonce=<redacted>, clientElapsedMs=$clientElapsedMs)"

    public companion object {
        /** The largest `client-elapsed-ms` the flow API accepts: ten minutes (C40.3 `CLIENT_ELAPSED_MS_MAX`). */
        public const val MAX_CLIENT_ELAPSED_MS: Long = 600_000
    }
}

/** `POST /api/v1/flow/verifications/:id/submit` body (C40.4). A government ID sends none. */
@Serializable
internal data class FlowSubmitVerificationBody(val capture: FlowSubmitCapture? = null)

/** The capture a selfie submit consumes, with what the camera reported about itself. */
@Serializable
internal data class FlowSubmitCapture(
    val id: String,
    val nonce: String,
    /** The camera's facts: client claims, for risk signals only. Absent for uploaded photos. */
    val device: SelfieDeviceSnapshot? = null,
) {
    init {
        requireCaptureId(id)
        requireNonce(nonce)
    }

    override fun toString(): String = "FlowSubmitCapture(id=$id, nonce=<redacted>, device=$device)"
}

/**
 * The C40.4 device snapshot. Every member is optional; the server refuses unknown ones. The SDK
 * maps CameraX facts onto it: the camera id into [label], the lens facing into
 * [SelfieDeviceSettings.facingMode], the resolution into its width and height, the frame rate into
 * its frame rate, and [imageMirrored] as the uploaded JPEG actually is.
 */
@Serializable
internal data class SelfieDeviceSnapshot(
    val label: String? = null,
    val settings: SelfieDeviceSettings? = null,
    val capabilities: SelfieDeviceCapabilities? = null,
    @SerialName("frame-stats") val frameStats: SelfieFrameStats? = null,
    val webdriver: Boolean? = null,
    @SerialName("image-mirrored") val imageMirrored: Boolean? = null,
) {
    /** A camera label can carry a person's name (C40.5), so it is never printed. */
    override fun toString(): String =
        "SelfieDeviceSnapshot(label=${if (label == null) "null" else "<redacted>"}, settings=$settings, " +
            "capabilities=$capabilities, frameStats=$frameStats, webdriver=$webdriver, imageMirrored=$imageMirrored)"
}

@Serializable
internal data class SelfieDeviceSettings(
    val width: Int? = null,
    val height: Int? = null,
    @SerialName("frame-rate") val frameRate: Double? = null,
    @SerialName("facing-mode") val facingMode: FacingMode? = null,
    @SerialName("resize-mode") val resizeMode: ResizeMode? = null,
)

@Serializable
internal data class SelfieDeviceCapabilities(
    @SerialName("width-max") val widthMax: Int? = null,
    @SerialName("height-max") val heightMax: Int? = null,
    @SerialName("frame-rate-max") val frameRateMax: Double? = null,
    @SerialName("facing-modes") val facingModes: List<FacingMode>? = null,
)

@Serializable
internal data class SelfieFrameStats(
    val delivered: Long? = null,
    val discarded: Long? = null,
    val total: Long? = null,
)

/** Which way a camera faces, in the web's `facingMode` vocabulary. */
@Serializable
internal enum class FacingMode {
    /** Towards the user: a front camera. */
    @SerialName("user")
    USER,

    /** Away from the user: a back camera. */
    @SerialName("environment")
    ENVIRONMENT,

    @SerialName("left")
    LEFT,

    @SerialName("right")
    RIGHT,
}

@Serializable
internal enum class ResizeMode {
    @SerialName("none")
    NONE,

    @SerialName("crop-and-scale")
    CROP_AND_SCALE,
}

/** `self_` plus a ULID in upper-case Crockford base32 (contract C1, C40.1). */
private val CAPTURE_ID = Regex("self_[0-9A-HJKMNP-TV-Z]{26}")

/** 128 bits as base64url without padding (C40.2). */
private val NONCE = Regex("[A-Za-z0-9_-]{22}")

private fun requireCaptureId(id: String) = require(CAPTURE_ID.matches(id)) { "Not a selfie capture ID" }

/** The message never repeats the value: a nonce is a secret. */
private fun requireNonce(nonce: String) = require(NONCE.matches(nonce)) { "A nonce is 22 base64url characters" }
