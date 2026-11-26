package dev.openverify.nfc

import android.app.Activity
import android.content.Context
import android.nfc.NfcAdapter
import android.os.Build
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Collections

/**
 * The empty screen the device tests resume, declared in the tests' own manifest. It shows itself over
 * a lock screen and turns the display on, so that a test device that went to sleep still resumes it;
 * it changes no setting of the device.
 */
class DeviceTestScreen : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
    }
}

/**
 * C209.2, C219.5: the reader on a device, with no chip in the field. The host tests hold the reader's
 * logic over a fake of the phone's NFC (`NfcChipReaderTest`) and over Robolectric's adapter
 * (`AdapterNfcPortTest`); this holds only the platform's side: what the device's own `NfcAdapter` does
 * when the reader asks it for reader mode.
 *
 * Each test asserts what the device it runs on reports, and never skips:
 * - **the adapter is on** (a phone with NFC turned on): a read turns reader mode on for the resumed
 *   screen, the platform accepts it, the read waits and starts no session with any chip, and reader
 *   mode is turned off when the screen is left or the read is stopped;
 * - **no adapter, or NFC off** (an emulator, a phone without NFC, a phone with NFC turned off): a
 *   read ends at once as `nfc_disabled`, reader mode is never asked for, and nothing is reported.
 *
 * No document is used: a real chip read is the owner's step, in the demo's reader check (decision 48).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class ChipReaderDeviceTest {

    /** The device's own NFC, with a record of what the reader asked of it and what it answered. */
    private class RecordingPort(private val device: NfcPort) : NfcPort {
        val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val chips: MutableList<ChipFound> = Collections.synchronizedList(mutableListOf())

        override fun ready(): Boolean = device.ready()

        override fun enable(activity: Activity, found: (ChipFound) -> Unit): Boolean =
            device.enable(activity) { chip -> chips += chip; found(chip) }.also { calls += if (it) "enable accepted" else "enable refused" }

        override fun disable(activity: Activity) {
            device.disable(activity)
            calls += "disable"
        }
    }

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    // Synthetic: the specimen document number and dates of the Utopia test chip.
    private val access = ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101"))
    private val progress: MutableList<ChipProgress> = Collections.synchronizedList(mutableListOf())

    @After
    fun stop() = scope.cancel()

    /** What this device reports: an NFC adapter that is turned on, or not. */
    private fun adapterIsOn(): Boolean = NfcAdapter.getDefaultAdapter(context)?.isEnabled == true

    private fun reading(reader: dev.openverify.sdk.chip.ChipReader): Deferred<Result<ChipRead>> =
        scope.async { runCatching { reader.read(access, ByteArray(8), progress::add) } }

    /** How a read that should still be waiting ended: its failure's constant, never anything of a document. */
    private fun ended(reading: Deferred<Result<ChipRead>>): String =
        if (!reading.isCompleted) "still running" else (reading.getCompleted().exceptionOrNull() as? ChipReadException)?.failure?.name ?: "another outcome"

    @Test
    fun aReadHoldsReaderModeOnlyWhileItsScreenIsResumedAndStartsNoSessionWithNoChipInTheFieldOrEndsAsNfcDisabledWithoutAnAdapterThatIsOn() = runBlocking {
        val port = RecordingPort(AdapterNfcPort(context))
        // The reader is made before the screen, as a host makes it when its process starts.
        val reader = NfcChipReader(port, ResumedActivity(context.applicationContext as android.app.Application))
        ActivityScenario.launch(DeviceTestScreen::class.java).use { screen ->
            val reading = reading(reader)

            if (adapterIsOn()) {
                // Branch: the adapter is on. The platform accepts reader mode for the resumed screen.
                withTimeout(WAIT_MS) { while (port.calls.isEmpty() && reading.isActive) delay(POLL_MS) }
                assertTrue("the read ended before reader mode was asked for: ${ended(reading)}", reading.isActive)
                assertEquals(listOf("enable accepted"), port.calls.toList())
                // No chip is in the field: the read waits, reports only that, and no session is started.
                delay(QUIET_MS)
                assertTrue(reading.isActive)
                assertEquals(listOf<ChipProgress>(ChipProgress.WaitingForDocument), progress.toList())
                assertEquals(0, port.chips.size)

                // Leaving the screen turns reader mode off at once, before anyone stops the read.
                screen.moveToState(Lifecycle.State.STARTED)
                assertEquals(listOf("enable accepted", "disable"), port.calls.toList())
                reading.cancelAndJoin()

                // Coming back and asking again turns it on again, and stopping the read turns it off.
                screen.moveToState(Lifecycle.State.RESUMED)
                val again = reading(reader)
                withTimeout(WAIT_MS) { while (port.calls.size < 3 && again.isActive) delay(POLL_MS) }
                assertTrue("the second read ended before reader mode was asked for: ${ended(again)}", again.isActive)
                assertEquals(listOf("enable accepted", "disable", "enable accepted"), port.calls.toList())
                again.cancelAndJoin()
                assertEquals(listOf("enable accepted", "disable", "enable accepted", "disable"), port.calls.toList())
                assertEquals(0, port.chips.size)
            } else {
                // Branch: no adapter, or NFC off. The read ends at once, and reader mode is never asked for.
                val failed = withTimeout(WAIT_MS) { reading.await() }.exceptionOrNull()
                assertEquals(ChipReadFailure.NFC_DISABLED, (failed as? ChipReadException)?.failure)
                assertEquals("Chip read failed: nfc_disabled", failed?.message)
                assertNull(failed?.cause)
                assertEquals(emptyList<String>(), port.calls.toList())
                assertEquals(emptyList<ChipProgress>(), progress.toList())
            }
        }
    }

    @Test
    fun theInstalledReaderWaitsForADocumentOnADeviceWhoseNfcIsOnAndEndsAsNfcDisabledOnOneWithoutAnAdapterThatIsOn() = runBlocking {
        // The public factory, as a host calls it, before any screen.
        val reader = OpenVerifyNfc.chipReader(context)
        ActivityScenario.launch(DeviceTestScreen::class.java).use { screen ->
            val reading = reading(reader)

            if (adapterIsOn()) {
                // Branch: the adapter is on. With no chip in the field the read only waits.
                withTimeout(WAIT_MS) { while (progress.isEmpty() && reading.isActive) delay(POLL_MS) }
                assertTrue("the read ended before it waited for a document: ${ended(reading)}", reading.isActive)
                delay(QUIET_MS)
                assertTrue(reading.isActive)
                assertEquals(listOf<ChipProgress>(ChipProgress.WaitingForDocument), progress.toList())
                // Leaving the screen does not end the read by itself; stopping it does, with nothing read.
                screen.moveToState(Lifecycle.State.STARTED)
                reading.cancelAndJoin()
                assertTrue(reading.isCancelled)
                assertFalse(ChipProgress.Connected in progress)
            } else {
                // Branch: no adapter, or NFC off.
                val failed = withTimeout(WAIT_MS) { reading.await() }.exceptionOrNull()
                assertEquals(ChipReadFailure.NFC_DISABLED, (failed as? ChipReadException)?.failure)
                assertEquals(emptyList<ChipProgress>(), progress.toList())
            }
        }
    }

    private companion object {
        /** The longest the device is given to answer a call that needs no chip. */
        const val WAIT_MS = 10_000L
        const val POLL_MS = 50L

        /** How long the field is watched to stay empty: nothing in the test holds a chip to the phone. */
        const val QUIET_MS = 2_000L
    }
}
