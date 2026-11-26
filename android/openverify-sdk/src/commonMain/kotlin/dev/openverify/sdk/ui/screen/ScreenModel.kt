package dev.openverify.sdk.ui.screen

import dev.openverify.sdk.flow.logic.VisibilityRuleRefused
import dev.openverify.sdk.flow.logic.evaluateVisibility
import dev.openverify.sdk.flow.logic.normalizeDigits
import dev.openverify.sdk.flow.logic.pattern.PATTERN_INPUT_LIMIT
import dev.openverify.sdk.flow.logic.pattern.PatternCompilation
import dev.openverify.sdk.flow.logic.pattern.compilePattern
import dev.openverify.sdk.flow.logic.pattern.matchPattern
import dev.openverify.sdk.flow.logic.visibilityValueOf
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.CheckboxGroupComponent
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.FieldComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.FormComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.OptionsComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.RadioGroupComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextFieldComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UnsupportedComponent
import dev.openverify.sdk.model.UrlComponent
import kotlinx.serialization.json.JsonElement

// C148, C195 (Workflow 10A, android-screens): what a `screen` step's form holds and checks, pure, a
// Kotlin mirror of the web flow's `apps/flow/src/screens/screen-model.ts`. The device checks only to
// help the person (C195.10: the server validates every value again and decides what is stored);
// visibility runs through android-logic's strict evaluator (C196.1) and patterns through its
// linear-time matcher (C196.2), never a `Regex` built from operator text; Arabic-Indic digits are
// normalised in number, date, phone, ID and postal-code fields before validation and submission
// (C196.3).

/** An address component's parts, in the order they are shown (C148.2). */
internal enum class AddressPart(internal val wire: String) {
    STREET1("street1"),
    STREET2("street2"),
    CITY("city"),
    SUBDIVISION("subdivision"),
    POSTAL_CODE("postalCode"),
    COUNTRY("country"),
}

/** One field a screen binds: its [key], the [component] that shows it and, for an address, its [part]. */
internal data class BoundField(internal val key: String, internal val component: FormComponent, internal val part: AddressPart? = null)

/** The field key an address binds for [part], or null when it does not bind it. */
internal fun AddressComponent.keyOf(part: AddressPart): String? = when (part) {
    AddressPart.STREET1 -> fields.street1
    AddressPart.STREET2 -> fields.street2
    AddressPart.CITY -> fields.city
    AddressPart.SUBDIVISION -> fields.subdivision
    AddressPart.POSTAL_CODE -> fields.postalCode
    AddressPart.COUNTRY -> fields.country
}

/** Every component of a screen, depth first, containers and footers included. */
internal fun allComponents(components: List<FlowComponent>): List<FlowComponent> = components.flatMap { component ->
    when (component) {
        is ContainerComponent -> listOf(component) + allComponents(component.children)
        is FooterComponent -> listOf(component) + allComponents(component.children)
        else -> listOf(component)
    }
}

/** The fields a screen binds, in the order they are shown. */
internal fun boundFields(step: ScreenStep): List<BoundField> = allComponents(step.components).flatMap { component ->
    when (component) {
        is FieldComponent -> listOf(BoundField(component.field, component))
        is AddressComponent -> AddressPart.entries.mapNotNull { part -> component.keyOf(part)?.let { BoundField(it, component, part) } }
        else -> emptyList()
    }
}

/** C148.6 (Phase 9 `FLOW_V2_CAPS`): the most a screen may hold; above them the screen renders unsupported (C195.9). */
internal object ScreenLimits {
    /** Components on a screen, nested ones included. */
    internal const val COMPONENTS: Int = 40

    /** How deep containers and footers nest: one at depth 3 or deeper is refused. */
    internal const val CONTAINER_DEPTH: Int = 3

    /** Options of one component. */
    internal const val OPTIONS: Int = 1000

    /** Labels of one stepper. */
    internal const val STEPPER_LABELS: Int = 20
}

