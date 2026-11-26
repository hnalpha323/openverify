package dev.openverify.sdk.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.AnnotatedString
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

/**
 * The SDK's one way to read a string (C199.1, C199.4; review F09): every SDK string goes through
 * here, never through `stringResource` directly (`SdkStringsSourceTest`).
 *
 * Spike (a) found no public per-composition locale in Compose Multiplatform 1.11.1
 * (`docs/research/phase10-inventory.md` section 5), so inside `OpenVerifyTheme`, which provides the
 * SDK's chosen language as [LocalSdkLanguage] (C199.2), a string is read from the generated
 * per-locale tables (`SdkStringTables.kt`, [sdkStringTable]) in that language, with Compose's own
 * fallback to the default (English) text and its own placeholder fill. The JVM default locale and
 * the host's configuration are never changed. `SdkStringTablesTest` proves that the tables and
 * Compose's resolution yield the same text for every key and locale. Outside a chosen language (a
 * screen composed without `OpenVerifyTheme`), and for a key the tables do not hold, it reads as
 * Compose does, by the process locale.
 *
 * The text is the logical form, which a consent digest may be taken over (C200.2): no isolate or
 * other format character is added. [sdkText] is the displayed form.
 */
@Composable
internal fun sdkString(key: StringResource, vararg args: Any): String {
    val language = LocalSdkLanguage.current ?: return stringResource(key, *args)
    return sdkStringIn(language, key.key, args.map { it.toString() }) ?: stringResource(key, *args)
}

/** [sdkString] for a plural: [count] picks the category by the chosen language's CLDR rules ([sdkPluralCategory]), [args] fill the placeholders. */
@Composable
internal fun sdkPlural(key: PluralStringResource, count: Int, vararg args: Any): String {
    val language = LocalSdkLanguage.current ?: return pluralStringResource(key, count, *args)
    return sdkPluralIn(language, key.key, count, args.map { it.toString() }) ?: pluralStringResource(key, count, *args)
}

/**
 * The SDK's chosen language for the composition below it (a base tag of [SDK_LANGUAGES], C199.2),
 * provided by `OpenVerifyTheme`; null outside it, where the facade reads as Compose does.
 */
internal val LocalSdkLanguage: ProvidableCompositionLocal<String?> = staticCompositionLocalOf { null }

/**
 * [sdkString] as it is displayed (C199.5): each interpolated value is isolated with U+2068 (first
 * strong isolate) and U+2069 (pop directional isolate), so a Latin name, an address or a number
 * keeps its own order inside Arabic text. Only the displayed text carries the isolates; the text a
 * consent digest is taken over is [sdkString]'s.
 */
@Composable
internal fun sdkText(key: StringResource, vararg args: Any): AnnotatedString =
    AnnotatedString(sdkString(key, *args.map { isolated(it.toString()) }.toTypedArray()))

/** [sdkText] for a plural. */
@Composable
internal fun sdkPluralText(key: PluralStringResource, count: Int, vararg args: Any): AnnotatedString =
    AnnotatedString(sdkPlural(key, count, *args.map { isolated(it.toString()) }.toTypedArray()))

private const val FIRST_STRONG_ISOLATE = '⁨'
private const val POP_DIRECTIONAL_ISOLATE = '⁩'

/** [value] between U+2068 and U+2069 (C199.5). */
internal fun isolated(value: String): String = "$FIRST_STRONG_ISOLATE$value$POP_DIRECTIONAL_ISOLATE"

/** CLDR's plural categories (C199.4, C199.8). */
internal enum class SdkPluralCategory { ZERO, ONE, TWO, FEW, MANY, OTHER }

/**
 * The CLDR plural category of an integer [count] in [language] (a base tag), from CLDR's plural
 * rules (`plurals.xml`) for the SDK's five languages, written as code for integer operands only
 * (`i` = `n`, `v` = 0, `e` = 0: the SDK never passes a fraction or a compact exponent). The count
 * is read by its absolute value, as CLDR's `n` is. Any other language takes CLDR's root rule, `other`.
 * - `en`, `de`: one for 1.
 * - `es`: one for 1; many for a non-zero multiple of 1,000,000.
 * - `fr`: one for 0 and 1; many for a non-zero multiple of 1,000,000.
 * - `ar`: zero for 0, one for 1, two for 2, few when `n % 100` is 3 to 10, many when it is 11 to 99.
 */
