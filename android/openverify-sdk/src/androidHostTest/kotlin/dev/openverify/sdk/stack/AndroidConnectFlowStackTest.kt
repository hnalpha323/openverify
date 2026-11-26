package dev.openverify.sdk.stack

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ShareConsentState
import dev.openverify.sdk.model.ShareConsentSide
import dev.openverify.sdk.testing.StackTests
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import java.nio.ByteBuffer
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.time.Duration.Companion.seconds

/**
 * C287.4 (Workflow 11A integration-11a): the client-side redemption through the SDK's own
 * `FlowApiClient` and driver, headless, against the reusable e2e stack (`:openverify-sdk:stackTest`,
 * run only under the e2e lock, never in CI), beside 10A's [AndroidFlowStackTest] and 10C's
 * [AndroidNfcFlowStackTest]. Two organisations on one install: the sample partner `seed:dev --connect`
 * made (the source) and the dev organisation (the destination, `connect-inbound` on). The test makes
 * (or reuses) an active connection from the partner, activating it as the dev organisation's TOTP
 * admin when it is not (C231.3: a session that verified its second factor just now); then, with the
 * fixture of `e2e/fixtures/android-11a/flow.json`:
 *
 * 1. the source: the SDK runs consent, a one-sided government ID (picked from files, a sandbox
 *    allows it) and the source-side share consent, whose text it shows only after its own digest
 *    check; the partner creates a share token citing the record the accept made;
 * 2. the destination: a customer's backend creates an inquiry with `meta.share-token-id` (the token
 *    reserved for it, never in a URL), and the SDK runs consent and the destination-side share
 *    consent; its accept asks for the `fill-inquiry` redemption, and the token is redeemed onto the
 *    inquiry, which gains a cloned government ID beside the one its own ID step took live
 *    (accept-cloned-results is off: every step runs live, review H01).
 *
 * The stack's API URL and credentials come from `e2e/.artifacts/stack.json` (mode 0600), which this
 * test never prints. A missing record fails the test: start the stack first (rule 7 (c)).
 */
