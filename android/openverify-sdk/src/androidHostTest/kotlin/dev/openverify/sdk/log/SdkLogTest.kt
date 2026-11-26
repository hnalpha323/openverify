package dev.openverify.sdk.log

import android.app.Application
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * C213.3: the SDK logs only constant codes, and only when the host app is debuggable, read once from
 * the application; before that read, and in a release host, it logs nothing.
 */
@RunWith(RobolectricTestRunner::class)
internal class SdkLogTest {

    private val application: Application = ApplicationProvider.getApplicationContext()

    @Before
    fun forgetTheFlag() {
        HostDebuggable.forget()
        ShadowLog.clear()
    }

    @After
    fun forgetItAgain() {
        HostDebuggable.forget()
    }

    private fun host(debuggable: Boolean): Application = application.also {
        it.applicationInfo.flags = if (debuggable) {
            it.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        } else {
            it.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        }
    }

    private fun logged(): List<String> = ShadowLog.getLogsForTag(TAG).map { it.msg }

    @Test
    fun `a debuggable host's log holds the code, under the SDK's tag`() {
        HostDebuggable.read(host(debuggable = true))

        SdkLog.log("flow.session_read_failed")

        assertEquals(listOf("flow.session_read_failed"), logged())
    }

    @Test
    fun `a host that is not debuggable logs nothing`() {
        HostDebuggable.read(host(debuggable = false))

        SdkLog.log("flow.session_read_failed")

        assertEquals(emptyList<String>(), logged())
    }

    @Test
    fun `nothing is logged before the flag is read`() {
        host(debuggable = true)

        SdkLog.log("flow.session_read_failed")

        assertEquals(emptyList<String>(), logged())
        assertFalse(HostDebuggable.debuggable)
    }

    @Test
    fun `the flag is read once`() {
        HostDebuggable.read(host(debuggable = true))
        HostDebuggable.read(host(debuggable = false))

        SdkLog.log("camera.bind_failed")

        assertEquals(listOf("camera.bind_failed"), logged())
    }

    @Test
    fun `a code that is not a constant is refused, without echoing it`() {
        HostDebuggable.read(host(debuggable = true))

        for (code in listOf("Failed for jane@example.com", "flow.", "", "x".repeat(65), "flow.session read")) {
            val refused = assertThrows(IllegalArgumentException::class.java) { SdkLog.log(code) }
            assertFalse(code.isNotEmpty() && refused.message.orEmpty().contains(code))
        }
        assertEquals(emptyList<String>(), logged())
    }

    private companion object {
        const val TAG = "OpenVerify"
    }
}
