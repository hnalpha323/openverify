package dev.openverify.demo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C215.3 (review P21): the merged manifest of the demo's `release` build, for the configuration this
 * build was made with (`openverifyDemoArtifacts`), is exactly its committed allowlist
 * `manifest-allowlist/<configuration>.json`. A dependency upgrade that adds a permission, a `<queries>`
 * entry or a component, or changes an `exported` value, fails here before the README's lists drift.
 * `UPDATE_MANIFEST_ALLOWLIST=1` rewrites the file of the configuration being built; a plain run never
 * writes.
 */
class MergedManifestTest {

    private val configuration: String = System.getProperty("openverify.demo.configuration") ?: error("the build passes openverify.demo.configuration")
    private val manifest = File(System.getProperty("openverify.demo.releaseManifest") ?: error("the build passes openverify.demo.releaseManifest"))

    private fun allowlist(name: String) = File("manifest-allowlist/$name.json")

    /** A file's entries, one a line, without the commas that only say whether a line is the last. */
    private fun entries(file: File): List<String> = file.readLines().map { it.trim().trimEnd(',') }

    @Test
    fun `the release build's merged manifest is exactly its allowlist`() {
        val rendered = ManifestFacts.render(manifest, configuration)
        val file = allowlist(configuration)
        if (System.getenv("UPDATE_MANIFEST_ALLOWLIST") == "1") {
            file.parentFile.mkdirs()
            file.writeText(rendered)
        }

        assertTrue(file.isFile, "no allowlist ${file.path} for the configuration $configuration")
        assertEquals(file.readText(), rendered, "the merged manifest differs from ${file.path}")
    }

    @Test
    fun `there is one allowlist for each configuration that exists, and no other`() {
        assertEquals(listOf("sdk-face.json", "sdk-nfc-face.json", "sdk-nfc.json", "sdk.json"), File("manifest-allowlist").list().orEmpty().sorted())
    }

    @Test
    fun `the SDK's three permissions are on the list, the overlay one since Workflow 10A`() {
        val entries = entries(allowlist("sdk"))

        listOf("android.permission.INTERNET", "android.permission.CAMERA", "android.permission.HIDE_OVERLAY_WINDOWS").forEach { permission ->
            assertTrue("\"$permission\"" in entries, "$permission is not on the list")
        }
        assertFalse(entries.any { "android.permission.NFC" in it }, "the SDK alone asks for no NFC permission (C207.8)")
    }

    @Test
    fun `the flow's activity is not exported, and the demo's launcher is the only exported activity`() {
        val activities = entries(allowlist("sdk")).filter { "Activity\"" in it }

        assertEquals(
            listOf(
                """{ "name": "dev.openverify.demo.MainActivity", "exported": true, "permission": null }""",
                """{ "name": "dev.openverify.sdk.OpenVerifyInquiryActivity", "exported": false, "permission": null }""",
            ),
            activities,
        )
    }

    @Test
    fun `the NFC configuration adds what openverify-nfc's manifest declares, and nothing else`() {
        val sdk = entries(allowlist("sdk"))
        val nfc = entries(allowlist("sdk-nfc"))
        val module = File("../openverify-nfc/src/main/AndroidManifest.xml").readText()

        assertEquals(
            listOf(
                """"android.permission.NFC"""",
                """"configuration": "sdk-nfc"""",
                """{ "name": "android.hardware.nfc", "required": false }""",
            ),
            (nfc - sdk.toSet()).sorted(),
        )
        assertEquals(listOf(""""configuration": "sdk""""), sdk - nfc.toSet())
        assertTrue("android.permission.NFC" in module && "android.hardware.nfc" in module, "openverify-nfc declares both")
    }

    /**
     * C205.2 (reviews P09, P10): ONNX Runtime's own manifest declares a telemetry provider and
     * `ACCESS_NETWORK_STATE`. openverify-face's manifest removes the provider for every host; the
     * permission is the host's to remove, and the demo, as a host, removes it
     * (`src/face/AndroidManifest.xml`), so this build gains no permission and no component (ONNX
     * Runtime's `INTERNET` is the SDK's already).
     */
    @Test
    fun `the face configuration adds no permission, provider or component, ONNX Runtime's telemetry provider and network-state permission being removed`() {
        val sdk = entries(allowlist("sdk"))
        val face = entries(allowlist("sdk-face"))

        assertEquals(listOf(""""configuration": "sdk-face""""), face - sdk.toSet())
        assertEquals(listOf(""""configuration": "sdk""""), sdk - face.toSet())
        assertFalse(face.any { "TelemetryInitializer" in it || "ACCESS_NETWORK_STATE" in it })
        val overlay = File("src/face/AndroidManifest.xml").readText()
        assertTrue("android.permission.ACCESS_NETWORK_STATE" in overlay && "tools:node=\"remove\"" in overlay && "tools:selector" !in SourceText.withoutComments(overlay))
        val module = SourceText.withoutComments(File("../openverify-face/src/main/AndroidManifest.xml").readText())
        assertTrue("ai.onnxruntime.TelemetryInitializer" in module && "tools:node=\"remove\"" in module && "uses-permission" !in module)
    }

    @Test
    fun `the configuration with both artifacts adds exactly what each adds alone`() {
        val sdk = entries(allowlist("sdk")).toSet()
        val both = entries(allowlist("sdk-nfc-face"))
        val each = (entries(allowlist("sdk-nfc")) - sdk) + (entries(allowlist("sdk-face")) - sdk)

        assertEquals(each.filterNot { "\"configuration\"" in it }.sorted(), (both - sdk).filterNot { "\"configuration\"" in it }.sorted())
    }

    @Test
    fun `no configuration claims a web domain or takes a view intent`() {
        // The merger keeps the example's comment, so the elements are read, not the text.
        val document = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(manifest)
        fun names(tag: String): List<String> = document.getElementsByTagName(tag).let { nodes ->
            (0 until nodes.length).map { (nodes.item(it) as Element).getAttributeNS(ANDROID, "name") }
        }
        val filters = document.getElementsByTagName("intent-filter").let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }

        assertFalse("android.intent.category.BROWSABLE" in names("category"), "the App Links example stays a comment (C218.2)")
        assertFalse("android.intent.action.VIEW" in names("action"))
        assertEquals(emptyList<Element>(), filters.filter { it.hasAttributeNS(ANDROID, "autoVerify") })
        assertEquals(0, document.getElementsByTagName("data").length)
    }

    /** An XML text without its comments. */
    private object SourceText {
        fun withoutComments(xml: String): String = xml.replace(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL), "")
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}
