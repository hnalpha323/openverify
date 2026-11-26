package dev.openverify.sdk.capture.barcode

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.RetryHint
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier
import java.util.IdentityHashMap

/**
 * C203.3, rule 11: the decoded PDF417 bytes are dropped at once. After the frame callback returns, no
 * field reachable from the guidance (alone, or alongside a document guidance) holds the array the
 * reader returned, whatever it decoded; [BarcodeGuidanceTest] shows the array itself is wiped.
 */
class BarcodeBytesReachabilityTest {

    private val idCard = GovernmentIdStep("id_card", DocumentSides.BOTH, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA))
    private val back = FlowState.Capture(idCard, FileKind.BACK, 1, 2, listOf(RetryHint("id_barcode_detection", listOf("barcode_not_found"))))

    private class ScriptedReader(private val payload: String) : BarcodeReader {
        val returned = mutableListOf<ByteArray>()

        override suspend fun readPdf417(frame: AnalysisFrame): ByteArray =
            payload.encodeToByteArray().also { returned += it }
    }

    /** One buffer for every frame: 640 x 480 upright, the smallest analysis frame that can carry a barcode read (KP10-35). */
    private val pixels = ByteArray(640 * 480 * 4)

    private fun frame(atMs: Long) = AnalysisFrame(640, 480, 0, PixelLayout.RGBA_8888, pixels, atMs * 1_000_000)

    @Test
    fun noDecodedBytesAreReachableFromTheGuidanceAfterItsCallback() = runTest {
        for (payload in listOf("@\n\u001e\rANSI 636014100002DL00410232ZC0273003", "not a licence")) {
            val reader = ScriptedReader(payload)
            val guidance = BarcodeGuidance(reader)
            guidance.onFrame(frame(0))
            guidance.run(flowOf(frame(Pdf417Guidance.READ_INTERVAL_MS))) { false }
            assertEquals(2, reader.returned.size, "the reader was asked")
            for (bytes in reader.returned) assertFalse(reachable(guidance, bytes, skipping = reader), payload)
        }
    }

    @Test
    fun noDecodedBytesAreReachableAlongsideTheDocumentGuidance() = runTest {
        val reader = ScriptedReader("@\n\u001e\rANSI 636014100002DL00410232ZC0273003")
        val document = BarcodeGuidance(ScriptedReader("not a licence"))
        val guidance = BarcodeGuidanceFactory(CaptureGuidanceFactory { document }) { reader }.create(back)!!
        guidance.run(flowOf(frame(0), frame(Pdf417Guidance.READ_INTERVAL_MS))) { false }
        assertEquals(2, reader.returned.size, "the reader was asked")
        for (bytes in reader.returned) assertFalse(reachable(guidance, bytes, skipping = reader))
    }

    @Test
    fun theWalkFindsAnArrayAFieldHolds() {
        val held = byteArrayOf(1, 2, 3)
        assertTrue(reachable(Holder(arrayOf("key", Holder(arrayOf(held)))), held), "the walk is not vacuous")
        assertFalse(reachable(Holder(arrayOf("key")), held))
        val reader = Holder(arrayOf(held))
        assertFalse(reachable(Holder(arrayOf(reader)), held, skipping = reader), "the skipped reader is not walked")
    }

    private class Holder(@Suppress("unused") val inner: Array<Any>)

    /**
     * Whether [target] is reachable from [root] through instance fields and array elements, not walking
     * into [skipping] (the test's own fake reader, which keeps what it returned so the test can look).
     */
    private fun reachable(root: Any, target: Any, skipping: Any? = null): Boolean {
        val seen = IdentityHashMap<Any, Unit>()
        if (skipping != null) seen[skipping] = Unit
        val queue = ArrayDeque<Any>().apply { add(root) }
        while (queue.isNotEmpty() && seen.size < 50_000) {
            val next = queue.removeFirst()
            if (next === target) return true
            if (seen.put(next, Unit) != null) continue
            val type = next.javaClass
            if (type.isArray) {
                if (!type.componentType.isPrimitive) (next as Array<*>).filterNotNull().forEach(queue::add)
                continue
            }
            // The JDK's collections hide their fields from reflection: walk their contents instead.
            if (next is Iterable<*>) next.filterNotNull().forEach(queue::add)
            if (next is Map<*, *>) next.forEach { (key, value) -> key?.let(queue::add); value?.let(queue::add) }
            var current: Class<*>? = type
            while (current != null) {
                for (field in current.declaredFields) {
                    if (Modifier.isStatic(field.modifiers) || field.type.isPrimitive) continue
                    val value = try {
                        field.isAccessible = true
                        field.get(next)
                    } catch (_: RuntimeException) {
                        null
                    }
                    if (value != null) queue.add(value)
                }
                current = current.superclass
            }
        }
        return false
    }
}
