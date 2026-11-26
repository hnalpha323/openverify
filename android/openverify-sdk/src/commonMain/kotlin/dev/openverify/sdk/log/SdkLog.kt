package dev.openverify.sdk.log

/**
 * C213.3 (review P06, F31): the SDK's only way to log. It takes a constant, PII-free code, never a
 * value, a message from the server, a URL or an exception's text, and the platform writes it only
 * where the host app is debuggable (Android) or nowhere (iOS). `LogScanTest` refuses `Log.*`,
 * `println`, `print` and `printStackTrace` everywhere else in the main sources, and any call of
 * [log] whose argument is not a string literal code.
 *
 * A code is lower case, dotted, at most 64 characters: `flow.session_read_failed`, never
 * `"failed: $reason"`.
 */
internal object SdkLog {
    /** Logs [code] when the platform allows it; a code that is not a constant's form is refused, unechoed. */
    internal fun log(code: String) {
        require(code.length <= 64 && CODE.matches(code)) { "SdkLog takes a constant code: lower case, dotted, at most 64 characters" }
        platformLog(code)
    }

    private val CODE = Regex("[a-z][a-z0-9_]{0,63}(\\.[a-z0-9_]+)*")
}

/**
 * Writes one constant [code]. Android: to Logcat, only when the host app is debuggable, which is read
 * once from the application. iOS: nothing.
 */
internal expect fun platformLog(code: String)
