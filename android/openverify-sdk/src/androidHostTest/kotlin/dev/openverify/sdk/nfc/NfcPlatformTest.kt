package dev.openverify.sdk.nfc

import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNfcAdapter

/**
 * C207.12 (review F16): the Android actual of the phone's NFC seam, over Robolectric's package
 * manager and adapter shadows: `PackageManager.FEATURE_NFC`, `NfcAdapter.isEnabled` (neither needs a
 * permission) and `Settings.ACTION_NFC_SETTINGS`. What only a phone shows (its real adapter's state,
 * the settings screen itself) stays a device proof (rule 28).
 */
@RunWith(RobolectricTestRunner::class)
class NfcPlatformTest {
    private val context: Application = ApplicationProvider.getApplicationContext()

    private fun phone(feature: Boolean, hardware: Boolean, enabled: Boolean): NfcPlatform {
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_NFC, feature)
        ShadowNfcAdapter.setNfcHardwareExists(hardware)
        // Robolectric hands out an adapter only when the feature and the hardware are both there.
        NfcAdapter.getDefaultAdapter(context)?.let { shadowOf(it).setEnabled(enabled) }
        return NfcPlatform(context)
    }

    @Test
    fun `a phone without the NFC feature, or without an adapter, has no hardware`() {
        assertEquals(NfcAvailability.NO_HARDWARE, phone(feature = false, hardware = true, enabled = true).availability())
        assertEquals(NfcAvailability.NO_HARDWARE, phone(feature = true, hardware = false, enabled = false).availability())
    }

    @Test
    fun `NFC present and off is disabled, and on is ready, read each time`() {
        val platform = phone(feature = true, hardware = true, enabled = false)
        assertEquals(NfcAvailability.DISABLED, platform.availability())

        shadowOf(NfcAdapter.getDefaultAdapter(context)).setEnabled(true)
        assertEquals(NfcAvailability.READY, platform.availability())
    }

    @Test
    fun `the settings shortcut opens the system's NFC settings in a new task, with no extra`() {
        phone(feature = true, hardware = true, enabled = false).openSettings()

        val started = shadowOf(context).nextStartedActivity
        assertEquals(Settings.ACTION_NFC_SETTINGS, started.action)
        assertTrue(started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(null, started.extras)
    }

    @Test
    fun `the SDK's own manifest asks for no NFC permission and declares no NFC feature (C207_8)`() {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)

        assertTrue(info.requestedPermissions.orEmpty().none { it == android.Manifest.permission.NFC })
        assertTrue(info.reqFeatures.orEmpty().none { it.name == PackageManager.FEATURE_NFC })
    }
}
