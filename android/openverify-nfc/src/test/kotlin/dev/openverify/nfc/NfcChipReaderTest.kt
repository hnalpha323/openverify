package dev.openverify.nfc

import android.app.Activity
import android.app.Application
import androidx.test.core.app.ApplicationProvider
import dev.openverify.nfc.ScriptedChipSession.Companion.BAC_FILES
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * C209.2: the reader, on the host, over a fake of the phone's NFC and a scripted chip. Reader mode is
 * on only while a read waits for or talks to a chip, for the activity that is resumed; the read runs
 * off the caller's thread; and every way out turns reader mode off. The platform's side of it is
 * `AdapterNfcPortTest`, and on a phone `ChipReaderDeviceTest`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class NfcChipReaderTest {

    /** The phone's NFC, scripted: it records what the reader asks of it, and [present] puts a chip in the field. */
    private class FakeNfcPort(var ready: Boolean = true, var accepts: Boolean = true) : NfcPort {
        val calls = mutableListOf<String>()
        var enabledFor: Activity? = null
        private var found: ((ChipFound) -> Unit)? = null

        override fun ready(): Boolean = ready

        /** Runs inside [enable], once reader mode is on and before the reader hears so: where a pause can fall (review E005). */
        var whileEnabling: () -> Unit = {}

        override fun enable(activity: Activity, found: (ChipFound) -> Unit): Boolean {
            calls += "enable"
            if (!accepts) return false
            enabledFor = activity
            this.found = found
            whileEnabling()
            return true
        }

        override fun disable(activity: Activity) {
            calls += "disable"
            if (enabledFor === activity) {
                enabledFor = null
                found = null
            }
        }

        fun present(chip: ChipFound) = checkNotNull(found) { "reader mode is off" }(chip)
    }

    private val application: Application = ApplicationProvider.getApplicationContext()
    private val activities = ResumedActivity(application)
    private val port = FakeNfcPort()
    private val mrz = ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101"))
    private val nonce = byteArrayOf(0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77)
    private val progress = mutableListOf<ChipProgress>()
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "chip-io") }

    @After
    fun stop() {
        worker.shutdownNow()
    }

    private fun screen(): ActivityController<Activity> = Robolectric.buildActivity(Activity::class.java).setup()

    private fun TestScope.reader(): NfcChipReader = NfcChipReader(port, activities, ChipReadOrchestrator(), StandardTestDispatcher(testScheduler))

    private fun TestScope.reading(reader: NfcChipReader): Deferred<Result<ChipRead>> =
        async { runCatching { reader.read(mrz, nonce, progress::add) } }.also { runCurrent() }

    private fun Result<ChipRead>.failure(): ChipReadFailure? = (exceptionOrNull() as? ChipReadException)?.failure

    @Test
    fun `a read turns reader mode on for the resumed screen and waits, and nothing is read until a chip is there`() = runTest {
        val screen = screen()
        val session = ScriptedChipSession(BAC_FILES)

        val reading = reading(reader())

        assertEquals(listOf("enable"), port.calls)
        assertTrue(port.enabledFor === screen.get())
        assertEquals(listOf<ChipProgress>(ChipProgress.WaitingForDocument), progress)
        advanceTimeBy(4.minutes)
        assertTrue(reading.isActive)
        assertEquals(emptyList<String>(), session.calls)

        port.present { session }
        val result = reading.await().getOrThrow()

        assertEquals(6, result.files.size)
        assertTrue(FileKind.CHIP_DG2 in result.files)
        assertEquals(listOf("enable", "disable"), port.calls)
        assertNull(port.enabledFor)
        assertEquals("close", session.calls.last())
    }

    @Test
    fun `progress reaches the caller in order, whole, before the read returns`() = runTest {
        screen()
        val reading = reading(reader())

        port.present { ScriptedChipSession(BAC_FILES) }
        reading.await().getOrThrow()

        assertEquals(listOf(ChipProgress.WaitingForDocument, ChipProgress.Connected), progress.take(2))
        assertEquals(listOf(ChipProgress.Authenticating, ChipProgress.Done), progress.takeLast(2))
        assertEquals(1, progress.count { it == ChipProgress.Done })
    }

    @Test
    fun `a phone without NFC, or with NFC off, ends the read as NFC disabled before anything is turned on`() = runTest {
        screen()
        port.ready = false

        val result = reading(reader()).await()

        assertEquals(ChipReadFailure.NFC_DISABLED, result.failure())
        assertEquals("Chip read failed: nfc_disabled", result.exceptionOrNull()?.message)
        assertNull(result.exceptionOrNull()?.cause)
        assertEquals(emptyList<String>(), port.calls)
        assertEquals(emptyList<ChipProgress>(), progress)
    }

    @Test
    fun `a phone that refuses reader mode ends the read as NFC disabled`() = runTest {
        screen()
        port.accepts = false

        assertEquals(ChipReadFailure.NFC_DISABLED, reading(reader()).await().failure())
        assertEquals(emptyList<ChipProgress>(), progress)
    }

    @Test
    fun `without a resumed screen the reader cannot run, and it can once a screen is resumed again`() = runTest {
        val reader = reader()

        assertEquals(ChipReadFailure.READER_BUSY, reading(reader).await().failure())

        val screen = screen()
        screen.pause()
        assertEquals(ChipReadFailure.READER_BUSY, reading(reader).await().failure())
        assertEquals(emptyList<String>(), port.calls)

        screen.resume()
        val reading = reading(reader)
        port.present { ScriptedChipSession(BAC_FILES) }
        assertEquals(6, reading.await().getOrThrow().files.size)
    }

    @Test
    fun `one read runs at a time, and the second ends as reader busy without disturbing the first`() = runTest {
        screen()
        val reader = reader()
        val first = reading(reader)

        val second = reading(reader).await()

        assertEquals(ChipReadFailure.READER_BUSY, second.failure())
        assertEquals(listOf("enable"), port.calls)
        port.present { ScriptedChipSession(BAC_FILES) }
        assertEquals(6, first.await().getOrThrow().files.size)
    }

    @Test
    fun `no document within the limit ends the read as a timeout, with reader mode off`() = runTest {
        screen()
        val reading = reading(reader())

        advanceTimeBy(5.minutes - 1.seconds)
        assertTrue(reading.isActive)
        advanceTimeBy(2.seconds)

        assertEquals(ChipReadFailure.TIMEOUT, reading.await().failure())
        assertEquals(listOf("enable", "disable"), port.calls)
    }

    @Test
    fun `a tag that is no travel document is an unsupported document`() = runTest {
        screen()
        val reading = reading(reader())

        port.present { null }

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, reading.await().failure())
        assertEquals(listOf("enable", "disable"), port.calls)
    }

    @Test
    fun `a lifted document ends the read as tag lost, and the next read waits for it again`() = runTest {
        screen()
        val reader = reader()
        val first = reading(reader)
        port.present { ScriptedChipSession(BAC_FILES).fail("read DG2", IOException("Transceive failed")) }

        assertEquals(ChipReadFailure.TAG_LOST, first.await().failure())
        assertNull(first.await().exceptionOrNull()?.cause)

        val second = reading(reader)
        assertEquals(listOf("enable", "disable", "enable"), port.calls)
        port.present { ScriptedChipSession(BAC_FILES) }
        assertEquals(6, second.await().getOrThrow().files.size)
    }

    @Test
    fun `stopping a read that waits turns reader mode off and reads nothing`() = runTest {
        screen()
        val reading = reading(reader())

        reading.cancelAndJoin()

        assertTrue(reading.isCancelled)
        assertEquals(listOf("enable", "disable"), port.calls)
        assertEquals(listOf<ChipProgress>(ChipProgress.WaitingForDocument), progress)
    }

    @Test
    fun `leaving the screen turns reader mode off at once, whatever the caller does`() = runTest {
        val screen = screen()
        val reading = reading(reader())

        screen.pause()

        assertEquals(listOf("enable", "disable"), port.calls)
        assertNull(port.enabledFor)
        // The SDK's step stops its read when its screen is left (C207.5); the test does the same.
        reading.cancelAndJoin()
    }

    @Test
    fun `a screen left while reader mode is being turned on does not keep it on`() = runTest {
        val screen = screen()
        port.whileEnabling = { screen.pause() }

        val reading = reading(reader())

        assertEquals("enable", port.calls.first())
        assertTrue(port.calls.toString(), "disable" in port.calls)
        assertNull(port.enabledFor)
        reading.cancelAndJoin()
        assertNull(port.enabledFor)
    }

    // The three tests below run the chip on a real thread, so they run in real time: virtual time would
    // skip a limit while that thread still works. None of them depends on how long anything takes.

    private suspend fun until(condition: () -> Boolean) {
        while (!condition()) yield()
    }

    @Test
    fun `the chip is talked to off the caller's thread, and progress is told on the caller's`() = runBlocking {
        screen()
        val caller = Thread.currentThread()
        var chipThread: Thread? = null
        val progressThreads = mutableSetOf<Thread>()
        val reader = NfcChipReader(port, activities, ChipReadOrchestrator(), worker.asCoroutineDispatcher())
        val reading = async { reader.read(mrz, nonce) { progressThreads += Thread.currentThread() } }
        until { port.enabledFor != null }

        port.present {
            chipThread = Thread.currentThread()
            ScriptedChipSession(BAC_FILES)
        }
        val result = reading.await()

        assertEquals(6, result.files.size)
        assertEquals("chip-io", chipThread?.name)
        assertNotEquals(caller, chipThread)
        assertEquals(setOf(caller), progressThreads)
    }

    /** A chip that stops answering inside its first command, until the session is closed. */
    private class StuckChip : ChipSession by ScriptedChipSession(BAC_FILES) {
        val entered = CountDownLatch(1)
        val closed = CountDownLatch(1)

        override fun open() {
            entered.countDown()
            closed.await()
            throw IOException("Transceive failed")
        }

        override fun close() = closed.countDown()
    }

    @Test
    fun `a read that takes longer than the limit is a timeout, and the stuck exchange is ended by closing the session`() = runBlocking {
        screen()
        val chip = StuckChip()
        // The chip never answers, so the limit is always reached; its length only sets how long the test takes.
        val reader = NfcChipReader(port, activities, ChipReadOrchestrator(), worker.asCoroutineDispatcher(), readLimit = 200.milliseconds)
        val reading = async { runCatching { reader.read(mrz, nonce, progress::add) } }
        until { port.enabledFor != null }

        port.present { chip }

        assertEquals(ChipReadFailure.TIMEOUT, reading.await().failure())
        assertEquals(0L, chip.entered.count)
        assertEquals(0L, chip.closed.count)
        assertEquals(listOf("enable", "disable"), port.calls)
    }

    @Test
    fun `stopping a read in the middle of an exchange closes the session and turns reader mode off`() = runBlocking {
        screen()
        val chip = StuckChip()
        val reader = NfcChipReader(port, activities, ChipReadOrchestrator(), worker.asCoroutineDispatcher())
        val reading = async { reader.read(mrz, nonce, progress::add) }
        until { port.enabledFor != null }
        port.present { chip }
        until { chip.entered.count == 0L }

        reading.cancelAndJoin()

        assertTrue(reading.isCancelled)
        assertEquals(0L, chip.closed.count)
        assertEquals(listOf("enable", "disable"), port.calls)
        assertFalse(ChipProgress.Done in progress)
    }
}
