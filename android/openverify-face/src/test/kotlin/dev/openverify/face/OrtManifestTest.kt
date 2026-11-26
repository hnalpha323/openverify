package dev.openverify.face

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Document
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C205.2, first layer (reviews P09, P10, V14), as Workflow 10E Stage 1a settled it against AGP 9.4.1's
 * manifest merger: this module's manifest removes ONNX Runtime's telemetry provider, with a marker
 * that carries no `tools:selector`, and touches no permission.
 *
 * Why not the plan's two selector-scoped markers: a remove marker with a selector rejects the named
 * library's element but stays in the merged manifest itself (measured: a provider with no
 * authorities, which no device installs, and the permission still declared). Without a selector the
 * provider's marker is safe, since no other library declares that provider; the permission's is not,
 * since it would take `ACCESS_NETWORK_STATE` from any other library of the host merged after this
 * one. So the permission is the host's to remove, in its own manifest (the demo's
 * `src/face/AndroidManifest.xml` does).
 *
 * What ONNX Runtime declares is read from the AAR the build resolved (the build passes its extracted
 * manifest), never assumed from the Maven group `com.microsoft.onnxruntime`, so an upgrade that adds
 * a component or a permission fails here. The merge itself, with a fake library that must keep its
 * permission, is the fourth layer's test (face-onnx).
 */
class OrtManifestTest {

    private fun parse(property: String): Document {
        val path = System.getProperty(property) ?: error("the build passes $property")
        return DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path))
    }

    private val ort = parse("openverify.face.ortManifest")
    private val module = parse("openverify.face.moduleManifest")

    private fun Document.elements(tag: String): List<Element> = getElementsByTagName(tag).let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    private fun Element.tools(name: String): String = getAttributeNS(TOOLS, name)

    @Test
    fun `ONNX Runtime's library manifest has the package the records name`() {
        assertEquals(ORT_PACKAGE, ort.documentElement.getAttribute("package"))
    }

    @Test
    fun `ONNX Runtime's manifest declares the telemetry provider and the network-state permission that are removed`() {
        assertEquals(listOf(TELEMETRY_PROVIDER), ort.elements("provider").map { it.android("name") })
        assertEquals(
            listOf("android.permission.ACCESS_NETWORK_STATE", "android.permission.INTERNET"),
            ort.elements("uses-permission").map { it.android("name") }.sorted(),
        )
        // Nothing else a host would receive unseen: no service, receiver, activity or package query.
        listOf("service", "receiver", "activity", "queries").forEach { tag -> assertEquals(0, ort.elements(tag).size, tag) }
    }

    @Test
    fun `this module removes the telemetry provider, with a marker that names no selector`() {
        val providers = module.elements("provider")

        assertEquals(listOf(TELEMETRY_PROVIDER), providers.map { it.android("name") })
        assertEquals(listOf("remove"), providers.map { it.tools("node") })
        // A marker with a selector would stay in a host's merged manifest as a provider of its own.
        assertEquals(listOf(""), providers.map { it.tools("selector") })
        assertEquals(listOf(""), providers.map { it.android("authorities") })
    }

    @Test
    fun `this module leaves every permission to the host`() {
        // Removing ACCESS_NETWORK_STATE here would also take it from a host's other libraries (review P10).
        assertEquals(emptyList<String>(), module.elements("uses-permission").map { it.android("name") })
        assertEquals(0, module.elements("uses-permission-sdk-23").size)
    }

    @Test
    fun `this module declares nothing of its own`() {
        val declared = listOf("uses-permission", "uses-feature", "provider", "service", "receiver", "activity", "queries")
            .flatMap { tag -> module.elements(tag) }
            .filterNot { it.tools("node") == "remove" }

        assertTrue(declared.isEmpty(), declared.map { it.tagName + " " + it.android("name") }.toString())
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
        const val TOOLS = "http://schemas.android.com/tools"

        /** The package of ONNX Runtime 1.31.0's library manifest, read from the AAR on 2026-11-11 (review V14). */
        const val ORT_PACKAGE = "ai.onnxruntime"
        const val TELEMETRY_PROVIDER = "ai.onnxruntime.TelemetryInitializer"
    }
}
