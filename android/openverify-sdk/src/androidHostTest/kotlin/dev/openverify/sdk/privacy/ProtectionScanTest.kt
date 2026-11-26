package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.1 (decision 70; review P08, V03), the cross-cutting scan: every typed-value field in the SDK's
 * sources is accessibility-data-sensitive (`typedValueProtection()`), and every control is in the
 * table below, either carrying `submitProtection()` (a consent, capture or submit control) or left
 * without it for a stated reason. The protections are built and tested by the owners of their files
 * (`ScreenProtectionsTest`, `ConsentProtectionsTest`, `VerificationStepFieldsTest`,
 * `CaptureScreenSlotsTest`); this scan fails when a field or control is added without one, or without
 * a line here. `OverlayWindowsTest` and `WindowChecksTest` hold the activity's part (API 31+).
 */
internal class ProtectionScanTest {

    private val scanned = SourceScan.sources.filterNot { (path, _) -> PrivacyScreens.pending(path) }

    @Test
    fun `every text field marks its value accessibility-data-sensitive`() {
        val fields = scanned.flatMap { (path, text) -> ProtectionScan.fields(path, text) }

        assertEquals(emptyList<String>(), fields.filterNot { it.protected }.map { "${it.path}:${it.line}: ${it.field}" })
        assertEquals(FIELDS, fields.groupingBy { it.path.substringAfterLast('/') }.eachCount().toSortedMap())
    }

    @Test
    fun `a shown value that is personal data is marked too, and each such place is named`() {
        val marked = scanned.filterNot { (path, _) -> path.endsWith("ui/screen/Protections.kt") }.associate { (path, text) ->
            path.substringAfterLast('/') to Regex("""\.typedValueProtection\(\)""").findAll(text).count() - ProtectionScan.fields(path, text).count { "typedValueProtection()" in sourceOf(text, it) }
        }.filterValues { it != 0 }

        assertEquals(SHOWN_VALUES.mapValues { it.value.first }, marked)
    }

    /** The arguments of the field's own call, to tell a mark it carries from one beside it. */
    private fun sourceOf(text: String, field: FieldSite): String =
        SourceScan.calls(text, ProtectionScan.FIELDS).first { it.line == field.line }.arguments

    @Test
    fun `every control is in the table, with the protection the table names`() {
        val found = scanned.associate { (path, text) -> path.removePrefix(ROOT) to ProtectionScan.controls(path, text) }.filterValues { it.isNotEmpty() }
        val asFound = found.mapValues { (_, sites) -> sites.map { "${it.control} ${it.action} -> ${if (it.protected) "protected" else "unprotected"}" } }
        val asTable = CONTROLS.mapValues { (_, controls) -> controls.map { "${it.control} ${it.action} -> ${if (it.reason == PROTECTED) "protected" else "unprotected"}" } }

        assertEquals(render(asTable), render(asFound))
    }

    @Test
    fun `every unprotected control has its reason, and the protected ones are consent, capture and submit`() {
        val reasons = CONTROLS.values.flatten().map { it.reason }.toSet()

        assertEquals(setOf(PROTECTED, LEAVES, OPENS, LOCAL, ASKS_AGAIN, SHOWN_ONLY, BY_DECISION_10B), reasons)
        // Workflow 11A (clients-connect): 27, and the share-consent tick, accept, decline and withdrawal.
        assertEquals(31, CONTROLS.values.flatten().count { it.reason == PROTECTED })
    }

    @Test
    fun `the screen step's fields carry the protection through fieldSemantics`() {
        val components = scanned.single { (path, _) -> path.endsWith("ui/screen/ScreenComponents.kt") }.second
        val wrapper = components.substringAfter("private fun Modifier.fieldSemantics(").substringBefore("@Composable")

        assertTrue(".typedValueProtection()" in wrapper, wrapper)
    }

    @Test
    fun `the protections are chosen by API level in one place`() {
        val protections = File("src/commonMain/kotlin/dev/openverify/sdk/ui/screen/Protections.kt").readText()

        assertTrue("fun filtersObscuredTouches(apiLevel: Int): Boolean = apiLevel in 26..30" in protections)
        assertTrue("fun marksDataSensitive(apiLevel: Int): Boolean = apiLevel >= 34" in protections)
        assertTrue("semantics { isSensitiveData = true }" in protections)
        assertTrue(".dropObscuredTouches()" in protections)
    }

