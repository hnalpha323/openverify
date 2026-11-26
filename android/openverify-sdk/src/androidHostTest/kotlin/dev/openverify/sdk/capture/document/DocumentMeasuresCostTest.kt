package dev.openverify.sdk.capture.document

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import java.lang.management.ManagementFactory
import kotlin.random.Random
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C202 (rule 19, the review's per-frame cost): each measure's CPU cost on one 640 x 480 analysis
 * frame on the host, in thread CPU time (never the wall clock, rule 6), printed for the TDD record;
 * the whole analysis of a frame stays inside the 125 ms between two sampled frames (8 Hz), and,
 * after the first frame of a size, allocates no buffer per frame.
 */
internal class DocumentMeasuresCostTest {
    private val threads = ManagementFactory.getThreadMXBean()
    private val width = 640
    private val height = 480

    /** A synthetic card-like frame: a light rectangle with dark marks over a noisy table, seeded. */
    private fun frame(): AnalysisFrame {
        val random = Random(42)
        val bytes = ByteArray(width * height * 4)
        val guide = DocumentGuide.inFrame(width, height, 0, DocumentGuide.CARD_ASPECT)
        for (y in 0 until height) for (x in 0 until width) {
            val inCard = x in guide.left until guide.right && y in guide.top until guide.bottom
            val mark = inCard && (y / 6) % 3 == 0 && (x / 5) % 2 == 0
            val base = when {
                mark -> 40
                inCard -> 210
                else -> 90 + random.nextInt(20)
            }
            val index = (y * width + x) * 4
            bytes[index] = base.toByte()
            bytes[index + 1] = (base + 5).coerceAtMost(255).toByte()
            bytes[index + 2] = (base - 5).toByte()
            bytes[index + 3] = -1
        }
        return AnalysisFrame(width, height, 0, PixelLayout.RGBA_8888, bytes, 0)
    }

    private fun cpuMillis(runs: Int, block: () -> Unit): Double {
        repeat(5) { block() }
        val samples = DoubleArray(runs) {
            val start = threads.currentThreadCpuTime
            block()
            (threads.currentThreadCpuTime - start) / 1_000_000.0
        }
        samples.sort()
        return samples[runs / 2]
    }

    @Test
    fun eachMeasuresCostAtTheAnalysisWidthIsRecordedAndAFrameFitsItsInterval() {
        assertTrue(threads.isCurrentThreadCpuTimeSupported)
        val frame = frame()
        val grey = IntArray(width * height)
        val energy = IntArray(width * height)
        val guide = DocumentGuide.inFrame(width, height, 0, DocumentGuide.CARD_ASPECT)
        DocumentMeasures.grey(frame.bytes, width, height, grey)
        DocumentMeasures.sobelEnergy(grey, width, height, energy)
        val costs = linkedMapOf(
            "grey" to cpuMillis(21) { DocumentMeasures.grey(frame.bytes, width, height, grey) },
            "sobel-energy" to cpuMillis(21) { DocumentMeasures.sobelEnergy(grey, width, height, energy) },
            "laplacian-variance" to cpuMillis(21) { DocumentMeasures.laplacianVariance(grey, width, height, guide) },
            "tenengrad" to cpuMillis(21) { DocumentMeasures.tenengrad(grey, width, height, guide) },
            "glare-share" to cpuMillis(21) { DocumentMeasures.glareShare(frame.bytes, width, height, guide) },
            "brightness-mean" to cpuMillis(21) { DocumentMeasures.brightnessMean(grey, width, height, guide) },
            "framing-edge-ratio" to cpuMillis(21) { DocumentMeasures.framingEdgeRatio(energy, width, height, guide) },
            "mrz-band-edge-density" to cpuMillis(21) { DocumentMeasures.mrzBandEdgeDensity(energy, width, height, guide, 0) },
        )
        val analyzer = DocumentFrameAnalyzer()
        val measurement = DocumentMeasurement()
        costs["whole-frame (with 9 smaller guides)"] = cpuMillis(21) { analyzer.measure(frame, DocumentGuide.CARD_ASPECT, measurement) }
        println("document-guidance per-frame CPU ms at ${width}x$height (median of 21): $costs")
        assertTrue(costs.getValue("whole-frame (with 9 smaller guides)") < 125.0, "a frame's analysis fits the 8 Hz interval: $costs")
    }

    @Test
    fun theAnalyzerAllocatesNoBufferPerFrameAfterTheFirstOfASize() {
        val beans = threads as com.sun.management.ThreadMXBean
        val frame = frame()
        val analyzer = DocumentFrameAnalyzer()
        val measurement = DocumentMeasurement()
        repeat(10) { analyzer.measure(frame, DocumentGuide.CARD_ASPECT, measurement) }
        val id = Thread.currentThread().id
        val before = beans.getThreadAllocatedBytes(id)
        repeat(20) { analyzer.measure(frame, DocumentGuide.CARD_ASPECT, measurement) }
        val perFrame = (beans.getThreadAllocatedBytes(id) - before) / 20
        println("document-guidance bytes allocated per frame after the first: $perFrame")
        // A frame's buffers are 2 x 1.2 MB at 640 x 480: well under one of them per frame means none was allocated.
        assertTrue(perFrame < 4_096, "bytes allocated per frame: $perFrame")
    }
}
