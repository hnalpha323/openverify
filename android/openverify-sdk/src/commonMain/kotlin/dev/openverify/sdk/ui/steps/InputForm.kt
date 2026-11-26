package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.logic.normalisesDigits
import dev.openverify.sdk.flow.logic.normalizeDigits
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PersonInput
import dev.openverify.sdk.model.US_JURISDICTIONS
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.countryName
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.SECRET_TEXT
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.screen.typedValueProtection
import dev.openverify.sdk.ui.text.Text
import org.jetbrains.compose.resources.StringResource

/**
 * C52.3, C64.2: the form of a database, AAMVA, business registry or business website step. Each
 * field the step collects is labelled and says when it is optional; countries and the issuing
 * state are chosen by name; a registration number's help and objection follow the register of the
 * chosen country; each objection, the device's or a 422 pointer's, shows on its own field, and a
 * refusal no field shows above them. A business that collects them takes up to ten associated
 * persons, each with their own fields. Continue sends every field's text; the flow engine trims it
 * and leaves blanks out.
 */
@Composable
internal fun InputForm(
    state: FlowState.Form,
    drafts: InputDrafts,
    actions: FlowActions,
    title: StringResource,
    intro: StringResource,
    modifier: Modifier = Modifier,
) {
    val aamva = state.step is AamvaStep
    val locale = sdkString(Res.string.openverify_locale)
    fun key(field: InputField) = "${state.step.id}:${field.wireName}"
    val country = drafts[key(InputField.COUNTRY_CODE)]
    val persons = rememberPersons(state, drafts)
    // C195.6 (3.3.7): a `prefillFrom` form shows each value the session holds under its input's name,
    // filled and editable, never over what was typed.
    val values = LocalScreenEnvironment.current.values
    LaunchedEffect(state.step.id, values) {
        prefilledInputs(state.fields, values).forEach { (field, value) -> if (drafts[key(field)].isEmpty()) drafts[key(field)] = value }
    }

    StepLayout(title = sdkString(title), modifier = modifier) {
        Paragraph(sdkString(intro))
        AttemptHints(state.retryHints)
        if (state.refused) ErrorMessage(sdkString(Res.string.openverify_form_refused))
        state.fields.forEach { field ->
            val label = sdkString(fieldLabel(field, aamva))
            val support: @Composable () -> Unit = { FieldSupport(field, field in state.required, state.errors[field], country) }
            when (field) {
                InputField.ADDRESS_COUNTRY_CODE, InputField.COUNTRY_CODE -> Selector(
                    label = label,
                    selected = drafts[key(field)].ifEmpty { null },
                    options = PhoneNumbers.regions.map { it to (countryName(it, locale) ?: it) }.sortedBy { it.second },
                    onSelect = { drafts[key(field)] = it },
                    enabled = !state.submitting,
                    tag = TestTags.input(field),
                    supporting = support,
                )
                InputField.ISSUING_AUTHORITY -> Selector(
                    label = label,
                    selected = drafts[key(field)].ifEmpty { null },
                    options = US_JURISDICTIONS.map { it to (US_JURISDICTION_NAMES[it] ?: it) },
                    onSelect = { drafts[key(field)] = it },
                    enabled = !state.submitting,
                    tag = TestTags.input(field),
                    supporting = support,
                )
                else -> OutlinedTextField(
                    value = drafts[key(field)],
                    // C196.3: digits typed on an Arabic keyboard show and go out as ASCII.
                    onValueChange = { drafts[key(field)] = if (normalisesDigits(field)) normalizeDigits(it) else it },
                    label = { Text(label) },
                    supportingText = support,
                    isError = field in state.errors,
                    singleLine = true,
                    enabled = !state.submitting,
                    keyboardOptions = keyboardFor(field),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(TestTags.input(field))
                        .then(autofillFor(field)?.let { type -> Modifier.semantics { contentType = type } } ?: Modifier)
                        .typedValueProtection(),
                )
            }
        }
        if (state.collectsPersons) PersonsSection(state, drafts, persons)
        if (state.submitting) BusyRow(sdkString(Res.string.openverify_form_submitting))
        Button(
            onClick = {
                actions.submitInputs(state.fields.associateWith { drafts[key(it)] }, if (state.collectsPersons) persons.values() else emptyList())
            },
            enabled = !state.submitting,
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_form_continue))
        }
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

