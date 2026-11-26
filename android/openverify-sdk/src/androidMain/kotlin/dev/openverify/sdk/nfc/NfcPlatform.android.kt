package dev.openverify.sdk.nfc

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.provider.Settings
import dev.openverify.sdk.log.SdkLog

/**
 * C207.12 (review F16): the Android actual. It reads `PackageManager.FEATURE_NFC` and
 * `NfcAdapter.isEnabled`, neither of which needs a permission, and opens
 * `Settings.ACTION_NFC_SETTINGS`. The SDK's manifest declares no NFC permission or feature (C207.8);
 * `openverify-nfc`'s does. It reads the phone each time it is asked and keeps nothing.
 */
internal actual class NfcPlatform(private val context: Context) {
    actual fun availability(): NfcAvailability {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC)) return NfcAvailability.NO_HARDWARE
        val adapter = NfcAdapter.getDefaultAdapter(context) ?: return NfcAvailability.NO_HARDWARE
        return if (adapter.isEnabled) NfcAvailability.READY else NfcAvailability.DISABLED
    }

    actual fun openSettings() {
        // From the application context, so in a task of its own; no extra, nothing about the person.
        val intent = Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // A device without that settings screen: the person turns NFC on themselves.
            SdkLog.log("nfc.settings_unavailable")
        }
    }
}
