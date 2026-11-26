package dev.openverify.sdk.testing

import java.lang.management.ManagementFactory

/**
 * Rule 6 (a CPU budget is deterministic, and is measured in thread CPU time): a cost held as a
 * multiple of a fixed reference workload measured beside it, never as milliseconds.
 *
 * Thread CPU time is not independent of the host's load: with every core busy, the same code took
 * about twice the CPU time here (a barcode side's frame 83.7 ms beside 36 busy loops against 39.8 to
 * 44.3 ms on a quiet host; Workflow 10C, `docs/tdd/phase10-integration-10c.tdd.md`), because a
 * shared core, its caches and its clock speed all move with the load. The reference loop moves with
 * them, so each sample is taken as a pair, the reference then the work, back to back on one thread,
 * and the figure is the median of the pairs' ratios. The milliseconds are still printed for the
 * record; no assertion reads them.
 */
internal object CpuCost {
    private val threads = ManagementFactory.getThreadMXBean()

    /** 4 MiB of fixed bytes: more than a core's private caches hold, as the measured work reads. */
    private val field = ByteArray(1 shl 22) { (it * 31 + (it ushr 9)).toByte() }

    /** Keeps the reference loop's result alive, so the JIT cannot drop the loop. */
    @Volatile
    private var sink = 0L

    /** What a measurement answers: the work as a multiple of the reference, and both in milliseconds. */
    internal data class Relative(val ratio: Double, val millis: Double, val referenceMillis: Double)

    /** Whether the JVM measures the current thread's CPU time; every caller asserts it. */
    val supported: Boolean get() = threads.isCurrentThreadCpuTimeSupported

    /** The reference workload: [REFERENCE_PASSES] passes over [field] with a branch and integer sums. */
    fun reference() {
        var sum = 0L
        repeat(REFERENCE_PASSES) { pass ->
            for (index in field.indices) {
                val value = field[index].toInt() and 0xFF
                sum += if (value > 127) value * 3L else value.toLong() + pass
            }
        }
        sink = sum
    }

    /** The thread CPU time of [block], in milliseconds. */
    fun millis(block: () -> Unit): Double {
        val start = threads.currentThreadCpuTime
        block()
        return (threads.currentThreadCpuTime - start) / 1_000_000.0
    }

    /**
     * [block] against [reference]: after [warmUps] unmeasured pairs, [runs] pairs measured back to
     * back; the answer is the pair at the median ratio.
     */
    fun relative(runs: Int, warmUps: Int = 5, block: () -> Unit): Relative {
        repeat(warmUps) {
            reference()
            block()
        }
        val pairs = List(runs) {
            val referenceMillis = millis(::reference)
            val workMillis = millis(block)
            Relative(workMillis / referenceMillis, workMillis, referenceMillis)
        }
        return pairs.sortedBy { it.ratio }[runs / 2]
    }

    private const val REFERENCE_PASSES = 4
}
