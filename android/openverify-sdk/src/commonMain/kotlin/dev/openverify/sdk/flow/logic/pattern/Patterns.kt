package dev.openverify.sdk.flow.logic.pattern

/**
 * C196.2 (Phase 9 C148.3, P03, V10): field patterns in the restricted grammar, a Kotlin port of
 * `packages/flow-spec/src/v2/pattern/`, compiled to our own linear-time matcher, never to `Regex`
 * (ours, mirroring Phase 9's rule). It passes the server's exported vectors
 * (`contracts/fixtures/flow-spec/pattern-vectors.json`, C196.4), so the device's inline feedback and
 * the server's validation agree on a value; the server's check stays the final one (C195.10). A
 * pattern applies to the whole value.
 */

/** Inputs longer than this (in UTF-16 code units, as Phase 9 counts) never match (Phase 11's G-REGEX re-checks it). */
internal const val PATTERN_INPUT_LIMIT: Int = 10_000

/** A pattern's longest source (C148.3; the component schema bounds it too). */
internal const val PATTERN_SOURCE_LIMIT: Int = 500

/**
 * The most instructions a compiled pattern may hold (Phase 9's `PATTERN_PROGRAM_LIMIT`, ours,
 * provisional). Basis: the matcher visits each instruction at most once per input character, so this
 * bounds one match at [PATTERN_INPUT_LIMIT] x 2,048 visits.
 */
internal const val PATTERN_PROGRAM_LIMIT: Int = 2048

/** Why [compilePattern] refuses a pattern: Phase 9's `PATTERN_REFUSAL_REASONS`, in its order. */
internal val PATTERN_REFUSAL_REASONS: List<String> = listOf(
    "empty",
    "too_long",
    "syntax",
    "backreference",
    "lookaround",
    "named_group",
    "property_escape",
    "flag_unsupported",
    "escape_unsupported",
    "nothing_to_repeat",
    "nested_quantifier",
    "lazy_quantifier",
    "quantifier_too_large",
    "class_range_invalid",
    "pattern_too_complex",
)

/** A compiled pattern: its [source] and a program no caller can run except through [matchPattern]. */
internal class CompiledPattern internal constructor(internal val source: String, internal val program: PatternProgram)

/** What [compilePattern] answers. */
internal sealed class PatternCompilation {
    internal data class Compiled(internal val pattern: CompiledPattern) : PatternCompilation()

    /** [reason] is one of [PATTERN_REFUSAL_REASONS]; [index] in UTF-16 code units, or null for the whole pattern. */
    internal data class Refused(internal val reason: String, internal val index: Int?) : PatternCompilation()
}

/** One match and the VM steps it took, for the linear-time budget (C196.4). */
internal data class PatternRun(internal val matches: Boolean, internal val steps: Long)

/** The pattern compiled, or the reason (`pattern_refused`) and where it starts. */
internal fun compilePattern(source: String): PatternCompilation {
    if (source.isEmpty()) return PatternCompilation.Refused("empty", null)
    if (source.length > PATTERN_SOURCE_LIMIT) return PatternCompilation.Refused("too_long", null)
    return try {
        PatternCompilation.Compiled(CompiledPattern(source, compileProgram(parsePattern(source))))
    } catch (refused: PatternRefused) {
        PatternCompilation.Refused(refused.reason, refused.index)
    }
}

/** Whether the whole of [input] matches; an input past [PATTERN_INPUT_LIMIT] does not (failing closed). */
internal fun matchPattern(pattern: CompiledPattern, input: String): Boolean = runPattern(pattern, input).matches

/** [matchPattern] with the steps it took; an input past [PATTERN_INPUT_LIMIT] takes none and does not match. */
internal fun runPattern(pattern: CompiledPattern, input: String): PatternRun {
    if (input.length > PATTERN_INPUT_LIMIT) return PatternRun(false, 0)
    return runProgram(pattern.program, input)
}

/** Whether [input] matches the pattern [source]; nothing matches a pattern that cannot be compiled (failing closed). */
internal fun matchPatternSource(source: String, input: String): Boolean =
    when (val compiled = compilePattern(source)) {
        is PatternCompilation.Compiled -> matchPattern(compiled.pattern, input)
        is PatternCompilation.Refused -> false
    }

/** The compiled program's instruction count (the step budget's basis, C196.4). */
internal fun programLength(pattern: CompiledPattern): Int = pattern.program.size
