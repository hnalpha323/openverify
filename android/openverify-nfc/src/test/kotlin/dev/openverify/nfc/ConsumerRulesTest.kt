package dev.openverify.nfc

import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C209.4, C215.1 (KP10-43): the module's consumer R8 rules against what its libraries need in a
 * minified host.
 *
 * - The LGPL libraries (JMRTD, SCUBA, cert-cvc) are kept whole and under their own names, so a user
 *   can replace them with a modified version (the licence boundary).
 * - JMRTD asks its own Bouncy Castle provider object for algorithms by name, and the provider loads
 *   each one's class by a name it holds as text. R8 cannot see such a use: before these rules the
 *   minified demo had no `DESede$Mappings` and no retail MAC class left. So every class the provider
 *   can name is kept, read here from the provider itself.
 *
 * That the minified app then reads a chip needs a phone and a document; this is the host's half.
 */
class ConsumerRulesTest {

    private val rules: List<String> = File("consumer-rules.pro").readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }

    /** The package prefixes the rules keep whole: `-keep class a.b.** { *; }` keeps `a.b.`. */
    private val kept: List<String> = rules.mapNotNull { Regex("""^-keep class ([\w.]+)\.\*\* \{ \*; }$""").find(it)?.groupValues?.get(1) }.map { "$it." }

    @Test
    fun `the three LGPL libraries are kept whole, under their names`() {
        assertEquals(listOf("org.jmrtd.", "net.sf.scuba.", "org.ejbca.cvc."), kept.take(3))
        // One class of each, as the reader uses them: named here so that a renamed package fails.
        listOf(org.jmrtd.PassportService::class.java, net.sf.scuba.smartcards.CardService::class.java, org.ejbca.cvc.CVCertificate::class.java).forEach { type ->
            assertTrue(kept.any { type.name.startsWith(it) }, type.name)
        }
    }

    @Test
    fun `every class Bouncy Castle's provider resolves by name for a travel document is kept`() {
        val named = BouncyCastleProvider().services.map { it.className }.toSet()
        // The provider also names post-quantum algorithms. No travel document's chip uses one, JMRTD asks
        // for none, and a host that does not use them need not carry them: they are left to R8.
        val needed = named.filterNot { it.startsWith("org.bouncycastle.pqc.") }

        assertTrue(named.size > 1000, "the provider named only ${named.size} classes")
        assertEquals(emptyList<String>(), needed.filterNot { name -> kept.any { name.startsWith(it) } })
        // What the reader's own exchange needs is among them: the retail MAC and triple DES of Basic Access Control.
        assertTrue(needed.any { it.startsWith("org.bouncycastle.jcajce.provider.symmetric.DESede$") })
        // The provider loads each algorithm family's `Mappings` class by name, from the same packages.
        assertTrue(kept.any { "org.bouncycastle.jcajce.provider.symmetric.DESede\$Mappings".startsWith(it) })
    }

    @Test
    fun `Bouncy Castle keeps its names, so a replaced JMRTD still links against it`() {
        assertTrue("-keepnames class org.bouncycastle.** { *; }" in rules)
    }

    @Test
    fun `no rule names the SDK, the host or kotlinx serialization`() {
        assertFalse(rules.any { "dev.openverify" in it || "kotlinx.serialization" in it })
        assertEquals(6, rules.size)
    }
}
