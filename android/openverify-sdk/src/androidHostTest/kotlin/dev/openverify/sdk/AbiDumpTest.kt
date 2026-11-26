package dev.openverify.sdk

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C214.2 (decision 39; review F02): the committed ABI dumps hold exactly the public surface of
 * C190.7, as `api/expected-public.txt` lists it, nested declarations included. KGP's ABI validation
 * writes the dumps (`updateKotlinAbi`) and `checkKotlinAbi` compares them with the compiled code;
 * this test compares them with the list, so a declaration that becomes public by accident fails
 * even when its dump was regenerated with it.
 *
 * - `api/android/openverify-sdk.api`: the Android target (JVM signatures). A companion object is a
 *   member of its class, as a function is, so it needs no line of its own.
 * - `api/openverify-sdk.klib.api`: the iOS klibs, which hold every listed top-level declaration but
 *   the Android-only entry points, the registry and the transport factory.
 * - `../openverify-nfc/api/openverify-nfc.api`: `openverify-nfc`'s dump, by BCV's tasks (spike (b)).
 */
internal class AbiDumpTest {

    /** Gradle runs host tests from the module directory. */
    private val androidDump = File("api/android/openverify-sdk.api")
    private val klibDump = File("api/openverify-sdk.klib.api")
    private val nfcDump = File("../openverify-nfc/api/openverify-nfc.api")

    /** The list: each top-level name with the names nested under it. */
    private val expected: Map<String, Set<String>> by lazy {
        val entries = linkedMapOf<String, MutableSet<String>>()
        var parent: String? = null
        File("api/expected-public.txt").readLines().filter { it.isNotBlank() && !it.startsWith("#") }.forEach { line ->
            if (line.startsWith("  ")) {
                entries.getValue(checkNotNull(parent) { "nested line before any top-level one: $line" }) += line.trim()
            } else {
                parent = line.trim()
                entries[line.trim()] = mutableSetOf()
            }
        }
        entries
    }

    /** The Android dump's classes (`a.b.C` or `a.b.C$D`), each with its member lines. */
    private val androidClasses: Map<String, List<String>> by lazy {
        val classes = linkedMapOf<String, MutableList<String>>()
        var current: MutableList<String>? = null
        androidDump.readLines().forEach { line ->
            val declared = CLASS_LINE.find(line)
            when {
                declared != null && !line.startsWith("\t") -> {
                    current = mutableListOf<String>().also { classes[declared.groupValues[1].replace('/', '.')] = it }
                }
                line.startsWith("\t") -> current?.add(line.trim())
            }
        }
        classes
    }

    @Test
    fun `the dumps are committed, and openverify-nfc's too`() {
        assertTrue(androidDump.isFile, "missing ${androidDump.path}: run updateKotlinAbi")
        assertTrue(klibDump.isFile, "missing ${klibDump.path}: run updateKotlinAbi")
        assertTrue(nfcDump.isFile, "missing ${nfcDump.path}: run :openverify-nfc:updateKotlinAbi")
    }

    @Test
    fun `every public class of the Android dump is on the list`() {
        val unlisted = androidClasses.keys.filterNot { name ->
            val top = name.substringBefore('$')
            val nested = name.substringAfter('$', "")
            when {
                nested.isEmpty() -> top in expected
                nested == "Companion" -> top in expected
                else -> nested in expected[top].orEmpty()
            }
        }

        assertEquals(emptyList<String>(), unlisted)
    }

    @Test
    fun `every line of the list is in the Android dump`() {
        val missing = expected.flatMap { (top, nested) ->
            val own = if (top in androidClasses) emptyList() else listOf(top)
            own + nested.filterNot { name ->
                "$top$$name" in androidClasses || androidClasses[top].orEmpty().any { member -> Regex("""\b$name\b""").containsMatchIn(member) }
            }.map { "$top.$it" }
        }

        assertEquals(emptyList<String>(), missing)
    }

    @Test
    fun `the iOS dump holds the listed top-level declarations, less the Android-only ones`() {
        val klibTopLevel = klibDump.readLines()
            .filter { it.isNotEmpty() && !it.startsWith(" ") && !it.startsWith("//") && !it.startsWith("}") }
            .mapNotNull { KLIB_DECLARATION.find(it)?.let { match -> match.groupValues[1].replace('/', '.') } }
            .toSet()

        assertEquals(expected.keys - ANDROID_ONLY, klibTopLevel)
    }

    @Test
    fun `no dump holds a compiler-generated declaration`() {
        val generated = listOf(androidDump, klibDump).flatMap { dump ->
            dump.readLines().filter { "ComposableSingletons" in it || "\$stableprop" in it }.map { "${dump.path}: $it" }
        }

        assertEquals(emptyList<String>(), generated)
    }

    @Test
    fun `no dump names a kotlinx-serialization type, so the SDK's wire format is not its API (KP10-12)`() {
        val serialization = listOf(androidDump, klibDump, nfcDump).flatMap { dump ->
            dump.readLines().filter { "kotlinx/serialization" in it || "kotlinx.serialization" in it }.map { "${dump.path}: ${it.trim()}" }
        }

        assertEquals(emptyList<String>(), serialization)
    }

    private companion object {
        /** `public final class dev/openverify/sdk/X : ... {`, its name in group 1. */
        val CLASS_LINE = Regex("""^public (?:[a-z]+ )*(?:class|interface) ([\w/$]+)""")

        /** `final class dev.openverify.sdk/X ...`, its package and name in group 1. */
        val KLIB_DECLARATION = Regex("""^(?:[a-z]+ )*(?:class|interface|object) ([\w.]+/\w+)""")

        /** Declared in androidMain only (C190.1, C191.1). */
        val ANDROID_ONLY = setOf(
            "dev.openverify.sdk.OpenVerifyInquiry",
            "dev.openverify.sdk.OpenVerifyAndroid",
            "dev.openverify.sdk.OpenVerifyAndroidTransport",
        )
    }
}
