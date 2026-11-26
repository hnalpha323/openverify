package dev.openverify.sdk.camera

import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedSendChannelException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withTimeoutOrNull

/** Where the analyzer hands a frame (C201.1): [FrameRelay] in the camera, a fake in tests. */
internal interface FrameSink {
    /** Whether a guidance is reading frames now, so a sampled frame is worth copying. */
    fun wanted(): Boolean

    /** Hands [frame] over and waits until its reader's callback returned, or says why it did not. */
    suspend fun deliver(frame: AnalysisFrame): FrameDelivery
}

/** What became of a frame the analyzer handed over. */
internal enum class FrameDelivery {
    /** No guidance took it: nobody reads frames, or the camera runs without analysis (C201.3). */
    NOT_WANTED,

    /** Its reader's callback returned: the buffer may be written again. */
    RELEASED,

    /** Its reader still held it when the wait ended: the buffer must never be written again. */
    HELD,
}

/**
 * C201.1, C201.3 (decision 17; rule 11): hands analysis frames from the camera's analyzer thread to
 * the one guidance that reads [frames], one frame at a time, and waits until that reader's callback
 * returned before the analyzer may write the same buffer again. So a frame lives in one reused buffer
 * for one callback, and nothing of it is kept.
 *
 * Each camera session [open]s its own session: analysing (three use cases bound) or not (C201.3's
 * preview and still only, or no camera); [close] ends it, and a reader's [frames] then complete.
 */
internal class FrameRelay(
    /** How long a frame waits for its reader to be ready before it is dropped. */
    private val handoffWait: Duration = HANDOFF_WAIT,
    /** How long the analyzer waits for the reader's callback before it gives the buffer up. */
    private val releaseWait: Duration = RELEASE_WAIT,
) : FrameSink {

    /** One camera session's frames. */
    internal class Session(internal val analysing: Boolean) {
        internal val handoffs: Channel<Handoff> = Channel(Channel.RENDEZVOUS, onUndeliveredElement = Handoff::release)
    }

    /** One frame on its way, released when its reader's callback returned (or it never reached one). */
    internal class Handoff(internal val frame: AnalysisFrame) {
        private val released = CompletableDeferred<Unit>()

        internal fun release() {
            released.complete(Unit)
        }

        internal suspend fun awaitRelease() = released.await()
    }

    private val current = MutableStateFlow<Session?>(null)
    private val readers = MutableStateFlow(0)

    /** A camera session came up, [analysing] when analysis was bound with it. It replaces any earlier one. */
    fun open(analysing: Boolean): Session {
        val session = Session(analysing)
        current.getAndUpdate { session }?.handoffs?.close()
        return session
    }

    /** [session] ended (the preview left, or rebinds): its readers' [frames] complete. */
    fun close(session: Session) {
        current.compareAndSet(session, null)
        session.handoffs.close()
    }

    override fun wanted(): Boolean = current.value?.analysing == true && readers.value > 0

    override suspend fun deliver(frame: AnalysisFrame): FrameDelivery {
        val session = current.value?.takeIf { it.analysing } ?: return FrameDelivery.NOT_WANTED
        if (readers.value == 0) return FrameDelivery.NOT_WANTED
        val handoff = Handoff(frame)
        val taken = try {
            withTimeoutOrNull(handoffWait) { session.handoffs.send(handoff) } != null
        } catch (_: ClosedSendChannelException) {
            false
        }
        if (!taken) return FrameDelivery.NOT_WANTED
        return if (withTimeoutOrNull(releaseWait) { handoff.awaitRelease() } != null) FrameDelivery.RELEASED else FrameDelivery.HELD
    }

    /**
     * The frames of the next camera session to come up, each valid only inside the collector's
     * callback: never buffer, conflate or `flowOn` this flow (each would release a frame before it is
     * read); switch threads inside the callback instead. Completes at once, empty, when that session
     * has no analysis (C201.3), and when the session ends.
     */
    fun frames(): Flow<AnalysisFrame> = flow {
        val session = current.first { it != null } ?: return@flow
        if (!session.analysing) return@flow
        readers.update { it + 1 }
        try {
            for (handoff in session.handoffs) {
                try {
                    emit(handoff.frame)
                } finally {
                    handoff.release()
                }
            }
        } finally {
            readers.update { it - 1 }
        }
    }

    internal companion object {
        /** A sampled frame comes every 125 ms (C201.2's 8 Hz); a reader returns to the next one within this. */
        val HANDOFF_WAIT: Duration = 50.milliseconds

        /** Far beyond a guidance callback's time (a few to tens of milliseconds); past it the buffer is given up. */
        val RELEASE_WAIT: Duration = 1.seconds
    }
}
