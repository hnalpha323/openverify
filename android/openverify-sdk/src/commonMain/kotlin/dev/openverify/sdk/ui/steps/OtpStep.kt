package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpCode
import dev.openverify.sdk.flow.OtpError
import dev.openverify.sdk.flow.logic.normalizeDigits
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkPluralText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.countryName
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.SECRET_NUMBER
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.screen.typedValueProtection
import dev.openverify.sdk.ui.text.Text
import kotlin.time.Clock
import org.jetbrains.compose.resources.StringResource

/**
 * C55, C64.1, C64.2: the phone or email step. Without a code open, the user picks the country (a
 * phone step's allowed ones, with their calling codes) and enters the number, or enters the email
 * address. With one, they enter its digits; the screen names the masked destination, the tries
 * and sends left, counts down to the next send and to the expiry, and always leaves a way on: a
 * new code, another destination, or, with neither code nor send left, continuing without one. A
 * limit refusal leaves only continuing to review (C55.6).
 */
@Composable
internal fun OtpStepScreen(state: FlowState.Otp, drafts: InputDrafts, actions: FlowActions, clock: Clock, modifier: Modifier = Modifier) {
    val code = state.code
    when {
        state.limited -> LimitedScreen(state, actions, modifier)
        code == null -> DestinationEntry(state, drafts, actions, modifier)
        else -> CodeEntry(state, code, drafts, actions, clock, modifier)
    }
}

@Composable
private fun DestinationEntry(state: FlowState.Otp, drafts: InputDrafts, actions: FlowActions, modifier: Modifier) {
    val phone = state.channel == OtpChannel.PHONE
    val countryKey = "${state.step.id}:country"
    val destinationKey = "${state.step.id}:destination"
    val country = drafts[countryKey].takeIf { it in state.allowedCountries } ?: state.allowedCountries.firstOrNull()
    val destination = drafts[destinationKey]
    var malformed by remember(state) { mutableStateOf(false) }
    val locale = sdkString(Res.string.openverify_locale)
    // C195.6 (3.3.7): a prefilled number or address, filled and editable, never over what was typed.
    val prefill = prefilledText(LocalScreenEnvironment.current.values)
    LaunchedEffect(state.step.id, prefill) {
        if (prefill != null && drafts[destinationKey].isEmpty()) drafts[destinationKey] = prefill
    }

    StepLayout(
        title = sdkString(if (phone) Res.string.openverify_otp_phone_title else Res.string.openverify_otp_email_title),
        modifier = modifier,
    ) {
        Paragraph(sdkString(if (phone) Res.string.openverify_otp_phone_intro else Res.string.openverify_otp_email_intro))
        AttemptHints(state.retryHints)
        if (phone) {
            Selector(
                label = sdkString(Res.string.openverify_otp_country),
                selected = country,
                options = state.allowedCountries.map { it to countryWithCode(it, locale) },
                onSelect = { drafts[countryKey] = it },
                enabled = !state.busy,
                tag = TestTags.OTP_COUNTRY,
            )
        }
        OutlinedTextField(
            value = destination,
            onValueChange = {
                // C196.3: a number typed on an Arabic keyboard shows and goes out in ASCII digits.
                drafts[destinationKey] = if (phone) normalizeDigits(it) else it
                malformed = false
            },
            label = { Text(sdkString(if (phone) Res.string.openverify_otp_phone_number else Res.string.openverify_otp_email_address)) },
            supportingText = if (phone) {
                { Text(sdkString(Res.string.openverify_otp_phone_hint)) }
            } else {
                null
            },
            singleLine = true,
            enabled = !state.busy,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (phone) KeyboardType.Phone else KeyboardType.Email,
                autoCorrectEnabled = false,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag(TestTags.OTP_DESTINATION)
                .semantics { contentType = if (phone) ContentType.PhoneNumber else ContentType.EmailAddress }
                .typedValueProtection(),
        )
        if (malformed) ErrorMessage(sdkString(Res.string.openverify_otp_email_invalid))
        state.error?.let { ErrorMessage(sdkString(otpErrorWords(it, state.channel))) }
        if (state.busy) BusyRow(sdkString(Res.string.openverify_otp_sending))
        Button(
            onClick = {
                if (phone) {
                    drafts[codeKey(state)] = ""
                    actions.sendOtp(OtpDestination.Phone(PhoneNumbers.international(country, destination)))
                } else {
                    val address = destination.trim()
                    if (EMAIL_SHAPE.matches(address)) {
                        drafts[codeKey(state)] = ""
                        actions.sendOtp(OtpDestination.Email(address))
                    } else {
                        malformed = true
                    }
                }
            },
            enabled = !state.busy && destination.isNotBlank(),
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_otp_send))
        }
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

