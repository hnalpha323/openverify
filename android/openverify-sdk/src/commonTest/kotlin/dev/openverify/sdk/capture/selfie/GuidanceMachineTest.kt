package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.model.SelfiePose
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C204.1, C204.3: the guidance machine as the web's `guidance-machine.test.ts` checks it, over the
 * shared constants (C40.11) and the golden capture's guidance (0.021, 0.077, 500 ms): framing, the
 * pose triggers, the hold, the manual shutter after 10 s or at once without a detector, and
 * announcements that settle instead of following every frame (C212.2).
 */
internal class GuidanceMachineTest {

    private val thresholds = GuidanceThresholds(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)
    private val faces = FaceBuffer()

    private fun machine(pose: SelfiePose = SelfiePose.CENTER, centre: Double = Double.NaN, detector: DetectorStatus = DetectorStatus.READY) =
        GuidanceMachine(pose, 0L, detector, centre, thresholds)

    private fun GuidanceMachine.seen(now: Long, vararg seen: TestFace): GuidanceMachine = apply {
        seen.forEach { faces.addFace(it) }
        faces(now, faces, 320, 240)
        faces.clear()
    }

    @Test
    fun eachPromptStartsWithItsOwnInstruction() {
        assertEquals(GuidanceMessage.LOOK_STRAIGHT, machine(SelfiePose.CENTER).message)
        assertEquals(GuidanceMessage.TURN_LEFT, machine(SelfiePose.LEFT).message)
        assertEquals(GuidanceMessage.TURN_RIGHT, machine(SelfiePose.RIGHT).message)
        assertEquals(GuidanceMessage.STARTING, machine(detector = DetectorStatus.LOADING).message)
        val unavailable = machine(SelfiePose.LEFT, detector = DetectorStatus.UNAVAILABLE)
        assertEquals(GuidanceMessage.MANUAL, unavailable.message)
        assertTrue(unavailable.manualShutter)
    }

    @Test
    fun theCentreCapturesOnceAFrontalFaceIsHeldForHoldMs() {
        val state = machine().seen(0, testFace()).seen(125, testFace()).seen(499, testFace())
        assertEquals(GuidanceMessage.HOLD_STILL, state.message)
        assertFalse(state.autoCapture)

        assertTrue(state.seen(500, testFace()).autoCapture)
    }

    @Test
    fun theCentreCapturesJustInsideItsTriggerAndAsksToLookStraightBeyondIt() {
        val inside = thresholds.centreTrigger - 1e-6
        assertTrue(machine().seen(0, testFace(yaw = inside)).seen(500, testFace(yaw = -inside)).autoCapture)

        val turned = machine().seen(0, testFace(yaw = thresholds.centreTrigger + 0.001)).seen(600, testFace(yaw = thresholds.centreTrigger + 0.001))
        assertEquals(GuidanceMessage.LOOK_STRAIGHT, turned.message)
        assertFalse(turned.autoCapture)
    }

    @Test
    fun theHoldStartsAgainWhenTheFaceMovesAway() {
        val state = machine().seen(0, testFace()).seen(300, testFace(cx = 20.0)).seen(400, testFace()).seen(800, testFace())
        assertFalse(state.autoCapture)

        assertTrue(state.seen(900, testFace()).autoCapture)
    }

    @Test
    fun theLatestWellPlacedFacesYawRatioIsKeptForTheSidePoses() {
        assertEquals(0.012, machine().seen(0, testFace(yaw = 0.012)).yawRatio, 1e-10)
        assertTrue(machine().seen(0, testFace(yaw = 0.012)).seen(125).yawRatio.isNaN())
    }

    @Test
    fun aSidePoseCapturesOnceTheRatioChangedFromTheCentreByItsTriggerInThePromptedDirection() {
        val centre = 0.01
        for ((pose, direction, prompt) in listOf(
            Triple(SelfiePose.LEFT, 1.0, GuidanceMessage.TURN_LEFT),
            Triple(SelfiePose.RIGHT, -1.0, GuidanceMessage.TURN_RIGHT),
        )) {
            fun at(change: Double) = testFace(yaw = centre + direction * change)
            val trigger = thresholds.sideTrigger
            assertTrue(machine(pose, centre).seen(0, at(trigger + 1e-6)).seen(500, at(trigger + 0.02)).autoCapture, "$pose")

            val short = machine(pose, centre).seen(0, at(trigger - 0.005)).seen(700, at(trigger - 0.005))
            assertEquals(prompt, short.message)
            assertFalse(short.autoCapture)

            val otherWay = machine(pose, centre).seen(0, at(-trigger * 2)).seen(700, at(-trigger * 2))
            assertEquals(prompt, otherWay.message)
            assertFalse(otherWay.autoCapture)
        }
    }

