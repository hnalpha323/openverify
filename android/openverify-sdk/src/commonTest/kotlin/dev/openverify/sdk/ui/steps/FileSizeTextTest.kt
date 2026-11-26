package dev.openverify.sdk.ui.steps

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C64.2: a picked document's size, in SI symbols the same in every language, with the language's
 * decimal separator: bytes under 1 KiB, then kilobytes and megabytes with one decimal.
 */
class FileSizeTextTest {
    @Test
    fun aSizeIsWrittenInBytesKilobytesOrMegabytesWithOneDecimal() {
        assertEquals("0 B", fileSizeText(0, "."))
        assertEquals("512 B", fileSizeText(512, "."))
        assertEquals("1 kB", fileSizeText(1024, "."))
        assertEquals("1.5 kB", fileSizeText(1536, "."))
        assertEquals("1,5 kB", fileSizeText(1536, ","))
        assertEquals("2.3 MB", fileSizeText(1024L * 1024 * 9 / 4, "."))
        assertEquals("10 MB", fileSizeText(10L * 1024 * 1024, ","))
        assertEquals("1024 kB", fileSizeText(1024L * 1024 - 1, "."))
    }
}
