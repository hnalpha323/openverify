package dev.openverify.sdk.privacy

import java.io.File

/**
 * C213.3 for the optional artifacts (KP10-42, Workflow 10E): every exception an artifact's main
 * sources create, and every one they throw on, is a row of the artifact's own table
 * ([SdkModule.exceptionRows], a file in the artifact's test resources that its builder fills), and the
 * table is exactly what the sources hold. So a builder never edits the SDK's tests, a module that gains
 * a throwing line without its row fails, and every row is read by a reviewer.
 *
 * A row is `file | call | message`:
 * - `file`: the source, relative to the module (`src/main/kotlin/...`);
 * - `call`: what is called to make the exception (`ChipReadException`, `IllegalStateException`,
 *   `error`, `TODO`, `require`, `check`, `requireNotNull`, `checkNotNull`), or `rethrow` for a
 *   `throw` of anything those calls did not make on the spot (an exception that was caught);
 * - `message`: what is written between the call's parentheses (for `require` and `check`, in their
 *   block), or `-` when nothing is; for a `rethrow`, what is thrown.
 *
 * The rules ([problem]): a message is one string literal with no value in it and nothing added to it;
 * a `ChipReadException` takes one `ChipReadFailure` constant, which gives it the SDK's fixed message
 * (`ExceptionCanaryTest`); nothing passes a cause, since a cause's own message would reach the host;
 * and only an exception caught as a `CancellationException` or a `ChipReadException` is thrown on.
 * Blank lines and lines that start with `#` are comments.
 */
internal object ModuleExceptions {
    internal data class Row(val file: String, val call: String, val message: String) {
        override fun toString(): String = "$file | $call | $message"
    }

    private const val THROWN = """[A-Z]\w*(?:Exception|Error|Refused)|error|TODO"""
    private const val CHECKED = "require|check|requireNotNull|checkNotNull"
    private val THROW = Regex("""\bthrow\s+([^\n;]+)""")
    private val MADE = Regex("""^(?:$THROWN)\s*\(""")
    private val LITERAL = Regex(""""[^"$\\]*"""")
    private val FAILURE = Regex("""ChipReadFailure\.[A-Z][A-Z_]*""")

    /** The rows the source [text] of [file] holds, in source order. */
    fun rowsIn(file: String, text: String): List<Row> {
        val thrown = SourceScan.calls(text, THROWN).map { it.start to Row(file, it.name, shown(it.arguments)) }
        val checked = SourceScan.calls(text, CHECKED).map { call -> call.start to Row(file, call.name, shown(blockAfter(text, call.end))) }
        // Whatever is thrown that is not made on the spot by one of the calls above: a caught exception thrown on.
        val rethrown = THROW.findAll(text).filterNot { MADE.containsMatchIn(it.groupValues[1]) }.map { it.range.first to Row(file, "rethrow", shown(it.groupValues[1])) }
        return (thrown + checked + rethrown).sortedBy { it.first }.map { it.second }
    }

    /** Every row of [module]'s main sources, by file and then in source order. */
    fun rowsOf(module: SdkModule): List<Row> {
        val prefix = File(module.directory).invariantSeparatorsPath + "/"
        return SourceScan.sourcesOf(module).flatMap { (path, text) -> rowsIn(path.removePrefix(prefix), text) }
    }

    /** The rows of a table's [text]. */
    fun parse(text: String): List<Row> = text.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.map { line ->
        val parts = line.split(" | ", limit = 3)
        require(parts.size == 3) { "A row is file | call | message" }
        Row(parts[0].trim(), parts[1].trim(), parts[2].trim())
    }

    /** Why [row] breaks the fixed-message rule, given the [source] it is in; `null` when it keeps it. */
    fun problem(row: Row, source: String): String? = when {
        row.call == "rethrow" ->
            if (Regex("""catch\s*\(\s*${Regex.escape(row.message)}\s*:\s*(CancellationException|ChipReadException)\s*\)""").containsMatchIn(source)) {
                null
            } else {
                "only an exception caught as a CancellationException or a ChipReadException is thrown on"
            }
        row.call == "ChipReadException" -> if (FAILURE.matches(row.message)) null else "a ChipReadException takes one ChipReadFailure constant"
        row.message == "-" || LITERAL.matches(row.message) -> null
        else -> "a message is one string literal with no value in it, and no cause is passed"
    }

    private fun shown(written: String?): String = written.orEmpty().trim().replace(Regex("""\s+"""), " ").ifEmpty { "-" }

    /** What is written inside the block after the call that ends at [close]: the lazy message of a check. */
    private fun blockAfter(text: String, close: Int): String? {
        val rest = text.substring(close + 1)
        if (!rest.trimStart().startsWith("{")) return null
        val open = close + 1 + rest.indexOf('{')
        var depth = 0
        var quoted = false
        var index = open
        while (index < text.length) {
            val char = text[index]
            when {
                quoted && char == '\\' -> index++
                char == '"' -> quoted = !quoted
                quoted -> Unit
                char == '{' -> depth++
                char == '}' -> if (--depth == 0) return text.substring(open + 1, index)
            }
            index++
        }
        return null
    }
}
