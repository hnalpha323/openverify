package dev.openverify.sdk.model

import java.io.File

/**
 * Reads constants from the TypeScript sources of `@openverify/contracts`, `@openverify/core` and
 * `@openverify/flow-spec`, so the SDK's copies are checked against the values the server uses
 * rather than against a second copy. Gradle runs the host tests from the module directory, two
 * levels below the repository root (as `ResourcesTest` reads `src/commonMain/composeResources`).
 */
internal object ContractSources {
    private const val REPOSITORY_ROOT = "../.."

    private fun source(path: String): String {
        val file = File(REPOSITORY_ROOT, path)
        check(file.isFile) { "$path is not at ${file.absolutePath}" }
        return file.readText()
    }

    /** The text from `export const <name>` to the end of its first bracketed or braced value. */
    private fun declaration(path: String, name: String): String {
        val text = source(path)
        val start = Regex("""export const $name\b[^=]*=""").find(text)?.range?.last
            ?: error("$path declares no $name")
        val open = text.indexOfAny(charArrayOf('[', '{'), start)
        val close = if (text[open] == '[') ']' else '}'
        var depth = 0
        for (index in open until text.length) {
            when (text[index]) {
                text[open] -> depth++
                close -> if (--depth == 0) return text.substring(open, index + 1)
            }
        }
        error("$name in $path is not closed")
    }

    /** Every match of [pattern] in [path]'s text, in order. */
    fun matches(path: String, pattern: Regex): List<MatchResult> = pattern.findAll(source(path)).toList()

    /** The quoted strings of the array `<name>` in [path], in order. */
    fun strings(path: String, name: String): List<String> =
        Regex("""'([^']*)'""").findAll(declaration(path, name)).map { it.groupValues[1] }.toList()

    /** The `key: number` members of the object `<name>` in [path]. */
    fun numbers(path: String, name: String): Map<String, Int> =
        Regex("""([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([0-9][0-9_]*)""").findAll(declaration(path, name))
            .associate { it.groupValues[1] to it.groupValues[2].replace("_", "").toInt() }

    const val CORE_CRYPTO_CHAINS = "packages/core/src/crypto-chains.ts"
    const val CONTRACTS_OTP = "packages/contracts/src/otp.ts"
    const val CONTRACTS_INPUTS = "packages/contracts/src/verification-inputs.ts"
    const val CONTRACTS_TYPES = "packages/contracts/src/verification-types.ts"
    const val FLOW_SPEC = "packages/flow-spec/src/flow.ts"
}
