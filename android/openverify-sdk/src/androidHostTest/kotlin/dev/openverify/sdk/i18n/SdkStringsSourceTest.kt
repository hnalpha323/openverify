package dev.openverify.sdk.i18n

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C199.1, C199.4 (review F09): every SDK string goes through `sdkString` or `sdkPlural`, so the
 * language can be chosen per composition behind them. Only `i18n/SdkStrings.kt` may call Compose
 * Multiplatform's `stringResource` or `pluralStringResource`. Comments are left out, and a method of another object (`cursor.getString(0)`) is not a resource read.
 */
internal class SdkStringsSourceTest {

    private val facade = "commonMain/kotlin/dev/openverify/sdk/i18n/SdkStrings.kt"
    private val direct = Regex("""(?<![.\w])(stringResource|pluralStringResource|getString|getPluralString)\s*\(""")

    private fun code(file: File): String = file.readText()
        .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        .lines().joinToString("\n") { it.substringBefore("//") }

    @Test
    fun `no main source but the facade reads a string resource directly (C199_1)`() {
        val root = File("src")
        val offenders = listOf("commonMain", "androidMain", "iosMain")
            .flatMap { set -> File(root, set).walkTopDown().filter { it.extension == "kt" }.toList() }
            .map { it.relativeTo(root).invariantSeparatorsPath to it }
            .filter { (path, file) -> path != facade && direct.containsMatchIn(code(file)) }
            .map { it.first }
            .sorted()

        assertEquals(emptyList<String>(), offenders)
    }

    /** The top-level arguments of the call whose opening parenthesis is at [open] in [text]. */
    private fun arguments(text: String, open: Int): List<String> {
        val parts = mutableListOf<String>()
        var depth = 0
        var start = open + 1
        var quoted = false
        var index = open
        while (index < text.length) {
            val character = text[index]
            when {
                character == '\\' && quoted -> index += 1
                character == '"' -> quoted = !quoted
                quoted -> Unit
                character == '(' || character == '[' || character == '{' -> depth += 1
                character == ')' || character == ']' || character == '}' -> {
                    depth -= 1
                    if (depth == 0) {
                        parts += text.substring(start, index).trim()
                        return parts.filter { it.isNotEmpty() }
                    }
                }
                character == ',' && depth == 1 -> {
                    parts += text.substring(start, index).trim()
                    start = index + 1
                }
            }
            index += 1
        }
        error("unbalanced call at $open")
    }

    @Test
    fun `no sentence that shows a value is read through sdkString or sdkPlural, whose text is the logical one (C199_5, K10A-2)`() {
        // sdkString(key, value) keeps the logical text, which the consent digests hash; what a screen
        // shows goes through sdkText or sdkPluralText, which isolate each value (U+2068, U+2069) so a
        // Latin name or a number keeps its order inside Arabic text. A call with a value is allowed
        // only where the text is not drawn, each with its reason.
        val logicalByDesign = mapOf(
            "commonMain/kotlin/dev/openverify/sdk/capture/selfie/Extension.kt#sdkPlural" to
                "the time warning's spoken text (its contentDescription); the drawn text beside it is sdkPluralText's",
        )
        val call = Regex("""(?<![.\w])(sdkString|sdkPlural)\s*\(""")
        val root = File("src")
        val found = listOf("commonMain", "androidMain", "iosMain")
            .flatMap { set -> File(root, set).walkTopDown().filter { it.extension == "kt" }.toList() }
            .map { it.relativeTo(root).invariantSeparatorsPath to code(it) }
            .filter { (path, _) -> path != facade }
            .flatMap { (path, text) ->
                call.findAll(text).mapNotNull { match ->
                    val name = match.groupValues[1]
                    val values = arguments(text, match.range.last).drop(if (name == "sdkPlural") 2 else 1)
                    if (values.isEmpty()) null else "$path#$name"
                }.toList()
            }

        assertEquals(logicalByDesign.keys.toList(), found.sorted())
    }
}
