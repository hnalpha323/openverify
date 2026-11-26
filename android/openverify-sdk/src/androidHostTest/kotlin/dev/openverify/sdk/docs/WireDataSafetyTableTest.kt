package dev.openverify.sdk.docs

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.OneTimeLinkClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.consent.ConsentEvidence
import dev.openverify.sdk.model.FlowShareConsentAcceptBody
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.AndroidRecognitionSignals
import dev.openverify.sdk.model.BusinessWebsiteInputs
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.CryptoSignatureScheme
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FacingMode
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipDeviceReport
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowChipSubmitBody
import dev.openverify.sdk.model.FlowClientUnableBody
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowCryptoSubmitBody
import dev.openverify.sdk.model.FlowSandboxChipBody
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowSubmitVerificationBody
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.ResizeMode
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfieDeviceCapabilities
import dev.openverify.sdk.model.SelfieDeviceSettings
import dev.openverify.sdk.model.SelfieDeviceSnapshot
import dev.openverify.sdk.model.SelfieFrameStats
import dev.openverify.sdk.model.VerificationType
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartReader
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.5 (decision 66; review P04): `docs/android/privacy.md` holds a fixed table from each wire
 * member the SDK sends to its Google Play Data safety category, and this test fails when a member
 * has no row. "The members the SDK sends" are taken three ways, and each must be covered:
 *
 * 1. what the real [FlowApiClient] and [OneTimeLinkClient] put on the wire, call by call, over
 *    Ktor's `MockEngine` (the headers, the query, the JSON members, the multipart fields and the file
 *    part), with every [FlowApi] method required to be in the call table, so a new route cannot be
 *    added without its rows;
 * 2. every member of the request models, optional ones included, from their serial descriptors
 *    (`FlowSignals` with `android-integrity` and its lists, `android-recognition`, `device-class` and
 *    `sandbox-outcome`; the selfie submit's camera snapshot; the typed inputs; the chip submit,
 *    client-unable and sandbox-chip bodies);
 * 3. every committed request fixture under `contracts/fixtures/flow-requests/android/` that
 *    `index.json` lists (C224.4), so a fixture a later agent writes is held to the table too.
 *
 * The other direction holds as well: a row that names a request or member the SDK does not send
 * fails, the categories are a closed list, and the SDK README's Data safety table names exactly
 * the categories the table uses. Values are synthetic. Nothing here touches the network.
 */
internal class WireDataSafetyTableTest {

    @Test
    fun `every header, query member, body member and file part the real client sends has a row`() {
        val missing = captured.flatMap { sent -> sent.members.map { Row(sent.request, it) } }.distinct() - rows.keys
        assertEquals(emptyList<Row>(), missing.sortedBy { it.toString() }, "$TABLE has no row for what FlowApiClient sends")
    }

    @Test
    fun `every member of the request models has a row, optional ones included`() {
        val missing = modelMembers.distinct() - rows.keys
        assertEquals(emptyList<Row>(), missing.sortedBy { it.toString() }, "$TABLE has no row for a member of a request model")
    }

    @Test
    fun `every committed request fixture's members have rows, and every listed route is in the table`() {
        val missing = fixtureMembers.distinct() - rows.keys
        assertEquals(emptyList<Row>(), missing.sortedBy { it.toString() }, "$TABLE has no row for a member of a request fixture")
        val routes = rows.keys.map { it.request }.toSet()
        assertEquals(emptyList<String>(), (indexRequests - routes).sorted(), "$TABLE has no row for a route of index.json")
    }

    @Test
    fun `every method of FlowApi is in the call table or is named as sending nothing of its own`() {
        // A method that takes a value class (a Duration) has a mangled JVM name: `pollVerification-<hash>`.
        val methods = FlowApi::class.java.declaredMethods.filterNot { it.isSynthetic || '$' in it.name }.map { it.name.substringBefore('-') }.toSet()
        assertEquals(methods.sorted(), (calls.map { it.method }.toSet() - ONE_TIME_LINK + NO_REQUEST_OF_ITS_OWN).sorted())
    }

