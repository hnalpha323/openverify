package dev.openverify.nfc

import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * C209.3 (Workflow 10E Stage 1a): the synthetic Utopia chip this module's JVM test answers APDUs
 * from, `contracts/fixtures/emrtd/utopia-chip.json`, as the build hands it to the host tests
 * (`openverify.fixtures.emrtd`). The file is written by `@openverify/emrtd/testing`
 * (`packages/emrtd/src/testing/utopia-chip-export.test.ts`); this test reads it on the JVM and holds
 * it to what a chip responder needs: the six files whole, the access values the SDK's own MRZ code
 * gives, and Active Authentication responses the JDK verifies with the key in DG15. No private value
 * is in the file, so a responder answers the listed nonces only.
 */
class UtopiaChipFixtureTest {

    private val chip: JsonObject = run {
        val directory = System.getProperty("openverify.fixtures.emrtd") ?: error("the build passes openverify.fixtures.emrtd")
        Json.parseToJsonElement(File(directory, "utopia-chip.json").readText()).jsonObject
    }

    private fun JsonObject.text(name: String): String = getValue(name).jsonPrimitive.content

    private fun hex(text: String): ByteArray = ByteArray(text.length / 2) { text.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

    private fun file(name: String): ByteArray =
        Base64.getDecoder().decode(chip.getValue("files").jsonArray.map { it.jsonObject }.single { it.text("name") == name }.text("content"))

    @Test
    fun `the chip is the synthetic Utopia one, in the first version of the format`() {
        assertEquals(1, chip.getValue("version").jsonPrimitive.int)
        assertEquals("UTO", chip.text("issuer"))
        assertTrue(chip.text("description").startsWith("Synthetic."))
    }

    @Test
    fun `the six files are whole, with their identifiers and tags`() {
        val files = chip.getValue("files").jsonArray.map { it.jsonObject }

        assertEquals(
            listOf("com:011e:chip-com", "sod:011d:chip-sod", "dg1:0101:chip-dg1", "dg2:0102:chip-dg2", "dg14:010e:chip-dg14", "dg15:010f:chip-dg15"),
            files.map { "${it.text("name")}:${it.text("file-identifier")}:${it.text("kind")}" },
        )
        files.forEach { entry ->
            val bytes = Base64.getDecoder().decode(entry.text("content"))

            assertEquals(entry.getValue("length").jsonPrimitive.int, bytes.size, entry.text("name"))
            assertEquals(entry.text("sha256"), MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }, entry.text("name"))
            assertEquals(entry.text("file-identifier").substring(2), entry.text("short-identifier"))
        }
        // The first byte of each elementary file is its template's tag (Doc 9303-10).
        assertEquals(listOf(0x60, 0x77, 0x61, 0x75, 0x6e, 0x6f), listOf("com", "sod", "dg1", "dg2", "dg14", "dg15").map { file(it)[0].toInt() and 0xff })
    }

    @Test
    fun `DG1 holds the two MRZ lines`() {
        val lines = chip.getValue("mrz").jsonObject.getValue("lines").jsonArray.map { it.jsonPrimitive.content }

        assertEquals(listOf(44, 44), lines.map { it.length })
        assertTrue(String(file("dg1"), Charsets.US_ASCII).endsWith(lines.joinToString("")))
    }

    @Test
    fun `the access values are what the SDK's MRZ code gives for the three fields`() {
        val mrz = chip.getValue("mrz").jsonObject
        val seed = BacKeySeed(mrz.text("document-number"), mrz.text("date-of-birth"), mrz.text("date-of-expiry"))

        assertEquals(mrz.text("information"), seed.mrzInformation)
        val kSeed = MessageDigest.getInstance("SHA-1").digest(seed.mrzInformation.toByteArray(Charsets.US_ASCII)).copyOf(16)
        assertArrayEquals(hex(chip.getValue("bac").jsonObject.text("k-seed")), kSeed)
        listOf("k-enc", "k-mac").forEach { name -> assertEquals(16, hex(chip.getValue("bac").jsonObject.text(name)).size, name) }
    }

    @Test
    fun `each listed nonce has a response the key in DG15 verifies`() {
        val dg15 = file("dg15")
        // DG15 is the tag 6F, a one-byte length, and the SubjectPublicKeyInfo of a P-256 key.
        assertEquals(dg15.size - 2, dg15[1].toInt() and 0xff)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(dg15.copyOfRange(2, dg15.size)))
        val authentication = chip.getValue("active-authentication").jsonObject
        val responses = authentication.getValue("responses").jsonArray.map { it.jsonObject }

        assertEquals("ecdsa-plain", authentication.text("algorithm"))
        assertEquals(4, responses.size)
        responses.forEach { entry ->
            val nonce = hex(entry.text("nonce"))
            val response = hex(entry.text("response"))

            assertEquals(8, nonce.size)
            assertEquals(64, response.size)
            val verifier = Signature.getInstance("SHA256withECDSAinP1363Format").apply {
                initVerify(key)
                update(nonce)
            }
            assertTrue(verifier.verify(response), entry.text("nonce"))
        }
    }
}
