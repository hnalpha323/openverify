package dev.openverify.sdk.capture.document

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A rectangle of a frame in pixels, [right] and [bottom] exclusive (C202.1): the card or page guide,
 * or the region a measure reads.
 */
internal data class FrameRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}

/**
 * C202.1 (decision 18): the document measures, pure Kotlin with no OpenCV.
 *
 * Four are ports of `services/vision/src/openverify_vision/quality.py`, reproducing OpenCV 5's
 * integer arithmetic exactly (`contracts/fixtures/flow/document-quality-vectors.json` names each
 * conversion; `DocumentQualityVectorsTest` holds them to the server's values):
 * - [grey]: `cvtColor`'s fixed point, `(9798 R + 19235 G + 3735 B + 16384) >> 15`;
 * - [laplacianVariance]: `quality.blur_score`, the population variance of the 3 x 3 Laplacian;
 * - [tenengrad]: `quality.tenengrad`, the mean of the 3 x 3 Sobel `gx² + gy²`;
 * - [glareShare]: `quality.glare_ratio`, the share at HSV value ≥ 250 and saturation ≤ 40 on
 *   OpenCV's 8-bit scale;
 * - [brightnessMean]: `quality.brightness`, the mean grey over 255.
 *
 * Every filter reads the region as an image of its own, its border reflected without repeating the
 * edge pixel (`BORDER_REFLECT_101`), as the server measures a crop. Two are ours, since the server
 * has no equivalent; `services/vision/tools/android_document_guidance.py` defines the reference the
 * vectors and the calibration use: [framingEdgeRatio] and [mrzBandEdgeDensity] over the frame's
 * [sobelEnergy].
 *
 * Guidance only (ADR 0009, C202.5): no value here is sent, logged or kept past its frame.
 */
internal object DocumentMeasures {
    /** C202.1: half a border's search band, in percent of the guide's shorter side (the tool's `FRAMING_BAND_PERCENT`). */
    internal const val FRAMING_BAND_PERCENT: Int = 6

    /** Added to the energy beyond a border (the tool's `FRAMING_ENERGY_FLOOR`): about the Sobel energy of 2 grey levels of sensor noise. */
    internal const val FRAMING_ENERGY_FLOOR: Double = 100.0

    /** C202.3: a pixel is an edge of the machine-readable band at this Sobel energy: a sharp 30-grey step (the tool's `MRZ_EDGE_ENERGY`). */
    internal const val MRZ_EDGE_ENERGY: Int = 14_400

    /** C202.3: the lines averaged together are the guide's height over this (the tool's `MRZ_WINDOW_DIVISOR`). */
    internal const val MRZ_WINDOW_DIVISOR: Int = 24

    private const val GLARE_VALUE_MIN = 250
    private const val GLARE_SATURATION_MAX = 40

    /** OpenCV's `sdiv_table`: `round((255 << 12) / v)`, 0 for 0. */
    private val SATURATION_DIVISORS = IntArray(256) { v -> if (v == 0) 0 else ((255 shl 12).toDouble() / v).roundToInt() }

    private fun requireInside(width: Int, height: Int, rect: FrameRect) {
        require(rect.left >= 0 && rect.top >= 0 && rect.left < rect.right && rect.top < rect.bottom && rect.right <= width && rect.bottom <= height) {
            "DocumentMeasures: a region is non-empty and inside its frame"
        }
    }

    /** [index] reflected into `[low, high)` without repeating the edge (`BORDER_REFLECT_101`). */
    private fun reflect(index: Int, low: Int, high: Int): Int = when {
        high - low == 1 -> low
        index < low -> 2 * low - index
        index >= high -> 2 * (high - 1) - index
        else -> index
    }