    @Test
    fun `every call reaches its route, the NFC calls included`() {
        val silent = calls.filter { call -> captured.none { it.call == call.name } }.map { it.method }
        assertEquals(emptyList<String>(), silent, "a call sent nothing")
        captured.filter { it.request != EVERY_REQUEST }.forEach { sent ->
            val pattern = Regex(sent.request.substringAfter(' ').replace(Regex(":[A-Za-z]+"), "[^/]+"))
            assertTrue(pattern.matches(sent.path)) { "${sent.call} reached ${sent.path}, not ${sent.request}" }
        }
    }

    @Test
    fun `no row names a request or a member the SDK does not send`() {
        val sentRows = (captured.flatMap { sent -> sent.members.map { Row(sent.request, it) } } + modelMembers + fixtureMembers).toSet()
        val known = captured.map { it.request }.toSet() + indexRequests + EVERY_REQUEST
        val stale = rows.keys.filterNot { row ->
            // A body-less row is checked against the calls; a route whose encoder is not built yet is only known by index.json.
            if (row.member == NO_BODY) row.request in known && (row in sentRows || captured.none { it.request == row.request }) else row in sentRows
        }
        assertEquals(emptyList<Row>(), stale.sortedBy { it.toString() }, "$TABLE has a row for something the SDK does not send")
    }

    @Test
    fun `every row's category is one of the fixed list`() {
        val unknown = rows.filterValues { categories -> categories.any { it !in CATEGORIES } }
        assertEquals(emptyMap<Row, Set<String>>(), unknown)
        assertTrue(rows.isNotEmpty()) { "$TABLE holds no table between $START and $END" }
    }

    @Test
    fun `the README's Data safety table names exactly the categories the table uses`() {
        val readme = File(README).takeIf { it.exists() }?.readText().orEmpty()
        val section = readme.substringAfter("### Google Play Data safety", "").substringBefore("\n## ")
        val named = section.lines().filter { it.startsWith("|") }.mapNotNull { line ->
            BOLD.find(line.split("|").getOrElse(3) { "" })?.groupValues?.get(1)?.trimEnd(':')
        }.toSet()
        assertEquals((rows.values.flatten().toSet() - NONE).sorted(), named.sorted(), "the README's Data safety table and $TABLE disagree")
        assertTrue("docs/android/privacy.md" in section) { "the README's Data safety section links the table" }
    }

    /** One table row's key: the request (`POST /api/v1/flow/consent`, or [EVERY_REQUEST]) and the member. */
    private data class Row(val request: String, val member: String) {
        override fun toString(): String = "$request | $member"
    }

    /** One request as the client put it on the wire. */
    private class Sent(val call: String, val request: String, val path: String, val members: List<String>)

    /** One call of the real client: the [FlowApi] method it covers and the route it must reach. */
    private class Call(val method: String, val request: String, val variant: String = "", val run: suspend (HttpClient) -> Unit) {
        val name: String get() = if (variant.isEmpty()) method else "$method ($variant)"
    }

