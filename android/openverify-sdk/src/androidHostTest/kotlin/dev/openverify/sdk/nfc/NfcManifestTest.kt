package dev.openverify.sdk.nfc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C207.8 (behaviour M13, decision 36; Workflow 10C, contracts-10c): `openverify-nfc` declares the
 * NFC permission and the optional NFC feature, so a host that adds the module gets them and one that
 * does not gets neither; `:openverify-sdk` declares neither (`NeverReadTest` holds its permissions).
 */
internal class NfcManifestTest {

    private fun manifest(path: String): Element =
        DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path)).documentElement

    private fun Element.children(tag: String): List<Element> =
        (0 until childNodes.length).map(childNodes::item).filterIsInstance<Element>().filter { it.tagName == tag }

    private fun Element.android(name: String): String = getAttributeNS("http://schemas.android.com/apk/res/android", name)

    @Test
    fun `openverify-nfc declares the NFC permission and the NFC feature as not required, and nothing else`() {
        val root = manifest("../openverify-nfc/src/main/AndroidManifest.xml")

        assertEquals(listOf("android.permission.NFC"), root.children("uses-permission").map { it.android("name") })
        assertEquals(listOf("android.hardware.nfc" to "false"), root.children("uses-feature").map { it.android("name") to it.android("required") })
        assertEquals(emptyList<String>(), root.children("application").flatMap { app -> (0 until app.childNodes.length).map(app.childNodes::item).filterIsInstance<Element>().map { it.tagName } })
        assertEquals(emptyList<String>(), root.children("queries").map { it.tagName })
    }

    @Test
    fun `the SDK's own manifest declares no NFC permission and no NFC feature`() {
        val root = manifest("src/androidMain/AndroidManifest.xml")

        assertFalse(root.children("uses-permission").any { "NFC" in it.android("name") })
        assertEquals(emptyList<String>(), root.children("uses-feature").map { it.android("name") }.filter { "nfc" in it })
    }
}
