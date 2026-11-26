package dev.openverify.sdk.privacy

import java.io.File

/**
 * A module of the Android build as the privacy checks see it (C213, C191.2). One entry per module the
 * build includes; `ModuleBoundaryTest` fails when `settings.gradle.kts` includes a module that has no
 * entry here, so a new artifact is one line. An optional artifact with sources also keeps the table of
 * its exceptions in its own test resources ([exceptionRows]; KP10-42), which `ExceptionCanaryTest` holds
 * to its sources.
 */
internal data class SdkModule(
    /** The Gradle project's name, as `settings.gradle.kts` includes it. */
    val name: String,
    val role: Role,
    /** The module's main Kotlin source roots, relative to the SDK module (Gradle runs host tests there). */
    val mainRoots: List<String>,
    /** The module's manifest, relative to the SDK module. */
    val manifest: String,
) {
    internal enum class Role {
        /** `:openverify-sdk`: Apache-2.0, depends on no optional artifact (C191.2). */
        SDK,

        /** An optional artifact: it depends on the SDK, never the reverse, and the scans read its main sources. */
        OPTIONAL,

        /** A consumer of the artifacts (the demo): not shipped in an artifact, so the SDK's source scans do not read it. */
        CONSUMER,
    }

    /** The module's directory, relative to the SDK module. */
    val directory: String get() = if (role == Role.SDK) "." else "../$name"

    /**
     * Where an optional artifact tables every exception its main sources create or let through
     * (C213.3; KP10-42), relative to the SDK module: a file its own builder fills, so no builder edits
     * the SDK's tests. `null` for the SDK, whose rows are `ExceptionCanaryTest`'s own, and for a consumer.
     */
    val exceptionRows: String? get() = if (role == Role.OPTIONAL) "$directory/$EXCEPTION_ROWS" else null

    internal companion object {
        /** An optional artifact's exception table, relative to the module. */
        const val EXCEPTION_ROWS = "src/test/resources/privacy/exception-rows.txt"

        /** Every module the build includes at Workflow 10E, in `settings.gradle.kts`' order. */
        val ALL: List<SdkModule> = listOf(
            SdkModule(
                "openverify-sdk",
                Role.SDK,
                listOf("src/commonMain/kotlin", "src/androidMain/kotlin", "src/iosMain/kotlin"),
                "src/androidMain/AndroidManifest.xml",
            ),
            // The chip reader (C209; Phase 10 P1).
            SdkModule("openverify-nfc", Role.OPTIONAL, listOf("../openverify-nfc/src/main"), "../openverify-nfc/src/main/AndroidManifest.xml"),
            // The face detector (C205; Phase 10 P2).
            SdkModule("openverify-face", Role.OPTIONAL, listOf("../openverify-face/src/main"), "../openverify-face/src/main/AndroidManifest.xml"),
            SdkModule("demo-app", Role.CONSUMER, listOf("../demo-app/src/main"), "../demo-app/src/main/AndroidManifest.xml"),
        )

        /** The modules whose main sources ship in an artifact: the SDK and each optional artifact. */
        val SHIPPED: List<SdkModule> = ALL.filter { it.role != Role.CONSUMER }

        /** The names `settings.gradle.kts` includes, in its order. */
        fun included(): List<String> =
            Regex("""include\(\s*":([^"]+)"\s*\)""").findAll(File("../settings.gradle.kts").readText()).map { it.groupValues[1] }.toList()
    }
}

/** One call of a function in a source: its line and the text between its parentheses. */
internal data class SourceCall(val name: String, val line: Int, val arguments: String, val start: Int, val end: Int)

/**
 * The main sources the privacy scans read (C213.2, C213.3): every shipped module's main Kotlin
 * sources ([SdkModule.SHIPPED]). Comments are left out, as `NeverReadTest` does; paths are relative to
 * the SDK module (`src/...`, `../<module>/...`).
 */
internal object SourceScan {
    /** Every main Kotlin source of [module] with its text, comments removed, sorted by path. */
    internal fun sourcesOf(module: SdkModule): List<Pair<String, String>> =
        module.mainRoots.map(::File).filter { it.isDirectory }.flatMap { root ->
            root.walkTopDown().filter { it.isFile && it.extension == "kt" }.map { file -> file.invariantSeparatorsPath to code(file.readText()) }.toList()
        }.sortedBy { it.first }

    /** Every main Kotlin source of every shipped module with its text, comments removed. */
    internal val sources: List<Pair<String, String>> by lazy {
        SdkModule.SHIPPED.flatMap(::sourcesOf).sortedBy { it.first }.also { check(it.size > 50) { "Found only ${it.size} sources" } }
    }

    /** [text] without its comments. */
    internal fun code(text: String): String =
        text
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .replace(Regex("""//[^\n]*"""), "")

    /** Each line of [text] that is not an import, with its 1-based number. */
    internal fun codeLines(text: String): List<Pair<Int, String>> =
        text.lines().mapIndexed { index, line -> index + 1 to line }.filterNot { (_, line) -> line.trimStart().startsWith("import ") }

    /**
     * Every call in [text] of a function named by [names] (a regular expression over the name), in
     * source order, with the text between its parentheses. A declaration (`fun name(`) is not a call,
     * and neither is a method called on a receiver (`.name(`): see [methodCalls].
     */
    internal fun calls(text: String, names: String): List<SourceCall> =
        Regex("""(?<![\w.])($names)\s*\(""").findAll(text).mapNotNull { match -> callAt(text, match.groupValues[1], match.range.first, match.range.last) }.toList()

    /** As [calls], for a method called on a receiver (`.name(`). */
    internal fun methodCalls(text: String, names: String): List<SourceCall> =
        Regex("""\.($names)\s*\(""").findAll(text).mapNotNull { match -> callAt(text, match.groupValues[1], match.range.first, match.range.last) }.toList()

    private fun callAt(text: String, name: String, start: Int, open: Int): SourceCall? {
        if (DECLARATION.containsMatchIn(text.substring(maxOf(0, start - 80), start))) return null
        val close = closing(text, open) ?: return null
        return SourceCall(name, text.substring(0, start).count { it == '\n' } + 1, text.substring(open + 1, close), start, close)
    }

    private val DECLARATION = Regex("""\bfun\s+(<[^>]*>\s*)?([\w.]+\.)?$""")

    /** The index of the parenthesis that closes the one at [open], string and character literals skipped; null when unbalanced. */
    internal fun closing(text: String, open: Int): Int? {
        var depth = 0
        var index = open
        var quoted = false
        while (index < text.length) {
            val char = text[index]
            when {
                quoted && char == '\\' -> index++
                char == '"' -> quoted = !quoted
                quoted -> Unit
                char == '\'' && text.getOrNull(index + 2) == '\'' -> index += 2
                char == '\'' && text.getOrNull(index + 1) == '\\' && text.getOrNull(index + 3) == '\'' -> index += 3
                char == '(' -> depth++
                char == ')' -> if (--depth == 0) return index
            }
            index++
        }
        return null
    }

    /** The arguments of the innermost call that encloses [index] in [text], or null at the top level. */
    internal fun enclosingArguments(text: String, index: Int): String? {
        var depth = 0
        var at = index - 1
        while (at >= 0) {
            when (text[at]) {
                ')' -> depth++
                '(' -> if (depth == 0) return closing(text, at)?.let { text.substring(at + 1, it) } else depth--
            }
            at--
        }
        return null
    }
}
