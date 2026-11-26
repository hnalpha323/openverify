package dev.openverify.sdk.flow.logic.pattern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * C196.2 (Phase 9 C148.3, P03, V10): hand cases over the restricted grammar, as Phase 9's
 * `pattern/parse.ts`, `vm.ts` and their test state it, before the exported vectors land
 * ([PatternVectorsTest] runs those). A pattern applies to the whole value; no `Regex` is built from
 * a pattern's text.
 */
internal class PatternTest {

    private fun compiled(source: String): CompiledPattern =
        when (val result = compilePattern(source)) {
            is PatternCompilation.Compiled -> result.pattern
            is PatternCompilation.Refused -> fail("refused $source: ${result.reason} at ${result.index}")
        }

    private fun matches(source: String, input: String): Boolean = matchPattern(compiled(source), input)

    private fun refusal(source: String): Pair<String, Int?> =
        when (val result = compilePattern(source)) {
            is PatternCompilation.Compiled -> fail("compiled $source")
            is PatternCompilation.Refused -> result.reason to result.index
        }

    @Test
    fun aPatternAppliesToTheWholeValue() {
        assertTrue(matches("abc", "abc"))
        assertFalse(matches("abc", "ab"))
        assertFalse(matches("abc", "abcd"))
        assertFalse(matches("abc", "xabc"))
        assertFalse(matches("abc", ""))
        assertTrue(matches("^abc$", "abc"))
        assertFalse(matches("a$", "a\n"), "\$ is the end of the input only (no m flag)")
        assertFalse(matches("^b", "ab"))
    }

    @Test
    fun classesRangesNegationAndTheClassEscapes() {
        assertTrue(matches("[a-c]+", "abcabc"))
        assertFalse(matches("[a-c]+", "abd"))
        assertTrue(matches("[^a-c]", "d"))
        assertFalse(matches("[^a-c]", "b"))
        assertTrue(matches("[^]", "\n"), "an empty negated class matches any code point")
        assertFalse(matches("[]", "a"), "an empty class matches nothing")
        assertTrue(matches("\\d{3}", "123"))
        assertFalse(matches("\\d", "٣"), "\\d is ASCII only")
        assertTrue(matches("\\w+", "aZ_9"))
        assertFalse(matches("\\w", "é"), "\\w is ASCII only")
        assertTrue(matches("\\s", " "))
        assertTrue(matches("\\s", "　"))
        assertTrue(matches("\\s", "﻿"))
        assertTrue(matches("\\s", "\u000b"))
        assertFalse(matches("\\s", "\u0085"), "NEL is not in ECMAScript's \\s")
        assertFalse(matches("\\s", "​"))
        assertTrue(matches("[\\d\\s-]+", "12 3-4"))
        assertTrue(matches("[a\\-z]+", "a-z"))
        assertTrue(matches("[a-]", "-"), "a trailing dash is literal")
        assertTrue(matches("[\\]]", "]"))
        assertTrue(matches("\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/\\^\\$\\\\", ".*+?()[]{}|/^$\\"))
    }

    @Test
    fun theDotMatchesEveryCodePointButTheLineTerminators() {
        assertTrue(matches(".", "a"))
        assertTrue(matches(".", "😀"), "a whole astral code point, as the u flag reads it")
        assertFalse(matches("..", "😀"))
        for (terminator in listOf("\n", "\r", " ", " ")) {
            assertFalse(matches(".", terminator))
        }
        assertTrue(matches(".", "\u0085"))
        assertTrue(matches("[😀-🙏]", "😃"), "a range of astral code points")
    }

    @Test
    fun alternationGroupsAndQuantifiers() {
        assertTrue(matches("cat|dog", "dog"))
        assertFalse(matches("cat|dog", "cats"))
        assertTrue(matches("(?:ab)+", "ababab"))
        assertTrue(matches("(ab)?c", "c"))
        assertTrue(matches("a{3}", "aaa"))
        assertFalse(matches("a{3}", "aaaa"))
        assertTrue(matches("a{2,}", "aaaaa"))
        assertFalse(matches("a{2,}", "a"))
        assertTrue(matches("a{1,3}b", "aab"))
        assertFalse(matches("a{1,3}b", "aaaab"))
        assertTrue(matches("a{0,100}", "a".repeat(100)))
        assertTrue(matches("(?:)*", ""), "an empty group may repeat without looping")
        assertTrue(matches("a|", ""))
        assertTrue(matches("x*", ""))
        assertTrue(matches("^(?:[A-Z]{2}\\d{2}[A-Z0-9]{1,30})$", "GB82WEST12345698765432"))
    }

