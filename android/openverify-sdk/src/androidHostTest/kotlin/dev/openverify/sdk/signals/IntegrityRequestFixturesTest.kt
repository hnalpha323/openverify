package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.HttpClient
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
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C224.4 (rule 26; Workflow 10B): the request bodies device-integrity-android's client code encodes
 * are the committed fixtures under `contracts/fixtures/flow-requests/android/`, which
 * `apps/api/src/routes/flow/flow-requests.android.test.ts` parses with each route's zod schema.
 * Assert-only: a file changes only with `UPDATE_CONTRACT_FIXTURES=1`, printed as Prettier prints JSON.
 * This test declares its own cases, synthetic values only.
 */
internal class IntegrityRequestFixturesTest {

    /** One encoded request: the call over a client on [HttpClient], and the route it must reach. */
    private class Case(val file: String, val method: String, val path: String, val route: String, val answer: Pair<Int, String>, val call: suspend (HttpClient) -> Unit)

    private val cases = listOf(
        Case("signals-android-integrity.json", "POST", "/api/v1/flow/signals", "/api/v1/flow/signals", 202 to "") { http ->
            FlowApiClient(BASE, TOKEN, http).sendSignals(
                FlowSignals(
                    collectorVersion = 1,
                    screen = "consent",
                    sequence = 0,
                    androidIntegrity = AndroidIntegritySignals(
                        debuggerConnected = false,
                        appDebuggable = true,
                        emulatorIndicators = listOf("build_hardware_goldfish_or_ranchu", "build_product_sdk", "build_model_emulator"),
                        rootIndicators = emptyList(),
                        hookingIndicators = listOf("frida_thread_name"),
                    ),
                    deviceClass = "smartphone",
                ),
            )
        },
        // C211.3: the integrity routes, sent by the real FlowApiClient (wired by integration-10b).
        Case("integrity-challenge.json", "POST", "/api/v1/flow/integrity-challenges", "/api/v1/flow/integrity-challenges", 201 to CHALLENGE) { http ->
            FlowApiClient(BASE, TOKEN, http).createIntegrityChallenge()
        },
        Case("integrity-token.json", "POST", "/api/v1/flow/integrity-tokens", "/api/v1/flow/integrity-tokens", 202 to "") { http ->
            FlowApiClient(BASE, TOKEN, http).sendIntegrityToken(CHALLENGE_ID, INTEGRITY_TOKEN)
        },
    )

    @TestFactory
    fun `each request body is its committed fixture, on its route`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, ByteArray>>()
                val engine = MockEngine { request ->
                    sent += Triple(request.method.value, request.url.encodedPath, request.body.toByteArray())
                    respond(case.answer.second, HttpStatusCode.fromValue(case.answer.first), headersOf(HttpHeaders.ContentType, "application/json"))
                }
                case.call(flowHttpClient(engine))

                val (method, path, body) = sent.single()
                assertEquals(case.method to case.path, method to path)
                val printed = prettierJson(OpenVerifyJson.parseToJsonElement(body.decodeToString())) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, if (file.exists()) file.readText() else "", "${case.file} differs from the body the SDK encodes; regenerate it with $UPDATE=1")
            }
        }
    }

    @TestFactory
    fun `the table lists each of these files for its route, owned by device-integrity-android`(): List<DynamicTest> {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val entries = (index.getValue("entries") as JsonArray).map { it as JsonObject }
        return cases.map { case ->
            dynamicTest(case.file) {
                val entry = entries.single { (it.getValue("file") as JsonPrimitive).content == case.file }
                assertEquals("device-integrity-android", (entry.getValue("owner") as JsonPrimitive).content)
                assertEquals(case.method, (entry.getValue("method") as JsonPrimitive).content)
                assertEquals(case.route, (entry.getValue("route") as JsonPrimitive).content)
            }
        }
    }

    private companion object {
        const val UPDATE = "UPDATE_CONTRACT_FIXTURES"
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_" + "t".repeat(43)
        const val CHALLENGE_ID = "ich_01M5CK3190XEVBM5ZXA76E1JS0"

        /** A synthetic integrity token, never a real device's attestation. */
        const val INTEGRITY_TOKEN = "synthetic-integrity-token"
        val CHALLENGE = """{"id":"$CHALLENGE_ID","request-hash":"syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","expires-at":"2026-11-09T12:10:00.000Z"}"""

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
