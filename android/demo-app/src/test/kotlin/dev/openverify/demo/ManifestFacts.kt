package dev.openverify.demo

import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * What a merged manifest asks of a device and offers to other apps (C215.3; review P21): its
 * permissions, features, `<queries>` and components with their `exported` values, as the text of an
 * allowlist file. One entry a line, sorted, so a difference reads as added or removed lines.
 */
object ManifestFacts {
    private const val ANDROID = "http://schemas.android.com/apk/res/android"

    /** The elements under [parent] (or anywhere below it when [deep]) named [tag]. */
    private fun elements(parent: Element, tag: String): List<Element> {
        val found = mutableListOf<Element>()
        var node = parent.firstChild
        while (node != null) {
            if (node is Element && node.tagName == tag) found += node
            node = node.nextSibling
        }
        return found
    }

    private fun Element.android(name: String): String? = getAttributeNS(ANDROID, name).takeIf { hasAttributeNS(ANDROID, name) }

    private fun quoted(value: String?): String = if (value == null) "null" else "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private fun component(element: Element): String =
        "{ \"name\": ${quoted(element.android("name"))}, \"exported\": ${element.android("exported") ?: "null"}, " +
            "\"permission\": ${quoted(element.android("permission"))} }"

    private fun query(element: Element): String = when (element.tagName) {
        "package" -> "package ${element.android("name")}"
        "provider" -> "provider ${element.android("authorities")}"
        else -> element.tagName + " " + listOf("action", "category", "data").flatMap { tag ->
            elements(element, tag).map { child ->
                val attributes = child.attributes
                tag + "(" + (0 until attributes.length).map { attributes.item(it) }.sortedBy { it.nodeName }
                    .joinToString(",") { "${it.localName}=${it.nodeValue}" } + ")"
            }
        }.joinToString(" ")
    }

    private fun list(name: String, entries: List<String>, last: Boolean = false): String {
        val body = if (entries.isEmpty()) "[]" else entries.sorted().joinToString(",\n", "[\n", "\n  ]") { "    $it" }
        return "  \"$name\": $body" + if (last) "\n" else ",\n"
    }

    /** The allowlist text of [manifest] for the demo configuration [configuration]. */
    fun render(manifest: File, configuration: String): String {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val root = factory.newDocumentBuilder().parse(manifest).documentElement
        val application = elements(root, "application").single()
        val permissions = (elements(root, "uses-permission") + elements(root, "uses-permission-sdk-23")).map { quoted(it.android("name")) }
        val declared = elements(root, "permission").map {
            "{ \"name\": ${quoted(it.android("name"))}, \"protection-level\": ${quoted(it.android("protectionLevel"))} }"
        }
        val features = elements(root, "uses-feature").map {
            "{ \"name\": ${quoted(it.android("name"))}, \"required\": ${it.android("required") ?: "true"} }"
        }
        val queries = elements(root, "queries").flatMap { queries ->
            val children = mutableListOf<Element>()
            var node = queries.firstChild
            while (node != null) {
                if (node is Element) children += node
                node = node.nextSibling
            }
            children.map { quoted(query(it)) }
        }
        return "{\n" +
            "  \"configuration\": ${quoted(configuration)},\n" +
            "  \"build-type\": \"release\",\n" +
            list("permissions", permissions) +
            list("declared-permissions", declared) +
            list("features", features) +
            list("queries", queries) +
            list("activities", (elements(application, "activity") + elements(application, "activity-alias")).map(::component)) +
            list("providers", elements(application, "provider").map(::component)) +
            list("services", elements(application, "service").map(::component)) +
            list("receivers", elements(application, "receiver").map(::component), last = true) +
            "}\n"
    }
}
