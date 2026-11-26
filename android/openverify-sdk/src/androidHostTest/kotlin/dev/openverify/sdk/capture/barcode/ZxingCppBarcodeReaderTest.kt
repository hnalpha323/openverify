package dev.openverify.sdk.capture.barcode

import android.graphics.Point
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import zxingcpp.BarcodeReader as ZxingReader

/**
 * C203.2 on Android, the parts a host can run: zxing-cpp's options (PDF417 only, raw bytes, the
 * options the vision test's host calibration uses), the choice among its results, and the reader
 * on a host without the native library, which decodes nothing and never throws into the guidance.
 * The device test (`ZxingCppBarcodeReaderDeviceTest`) decodes the committed images with the native
 * library itself.
 */
@RunWith(RobolectricTestRunner::class)
class ZxingCppBarcodeReaderTest {

    private fun result(
        format: ZxingReader.Format,
        bytes: ByteArray,
        error: ZxingReader.Error? = null,
    ) = ZxingReader.Result(
        format,
        bytes,
        "",
        ZxingReader.ContentType.TEXT,
        ZxingReader.Position(Point(0, 0), Point(1, 0), Point(1, 1), Point(0, 1), 0.0),
        0,
        "",
        "",
        -1,
        -1,
        "",
        false,
        1,
        error,
    )

    @Test
    fun theOptionsReadPdf417OnlyAsRawBytesWithTheCalibrationsSettings() {
        val options = pdf417Options()
        assertEquals(setOf(ZxingReader.Format.PDF_417), options.formats)
        assertEquals(ZxingReader.TextMode.PLAIN, options.textMode)
        assertTrue("any orientation", options.tryRotate)
        assertTrue("downscaled passes", options.tryDownscale)
        assertTrue(options.tryHarder)
        assertFalse("a licence is never printed inverted", options.tryInvert)
        assertFalse(options.isPure)
        assertEquals(ZxingReader.Binarizer.LOCAL_AVERAGE, options.binarizer)
        assertEquals(1, options.maxNumberOfSymbols)
        assertFalse("a failed read is no result", options.returnErrors)
    }

    @Test
    fun takesTheFirstDecodedPdf417sRawBytes() {
        val payload = "@\n\u001e\rANSI 636014100002".encodeToByteArray()
        val chosen = firstPdf417(
            listOf(
                result(ZxingReader.Format.QR_CODE, byteArrayOf(1)),
                result(ZxingReader.Format.PDF_417, byteArrayOf(2), ZxingReader.Error(ZxingReader.ErrorType.CHECKSUM, "")),
                result(ZxingReader.Format.PDF_417, byteArrayOf()),
                result(ZxingReader.Format.PDF_417, payload),
                result(ZxingReader.Format.PDF_417, byteArrayOf(3)),
            ),
        )
        assertSame("the decoder's own array: wiping it wipes the result's copy", payload, chosen)
        assertArrayEquals("@\n\u001e\rANSI 636014100002".encodeToByteArray(), chosen)
    }

    @Test
    fun aResultWithNoErrorTypeNoneCounts() {
        val payload = byteArrayOf(0x40)
        assertSame(payload, firstPdf417(listOf(result(ZxingReader.Format.PDF_417, payload, ZxingReader.Error(ZxingReader.ErrorType.NONE, "")))))
    }

    @Test
    fun noDecodedPdf417IsNoBytes() {
        assertNull(firstPdf417(emptyList()))
        assertNull(firstPdf417(listOf(result(ZxingReader.Format.DATA_MATRIX, byteArrayOf(1)))))
    }

    @Test
    fun androidsPlatformReaderIsZxingCpp() {
        val reader = platformBarcodeReader()
        assertTrue(reader is ZxingCppBarcodeReader)
        (reader as AutoCloseable).close()
    }

    @Test
    fun withoutItsNativeLibraryTheReaderDecodesNothingAndNeverThrows() = runTest {
        val reader = ZxingCppBarcodeReader()
        val frame = AnalysisFrame(4, 2, 0, PixelLayout.RGBA_8888, ByteArray(32), 0)
        assertNull(reader.readPdf417(frame))
        assertNull("the failed load is not retried into an error", reader.readPdf417(frame))
        reader.close()
        assertNull("a closed reader decodes nothing", reader.readPdf417(frame))
    }
}
