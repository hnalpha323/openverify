package dev.openverify.demo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Comment
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C218.2 and C218.4: the App Links intent filter is an example in a comment (no domain is claimed);
 * the app bundles no credential; and the README says what the demo is.
 */
class DemoHonestyTest {

    private fun walk(node: Node, visit: (Node) -> Unit) {
        visit(node)
        var child = node.firstChild
        while (child != null) {
            walk(child, visit)
            child = child.nextSibling
        }
    }

    @Test
    fun `the App Links filter is a commented example for the compiled-in host, verified with autoVerify`() {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/AndroidManifest.xml"))
        val comments = mutableListOf<String>()
        val filters = mutableListOf<Element>()
        walk(document) { node ->
            if (node is Comment) comments += node.data
            if (node is Element && node.tagName == "intent-filter") filters += node
        }

        val example = comments.single { "<intent-filter" in it }
        assertTrue("android:autoVerify=\"true\"" in example)
        assertTrue("android.intent.action.VIEW" in example && "android.intent.category.BROWSABLE" in example && "android.intent.category.DEFAULT" in example)
        assertTrue("android:scheme=\"https\"" in example && "android:host=\"${AppLinks.HOST}\"" in example, "the example names the compiled-in host")
        assertFalse("android:scheme=\"http\"" in example)
        assertEquals(1, filters.size, "the only live filter is the launcher's")
        assertEquals("android.intent.action.MAIN", (filters.single().getElementsByTagName("action").item(0) as Element).getAttribute("android:name"))
    }

    @Test
    fun `the compiled-in host and API are placeholders on a reserved domain`() {
        assertEquals("verify.example.com", AppLinks.HOST)
        assertEquals("https://verify.example.com", AppLinks.API_BASE_URL)
    }

    @Test
    fun `the app bundles no credential`() {
        val credential = Regex("ov[so]_[A-Za-z0-9_-]{20,}|ov_(live|test|sandbox)_[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY")
        val sources = listOf("src/main", "src/debug", "src/minifiedSmoke").flatMap { root -> File(root).walkTopDown().filter { it.isFile }.toList() }

        assertTrue(sources.size > 5)
        assertEquals(emptyList<String>(), sources.filter { credential.containsMatchIn(it.readText()) }.map { it.path })
    }

    @Test
    fun `the README says the demo is a test harness for sandbox inquiries, never a product`() {
        val readme = File("README.md").readText()

        assertTrue("test harness for sandbox inquiries" in readme)
        assertTrue("not a product" in readme)
        assertTrue("bundles no credentials" in readme)
        assertTrue("sandboxSignalOutcome" in readme, "the sandbox-outcome picker has its line (Phase 7 C90.9)")
        assertTrue("openverifyDemoArtifacts" in readme)
        assertTrue("connectedMinifiedSmokeAndroidTest" in readme)
        assertFalse(Regex("(?i)persona").containsMatchIn(readme))
    }
}
