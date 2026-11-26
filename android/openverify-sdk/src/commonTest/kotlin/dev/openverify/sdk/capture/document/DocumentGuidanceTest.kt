package dev.openverify.sdk.capture.document

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.document.DocumentCaptureConstants as C
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource

/**
 * C202.3, C202.4 (decision 19), C212.2: the document guidance over scripted measurements on the
 * test scheduler's frozen clock. Frames come every 125 ms (`guidance-hz` 8); every gate must hold
 * for `hold-ms` before the still is taken through [AutoCapture]; the shutter becomes the primary
 * action after `manual-shutter-after-ms`, at once without frames, and after a failed auto-capture;
 * a hint is shown (and so announced) once per change, never at the frame rate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DocumentGuidanceTest {
    private val pixel = ByteArray(AnalysisFrame.BYTES_PER_PIXEL)
    private val period = 125.milliseconds

    private fun frames(count: Int): Flow<AnalysisFrame> = flow {
        repeat(count) { index ->
            emit(AnalysisFrame(1, 1, 0, PixelLayout.RGBA_8888, pixel, index.toLong()))
            delay(period)
        }
    }

    private fun DocumentMeasurement.held() {
        laplacianVariance = C.SHARPNESS_LAPLACIAN_VARIANCE_MIN * 3
        tenengrad = C.SHARPNESS_TENENGRAD_MIN * 2
        glareShare = 0.0
        brightnessMean = (C.BRIGHTNESS_MEAN_MIN + C.BRIGHTNESS_MEAN_MAX) / 2
        framingEdgeRatio = C.FRAMING_EDGE_RATIO_MIN * 5
        framingShrunkBest = 1.0
        mrzBandEdgeDensity = C.MRZ_BAND_EDGE_DENSITY_MIN * 2
    }

    private val dark: DocumentMeasurement.() -> Unit = { brightnessMean = C.BRIGHTNESS_MEAN_MIN / 2 }
    private val glare: DocumentMeasurement.() -> Unit = { glareShare = 1.0 }
    private val nothing: DocumentMeasurement.() -> Unit = {}

    private fun TestScope.guidance(passport: Boolean = false, script: (Int) -> DocumentMeasurement.() -> Unit): DocumentGuidance =
        DocumentGuidance(passport, DocumentGuide.CARD_ASPECT, testTimeSource) { frame, _, into ->
            into.held()
            into.apply(script(frame.timestampNanos.toInt()))
        }

    private class Shutter(private val succeeds: Boolean, private val scope: TestScope) : AutoCapture {
        val takenAt = mutableListOf<Long>()

        override suspend fun takeStill(): Boolean {
            takenAt += scope.testScheduler.currentTime
            return succeeds
        }
    }

    @Test
    fun everyGateHeldForHoldMsTakesTheStillOnceAndEndsTheGuidance() = runTest {
        val shutter = Shutter(succeeds = true, this)
        guidance { nothing }.run(frames(40), shutter)
        assertEquals(listOf(C.HOLD.inWholeMilliseconds), shutter.takenAt)
        assertEquals(500L, C.HOLD.inWholeMilliseconds)
    }

    @Test
    fun aBrokenFrameStartsTheHoldAgain() = runTest {
        val shutter = Shutter(succeeds = true, this)
        guidance { index -> if (index == 2) dark else nothing }.run(frames(40), shutter)
        assertEquals(listOf(3 * period.inWholeMilliseconds + C.HOLD.inWholeMilliseconds), shutter.takenAt)
    }

    @Test
    fun theShutterBecomesPrimaryAfterTenSecondsWhileTheGatesDoNotHold() = runTest {
        val document = guidance { dark }
        val shutter = Shutter(succeeds = true, this)
        backgroundScope.launch { document.run(frames(200), shutter) }
        advanceTimeBy(C.MANUAL_SHUTTER_AFTER - 1.milliseconds)
        runCurrent()
        assertFalse(document.shutterPrimary.value)
        advanceTimeBy(1.milliseconds)
        runCurrent()
        assertTrue(document.shutterPrimary.value)
        assertEquals(emptyList(), shutter.takenAt)
    }

    @Test
    fun autoCaptureStillTakesTheStillAfterTheShutterWasPromoted() = runTest {
        val shutter = Shutter(succeeds = true, this)
        val brokenFrames = 88 // 11 s
        val document = guidance { index -> if (index < brokenFrames) dark else nothing }
        document.run(frames(200), shutter)
        assertEquals(listOf(brokenFrames * period.inWholeMilliseconds + C.HOLD.inWholeMilliseconds), shutter.takenAt)
        assertTrue(document.shutterPrimary.value)
    }

    @Test
    fun withoutFramesTheShutterIsPrimaryAtOnce() = runTest {
        val document = guidance { nothing }
        val shutter = Shutter(succeeds = true, this)
        document.run(emptyFlow(), shutter)
        assertTrue(document.shutterPrimary.value)
        assertEquals(0L, testScheduler.currentTime)
        assertEquals(emptyList(), shutter.takenAt)
    }

    @Test
    fun framesThatStopMakeTheShutterPrimary() = runTest {
        val document = guidance { dark }
        document.run(frames(3), Shutter(succeeds = true, this))
        assertTrue(document.shutterPrimary.value)
    }

    @Test
    fun aFailedAutoCaptureMakesTheShutterPrimaryAndIsNotTriedAgain() = runTest {
        val document = guidance { nothing }
        val shutter = Shutter(succeeds = false, this)
        backgroundScope.launch { document.run(frames(40), shutter) }
        advanceTimeBy(C.HOLD + 1.milliseconds)
        runCurrent()
        assertEquals(listOf(C.HOLD.inWholeMilliseconds), shutter.takenAt)
        assertTrue(document.shutterPrimary.value)
        advanceTimeBy(5_000.milliseconds)
        runCurrent()
        assertEquals(1, shutter.takenAt.size)
    }

    @Test
    fun eachHintIsShownOnceItHeldAndAnnouncedOncePerChangeNeverAtTheFrameRate() = runTest {
        val document = guidance { index ->
            when {
                index < 16 -> dark
                index < 32 -> glare
                index < 48 -> if (index % 2 == 0) dark else glare // flickers every frame: never settles
                else -> nothing
            }
        }
        val shown = mutableListOf<Pair<Long, DocumentHint?>>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            document.hint.collect { shown += testScheduler.currentTime to it }
        }
        val shutter = Shutter(succeeds = true, this)
        document.run(frames(80), shutter)
        val settle = C.HOLD.inWholeMilliseconds
        assertEquals(
            listOf(0L to null, settle to DocumentHint.MORE_LIGHT, 16 * 125L + settle to DocumentHint.TILT_AWAY, 48 * 125L + settle to null),
            shown,
        )
        assertEquals(2, shown.count { it.second != null }, "two announcements for 48 frames of hints")
        assertEquals(listOf(48 * 125L + settle), shutter.takenAt)
    }

    @Test
    fun aPassportPageWithoutItsBandIsAskedForItAndNotTaken() = runTest {
        val document = guidance(passport = true) { { mrzBandEdgeDensity = 0.0 } }
        val shutter = Shutter(succeeds = true, this)
        backgroundScope.launch { document.run(frames(40), shutter) }
        advanceTimeBy(Duration.parse("2s"))
        runCurrent()
        assertEquals(DocumentHint.SHOW_MRZ, document.hint.value)
        assertEquals(emptyList(), shutter.takenAt)
    }
}
