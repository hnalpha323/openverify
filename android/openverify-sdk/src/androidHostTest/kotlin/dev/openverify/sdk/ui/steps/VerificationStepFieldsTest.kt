package dev.openverify.sdk.ui.steps

import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.CryptoChallenge
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpCode
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.screen.LocalPlatformApiLevel
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.ObscuredTouchesFiltered
import dev.openverify.sdk.ui.screen.screenEnvironment
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Workflow 10A (android-screens) in the verification steps of `ui/steps/`: `prefillFrom` values shown
 * filled and editable (C195.6, 3.3.7), the OTP code and the document number as secrets with no
 * autofill content type (C195.2, review P07), and C213.1's protections: typed-value fields
 * accessibility-data-sensitive on API 34+, submit controls dropping obscured touches on API 26-30.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
internal class VerificationStepFieldsTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val drafts = InputDrafts()
    private val now = Instant.parse("2026-11-08T12:00:00Z")
    private val clock = object : Clock {
        override fun now(): Instant = now
    }
    private lateinit var view: View

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun show(values: Map<String, FlowValue> = emptyMap(), apiLevel: Int = 36, content: @Composable () -> Unit) {
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(
                LocalScreenEnvironment provides screenEnvironment(emptyMap(), values = values),
                LocalPlatformApiLevel provides apiLevel,
                content = content,
            )
        }
    }

    private val phone = FlowState.Otp(PhoneOtpStep("phone", listOf("US")), OtpChannel.PHONE, listOf("US"), codeLength = 6)
    private val email = FlowState.Otp(EmailOtpStep("email"), OtpChannel.EMAIL, emptyList(), codeLength = 6)
    private val code = phone.copy(code = OtpCode("•••• ••00", now + 10.minutes, now, sendsRemaining = 4, attemptsRemaining = 5))
    private val database = FlowState.Form(
        DatabaseStep("db", listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.ADDRESS_POSTAL_CODE)),
        listOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_POSTAL_CODE),
        setOf(InputField.NAME_FIRST),
    )
    private val aamva = FlowState.Form(
        AamvaStep("aamva", AamvaSource.FORM),
        listOf(InputField.NAME_FIRST, InputField.IDENTIFICATION_NUMBER, InputField.ISSUE_DATE),
        setOf(InputField.IDENTIFICATION_NUMBER),
    )
    private val wallet = FlowState.CryptoWallet(CryptoWalletStep("wallet", listOf(EVM), listOf(CryptoSigningMethod.PASTE)), listOf(EVM))

    @Test
    fun `a phone step shows its prefilled number, filled and editable (C195_6)`() {
        show(values = mapOf("mobile" to FlowValue.Text("+1 202 555 0100"))) { OtpStepScreen(phone, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assertTextContains("+1 202 555 0100")
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).performClick()
        assertEquals(listOf("sendOtp"), actions.calls)
    }

    @Test
    fun `an email step shows its prefilled address`() {
        show(values = mapOf("contact_email" to FlowValue.Text("sam@example.com"))) { OtpStepScreen(email, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assertTextContains("sam@example.com")
    }

    @Test
    fun `a value the person already typed is not replaced by the prefill`() {
        drafts["phone:destination"] = "202 555 0199"
        show(values = mapOf("mobile" to FlowValue.Text("+1 202 555 0100"))) { OtpStepScreen(phone, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assertTextContains("202 555 0199")
    }

    @Test
    fun `a database form fills each input from the value under its name, and leaves the rest empty (C195_6)`() {
        show(values = mapOf("name_first" to FlowValue.Text("Sam"), "address_postal_code" to FlowValue.Text("90210"), "name_last" to FlowValue.Set)) {
            DatabaseStepScreen(database, drafts, actions)
        }

        rule.onNodeWithTag(TestTags.input(InputField.NAME_FIRST)).assertTextContains("Sam")
        rule.onNodeWithTag(TestTags.input(InputField.ADDRESS_POSTAL_CODE)).performScrollTo().assertTextContains("90210")
        assertEquals("", drafts["db:name-last"])
    }

    @Test
    fun `the OTP code is a secret, with no autofill content type, the number keyboard, autocorrect off (C195_2)`() {
        show { OtpStepScreen(code, drafts, actions, clock) }

        rule.onNodeWithTag(TestTags.OTP_CODE).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType))
        rule.onNodeWithTag(TestTags.OTP_CODE).performClick()
        val info = rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }
        // Not the number-password variation: Compose 1.11 declares ContentType.Password for it (FieldInput.kt).
        assertEquals(InputType.TYPE_CLASS_NUMBER, info.inputType)
    }

    @Test
    fun `a document number is a secret, with no autofill content type and autocorrect off (C195_2)`() {
        show { AamvaStepScreen(aamva, drafts, actions) }

        rule.onNodeWithTag(TestTags.input(InputField.IDENTIFICATION_NUMBER)).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType))
        rule.onNodeWithTag(TestTags.input(InputField.IDENTIFICATION_NUMBER)).performClick()
        val info = rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }
        assertEquals(InputType.TYPE_CLASS_TEXT, info.inputType and (InputType.TYPE_MASK_CLASS or InputType.TYPE_MASK_VARIATION))
        assertEquals(0, info.inputType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
        // Its digits stay readable: the field is not masked.
        rule.onNodeWithTag(TestTags.input(InputField.IDENTIFICATION_NUMBER)).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Password))
    }

    @Test
    fun `on API 34 the typed-value fields of the verification steps are accessibility-data-sensitive (C213_1)`() {
        show(apiLevel = 34) { OtpStepScreen(phone, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assert(SensitiveData)
    }

    @Test
    fun `on API 34 the OTP code is accessibility-data-sensitive`() {
        show(apiLevel = 34) { OtpStepScreen(code, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.OTP_CODE).assert(SensitiveData)
    }

    @Test
    fun `on API 34 every form field is accessibility-data-sensitive`() {
        show(apiLevel = 34) { AamvaStepScreen(aamva, drafts, actions) }
        listOf(InputField.NAME_FIRST, InputField.IDENTIFICATION_NUMBER, InputField.ISSUE_DATE).forEach {
            rule.onNodeWithTag(TestTags.input(it)).assert(SensitiveData)
        }
    }

    @Test
    fun `on API 34 the wallet address is accessibility-data-sensitive`() {
        show(apiLevel = 34) { CryptoWalletStepScreen(wallet, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.CRYPTO_ADDRESS).assert(SensitiveData)
    }

    @Test
    fun `on API 34 the pasted signature is accessibility-data-sensitive`() {
        val signing = wallet.copy(challenge = CryptoChallenge("cwc_01M5CK16P0D13FXHZSS4TCFB01", EVM, "Synthetic message to sign", now + 10.minutes))
        show(apiLevel = 34) { CryptoWalletStepScreen(signing, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).assert(SensitiveData)
    }

    @Test
    fun `below API 34 none is marked`() {
        show(apiLevel = 33) { OtpStepScreen(phone, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.OTP_DESTINATION).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))
    }

    @Test
    fun `on API 28 the OTP send and confirm controls drop obscured touches (C213_1)`() {
        show(apiLevel = 28) { OtpStepScreen(phone, drafts, actions, clock) }
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).assert(Filtered)
    }

    @Test
    fun `on API 28 the code's confirm control drops obscured touches`() {
        show(apiLevel = 28) { OtpStepScreen(code, drafts, actions, clock) }
        rule.onNodeWithText(text(Res.string.openverify_otp_confirm)).assert(Filtered)
    }

    @Test
    fun `on API 28 a form's continue control drops obscured touches`() {
        show(apiLevel = 28) { DatabaseStepScreen(database, drafts, actions) }
        rule.onNodeWithText(text(Res.string.openverify_form_continue)).performScrollTo().assert(Filtered)
    }

    @Test
    fun `on API 28 the wallet's controls drop obscured touches`() {
        show(apiLevel = 28) { CryptoWalletStepScreen(wallet, drafts, actions, clock) }
        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).assert(Filtered)
    }

    @Test
    fun `from API 31 the platform filters, so the controls do not`() {
        show(apiLevel = 31) { OtpStepScreen(phone, drafts, actions, clock) }
        rule.onNodeWithText(text(Res.string.openverify_otp_send)).assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))
    }

    private companion object {
        const val EVM = "eip155:1"
        val SensitiveData = SemanticsMatcher.expectValue(SemanticsProperties.IsSensitiveData, true)
        val Filtered = SemanticsMatcher.expectValue(ObscuredTouchesFiltered, true)
    }
}
