package dev.openverify.sdk.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.CancellationException

/**
 * C201.2, C201.3 (decision 17), KP10-14: the three use cases in one bind, else preview and the still
 * (the manual shutter, no frames), else no camera at all; the device test forces the middle path on
 * the emulator, and this is its host twin.
 */
class UseCaseBindingTest {

    private val calls = mutableListOf<String>()

    @Test
    fun threeUseCasesBoundTogetherAnalyse() {
        val binding = bindUseCases(three = { calls += "three"; "camera" }, two = { calls += "two"; "two" }, release = { calls += "release" })

        assertEquals(Binding.Analysing("camera"), binding)
        assertEquals(listOf("three"), calls)
    }

    @Test
    fun whenThreeCannotBeBoundTheCameraReleasesThemAndBindsPreviewAndTheStill() {
        val binding = bindUseCases(
            three = { calls += "three"; throw IllegalArgumentException("No supported surface combination") },
            two = { calls += "two"; "camera" },
            release = { calls += "release" },
        )

        assertEquals(Binding.WithoutAnalysis("camera"), binding)
        assertEquals(listOf("three", "release", "two"), calls)
    }

    @Test
    fun whenNotEvenTwoCanBeBoundTheCameraIsUnavailable() {
        val binding = bindUseCases<String>(
            three = { throw IllegalStateException("no camera") },
            two = { throw IllegalArgumentException("No available camera can be found") },
            release = { calls += "release" },
        )

        assertEquals(Binding.Unavailable, binding)
        assertEquals(listOf("release"), calls)
    }

    @Test
    fun aCancellationIsNeverAFallback() {
        assertFailsWith<CancellationException> {
            bindUseCases(three = { throw CancellationException("left the screen") }, two = { calls += "two"; "two" }, release = {})
        }
        assertFailsWith<CancellationException> {
            bindUseCases(three = { throw IllegalStateException("no") }, two = { throw CancellationException("left") }, release = {})
        }
        assertEquals(emptyList(), calls)
    }
}
