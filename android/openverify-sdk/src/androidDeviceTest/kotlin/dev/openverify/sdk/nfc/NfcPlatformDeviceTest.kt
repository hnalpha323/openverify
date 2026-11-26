package dev.openverify.sdk.nfc

import android.Manifest
import android.app.Activity
import android.app.Instrumentation
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.nfc.NfcManager
import android.provider.Settings
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * KP10-38 (C207.12; review F16): the phone's NFC seam on a real device. Its rules are the host test's
 * (`NfcPlatformTest`, over Robolectric's shadows); this checks the platform glue: the feature and the
 * adapter's state are read without the NFC permission and agree with what the device itself reports,
 * and the system's NFC settings can be asked for from the application context.
 *
 * It asserts what the device reports, whatever that is: a phone with NFC on or off, or an emulator
 * with none. It changes no setting, and the settings screen is never opened: an activity monitor
 * takes the start, so the phone stays as it was.
 */
@RunWith(AndroidJUnit4::class)
class NfcPlatformDeviceTest {

    private val instrumentation: Instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext.applicationContext

    private fun hasNfc(): Boolean = context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC)

    @Test
    fun theNfcStateIsReadWithoutThePermissionAndAgreesWithTheDevice() {
        assertEquals(
            "the SDK's own manifest asks for no NFC permission (C207.8)",
            PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.NFC),
        )
        // The device's own report, by another road than the SDK's: the NFC system service.
        val adapter = (context.getSystemService(Context.NFC_SERVICE) as NfcManager?)?.defaultAdapter
        val reported = when {
            !hasNfc() || adapter == null -> NfcAvailability.NO_HARDWARE
            adapter.isEnabled -> NfcAvailability.READY
            else -> NfcAvailability.DISABLED
        }

        val platform = NfcPlatform(context)
        val read = platform.availability()
        Log.i(TAG, "feature=${hasNfc()} adapter=${adapter != null} availability=${read.name}")

        assertEquals(reported, read)
        assertEquals("the phone is read each time it is asked", reported, platform.availability())
    }

    @Test
    fun theNfcSettingsAreAskedForFromTheApplicationContextAndADeviceWithNfcHasThatScreen() {
        val monitor = instrumentation.addMonitor(
            IntentFilter(Settings.ACTION_NFC_SETTINGS),
            Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null),
            true,
        )
        try {
            // From the application context a start needs FLAG_ACTIVITY_NEW_TASK, or the platform throws.
            NfcPlatform(context).openSettings()

            assertEquals("one start of the system's NFC settings", 1, monitor.hits)
        } finally {
            instrumentation.removeMonitor(monitor)
        }
        val screen = context.packageManager.resolveActivity(Intent(Settings.ACTION_NFC_SETTINGS), 0)
        Log.i(TAG, "settings=${screen != null}")
        if (hasNfc()) assertNotNull("this device has NFC, and no screen answers ACTION_NFC_SETTINGS", screen)
    }

    private companion object {
        const val TAG = "openverify-nfc"
    }
}
