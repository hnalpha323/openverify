package dev.openverify.sdk.ui

import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.RetryHint
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource

/**
 * The reason codes a retry hint can carry, shared with the web flow, which keeps the list equal
 * to the contracts (`contracts/fixtures/flow/retry-hint-reasons.json`, C29.4).
 */
internal fun retryHintReasons(): List<String> =
    OpenVerifyJson.parseToJsonElement(Fixtures.read("flow/retry-hint-reasons.json"))
        .jsonObject.getValue("reasons").jsonArray.map { it.jsonPrimitive.content }

internal class MessagesTest {

    @Test
    fun `the consent texts the SDK can show are the default template's`() {
        // C45.1, C42.3: the optional matching consent too; C94.6 (ADR 0006): the collection tiers' notices
        // and the optional device-recognition consent.
        assertEquals(
            setOf(
                "consent.biometric",
                "consent.processing",
                "consent.biometric-matching",
                "notice.session-integrity",
                "notice.device-recognition",
                "notice.play-integrity",
                "consent.device-recognition",
                "consent.automated-decision",
            ),
            ConsentTexts.keys,
        )
        assertEquals(Res.string.openverify_consent_biometric_matching, ConsentTexts.resources["consent.biometric-matching"])
        assertEquals(Res.string.openverify_consent_biometric, ConsentTexts.resources["consent.biometric"])
        assertEquals(Res.string.openverify_consent_processing, ConsentTexts.resources["consent.processing"])
    }

    @Test
    fun `the optional matching consent has its own checkbox label (C42_3)`() {
        assertEquals(
            Res.string.openverify_consent_biometric_matching_checkbox,
            ConsentTexts.optionalCheckboxes["consent.biometric-matching"],
        )
        // C94.6: the optional device-recognition consent is offered with its own checkbox too.
        // C128.4: the optional automated-decision consent has its own checkbox as well.
        assertEquals(
            setOf("consent.biometric-matching", "consent.device-recognition", "consent.automated-decision"),
            ConsentTexts.optionalCheckboxes.keys,
        )
    }

    @Test
    fun `a consent text names the session's retention days in place of the days placeholder`() {
        assertEquals("A template is kept for 365 days.", consentText("A template is kept for {{days}} days.", 365))
    }

    @Test
    fun `a text that names the retention days is not offered when the session gives none`() {
        assertNull(consentText("A template is kept for {{days}} days.", null))
    }

    @Test
    fun `a text without the days placeholder is shown as it is`() {
        assertEquals("We compare a selfie.", consentText("We compare a selfie.", null))
        assertEquals("We compare a selfie.", consentText("We compare a selfie.", 30))
    }

    @Test
    fun `every Phase 1 user-fixable reason has its own message`() {
        val expected = mapOf(
            "image_blurry" to Res.string.openverify_retry_image_blurry,
            "glare_present" to Res.string.openverify_retry_glare_present,
            "portrait_not_present" to Res.string.openverify_retry_portrait_not_present,
            "front_not_present" to Res.string.openverify_retry_front_not_present,
            "back_not_present" to Res.string.openverify_retry_back_not_present,
            "image_too_dark" to Res.string.openverify_retry_image_too_dark,
            "image_too_bright" to Res.string.openverify_retry_image_too_bright,
            "face_not_present" to Res.string.openverify_retry_face_not_present,
            "multiple_faces_present" to Res.string.openverify_retry_multiple_faces_present,
        )

        assertEquals(expected, expected.keys.associateWith(::retryReasonMessage))
    }

    @Test
    fun `every reason a retry hint can carry has its own message (C29_4)`() {
        val reasons = retryHintReasons()
        val generic = reasons.filter { retryReasonMessage(it) == Res.string.openverify_retry_generic }

        assertTrue(reasons.isNotEmpty())
        assertEquals(emptyList<String>(), generic)
        assertEquals(reasons.size, reasons.map(::retryReasonMessage).toSet().size, "two reasons share a message")
    }

    @Test
    fun `an unknown reason gets the generic message`() {
        // `document_expired` became a known reason in Phase 5 (C51.2); a newer server's code is not.
        assertEquals(Res.string.openverify_retry_generic, retryReasonMessage("reason_from_a_newer_server"))
    }

    @Test
    fun `retry messages are listed once each, in order`() {
        val hints = listOf(
            RetryHint("id_blur_detection", listOf("image_blurry")),
            RetryHint("selfie_image_quality_detection", listOf("image_blurry", "image_too_dark")),
            RetryHint("id_double_side_detection", emptyList()),
        )

        assertEquals(
            listOf(Res.string.openverify_retry_image_blurry, Res.string.openverify_retry_image_too_dark, Res.string.openverify_retry_generic),
            retryMessages(hints),
        )
        assertEquals(emptyList<Int>(), retryMessages(emptyList()))
    }

    @Test
    fun `terminal messages come from the step's message key`() {
        assertEquals(Res.string.openverify_flow_completion, completionMessage("flow.completion"))
        assertEquals(Res.string.openverify_flow_completion, completionMessage("flow.custom"))
        assertEquals(Res.string.openverify_flow_completion, completionMessage(null))
        assertEquals(Res.string.openverify_flow_failure, failureMessage("flow.failure"))
        assertEquals(Res.string.openverify_flow_failure, failureMessage(null))
    }

    @ParameterizedTest
    @EnumSource(FlowError::class)
    fun `every flow error has its own message`(error: FlowError) {
        val messages = FlowError.entries.map(::errorMessage)

        assertEquals(messages.size, messages.toSet().size)
        assertEquals(1, messages.count { it == errorMessage(error) })
    }

    @Test
    fun `each capture kind has its own title, instruction and photo description`() {
        assertEquals(
            CaptureCopy(Res.string.openverify_id_front_title, Res.string.openverify_id_front_instruction, Res.string.openverify_id_front_photo),
            captureCopy(FileKind.FRONT),
        )
        assertEquals(
            CaptureCopy(Res.string.openverify_selfie_right_title, Res.string.openverify_selfie_right_instruction, Res.string.openverify_selfie_right_photo),
            captureCopy(FileKind.SELFIE_RIGHT),
        )
        val all = FileKind.entries.mapNotNull(::captureCopy)
        assertEquals(all.size, all.map { it.title }.toSet().size)
    }

    @Test
    fun `only the ID sides, the portrait, the selfie poses and a document's photo have capture copy (C52_4, C64_2)`() {
        assertEquals(
            listOf(
                FileKind.FRONT,
                FileKind.BACK,
                FileKind.PORTRAIT,
                FileKind.SELFIE_CENTER,
                FileKind.SELFIE_LEFT,
                FileKind.SELFIE_RIGHT,
                FileKind.DOCUMENT,
            ),
            FileKind.entries.filter { captureCopy(it) != null },
        )
    }
}