internal fun sdkPluralCategory(language: String, count: Int): SdkPluralCategory {
    val n = kotlin.math.abs(count.toLong())
    val millions = n != 0L && n % 1_000_000L == 0L
    return when (language) {
        "en", "de" -> if (n == 1L) SdkPluralCategory.ONE else SdkPluralCategory.OTHER
        "es" -> when {
            n == 1L -> SdkPluralCategory.ONE
            millions -> SdkPluralCategory.MANY
            else -> SdkPluralCategory.OTHER
        }
        "fr" -> when {
            n == 0L || n == 1L -> SdkPluralCategory.ONE
            millions -> SdkPluralCategory.MANY
            else -> SdkPluralCategory.OTHER
        }
        "ar" -> when {
            n == 0L -> SdkPluralCategory.ZERO
            n == 1L -> SdkPluralCategory.ONE
            n == 2L -> SdkPluralCategory.TWO
            n % 100L in 3L..10L -> SdkPluralCategory.FEW
            n % 100L in 11L..99L -> SdkPluralCategory.MANY
            else -> SdkPluralCategory.OTHER
        }
        else -> SdkPluralCategory.OTHER
    }
}

/**
 * The string [key] (a resource name) in [language] with its `%n$s`/`%n$d` placeholders filled from
 * [args], from the generated tables; the default (English) text when [language]'s table lacks it,
 * as Compose falls back to the qualifier-less folder; null when no table holds it.
 */
internal fun sdkStringIn(language: String, key: String, args: List<String>): String? {
    val found = sdkStringTable(language)?.strings?.get(key) ?: sdkStringTable(SDK_DEFAULT_LANGUAGE)?.strings?.get(key) ?: return null
    val template = if (language == SDK_PSEUDO_LANGUAGE) pseudoLocalized(found) else found
    return if (args.isEmpty()) template else filled(template, args)
}

/**
 * The plural [key] for [count] in [language]: the category by [language]'s rules, its text or else
 * the `other` text, as Compose picks them, with [args] filling the placeholders; [language]'s items,
 * else the default (English) ones; null when no table holds it.
 */
internal fun sdkPluralIn(language: String, key: String, count: Int, args: List<String>): String? {
    val items = sdkStringTable(language)?.plurals?.get(key) ?: sdkStringTable(SDK_DEFAULT_LANGUAGE)?.plurals?.get(key) ?: return null
    val rules = if (language == SDK_PSEUDO_LANGUAGE) SDK_DEFAULT_LANGUAGE else language
    val found = items[sdkPluralCategory(rules, count)] ?: items[SdkPluralCategory.OTHER] ?: return null
    val template = if (language == SDK_PSEUDO_LANGUAGE) pseudoLocalized(found) else found
    return if (args.isEmpty()) template else filled(template, args)
}

/**
 * The pseudo-locale of the accessibility checks (C212.2), named as Android names its own: English
 * with every letter accented and each text made longer, so a text that only fits in English shows
 * as cut off. No session, request or device locale ever resolves to it (`chooseLanguage` picks among
 * [SDK_LANGUAGES] only); a test provides it as [LocalSdkLanguage].
 */
internal const val SDK_PSEUDO_LANGUAGE: String = "en-XA"

/** [template] as [SDK_PSEUDO_LANGUAGE] shows it; its `%n$s` and `%n$d` placeholders stay as they are. */
internal fun pseudoLocalized(template: String): String {
    val accented = StringBuilder(template.length * 2)
    var index = 0
    var letters = 0
    while (index < template.length) {
        val placeholder = POSITIONAL_PLACEHOLDER.matchAt(template, index)
        if (placeholder != null) {
            accented.append(placeholder.value)
            index = placeholder.range.last + 1
        } else {
            val character = template[index]
            val position = PSEUDO_PLAIN.indexOf(character)
            accented.append(if (position >= 0) PSEUDO_ACCENTED[position] else character)
            if (character.isLetter()) letters++
            index++
        }
    }
    // About half as long again, as a translation of a short English text can be.
    val padding = (letters + 1) / 2
    val filler = buildString { while (length < padding) append(PSEUDO_FILLER) }.take(padding).trimEnd()
    return if (filler.isEmpty()) "[$accented]" else "[$accented $filler]"
}

private const val PSEUDO_PLAIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
private const val PSEUDO_ACCENTED = "åƀçđéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇĐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ"
private const val PSEUDO_FILLER = "öñé ţŵö ţĥŕéé ƒöûŕ ƒîṽé šîẋ šéṽéñ éîĝĥţ ñîñé ţéñ "

/** Compose Multiplatform's positional fill (`replaceWithArgs`): each `%n$s` or `%n$d` is the n-th argument, nothing else is read. */
private val POSITIONAL_PLACEHOLDER = Regex("""%(\d+)\$[ds]""")

private fun filled(template: String, args: List<String>): String =
    POSITIONAL_PLACEHOLDER.replace(template) { match -> args[match.groupValues[1].toInt() - 1] }

/**
 * One language's SDK texts as Compose Multiplatform reads them from `composeResources` (the XML's
 * escapes resolved, placeholders still `%n$s` and `%n$d`): each string by its resource name, and each
 * plural's text by category.
 */
internal class SdkStringTable internal constructor(
    internal val strings: Map<String, String>,
    internal val plurals: Map<String, Map<SdkPluralCategory, String>>,
)
