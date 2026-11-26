package dev.openverify.sdk.ui.screen

import androidx.compose.ui.graphics.ImageBitmap
import dev.openverify.sdk.flow.FakeFlowApi
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.Executors

/**
 * KP10-11 (C195.1, C198.3): a screen's image comes from the flow's theme-asset read, through the
 * logo's checks before any decoding, decoded off the caller's thread, cached per asset id for the
 * session; a fetch, check or decode failure keeps the text alternative (null).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@OptIn(ExperimentalCoroutinesApi::class)
internal class ScreenAssetsTest {

    private val decodingThread = Executors.newSingleThreadExecutor { Thread(it, "screen-assets-decoding") }
    private val decoding = decodingThread.asCoroutineDispatcher()
    private val bitmap = ImageBitmap(2, 1)
    private val decodedOn = mutableListOf<String>()

    private val decode = { _: ByteArray -> bitmap.also { decodedOn += Thread.currentThread().name } }

    @After
    fun close() {
        decoding.close()
    }

    private fun u32(value: Int): List<Int> = listOf(value ushr 24 and 0xff, value ushr 16 and 0xff, value ushr 8 and 0xff, value and 0xff)

    /** A PNG signature and IHDR for [width] by [height]: nothing decodes it but [decode]. */
    private fun png(width: Int, height: Int): ByteArray =
        (listOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + u32(13) + listOf(0x49, 0x48, 0x44, 0x52) + u32(width) + u32(height) + List(25) { 0 })
            .map { it.toByte() }.toByteArray()

    @Test
    fun `an image asset is fetched, checked, decoded off the caller's thread, and kept for the session`() = runTest(UnconfinedTestDispatcher()) {
        val api = FakeFlowApi().apply { themeAssets["tsa_banner"] = png(640, 216) }
        val assets = ScreenAssets(api::fetchThemeAsset, this, decode, decoding)

        assertNull("nothing is shown before it loads", assets.asset("tsa_banner"))
        advanceUntilIdle()
        decodingThread.submit {}.get()
        advanceUntilIdle()

        assertSame(bitmap, assets.asset("tsa_banner"))
        assertSame(bitmap, assets.asset("tsa_banner"))
        assertEquals(listOf("screen-assets-decoding"), decodedOn.map { it.substringBefore(" @coroutine") })
        assertEquals("fetched once for the session", 1, api.calls.count { it == "fetchThemeAsset" })
    }

    @Test
    fun `an image the logo's checks refuse is never decoded, and the text alternative stays`() = runTest(UnconfinedTestDispatcher()) {
        val api = FakeFlowApi().apply {
            themeAssets["tsa_huge"] = png(4096, 10)
            themeAssets["tsa_gif"] = "GIF89a synthetic".encodeToByteArray()
            themeAssets["tsa_big"] = png(10, 10) + ByteArray(256 * 1024)
        }
        val assets = ScreenAssets(api::fetchThemeAsset, this, decode, decoding)

        for (id in listOf("tsa_huge", "tsa_gif", "tsa_big", "tsa_missing")) {
            assertNull(id, assets.load(id))
        }
        assertEquals(emptyList<String>(), decodedOn)
    }

    @Test
    fun `bytes that pass the checks but do not decode keep the text alternative`() = runTest(UnconfinedTestDispatcher()) {
        val api = FakeFlowApi().apply { themeAssets["tsa_banner"] = png(64, 32) }
        val assets = ScreenAssets(api::fetchThemeAsset, this, { null }, decoding)

        assertNull(assets.load("tsa_banner"))
    }
}
