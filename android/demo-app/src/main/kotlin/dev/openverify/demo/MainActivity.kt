package dev.openverify.demo

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.StringRes
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.OpenVerifyInquiry

class MainActivity : ComponentActivity() {
    private lateinit var viewModel: DemoViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        viewModel = ViewModelProvider(this)[DemoViewModel::class.java]
        // C218.2: a tapped one-time link, were the manifest's example filter enabled. A recreated
        // activity gets the same intent again, and the link works once, so only a new launch reads it.
        if (savedInstanceState == null) openLinkOf(intent)
        setContent {
            DemoTheme {
                StartVerificationScreen(viewModel = viewModel)
            }
        }
    }

    // C218.2: a link tapped while the screen is open.
    public override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openLinkOf(intent)
    }

    /** Hands a view intent's link to the model, which checks its host before anything is launched. */
    private fun openLinkOf(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) viewModel.onAppLink(AppLinks.linkOf(intent))
    }
}

/**
 * Paste an inquiry ID and a session token created by your server, or a one-time link, then start
 * the SDK flow, with the language, appearance and sandbox bot-detection outcome picked here
 * (C218.1). The app bundles no credentials. The form lives in [DemoViewModel], so a rotation keeps
 * it; the token and the link stay in memory only, never in saved state (1B F026). The event log
 * below the form shows event names only.
 */
