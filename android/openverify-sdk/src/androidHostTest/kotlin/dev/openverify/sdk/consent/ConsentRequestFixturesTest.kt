package dev.openverify.sdk.consent

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.OpenVerifyJson
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
 * C224.4 (review H02; rule 21): the consent bodies the SDK sends, with the evidence the consent hook
 * gives over a synthetic session, are the committed fixtures under
 * `contracts/fixtures/flow-requests/android/`, which `apps/api/src/routes/flow/flow-requests.android.test.ts`
 * parses with `flowConsentBodySchema`. Assert-only: the files change only with
 * `UPDATE_CONTRACT_FIXTURES=1`, printed as Prettier prints JSON. This test declares its own cases and
 * owns android-sdk-api's three files of `index.json`.
 */
internal class ConsentRequestFixturesTest {

    private class Case(val file: String, val step: ConsentStep, val optional: List<String>, val locale: String, val session: FlowSession)

    private val base: FlowSession = kotlinx.coroutines.runBlocking { FakeFlowApi().getSession() }.copy(faceTemplateRetentionDays = 365)

    private val required = ConsentStep("consent", listOf("consent.biometric", "consent.processing", "notice.session-integrity"), required = true)

    private val cases = listOf(
        Case("consent-built-in.json", required, emptyList(), "en", base),
        Case(
            "consent-optional.json",
            required.copy(optionalTextKeys = listOf("consent.biometric-matching", "consent.device-recognition")),
            listOf("consent.biometric-matching"),
            "es",
            base,
        ),
        Case(
            "consent-custom.json",
            required,
            emptyList(),
            "en",
            base.copy(
                organizationDisplayName = "Example Verification Ltd",
                copy = FlowCopy(
                    mapOf(
                        "en" to mapOf(
                            "consent.biometric" to "{organization} compares your selfie with the photo on your ID. The template is kept {days} days.",
                            "consent.processing" to "{organization} processes your photos for this verification only.",
                            "notice.session-integrity" to "{organization} checks how this app is used, to protect your verification.",
                        ),
                    ),
                ),
            ),
        ),
    )

    @TestFactory
    fun `each consent body is its committed fixture, on the consent route`(): List<DynamicTest> = cases.map { case ->
        dynamicTest(case.file) {
            runTest {
                val sent = mutableListOf<Triple<String, String, ByteArray>>()
                val engine = MockEngine { request ->
                    sent += Triple(request.method.value, request.url.encodedPath, request.body.toByteArray())
                    respond("""{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                }
                val evidence = consentEvidence(case.step, case.optional, case.locale, case.session)
                FlowApiClient(BASE, TOKEN, flowHttpClient(engine)).acceptConsent(case.step.textKeys, case.locale, case.optional, evidence)

                val (method, path, body) = sent.single()
                assertEquals("POST" to "/api/v1/flow/consent", method to path)
                val printed = prettierJson(OpenVerifyJson.parseToJsonElement(body.decodeToString())) + "\n"
                val file = File(DIRECTORY, case.file)
                if (System.getenv(UPDATE) == "1") file.writeText(printed)
                assertEquals(printed, file.readText(), "${case.file} differs from the body the SDK sends; regenerate it with $UPDATE=1")
            }
        }
    }

    @TestFactory
    fun `the table lists each of these files for the consent route, owned by android-sdk-api`(): List<DynamicTest> {
        val index = OpenVerifyJson.parseToJsonElement(File(DIRECTORY, "index.json").readText()) as JsonObject
        val entries = (index.getValue("entries") as JsonArray).map { it as JsonObject }
        return cases.map { case ->
            dynamicTest(case.file) {
                val entry = entries.single { (it.getValue("file") as JsonPrimitive).content == case.file }
                assertEquals("android-sdk-api", (entry.getValue("owner") as JsonPrimitive).content)
                assertEquals("/api/v1/flow/consent", (entry.getValue("route") as JsonPrimitive).content)
                assertEquals("flowConsentBodySchema", (entry.getValue("schema") as JsonPrimitive).content)
            }
        }
    }

    private companion object {
        const val UPDATE = "UPDATE_CONTRACT_FIXTURES"
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_synthetic" + "t".repeat(34)

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
