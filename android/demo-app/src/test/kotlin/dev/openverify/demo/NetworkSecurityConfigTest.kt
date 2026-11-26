package dev.openverify.demo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C213.4, C215.2, C218.3: `src/main`'s network security configuration, which the `release` and
 * `minifiedSmoke` builds ship, permits no cleartext and trusts no user-added CA; only the debug build
 * overrides it, for plain http to the development machine. `src/minifiedSmoke/` has no configuration
 * of its own, so the smoke test proves the https-only build.
 */
class NetworkSecurityConfigTest {

    private fun parse(path: String): Element = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(path)).documentElement

    private fun Element.all(tag: String): List<Element> = getElementsByTagName(tag).let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }

    private val main = parse("src/main/res/xml/network_security_config.xml")

    @Test
    fun `the shipped configuration permits no cleartext anywhere`() {
        assertEquals(listOf("false"), main.all("base-config").map { it.getAttribute("cleartextTrafficPermitted") })
        assertEquals(emptyList<Element>(), main.all("domain-config"), "no host is treated differently")
        assertFalse(File("src/main/res/xml/network_security_config.xml").readText().contains("cleartextTrafficPermitted=\"true\""))
    }

    @Test
    fun `the shipped configuration trusts the system's authorities only, never a user-added one`() {
        assertEquals(listOf("system"), main.all("certificates").map { it.getAttribute("src") }, "the trust anchors are stated, and only the system's")
        assertEquals(emptyList<Element>(), main.all("debug-overrides"))
        assertEquals(emptyList<Element>(), main.all("pin-set"))
    }

    @Test
    fun `the manifest names that configuration`() {
        assertTrue(File("src/main/AndroidManifest.xml").readText().contains("android:networkSecurityConfig=\"@xml/network_security_config\""))
    }

    @Test
    fun `only the debug build overrides it, for the loopback hosts alone`() {
        val overrides = File("src").listFiles().orEmpty().filter { File(it, "res/xml/network_security_config.xml").isFile }.map { it.name }.sorted()
        assertEquals(listOf("debug", "main"), overrides)

        val debug = parse("src/debug/res/xml/network_security_config.xml")
        assertEquals(listOf("false"), debug.all("base-config").map { it.getAttribute("cleartextTrafficPermitted") })
        assertEquals(listOf("10.0.2.2", "localhost", "127.0.0.1"), debug.all("domain").map { it.textContent.trim() })
        assertEquals(listOf("false", "false", "false"), debug.all("domain").map { it.getAttribute("includeSubdomains") })
        assertEquals(emptyList<String>(), debug.all("certificates").map { it.getAttribute("src") }.filter { it != "system" })
    }
}
