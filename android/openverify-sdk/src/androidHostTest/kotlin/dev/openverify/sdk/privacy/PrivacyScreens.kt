@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.privacy

import android.content.Context
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.nfc.FakeChipReader
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.screen.ScreenTags
import dev.openverify.sdk.ui.steps.NfcStepTags
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNfcAdapter

/**
 * One thing a person can do on a screen that the privacy tests care about (C213.1, C213.2). The
 * tables below are read by the saved-state canary (`SavedStateCanaryTest`), the per-window
 * `FLAG_SECURE` test (`WindowSecureFlagTest`) and the scan that ties each window in the sources to a
 * row (`WindowSitesScanTest`), so a new field kind or window is one line here.
 */
internal sealed interface PrivacyEntry {
    /** What the entry is, in the words of its contract: a component kind, or a step's field. */
    val kind: String

    /** The test tag of the node the entry starts at. */
    val tag: String

    /** A typed-value field: the canary test types [canary] into it, and it is data-sensitive on API 34+. */
    data class Typed(override val kind: String, override val tag: String, val canary: String = PrivacyScreens.CANARY) : PrivacyEntry

    /**
     * A selector: [tag] opens its menu, a popup window made at [site], and [option] chooses in it.
     * [canary] is the chosen value when the table controls it (an operator's option), else null.
     */
    data class Menu(override val kind: String, override val tag: String, val option: String, val site: String, val canary: String? = null) : PrivacyEntry

    /** A dialog window made at [site], opened by [tag]. */
    data class Dialog(override val kind: String, override val tag: String, val site: String) : PrivacyEntry

    /** A choice made in place (a radio, a checkbox): the chosen value is [canary] when the table controls it. */
    data class Choice(override val kind: String, override val tag: String, val canary: String? = null) : PrivacyEntry
}

/** A screen the real activity shows for [session], after [setup] and along [path], ready once [ready] is on screen. */
internal class PrivacyScreen(
    val name: String,
    val owner: String,
    val session: String,
    val ready: String,
    val entries: List<PrivacyEntry>,
    /** What the host and the phone must be before the launch (a reader installed, NFC on). */
    val setup: () -> Unit = {},
    /** The controls pressed, in order, to reach the screen from the one the session opens on. */
    val path: List<String> = emptyList(),
) {
    override fun toString(): String = name
}

internal object PrivacyScreens {
    /** Synthetic, and distinct from any word of the contract or the SDK. */
    const val CANARY = "SyntheticCanaryQv7Zx"

    /** A second synthetic value, for an operator's option the person chooses. */
    const val OPTION_CANARY = "SyntheticChoiceKp4Wd"

    /** Digits only, for the fields that keep digits: no id, hash or time the SDK saves reads like them. */
    const val DIGITS_CANARY = "7391846205"

    /** An eight-digit code, the length the OTP rows ask for. */
    const val CODE_CANARY = "73918462"

    /** A date as the date field takes it. */
    const val DATE_CANARY = "1987-06-05"

    private const val SCREEN = "src/commonMain/kotlin/dev/openverify/sdk/ui/screen/ScreenComponents.kt"
    private const val STEPS = "src/commonMain/kotlin/dev/openverify/sdk/ui/steps"

    /** An nfc step in a sandbox, with the author's fallback and the server's test chip on offer (C207, C208). */
    private const val NFC_STEP = """{"id":"chip","type":"nfc","androidOnly":true,"fallbackAvailable":true,"sandboxChipAvailable":true}"""

