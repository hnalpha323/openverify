package dev.openverify.sdk.ui.screen

import androidx.compose.foundation.Image
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.CheckboxGroupComponent
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.FieldComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.OptionsComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.RadioGroupComponent
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.SpacerComponent
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.UnsupportedComponent
import dev.openverify.sdk.ui.countryName
import dev.openverify.sdk.ui.steps.PhoneNumbers
import dev.openverify.sdk.ui.steps.Selector
import dev.openverify.sdk.ui.text.Text
import org.jetbrains.compose.resources.StringResource

/**
 * What every component of a screen reads: the form's state, its errors, its components' states,
 * the environment's texts and links, and the screen's actions. One per composition of a screen.
 */
internal class ScreenScope(
    internal val form: ScreenFormState,
    internal val errors: Map<String, FieldError>,
    internal val visibility: Map<String, Visibility>,
    internal val busy: Boolean,
    internal val environment: ScreenEnvironment,
    internal val titleId: String?,
    internal val heading: FocusRequester,
    internal val requesters: Map<String, FocusRequester>,
    internal val change: (BoundField, ScreenValue) -> Unit,
    internal val submit: (port: String?) -> Unit,
    internal val cancel: () -> Unit,
) {
    /** A component text as displayed: its isolated values (C199.5) and, from another language, its language (WCAG 3.1.2). */
    internal fun text(key: String): AnnotatedString? = environment.text(key)?.let(::display)

    internal fun display(text: ComponentText): AnnotatedString = if (text.language == environment.language) {
        AnnotatedString(text.text.display)
    } else {
        buildAnnotatedString { withStyle(SpanStyle(localeList = LocaleList(text.language))) { append(text.text.display) } }
    }

    /** The field's label: its component's, or for an address part the SDK's own words. */
    @Composable
    internal fun labelOf(field: BoundField): AnnotatedString =
        if (field.isAddressPart) AnnotatedString(sdkString(addressPartLabel(field.part!!))) else text(field.component.labelKey) ?: AnnotatedString("")

    /** The [FieldState] of [field], shown by [component] in the state its rules give it. */
    @Composable
    internal fun fieldState(field: BoundField): FieldState = FieldState(
        field = field,
        label = labelOf(field),
        hint = field.component.hintKey?.takeIf { field.part == null }?.let(::text),
        value = form.values[field.key] ?: emptyValue(field),
        set = field.key in form.set,
        error = errors[field.key],
        enabled = !busy && visibility[field.component.id] == Visibility.VISIBLE,
        required = isRequired(field),
        requester = requesters.getValue(field.key),
        onChange = { change(field, it) },
    )
}

/**
 * C195.2: the one model behind every form component's composable: what the field shows (its label,
 * hint and value, whether the server already holds a value, its error) and how it changes. The value
 * is personal data in memory only (C195.5).
 */
internal class FieldState(
    internal val field: BoundField,
    internal val label: AnnotatedString,
    internal val hint: AnnotatedString?,
    internal val value: ScreenValue,
    internal val set: Boolean,
    internal val error: FieldError?,
    internal val enabled: Boolean,
    internal val required: Boolean,
    internal val requester: FocusRequester,
    internal val onChange: (ScreenValue) -> Unit,
) {
    internal val text: String get() = (value as? ScreenValue.Text)?.text.orEmpty()

    override fun toString(): String = "FieldState(${field.key})"
}

/** Components in order; a hidden one is not composed (C148.4). */
@Composable
internal fun RenderComponents(components: List<FlowComponent>, scope: ScreenScope) {
    components.forEach { component ->
        if (scope.visibility[component.id] != Visibility.HIDDEN) RenderComponent(component, scope)
    }
}

@Composable
private fun RenderComponent(component: FlowComponent, scope: ScreenScope) {
    when (component) {
        is TextComponent -> TextView(component, scope)
        is ImageComponent -> ImageView(component, scope, scope.environment.asset(component.assetId))
        is SpacerComponent -> Spacer(Modifier.height(SPACER_SIZES[component.size] ?: 16.dp))
        is StepperComponent -> StepperView(component, scope)
        is ContainerComponent -> ContainerView(component, scope)
        is FooterComponent -> FooterView(component, scope)
        is ButtonComponent -> ButtonView(component, scope)
        is AddressComponent -> AddressView(component, scope)
        is FieldComponent -> FieldView(component, scope)
        // Never reached: a screen holding one renders unsupported as a whole (C194.3).
        is UnsupportedComponent -> Unit
    }
}

