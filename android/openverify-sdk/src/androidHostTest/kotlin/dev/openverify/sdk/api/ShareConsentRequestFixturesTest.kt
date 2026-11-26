package dev.openverify.sdk.api

import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C238.4, C237.6, C224.4 (Phase 11, Workflow 11A; `clients-connect`; rule 24): the three
 * share-consent exits the real [FlowApiClient] encodes are the committed fixtures under
 * `contracts/fixtures/flow-requests/android/`, which `apps/api/src/routes/flow/flow-requests.android.test.ts`
 * parses with each route's zod schema. Each reaches its route with the session token and the
 * spec header; a step id outside its pattern and a digest that is not one are refused before
 * anything is sent. Assert-only: the files change only with `UPDATE_CONTRACT_FIXTURES=1`. This test
 * declares its own cases, synthetic values only, and owns clients-connect's three files in `index.json`.
 */
internal class ShareConsentRequestFixturesTest {

    private class Case(val file: String, val exit: String, val schema: String, val call: suspend (FlowApiClient) -> Unit)

    private val cases = listOf(
        Case("share-consent-accept.json", "accept", "flowShareConsentAcceptBodySchema") { client ->
            client.acceptShareConsent(STEP_ID, "a".repeat(64), "b".repeat(64), explicitBiometric = true)
        },
        Case("share-consent-decline.json", "decline", "flowShareConsentDeclineBodySchema") { it.declineShareConsent(STEP_ID) },
        Case("share-consent-withdraw.json", "withdraw", "flowShareConsentWithdrawBodySchema") { it.withdrawShareConsent(STEP_ID) },
    )

    @TestFactory
    fun `each share-consent exit is its committed fixture, on its route, with the SDK's headers`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, Pair<String, ByteArray>>>()
                val headers = mutableListOf<Pair<String?, String?>>()
                val engine = MockEngine { request ->
                    val body = request.body
                    sent += Triple(request.method.value, request.url.encodedPath, body.contentType.toString() to body.toByteArray())
                    headers += request.headers[HttpHeaders.Authorization] to request.headers["OpenVerify-Flow-Spec"]
                    respond(SESSION, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                }
                case.call(FlowApiClient(BASE, TOKEN, flowHttpClient(engine)))

                val (method, path, body) = sent.single()
                assertEquals("POST" to "/api/v1/flow/share-consents/$STEP_ID/${case.exit}", method to path)
                assertEquals("Bearer $TOKEN" to "2", headers.single())
                assertEquals("application/json; charset=utf-8", body.first)
                val printed = prettierJson(OpenVerifyJson.parseToJsonElement(body.second.decodeToString())) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, if (file.exists()) file.readText() else "", "${case.file} differs from the request FlowApiClient encodes; regenerate it with $UPDATE=1")
            }
        }
    }

    @Test
    fun `an accept without a biometric text sends no biometric digest`() = runTest {
        var sent = ""
        val client = FlowApiClient(BASE, TOKEN, flowHttpClient(MockEngine { request -> sent = request.body.toByteArray().decodeToString(); respond(SESSION, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }))

        client.acceptShareConsent(STEP_ID, "a".repeat(64), null, explicitBiometric = false)

        assertEquals("""{"text-sha256":"${"a".repeat(64)}","explicit-biometric":false}""", sent)
    }

    @Test
    fun `the table lists exactly these files for clients-connect, each with its route and schema`() {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val listed = (index.getValue("entries") as JsonArray).map { it as JsonObject }
            .filter { (it["owner"] as? JsonPrimitive)?.content == "clients-connect" }
            .map { entry -> listOf("file", "method", "route", "schema", "workflow").map { (entry.getValue(it) as JsonPrimitive).content } }

        assertEquals(
            cases.map { listOf(it.file, "POST", "/api/v1/flow/share-consents/:stepId/${it.exit}", it.schema, "11A") }.sortedBy { it[0] },
            listed.sortedBy { it[0] },
        )
    }

    @Test
    fun `a step id outside its pattern or a digest that is not one is refused before anything is sent`() {
        var requests = 0
        val client = FlowApiClient(BASE, TOKEN, flowHttpClient(MockEngine { requests += 1; respond(SESSION) }))
        fun refused(call: suspend () -> Unit) = assertThrows(IllegalArgumentException::class.java) { runBlocking { call() } }

        refused { client.acceptShareConsent("../consent", "a".repeat(64), null, false) }
        refused { client.declineShareConsent("Share") }
        refused { client.withdrawShareConsent("a/b") }
        refused { client.acceptShareConsent(STEP_ID, "not a digest", null, false) }
        refused { client.acceptShareConsent(STEP_ID, "a".repeat(64), "B".repeat(64), true) }
        assertEquals(0, requests)
    }

    private companion object {
        const val UPDATE = "UPDATE_CONTRACT_FIXTURES"
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_synthetic" + "s".repeat(34)
        const val STEP_ID = "share_back"
        val SESSION: String = File("../../contracts/fixtures/api/flow-session-share-consent.json").readText()

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
