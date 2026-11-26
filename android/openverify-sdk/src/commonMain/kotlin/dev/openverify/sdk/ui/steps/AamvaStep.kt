package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts

/**
 * C52.3, C59.5, C64.2: the AAMVA step's form, a US driver's license or ID card as printed. A
 * silent AAMVA step has no screen: the flow shows processing until the server creates or skips it.
 */
@Composable
internal fun AamvaStepScreen(state: FlowState.Form, drafts: InputDrafts, actions: FlowActions, modifier: Modifier = Modifier) {
    InputForm(state, drafts, actions, Res.string.openverify_aamva_title, Res.string.openverify_aamva_intro, modifier)
}
