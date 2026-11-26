package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipDeviceReport.Attempt
import dev.openverify.sdk.chip.ChipDeviceReport.Outcome
import dev.openverify.sdk.chip.ChipDeviceReport.Protocol
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.model.FileKind
import kotlin.time.TimeSource

/**
 * One read of a chip, in the order C209.2 gives (C209.3; reviews H09, F15):
 *
 * 1. connect, and read EF.CardAccess, which needs no key;
 * 2. access: PACE when EF.CardAccess offers it, with the MRZ key or the card access number; else
 *    Basic Access Control with the MRZ key. A chip that refuses PACE with the MRZ key is tried with
 *    Basic Access Control; a card access number opens nothing but PACE;
 * 3. DG14, and Chip Authentication when it offers it, so that the rest is read under its keys;
 * 4. the other files the server takes: COM, the security object, DG1, DG15 and DG2, the portrait,
 *    last because it is the longest. A file is never read past what the server takes for it;
 * 5. Active Authentication over the server's nonce when the chip has DG15.
 *
 * The device reads and the server verifies (C62): nothing here checks a signature, a hash or a
 * certificate, the response of step 5 is returned as the chip gave it, and what steps 2, 3 and 5
 * report is `device-report` metadata for operators.
 *
 * Every failure of the session beneath becomes one `ChipReadFailure` ([ChipFailures]); no library
 * exception, message or byte passes through (C213.3). The libraries' loggers are off for the whole
 * read ([LibraryLoggers]). The read blocks: its caller runs it off the main thread.
 */
internal class ChipReadOrchestrator(private val time: TimeSource = TimeSource.Monotonic) {
    /**
     * Whether files are still read in large blocks where a chip takes them. A file a chip refuses in
     * a large block is read again in small ones, and from then on this reader reads in small blocks
     * only: a chip that ends its session on such a refusal is then readable on the next tap. It says
     * nothing about any document, and is kept for the process.
     */
    @Volatile
    internal var largeBlocks: Boolean = true

    /** Reads the chip [connect] gives, with [access], signing [challenge], telling [progress]. Blocks. */
    fun read(connect: () -> ChipSession, access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
        require(challenge.size == CHALLENGE_BYTES) { "The challenge is the server's nonce: 8 bytes" }
        return LibraryLoggers.silenced {
            val started = time.markNow()
            var session: ChipSession? = null
            try {
                progress(ChipProgress.Connected)
                val opened = step(null, ChipReadFailure.TAG_LOST, ChipReadFailure.TAG_LOST) { connect().also { session = it }.also { it.open() } }
                val run = Run(opened, progress)
                val files = LinkedHashMap<FileKind, ByteArray>()
                val attempts = ArrayList<Attempt>()

                val cardAccess = run.file(ChipFile.CARD_ACCESS)
                // An EF.CardAccess that cannot be read as one is not sent on: for this read the chip has none.
                if (run.access(access, cardAccess, attempts) && cardAccess != null) files[FileKind.CHIP_CARD_ACCESS] = cardAccess

                val dg14 = run.file(ChipFile.DG14)?.also { files[FileKind.CHIP_DG14] = it }
                attempts += Attempt(Protocol.CHIP_AUTHENTICATION, run.chipAuthentication(dg14))
                for (file in AFTER_ACCESS) {
                    run.file(file)?.also { files[file.kind] = it }
                }

                val dg15 = files[FileKind.CHIP_DG15]
                val response = if (dg15 == null) null else run.activeAuthentication(dg15, dg14, challenge)
                attempts += Attempt(
                    Protocol.ACTIVE_AUTHENTICATION,
                    when {
                        dg15 == null -> Outcome.NOT_ATTEMPTED
                        response == null -> Outcome.FAILED
                        else -> Outcome.SUCCEEDED
                    },
                )
                progress(ChipProgress.Done)
                ChipRead(files, response, ChipDeviceReport(attempts, started.elapsedNow().inWholeMilliseconds))
            } finally {
                try {
                    session?.close()
                } catch (_: Exception) {
                    // Nothing to do for a chip that is already gone, and nothing of the failure to keep.
                }
            }
        }
    }

    /** One read's steps over its [session]. */
    private inner class Run(private val session: ChipSession, private val progress: (ChipProgress) -> Unit) {
        private var large: Boolean = session.largeBlocks && largeBlocks

        /**
         * Step 2: opens the chip with [access] and adds what was tried to [attempts]. It answers
         * whether [cardAccess], when there is one, could be read as an EF.CardAccess. One that cannot
         * offers no PACE (review E004): the MRZ key is then tried with Basic Access Control, as on a
         * chip without the file, and a card access number has nothing to open.
         */
        fun access(access: ChipAccess, cardAccess: ByteArray?, attempts: MutableList<Attempt>): Boolean {
            // `null`: the file could not be read as an EF.CardAccess.
            val offer: Boolean? = if (cardAccess == null) {
                false
            } else {
                try {
                    session.offersPace(cardAccess)
                } catch (error: Exception) {
                    val failure = ChipFailures.of(error, session, ChipReadFailure.UNSUPPORTED_DOCUMENT, ChipReadFailure.UNSUPPORTED_DOCUMENT)
                    if (failure == ChipReadFailure.TAG_LOST || access !is ChipAccess.Mrz) ChipFailures.raise(failure)
                    null
                }
            }
            val offered = offer == true
            var pace: Protocol? = null
            if (offered && cardAccess != null) {
                try {
                    pace = if (session.pace(access, cardAccess)) Protocol.PACE_CAM else Protocol.PACE
                } catch (error: Exception) {
                    val failure = ChipFailures.of(error, session, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT)
                    // A card access number opens nothing else; the MRZ key is tried with Basic Access Control.
                    if (failure == ChipReadFailure.TAG_LOST || access !is ChipAccess.Mrz) ChipFailures.raise(failure)
                }
            }
            attempts += Attempt(pace ?: Protocol.PACE, if (pace != null) Outcome.SUCCEEDED else if (offered) Outcome.FAILED else Outcome.NOT_ATTEMPTED)
            if (pace == null && access !is ChipAccess.Mrz) ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT)

            step(session, ChipReadFailure.UNSUPPORTED_DOCUMENT, ChipReadFailure.UNSUPPORTED_DOCUMENT) { session.selectApplication(afterPace = pace != null) }
            if (pace == null && access is ChipAccess.Mrz) {
                step(session, ChipReadFailure.ACCESS_DENIED, ChipReadFailure.UNSUPPORTED_DOCUMENT) { session.bac(access.seed) }
            }
            attempts += Attempt(Protocol.BAC, if (pace == null) Outcome.SUCCEEDED else Outcome.NOT_ATTEMPTED)
            return offer != null
        }

