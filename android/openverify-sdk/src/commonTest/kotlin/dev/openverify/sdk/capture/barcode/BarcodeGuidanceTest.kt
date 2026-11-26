package dev.openverify.sdk.capture.barcode

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.RetryHint
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * C203.3 over a fake [BarcodeReader] (zxing-cpp's native library cannot load in a host test; the device
 * test covers the glue): "barcode found" for a decoded PDF417 with an AAMVA header and nothing else, the
 * decoded bytes wiped as soon as the header is judged, a bounded read rate and a held hint, and the
 * hint alongside the document guidance without ever taking the photo.
 */
class BarcodeGuidanceTest {

    private val aamva = "@\n\u001e\rANSI 636014100002DL00410232ZC0273003DLDAQSYNTH".encodeToByteArray()
    private val notAamva = "https://example.com/a-pdf417-that-is-not-a-licence".encodeToByteArray()

    /** Answers each read from [answers] (null decodes nothing), keeping every array it returned. */
    private class FakeReader(private val answers: (AnalysisFrame) -> ByteArray?) : BarcodeReader, AutoCloseable {
        val frames = mutableListOf<AnalysisFrame>()
        val returned = mutableListOf<ByteArray>()
        var closed = false

        override suspend fun readPdf417(frame: AnalysisFrame): ByteArray? {
            frames += frame
            return answers(frame)?.copyOf()?.also { returned += it }
        }

        override fun close() {
            closed = true
        }
    }

    /** One buffer for every frame: 640 x 480 upright, the smallest analysis frame that can carry a barcode read (KP10-35). */
    private val pixels = ByteArray(640 * 480 * 4)

    private fun frame(atMs: Long) = AnalysisFrame(640, 480, 0, PixelLayout.RGBA_8888, pixels, atMs * 1_000_000)

    @Test
    fun aDecodedAamvaHeaderShowsBarcodeFound() = runTest {
        val guidance = BarcodeGuidance(FakeReader { aamva })
        assertEquals(BarcodeHint.SEARCHING, guidance.hint.value)
        guidance.onFrame(frame(0))
        assertEquals(BarcodeHint.FOUND, guidance.hint.value)
    }

    @Test
    fun aFrameThatCannotCarryAReadHidesTheGuideAndIsNeverRead() = runTest {
        // KP10-35: "Fit the barcode in the box" is a prompt the SDK cannot answer on such a frame. A
        // 640 x 480 frame turned upright by 90 degrees is 480 wide: its guide is narrower than a
        // readable symbol (AnalysisSizes.barcodeRead is NONE). A 1,280 x 960 frame carries the read.
        val reader = FakeReader { aamva }
        val guidance = BarcodeGuidance(reader)
        assertEquals(false, guidance.visible.value, "nothing is asked before a frame says what it can carry")

        guidance.onFrame(AnalysisFrame(640, 480, 90, PixelLayout.RGBA_8888, ByteArray(640 * 480 * 4), 0))
        assertEquals(false, guidance.visible.value)
        assertEquals(0, reader.frames.size)
        assertEquals(BarcodeHint.SEARCHING, guidance.hint.value)

        guidance.onFrame(AnalysisFrame(1280, 960, 90, PixelLayout.RGBA_8888, ByteArray(1280 * 960 * 4), 1_000_000_000))
        assertEquals(true, guidance.visible.value)
        assertEquals(1, reader.frames.size)
        assertEquals(BarcodeHint.FOUND, guidance.hint.value)

        guidance.onFrame(AnalysisFrame(640, 480, 90, PixelLayout.RGBA_8888, ByteArray(640 * 480 * 4), 2_000_000_000))
        assertEquals(false, guidance.visible.value, "a later frame that cannot carry a read hides the guide again")
        assertEquals(1, reader.frames.size)
    }

