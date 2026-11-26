package dev.openverify.face

import android.app.Activity
import android.os.Bundle
import android.view.WindowManager

/**
 * An empty screen that keeps the device awake while the telemetry window is measured: a phone left
 * alone suspends its processor and then restricts the network (measured on the first attempt: a
 * 120-second sleep took eight minutes), and a window measured on a sleeping phone would prove nothing.
 * It turns the screen on and shows over the lock screen without unlocking anything, and changes no setting.
 */
class KeepAwakeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