/**
 * Why [step] cannot be rendered, or null when it can: a component kind this SDK version does not
 * know (C194.3: the whole screen, never a part of it), a screen above [ScreenLimits] (C195.9), or a
 * visibility rule outside the strict subset (C196.1). The reason names no value and no field, only
 * what kind of problem it is, for `FlowState.Unsupported`'s diagnostics.
 */
internal fun screenUnsupportedReason(step: ScreenStep): String? {
    val all = allComponents(step.components)
    if (all.any { it is UnsupportedComponent }) return "screen component"
    if (all.size > ScreenLimits.COMPONENTS) return "screen limits"
    if (nestingTooDeep(step.components, 0)) return "screen limits"
    val tooManyOptions = all.any { component ->
        (component is OptionsComponent && component.options.size > ScreenLimits.OPTIONS) ||
            (component is StepperComponent && (component.labelKeys.size > ScreenLimits.STEPPER_LABELS || component.current !in component.labelKeys.indices))
    }
    if (tooManyOptions) return "screen limits"
    return try {
        visibilityOf(step, initialScreenState(step, emptyMap()).values)
        null
    } catch (_: VisibilityRuleRefused) {
        "screen visibility"
    }
}

private fun nestingTooDeep(components: List<FlowComponent>, depth: Int): Boolean = components.any { component ->
    val children = when (component) {
        is ContainerComponent -> component.children
        is FooterComponent -> component.children
        else -> return@any false
    }
    depth + 1 > ScreenLimits.CONTAINER_DEPTH || nestingTooDeep(children, depth + 1)
}

/** A value a screen field holds while the person edits it: a text, a choice ([Bool]) or a list. */
internal sealed interface ScreenValue {
    data class Text(val text: String) : ScreenValue {
        override fun toString(): String = "ScreenValue.Text(<redacted>)"
    }

    data class Bool(val checked: Boolean) : ScreenValue {
        override fun toString(): String = "ScreenValue.Bool(<redacted>)"
    }

    data class Texts(val items: List<String>) : ScreenValue {
        override fun toString(): String = "ScreenValue.Texts(<${items.size} redacted>)"
    }
}

/**
 * A screen's form: each field's value by field key, and the fields the server holds but never sends
 * back ([set]: a masked or write-once value, C151.5), shown as set and never re-sent unless the
 * person types a new value. Personal data: it lives in memory only (C195.5, C213.2).
 */
internal data class ScreenFormState(internal val values: Map<String, ScreenValue>, internal val set: Set<String>) {
    /** [field]'s value replaced by [value]: a field typed into is no longer shown as set. */
    internal fun with(field: BoundField, value: ScreenValue): ScreenFormState =
        ScreenFormState(values + (field.key to normalizeTyped(field, value)), set - field.key)

    override fun toString(): String = "ScreenFormState(<${values.size} redacted>, set=${set.size})"
}

private fun isListKind(component: FormComponent): Boolean = component is MultiSelectComponent || component is CheckboxGroupComponent

/** A field's value when it holds nothing. */
internal fun emptyValue(field: BoundField): ScreenValue = when {
    field.component is CheckboxComponent -> ScreenValue.Bool(false)
    isListKind(field.component) -> ScreenValue.Texts(emptyList())
    else -> ScreenValue.Text("")
}

