package dev.openverify.sdk.camera

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/** 1B F025: no camera failure may crash the host app. */
class CaptureCameraTest {

    private class ThrowingCamera(private val failure: () -> Throwable) : CaptureCamera {
        @Composable
        override fun Preview(lens: CameraLens, modifier: Modifier) = Unit

        override suspend fun takePicture(): CapturedImage = throw failure()
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("failures")
    fun `any capture failure becomes a missing photo the user can retake`(failure: Throwable) = runTest {
        assertNull(ThrowingCamera { failure }.takePictureOrNull())
    }

    @Test
    fun `a photo is passed through`() = runTest {
        val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")
        val camera = object : CaptureCamera {
            @Composable
            override fun Preview(lens: CameraLens, modifier: Modifier) = Unit

            override suspend fun takePicture(): CapturedImage = photo
        }

        assertEquals(photo, camera.takePictureOrNull())
    }

    @Test
    fun `cancellation is not swallowed`() = runTest {
        assertThrows<CancellationException> { ThrowingCamera { CancellationException("left the screen") }.takePictureOrNull() }
    }

    companion object {
        @JvmStatic
        fun failures(): List<Throwable> = listOf(
            CameraCaptureException("camera closed"),
            IllegalArgumentException("not an accepted image"),
            IllegalStateException("use case not bound"),
            UnsupportedOperationException("format not supported"),
            RuntimeException("camera service died"),
            // Decoding a full-resolution frame can exhaust a small heap; the frame is then dropped.
            OutOfMemoryError("bitmap"),
        )
    }
}
