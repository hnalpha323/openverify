package dev.openverify.sdk.capture.barcode

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.flow.logic.Sha256
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer

/**
 * C203.2, C219.5 (review F11): zxing-cpp's native library on a device (CI's emulator only: there is no
 * local emulator) decodes the committed synthetic AAMVA PDF417 images, at the generator's full size and
 * at the 640 px analysis width, to exactly their payloads, through the SDK's own bridge and an
 * RGBA_8888 [AnalysisFrame] as CameraX delivers it; and the guidance says "barcode found" for the AAMVA
 * ones only. The images and `index.json` are `services/vision/tests/test_android_pdf417_assets.py`'s.
 * Every assertion about the SDK's logic has its host twin over a fake reader (`BarcodeGuidanceTest`,
 * `ZxingCppBarcodeReaderTest`); this test checks the native glue.
 */
@RunWith(AndroidJUnit4::class)
class ZxingCppBarcodeReaderDeviceTest {

    private class Asset(val file: String, val scale: String, val width: Int, val aamvaHeader: Boolean, val payloadSha256: String)

    private fun bytesOf(name: String): ByteArray {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("capture/barcode/$name")) { "missing test resource $name" }
        return stream.use { it.readBytes() }
    }

    private fun assets(): List<Asset> {
        val list = JSONObject(bytesOf("index.json").decodeToString()).getJSONArray("assets")
        return (0 until list.length()).map { list.getJSONObject(it) }.map {
            Asset(it.getString("file"), it.getString("scale"), it.getInt("width"), it.getBoolean("aamva-header"), it.getString("payload-sha256"))
        }
    }

    /** The image as an analysis frame: RGBA_8888, rows packed, as `capture-pipeline`'s analyzer copies a frame. */
    private fun frameOf(file: String, rotation: Int = 0): AnalysisFrame {
        val png = bytesOf(file)
        val decoded = checkNotNull(BitmapFactory.decodeByteArray(png, 0, png.size)) { "not a PNG: $file" }
        val bitmap = decoded.copy(Bitmap.Config.ARGB_8888, false)
        val pixels = ByteArray(bitmap.width * bitmap.height * AnalysisFrame.BYTES_PER_PIXEL)
        bitmap.copyPixelsToBuffer(ByteBuffer.wrap(pixels))
        return AnalysisFrame(bitmap.width, bitmap.height, rotation, PixelLayout.RGBA_8888, pixels, 0)
    }

    @Test
    fun theIndexListsEachVectorAtFullSizeAndAtTheAnalysisWidth() {
        val assets = assets()
        assertTrue(assets.size >= 6)
        assertTrue(assets.any { !it.aamvaHeader })
        assertEquals(setOf("full", "analysis"), assets.map { it.scale }.toSet())
        assertTrue(assets.filter { it.scale == "analysis" }.all { it.width == 640 })
    }

    @Test
    fun decodesEveryImageToItsExactPayloadAtBothSizes() {
        val reader = ZxingCppBarcodeReader()
        try {
            for (asset in assets()) {
                val bytes = runBlocking { reader.readPdf417(frameOf(asset.file)) }
                assertNotNull("zxing-cpp decodes ${asset.file}", bytes)
                assertEquals(asset.file, asset.payloadSha256, Sha256.hex(bytes!!))
                assertEquals(asset.file, asset.aamvaHeader, AamvaHeader.matches(bytes))
            }
        } finally {
            reader.close()
        }
    }

    @Test
    fun decodesAFrameTheCameraDeliversTurned() {
        val reader = ZxingCppBarcodeReader()
        try {
            val asset = assets().first { it.aamvaHeader && it.scale == "analysis" }
            for (rotation in listOf(90, 180, 270)) {
                val bytes = runBlocking { reader.readPdf417(frameOf(asset.file, rotation)) }
                assertNotNull("rotation $rotation", bytes)
                assertEquals(asset.payloadSha256, Sha256.hex(bytes!!))
            }
        } finally {
            reader.close()
        }
    }

    @Test
    fun theGuidanceSaysBarcodeFoundForAnAamvaHeaderOnly() {
        for (asset in assets()) {
            val guidance = BarcodeGuidance(platformBarcodeReader()!!)
            try {
                runBlocking { guidance.onFrame(frameOf(asset.file)) }
                val expected = if (asset.aamvaHeader) BarcodeHint.FOUND else BarcodeHint.SEARCHING
                assertEquals(asset.file, expected, guidance.hint.value)
            } finally {
                guidance.close()
            }
        }
    }
}
