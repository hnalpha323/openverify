package dev.openverify.sdk.log

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log

/**
 * Whether the host app is debuggable (C213.3): the KMP library has no build types of its own, so the
 * host's flag decides whether `SdkLog` writes anything. It is read once, from the application, and
 * kept only here; nothing reads it back but [platformLog], and it is never sent (`NeverReadTest`).
 * Until [read] is called, nothing is logged. The activity calls [read] when it starts (a hook of
 * android-sdk-api, C190.2).
 */
internal object HostDebuggable {
    @Volatile
    private var flag: Boolean? = null

    /** Reads the flag from [context]'s application, the first time only. */
    internal fun read(context: Context) {
        if (flag == null) {
            flag = (context.applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        }
    }

    /** True only once [read] found the host debuggable. */
    internal val debuggable: Boolean get() = flag == true

    /** Forgets the flag, for tests that read it again. */
    internal fun forget() {
        flag = null
    }
}

/** The SDK's Logcat tag. */
private const val TAG = "OpenVerify"

internal actual fun platformLog(code: String) {
    if (HostDebuggable.debuggable) {
        Log.w(TAG, code)
    }
}
