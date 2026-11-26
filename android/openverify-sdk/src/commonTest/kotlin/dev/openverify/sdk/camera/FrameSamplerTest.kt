package dev.openverify.sdk.camera

import dev.openverify.sdk.fixtures.readContractFixture
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * C201.2 (decision 17): the guidance reads `guidance-hz` frames a second, whatever rate the camera
 * runs at, on a fixed schedule; the rest are closed at once.
 */
class FrameSamplerTest {

    /** The frames of [seconds] of a [fps] camera, starting at [startNanos], that the sampler takes. */
    private fun taken(sampler: FrameSampler, fps: Int, seconds: Int = 1, startNanos: Long = 0): List<Long> =
        (0 until fps * seconds).map { startNanos + it * NANOS / fps }.filter(sampler::take)

    @Test
    fun guidanceHzIsTheSharedFixturesRate() {
        val selfie = Json.parseToJsonElement(readContractFixture("flow/selfie-capture.json")).jsonObject
        assertEquals(selfie.getValue("client").jsonObject.getValue("guidance-hz").jsonPrimitive.int, FrameSampler.GUIDANCE_HZ)
        val document = Json.parseToJsonElement(readContractFixture("flow/document-capture.schema.json")).jsonObject
        val hz = document.getValue("properties").jsonObject.getValue("client").jsonObject.getValue("properties").jsonObject
            .getValue("guidance-hz").jsonObject.getValue("const").jsonPrimitive.int
        assertEquals(hz, FrameSampler.GUIDANCE_HZ)
    }

    @Test
    fun aCameraAtThirtyOrSixtyFramesASecondGivesEightASecond() {
        listOf(24, 30, 60).forEach { fps ->
            assertEquals(8, taken(FrameSampler(8), fps).size, "at $fps fps")
            assertEquals(8 * 5, taken(FrameSampler(8), fps, seconds = 5).size, "at $fps fps over 5 s")
        }
    }

    @Test
    fun takenFramesAreNeverCloserThanTheCamerasOwnSpacingBelowTheInterval() {
        val frames = taken(FrameSampler(8), 30, seconds = 3)
        frames.zipWithNext { a, b -> b - a }.forEach { gap -> assertTrue(gap >= NANOS / 8 - NANOS / 30, "gap $gap") }
    }

    @Test
    fun aSlowerCameraHasEveryFrameTakenAndNoBurstAfterAGap() {
        assertEquals(5, taken(FrameSampler(8), 5).size)
        val sampler = FrameSampler(8)
        assertTrue(sampler.take(0))
        // A two-second stall, then 30 fps again: no catch-up burst.
        assertEquals(8, taken(sampler, 30, startNanos = 2 * NANOS).size)
    }

    @Test
    fun theFirstFrameIsTakenAndAClockThatGoesBackStartsAgain() {
        val sampler = FrameSampler(8)
        assertTrue(sampler.take(5 * NANOS))
        assertEquals(false, sampler.take(5 * NANOS + 1))
        assertTrue(sampler.take(10))
    }

    @Test
    fun theRateIsOneToSixtyFramesASecond() {
        assertFailsWith<IllegalArgumentException> { FrameSampler(0) }
        assertFailsWith<IllegalArgumentException> { FrameSampler(61) }
    }

    private companion object {
        const val NANOS = 1_000_000_000L
    }
}
