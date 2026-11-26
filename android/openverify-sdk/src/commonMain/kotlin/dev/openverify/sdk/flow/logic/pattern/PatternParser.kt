package dev.openverify.sdk.flow.logic.pattern

/**
 * C196.2 (Phase 9 C148.3, V10): the restricted grammar read into a tree, a port of
 * `packages/flow-spec/src/v2/pattern/parse.ts`; never handed to `Regex`.
 * - literal code points and the escaped syntax characters (`\.`, `\*`, ..., `\/`); `.`;
 * - bracket classes with ranges and negation over code points, which may hold `\d`, `\w` and `\s`
 *   (ASCII digits and word characters, as in ECMAScript's `u` mode, and its fixed white-space list);
 * - `^` and `$` (the whole input: no `m` flag); alternation; capturing and `(?:...)` groups;
 * - `*`, `+`, `?`, `{n}`, `{n,}` and `{n,m}` with every bound at most 100, never lazy and never on
 *   a group that already holds a quantifier (no nested quantifiers).
 * Everything else is refused with its reason and the index (in UTF-16 code units) where it starts.
 */
internal sealed class PatternNode {
    /** Code points in [ranges] (inclusive pairs), or, with [negate], every code point outside them. */
    internal class CodePoints(internal val ranges: IntArray, internal val negate: Boolean) : PatternNode()

    internal data object Start : PatternNode()

    internal data object End : PatternNode()

    internal class Sequence(internal val items: List<PatternNode>) : PatternNode()

    internal class Alternatives(internal val options: List<PatternNode>) : PatternNode()

    /** [max] -1 is unbounded. */
    internal class Repeat(internal val body: PatternNode, internal val min: Int, internal val max: Int) : PatternNode()
}

/** A refused pattern: Phase 9's `PatternRefusal`, with its [reason] and [index] (or null for the whole pattern). */
internal class PatternRefused(internal val reason: String, internal val index: Int?) : IllegalArgumentException("Pattern refused: $reason")

/** The largest bound a counted quantifier may name (V10). */
internal const val MAX_QUANTIFIER_BOUND: Int = 100

private const val END_OF_INPUT = -1

private fun pairOf(point: Int): IntArray = intArrayOf(point, point)

/** ECMAScript's `\d` and `\w` (ASCII in `u` mode without `i`), and `\s`'s fixed list. */
private val DIGIT = intArrayOf('0'.code, '9'.code)
private val WORD = intArrayOf('0'.code, '9'.code, 'A'.code, 'Z'.code, '_'.code, '_'.code, 'a'.code, 'z'.code)
private val SPACE = intArrayOf(
    0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f,
    0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
)

/** `.` matches every code point but the line terminators (no `s` flag). */
private val LINE_TERMINATORS = intArrayOf(0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029)

private fun classEscape(point: Int): IntArray? =
    when (point) {
        'd'.code -> DIGIT
        'w'.code -> WORD
        's'.code -> SPACE
        else -> null
    }

private const val SYNTAX_CHARACTERS = "^$\\.*+?()[]{}|/"
private const val QUANTIFIER_START = "*+?{"

private fun Int.isOneOf(characters: String): Boolean = this != END_OF_INPUT && this < 0x80 && characters.indexOf(this.toChar()) >= 0

private fun Int.isAsciiDigit(): Boolean = this in '0'.code..'9'.code

private fun Int.isAsciiLetter(): Boolean = this in 'a'.code..'z'.code || this in 'A'.code..'Z'.code

private class Parsed(val node: PatternNode, val quantifiable: Boolean, val quantified: Boolean)

private class Braces(val min: Int, val max: Int, val length: Int)

/** Reads code points as ECMAScript's `codePointAt` does: a lone surrogate is its own code unit. */
private class Reader(val source: String) {
    var position = 0

    val done: Boolean get() = position >= source.length

    private fun widthAt(at: Int): Int {
        val high = source[at]
        return if (high.isHighSurrogate() && at + 1 < source.length && source[at + 1].isLowSurrogate()) 2 else 1
    }

    private fun pointAt(at: Int): Int {
        if (at >= source.length) return END_OF_INPUT
        return if (widthAt(at) == 2) {
            0x10000 + ((source[at].code - 0xd800) shl 10) + (source[at + 1].code - 0xdc00)
        } else {
            source[at].code
        }
    }

