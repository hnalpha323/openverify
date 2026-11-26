package dev.openverify.face

import com.android.manifmerger.ManifestMerger2
import com.android.manifmerger.ManifestSystemProperty
import com.android.manifmerger.MergingReport
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.w3c.dom.Document
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C205.2, the first layer as a host app receives it (reviews P09, P10; Workflow 10E Stage 1a amendment
 * 2): the Android Gradle plugin's own manifest merger (the build's version) over a host app, this
 * module's manifest, ONNX Runtime's manifest as the build resolved it, and a fake library that needs
 * `ACCESS_NETWORK_STATE` for itself.
 *
 * - With this module, ONNX Runtime's telemetry provider is not in the app.
 * - This module takes no permission away: the fake library keeps `ACCESS_NETWORK_STATE`.
 * - A host with no use for that permission removes it in its own manifest, and then nothing beyond
 *   `INTERNET` arrives with this module.
 * - A library's marker reaches only manifests merged after it: a host that itself depends on ONNX
 *   Runtime, ahead of this module, keeps the provider unless its own manifest removes it.
 * - The demo's own manifests, merged the same way with the SDK's, hold exactly the permissions of its
 *   `sdk-face` allowlist that these manifests can give (`:demo-app`'s `MergedManifestTest` holds the
 *   built app's whole manifest to that allowlist; gate call 11).
 */
class MergedManifestTest {

    @TempDir
    lateinit var directory: File

    private val ort = File(System.getProperty("openverify.face.ortManifest") ?: error("the build passes openverify.face.ortManifest"))

    /**
     * A copy of a source manifest with what its module's build writes into it: the package (a source
     * manifest names none) and, for a library, its minimum SDK level (without one the merger takes the
     * library for a pre-Donut one and adds the permissions such a library implied).
     */
    private fun packaged(source: File, packageName: String, name: String, library: Boolean = false): File = File(directory, name).also {
        val text = source.readText().replaceFirst("<manifest ", "<manifest package=\"$packageName\" ")
        it.writeText(if (library) text.replaceFirst(Regex("(<manifest[^>]*>)"), "$1\n    <uses-sdk android:minSdkVersion=\"26\" />") else text)
    }

    private fun manifest(name: String, body: String): File = File(directory, name).also {
        it.writeText(
            """<?xml version="1.0" encoding="utf-8"?>
            |<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools" package="${name.removeSuffix(".xml")}">
            |$body
            |</manifest>
            """.trimMargin(),
        )
    }

    private fun host(body: String = "<application />"): File = manifest("com.example.host.xml", body)

    private fun fakeLibrary(): File = manifest("com.example.connectivity.xml", "<uses-permission android:name=\"$NETWORK_STATE\" />")

    /** This module's manifest as its AAR carries it (AGP's processed copy of the source manifest). */
    private fun face(): File = File(System.getProperty("openverify.face.libraryManifest") ?: error("the build passes openverify.face.libraryManifest"))

    private fun merge(app: File, libraries: List<File>, overlays: List<File> = emptyList()): Document {
        // The merger's logger type is in a library the merger brings at run time only, so it is reached by name.
        val loggerType = Class.forName("com.android.utils.ILogger")
        val logger = Class.forName("com.android.utils.NullLogger").getDeclaredConstructor().newInstance()
        val merger = (ManifestMerger2::class.java.getMethod("newMerger", File::class.java, loggerType, ManifestMerger2.MergeType::class.java)
            .invoke(null, app, logger, ManifestMerger2.MergeType.APPLICATION) as ManifestMerger2.Invoker)
            .setPlaceHolderValue("applicationId", "com.example.host")
            // The app's SDK levels come from its build, as AGP passes them (ONNX Runtime's manifest asks for 24).
            // As AGP merges an app's manifest: the tools: markers are instructions, not part of the result.
            .withFeatures(ManifestMerger2.Invoker.Feature.REMOVE_TOOLS_DECLARATIONS)
            .setOverride(ManifestSystemProperty.UsesSdk.MIN_SDK_VERSION, "26")
            .setOverride(ManifestSystemProperty.UsesSdk.TARGET_SDK_VERSION, "36")
        overlays.forEach { merger.addFlavorAndBuildTypeManifest(it) }
        libraries.forEach { merger.addLibraryManifest(it) }
        val report = merger.merge()
        assertTrue(report.result.isSuccess, report.reportString)
        val merged = report.getMergedDocument(MergingReport.MergedManifestKind.MERGED)
        return DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(ByteArrayInputStream(merged!!.toByteArray()))
    }

    private fun Document.names(tag: String): List<String> =
        getElementsByTagName(tag).let { nodes -> (0 until nodes.length).map { (nodes.item(it) as Element).getAttributeNS(ANDROID, "name") } }.sorted()

    @Test
    fun `without this module ONNX Runtime's telemetry provider reaches the app`() {
        // The control: the provider is real, so its absence below is this module's doing.
        val merged = merge(host(), listOf(ort))

        assertEquals(listOf(TELEMETRY_PROVIDER), merged.names("provider"))
        assertEquals(listOf(NETWORK_STATE, INTERNET), merged.names("uses-permission"))
    }

    @Test
    fun `with this module the telemetry provider is gone and no marker is left as a declaration`() {
        val merged = merge(host(), listOf(face(), ort))

        assertEquals(emptyList<String>(), merged.names("provider"))
    }

    @Test
    fun `a host that itself depends on ONNX Runtime ahead of this module keeps the provider unless its own manifest removes it`() {
        // Measured, and in the README: a library's marker removes only from manifests merged after it.
        // This module depends on ONNX Runtime, so in a host that only adds this module ONNX Runtime's
        // manifest is merged after this one's (the cases above). A host that also declares ONNX Runtime
        // itself, ahead of this module, has ONNX Runtime's manifest merged first: the host governs.
        val ahead = merge(host(), listOf(ort, face()))
        val removing = host("<application>\n<provider android:name=\"$TELEMETRY_PROVIDER\" tools:node=\"remove\" />\n</application>")

        val removed = merge(removing, listOf(ort, face()))

        assertEquals(listOf(TELEMETRY_PROVIDER), ahead.names("provider"))
        assertEquals(emptyList<String>(), removed.names("provider"))
    }

    @Test
    fun `this module takes no permission away - a library that needs the network state keeps it`() {
        val merged = merge(host(), listOf(face(), ort, fakeLibrary()))

        assertEquals(emptyList<String>(), merged.names("provider"))
        assertTrue(NETWORK_STATE in merged.names("uses-permission"))
    }

    @Test
    fun `ONNX Runtime's network-state permission arrives unless the host removes it`() {
        val merged = merge(host(), listOf(face(), ort))

        assertEquals(listOf(NETWORK_STATE, INTERNET), merged.names("uses-permission"))
    }

    @Test
    fun `a host that removes the permission in its own manifest receives nothing beyond INTERNET`() {
        val removing = host("<uses-permission android:name=\"$NETWORK_STATE\" tools:node=\"remove\" />\n<application />")

        val merged = merge(removing, listOf(face(), ort))

        assertEquals(listOf(INTERNET), merged.names("uses-permission"))
        assertEquals(emptyList<String>(), merged.names("provider"))
        listOf("service", "receiver", "activity", "queries", "uses-feature").forEach { tag -> assertEquals(emptyList<String>(), merged.names(tag), tag) }
    }

    @Test
    fun `the demo's manifests with face hold no telemetry provider and no permission beyond its allowlist`() {
        val android = HostFiles.repository("android")
        val demo = packaged(File(android, "demo-app/src/main/AndroidManifest.xml"), "dev.openverify.demo", "demo.xml")
        val demoFace = File(android, "demo-app/src/face/AndroidManifest.xml")
        val sdk = packaged(File(android, "openverify-sdk/src/androidMain/AndroidManifest.xml"), "dev.openverify.sdk", "openverify-sdk.xml", library = true)
        val allowlist = File(android, "demo-app/manifest-allowlist/sdk-face.json").readText()

        val merged = merge(demo, listOf(face(), ort, sdk), overlays = listOf(demoFace))

        assertFalse(TELEMETRY_PROVIDER in merged.names("provider"))
        assertFalse(NETWORK_STATE in merged.names("uses-permission"))
        merged.names("uses-permission").forEach { permission -> assertTrue("\"$permission\"" in allowlist, permission) }
        assertFalse(NETWORK_STATE in allowlist)
        assertFalse("onnxruntime" in allowlist)
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
        const val TELEMETRY_PROVIDER = "ai.onnxruntime.TelemetryInitializer"
        const val NETWORK_STATE = "android.permission.ACCESS_NETWORK_STATE"
        const val INTERNET = "android.permission.INTERNET"
    }
}
