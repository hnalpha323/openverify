package dev.openverify.sdk.capture.document

import dev.openverify.sdk.capture.document.DocumentCaptureConstants as C
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * C202.3: one hint at a time, the first in the fixed order (move closer, hold still, tilt away from
 * the light, more light, fit the card in the frame), then the machine-readable band on a passport
 * page. Measurements are built here on either side of the shared thresholds; nothing is tuned on them.
 */
class DocumentHintsTest {
    private fun held(): DocumentMeasurement = DocumentMeasurement().apply {
        laplacianVariance = C.SHARPNESS_LAPLACIAN_VARIANCE_MIN * 3
        tenengrad = C.SHARPNESS_TENENGRAD_MIN * 2
        glareShare = 0.0
        brightnessMean = (C.BRIGHTNESS_MEAN_MIN + C.BRIGHTNESS_MEAN_MAX) / 2
        framingEdgeRatio = C.FRAMING_EDGE_RATIO_MIN * 5
        framingShrunkBest = 1.0
        mrzBandEdgeDensity = C.MRZ_BAND_EDGE_DENSITY_MIN * 2
    }

    @Test
    fun theOrderIsFixed() {
        assertEquals(
            listOf("MOVE_CLOSER", "HOLD_STILL", "TILT_AWAY", "MORE_LIGHT", "FIT_CARD", "SHOW_MRZ"),
            DocumentHint.entries.map { it.name },
        )
    }

    @Test
    fun everyGateHeldShowsNoHint() {
        assertNull(DocumentHints.hintOf(held(), passport = false))
        assertNull(DocumentHints.hintOf(held(), passport = true))
    }

    @Test
    fun aThresholdItselfHolds() {
        val atThresholds = held().apply {
            laplacianVariance = C.SHARPNESS_LAPLACIAN_VARIANCE_MIN
            tenengrad = C.SHARPNESS_TENENGRAD_MIN
            glareShare = C.GLARE_SHARE_MAX
            brightnessMean = C.BRIGHTNESS_MEAN_MIN
            framingEdgeRatio = C.FRAMING_EDGE_RATIO_MIN
            mrzBandEdgeDensity = C.MRZ_BAND_EDGE_DENSITY_MIN
        }
        assertNull(DocumentHints.hintOf(atThresholds, passport = true))
        assertNull(DocumentHints.hintOf(held().apply { brightnessMean = C.BRIGHTNESS_MEAN_MAX }, passport = true))
    }

    @Test
    fun eachBrokenGateHasItsHint() {
        val unframed = C.FRAMING_EDGE_RATIO_MIN / 2
        assertEquals(DocumentHint.MOVE_CLOSER, DocumentHints.hintOf(held().apply { framingEdgeRatio = unframed; framingShrunkBest = C.FRAMING_EDGE_RATIO_MIN }, false))
        assertEquals(DocumentHint.HOLD_STILL, DocumentHints.hintOf(held().apply { laplacianVariance = C.SHARPNESS_LAPLACIAN_VARIANCE_MIN / 2 }, false))
        assertEquals(DocumentHint.HOLD_STILL, DocumentHints.hintOf(held().apply { tenengrad = C.SHARPNESS_TENENGRAD_MIN / 2 }, false))
        assertEquals(DocumentHint.TILT_AWAY, DocumentHints.hintOf(held().apply { glareShare = C.GLARE_SHARE_MAX * 2 }, false))
        assertEquals(DocumentHint.TILT_AWAY, DocumentHints.hintOf(held().apply { brightnessMean = (C.BRIGHTNESS_MEAN_MAX + 1) / 2 }, false))
        assertEquals(DocumentHint.MORE_LIGHT, DocumentHints.hintOf(held().apply { brightnessMean = C.BRIGHTNESS_MEAN_MIN / 2 }, false))
        assertEquals(DocumentHint.FIT_CARD, DocumentHints.hintOf(held().apply { framingEdgeRatio = unframed }, false))
        assertEquals(DocumentHint.SHOW_MRZ, DocumentHints.hintOf(held().apply { mrzBandEdgeDensity = 0.0 }, true))
        assertNull(DocumentHints.hintOf(held().apply { mrzBandEdgeDensity = 0.0 }, false), "the band is a passport page's only")
    }

    @Test
    fun theFirstInOrderWinsWhenSeveralBreak() {
        val everything = held().apply {
            framingEdgeRatio = C.FRAMING_EDGE_RATIO_MIN / 2
            framingShrunkBest = C.FRAMING_EDGE_RATIO_MIN
            laplacianVariance = 0.0
            glareShare = 1.0
            mrzBandEdgeDensity = 0.0
        }
        assertEquals(DocumentHint.MOVE_CLOSER, DocumentHints.hintOf(everything, true))
        assertEquals(DocumentHint.TILT_AWAY, DocumentHints.hintOf(everything.apply { framingShrunkBest = 0.0 }, true))
        assertEquals(DocumentHint.MORE_LIGHT, DocumentHints.hintOf(held().apply { brightnessMean = 0.05; framingEdgeRatio = 0.0; laplacianVariance = 0.0 }, false))
        assertEquals(DocumentHint.FIT_CARD, DocumentHints.hintOf(held().apply { framingEdgeRatio = 0.0; laplacianVariance = 0.0 }, true))
        assertEquals(DocumentHint.HOLD_STILL, DocumentHints.hintOf(held().apply { laplacianVariance = 0.0; mrzBandEdgeDensity = 0.0 }, true))
    }

    @Test
    fun holdStillIsAskedOnlyOfALitClearFramedCard() {
        // A blurred measure in the dark is the dark's, and an unframed card's is the framing's.
        assertEquals(DocumentHint.MORE_LIGHT, DocumentHints.hintOf(held().apply { laplacianVariance = 0.0; brightnessMean = 0.0 }, false))
        assertEquals(DocumentHint.TILT_AWAY, DocumentHints.hintOf(held().apply { laplacianVariance = 0.0; glareShare = 1.0 }, false))
        assertEquals(DocumentHint.FIT_CARD, DocumentHints.hintOf(held().apply { laplacianVariance = 0.0; framingEdgeRatio = 0.0 }, false))
    }
}
