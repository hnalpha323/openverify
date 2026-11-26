package dev.openverify.sdk.stack

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.testing.StackTests
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * C224.4 (Phase 10, Workflow 10C integration-10c): the 10C NFC flow through the SDK's own
 * `FlowApiClient`, its driver and `SandboxChipReader`, headless, against the reusable e2e stack
 * (`:openverify-sdk:stackTest`, run only under the e2e lock, never in CI), beside 10A's
 * [AndroidFlowStackTest]. It publishes the flow of `e2e/fixtures/android-10c/flow.json` (the flow the
 * API-driven spec `e2e/tests/flow-nfc-android.spec.ts` drives), starts an inquiry as a customer's
 * backend does, and lets the coordinator run it: consent, the Utopia TD3 passport page picked as the
 * ID's one side, person A's selfie picked as stills (the sandbox upload fallback), then the chip step
 * with no reader installed, where the server offers the sandbox test chip. "I'm ready" with the
 * `match` scenario takes the challenge, then the chip the server built; the DG1 review shows the
 * passport's number; confirming uploads the files (never DG2) and submits. The server's own checks
 * pass the verification, labelled `sandbox-chip: match`, and the inquiry completes.
 *
 * A sandbox chip proves the flow and the server's checks, never a reader (C208.4): no NFC hardware,
 * tag or JMRTD code takes part. The stack's API URL and credentials come from
 * `e2e/.artifacts/stack.json` (mode 0600), which this test never prints; the images are the generated
 * synthetic fixtures (`fixtures/generated/`), read by the paths the fixture names. A missing record
 * fails the test: start the stack first (rule 7 (c)).
 */
