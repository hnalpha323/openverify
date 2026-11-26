package dev.openverify.sdk.ui.theme

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * C198.3 (review P20): a logo is decoded only after its bytes are at most 256 KiB, start with the
 * magic bytes of a format the server's rendition emits (PNG, or JPEG), and carry a header whose
 * size, read without decoding, is at most 2,048 px a side. Synthetic bytes only: each header is
 * built here, with no image behind it.
 */
internal class ThemeLogoTest {

    private fun bytes(vararg values: Int): ByteArray = ByteArray(values.size) { values[it].toByte() }

    private fun u32(value: Int): IntArray = intArrayOf(value ushr 24 and 0xff, value ushr 16 and 0xff, value ushr 8 and 0xff, value and 0xff)

    private fun u16(value: Int): IntArray = intArrayOf(value ushr 8 and 0xff, value and 0xff)

    /** A PNG signature and its IHDR chunk for [width] by [height], then [rest]. */
    private fun png(width: Int, height: Int, rest: Int = 16): ByteArray = bytes(
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        *u32(13), 0x49, 0x48, 0x44, 0x52, *u32(width), *u32(height),
        8, 6, 0, 0, 0, *IntArray(4 + rest),
    )

    /** A JPEG with an APP0 segment and a [frame] marker (baseline SOF0 by default) for [width] by [height]. */
    private fun jpeg(width: Int, height: Int, frame: Int = 0xc0): ByteArray = bytes(
        0xff, 0xd8,
        0xff, 0xe0, *u16(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
        0xff, 0xdb, *u16(4), 0, 0,
        0xff, frame, *u16(17), 8, *u16(height), *u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
        0xff, 0xd9,
    )

    @Test
    fun aPngHeaderIsReadWithoutDecoding() {
        assertEquals(LogoCheck.Accepted(LogoHeader(LogoFormat.PNG, 640, 216)), checkLogo(png(640, 216)))
        assertEquals(LogoCheck.Accepted(LogoHeader(LogoFormat.PNG, 2048, 2048)), checkLogo(png(2048, 2048)))
    }

    @Test
    fun aJpegFrameHeaderIsReadPastTheSegmentsBeforeIt() {
        assertEquals(LogoCheck.Accepted(LogoHeader(LogoFormat.JPEG, 300, 120)), checkLogo(jpeg(300, 120)))
        assertEquals(LogoCheck.Accepted(LogoHeader(LogoFormat.JPEG, 64, 48)), checkLogo(jpeg(64, 48, frame = 0xc2)))
    }

    @Test
    fun aHeaderAbove2048PxASideIsRefused() {
        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS), checkLogo(png(2049, 10)))
        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS), checkLogo(png(10, 40000)))
        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS), checkLogo(jpeg(4096, 4096)))
        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS), checkLogo(png(-1, 10)))
    }

    @Test
    fun moreThan256KibIsRefusedBeforeAnythingIsRead() {
        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_LARGE), checkLogo(png(10, 10, rest = LOGO_MAX_BYTES)))
        assertTrue(checkLogo(png(10, 10, rest = LOGO_MAX_BYTES - 33 - 4)) is LogoCheck.Accepted)
    }

    @Test
    fun anyOtherFormatIsRefused() {
        val webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20)
        val gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0)
        val svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".encodeToByteArray()
        for (other in listOf(webp, gif, svg, ByteArray(0), bytes(0xff))) {
            assertEquals(LogoCheck.Refused(LogoRefusal.NOT_PNG_OR_JPEG), checkLogo(other))
        }
    }

    @Test
    fun aTruncatedOrMalformedHeaderIsRefused() {
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(png(10, 10).copyOf(20)))
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(png(0, 10)))
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(jpeg(10, 0)))
        val notIhdr = png(10, 10).also { it[12] = 0x49; it[13] = 0x44; it[14] = 0x41; it[15] = 0x54 }
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(notIhdr))
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2)))
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(bytes(0xff, 0xd8, 0xff, 0xd9)))
        assertEquals(LogoCheck.Refused(LogoRefusal.NO_HEADER), checkLogo(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 1)))
    }

    @Test
    fun anOversizedHeaderIsNeverDecoded() = runTest {
        var decoded = 0
        val logo = loadLogo({ png(4096, 4096) }, "tas_synthetic") { decoded += 1; null }

        assertNull(logo)
        assertEquals(0, decoded)
    }

    @Test
    fun anAcceptedLogoIsDecodedOnceAndAFailedFetchShowsNone() = runTest {
        val image = "decoded"
        var decoded = 0
        assertSame(image, loadLogo({ png(2, 2) }, "tas_synthetic") { decoded += 1; image })
        assertEquals(1, decoded)

        assertNull(loadLogo({ error("not found") }, "tas_synthetic") { decoded += 1; image })
        assertNull(loadLogo({ png(2, 2) }, "tas_synthetic") { null })
        assertEquals(1, decoded)
    }
}
