package dev.openverify.nfc

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.coroutines.test.runTest
import android.app.Activity
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNfcAdapter

/**
 * C209.2: the public factory. It gives one reader for the app, which reads for whichever of the app's
 * screens is resumed (the SDK's flow activity, when its tap screen calls it), and whose failures are
 * the SDK's exception with its fixed message and no cause (C213.3).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class OpenVerifyNfcTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    // Synthetic: the specimen document number and dates of the Utopia test chip.
    private val access = ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101"))

    @After
    fun reset() = ShadowNfcAdapter.reset()

    private fun nfc(enabled: Boolean): ShadowNfcAdapter {
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_NFC, true)
        ShadowNfcAdapter.setNfcHardwareExists(true)
        return shadowOf(NfcAdapter.getDefaultAdapter(context)).also { it.setEnabled(enabled) }
    }

    private fun failed(reader: ChipReader, progress: MutableList<ChipProgress> = mutableListOf()): ChipReadException? {
        var failure: Throwable? = null
        runTest { failure = runCatching { reader.read(access, ByteArray(8), progress::add) }.exceptionOrNull() }
        return failure as? ChipReadException
    }

    @Test
    fun `the factory gives the SDK's chip reader, the same for any context of the app`() {
        val reader: ChipReader = OpenVerifyNfc.chipReader(context)

        assertSame(reader, OpenVerifyNfc.chipReader(context.applicationContext))
        assertSame(reader, OpenVerifyNfc.chipReader(Robolectric.buildActivity(Activity::class.java).setup().get()))
    }

    @Test
    fun `on a phone without NFC a read reports no progress and ends as NFC disabled, with the fixed message`() {
        ShadowNfcAdapter.setNfcHardwareExists(false)
        val progress = mutableListOf<ChipProgress>()

        val failed = failed(OpenVerifyNfc.chipReader(context), progress)

        assertEquals(ChipReadFailure.NFC_DISABLED, failed?.failure)
        assertEquals("Chip read failed: nfc_disabled", failed?.message)
        assertNull(failed?.cause)
        assertEquals(emptyList<ChipProgress>(), progress)
    }

    @Test
    fun `with NFC off a read ends as NFC disabled`() {
        nfc(enabled = false)

        assertEquals(ChipReadFailure.NFC_DISABLED, failed(OpenVerifyNfc.chipReader(context))?.failure)
    }

    @Test
    fun `with NFC on and no screen of the app resumed, the reader cannot run`() {
        nfc(enabled = true)

        assertEquals(ChipReadFailure.READER_BUSY, failed(OpenVerifyNfc.chipReader(context))?.failure)
    }

    @Test
    fun `with NFC on, a read for the resumed screen puts the phone in reader mode and takes it out when it is stopped`() = runTest {
        val adapter = nfc(enabled = true)
        val reader = OpenVerifyNfc.chipReader(context)
        Robolectric.buildActivity(Activity::class.java).setup()
        val progress = mutableListOf<ChipProgress>()

        val reading = launch { reader.read(access, ByteArray(8), progress::add) }
        runCurrent()

        assertTrue(adapter.isInReaderMode)
        assertEquals(listOf<ChipProgress>(ChipProgress.WaitingForDocument), progress)

        reading.cancelAndJoin()
        assertFalse(adapter.isInReaderMode)
    }
}