/** Under a field: its objection, else whether it is optional and how to write it. */
@Composable
private fun FieldSupport(field: InputField, required: Boolean, problem: InputProblem?, country: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (problem != null) {
            Text(sdkString(problemWords(field, problem, country)), color = MaterialTheme.colorScheme.error)
        } else if (!required) {
            Text(sdkString(Res.string.openverify_field_optional))
        }
        hintFor(field, country)?.let { Text(sdkString(it)) }
    }
}

/**
 * The associated persons of a business form (C52.3), kept in the drafts: how many there are under
 * `<step>:persons` and each one's fields under `<step>:person:<index>:<field>`.
 */
internal class PersonDrafts(private val stepId: String, private val drafts: InputDrafts) {
    val count: Int get() = drafts["$stepId:persons"].toIntOrNull()?.coerceIn(0, DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS) ?: 0

    fun key(index: Int, field: PersonField) = "$stepId:person:$index:${field.wireName}"

    fun add() {
        if (count < DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS) drafts["$stepId:persons"] = (count + 1).toString()
    }

    /** Removes the person at [index]; the ones after it move up, keeping their values. */
    fun remove(index: Int) {
        val last = count - 1
        for (moved in index until last) {
            PersonField.entries.forEach { drafts[key(moved, it)] = drafts[key(moved + 1, it)] }
        }
        PersonField.entries.forEach { drafts[key(last, it)] = "" }
        drafts["$stepId:persons"] = last.coerceAtLeast(0).toString()
    }

    /** Each person's fields as typed, in order. */
    fun values(): List<Map<PersonField, String>> = (0 until count).map { index -> PersonField.entries.associateWith { drafts[key(index, it)] } }
}

@Composable
private fun rememberPersons(state: FlowState.Form, drafts: InputDrafts): PersonDrafts =
    remember(state.step.id, drafts) { PersonDrafts(state.step.id, drafts) }

/** A business's associated persons: up to ten, each with their names and birth month or date. */
@Composable
private fun PersonsSection(state: FlowState.Form, drafts: InputDrafts, persons: PersonDrafts) {
    Text(
        text = sdkString(Res.string.openverify_persons_title),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() },
    )
    Paragraph(sdkText(Res.string.openverify_persons_intro, DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS).text)
    for (index in 0 until persons.count) {
        Text(
            text = sdkText(Res.string.openverify_person_title, index + 1),
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.semantics { heading() },
        )
        PersonField.entries.forEach { field ->
            val problem = state.personErrors[PersonInput(index, field)]
            OutlinedTextField(
                value = drafts[persons.key(index, field)],
                onValueChange = { drafts[persons.key(index, field)] = normalizeDigits(it) },
                label = { Text(sdkString(personLabel(field))) },
                supportingText = { PersonSupport(field, problem) },
                isError = problem != null,
                singleLine = true,
                enabled = !state.submitting,
                keyboardOptions = if (field == PersonField.BIRTHDATE) {
                    KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false)
                } else {
                    KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false)
                },
                modifier = Modifier.fillMaxWidth().testTag(TestTags.person(index, field)).typedValueProtection(),
            )
        }
        TextButton(onClick = { persons.remove(index) }, enabled = !state.submitting) {
            Text(sdkText(Res.string.openverify_person_remove, index + 1))
        }
    }
    if (persons.count < DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS) {
        OutlinedButton(
            onClick = persons::add,
            enabled = !state.submitting,
            modifier = Modifier.fillMaxWidth().testTag(TestTags.PERSON_ADD),
        ) {
            Text(sdkString(Res.string.openverify_person_add))
        }
    } else {
        Paragraph(sdkString(Res.string.openverify_persons_full))
    }
}

