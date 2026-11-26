package dev.openverify.demo.readercheck

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.model.FileKind
import java.security.SecureRandom

/** How one line of a reader check ended. */
enum class CheckOutcome { PASS, FAIL, NOT_ATTEMPTED }

/** One line of a reader check: a protocol or a file by its name, and how it ended. Never a value of the chip. */
data class CheckLine(val name: String, val outcome: CheckOutcome)

/**
 * What a reader check shows (C209.6, decision 48): why the read failed, if it did, as the reader's
 * constant reason; then pass or fail per protocol and per file. It holds no byte, length or text of
 * the chip.
 */
data class ReaderCheckReport(val failure: String?, val protocols: List<CheckLine>, val files: List<CheckLine>)

/**
 * The demo's reader check (C209.6; decision 48; review H09): one read of a real document with the
 * installed [ChipReader], for the owner to see that the reader works on a real phone. It calls
 * `ChipReader.read` and nothing else: no API, no flow, no file, no log. The challenge is eight random
 * bytes made here, since no server is asked for one, so the chip's signature proves nothing and is
 * discarded. What the read returned is turned into pass or fail per protocol and file, and its bytes
 * are overwritten before this returns.
 */
@OptIn(ExperimentalOpenVerifyApi::class)
object ReaderCheck {
    /** The files a document must have, and those it may have, in the order they are shown. */
    private val REQUIRED = listOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2)
    private val OPTIONAL = listOf(FileKind.CHIP_COM, FileKind.CHIP_DG14, FileKind.CHIP_DG15, FileKind.CHIP_CARD_ACCESS, FileKind.CHIP_CARD_SECURITY)

    /** Reads once with [reader] and [access], telling [phase] where the read is, as a constant word. */
    suspend fun run(reader: ChipReader, access: ChipAccess, phase: (String) -> Unit): ReaderCheckReport {
        val challenge = ByteArray(8).also { SecureRandom().nextBytes(it) }
        // The files the reader finished, from its progress: all a failed read leaves to show.
        val finished = LinkedHashSet<FileKind>()
        val started = LinkedHashSet<FileKind>()
        val read = try {
            reader.read(access, challenge) { progress ->
                when (progress) {
                    ChipProgress.WaitingForDocument -> phase("waiting")
                    ChipProgress.Connected -> phase("connected")
                    is ChipProgress.Reading -> {
                        started += progress.fileKind
                        if (progress.percent >= 100) finished += progress.fileKind
                        phase("reading")
                    }
                    ChipProgress.Authenticating -> phase("signing")
                    ChipProgress.Done -> phase("read")
                }
            }
        } catch (failed: ChipReadException) {
            val files = started.map { CheckLine(it.wireValue, if (it in finished) CheckOutcome.PASS else CheckOutcome.FAIL) }
            return ReaderCheckReport(failed.failure.name.lowercase(), emptyList(), files)
        }
        val present = read.files.keys.toSet()
        val protocols = read.deviceReport.protocols.map { attempt ->
            CheckLine(
                attempt.protocol.name.lowercase(),
                when (attempt.outcome) {
                    ChipDeviceReport.Outcome.SUCCEEDED -> CheckOutcome.PASS
                    ChipDeviceReport.Outcome.FAILED -> CheckOutcome.FAIL
                    ChipDeviceReport.Outcome.NOT_ATTEMPTED -> CheckOutcome.NOT_ATTEMPTED
                },
            )
        }
        // Dropped at once: the check keeps nothing of the document, and what it read is overwritten here.
        read.files.values.forEach { it.fill(0) }
        read.activeAuthenticationResponse?.fill(0)
        challenge.fill(0)
        return ReaderCheckReport(
            failure = null,
            protocols = protocols,
            files = REQUIRED.map { CheckLine(it.wireValue, if (it in present) CheckOutcome.PASS else CheckOutcome.FAIL) } +
                OPTIONAL.map { CheckLine(it.wireValue, if (it in present) CheckOutcome.PASS else CheckOutcome.NOT_ATTEMPTED) },
        )
    }
}
