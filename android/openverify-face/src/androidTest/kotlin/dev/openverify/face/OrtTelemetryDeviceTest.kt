package dev.openverify.face

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.TrafficStats
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * C205.2, the fourth layer on a device (reviews P09, H06): with ONNX Runtime's telemetry provider
 * removed by this module's manifest, YuNet runs through ONNX Runtime in an app that holds `INTERNET`,
 * and over a stated window the app sends and receives nothing beyond what the test runner itself does.
 *
 * What is measured, each time in a new process of this app that has not loaded ONNX Runtime
 * (`OrtProbeService`): the app UID's bytes, received and sent, by `TrafficStats` (unsupported counters
 * fail the test), from before the process exists, through the first `OrtEnvironment`, [INFERENCE] of
 * the detector and its close, to the end of a fixed quiet period of [QUIET_MS]. The same is measured
 * again in a second new process: a restart is what would send an event queued by the first.
 *
 * The test runner's own traffic is measured separately, over [CONTROL_MS] before any such process
 * exists, and scaled to a window's length: a window may count no more than that.
 *
 * Also asserted: no class of ONNX Runtime's telemetry was loaded, so none was initialised (read from
 * the process's own heap dump, which does list the ONNX Runtime classes that were); no new file under `files`,
 * `databases`, `cache` or `no_backup` (a queued event); the telemetry variable is set; this module
 * created the environment.
 *
 * The screen is kept on throughout and the device is asserted awake and not dozing at each end of each
 * quiet period: a sleeping phone sends nothing, so a window measured on one would prove nothing.
 *
 * What this proves is this window on the device it ran on, never "no bytes are ever sent". Host twins:
 * `OrtEnvironmentsTest` (the variable before the first environment, telemetry off before every
 * session), `MergedManifestTest` and `OrtManifestTest` (the provider's removal), `OrtTelemetryClassesTest`.
 */
@RunWith(AndroidJUnit4::class)
class OrtTelemetryDeviceTest {

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val replies = LinkedBlockingQueue<Bundle>()
    private val replyThread = HandlerThread("ort-probe-replies").apply { start() }
    private val replyTo = Messenger(
        Handler(replyThread.looper) { message ->
            replies.put(message.data ?: Bundle())
            true
        },
    )
    private var connection: Connection? = null
    private var awake: ActivityScenario<KeepAwakeActivity>? = null

    private class Connection : ServiceConnection {
        val connected = CountDownLatch(1)
        val gone = CountDownLatch(1)

        @Volatile
        var service: Messenger? = null

        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            service = Messenger(binder)
            connected.countDown()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            gone.countDown()
        }
    }

    private class Traffic(val received: Long, val sent: Long) {
        operator fun minus(earlier: Traffic) = Traffic(received - earlier.received, sent - earlier.sent)
        val total: Long get() = received + sent
    }

    private fun traffic(): Traffic {
        val uid = Process.myUid()
        val received = TrafficStats.getUidRxBytes(uid)
        val sent = TrafficStats.getUidTxBytes(uid)
        assertNotEquals("this device does not count the UID's received bytes", TrafficStats.UNSUPPORTED.toLong(), received)
        assertNotEquals("this device does not count the UID's sent bytes", TrafficStats.UNSUPPORTED.toLong(), sent)
        return Traffic(received, sent)
    }

    private fun startProcess(): Connection {
        val made = Connection()
        assertTrue(context.bindService(Intent(context, OrtProbeService::class.java), made, Context.BIND_AUTO_CREATE))
        assertTrue("the second process did not start", made.connected.await(STEP_SECONDS, TimeUnit.SECONDS))
        connection = made
        return made
    }

    private fun ask(connection: Connection, what: Int): Bundle {
        connection.service!!.send(Message.obtain(null, what).also { it.replyTo = replyTo })
        val reply = replies.poll(STEP_SECONDS, TimeUnit.SECONDS)
        assertNotNull("the second process did not answer", reply)
        return reply!!
    }

    /** Ends the second process and waits until the system reports it gone. */
    private fun endProcess(connection: Connection) {
        connection.service!!.send(Message.obtain(null, OrtProbeService.EXIT).also { it.replyTo = replyTo })
        assertTrue("the second process did not end", connection.gone.await(STEP_SECONDS, TimeUnit.SECONDS))
        context.unbindService(connection)
        this.connection = null
        replies.clear()
    }

    /** Waits [milliseconds] of real time (a clock that keeps counting if the processor sleeps). */
    private fun quiet(milliseconds: Long) {
        val end = SystemClock.elapsedRealtime() + milliseconds
        while (true) {
            val left = end - SystemClock.elapsedRealtime()
            if (left <= 0) return
            SystemClock.sleep(minOf(left, 1_000L))
        }
    }

    /**
     * A sleeping or dozing phone sends nothing, whatever the app holds: the window counts only on an
     * awake one. A phone that is locked, on battery and lying still stays in doze even with its screen
     * on; the byte count cannot be taken on it until it is unlocked or charging, and this fails then.
     */
    private fun assertAwake(moment: String) {
        val power = context.getSystemService(PowerManager::class.java)
        assertTrue("$moment: the screen is off, so the device may suspend", power.isInteractive)
        assertFalse("$moment: the device is dozing, which restricts the network (unlock it or put it on charge)", power.isDeviceIdleMode)
    }

    /** Which of ONNX Runtime's telemetry classes the probed process has loaded: by the AAR's list and by package. */
    private fun telemetryClasses(probe: Bundle): List<String> =
        probe.getStringArrayList(OrtProbeService.LOADED)!!.filter { it in OrtTelemetryClasses.NAMES || it.startsWith(OrtTelemetryClasses.PACKAGE_PREFIX) }

    @After
    fun release() {
        awake?.close()
        connection?.let { runCatching { context.unbindService(it) } }
        replyThread.quitSafely()
    }

    /** A new process of this app, before anything of ONNX Runtime ran in it: its connection, its id and the files it starts with. */
    private fun freshProcess(label: String, knownFiles: Set<String>?, earlierPid: Int?): Triple<Connection, Int, Set<String>> {
        val process = startProcess()
        val fresh = ask(process, OrtProbeService.PROBE)
        val pid = fresh.getInt(OrtProbeService.PID)
        assertNotEquals("the detector runs outside the runner's process", Process.myPid(), pid)
        if (earlierPid != null) assertNotEquals("the restart is a new process", earlierPid, pid)
        // From before the first OrtEnvironment: this process has not loaded that class yet.
        assertFalse("$label: ONNX Runtime was loaded before the measurement began", ENVIRONMENT in fresh.getStringArrayList(OrtProbeService.LOADED)!!)
        assertEquals("$label: telemetry classes loaded at process start", emptyList<String>(), telemetryClasses(fresh))
        assertNull("$label: the variable was set before this module ran", fresh.getString(OrtProbeService.VARIABLE))
        val filesAtStart = fresh.getStringArrayList(OrtProbeService.FILES)!!.toSet()
        // After a restart, nothing may have appeared since the first process began either.
        if (knownFiles != null) assertEquals("$label: files that appeared across the restart", emptySet<String>(), filesAtStart - knownFiles)
        return Triple(process, pid, knownFiles ?: filesAtStart)
    }

    /** The detector as a host runs it, in [process]: the public factory, a detector, [INFERENCE] frames, close. */
    private fun runDetector(label: String, process: Connection) {
        val ran = ask(process, OrtProbeService.INFER)
        assertEquals("$label: the detector found the drawn face in every frame", ran.getInt(OrtProbeService.FRAMES), ran.getInt(OrtProbeService.FACES))
        assertEquals(INFERENCE, ran.getInt(OrtProbeService.FRAMES))
        assertFalse("$label: this module created the environment", ran.getBoolean(OrtProbeService.HOST_CREATED))
    }

    /** What ONNX Runtime's telemetry would leave in [process] if it had run: none of it is there. */
    private fun assertNoTelemetryTrace(label: String, process: Connection, knownFiles: Set<String>) {
        val after = ask(process, OrtProbeService.PROBE)
        // The control of the class check: ONNX Runtime ran here, and the dump lists the classes it loaded.
        assertTrue("$label: the loaded-class list sees ONNX Runtime's own classes", ENVIRONMENT in after.getStringArrayList(OrtProbeService.LOADED)!!)
        assertEquals("$label: telemetry classes loaded", emptyList<String>(), telemetryClasses(after))
        assertEquals("$label: the telemetry variable", "1", after.getString(OrtProbeService.VARIABLE))
        assertEquals("$label: new files (a queued event)", emptySet<String>(), after.getStringArrayList(OrtProbeService.FILES)!!.toSet() - knownFiles)
    }

    /** One window in a new process: from before it exists to the end of the quiet period after the detector closed. */
    private fun window(label: String, allowedBytes: (Long) -> Long, knownFiles: Set<String>?, earlierPid: Int?): Pair<Set<String>, Int> {
        val startedAt = SystemClock.elapsedRealtime()
        val before = traffic()
        val (process, pid, files) = freshProcess(label, knownFiles, earlierPid)
        Log.i(TAG, "$label: process started after ${SystemClock.elapsedRealtime() - startedAt} ms")

        runDetector(label, process)

        Log.i(TAG, "$label: detector closed after ${SystemClock.elapsedRealtime() - startedAt} ms; quiet period begins")
        assertAwake("$label, as the quiet period begins")
        val quietStart = SystemClock.elapsedRealtime()
        quiet(QUIET_MS)
        val quietLength = SystemClock.elapsedRealtime() - quietStart
        assertAwake("$label, as the quiet period ends")
        // The period is the fixed one: not shorter, and not stretched by a processor that slept through it.
        assertTrue("$label: the quiet period lasted $quietLength ms", quietLength in QUIET_MS..QUIET_MS + QUIET_SLACK_MS)

        assertNoTelemetryTrace(label, process, files)
        val moved = traffic() - before
        val length = SystemClock.elapsedRealtime() - startedAt
        val allowed = allowedBytes(length)
        Log.i(TAG, "$label: window ${length} ms, received ${moved.received} B, sent ${moved.sent} B, allowed ${allowed} B")
        assertTrue("$label: the app's UID moved ${moved.total} bytes in ${length} ms; the runner's own traffic allows $allowed", moved.total <= allowed)
        endProcess(process)
        return files to pid
    }

    /**
     * What does not depend on the network, and so holds on a phone in any power state: the detector
     * runs in a new process of an app without the provider, no telemetry class is loaded by it, the
     * telemetry variable is set, no file appears, and the same again in a second new process.
     */
    @Test
    fun noTelemetryClassIsLoadedAndNoFileAppearsWhenTheDetectorRunsAndAgainAfterARestart() {
        assertTheAppCouldSendAndHoldsNoProvider()

        val (first, pid, files) = freshProcess("first process", knownFiles = null, earlierPid = null)
        runDetector("first process", first)
        assertNoTelemetryTrace("first process", first, files)
        endProcess(first)

        val (second, _, _) = freshProcess("after a restart", knownFiles = files, earlierPid = pid)
        runDetector("after a restart", second)
        assertNoTelemetryTrace("after a restart", second, files)
        endProcess(second)
    }

    /** The app this runs in is one that could send, and holds neither the provider nor the extra permission. */
    private fun assertTheAppCouldSendAndHoldsNoProvider() {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS or PackageManager.GET_PROVIDERS)
        val requested = info.requestedPermissions.orEmpty().toList()
        assertTrue("the app holds INTERNET", "android.permission.INTERNET" in requested)
        assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission("android.permission.INTERNET"))
        assertFalse("the host removed ACCESS_NETWORK_STATE", "android.permission.ACCESS_NETWORK_STATE" in requested)
        assertEquals("no telemetry provider is in the app", emptyList<String>(), info.providers.orEmpty().map { it.name }.filter { it == OrtTelemetryClasses.PROVIDER })
        assertNull(context.packageManager.resolveContentProvider(context.packageName + ".onnxruntime_telemetry_initializer", 0))
    }

    @Test
    fun noBytesAreCountedBeyondTheRunnersOwnFromBeforeTheFirstEnvironmentThroughAQuietPeriodAndAgainAfterARestart() {
        assertTheAppCouldSendAndHoldsNoProvider()

        // The screen is kept on for the whole measurement (KeepAwakeActivity says why).
        awake = ActivityScenario.launch(KeepAwakeActivity::class.java)
        // A phone that was dozing may leave that state a moment after its screen comes on: wait for it once, here.
        val power = context.getSystemService(PowerManager::class.java)
        val wakeBy = SystemClock.elapsedRealtime() + WAKE_MS
        while ((!power.isInteractive || power.isDeviceIdleMode) && SystemClock.elapsedRealtime() < wakeBy) SystemClock.sleep(200)
        assertAwake("at the start")

        // The runner's own traffic, with no second process: bytes over CONTROL_MS, scaled to a window's length.
        val controlStart = traffic()
        quiet(CONTROL_MS)
        val control = traffic() - controlStart
        Log.i(TAG, "control: ${CONTROL_MS} ms, received ${control.received} B, sent ${control.sent} B")
        val allowed = { length: Long -> (control.total * length + CONTROL_MS - 1) / CONTROL_MS }

        val (files, pid) = window("first process", allowed, knownFiles = null, earlierPid = null)
        window("after a restart", allowed, knownFiles = files, earlierPid = pid)
    }

    private companion object {
        const val TAG = "OpenVerifyFaceTest"

        /** C205.2: the fixed quiet period after the detector closed. Never shortened to fit a run. */
        const val QUIET_MS = 120_000L

        /** How long the runner's own traffic is measured for, before any ONNX Runtime process exists. */
        const val CONTROL_MS = 30_000L

        /** How much longer than [QUIET_MS] the quiet period may measure (the wait's own granularity and scheduling). */
        const val QUIET_SLACK_MS = 5_000L

        /** How long the device may take to leave its sleep once the screen is on, before anything is measured. */
        const val WAKE_MS = 30_000L

        const val ENVIRONMENT = "ai.onnxruntime.OrtEnvironment"

        /** How long a step of the second process may take (its start, an answer, its end). */
        const val STEP_SECONDS = 60L

        /** What "inference" is in a window: eight frames, a second of guidance. */
        const val INFERENCE = OrtProbeService.INFERENCE_FRAMES
    }
}
