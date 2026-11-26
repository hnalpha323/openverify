package dev.openverify.sdk.api

import android.content.Context
import android.content.pm.ApplicationInfo

/**
 * The Android half of C190.2's seam (review V01): whether the host app is debuggable
 * (`ApplicationInfo.FLAG_DEBUGGABLE`), read from the application context the activity holds each
 * time it starts ([read]), or the SDK's own internal [testOverride]. The KMP library has no build
 * types of its own, so the host's flag decides, as it does for `SdkLog` (C213.3). The flag is kept
 * only here and never sent (`NeverReadTest`).
 */
internal object LoopbackHttp {
    @Volatile
    private var hostDebuggable: Boolean = false

    /**
     * Set only by the SDK's own `androidHostTest`, `stackTest` and `androidDeviceTest` code, which
     * serve the flow API from a loopback `MockWebServer` or the local stack; `null` everywhere else
     * (`LoopbackPolicyTest` holds every main source to that). It is `internal`, so no host app and no
     * other module can set it.
     */
    @Volatile
    internal var testOverride: Boolean? = null

    /** Reads whether [context]'s application is debuggable; until then, it is not. */
    internal fun read(context: Context) {
        hostDebuggable = (context.applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    internal val allowed: Boolean get() = testOverride ?: hostDebuggable
}

internal actual fun loopbackHttpAllowed(): Boolean = LoopbackHttp.allowed