    /** `cvtColor`'s grey of every pixel of an RGBA_8888 frame, into [out]. */
    fun grey(rgba: ByteArray, width: Int, height: Int, out: IntArray) {
        require(rgba.size >= width * height * 4 && out.size >= width * height) { "DocumentMeasures: the buffers hold the frame" }
        for (pixel in 0 until width * height) {
            val base = pixel * 4
            val red = rgba[base].toInt() and 0xff
            val green = rgba[base + 1].toInt() and 0xff
            val blue = rgba[base + 2].toInt() and 0xff
            out[pixel] = (9798 * red + 19235 * green + 3735 * blue + 16384) shr 15
        }
    }

    /** `quality.blur_score` of [region] read as its own image. */
    fun laplacianVariance(grey: IntArray, width: Int, height: Int, region: FrameRect): Double {
        requireInside(width, height, region)
        var sum = 0L
        var squares = 0L
        for (y in region.top until region.bottom) {
            val up = reflect(y - 1, region.top, region.bottom) * width
            val down = reflect(y + 1, region.top, region.bottom) * width
            val row = y * width
            for (x in region.left until region.right) {
                val left = reflect(x - 1, region.left, region.right)
                val right = reflect(x + 1, region.left, region.right)
                val value = grey[up + x] + grey[down + x] + grey[row + left] + grey[row + right] - 4 * grey[row + x]
                sum += value
                squares += value.toLong() * value
            }
        }
        val count = region.width.toLong() * region.height
        val numerator = count * squares - sum * sum
        return numerator.toDouble() / (count.toDouble() * count.toDouble())
    }

    /** The 3 x 3 Sobel energy `gx² + gy²` at ([x], [y]) of the region `[top, bottom) x [left, right)` read as its own image. */
    private fun energyAt(grey: IntArray, width: Int, top: Int, bottom: Int, regionLeft: Int, regionRight: Int, x: Int, y: Int): Int {
        val up = reflect(y - 1, top, bottom) * width
        val row = y * width
        val down = reflect(y + 1, top, bottom) * width
        val left = reflect(x - 1, regionLeft, regionRight)
        val right = reflect(x + 1, regionLeft, regionRight)
        val gx = (grey[up + right] + 2 * grey[row + right] + grey[down + right]) - (grey[up + left] + 2 * grey[row + left] + grey[down + left])
        val gy = (grey[down + left] + 2 * grey[down + x] + grey[down + right]) - (grey[up + left] + 2 * grey[up + x] + grey[up + right])
        return gx * gx + gy * gy
    }

    /** `quality.tenengrad` of [region] read as its own image. */
    fun tenengrad(grey: IntArray, width: Int, height: Int, region: FrameRect): Double {
        requireInside(width, height, region)
        var sum = 0L
        for (y in region.top until region.bottom) {
            for (x in region.left until region.right) sum += energyAt(grey, width, region.top, region.bottom, region.left, region.right, x, y)
        }
        return sum.toDouble() / (region.width.toLong() * region.height).toDouble()
    }

    /** `quality.glare_ratio` of [region]: the share of its pixels at HSV value ≥ 250 and saturation ≤ 40. */
    fun glareShare(rgba: ByteArray, width: Int, height: Int, region: FrameRect): Double {
        requireInside(width, height, region)
        var glare = 0
        for (y in region.top until region.bottom) {
            for (x in region.left until region.right) {
                val base = (y * width + x) * 4
                val red = rgba[base].toInt() and 0xff
                val green = rgba[base + 1].toInt() and 0xff
                val blue = rgba[base + 2].toInt() and 0xff
                val value = max(red, max(green, blue))
                if (value < GLARE_VALUE_MIN) continue
                val low = min(red, min(green, blue))
                val saturation = ((value - low) * SATURATION_DIVISORS[value] + 2048) shr 12
                if (saturation <= GLARE_SATURATION_MAX) glare++
            }
        }
        return glare.toDouble() / (region.width.toLong() * region.height).toDouble()
    }

