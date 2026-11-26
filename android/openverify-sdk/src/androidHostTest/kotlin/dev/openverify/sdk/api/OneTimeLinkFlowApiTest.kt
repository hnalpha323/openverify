package dev.openverify.sdk.api

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.consent.ConsentEvidence
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileAttributes
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileRelationships
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSelfieCaptureDocument
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.ResourceIdentifier
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfieDeviceSnapshot
import dev.openverify.sdk.model.ToOneRelationship
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.IOException

class OneTimeLinkFlowApiTest {

    private val delegate = FakeFlowApi()
    private val redeems = mutableListOf<Pair<String, String>>()
    private val connected = mutableListOf<String>()

    private fun api(redeem: suspend (String, String) -> RedeemedSession) = OneTimeLinkFlowApi(
        inquiryId = INQUIRY_ID,
        oneTimeToken = ONE_TIME_TOKEN,
        redeem = { inquiryId, token ->
            redeems += inquiryId to token
            redeem(inquiryId, token)
        },
        connect = { token ->
            connected += token
            delegate
        },
    )

    private val redeemed: suspend (String, String) -> RedeemedSession = { _, _ -> RedeemedSession(SESSION_TOKEN, EXPIRES_AT) }

    @Test
    fun `the first call redeems the link, then calls go to a client for the session`() = runTest {
        val api = api(redeemed)
        delegate.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)

        val session = api.getSession()
        api.acceptConsent(listOf("consent.biometric"), "en")
        val created = api.createVerification(VerificationType.GOVERNMENT_ID)
        api.submitVerification(created.id)
        api.getVerification(created.id)

