package dev.openverify.sdk.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/**
 * C201.1, C201.3 (decision 17; rule 11): frames reach the one guidance that reads them, one at a time;
 * the analyzer may write a buffer again only once the reader's callback returned; a session without
 * analysis gives no frames at all, and an ended session completes its readers.
 */
class FrameRelayTest {

    private fun frame(timestamp: Long = 1, bytes: ByteArray = ByteArray(4 * 4 * 4)) =
        AnalysisFrame(4, 4, 90, PixelLayout.RGBA_8888, bytes, timestamp)

    @Test
    fun aSessionWithoutAnalysisCompletesItsReadersAtOnceEmpty() = runTest {
        val relay = FrameRelay()
        val read = async { relay.frames().toList() }
        runCurrent()

        relay.open(analysing = false)

        assertEquals(emptyList(), read.await())
        assertFalse(relay.wanted())
        assertEquals(FrameDelivery.NOT_WANTED, relay.deliver(frame()))
    }

    @Test
    fun aReaderWaitsForTheCameraToComeUp() = runTest {
        val relay = FrameRelay()
        val read = async { relay.frames().first() }
        runCurrent()
        assertFalse(read.isCompleted)

        relay.open(analysing = true)
        runCurrent()
        val sent = frame(timestamp = 42)
        val delivery = async { relay.deliver(sent) }

        assertSame(sent, read.await())
        assertEquals(FrameDelivery.RELEASED, delivery.await())
    }

    @Test
    fun aFrameIsCopiedOnlyWhenSomeoneReadsIt() = runTest {
        val relay = FrameRelay()
        relay.open(analysing = true)
        assertFalse(relay.wanted())
        assertEquals(FrameDelivery.NOT_WANTED, relay.deliver(frame()))

        val reader = launch { relay.frames().collect { } }
        runCurrent()

        assertTrue(relay.wanted())
        reader.cancel()
        runCurrent()
        assertFalse(relay.wanted())
    }

    @Test
    fun theAnalyzerWaitsUntilTheReadersCallbackReturned() = runTest {
        val relay = FrameRelay()
        relay.open(analysing = true)
        val inCallback = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        val reader = launch {
            relay.frames().collect {
                inCallback.complete(Unit)
                finish.await()
            }
        }
        runCurrent()

        val delivery = async { relay.deliver(frame()) }
        inCallback.await()
        runCurrent()
        assertFalse(delivery.isCompleted, "the buffer is still being read")

        finish.complete(Unit)
        assertEquals(FrameDelivery.RELEASED, delivery.await())
        reader.cancel()
    }

    @Test
    fun aReaderThatHoldsAFrameTooLongCostsTheAnalyzerItsBuffer() = runTest {
        val relay = FrameRelay(releaseWait = 1.seconds)
        relay.open(analysing = true)
        val reader = launch { relay.frames().collect { delay(5.seconds) } }
        runCurrent()

        assertEquals(FrameDelivery.HELD, relay.deliver(frame()))
        reader.cancel()
    }

    @Test
    fun frameAfterFrameEachReachesTheReaderInOrder() = runTest {
        val relay = FrameRelay()
        relay.open(analysing = true)
        val seen = mutableListOf<Long>()
        val reader = launch { relay.frames().collect { seen += it.timestampNanos } }
        runCurrent()

        (1L..5L).forEach { assertEquals(FrameDelivery.RELEASED, relay.deliver(frame(timestamp = it))) }

        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), seen)
        reader.cancel()
    }

    @Test
    fun anEndedSessionCompletesItsReadersAndTakesNoMoreFrames() = runTest {
        val relay = FrameRelay()
        val session = relay.open(analysing = true)
        val read = async { relay.frames().toList() }
        runCurrent()

        relay.close(session)

        assertEquals(emptyList(), read.await())
        assertEquals(FrameDelivery.NOT_WANTED, relay.deliver(frame()))
    }

    @Test
    fun aNewSessionEndsTheOldOnesReaders() = runTest {
        val relay = FrameRelay()
        relay.open(analysing = true)
        val read = async { relay.frames().toList() }
        runCurrent()

        relay.open(analysing = true)

        assertEquals(emptyList(), read.await())
    }

    @Test
    fun aReaderCancelledInsideItsCallbackStillReleasesTheBuffer() = runTest {
        val relay = FrameRelay()
        relay.open(analysing = true)
        val reader = launch { relay.frames().collect { delay(10_000) } }
        runCurrent()

        val delivery = async { relay.deliver(frame()) }
        runCurrent()
        reader.cancel()

        assertEquals(FrameDelivery.RELEASED, delivery.await())
    }
}