/** Spacer sizes, as the web flow's (8, 16 and 32 CSS px). */
private val SPACER_SIZES = mapOf("s" to 8.dp, "m" to 16.dp, "l" to 32.dp)

@Composable
private fun TextView(component: TextComponent, scope: ScreenScope) {
    val text = scope.text(component.copyKey) ?: return
    val modifier = Modifier.fillMaxWidth().testTag(ScreenTags.component(component.id))
    when (component.variant) {
        TITLE -> Text(
            text = text,
            style = MaterialTheme.typography.headlineSmall,
            // The screen's heading carries the heading's tag; another title its component's.
            modifier = if (component.id == scope.titleId) Modifier.fillMaxWidth().headingFocus(scope.heading) else modifier.semantics { heading() },
        )
        "caption" -> Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
        else -> Text(text, style = MaterialTheme.typography.bodyLarge, modifier = modifier)
    }
}

/**
 * C195.1, C198.3: an image from a theme asset, with its text alternative or none when decorative; not
 * loaded (or not fetched), its text alternative stands in, never a broken image.
 */
@Composable
internal fun ImageView(component: ImageComponent, scope: ScreenScope, bitmap: ImageBitmap?) {
    val alt = if (component.decorative) null else component.altKey?.let(scope::text)
    val modifier = Modifier.testTag(ScreenTags.component(component.id))
    when {
        bitmap != null -> Image(
            bitmap = bitmap,
            contentDescription = alt?.text,
            contentScale = ContentScale.Fit,
            modifier = modifier.heightIn(max = 192.dp),
        )
        alt != null -> Text(alt, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
    }
}

/** C195.1: a static indicator of where the person is; the current step is said, not only drawn bold. */
@Composable
private fun StepperView(component: StepperComponent, scope: ScreenScope) {
    val current = sdkString(Res.string.openverify_screen_stepper_current)
    Column(Modifier.fillMaxWidth().testTag(ScreenTags.component(component.id)), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        component.labelKeys.forEachIndexed { index, key ->
            val label = scope.text(key) ?: return@forEachIndexed
            val isCurrent = index == component.current
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (isCurrent) FontWeight.SemiBold else null,
                color = if (isCurrent) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = if (isCurrent) Modifier.semantics { stateDescription = current } else Modifier,
            )
        }
    }
}

/** C195.1: containers nest at most three deep (the screen above that renders unsupported). */
@Composable
private fun ContainerView(component: ContainerComponent, scope: ScreenScope) {
    if (component.direction == "horizontal") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
            component.children.filter { scope.visibility[it.id] != Visibility.HIDDEN }.forEach { child ->
                Column(Modifier.weight(1f)) { RenderComponent(child, scope) }
            }
        }
    } else {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) { RenderComponents(component.children, scope) }
    }
}

/** C195.1: the footer's children; the help slot follows it in a fixed place (`StepScaffold`, C197.4). */
@Composable
private fun FooterView(component: FooterComponent, scope: ScreenScope) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        HorizontalDivider()
        RenderComponents(component.children, scope)
    }
}

/**
 * C195.3: `submit` through its port (absent: `next`); `cancel` asks first; `link` opens one of the
 * version's `https:` link fields in the system browser, any other address refused with a PII-free
 * code. A link button whose field the version does not set is not shown.
 */
