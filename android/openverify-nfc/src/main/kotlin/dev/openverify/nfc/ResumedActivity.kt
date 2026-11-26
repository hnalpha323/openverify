package dev.openverify.nfc

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference

/**
 * Which activity of the host app is resumed (C209.2): the route from a reader that was installed
 * once, with the application's context, to the screen that asks it to read. The SDK's NFC step calls
 * the reader only while its own activity is resumed (C207.5), so that activity is the one reader
 * mode is turned on for, and the SDK's API needs no change. The activity is held weakly, and only
 * between its resume and its pause.
 */
internal class ResumedActivity(application: Application?) {
    @Volatile
    private var resumed: WeakReference<Activity>? = null

    /** Told each activity that stops being resumed, on the main thread. */
    @Volatile
    var onPaused: ((Activity) -> Unit)? = null

    init {
        application?.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(activity: Activity) {
                    resumed = WeakReference(activity)
                }

                override fun onActivityPaused(activity: Activity) {
                    // A new activity is resumed before the old one's pause arrives only on some platform versions: keep the newer one.
                    if (resumed?.get() === activity) resumed = null
                    onPaused?.invoke(activity)
                }

                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

                override fun onActivityStarted(activity: Activity) = Unit

                override fun onActivityStopped(activity: Activity) = Unit

                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

                override fun onActivityDestroyed(activity: Activity) = Unit
            },
        )
    }

    /** The resumed activity, or `null` when none of the app's is. */
    fun current(): Activity? = resumed?.get()
}