/** Under a person's field: its objection, else whether it is optional and how to write it. */
@Composable
private fun PersonSupport(field: PersonField, problem: InputProblem?) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (problem != null) {
            val words = when (problem) {
                InputProblem.MISSING -> Res.string.openverify_field_error_missing
                InputProblem.TOO_LONG -> Res.string.openverify_field_error_too_long
                InputProblem.REFUSED -> Res.string.openverify_field_error_refused
                InputProblem.INVALID ->
                    if (field == PersonField.BIRTHDATE) Res.string.openverify_field_error_birth_month else Res.string.openverify_field_error_invalid
            }
            Text(sdkString(words), color = MaterialTheme.colorScheme.error)
        } else if (field == PersonField.BIRTHDATE) {
            Text(sdkString(Res.string.openverify_field_optional))
        }
        if (field == PersonField.BIRTHDATE) Text(sdkString(Res.string.openverify_field_person_birthdate_hint))
    }
}

private fun personLabel(field: PersonField): StringResource = when (field) {
    PersonField.NAME_FIRST -> Res.string.openverify_field_name_first
    PersonField.NAME_LAST -> Res.string.openverify_field_name_last
    PersonField.BIRTHDATE -> Res.string.openverify_field_person_birthdate
}

private val DATE_FIELDS = setOf(InputField.BIRTHDATE, InputField.ISSUE_DATE, InputField.EXPIRATION_DATE)

private fun fieldLabel(field: InputField, aamva: Boolean): StringResource = when (field) {
    InputField.NAME_FIRST -> Res.string.openverify_field_name_first
    InputField.NAME_MIDDLE -> Res.string.openverify_field_name_middle
    InputField.NAME_LAST -> Res.string.openverify_field_name_last
    InputField.BIRTHDATE -> Res.string.openverify_field_birthdate
    InputField.ADDRESS_STREET_1 -> Res.string.openverify_field_address_street_1
    InputField.ADDRESS_STREET_2 -> Res.string.openverify_field_address_street_2
    InputField.ADDRESS_CITY -> Res.string.openverify_field_address_city
    InputField.ADDRESS_SUBDIVISION -> Res.string.openverify_field_address_subdivision
    InputField.ADDRESS_POSTAL_CODE -> if (aamva) Res.string.openverify_field_zip_code else Res.string.openverify_field_address_postal_code
    InputField.ADDRESS_COUNTRY_CODE -> Res.string.openverify_field_address_country_code
    InputField.IDENTIFICATION_NUMBER -> if (aamva) Res.string.openverify_field_license_number else Res.string.openverify_field_identification_number
    InputField.PHONE_NUMBER -> Res.string.openverify_field_phone_number
    InputField.EMAIL_ADDRESS -> Res.string.openverify_field_email_address
    InputField.ISSUING_AUTHORITY -> Res.string.openverify_field_issuing_authority
    InputField.ISSUE_DATE -> Res.string.openverify_field_issue_date
    InputField.EXPIRATION_DATE -> Res.string.openverify_field_expiration_date
    InputField.BUSINESS_NAME -> Res.string.openverify_field_business_name
    InputField.COUNTRY_CODE -> Res.string.openverify_field_country_code
    InputField.REGISTRATION_NUMBER -> Res.string.openverify_field_registration_number
    InputField.LEI -> Res.string.openverify_field_lei
    InputField.WEBSITE_URL -> Res.string.openverify_field_website_url
}

