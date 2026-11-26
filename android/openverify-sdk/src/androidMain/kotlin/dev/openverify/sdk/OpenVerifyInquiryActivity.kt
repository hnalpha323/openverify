package dev.openverify.sdk

import android.os.Build
import android.os.Bundle
import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import dev.openverify.sdk.nfc.NfcPlatform
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.api.LoopbackPolicy
import dev.openverify.sdk.camera.CameraXCaptureCamera
import dev.openverify.sdk.events.EventingCaptureCamera
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.signals.AndroidDeviceSignals
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InquiryFlowScreen
import dev.openverify.sdk.ui.LocalCaptureGuidance
import dev.openverify.sdk.ui.OpenVerifyTheme
import dev.openverify.sdk.ui.SystemDocumentPicker
import dev.openverify.sdk.ui.SystemPhotoPicker
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.ScreenEnvironment
import dev.openverify.sdk.ui.screen.screenEnvironmentOf
import dev.openverify.sdk.ui.theme.SessionLook
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Hosts the verification flow. Launch it through [OpenVerifyInquiry.Contract] (a session token)
 * or [OpenVerifyInquiry.OneTimeLinkContract] (a one-time link, redeemed here).
 */
internal class OpenVerifyInquiryActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Identity documents and selfies stay out of screenshots, screen recordings and recents.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // C213.3: SdkLog writes its codes only in a debuggable host; C190.2: plain http to a loopback
        // host only there too. Both read the flag from the application, here, before any request.
        HostDebuggable.read(applicationContext)
        LoopbackHttp.read(applicationContext)

        val launch = InquiryResults.launchFrom(intent)
        if (launch == null || !LoopbackPolicy.allows(launch.apiBaseUrl)) {
            finishWith(InquiryResult.Failed(InquiryResults.inquiryIdFrom(intent), FailureReason.INVALID_REQUEST))
            return
        }

        // C191: what the host installed in Application.onCreate. The view models below are made once
        // per launch, so a rotation keeps the components the flow started with.
        val components = OpenVerifyAndroid.installed()
        val scope = ViewModelProvider(this, InquiryLaunchScope.factory(launch.inquiryId, components))[InquiryLaunchScope::class.java]
        // C94.7: the device facts the session's tiers allow, read only after consent; C90.9: the
        // sandbox outcome the host installed, for a sandbox session only.
        val signals = AndroidDeviceSignals(applicationContext, components.sandboxSignalOutcome)
        val viewModel = ViewModelProvider(
            this,
            // C207.12 (Workflow 10C): the phone's NFC seam, made here because it needs a context.
            InquiryViewModel.factory(launch, signals, components, scope, NfcPlatform(applicationContext)),
        )[InquiryViewModel::class.java]
        // C204 (Workflow 10B): the selfie guidance reads the open capture's thresholds. An extension's
        // outcome travels with that window (KP10-25), so a new launch has nothing to forget.
        scope.selfieWindow = viewModel.selfieCapture
        onBackPressedDispatcher.addCallback(this) { viewModel.back() }
        lifecycleScope.launch { finishWith(viewModel.result.filterNotNull().first()) }

        // C192: a photo the camera could not take, and the camera's permission, become events.
        val camera = EventingCaptureCamera(CameraXCaptureCamera(applicationContext), scope.events)
        val actions = object : FlowActions by viewModel {
            override fun cameraReady() {
                scope.events.cameraGranted()
                viewModel.cameraReady()
            }
        }
        setContent {
            // C198, C199: the session's look (theme, languages, links, the organisation's name, operator
            // copy), the host's appearance and locale, the selector's choice and the logo's reader.
            val session by scope.session.collectAsStateWithLifecycle()
            val look = remember(session) { SessionLook.of(session) }
            OpenVerifyTheme(
                look = look,
                appearance = launch.appearance,
                requestedLocale = launch.locale,
                language = scope.language,
                themeAssets = scope.themeAssets,
            ) {
                val state by viewModel.state.collectAsStateWithLifecycle()
                val sandbox by viewModel.sandbox.collectAsStateWithLifecycle()
                // C195, C195.6, C197.3 (Workflow 10A integration hook): the screens read the session's
                // component texts in the chosen language, its links, values and contest route, and the
                // view model's drafts. Images come decoded from the launch's ScreenAssets (C198.3's
                // checks, KP10-11), their text alternative standing in until then or on a failure.
                val language = LocalSdkLanguage.current ?: SDK_DEFAULT_LANGUAGE
                val assets = scope.screenAssets
                val environment = remember(session, language, assets) {
                    session?.let {
                        screenEnvironmentOf(it, language, asset = { id -> assets?.asset(id) }, drafts = viewModel.screenDrafts)
                    } ?: ScreenEnvironment.NONE
                }
                CompositionLocalProvider(LocalScreenEnvironment provides environment, LocalCaptureGuidance provides scope.captureGuidance) {
                    InquiryFlowScreen(
                        state,
                        camera,
                        actions,
                        sandbox = sandbox,
                        photoPicker = SystemPhotoPicker,
                        documentPicker = SystemDocumentPicker,
                        drafts = viewModel.drafts,
                    )
                }
            }
        }
    }

    // C213.1: other apps' overlays are hidden while the flow is in front, and only then.
    override fun onResume() {
        super.onResume()
        OverlayWindows.apply(window, hide = true)
    }

    override fun onPause() {
        OverlayWindows.apply(window, hide = false)
        super.onPause()
    }

    private fun finishWith(result: InquiryResult) {
        val (resultCode, data) = InquiryResults.toActivityResult(result)
        setResult(resultCode, data)
        finish()
    }
}

/**
 * C213.1 (decision 70; review P08, V03): while the flow is resumed, its window hides the non-system
 * overlay windows of other apps on API 31 and later (`Window.setHideOverlayWindows`, the normal
 * permission `HIDE_OVERLAY_WINDOWS`); below API 31 the method does not exist, and the consent
 * controls drop touches delivered through an overlay instead (`ConsentScreen`).
 */
internal object OverlayWindows {
    /** The first API level with `Window.setHideOverlayWindows`. */
    const val FIRST_API_LEVEL: Int = 31

    /**
     * Hides other apps' overlays over [window] when [hide], shows them again otherwise, on [apiLevel]
     * (the device's; tests inject a lower one). A refusal, which the manifest's permission rules out,
     * is logged as a constant code and never stops the flow.
     */
    fun apply(window: Window, hide: Boolean, apiLevel: Int = Build.VERSION.SDK_INT) {
        if (apiLevel < FIRST_API_LEVEL || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            window.setHideOverlayWindows(hide)
        } catch (_: SecurityException) {
            SdkLog.log("activity.overlay_hiding_refused")
        }
    }
}
