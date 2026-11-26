package dev.openverify.sdk.camera

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C40.4 `sanitizeDeviceLabel` in common code, as the server applies it: control and bidi
 * characters go, then at most 200 code points stay. A surrogate pair is one code point, and an
 * unpaired surrogate counts as one too, as on the JVM and in the server's `Array.from`.
 */
class DeviceLabelTest {

    /** U+1F4F7 CAMERA: one code point, two UTF-16 units. */
    private val camera = "📷"

    @Test
    fun keepsAtMost200CodePointsCountingASurrogatePairAsOne() {
        assertEquals(camera.repeat(200), cleanDeviceLabel(camera.repeat(250)))
    }

    @Test
    fun neverSplitsASurrogatePairAtTheLimit() {
        assertEquals("x".repeat(199) + camera, cleanDeviceLabel("x".repeat(199) + camera + "yz"))
    }

    @Test
    fun countsAnUnpairedSurrogateAsOneCodePoint() {
        assertEquals("\uD83D" + "x".repeat(199), cleanDeviceLabel("\uD83D" + "x".repeat(300)))
        assertEquals("x".repeat(199) + "\uDCF7", cleanDeviceLabel("x".repeat(199) + "\uDCF7" + "x"))
        assertEquals("x".repeat(199) + "\uD83D", cleanDeviceLabel("x".repeat(199) + "\uD83D"))
    }

    @Test
    fun countsCodePointsAfterRemovingControlCharacters() {
        assertEquals("x".repeat(200), cleanDeviceLabel("\u0000".repeat(50) + "x".repeat(250)))
    }

    @Test
    fun removesEveryC0AndC1ControlCharacter() {
        val controls = ((0x00..0x1F) + (0x7F..0x9F)).map { it.toChar() }.joinToString("")

        assertEquals("ab", cleanDeviceLabel("a" + controls + "b"))
    }

    @Test
    fun removesTheBidiControlsTheServerRemoves() {
        val bidi = "؜‎‏‪‫‬‭‮⁦⁧⁨⁩"

        assertEquals("front camera", cleanDeviceLabel("front$bidi camera"))
    }

    @Test
    fun keepsEveryOtherCharacter() {
        // The neighbours of the removed ranges stay, as do a no-break space, a joiner and CJK.
        val label = "Caméra 1,2  ­؛؝‍  ⁥⁪ 前置 $camera"

        assertEquals(label, cleanDeviceLabel(label))
    }
}
