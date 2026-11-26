package dev.openverify.sdk.privacy

/** A control in a source: what pressing it does ([action], as written) and whether it drops obscured touches. */
internal data class ControlSite(val path: String, val line: Int, val control: String, val action: String, val protected: Boolean)

/** A text field in a source and whether its value is marked accessibility-data-sensitive. */
internal data class FieldSite(val path: String, val line: Int, val field: String, val protected: Boolean)

/**
 * C213.1 (decision 70; review V03) read from the sources: every text field and every control of the
 * SDK's screens, with the protection its own call carries. `typedValueProtection()` marks a typed
 * value accessibility-data-sensitive on API 34+; `submitProtection()` drops touches delivered through
 * another window on API 26 to 30 (`ui/screen/Protections.kt`; Compose has no per-node
 * `filterTouchesWhenObscured`).
 */
internal object ProtectionScan {
    /** The Compose text fields. */
    const val FIELDS = "OutlinedTextField|TextField|BasicTextField|SecureTextField|OutlinedSecureTextField|BasicSecureTextField"

    /** The Compose controls a person presses. */
    const val CONTROLS = "Button|OutlinedButton|TextButton|FilledTonalButton|ElevatedButton|IconButton|FilledIconButton|FilledTonalIconButton|" +
        "OutlinedIconButton|FloatingActionButton|ExtendedFloatingActionButton|Checkbox|TriStateCheckbox|RadioButton|Switch|DropdownMenuItem|" +
        "AssistChip|FilterChip|InputChip|SuggestionChip"

    /** The modifiers that make any node a control. */
    const val CONTROL_MODIFIERS = "clickable|combinedClickable|toggleable|triStateToggleable|selectable"

    private const val TYPED = "typedValueProtection()"
    private const val SUBMIT = "submitProtection()"

    /** The SDK's own wrapper that carries [TYPED] for the screen step's fields (`ScreenComponents.kt`). */
    private const val FIELD_SEMANTICS = ".fieldSemantics("

    fun fields(path: String, text: String): List<FieldSite> =
        SourceScan.calls(text, FIELDS).map { call -> FieldSite(path, call.line, call.name, TYPED in call.arguments || FIELD_SEMANTICS in call.arguments) }

    fun controls(path: String, text: String): List<ControlSite> {
        val direct = SourceScan.calls(text, CONTROLS).map { call ->
            call.start to ControlSite(path, call.line, call.name, action(call.arguments) ?: "?", SUBMIT in call.arguments || viaModifier(call.arguments, text))
        }
        val modifiers = SourceScan.methodCalls(text, CONTROL_MODIFIERS).map { call ->
            val around = SourceScan.enclosingArguments(text, call.start).orEmpty()
            val does = action(call.arguments) ?: trailingLambda(text, call.end) ?: "?"
            call.start to ControlSite(path, call.line, ".${call.name}", does, SUBMIT in around)
        }
        return (direct + modifiers).sortedBy { it.first }.map { it.second }
    }

    /** The expression given as the control's handler, as written, on one line. */
    private fun action(arguments: String): String? {
        val named = Regex("""\b(onClick|onValueChange|onCheckedChange)\s*=\s*""").find(arguments) ?: return null
        var depth = 0
        var quoted = false
        var end = arguments.length
        for (index in named.range.last + 1 until arguments.length) {
            val char = arguments[index]
            if (char == '"') quoted = !quoted
            if (quoted) continue
            if (char == '(' || char == '{' || char == '[') depth++
            if (char == ')' || char == '}' || char == ']') depth--
            if (char == ',' && depth == 0) {
                end = index
                break
            }
        }
        return oneLine(arguments.substring(named.range.last + 1, end))
    }

    /** The lambda written after the call that ends at [close], as `.clickable(...) { }` gives its handler. */
    private fun trailingLambda(text: String, close: Int): String? {
        val rest = text.substring(close + 1)
        if (!rest.trimStart().startsWith("{")) return null
        val open = close + 1 + rest.indexOf('{')
        var depth = 0
        for (index in open until text.length) {
            if (text[index] == '{') depth++
            if (text[index] == '}' && --depth == 0) return oneLine(text.substring(open, index + 1))
        }
        return null
    }

    private fun oneLine(text: String): String = text.trim().replace(Regex("""\s+"""), " ").take(72)

    /** Whether the call's `modifier = <name>` names a value of the file whose declaration carries [SUBMIT]. */
    private fun viaModifier(arguments: String, text: String): Boolean {
        val name = Regex("""\bmodifier\s*=\s*(\w+)\s*(,|$)""").find(arguments.trim())?.groupValues?.get(1) ?: return false
        val declared = Regex("""\bval\s+$name\s*=""").find(text) ?: return false
        val lines = text.substring(declared.range.first).lines()
        val statement = lines.take(1) + lines.drop(1).takeWhile { it.trimStart().startsWith(".") }
        return statement.any { SUBMIT in it }
    }
}
