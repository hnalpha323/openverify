package dev.openverify.sdk.stack

import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.SandboxSignalOutcome
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.signals.AndroidDeviceSignals
import dev.openverify.sdk.testing.StackTests
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds

/**
 * C224.4 (Phase 10, Workflow 10A integration-10a): the SDK's own `FlowApiClient` and driver, headless,
 * against the reusable e2e stack (`:openverify-sdk:stackTest`, run only under the e2e lock, never in
 * CI). It publishes the 10A flow of `e2e/fixtures/android-10a/flow.json` (the flow the API-driven
 * spec `e2e/tests/flow-android.spec.ts` drives), starts an inquiry as a customer's backend does, and
 * lets the coordinator run it: consent with the SDK's digests in Spanish, the sandbox database step,
 * the screen, the Spanish screen the branch on `session.locale` takes, and the completion. The real
 * `AndroidDeviceSignals` sends one body with the sandbox outcome `bot` (C90.9); since the coordinator
 * swallows a failed send by design (C94.7), the server is asked whether the body was stored: the
 * inquiry session's `signals-collected` and `device-type`, and `inquiry/bot_score` at 95.
 *
 * The stack's API URL and credentials come from `e2e/.artifacts/stack.json` (mode 0600), which this
 * test never prints. A missing record fails the test: start the stack first (rule 7 (c)).
 */