    @Test
    fun `the activity hides overlays when it resumes and shows them again when it pauses`() {
        val activity = SourceScan.code(File("src/androidMain/kotlin/dev/openverify/sdk/OpenVerifyInquiryActivity.kt").readText())
        val resume = activity.substringAfter("override fun onResume()").substringBefore("override fun")
        val pause = activity.substringAfter("override fun onPause()").substringBefore("private fun")

        assertTrue("OverlayWindows.apply(window, hide = true)" in resume, resume)
        assertTrue("OverlayWindows.apply(window, hide = false)" in pause, pause)
        assertTrue("window.setHideOverlayWindows(hide)" in activity)
        assertTrue("const val FIRST_API_LEVEL: Int = 31" in activity)
    }

    @Test
    fun `the scan reads a control's handler and its protection, direct, by a named modifier and around a modifier`() {
        val text = """
            fun Screen() {
                val shutter = Modifier
                    .fillMaxWidth()
                    .submitProtection()
                Button(onClick = takePhoto, enabled = !busy, modifier = shutter) { Text("a") }
                Button(onClick = { send(value, "x,y") }, modifier = Modifier.submitProtection()) { Text("b") }
                TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) { Text("c") }
                Row(modifier = Modifier.submitProtection().toggleable(value = on, onValueChange = onChange)) { }
                Box(Modifier.clickable(role = Role.Button) { open = true })
                OutlinedTextField(value = a, onValueChange = { a = it }, modifier = Modifier.typedValueProtection())
                OutlinedTextField(value = b, onValueChange = { b = it })
            }
        """.trimIndent()

        assertEquals(
            listOf(
                "Button takePhoto true",
                "Button { send(value, \"x,y\") } true",
                "TextButton actions::cancel false",
                ".toggleable onChange true",
                ".clickable { open = true } false",
            ),
            ProtectionScan.controls("x", text).map { "${it.control} ${it.action} ${it.protected}" },
        )
        assertEquals(listOf(true, false), ProtectionScan.fields("x", text).map { it.protected })
    }

    private fun render(table: Map<String, List<String>>): String =
        table.toSortedMap().entries.joinToString("\n") { (path, controls) -> "$path\n" + controls.joinToString("\n") { "    $it" } }

    private data class Control(val control: String, val action: String, val reason: String)

