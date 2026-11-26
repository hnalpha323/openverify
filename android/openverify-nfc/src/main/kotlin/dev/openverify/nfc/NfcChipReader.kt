package dev.openverify.nfc

import android.app.Activity
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * The module's chip reader (C209.2). One read is one tap:
 *
 * 1. reader mode is turned on for the resumed activity ([ResumedActivity]), for NFC-A and NFC-B with
 *    no NDEF check ([NfcPort]), and the read waits for a document;
 * 2. the first chip in the field is read by [ChipReadOrchestrator], off the caller's thread;
 * 3. reader mode is turned off, on every way out: a result, a failure, a stop by the caller, and at
 *    once when the activity is left.
 *
 * Reader mode is therefore on only while a screen that asked for a read is resumed and still waits.
 * A caller stops a read by cancelling it, as the SDK's NFC step does when its screen is left.
 *
 * The reader keeps the application's context and nothing of any document: the chip's bytes exist
 * only in the read's own result, which is the caller's (C207.4). Progress is told in the caller's
 * context, in order, and whole before the read returns.
 */
internal class NfcChipReader(
    private val port: NfcPort,
    private val activities: ResumedActivity,
    private val orchestrator: ChipReadOrchestrator = ChipReadOrchestrator(),
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val waitLimit: Duration = WAIT_FOR_DOCUMENT,
    private val readLimit: Duration = READ_LIMIT,
) : ChipReader {
    private val reading = AtomicBoolean(false)

    /** The activity reader mode is on for, while a read waits or talks. */
    private val enabledFor = AtomicReference<Activity?>(null)

    init {
        activities.onPaused = { left -> if (enabledFor.compareAndSet(left, null)) port.disable(left) }
    }

    override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
        if (!reading.compareAndSet(false, true)) failed(ChipReadFailure.READER_BUSY)
        try {
            if (!port.ready()) failed(ChipReadFailure.NFC_DISABLED)
            val activity = activities.current() ?: failed(ChipReadFailure.READER_BUSY)
            return coroutineScope {
                // Progress crosses from the reading thread to the caller's context through this channel, in order.
                val events = Channel<ChipProgress>(Channel.UNLIMITED)
                val teller = launch { for (event in events) progress(event) }
                try {
                    tap(activity, access, challenge) { events.trySend(it) }
                } catch (failure: ChipReadException) {
                    failed(failure.failure)
                } finally {
                    events.close()
                    teller.join()
                }
            }.also { NfcLog.log("nfc.read.done") }
        } finally {
            reading.set(false)
        }
    }

    /** Steps 1 to 3 for [activity]. */
    private suspend fun tap(activity: Activity, access: ChipAccess, challenge: ByteArray, tell: (ChipProgress) -> Unit): ChipRead {
        val chips = Channel<ChipFound>(Channel.CONFLATED)
        val session = AtomicReference<ChipSession?>(null)
        // Named before reader mode is on, so that a pause that falls while it is being turned on finds it (review E005).
        enabledFor.set(activity)
        if (!port.enable(activity) { chips.trySend(it) }) {
            enabledFor.compareAndSet(activity, null)
            ChipFailures.raise(ChipReadFailure.NFC_DISABLED)
        }
        // The activity was left meanwhile: its pause may have come before reader mode was on, so it is turned off again here.
        if (enabledFor.get() !== activity) port.disable(activity)
        try {
            tell(ChipProgress.WaitingForDocument)
            val chip = withTimeoutOrNull(waitLimit) { chips.receive() } ?: ChipFailures.raise(ChipReadFailure.TIMEOUT)
            val connect = { (chip.connect() ?: ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT)).also { session.set(it) } }
            val outcome = withTimeoutOrNull(readLimit) {
                coroutineScope {
                    // A failed read is carried out of the reading thread as a value: thrown there, it
                    // would also count as this scope's failure, and outrank the limit that ended it.
                    val work = async(io) {
                        try {
                            Outcome(orchestrator.read(connect, access, challenge, tell), null)
                        } catch (failure: ChipReadException) {
                            Outcome(null, failure.failure)
                        }
                    }
                    try {
                        work.await()
                    } catch (stopped: CancellationException) {
                        // The read is stopped or out of time while the reading thread may be inside an
                        // exchange: closing the session ends that exchange, so the thread comes back.
                        close(session.get())
                        throw stopped
                    }
                }
            } ?: ChipFailures.raise(ChipReadFailure.TIMEOUT)
            return outcome.read ?: ChipFailures.raise(outcome.failure ?: ChipReadFailure.READER_BUSY)
        } finally {
            close(session.getAndSet(null))
            if (enabledFor.compareAndSet(activity, null)) port.disable(activity)
        }
    }

    /** How the reading thread ended: with a read, or with the failure that ended it. */
    private class Outcome(val read: ChipRead?, val failure: ChipReadFailure?)

    private fun close(session: ChipSession?) {
        try {
            session?.close()
        } catch (_: Exception) {
            // Nothing to do for a chip that is already gone, and nothing of the failure to keep.
        }
    }

    /** Ends the read as [failure], with the failure's own code in a debuggable host's log (C213.3). */
    private fun failed(failure: ChipReadFailure): Nothing {
        when (failure) {
            ChipReadFailure.TAG_LOST -> NfcLog.log("nfc.read.tag_lost")
            ChipReadFailure.ACCESS_DENIED -> NfcLog.log("nfc.read.access_denied")
            ChipReadFailure.UNSUPPORTED_DOCUMENT -> NfcLog.log("nfc.read.unsupported_document")
            ChipReadFailure.TIMEOUT -> NfcLog.log("nfc.read.timeout")
            ChipReadFailure.NFC_DISABLED -> NfcLog.log("nfc.read.nfc_disabled")
            ChipReadFailure.READER_BUSY -> NfcLog.log("nfc.read.reader_busy")
        }
        ChipFailures.raise(failure)
    }

    internal companion object {
        /**
         * How long a read waits for a document. Provisional: the lifetime of the server's chip
         * challenge (C207.2), at whose end the SDK's step stops a read that still waits; this limit
         * only keeps another caller's read from waiting for ever.
         */
        val WAIT_FOR_DOCUMENT: Duration = 5.minutes

        /**
         * How long a read may take once a chip is in the field. Provisional: about twice what the
         * largest portrait the server takes (1 MiB) needs in small blocks from a slow chip, so that
         * no read that would finish is cut off; a chip that stops answering is ended much sooner, by
         * the limit on one exchange ([JmrtdChipSession.EXCHANGE_TIMEOUT_MS]).
         */
        val READ_LIMIT: Duration = 5.minutes
    }
}
