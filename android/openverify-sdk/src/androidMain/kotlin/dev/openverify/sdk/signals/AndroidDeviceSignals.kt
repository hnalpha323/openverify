package dev.openverify.sdk.signals

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.os.Debug
import android.provider.Settings
import dev.openverify.sdk.SandboxSignalOutcome
import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.AndroidRecognitionSignals
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * What the Android device can tell the server after consent (C94.7). Each read happens only when
 * called, so [AndroidDeviceSignals] reads only what the session's tiers allow.
 */
internal interface AndroidDeviceFacts {
    /** Session integrity: whether a debugger is attached now. */
    fun debuggerConnected(): Boolean

    /** Session integrity: whether the host app is a debuggable build. */
    fun appDebuggable(): Boolean

    /** Device recognition only: the app-scoped device id, or `null` when the platform gives none. */
    fun androidId(): String?

    /** The screen's smallest width in dp, or 0 when the platform leaves it undefined. */
    fun smallestScreenWidthDp(): Int
}

/** [AndroidDeviceFacts] read from the platform through the host app's [context]. */
internal class ContextDeviceFacts(private val context: Context) : AndroidDeviceFacts {
    override fun debuggerConnected(): Boolean = Debug.isDebuggerConnected()

    override fun appDebuggable(): Boolean = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    // The device recognition tier's one identifier (C94.4, C94.7): per app-signing key, user and
    // device on Android 8.0 and later, read only when the session's recognition tier is on. The server
    // keeps only its HMAC.
    @SuppressLint("HardwareIds")
    override fun androidId(): String? = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)

    override fun smallestScreenWidthDp(): Int = context.resources.configuration.smallestScreenWidthDp
}

/**
 * The Android [DeviceSignals] (C94.7, ADR 0006). Under session integrity it sends the debugger facts
 * and (C210, Workflow 10B) the emulator, root and hooking indicator codes of [IntegrityProbes];
 * under device recognition the `ANDROID_ID`; with any tier, the device class that sets an SDK
 * session's `device-type` (C94.5). With neither tier it reads nothing and sends nothing.
 *
 * A value the platform does not give, or that the contract cannot carry, is left out rather than
 * replaced: the server then reads it as unknown, never as a clean device.
 */
internal class AndroidDeviceSignals(
    private val facts: AndroidDeviceFacts,
    /**
     * Phase 7 C90.9 (owner decisions after Workflow 7A): the bot-detection outcome a sandbox session
     * asks for, from `OpenVerifyComponents.sandboxSignalOutcome`, sent beside whichever tier applies.
     * The coordinator leaves it out of a session that is not a sandbox (`sendSignalsBeside`), since
     * production refuses the whole body (422 `sandbox_only_value`). It is no read of the device.
     */
    private val sandboxOutcome: SandboxSignalOutcome? = null,
    /**
     * C210.3 (Workflow 10B): what the device-integrity rules read, under session integrity only; `null`
     * runs no probe, so the body carries no indicator list.
     */
    private val probe: DeviceProbe? = null,
    /** Where the reads run: never the main thread, since the probes read files (C210.3). */
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
) : DeviceSignals {
    constructor(context: Context, sandboxOutcome: SandboxSignalOutcome? = null) :
        this(ContextDeviceFacts(context.applicationContext), sandboxOutcome, ContextDeviceProbe(context.applicationContext))

    override suspend fun collect(tiers: FlowSessionSignals, screen: String, sequence: Int): FlowSignals? {
        if (!tiers.integrity && !tiers.recognition) return null
        return withContext(dispatcher) { read(tiers, screen, sequence) }
    }

    private fun read(tiers: FlowSessionSignals, screen: String, sequence: Int): FlowSignals {
        val integrity = if (tiers.integrity) integrityOf(facts.debuggerConnected(), facts.appDebuggable()) else null
        val recognition = if (tiers.recognition) facts.androidId()?.let(::recognitionOf) else null
        return FlowSignals(
            platform = AndroidSignalContract.PLATFORM,
            collectorVersion = AndroidSignalContract.COLLECTOR_VERSION,
            screen = screen,
            sequence = sequence,
            androidIntegrity = integrity,
            androidRecognition = recognition,
            deviceClass = deviceClassOf(facts.smallestScreenWidthDp()),
            sandboxOutcome = sandboxOutcome?.let(::wireOf),
        )
    }

    /**
     * Session integrity: the debugger facts, and (C210.2, C210.3) the three families' indicator codes
     * from [probe], each left out when its rules gave no answer, empty when they found nothing.
     */
    private fun integrityOf(debuggerConnected: Boolean, appDebuggable: Boolean): AndroidIntegritySignals {
        val found = probe?.let(IntegrityProbes::collect)
        return AndroidIntegritySignals(debuggerConnected, appDebuggable, found?.emulator, found?.root, found?.hooking)
    }

    /** C90.9's wire values. */
    private fun wireOf(outcome: SandboxSignalOutcome): String = when (outcome) {
        SandboxSignalOutcome.BOT -> "bot"
        SandboxSignalOutcome.HUMAN -> "human"
    }

    private fun recognitionOf(androidId: String): AndroidRecognitionSignals? =
        androidId.lowercase().takeIf(AndroidSignalContract.ANDROID_ID::matches)?.let(::AndroidRecognitionSignals)

    internal companion object {
        /**
         * The smallest width, in dp, from which a device is a `tablet` (provisional). Basis: Android's
         * `sw600dp` resource qualifier, the platform's documented breakpoint for 7-inch tablets; not
         * measured on OpenVerify data.
         */
        const val TABLET_SMALLEST_WIDTH_DP: Int = 600

        /** `smartphone` or `tablet`, or `null` when the width is undefined. */
        fun deviceClassOf(smallestWidthDp: Int): String? = when {
            smallestWidthDp == Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED -> null
            smallestWidthDp >= TABLET_SMALLEST_WIDTH_DP -> "tablet"
            else -> "smartphone"
        }
    }
}
