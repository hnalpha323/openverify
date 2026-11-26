package dev.openverify.demo.readercheck

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import dev.openverify.demo.R
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.mrz.BacKeySeed
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * The demo's reader check (C209.6; decision 48): one screen, in debug builds with the NFC module
 * only, on which the owner reads a real passport or identity card with the installed chip reader and
 * sees pass or fail per protocol and file.
 *
 * It starts no flow and calls no server. The key the person types lives in this screen's memory only
 * (not in saved state, so a rotation clears it), the window is kept out of screenshots, the read
 * stops when the screen is left, and what the reader returned is overwritten by [ReaderCheck] before
 * anything is shown. Nothing is written or logged.
 */
@OptIn(ExperimentalOpenVerifyApi::class)
class ReaderCheckActivity : ComponentActivity() {
    private var useCan by mutableStateOf(false)
    private var documentNumber by mutableStateOf("")
    private var birthDate by mutableStateOf("")
    private var expiryDate by mutableStateOf("")
    private var can by mutableStateOf("")
    private var status by mutableStateOf<Status>(Status.Idle)
    private var reading: Job? = null

    /** What the screen shows under the button. */
    private sealed interface Status {
        data object Idle : Status
        data object NoReader : Status
        data object KeyInvalid : Status
        data class Reading(val phase: String) : Status
        data object Stopped : Status
        data class Done(val report: ReaderCheckReport) : Status
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The typed key is the owner's own document's: keep the screen out of screenshots and the recents view.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { Screen() } } }
    }

    override fun onPause() {
        // The reader is on only while this screen is resumed: leaving it stops the read.
        stop()
        super.onPause()
    }

    private fun access(): ChipAccess? =
        if (useCan) {
            can.trim().takeIf { Regex("[0-9]{6}").matches(it) }?.let { ChipAccess.Can(it) }
        } else {
            try {
                ChipAccess.Mrz(BacKeySeed(documentNumber.trim().uppercase(), birthDate.trim(), expiryDate.trim()))
            } catch (_: IllegalArgumentException) {
                null
            }
        }

    private fun start() {
        val reader = OpenVerifyAndroid.installed().chipReader
        val access = access()
        when {
            reader == null -> status = Status.NoReader
            access == null -> status = Status.KeyInvalid
            else -> {
                status = Status.Reading("waiting")
                reading = lifecycleScope.launch {
                    val report = ReaderCheck.run(reader, access) { phase -> status = Status.Reading(phase) }
                    status = Status.Done(report)
                    reading = null
                }
            }
        }
    }

    private fun stop() {
        val job = reading ?: return
        reading = null
        job.cancel()
        status = Status.Stopped
    }

    @Composable
    private fun Screen() {
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.reader_check_title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.reader_check_intro))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !useCan, onClick = { useCan = false }, label = { Text(stringResource(R.string.reader_check_key_mrz)) }, modifier = Modifier.testTag("reader-check-key-mrz"))
                FilterChip(selected = useCan, onClick = { useCan = true }, label = { Text(stringResource(R.string.reader_check_key_can)) }, modifier = Modifier.testTag("reader-check-key-can"))
            }
            if (useCan) {
                Field("reader-check-can", R.string.reader_check_can, can, KeyboardType.Number) { can = it }
            } else {
                Field("reader-check-document-number", R.string.reader_check_document_number, documentNumber, KeyboardType.Ascii) { documentNumber = it }
                Field("reader-check-birth-date", R.string.reader_check_birth_date, birthDate, KeyboardType.Number) { birthDate = it }
                Field("reader-check-expiry-date", R.string.reader_check_expiry_date, expiryDate, KeyboardType.Number) { expiryDate = it }
            }
            val current = status
            if (current is Status.Reading) {
                Button(onClick = ::stop, modifier = Modifier.testTag("reader-check-stop")) { Text(stringResource(R.string.reader_check_stop)) }
            } else {
                Button(onClick = ::start, modifier = Modifier.testTag("reader-check-read")) { Text(stringResource(R.string.reader_check_read)) }
            }
            when (current) {
                Status.Idle -> Unit
                Status.NoReader -> Line("reader-check-status", stringResource(R.string.reader_check_no_reader))
                Status.KeyInvalid -> Line("reader-check-status", stringResource(R.string.reader_check_key_invalid))
                is Status.Reading -> Line("reader-check-status", stringResource(R.string.reader_check_phase, current.phase))
                Status.Stopped -> Line("reader-check-status", stringResource(R.string.reader_check_stopped))
                is Status.Done -> Report(current.report)
            }
        }
    }

    @Composable
    private fun Field(tag: String, label: Int, value: String, keyboard: KeyboardType, onChange: (String) -> Unit) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text(stringResource(label)) },
            singleLine = true,
            // No suggestions and no learning: the keyboard keeps nothing of the key either.
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag(tag),
        )
    }

    @Composable
    private fun Line(tag: String, text: String) {
        Text(text, modifier = Modifier.testTag(tag))
    }

    @Composable
    private fun Report(report: ReaderCheckReport) {
        val failure = report.failure
        Line("reader-check-status", if (failure == null) stringResource(R.string.reader_check_done) else stringResource(R.string.reader_check_failed, failure))
        if (report.protocols.isNotEmpty()) {
            Text(stringResource(R.string.reader_check_protocols), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            report.protocols.forEach { Outcome("reader-check-protocol-${it.name}", it) }
        }
        if (report.files.isNotEmpty()) {
            Text(stringResource(R.string.reader_check_files), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            report.files.forEach { Outcome("reader-check-file-${it.name}", it) }
        }
    }

    @Composable
    private fun Outcome(tag: String, line: CheckLine) {
        val outcome = when (line.outcome) {
            CheckOutcome.PASS -> stringResource(R.string.reader_check_pass)
            CheckOutcome.FAIL -> stringResource(R.string.reader_check_fail)
            CheckOutcome.NOT_ATTEMPTED -> stringResource(R.string.reader_check_not_attempted)
        }
        Line(tag, "${line.name}: $outcome")
    }
}