    @Test
    fun aPdf417WithoutAnAamvaHeaderOrNoBarcodeFindsNothing() = runTest {
        val other = BarcodeGuidance(FakeReader { notAamva })
        other.onFrame(frame(0))
        assertEquals(BarcodeHint.SEARCHING, other.hint.value)
        val none = BarcodeGuidance(FakeReader { null })
        none.onFrame(frame(0))
        assertEquals(BarcodeHint.SEARCHING, none.hint.value)
    }

    @Test
    fun theDecodedBytesAreWipedBeforeTheCallbackReturns() = runTest {
        for (answer in listOf(aamva, notAamva)) {
            val reader = FakeReader { answer }
            BarcodeGuidance(reader).onFrame(frame(0))
            assertEquals(1, reader.returned.size)
            assertTrue(reader.returned.single().all { it == 0.toByte() }, "nothing decoded outlives the frame callback")
        }
    }

    @Test
    fun readsTheFrameItIsGivenInsideItsCallback() = runTest {
        val reader = FakeReader { null }
        val guidance = BarcodeGuidance(reader)
        val first = frame(0)
        guidance.onFrame(first)
        assertSame(first, reader.frames.single())
    }

    @Test
    fun readsAtMostOnceAReadInterval() = runTest {
        val reader = FakeReader { null }
        val guidance = BarcodeGuidance(reader)
        val interval = Pdf417Guidance.READ_INTERVAL_MS
        assertTrue(interval > 0, "the read rate is bounded")
        val times = listOf(0L, interval / 2, interval, interval + 1, 2 * interval, 2 * interval + interval / 2)
        for (time in times) guidance.onFrame(frame(time))
        assertEquals(listOf(0L, interval, 2 * interval), reader.frames.map { it.timestampNanos / 1_000_000 })
    }

    @Test
    fun aFrameFromAnEarlierTimeIsReadAgain() = runTest {
        val reader = FakeReader { null }
        val guidance = BarcodeGuidance(reader)
        guidance.onFrame(frame(10_000))
        guidance.onFrame(frame(5_000))
        assertEquals(2, reader.frames.size)
    }

    @Test
    fun barcodeFoundIsHeldBetweenReadsAndThenDropped() = runTest {
        var decodes = true
        val guidance = BarcodeGuidance(FakeReader { if (decodes) aamva else null })
        val hold = Pdf417Guidance.FOUND_HOLD_MS
        val interval = Pdf417Guidance.READ_INTERVAL_MS
        assertTrue(hold > interval, "one missed read does not drop the hint")
        guidance.onFrame(frame(0))
        decodes = false
        var time = interval
        while (time <= hold) {
            guidance.onFrame(frame(time))
            assertEquals(BarcodeHint.FOUND, guidance.hint.value, "held at $time ms")
            time += interval
        }
        guidance.onFrame(frame(hold + 1))
        assertEquals(BarcodeHint.SEARCHING, guidance.hint.value)
        decodes = true
        guidance.onFrame(frame(hold + 1 + interval))
        assertEquals(BarcodeHint.FOUND, guidance.hint.value)
    }

    @Test
    fun aReaderThatFailsFindsNothingAndCancellationStillEndsTheRun() = runTest {
        val failing = BarcodeGuidance(FakeReader { error("native read failed") })
        failing.onFrame(frame(0))
        assertEquals(BarcodeHint.SEARCHING, failing.hint.value)
        val canceled = BarcodeGuidance(FakeReader { throw CancellationException("screen left") })
        assertFailsWith<CancellationException> { canceled.onFrame(frame(0)) }
    }

    @Test
    fun runReadsEveryFrameAndNeverTakesThePhoto() = runTest {
        val reader = FakeReader { aamva }
        val guidance = BarcodeGuidance(reader)
        var stills = 0
        val interval = Pdf417Guidance.READ_INTERVAL_MS
        guidance.run(flowOf(frame(0), frame(interval), frame(2 * interval))) { stills++; true }
        assertEquals(3, reader.frames.size)
        assertEquals(0, stills, "the barcode is a hint, never an auto-capture gate (review F11)")
        assertEquals(BarcodeHint.FOUND, guidance.hint.value)
        assertTrue(guidance.shutterPrimary.value, "with no auto-capture of its own the shutter is the primary action")
    }

