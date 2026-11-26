package dev.openverify.demo

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyInquiry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The demo screen's form (1B F026). A ViewModel outlives a rotation, so nothing pasted is lost.
 * The inquiry ID, the API URL and the pickers' choices are also kept in saved state, which survives
 * the process; the session token and the one-time link (pasted, or handed over by an intent) are
 * secrets, so they live in memory only and are never written to saved state, which the system may
 * persist.
 */
class DemoViewModel @JvmOverloads constructor(
    private val saved: SavedStateHandle,
    private val events: EventLog = EventLog.shared,
) : ViewModel() {

    val inquiryId: StateFlow<String> = saved.getStateFlow(KEY_INQUIRY_ID, "")
    val apiBaseUrl: StateFlow<String> = saved.getStateFlow(KEY_API_BASE_URL, DemoForm.DEFAULT_API_BASE_URL)

    private val mutableSessionToken = MutableStateFlow("")
    val sessionToken: StateFlow<String> = mutableSessionToken.asStateFlow()

    private val mutableOneTimeLink = MutableStateFlow("")
    val oneTimeLinkText: StateFlow<String> = mutableOneTimeLink.asStateFlow()

    private val mutableResult = MutableStateFlow<ResultMessage?>(null)
    val result: StateFlow<ResultMessage?> = mutableResult.asStateFlow()

    private val mutableLocale = MutableStateFlow(choice(saved[KEY_LOCALE], LocaleChoice.DEVICE))
    val locale: StateFlow<LocaleChoice> = mutableLocale.asStateFlow()

    private val mutableAppearance = MutableStateFlow(choice(saved[KEY_APPEARANCE], Appearance.SYSTEM))
    val appearance: StateFlow<Appearance> = mutableAppearance.asStateFlow()

    private val mutableSandboxOutcome = MutableStateFlow(choice(saved[KEY_SANDBOX_OUTCOME], SandboxOutcomeChoice.NONE))
    val sandboxOutcome: StateFlow<SandboxOutcomeChoice> = mutableSandboxOutcome.asStateFlow()

    /** The names of the events the flow told this app (C218.1). */
    val eventNames: StateFlow<List<String>> = events.names

    private val mutablePendingAppLink = MutableStateFlow<OpenVerifyInquiry.OneTimeLink?>(null)

    /** A link an intent handed over and this app accepted, until the screen launches it. In memory only. */
    val pendingAppLink: StateFlow<OpenVerifyInquiry.OneTimeLink?> = mutablePendingAppLink.asStateFlow()

    fun onLocaleChange(value: LocaleChoice) {
        saved[KEY_LOCALE] = value.name
        mutableLocale.value = value
    }

    fun onAppearanceChange(value: Appearance) {
        saved[KEY_APPEARANCE] = value.name
        mutableAppearance.value = value
    }

    fun onSandboxOutcomeChange(value: SandboxOutcomeChoice) {
        saved[KEY_SANDBOX_OUTCOME] = value.name
        mutableSandboxOutcome.value = value
    }

    /** What the pickers add to the next launch. */
    fun options(): LaunchOptions = LaunchOptions(locale.value, appearance.value)

    /** Installs the event log and the picked sandbox outcome, before a launch (C90.9). */
    fun installComponents() = DemoComponents.install(sandboxOutcome.value, events)

    /**
     * A link an intent carried (C218.2): accepted for launch, or refused with a line on the screen
     * that does not repeat it.
     */
    fun onAppLink(link: String?) {
        val accepted = AppLinks.oneTimeLinkOrNull(link, options())
        if (accepted == null) {
            mutableResult.value = ResultMessage(R.string.app_link_refused, emptyList())
        } else {
            mutablePendingAppLink.value = accepted
        }
    }

    /** The screen launched the pending link. */
    fun appLinkTaken() {
        mutablePendingAppLink.value = null
    }

    fun onInquiryIdChange(value: String) {
        saved[KEY_INQUIRY_ID] = value
    }

    fun onApiBaseUrlChange(value: String) {
        saved[KEY_API_BASE_URL] = value
    }

    fun onSessionTokenChange(value: String) {
        mutableSessionToken.value = value
    }

    fun onOneTimeLinkChange(value: String) {
        mutableOneTimeLink.value = value
    }

    fun onResult(result: InquiryResult) {
        mutableResult.value = DemoForm.describe(result)
    }

    /** The session-token launch, or `null` while a value is missing or malformed. */
    fun request(): OpenVerifyInquiry.Request? =
        DemoForm.requestOrNull(inquiryId.value, sessionToken.value, apiBaseUrl.value, options())

    /** The one-time link launch, or `null` while the link or the API URL is malformed. */
    fun oneTimeLink(): OpenVerifyInquiry.OneTimeLink? =
        DemoForm.oneTimeLinkOrNull(oneTimeLinkText.value, apiBaseUrl.value, options())

    private companion object {
        const val KEY_INQUIRY_ID = "inquiry-id"
        const val KEY_API_BASE_URL = "api-base-url"
        const val KEY_LOCALE = "locale"
        const val KEY_APPEARANCE = "appearance"
        const val KEY_SANDBOX_OUTCOME = "sandbox-outcome"

        /** The entry of [E] a saved [name] names, or [default] for a name this build does not know. */
        inline fun <reified E : Enum<E>> choice(name: String?, default: E): E = enumValues<E>().firstOrNull { it.name == name } ?: default
    }
}
