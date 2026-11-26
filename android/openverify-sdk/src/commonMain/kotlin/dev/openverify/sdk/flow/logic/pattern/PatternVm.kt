package dev.openverify.sdk.flow.logic.pattern

/**
 * C196.2 (Phase 9 C148.3, P03): the compiled form of a pattern and the Pike VM that runs it, a port
 * of `packages/flow-spec/src/v2/pattern/vm.ts`. The program is a list of instructions; the VM keeps
 * the set of instructions every match could be at, advancing all of them one code point at a time,
 * and visits each instruction at most once per position. So a match costs at most
 * (input length + 1) x program length visits, whatever the pattern: no backtracking, and no pattern
 * can make it exponential or polynomial in the input.
 */
internal class PatternProgram internal constructor(
    internal val ops: IntArray,
    internal val x: IntArray,
    internal val y: IntArray,
    internal val sets: Array<IntArray?>,
    internal val negated: BooleanArray,
) {
    internal val size: Int get() = ops.size
}

private const val SET = 0
private const val SPLIT = 1
private const val JUMP = 2
private const val START = 3
private const val END = 4
private const val MATCH = 5

/** Matches nothing: what an index outside the program reads as, so it can never match (fails closed). */
private val DEAD = IntArray(0)

private class Emitter {
    val ops = mutableListOf<Int>()
    val x = mutableListOf<Int>()
    val y = mutableListOf<Int>()
    val sets = mutableListOf<IntArray?>()
    val negated = mutableListOf<Boolean>()

    val here: Int get() = ops.size

    fun push(op: Int, set: IntArray? = null, negate: Boolean = false): Int {
        if (ops.size >= PATTERN_PROGRAM_LIMIT) throw PatternRefused("pattern_too_complex", null)
        ops += op
        x += 0
        y += 0
        sets += set
        negated += negate
        return ops.size - 1
    }

    fun emit(node: PatternNode) {
        when (node) {
            is PatternNode.CodePoints -> push(SET, node.ranges, node.negate)
            PatternNode.Start -> push(START)
            PatternNode.End -> push(END)
            is PatternNode.Sequence -> node.items.forEach(::emit)
            is PatternNode.Alternatives -> emitAlternatives(node.options)
            is PatternNode.Repeat -> emitRepeat(node.body, node.min, node.max)
        }
    }

    /** split L1, L2; L1: first; jump end; L2: split ...; the last option falls through. */
    private fun emitAlternatives(options: List<PatternNode>) {
        val jumps = mutableListOf<Int>()
        options.forEachIndexed { index, option ->
            if (index == options.lastIndex) {
                emit(option)
                return@forEachIndexed
            }
            val split = push(SPLIT)
            x[split] = here
            emit(option)
            jumps += push(JUMP)
            y[split] = here
        }
        for (jump in jumps) x[jump] = here
    }

    /** [min] copies, then `max - min` optional ones, or a loop when unbounded. */
    private fun emitRepeat(body: PatternNode, min: Int, max: Int) {
        repeat(min) { emit(body) }
        if (max == -1) {
            val loop = here
            val split = push(SPLIT)
            x[split] = here
            emit(body)
            val jump = push(JUMP)
            x[jump] = loop
            y[split] = here
            return
        }
        val splits = mutableListOf<Int>()
        for (copy in min until max) {
            val split = push(SPLIT)
            x[split] = here
            splits += split
            emit(body)
        }
        for (split in splits) y[split] = here
    }

    fun program(): PatternProgram =
        PatternProgram(ops.toIntArray(), x.toIntArray(), y.toIntArray(), sets.toTypedArray(), negated.toBooleanArray())
}

/**
 * The program of a parsed pattern.
 *
 * @throws PatternRefused `pattern_too_complex` past [PATTERN_PROGRAM_LIMIT] instructions.
 */
internal fun compileProgram(node: PatternNode): PatternProgram {
    val emitter = Emitter()
    emitter.emit(node)
    emitter.push(MATCH)
    return emitter.program()
}

private fun inSet(ranges: IntArray, negate: Boolean, point: Int): Boolean {
    var found = false
    var index = 0
    while (index + 1 < ranges.size && !found) {
        found = point >= ranges[index] && point <= ranges[index + 1]
        index += 2
    }
    return found != negate
}

/** The input's code points, as ECMAScript iterates a string: a lone surrogate is its own code point. */
private fun codePoints(input: String): IntArray {
    val points = IntArray(input.length)
    var count = 0
    var at = 0
    while (at < input.length) {
        val high = input[at]
        if (high.isHighSurrogate() && at + 1 < input.length && input[at + 1].isLowSurrogate()) {
            points[count++] = 0x10000 + ((high.code - 0xd800) shl 10) + (input[at + 1].code - 0xdc00)
            at += 2
        } else {
            points[count++] = high.code
            at += 1
        }
    }
    return points.copyOf(count)
}

/**
 * Whether the whole of [input] matches [program], with the steps it took: every stack pop while
 * following splits and jumps, and every look at a live instruction. Each instruction is visited at
 * most once per position, so the steps are at most `4 x (positions) x (program length + 1)`.
 */
internal fun runProgram(program: PatternProgram, input: String): PatternRun {
    val points = codePoints(input)
    val length = points.size
    val size = program.size
    // seen[pc] is the last position pc was added at, so each is visited once per position.
    val seen = IntArray(size) { -1 }
    // Each instruction, visited once per position, pushes at most two: the stack never overflows.
    val stack = IntArray(2 * size + 2)
    var current = IntArray(size)
    var next = IntArray(size)
    var steps = 0L

    fun opAt(pc: Int): Int = if (pc in 0 until size) program.ops[pc] else SET

    fun setAt(pc: Int): IntArray = if (pc in 0 until size) program.sets[pc] ?: DEAD else DEAD

    fun add(list: IntArray, count: Int, start: Int, position: Int): Int {
        var added = count
        var top = 0
        stack[top++] = start
        while (top > 0) {
            val pc = stack[--top]
            steps += 1
            if (pc !in 0 until size) continue
            if (seen[pc] == position) continue
            seen[pc] = position
            when (program.ops[pc]) {
                JUMP -> stack[top++] = program.x[pc]
                SPLIT -> {
                    stack[top++] = program.y[pc]
                    stack[top++] = program.x[pc]
                }
                START -> if (position == 0) stack[top++] = pc + 1
                END -> if (position == length) stack[top++] = pc + 1
                else -> list[added++] = pc
            }
        }
        return added
    }

    var currentCount = add(current, 0, 0, 0)
    for (position in 0 until length) {
        val point = points[position]
        var nextCount = 0
        for (index in 0 until currentCount) {
            val pc = current[index]
            steps += 1
            if (opAt(pc) == SET && inSet(setAt(pc), program.negated[pc], point)) {
                nextCount = add(next, nextCount, pc + 1, position + 1)
            }
        }
        if (nextCount == 0) return PatternRun(false, steps)
        val swap = current
        current = next
        next = swap
        currentCount = nextCount
    }
    for (index in 0 until currentCount) {
        steps += 1
        if (opAt(current[index]) == MATCH) return PatternRun(true, steps)
    }
    return PatternRun(false, steps)
}