@RunWith(RobolectricTestRunner::class)
@Category(StackTests::class)
class AndroidConnectFlowStackTest {

    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).followRedirects(false).build()

    private class Login(val email: String, val password: String)

    private class Stack(
        val apiUrl: String,
        val apiKey: String,
        val admin: Login,
        val mfaAdmin: Login,
        val totpSecret: String,
        val partnerAdmin: Login,
        val seededConnectionId: String,
    )

    private fun property(name: String): String = checkNotNull(System.getProperty(name)) { "$name is not set: run :openverify-sdk:stackTest" }

    private fun file(property: String): File {
        val file = File(property(property))
        check(file.isFile) { "${file.name} is missing: start the reusable stack (e2e:stack:up) before stackTest" }
        return file
    }

    private fun JsonObject.login(): Login = Login(getValue("email").jsonPrimitive.content, getValue("password").jsonPrimitive.content)

    private fun stack(): Stack {
        val info = json.parseToJsonElement(file("openverify.e2e.stackRecord").readText()).jsonObject.getValue("info").jsonObject
        val mfa = info.getValue("mfaAdmin").jsonObject
        val connect = info.getValue("connect").jsonObject
        return Stack(
            apiUrl = info.getValue("apiUrl").jsonPrimitive.content,
            apiKey = info.getValue("apiKey").jsonPrimitive.content,
            admin = info.getValue("operators").jsonObject.getValue("admin").jsonObject.login(),
            mfaAdmin = mfa.login(),
            totpSecret = mfa.getValue("totpSecret").jsonPrimitive.content,
            partnerAdmin = connect.getValue("partnerAdmin").jsonObject.login(),
            seededConnectionId = connect.getValue("seededConnectionId").jsonPrimitive.content,
        )
    }

    private class Answer(val status: Int, val body: JsonObject)

    /** A JSON request; never prints a token or a credential. */
    private fun call(stack: Stack, method: String, route: String, token: String, body: JsonElement? = null): Answer {
        val request = Request.Builder()
            .url("${stack.apiUrl}/api/v1$route")
            .header("Accept", "application/json")
            .apply { if (token.isNotEmpty()) header("Authorization", "Bearer $token") }
            .method(method, body?.toString()?.toRequestBody("application/json".toMediaType()) ?: if (method == "POST") ByteArray(0).toRequestBody() else null)
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body.string()
            return Answer(response.code, if (text.isEmpty()) JsonObject(emptyMap()) else json.parseToJsonElement(text).jsonObject)
        }
    }

    private fun send(stack: Stack, method: String, route: String, token: String, body: JsonElement? = null, status: Int): JsonObject {
        val answer = call(stack, method, route, token, body)
        assertEquals("$method $route answered ${answer.status}: ${answer.body}", status, answer.status)
        return answer.body
    }

    private fun JsonObject.data(): JsonObject = getValue("data").jsonObject

    private fun JsonObject.attributes(): JsonObject = data().getValue("attributes").jsonObject

    private fun JsonObject.id(): String = data().getValue("id").jsonPrimitive.content

    private fun document(type: String, attributes: JsonObject) = buildJsonObject {
        put("data", buildJsonObject { put("type", type); put("attributes", attributes) })
    }

    private fun signIn(stack: Stack, login: Login): String = send(stack, "POST", "/dashboard/sessions", "", buildJsonObject {
        put("email", login.email)
        put("password", login.password)
    }, 201).getValue("token").jsonPrimitive.content

    /** RFC 6238 over the base32 secret (30 s steps, 6 digits), as the e2e suite's totp.ts. */
    private fun totp(secret: String, step: Long): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        var bits = 0
        var value = 0
        val key = mutableListOf<Byte>()
        for (char in secret.uppercase().trimEnd('=')) {
            value = (value shl 5) or alphabet.indexOf(char)
            bits += 5
            if (bits >= 8) {
                key += ((value shr (bits - 8)) and 0xff).toByte()
                bits -= 8
            }
        }
        val mac = Mac.getInstance("HmacSHA1").apply { init(SecretKeySpec(key.toByteArray(), "HmacSHA1")) }
        val hash = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array())
        val offset = hash.last().toInt() and 0x0f
        val code = ((hash[offset].toInt() and 0x7f) shl 24) or ((hash[offset + 1].toInt() and 0xff) shl 16) or
            ((hash[offset + 2].toInt() and 0xff) shl 8) or (hash[offset + 3].toInt() and 0xff)
        return (code % 1_000_000).toString().padStart(6, '0')
    }

    /** The TOTP admin's session, its second factor verified now (a step's code another sign-in used is retried once). */
    private suspend fun steppedUp(stack: Stack): String {
        val pending = send(stack, "POST", "/dashboard/sessions", "", buildJsonObject {
            put("email", stack.mfaAdmin.email)
            put("password", stack.mfaAdmin.password)
        }, 202).getValue("mfa-token").jsonPrimitive.content
        repeat(2) {
            val step = Instant.now().epochSecond / 30
            val answer = call(stack, "POST", "/dashboard/sessions/mfa", "", buildJsonObject {
                put("mfa-token", pending)
                put("totp-code", totp(stack.totpSecret, step))
            })
            if (answer.status == 201) return answer.body.getValue("token").jsonPrimitive.content
            while (Instant.now().epochSecond / 30 == step) delay(500)
        }
        error("the TOTP admin's second factor was refused twice")
    }

    /** An active connection from the partner to the dev organisation, activated by the destination when needed. */
    private suspend fun activeConnection(stack: Stack, partner: String, policy: JsonObject): String {
        val devOrganization = send(stack, "GET", "/connect/connections/${stack.seededConnectionId}", partner, null, 200)
            .attributes().getValue("source-organization-id").jsonPrimitive.content
        val dev = signIn(stack, stack.admin)
        send(stack, "PATCH", "/dashboard/settings", dev, buildJsonObject { put("connect-inbound", true) }, 200)
        val listed = send(stack, "GET", "/connect/connections?filter%5Bdestination-organization-id%5D=$devOrganization", partner, null, 200)
            .getValue("data").jsonArray.firstOrNull()?.jsonObject
        val id = listed?.getValue("id")?.jsonPrimitive?.content
            ?: send(stack, "POST", "/connect/connections", partner, document("connect/connection", buildJsonObject {
                put("destination-organization-id", devOrganization)
                put("share-policy", policy)
            }), 201).id()
        var connection = send(stack, "GET", "/connect/connections/$id", partner, null, 200).attributes()
        if (connection.getValue("status").jsonPrimitive.content == "inactive") {
            connection = send(stack, "POST", "/connect/connections/$id/reactivate", partner, null, 200).attributes()
        }
        if (connection.getValue("status").jsonPrimitive.content != "active") {
            val version = connection.getValue("share-policy").jsonObject.getValue("version").jsonPrimitive.content.toInt()
            send(stack, "POST", "/dashboard/connect/connections/$id/activate", steppedUp(stack), document("connect/connection", buildJsonObject {
                put("policy-version", version)
                put("agreement-reference", "Synthetic agreement STACK-${UUID.randomUUID().toString().take(8)}")
                put("acknowledged", true)
            }), 200)
        }
        return id
    }

    /** A template with the side's v2 version drafted, validated in publish mode and published by `publisher`. */
    private fun publish(stack: Stack, side: JsonObject, author: String, publisher: String, flow: JsonObject): String {
        val name = "stack android connect ${UUID.randomUUID().toString().take(8)}"
        val template = send(stack, "POST", "/inquiry-templates", author,
            document("inquiry-template", JsonObject(side.getValue("template").jsonObject + ("name" to JsonPrimitive(name)))), 201).id()
        val attributes = side.getValue("version").jsonObject + mapOf("inquiry-template-id" to JsonPrimitive(template), "flow" to flow)
        val version = send(stack, "POST", "/inquiry-template-versions", author, document("inquiry-template-version", JsonObject(attributes)), 201).id()
        val acknowledgements = send(stack, "POST", "/inquiry-template-versions/$version/validate", author, buildJsonObject {
            put("meta", buildJsonObject { put("mode", "publish") })
        }, 200).attributes().getValue("acknowledgements-required")
        send(stack, "POST", "/inquiry-template-versions/$version/publish", publisher, buildJsonObject {
            put("meta", buildJsonObject { put("acknowledgements", acknowledgements); put("publish-note", "Synthetic stackTest version.") })
        }, 200)
        return template
    }

    /** A customer's backend: the inquiry (with `meta`) and its session token. */
    private fun startInquiry(stack: Stack, token: String, template: String, meta: JsonObject?): Pair<String, String> {
        val inquiry = send(stack, "POST", "/inquiries", token, buildJsonObject {
            put("data", buildJsonObject {
                put("type", "inquiry")
                put("attributes", buildJsonObject {
                    put("inquiry-template-id", template)
                    put("reference-id", "stack-android-connect-${UUID.randomUUID()}")
                })
            })
            if (meta != null) put("meta", meta)
        }, 201).id()
        val session = send(stack, "POST", "/inquiries/$inquiry/resume", token, null, 200)
            .getValue("meta").jsonObject.getValue("session-token").jsonPrimitive.content
        return inquiry to session
    }

    private suspend fun FlowCoordinator.until(what: String, predicate: (FlowState) -> Boolean): FlowState =
        withTimeout<FlowState>(90.seconds) {
            state.first { now ->
                check(now !is FlowState.Error && now !is FlowState.Unsupported) { "$what: the flow showed $now" }
                predicate(now)
            }
        }

    @Test
    fun `the SDK's own client consents at the source and redeems client-side at the destination, filling the inquiry`() = runBlocking {
        val stack = stack()
        val fixture = json.parseToJsonElement(file("openverify.e2e.androidConnectFlow").readText()).jsonObject
        val root = File(property("openverify.e2e.repositoryRoot"))
        val partner = signIn(stack, stack.partnerAdmin)
        val connection = activeConnection(stack, partner, fixture.getValue("share-policy").jsonObject)

        // 1. The source: the share consent names this run's connection.
        val source = fixture.getValue("source").jsonObject
        val sourceFlow = source.getValue("version").jsonObject.getValue("flow").jsonObject
        val sourceSteps = JsonArray(sourceFlow.getValue("steps").jsonArray.map { step ->
            val values = step.jsonObject
            if (values.getValue("type").jsonPrimitive.content == "share_consent") JsonObject(values + ("connectionId" to JsonPrimitive(connection))) else values
        })
        val sourceTemplate = publish(stack, source, partner, partner, JsonObject(sourceFlow + ("steps" to sourceSteps)))
        val (sourceInquiry, sourceSession) = startInquiry(stack, partner, sourceTemplate, null)
        val image = File(root, fixture.getValue("inputs").jsonObject.getValue("id-front").jsonPrimitive.content)
        check(image.isFile) { "the generated ID image is missing: the e2e stack's start generates fixtures/generated/" }

        val atSource = FlowCoordinator(FlowApiClient(stack.apiUrl, sourceSession), sourceInquiry, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 90))
        atSource.start()
        atSource.until("the source's consent") { it is FlowState.Consent }
        atSource.acceptConsent(locale = "en")
        atSource.until("the ID's front") { it is FlowState.Capture && !it.isSelfie }
        atSource.pick(CapturedImage(image.readBytes(), "image/jpeg"))
        atSource.confirmCapture()
        val shareOut = atSource.until("the source's share consent") { it is ShareConsentState } as ShareConsentState
        assertEquals(ShareConsentSide.SOURCE, shareOut.view.step.side)
        assertTrue("no biometric text without the biometric category", shareOut.view.step.biometric == null)
        atSource.acceptShareConsent(biometricTicked = false)
        atSource.until("the source's completion") { it is FlowState.Completed }

        val record = send(stack, "GET", "/connect/consent-records?filter%5Bsubject-id%5D=$sourceInquiry", partner, null, 200)
            .getValue("data").jsonArray.single().jsonObject
        assertEquals("flow", record.getValue("attributes").jsonObject.getValue("method").jsonPrimitive.content)
        val token = send(stack, "POST", "/connect/share-tokens", partner, document("connect/share-token", buildJsonObject {
            put("connection-id", connection)
            put("source-id", sourceInquiry)
            put("consent-record-id", record.getValue("id").jsonPrimitive.content)
        }), 201).id()

        // 2. The destination: the token reserved for a new inquiry, then the SDK's accept.
        val destination = fixture.getValue("destination").jsonObject
        val destinationTemplate = publish(stack, destination, stack.apiKey, signIn(stack, stack.admin), destination.getValue("version").jsonObject.getValue("flow").jsonObject)
        val (inquiry, session) = startInquiry(stack, stack.apiKey, destinationTemplate, buildJsonObject { put("share-token-id", token) })
        val atDestination = FlowCoordinator(FlowApiClient(stack.apiUrl, session), inquiry, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 90))
        atDestination.start()
        atDestination.until("the destination's consent") { it is FlowState.Consent }
        atDestination.acceptConsent(locale = "en")
        val shareIn = atDestination.until("the destination's share consent") { it is ShareConsentState } as ShareConsentState
        assertEquals(ShareConsentSide.DESTINATION, shareIn.view.step.side)
        assertFalse("the step's client view names no token", shareIn.view.step.toString().contains("cnst_"))
        atDestination.acceptShareConsent(biometricTicked = false)
        // accept-cloned-results is off (H01): the destination's own ID step runs live.
        atDestination.until("the destination's ID") { it is FlowState.Capture && !it.isSelfie }
        atDestination.pick(CapturedImage(image.readBytes(), "image/jpeg"))
        atDestination.confirmCapture()
        atDestination.until("the destination's completion") { it is FlowState.Completed }

        // The fill-inquiry job redeems the token onto the reserved inquiry.
        val redeemed = withTimeout(90.seconds) {
            var status = ""
            while (status != "redeemed") {
                status = send(stack, "GET", "/connect/share-tokens/$token", stack.apiKey, null, 200).attributes().getValue("status").jsonPrimitive.content
                check(status != "failed") { "the redemption failed" }
                if (status != "redeemed") delay(1_000)
            }
            send(stack, "GET", "/connect/share-tokens/$token", stack.apiKey, null, 200).attributes()
        }
        assertEquals("fill-inquiry", redeemed.getValue("redeem-mode").jsonPrimitive.contentOrNull)
        val verifications = send(stack, "GET", "/inquiries/$inquiry", stack.apiKey, null, 200).data()
            .getValue("relationships").jsonObject.getValue("verifications").jsonObject.getValue("data").jsonArray
        assertEquals("the live government ID and the cloned one", 2,
            verifications.count { it.jsonObject.getValue("type").jsonPrimitive.content == "verification/government-id" })
        val sdk = send(stack, "GET", "/inquiry-sessions?filter%5Binquiry-id%5D=$inquiry", stack.apiKey, null, 200)
            .getValue("data").jsonArray.single().jsonObject.getValue("attributes").jsonObject
        assertEquals("openverify-android", sdk.getValue("mobile-sdk-name").jsonPrimitive.contentOrNull)
    }
}
