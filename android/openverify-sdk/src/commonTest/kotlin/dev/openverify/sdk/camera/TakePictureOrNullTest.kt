package dev.openverify.sdk.camera

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertSame

/**
 * 1B F025 in common code: a capture failure becomes a missing photo the user can retake, a frame
 * too large for the heap included, while cancellation and every other error still propagate.
 */
class TakePictureOrNullTest {

    private class ScriptedCamera(private val shot: () -> CapturedImage) : CaptureCamera {
        @Composable
        override fun Preview(lens: CameraLens, modifier: Modifier) = Unit

        override suspend fun takePicture(): CapturedImage = shot()
    }

    private val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")

    @Test
    fun passesAPhotoThrough() = runTest {
        assertEquals(photo, ScriptedCamera { photo }.takePictureOrNull())
    }

    @Test
    fun turnsAnExceptionIntoAMissingPhoto() = runTest {
        assertNull(ScriptedCamera { throw IllegalStateException("use case not bound") }.takePictureOrNull())
    }

    @Test
    fun turnsAnOutOfMemoryErrorIntoAMissingPhoto() = runTest {
        assertNull(ScriptedCamera { throw outOfMemoryError() }.takePictureOrNull())
    }

    @Test
    fun letsCancellationPropagate() = runTest {
        val cancellation = CancellationException("left the screen")

        val thrown = assertFailsWith<CancellationException> { ScriptedCamera { throw cancellation }.takePictureOrNull() }

        assertSame(cancellation, thrown)
    }

    @Test
    fun letsAnyOtherErrorPropagate() = runTest {
        val error = AssertionError("not a capture failure")

        val thrown = assertFailsWith<AssertionError> { ScriptedCamera { throw error }.takePictureOrNull() }

        assertSame(error, thrown)
    }
}
