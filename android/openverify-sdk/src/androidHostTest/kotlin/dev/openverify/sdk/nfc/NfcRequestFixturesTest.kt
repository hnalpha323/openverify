package dev.openverify.sdk.nfc

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipDeviceReport
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.SandboxChipScenario
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlin.io.encoding.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartReader
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C207.1, C221.8, C224.4 (rule 27): the NFC requests the real [FlowApiClient] encodes are the
 * committed fixtures under `contracts/fixtures/flow-requests/android/`, which
 * `apps/api/src/routes/flow/flow-requests.android.test.ts` parses with each route's zod schema. A
 * chip upload is a `.multipart.json` of `{fields, file}`: the form fields and the file part's name,
 * filename, content type and size, never its bytes. Assert-only: the files change only with
 * `UPDATE_CONTRACT_FIXTURES=1`. This test declares its own cases, synthetic values only, and owns
 * nfc-sdk's twelve files in `index.json`.
 */
internal class NfcRequestFixturesTest {

    private class Case(val file: String, val route: String, val schema: String, val answer: String, val call: suspend (FlowApiClient) -> Unit)

    private val uploads = listOf(
        FileKind.CHIP_SOD to 7, FileKind.CHIP_DG1 to 93, FileKind.CHIP_DG2 to 9, FileKind.CHIP_DG14 to 6, FileKind.CHIP_DG15 to 5,
        FileKind.CHIP_CARD_SECURITY to 4, FileKind.CHIP_CARD_ACCESS to 3, FileKind.CHIP_COM to 2,
    ).map { (kind, size) ->
        Case("upload-${kind.wireValue}.multipart.json", "files", "flowFileUploadFieldsSchema", fileAnswer(kind, size)) { client ->
            client.uploadChipFile(VERIFICATION_ID, kind, ByteArray(size) { 0x61 })
        }
    }

    private val cases = uploads + listOf(
        Case("chip-challenge.json", "chip-challenges", "createChipChallengeBodySchema", CHALLENGE_ANSWER) { it.createChipChallenge(VERIFICATION_ID) },
        Case("chip-submit.json", "submit", "flowSubmitVerificationBodySchema", VERIFICATION_ANSWER) { client ->
            client.submitChip(
                VERIFICATION_ID,
                FlowChipSubmit(
                    CHALLENGE_ID,
                    NONCE,
                    Base64.encode(byteArrayOf(1, 2, 3, 4)),
                    FlowChipDeviceReport(
                        listOf(FlowChipDeviceReport.Attempt("pace", "succeeded"), FlowChipDeviceReport.Attempt("active-authentication", "succeeded")),
                        readMs = 4_200,
                    ),
                ),
            )
        },
        Case("client-unable.json", "client-unable", "flowClientUnableBodySchema", """{"verification-id":"$VERIFICATION_ID","status":"canceled"}""") { client ->
            client.reportClientUnable(VERIFICATION_ID, ClientUnableReason.NFC_DISABLED_DECLINED)
        },
        Case("sandbox-chip.json", "sandbox-chip", "flowSandboxChipBodySchema", """{"files":[],"dg2-attached":true}""") { client ->
            client.requestSandboxChip(VERIFICATION_ID, CHALLENGE_ID, SandboxChipScenario.FACE_MISMATCH)
        },
    )

