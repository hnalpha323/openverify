package dev.openverify.nfc

import dev.openverify.nfc.ScriptedChipSession.Companion.BAC_FILES
import dev.openverify.nfc.ScriptedChipSession.Companion.PACE_FILES
import dev.openverify.nfc.ScriptedChipSession.Companion.content
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport.Outcome
import dev.openverify.sdk.chip.ChipDeviceReport.Protocol
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed
import net.sf.scuba.smartcards.CardServiceException
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import kotlin.time.TestTimeSource

/**
 * C209.3 (reviews H09, F15): the reader's protocol order, fallbacks, progress and error mapping, on
 * the host, over a scripted chip. Everything here is synthetic: the specimen MRZ fields of the Utopia
 * test chip and made-up file contents.
 */
class ChipReadOrchestratorTest {

    private val mrz = ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101"))
    private val can = ChipAccess.Can("123456")
    private val challenge = byteArrayOf(0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77)
    private val progress = mutableListOf<ChipProgress>()

    private fun read(session: ScriptedChipSession, access: ChipAccess = mrz, orchestrator: ChipReadOrchestrator = ChipReadOrchestrator()): ChipRead =
        orchestrator.read({ session }, access, challenge, progress::add)

    private fun failure(session: ScriptedChipSession, access: ChipAccess = mrz): ChipReadException =
        assertThrows(ChipReadException::class.java) { read(session, access) }

    private fun ChipRead.protocols(): Map<Protocol, Outcome> = deviceReport.protocols.associate { it.protocol to it.outcome }

    private fun refusal(statusWord: Int = 0x6982) = CardServiceException("Access to file denied, canary X12345678", statusWord)

    private fun lostChip() = CardServiceException("Could not tranceive APDU", IOException("Transceive failed, canary X12345678"))

    // The order.

    @Test
    fun `a chip without EF CardAccess is opened with Basic Access Control, then read file by file, then asked to sign`() {
        val session = ScriptedChipSession(BAC_FILES)

        val result = read(session)

        assertEquals(
            listOf(
                "open",
                "select CARD_ACCESS small",
                "selectApplication plain",
                "bac",
                "select DG14 small", "read DG14", "offersChipAuthentication",
                "select COM small", "read COM",
                "select SOD small", "read SOD",
                "select DG1 small", "read DG1",
                "select DG15 small", "read DG15",
                "select DG2 small", "read DG2",
                "activeAuthentication 0011223344556677",
                "close",
            ),
            session.calls,
        )
        assertEquals(
            setOf(FileKind.CHIP_COM, FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_DG14, FileKind.CHIP_DG15),
            result.files.keys,
        )
        BAC_FILES.forEach { (file, bytes) -> assertArrayEquals(bytes, result.files.getValue(file.kind), file.name) }
        assertArrayEquals(ByteArray(64) { 0x5a }, result.activeAuthenticationResponse)
        assertEquals(
            listOf(
                Protocol.PACE to Outcome.NOT_ATTEMPTED,
                Protocol.BAC to Outcome.SUCCEEDED,
                Protocol.CHIP_AUTHENTICATION to Outcome.NOT_ATTEMPTED,
                Protocol.ACTIVE_AUTHENTICATION to Outcome.SUCCEEDED,
            ),
            result.deviceReport.protocols.map { it.protocol to it.outcome },
        )
    }

