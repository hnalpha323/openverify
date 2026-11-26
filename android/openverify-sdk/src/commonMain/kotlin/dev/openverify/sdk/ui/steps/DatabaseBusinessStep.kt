package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts

/**
 * C52.3, C61, C64.2: the business registry step's form: the business, its country of registration,
 * its identifiers and its registered address, and, when the step collects them, its people.
 */
@Composable
internal fun DatabaseBusinessStepScreen(state: FlowState.Form, drafts: InputDrafts, actions: FlowActions, modifier: Modifier = Modifier) {
    InputForm(state, drafts, actions, Res.string.openverify_business_title, Res.string.openverify_business_intro, modifier)
}
