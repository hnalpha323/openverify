package dev.openverify.sdk.consent

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The consent hook's evidence on the wire (C200.1; Workflow 10A Stage 1b): `FlowApiClient` encodes
 * what [consentEvidence] gives as the consent body's `text-sha256`, `copy-source` and
 * `catalog-version` (Phase 9's `flowConsentBodySchema`), and leaves each out when it is absent, so
 * [ConsentEvidence.NONE] sends exactly today's body.
 */
internal class ConsentEvidenceBodyTest {

    private val bodies = mutableListOf<JsonElement>()

    private val engine = MockEngine { request ->
        bodies += OpenVerifyJson.parseToJsonElement(request.body.toByteArray().decodeToString())
        respond(
            """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}""",
            HttpStatusCode.OK,
            headersOf(HttpHeaders.ContentType, "application/json; charset=utf-8"),
        )
    }

    private val client = FlowApiClient("https://api.example.com", "ovs_synthetic" + "t".repeat(34), flowHttpClient(engine))

    @Test
    fun evidenceIsSentAsTheConsentBodysThreeMembers() = runTest {
        val digest = "0".repeat(63) + "1"
        client.acceptConsent(
            textKeys = listOf("consent.biometric"),
            locale = "en",
            evidence = ConsentEvidence(listOf(digest), copySource = "built-in", catalogVersion = consentCatalogVersion()),
        )

        assertEquals(
            buildJsonObject {
                put("accepted", true)
                put("text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric")) })
                put("locale", "en")
                put("text-sha256", buildJsonArray { add(JsonPrimitive(digest)) })
                put("copy-source", "built-in")
                put("catalog-version", consentCatalogVersion())
            },
            bodies.single(),
        )
    }

    @Test
    fun noEvidenceSendsTodaysBody() = runTest {
        client.acceptConsent(listOf("consent.biometric"), "es", listOf("consent.biometric-matching"), ConsentEvidence.NONE)

        val body = bodies.single() as JsonObject
        assertEquals(setOf("accepted", "text-keys", "optional-text-keys", "locale"), body.keys)
    }
}