    @Test
    fun withoutTheCentreFrameASidePoseIsLeftToTheShutter() {
        val state = machine(SelfiePose.LEFT).seen(0, testFace(yaw = 0.5)).seen(9_999, testFace(yaw = 0.5))
        assertFalse(state.autoCapture)
        assertFalse(state.manualShutter)

        assertTrue(state.seen(10_000, testFace(yaw = 0.5)).manualShutter)
    }

    @Test
    fun framingProblemsAreNamedInTheOrderThePersonShouldFixThem() {
        val cases = listOf(
            emptyList<TestFace>() to GuidanceMessage.NO_FACE,
            listOf(testFace(score = 0.85)) to GuidanceMessage.NO_FACE,
            listOf(testFace(), testFace(cx = 60.0, height = 0.3)) to GuidanceMessage.MULTIPLE_FACES,
            listOf(testFace(height = 0.2)) to GuidanceMessage.TOO_FAR,
            listOf(testFace(height = 0.9)) to GuidanceMessage.TOO_CLOSE,
            listOf(testFace(cx = 260.0)) to GuidanceMessage.OFF_CENTRE,
            listOf(testFace(cy = 60.0)) to GuidanceMessage.OFF_CENTRE,
        )
        for ((seen, expected) in cases) {
            val state = machine().seen(0, *seen.toTypedArray()).seen(800, *seen.toTypedArray())
            assertEquals(expected, state.message)
            assertFalse(state.autoCapture)
            assertEquals(GuidanceMachine.NO_TIME, state.heldSince)
        }
    }

    @Test
    fun aSmallFaceInTheBackgroundIsIgnoredAndTheLargestFaceIsThePerson() {
        val background = testFace(cx = 40.0, cy = 40.0, height = 0.2)
        assertTrue(machine().seen(0, testFace(), background).seen(500, testFace(), background).autoCapture)

        assertEquals(GuidanceMessage.HOLD_STILL, machine().seen(0, testFace(cx = 40.0, height = 0.15), testFace()).message)
    }

    @Test
    fun theShutterBecomesPrimaryAfterManualShutterAfterMsEvenWithoutFramesAndStays() {
        val state = machine()
        state.tick(thresholds.manualShutterAfterMs - 1)
        assertFalse(state.manualShutter)

        state.tick(thresholds.manualShutterAfterMs)
        assertTrue(state.manualShutter)
        assertTrue(state.seen(thresholds.manualShutterAfterMs + 100, testFace()).manualShutter)
    }

    @Test
    fun aDetectorThatBecomesUnavailableShowsTheShutterAtOnceAndSaysSo() {
        val state = machine(detector = DetectorStatus.LOADING)
        assertFalse(state.manualShutter)

        state.detectorChanged(50, DetectorStatus.UNAVAILABLE)

        assertEquals(GuidanceMessage.MANUAL, state.message)
        assertTrue(state.manualShutter)
    }

    @Test
    fun aLoadingDetectorThatBecomesReadyStartsGuiding() {
        val state = machine(detector = DetectorStatus.LOADING)
        state.detectorChanged(10, DetectorStatus.READY)
        state.seen(20)

        assertEquals(DetectorStatus.READY, state.detector)
        assertEquals(GuidanceMessage.NO_FACE, state.message)
    }

    @Test
    fun aMessageIsAnnouncedOnceItHasStayedOnScreenAndTheLastStaysWhileANewOneSettles() {
        val early = machine().seen(0).seen(1_000)
        assertEquals(GuidanceMessage.NO_FACE, early.message)
        assertNull(early.announcement)

        early.seen(1_500)
        assertEquals(GuidanceMessage.NO_FACE, early.announcement)

        early.seen(1_600, testFace(height = 0.2))
        assertEquals(GuidanceMessage.TOO_FAR, early.message)
        assertEquals(GuidanceMessage.NO_FACE, early.announcement)
    }

    @Test
    fun aMessageThatFlickersAt8HzIsAnnouncedOncePerSettledChangeNeverPerFrame() {
        // 20 s of frames at 8 Hz: the face comes and goes every frame for 10 s (no message settles),
        // then stays too far for 5 s, then is held centred, which captures.
        val state = machine()
        val announcements = mutableListOf<GuidanceMessage>()
        var last: GuidanceMessage? = null
        var messageChanges = 0
        var previousMessage = state.message
        for (frame in 1..160) {
            val now = frame * 125L
            when {
                now <= 10_000 -> if (frame % 2 == 0) state.seen(now) else state.seen(now, testFace(height = 0.2))
                now <= 15_000 -> state.seen(now, testFace(height = 0.2))
                else -> state.seen(now, testFace())
            }
            if (state.message != previousMessage) messageChanges += 1
            previousMessage = state.message
            if (state.announcement != last) {
                state.announcement?.let { announcements += it }
                last = state.announcement
            }
        }

        assertTrue(messageChanges > 70, "the message follows every frame: $messageChanges changes")
        assertEquals(listOf(GuidanceMessage.TOO_FAR, GuidanceMessage.HOLD_STILL), announcements)
    }
}
