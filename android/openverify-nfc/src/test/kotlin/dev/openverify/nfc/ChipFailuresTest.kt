package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import net.sf.scuba.smartcards.CardServiceException
import org.jmrtd.AccessDeniedException
import org.jmrtd.BACDeniedException
import org.jmrtd.BACKey
import org.jmrtd.PACEException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

/**
 * C209.3, C213.3: the reader's error mapping over the exceptions JMRTD and SCUBA really throw. The
 * messages hold a canary where a library would name a command or a status word.
 */
class ChipFailuresTest {

    /** Android's exception for a tag that left the field is told by its name, as SCUBA tells it. */
    private class TagLostException : Exception("canary X12345678")

    private val refused = CardServiceException("Access to file denied, canary X12345678", 0x6982)

    @Test
    fun `a transport failure at the root is a lost chip`() {
        assertTrue(ChipFailures.lost(IOException("Transceive failed"), null))
        assertTrue(ChipFailures.lost(CardServiceException("Could not tranceive APDU", IOException("Transceive failed")), null))
        assertTrue(ChipFailures.lost(IOException("Unexpected exception", CardServiceException("Read binary failed", CardServiceException("x", IOException()))), null))
        assertTrue(ChipFailures.lost(CardServiceException("Could not tranceive APDU", TagLostException()), null))
        assertTrue(ChipFailures.lost(InterruptedException(), null))
    }

    @Test
    fun `a refusal or a library fault is not a lost chip, also when a stream wraps it`() {
        assertFalse(ChipFailures.lost(refused, null))
        assertFalse(ChipFailures.lost(IOException("Unexpected exception", refused), null))
        assertFalse(ChipFailures.lost(IllegalStateException("Could not read bytes"), null))
        assertFalse(ChipFailures.lost(CardServiceException("Malformed read binary long response data"), null))
    }

    @Test
    fun `the session's own word for a lost connection is taken`() {
        val session = ScriptedChipSession(emptyMap()).fail("never", refused, isLost = true)

        assertTrue(ChipFailures.lost(refused, session))
        assertFalse(ChipFailures.lost(CardServiceException("other", 0x6982), session))
    }

    @Test
    fun `a status word anywhere in the chain is the chip's refusal, and so are JMRTD's denials`() {
        assertTrue(ChipFailures.refused(refused))
        assertTrue(ChipFailures.refused(IOException("Unexpected exception", CardServiceException("Read binary failed on file", refused))))
        assertTrue(ChipFailures.refused(AccessDeniedException("canary", 0x6982)))
        assertTrue(ChipFailures.refused(BACDeniedException("canary", BACKey("X12345678", "900101", "310101"), 0x6300)))
        assertTrue(ChipFailures.refused(PACEException("canary", 4, 0x6300)))
    }

    @Test
    fun `a failure without a status word is not a refusal`() {
        assertFalse(ChipFailures.refused(CardServiceException("Failed response")))
        assertFalse(ChipFailures.refused(CardServiceException("Security exception during mutual auth", IllegalStateException())))
        assertFalse(ChipFailures.refused(IllegalArgumentException("Unsupported key type")))
        assertFalse(ChipFailures.refused(PACEException("canary", 2)))
    }

    @Test
    fun `a failure is one constant, lost first, then the meaning of a refusal, then the other`() {
        val lost = CardServiceException("Could not tranceive APDU", IOException())

        assertEquals(ChipReadFailure.TAG_LOST, ChipFailures.of(lost, null, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT))
        assertEquals(ChipReadFailure.ACCESS_DENIED, ChipFailures.of(refused, null, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT))
        assertEquals(
            ChipReadFailure.UNSUPPORTED_DOCUMENT,
            ChipFailures.of(IllegalStateException("x"), null, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT),
        )
        // A failure this module already named keeps its name.
        assertEquals(
            ChipReadFailure.TIMEOUT,
            ChipFailures.of(ChipReadException(ChipReadFailure.TIMEOUT), null, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT),
        )
    }

    @Test
    fun `every failure is raised as the SDK's exception with its fixed message and no cause`() {
        ChipReadFailure.entries.forEach { failure ->
            val raised = assertThrows(ChipReadException::class.java) { ChipFailures.raise(failure) }

            assertEquals(failure, raised.failure)
            assertEquals("Chip read failed: ${failure.name.lowercase()}", raised.message)
            assertNull(raised.cause)
        }
    }
}
