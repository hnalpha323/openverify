package dev.openverify.sdk.flow.logic

import dev.openverify.sdk.model.FlowValue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * C196.1 (Phase 9 C148.4): the strict visibility evaluator, a Kotlin port of
 * `packages/flow-spec/src/v2/visibility.ts`, which the web flow and the server run. It passes the
 * server's exported vectors (`contracts/fixtures/flow-spec/visibility-vectors.json`, C196.4).
 *
 * The subset: `var` over `screen.<field>` of the same screen only (no default); `===`, `!==`, `==`
 * as an alias of `===`; `!`, `!!`, `and`, `or`; `in` over a list of literals, a field's list or a
 * string. Operands are a `var`, an operator of the subset, or a literal (a string, number, boolean,
 * `null`, or a list of those). Anything else throws [VisibilityRuleRefused], which renders the
 * screen unsupported: the server refuses such a rule at publish, so meeting one means a server
 * defect, never a guess (C196.5: no condition over a server fact ever runs on the device).
 *
 * Evaluation: a field with no value reads `null`; equality is strict (two lists are never equal, a
 * number is its value, so `0` and `0.0` are equal); `!`, `!!`, `and`, `or` use JSONLogic
 * truthiness (an empty list is false) and answer booleans.
 */

/** A rule's bounds, Phase 9's `VISIBILITY_RULE_LIMITS` (ours, provisional: what a screen's own logic needs, with room). */
internal object VisibilityRuleLimits {
    internal const val DEPTH: Int = 16
    internal const val NODES: Int = 200
}

/**
 * What [evaluateVisibility] throws for a rule outside the strict subset; the screen renders
 * unsupported (C196.1). [code] is the first problem's, `visibility_rule_invalid` or
 * `visibility_scope_invalid`; the message is fixed and names no part of the rule (C213.3).
 */
internal class VisibilityRuleRefused(internal val code: String) : IllegalArgumentException("Visibility rule refused: $code") {
    internal companion object {
        internal const val RULE_INVALID: String = "visibility_rule_invalid"
        internal const val SCOPE_INVALID: String = "visibility_scope_invalid"
    }
}

/**
 * Whether [rule] holds over the screen's current [values] (by field key; a missing key or a Kotlin
 * `null` reads JSON `null`). An absent rule holds.
 *
 * @throws VisibilityRuleRefused for a rule outside the strict subset.
 */
internal fun evaluateVisibility(rule: JsonObject?, values: Map<String, JsonElement?>): Boolean {
    if (rule == null) return true
    val problems = checkVisibilityRule(rule, values.keys + referencedFields(rule))
    if (problems.isNotEmpty()) throw VisibilityRuleRefused(problems.first())
    return truthy(evaluate(rule, values))
}

/**
 * A screen value as a rule reads it, as the web flow's `visibilityValues` does: an empty text reads
 * `null`, a value the server holds and never sends back (`{ "set": true }`) is an object, which is
 * truthy and equal to no literal.
 */
internal fun visibilityValueOf(value: FlowValue?): JsonElement =
    when (value) {
        null, FlowValue.Empty -> JsonNull
        is FlowValue.Text -> if (value.value.isEmpty()) JsonNull else JsonPrimitive(value.value)
        is FlowValue.Number -> JsonPrimitive(value.value)
        is FlowValue.Bool -> JsonPrimitive(value.value)
        is FlowValue.Texts -> JsonArray(value.values.map(::JsonPrimitive))
        FlowValue.Set -> JsonObject(mapOf("set" to JsonPrimitive(true)))
    }

/**
 * The problem codes of a rule that leaves the strict subset or names a field outside
 * [screenFields], in Phase 9's order (`checkVisibilityRule`); empty when the rule is in the subset.
 */
internal fun checkVisibilityRule(rule: JsonElement, screenFields: Set<String>): List<String> {
    val checking = Checking(screenFields)
    try {
        checkNode(checking, rule, 0)
    } catch (_: LimitReached) {
        return listOf(VisibilityRuleRefused.RULE_INVALID)
    }
    return checking.problems
}

/** Operator to its operand count (inclusive bounds). */
private val ARITY: Map<String, IntRange> = mapOf(
    "===" to 2..2,
    "==" to 2..2,
    "!==" to 2..2,
    "!" to 1..1,
    "!!" to 1..1,
    "and" to 1..Int.MAX_VALUE,
    "or" to 1..Int.MAX_VALUE,
    "in" to 2..2,
)

private const val SCREEN_PREFIX = "screen."
private const val FIELD_KEY_LONGEST = 64

/**
 * The field of a `screen.<field>` path, `<field>` being `^[a-z][a-z0-9_]{0,63}$` (Phase 9's
 * `SCREEN_PATH`), or null. Checked by hand: a JVM `Regex` `$` also matches before a final line
 * feed, where ECMAScript's does not.
 */
private fun screenField(path: String): String? {
    if (!path.startsWith(SCREEN_PREFIX)) return null
    val field = path.substring(SCREEN_PREFIX.length)
    if (field.isEmpty() || field.length > FIELD_KEY_LONGEST || field[0] !in 'a'..'z') return null
    return field.takeIf { key -> key.all { it in 'a'..'z' || it in '0'..'9' || it == '_' } }
}

private class Checking(val fields: Set<String>) {
    val problems = mutableListOf<String>()
    var nodes = 0
}

/** Thrown inside a check once a limit is passed; caught in [checkVisibilityRule] alone. */
private class LimitReached : RuntimeException("limit")

private fun JsonElement.isScalar(): Boolean = this is JsonPrimitive

private fun argsOf(raw: JsonElement): List<JsonElement> = if (raw is JsonArray) raw else listOf(raw)

