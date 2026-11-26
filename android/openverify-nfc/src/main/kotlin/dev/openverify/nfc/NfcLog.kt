package dev.openverify.nfc

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log

/**
 * The module's only way to log (C213.3), with the grammar and the rule of the SDK's own `SdkLog`,
 * which is internal to the SDK: a constant, PII-free code (lower case, dotted, at most 64
 * characters), written only where the host app is debuggable. Never a value, an MRZ, a CAN, a chip byte or an exception's
 * text. The SDK's `LogScanTest` holds this file to that, and every call of [log] to a string literal.
 */
internal object NfcLog {
    private const val TAG = "OpenVerifyNfc"

    private val CODE = Regex("[a-z][a-z0-9_]{0,63}(\\.[a-z0-9_]+)*")

    /** Whether the host app is debuggable. False until [attach] reads it, so nothing is written before. */
    @Volatile
    private var debuggable: Boolean = false

    /** Reads whether the host app of [context] is debuggable. The flag is kept only here and never sent. */
    internal fun attach(context: Context) {
        debuggable = (context.applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    /** Logs [code] in a debuggable host; what is not a constant code's form is refused, unechoed. */
    internal fun log(code: String) {
        require(code.length <= 64 && CODE.matches(code)) { "NfcLog takes a constant code: lower case, dotted, at most 64 characters" }
        if (debuggable) {
            Log.w(TAG, code)
        }
    }
}
