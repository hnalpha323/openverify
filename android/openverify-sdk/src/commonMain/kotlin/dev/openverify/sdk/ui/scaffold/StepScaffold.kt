package dev.openverify.sdk.ui.scaffold

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.ui.help.HelpSlot
import dev.openverify.sdk.ui.steps.ShareConsentWithdrawalsSlot
import dev.openverify.sdk.ui.theme.LocalThemeBrand

/**
 * Wraps every step's content once, from the dispatcher (review F04), in the same frame on every
 * screen: the theme's brand above it ([BrandHeader]; C198.3, C198.10), the content in the space
 * between, and the fixed help slot after it ([HelpSlot]: the help and privacy links and the language
 * selector; C197.4, C199.3; WCAG 3.2.6's consistent help). Every [state] gets the same frame, so
 * the slot never moves between steps. Each part reads what `OpenVerifyTheme` provides; outside it
 * (a screen composed alone) the content is shown alone.
 */
@Composable
internal fun StepScaffold(state: FlowState, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        LocalThemeBrand.current?.let { BrandHeader(it) }
        Box(Modifier.fillMaxWidth().weight(1f)) { content() }
        // C237.6 (Workflow 11A, clients-connect's hook): withdrawing an accepted share, under every later screen.
        ShareConsentWithdrawalsSlot(state)
        HelpSlot()
    }
}
