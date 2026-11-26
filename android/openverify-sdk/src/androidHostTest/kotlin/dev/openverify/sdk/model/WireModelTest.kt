package dev.openverify.sdk.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/** Forward compatibility: what the SDK does with values a newer server may send. */
class WireModelTest {

    private fun flowWith(stepJson: String): Flow = OpenVerifyJson.decodeFromString(
        """{"metadata":{"specVersion":1,"id":"f","version":1,"name":"F"},"steps":[$stepJson],"transitions":[]}""",
    )

    @ParameterizedTest(name = "{0}")
    @ValueSource(
        strings = [
            """{"id":"details","type":"form","fields":[{"type":"email","name":"email","labelKey":"x","required":true}]}""",
            """{"id":"call","type":"video_call","provider":"example"}""",
        ],
    )
    fun `a step type the SDK does not render decodes as Unsupported and keeps its type`(stepJson: String) {
        val raw = OpenVerifyJson.parseToJsonElement(stepJson).jsonObject
        val step = flowWith(stepJson).steps.single()

        assertEquals(
            UnsupportedStep(
                id = (raw.getValue("id") as JsonPrimitive).content,
                type = (raw.getValue("type") as JsonPrimitive).content,
            ),
            step,
        )
    }

    @Test
    fun `a known step type with a value this SDK cannot use decodes as Unsupported`() {
        val step = flowWith(
            """{"id":"gov","type":"government_id","sides":"all_pages","maxAttempts":3,"captureMethods":["camera"]}""",
        ).steps.single()

        assertEquals(UnsupportedStep(id = "gov", type = "government_id"), step)
    }

    @Test
    fun `a step without a type is a malformed flow`() {
        assertThrows<SerializationException> { flowWith("""{"id":"x"}""") }
    }

    @Test
    fun `a step without an id is a malformed flow`() {
        assertThrows<SerializationException> { flowWith("""{"type":"completion"}""") }
    }

    @Test
    fun `optional government-id restrictions decode when present`() {
        val step = flowWith(
            """{"id":"gov","type":"government_id","sides":"front","allowedCountries":["US","CA"],
               "allowedIdClasses":["passport"],"maxAttempts":2,"captureMethods":["camera"]}""",
        ).steps.single()

        assertEquals(
            GovernmentIdStep(
                id = "gov",
                sides = DocumentSides.FRONT,
                allowedCountries = listOf("US", "CA"),
                allowedIdClasses = listOf("passport"),
                maxAttempts = 2,
                captureMethods = listOf(CaptureMethod.CAMERA),
            ),
            step,
        )
    }

    @Test
    fun `flow steps keep their type name`() {
        val types = ContractFixturesTest.DEFAULT_FLOW_STEPS.map { it.type }

        assertEquals(listOf("consent", "government_id", "selfie", "completion", "failure"), types)
    }

    @Test
    fun `a flow round-trips through JSON, including unsupported steps`() {
        val flow = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json")).flow
            .let { it.copy(steps = it.steps + UnsupportedStep(id = "call", type = "video_call")) }

        val encoded = OpenVerifyJson.encodeToString(Flow.serializer(), flow)

        assertEquals(flow, OpenVerifyJson.decodeFromString<Flow>(encoded))
    }

    @Test
    fun `statuses this SDK does not know decode as UNKNOWN`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(
            Fixtures.read("api/flow-session.json")
                .replace("\"status\": \"pending\"", "\"status\": \"on_hold\"")
                .replace("\"status\": \"initiated\"", "\"status\": \"escalated\""),
        )
        val check = OpenVerifyJson.decodeFromString<VerificationCheck>(
            """{"name":"id_blur_detection","status":"queued","reasons":[],"requirement":"advisory","metadata":{}}""",
        )

