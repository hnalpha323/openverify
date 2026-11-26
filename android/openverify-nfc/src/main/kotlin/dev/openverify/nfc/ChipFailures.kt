package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import net.sf.scuba.smartcards.CardServiceException
import org.jmrtd.AccessDeniedException
import org.jmrtd.BACDeniedException
import java.io.IOException

/**
 * The reader's error mapping (C209.3, C213.3): what a failure beneath a [ChipSession] means, and the
 * one place a `ChipReadException` is made. Nothing of the failure itself is carried on: not its
 * message, its status word or its cause, only one constant of the closed `ChipReadFailure`.
 */
internal object ChipFailures {
    /**
     * Whether [error] means that the chip left the field or stopped answering: the session says so,
     * Android's exception for a lost tag is somewhere in the chain (told by its name, as SCUBA tells
     * it, so that this file needs no Android class), the thread was interrupted, or the chain ends in
     * an I/O failure. A stream wraps a chip's refusal in an `IOException` too, which is why only the
     * end of the chain counts.
     */
    fun lost(error: Throwable, session: ChipSession?): Boolean {
        if (error is Exception && session != null && session.connectionLost(error)) return true
        val chain = chain(error)
        return chain.any { it is InterruptedException || it.javaClass.name.endsWith("TagLostException") } || chain.last() is IOException
    }

    /** Whether the chip answered [error]'s command with a refusal: a status word other than success, or JMRTD's word for a denied key. */
    fun refused(error: Throwable): Boolean = chain(error).any { cause ->
        cause is AccessDeniedException || cause is BACDeniedException || (cause is CardServiceException && cause.sw != CardServiceException.SW_NONE)
    }

    /**
     * What [error] is to a caller: a failure this module already named keeps its name; a lost chip is
     * `TAG_LOST`; a chip's refusal is [whenRefused]; anything else is [otherwise].
     */
    fun of(error: Throwable, session: ChipSession?, whenRefused: ChipReadFailure, otherwise: ChipReadFailure): ChipReadFailure = when {
        error is ChipReadException -> error.failure
        lost(error, session) -> ChipReadFailure.TAG_LOST
        refused(error) -> whenRefused
        else -> otherwise
    }

    /** Ends the read as [failure]: the SDK's exception with its fixed message, made here and never given a cause. */
    fun raise(failure: ChipReadFailure): Nothing = when (failure) {
        ChipReadFailure.TAG_LOST -> throw ChipReadException(ChipReadFailure.TAG_LOST)
        ChipReadFailure.ACCESS_DENIED -> throw ChipReadException(ChipReadFailure.ACCESS_DENIED)
        ChipReadFailure.UNSUPPORTED_DOCUMENT -> throw ChipReadException(ChipReadFailure.UNSUPPORTED_DOCUMENT)
        ChipReadFailure.TIMEOUT -> throw ChipReadException(ChipReadFailure.TIMEOUT)
        ChipReadFailure.NFC_DISABLED -> throw ChipReadException(ChipReadFailure.NFC_DISABLED)
        ChipReadFailure.READER_BUSY -> throw ChipReadException(ChipReadFailure.READER_BUSY)
    }

    /** [error] and its causes, outermost first; a chain that loops is cut. */
    private fun chain(error: Throwable): List<Throwable> = generateSequence(error) { it.cause }.take(MAX_CAUSES).toList()

    private const val MAX_CAUSES = 16
}
