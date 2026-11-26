package dev.openverify.sdk.api

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * C190.2 (decision 65; review V01): plain `http` to a loopback host (`localhost`, `127.0.0.1`, `::1`,
 * `10.0.2.2`) only in a debuggable host app, read from the application, or under the SDK's own
 * internal test override; `https` always. On a real phone `10.0.2.2` is an ordinary private address.
 */
@RunWith(RobolectricTestRunner::class)
internal class LoopbackPolicyTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun host(debuggable: Boolean) {
        val info = context.applicationInfo
        info.flags = if (debuggable) info.flags or ApplicationInfo.FLAG_DEBUGGABLE else info.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        LoopbackHttp.read(context)
    }

    @After
    fun forget() {
        LoopbackHttp.testOverride = null
        host(debuggable = false)
    }

    @Test
    fun `a debuggable host may use plain http to a loopback host`() {
        host(debuggable = true)

        assertTrue(loopbackHttpAllowed())
        LOOPBACK.forEach { assertTrue(it, LoopbackPolicy.allows(it)) }
    }

    @Test
    fun `a host that is not debuggable may not, without the SDK's own test override`() {
        host(debuggable = false)

        assertFalse(loopbackHttpAllowed())
        LOOPBACK.forEach { assertFalse(it, LoopbackPolicy.allows(it)) }
    }

    @Test
    fun `https is allowed in both`() {
        listOf(true, false).forEach { debuggable ->
            host(debuggable)
            HTTPS.forEach { assertTrue("$it, debuggable=$debuggable", LoopbackPolicy.allows(it)) }
        }
    }

    @Test
    fun `the SDK's own test override allows plain http in a host that is not debuggable`() {
        host(debuggable = false)
        LoopbackHttp.testOverride = true

        assertTrue(loopbackHttpAllowed())
        assertTrue(LoopbackPolicy.allows("http://127.0.0.1:3000"))
    }

    @Test
    fun `the flag is read again for each read, so a later host's answer is its own`() {
        host(debuggable = true)
        host(debuggable = false)

        assertFalse(LoopbackPolicy.allows("http://10.0.2.2:3000"))
    }

    /** Only the SDK's tests set the override: no main source but its declaration names it. */
    @Test
    fun `no main source sets the test override`() {
        val writers = listOf("commonMain", "androidMain", "iosMain")
            .flatMap { File("src/$it/kotlin").walkTopDown().filter { file -> file.isFile && file.extension == "kt" }.toList() }
            .filter { "testOverride" in it.readText() }
            .map { it.invariantSeparatorsPath }

        assertEquals(listOf("src/androidMain/kotlin/dev/openverify/sdk/api/LoopbackPolicy.android.kt"), writers)
    }

    private companion object {
        val LOOPBACK = listOf("http://localhost:3000", "http://127.0.0.1:3000/", "http://[::1]:3000", "http://10.0.2.2:3000")
        val HTTPS = listOf("https://api.example.com", "https://127.0.0.1:8443", "https://10.0.2.2")
    }
}