@Composable
private fun ButtonView(component: ButtonComponent, scope: ScreenScope) {
    val label = scope.text(component.labelKey) ?: return
    val enabled = !scope.busy && scope.visibility[component.id] == Visibility.VISIBLE
    val modifier = Modifier.fillMaxWidth().testTag(ScreenTags.component(component.id))
    when (component.action) {
        "submit" -> Button(onClick = { scope.submit(component.port) }, enabled = enabled, modifier = modifier.submitProtection()) { Text(label) }
        "cancel" -> OutlinedButton(onClick = scope.cancel, enabled = enabled, modifier = modifier) { Text(label) }
        "link" -> {
            val links = scope.environment.links
            val url = when (component.link) {
                "help-url" -> links?.helpUrl
                "privacy-url" -> links?.privacyUrl
                else -> null
            } ?: return
            val uriHandler = LocalUriHandler.current
            TextButton(
                onClick = { if (isHttpsLink(url)) uriHandler.openUri(url) else SdkLog.log("screen.link_refused") },
                enabled = enabled,
                modifier = modifier,
            ) { Text(label) }
        }
    }
}

/** The words of [error], its bound in ASCII digits (C196.3). */
@Composable
internal fun errorText(error: FieldError): String {
    val words = errorWords(error.code)
    return if (error.limit == null) sdkString(words) else sdkText(words, error.limit).text
}

internal fun errorWords(code: FieldErrorCode): StringResource = when (code) {
    FieldErrorCode.REQUIRED -> Res.string.openverify_screen_error_required
    FieldErrorCode.TOO_SHORT -> Res.string.openverify_screen_error_too_short
    FieldErrorCode.TOO_LONG -> Res.string.openverify_screen_error_too_long
    FieldErrorCode.PATTERN -> Res.string.openverify_screen_error_pattern
    FieldErrorCode.NUMBER -> Res.string.openverify_screen_error_number
    FieldErrorCode.TOO_SMALL -> Res.string.openverify_screen_error_too_small
    FieldErrorCode.TOO_LARGE -> Res.string.openverify_screen_error_too_large
    FieldErrorCode.DATE -> Res.string.openverify_screen_error_date
    FieldErrorCode.DATE_TOO_EARLY -> Res.string.openverify_screen_error_date_too_early
    FieldErrorCode.DATE_TOO_LATE -> Res.string.openverify_screen_error_date_too_late
    FieldErrorCode.EMAIL -> Res.string.openverify_screen_error_email
    FieldErrorCode.PHONE -> Res.string.openverify_screen_error_phone
    FieldErrorCode.URL -> Res.string.openverify_screen_error_url
    FieldErrorCode.OPTION -> Res.string.openverify_screen_error_option
    FieldErrorCode.COUNTRY -> Res.string.openverify_screen_error_country
    FieldErrorCode.REFUSED -> Res.string.openverify_screen_error_refused
}

/** The label as shown: its text, and a visible mark when required (said in words once, at the top). */
private fun labelWithMark(state: FieldState): AnnotatedString =
    if (state.required) buildAnnotatedString { append(state.label); append(" *") } else state.label

/** Under a field: its error, else what the server already holds, and its hint. */
@Composable
private fun Supporting(state: FieldState, extra: String? = null) {
    val style = MaterialTheme.typography.bodySmall
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        state.error?.let { Text(errorText(it), color = MaterialTheme.colorScheme.error, style = style) }
        if (state.set) Text(sdkString(Res.string.openverify_screen_set), style = style)
        state.hint?.let { Text(it, style = style) }
        extra?.let { Text(it, style = style) }
    }
}

/** Every field's semantics: its error said and linked (C195.4) and, on API 34+, its value data-sensitive (C213.1). */
@Composable
private fun Modifier.fieldSemantics(state: FieldState, errorWords: String?): Modifier = this
    .testTag(ScreenTags.field(state.field.key))
    .focusRequester(state.requester)
    .typedValueProtection()
    .then(if (errorWords != null) Modifier.semantics { error(errorWords) } else Modifier)

@Composable
private fun FieldView(component: FieldComponent, scope: ScreenScope) {
    val field = BoundField(component.field, component)
    val state = scope.fieldState(field)
    when (component) {
        is SelectComponent -> SelectView(state, component.options.map { it.value to (scope.text(it.labelKey)?.text ?: it.value) })
        is CountrySelectComponent -> SelectView(state, countryOptions(component.allowedCountries, scope.environment.language))
        is RadioGroupComponent, is CheckboxGroupComponent, is MultiSelectComponent -> ChoiceGroupView(state, component as OptionsComponent, scope)
        is CheckboxComponent -> CheckboxView(state)
        is DateComponent -> DateView(state)
        is PhoneComponent -> PhoneView(state, component.allowedCountries, scope.environment.language)
        else -> TextFieldView(state)
    }
}

