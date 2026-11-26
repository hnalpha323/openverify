package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * C213.3 (review P06) as a scan over every shipped module: an exception's message is a fixed text.
 * Where a message is built with a value (`$name`, `${...}`), the value is in the table below with
 * why it can hold no personal data, typed value, response body or server `detail`. A new template
 * fails here until it has its line; the rule for a new exception is a constant message and a code.
 */
internal class ExceptionMessageScanTest {

    @Test
    fun `every value an exception's message is built from is in the table`() {
        val found = SourceScan.sources.associate { (path, text) -> path to ExceptionMessages.templates(text) }.filterValues { it.isNotEmpty() }

        assertEquals(render(ALLOWED.mapValues { (_, templates) -> templates.map { it.first } }), render(found))
    }

    @Test
    fun `the scan reads a constructor's message, an error and the block of a check`() {
        val text = """
            class Refusal(val code: String) : IllegalArgumentException("Refused: ${'$'}code")
            fun f(value: String, items: Map<String, Int>) {
                require(value.isNotEmpty()) { "A fixed message" }
                require(items.isEmpty()) { "Outside: ${'$'}{items.keys.map { it.length }}" }
                check(value.length < MAX) { "At most ${'$'}MAX" }
                if (value == "x") error("no ${'$'}{value.length} \${'$'}escaped")
                throw IllegalStateException("fixed")
            }
        """.trimIndent()

        assertEquals(listOf("\$code", "\${items.keys.map { it.length }}", "\$MAX", "\${value.length}"), ExceptionMessages.templates(text))
    }

    private fun render(table: Map<String, List<String>>): String =
        table.toSortedMap().entries.joinToString("\n") { (path, templates) -> "$path\n" + templates.joinToString("\n") { "    $it" } }

    private companion object {
        const val COMMON = "src/commonMain/kotlin/dev/openverify/sdk"

        /** Each template, in its file's order, with why it holds no personal data and no server text. */
        val ALLOWED: Map<String, List<Pair<String, String>>> = mapOf(
            "$COMMON/api/FlowApiClient.kt" to listOf(
                "\$problems" to "the names of signal members outside their contract (AndroidSignalContract.problems), never their values",
                "\${problems.keys.map { it.wireName }}" to "the wire names of input fields outside their contract, never what was typed",
                "\${personProblems.keys.map { \"\${it.index}/\${it.field.wireName}\" }}" to "an associated person's index and its fields' wire names, never what was typed",
            ),
            "$COMMON/api/FlowApiException.kt" to listOf(
                "\$status" to "the code: the answer's HTTP status, a number",
                "\$status" to "the message: the answer's HTTP status, a number",
            ),
            "$COMMON/camera/FrameSampler.kt" to listOf("\$MAX_HZ" to "a constant"),
            "$COMMON/capture/selfie/YunetDecode.kt" to listOf("\$index" to "an index into the detector's faces, a number"),
            "$COMMON/flow/EntrySteps.kt" to listOf(
                "\${step.type}" to "the type of a step where a one-time-code step was expected: a programming error, and the type is the registry's own constant",
                "\${step.type}" to "as above, where a form step's fields were asked for",
                "\${step.type}" to "as above, where a form step's guidance was asked for",
            ),
            "$COMMON/flow/logic/Visibility.kt" to listOf("\$code" to "one of two constant codes (RULE_INVALID, SCOPE_INVALID); no part of the rule"),
            "$COMMON/flow/logic/pattern/PatternParser.kt" to listOf("\$reason" to "a constant reason code (every refuse call passes a literal); no part of the pattern"),
            "$COMMON/model/Flow.kt" to listOf("\$key" to "the name of the member a step lacks (id or type), a constant; FlowHttp keeps only the exception's class"),
            "$COMMON/model/SelfieCapture.kt" to listOf("\$MAX_CLIENT_ELAPSED_MS" to "a constant"),
            "$COMMON/model/WireEnums.kt" to listOf(
                // KP10-37: the unknown value itself is no longer in the message; only the enum's name is.
                "\${descriptor.serialName}" to "the enum's own name, a constant",
                "\${descriptor.serialName}" to "the enum's own name, a constant",
                "\${value.name}" to "the placeholder's own name (UNKNOWN), a constant",
            ),
            "$COMMON/mrz/Mrz.kt" to listOf("\${index + 1}" to "the position of a character that is no MRZ character, never the character or the line"),
        )
    }
}