    @Test
    fun refusesEachConstructOutsideTheGrammarWithItsReasonAndIndex() {
        val cases = listOf(
            "" to ("empty" to null),
            "a".repeat(501) to ("too_long" to null),
            "ab(?=c)" to ("lookaround" to 2),
            "(?!a)" to ("lookaround" to 0),
            "(?<=a)b" to ("lookaround" to 0),
            "(?<!a)b" to ("lookaround" to 0),
            "x\\1" to ("backreference" to 1),
            "\\k<a>" to ("backreference" to 0),
            "(?<name>a)" to ("named_group" to 0),
            "\\p{L}" to ("property_escape" to 0),
            "[\\P{L}]" to ("property_escape" to 1),
            "(?i)a" to ("flag_unsupported" to 0),
            "(?-i:a)" to ("flag_unsupported" to 0),
            "\\b" to ("escape_unsupported" to 0),
            "\\0" to ("escape_unsupported" to 0),
            "[\\b]" to ("escape_unsupported" to 1),
            "*a" to ("nothing_to_repeat" to 0),
            "a**" to ("nothing_to_repeat" to 2),
            "^*" to ("nothing_to_repeat" to 1),
            "{2}" to ("nothing_to_repeat" to 0),
            "(?:a+)+" to ("nested_quantifier" to 6),
            "(a*)*" to ("nested_quantifier" to 4),
            "a+?" to ("lazy_quantifier" to 2),
            "a{101}" to ("quantifier_too_large" to 1),
            "a{1,101}" to ("quantifier_too_large" to 1),
            "a{99999999999999999999}" to ("quantifier_too_large" to 1),
            "[z-a]" to ("class_range_invalid" to 2),
            "[\\d-z]" to ("class_range_invalid" to 3),
            "(" to ("syntax" to 0),
            "(?" to ("syntax" to 0),
            "a)" to ("syntax" to 1),
            "[a" to ("syntax" to 0),
            "a{3,2}" to ("syntax" to 1),
            "a{" to ("syntax" to 1),
            "{" to ("syntax" to 0),
            "}" to ("syntax" to 0),
            "]" to ("syntax" to 0),
            "a\\" to ("syntax" to 1),
        )
        val wrong = cases.mapNotNull { (source, expected) ->
            val got = refusal(source)
            if (got == expected) null else "$source: $got, expected $expected"
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun acceptsAProgramUpToItsLimitAndRefusesOnePastIt() {
        val per = "[a-z]{100}"
        assertTrue(compilePattern(per.repeat(PATTERN_PROGRAM_LIMIT / 100 - 1)) is PatternCompilation.Compiled)
        assertEquals("pattern_too_complex" to null, refusal(per.repeat(PATTERN_PROGRAM_LIMIT / 100 + 1)))
    }

    @Test
    fun keepsTheSourceAndRefusesAnInputPastTheCap() {
        val any = compiled("[^]*")
        assertEquals("[^]*", any.source)
        assertTrue(matchPattern(any, "a".repeat(PATTERN_INPUT_LIMIT)))
        assertFalse(matchPattern(any, "a".repeat(PATTERN_INPUT_LIMIT + 1)))
    }

    @Test
    fun matchesNothingForAPatternItCannotCompileFailingClosed() {
        assertFalse(matchPatternSource("(a)\\1", "aa"))
        assertTrue(matchPatternSource("ab", "ab"))
    }

    /**
     * Linear time (P03; rule 6: a step count of the VM, never the clock). Each instruction is
     * visited at most once per input position, so a match costs at most
     * `4 x (input length + 1) x (program length + 1)` steps (the bound counts each stack pop and
     * each step over the live list); a backtracking engine takes 2^n steps on the first two
     * patterns and n^5 on the third.
     */
    @Test
    fun thePathologicalPatternsStayLinearInTheInput() {
        val pathological = listOf(
            "(?:a|a)*" to "a".repeat(PATTERN_INPUT_LIMIT - 1) + "b",
            "(?:a|ab|b)*c" to "ab".repeat(PATTERN_INPUT_LIMIT / 2),
            "a*a*a*a*a*b" to "a".repeat(PATTERN_INPUT_LIMIT),
            ".*.*.*.*=x" to "x=".repeat(PATTERN_INPUT_LIMIT / 2),
            "(?:\\w|\\d|[a-z0-9_])*!" to "a1_".repeat(3333),
            "[a-z]{100}".repeat(19) to "a".repeat(PATTERN_INPUT_LIMIT),
        )
        for ((source, input) in pathological) {
            val pattern = compiled(source)
            val run = runPattern(pattern, input)
            assertFalse(run.matches, source)
            val bound = 4L * (input.length + 1) * (programLength(pattern) + 1)
            assertTrue(run.steps in 1..bound, "$source: ${run.steps} steps, bound $bound")
        }
    }

    @Test
    fun theStepCountGrowsLinearlyWithTheInput() {
        val pattern = compiled("(?:a|a)*b")
        val short = runPattern(pattern, "a".repeat(1_000)).steps
        val long = runPattern(pattern, "a".repeat(10_000)).steps
        assertTrue(long in (9 * short)..(11 * short), "1,000: $short steps; 10,000: $long steps")
    }
}
