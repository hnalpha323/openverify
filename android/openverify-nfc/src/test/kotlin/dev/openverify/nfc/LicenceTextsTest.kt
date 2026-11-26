package dev.openverify.nfc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.security.MessageDigest

/**
 * C209.4 (decision 30; Phase 10 P1): the licence boundary's papers. The module's AAR carries the
 * texts of the licences its libraries come under, as resources of its classes, so they travel into
 * every app that adds the module; each was copied by a command from one pinned release of SPDX's
 * license-list-data and is held to its digest here. `NOTICE` travels with them and says where the
 * source of the two SCUBA files under the owner's exception is.
 */
class LicenceTextsTest {

    private fun resource(name: String): ByteArray? = javaClass.getResourceAsStream("/META-INF/openverify-nfc/$name")?.use { it.readBytes() }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test
    fun `the AAR's classes carry the four licence texts, each as SPDX publishes it`() {
        val texts = mapOf(
            // JMRTD, SCUBA and cert-cvc.
            "LGPL-2.1-or-later.txt" to "5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2",
            // This module's own code; the file holds the GPL version 3 it is written as an addition to.
            "LGPL-3.0-or-later.txt" to "996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1",
            // SCUBA's CommandAPDU.java and ResponseAPDU.java, with the exception they come under.
            "GPL-2.0-only.txt" to "aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3",
            "Classpath-exception-2.0.txt" to "f36ecd7d28dc3c49854d3908a3824696972aed34f5ffe426174f35fb03c5f194",
        )

        texts.forEach { (name, digest) ->
            val text = resource("licenses/$name")
            assertNotNull(text, name)
            assertEquals(digest, sha256(text!!), name)
        }
        assertEquals(texts.keys + "SOURCE.txt", File("src/main/resources/META-INF/openverify-nfc/licenses").list().orEmpty().toSet())
    }

    @Test
    fun `the texts' source is one pinned release of SPDX's licence list`() {
        val source = resource("licenses/SOURCE.txt")?.decodeToString().orEmpty()

        assertTrue("https://github.com/spdx/license-list-data" in source)
        assertTrue("v3.27.0" in source)
        listOf("LGPL-2.1-or-later", "LGPL-3.0-or-later", "GPL-2.0-only", "Classpath-exception-2.0").forEach { assertTrue(it in source, it) }
    }

    @Test
    fun `NOTICE travels in the AAR as the module's own file, and names the two SCUBA files and where their source is`() {
        val notice = File("NOTICE").readText()

        assertEquals(notice, resource("NOTICE")?.decodeToString())
        listOf(
            "CommandAPDU.java",
            "ResponseAPDU.java",
            "GPL-2.0-only WITH Classpath-exception-2.0",
            "https://repo1.maven.org/maven2/net/sf/scuba/scuba-smartcards/0.0.21/",
            "scuba-smartcards-0.0.21-sources.jar",
            "unmodified",
            "META-INF/openverify-nfc/licenses/",
            "LGPL-3.0",
        ).forEach { assertTrue(it in notice, it) }
        // Who granted the exception stays on record.
        assertTrue("2026-11-08" in notice && "owner" in notice)
    }

    @Test
    fun `NOTICE and the README no longer say that the module holds no reader`() {
        val stale = listOf("no reader yet", "holds no reader", "without the reader", "stand-in", "will carry", "Once the reader ships", "is being built")
        listOf("NOTICE", "README.md").forEach { name ->
            val text = File(name).readText()
            assertEquals(emptyList<String>(), stale.filter { it in text }, name)
        }
    }

    @Test
    fun `the README says what the reader proves and what it does not, and what a host takes on`() {
        val readme = File("README.md").readText().replace(Regex("\\s+"), " ")

        listOf(
            "not legal advice",
            "replace",
            "reverse engineering",
            "PACE runs in no automated test",
            "No real document has been read",
            "pickFirsts += \"META-INF/LICENSE.md\"",
            "No conformance with ICAO or BSI test specifications is claimed",
        ).forEach { assertTrue(it in readme, it) }
        // The device reads and the server verifies: the module's own papers make no verdict of it.
        assertFalse(Regex("\\b(verified|authentic|genuine) (document|chip|passport)").containsMatchIn(readme))
    }
}
