package dev.openverify.demo

import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.InquiryResultKind
import dev.openverify.sdk.OpenVerifyEvent
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/** C218.1: the event log shows event names only, in memory, newest last. */
class EventLogTest {

    private val everyEvent: List<Pair<OpenVerifyEvent, String>> = listOf(
        OpenVerifyEvent.Started(DemoFormTest.INQUIRY_ID) to "Started",
        OpenVerifyEvent.StepShown("government_id") to "StepShown",
        OpenVerifyEvent.CameraPermission(granted = true) to "CameraPermission",
        OpenVerifyEvent.CaptureFailed(CaptureFailureReason.CAMERA_ERROR) to "CaptureFailed",
        OpenVerifyEvent.Submitted("selfie") to "Submitted",
        OpenVerifyEvent.Waiting to "Waiting",
        OpenVerifyEvent.Ended(InquiryResultKind.COMPLETED) to "Ended",
    )

    @Test
    fun `each event is named, and nothing it carries is kept`() {
        val log = EventLog()

        everyEvent.forEach { (event, _) -> log.onEvent(event) }

        assertEquals(everyEvent.map { it.second }, log.names.value)
        val kept = log.names.value.joinToString("\n")
        listOf(DemoFormTest.INQUIRY_ID, "government_id", "selfie", "CAMERA_ERROR", "COMPLETED", "true").forEach { carried ->
            assertFalse(kept.contains(carried), "the log holds $carried")
        }
    }

    @Test
    fun `a name is a constant of this app, not a class name the build could rename`() {
        assertEquals(everyEvent.map { it.second }, everyEvent.map { EventLog.nameOf(it.first) })
    }

    @Test
    fun `the log keeps the newest names only`() {
        val log = EventLog(capacity = 3)

        log.onEvent(OpenVerifyEvent.Started(DemoFormTest.INQUIRY_ID))
        log.onEvent(OpenVerifyEvent.StepShown("consent"))
        log.onEvent(OpenVerifyEvent.Submitted("consent"))
        log.onEvent(OpenVerifyEvent.Waiting)

        assertEquals(listOf("StepShown", "Submitted", "Waiting"), log.names.value)
    }

    @Test
    fun `clearing forgets every name`() {
        val log = EventLog()
        log.onEvent(OpenVerifyEvent.Waiting)

        log.clear()

        assertEquals(emptyList<String>(), log.names.value)
    }
}