@Composable
fun StartVerificationScreen(modifier: Modifier = Modifier, viewModel: DemoViewModel = viewModel()) {
    val inquiryId by viewModel.inquiryId.collectAsStateWithLifecycle()
    val sessionToken by viewModel.sessionToken.collectAsStateWithLifecycle()
    val apiBaseUrl by viewModel.apiBaseUrl.collectAsStateWithLifecycle()
    val oneTimeLinkText by viewModel.oneTimeLinkText.collectAsStateWithLifecycle()
    val result by viewModel.result.collectAsStateWithLifecycle()
    val locale by viewModel.locale.collectAsStateWithLifecycle()
    val appearance by viewModel.appearance.collectAsStateWithLifecycle()
    val sandboxOutcome by viewModel.sandboxOutcome.collectAsStateWithLifecycle()
    val eventNames by viewModel.eventNames.collectAsStateWithLifecycle()
    val pendingAppLink by viewModel.pendingAppLink.collectAsStateWithLifecycle()
    val launcher = rememberLauncherForActivityResult(OpenVerifyInquiry.Contract(), viewModel::onResult)
    val linkLauncher = rememberLauncherForActivityResult(OpenVerifyInquiry.OneTimeLinkContract(), viewModel::onResult)
    val options = LaunchOptions(locale, appearance)
    val request = DemoForm.requestOrNull(inquiryId, sessionToken, apiBaseUrl, options)
    val oneTimeLink = DemoForm.oneTimeLinkOrNull(oneTimeLinkText, apiBaseUrl, options)

    // C218.2: a link an intent handed over and the model accepted is launched once.
    LaunchedEffect(pendingAppLink) {
        pendingAppLink?.let { link ->
            viewModel.appLinkTaken()
            viewModel.installComponents()
            linkLauncher.launch(link)
        }
    }

    Scaffold(modifier = modifier.fillMaxSize()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(text = stringResource(R.string.start_verification_title), style = MaterialTheme.typography.headlineMedium)
            Text(text = stringResource(R.string.harness_notice), style = MaterialTheme.typography.labelLarge)
            Text(text = stringResource(R.string.start_verification_body), style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                value = inquiryId,
                onValueChange = viewModel::onInquiryIdChange,
                label = { Text(stringResource(R.string.field_inquiry_id)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = sessionToken,
                onValueChange = viewModel::onSessionTokenChange,
                label = { Text(stringResource(R.string.field_session_token)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = apiBaseUrl,
                onValueChange = viewModel::onApiBaseUrlChange,
                label = { Text(stringResource(R.string.field_api_base_url)) },
                supportingText = { Text(stringResource(R.string.field_api_base_url_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Choice(
                title = stringResource(R.string.picker_locale_title),
                options = LocaleChoice.entries,
                selected = locale,
                label = { it.tag ?: stringResource(R.string.locale_device) },
                onSelect = viewModel::onLocaleChange,
            )
            Choice(
                title = stringResource(R.string.picker_appearance_title),
                options = Appearance.entries,
                selected = appearance,
                label = { stringResource(appearanceLabel(it)) },
                onSelect = viewModel::onAppearanceChange,
            )
            Choice(
                title = stringResource(R.string.picker_sandbox_outcome_title),
                options = SandboxOutcomeChoice.entries,
                selected = sandboxOutcome,
                label = { stringResource(sandboxOutcomeLabel(it)) },
                onSelect = viewModel::onSandboxOutcomeChange,
            )
            Text(text = stringResource(R.string.sandbox_outcome_hint), style = MaterialTheme.typography.bodySmall)
            Text(text = stringResource(DemoArtifacts.description(DemoArtifacts.included)), style = MaterialTheme.typography.bodySmall)
            Button(
                onClick = {
                    request?.let {
                        // Phase 7 C90.9: the picked outcome is installed before the launch.
                        viewModel.installComponents()
                        launcher.launch(it)
                    }
                },
                enabled = request != null,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(text = stringResource(R.string.start_verification_button))
            }
            Text(text = stringResource(R.string.one_time_link_body), style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                value = oneTimeLinkText,
                onValueChange = viewModel::onOneTimeLinkChange,
                label = { Text(stringResource(R.string.field_one_time_link)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    oneTimeLink?.let {
                        viewModel.installComponents()
                        linkLauncher.launch(it)
                    }
                },
                enabled = oneTimeLink != null,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(text = stringResource(R.string.start_one_time_link_button))
            }
            result?.let { message: ResultMessage ->
                Text(text = stringResource(R.string.result_title), style = MaterialTheme.typography.titleMedium)
                Text(
                    text = stringResource(message.text, *message.args.toTypedArray()),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            Text(text = stringResource(R.string.event_log_title), style = MaterialTheme.typography.titleMedium)
            if (eventNames.isEmpty()) {
                Text(text = stringResource(R.string.event_log_empty), style = MaterialTheme.typography.bodyMedium)
            }
            eventNames.forEach { name ->
                Text(text = name, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** One of the screen's pickers: a title over chips that wrap, one of them selected. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun <T> Choice(title: String, options: List<T>, selected: T, label: @Composable (T) -> String, onSelect: (T) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(text = title, style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { option ->
                FilterChip(selected = option == selected, onClick = { onSelect(option) }, label = { Text(label(option)) })
            }
        }
    }
}

@StringRes
private fun appearanceLabel(appearance: Appearance): Int = when (appearance) {
    Appearance.SYSTEM -> R.string.appearance_system
    Appearance.LIGHT -> R.string.appearance_light
    Appearance.DARK -> R.string.appearance_dark
}

@StringRes
private fun sandboxOutcomeLabel(choice: SandboxOutcomeChoice): Int = when (choice) {
    SandboxOutcomeChoice.NONE -> R.string.sandbox_outcome_none
    SandboxOutcomeChoice.BOT -> R.string.sandbox_outcome_bot
    SandboxOutcomeChoice.HUMAN -> R.string.sandbox_outcome_human
}

// The preview draws the screen with a throwaway model; the activity gets its model from viewModel().
@Suppress("ViewModelConstructorInComposable")
@Preview(showBackground = true)
@Composable
private fun StartVerificationScreenPreview() {
    DemoTheme {
        StartVerificationScreen(viewModel = DemoViewModel(SavedStateHandle()))
    }
}

/** The demo's own theme (plan C190.7): the SDK's theme is internal, so a host styles its own screens. */
@Composable
private fun DemoTheme(content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme(), content = content)

