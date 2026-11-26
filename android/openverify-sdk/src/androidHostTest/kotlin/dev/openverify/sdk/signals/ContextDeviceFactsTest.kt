package dev.openverify.sdk.signals

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Debug
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.model.AndroidRecognitionSignals
import dev.openverify.sdk.model.FlowSessionSignals
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** C94.7: the platform reads behind [ContextDeviceFacts], on Robolectric's Android. */
@RunWith(RobolectricTestRunner::class)
class ContextDeviceFactsTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun setDebuggable(debuggable: Boolean) {
        val info = context.applicationInfo
        info.flags = if (debuggable) info.flags or ApplicationInfo.FLAG_DEBUGGABLE else info.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
    }

    @Test
    fun `the ANDROID_ID is read from Settings Secure`() {
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, ANDROID_ID)

        assertEquals(ANDROID_ID, ContextDeviceFacts(context).androidId())
    }

    @Test
    fun `the host app's FLAG_DEBUGGABLE is read from its application info`() {
        setDebuggable(true)
        assertTrue(ContextDeviceFacts(context).appDebuggable())

        setDebuggable(false)
        assertFalse(ContextDeviceFacts(context).appDebuggable())
    }

    @Test
    fun `whether a debugger is attached is the platform's answer`() {
        assertEquals(Debug.isDebuggerConnected(), ContextDeviceFacts(context).debuggerConnected())
    }

    @Test
    @Config(qualifiers = "sw720dp")
    fun `the smallest screen width is the configuration's`() {
        assertEquals(720, ContextDeviceFacts(context).smallestScreenWidthDp())
    }

    @Test
    @Config(qualifiers = "sw720dp")
    fun `the Android signals from a context carry its facts`() = runTest {
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, ANDROID_ID)
        setDebuggable(true)

        val body = AndroidDeviceSignals(context).collect(FlowSessionSignals(integrity = true, recognition = true), "consent", 0)

        val integrity = body?.androidIntegrity
        assertEquals(Debug.isDebuggerConnected(), integrity?.debuggerConnected)
        assertEquals(true, integrity?.appDebuggable)
        // C210.3 (Workflow 10B): a context's signals run the device-integrity probes, here over the host
        // test's own process, so each family answers; which codes it holds is the host's, not asserted.
        assertNotNull(integrity?.emulatorIndicators)
        assertNotNull(integrity?.rootIndicators)
        assertNotNull(integrity?.hookingIndicators)
        assertEquals(AndroidRecognitionSignals(ANDROID_ID), body?.androidRecognition)
        assertEquals("tablet", body?.deviceClass)
    }

    private companion object {
        /** A synthetic ANDROID_ID: 16 lowercase hex digits, never a real device's. */
        const val ANDROID_ID = "0f1e2d3c4b5a6978"
    }
}
