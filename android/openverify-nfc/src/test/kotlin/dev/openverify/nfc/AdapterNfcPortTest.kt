package dev.openverify.nfc

import android.app.Activity
import android.app.Application
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNfcAdapter

/**
 * C209.2: the platform's side of the reader, over Robolectric's `NfcAdapter`: what it asks of the
 * adapter and what it makes of the adapter's answers. A real adapter is `ChipReaderDeviceTest`'s.
 */
@RunWith(RobolectricTestRunner::class)
class AdapterNfcPortTest {

    private val application: Application = ApplicationProvider.getApplicationContext()
    private val port = AdapterNfcPort(application)

    @After
    fun reset() = ShadowNfcAdapter.reset()

    private fun adapter(enabled: Boolean = true): ShadowNfcAdapter {
        shadowOf(application.packageManager).setSystemFeature(PackageManager.FEATURE_NFC, true)
        ShadowNfcAdapter.setNfcHardwareExists(true)
        return shadowOf(NfcAdapter.getDefaultAdapter(application)).also { it.setEnabled(enabled) }
    }

    @Test
    fun `NFC is ready when the phone has it and it is on`() {
        adapter(enabled = true)
        assertTrue(port.ready())

        adapter(enabled = false)
        assertFalse(port.ready())
    }

    @Test
    fun `a phone without NFC is not ready, and reader mode cannot be turned on or off on it`() {
        ShadowNfcAdapter.setNfcHardwareExists(false)
        val screen = Robolectric.buildActivity(Activity::class.java).setup().get()

        assertFalse(port.ready())
        assertFalse(port.enable(screen) {})
        port.disable(screen)
    }

    @Test
    fun `reader mode is turned on for the activity, for NFC-A and NFC-B with no NDEF check, and off again`() {
        val adapter = adapter()
        val screen = Robolectric.buildActivity(Activity::class.java).setup().get()

        assertTrue(port.enable(screen) {})

        assertTrue(adapter.isInReaderMode)
        assertNull(adapter.readerModeExtras)
        assertEquals(NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK, AdapterNfcPort.READER_FLAGS)

        port.disable(screen)
        assertFalse(adapter.isInReaderMode)
        // Turning it off twice is harmless.
        port.disable(screen)
    }

    @Test
    fun `a tag in the field is handed on, and one that is no ISO-DEP tag gives no session`() {
        val adapter = adapter()
        val screen = Robolectric.buildActivity(Activity::class.java).setup().get()
        val found = mutableListOf<ChipFound>()
        port.enable(screen) { found += it }

        adapter.dispatchTagDiscovered(ShadowNfcAdapter.createMockTag())

        assertEquals(1, found.size)
        assertNull(found.single().connect())
    }

    @Test
    fun `the adapter is asked for anew each time, so NFC turned on later is seen`() {
        ShadowNfcAdapter.setNfcHardwareExists(false)
        assertFalse(port.ready())

        adapter(enabled = true)

        assertTrue(port.ready())
        assertSame(NfcAdapter.getDefaultAdapter(application), NfcAdapter.getDefaultAdapter(application))
    }
}