@RunWith(RobolectricTestRunner::class)
@Category(StackTests::class)
class AndroidNfcFlowStackTest {

    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).followRedirects(false).build()

    /** The stack's API, key and admin, from the reusable stack's record. */
    private class Stack(val apiUrl: String, val apiKey: String, val adminEmail: String, val adminPassword: String)

    private fun property(name: String): String = checkNotNull(System.getProperty(name)) { "$name is not set: run :openverify-sdk:stackTest" }

    private fun file(property: String): File {
        val file = File(property(property))
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
    private fun publish(stack: Stack, fixture: JsonObject): String {
        val name = "stack android nfc ${UUID.randomUUID().toString().take(8)}"
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
    fun `the SDK's own client runs the 10C flow on the stack, reading the sandbox test chip after its challenge, and the server passes it`() = runBlocking {
        val stack = stack()
        val fixture = json.parseToJsonElement(file("openverify.e2e.androidNfcFlow").readText()).jsonObject
        val inputs = fixture.getValue("inputs").jsonObject
        val root = File(property("openverify.e2e.repositoryRoot"))
        fun image(relative: String): CapturedImage {
            val file = File(root, relative)
            check(file.isFile) { "$relative is missing: the e2e stack's start generates fixtures/generated/" }
            return CapturedImage(file.readBytes(), "image/jpeg")
        }
        val template = publish(stack, fixture)
        // A customer's backend: the inquiry, prefilled with the synthetic holder, and its session token.
        val inquiry = send(stack, "POST", "/inquiries", stack.apiKey, buildJsonObject {
            put("data", buildJsonObject {
                put("type", "inquiry")
                put("attributes", buildJsonObject {
                    put("inquiry-template-id", template)
                    put("reference-id", "stack-android-nfc-${UUID.randomUUID()}")
                    put("fields", fixture.getValue("inquiry-fields"))
                })
            })
        }, 201).data().getValue("id").jsonPrimitive.content
        val sessionToken = send(stack, "POST", "/inquiries/$inquiry/resume", stack.apiKey, null, 200)
            .getValue("meta").jsonObject.getValue("session-token").jsonPrimitive.content

        // No chip reader and no NFC seam are installed (NfcEnvironment.None): only the test chip can be read.
        val coordinator = FlowCoordinator(
            FlowApiClient(stack.apiUrl, sessionToken),
            inquiry,
            FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 60),
        )
        suspend fun until(what: String, predicate: (FlowState) -> Boolean): FlowState =
            withTimeout<FlowState>(90.seconds) {
                coordinator.state.first { state ->
                    check(state !is FlowState.Error && state !is FlowState.Unsupported) { "$what: the flow showed $state" }
                    predicate(state)
                }
            }

        coordinator.start()
        until("consent") { it is FlowState.Consent }
        coordinator.acceptConsent(locale = "en")

        // The ID: the passport page, picked from files (a sandbox allows it, C19), kept and sent.
        val front = until("the ID's front") { it is FlowState.Capture && !it.isSelfie } as FlowState.Capture
        assertEquals(FileKind.FRONT, front.kind)
        assertEquals(1, front.count)
        assertTrue("a sandbox lets the person pick a photo", front.uploadAllowed)
        coordinator.pick(image(inputs.getValue("id-front").jsonPrimitive.content))
        coordinator.confirmCapture()

        // The selfie: each prompted pose picked as a still, in the server's order.
        val stills = inputs.getValue("selfie").jsonObject
        val poses = mapOf(FileKind.SELFIE_CENTER to "center", FileKind.SELFIE_LEFT to "left", FileKind.SELFIE_RIGHT to "right")
        val sent = mutableListOf<FileKind>()
        var state = until("the selfie") { it is FlowState.AwaitingCamera || (it is FlowState.Capture && it.isSelfie) || it is FlowState.Nfc }
        while (state !is FlowState.Nfc) {
            when (state) {
                is FlowState.AwaitingCamera -> coordinator.cameraReady()
                is FlowState.Capture -> {
                    val kind = state.kind
                    check(state.image == null && !state.sending) { "the selfie prompt for $kind is not open" }
                    coordinator.pick(image(stills.getValue(poses.getValue(kind)).jsonPrimitive.content))
                    coordinator.confirmCapture()
                    sent += kind
                    check(sent.size <= 6) { "the selfie asked for more than six photos" }
                }
                else -> error("the selfie showed $state")
            }
            val before = state
            state = until("after the selfie's ${sent.size} photo(s)") { next ->
                next is FlowState.Nfc || next is FlowState.AwaitingCamera && next != before ||
                    (next is FlowState.Capture && next.isSelfie && next.image == null && !next.sending && next != before)
            }
        }
        assertTrue("every pose was sent once", sent.containsAll(poses.keys))

        // The chip step: the server offers the fallback and the sandbox test chip, and prefills the
        // access key from the ID's MRZ; with no reader installed the tap screen has the test chip only.
        val chip = state as FlowState.Nfc
        val step: NfcStep = chip.step
        assertTrue(step.fallbackAvailable)
        assertTrue(step.sandboxChipAvailable)
        assertEquals("UP7316408", step.prefillMrz?.documentNumber)
        val tap = chip.view as NfcView.Tap
        assertFalse("no reader is installed", tap.reader)
        assertTrue("the test chip is offered", tap.sandbox)

        coordinator.nfc(NfcEvent.Ready(SandboxChipScenario.MATCH))
        val review = (until("the DG1 review") { it is FlowState.Nfc && it.view is NfcView.Review } as FlowState.Nfc).view as NfcView.Review
        assertEquals("UP7316408", review.details.documentNumber)
        coordinator.nfc(NfcEvent.ReviewConfirmed)

        val completed = withTimeout<FlowState.Completed>(90.seconds) {
            var done: FlowState.Completed? = null
            while (done == null) {
                when (val now = coordinator.state.value) {
                    is FlowState.Completed -> done = now
                    is FlowState.Error, is FlowState.Unsupported -> error("after the chip: the flow showed $now")
                    // The position has not moved yet: the checking screen asks again, as its screen does.
                    is FlowState.Nfc -> if (now.view is NfcView.Checking) coordinator.nfc(NfcEvent.Check) else delay(250)
                    else -> delay(250)
                }
            }
            done
        }
        assertEquals(InquiryStatus.COMPLETED, completed.inquiryStatus)

        // The server's side: the session names the SDK, and the chip verification passed on the
        // server's own checks, labelled as read from a sandbox test chip (C208.4).
        val session = send(stack, "GET", "/inquiry-sessions?filter%5Binquiry-id%5D=$inquiry", stack.apiKey, null, 200)
            .getValue("data").jsonArray.single().jsonObject.getValue("attributes").jsonObject
        assertEquals("openverify-android", session.getValue("mobile-sdk-name").jsonPrimitive.contentOrNull)
        val settled = send(stack, "GET", "/inquiries/$inquiry", stack.apiKey, null, 200).data()
        assertEquals("completed", settled.getValue("attributes").jsonObject.getValue("status").jsonPrimitive.content)
        val read = settled.getValue("relationships").jsonObject.getValue("verifications").jsonObject.getValue("data").jsonArray
            .map { send(stack, "GET", "/verifications/${it.jsonObject.getValue("id").jsonPrimitive.content}", stack.apiKey, null, 200).data() }
            .single { it.getValue("type").jsonPrimitive.content == "verification/government-id-nfc" }
            .getValue("attributes").jsonObject
        assertEquals("passed", read.getValue("status").jsonPrimitive.content)
        assertEquals("match", read.getValue("sandbox-chip").jsonPrimitive.content)
        val required = read.getValue("checks").jsonArray.map { it.jsonObject }.filter { it.getValue("requirement").jsonPrimitive.content == "required" }
        assertTrue("the required NFC checks ran", required.size >= 3)
        assertEquals(emptyList<String>(), required.filter { it.getValue("status").jsonPrimitive.content != "passed" }.map { it.getValue("name").jsonPrimitive.content })
    }
}
