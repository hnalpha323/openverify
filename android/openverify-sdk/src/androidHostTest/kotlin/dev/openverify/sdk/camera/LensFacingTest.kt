package dev.openverify.sdk.camera

import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalLensFacing
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.Arguments.arguments
import org.junit.jupiter.params.provider.MethodSource

/**
 * The common lens facing codes are CameraX's own: `CameraXCaptureCamera` passes
 * `CameraInfo.lensFacing` on unchanged, and the C40.4 snapshot reads it through [LensFacing].
 */
class LensFacingTest {

    @ParameterizedTest(name = "{0}")
    @MethodSource("codes")
    fun `each common lens facing code is CameraX's`(name: String, common: Int, cameraX: Int) {
        assertEquals(cameraX, common, name)
    }

    companion object {
        @JvmStatic
        @OptIn(ExperimentalLensFacing::class)
        fun codes(): List<Arguments> = listOf(
            arguments("UNKNOWN", LensFacing.UNKNOWN, CameraSelector.LENS_FACING_UNKNOWN),
            arguments("FRONT", LensFacing.FRONT, CameraSelector.LENS_FACING_FRONT),
            arguments("BACK", LensFacing.BACK, CameraSelector.LENS_FACING_BACK),
            arguments("EXTERNAL", LensFacing.EXTERNAL, CameraSelector.LENS_FACING_EXTERNAL),
        )
    }
}
