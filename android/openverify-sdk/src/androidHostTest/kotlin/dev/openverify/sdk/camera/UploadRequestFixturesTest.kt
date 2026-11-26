package dev.openverify.sdk.camera

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.SelfieCaptureUpload
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
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
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C224.4 (review H02; rule 26), C206: the multipart uploads the real [FlowApiClient] encodes, with the
 * client-reported `capture-method` and `capture-trigger`, are the committed `.multipart.json` fixtures
 * under `contracts/fixtures/flow-requests/android/` (`multipart.schema.json`: the form fields as sent,
 * in order, and the file part's name, filename, content type and size, never its bytes), which
 * `apps/api/src/routes/flow/flow-requests.android.test.ts` parses with `flowFileUploadFieldsSchema`.
 * Assert-only: the files change only with `UPDATE_CONTRACT_FIXTURES=1`, printed as Prettier prints
 * JSON. This test declares its own cases, synthetic values only, and owns capture-pipeline's three
 * files in `index.json`.
 */
internal class UploadRequestFixturesTest {

    /** One encoded upload: the call, and the route it must reach. */
    private class Case(val file: String, val call: suspend (FlowApiClient) -> Unit)

    private val cases = listOf(
        // An ID side taken with the shutter on the live camera (C206.1, C206.2).
        Case("upload-government-id-camera.multipart.json") { client ->
            client.uploadFile(
                VERIFICATION_ID,
                FileKind.FRONT,
                CapturedImage(JPEG_BYTES, "image/jpeg"),
                capture = null,
                captureMethod = CaptureMethod.CAMERA,
                captureTrigger = CaptureTrigger.MANUAL,
            )
        },
        // A selfie pose the auto-capture took, sent to its capture (C40.3, C204.4).
        Case("upload-selfie-pose-auto.multipart.json") { client ->
            client.uploadFile(
                VERIFICATION_ID,
                FileKind.SELFIE_LEFT,
                CapturedImage(JPEG_BYTES, "image/jpeg"),
                capture = SelfieCaptureUpload(CAPTURE_ID, NONCE, clientElapsedMs = 6_250),
                captureMethod = CaptureMethod.CAMERA,
                captureTrigger = CaptureTrigger.AUTO,
            )
        },
        // A document picked from the device's files (C64.2): a method, never a trigger.
        Case("upload-document.multipart.json") { client ->
            client.uploadDocument(VERIFICATION_ID, DocumentFile(PDF_BYTES, "application/pdf"), captureMethod = CaptureMethod.UPLOAD)
        },
    )

    @TestFactory
    fun `each of capture-pipeline's uploads is its committed fixture, on the files route`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, Pair<String, ByteArray>>>()
                val engine = MockEngine { request ->
                    val body = request.body
                    sent += Triple(request.method.value, request.url.encodedPath, body.contentType.toString() to body.toByteArray())
                    respond(FILE_ANSWER, HttpStatusCode.Created, headersOf(HttpHeaders.ContentType, "application/json"))
                }
                case.call(FlowApiClient(BASE, TOKEN, flowHttpClient(engine)))

                val (method, path, body) = sent.single()
                assertEquals("POST" to "/api/v1/flow/verifications/$VERIFICATION_ID/files", method to path)
                val printed = prettierJson(multipartFixture(body.first, body.second)) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, if (file.exists()) file.readText() else "", "${case.file} differs from the upload FlowApiClient encodes; regenerate it with $UPDATE=1")
            }
        }
    }

    @TestFactory
    fun `the table lists each of these files for the files route, owned by capture-pipeline`(): List<DynamicTest> {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val entries = (index.getValue("entries") as JsonArray).map { it as JsonObject }
        return cases.map { case ->
            dynamicTest(case.file) {
                val entry = entries.single { (it.getValue("file") as JsonPrimitive).content == case.file }
                val member = { name: String -> (entry.getValue(name) as JsonPrimitive).content }
                assertEquals(
                    listOf("capture-pipeline", "POST", "/api/v1/flow/verifications/:id/files", "flowFileUploadFieldsSchema", "10B"),
                    listOf(member("owner"), member("method"), member("route"), member("schema"), member("workflow")),
                )
            }
        }
    }

    /**
     * The `.multipart.json` shape (`multipart.schema.json`) of a `multipart/form-data` body: each form
     * field by name, as sent and in order, then the file part's name, filename, content type and size.
     */
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
        val TOKEN = "ovs_" + "t".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"

        /** The golden capture's id and synthetic nonce (`contracts/fixtures/flow/selfie-capture-created.json`). */
        const val CAPTURE_ID = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val NONCE = "E2eSyntheticNonce00000"

        /** A JPEG's first bytes: the size is what the fixture states, never the bytes. */
        val JPEG_BYTES = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10)
        val PDF_BYTES = "%PDF-1.7\n% synthetic document\n%%EOF\n".encodeToByteArray()

        val FILE_ANSWER = """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68DDZ","attributes":{"kind":"front",""" +
            """"mime-type":"image/jpeg","byte-size":6,"created-at":"2026-10-20T12:03:01.000Z"},""" +
            """"relationships":{"verification":{"data":{"type":"verification/government-id","id":"$VERIFICATION_ID"}}}}}"""

        val DISPOSITION_NAME = Regex("""\bname="([^"]*)"""")
        val DISPOSITION_FILENAME = Regex("""\bfilename="([^"]*)"""")

        /** The fixtures, from this module's directory, where Gradle runs its tests. */
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
