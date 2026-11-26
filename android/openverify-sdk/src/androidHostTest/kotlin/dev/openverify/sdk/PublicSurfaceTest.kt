package dev.openverify.sdk

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C190.7 (decision 68; review F02): the public surface is exactly `api/expected-public.txt`. Until
 * the ABI dump of `foundation-10a` checks every declaration, this test holds its top-level lines
 * to the main sources: a top-level declaration that is neither `internal` nor `private` must be
 * listed, and every listed one must exist. Comments are left out; `explicitApi()` (C214.2) will
 * also refuse a declaration with no visibility at all.
 */
internal class PublicSurfaceTest {

    private val declaration = Regex(
        """^(?:@[\w.]+(?:\([^)]*\))?\s+)*(public\s+|internal\s+|private\s+)?(?:(?:sealed|data|enum|abstract|open|annotation|value|const|inline|expect|actual|fun)\s+)*(class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)""",
    )

    private fun expected(): Set<String> = File("api/expected-public.txt").readLines()
        .filter { it.isNotBlank() && !it.startsWith("#") && !it.startsWith(" ") }
        .toSet()

    private fun declared(): Set<String> = listOf("commonMain", "androidMain")
        .flatMap { set -> File("src", set).walkTopDown().filter { it.extension == "kt" }.toList() }
        .flatMap { file ->
            val text = file.readText().replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            val pkg = Regex("""^package\s+([\w.]+)""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1).orEmpty()
            text.lines().mapNotNull { line -> declaration.find(line) }
                .filter { it.groupValues[1].trim() !in setOf("internal", "private") }
                .map { "$pkg.${it.groupValues[3]}" }
        }
        .toSet()

    @Test
    fun `the top-level public declarations are exactly the expected list (C190_7)`() {
        assertEquals(expected().sorted(), declared().sorted())
    }
}
