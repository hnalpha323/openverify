package dev.openverify.sdk

import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.face.YunetOutputs
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed
import okhttp3.OkHttpClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier

/**
 * The shapes of the public API and seams frozen in Workflow 10A Stage 1a (C190–C192, C204.2,
 * C207.3, C211.2), before the first ABI dump. The behaviour behind them is built in Stage 3
 * (`android-sdk-api`, `android-driver`) and in 10B, 10C and 10E; these tests pin what a host can
 * name and what it can never read (tokens, MRZ values, a CAN, chip bytes).
 */
@OptIn(ExperimentalOpenVerifyApi::class)
internal class PublicApiShapeTest {

    private val token = "ovs_synthetic" + "0".repeat(34)
    private val inquiryId = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
    private val api = "https://verify.example.com"

    @Test
    fun `a request takes a locale and an appearance, and its text shows them but never the token (C190_2)`() {
        val request = OpenVerifyInquiry.Request(inquiryId, token, api, locale = "es", appearance = Appearance.DARK)

        assertEquals("es", request.locale)
        assertEquals(Appearance.DARK, request.appearance)
        assertEquals(null, OpenVerifyInquiry.Request(inquiryId, token, api).locale)
        assertEquals(Appearance.SYSTEM, OpenVerifyInquiry.Request(inquiryId, token, api).appearance)
        assertTrue("locale=es" in request.toString() && "appearance=DARK" in request.toString(), request.toString())
        assertFalse(token in request.toString())
    }

    @Test
    fun `a one-time link takes the compiled-in API, a locale and an appearance (C190_2, decision 65)`() {
        val url = "https://links.example.org/#inquiry-id=$inquiryId&one-time-token=ovo_synthetic${"0".repeat(34)}"
        val link = OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl = api, locale = "ar", appearance = Appearance.LIGHT)

        assertEquals(api, link.apiBaseUrl)
        assertEquals("ar", link.locale)
        assertEquals(Appearance.LIGHT, link.appearance)
        assertNotEquals(link, OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl = api))
        assertTrue("locale=ar" in link.toString(), link.toString())
        assertFalse("ovo_" in link.toString())
    }

    @Test
    fun `the registry holds one set of components, empty until installed (C191_1)`() {
        val before = OpenVerifyAndroid.installed()
        try {
            val empty = OpenVerifyComponents()
            assertNull(empty.chipReader)
            assertNull(empty.faceDetectorFactory)
            assertNull(empty.integrityTokenProvider)
            assertNull(empty.eventListener)
            assertNull(empty.transport)
            assertNull(empty.sandboxSignalOutcome)

            val components = OpenVerifyComponents(
                eventListener = { },
                transport = OpenVerifyAndroidTransport.okHttp(OkHttpClient()),
                sandboxSignalOutcome = SandboxSignalOutcome.BOT,
            )
            OpenVerifyAndroid.install(components)
            assertSame(components, OpenVerifyAndroid.installed())
        } finally {
            OpenVerifyAndroid.install(before)
        }
    }

    @Test
    fun `the sandbox control has two outcomes (C90_9)`() {
        assertEquals(listOf("BOT", "HUMAN"), SandboxSignalOutcome.entries.map { it.name })
    }

    @Test
    fun `each event carries only its closed members (C192_2, C192_3)`() {
        fun members(type: Class<*>): Set<String> =
            type.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.map { it.name }.toSet()

        assertEquals(setOf("inquiryId"), members(OpenVerifyEvent.Started::class.java))
        assertEquals(setOf("stepType"), members(OpenVerifyEvent.StepShown::class.java))
        assertEquals(setOf("granted"), members(OpenVerifyEvent.CameraPermission::class.java))
        assertEquals(setOf("reason"), members(OpenVerifyEvent.CaptureFailed::class.java))
        assertEquals(setOf("stepType"), members(OpenVerifyEvent.Submitted::class.java))
        assertEquals(emptySet<String>(), members(OpenVerifyEvent.Waiting::class.java))
        assertEquals(setOf("result"), members(OpenVerifyEvent.Ended::class.java))
        assertEquals(listOf("CAMERA_UNAVAILABLE", "CAMERA_ERROR", "OUT_OF_MEMORY"), CaptureFailureReason.entries.map { it.name })
        assertEquals(listOf("COMPLETED", "FAILED", "CANCELED"), InquiryResultKind.entries.map { it.name })
    }

    @Test
    fun `an MRZ seed and a CAN never show their values (C207_3, C213_3)`() {
        val seed = BacKeySeed(documentNumber = "L898902C", dateOfBirth = "690806", dateOfExpiry = "940623")
        val can = ChipAccess.Can("123456")

        assertEquals(BacKeySeed.mrzInformation("L898902C", "690806", "940623"), seed.mrzInformation)
        listOf(seed.toString(), ChipAccess.Mrz(seed).toString(), can.toString()).forEach { text ->
            listOf("L898902C", "690806", "940623", "123456").forEach { value -> assertFalse(value in text, text) }
        }
    }

    @Test
    fun `a chip read shows no bytes, and a failed read has a code and a fixed message (C207_3, C213_3)`() {
        val read = ChipRead(
            files = mapOf(FileKind.CHIP_DG1 to byteArrayOf(0x61, 0x5B)),
            activeAuthenticationResponse = byteArrayOf(9, 9),
            deviceReport = ChipDeviceReport(listOf(ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.BAC, ChipDeviceReport.Outcome.SUCCEEDED)), 1200),
        )

        assertFalse("[" in read.toString().substringAfter("ChipRead"), read.toString())
        assertEquals("Chip read failed: tag_lost", ChipReadException(ChipReadFailure.TAG_LOST).message)
        assertEquals(
            listOf("TAG_LOST", "ACCESS_DENIED", "UNSUPPORTED_DOCUMENT", "TIMEOUT", "NFC_DISABLED", "READER_BUSY"),
            ChipReadFailure.entries.map { it.name },
        )
        assertEquals(ChipProgress.Reading(FileKind.CHIP_DG2, 40), ChipProgress.Reading(FileKind.CHIP_DG2, 40))
    }

    @Test
    fun `YuNet's twelve outputs are named as the web names them (C204_2, review F17)`() {
        val outputs = YunetOutputs(
            FloatArray(1), FloatArray(2), FloatArray(3), FloatArray(4), FloatArray(5), FloatArray(6),
            FloatArray(7), FloatArray(8), FloatArray(9), FloatArray(10), FloatArray(11), FloatArray(12),
        )

        assertEquals(
            listOf("cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"),
            YunetOutputs.NAMES,
        )
        assertEquals((1..12).toList(), YunetOutputs.NAMES.map { outputs.tensor(it)?.size })
        assertNull(outputs.tensor("kps_64"))
    }

    @Test
    fun `the seams are interfaces a host or an optional artifact implements (C191_2)`() {
        val reader: ChipReader = object : ChipReader {
            override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead =
                throw ChipReadException(ChipReadFailure.READER_BUSY)
        }
        val factory: FaceDetectorFactory = object : FaceDetectorFactory {
            override fun create(): FaceDetector = throw UnsupportedOperationException()
        }
        val provider: IntegrityTokenProvider = object : IntegrityTokenProvider {
            override suspend fun token(requestHash: String): String? = null
        }

        val components = OpenVerifyComponents(chipReader = reader, faceDetectorFactory = factory, integrityTokenProvider = provider)
        assertSame(reader, components.chipReader)
        assertSame(factory, components.faceDetectorFactory)
        assertSame(provider, components.integrityTokenProvider)
    }
}
