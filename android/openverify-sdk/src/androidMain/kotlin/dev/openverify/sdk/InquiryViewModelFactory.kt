package dev.openverify.sdk

import android.os.Handler
import android.os.Looper
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import dev.openverify.sdk.nfc.NfcEnvironment
import dev.openverify.sdk.nfc.NfcPlatform
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.capture.selfie.SelfieGuidanceFactory
import dev.openverify.sdk.ui.BuiltInCaptureGuidance
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.OneTimeLinkClient
import dev.openverify.sdk.api.OneTimeLinkFlowApi
import dev.openverify.sdk.events.FlowEventTracker
import dev.openverify.sdk.events.FlowEvents
import dev.openverify.sdk.events.ObservedFlowApi
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.signals.DeviceSignals
import dev.openverify.sdk.signals.integrityVerdictRequest
import dev.openverify.sdk.ui.ConsentTexts
import dev.openverify.sdk.ui.theme.LanguageSelection
import dev.openverify.sdk.ui.screen.ScreenAssets
import dev.openverify.sdk.ui.theme.ThemeAssetSource
import io.ktor.client.HttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The view model for a launch. A one-time link is redeemed when the flow starts, and the
 * session token it gives lives in this view model only: it survives a rotation, never
 * reaches an intent or saved state, and ends with the process (C19). Consent is recorded in
 * the language the consent screen shows (C37), so the view model keeps none of its own.
 *
 * C191.1: when the host installed a transport (`OpenVerifyAndroidTransport.okHttp`), every flow
 * request and the one-time-link redemption go through the client derived from it; otherwise through
 * the SDK's shared client. C192: with a [scope], the coordinator's API is observed for the chrome's
 * session and the events' submissions, and its states become the launch's events.
 */
internal fun InquiryViewModel.Companion.factory(
    launch: InquiryResults.Launch,
    /** C94.7 (Phase 7): the device signals the coordinator sends after consent. */
    deviceSignals: DeviceSignals = DeviceSignals.None,
    /** C191: what the host installed (its transport, its integrity provider); read once, when the view model is made. */
    components: OpenVerifyComponents = OpenVerifyAndroid.installed(),
    /** C192: the launch's events and the chrome's session, kept beside the view model. */
    scope: InquiryLaunchScope? = null,
    /** C207.12 (Workflow 10C): what the phone offers for reading a chip; the activity makes it from its application context. */
    nfcPlatform: NfcPlatform? = null,
): ViewModelProvider.Factory = viewModelFactory {
    initializer {
        val http: HttpClient? = (components.transport as? OkHttpFlowTransport)?.httpClient
        val api: FlowApi = when (launch) {
            is InquiryResults.Launch.Session -> flowApiClient(launch.request.apiBaseUrl, launch.request.sessionToken, http)
            is InquiryResults.Launch.OneTimeLink -> OneTimeLinkFlowApi(
                inquiryId = launch.link.inquiryId,
                oneTimeToken = launch.link.oneTimeToken,
                redeem = (http?.let { OneTimeLinkClient(launch.link.apiBaseUrl, it) } ?: OneTimeLinkClient(launch.link.apiBaseUrl))::redeem,
                connect = { sessionToken -> flowApiClient(launch.link.apiBaseUrl, sessionToken, http) },
            )
        }
        var coordinator: FlowCoordinator? = null
        val observed = scope?.let { launchScope ->
            ObservedFlowApi(
                api,
                onSession = launchScope::seen,
                onSubmitted = { coordinator?.state?.value?.let(launchScope.events::submitted) },
            )
        } ?: api
        val settings = FlowCoordinator.Settings(consentTextKeys = ConsentTexts.keys)
        // C211.3 (Workflow 10B hook): the integrity request over the flow's own client and the host's provider.
        val integrity = integrityVerdictRequest(observed, components.integrityTokenProvider)
        // C207 (Workflow 10C hook): the reader the host installed and the phone's NFC seam, for the nfc step.
        val nfc = NfcEnvironment(components.chipReader, nfcPlatform)
        val created = FlowCoordinator(observed, launch.inquiryId, settings, deviceSignals, integrity, nfcEnvironment = nfc).also { coordinator = it }
        scope?.themeAssets = observed::fetchThemeAsset
        // KP10-11 (C195.1, C198.3): a screen's images, through the same read, cached for the launch.
        scope?.let { launchScope -> launchScope.screenAssets = ScreenAssets(observed::fetchThemeAsset, launchScope.viewModelScope) }
        InquiryViewModel(created, launch.inquiryId).also { viewModel -> scope?.attach(viewModel, created) }
    }
}

