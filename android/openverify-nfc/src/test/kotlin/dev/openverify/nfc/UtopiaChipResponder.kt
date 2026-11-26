package dev.openverify.nfc

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.CardServiceException
import net.sf.scuba.smartcards.CommandAPDU
import net.sf.scuba.smartcards.ResponseAPDU
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The synthetic Utopia chip of `contracts/fixtures/emrtd/utopia-chip.json`, as the host tests read
 * it: its files by identifier, its MRZ fields, and its precomputed Active Authentication responses.
 * No real document and no private value.
 */
internal class UtopiaChip(json: JsonObject) {
    private fun JsonObject.text(name: String): String = getValue(name).jsonPrimitive.content

    val documentNumber: String = json.getValue("mrz").jsonObject.text("document-number")
    val dateOfBirth: String = json.getValue("mrz").jsonObject.text("date-of-birth")
    val dateOfExpiry: String = json.getValue("mrz").jsonObject.text("date-of-expiry")
    val mrzInformation: String = json.getValue("mrz").jsonObject.text("information")
    val kEnc: ByteArray = ChipCrypto.hex(json.getValue("bac").jsonObject.text("k-enc"))
    val kMac: ByteArray = ChipCrypto.hex(json.getValue("bac").jsonObject.text("k-mac"))

    /** Each file's content by its identifier, such as `0x0101` for DG1. */
    val files: Map<Int, ByteArray> = json.getValue("files").jsonArray.map { it.jsonObject }.associate { file ->
        file.text("file-identifier").toInt(16) to Base64.getDecoder().decode(file.text("content"))
    }

    /** The Active Authentication response for each nonce the fixture lists, by the nonce in hex. */
    val responses: Map<String, ByteArray> = json.getValue("active-authentication").jsonObject.getValue("responses").jsonArray
        .map { it.jsonObject }.associate { it.text("nonce") to ChipCrypto.hex(it.text("response")) }

    internal companion object {
        /** The fixture the build hands the host tests (`openverify.fixtures.emrtd`). */
        fun load(): UtopiaChip {
            val directory = System.getProperty("openverify.fixtures.emrtd") ?: error("the build passes openverify.fixtures.emrtd")
            return UtopiaChip(Json.parseToJsonElement(File(directory, "utopia-chip.json").readText()).jsonObject)
        }
    }
}

/**
 * The chip side of Basic Access Control and its secure messaging (ICAO Doc 9303 Part 11, sections
 * 4.3 and 9.8), written for the tests from the standard: the key derivation with SHA-1 and a
 * counter, two-key triple DES in CBC mode with a zero initialisation vector, the retail MAC of
 * ISO/IEC 9797-1 (algorithm 3, padding method 2), and the padding. Checked against the standard's
 * worked example in `JmrtdChipSessionTest`.
 */
