package dev.openverify.sdk.capture.barcode

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C203.3: the device shows "barcode found" only for a PDF417 whose bytes begin with an AAMVA header,
 * judged as the server's parser judges a header (`packages/checks/src/aamva.ts`, `readHeader`): over the
 * synthetic AAMVA vectors of `contracts/fixtures/aamva/`, a payload matches exactly when the server
 * does not refuse it with `aamva_header_invalid`.
 */
class AamvaHeaderTest {

    private class Vector(val id: String, val payload: ByteArray, val headerRefused: Boolean)

    private fun vectors(file: String): List<Vector> =
        Json.parseToJsonElement(readContractFixture("aamva/$file")).jsonObject.getValue("vectors").jsonArray.map {
            val vector = it.jsonObject
            Vector(
                id = vector.getValue("id").jsonPrimitive.content,
                payload = vector.getValue("payload").jsonPrimitive.content.encodeToByteArray(),
                headerRefused = (vector["error"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "aamva_header_invalid",
            )
        }

    @Test
    fun everyValidVectorHasAnAamvaHeader() {
        val valid = vectors("valid.json")
        assertTrue(valid.size >= 4, "the valid vectors are read")
        for (vector in valid) assertTrue(AamvaHeader.matches(vector.payload), vector.id)
    }

    @Test
    fun anInvalidVectorMatchesExactlyWhenTheServerReadsItsHeader() {
        val invalid = vectors("invalid.json")
        assertTrue(invalid.count { it.headerRefused } >= 2, "the header refusals are among the vectors")
        for (vector in invalid) assertEquals(!vector.headerRefused, AamvaHeader.matches(vector.payload), vector.id)
    }

    @Test
    fun aVersionOneHeaderHasNoJurisdictionVersion() {
        // Version 01's header is 19 bytes: no jurisdiction version before the number of entries.
        assertTrue(AamvaHeader.matches("@\n\u001e\rANSI 6360140101DL00290100".encodeToByteArray()))
        assertFalse(AamvaHeader.matches("@\n\u001e\rANSI 6360140100DL00290100".encodeToByteArray()), "no entries")
    }

    @Test
    fun refusesWhatIsNotAnAamvaHeader() {
        val refused = listOf(
            "",
            "@",
            "@\n\u001e\r",
            "@\n\u001e\rANSI 636014",
            "@\n\u001e\rANSI 6360141000",
            "@\n\u001e\rANSI 63601410000",
            "@\n\u001e\rAAMVA636014100002",
            "@\n\u001e\nANSI 636014100002",
            "@\r\u001e\nANSI 636014100002",
            "@\n\u001e\rANSI 63A014100002",
            "@\n\u001e\rANSI 636014X00002",
            "@\n\u001e\rANSI 6360141000X2",
            "@\n\u001e\rANSI 636014100000",
            " @\n\u001e\rANSI 636014100002",
            "https://example.com/not-a-licence",
        )
        for (text in refused) assertFalse(AamvaHeader.matches(text.encodeToByteArray()), text)
        assertFalse(AamvaHeader.matches(byteArrayOf(0x40, 0x0A, 0x1E, 0x0D, -1, -1, -1, -1, -1)), "bytes outside ASCII")
    }

    @Test
    fun readsWithoutChangingTheBytes() {
        val payload = "@\n\u001e\rANSI 636014100002DL00410232".encodeToByteArray()
        val copy = payload.copyOf()
        AamvaHeader.matches(payload)
        assertContentEquals(copy, payload)
    }

}
