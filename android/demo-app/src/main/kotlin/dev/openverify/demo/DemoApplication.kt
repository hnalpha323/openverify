package dev.openverify.demo

import android.app.Application

/**
 * Installs the demo's components when the process starts (C191.1), so the event log is told again
 * after process death, and each optional artifact of this build is asked for its component once
 * (KP10-45). A launch from the screen installs them again with the sandbox outcome picked then
 * (Phase 7 C90.9).
 */
class DemoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        DemoComponents.attach(this)
        DemoComponents.install(SandboxOutcomeChoice.NONE)
    }
}