internal object ChipCrypto {
    fun hex(text: String): ByteArray = ByteArray(text.length / 2) { text.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    /** The first 16 bytes of SHA-1 over the MRZ information. */
    fun keySeed(mrzInformation: String): ByteArray = MessageDigest.getInstance("SHA-1").digest(mrzInformation.toByteArray(Charsets.US_ASCII)).copyOf(16)

    /** A two-key triple DES key from [seed] and the counter [mode] (1 for encryption, 2 for the MAC), with odd parity. */
    fun deriveKey(seed: ByteArray, mode: Int): ByteArray {
        val digest = MessageDigest.getInstance("SHA-1").digest(seed + byteArrayOf(0, 0, 0, mode.toByte()))
        return ByteArray(16) { index ->
            val value = digest[index].toInt() and 0xfe
            (value or if (Integer.bitCount(value) % 2 == 0) 1 else 0).toByte()
        }
    }

    private fun tripleDes(mode: Int, key: ByteArray, data: ByteArray): ByteArray =
        Cipher.getInstance("DESede/CBC/NoPadding").apply { init(mode, SecretKeySpec(key + key.copyOf(8), "DESede"), IvParameterSpec(ByteArray(8))) }.doFinal(data)

    fun encrypt(key: ByteArray, data: ByteArray): ByteArray = tripleDes(Cipher.ENCRYPT_MODE, key, data)

    fun decrypt(key: ByteArray, data: ByteArray): ByteArray = tripleDes(Cipher.DECRYPT_MODE, key, data)

    /** The retail MAC over [data], which is already padded: single DES in CBC mode with the first key half, then the last block through the second and the first. */
    fun mac(key: ByteArray, data: ByteArray): ByteArray {
        val first = SecretKeySpec(key.copyOfRange(0, 8), "DES")
        val second = SecretKeySpec(key.copyOfRange(8, 16), "DES")
        val chained = Cipher.getInstance("DES/CBC/NoPadding").apply { init(Cipher.ENCRYPT_MODE, first, IvParameterSpec(ByteArray(8))) }.doFinal(data)
        val last = chained.copyOfRange(chained.size - 8, chained.size)
        val opened = Cipher.getInstance("DES/ECB/NoPadding").apply { init(Cipher.DECRYPT_MODE, second) }.doFinal(last)
        return Cipher.getInstance("DES/ECB/NoPadding").apply { init(Cipher.ENCRYPT_MODE, first) }.doFinal(opened)
    }

    /** Padding method 2: one byte `80`, then zeros to a multiple of eight. */
    fun pad(data: ByteArray): ByteArray = (data + 0x80.toByte()).let { it + ByteArray((8 - it.size % 8) % 8) }

    fun unpad(data: ByteArray): ByteArray = data.copyOf(data.indexOfLast { it == 0x80.toByte() })
}

/**
 * An in-process chip for the JVM test of the real JMRTD service (C209.3): a SCUBA `CardService`
 * that answers the commands a reader sends to [chip], as a travel document's chip answers them:
 *
 * - file and application selection, by identifier;
 * - Basic Access Control (GET CHALLENGE, EXTERNAL AUTHENTICATE) with the key of the chip's MRZ;
 * - secure messaging with the session keys: every command after access must arrive protected, with
 *   the right checksum and counter, and every answer is protected the same way;
 * - READ BINARY of the selected file, in short blocks, and in long ones when [extendedLength];
 * - INTERNAL AUTHENTICATE, for the nonces the fixture has a response for.
 *
 * It implements no PACE, no Chip Authentication and no Terminal Authentication, and has no
 * EF.CardAccess: PACE runs in no automated test. It records the plain form of each command in
 * [commands], as `INS P1P2 [data]` with `*` in front of a protected one.
 */
internal class UtopiaChipResponder(
    private val chip: UtopiaChip,
    private val extendedLength: Boolean = false,
    /** The chip leaves the field at this command, counted from 1; 0 for never. */
    private val lostAt: Int = 0,
) : CardService() {
    val commands = mutableListOf<String>()
    private var open = false
    private var application = false
    private var selected: ByteArray? = null
    private var challenge: ByteArray? = null
    private var challenges = 0
    private var session: Session? = null
    private var lost = false

    private class Session(val encryption: ByteArray, val mac: ByteArray, var counter: Long) {
        /** The counter, one further, as the eight bytes a checksum starts with. */
        fun next(): ByteArray {
            counter++
            return ByteArray(8) { index -> (counter ushr (8 * (7 - index))).toByte() }
        }
    }

    override fun open() {
        open = true
    }

    override fun isOpen(): Boolean = open

    override fun getATR(): ByteArray = ByteArray(0)

    override fun close() {
        open = false
    }

    override fun isExtendedAPDULengthSupported(): Boolean = extendedLength

    override fun isConnectionLost(error: Exception?): Boolean = lost

    override fun transmit(command: CommandAPDU): ResponseAPDU {
        if (lostAt != 0 && commands.size + 1 >= lostAt) {
            lost = true
            commands += "lost"
            throw CardServiceException("Could not tranceive APDU", IOException("Transceive failed"))
        }
        return if (command.cla and 0x0c == 0x0c) secured(command) else ResponseAPDU(plain(command.ins, command.p1, command.p2, command.data, command.ne, protected = false))
    }

    /** Opens a protected command, answers its plain form, and protects the answer. */
    private fun secured(command: CommandAPDU): ResponseAPDU {
        val keys = session ?: return word(0x6988).also { commands += "*${name(command.ins, command.p1, command.p2, null)} without a session" }
        val objects = dataObjects(command.data)
        val header = byteArrayOf(command.cla.toByte(), command.ins.toByte(), command.p1.toByte(), command.p2.toByte())
        val body = ByteArrayOutputStream().apply {
            objects.filter { it.first == 0x87 || it.first == 0x85 || it.first == 0x97 }.forEach { write(it.third) }
        }.toByteArray()
        val expectedLength = objects.firstOrNull { it.first == 0x97 }?.second?.let { length ->
            val value = length.fold(0) { sum, byte -> (sum shl 8) or (byte.toInt() and 0xff) }
            if (value == 0) (if (length.size == 1) 256 else 65536) else value
        } ?: 0
        if (expectedLength > 256 && !extendedLength) {
            // This chip takes no long read: it refuses before it counts the command (ISO/IEC 7816-4, wrong length).
            commands += "*${name(command.ins, command.p1, command.p2, null)} too long"
            return word(0x6700)
        }
        val expected = ChipCrypto.mac(keys.mac, ChipCrypto.pad(keys.next() + ChipCrypto.pad(header) + body))
        val given = objects.firstOrNull { it.first == 0x8e }?.second
        if (given == null || !given.contentEquals(expected)) {
            // A wrong checksum ends the session, and the answer is not protected.
            session = null
            commands += "*${name(command.ins, command.p1, command.p2, null)} with a wrong checksum"
            return word(0x6988)
        }
        val data = objects.firstOrNull { it.first == 0x87 }?.second?.let { ChipCrypto.unpad(ChipCrypto.decrypt(keys.encryption, it.copyOfRange(1, it.size))) } ?: ByteArray(0)
        val answer = plain(command.ins, command.p1, command.p2, data, expectedLength, protected = true)
        val content = answer.copyOf(answer.size - 2)
        val status = answer.copyOfRange(answer.size - 2, answer.size)
        val out = ByteArrayOutputStream()
        if (content.isNotEmpty()) {
            val encrypted = byteArrayOf(0x01) + ChipCrypto.encrypt(keys.encryption, ChipCrypto.pad(content))
            out.write(0x87)
            out.write(length(encrypted.size))
            out.write(encrypted)
        }
        out.write(byteArrayOf(0x99.toByte(), 0x02) + status)
        val checksum = ChipCrypto.mac(keys.mac, ChipCrypto.pad(keys.next() + out.toByteArray()))
        out.write(byteArrayOf(0x8e.toByte(), 0x08) + checksum)
        out.write(byteArrayOf(0x90.toByte(), 0x00))
        return ResponseAPDU(out.toByteArray())
    }

    /** Answers a command in its plain form: the data, then the status word. */
    private fun plain(ins: Int, p1: Int, p2: Int, data: ByteArray, expected: Int, protected: Boolean): ByteArray {
        commands += (if (protected) "*" else "") + name(ins, p1, p2, data.takeIf { ins == 0xa4 || ins == 0x88 })
        return when (ins) {
            0xa4 -> select(p1, data, protected)
            0x84 -> if (!application) status(0x6985) else ByteArray(8) { (0x40 + challenges * 16 + it).toByte() }.also { challenge = it; challenges++ } + status(0x9000)
            0x82 -> mutualAuthentication(data)
            0xb0 -> read(p1, p2, expected, protected)
            0x88 -> if (!protected) status(0x6982) else chip.responses[ChipCrypto.hex(data)]?.plus(status(0x9000)) ?: status(0x6a80)
            else -> status(0x6d00)
        }
    }

    private fun select(p1: Int, data: ByteArray, protected: Boolean): ByteArray = when {
        p1 == 0x04 && ChipCrypto.hex(data) == "a0000002471001" -> {
            application = true
            selected = null
            status(0x9000)
        }
        p1 == 0x04 -> status(0x6a82)
        // This chip has no file in its master file: no EF.CardAccess, so no PACE.
        !application -> status(0x6a82)
        // After access a chip takes only protected commands, and ends the session on a plain one.
        !protected -> status(0x6982).also { session = null }
        else -> chip.files[ChipCrypto.hex(data).toInt(16)]?.let { selected = it; status(0x9000) } ?: status(0x6a82)
    }

    /** The chip's half of Basic Access Control: the command holds the reader's cryptogram and its checksum. */
    private fun mutualAuthentication(data: ByteArray): ByteArray {
        val own = challenge ?: return status(0x6985)
        challenge = null
        if (data.size != 40) return status(0x6700)
        val cryptogram = data.copyOfRange(0, 32)
        if (!ChipCrypto.mac(chip.kMac, ChipCrypto.pad(cryptogram)).contentEquals(data.copyOfRange(32, 40))) return status(0x6300)
        val opened = ChipCrypto.decrypt(chip.kEnc, cryptogram)
        val readerChallenge = opened.copyOfRange(0, 8)
        if (!opened.copyOfRange(8, 16).contentEquals(own)) return status(0x6300)
        val readerKey = opened.copyOfRange(16, 32)
        val chipKey = ByteArray(16) { (0x70 + it).toByte() }
        val answer = ChipCrypto.encrypt(chip.kEnc, own + readerChallenge + chipKey)
        val seed = ByteArray(16) { (readerKey[it].toInt() xor chipKey[it].toInt()).toByte() }
        val counter = (own.copyOfRange(4, 8) + readerChallenge.copyOfRange(4, 8)).fold(0L) { sum, byte -> (sum shl 8) or (byte.toLong() and 0xff) }
        session = Session(ChipCrypto.deriveKey(seed, 1), ChipCrypto.deriveKey(seed, 2), counter)
        return answer + ChipCrypto.mac(chip.kMac, ChipCrypto.pad(answer)) + status(0x9000)
    }

    private fun read(p1: Int, p2: Int, expected: Int, protected: Boolean): ByteArray {
        val file = selected
        if (!protected || file == null) return status(0x6982)
        if (p1 and 0x80 != 0) return status(0x6a86)
        val offset = (p1 shl 8) or p2
        if (offset > file.size) return status(0x6b00)
        return file.copyOfRange(offset, minOf(file.size, offset + expected)) + status(0x9000)
    }

    /** The data objects of a protected command: tag, value, and the whole object as sent. */
    private fun dataObjects(data: ByteArray): List<Triple<Int, ByteArray, ByteArray>> {
        val found = ArrayList<Triple<Int, ByteArray, ByteArray>>()
        var index = 0
        while (index < data.size) {
            val start = index
            val tag = data[index++].toInt() and 0xff
            var length = data[index++].toInt() and 0xff
            if (length > 0x80) {
                val count = length and 0x7f
                length = 0
                repeat(count) { length = (length shl 8) or (data[index++].toInt() and 0xff) }
            }
            found += Triple(tag, data.copyOfRange(index, index + length), data.copyOfRange(start, index + length))
            index += length
        }
        return found
    }

    private fun length(value: Int): ByteArray = when {
        value < 0x80 -> byteArrayOf(value.toByte())
        value < 0x100 -> byteArrayOf(0x81.toByte(), value.toByte())
        else -> byteArrayOf(0x82.toByte(), (value shr 8).toByte(), value.toByte())
    }

    private fun name(ins: Int, p1: Int, p2: Int, data: ByteArray?): String =
        "%02X %02X%02X".format(ins, p1, p2) + if (data == null || data.isEmpty()) "" else " ${ChipCrypto.hex(data)}"

    private fun status(word: Int): ByteArray = byteArrayOf((word shr 8).toByte(), word.toByte())

    private fun word(word: Int): ResponseAPDU = ResponseAPDU(status(word))
}