    /** A host that installed a chip reader (a scripted fake) on a phone whose NFC is on, so the step asks for the access key. */
    private fun readerInstalledAndNfcOn() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_NFC, true)
        ShadowNfcAdapter.setNfcHardwareExists(true)
        shadowOf(NfcAdapter.getDefaultAdapter(context)).setEnabled(true)
        OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = FakeChipReader()))
    }

    /** The window a `Selector` opens is its own `DropdownMenu`, the one call in `StepParts.kt`. */
    const val SELECTOR_MENU = "$STEPS/StepParts.kt#DropdownMenu#1"

    private fun option(key: String, value: String) = """{"key":"$key","value":"$value","labelKey":"about.option.$key"}"""

    private val options = "[" + option("first", OPTION_CANARY) + "," + option("second", "second") + "]"

    /**
     * C148's catalogue v1, every form component (`ScreenComponentKindsTest` holds this list to the
     * decoder's kinds): each typed one takes a canary, each choice an option whose value is one.
     */
    private val everyFormComponent = """{"id":"about","type":"screen","components":[
        {"id":"heading","kind":"text","variant":"title","copyKey":"about.heading.title"},
        {"id":"nickname","kind":"text_input","field":"nickname","labelKey":"about.label"},
        {"id":"story","kind":"text_area","field":"story","labelKey":"about.label"},
        {"id":"secret","kind":"masked_text","field":"secret","labelKey":"about.label"},
        {"id":"amount","kind":"number","field":"amount","labelKey":"about.label"},
        {"id":"born","kind":"date","field":"born","labelKey":"about.label"},
        {"id":"mail","kind":"email","field":"mail","labelKey":"about.label"},
        {"id":"site","kind":"url","field":"site","labelKey":"about.label"},
        {"id":"mobile","kind":"phone","field":"mobile","labelKey":"about.label","allowedCountries":["US","CA"]},
        {"id":"home","kind":"address","labelKey":"about.label","allowedCountries":["US","CA"],
         "fields":{"street1":"home_street1","street2":"home_street2","city":"home_city","subdivision":"home_subdivision","postalCode":"home_postal","country":"home_country"}},
        {"id":"country","kind":"country_select","field":"country","labelKey":"about.label","allowedCountries":["US","CA"]},
        {"id":"plan","kind":"select","field":"plan","labelKey":"about.label","options":$options},
        {"id":"tier","kind":"radio_group","field":"tier","labelKey":"about.label","options":$options},
        {"id":"topics","kind":"checkbox_group","field":"topics","labelKey":"about.label","options":$options},
        {"id":"extras","kind":"multi_select","field":"extras","labelKey":"about.label","options":$options},
        {"id":"agree","kind":"checkbox","field":"agree","labelKey":"about.label"},
        {"id":"next","kind":"button","labelKey":"about.next.button","action":"submit"}]}"""

    private val screenCopy = mapOf(
        "about.heading.title" to "About you",
        "about.label" to "Synthetic label",
        "about.option.first" to "First",
        "about.option.second" to "Second",
        "about.next.button" to "Continue",
    )

    private val otpCode = """{"code-length":8,"otp":{"masked-destination":"s***@example.com","expires-at":"2099-01-01T00:00:00.000Z",""" +
        """"resend-available-at":null,"sends-remaining":0,"attempts-remaining":5}}"""

    private val databaseFields = listOf("name-first", "name-middle", "name-last", "birthdate", "address-street-1", "address-street-2", "address-city", "address-subdivision", "address-postal-code", "identification-number", "phone-number", "email-address")

    /**
     * Every screen with a typed value or a window, as the real activity shows it. The DG1 review
     * holds no typed value and no window: `NfcReviewSavedStateTest` checks what it shows.
     */
    val ALL: List<PrivacyScreen> = listOf(
        PrivacyScreen(
            "a screen step with every form component",
            "android-screens (10A)",
            PrivacySessions.at(everyFormComponent, copy = screenCopy),
            ScreenTags.field("nickname"),
            listOf(
                PrivacyEntry.Typed("text_input", ScreenTags.field("nickname")),
                PrivacyEntry.Typed("text_area", ScreenTags.field("story")),
                PrivacyEntry.Typed("masked_text", ScreenTags.field("secret")),
                PrivacyEntry.Typed("number", ScreenTags.field("amount"), DIGITS_CANARY),
                PrivacyEntry.Typed("date", ScreenTags.field("born"), DATE_CANARY),
                PrivacyEntry.Dialog("date", ScreenTags.datePick("born"), "$SCREEN#DatePickerDialog#1"),
                PrivacyEntry.Typed("email", ScreenTags.field("mail")),
                PrivacyEntry.Typed("url", ScreenTags.field("site")),
                PrivacyEntry.Menu("phone", ScreenTags.phoneCountry("mobile"), TestTags.option("CA"), "$SCREEN#Selector#2"),
                PrivacyEntry.Typed("phone", ScreenTags.field("mobile"), DIGITS_CANARY),
                PrivacyEntry.Typed("address", ScreenTags.field("home_street1")),
                PrivacyEntry.Typed("address", ScreenTags.field("home_street2")),
                PrivacyEntry.Typed("address", ScreenTags.field("home_city")),
                PrivacyEntry.Typed("address", ScreenTags.field("home_subdivision")),
                PrivacyEntry.Typed("address", ScreenTags.field("home_postal")),
                PrivacyEntry.Menu("address", ScreenTags.field("home_country"), TestTags.option("CA"), "$SCREEN#Selector#1"),
                PrivacyEntry.Menu("country_select", ScreenTags.field("country"), TestTags.option("CA"), "$SCREEN#Selector#1"),
                PrivacyEntry.Menu("select", ScreenTags.field("plan"), TestTags.option(OPTION_CANARY), "$SCREEN#Selector#1", OPTION_CANARY),
                PrivacyEntry.Choice("radio_group", ScreenTags.choice("tier", OPTION_CANARY), OPTION_CANARY),
                PrivacyEntry.Choice("checkbox_group", ScreenTags.choice("topics", OPTION_CANARY), OPTION_CANARY),
                PrivacyEntry.Choice("multi_select", ScreenTags.choice("extras", OPTION_CANARY), OPTION_CANARY),
                PrivacyEntry.Choice("checkbox", ScreenTags.field("agree")),
                // The chrome's language menu, on every screen of a session with more than one language.
                PrivacyEntry.Menu("language", ChromeTags.LANGUAGE_SELECTOR, ChromeTags.languageItem("es"), "src/commonMain/kotlin/dev/openverify/sdk/ui/help/LanguageSelector.kt#DropdownMenu#1"),
            ),
        ),
        PrivacyScreen(
            "the email step's address",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at("""{"id":"mail","type":"email_otp","codeLength":8}"""),
            TestTags.OTP_DESTINATION,
            listOf(PrivacyEntry.Typed("otp destination", TestTags.OTP_DESTINATION)),
        ),
        PrivacyScreen(
            "the phone step's number",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at("""{"id":"phone","type":"phone_otp","allowedCountries":["US","CA"],"codeLength":8}"""),
            TestTags.OTP_DESTINATION,
            listOf(
                PrivacyEntry.Menu("otp country", TestTags.OTP_COUNTRY, TestTags.option("CA"), "$STEPS/OtpStep.kt#Selector#1"),
                PrivacyEntry.Typed("otp destination", TestTags.OTP_DESTINATION, DIGITS_CANARY),
            ),
        ),
        PrivacyScreen(
            "the OTP code",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at("""{"id":"mail","type":"email_otp","codeLength":8}""", PrivacySessions.initiated("email-address", otpCode)),
            TestTags.OTP_CODE,
            listOf(PrivacyEntry.Typed("otp code", TestTags.OTP_CODE, CODE_CANARY)),
        ),
        PrivacyScreen(
            "a database step's form",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at(
                """{"id":"record","type":"database","fields":["name_first","name_middle","name_last","birthdate","address_street_1","address_street_2",""" +
                    """"address_city","address_subdivision","address_postal_code","address_country_code","identification_number","phone_number","email_address"]}""",
            ),
            "openverify:input:name-first",
            databaseFields.map { PrivacyEntry.Typed("form $it", "openverify:input:$it") } +
                PrivacyEntry.Menu("form address-country-code", "openverify:input:address-country-code", TestTags.option("CA"), "$STEPS/InputForm.kt#Selector#1"),
        ),
        PrivacyScreen(
            "an AAMVA step's form",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at("""{"id":"license","type":"aamva","source":"form"}"""),
            "openverify:input:issuing-authority",
            listOf(PrivacyEntry.Menu("form issuing-authority", "openverify:input:issuing-authority", TestTags.option("CA"), "$STEPS/InputForm.kt#Selector#2")),
        ),
        PrivacyScreen(
            "a crypto wallet step's address",
            "android-screens (10A, Phase 5)",
            PrivacySessions.at("""{"id":"wallet","type":"crypto_wallet","chains":["eip155:1","eip155:8453"],"signing":["paste"]}"""),
            TestTags.CRYPTO_ADDRESS,
            listOf(
                PrivacyEntry.Menu("crypto chain", TestTags.CRYPTO_CHAIN, TestTags.option("eip155:8453"), "$STEPS/CryptoWalletStep.kt#Selector#1"),
                PrivacyEntry.Typed("crypto address", TestTags.CRYPTO_ADDRESS),
            ),
        ),
        PrivacyScreen(
            "the NFC step's MRZ entry",
            "nfc-sdk (10C)",
            PrivacySessions.at(NFC_STEP),
            NfcStepTags.DOCUMENT_NUMBER,
            listOf(
                PrivacyEntry.Typed("mrz document number", NfcStepTags.DOCUMENT_NUMBER),
                PrivacyEntry.Typed("mrz birth date", NfcStepTags.BIRTH_DATE, DIGITS_CANARY),
                PrivacyEntry.Typed("mrz expiry date", NfcStepTags.EXPIRY_DATE, DIGITS_CANARY),
                // The sandbox test chip's scenario, offered where the server says so (C208.2).
                PrivacyEntry.Menu("sandbox chip scenario", NfcStepTags.SANDBOX_SCENARIO, TestTags.option("mrz-mismatch"), "$STEPS/NfcStepScreen.kt#Selector#1"),
            ),
            setup = ::readerInstalledAndNfcOn,
        ),
        PrivacyScreen(
            "the NFC step's CAN entry",
            "nfc-sdk (10C)",
            PrivacySessions.at(NFC_STEP),
            NfcStepTags.CAN,
            listOf(PrivacyEntry.Typed("can", NfcStepTags.CAN, DIGITS_CANARY)),
            setup = ::readerInstalledAndNfcOn,
            path = listOf(NfcStepTags.SWITCH_ACCESS),
        ),
    )

    /**
     * Source paths whose fields, controls and windows are left out of the table-driven scans until
     * their rows are written. Empty at the end of Workflow 10C Stage 2: nfc-sdk's screens
     * (`ui/steps/NfcStepScreen.kt`) landed and have their rows above.
     */
    val PENDING: List<String> = emptyList()

    fun pending(path: String): Boolean = PENDING.any { path.startsWith(it) }
}