        assertEquals(InquiryStatus.UNKNOWN, session.inquiry.status)
        assertEquals(VerificationStatus.UNKNOWN, session.verifications[1].attributes.status)
        assertEquals(CheckStatus.UNKNOWN, check.status)
        assertEquals(CheckRequirement.UNKNOWN, check.requirement)
    }

    @Test
    fun `an UNKNOWN status is never sent back to a server`() {
        assertThrows<SerializationException> {
            OpenVerifyJson.encodeToString(InquiryStatus.Serializer, InquiryStatus.UNKNOWN)
        }
    }

    @Test
    fun `known statuses encode as their wire values`() {
        assertEquals("\"needs_review\"", OpenVerifyJson.encodeToString(InquiryStatus.Serializer, InquiryStatus.NEEDS_REVIEW))
        assertEquals("\"requires_retry\"", OpenVerifyJson.encodeToString(VerificationStatus.serializer(), VerificationStatus.REQUIRES_RETRY))
        assertEquals("\"selfie-center\"", OpenVerifyJson.encodeToString(FileKind.Serializer, FileKind.SELFIE_CENTER))
    }

    @Test
    fun `needs_review is a known verification status that ends polling (C30_6)`() {
        val status = OpenVerifyJson.decodeFromString(VerificationStatus.serializer(), "\"needs_review\"")

        assertEquals(VerificationStatus.NEEDS_REVIEW, status)
        assertEquals("\"needs_review\"", OpenVerifyJson.encodeToString(VerificationStatus.serializer(), status))
        assertTrue(status.isDecided)
    }

    @Test
    fun `a file kind the SDK does not know decodes as UNKNOWN, which is never sent (C50_6)`() {
        assertEquals(FileKind.UNKNOWN, OpenVerifyJson.decodeFromString(FileKind.Serializer, "\"hologram\""))
        assertThrows<SerializationException> { OpenVerifyJson.encodeToString(FileKind.Serializer, FileKind.UNKNOWN) }
        assertEquals("\"chip-dg14\"", OpenVerifyJson.encodeToString(FileKind.Serializer, FileKind.CHIP_DG14))
    }

    @Test
    fun `verification types map from resource types`() {
        assertEquals(VerificationType.GOVERNMENT_ID, VerificationType.fromResourceType("verification/government-id"))
        assertEquals(VerificationType.SELFIE, VerificationType.fromResourceType("verification/selfie"))
        assertEquals(VerificationType.DOCUMENT, VerificationType.fromResourceType("verification/document"))
        assertEquals(VerificationType.UNKNOWN, VerificationType.fromResourceType("verification/hologram"))
        assertEquals("government-id", VerificationType.GOVERNMENT_ID.apiValue)
        assertEquals("database-business", VerificationType.DATABASE_BUSINESS.apiValue)
    }

    @Test
    fun `a problem with only some RFC 9457 members still decodes`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>("""{"title":"Conflict","status":409,"extra":1}""")

        assertEquals(Problem(title = "Conflict", status = 409), problem)
        assertEquals("about:blank", problem.type)
    }

    @Test
    fun `a cancel reason a newer server adds decodes as UNKNOWN and keeps the code (C25)`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(
            """{"title":"Unauthorized","status":401,"code":"session_canceled","reason":"inquiry_archived"}""",
        )

        assertEquals("session_canceled", problem.code)
        assertEquals(SessionCanceledReason.UNKNOWN, problem.reason)
    }

    @Test
    fun `each cancel reason decodes from its wire value (C25)`() {
        for (reason in SessionCanceledReason.entries - SessionCanceledReason.UNKNOWN) {
            val problem = OpenVerifyJson.decodeFromString<Problem>(
                """{"status":401,"code":"session_canceled","reason":"${reason.wireValue}"}""",
            )
            assertEquals(reason, problem.reason)
        }
        assertEquals(null, OpenVerifyJson.decodeFromString<Problem>("""{"status":401,"code":"session_expired"}""").reason)
    }

    @Test
    fun `event payloads never print the resource attributes`() {
        val document = OpenVerifyJson.decodeFromString<EventDocument>(
            Fixtures.read("api/webhook-event-inquiry-completed.json"),
        )

        assertEquals(false, document.toString().contains("Jane"), document.toString())
    }

    @Test
    fun `an environment kind this SDK does not know decodes as UNKNOWN`() {
        assertEquals(
            FlowEnvironment(EnvironmentKind.UNKNOWN),
            OpenVerifyJson.decodeFromString<FlowEnvironment>("""{"kind":"staging"}"""),
        )
        assertEquals(
            FlowEnvironment(EnvironmentKind.PRODUCTION),
            OpenVerifyJson.decodeFromString<FlowEnvironment>("""{"kind":"production"}"""),
        )
    }

    @Test
    fun `a session from a server without environments decodes without one`() {
        val session = OpenVerifyJson.decodeFromString<FlowSession>(
            """{"inquiry":{"id":"inq_01M5CJXHG07XPHF3HRM6NREDH7","status":"pending"},""" +
                """"flow":{"metadata":{"specVersion":1,"id":"f","version":1,"name":"F"},"steps":[],"transitions":[]},""" +
                """"verifications":[],"consent":null}""",
        )

        assertEquals(null, session.environment)
    }

    @Test
    fun `an inquiry session status this SDK does not know decodes as UNKNOWN`() {
        assertEquals(InquirySessionStatus.UNKNOWN, OpenVerifyJson.decodeFromString<InquirySessionStatus>(""""paused""""))
    }

    @Test
    fun `a problem keeps its machine-readable code (C10)`() {
        val problem = OpenVerifyJson.decodeFromString<Problem>(
            """{"type":"about:blank","title":"Unauthorized","status":401,"code":"session_expired"}""",
        )

        assertEquals("session_expired", problem.code)
    }
}