/** The countries a selector offers, by name in the chosen language, sorted by that name. */
internal fun countryOptions(allowed: List<String>?, language: String): List<Pair<String, String>> =
    (allowed ?: PhoneNumbers.regions.toList()).map { it to (countryName(it, language) ?: it) }.sortedBy { it.second }

/**
 * C195.2: a typed field: its keyboard and autofill hint by kind ([fieldInputOf]); a secret
 * (`masked_text`) carries no autofill content type, asks the keyboard not to learn and is shown masked;
 * every typed field is accessibility-data-sensitive on API 34+ (C213.1).
 */
@Composable
internal fun TextFieldView(state: FieldState, label: AnnotatedString = labelWithMark(state)) {
    val input = fieldInputOf(state.field) ?: return
    val words = state.error?.let { errorText(it) }
    OutlinedTextField(
        value = state.text,
        onValueChange = { state.onChange(ScreenValue.Text(it)) },
        label = { Text(label) },
        supportingText = { Supporting(state) },
        isError = state.error != null,
        singleLine = input.singleLine,
        minLines = if (input.singleLine) 1 else 3,
        enabled = state.enabled,
        keyboardOptions = input.keyboard,
        visualTransformation = if (input.masked) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = Modifier
            .fillMaxWidth()
            .fieldSemantics(state, words)
            .then(input.contentType?.let { type -> Modifier.semantics { contentType = type } } ?: Modifier),
    )
}

/** A selector among [options] (value to words), its error under it. */
@Composable
private fun SelectView(state: FieldState, options: List<Pair<String, String>>) {
    val words = state.error?.let { errorText(it) }
    // The summary's link moves focus into the selector's group, to its button.
    Column(
        Modifier
            .fillMaxWidth()
            .focusRequester(state.requester)
            .focusGroup()
            .then(if (words != null) Modifier.semantics { error(words) } else Modifier),
    ) {
        Selector(
            label = labelWithMark(state).text,
            selected = state.text.ifEmpty { null },
            options = options,
            onSelect = { state.onChange(ScreenValue.Text(it)) },
            enabled = state.enabled,
            tag = ScreenTags.field(state.field.key),
            supporting = { Supporting(state) },
        )
    }
}