private fun hintFor(field: InputField, country: String): StringResource? = when (field) {
    in DATE_FIELDS -> Res.string.openverify_field_date_hint
    InputField.PHONE_NUMBER -> Res.string.openverify_field_phone_hint
    // C52.3: the register of the chosen country sets the format.
    InputField.REGISTRATION_NUMBER -> when (country) {
        "GB" -> Res.string.openverify_field_registration_hint_gb
        "US" -> Res.string.openverify_field_registration_hint_us
        else -> Res.string.openverify_field_registration_hint
    }
    InputField.LEI -> Res.string.openverify_field_lei_hint
    InputField.WEBSITE_URL -> Res.string.openverify_field_website_hint
    else -> null
}

private fun problemWords(field: InputField, problem: InputProblem, country: String): StringResource = when (problem) {
    InputProblem.MISSING -> Res.string.openverify_field_error_missing
    InputProblem.INVALID -> when {
        field in DATE_FIELDS -> Res.string.openverify_field_error_date
        field == InputField.REGISTRATION_NUMBER -> when (country) {
            "GB" -> Res.string.openverify_field_error_registration_gb
            "US" -> Res.string.openverify_field_error_registration_us
            else -> Res.string.openverify_field_error_registration
        }
        field == InputField.LEI -> Res.string.openverify_field_error_lei
        field == InputField.WEBSITE_URL -> Res.string.openverify_field_error_url
        else -> Res.string.openverify_field_error_invalid
    }
    InputProblem.TOO_LONG -> Res.string.openverify_field_error_too_long
    InputProblem.REFUSED -> Res.string.openverify_field_error_refused
}

private fun keyboardFor(field: InputField): KeyboardOptions = when (field) {
    InputField.PHONE_NUMBER -> KeyboardOptions(keyboardType = KeyboardType.Phone, autoCorrectEnabled = false)
    InputField.EMAIL_ADDRESS -> KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false)
    InputField.NAME_FIRST, InputField.NAME_MIDDLE, InputField.NAME_LAST, InputField.ADDRESS_CITY, InputField.BUSINESS_NAME ->
        KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false)
    InputField.WEBSITE_URL -> KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false)
    InputField.REGISTRATION_NUMBER, InputField.LEI ->
        KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false)
    // C195.2 (review P07): a document number is a secret: no autofill content type, autocorrect off (SECRET_TEXT says why no more).
    InputField.IDENTIFICATION_NUMBER -> SECRET_TEXT
    else -> KeyboardOptions(autoCorrectEnabled = false)
}

/**
 * C148.7 (Phase 9 B48): the values a `prefillFrom` database or AAMVA form shows on arrival, each under
 * its input's name with `-` read as `_` (`name-first` is `name_first`), as the server serves them; a
 * text only, never a value the server keeps (`{ "set": true }`).
 */
internal fun prefilledInputs(fields: List<InputField>, values: Map<String, FlowValue>): Map<InputField, String> =
    fields.mapNotNull { field -> (values[field.wireName.replace('-', '_')] as? FlowValue.Text)?.value?.takeIf(String::isNotEmpty)?.let { field to it } }.toMap()

/** The autofill hint of a field, so the platform's autofill can offer the user's own details. */
private fun autofillFor(field: InputField): ContentType? = when (field) {
    InputField.NAME_FIRST -> ContentType.PersonFirstName
    InputField.NAME_MIDDLE -> ContentType.PersonMiddleName
    InputField.NAME_LAST -> ContentType.PersonLastName
    InputField.BIRTHDATE -> ContentType.BirthDateFull
    InputField.ADDRESS_STREET_1 -> ContentType.AddressStreet
    InputField.ADDRESS_CITY -> ContentType.AddressLocality
    InputField.ADDRESS_SUBDIVISION -> ContentType.AddressRegion
    InputField.ADDRESS_POSTAL_CODE -> ContentType.PostalCode
    InputField.PHONE_NUMBER -> ContentType.PhoneNumber
    InputField.EMAIL_ADDRESS -> ContentType.EmailAddress
    else -> null
}
