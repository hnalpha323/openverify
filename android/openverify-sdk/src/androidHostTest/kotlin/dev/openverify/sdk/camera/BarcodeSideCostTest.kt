package dev.openverify.sdk.camera

import dev.openverify.sdk.capture.document.DocumentFrameAnalyzer
import dev.openverify.sdk.capture.document.DocumentGuide
import dev.openverify.sdk.capture.document.DocumentMeasurement
import dev.openverify.sdk.testing.CpuCost
import java.nio.ByteBuffer
import kotlin.random.Random
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * KP10-21 (C201.2, review F11; rule 6: thread CPU time, held against a reference workload measured
 * beside it, [CpuCost]): what a barcode side's 1,280 x 960 frame costs on the host, printed for the
 * TDD record. The document guidance measures the same frame the barcode
 * hint reads, so its whole analysis must still fit the 125 ms between two sampled frames (8 Hz) at
 * four times the pixels of a card's 640 x 480. The second figure is review F11's comparison on the
 * host: the copy of that frame against the copy of a full-resolution crop of the guide area (90% of
 * the width at the card's shape) of the CI emulator's largest size, 1,856 x 1,392. The device's own
 * figures are the device test's (`CameraXFramePipelineTest`).
 */
internal class BarcodeSideCostTest {
    /** A synthetic card-like frame: a light rectangle with dark marks over a noisy table, seeded. */
    private fun frame(width: Int, height: Int): AnalysisFrame {
        val random = Random(42)
        val bytes = ByteArray(width * height * AnalysisFrame.BYTES_PER_PIXEL)
        val guide = DocumentGuide.inFrame(width, height, 0, DocumentGuide.CARD_ASPECT)
        for (y in 0 until height) for (x in 0 until width) {
            val inCard = x in guide.left until guide.right && y in guide.top until guide.bottom
            val mark = inCard && (y / 6) % 3 == 0 && (x / 5) % 2 == 0
            val base = when {
                mark -> 40
                inCard -> 210
                else -> 90 + random.nextInt(20)
            }
            val index = (y * width + x) * AnalysisFrame.BYTES_PER_PIXEL
            bytes[index] = base.toByte()
            bytes[index + 1] = (base + 5).toByte()
            bytes[index + 2] = (base - 5).toByte()
            bytes[index + 3] = -1
        }
        return AnalysisFrame(width, height, 0, PixelLayout.RGBA_8888, bytes, 0)
    }

    @Test
    fun `the document guidance still fits its interval on a barcode side's frame`() {
        assertTrue(CpuCost.supported)
        val costs = listOf(AnalysisTarget.DOCUMENT, AnalysisTarget.BARCODE).associate { target ->
            val frame = frame(target.longSidePx, target.shortSidePx)
            val analyzer = DocumentFrameAnalyzer()
            val measurement = DocumentMeasurement()
            target to CpuCost.relative(RUNS) { analyzer.measure(frame, DocumentGuide.CARD_ASPECT, measurement) }
        }

        println(
            "document guidance a frame (median of $RUNS): " +
                costs.entries.joinToString { (target, cost) -> "${target.longSidePx}x${target.shortSidePx} ${"%.1f".format(cost.millis)} ms CPU, ${"%.2f".format(cost.ratio)} times the reference's ${"%.1f".format(cost.referenceMillis)} ms" },
        )
        val barcode = costs.getValue(AnalysisTarget.BARCODE)
        assertTrue(barcode.ratio < INTERVAL_BUDGET, "a barcode side's frame takes ${barcode.ratio} times the reference workload, over the budget of $INTERVAL_BUDGET")
    }

    @Test
    fun `the copy of the barcode frame is cheaper than the copy of a full-resolution guide crop`() {
        fun copy(width: Int, height: Int): CpuCost.Relative {
            val rowStride = width * AnalysisFrame.BYTES_PER_PIXEL + 64
            val plane = ByteBuffer.allocateDirect(rowStride * height)
            val into = ByteArray(width * height * AnalysisFrame.BYTES_PER_PIXEL)
            return CpuCost.relative(RUNS) { assertTrue(RgbaFrames.copy(plane, rowStride, AnalysisFrame.BYTES_PER_PIXEL, width, height, into)) }
        }
        val cropWidth = (LARGEST_WIDTH * DocumentGuide.GUIDE_SHARE).toInt()
        val cropHeight = (cropWidth / DocumentGuide.CARD_ASPECT).toInt()

        val frame = copy(AnalysisTarget.BARCODE.longSidePx, AnalysisTarget.BARCODE.shortSidePx)
        val crop = copy(cropWidth, cropHeight)

        println("copy CPU ms (median of $RUNS): frame 1280x960 ${"%.3f".format(frame.millis)}; guide crop ${cropWidth}x$cropHeight of 1856x1392 ${"%.3f".format(crop.millis)}; as multiples of the reference ${"%.4f".format(frame.ratio)} and ${"%.4f".format(crop.ratio)}")
        assertTrue(frame.ratio < crop.ratio, "the 1,280 px frame (${frame.ratio} times the reference) against the crop (${crop.ratio})")
    }

    private companion object {
        const val RUNS = 11

        /**
         * Half the 125 ms between two sampled frames (8 Hz), in units of [CpuCost.reference]: 62.5 ms
         * over the reference's 24.5 ms on a quiet host. Provisional. A barcode side's frame measured
         * 1.59 times the reference on a quiet host (39.3 ms) and 1.91 beside 36 busy loops (86.3 ms,
         * where the bound in milliseconds failed): `docs/tdd/phase10-integration-10c.tdd.md`.
         */
        const val INTERVAL_BUDGET = 2.55

        /** The CI emulator's largest analysis size (run 42762952128). */
        const val LARGEST_WIDTH = 1856
    }
}
