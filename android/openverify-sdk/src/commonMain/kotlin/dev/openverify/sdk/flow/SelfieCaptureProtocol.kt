package dev.openverify.sdk.flow

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Constants of the selfie capture protocol (C40). The shared ones come from
 * `contracts/fixtures/flow/selfie-capture.json` (C40.11), which `SelfieCaptureProtocolTest` reads.
 */
internal object SelfieCaptureProtocol {
    /**
     * How long a capture lives after the server creates it (`server.capture-ttl-seconds`). The
     * device's monotonic clock starts when the create's answer arrives, so a capture this old by
     * that clock has expired on the server too, and no photo is sent to it. The capture is created
     * only once the camera can be shown (4B H014), and each selfie prompt states the limit in whole
     * minutes (4B H015).
     */
    val CAPTURE_TTL: Duration = 180.seconds

    /** `client.camera-stays-open`: one camera session for every prompt of a capture. */
    const val CAMERA_STAYS_OPEN: Boolean = true

    /**
     * Problem codes of a 409 after which the poses go to a new capture (C40.4,
     * `SELFIE_CAPTURE_PROBLEM_CODES`): a wrong nonce, a foreign, superseded or expired capture, or a
     * submit missing a prompt's photo.
     */
    val CAPTURE_REFUSED_CODES: Set<String> = setOf("selfie_capture_invalid", "selfie_capture_incomplete")

    /** The code of the create that hit the capture cap: the verification was canceled (C40.2). */
    val CAPTURE_LIMIT_CODES: Set<String> = setOf("selfie_capture_limit")
}
