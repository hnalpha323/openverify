package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport.Outcome
import dev.openverify.sdk.chip.ChipDeviceReport.Protocol
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import net.sf.scuba.smartcards.CommandAPDU
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.security.KeyFactory
import java.security.Security
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * C209.3: the real JMRTD service (`PassportService`), driven through the adapter and the
 * orchestrator on the JVM, against an in-process chip that answers the commands of the synthetic
 * Utopia chip (`contracts/fixtures/emrtd/utopia-chip.json`): Basic Access Control with its secure
 * messaging, file selection and reads, and INTERNAL AUTHENTICATE over a nonce.
 *
 * What this does not run: PACE and Chip Authentication (the responder implements neither, and the
 * fixture's DG14 holds no Chip Authentication key), and anything of a phone's NFC. A real document
 * is read only by the owner (decision 48).
 */
class JmrtdChipSessionTest {

    private val chip = UtopiaChip.load()
    private val mrz = ChipAccess.Mrz(BacKeySeed(chip.documentNumber, chip.dateOfBirth, chip.dateOfExpiry))
    private val nonce = ChipCrypto.hex("0011223344556677")
    private val progress = mutableListOf<ChipProgress>()

    private fun read(responder: UtopiaChipResponder, access: ChipAccess = mrz, challenge: ByteArray = nonce, largeBlocks: Boolean = false): ChipRead =
        ChipReadOrchestrator().read({ JmrtdChipSession(responder, largeBlocks) }, access, challenge, progress::add)

    private fun ChipRead.protocols(): Map<Protocol, Outcome> = deviceReport.protocols.associate { it.protocol to it.outcome }

    // The chip side's arithmetic, against the standard's worked example (ICAO Doc 9303 Part 11, Appendix D).

    @Test
    fun `the responder derives the access keys of the standard's worked example`() {
        val seed = ChipCrypto.keySeed("L898902C<369080619406236")

        assertEquals("239ab9cb282daf66231dc5a4df6bfbae", ChipCrypto.hex(seed))
        assertEquals("ab94fdecf2674fdfb9b391f85d7f76f2", ChipCrypto.hex(ChipCrypto.deriveKey(seed, 1)))
        assertEquals("7962d9ece03d1acd4c76089dce131543", ChipCrypto.hex(ChipCrypto.deriveKey(seed, 2)))
    }

    @Test
    fun `the responder's cipher and checksum give the worked example's cryptogram, checksum and session keys`() {
        val kEnc = ChipCrypto.hex("ab94fdecf2674fdfb9b391f85d7f76f2")
        val kMac = ChipCrypto.hex("7962d9ece03d1acd4c76089dce131543")
        val s = ChipCrypto.hex("781723860c06c2264608f919887022120b795240cb7049b01c19b33e32804f0b")

        val cryptogram = ChipCrypto.encrypt(kEnc, s)

        assertEquals("72c29c2371cc9bdb65b779b8e8d37b29ecc154aa56a8799fae2f498f76ed92f2", ChipCrypto.hex(cryptogram))
        assertEquals("5f1448eea8ad90a7", ChipCrypto.hex(ChipCrypto.mac(kMac, ChipCrypto.pad(cryptogram))))
        assertArrayEquals(s, ChipCrypto.decrypt(kEnc, cryptogram))
        val sessionSeed = ChipCrypto.hex("0036d272f5c350acac50c3f572d23600")
        assertEquals("979ec13b1cbfe9dcd01ab0fed307eae5", ChipCrypto.hex(ChipCrypto.deriveKey(sessionSeed, 1)))
        assertEquals("f1cb1f1fb5adf208806b89dc579dc1f8", ChipCrypto.hex(ChipCrypto.deriveKey(sessionSeed, 2)))
    }

    @Test
    fun `the fixture's access keys are what its MRZ fields derive`() {
        val seed = ChipCrypto.keySeed(mrz.seed.mrzInformation)

        assertEquals(chip.mrzInformation, mrz.seed.mrzInformation)
        assertArrayEquals(chip.kEnc, ChipCrypto.deriveKey(seed, 1))
        assertArrayEquals(chip.kMac, ChipCrypto.deriveKey(seed, 2))
    }

    @Test
    fun `JMRTD opens a chip keyed with the worked example's document, so its key derivation is the standard's`() {
        val example = Json.parseToJsonElement(
            """{"mrz":{"document-number":"L898902C<","date-of-birth":"690806","date-of-expiry":"940623","information":"L898902C<369080619406236"},
               "bac":{"k-enc":"ab94fdecf2674fdfb9b391f85d7f76f2","k-mac":"7962d9ece03d1acd4c76089dce131543"},
               "files":[],"active-authentication":{"responses":[]}}""",
        ).jsonObject
        val responder = UtopiaChipResponder(UtopiaChip(example))
        val session = JmrtdChipSession(responder, largeBlocks = false)

        LibraryLoggers.silenced {
            session.open()
            session.selectApplication(afterPace = false)
            session.bac(BacKeySeed("L898902C<", "690806", "940623"))
            // The session keys agree too: a protected command is answered with "no such file", not "wrong checksum".
            assertThrows(Exception::class.java) { session.select(ChipFile.DG1, largeBlocks = false) }
        }

        assertEquals(listOf("A4 040C a0000002471001", "84 0000", "82 0000", "*A4 020C 0101"), responder.commands)
    }

    @Test
    fun `the responder refuses a protected command whose checksum is wrong, or that comes before access`() {
        val forged = CommandAPDU(0x0c, 0xa4, 0x02, 0x0c, ChipCrypto.hex("8709016375432908c044f6" + "8e08bf8b92d635ff24f8"), 256)
        val before = UtopiaChipResponder(chip)
        val after = UtopiaChipResponder(chip)
        val session = JmrtdChipSession(after, largeBlocks = false)
        LibraryLoggers.silenced {
            session.open()
            session.selectApplication(afterPace = false)
            session.bac(mrz.seed)
        }

        assertEquals(0x6988, before.transmit(forged).sw)
        assertEquals(0x6988, after.transmit(forged).sw)
        assertEquals("*A4 020C with a wrong checksum", after.commands.last())
        // The session is over: the reader's next protected command is refused too.
        assertThrows(Exception::class.java) { LibraryLoggers.silenced { session.select(ChipFile.DG1, largeBlocks = false) } }
    }

    // The read.

    @Test
    fun `the chip is opened with Basic Access Control and its six files are read whole, under secure messaging`() {
        val responder = UtopiaChipResponder(chip)

        val result = read(responder)

        assertEquals(
            setOf(FileKind.CHIP_COM, FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_DG14, FileKind.CHIP_DG15),
            result.files.keys,
        )
        ChipFile.entries.filter { it.kind in result.files }.forEach { file ->
            assertArrayEquals(chip.files.getValue(file.identifier), result.files.getValue(file.kind), file.name)
        }
        // EF.CardAccess is asked for in the clear and is absent; then the application, the challenge and the mutual authentication.
        assertEquals(listOf("A4 020C 011c", "A4 040C a0000002471001", "84 0000", "82 0000"), responder.commands.take(4))
        // Everything after access is protected, and every answer was accepted by JMRTD.
        assertTrue(responder.commands.drop(4).all { it.startsWith("*") })
        assertEquals(
            listOf("*A4 020C 010e", "*A4 020C 011e", "*A4 020C 011d", "*A4 020C 0101", "*A4 020C 010f", "*A4 020C 0102"),
            responder.commands.filter { it.startsWith("*A4") },
        )
        assertFalse(responder.commands.any { "wrong checksum" in it || "without a session" in it })
        assertEquals(ChipProgress.Done, progress.last())
    }

    @Test
    fun `no file but the six is selected, and neither DG11 nor DG12`() {
        val responder = UtopiaChipResponder(chip)

        read(responder)

        val selected = responder.commands.filter { "A4 020C" in it }.map { it.substringAfterLast(' ') }.toSet()
        assertEquals(setOf("011c", "010e", "011e", "011d", "0101", "010f", "0102"), selected)
        assertFalse("010b" in selected || "010c" in selected)
    }

    @Test
    fun `the chip signs the given nonce and its response is returned as it gave it`() {
        val responder = UtopiaChipResponder(chip)

        val result = read(responder)

        assertEquals("*88 0000 0011223344556677", responder.commands.last())
        assertArrayEquals(chip.responses.getValue("0011223344556677"), result.activeAuthenticationResponse)
        // The reader does not verify it (C62: the server does). The test may: the key is the one in DG15.
        val dg15 = result.files.getValue(FileKind.CHIP_DG15)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(dg15.copyOfRange(2, dg15.size)))
        val verifier = Signature.getInstance("SHA256withECDSAinP1363Format").apply {
            initVerify(key)
            update(nonce)
        }
        assertTrue(verifier.verify(result.activeAuthenticationResponse))
    }

    @Test
    fun `the report names Basic Access Control and Active Authentication, and no PACE or Chip Authentication`() {
        val result = read(UtopiaChipResponder(chip))

        assertEquals(
            mapOf(
                Protocol.PACE to Outcome.NOT_ATTEMPTED,
                Protocol.BAC to Outcome.SUCCEEDED,
                Protocol.CHIP_AUTHENTICATION to Outcome.NOT_ATTEMPTED,
                Protocol.ACTIVE_AUTHENTICATION to Outcome.SUCCEEDED,
            ),
            result.protocols(),
        )
    }

    @Test
    fun `a nonce the chip cannot sign gives no response, and the files are still returned`() {
        val result = read(UtopiaChipResponder(chip), challenge = ChipCrypto.hex("1111111111111111"))

        assertNull(result.activeAuthenticationResponse)
        assertEquals(Outcome.FAILED, result.protocols()[Protocol.ACTIVE_AUTHENTICATION])
        assertEquals(6, result.files.size)
    }

    @Test
    fun `a chip that takes long reads is read in large blocks, to the same bytes`() {
        val responder = UtopiaChipResponder(chip, extendedLength = true)

        val result = read(responder, largeBlocks = true)

        assertArrayEquals(chip.files.getValue(0x0102), result.files.getValue(FileKind.CHIP_DG2))
        assertArrayEquals(chip.files.getValue(0x011d), result.files.getValue(FileKind.CHIP_SOD))
        // DG2 is 3,095 bytes: in blocks of 224 it would take 14 reads after the first eight bytes.
        val portraitReads = responder.commands.dropWhile { it != "*A4 020C 0102" }.drop(1).takeWhile { it.startsWith("*B0") }
        assertTrue(portraitReads.size in 2..6, "$portraitReads")
    }

    @Test
    fun `a chip that refuses long reads is still read whole`() {
        val responder = UtopiaChipResponder(chip, extendedLength = false)

        val result = read(responder, largeBlocks = true)

        assertTrue(responder.commands.any { it.endsWith("too long") })
        ChipFile.entries.filter { it.kind in result.files }.forEach { file ->
            assertArrayEquals(chip.files.getValue(file.identifier), result.files.getValue(file.kind), file.name)
        }
        assertArrayEquals(chip.responses.getValue("0011223344556677"), result.activeAuthenticationResponse)
    }

    // Errors, as the real service raises them.

    @Test
    fun `a wrong MRZ key is access denied, and nothing is read`() {
        val responder = UtopiaChipResponder(chip)

        val failed = assertThrows(ChipReadException::class.java) { read(responder, ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310102"))) }

        assertEquals(ChipReadFailure.ACCESS_DENIED, failed.failure)
        assertEquals("Chip read failed: access_denied", failed.message)
        assertNull(failed.cause)
        assertFalse(responder.commands.any { it.startsWith("*") })
    }

    @Test
    fun `a card access number cannot open this chip, which has no PACE`() {
        val failed = assertThrows(ChipReadException::class.java) { read(UtopiaChipResponder(chip), ChipAccess.Can("123456")) }

        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, failed.failure)
    }

    @Test
    fun `a chip that leaves the field is tag lost, wherever it leaves`() {
        // 1: the first command; 3: the challenge; 4: the mutual authentication; 9: a read under secure messaging; 30: inside the portrait.
        listOf(1, 3, 4, 9, 30).forEach { command ->
            val responder = UtopiaChipResponder(chip, lostAt = command)

            val failed = assertThrows(ChipReadException::class.java) { read(responder) }

            assertEquals(ChipReadFailure.TAG_LOST, failed.failure, "lost at command $command")
            assertNull(failed.cause)
            assertFalse(responder.isOpen)
        }
    }

    @Test
    fun `the session is closed after a read, and the security providers are as they were`() {
        val before = Security.getProviders().toList()
        val responder = UtopiaChipResponder(chip)

        read(responder)

        assertFalse(responder.isOpen)
        // Bouncy Castle is JMRTD's own provider object; a read installs no provider and moves none (C209.2).
        // (Robolectric installs one of its own for the module's other tests, which is why the list is compared and not searched.)
        val after = Security.getProviders().toList()
        assertEquals(before.size, after.size)
        before.indices.forEach { index -> assertSame(before[index], after[index]) }
    }

    @Test
    fun `a session reports what its card service says of long commands and lost connections`() {
        val responder = UtopiaChipResponder(chip, lostAt = 1)
        val session = JmrtdChipSession(responder, largeBlocks = true)

        assertTrue(session.largeBlocks)
        assertFalse(session.connectionLost(IllegalStateException()))
        assertThrows(Exception::class.java) { LibraryLoggers.silenced { session.open(); session.selectApplication(afterPace = false) } }
        assertTrue(session.connectionLost(IllegalStateException()))
    }
}
