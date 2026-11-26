package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_turn_left
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_turn_right
import dev.openverify.sdk.model.SelfiePose
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource

/**
 * C204.3, C204.6, C204.8 (decision 19): one prompt's selfie guidance over a fake detector (C204.2) and
 * synthetic grey frames (no face, rule 3), on the test scheduler's clock. The still is requested once,
 * from the callback in which the pose held; the shutter becomes primary after 10 s, at once without a
 * detector or frames, and after a failed auto-capture; and nothing of a frame is left once its callback
 * returns.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class SelfieGuidanceTest {

    private val thresholds = GuidanceThresholds(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)

    /** Synthetic grey 320 x 240 frames, one every [every], so the detector is handed non-zero pixels. */
    private fun frames(count: Int, every: Duration = 125.milliseconds, afterEach: () -> Unit = {}): Flow<AnalysisFrame> = flow {
        val bytes = ByteArray(320 * 240 * AnalysisFrame.BYTES_PER_PIXEL) { 90 }
        repeat(count) {
            emit(AnalysisFrame(320, 240, 0, PixelLayout.RGBA_8888, bytes, 0L))
            afterEach()
            delay(every)
        }
    }

    private fun factoryOf(detector: FaceDetector) = object : FaceDetectorFactory {
        var created = 0
        override fun create(): FaceDetector = detector.also { created += 1 }
    }

    private fun stills(answer: Boolean = true, count: MutableList<Unit>) = AutoCapture {
        count += Unit
        answer
    }

    @Test
    fun theCentreIsCapturedOnceFromTheCallbackInWhichThePoseHeld() = runTest {
        val detector = FakeFaceDetector { listOf(testFace()) }
        val taken = mutableListOf<Unit>()
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(detector), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(frames(20), stills(count = taken))

        assertEquals(1, taken.size)
        // Frames at 0, 125, 250, 375 and 500 ms: held from the first, fired by the fifth, none judged after.
        assertEquals(5, detector.calls)
        assertEquals(listOf(320 to 256), detector.sizes.distinct())
        assertTrue(detector.closed)
        assertFalse(guidance.shutterPrimary.value)
    }

    @Test
    fun aSidePoseIsJudgedFromThePersonsOwnCentreFrame() = runTest {
        val centre = CentreYawRatio()
        SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(FakeFaceDetector { listOf(testFace(yaw = 0.004)) }), centre, testTimeSource, analysis = EmptyCoroutineContext)
            .run(frames(10), stills(count = mutableListOf()))
        assertEquals(0.004, centre.ratio, 1e-4)

        val left = mutableListOf<Unit>()
        SelfieGuidance(SelfiePose.LEFT, thresholds, factoryOf(FakeFaceDetector { listOf(testFace(yaw = 0.004 + 0.12)) }), centre, testTimeSource, analysis = EmptyCoroutineContext)
            .run(frames(10), stills(count = left))
        assertEquals(1, left.size)

        val unknown = mutableListOf<Unit>()
        val withoutCentre = SelfieGuidance(SelfiePose.LEFT, thresholds, factoryOf(FakeFaceDetector { listOf(testFace(yaw = 0.3)) }), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)
        withoutCentre.run(frames(10), stills(count = unknown))
        assertEquals(0, unknown.size)
        assertEquals(GuidanceMessage.TURN_LEFT, withoutCentre.view.value.message)
    }

    @Test
    fun theShutterBecomesPrimaryAfterTenSecondsWithoutAHeldPose() = runTest {
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(FakeFaceDetector()), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)
        val job = launch { guidance.run(frames(100), stills(count = mutableListOf())) }

        advanceTimeBy(9_900)
        runCurrent()
        assertFalse(guidance.shutterPrimary.value)
        assertEquals(GuidanceMessage.NO_FACE, guidance.view.value.message)

        advanceTimeBy(200)
        runCurrent()
        assertTrue(guidance.shutterPrimary.value)
        job.cancel()
    }

    @Test
    fun withoutFramesTheShutterIsPrimaryAtOnce() = runTest {
        val detector = FakeFaceDetector()
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(detector), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(emptyFlow(), stills(count = mutableListOf()))

        assertTrue(guidance.shutterPrimary.value)
        assertEquals(GuidanceMessage.MANUAL, guidance.view.value.message)
        assertTrue(detector.closed)
    }

    @Test
    fun aDetectorThatCannotStartLeavesTheShutterAndReadsNoFrame() = runTest {
        val failing = object : FaceDetectorFactory {
            override fun create(): FaceDetector = throw IllegalStateException("no model")
        }
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, failing, CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(flow { error("no frame is read") }, stills(count = mutableListOf()))

        assertTrue(guidance.shutterPrimary.value)
        assertEquals(GuidanceMessage.MANUAL, guidance.view.value.message)
    }

    @Test
    fun aDetectionThatFailsIsNotTriedAgainAndLeavesTheShutter() = runTest {
        val detector = FakeFaceDetector(failOnCall = 1) { listOf(testFace(height = 0.2)) }
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(detector), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(frames(10), stills(count = mutableListOf()))

        assertEquals(2, detector.calls)
        assertTrue(guidance.shutterPrimary.value)
        assertEquals(GuidanceMessage.MANUAL, guidance.view.value.message)
        assertTrue(detector.closed)
    }

    @Test
    fun aFailedAutoCaptureIsNotTriedAgainAndPromotesTheShutter() = runTest {
        val taken = mutableListOf<Unit>()
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(FakeFaceDetector { listOf(testFace()) }), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(frames(20), stills(answer = false, count = taken))

        assertEquals(1, taken.size)
        assertTrue(guidance.shutterPrimary.value)
    }

    @Test
    fun nothingOfAFrameIsLeftOnceItsCallbackReturns() = runTest {
        val detector = FakeFaceDetector { listOf(testFace(height = 0.2), testFace(cx = 60.0, height = 0.3)) }
        lateinit var guidance: SelfieGuidance
        val wiped = mutableListOf<Boolean>()
        guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(detector), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)

        guidance.run(frames(6) { wiped += guidance.holdsNoFrame() }, stills(count = mutableListOf()))

        assertTrue(detector.sawPixels, "the frames' pixels reached the detector")
        assertEquals(6, detector.calls)
        assertEquals(List(6) { true }, wiped)
    }

    @Test
    fun aGuidanceClosedBeforeItRunsReadsNothing() = runTest {
        val factory = factoryOf(FakeFaceDetector())
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factory, CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)
        guidance.close()

        guidance.run(flow { error("no frame is read") }, stills(count = mutableListOf()))

        assertEquals(0, factory.created)
    }

    @Test
    fun aMessageThatFlickersIsAnnouncedOnlyOnceSettled() = runTest {
        // The face comes and goes every frame for 5 s, then stays too far for 3 s.
        var frame = 0
        val detector = FakeFaceDetector { call -> if (call < 40 && call % 2 == 0) emptyList() else listOf(testFace(height = 0.2)) }
        val guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factoryOf(detector), CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)
        val heard = mutableListOf<GuidanceMessage>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            guidance.view.collect { view -> view.announcement?.let { if (heard.lastOrNull() != it) heard += it } }
        }

        guidance.run(frames(64) { frame += 1 }, stills(count = mutableListOf()))
        advanceUntilIdle()

        assertEquals(64, frame)
        assertEquals(listOf(GuidanceMessage.TOO_FAR), heard)
    }

    @Test
    fun beforeAnyFrameTheViewShowsThePromptsOwnInstruction() {
        val guidance = SelfieGuidance(SelfiePose.RIGHT, thresholds, factoryOf(FakeFaceDetector()), CentreYawRatio())

        assertEquals(GuidanceMessage.TURN_RIGHT, guidance.view.value.message)
        assertNull(guidance.view.value.announcement)
        assertFalse(guidance.shutterPrimary.value)
    }

    @Test
    fun leftAndRightNameThePersonsOwnSidesAndEachMessageHasItsOwnWords() {
        assertEquals(Res.string.openverify_selfie_guidance_turn_left, guidanceText(GuidanceMessage.TURN_LEFT))
        assertEquals(Res.string.openverify_selfie_guidance_turn_right, guidanceText(GuidanceMessage.TURN_RIGHT))
        assertEquals(GuidanceMessage.entries.size, GuidanceMessage.entries.map(::guidanceText).distinct().size)
    }
}