@Composable
private fun CodeEntry(state: FlowState.Otp, code: OtpCode, drafts: InputDrafts, actions: FlowActions, clock: Clock, modifier: Modifier) {
    val codeKey = codeKey(state)
    val typed = drafts[codeKey]
    val now = rememberNow(clock, code.resendAvailableAt, code.expiresAt)
    val expired = code.expiresAt != null && minutesUntil(now, code.expiresAt) == 0L
    val wait = secondsUntil(now, code.resendAvailableAt)

    StepLayout(title = sdkString(Res.string.openverify_otp_code_title), modifier = modifier) {
        AttemptHints(state.retryHints)
        val masked = code.maskedDestination
        Paragraph(
            when {
                masked == null -> sdkString(Res.string.openverify_otp_sent)
                code.resent -> sdkText(Res.string.openverify_otp_sent_again, masked).text
                else -> sdkText(Res.string.openverify_otp_sent_to, masked).text
            },
        )
        OutlinedTextField(
            value = typed,
            // C196.3: Arabic-Indic and Persian digits become ASCII first, so the filter keeps them.
            onValueChange = { drafts[codeKey] = normalizeDigits(it).filter { char -> char in '0'..'9' }.take(state.codeLength) },
            label = { Text(sdkString(Res.string.openverify_otp_code)) },
            supportingText = { Text(sdkText(Res.string.openverify_otp_code_hint, state.codeLength)) },
            singleLine = true,
            enabled = !state.busy,
            // C195.2 (review P07): a secret: no autofill content type (SECRET_NUMBER says why not the number-password keyboard).
            keyboardOptions = SECRET_NUMBER,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(TestTags.OTP_CODE)
                .typedValueProtection(),
        )
        code.attemptsRemaining?.let { left ->
            Text(sdkPluralText(Res.plurals.openverify_otp_attempts_left, left, left))
        }
        if (code.expiresAt != null) {
            if (expired) {
                ErrorMessage(sdkString(Res.string.openverify_otp_code_expired))
            } else {
                val minutes = minutesUntil(now, code.expiresAt).toInt()
                Text(sdkPluralText(Res.plurals.openverify_otp_expires_in, minutes, minutes))
            }
        }
        state.error?.takeIf { it != OtpError.CODE_EXPIRED || !expired }?.let { ErrorMessage(sdkString(otpErrorWords(it, state.channel))) }
        if (state.busy) BusyRow(sdkString(Res.string.openverify_otp_checking))
        Button(
            onClick = { actions.confirmOtp(typed) },
            enabled = !state.busy && typed.length == state.codeLength,
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_otp_confirm))
        }
        when {
            code.sendsRemaining == 0 -> {
                Text(sdkString(Res.string.openverify_otp_no_sends_left))
                // C55.6: no usable code and no send left. A send now ends the attempt, so the user
                // can start again rather than be stuck.
                if (code.attemptsRemaining == 0 || expired) {
                    OutlinedButton(onClick = { resend(drafts, codeKey, actions) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                        Text(sdkString(Res.string.openverify_otp_finish))
                    }
                }
            }
            wait > 0 -> Text(sdkPluralText(Res.plurals.openverify_otp_resend_in, wait.toInt(), wait.toInt()))
            else -> OutlinedButton(onClick = { resend(drafts, codeKey, actions) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                Text(sdkString(Res.string.openverify_otp_resend))
            }
        }
        code.sendsRemaining?.takeIf { it > 0 }?.let { left ->
            Text(sdkPluralText(Res.plurals.openverify_otp_sends_left, left, left))
        }
        TextButton(onClick = actions::changeOtpDestination, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text(
                sdkString(
                    if (state.channel == OtpChannel.PHONE) Res.string.openverify_otp_change_phone else Res.string.openverify_otp_change_email,
                ),
            )
        }
    }
}