    /** `quality.brightness` of [region]: its mean grey over 255. */
    fun brightnessMean(grey: IntArray, width: Int, height: Int, region: FrameRect): Double {
        requireInside(width, height, region)
        var sum = 0L
        for (y in region.top until region.bottom) {
            val row = y * width
            for (x in region.left until region.right) sum += grey[row + x]
        }
        return sum.toDouble() / (region.width.toLong() * region.height).toDouble() / 255.0
    }

    /** The 3 x 3 Sobel energy `gx² + gy²` of every pixel of the frame (`BORDER_REFLECT_101`), into [out]. */
    fun sobelEnergy(grey: IntArray, width: Int, height: Int, out: IntArray) {
        require(grey.size >= width * height && out.size >= width * height) { "DocumentMeasures: the buffers hold the frame" }
        for (y in 0 until height) {
            for (x in 0 until width) out[y * width + x] = energyAt(grey, width, 0, height, 0, width, x, y)
        }
    }

    /** C202.1: [FRAMING_BAND_PERCENT] of the guide's shorter side, rounded half up, at least one pixel. */
    fun bandHalfWidth(guide: FrameRect): Int = max(1, (min(guide.width, guide.height) * FRAMING_BAND_PERCENT + 50) / 100)

    private fun rowMean(energy: IntArray, width: Int, y: Int, left: Int, right: Int): Double {
        var sum = 0L
        val row = y * width
        for (x in left until right) sum += energy[row + x]
        return sum.toDouble() / (right - left).toDouble()
    }

    private fun columnMean(energy: IntArray, width: Int, x: Int, top: Int, bottom: Int): Double {
        var sum = 0L
        for (y in top until bottom) sum += energy[y * width + x]
        return sum.toDouble() / (bottom - top).toDouble()
    }

    /** The mean energy of rows [top, bottom) by columns [left, right) clipped to the frame, 0 when nothing is left. */
    private fun stripMean(energy: IntArray, width: Int, height: Int, top: Int, bottom: Int, left: Int, right: Int): Double {
        val rowFrom = max(0, top)
        val rowTo = min(height, bottom)
        val columnFrom = max(0, left)
        val columnTo = min(width, right)
        if (rowTo <= rowFrom || columnTo <= columnFrom) return 0.0
        var sum = 0L
        for (y in rowFrom until rowTo) {
            val row = y * width
            for (x in columnFrom until columnTo) sum += energy[row + x]
        }
        return sum.toDouble() / ((rowTo - rowFrom).toLong() * (columnTo - columnFrom)).toDouble()
    }

    /**
     * C202.1 (ours): how strongly an edge runs along [guide]'s borders against what lies just beyond
     * them. Each border's band of [bandHalfWidth] lines on both sides is searched for the line (a row
     * for the top and bottom, a column for the sides, over the guide's extent) with the highest mean
     * energy; its score is that mean over the mean energy of the strip of twice the band just beyond
     * it, outside the guide (0 where the strip leaves the frame), plus [FRAMING_ENERGY_FLOOR]. The
     * ratio is the second-weakest border's score: three borders must show an edge, since a card edge
     * of the table's own tone shows none.
     */
    fun framingEdgeRatio(energy: IntArray, width: Int, height: Int, guide: FrameRect): Double {
        requireInside(width, height, guide)
        val band = bandHalfWidth(guide)
        var top = 0.0
        for (y in max(0, guide.top - band) until min(height, guide.top + band)) top = max(top, rowMean(energy, width, y, guide.left, guide.right))
        var bottom = 0.0
        for (y in max(0, guide.bottom - band) until min(height, guide.bottom + band)) bottom = max(bottom, rowMean(energy, width, y, guide.left, guide.right))
        var left = 0.0
        for (x in max(0, guide.left - band) until min(width, guide.left + band)) left = max(left, columnMean(energy, width, x, guide.top, guide.bottom))
        var right = 0.0
        for (x in max(0, guide.right - band) until min(width, guide.right + band)) right = max(right, columnMean(energy, width, x, guide.top, guide.bottom))
        val beyondTop = stripMean(energy, width, height, guide.top - 3 * band, guide.top - band, guide.left, guide.right)
        val beyondBottom = stripMean(energy, width, height, guide.bottom + band, guide.bottom + 3 * band, guide.left, guide.right)
        val beyondLeft = stripMean(energy, width, height, guide.top, guide.bottom, guide.left - 3 * band, guide.left - band)
        val beyondRight = stripMean(energy, width, height, guide.top, guide.bottom, guide.right + band, guide.right + 3 * band)
        return secondSmallest(
            top / (beyondTop + FRAMING_ENERGY_FLOOR),
            bottom / (beyondBottom + FRAMING_ENERGY_FLOOR),
            left / (beyondLeft + FRAMING_ENERGY_FLOOR),
            right / (beyondRight + FRAMING_ENERGY_FLOOR),
        )
    }

