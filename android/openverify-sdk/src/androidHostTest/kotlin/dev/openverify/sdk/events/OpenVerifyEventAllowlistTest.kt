package dev.openverify.sdk.events

import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.InquiryResultKind
import dev.openverify.sdk.OpenVerifyEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier

/**
 * C192.3: never in an event a field value, token, image, chip byte, MRZ, signal, check result, server
 * message or URL. Every event's members are enumerated against this allowlist, so a member added to
 * an event fails here until it is reviewed; the closed enums are listed the same way.
 */
internal class OpenVerifyEventAllowlistTest {

    /** Each event's instance fields, by name and type. */
    private fun members(type: Class<*>): Map<String, String> =
        type.declaredFields
            .filterNot { Modifier.isStatic(it.modifiers) }
            .associate { it.name to it.type.simpleName }

    @Test
    fun `the events are exactly the reviewed kinds`() {
        val kinds = OpenVerifyEvent::class.java.declaredClasses
            .filter { OpenVerifyEvent::class.java.isAssignableFrom(it) }
            .map { it.simpleName }
            .sorted()

        assertEquals(ALLOWLIST.keys.sorted(), kinds)
    }

    @Test
    fun `each event carries exactly its reviewed members`() {
        val found = OpenVerifyEvent::class.java.declaredClasses
            .filter { OpenVerifyEvent::class.java.isAssignableFrom(it) }
            .associate { it.simpleName to members(it) }

        assertEquals(ALLOWLIST, found)
    }

    @Test
    fun `the closed reasons and kinds are the reviewed ones`() {
        assertEquals(listOf("CAMERA_UNAVAILABLE", "CAMERA_ERROR", "OUT_OF_MEMORY"), CaptureFailureReason.entries.map { it.name })
        assertEquals(listOf("COMPLETED", "FAILED", "CANCELED"), InquiryResultKind.entries.map { it.name })
    }

    private companion object {
        /**
         * The reviewed members: an inquiry id (the host's own), a flow-spec step type (`consent`,
         * `screen`, `government_id`, never a step id), the camera's answer, a closed reason, a
         * result's kind.
         */
        val ALLOWLIST: Map<String, Map<String, String>> = mapOf(
            "Started" to mapOf("inquiryId" to "String"),
            "StepShown" to mapOf("stepType" to "String"),
            "CameraPermission" to mapOf("granted" to "boolean"),
            "CaptureFailed" to mapOf("reason" to "CaptureFailureReason"),
            "Submitted" to mapOf("stepType" to "String"),
            "Waiting" to emptyMap(),
            "Ended" to mapOf("result" to "InquiryResultKind"),
        )
    }
}
