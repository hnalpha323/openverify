package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts

/** C52.3, C61, C64.2: the business website step's form: its URL, and the business's name if the user likes. */
@Composable
internal fun BusinessWebsiteStepScreen(state: FlowState.Form, drafts: InputDrafts, actions: FlowActions, modifier: Modifier = Modifier) {
    InputForm(state, drafts, actions, Res.string.openverify_website_title, Res.string.openverify_website_intro, modifier)
}