    private fun secondSmallest(a: Double, b: Double, c: Double, d: Double): Double {
        val lowPair = min(a, b)
        val highPair = max(a, b)
        val lowOther = min(c, d)
        val highOther = max(c, d)
        return min(max(lowPair, lowOther), min(highPair, highOther))
    }

    /** C202.3: [guide] scaled to [percent] of its width and height about its centre, in whole pixels (the tool's `shrunk_guide`). */
    fun shrunkGuide(guide: FrameRect, percent: Int): FrameRect {
        val newWidth = max(1, (guide.width * percent + 50) / 100)
        val newHeight = max(1, (guide.height * percent + 50) / 100)
        val left = guide.left + (guide.width - newWidth) / 2
        val top = guide.top + (guide.height - newHeight) / 2
        return FrameRect(left, top, left + newWidth, top + newHeight)
    }

    /**
     * C202.3 (ours): the edge density of the guide's lower third as the person sees it. [rotationDegrees]
     * turns the frame upright (C201.1), so the upright bottom is the frame's bottom (0), right (90),
     * top (180) or left (270). Along that band, each line parallel to the guide's bottom edge counts
     * its edge pixels ([MRZ_EDGE_ENERGY]) over the guide's extent; the densest window of
     * `max(1, guide height / MRZ_WINDOW_DIVISOR)` consecutive lines is the answer.
     */
    fun mrzBandEdgeDensity(energy: IntArray, width: Int, height: Int, guide: FrameRect, rotationDegrees: Int): Double {
        requireInside(width, height, guide)
        require(rotationDegrees == 0 || rotationDegrees == 90 || rotationDegrees == 180 || rotationDegrees == 270) {
            "DocumentMeasures: the rotation is 0, 90, 180 or 270"
        }
        val sideways = rotationDegrees == 90 || rotationDegrees == 270
        // In the frame read with rows and columns swapped when sideways: lines run along `across`.
        val lineFrom = if (sideways) guide.top else guide.left
        val lineTo = if (sideways) guide.bottom else guide.right
        val first = if (sideways) guide.left else guide.top
        val last = if (sideways) guide.right else guide.bottom
        val span = lineTo - lineFrom
        val third = max(1, (last - first) / 3)
        val start = if (rotationDegrees == 180 || rotationDegrees == 270) first else last - third
        val window = min(third, max(1, (last - first) / MRZ_WINDOW_DIVISOR))
        var best = 0
        var running = 0
        for (line in 0 until third) {
            running += edgesOnLine(energy, width, sideways, start + line, lineFrom, lineTo)
            if (line >= window) running -= edgesOnLine(energy, width, sideways, start + line - window, lineFrom, lineTo)
            if (line >= window - 1) best = max(best, running)
        }
        return best.toDouble() / (window.toLong() * span).toDouble()
    }

    private fun edgesOnLine(energy: IntArray, width: Int, sideways: Boolean, line: Int, from: Int, to: Int): Int {
        var edges = 0
        for (along in from until to) {
            val index = if (sideways) along * width + line else line * width + along
            if (energy[index] >= MRZ_EDGE_ENERGY) edges++
        }
        return edges
    }
}