private fun flowApiClient(apiBaseUrl: String, sessionToken: String, http: HttpClient?): FlowApiClient =
    if (http != null) FlowApiClient(apiBaseUrl, sessionToken, http) else FlowApiClient(apiBaseUrl, sessionToken)

/**
 * What a launch keeps beside its [InquiryViewModel], in the same view-model store so a rotation keeps
 * it too: the events' tracker (C192), made from the listener installed when the flow started, and for
 * the chrome (`OpenVerifyTheme`): the last session the server answered (its look: theme, languages,
 * links, the organisation's name, operator copy), the language selector's choice and the logo's reader.
 */
internal class InquiryLaunchScope(inquiryId: String, components: OpenVerifyComponents) : ViewModel() {
    val events: FlowEventTracker = FlowEventTracker(inquiryId, FlowEvents(components.eventListener, MainThreadDelivery::deliver))

    /** C199.3: the person's choice in the language selector, kept across a rotation, in memory only. */
    val language: LanguageSelection = LanguageSelection()

    /** C198.3: the session's logo, read through the flow's own client; set when the view model is made. */
    var themeAssets: ThemeAssetSource? = null

    /** C195.1 (KP10-11): the screens' image assets, decoded once and kept in memory for this launch. */
    var screenAssets: ScreenAssets? = null

    /** C204.5: the open selfie capture's window, set by the activity once the flow's view model is made. */
    var selfieWindow: StateFlow<SelfieCaptureWindow?>? = null

    /**
     * C204, C201 (Workflow 10B): the capture guidance of this launch, one per launch so a rotation keeps
     * it and the centre yaw ratio passes between a capture's prompts: the selfie guidance, with the
     * installed detector and the open capture's thresholds, over the built-in document and barcode
     * guidance. Without a detector a selfie keeps the manual shutter (C204.6).
     */
    val captureGuidance: CaptureGuidanceFactory =
        SelfieGuidanceFactory(components.faceDetectorFactory, { selfieWindow?.value?.guidance }, next = BuiltInCaptureGuidance)

    private val mutableSession = MutableStateFlow<FlowSession?>(null)

    /** The last session the server answered; `null` before the first. */
    val session: StateFlow<FlowSession?> = mutableSession.asStateFlow()

    internal fun seen(session: FlowSession) {
        mutableSession.value = session
    }

    /** Turns [viewModel]'s flow into events, once per launch (the view model is made once). */
    internal fun attach(viewModel: InquiryViewModel, coordinator: FlowCoordinator) {
        viewModel.viewModelScope.launch {
            events.started()
            coordinator.state.collect(events::onState)
        }
        viewModel.viewModelScope.launch { events.ended(viewModel.result.filterNotNull().first()) }
    }

    internal companion object {
        fun factory(inquiryId: String, components: OpenVerifyComponents = OpenVerifyAndroid.installed()): ViewModelProvider.Factory =
            viewModelFactory { initializer { InquiryLaunchScope(inquiryId, components) } }

        /**
         * KP10-14: the launch scope [owner] (the flow's activity) already holds, or `null` when [owner]
         * runs no flow launch; it never makes one. So a composable deep in the flow (the camera
         * permission) tells its events on the activity path only, as every C192 event is.
         */
        fun of(owner: ViewModelStoreOwner): InquiryLaunchScope? = try {
            ViewModelProvider(owner.viewModelStore, NoLaunch)[InquiryLaunchScope::class.java]
        } catch (_: NoLaunch.Absent) {
            null
        }
    }

    /** Makes no scope: asked only when the store holds none, which [of] answers as `null`. */
    private object NoLaunch : ViewModelProvider.Factory {
        class Absent : IllegalStateException("No flow launch")

        override fun <T : ViewModel> create(modelClass: Class<T>): T = throw Absent()
    }
}

/** C192.1: runs an event's delivery on the main thread, at once when already there. */
internal object MainThreadDelivery {
    private val main: Handler by lazy { Handler(Looper.getMainLooper()) }

    fun deliver(delivery: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) delivery() else main.post(delivery)
    }
}
