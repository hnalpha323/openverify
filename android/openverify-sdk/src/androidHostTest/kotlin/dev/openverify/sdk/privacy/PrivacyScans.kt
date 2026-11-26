package dev.openverify.sdk.privacy

import java.io.File

/**
 * C213.3 (review P06) read from the sources: the values an exception's message is built from. A
 * message is a string literal given to an exception's constructor, to `error` or `TODO`, or in the
 * block of `require`, `check` and their `NotNull` forms; each `$name` or `${...}` in one is a value
 * that reaches whoever reads the message (a host's crash report), so each is named in
 * `ExceptionMessageScanTest`'s table with why it is no personal data and no server text.
 */
internal object ExceptionMessages {
    private const val THROWN = """[A-Z]\w*(?:Exception|Error|Refused)|error|TODO"""
    private const val CHECKED = "require|check|requireNotNull|checkNotNull"

    /** Each template in a message of [text], as written, in source order. */
    fun templates(text: String): List<String> {
        val thrown = SourceScan.calls(text, THROWN).map { it.start to it.arguments }
        val checked = SourceScan.calls(text, CHECKED).map { call -> call.start to block(text, call.end).orEmpty() }
        return (thrown + checked).sortedBy { it.first }.flatMap { (_, message) -> literals(message).flatMap(::templatesIn) }
    }

    /** The block written after the call that ends at [close]: the lazy message of a check. */
    private fun block(text: String, close: Int): String? {
        val rest = text.substring(close + 1)
        if (!rest.trimStart().startsWith("{")) return null
        val open = close + 1 + rest.indexOf('{')
        var depth = 0
        var index = open
        while (index < text.length) {
            when (text[index]) {
                '"' -> index = literalEnd(text, index)
                '{' -> depth++
                '}' -> if (--depth == 0) return text.substring(open, index + 1)
            }
            index++
        }
        return null
    }

    /** The string literals of [code], outermost only: a literal inside a template's braces belongs to that template. */
    private fun literals(code: String): List<String> {
        val found = mutableListOf<String>()
        var index = 0
        while (index < code.length) {
            if (code[index] == '"') {
                val end = literalEnd(code, index)
                found += code.substring(index, minOf(end + 1, code.length))
                index = end
            }
            index++
        }
        return found
    }

    /** The index of the quote that closes the literal opened at [open], its templates' own literals skipped. */
    private fun literalEnd(code: String, open: Int): Int {
        var index = open + 1
        while (index < code.length) {
            when {
                code[index] == '\\' -> index++
                code[index] == '"' -> return index
                code[index] == '$' && code.getOrNull(index + 1) == '{' -> index = templateEnd(code, index + 1)
            }
            index++
        }
        return code.length - 1
    }

    /** The index of the brace that closes the template opened at [open]. */
    private fun templateEnd(code: String, open: Int): Int {
        var depth = 0
        var index = open
        while (index < code.length) {
            when (code[index]) {
                '"' -> index = literalEnd(code, index)
                '{' -> depth++
                '}' -> if (--depth == 0) return index
            }
            index++
        }
        return code.length - 1
    }

    /** The templates of one [literal], quotes included: `$name` and `${...}`, an escaped dollar left out. */
    private fun templatesIn(literal: String): List<String> {
        val found = mutableListOf<String>()
        var index = 1
        while (index < literal.length - 1) {
            when {
                literal[index] == '\\' -> index++
                literal[index] == '$' && literal[index + 1] == '{' -> {
                    val end = templateEnd(literal, index + 1)
                    found += literal.substring(index, minOf(end + 1, literal.length))
                    index = end
                }
                literal[index] == '$' -> NAME.matchAt(literal, index + 1)?.let { found += "$" + it.value }
            }
            index++
        }
        return found
    }

    private val NAME = Regex("""[A-Za-z_]\w*""")
}

/**
 * C191.2, C214.6: what `:openverify-sdk:checkDependencyBoundary` refuses, read from the build file that
 * declares it (never a second list), and what the committed lockfiles resolve.
 */
internal object DependencyBoundary {
    /** The SDK's build file without its line comments (its globs hold a slash and a star, which are no block comment). */
    private val sdkBuild: String by lazy { lineCommentsRemoved(File("build.gradle.kts").readText()) }

    private val check: String by lazy { sdkBuild.substringAfter("tasks.register(\"checkDependencyBoundary\")").substringBefore("tasks.matching") }

    /** The Maven groups the check refuses: the libraries reserved for the optional artifacts. */
    fun reservedGroups(): List<String> = strings(check.substringAfter("val groups = listOf(").substringBefore(")"))

    /** The artifact names the check refuses by name, whatever the build includes. */
    fun reservedArtifacts(): List<String> = strings(check.substringAfter("val optional = setOf(").substringBefore(")"))

    /** The modules the check leaves out of "every other included module is an optional artifact". */
    fun notOptional(): List<String> =
        strings(check.substringAfter("rootProject.subprojects.map { it.name }.filterNot {").substringBefore("}")).plus("openverify-sdk").sorted()

    /** Whether the check runs with `assemble` and `check`. */
    fun wired(): Boolean =
        Regex("""tasks\.matching \{ it\.name == "assemble" \|\| it\.name == "check" \}\.configureEach \{ dependsOn\(checkDependencyBoundary\) \}""").containsMatchIn(sdkBuild)

    /**
     * The `group:name` coordinates [lockfile] locks for a configuration that ships: a line names its
     * configurations after `=`, and the test and lint classpaths (Robolectric and the lint tool bring
     * Bouncy Castle to those, never to an artifact) are left out, as are comments and the `empty=` line.
     */
    fun locked(lockfile: List<String>): List<String> =
        lockfile.filterNot { it.startsWith("#") || it.startsWith("empty=") || it.isBlank() }
            .filter { line -> line.substringAfter('=').split(',').any { configuration -> !TOOLING.containsMatchIn(configuration) } }
            .map { it.substringBefore('=').substringBeforeLast(':') }

    /** A configuration that only builds or tests: nothing it resolves reaches an artifact. */
    private val TOOLING = Regex("Test|Lint")

    /** The coordinates among [coordinates] the boundary refuses for the SDK: a reserved group or an optional artifact. */
    fun refused(coordinates: List<String>, groups: List<String>, artifacts: List<String>): List<String> = coordinates.filter { coordinate ->
        val group = coordinate.substringBefore(':')
        groups.any { group == it || group.startsWith("$it.") } || coordinate.substringAfter(':') in artifacts
    }

    /** The other modules of the build that [buildFile] depends on as projects. */
    fun projectDependencies(buildFile: String): List<String> =
        Regex("""project\(\s*":([^"]+)"\s*\)""").findAll(lineCommentsRemoved(buildFile)).map { it.groupValues[1] }.toList()

    private fun lineCommentsRemoved(text: String): String = text.lines().joinToString("\n") { it.substringBefore("//") }

    private fun strings(text: String): List<String> = Regex(""""([^"]+)"""").findAll(text).map { it.groupValues[1] }.toList()
}