    @Test
    fun closingClosesTheReader() {
        val reader = FakeReader { null }
        BarcodeGuidance(reader).close()
        assertTrue(reader.closed)
    }

    // The factory -----------------------------------------------------------------------------

    private val barcodeNotFound = RetryHint("id_barcode_detection", listOf("barcode_not_found"))
    private val idCard = GovernmentIdStep("id_card", DocumentSides.BOTH, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA))
    private val back = FlowState.Capture(idCard, FileKind.BACK, 1, 2, listOf(barcodeNotFound))
    private val front = FlowState.Capture(idCard, FileKind.FRONT, 0, 2, listOf(barcodeNotFound))

    /** A document guidance that records the frames it saw and when the barcode reader had read them. */
    private class FakeDocumentGuidance(private val log: MutableList<String>) : CaptureGuidance {
        var closed = false
        var autoCapture: AutoCapture? = null
        override val shutterPrimary: StateFlow<Boolean> = MutableStateFlow(false)

        override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
            this.autoCapture = autoCapture
            frames.collect { log += "document ${it.timestampNanos / 1_000_000}" }
        }

        @Composable
        override fun Overlay(modifier: Modifier) = Unit

        override fun close() {
            closed = true
            log += "document closed"
        }
    }

    @Test
    fun aSideWithoutTheMarkKeepsTheDocumentGuidanceAndOpensNoReader() {
        val document = FakeDocumentGuidance(mutableListOf())
        var opened = 0
        val factory = BarcodeGuidanceFactory(CaptureGuidanceFactory { document }) { opened++; FakeReader { aamva } }
        assertSame(document, factory.create(front))
        assertNull(BarcodeGuidanceFactory(null) { opened++; FakeReader { aamva } }.create(front))
        assertEquals(0, opened)
    }

    @Test
    fun aPlatformWithoutAReaderKeepsTheDocumentGuidance() {
        val document = FakeDocumentGuidance(mutableListOf())
        assertSame(document, BarcodeGuidanceFactory(CaptureGuidanceFactory { document }) { null }.create(back))
        assertNull(BarcodeGuidanceFactory(null) { null }.create(back))
    }

    @Test
    fun aBarcodeSideWithoutDocumentGuidanceGetsTheBarcodeHintAlone() = runTest {
        val guidance = BarcodeGuidanceFactory(null) { FakeReader { aamva } }.create(back)
        assertIs<BarcodeGuidance>(guidance)
    }

    @Test
    fun aBarcodeSideReadsEachFrameBeforeTheDocumentGuidanceSeesIt() = runTest {
        val log = mutableListOf<String>()
        val document = FakeDocumentGuidance(log)
        val reader = object : BarcodeReader, AutoCloseable {
            override suspend fun readPdf417(frame: AnalysisFrame): ByteArray? {
                log += "barcode ${frame.timestampNanos / 1_000_000}"
                return null
            }

            override fun close() {
                log += "barcode closed"
            }
        }
        val guidance = BarcodeGuidanceFactory(CaptureGuidanceFactory { document }) { reader }.create(back)!!
        val interval = Pdf417Guidance.READ_INTERVAL_MS
        val still = AutoCapture { true }
        guidance.run(flowOf(frame(0), frame(interval)), still)
        assertEquals(listOf("barcode 0", "document 0", "barcode $interval", "document $interval"), log)
        assertSame(still, document.autoCapture, "the photo is the document guidance's to take")
        assertSame(document.shutterPrimary, guidance.shutterPrimary)
        guidance.close()
        assertEquals(listOf("document closed", "barcode closed"), log.takeLast(2))
    }
}