        assertEquals(FakeFlowApi.INQUIRY_ID, session.inquiry.id)
        assertEquals(listOf(INQUIRY_ID to ONE_TIME_TOKEN), redeems)
        assertEquals(listOf(SESSION_TOKEN), connected)
        assertEquals(
            listOf("getSession", "acceptConsent", "createVerification:government-id", "submit", "getVerification"),
            delegate.calls,
        )
    }

    @Test
    fun `calls that race to be first still redeem once`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = api { _, _ ->
            gate.await()
            RedeemedSession(SESSION_TOKEN, EXPIRES_AT)
        }

        val calls = List(3) { async { api.getSession() } }
        gate.complete(Unit)
        calls.awaitAll()

        assertEquals(1, redeems.size)
        assertEquals(1, connected.size)
    }

    @Test
    fun `a redeem that failed on the way is tried again by the next call`() = runTest {
        var attempts = 0
        val api = api { _, _ ->
            if (attempts++ == 0) throw FlowApiException.Network(IOException("offline"))
            RedeemedSession(SESSION_TOKEN, EXPIRES_AT)
        }

        assertThrows<FlowApiException.Network> { api.getSession() }
        api.getSession()

        assertEquals(2, redeems.size)
        assertEquals(listOf(SESSION_TOKEN), connected)
    }

    @Test
    fun `a refused link stays refused, without a second redeem (2D F022)`() = runTest {
        // The server refuses only the first redeem, so only the remembered refusal can keep the
        // link refused: a second redeem would get a session.
        var refused = false
        val api = api { _, _ ->
            if (!refused) {
                refused = true
                throw FlowApiException.LinkRefused(null, null)
            }
            RedeemedSession(SESSION_TOKEN, EXPIRES_AT)
        }

        val first = assertThrows<FlowApiException.LinkRefused> { api.getSession() }
        val again = assertThrows<FlowApiException.LinkRefused> { api.getSession() }
        assertThrows<FlowApiException.LinkRefused> { api.acceptConsent(listOf("consent.biometric"), "en") }

        assertSame(first, again)
        assertEquals(listOf(INQUIRY_ID to ONE_TIME_TOKEN), redeems)
        assertEquals(emptyList<String>(), connected)
        assertEquals(emptyList<String>(), delegate.calls)
    }

    @Test
    fun `the selfie capture calls reach the session's client with every argument (C40, C42_3)`() = runTest {
        val recorded = mutableListOf<Any?>()
        val created = OpenVerifyJson.decodeFromString<FlowSelfieCaptureDocument>(Fixtures.read("flow/selfie-capture-created.json")).data
        val recording = object : FlowApi by delegate {
            override suspend fun acceptConsent(
                textKeys: List<String>,
                locale: String,
                optionalTextKeys: List<String>,
                evidence: ConsentEvidence,
            ): FlowConsent {
                recorded.add(listOf(textKeys, locale, optionalTextKeys))
                return FlowConsent(EXPIRES_AT)
            }

            override suspend fun createSelfieCapture(verificationId: String, method: CaptureMethod): FlowSelfieCapture {
                recorded.add(listOf(verificationId, method))
                return created
            }

            override suspend fun uploadFile(
                verificationId: String,
                kind: FileKind,
                image: CapturedImage,
                capture: SelfieCaptureUpload?,
                captureMethod: CaptureMethod?,
                captureTrigger: CaptureTrigger?,
            ): FileResource {
                recorded.add(listOf(verificationId, kind, capture))
                throw FlowApiException.Network(IOException("recorded"))
            }

            override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification {
                recorded.add(listOf(verificationId, capture))
                throw FlowApiException.Network(IOException("recorded"))
            }
        }
        val api = OneTimeLinkFlowApi(INQUIRY_ID, ONE_TIME_TOKEN, redeem = { _, _ -> RedeemedSession(SESSION_TOKEN, EXPIRES_AT) }) { recording }
        val upload = SelfieCaptureUpload(created.id, created.attributes.nonce, 1_200)
        val submit = FlowSubmitCapture(created.id, created.attributes.nonce, SelfieDeviceSnapshot(imageMirrored = false))
        val image = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")

        api.acceptConsent(listOf("consent.biometric"), "es", listOf("consent.biometric-matching"))
        val capture = api.createSelfieCapture(VERIFICATION_ID, CaptureMethod.UPLOAD)
        assertThrows<FlowApiException.Network> { api.uploadFile(VERIFICATION_ID, FileKind.SELFIE_CENTER, image, upload) }
        assertThrows<FlowApiException.Network> { api.submitVerification(VERIFICATION_ID, submit) }

        assertSame(created, capture)
        assertEquals(
            listOf<Any?>(
                listOf(listOf("consent.biometric"), "es", listOf("consent.biometric-matching")),
                listOf(VERIFICATION_ID, CaptureMethod.UPLOAD),
                listOf(VERIFICATION_ID, FileKind.SELFIE_CENTER, upload),
                listOf(VERIFICATION_ID, submit),
            ),
            recorded,
        )
    }

    @Test
    fun `the Phase 5 calls reach the session's client with every argument (C52_3, C55, C57)`() = runTest {
        val recorded = mutableListOf<Any?>()
        val answered = FakeFlowApi.verification(VERIFICATION_ID, VerificationType.PHONE_NUMBER, VerificationStatus.INITIATED)
        val challenge = FlowCryptoChallenge("cwc_01M5CK16P0D13FXHZSS4TCFBVH", "Sign this", EXPIRES_AT)
        val recording = object : FlowApi by delegate {
            override suspend fun sendOtp(verificationId: String, destination: OtpDestination): FlowVerification {
                recorded.add(listOf("sendOtp", verificationId, destination))
                return answered
            }

            override suspend fun confirmOtp(verificationId: String, code: String): FlowVerification {
                recorded.add(listOf("confirmOtp", verificationId, code))
                return answered
            }

            override suspend fun enterInputs(verificationId: String, inputs: VerificationInputs): FlowVerification {
                recorded.add(listOf("enterInputs", verificationId, inputs))
                return answered
            }

            override suspend fun createCryptoChallenge(verificationId: String, chainId: String, walletAddress: String): FlowCryptoChallenge {
                recorded.add(listOf("createCryptoChallenge", verificationId, chainId, walletAddress))
                return challenge
            }

            override suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification {
                recorded.add(listOf("submitCryptoSignature", verificationId, crypto))
                throw FlowApiException.Network(IOException("recorded"))
            }
        }
        val api = OneTimeLinkFlowApi(INQUIRY_ID, ONE_TIME_TOKEN, redeem = { _, _ -> RedeemedSession(SESSION_TOKEN, EXPIRES_AT) }) { recording }
        val phone = OtpDestination.Phone("+15555550100")
        val inputs = DatabaseInputs(nameFirst = "Jane")
        val crypto = FlowCryptoSubmit(challenge.id, "0xab")

        assertSame(answered, api.sendOtp(VERIFICATION_ID, phone))
        assertSame(answered, api.confirmOtp(VERIFICATION_ID, "123456"))
        assertSame(answered, api.enterInputs(VERIFICATION_ID, inputs))
        assertSame(challenge, api.createCryptoChallenge(VERIFICATION_ID, "eip155:1", "0xabc"))
        assertThrows<FlowApiException.Network> { api.submitCryptoSignature(VERIFICATION_ID, crypto) }

        assertEquals(
            listOf<Any?>(
                listOf("sendOtp", VERIFICATION_ID, phone),
                listOf("confirmOtp", VERIFICATION_ID, "123456"),
                listOf("enterInputs", VERIFICATION_ID, inputs),
                listOf("createCryptoChallenge", VERIFICATION_ID, "eip155:1", "0xabc"),
                listOf("submitCryptoSignature", VERIFICATION_ID, crypto),
            ),
            recorded,
        )
    }

    @Test
    fun `the document upload reaches the session's client with its document (C52_4)`() = runTest {
        val recorded = mutableListOf<Any?>()
        val document = DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf")
        val stored = FileResource(
            "file",
            "file_01M5CK3288G5K9T8DC51K68DDZ",
            FileAttributes(FileKind.DOCUMENT, "application/pdf", document.bytes.size.toLong(), EXPIRES_AT),
            FileRelationships(ToOneRelationship(ResourceIdentifier("verification/document", VERIFICATION_ID))),
        )
        val recording = object : FlowApi by delegate {
            override suspend fun uploadDocument(verificationId: String, document: DocumentFile, captureMethod: CaptureMethod?): FileResource {
                recorded.add(listOf("uploadDocument", verificationId, document))
                return stored
            }
        }
        val api = OneTimeLinkFlowApi(INQUIRY_ID, ONE_TIME_TOKEN, redeem = { _, _ -> RedeemedSession(SESSION_TOKEN, EXPIRES_AT) }) { recording }

        assertSame(stored, api.uploadDocument(VERIFICATION_ID, document))
        assertEquals(listOf<Any?>(listOf("uploadDocument", VERIFICATION_ID, document)), recorded)
    }

    companion object {
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        val ONE_TIME_TOKEN = "ovo_" + "o".repeat(43)
        val SESSION_TOKEN = "ovs_" + "t".repeat(43)
        const val EXPIRES_AT = "2026-10-21T12:00:00.000Z"
    }
}
