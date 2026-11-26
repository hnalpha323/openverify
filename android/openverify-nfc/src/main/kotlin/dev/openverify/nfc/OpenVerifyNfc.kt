package dev.openverify.nfc

import android.app.Application
import android.content.Context
import dev.openverify.sdk.chip.ChipReader

/**
 * The entry point of `openverify-nfc`: the chip reader a host installs so that an NFC step can read
 * an identity document's chip on this phone (C209.2).
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = OpenVerifyNfc.chipReader(context)))
 * ```
 *
 * The device reads and the server verifies: nothing the reader returns is a verdict, and its bytes
 * stay in memory (C207.4). This module is a separate artifact under its own licence (LGPL-3.0),
 * because the libraries it reads the chip with are LGPL; see its README and NOTICE.
 */
public object OpenVerifyNfc {
    /** The app's one reader, made on the first call. */
    private var made: Pair<Context, ChipReader>? = null

    /**
     * A [ChipReader] for the host app of [context]. Only the application's context is kept, so any
     * context may be passed; every call for the same app gives the same reader. Call it once when
     * the process starts (in `Application.onCreate`): the reader reads for whichever of the app's
     * activities is resumed when a read is asked for, and learns of an activity when it is resumed.
     *
     * The reader needs NFC on the phone and turned on, and holds reader mode only while the SDK's
     * tap screen is resumed and waits for the document. Its failures are the SDK's
     * `ChipReadException`, with a `ChipReadFailure` and a fixed message.
     */
    public fun chipReader(context: Context): ChipReader = synchronized(this) {
        NfcLog.attach(context)
        val application = context.applicationContext
        made?.takeIf { it.first === application }?.second
            ?: NfcChipReader(AdapterNfcPort(application), ResumedActivity(application as? Application)).also { made = application to it }
    }
}
