package dev.openverify.sdk.camera

import dev.openverify.sdk.capture.document.DocumentGuide

/** A camera output size, in the sensor's orientation. */
internal data class FrameSize(val width: Int, val height: Int) {
    val longSide: Int get() = maxOf(width, height)
    val shortSide: Int get() = minOf(width, height)
    val area: Long get() = width.toLong() * height

    /** The still's shape (C201.2). */
    val fourByThree: Boolean get() = longSide * 3 == shortSide * 4

    override fun toString(): String = "${width}x$height"
}

/**
 * KP10-21 (C201.2, review F11): what a barcode-bearing side's analysis frames can carry, judged from a
 * frame the camera gave, never from the size that was asked. The PDF417 read is a hint that gates
 * nothing (C203.3), so a shortfall changes no result; it is known, and the camera logs its code in a
 * debuggable host (`camera.barcode_analysis_narrow`, `camera.barcode_analysis_unreadable`).
 */
internal enum class BarcodeRead {
    /** The frame's long side is the barcode width or more: the read C201.2 asks for. */
    STREAM,

    /**
     * A smaller frame whose guide still spans [AnalysisSizes.READABLE_SYMBOL_PX]: a symbol is read only
     * while it nearly fills the guide.
     */
    NARROW,

    /** The guide itself is narrower than the calibrated symbol: no reliable read can be made on this frame. */
    NONE,
}

/**
 * KP10-21 (C201.2, review F11): which analysis size a camera runs beside the preview and a full-size
 * still, and what a barcode read on a given frame can carry.
 *
 * The first is CameraX's rule, read from CameraX 1.6.2 (`GuaranteedConfigurationsUtil`,
 * `SurfaceConfig`, `DisplayInfoManager`): on every hardware level the guaranteed combination for a
 * preview, a YUV stream and a maximum-size JPEG holds the YUV stream to the PREVIEW class, which is
 * the display's area, at most 1920 x 1080 and never under 640 x 480. So the 1,280 px a barcode side
 * asks for is granted only where the display and the camera's size list allow it: the CI emulator
 * (a 320 x 640 display, no 4:3 size between 1024 x 768 and 1856 x 1392) gave 640 x 480 in run
 * 42762952128. [beside] is that rule as a pure function, for the tests and the device test's record;
 * the binding itself leaves the choice to CameraX (`CameraXCaptureCamera.analysisUseCase`), which
 * applies the same rule and more (a still inside the RECORD class allows a larger stream on LIMITED
 * and better cameras). No device has confirmed this reading yet (the device proof is open).
 *
 * A full-resolution crop of the guide area, review F11's other way, has no stream to come from: no
 * guaranteed combination gives a YUV stream above the preview class beside a maximum-size JPEG, and
 * the still itself is the photo the person takes, not a frame to sample for a hint.
 */
internal object AnalysisSizes {
    /** CameraX's VGA class: a stream of this area or less is always inside the preview class. */
    val VGA: FrameSize = FrameSize(640, 480)

    /** CameraX's largest preview class (`DisplayInfoManager.MAX_PREVIEW_SIZE`). */
    val PREVIEW_MAX: FrameSize = FrameSize(1920, 1080)

    /** A display under this area is read as [VGA] (`DisplayInfoManager.ABNORMAL_DISPLAY_SIZE_THRESHOLD`). */
    val SMALLEST_DISPLAY: FrameSize = FrameSize(320, 240)

    /**
     * The width in pixels from which the host calibration reads a licence's PDF417 reliably: 1.62
     * pixels a module, 40% of the barcode width (Workflow 10B Stage 2, pdf417-guidance 1). Provisional:
     * synthetic symbols on the host, no camera frame.
     */
    const val READABLE_SYMBOL_PX: Int = 512

    /** The preview class of a [display]: its own area, at most [PREVIEW_MAX], and [VGA] for a tiny display. */
    fun previewBound(display: FrameSize): FrameSize = when {
        display.area < SMALLEST_DISPLAY.area -> VGA
        display.area >= PREVIEW_MAX.area -> PREVIEW_MAX
        else -> display
    }

    /**
     * The size [target]'s analysis gets among the [offered] ones beside the preview and a full-size
     * still, inside the preview class [bound]: the still's 4:3 shape first (other shapes only when the
     * camera has no 4:3 size inside the class), the smallest at or above the target's long side, else
     * the largest below it; `null` when no offered size is inside the class.
     */
    fun beside(target: AnalysisTarget, offered: List<FrameSize>, bound: FrameSize): FrameSize? {
        val limit = maxOf(bound.area, VGA.area)
        val inside = offered.filter { it.area <= limit }
        val shaped = inside.filter { it.fourByThree }.ifEmpty { inside }
        return shaped.filter { it.longSide >= target.longSidePx }.minByOrNull { it.area }
            ?: shaped.maxByOrNull { it.area }
    }

    /**
     * What a barcode read can carry on a [width] x [height] frame that [rotationDegrees] turns upright.
     * The capture guide spans [DocumentGuide.GUIDE_SHARE] of the upright frame's width, and the symbol
     * lies inside the guide, so a guide narrower than [READABLE_SYMBOL_PX] cannot hold a readable one.
     */
    fun barcodeRead(width: Int, height: Int, rotationDegrees: Int): BarcodeRead {
        if (maxOf(width, height) >= AnalysisTarget.BARCODE.longSidePx) return BarcodeRead.STREAM
        val uprightWidth = if (rotationDegrees == 90 || rotationDegrees == 270) height else width
        val guidePx = (uprightWidth * DocumentGuide.GUIDE_SHARE).toInt()
        return if (guidePx >= READABLE_SYMBOL_PX) BarcodeRead.NARROW else BarcodeRead.NONE
    }
}

/**
 * KP10-21: between the analyzer and the frames' reader on a barcode side. The first frame a reader
 * takes in a camera session tells [report] what a barcode read on it can carry
 * ([AnalysisSizes.barcodeRead]), once; every frame passes on unchanged. Another [target] tells
 * nothing. Called on the analysis thread only.
 */
internal class BarcodeReadSink(
    private val target: AnalysisTarget,
    private val next: FrameSink,
    private val report: (BarcodeRead) -> Unit,
) : FrameSink {
    private var told = target != AnalysisTarget.BARCODE

    override fun wanted(): Boolean = next.wanted()

    override suspend fun deliver(frame: AnalysisFrame): FrameDelivery {
        if (!told) {
            told = true
            report(AnalysisSizes.barcodeRead(frame.width, frame.height, frame.rotationDegrees))
        }
        return next.deliver(frame)
    }
}
