package dev.openverify.nfc

import java.util.logging.Level
import java.util.logging.Logger

/**
 * The loggers of the libraries the reader calls (C209.2, C213.3; review P06). JMRTD, SCUBA and
 * cert-cvc log through `java.util.logging`, which Android routes to Logcat, and what they log names
 * commands, file identifiers and status words. So they are turned off for a read and put back as
 * they were after it, whether it ends well or not. This is the only file of the module that names
 * `java.util.logging`, and it only sets levels (the SDK's `LogScanTest`).
 */
internal object LibraryLoggers {
    /** The roots of the three libraries' logger names; every logger they use is a child of one. */
    private val NAMES = listOf("org.jmrtd", "net.sf.scuba", "org.ejbca")

    /** Runs [block] with the libraries' loggers off. One read runs at a time, so the levels put back are the host's. */
    fun <T> silenced(block: () -> T): T {
        // Held here for the whole read: the platform keeps a logger only weakly.
        val loggers = NAMES.map { Logger.getLogger(it) }
        val before = loggers.map { it.level }
        loggers.forEach { it.level = Level.OFF }
        try {
            return block()
        } finally {
            loggers.forEachIndexed { index, logger -> logger.level = before[index] }
        }
    }
}