@Composable
private fun LimitedScreen(state: FlowState.Otp, actions: FlowActions, modifier: Modifier) {
    StepLayout(title = sdkString(Res.string.openverify_otp_limited_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_otp_limited_message))
        if (state.error == OtpError.CONTINUE_REFUSED) ErrorMessage(sdkString(Res.string.openverify_otp_limited_refused))
        if (state.busy) BusyRow(sdkString(Res.string.openverify_otp_limited_continuing))
        // KP10-36 (C213.1): continuing asks the server to move the flow on through its exhausted edge.
        Button(onClick = actions::continueAfterLimit, enabled = !state.busy, modifier = Modifier.fillMaxWidth().submitProtection()) {
            Text(sdkString(Res.string.openverify_otp_limited_continue))
        }
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

/**
 * C148.7: the one value a `prefillFrom` phone or email step gets from the session (its client view
 * names no key), as the web flow reads it: the first text; null when there is none.
 */
internal fun prefilledText(values: Map<String, FlowValue>): String? =
    values.values.firstNotNullOfOrNull { (it as? FlowValue.Text)?.value?.takeIf(String::isNotEmpty) }

/** Where the code the user types is drafted. */
private fun codeKey(state: FlowState.Otp): String = "${state.step.id}:code"

/** A new code supersedes the open one (C55.4), so the digits typed for that one go. */
private fun resend(drafts: InputDrafts, codeKey: String, actions: FlowActions) {
    drafts[codeKey] = ""
    actions.resendOtp()
}

/** A country as the selector offers it: its name in the screen's language and its calling code. */
private fun countryWithCode(country: String, locale: String): String {
    val name = countryName(country, locale) ?: country
    return PhoneNumbers.callingCode(country)?.let { "$name (+$it)" } ?: name
}

/** The words for a refusal of a code request (C52.7), in the channel's terms. */
private fun otpErrorWords(error: OtpError, channel: OtpChannel): StringResource {
    val phone = channel == OtpChannel.PHONE
    return when (error) {
        OtpError.DESTINATION_INVALID ->
            if (phone) Res.string.openverify_otp_error_destination_invalid_phone else Res.string.openverify_otp_error_destination_invalid_email
        OtpError.DESTINATION_NOT_ALLOWED ->
            if (phone) Res.string.openverify_otp_error_not_allowed_phone else Res.string.openverify_otp_error_not_allowed_email
        OtpError.DELIVERY_FAILED ->
            if (phone) Res.string.openverify_otp_error_delivery_failed_phone else Res.string.openverify_otp_error_delivery_failed_email
        OtpError.CODE_INCORRECT -> Res.string.openverify_otp_error_incorrect
        OtpError.CODE_EXPIRED -> Res.string.openverify_otp_code_expired
        OtpError.CODE_EXHAUSTED -> Res.string.openverify_otp_error_exhausted
        OtpError.CODE_NOT_SENT -> Res.string.openverify_otp_error_not_sent
        OtpError.RESEND_TOO_SOON -> Res.string.openverify_otp_error_too_soon
        OtpError.CONTINUE_REFUSED -> Res.string.openverify_otp_limited_refused
        OtpError.DESTINATION_TOO_LONG ->
            if (phone) Res.string.openverify_otp_error_too_long_phone else Res.string.openverify_otp_error_too_long_email
    }
}

/** A loose shape check before a send; the server applies the full rules (C55.8). */
private val EMAIL_SHAPE = Regex("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")
