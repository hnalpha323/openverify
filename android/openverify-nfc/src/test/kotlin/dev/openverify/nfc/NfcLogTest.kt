package dev.openverify.nfc

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * C213.3 for this module: its one logger writes a constant code, only in a debuggable host, and
 * refuses anything that is not a code without repeating it.
 */
@RunWith(RobolectricTestRunner::class)
class NfcLogTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun host(debuggable: Boolean) {
        val info = context.applicationInfo
        info.flags = if (debuggable) info.flags or ApplicationInfo.FLAG_DEBUGGABLE else info.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        NfcLog.attach(context)
    }

    private fun written(): List<Pair<Int, String>> = ShadowLog.getLogsForTag("OpenVerifyNfc").map { it.type to it.msg }

    @Before
    fun clear() = ShadowLog.clear()

    @Test
    fun `a code is written as one warning in a debuggable host`() {
        host(debuggable = true)

        NfcLog.log("nfc.sample_code")

        assertEquals(listOf(Log.WARN to "nfc.sample_code"), written())
    }

    @Test
    fun `nothing is written in a host that is not debuggable`() {
        host(debuggable = false)

        NfcLog.log("nfc.sample_code")

        assertEquals(emptyList<Pair<Int, String>>(), written())
    }

    @Test
    fun `what is not a constant code is refused, and the refusal does not repeat it`() {
        host(debuggable = true)

        listOf("X12345678 is not a code", "nfc.Sample", "", "nfc." + "a".repeat(64), "nfc.failed: 4").forEach { text ->
            val refused = assertThrows(IllegalArgumentException::class.java) { NfcLog.log(text) }

            assertEquals("NfcLog takes a constant code: lower case, dotted, at most 64 characters", refused.message)
            assertFalse(text.isNotEmpty() && text in refused.message.orEmpty())
        }
        assertEquals(emptyList<Pair<Int, String>>(), written())
    }

    @Test
    fun `a code as long as the limit is written`() {
        host(debuggable = true)
        val code = "nfc." + "a".repeat(64 - "nfc.".length)

        NfcLog.log(code)

        assertEquals(listOf(Log.WARN to code), written())
    }
}
