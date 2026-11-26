package dev.openverify.sdk.i18n

import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The SDK's Compose Multiplatform resource texts as the files spell them once the XML is read
 * (`&lt;` is `<`), for the android-i18n host tests (C199.1, C199.8, C200.2). Read from the module
 * directory, where Gradle runs the host tests.
 */
internal object SdkResourceTexts {

    const val COMPOSE_RESOURCES = "src/commonMain/composeResources"

    /** The five SDK locales (C199.1), each with its folder; English, the source, first. */
    val LOCALE_FOLDERS: Map<String, String> = linkedMapOf(
        "en" to "values",
        "es" to "values-es",
        "fr" to "values-fr",
        "de" to "values-de",
        "ar" to "values-ar",
    )

    /** One `<string>` or `<plurals>`: its file, and its text or each plural item's by quantity. */
    data class Resource(val name: String, val file: String, val text: String?, val items: Map<String, String>) {
        val isPlural: Boolean get() = text == null

        /** Every text of the resource: the string's, or each plural item's. */
        val texts: List<String> get() = text?.let(::listOf) ?: items.values.toList()
    }

    /** The folders under composeResources whose name starts with `values`, sorted by name. */
    fun folders(): List<String> =
        File(COMPOSE_RESOURCES).listFiles { file -> file.isDirectory && file.name.startsWith("values") }.orEmpty().map { it.name }.sorted()

    /** Every resource of [folder]'s XML files, by name. */
    fun resources(folder: String): Map<String, Resource> =
        File(COMPOSE_RESOURCES, folder).listFiles { file -> file.extension == "xml" }.orEmpty().sortedBy { it.name }
            .flatMap { file ->
                val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
                (0 until root.childNodes.length).map(root.childNodes::item).filterIsInstance<Element>().map { element ->
                    val name = element.getAttribute("name")
                    if (element.tagName == "plurals") {
                        val items = element.getElementsByTagName("item")
                        Resource(
                            name,
                            file.name,
                            null,
                            (0 until items.length).map { items.item(it) as Element }.associate { it.getAttribute("quantity") to it.textContent },
                        )
                    } else {
                        Resource(name, file.name, element.textContent, emptyMap())
                    }
                }
            }
            .associateBy { it.name }
}