    @Test
    fun `a chip whose EF CardAccess offers PACE is opened with PACE and the MRZ key, and Basic Access Control is not tried`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false)

        val result = read(session)

        assertEquals(
            listOf("open", "select CARD_ACCESS small", "read CARD_ACCESS", "offersPace", "pace mrz", "selectApplication secured", "select DG14 small"),
            session.calls.take(7),
        )
        assertFalse("bac" in session.calls)
        assertArrayEquals(PACE_FILES.getValue(ChipFile.CARD_ACCESS), result.files[FileKind.CHIP_CARD_ACCESS])
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.PACE])
        assertEquals(Outcome.NOT_ATTEMPTED, result.protocols()[Protocol.BAC])
    }

    @Test
    fun `PACE runs with the card access number when that is the key`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false)

        val result = read(session, can)

        assertTrue("pace can" in session.calls)
        assertFalse("bac" in session.calls)
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.PACE])
    }

    @Test
    fun `PACE with the chip authentication mapping is reported as PACE-CAM`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = true)

        val result = read(session)

        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.PACE_CAM])
        assertNull(result.protocols()[Protocol.PACE])
    }

    @Test
    fun `an EF CardAccess that offers no PACE leaves Basic Access Control, and the file is still returned`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = null)

        val result = read(session)

        assertEquals(listOf("offersPace", "selectApplication plain", "bac"), session.calls.subList(3, 6))
        assertTrue(FileKind.CHIP_CARD_ACCESS in result.files)
        assertEquals(Outcome.NOT_ATTEMPTED, result.protocols()[Protocol.PACE])
    }

    // The fallbacks.

    @Test
    fun `when the chip refuses PACE with the MRZ key, Basic Access Control is tried with the same key`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false).fail("pace mrz", refusal(0x6300))

        val result = read(session)

        assertEquals(listOf("pace mrz", "selectApplication plain", "bac"), session.calls.subList(4, 7))
        assertEquals(Outcome.FAILED, result.protocols()[Protocol.PACE])
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.BAC])
    }

    @Test
    fun `when the chip refuses PACE with the card access number, the key is denied and nothing else is tried`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false).fail("pace can", refusal(0x6300))

        val failed = failure(session, can)

        assertEquals(ChipReadFailure.ACCESS_DENIED, failed.failure)
        assertEquals(listOf("open", "select CARD_ACCESS small", "read CARD_ACCESS", "offersPace", "pace can", "close"), session.calls)
    }

    @Test
    fun `PACE with the card access number that fails without the chip's refusal is an unsupported document`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false)
            .fail("pace can", IllegalStateException("Unsupported agreement, canary X12345678"))

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session, can).failure)
    }

    @Test
    fun `a card access number cannot open a chip that offers no PACE`() {
        val session = ScriptedChipSession(BAC_FILES)

        val failed = failure(session, can)

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failed.failure)
        assertEquals(listOf("open", "select CARD_ACCESS small", "close"), session.calls)
    }

    @Test
    fun `a file the chip refuses in large blocks is read again in small ones, and so is every file after it`() {
        val session = ScriptedChipSession(BAC_FILES, largeBlocks = true).fail("read SOD", refusal(0x6700))
        val orchestrator = ChipReadOrchestrator()

        val result = read(session, orchestrator = orchestrator)

        assertEquals(
            listOf("select COM large", "read COM", "select SOD large", "read SOD", "select SOD small", "read SOD", "select DG1 small", "read DG1"),
            session.calls.subList(session.calls.indexOf("select COM large"), session.calls.indexOf("select DG15 small")),
        )
        assertArrayEquals(BAC_FILES.getValue(ChipFile.SOD), result.files[FileKind.CHIP_SOD])
        assertFalse(orchestrator.largeBlocks)

        // The next read with this reader starts in small blocks: a chip that drops the session on a
        // large read is readable on the next tap.
        val next = ScriptedChipSession(BAC_FILES, largeBlocks = true)
        read(next, orchestrator = orchestrator)
        assertTrue(next.calls.none { it.endsWith(" large") })
    }

    @Test
    fun `a chip that takes large blocks is read in them from the first file`() {
        val session = ScriptedChipSession(BAC_FILES, largeBlocks = true)
        val orchestrator = ChipReadOrchestrator()

        read(session, orchestrator = orchestrator)

        assertEquals("select CARD_ACCESS large", session.calls[1])
        assertTrue(session.calls.none { it.endsWith(" small") })
        assertTrue(orchestrator.largeBlocks)
    }

    @Test
    fun `a file refused in small blocks is not read twice`() {
        val session = ScriptedChipSession(BAC_FILES).fail("read SOD", refusal(0x6700))

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session).failure)
        assertEquals(1, session.calls.count { it == "read SOD" })
    }

    // The files.

    @Test
    fun `only the kinds the server takes can be read, and never DG11 or DG12`() {
        assertEquals(
            setOf(
                FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_DG14, FileKind.CHIP_DG15, FileKind.CHIP_COM,
                FileKind.CHIP_CARD_ACCESS,
            ),
            ChipFile.entries.map { it.kind }.toSet(),
        )
        assertEquals(listOf(0x011C, 0x011E, 0x011D, 0x0101, 0x0102, 0x010E, 0x010F), ChipFile.entries.map { it.identifier })
        assertFalse(ChipFile.entries.any { it.identifier == 0x010B || it.identifier == 0x010C })
        assertEquals(setOf(ChipFile.SOD, ChipFile.DG1, ChipFile.DG2), ChipFile.entries.filter { it.required }.toSet())
    }

    @Test
    fun `the portrait may be 1 MiB and every other file 64 KiB`() {
        assertEquals(1_048_576, ChipFile.DG2.maximumBytes)
        assertEquals(setOf(65_536), (ChipFile.entries - ChipFile.DG2).map { it.maximumBytes }.toSet())
    }

    @Test
    fun `a file longer than the server takes is not read, and the document is unsupported`() {
        listOf(ChipFile.DG2 to 1_048_577, ChipFile.DG1 to 65_537, ChipFile.DG14 to 65_537).forEach { (file, length) ->
            val session = ScriptedChipSession(BAC_FILES).declare(file, length)

            assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session).failure, file.name)
            assertFalse("read ${file.name}" in session.calls, file.name)
        }
    }

    @Test
    fun `a file exactly as long as the server takes is read`() {
        val portrait = content(ChipFile.DG2, 1_048_576)
        val session = ScriptedChipSession(BAC_FILES + (ChipFile.DG2 to portrait), chunk = 65_536)

        val result = read(session)

        assertEquals(1_048_576, result.files.getValue(FileKind.CHIP_DG2).size)
    }

    @Test
    fun `a file that is empty, or not as long as it said, makes the document unsupported`() {
        val empty = ScriptedChipSession(BAC_FILES).declare(ChipFile.DG1, 0)
        val short = ScriptedChipSession(BAC_FILES).declare(ChipFile.DG1, 94)

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(empty).failure)
        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(short).failure)
    }

    // Review E004 (Workflow 10E): an optional file that is there but unusable is read as absent.

    @Test
    fun `an optional file that is empty is read as absent, and the chip is still read with Basic Access Control`() {
        listOf(ChipFile.CARD_ACCESS, ChipFile.COM, ChipFile.DG14, ChipFile.DG15).forEach { file ->
            val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = null).declare(file, 0)

            val result = read(session)

            assertFalse(file.kind in result.files, file.name)
            assertFalse("read ${file.name}" in session.calls, file.name)
            assertTrue(FileKind.CHIP_DG2 in result.files, file.name)
            assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.BAC], file.name)
        }
    }

    @Test
    fun `an optional file longer than the server takes still makes the document unsupported`() {
        listOf(ChipFile.CARD_ACCESS, ChipFile.COM, ChipFile.DG14, ChipFile.DG15).forEach { file ->
            val session = ScriptedChipSession(PACE_FILES).declare(file, file.maximumBytes + 1)

            assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session).failure, file.name)
        }
    }

    @Test
    fun `an EF CardAccess that cannot be parsed offers no PACE to the MRZ key, which is tried with Basic Access Control, and the file is not returned`() {
        val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false)
            .fail("offersPace", IllegalArgumentException("Could not parse, canary X12345678"))

        val result = read(session)

        assertEquals(listOf("offersPace", "selectApplication plain", "bac"), session.calls.subList(3, 6))
        assertFalse(session.calls.any { it.startsWith("pace") })
        assertFalse(FileKind.CHIP_CARD_ACCESS in result.files)
        assertEquals(Outcome.NOT_ATTEMPTED, result.protocols()[Protocol.PACE])
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.BAC])
        assertTrue(FileKind.CHIP_DG2 in result.files)
    }

    @Test
    fun `an EF CardAccess that cannot be parsed leaves a card access number nothing to open, and a lost chip is still tag lost`() {
        val unparsable = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false)
            .fail("offersPace", IllegalArgumentException("Could not parse, canary X12345678"))
        val lost = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false).fail("offersPace", lostChip())

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(unparsable, can).failure)
        assertFalse("bac" in unparsable.calls)
        assertEquals(ChipReadFailure.TAG_LOST, failure(lost).failure)
    }

    @Test
    fun `a chip without the optional files is read without them, and is not asked to sign`() {
        val session = ScriptedChipSession(BAC_FILES - ChipFile.COM - ChipFile.DG14 - ChipFile.DG15)

        val result = read(session)

        assertEquals(setOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2), result.files.keys)
        assertNull(result.activeAuthenticationResponse)
        assertEquals(Outcome.NOT_ATTEMPTED, result.protocols()[Protocol.ACTIVE_AUTHENTICATION])
        assertFalse(session.calls.any { it.startsWith("activeAuthentication") || it == "offersChipAuthentication" })
        assertFalse(ChipProgress.Authenticating in progress)
    }

    @Test
    fun `a chip without a required file is an unsupported document`() {
        listOf(ChipFile.SOD, ChipFile.DG1, ChipFile.DG2).forEach { file ->
            assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(ScriptedChipSession(BAC_FILES - file)).failure, file.name)
        }
    }

    // Chip Authentication and Active Authentication.

    @Test
    fun `Chip Authentication runs when DG14 offers it, right after DG14, and is reported`() {
        val session = ScriptedChipSession(BAC_FILES, chipAuthentication = true)

        val result = read(session)

        assertEquals(
            listOf("select DG14 small", "read DG14", "offersChipAuthentication", "chipAuthentication", "select COM small"),
            session.calls.subList(4, 9),
        )
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.CHIP_AUTHENTICATION])
    }

    @Test
    fun `a failed Chip Authentication is reported and the read goes on`() {
        val session = ScriptedChipSession(BAC_FILES, chipAuthentication = true).fail("chipAuthentication", refusal(0x6A80))

        val result = read(session)

        assertEquals(Outcome.FAILED, result.protocols()[Protocol.CHIP_AUTHENTICATION])
        assertTrue(FileKind.CHIP_DG2 in result.files)
    }

    @Test
    fun `the chip signs the server's nonce after access and the files, and the response is returned as the chip gave it`() {
        val response = ByteArray(256) { it.toByte() }
        val session = ScriptedChipSession(BAC_FILES, activeAuthenticationResponse = response)

        val result = read(session)

        assertEquals("activeAuthentication 0011223344556677", session.calls[session.calls.size - 2])
        assertArrayEquals(response, result.activeAuthenticationResponse)
    }

    @Test
    fun `an elliptic-curve key without DG14 is still asked to sign`() {
        val session = ScriptedChipSession(BAC_FILES - ChipFile.DG14)

        val result = read(session)

        assertTrue("activeAuthentication 0011223344556677 without dg14" in session.calls)
        assertEquals(Outcome.SUCCEEDED, result.protocols()[Protocol.ACTIVE_AUTHENTICATION])
    }

    @Test
    fun `a chip that refuses to sign gives no response, reported as failed, and the files are returned`() {
        val session = ScriptedChipSession(BAC_FILES).fail("activeAuthentication 0011223344556677", refusal(0x6982))

        val result = read(session)

        assertNull(result.activeAuthenticationResponse)
        assertEquals(Outcome.FAILED, result.protocols()[Protocol.ACTIVE_AUTHENTICATION])
        assertEquals(6, result.files.size)
        assertEquals(ChipProgress.Done, progress.last())
    }

    @Test
    fun `a response longer than the server takes, or an empty one, is not returned`() {
        listOf(769, 0).forEach { size ->
            val result = read(ScriptedChipSession(BAC_FILES, activeAuthenticationResponse = ByteArray(size)))

            assertNull(result.activeAuthenticationResponse, "$size bytes")
            assertEquals(Outcome.FAILED, result.protocols()[Protocol.ACTIVE_AUTHENTICATION], "$size bytes")
        }
        assertEquals(768, read(ScriptedChipSession(BAC_FILES, activeAuthenticationResponse = ByteArray(768))).activeAuthenticationResponse?.size)
    }

    @Test
    fun `a challenge that is not 8 bytes is refused before the chip is touched, with a fixed message`() {
        var connected = false

        val refused = assertThrows(IllegalArgumentException::class.java) {
            ChipReadOrchestrator().read({ connected = true; ScriptedChipSession(BAC_FILES) }, mrz, ByteArray(16), progress::add)
        }

        assertEquals("The challenge is the server's nonce: 8 bytes", refused.message)
        assertFalse(connected)
        assertEquals(emptyList<ChipProgress>(), progress)
    }

    // Progress.

    @Test
    fun `progress is told per phase and per file, each file from 0 to 100`() {
        read(ScriptedChipSession(BAC_FILES - ChipFile.COM - ChipFile.DG14, chunk = 40))

        assertEquals(
            listOf(
                ChipProgress.Connected,
                ChipProgress.Reading(FileKind.CHIP_SOD, 0), ChipProgress.Reading(FileKind.CHIP_SOD, 33), ChipProgress.Reading(FileKind.CHIP_SOD, 66),
                ChipProgress.Reading(FileKind.CHIP_SOD, 100),
                ChipProgress.Reading(FileKind.CHIP_DG1, 0), ChipProgress.Reading(FileKind.CHIP_DG1, 43), ChipProgress.Reading(FileKind.CHIP_DG1, 86),
                ChipProgress.Reading(FileKind.CHIP_DG1, 100),
                ChipProgress.Reading(FileKind.CHIP_DG15, 0), ChipProgress.Reading(FileKind.CHIP_DG15, 43), ChipProgress.Reading(FileKind.CHIP_DG15, 86),
                ChipProgress.Reading(FileKind.CHIP_DG15, 100),
                ChipProgress.Reading(FileKind.CHIP_DG2, 0), ChipProgress.Reading(FileKind.CHIP_DG2, 20), ChipProgress.Reading(FileKind.CHIP_DG2, 40),
                ChipProgress.Reading(FileKind.CHIP_DG2, 60), ChipProgress.Reading(FileKind.CHIP_DG2, 80), ChipProgress.Reading(FileKind.CHIP_DG2, 100),
                ChipProgress.Authenticating,
                ChipProgress.Done,
            ),
            progress,
        )
    }

    @Test
    fun `a percentage is told once, however many blocks it takes`() {
        read(ScriptedChipSession(BAC_FILES + (ChipFile.DG2 to content(ChipFile.DG2, 5_000)), chunk = 7))

        val portrait = progress.filterIsInstance<ChipProgress.Reading>().filter { it.fileKind == FileKind.CHIP_DG2 }.map { it.percent }
        assertEquals((0..100).toList(), portrait)
    }

    @Test
    fun `the report says how long the read took, by the injected time source`() {
        val clock = TestTimeSource()
        val session = ScriptedChipSession(BAC_FILES, clock = clock)

        val result = ChipReadOrchestrator(clock).read({ session }, mrz, challenge, progress::add)

        // Every call of the scripted chip takes 10 ms; the closing call is after the report.
        assertEquals((session.calls.size - 1) * 10L, result.deviceReport.readMillis)
    }

    // Errors.

    @Test
    fun `a chip that refuses the key is access denied, with the fixed message and nothing of the library's`() {
        val session = ScriptedChipSession(BAC_FILES).fail("bac", refusal(0x6300))

        val failed = failure(session)

        assertEquals(ChipReadFailure.ACCESS_DENIED, failed.failure)
        assertEquals("Chip read failed: access_denied", failed.message)
        assertNull(failed.cause)
        assertEquals(0, failed.suppressed.size)
        assertEquals("close", session.calls.last())
        assertFalse(ChipProgress.Done in progress)
    }

    @Test
    fun `Basic Access Control that fails without the chip's refusal is an unsupported document`() {
        val session = ScriptedChipSession(BAC_FILES).fail("bac", IllegalStateException("Cryptogram wrong length 31, canary X12345678"))

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session).failure)
    }

    @Test
    fun `a chip that leaves the field is tag lost, at every step`() {
        val steps = listOf(
            "open", "select CARD_ACCESS small", "selectApplication plain", "bac", "select DG14 small", "read DG14", "offersChipAuthentication",
            "chipAuthentication", "select SOD small", "read SOD", "read DG2", "activeAuthentication 0011223344556677",
        )
        steps.forEach { step ->
            val session = ScriptedChipSession(BAC_FILES, chipAuthentication = true).fail(step, lostChip())

            val failed = failure(session)

            assertEquals(ChipReadFailure.TAG_LOST, failed.failure, step)
            assertNull(failed.cause, step)
            assertEquals("close", session.calls.last(), step)
        }
        listOf("read CARD_ACCESS", "offersPace", "pace mrz", "selectApplication secured").forEach { step ->
            val session = ScriptedChipSession(PACE_FILES, paceWithChipAuthenticationMapping = false).fail(step, lostChip())

            assertEquals(ChipReadFailure.TAG_LOST, failure(session).failure, step)
        }
    }

    @Test
    fun `what the session calls a lost connection is tag lost, whatever the exception`() {
        val session = ScriptedChipSession(BAC_FILES).fail("read DG1", refusal(0x6F00), isLost = true)

        assertEquals(ChipReadFailure.TAG_LOST, failure(session).failure)
    }

    @Test
    fun `a chip that cannot be connected to is tag lost`() {
        val failed = assertThrows(ChipReadException::class.java) {
            ChipReadOrchestrator().read({ throw IllegalStateException("No ISO-DEP, canary X12345678") }, mrz, challenge, progress::add)
        }

        assertEquals(ChipReadFailure.TAG_LOST, failed.failure)
        assertNull(failed.cause)
    }

    @Test
    fun `anything else a library throws while reading is an unsupported document, and the session is closed`() {
        listOf<Exception>(
            NumberFormatException("Unknown FID 11c, canary X12345678"),
            IllegalStateException("Could not read bytes, canary X12345678"),
            refusal(0x6982),
            IOException("Unexpected exception", refusal(0x6988)),
        ).forEach { error ->
            val session = ScriptedChipSession(BAC_FILES).fail("read DG1", error)

            val failed = failure(session)

            assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failed.failure, error.toString())
            assertEquals("Chip read failed: unsupported_document", failed.message)
            assertNull(failed.cause)
            assertEquals("close", session.calls.last())
        }
    }

    @Test
    fun `selecting the application is refused by something that is no travel document`() {
        val session = ScriptedChipSession(BAC_FILES).fail("selectApplication plain", refusal(0x6A82))

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failure(session).failure)
    }

    @Test
    fun `a failure of the closing call changes nothing`() {
        val session = ScriptedChipSession(BAC_FILES).fail("close", IllegalStateException("canary X12345678"))

        assertEquals(6, read(session).files.size)

        val failing = ScriptedChipSession(BAC_FILES).fail("bac", refusal()).fail("close", IllegalStateException("canary X12345678"))
        assertEquals(ChipReadFailure.ACCESS_DENIED, failure(failing).failure)
    }
}
