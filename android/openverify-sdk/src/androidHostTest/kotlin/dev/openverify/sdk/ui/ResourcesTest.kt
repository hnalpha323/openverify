package dev.openverify.sdk.ui

import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.allPluralStringResources
import dev.openverify.sdk.generated.resources.allStringResources
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The SDK's texts are Compose Multiplatform resources (`src/commonMain/composeResources`), so
 * Android and iOS show the same ones (KMP plan K5). Lint's MissingTranslation does not read them,
 * so these tests take its place: the five SDK locales (English, the default, and Spanish, French,
 * German and Arabic, C199.1) name the same strings with the same placeholders, each folder names
 * its own language, and `Res` holds them all. The SDK's only Android resources are those it must
 * merge into the host app (its window theme), and their names keep the prefix that the KMP library
 * DSL, which has no `resourcePrefix`, can no longer enforce.
 */
internal class ResourcesTest {

    /** The `<string>` and `<plurals>` elements of [directory]'s XML files. */
    private fun resourceElements(directory: String): List<Element> =
        File(COMPOSE_RESOURCES, directory).listFiles { file -> file.extension == "xml" }.orEmpty()
            .flatMap { file ->
                val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
                (0 until root.childNodes.length).map(root.childNodes::item).filterIsInstance<Element>()
            }

    /** Each kind of resource ("string", "plurals") with the names that [directory]'s XML files give it. */
    private fun composeResources(directory: String): Map<String, Set<String>> =
        resourceElements(directory)
            .groupBy(Element::getTagName) { it.getAttribute("name") }
            .mapValues { (_, names) -> names.toSet() }

    /**
     * Every text of [directory]'s XML files by resource name, as the file spells it once the XML
     * itself is read (`&lt;` is `<`): a string's text, or each item of a plural.
     */
    private fun composeTexts(directory: String): Map<String, List<String>> =
        resourceElements(directory)
            .associate { resource ->
                val items = resource.getElementsByTagName("item")
                val texts = if (items.length == 0) listOf(resource.textContent) else (0 until items.length).map { items.item(it).textContent }
                resource.getAttribute("name") to texts
            }

    /** Each text of the five locales that [isWrong] picks, as `values-es/<name>: <text>`. */
    private fun textsWhere(isWrong: (String) -> Boolean): List<String> = LANGUAGES.flatMap { directory ->
        composeTexts(directory).flatMap { (name, texts) -> texts.filter(isWrong).map { "$directory/$name: $it" } }
    }

    /** Each type of the SDK's Android resources ("string", "style") with its names, as `R` holds them. */
    private fun androidResources(): Map<String, List<String>> =
        Class.forName("dev.openverify.sdk.R").classes.associate { type -> type.simpleName to type.fields.map { it.name } }

    @Test
    fun `every English string and plural has a Spanish one, and every Spanish one an English one`() {
        val english = composeResources("values")
        val spanish = composeResources("values-es")

        assertTrue(english["string"].orEmpty().isNotEmpty(), "no strings in $COMPOSE_RESOURCES/values")
        assertEquals(english, spanish)
    }

    @Test
    fun `French, German and Arabic name exactly the strings and plurals English names (C199_1)`() {
        val english = composeResources("values")

        val added = LANGUAGES - listOf("values", "values-es")

        assertEquals(added.associateWith { english }, added.associateWith { composeResources(it) })
    }

    /**
     * The consent screen sends `openverify_locale` with the texts it showed (C37, C42.3), so a
     * folder that shows a language's words must also name that language: a folder without it would
     * record its consent texts as English (Workflow 10A Stage 1a amendment 11).
     */
    @Test
    fun `each locale folder names its own language for the consent record`() {
        val named = LANGUAGES.associateWith { directory -> composeTexts(directory)["openverify_locale"] }

        assertEquals(LANGUAGES.associateWith { listOf(LOCALE_TAGS.getValue(it)) }, named)
    }

    /**
     * Each French, German and Arabic text is its own, so none is left in English by mistake, except
     * the few that the language writes as English does, each listed here (machine-drafted, C199.1).
     */
    @Test
    fun `each French, German and Arabic text is its own, but for the listed ones its language writes as English does`() {
        val english = composeTexts("values")
        val same = (LANGUAGES - listOf("values", "values-es")).associateWith { directory ->
            composeTexts(directory).filter { (name, texts) -> english[name] == texts }.keys.sorted()
        }

        assertEquals(SAME_AS_ENGLISH, same)
    }

    /**
     * C199.5's resource half: the SDK sets the layout direction and isolates interpolated values in
     * the displayed text only (android-theme), so no resource carries a bidi control, an isolate or a
     * mark (they would enter the text a consent digest is taken over, C200.2), and none draws a
     * direction with an arrow character, which would point the wrong way in Arabic: directional icons
     * are drawables, mirrored by the layout.
     */
    @Test
    fun `no text carries a bidi control, an isolate or a mark, or draws a direction with an arrow (C199_5)`() {
        val directional = Regex("[\\u200E\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069\\u2190-\\u21FF\\u27F5-\\u27FF]")

        assertEquals(emptyList<String>(), textsWhere(directional::containsMatchIn))
    }

