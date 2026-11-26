package dev.openverify.sdk.camera

import kotlinx.coroutines.CancellationException
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The platform seams the common capture code relies on. */
class CapturePlatformTest {

    @Test
    fun recognisesThePlatformsOutOfMemoryError() {
        assertTrue(isOutOfMemory(outOfMemoryError()))
    }

    @Test
    fun recognisesNoOtherFailureAsOutOfMemory() {
        val others = listOf(
            IllegalStateException("use case not bound"),
            CancellationException("left the screen"),
            AssertionError("not a memory error"),
            NotImplementedError(),
        )

        others.forEach { assertFalse(isOutOfMemory(it), it.toString()) }
    }
}