    /** The code point [offset] code points after the cursor, or [END_OF_INPUT]. */
    fun peek(offset: Int = 0): Int {
        var at = position
        var skipped = 0
        while (skipped < offset && at < source.length) {
            at += widthAt(at)
            skipped += 1
        }
        return pointAt(at)
    }

    fun next(): Int {
        val point = peek()
        if (point != END_OF_INPUT) position += widthAt(position)
        return point
    }

    fun refuse(reason: String, index: Int = position): Nothing = throw PatternRefused(reason, index)
}

/**
 * `{n}`, `{n,}` or `{n,m}` at the cursor (ASCII digits), without moving it; null when it is not one.
 * Bounds are read as ECMAScript's `Number` reads them, so a bound too long for an `Int` is still
 * past [MAX_QUANTIFIER_BOUND].
 */
private fun readBraces(reader: Reader): Braces? {
    val source = reader.source
    var at = reader.position
    if (at >= source.length || source[at] != '{') return null
    at += 1
    val minStart = at
    while (at < source.length && source[at].code.isAsciiDigit()) at += 1
    if (at == minStart) return null
    val min = source.substring(minStart, at).toDouble()
    var max = min
    if (at < source.length && source[at] == ',') {
        at += 1
        val maxStart = at
        while (at < source.length && source[at].code.isAsciiDigit()) at += 1
        max = if (at == maxStart) -1.0 else source.substring(maxStart, at).toDouble()
    }
    if (at >= source.length || source[at] != '}') return null
    at += 1
    if (max != -1.0 && max < min) return Braces(1, 0, at - reader.position)
    if (min > MAX_QUANTIFIER_BOUND || max > MAX_QUANTIFIER_BOUND) return Braces(-1, -1, at - reader.position)
    return Braces(min.toInt(), max.toInt(), at - reader.position)
}

private fun parseQuantifier(reader: Reader, atom: Parsed): PatternNode {
    val at = reader.position
    if (!atom.quantifiable) reader.refuse("nothing_to_repeat", at)
    val min: Int
    val max: Int
    val character = reader.peek()
    if (character == '{'.code) {
        val braces = readBraces(reader) ?: reader.refuse("syntax", at)
        if (braces.max != -1 && braces.max < braces.min) reader.refuse("syntax", at)
        if (braces.min == -1) reader.refuse("quantifier_too_large", at)
        reader.position += braces.length
        min = braces.min
        max = braces.max
    } else {
        reader.next()
        min = if (character == '+'.code) 1 else 0
        max = if (character == '?'.code) 1 else -1
    }
    if (reader.peek() == '?'.code) reader.refuse("lazy_quantifier", reader.position)
    if (reader.peek().isOneOf(QUANTIFIER_START)) reader.refuse("nothing_to_repeat", reader.position)
    if (atom.quantified) reader.refuse("nested_quantifier", at)
    return PatternNode.Repeat(atom.node, min, max)
}

/** An escape outside a class; the cursor is on the backslash. */
private fun parseEscape(reader: Reader): PatternNode {
    val at = reader.position
    reader.next()
    val character = reader.next()
    if (character == END_OF_INPUT) reader.refuse("syntax", at)
    classEscape(character)?.let { return PatternNode.CodePoints(it, negate = false) }
    if (character in '1'.code..'9'.code || character == 'k'.code) reader.refuse("backreference", at)
    if (character == 'p'.code || character == 'P'.code) reader.refuse("property_escape", at)
    if (character.isOneOf(SYNTAX_CHARACTERS)) return PatternNode.CodePoints(pairOf(character), negate = false)
    reader.refuse("escape_unsupported", at)
}

/** One member of a class: a code point (or an escaped one), or `\d`, `\w`, `\s` as a set. */
private class ClassAtom(val point: Int, val set: IntArray?)

private fun parseClassAtom(reader: Reader): ClassAtom {
    val at = reader.position
    val character = reader.next()
    if (character != '\\'.code) return ClassAtom(character, null)
    val escaped = reader.next()
    classEscape(escaped)?.let { return ClassAtom(END_OF_INPUT, it) }
    if (escaped == 'p'.code || escaped == 'P'.code) reader.refuse("property_escape", at)
    if (escaped == '-'.code || escaped.isOneOf(SYNTAX_CHARACTERS)) return ClassAtom(escaped, null)
    reader.refuse(if (escaped == END_OF_INPUT) "syntax" else "escape_unsupported", at)
}