/** A number as the person would type it: a whole number without a decimal point, ASCII digits always (C196.3). */
internal fun numberText(value: Double): String =
    if (value.isFinite() && value == kotlin.math.floor(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()

/** A value the session sent, as the control holds it; null when the control cannot hold it. */
private fun fromSession(field: BoundField, value: FlowValue): ScreenValue? = when {
    field.component is CheckboxComponent -> (value as? FlowValue.Bool)?.let { ScreenValue.Bool(it.value) }
    isListKind(field.component) -> (value as? FlowValue.Texts)?.let { ScreenValue.Texts(it.values) }
    value is FlowValue.Text -> ScreenValue.Text(value.value)
    value is FlowValue.Number -> ScreenValue.Text(numberText(value.value))
    else -> null
}

/**
 * C151.5, C195.5 (3.3.7): the form on arrival. Only the fields the screen binds are filled from the
 * session's [values], which the server already limits to the current screen; a field the server
 * will not send back (`{ "set": true }`, a masked or write-once value) is shown as set.
 */
internal fun initialScreenState(step: ScreenStep, values: Map<String, FlowValue>): ScreenFormState {
    val filled = mutableMapOf<String, ScreenValue>()
    val set = mutableSetOf<String>()
    for (field in boundFields(step)) {
        if (field.key in filled) continue
        val sent = values[field.key]
        if (sent == FlowValue.Set) set += field.key
        filled[field.key] = sent?.let { fromSession(field, it) } ?: emptyValue(field)
    }
    return ScreenFormState(filled, set)
}

/** Whether [field]'s typed digits are normalised (C196.3): numbers, dates, phones, IDs and postal codes. */
internal fun normalisesDigits(field: BoundField): Boolean = when (field.component) {
    is NumberComponent, is DateComponent, is PhoneComponent, is TextInputComponent, is MaskedTextComponent -> true
    is AddressComponent -> field.part == AddressPart.POSTAL_CODE
    else -> false
}

/** A typed value, as the field keeps it: Arabic-Indic digits become ASCII where they mean digits. */
internal fun normalizeTyped(field: BoundField, value: ScreenValue): ScreenValue =
    if (value is ScreenValue.Text && normalisesDigits(field)) ScreenValue.Text(normalizeDigits(value.text)) else value

/** A component's state: shown, shown but not usable, or not shown. */
internal enum class Visibility { VISIBLE, DISABLED, HIDDEN }

/** The values a visibility rule reads: every field of the screen, an empty text read as `null`. */
internal fun visibilityValues(values: Map<String, ScreenValue>): Map<String, JsonElement?> = values.mapValues { (_, value) ->
    visibilityValueOf(
        when (value) {
            is ScreenValue.Text -> FlowValue.Text(value.text)
            is ScreenValue.Bool -> FlowValue.Bool(value.checked)
            is ScreenValue.Texts -> FlowValue.Texts(value.items)
        },
    )
}

/**
 * C148.4, C196.1: each component's state by id, through the strict evaluator; a hidden container
 * hides its children and a disabled one disables them.
 *
 * @throws VisibilityRuleRefused for a rule outside the strict subset (the screen renders unsupported).
 */
internal fun visibilityOf(step: ScreenStep, values: Map<String, ScreenValue>): Map<String, Visibility> {
    val scope = visibilityValues(values)
    val states = mutableMapOf<String, Visibility>()
    fun walk(components: List<FlowComponent>, inherited: Visibility) {
        for (component in components) {
            val own = when {
                inherited == Visibility.HIDDEN -> Visibility.HIDDEN
                !evaluateVisibility(component.visibleWhen, scope) -> Visibility.HIDDEN
                !evaluateVisibility(component.enabledWhen, scope) -> Visibility.DISABLED
                else -> Visibility.VISIBLE
            }
            val state = if (own == Visibility.VISIBLE && inherited == Visibility.DISABLED) Visibility.DISABLED else own
            states[component.id] = state
            when (component) {
                is ContainerComponent -> walk(component.children, state)
                is FooterComponent -> walk(component.children, state)
                else -> Unit
            }
        }
    }
    walk(step.components, Visibility.VISIBLE)
    return states
}

/** Why a field's value is refused, each with its `openverify_screen_error_*` words. */
internal enum class FieldErrorCode {
    REQUIRED,
    TOO_SHORT,
    TOO_LONG,
    PATTERN,
    NUMBER,
    TOO_SMALL,
    TOO_LARGE,
    DATE,
    DATE_TOO_EARLY,
    DATE_TOO_LATE,
    EMAIL,
    PHONE,
    URL,
    OPTION,
    COUNTRY,

    /** The server refused the value (a 422 named its field, C195.4). */
    REFUSED,
}

/** A field's error, with the bound its words name (a length, a number or a date), ASCII digits. */
internal data class FieldError(internal val code: FieldErrorCode, internal val limit: String? = null)

/** C195.4: a phone number's digits, E.164's longest (ITU-T E.164 §6.1, 15 digits); provisional guidance, the server decides. */
internal const val PHONE_DIGITS_MOST: Int = 15

/** The fewest digits the device takes as a phone number (ours, provisional guidance: a calling code and a short number). */
internal const val PHONE_DIGITS_FEWEST: Int = 7

/** The longest email address (RFC 5321 §4.5.3.1.3's path limit less its brackets), as the web flow checks it. */
internal const val EMAIL_LONGEST: Int = 254

/** The longest web address, as the web flow and the link fields check it. */
internal const val URL_LONGEST: Int = 2048

private fun isEmpty(value: ScreenValue): Boolean = when (value) {
    is ScreenValue.Text -> value.text.isEmpty()
    is ScreenValue.Bool -> !value.checked
    is ScreenValue.Texts -> value.items.isEmpty()
}

/** Code points, so a character outside the BMP counts once, as the server counts it. */
private fun codePointLength(text: String): Int {
    var count = 0
    var index = 0
    while (index < text.length) {
        val high = text[index]
        index += if (high.isHighSurrogate() && index + 1 < text.length && text[index + 1].isLowSurrogate()) 2 else 1
        count++
    }
    return count
}

private fun lengthError(text: String, minLength: Int?, maxLength: Int?): FieldError? {
    val length = codePointLength(text)
    return when {
        minLength != null && length < minLength -> FieldError(FieldErrorCode.TOO_SHORT, minLength.toString())
        maxLength != null && length > maxLength -> FieldError(FieldErrorCode.TOO_LONG, maxLength.toString())
        text.length > PATTERN_INPUT_LIMIT -> FieldError(FieldErrorCode.TOO_LONG, PATTERN_INPUT_LIMIT.toString())
        else -> null
    }
}

/** A pattern the matcher refuses fails closed, as the server's does (`pattern_refused` at publish). */
private fun patternError(text: String, source: String?): FieldError? {
    if (source == null) return null
    val compiled = compilePattern(source) as? PatternCompilation.Compiled ?: return FieldError(FieldErrorCode.PATTERN)
    return if (matchPattern(compiled.pattern, text)) null else FieldError(FieldErrorCode.PATTERN)
}

private fun isAsciiDigit(character: Char): Boolean = character in '0'..'9'

/** A decimal number as the server reads one: a sign, digits with one point, an exponent; never `0x`, `NaN` or a `d` suffix. */
internal fun parseNumber(text: String): Double? {
    val trimmed = text.trim()
    if (!NUMBER_SHAPE.matches(trimmed)) return null
    return trimmed.toDoubleOrNull()?.takeIf { it.isFinite() }
}

private val NUMBER_SHAPE = Regex("[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?")

/** Whether [text] is a real calendar day written `YYYY-MM-DD` (as Phase 9's `isCalendarDate`). */
internal fun isCalendarDate(text: String): Boolean {
    if (text.length != 10 || text[4] != '-' || text[7] != '-') return false
    if (!(text.substring(0, 4) + text.substring(5, 7) + text.substring(8, 10)).all(::isAsciiDigit)) return false
    val year = text.substring(0, 4).toInt()
    val month = text.substring(5, 7).toInt()
    val day = text.substring(8, 10).toInt()
    return month in 1..12 && day in 1..daysInMonth(year, month)
}

internal fun daysInMonth(year: Int, month: Int): Int = when (month) {
    2 -> if (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) 29 else 28
    4, 6, 9, 11 -> 30
    else -> 31
}

private fun isEmail(text: String): Boolean {
    if (text.length > EMAIL_LONGEST || text.any { it.isWhitespace() }) return false
    val at = text.indexOf('@')
    if (at <= 0 || at != text.lastIndexOf('@')) return false
    val domain = text.substring(at + 1)
    val dot = domain.lastIndexOf('.')
    return dot > 0 && dot < domain.length - 1
}

private fun isHttpUrl(text: String): Boolean {
    if (text.length > URL_LONGEST || text.any { it.isWhitespace() }) return false
    val rest = when {
        text.startsWith("https://", ignoreCase = true) -> text.substring(8)
        text.startsWith("http://", ignoreCase = true) -> text.substring(7)
        else -> return false
    }
    val host = rest.takeWhile { it != '/' && it != '?' && it != '#' }.substringAfterLast('@').substringBefore(':')
    return host.isNotEmpty()
}

/** The digits of a phone number as the person typed it, `+`, spaces, dashes, dots and brackets aside; null for anything else. */
private fun phoneDigits(text: String): Int? {
    var digits = 0
    for ((index, character) in text.withIndex()) {
        when {
            isAsciiDigit(character) -> digits++
            character == '+' && index == 0 -> Unit
            character == ' ' || character == '-' || character == '.' || character == '(' || character == ')' -> Unit
            else -> return null
        }
    }
    return digits
}

/** The error of one non-empty value, by its component's kind. */
private fun valueError(field: BoundField, value: ScreenValue): FieldError? {
    val component = field.component
    val text = (value as? ScreenValue.Text)?.text
    return when (component) {
        is AddressComponent -> when {
            text == null -> null
            field.part == AddressPart.COUNTRY ->
                if (component.allowedCountries == null || text in component.allowedCountries) null else FieldError(FieldErrorCode.COUNTRY)
            else -> lengthError(text, null, null)
        }
        is TextFieldComponent -> text?.let { lengthError(it, component.minLength, component.maxLength) ?: patternError(it, component.pattern) }
        is NumberComponent -> {
            val number = text?.let(::parseNumber) ?: return FieldError(FieldErrorCode.NUMBER)
            when {
                component.min != null && number < component.min -> FieldError(FieldErrorCode.TOO_SMALL, numberText(component.min))
                component.max != null && number > component.max -> FieldError(FieldErrorCode.TOO_LARGE, numberText(component.max))
                else -> null
            }
        }
        is DateComponent -> when {
            text == null || !isCalendarDate(text) -> FieldError(FieldErrorCode.DATE)
            component.min != null && text < component.min -> FieldError(FieldErrorCode.DATE_TOO_EARLY, component.min)
            component.max != null && text > component.max -> FieldError(FieldErrorCode.DATE_TOO_LATE, component.max)
            else -> null
        }
        is EmailComponent -> if (text != null && isEmail(text)) null else FieldError(FieldErrorCode.EMAIL)
        is UrlComponent -> if (text != null && isHttpUrl(text)) null else FieldError(FieldErrorCode.URL)
        is PhoneComponent -> {
            val digits = text?.let(::phoneDigits)
            if (text != null && text.startsWith("+") && digits != null && digits in PHONE_DIGITS_FEWEST..PHONE_DIGITS_MOST) null else FieldError(FieldErrorCode.PHONE)
        }
        is SelectComponent, is RadioGroupComponent ->
            if ((component as OptionsComponent).options.any { it.value == text }) null else FieldError(FieldErrorCode.OPTION)
        is MultiSelectComponent, is CheckboxGroupComponent -> {
            val items = (value as? ScreenValue.Texts)?.items
            val options = (component as OptionsComponent).options
            if (items != null && items.all { item -> options.any { it.value == item } }) null else FieldError(FieldErrorCode.OPTION)
        }
        is CountrySelectComponent ->
            if (text != null && (component.allowedCountries == null || text in component.allowedCountries)) null else FieldError(FieldErrorCode.COUNTRY)
        is CheckboxComponent -> null
    }
}

/** Whether [field] must hold a value: its component's `required`; an address's second street line and subdivision never (C148.2). */
internal fun isRequired(field: BoundField): Boolean =
    field.component.required == true && field.part != AddressPart.STREET2 && field.part != AddressPart.SUBDIVISION

/**
 * C148.5, C195.4: the visible fields' errors, by field key, in the order the fields are shown. A
 * hidden or disabled component is not checked; a field shown as set (a value the server holds) is not
 * required again.
 */
internal fun screenErrors(step: ScreenStep, state: ScreenFormState, visibility: Map<String, Visibility>): Map<String, FieldError> {
    val errors = linkedMapOf<String, FieldError>()
    for (field in boundFields(step)) {
        if (visibility[field.component.id] != Visibility.VISIBLE || field.key in errors) continue
        val value = state.values[field.key] ?: emptyValue(field)
        if (isEmpty(value)) {
            if (isRequired(field) && field.key !in state.set) errors[field.key] = FieldError(FieldErrorCode.REQUIRED)
            continue
        }
        valueError(field, value)?.let { errors[field.key] = it }
    }
    return errors
}

/**
 * C148.5, C195.7: the submission's `values`: only visible, enabled fields; digits normalised
 * (C196.3); a number as a number; an empty value as `null` ([FlowValue.Empty]); a field shown as set
 * and left empty is not sent, so the server keeps what it holds. A hidden component's value is
 * dropped, as the server drops it (C196.1).
 */
internal fun submissionValues(step: ScreenStep, state: ScreenFormState, visibility: Map<String, Visibility>): Map<String, FlowValue> {
    val values = linkedMapOf<String, FlowValue>()
    for (field in boundFields(step)) {
        if (visibility[field.component.id] != Visibility.VISIBLE || field.key in values) continue
        val value = state.values[field.key] ?: emptyValue(field)
        if (isEmpty(value) && field.component !is CheckboxComponent) {
            if (field.key !in state.set) values[field.key] = FlowValue.Empty
            continue
        }
        values[field.key] = when (val typed = normalizeTyped(field, value)) {
            is ScreenValue.Text -> if (field.component is NumberComponent) {
                parseNumber(typed.text)?.let(FlowValue::Number) ?: FlowValue.Text(typed.text)
            } else {
                FlowValue.Text(typed.text)
            }
            is ScreenValue.Bool -> FlowValue.Bool(typed.checked)
            is ScreenValue.Texts -> FlowValue.Texts(typed.items)
        }
    }
    return values
}

/** C195.2: the ISO 8601 day (`YYYY-MM-DD`, ASCII digits, C196.3) of a date picker's UTC midnight [millis]. */
internal fun isoDateOfEpochMillis(millis: Long): String {
    val days = millis.floorDiv(MILLIS_PER_DAY)
    // Howard Hinnant's civil_from_days (public domain), for the proleptic Gregorian calendar.
    val shifted = days + 719_468
    val era = shifted.floorDiv(146_097L)
    val dayOfEra = shifted - era * 146_097L
    val yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    val monthIndex = (5 * dayOfYear + 2) / 153
    val day = dayOfYear - (153 * monthIndex + 2) / 5 + 1
    val month = if (monthIndex < 10) monthIndex + 3 else monthIndex - 9
    val year = yearOfEra + era * 400 + if (month <= 2) 1 else 0
    return year.toString().padStart(4, '0') + "-" + month.toString().padStart(2, '0') + "-" + day.toString().padStart(2, '0')
}

/** The UTC midnight of the ISO 8601 day [text], for the date picker's selection; null when it is not a calendar day. */
internal fun epochMillisOfIsoDate(text: String): Long? {
    if (!isCalendarDate(text)) return null
    val year = text.substring(0, 4).toLong()
    val month = text.substring(5, 7).toLong()
    val day = text.substring(8, 10).toLong()
    // Howard Hinnant's days_from_civil (public domain).
    val y = if (month <= 2) year - 1 else year
    val era = y.floorDiv(400L)
    val yearOfEra = y - era * 400
    val dayOfYear = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5 + day - 1
    val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return (era * 146_097 + dayOfEra - 719_468) * MILLIS_PER_DAY
}

private const val MILLIS_PER_DAY: Long = 86_400_000L