    private companion object {
        const val TABLE = "docs/android/privacy.md"
        const val README = "README.md"
        const val START = "<!-- wire-members:start -->"
        const val END = "<!-- wire-members:end -->"
        const val EVERY_REQUEST = "Every request"
        const val NO_BODY = "(no body)"
        const val NONE = "None"

        /** Google Play's Data safety data-type groups this SDK's members fall under, and [NONE] for protocol members. */
        val CATEGORIES = setOf("Photos", "Personal info", "Device or other IDs", "App info and performance", "App activity", "Files and docs", "Financial info", NONE)

        /** `pollVerification` only repeats `getVerification`. */
        val NO_REQUEST_OF_ITS_OWN = setOf("pollVerification")
        /** [OneTimeLinkClient.redeem], which is not a [FlowApi] method. */
        const val ONE_TIME_LINK = "redeem"

        /** Members whose keys the operator's template names (the screen's field keys): one row, `values.*`. */
        val OPAQUE = mapOf("POST /api/v1/flow/screens/:stepId/submit" to setOf("values"))

        val CODE = Regex("`([^`]+)`")
        val BOLD = Regex("""\*\*([^*]+)\*\*""")
        val DISPOSITION_NAME = Regex("""\bname="([^"]*)"""")

        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_" + "t".repeat(43)
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CAPTURE_ID = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val NONCE = "E2eSyntheticNonce00000"
        const val CHIP_CHALLENGE = "chc_01M5CK16P0D13FXHZSS4TCFBVJ"
        const val CHIP_NONCE = "00112233445566ff"
        val JPEG = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10)

        private const val FLOW = "/api/v1/flow"
        private const val VERIFICATION = "$FLOW/verifications/:id"

        private fun client(http: HttpClient) = FlowApiClient(BASE, TOKEN, http)

        /** Every optional member set, so the wire shows it. */
        val calls: List<Call> = listOf(
            Call("getSession", "GET $FLOW/session") { client(it).getSession() },
            Call("acceptConsent", "POST $FLOW/consent") {
                client(it).acceptConsent(
                    listOf("consent.biometric"),
                    "en",
                    listOf("consent.device-recognition"),
                    ConsentEvidence(listOf("0".repeat(64), "1".repeat(64)), "built-in", "android-0.1.0-0000000000000000"),
                )
            },
            Call("createVerification", "POST $FLOW/verifications") { client(it).createVerification(VerificationType.GOVERNMENT_ID, "US", "dl") },
            Call("createSelfieCapture", "POST $VERIFICATION/selfies") { client(it).createSelfieCapture(VERIFICATION_ID, CaptureMethod.CAMERA) },
            Call("uploadFile", "POST $VERIFICATION/files") {
                client(it).uploadFile(
                    VERIFICATION_ID,
                    FileKind.SELFIE_LEFT,
                    CapturedImage(JPEG, "image/jpeg"),
                    capture = SelfieCaptureUpload(CAPTURE_ID, NONCE, clientElapsedMs = 6_250),
                    captureMethod = CaptureMethod.CAMERA,
                    captureTrigger = CaptureTrigger.AUTO,
                )
            },
            Call("uploadDocument", "POST $VERIFICATION/files") {
                client(it).uploadDocument(VERIFICATION_ID, DocumentFile("%PDF-1.7\n%%EOF\n".encodeToByteArray(), "application/pdf"), CaptureMethod.UPLOAD)
            },
            Call("submitVerification", "POST $VERIFICATION/submit", "no capture") { client(it).submitVerification(VERIFICATION_ID) },
            Call("submitVerification", "POST $VERIFICATION/submit", "a selfie capture") {
                val device = SelfieDeviceSnapshot(
                    label = "0",
                    settings = SelfieDeviceSettings(1280, 960, 30.0, FacingMode.entries.first(), ResizeMode.entries.first()),
                    capabilities = SelfieDeviceCapabilities(1920, 1440, 30.0, listOf(FacingMode.entries.first())),
                    frameStats = SelfieFrameStats(10, 0, 10),
                    webdriver = false,
                    imageMirrored = false,
                )
                client(it).submitVerification(VERIFICATION_ID, FlowSubmitCapture(CAPTURE_ID, NONCE, device))
            },
            Call("getVerification", "GET $VERIFICATION") { client(it).getVerification(VERIFICATION_ID) },
            Call("sendOtp", "POST $VERIFICATION/otp", "phone") { client(it).sendOtp(VERIFICATION_ID, OtpDestination.Phone("+15555550100")) },
            Call("sendOtp", "POST $VERIFICATION/otp", "email") { client(it).sendOtp(VERIFICATION_ID, OtpDestination.Email("jane.example@example.com")) },
            Call("confirmOtp", "POST $VERIFICATION/otp/confirm") { client(it).confirmOtp(VERIFICATION_ID, "000000") },
            Call("enterInputs", "POST $VERIFICATION/inputs") {
                client(it).enterInputs(VERIFICATION_ID, DatabaseInputs(nameFirst = "Jane", nameLast = "Example", birthdate = "1990-04-23"))
            },
            Call("createCryptoChallenge", "POST $VERIFICATION/crypto-challenges") {
                client(it).createCryptoChallenge(VERIFICATION_ID, "eip155:1", "0x" + "0".repeat(40))
            },
            Call("submitCryptoSignature", "POST $VERIFICATION/submit") {
                val crypto = FlowCryptoSubmit("cwc_01M5CK16P0D13FXHZSS4TCFBVK", "0x" + "0".repeat(130), "synthetic message", CryptoSignatureScheme.entries.first())
                client(it).submitCryptoSignature(VERIFICATION_ID, crypto)
            },
            Call("sendSignals", "POST $FLOW/signals") {
                client(it).sendSignals(
                    FlowSignals(
                        collectorVersion = 1,
                        screen = "consent",
                        sequence = 0,
                        androidIntegrity = AndroidIntegritySignals(false, true, listOf("build_product_sdk"), emptyList(), listOf("frida_thread_name")),
                        androidRecognition = AndroidRecognitionSignals("00112233445566ff"),
                        deviceClass = "smartphone",
                        sandboxOutcome = "bot",
                    ),
                )
            },
            Call("submitScreen", "POST $FLOW/screens/:stepId/submit") {
                client(it).submitScreen("details", mapOf("first_name" to FlowValue.Text("Jane")), "next")
            },
            Call("extendSelfieCapture", "POST $FLOW/selfie-captures/:id/extend") { client(it).extendSelfieCapture(CAPTURE_ID) },
            Call("fetchThemeAsset", "GET $FLOW/theme-assets/:id") { client(it).fetchThemeAsset("tsa_01M5CK16P0D13FXHZSS4TCFBVM") },
            Call("createIntegrityChallenge", "POST $FLOW/integrity-challenges") { client(it).createIntegrityChallenge() },
            Call("sendIntegrityToken", "POST $FLOW/integrity-tokens") {
                client(it).sendIntegrityToken("ich_01M5CK16P0D13FXHZSS4TCFBVN", "sandbox-synthetic-token")
            },
            Call("createChipChallenge", "POST $VERIFICATION/chip-challenges") { client(it).createChipChallenge(VERIFICATION_ID) },
            Call("uploadChipFile", "POST $VERIFICATION/files") { client(it).uploadChipFile(VERIFICATION_ID, FileKind.CHIP_DG1, byteArrayOf(0x61, 0x00)) },
            Call("submitChip", "POST $VERIFICATION/submit") {
                val report = FlowChipDeviceReport(listOf(FlowChipDeviceReport.Attempt("bac", "succeeded")), 1_200)
                client(it).submitChip(VERIFICATION_ID, FlowChipSubmit(CHIP_CHALLENGE, CHIP_NONCE, "AAAA", report))
            },
            Call("reportClientUnable", "POST $VERIFICATION/client-unable") {
                client(it).reportClientUnable(VERIFICATION_ID, ClientUnableReason.NFC_UNAVAILABLE)
            },
            Call("requestSandboxChip", "POST $VERIFICATION/sandbox-chip") {
                client(it).requestSandboxChip(VERIFICATION_ID, CHIP_CHALLENGE, SandboxChipScenario.MATCH)
            },
            // C238.4, C237.6 (Workflow 11A, clients-connect): the share-consent exits.
            Call("acceptShareConsent", "POST $FLOW/share-consents/:stepId/accept") {
                client(it).acceptShareConsent("share_back", "0".repeat(64), "1".repeat(64), explicitBiometric = true)
            },
            Call("declineShareConsent", "POST $FLOW/share-consents/:stepId/decline") { client(it).declineShareConsent("share_back") },
            Call("withdrawShareConsent", "POST $FLOW/share-consents/:stepId/withdraw") { client(it).withdrawShareConsent("share_back") },
            // Not a FlowApi method: the one-time link's redemption, before any session exists.
            Call(ONE_TIME_LINK, "POST $FLOW/one-time-links/redeem") { OneTimeLinkClient(BASE, it).redeem(INQUIRY_ID, "ovo_" + "o".repeat(43)) },
        )

        /** The request models whose optional members a single call may leave out, by the request that carries each. */
        val models: List<Pair<String, SerialDescriptor>> = listOf(
            "POST $FLOW/signals" to FlowSignals.serializer().descriptor,
            "POST $VERIFICATION/submit" to FlowSubmitVerificationBody.serializer().descriptor,
            "POST $VERIFICATION/submit" to FlowCryptoSubmitBody.serializer().descriptor,
            "POST $VERIFICATION/submit" to FlowChipSubmitBody.serializer().descriptor,
            "POST $VERIFICATION/inputs" to DatabaseInputs.serializer().descriptor,
            "POST $VERIFICATION/inputs" to AamvaInputs.serializer().descriptor,
            "POST $VERIFICATION/inputs" to DatabaseBusinessInputs.serializer().descriptor,
            "POST $VERIFICATION/inputs" to BusinessWebsiteInputs.serializer().descriptor,
            "POST $VERIFICATION/otp" to OtpDestination.Phone.serializer().descriptor,
            "POST $VERIFICATION/otp" to OtpDestination.Email.serializer().descriptor,
            "POST $VERIFICATION/client-unable" to FlowClientUnableBody.serializer().descriptor,
            "POST $VERIFICATION/sandbox-chip" to FlowSandboxChipBody.serializer().descriptor,
            "POST $FLOW/share-consents/:stepId/accept" to FlowShareConsentAcceptBody.serializer().descriptor,
        )

        /** The table: each row's categories, a member with several rows (a file part by kind) holding each. */
        val rows: Map<Row, Set<String>> by lazy {
            val file = File("../../$TABLE")
            val text = if (file.exists()) file.readText() else ""
            val table = text.substringAfter(START, "").substringBefore(END)
            val parsed = table.lines().filter { it.startsWith("|") }.drop(2).flatMap { line ->
                val cells = line.split("|").map { it.trim() }
                val request = cells[1].replace("`", "")
                val members = CODE.findAll(cells[2]).map { it.groupValues[1] }.toList().ifEmpty { listOf(cells[2]) }
                members.map { Row(request, it) to cells[3].replace("*", "") }
            }
            parsed.groupBy({ it.first }, { it.second }).mapValues { it.value.toSet() }
        }

        val captured: List<Sent> by lazy { runBlocking { calls.flatMap { capture(it) } } }

        val modelMembers: List<Row> by lazy { models.flatMap { (request, descriptor) -> members(descriptor, "").map { Row(request, it) } } }

        private val index: List<JsonObject> by lazy {
            val text = File("../../contracts/fixtures/flow-requests/android/index.json").readText()
            ((OpenVerifyJson.parseToJsonElement(text) as JsonObject).getValue("entries") as JsonArray).map { it as JsonObject }
        }

        private fun JsonObject.text(name: String): String = (getValue(name) as JsonPrimitive).content

        val indexRequests: Set<String> by lazy { index.map { "${it.text("method")} ${it.text("route")}" }.toSet() }

        val fixtureMembers: List<Row> by lazy {
            index.flatMap { entry ->
                val request = "${entry.text("method")} ${entry.text("route")}"
                val file = File("../../contracts/fixtures/flow-requests/android", entry.text("file"))
                if (!file.exists()) return@flatMap emptyList()
                val body = OpenVerifyJson.parseToJsonElement(file.readText()) as JsonObject
                val members = if (entry.text("file").endsWith(".multipart.json")) {
                    (body.getValue("fields") as JsonObject).keys + (body.getValue("file") as JsonObject).text("name")
                } else {
                    members(body, "", OPAQUE[request].orEmpty()).ifEmpty { listOf(NO_BODY) }
                }
                members.map { Row(request, it) }
            }
        }

        /** Runs one call against an engine that records the request and answers 500, which the client reports. */
        private suspend fun capture(call: Call): List<Sent> {
            val sent = mutableListOf<Sent>()
            val engine = MockEngine { request ->
                val headers = request.headers.names().map { Row(EVERY_REQUEST, it) }
                val query = request.url.parameters.names().map { "?$it" }
                val type = request.body.contentType
                val bytes = request.body.toByteArray()
                val body = when {
                    bytes.isEmpty() -> emptyList()
                    type?.contentType == "multipart" -> multipartMembers(type.toString(), bytes)
                    else -> members(OpenVerifyJson.parseToJsonElement(bytes.decodeToString()) as JsonObject, "", OPAQUE[call.request].orEmpty())
                }
                sent += Sent(call.name, call.request, request.url.encodedPath, (query + body).ifEmpty { listOf(NO_BODY) })
                headers.forEach { sent += Sent(call.name, it.request, request.url.encodedPath, listOf(it.member)) }
                respond("", HttpStatusCode.InternalServerError)
            }
            try {
                call.run(flowHttpClient(engine))
            } catch (_: FlowApiException) {
                // The 500 above: the request was recorded before it.
            }
            // A header row is every request's, so it is not held to one route's pattern.
            return sent.filter { it.request != EVERY_REQUEST } +
                sent.filter { it.request == EVERY_REQUEST }.map { Sent(call.name, EVERY_REQUEST, "", it.members) }
        }

        private fun multipartMembers(contentType: String, body: ByteArray): List<String> {
            val names = mutableListOf<String>()
            MultipartReader(Buffer().write(body), checkNotNull(contentType.toMediaType().parameter("boundary"))).use { reader ->
                generateSequence { reader.nextPart() }.forEach { part ->
                    names += checkNotNull(DISPOSITION_NAME.find(checkNotNull(part.headers["Content-Disposition"]))).groupValues[1]
                    part.body.readByteArray()
                }
            }
            return names
        }

        /** A JSON body's leaf members: `a.b`, `a[].b` inside an array of objects, `a.*` for an [opaque] map. */
        private fun members(value: JsonObject, prefix: String, opaque: Set<String>): List<String> = value.entries.flatMap { (key, member) ->
            val name = prefix + key
            when {
                key in opaque && prefix.isEmpty() -> listOf("$name.*")
                member is JsonObject -> members(member, "$name.", emptySet())
                member is JsonArray && member.any { it is JsonObject } -> member.flatMap { members(it as JsonObject, "$name[].", emptySet()) }.distinct()
                else -> listOf(name)
            }
        }

        /** A request model's leaf members, by the same names. */
        private fun members(descriptor: SerialDescriptor, prefix: String): List<String> =
            (0 until descriptor.elementsCount).flatMap { index ->
                val name = prefix + descriptor.getElementName(index)
                val element = descriptor.getElementDescriptor(index)
                when (element.kind) {
                    StructureKind.CLASS, StructureKind.OBJECT -> members(element, "$name.")
                    StructureKind.MAP -> listOf("$name.*")
                    StructureKind.LIST -> element.getElementDescriptor(0).let { item ->
                        if (item.kind == StructureKind.CLASS) members(item, "$name[].") else listOf(name)
                    }
                    else -> listOf(name)
                }
            }
    }
}