/** A literal operand: a scalar, or a list of scalars (each other member reported). */
private fun checkLiteral(checking: Checking, value: JsonElement) {
    if (value.isScalar()) return
    if (value !is JsonArray) {
        checking.problems += VisibilityRuleRefused.RULE_INVALID
        return
    }
    for (item in value) {
        checking.nodes += 1
        if (!item.isScalar()) checking.problems += VisibilityRuleRefused.RULE_INVALID
    }
}

private fun checkVar(checking: Checking, raw: JsonElement) {
    if (raw !is JsonPrimitive || !raw.isString) {
        checking.problems += VisibilityRuleRefused.RULE_INVALID
        return
    }
    val field = screenField(raw.content)
    if (field == null || field !in checking.fields) checking.problems += VisibilityRuleRefused.SCOPE_INVALID
}

private fun checkNode(checking: Checking, node: JsonElement, depth: Int) {
    checking.nodes += 1
    if (depth > VisibilityRuleLimits.DEPTH || checking.nodes > VisibilityRuleLimits.NODES) throw LimitReached()
    if (node !is JsonObject) {
        if (depth == 0) checking.problems += VisibilityRuleRefused.RULE_INVALID else checkLiteral(checking, node)
        return
    }
    if (node.size != 1) {
        checking.problems += VisibilityRuleRefused.RULE_INVALID
        return
    }
    val (operator, raw) = node.entries.first()
    if (operator == "var") {
        checkVar(checking, raw)
        return
    }
    val arity = ARITY[operator]
    val args = argsOf(raw)
    if (arity == null || args.size !in arity) {
        checking.problems += VisibilityRuleRefused.RULE_INVALID
        return
    }
    args.forEachIndexed { index, arg ->
        if (operator == "in" && index == 1 && arg is JsonObject && !(arg.size == 1 && "var" in arg)) {
            checking.problems += VisibilityRuleRefused.RULE_INVALID
        } else {
            checkNode(checking, arg, depth + 1)
        }
    }
}

/** Every `screen.<field>` a rule names, so a field with no value yet still reads `null`. */
private fun referencedFields(node: JsonElement): Set<String> =
    when (node) {
        is JsonArray -> node.flatMapTo(mutableSetOf(), ::referencedFields)
        is JsonObject -> node.entries.flatMapTo(mutableSetOf()) { (key, value) ->
            if (key != "var") {
                referencedFields(value)
            } else {
                listOfNotNull((value as? JsonPrimitive)?.takeIf { it.isString }?.let { screenField(it.content) })
            }
        }
        else -> emptySet()
    }

/** A value while a rule is evaluated, with ECMAScript's types. */
private sealed class Value {
    data object Null : Value()

    data class Text(val text: String) : Value()

    class Number(val number: Double) : Value()

    data class Bool(val bool: Boolean) : Value()

    data class Items(val items: List<Value>) : Value()

    /** An object (a held value's `{ "set": true }`): truthy, never a scalar. */
    data object Record : Value()
}

private fun valueOf(element: JsonElement?): Value =
    when (element) {
        null, JsonNull -> Value.Null
        is JsonPrimitive -> when {
            element.isString -> Value.Text(element.content)
            element.content == "true" -> Value.Bool(true)
            element.content == "false" -> Value.Bool(false)
            else -> Value.Number(element.content.toDouble())
        }
        is JsonArray -> Value.Items(element.map(::valueOf))
        is JsonObject -> Value.Record
    }

private fun Value.isScalar(): Boolean = this is Value.Null || this is Value.Text || this is Value.Number || this is Value.Bool

/** ECMAScript's `===` over two scalars (IEEE equality for numbers, as `===` has it). */
private fun strictEquals(left: Value, right: Value): Boolean =
    when {
        left is Value.Number && right is Value.Number -> left.number == right.number
        left.isScalar() && right.isScalar() -> left == right
        else -> false
    }

private fun truthy(value: Value): Boolean =
    when (value) {
        Value.Null -> false
        is Value.Text -> value.text.isNotEmpty()
        is Value.Number -> value.number != 0.0 && !value.number.isNaN()
        is Value.Bool -> value.bool
        is Value.Items -> value.items.isNotEmpty()
        Value.Record -> true
    }

private fun evaluate(node: JsonElement, values: Map<String, JsonElement?>): Value {
    if (node !is JsonObject) return valueOf(node)
    val (operator, raw) = node.entries.firstOrNull() ?: throw VisibilityRuleRefused(VisibilityRuleRefused.RULE_INVALID)
    val args = argsOf(raw)
    fun operand(index: Int): Value = evaluate(args[index], values)
    return when (operator) {
        "var" -> {
            val field = (raw as? JsonPrimitive)?.takeIf { it.isString }?.let { screenField(it.content) }
                ?: throw VisibilityRuleRefused(VisibilityRuleRefused.SCOPE_INVALID)
            valueOf(values[field])
        }
        "===", "==" -> Value.Bool(strictEquals(operand(0), operand(1)))
        "!==" -> Value.Bool(!strictEquals(operand(0), operand(1)))
        "!" -> Value.Bool(!truthy(operand(0)))
        "!!" -> Value.Bool(truthy(operand(0)))
        "and" -> Value.Bool(args.indices.all { truthy(operand(it)) })
        "or" -> Value.Bool(args.indices.any { truthy(operand(it)) })
        "in" -> {
            val needle = operand(0)
            when (val haystack = operand(1)) {
                is Value.Items -> Value.Bool(needle.isScalar() && haystack.items.any { strictEquals(needle, it) })
                is Value.Text -> Value.Bool(needle is Value.Text && haystack.text.contains(needle.text))
                else -> Value.Bool(false)
            }
        }
        else -> throw VisibilityRuleRefused(VisibilityRuleRefused.RULE_INVALID)
    }
}
