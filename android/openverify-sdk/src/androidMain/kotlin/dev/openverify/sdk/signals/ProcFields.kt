package dev.openverify.sdk.signals

/**
 * KP10-22 (C210.3): the whitespace-separated fields of one `/proc` line, read without a `Regex`, so
 * the probes' first, timed run compiles none and a line costs one pass over its characters. The
 * fields are the ones a split of the trimmed line on runs of `\s` gave (`IntegrityProbesReadsTest` holds the
 * two equal): a separator is a space or one of the control characters tab to carriage return.
 */
internal object ProcFields {
    private fun separator(char: Char): Boolean = char == ' ' || char in '\t'..'\r'

    /**
     * The text from field [index] (0-based) to the line's end, trimmed, or `null` when the line has
     * fewer fields. The last field may hold spaces, as a mapped path does.
     */
    fun rest(line: String, index: Int): String? {
        val text = line.trim()
        val start = skip(text, 0, index)
        return if (start < text.length) text.substring(start).trim() else null
    }

    /** The first [count] fields, or `null` when the line has fewer. */
    fun leading(line: String, count: Int): List<String>? {
        val text = line.trim()
        val fields = ArrayList<String>(count)
        var start = 0
        while (fields.size < count && start < text.length) {
            var end = start
            while (end < text.length && !separator(text[end])) end++
            fields += text.substring(start, end)
            start = skip(text, start, 1)
        }
        return fields.takeIf { it.size == count }
    }

    /** The index where the field [fields] after the one at [from] starts, or the text's length. */
    private fun skip(text: String, from: Int, fields: Int): Int {
        var at = from
        repeat(fields) {
            while (at < text.length && !separator(text[at])) at++
            while (at < text.length && separator(text[at])) at++
        }
        return at
    }
}