    private companion object {
        const val ROOT = "src/commonMain/kotlin/dev/openverify/sdk/"

        /** Sends the person's consent, capture or values, or ends the inquiry: drops obscured touches on API 26 to 30. */
        const val PROTECTED = "consent, capture or submit (C213.1)"

        /** Cancel, back, close, done, change the details, stop the read, continue after the limit: leaves the screen, and sends none of the person's data. */
        const val LEAVES = "leaves or closes; sends none of the person's data"

        /** Opens a picker, a menu, a link, the settings or another screen: nothing is sent until a protected control. */
        const val OPENS = "opens a picker, a menu, a link or another screen; nothing is sent until a protected control"

        /** Acts on the device only (a choice, a menu item, a copy, a row added or removed): what it changes is sent by a protected control, or never. */
        const val LOCAL = "acts on the screen only; what it changes is sent by a protected control, or never"

        /** Asks again for what the person already asked for (a code, another try, more time, another look at the phone's NFC): no new value and no decision. */
        const val ASKS_AGAIN = "asks again (resend, retry, more time, recheck); sends no new value"

        /** No handler of its own: the row around it is the control. */
        const val SHOWN_ONLY = "shown only: the row around it is the control"

        /** Workflow 10B Stage 2, capture-pipeline 5: retake, back and cancel on the capture screen stay unprotected. */
        const val BY_DECISION_10B = "unprotected by decision (Workflow 10B Stage 2, capture-pipeline 5)"

        /** The text fields per file: a count that changes is a field added or removed. */
        val FIELDS: Map<String, Int> = sortedMapOf("CryptoWalletStep.kt" to 3, "InputForm.kt" to 2, "NfcStepScreen.kt" to 1, "OtpStep.kt" to 2, "ScreenComponents.kt" to 1)

        /**
         * Marks that are not on a text field's own call, per file, with what they are on: the screen
         * step's `fieldSemantics` wrapper (every field of `ScreenComponents.kt` goes through it), and the
         * card of the DG1 review, which shows what the chip holds (C213.1; nfc-sdk).
         */
        val SHOWN_VALUES: Map<String, Pair<Int, String>> = mapOf(
            "ScreenComponents.kt" to (1 to "Modifier.fieldSemantics, the screen step's fields' shared modifier"),
            "NfcStepScreen.kt" to (1 to "the DG1 review's card: name, document number, nationality and dates as the chip holds them"),
        )

        /** Every control of the SDK's screens, per file in source order. */
        val CONTROLS: Map<String, List<Control>> = mapOf(
            "capture/selfie/Extension.kt" to listOf(
                Control("Button", "onExtend", ASKS_AGAIN),
            ),
            "ui/CameraPermissionGate.kt" to listOf(
                Control("Button", "permission::request", OPENS),
                Control("OutlinedButton", "permission::openSettings", OPENS),
                Control("TextButton", "onCancel", LEAVES),
            ),
            "ui/CaptureScreen.kt" to listOf(
                Control("Button", "takePhoto", PROTECTED),
                Control("OutlinedButton", "takePhoto", PROTECTED),
                Control("OutlinedButton", "pickPhoto", PROTECTED),
                Control("TextButton", "onBack", BY_DECISION_10B),
                Control("TextButton", "onCancel", BY_DECISION_10B),
                Control("OutlinedButton", "onRetake", BY_DECISION_10B),
                Control("Button", "onConfirm", PROTECTED),
            ),
            "ui/ConsentScreen.kt" to listOf(
                Control("Button", "{ onAccept(ticked intersect optional.map { it.key }.toSet(), locale) }", PROTECTED),
                Control("TextButton", "onCancel", LEAVES),
                Control(".toggleable", "onChange", PROTECTED),
                Control("Checkbox", "null", SHOWN_ONLY),
            ),
            "ui/FailureScreen.kt" to listOf(
                Control("Button", "onDone", LEAVES),
                Control("OutlinedButton", "{ uriHandler.openUri(link) }", OPENS),
            ),
            "ui/StatusScreens.kt" to listOf(
                Control("Button", "onDone", LEAVES),
                Control("Button", "onClose", LEAVES),
                Control("Button", "onClose", LEAVES),
                Control("Button", "onClose", LEAVES),
                Control("Button", "onClose", LEAVES),
                Control("Button", "onRetry", ASKS_AGAIN),
                Control("OutlinedButton", "onClose", LEAVES),
                Control("Button", "onClose", LEAVES),
                Control("OutlinedButton", "onCancel", LEAVES),
                Control("Button", "onClose", LEAVES),
            ),
            "ui/help/HelpSlot.kt" to listOf(
                Control("TextButton", "{ try { uriHandler.openUri(link.url) } catch (failure: Exception) { SdkL", OPENS),
            ),
            "ui/help/LanguageSelector.kt" to listOf(
                Control(".clickable", "{ open = true }", OPENS),
                Control("DropdownMenuItem", "{ selection.selected = language open = false }", LOCAL),
            ),
            "ui/screen/ScreenComponents.kt" to listOf(
                Control("Button", "{ scope.submit(component.port) }", PROTECTED),
                Control("OutlinedButton", "scope.cancel", OPENS),
                Control("TextButton", "{ if (isHttpsLink(url)) uriHandler.openUri(url) else SdkLog.log(\"screen.", OPENS),
                Control(".toggleable", "{ on -> state.onChange(ScreenValue.Texts(if (on) chosen + option.value e", LOCAL),
                Control("Checkbox", "null", SHOWN_ONLY),
                Control(".selectable", "{ state.onChange(ScreenValue.Text(option.value)) }", LOCAL),
                Control("RadioButton", "null", SHOWN_ONLY),
                Control(".toggleable", "{ state.onChange(ScreenValue.Bool(it)) }", LOCAL),
                Control("Checkbox", "null", SHOWN_ONLY),
                Control("TextButton", "{ picking = true }", OPENS),
                Control("TextButton", "{ picker.selectedDateMillis?.let { state.onChange(ScreenValue.Text(isoDa", LOCAL),
                Control("TextButton", "{ picking = false }", LEAVES),
            ),
            "ui/screen/ScreenRenderer.kt" to listOf(
                Control("Button", "onConfirm", PROTECTED),
                Control("OutlinedButton", "onKeep", LEAVES),
            ),
            "ui/steps/CryptoWalletStep.kt" to listOf(
                Control("Button", "{ if (chain != null) actions.createCryptoChallenge(chain, address) }", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
                Control("OutlinedButton", "{ copy(challenge.message) copied = true }", LOCAL),
                Control("OutlinedButton", "{ actions.renewCryptoChallenge(drafts[addressKey]) }", PROTECTED),
                Control("Button", "{ actions.submitCryptoSignature(signature, drafts[signedMessageKey].take", PROTECTED),
                Control("TextButton", "actions::changeCryptoWallet", LEAVES),
            ),
            "ui/steps/DocumentStep.kt" to listOf(
                Control("Button", "chooseFile", PROTECTED),
                Control("OutlinedButton", "actions::takeDocumentPhoto", PROTECTED),
                Control("Button", "actions::takeDocumentPhoto", PROTECTED),
                Control("Button", "actions::submitDocument", PROTECTED),
                Control("OutlinedButton", "chooseFile ?: actions::discardDocument", OPENS),
                Control("TextButton", "actions::cancel", LEAVES),
            ),
            "ui/steps/InputForm.kt" to listOf(
                Control("Button", "{ actions.submitInputs(state.fields.associateWith { drafts[key(it)] }, i", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
                Control("TextButton", "{ persons.remove(index) }", LOCAL),
                Control("OutlinedButton", "persons::add", LOCAL),
            ),
            "ui/steps/NfcStepScreen.kt" to listOf(
                Control("Button", "{ actions.nfc(NfcEvent.MrzEntered(number, birth, expiry)) }", PROTECTED),
                Control("Button", "{ actions.nfc(NfcEvent.CanEntered(can)) }", PROTECTED),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.ChooseAccess(other)) }", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
                Control("Button", "{ actions.nfc(NfcEvent.Ready()) }", PROTECTED),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.ChooseAccess(NfcAccessKind.MRZ)) }", LEAVES),
                Control("TextButton", "actions::cancel", LEAVES),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.StopRead) }", LEAVES),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.Ready(scenario)) }", PROTECTED),
                Control("Button", "{ actions.nfc(NfcEvent.ReviewConfirmed) }", PROTECTED),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.ReviewRefused) if (view.again) actions.cancel() }", PROTECTED),
                Control("Button", "{ actions.nfc(NfcEvent.TryAgain) }", ASKS_AGAIN),
                Control("OutlinedButton", "actions::cancel", LEAVES),
                Control("Button", "{ actions.nfc(NfcEvent.OpenNfcSettings) }", OPENS),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.Recheck) }", ASKS_AGAIN),
                Control("OutlinedButton", "{ actions.nfc(NfcEvent.UseAnotherWay) }", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
            ),
            // C238.7, C237.6 (Workflow 11A, clients-connect): the share-consent choice and the withdrawal.
            "ui/steps/ShareConsentStep.kt" to listOf(
                Control(".toggleable", "{ ticked = it }", PROTECTED),
                Control("Checkbox", "null", SHOWN_ONLY),
                Control("Button", "{ actions.acceptShareConsent(ticked) }", PROTECTED),
                Control("OutlinedButton", "actions::declineShareConsent", PROTECTED),
                Control("OutlinedButton", "{ onWithdraw(entry.stepId) }", PROTECTED),
            ),
            "ui/steps/OtpStep.kt" to listOf(
                Control("Button", "{ if (phone) { drafts[codeKey(state)] = \"\" actions.sendOtp(OtpDestinatio", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
                Control("Button", "{ actions.confirmOtp(typed) }", PROTECTED),
                Control("OutlinedButton", "{ resend(drafts, codeKey, actions) }", ASKS_AGAIN),
                Control("OutlinedButton", "{ resend(drafts, codeKey, actions) }", ASKS_AGAIN),
                Control("TextButton", "actions::changeOtpDestination", LEAVES),
                Control("Button", "actions::continueAfterLimit", PROTECTED),
                Control("TextButton", "actions::cancel", LEAVES),
            ),
            "ui/steps/StepParts.kt" to listOf(
                Control("OutlinedButton", "{ open = true }", OPENS),
                Control("DropdownMenuItem", "{ onSelect(value) open = false }", LOCAL),
            ),
        )
    }
}
