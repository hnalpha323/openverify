package dev.openverify.sdk.api

import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.VerificationType
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
 * C224.4 (review H02; rule 21): every request body the real [FlowApiClient] encodes for the driver's
 * routes is the committed fixture under `contracts/fixtures/flow-requests/android/`, which
 * `apps/api/src/routes/flow/flow-requests.android.test.ts` parses with the route's zod schema, so
 * the SDK's bodies and the server's contract cannot drift apart. Assert-only: the files change only
 * with `UPDATE_CONTRACT_FIXTURES=1`, printed as Prettier prints JSON. This test declares its own
 * cases, synthetic values only, and owns the four files of android-driver in `index.json`.
 */
internal class FlowRequestFixturesTest {

    /** One encoded request: the call, and the route it must reach. */
    private class Case(val file: String, val method: String, val path: String, val call: suspend (FlowApiClient) -> Unit)

    private val cases = listOf(
        Case("screen-submit.json", "POST", "/api/v1/flow/screens/extra_details/submit") { client ->
            client.submitScreen(
                "extra_details",
                linkedMapOf(
                    "nickname" to FlowValue.Text("Sam"),
                    "household_size" to FlowValue.Number(3.5),
                    "newsletter" to FlowValue.Bool(true),
                    "interests" to FlowValue.Texts(listOf("cycling", "reading")),
                    "middle_name" to FlowValue.Empty,
                ),
                button = null,
            )
        },
        Case("screen-submit-button.json", "POST", "/api/v1/flow/screens/extra_details/submit") { client ->
            client.submitScreen("extra_details", linkedMapOf("nickname" to FlowValue.Text("Sam")), button = "skip")
        },
        Case("verification-government-id.json", "POST", "/api/v1/flow/verifications") { client ->
            client.createVerification(VerificationType.GOVERNMENT_ID, country = "US", idClass = "drivers_license")
        },
        Case("signals.json", "POST", "/api/v1/flow/signals") { client ->
            client.sendSignals(
                FlowSignals(
                    collectorVersion = 1,
                    screen = "consent",
                    sequence = 0,
                    androidIntegrity = AndroidIntegritySignals(debuggerConnected = false, appDebuggable = false),
                    deviceClass = "smartphone",
                ),
            )
        },
    )

    @TestFactory
    fun `each of the driver's request bodies is its committed fixture, on its route`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, ByteArray>>()
                val engine = MockEngine { request ->
                    sent += Triple(request.method.value, request.url.encodedPath, request.body.toByteArray())
                    respond(answerFor(request.url.encodedPath), HttpStatusCode.fromValue(statusFor(request.url.encodedPath)), headersOf(HttpHeaders.ContentType, "application/json"))
                }
                case.call(FlowApiClient(BASE, TOKEN, flowHttpClient(engine)))

                val (method, path, body) = sent.single()
                assertEquals(case.method to case.path, method to path)
                val printed = prettierJson(OpenVerifyJson.parseToJsonElement(body.decodeToString())) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, file.readText(), "${case.file} differs from the body FlowApiClient encodes; regenerate it with $UPDATE=1")
            }
        }
    }

    @TestFactory
    fun `the table lists each of these files for its route, owned by android-driver`(): List<DynamicTest> {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val entries = (index.getValue("entries") as JsonArray).map { it as JsonObject }
        return cases.map { case ->
            dynamicTest(case.file) {
                val entry = entries.single { (it.getValue("file") as JsonPrimitive).content == case.file }
                assertEquals("android-driver", (entry.getValue("owner") as JsonPrimitive).content)
                assertEquals(case.method, (entry.getValue("method") as JsonPrimitive).content)
                assertEquals(case.path.replace("extra_details", ":stepId"), (entry.getValue("route") as JsonPrimitive).content)
            }
        }
    }

    private fun statusFor(path: String): Int = if (path.endsWith("/signals")) 202 else 200

    private fun answerFor(path: String): String = when {
        path.endsWith("/submit") -> Fixtures.read("api/flow-session-v2.json")
        path.endsWith("/verifications") -> Fixtures.read("api/verification-government-id.json")
        else -> ""
    }

    private companion object {
        const val UPDATE = "UPDATE_CONTRACT_FIXTURES"
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_" + "t".repeat(43)

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