    @TestFactory
    fun `each NFC request is its committed fixture, on its route, with the SDK's headers`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, Pair<String, ByteArray>>>()
                val headers = mutableListOf<Pair<String?, String?>>()
                val engine = MockEngine { request ->
                    val body = request.body
                    sent += Triple(request.method.value, request.url.encodedPath, body.contentType.toString() to body.toByteArray())
                    headers += request.headers[HttpHeaders.Authorization] to request.headers["OpenVerify-Flow-Spec"]
                    respond(case.answer, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                }
                case.call(FlowApiClient(BASE, TOKEN, flowHttpClient(engine)))

                val (method, path, body) = sent.single()
                assertEquals("POST" to "/api/v1/flow/verifications/$VERIFICATION_ID/${case.route}", method to path)
                assertEquals("Bearer $TOKEN" to "2", headers.single())
                val content = if (case.file.endsWith(".multipart.json")) {
                    multipartFixture(body.first, body.second)
                } else {
                    assertEquals("application/json; charset=utf-8", body.first)
                    OpenVerifyJson.parseToJsonElement(body.second.decodeToString())
                }
                val printed = prettierJson(content) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, if (file.exists()) file.readText() else "", "${case.file} differs from the request FlowApiClient encodes; regenerate it with $UPDATE=1")
            }
        }
    }

    @Test
    fun `the table lists exactly these files for nfc-sdk, each with its route and schema`() {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val listed = (index.getValue("entries") as JsonArray).map { it as JsonObject }
            .filter { (it.getValue("owner") as JsonPrimitive).content == "nfc-sdk" }
            .map { entry -> listOf("file", "method", "route", "schema", "workflow").map { (entry.getValue(it) as JsonPrimitive).content } }

        assertEquals(
            cases.map { listOf(it.file, "POST", "/api/v1/flow/verifications/:id/${it.route}", it.schema, "10C") }.sortedBy { it[0] },
            listed.sortedBy { it[0] },
        )
    }

    @Test
    fun `a chip file is checked before it is sent - its kind and its size (C207_1)`() {
        var requests = 0
        val client = FlowApiClient(BASE, TOKEN, flowHttpClient(MockEngine { requests += 1; respond("{}") }))
        fun refused(kind: FileKind, size: Int) =
            assertThrows(IllegalArgumentException::class.java) { runBlocking { client.uploadChipFile(VERIFICATION_ID, kind, ByteArray(size)) } }

        // DG2 up to 1 MiB, the others up to 64 KiB; never an empty file; never a kind a chip does not hold.
        refused(FileKind.CHIP_DG2, 1024 * 1024 + 1)
        refused(FileKind.CHIP_DG1, 64 * 1024 + 1)
        refused(FileKind.CHIP_SOD, 0)
        refused(FileKind.FRONT, 8)
        refused(FileKind.CHIP_PORTRAIT, 8)
        val message = refused(FileKind.UNKNOWN, 8).message.orEmpty()
        assertFalse(message.any { it.isDigit() }, message)
        assertEquals(0, requests)
    }

    @Test
    fun `a submit's Active Authentication response is checked before it is sent - base64 of at most 1 KiB`() {
        var requests = 0
        val client = FlowApiClient(BASE, TOKEN, flowHttpClient(MockEngine { requests += 1; respond("{}") }))
        fun refused(response: String) = assertThrows(IllegalArgumentException::class.java) {
            runBlocking { client.submitChip(VERIFICATION_ID, FlowChipSubmit(CHALLENGE_ID, NONCE, response)) }
        }

        refused(Base64.encode(ByteArray(1025)))
        refused("not base64")
        refused("")
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { client.submitChip("ver_../session", FlowChipSubmit(CHALLENGE_ID, NONCE)) }
        }
        assertEquals(0, requests)
    }

    private fun multipartFixture(contentType: String, body: ByteArray): JsonObject {
        val type = contentType.toMediaType()
        assertEquals("multipart/form-data", "${type.type}/${type.subtype}")
        val fields = linkedMapOf<String, JsonElement>()
        var file: JsonObject? = null
        MultipartReader(Buffer().write(body), checkNotNull(type.parameter("boundary"))).use { reader ->
            generateSequence { reader.nextPart() }.forEach { part ->
                val disposition = checkNotNull(part.headers["Content-Disposition"])
                val name = checkNotNull(DISPOSITION_NAME.find(disposition)).groupValues[1]
                val bytes = part.body.readByteArray()
                val filename = DISPOSITION_FILENAME.find(disposition)?.groupValues?.get(1)
                if (filename == null) {
                    fields[name] = JsonPrimitive(bytes.decodeToString())
                } else {
                    file = buildJsonObject {
                        put("name", name)
                        put("filename", filename)
                        put("content-type", checkNotNull(part.headers["Content-Type"]))
                        put("size", bytes.size)
                    }
                }
            }
        }
        return buildJsonObject {
            put("fields", JsonObject(fields))
            put("file", checkNotNull(file) { "no file part" })
        }
    }

    private companion object {
        const val UPDATE = "UPDATE_CONTRACT_FIXTURES"
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_" + "syntheticS".repeat(5).take(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CHALLENGE_ID = "chc_01M5CK3190XEVBM5ZXA76E1JSM"
        const val NONCE = "0123456789abcdef"
        const val CHALLENGE_ANSWER = """{"id":"$CHALLENGE_ID","nonce":"$NONCE","expires-at":"2026-10-20T12:08:01.000Z"}"""

        val VERIFICATION_ANSWER = """{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION_ID","attributes":{"status":"submitted",""" +
            """"created-at":"2026-10-20T12:03:01.000Z","updated-at":"2026-10-20T12:03:01.000Z"}}}"""

        fun fileAnswer(kind: FileKind, size: Int) = """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68DDZ","attributes":{"kind":"${kind.wireValue}",""" +
            """"mime-type":"application/octet-stream","byte-size":$size,"created-at":"2026-10-20T12:03:01.000Z"},""" +
            """"relationships":{"verification":{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION_ID"}}}}}"""

        val DISPOSITION_NAME = Regex("""\bname="([^"]*)"""")
        val DISPOSITION_FILENAME = Regex("""\bfilename="([^"]*)"""")
        val DIRECTORY = File("../../contracts/fixtures/flow-requests/android")

        /** JSON as Prettier prints it (printWidth 100): objects one member a line, short arrays inline. */
        fun prettierJson(value: JsonElement, indent: String = "", lead: Int = 0): String = when (value) {
            is JsonArray -> {
                val items = value.map { prettierJson(it, "$indent  ", indent.length + 2) }
                val inline = "[${items.joinToString(", ")}]"
                if (value.none { it is JsonObject || it is JsonArray } && lead + inline.length <= 100) {
                    inline
                } else {
                    "[\n${items.joinToString(",\n") { "$indent  $it" }}\n$indent]"
                }
            }
            is JsonObject -> if (value.isEmpty()) {
                "{}"
            } else {
                val inner = "$indent  "
                val lines = value.entries.map { (key, member) ->
                    val head = "$inner${JsonPrimitive(key)}: "
                    head + prettierJson(member, inner, head.length + 1)
                }
                "{\n${lines.joinToString(",\n")}\n$indent}"
            }
            else -> value.toString()
        }
    }
}
