package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts

/** C52.3, C64.2: the database step's form: the details the step compares with a record. */
@Composable
internal fun DatabaseStepScreen(state: FlowState.Form, drafts: InputDrafts, actions: FlowActions, modifier: Modifier = Modifier) {
    InputForm(state, drafts, actions, Res.string.openverify_database_title, Res.string.openverify_database_intro, modifier)
}
