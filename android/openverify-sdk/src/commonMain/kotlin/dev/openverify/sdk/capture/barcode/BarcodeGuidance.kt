package dev.openverify.sdk.capture.barcode

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.AnalysisSizes
import dev.openverify.sdk.camera.BarcodeRead
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.capture.document.DocumentCaptureConstants
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.log.SdkLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.onEach

/** C203.3: what the barcode guide says. Never "readable": the server re-decodes the uploaded photo (review H21). */
internal enum class BarcodeHint {
    /** No AAMVA PDF417 decoded lately: the guide asks for the barcode inside it. */
    SEARCHING,

    /** A PDF417 with an AAMVA header decoded lately: "barcode found". */
    FOUND,
}

/**
 * C203.3's constants, each provisional with its basis, none tuned on a test's expected answer. The
 * host calibration (`services/vision/tests/test_android_pdf417_assets.py`) found zxing-cpp 3.1.1
 * decoding the synthetic AAMVA symbols reliably from about 1.62 pixels a module: at the document
 * analysis width (640 px) the symbol must span 80% of the frame, at C201.2's 1,280 px 40%. So the read
 * stays a hint and never gates the auto-capture in 10B (review F11), until the CI device test confirms
 * the host result.
 */
internal object Pdf417Guidance {
    /**
     * At most one read every 250 ms of camera time: half of `guidance-hz` (8), so the decoder, the
     * costliest analysis on the frame, leaves every other frame to the document measures. Provisional.
     */
    const val READ_INTERVAL_MS: Long = 250

    /**
     * "Barcode found" stays shown for 1.5 s of camera time after the last AAMVA read, six read
     * intervals: a hint that dropped on one missed read would flicker and be announced again (C202.3:
     * once per change). Provisional.
     */
    const val FOUND_HOLD_MS: Long = 1_500

    /**
     * C201.2's analysis width for a barcode-bearing side, where the calibration's 1.62 pixels a module
     * needs the symbol across 40% of the frame. `capture-pipeline` chooses the analysis size. KP10-23:
     * the width is stated once, in [DocumentCaptureConstants], from `document-capture.json`.
     */
    const val ANALYSIS_WIDTH_PX: Int = DocumentCaptureConstants.BARCODE_ANALYSIS_WIDTH_PX

    internal const val NANOS_A_MILLI: Long = 1_000_000
}

/**
 * C203.3 (behaviour M26): the PDF417 hint on a barcode-bearing side. Each analysis frame it reads (at
 * most one every [Pdf417Guidance.READ_INTERVAL_MS]) goes to the [reader] inside the frame callback;
 * a decoded PDF417 with an AAMVA header shows "barcode found" for [Pdf417Guidance.FOUND_HOLD_MS], and
 * the decoded bytes are wiped as soon as the header is judged: never kept, uploaded or logged. It
 * never takes the photo: the barcode is a hint, not an auto-capture gate (review F11), so on its own
 * the shutter is the primary action. Time is the frames' camera clock, never the wall clock.
 */
internal class BarcodeGuidance(private val reader: BarcodeReader) : CaptureGuidance {
    private val state = MutableStateFlow(BarcodeHint.SEARCHING)
    private var lastReadNanos: Long? = null
    private var lastFoundNanos: Long? = null

    /** The hint the overlay shows. */
    val hint: StateFlow<BarcodeHint> = state.asStateFlow()

    private val shown = MutableStateFlow(false)

    /**
     * Whether the guide is drawn (KP10-35): only while the latest frame can carry a barcode read
     * ([AnalysisSizes.barcodeRead] is not [BarcodeRead.NONE]). On a frame too narrow for a readable
     * symbol "fit the barcode in the box" would be a prompt the SDK cannot answer, so nothing is
     * shown and nothing is read; and nothing is shown before the first frame says what it carries.
     */
    val visible: StateFlow<Boolean> = shown.asStateFlow()

    /** Reads one analysis frame, inside its callback: the frame's bytes are valid only until this returns. */
    suspend fun onFrame(frame: AnalysisFrame) {
        if (AnalysisSizes.barcodeRead(frame.width, frame.height, frame.rotationDegrees) == BarcodeRead.NONE) {
            shown.value = false
            return
        }
        shown.value = true
        val now = frame.timestampNanos
        val found = lastFoundNanos
        if (found != null && now - found > Pdf417Guidance.FOUND_HOLD_MS * Pdf417Guidance.NANOS_A_MILLI) {
            lastFoundNanos = null
            state.value = BarcodeHint.SEARCHING
        }
        val last = lastReadNanos
        if (last != null && now >= last && now - last < Pdf417Guidance.READ_INTERVAL_MS * Pdf417Guidance.NANOS_A_MILLI) return
        lastReadNanos = now
        if (aamvaIn(frame)) {
            lastFoundNanos = now
            state.value = BarcodeHint.FOUND
        }
    }

    /** Decodes [frame] and judges the header; the decoded bytes are wiped before this returns. */
    private suspend fun aamvaIn(frame: AnalysisFrame): Boolean {
        val bytes = try {
            reader.readPdf417(frame)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            SdkLog.log("barcode.read_failed")
            null
        } ?: return false
        try {
            return AamvaHeader.matches(bytes)
        } finally {
            bytes.fill(0)
        }
    }

    override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
        frames.collect { onFrame(it) }
    }

    override val shutterPrimary: StateFlow<Boolean> = MutableStateFlow(true).asStateFlow()

    @Composable
    override fun Overlay(modifier: Modifier) {
        val drawn by visible.collectAsState()
        val words by hint.collectAsState()
        if (drawn) BarcodeOverlay(words, modifier)
    }

    override fun close() {
        (reader as? AutoCloseable)?.close()
    }
}

/**
 * C203.3: adds the barcode hint to [next]'s guidance (the document guidance) on a barcode-bearing side
 * ([isBarcodeBearing]), when the platform has a reader ([readers]: zxing-cpp on Android, none on iOS).
 * Every other side, and a platform without a reader, keeps [next]'s guidance unchanged, and no reader
 * is opened for it. `capture-pipeline` wraps its factory in this one.
 */
internal class BarcodeGuidanceFactory(
    private val next: CaptureGuidanceFactory?,
    private val readers: () -> BarcodeReader? = ::platformBarcodeReader,
) : CaptureGuidanceFactory {
    override fun create(state: FlowState.Capture): CaptureGuidance? {
        val document = next?.create(state)
        if (!isBarcodeBearing(state)) return document
        val reader = readers() ?: return document
        val barcode = BarcodeGuidance(reader)
        return if (document == null) barcode else BarcodeBesideDocument(document, barcode)
    }
}

/**
 * The barcode hint beside the document guidance, reading one frame stream: each frame passes the
 * barcode reader first, inside the same callback, then the document guidance, which alone decides
 * when the photo is taken and when the shutter is the primary action.
 */
private class BarcodeBesideDocument(
    private val document: CaptureGuidance,
    private val barcode: BarcodeGuidance,
) : CaptureGuidance {
    override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
        document.run(frames.onEach { barcode.onFrame(it) }, autoCapture)
    }

    override val shutterPrimary: StateFlow<Boolean> get() = document.shutterPrimary

    @Composable
    override fun Overlay(modifier: Modifier) {
        Box(modifier) {
            document.Overlay(Modifier.matchParentSize())
            barcode.Overlay(Modifier.matchParentSize())
        }
    }

    override fun close() {
        try {
            document.close()
        } finally {
            barcode.close()
        }
    }
}
