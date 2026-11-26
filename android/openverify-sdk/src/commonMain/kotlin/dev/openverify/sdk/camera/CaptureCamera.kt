package dev.openverify.sdk.camera

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * The camera behind the capture screens. The SDK uses CameraX on devices; tests use a fake, so
 * no screen logic depends on camera hardware.
 */
internal interface CaptureCamera {
    /** Shows the live preview of [lens] and readies it for [takePicture]. */
    @Composable
    fun Preview(lens: CameraLens, modifier: Modifier)

    /**
     * C201.2: shows the live preview of [lens] with its analysis frames read at [analysis]'s size (a
     * card or a page, an ID's back, a selfie). A camera without analysis shows the plain preview.
     */
    @Composable
    fun Preview(lens: CameraLens, analysis: AnalysisTarget, modifier: Modifier) = Preview(lens, modifier)

    /**
     * Takes a photo with the lens the preview shows.
     *
     * @throws CameraCaptureException if the camera could not take it.
     */
    suspend fun takePicture(): CapturedImage

    /**
     * What the camera that took the last photo reports about itself (C40.4), or `null` when it is
     * not known. The selfie submit sends it as the capture's device snapshot.
     */
    fun deviceFacts(): CameraFacts? = null

    /**
     * C201.1 (Workflow 10B): the preview's analysis frames while it is shown, sampled for guidance;
     * none by default, so a fake, the iOS placeholder and a camera that bound only preview and capture
     * (C201.3's fallback) claim nothing and the step keeps the manual shutter. Each frame is valid only
     * inside the collector's callback ([AnalysisFrame]).
     */
    fun frames(): Flow<AnalysisFrame> = emptyFlow()

    /**
     * KP10-14 (C192.2): [listener] is told each time this camera's preview could bind no use case at
     * all, so the step shows "camera unavailable" (`CaptureFailureReason.CAMERA_UNAVAILABLE`); a
     * fallback to preview and capture without analysis (C201.3) is not one. A camera that never fails
     * to bind (a fake, the iOS placeholder) keeps no listener. The last listener given replaces any
     * earlier one.
     */
    fun reportUnavailableTo(listener: () -> Unit) = Unit
}

/** The camera could not take a photo. The user can try again. */
internal class CameraCaptureException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Takes a photo, or returns `null` when the camera failed in any way (1B F025): CameraX and the
 * frame conversion can throw more than [CameraCaptureException], and none of it may crash the
 * host app. A frame too large for the heap is dropped the same way. The user then sees a
 * recoverable "could not take the photo" message. Cancellation and every other error still
 * propagate. Common Kotlin has no `OutOfMemoryError` type, hence the one catch and [isOutOfMemory].
 */
internal suspend fun CaptureCamera.takePictureOrNull(): CapturedImage? = try {
    takePicture()
} catch (e: Throwable) {
    when {
        e is CancellationException -> throw e
        e is Exception || isOutOfMemory(e) -> null
        else -> throw e
    }
}