/** A group of radios (one choice) or checkboxes (several), its label a heading of the group, each row a 48 dp target. */
@Composable
private fun ChoiceGroupView(state: FieldState, component: OptionsComponent, scope: ScreenScope) {
    val multiple = component !is RadioGroupComponent
    val chosen: List<String> = when (val value = state.value) {
        is ScreenValue.Texts -> value.items
        is ScreenValue.Text -> listOfNotNull(value.text.ifEmpty { null })
        is ScreenValue.Bool -> emptyList()
    }
    val words = state.error?.let { errorText(it) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .selectableGroup()
            .testTag(ScreenTags.field(state.field.key))
            .then(if (words != null) Modifier.semantics { error(words) } else Modifier),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Text(labelWithMark(state), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
        state.hint?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        component.options.forEachIndexed { index, option ->
            val selected = option.value in chosen
            val optionText = scope.text(option.labelKey) ?: AnnotatedString(option.value)
            val rowModifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .then(if (index == 0) Modifier.focusRequester(state.requester) else Modifier)
                .testTag(ScreenTags.choice(state.field.key, option.value))
            if (multiple) {
                Row(
                    rowModifier.toggleable(
                        value = selected,
                        enabled = state.enabled,
                        role = Role.Checkbox,
                        onValueChange = { on -> state.onChange(ScreenValue.Texts(if (on) chosen + option.value else chosen - option.value)) },
                    ),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Checkbox(checked = selected, onCheckedChange = null, enabled = state.enabled)
                    Text(optionText, style = MaterialTheme.typography.bodyLarge)
                }
            } else {
                Row(
                    rowModifier.selectable(selected = selected, enabled = state.enabled, role = Role.RadioButton, onClick = { state.onChange(ScreenValue.Text(option.value)) }),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    RadioButton(selected = selected, onClick = null, enabled = state.enabled)
                    Text(optionText, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        words?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
}

/** A checkbox whose whole row, label included, is its 48 dp target. */
@Composable
private fun CheckboxView(state: FieldState) {
    val checked = (state.value as? ScreenValue.Bool)?.checked == true
    val words = state.error?.let { errorText(it) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .focusRequester(state.requester)
                .toggleable(value = checked, enabled = state.enabled, role = Role.Checkbox, onValueChange = { state.onChange(ScreenValue.Bool(it)) })
                .testTag(ScreenTags.field(state.field.key))
                .then(if (words != null) Modifier.semantics { error(words) } else Modifier),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Checkbox(checked = checked, onCheckedChange = null, enabled = state.enabled)
            Text(labelWithMark(state), style = MaterialTheme.typography.bodyLarge)
        }
        Column(Modifier.padding(start = 52.dp)) { Supporting(state) }
    }
}

/**
 * A date as ISO 8601 (`YYYY-MM-DD`): typed, or chosen in the platform's date picker, a dialog window
 * that inherits the activity's `FLAG_SECURE` (Compose's default `SecureFlagPolicy.Inherit`, C213.1).
 */
// Compose Multiplatform's iOS Material 3 marks the date picker dialog experimental; Android's does not.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateView(state: FieldState) {
    var picking by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TextFieldView(state)
        TextButton(onClick = { picking = true }, enabled = state.enabled, modifier = Modifier.testTag(ScreenTags.datePick(state.field.key))) {
            Text(sdkString(Res.string.openverify_screen_date_pick))
        }
    }
    if (picking) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = epochMillisOfIsoDate(state.text))
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { state.onChange(ScreenValue.Text(isoDateOfEpochMillis(it))) }
                    picking = false
                }) { Text(sdkString(Res.string.openverify_screen_date_use)) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(sdkString(Res.string.openverify_cancel)) } },
        ) {
            DatePicker(state = picker)
        }
    }
}

/**
 * A phone number with its country, as the phone step's selector offers them (C195.2): the value is the
 * international form the server reads, `+`, the calling code and the number as typed (C55.8).
 */
@Composable
private fun PhoneView(state: FieldState, allowed: List<String>?, language: String) {
    val regions = remember(allowed) { allowed ?: PhoneNumbers.regions.toList() }
    var country by remember(state.field.key) { mutableStateOf(regions.singleOrNull()) }
    var typed by remember(state.field.key) { mutableStateOf(state.text) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Selector(
            label = sdkString(Res.string.openverify_otp_country),
            selected = country,
            options = countryOptions(regions, language).map { (code, name) -> code to (PhoneNumbers.callingCode(code)?.let { "$name (+$it)" } ?: name) },
            onSelect = {
                country = it
                state.onChange(ScreenValue.Text(PhoneNumbers.international(it, typed)))
            },
            enabled = state.enabled,
            tag = ScreenTags.phoneCountry(state.field.key),
        )
        val number = FieldState(
            field = state.field,
            label = state.label,
            hint = state.hint,
            value = ScreenValue.Text(typed),
            set = state.set,
            error = state.error,
            enabled = state.enabled,
            required = state.required,
            requester = state.requester,
            onChange = { value ->
                typed = (value as ScreenValue.Text).text
                state.onChange(ScreenValue.Text(PhoneNumbers.international(country, typed)))
            },
        )
        TextFieldView(number)
    }
}

/** C148.2: an address of several fields, each with its own label and autofill hint; no autocomplete lookup. */
@Composable
private fun AddressView(component: AddressComponent, scope: ScreenScope) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(scope.text(component.labelKey) ?: AnnotatedString(""), style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
        component.hintKey?.let(scope::text)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        AddressPart.entries.forEach { part ->
            val key = component.keyOf(part) ?: return@forEach
            val state = scope.fieldState(BoundField(key, component, part))
            if (part == AddressPart.COUNTRY) {
                SelectView(state, countryOptions(component.allowedCountries, scope.environment.language))
            } else {
                TextFieldView(state)
            }
        }
    }
}
