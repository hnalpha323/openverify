package dev.openverify.sdk.flow.logic

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C196.3 (review H08): the SDK leaves the JVM default locale alone, so a value it formats with the
 * default locale follows the host device's own setting, and `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` and
 * `my-MM` format digits that are not ASCII. This scan refuses locale-less `String.format`,
 * `"…".format`, `DateTimeFormatter`, `NumberFormat` (and its `DecimalFormat`), `SimpleDateFormat` and
 * `java.util.Formatter` in the packages that build values sent to the server or the chip: `api/`,
 * `flow/`, `consent/`, `ui/screen/`, `ui/steps/` and `mrz/`, in every main source set. Common code
 * builds those values by hand (Kotlin's own number `toString()` is ASCII on every platform), and
 * `androidMain` passes `Locale.ROOT`. A hit in another owner's file is a finding for that owner.
 */
internal class LocaleFormatScanTest {

    @Test
    fun `the matcher refuses each locale-less form and allows the Locale ROOT ones`() {
        val dollar = '$'
        val refused = listOf(
            """val text = String.format("%d", count)""",
            """val text = java.lang.String.format("%02d", day)""",
            """val text = "%d".format(count)""",
            "val text = \"\"\"%d\"\"\".format(count)",
            """val text = "%1${dollar}s-%2${dollar}s" .format(a, b)""",
            """val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")""",
            """val formatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT)""",
            """val numbers = NumberFormat.getInstance()""",
            """val numbers = NumberFormat.getIntegerInstance()""",
            """val decimals = DecimalFormat("0.00")""",
            """val dates = SimpleDateFormat("yyyy-MM-dd")""",
            """val out = java.util.Formatter(builder)""",
        )
        val allowed = listOf(
            """val text = String.format(Locale.ROOT, "%d", count)""",
            """val text = "%d".format(Locale.ROOT, count)""",
            """val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT)""",
            """val iso = DateTimeFormatter.ISO_LOCAL_DATE""",
            """val numbers = NumberFormat.getInstance(Locale.ROOT)""",
            """val decimals = DecimalFormat("0.00", DecimalFormatSymbols(Locale.ROOT))""",
            """val dates = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)""",
            """import java.time.format.DateTimeFormatter""",
            """val day = date.format(DateTimeFormatter.ISO_LOCAL_DATE)""",
            """val text = count.toString()""",
            """val url = "https://example.com/" + "format(x)"""",
            """// String.format("%d", count) in a comment""",
            """/* NumberFormat.getInstance() in a block comment */""",
        )
        assertEquals((1..refused.size).toList(), localeLessFormatting(refused.joinToString("\n")))
        assertEquals(emptyList<Int>(), localeLessFormatting(allowed.joinToString("\n")))
    }

    @Test
    fun `no package that builds a value for the server or the chip formats with the default locale (C196_3)`() {
        val packages = listOf("api", "flow", "consent", "ui/screen", "ui/steps", "mrz")
        assertTrue(File("src/commonMain/kotlin/dev/openverify/sdk/flow").isDirectory, "run from the module directory")
        val hits = listOf("commonMain", "androidMain", "iosMain").flatMap { sourceSet ->
            packages.flatMap { pkg ->
                File("src/$sourceSet/kotlin/dev/openverify/sdk/$pkg").walkTopDown().filter { it.isFile && it.extension == "kt" }
                    .flatMap { file -> localeLessFormatting(file.readText()).map { line -> "${file.path}:$line" } }
                    .toList()
            }
        }
        assertEquals(emptyList<String>(), hits)
    }
}

/** A locale whose digits are ASCII: what `androidMain` passes. `Locale.getDefault()` is the hazard itself. */
private const val ASCII_LOCALE = """Locale\.(ROOT|US|ENGLISH)\b"""

/** The calls that take the default locale unless their first argument is an ASCII locale. */
private val FORMAT_CALLS = listOf(
    Regex("""\bString\.format\(\s*(?!$ASCII_LOCALE)"""),
    Regex(""""\s*\.format\(\s*(?!$ASCII_LOCALE)"""),
)

/** The formatter classes: a line naming one must pass an ASCII locale, or be a fixed `ISO_` formatter. */
private val FORMATTER_CLASSES = Regex("""\b(DateTimeFormatter|NumberFormat|DecimalFormat|SimpleDateFormat|Formatter)\b""")

/**
 * The 1-based lines of [source] that format with the default locale (comments left out, line
 * numbers kept; a `//` after `:` is a URL, not a comment; imports are not uses).
 */
internal fun localeLessFormatting(source: String): List<Int> {
    val code = source
        .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)) { comment -> "\n".repeat(comment.value.count { it == '\n' }) }
        .replace(Regex("""(?<!:)//[^\n]*"""), "")
    val asciiLocale = Regex(ASCII_LOCALE)
    return code.lines().mapIndexedNotNull { index, line ->
        val refused = !line.trimStart().startsWith("import ") && (
            FORMAT_CALLS.any { it.containsMatchIn(line) } ||
                (FORMATTER_CLASSES.containsMatchIn(line) && !asciiLocale.containsMatchIn(line) && "ISO_" !in line)
            )
        (index + 1).takeIf { refused }
    }
}
