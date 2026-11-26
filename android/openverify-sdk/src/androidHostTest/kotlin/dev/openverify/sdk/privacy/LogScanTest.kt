package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.3 (review P06, F31), the final list of Workflow 10C, over the main sources of every shipped
 * module ([SdkModule.SHIPPED]): the SDK logs only through `SdkLog`, with constant codes.
 * - No `Log.*`, `println`, `print`, `printStackTrace`, `System.out`, `System.err`, `NSLog`, logging
 *   framework or stack-trace text appears in a main source. The allowlist is one entry: `Log.w` in the
 *   Android `platformLog` actual, which writes `SdkLog`'s codes and only in a debuggable host.
 * - `platformLog` is called only by `SdkLog`, so nothing reaches Logcat around the code check.
 * - Each optional artifact has one logger of its own with `SdkLog`'s grammar and rule (`SdkLog` is
 *   internal to the SDK, so another module cannot call it; Workflow 10E): its file is the artifact's
 *   only `Log.w`, written only in a debuggable host, and every call of it passes a string literal code.
 * - `java.util.logging` is named by one file, `openverify-nfc`'s, which only turns the loggers of the
 *   chip libraries off for a read and restores them (C213.3, C209.2): it logs nothing itself.
 * - Every `SdkLog.log` call passes a string literal code, never a value, and `SdkLog` is never
 *   imported by member or aliased, which would hide a call from this scan.
 */
internal class LogScanTest {

