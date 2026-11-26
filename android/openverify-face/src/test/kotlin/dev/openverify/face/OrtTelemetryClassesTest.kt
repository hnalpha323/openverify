package dev.openverify.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.zip.ZipFile

/**
 * The list of ONNX Runtime's telemetry classes that the device test asserts were never loaded
 * (C205.2, fourth layer) is the list in the Android AAR the build resolved: an upgrade that adds a
 * telemetry class fails here, on the host, before a device test would miss it.
 */
class OrtTelemetryClassesTest {

    /** The jar on the test classpath that holds ONNX Runtime's Android classes (its `classes.jar`). */
    private fun androidClasses(): ZipFile {
        val resource = javaClass.classLoader!!.getResource("ai/onnxruntime/TelemetryInitializer.class") ?: error("ONNX Runtime's Android classes are on the test classpath")
        val jar = resource.path.substringAfter("file:").substringBefore("!")
        return ZipFile(jar)
    }

    @Test
    fun `the list is every telemetry class of the resolved AAR`() {
        val inJar = androidClasses().use { zip ->
            zip.entries().asSequence().map { it.name }.filter { it.endsWith(".class") }
                .map { it.removeSuffix(".class").replace('/', '.') }
                .filter { it == OrtTelemetryClasses.PROVIDER || it.startsWith(OrtTelemetryClasses.PACKAGE_PREFIX) }
                .sorted().toList()
        }

        assertEquals(inJar, OrtTelemetryClasses.NAMES.sorted())
        assertTrue(inJar.size > 1)
    }

    @Test
    fun `nothing outside those classes refers to them`() {
        // If ONNX Runtime's own classes named a telemetry class, creating an environment could load it.
        val referrers = androidClasses().use { zip ->
            zip.entries().asSequence().filter { it.name.endsWith(".class") }
                .filterNot { entry -> entry.name.removeSuffix(".class").replace('/', '.') in OrtTelemetryClasses.NAMES }
                .filter { entry ->
                    val text = String(zip.getInputStream(entry).readBytes(), Charsets.ISO_8859_1)
                    "ai/onnxruntime/telemetry/" in text || "ai/onnxruntime/TelemetryInitializer" in text
                }
                .map { it.name }.toList()
        }

        assertEquals(emptyList<String>(), referrers)
    }
}
