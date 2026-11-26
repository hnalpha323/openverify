package dev.openverify.sdk.camera

import dev.openverify.sdk.model.FacingMode
import dev.openverify.sdk.model.SelfieDeviceCapabilities
import dev.openverify.sdk.model.SelfieDeviceSettings
import dev.openverify.sdk.model.SelfieDeviceSnapshot

/**
 * What the camera that took a selfie reports about itself, as CameraX gives it (C40.4). These are
 * client claims: the server records them as risk signals and never decides on them alone.
 */
internal data class CameraFacts(
    /** CameraX's camera ids (Camera2 ids such as `1`); a logical multi-camera has several. */
    val cameraIds: List<String> = emptyList(),
    /** A [LensFacing] code (CameraX's `CameraSelector.LENS_FACING_*`). */
    val lensFacing: Int = LensFacing.UNKNOWN,
    /** The photo's size as the camera captured it, upright. */
    val width: Int? = null,
    val height: Int? = null,
    /** The frame rate the camera ran at: the upper bound of its auto-exposure target range. */
    val frameRate: Int? = null,
    /** The highest frame rate the camera supports. */
    val frameRateMax: Int? = null,
)

/**
 * The codes of [CameraFacts.lensFacing], as plain `Int`s so the facts are common code. They are
 * CameraX's `CameraSelector.LENS_FACING_*` values, which `CameraXCaptureCamera` passes on as they are.
 */
internal object LensFacing {
    const val UNKNOWN: Int = -1
    const val FRONT: Int = 0
    const val BACK: Int = 1
    const val EXTERNAL: Int = 2
}

/**
 * The C40.4 device snapshot for these facts: the camera ids as `label`, the lens facing as
 * `settings.facing-mode`, the resolution as `settings.width`/`height`, the frame rate as
 * `settings.frame-rate`, the supported maximum as `capabilities.frame-rate-max`, and
 * `image-mirrored` as the uploaded JPEG is ([CAPTURE_MIRRORS_IMAGES]). A value outside the
 * server's bounds is left out rather than sent. Without facts, only `image-mirrored` is known.
 */
internal fun CameraFacts?.toDeviceSnapshot(): SelfieDeviceSnapshot {
    val facing = when (this?.lensFacing) {
        LensFacing.FRONT -> FacingMode.USER
        LensFacing.BACK -> FacingMode.ENVIRONMENT
        // An external camera can face anywhere; the web reports none for it either.
        else -> null
    }
    val settings = SelfieDeviceSettings(
        width = this?.width?.takeIf { it in PIXELS },
        height = this?.height?.takeIf { it in PIXELS },
        frameRate = this?.frameRate?.takeIf { it in FRAME_RATES }?.toDouble(),
        facingMode = facing,
    )
    val capabilities = SelfieDeviceCapabilities(frameRateMax = this?.frameRateMax?.takeIf { it in FRAME_RATES }?.toDouble())
    return SelfieDeviceSnapshot(
        label = this?.cameraIds?.takeIf { it.isNotEmpty() }?.joinToString(",")?.let(::cleanDeviceLabel)?.ifEmpty { null },
        settings = settings.takeIf { it != SelfieDeviceSettings() },
        capabilities = capabilities.takeIf { it != SelfieDeviceCapabilities() },
        imageMirrored = CAPTURE_MIRRORS_IMAGES,
    )
}

/** C40.4 bounds: pixels 1 to 16,384; frame rates are whole numbers here, so 1 to 1,000. */
private val PIXELS = 1..16_384
private val FRAME_RATES = 1..1_000