        /** Step 3: Chip Authentication when [dg14] offers it. A chip that fails it is read on, under the keys it had. */
        fun chipAuthentication(dg14: ByteArray?): Outcome {
            if (dg14 == null) return Outcome.NOT_ATTEMPTED
            return try {
                if (!session.offersChipAuthentication(dg14)) return Outcome.NOT_ATTEMPTED
                session.chipAuthentication(dg14)
                Outcome.SUCCEEDED
            } catch (error: Exception) {
                if (ChipFailures.lost(error, session)) ChipFailures.raise(ChipReadFailure.TAG_LOST)
                Outcome.FAILED
            }
        }

        /**
         * Step 5: the chip's response over [challenge], or `null` when it gave none the server takes.
         * It is not verified here.
         */
        fun activeAuthentication(dg15: ByteArray, dg14: ByteArray?, challenge: ByteArray): ByteArray? {
            progress(ChipProgress.Authenticating)
            return try {
                session.activeAuthentication(dg15, dg14, challenge).takeIf { it.size in 1..RESPONSE_BYTES }
            } catch (error: Exception) {
                if (ChipFailures.lost(error, session)) ChipFailures.raise(ChipReadFailure.TAG_LOST)
                null
            }
        }

        /**
         * [file] whole, or `null` when the chip has none and may have none: an optional file the chip
         * refuses to select, or one it says is empty (review E004). A missing or empty required file,
         * and any file that is longer than the server takes or not as long as it said, makes the
         * document unsupported.
         */
        fun file(file: ChipFile): ByteArray? {
            val length = select(file) ?: return null
            val first = try {
                content(file, length)
            } catch (error: Exception) {
                val failure = ChipFailures.of(error, session, ChipReadFailure.UNSUPPORTED_DOCUMENT, ChipReadFailure.UNSUPPORTED_DOCUMENT)
                if (error is ChipReadException || failure != ChipReadFailure.UNSUPPORTED_DOCUMENT || !large) ChipFailures.raise(failure)
                null
            }
            if (first != null) return first
            // The chip refused a large block: small ones from here on, for this read and the next.
            large = false
            largeBlocks = false
            return step(session, ChipReadFailure.UNSUPPORTED_DOCUMENT, ChipReadFailure.UNSUPPORTED_DOCUMENT) {
                content(file, select(file) ?: ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT))
            }
        }

        /**
         * Selects [file] and answers its length, or `null` for an optional file the chip refuses to
         * select (it has none, or keeps it from this key) or says is empty. The server's ceiling holds
         * for every file: a longer one is never read.
         */
        private fun select(file: ChipFile): Int? {
            val length = try {
                session.select(file, large)
            } catch (error: Exception) {
                val failure = ChipFailures.of(error, session, ChipReadFailure.UNSUPPORTED_DOCUMENT, ChipReadFailure.UNSUPPORTED_DOCUMENT)
                if (failure == ChipReadFailure.UNSUPPORTED_DOCUMENT && !file.required && ChipFailures.refused(error)) return null
                ChipFailures.raise(failure)
            }
            if (length > file.maximumBytes) ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT)
            if (length < 1) return if (file.required) ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT) else null
            return length
        }

        /** The selected [file], [length] bytes of it, with its progress: each percentage once. */
        private fun content(file: ChipFile, length: Int): ByteArray {
            var told = 0
            progress(ChipProgress.Reading(file.kind, 0))
            val content = session.readSelected { bytes ->
                val percent = (bytes.toLong() * 100 / length).toInt().coerceIn(0, 100)
                if (percent > told) {
                    told = percent
                    progress(ChipProgress.Reading(file.kind, percent))
                }
            }
            if (content.size != length) ChipFailures.raise(ChipReadFailure.UNSUPPORTED_DOCUMENT)
            return content
        }
    }

    /** Runs [block], ending the read as [whenRefused] or [otherwise] when it fails ([ChipFailures.of]). */
    private inline fun <T> step(session: ChipSession?, whenRefused: ChipReadFailure, otherwise: ChipReadFailure, block: () -> T): T =
        try {
            block()
        } catch (error: Exception) {
            ChipFailures.raise(ChipFailures.of(error, session, whenRefused, otherwise))
        }

    private companion object {
        /** C62.5: the server's nonce. */
        const val CHALLENGE_BYTES = 8

        /** C207.1: the server takes a response of at most 1 KiB in base64, which is 768 bytes. */
        const val RESPONSE_BYTES = 768

        /** Step 4's order. */
        val AFTER_ACCESS = listOf(ChipFile.COM, ChipFile.SOD, ChipFile.DG1, ChipFile.DG15, ChipFile.DG2)
    }
}