private fun parseClass(reader: Reader): PatternNode {
    val open = reader.position
    reader.next()
    val negate = reader.peek() == '^'.code
    if (negate) reader.next()
    val ranges = mutableListOf<Int>()
    while (true) {
        if (reader.done) reader.refuse("syntax", open)
        if (reader.peek() == ']'.code) {
            reader.next()
            return PatternNode.CodePoints(ranges.toIntArray(), negate)
        }
        val first = parseClassAtom(reader)
        if (reader.peek() == '-'.code && reader.peek(1) != ']'.code && reader.peek(1) != END_OF_INPUT) {
            val dash = reader.position
            reader.next()
            val last = parseClassAtom(reader)
            if (first.set != null || last.set != null || first.point > last.point) reader.refuse("class_range_invalid", dash)
            ranges += first.point
            ranges += last.point
        } else if (first.set == null) {
            ranges += first.point
            ranges += first.point
        } else {
            first.set.forEach { ranges += it }
        }
    }
}

private fun parseGroup(reader: Reader, depth: Int): Parsed {
    val open = reader.position
    reader.next()
    if (reader.peek() == '?'.code) {
        val marker = reader.peek(1)
        val after = reader.peek(2)
        when {
            marker == ':'.code -> reader.position += 2
            marker == '='.code || marker == '!'.code || (marker == '<'.code && (after == '='.code || after == '!'.code)) ->
                reader.refuse("lookaround", open)
            marker == '<'.code -> reader.refuse("named_group", open)
            marker.isAsciiLetter() || marker == '-'.code -> reader.refuse("flag_unsupported", open)
            else -> reader.refuse("syntax", open)
        }
    }
    val body = parseDisjunction(reader, depth + 1)
    if (reader.peek() != ')'.code) reader.refuse("syntax", open)
    reader.next()
    return Parsed(body.node, quantifiable = true, quantified = body.quantified)
}

private fun parseAtom(reader: Reader, depth: Int): Parsed {
    fun plain(node: PatternNode) = Parsed(node, quantifiable = true, quantified = false)
    return when (val character = reader.peek()) {
        '^'.code -> {
            reader.next()
            Parsed(PatternNode.Start, quantifiable = false, quantified = false)
        }
        '$'.code -> {
            reader.next()
            Parsed(PatternNode.End, quantifiable = false, quantified = false)
        }
        '.'.code -> {
            reader.next()
            plain(PatternNode.CodePoints(LINE_TERMINATORS, negate = true))
        }
        '('.code -> parseGroup(reader, depth)
        '['.code -> plain(parseClass(reader))
        '\\'.code -> plain(parseEscape(reader))
        '*'.code, '+'.code, '?'.code -> reader.refuse("nothing_to_repeat")
        '{'.code -> reader.refuse(if (readBraces(reader) == null) "syntax" else "nothing_to_repeat")
        '}'.code, ']'.code, ')'.code -> reader.refuse("syntax")
        else -> {
            reader.next()
            plain(PatternNode.CodePoints(pairOf(character), negate = false))
        }
    }
}

private fun parseAlternative(reader: Reader, depth: Int): Parsed {
    val items = mutableListOf<PatternNode>()
    var quantified = false
    while (!reader.done && reader.peek() != '|'.code && !(reader.peek() == ')'.code && depth > 0)) {
        val atom = parseAtom(reader, depth)
        if (reader.peek().isOneOf(QUANTIFIER_START)) {
            items += parseQuantifier(reader, atom)
            quantified = true
        } else {
            items += atom.node
            quantified = quantified || atom.quantified
        }
    }
    return Parsed(items.singleOrNull() ?: PatternNode.Sequence(items), quantifiable = true, quantified = quantified)
}

private fun parseDisjunction(reader: Reader, depth: Int): Parsed {
    val options = mutableListOf<PatternNode>()
    var quantified = false
    while (true) {
        val alternative = parseAlternative(reader, depth)
        options += alternative.node
        quantified = quantified || alternative.quantified
        if (reader.peek() != '|'.code) break
        reader.next()
    }
    return Parsed(options.singleOrNull() ?: PatternNode.Alternatives(options), quantifiable = true, quantified = quantified)
}

/**
 * The tree of a pattern. At the top level an alternative runs to the end (a stray `)` is refused
 * as an atom).
 *
 * @throws PatternRefused for anything outside the grammar.
 */
internal fun parsePattern(source: String): PatternNode = parseDisjunction(Reader(source), 0).node