    @Test
    fun `Res holds every string and plural the resource files define, and nothing else`() {
        val english = composeResources("values")

        assertEquals(english["string"].orEmpty(), Res.allStringResources.keys)
        assertEquals(english["plurals"].orEmpty(), Res.allPluralStringResources.keys)
        assertTrue(Res.allStringResources.isNotEmpty(), "Res has no strings")
    }

    /**
     * Compose Multiplatform 1.11 formats only `%1$s` and `%1$d` (its `SimpleStringFormatRegex` is
     * `%(\d+)\$[ds]`), on Android as on iOS: any other format specifier, such as a bare `%d`, a `%.1f`
     * or a `%%`, reaches the screen as it is written, which Android resources never did. A percent
     * sign that starts no specifier, as in `100 %`, is shown as it is, which is what it means.
     */
    @Test
    fun `every text uses only the placeholders Compose Multiplatform fills, %1$s and %1$d`() {
        val unfilledSpecifier = Regex("%(?![1-9][0-9]*\\$[sd])([0-9]+\\$)?[-#+0,(]*[0-9]*(\\.[0-9]+)?[a-zA-Z%]")

        assertEquals(emptyList<String>(), textsWhere(unfilledSpecifier::containsMatchIn))
    }

    /**
     * A plural item may leave its count out (Arabic's one and two say it in words), so a plural's
     * placeholders are those of all its items together.
     */
    @Test
    fun `each translated text has the same placeholders as its English text`() {
        fun placeholders(directory: String): Map<String, Set<String>> = composeTexts(directory).mapValues { (_, texts) ->
            texts.flatMap { text -> Regex("%[1-9][0-9]*\\$[sd]|\\{\\{[a-z][A-Za-z0-9_]*\\}\\}").findAll(text).map { it.value } }.toSet()
        }
        val english = placeholders("values")

        val different = LANGUAGES.drop(1).flatMap { directory ->
            val translated = placeholders(directory)
            (english.keys + translated.keys).filter { english[it] != translated[it] }
                .map { "$it: en ${english[it]}, ${directory.removePrefix("values-")} ${translated[it]}" }
        }
        assertEquals(emptyList<String>(), different)
    }

    /**
     * Compose Multiplatform reads only the `\n`, `\t`, `\uXXXX` and `\\` escapes, so the backslash of
     * Android's `\'`, `\"`, `\@` or `\?` would be shown. Write the character itself: `'` and `"` need
     * no escape here.
     */
    @Test
    fun `no text uses an Android escape that Compose Multiplatform would show as it is`() {
        val readEscapes = Regex("\\\\(u[0-9a-fA-F]{4}|[nt\\\\])")

        assertEquals(emptyList<String>(), textsWhere { text -> '\\' in text.replace(readEscapes, "") })
    }

    @Test
    fun `the SDK merges no string into the host app's Android resources`() {
        val resources = androidResources()

        assertEquals(emptyList<String>(), resources["string"].orEmpty() + resources["plurals"].orEmpty())
    }

    @Test
    fun `every Android resource the SDK merges into the host app starts with OpenVerify or openverify_`() {
        val names = androidResources().values.flatten()

        assertTrue(names.isNotEmpty(), "the SDK has no Android resources: is its window theme gone?")
        assertEquals(emptyList<String>(), names.filterNot { it.startsWith("OpenVerify_") || it.startsWith("openverify_") })
    }

    private companion object {
        /** Read from the module directory, where Gradle runs the host tests. */
        const val COMPOSE_RESOURCES = "src/commonMain/composeResources"

        /** The SDK's five locales (C199.1): English, the default, then Spanish, French, German and Arabic. */
        val LANGUAGES = listOf("values", "values-es", "values-fr", "values-de", "values-ar")

        /** Each locale folder's BCP 47 tag, which its `openverify_locale` names. */
        val LOCALE_TAGS = mapOf("values" to "en", "values-es" to "es", "values-fr" to "fr", "values-de" to "de", "values-ar" to "ar")

        /**
         * The texts each language writes as English does (machine-drafted): French "Signature" and
         * "Code", German "Optional" and "Person %1$d", and the decimal point the Arabic texts use
         * with the ASCII digits the SDK shows (C196.3).
         */
        val SAME_AS_ENGLISH = mapOf(
            "values-fr" to listOf("openverify_crypto_signature", "openverify_otp_code"),
            "values-de" to listOf("openverify_field_optional", "openverify_person_title"),
            "values-ar" to listOf("openverify_decimal_separator"),
        )
    }
}
