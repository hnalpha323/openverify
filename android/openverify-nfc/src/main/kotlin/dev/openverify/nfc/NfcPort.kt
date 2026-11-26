package dev.openverify.nfc

import android.app.Activity
import android.content.Context
import android.nfc.NfcAdapter

/** A chip the phone found in its field: [connect] gives a session with it, or `null` when it is no travel document's chip. */
internal fun interface ChipFound {
    fun connect(): ChipSession?
}

/**
 * The phone's NFC as the reader uses it (C209.2), so that the reader's own logic runs on the host
 * over a fake: whether NFC can be used now, and reader mode for one activity.
 */
internal interface NfcPort {
    /** Whether the phone has NFC and it is on. Needs no permission beyond the module's `NFC`. */
    fun ready(): Boolean

    /**
     * Turns reader mode on for [activity], which must be resumed: [found] is told each chip that
     * enters the field, on a thread of the platform's. Answers false when the phone refuses.
     */
    fun enable(activity: Activity, found: (ChipFound) -> Unit): Boolean

    /** Turns reader mode off for [activity]. Safe to call when it is off already. */
    fun disable(activity: Activity)
}

/**
 * [NfcPort] over the platform's `NfcAdapter` (C209.2). The adapter is asked for each time, so NFC
 * that is turned on later is seen; a phone without NFC has none, and nothing here fails on it.
 */
internal class AdapterNfcPort(context: Context) : NfcPort {
    private val application: Context = context.applicationContext

    private fun adapter(): NfcAdapter? = NfcAdapter.getDefaultAdapter(application)

    override fun ready(): Boolean = adapter()?.isEnabled == true

    override fun enable(activity: Activity, found: (ChipFound) -> Unit): Boolean {
        val adapter = adapter() ?: return false
        return try {
            adapter.enableReaderMode(activity, { tag -> found(ChipFound { JmrtdChipSession.over(tag) }) }, READER_FLAGS, null)
            true
        } catch (_: RuntimeException) {
            // The platform refuses on a phone whose NFC was just removed or locked down; the read then ends as "NFC disabled".
            false
        }
    }

    override fun disable(activity: Activity) {
        try {
            adapter()?.disableReaderMode(activity)
        } catch (_: RuntimeException) {
            // Reader mode is off either way: an activity that is already gone has none.
        }
    }

    internal companion object {
        /** NFC-A and NFC-B, the two an identity document's chip may use, and no NDEF check: such a chip holds no NDEF message. */
        const val READER_FLAGS: Int = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
    }
}