@RunWith(RobolectricTestRunner::class)
@Category(StackTests::class)
class AndroidFlowStackTest {

    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).followRedirects(false).build()

    /** The stack's API, key and admin, from the reusable stack's record. */
    private class Stack(val apiUrl: String, val apiKey: String, val adminEmail: String, val adminPassword: String)

    private fun file(property: String): File {
        val path = checkNotNull(System.getProperty(property)) { "$property is not set: run :openverify-sdk:stackTest" }
        val file = File(path)
        check(file.isFile) { "${file.name} is missing: start the reusable stack (e2e:stack:up) before stackTest" }
        return file
    }

    private fun stack(): Stack {
        val info = json.parseToJsonElement(file("openverify.e2e.stackRecord").readText()).jsonObject.getValue("info").jsonObject
        val admin = info.getValue("operators").jsonObject.getValue("admin").jsonObject
        return Stack(
            apiUrl = info.getValue("apiUrl").jsonPrimitive.content,
            apiKey = info.getValue("apiKey").jsonPrimitive.content,
            adminEmail = admin.getValue("email").jsonPrimitive.content,
            adminPassword = admin.getValue("password").jsonPrimitive.content,
        )
    }

    /** A JSON request to the server or dashboard API; fails naming the route and status, never a secret. */
    private fun send(stack: Stack, method: String, route: String, token: String, body: JsonElement? = null, status: Int): JsonObject {
        val request = Request.Builder()
            .url("${stack.apiUrl}/api/v1$route")
            .header("Accept", "application/json")
            .apply { if (token.isNotEmpty()) header("Authorization", "Bearer $token") }
            .method(method, body?.toString()?.toRequestBody("application/json".toMediaType()) ?: if (method == "POST") ByteArray(0).toRequestBody() else null)
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body.string()
            assertEquals("$method $route answered ${response.code}: $text", status, response.code)
            return if (text.isEmpty()) JsonObject(emptyMap()) else json.parseToJsonElement(text).jsonObject
        }
    }

    private fun JsonObject.data(): JsonObject = getValue("data").jsonObject

    private fun JsonObject.attributes(): JsonObject = data().getValue("attributes").jsonObject

    /** The fixture's template, its v2 version drafted, validated in publish mode and published by the admin. */
    private fun publish(stack: Stack): String {
        val fixture = json.parseToJsonElement(file("openverify.e2e.androidFlow").readText()).jsonObject
        val name = "stack android ${UUID.randomUUID().toString().take(8)}"
        val templateAttributes = JsonObject(fixture.getValue("template").jsonObject + ("name" to JsonPrimitive(name)))
        val template = send(stack, "POST", "/inquiry-templates", stack.apiKey, buildJsonObject {
            put("data", buildJsonObject { put("type", "inquiry-template"); put("attributes", templateAttributes) })
        }, 201).data().getValue("id").jsonPrimitive.content
        val versionAttributes = JsonObject(fixture.getValue("version").jsonObject + ("inquiry-template-id" to JsonPrimitive(template)))
        val version = send(stack, "POST", "/inquiry-template-versions", stack.apiKey, buildJsonObject {
            put("data", buildJsonObject { put("type", "inquiry-template-version"); put("attributes", versionAttributes) })
        }, 201).data().getValue("id").jsonPrimitive.content
        val validation = send(stack, "POST", "/inquiry-template-versions/$version/validate", stack.apiKey, buildJsonObject {
            put("meta", buildJsonObject { put("mode", "publish") })
        }, 200).attributes()
        val acknowledgements = validation.getValue("acknowledgements-required")
        val admin = send(stack, "POST", "/dashboard/sessions", "", buildJsonObject {
            put("email", stack.adminEmail)
            put("password", stack.adminPassword)
        }, 201).getValue("token").jsonPrimitive.content
        send(stack, "POST", "/inquiry-template-versions/$version/publish", admin, buildJsonObject {
            put("meta", buildJsonObject { put("acknowledgements", acknowledgements); put("publish-note", "Synthetic stackTest version.") })
        }, 200)
        return template
    }

    @Test
    fun `the SDK's own client runs the 10A flow on the stack, with Spanish consent digests, the database step, the screens the branch on session_locale takes, and a stored signal body`() = runBlocking {
        val stack = stack()
        val template = publish(stack)
        // A customer's backend: the inquiry (the sandbox nickname record, C59.2) and its session token.
        val inquiry = send(stack, "POST", "/inquiries", stack.apiKey, buildJsonObject {
            put("data", buildJsonObject {
                put("type", "inquiry")
                put("attributes", buildJsonObject {
                    put("inquiry-template-id", template)
                    put("reference-id", "stack-android-${UUID.randomUUID()} sandbox-database-nickname")
                })
            })
        }, 201).data().getValue("id").jsonPrimitive.content
        val sessionToken = send(stack, "POST", "/inquiries/$inquiry/resume", stack.apiKey, null, 200)
            .getValue("meta").jsonObject.getValue("session-token").jsonPrimitive.content

        val coordinator = FlowCoordinator(
            FlowApiClient(stack.apiUrl, sessionToken),
            inquiry,
            FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 60),
            AndroidDeviceSignals(ApplicationProvider.getApplicationContext<android.content.Context>(), SandboxSignalOutcome.BOT),
        )
        suspend fun until(what: String, predicate: (FlowState) -> Boolean): FlowState =
            withTimeout<FlowState>(60.seconds) {
                coordinator.state.first { state ->
                    check(state !is FlowState.Error && state !is FlowState.Unsupported) { "$what: the flow showed $state" }
                    predicate(state)
                }
            }

        coordinator.start()
        until("consent") { it is FlowState.Consent }
        // C200: the consent body carries the SDK's own digests of the Spanish texts (the server
        // refuses a consent it cannot match, so going on proves they matched), and its locale sets
        // session.locale (D2).
        coordinator.acceptConsent(locale = "es")
        val form = until("the database step") { it is FlowState.Form } as FlowState.Form
        assertTrue(form.step is DatabaseStep)
        coordinator.submitInputs(
            mapOf(
                InputField.NAME_FIRST to "Bob",
                InputField.NAME_LAST to "Quillon",
                InputField.BIRTHDATE to "1984-07-09",
                InputField.ADDRESS_STREET_1 to "12 Example Street",
                InputField.ADDRESS_CITY to "Exampleton",
                InputField.ADDRESS_POSTAL_CODE to "00000",
                InputField.ADDRESS_COUNTRY_CODE to "US",
            ),
        )
        val hello = until("the first screen") { it is FlowState.Screen } as FlowState.Screen
        assertEquals("hello", hello.step.id)
        coordinator.submitScreen(emptyMap(), null)
        val hola = until("the Spanish screen") { it is FlowState.Screen && it.step.id != "hello" } as FlowState.Screen
        assertEquals("hola", (hola.step as ScreenStep).id)
        coordinator.submitScreen(emptyMap(), null)
        val completed = until("the completion") { it is FlowState.Completed } as FlowState.Completed
        assertEquals(InquiryStatus.COMPLETED, completed.inquiryStatus)

        // The signal body was stored, not swallowed: the session's tiers and the SDK's device type,
        // then the sandbox outcome's bot score once the signals job ran on completion.
        val session = send(stack, "GET", "/inquiry-sessions?filter%5Binquiry-id%5D=$inquiry", stack.apiKey, null, 200)
            .getValue("data").jsonArray.single().jsonObject.getValue("attributes").jsonObject
        assertEquals("openverify-android", session.getValue("mobile-sdk-name").jsonPrimitive.contentOrNull)
        assertTrue(session.getValue("signals-collected").jsonArray.map { it.jsonPrimitive.content }.contains("session-integrity"))
        assertNotNull(session.getValue("device-type").jsonPrimitive.contentOrNull)
        val score = withTimeout<Int>(60.seconds) {
            var found: Int? = null
            while (found == null) {
                val attributes = send(stack, "GET", "/inquiries/$inquiry", stack.apiKey, null, 200).attributes()
                found = attributes["signals"]?.jsonArray
                    ?.map { it.jsonObject }
                    ?.firstOrNull { it.getValue("name").jsonPrimitive.content == "inquiry/bot_score" }
                    ?.get("value")?.jsonPrimitive?.intOrNull
                if (found == null) kotlinx.coroutines.delay(1_000)
            }
            found
        }
        assertEquals(95, score)
    }
}