    @Test
    fun `nothing logs outside SdkLog's platform writer`() {
        val found = SourceScan.sources.flatMap { (path, text) ->
            SourceScan.codeLines(text).flatMap { (number, line) ->
                FORBIDDEN.filter { it.containsMatchIn(line) }
                    .filterNot { (path == PLATFORM_WRITER || path in MODULE_LOGGERS.values) && it == ANDROID_LOG }
                    .filterNot { path == LIBRARY_LOGGERS && it == JAVA_LOGGING }
                    .map { "$path:$number: ${it.pattern}" }
            }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `the platform writer's only log call writes the code, and only in a debuggable host`() {
        val writer = SourceScan.code(File(PLATFORM_WRITER).readText())

        assertEquals(listOf("Log.w(TAG, code)"), ANDROID_LOG.findAll(writer).map { match -> writer.substring(match.range.first).substringBefore(")") + ")" }.toList())
        assertTrue(Regex("""if \(HostDebuggable\.debuggable\) \{\s*Log\.w\(TAG, code\)\s*\}""").containsMatchIn(writer), writer)
    }

    @Test
    fun `no logging class is imported outside the platform writer`() {
        val found = SdkModule.SHIPPED.flatMap { module ->
            module.mainRoots.map(::File).filter { it.isDirectory }.flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        }.flatMap { file ->
            val path = file.invariantSeparatorsPath
            file.readLines().filter { it.trimStart().startsWith("import ") }.filter { line -> LOGGING_IMPORTS.any { it.containsMatchIn(line) } }
                .filterNot { (path == PLATFORM_WRITER || path in MODULE_LOGGERS.values) && "android.util.Log" in it }
                .filterNot { path == LIBRARY_LOGGERS && "java.util.logging" in it }
                .map { "$path: ${it.trim()}" }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `platformLog is called only by SdkLog`() {
        val callers = SourceScan.sources.filter { (_, text) -> SourceScan.calls(text, "platformLog").isNotEmpty() }.map { it.first }

        assertEquals(listOf("src/commonMain/kotlin/dev/openverify/sdk/log/SdkLog.kt"), callers)
    }

    @Test
    fun `every SdkLog call passes a constant code`() {
        val found = SourceScan.sources.flatMap { (path, text) ->
            SDK_LOG_CALL.findAll(text).map { it.groupValues[1].trim() }.filterNot { CODE_LITERAL.matches(it) }.map { "$path: SdkLog.log($it)" }.toList()
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `SdkLog is called by its name everywhere, so every call is one the scan reads`() {
        val calls = SourceScan.sources.sumOf { (_, text) -> SDK_LOG_CALL.findAll(text).count() }
        val references = SourceScan.sources.filterNot { (path, _) -> path.endsWith("/log/SdkLog.kt") }
            .sumOf { (_, text) -> SourceScan.codeLines(text).sumOf { (_, line) -> Regex("""\bSdkLog\b""").findAll(line).count() } }

        // Each mention outside an import is a `SdkLog.log("...")` call: no alias, no reference passed on.
        assertEquals(calls, references)
        assertTrue(calls > 20, "$calls calls")
    }

    @Test
    fun `each optional artifact has its one logger, and no other module has one`() {
        assertEquals(SdkModule.SHIPPED.filter { it.role == SdkModule.Role.OPTIONAL }.map { it.name }, MODULE_LOGGERS.keys.toList())
        MODULE_LOGGERS.forEach { (module, path) ->
            assertTrue(path.startsWith("../$module/src/main/"), path)
            assertTrue(File(path).isFile, "$module has no logger at $path")
        }
    }

    @Test
    fun `an artifact's logger writes only the code, only in a debuggable host, after checking it is a code`() {
        MODULE_LOGGERS.forEach { (module, path) ->
            val writer = SourceScan.code(File(path).readText())

            assertEquals(listOf("Log.w(TAG, code)"), ANDROID_LOG.findAll(writer).map { match -> writer.substring(match.range.first).substringBefore(")") + ")" }.toList(), module)
            assertTrue(Regex("""if \(debuggable\) \{\s*Log\.w\(TAG, code\)\s*\}""").containsMatchIn(writer), "$module: $writer")
            // The same grammar as SdkLog's, checked before the write.
            assertTrue("""Regex("[a-z][a-z0-9_]{0,63}(\\.[a-z0-9_]+)*")""" in writer, module)
            assertTrue(writer.indexOf("require(code.length <= 64 && CODE.matches(code))") in 0 until writer.indexOf("Log.w(TAG, code)"), module)
        }
    }

    @Test
    fun `every call of an artifact's logger passes a constant code, by the logger's own name`() {
        MODULE_LOGGERS.forEach { (module, path) ->
            val logger = File(path).nameWithoutExtension
            val call = Regex("""\b$logger\.log\s*\(([^)]*)\)""")
            val sources = SourceScan.sourcesOf(SdkModule.SHIPPED.single { it.name == module })
            val found = sources.flatMap { (source, text) ->
                call.findAll(text).map { it.groupValues[1].trim() }.filterNot { CODE_LITERAL.matches(it) }.map { "$source: $logger.log($it)" }.toList()
            }
            assertEquals(emptyList<String>(), found)

            // Each mention outside the logger's own file and the imports is a `<logger>.log("...")` or `<logger>.attach(...)` call.
            val others = sources.filterNot { (source, _) -> source == path }
            val mentions = others.sumOf { (_, text) -> SourceScan.codeLines(text).sumOf { (_, line) -> Regex("""\b$logger\b""").findAll(line).count() } }
            val calls = others.sumOf { (_, text) -> Regex("""\b$logger\.(log|attach)\s*\(""").findAll(text).count() }
            assertEquals(calls, mentions, "$module: $logger is aliased or passed on")
        }
    }

    @Test
    fun `the one file that names java util logging only sets levels`() {
        val file = File(LIBRARY_LOGGERS)
        // The reader exists (Workflow 10E), so a missing file means the libraries' loggers are no longer silenced here (review E003).
        assertTrue(file.isFile, "$LIBRARY_LOGGERS is missing: the libraries' loggers must be turned off for a read (C209.2)")
        val text = SourceScan.code(file.readText())

        assertEquals(emptyList<String>(), JAVA_LOGGING_WRITES.filter { it.containsMatchIn(text) }.map { it.pattern })
        assertTrue(Regex("""\bLevel\.OFF\b""").containsMatchIn(text), "the libraries' loggers are turned off for a read")
    }

    private companion object {
        const val PLATFORM_WRITER = "src/androidMain/kotlin/dev/openverify/sdk/log/PlatformLog.android.kt"

        /** Each optional artifact's one logger (Workflow 10E Stage 1a), by module, in the module table's order. */
        val MODULE_LOGGERS: Map<String, String> = linkedMapOf(
            "openverify-nfc" to "../openverify-nfc/src/main/kotlin/dev/openverify/nfc/NfcLog.kt",
            "openverify-face" to "../openverify-face/src/main/kotlin/dev/openverify/face/FaceLog.kt",
        )

        /** C209.2: where openverify-nfc turns the `org.jmrtd`, `net.sf.scuba` and `org.ejbca` loggers off for a read and restores them. */
        const val LIBRARY_LOGGERS = "../openverify-nfc/src/main/kotlin/dev/openverify/nfc/LibraryLoggers.kt"

        val JAVA_LOGGING = Regex("""\bLogger\.getLogger\b|\bLoggerFactory\b|\bjava\.util\.logging\b""")

        /** A logger used to write, or given somewhere to write to. */
        val JAVA_LOGGING_WRITES = listOf(
            Regex("""\.(log|logp|logrb|severe|warning|info|config|fine|finer|finest|entering|exiting|throwing)\s*\("""),
            Regex("""\b(addHandler|ConsoleHandler|FileHandler|StreamHandler|SocketHandler)\b"""),
        )

        val ANDROID_LOG = Regex("""\bLog\.(v|d|i|w|e|wtf|println|isLoggable)\s*\(""")

        val FORBIDDEN = listOf(
            ANDROID_LOG,
            Regex("""\bprintln\s*\("""),
            Regex("""\bprint\s*\("""),
            Regex("""\.printStackTrace\s*\("""),
            Regex("""\bSystem\.(out|err)\b"""),
            Regex("""\bNSLog\b"""),
            // Final list (10C): the other ways to Logcat or a console, and an exception's text made a string.
            Regex("""\bLog\.getStackTraceString\b"""),
            Regex("""\.stackTraceToString\s*\("""),
            Regex("""\b(Timber|Napier|Kermit|Slog|EventLog)\."""),
            JAVA_LOGGING,
            Regex("""\bos_log\b|\bprint\(to:"""),
            Regex("""\bStrictMode\b"""),
        )

        val LOGGING_IMPORTS = listOf(
            Regex("""\bandroid\.util\.(Log|Slog|EventLog|Printer)\b"""),
            Regex("""\bjava\.util\.logging\b"""),
            Regex("""\borg\.slf4j\b|\btimber\.log\b|\bio\.github\.aakira\.napier\b|\bco\.touchlab\.kermit\b"""),
            Regex("""\bio\.ktor\.client\.plugins\.logging\b|\bokhttp3\.logging\b"""),
            Regex("""\bdev\.openverify\.sdk\.log\.SdkLog\.log\b|\bdev\.openverify\.sdk\.log\.platformLog\b"""),
            Regex("""\bdev\.openverify\.sdk\.log\.SdkLog\s+as\b"""),
        )

        val SDK_LOG_CALL = Regex("""\bSdkLog\.log\s*\(([^)]*)\)""")

        /** A string literal of a lower-case dotted code, at most 64 characters, with no template. */
        val CODE_LITERAL = Regex(""""[a-z][a-z0-9_]{0,63}(\.[a-z0-9_]+)*"""")
    }
}
