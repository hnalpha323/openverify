package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.2 (decision 37; review P07, V03), the final lists of Workflow 10C: captures, chip bytes, typed
 * values and tokens live in memory only.
 * - **Storage:** no main source of a shipped module writes a file, a preference, a cache or a
 *   database. The allowlist is empty.
 * - **Saved state:** `rememberSaveable`, `rememberTextFieldState`, a `Saver`, `SavedStateHandle`, the
 *   saved-state registry and `onSaveInstanceState` hold only the non-PII UI state named below, by file
 *   and declaration, each with its reason. An entry that no longer exists fails too.
 * - **Intents:** only the launch's credential extras, its locale and appearance, and the result's
 *   outcome (C190; "intents beyond today's credential extras").
 * - **The clipboard:** only the crypto step's message to sign, which the server wrote.
 * - **Backups:** no shipped manifest sets backup rules; the SDK stores nothing a backup could take.
 *
 * `SavedStateCanaryTest` types a canary into every field and reads the saved `Bundle`s.
 */
internal class DataAtRestScanTest {

    @Test
    fun `no main source writes a file, a preference, a cache or a database`() {
        val found = SourceScan.sources.flatMap { (path, text) ->
            SourceScan.codeLines(text).flatMap { (number, line) ->
                STORAGE.filter { it.containsMatchIn(line) }.map { "$path:$number: ${it.pattern}" }
            }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `saved state holds only the allowlisted non-PII UI state`() {
        val saved = SourceScan.sources.flatMap { (path, text) ->
            SourceScan.codeLines(text).filter { (_, line) -> SAVED_STATE.any { it.containsMatchIn(line) } }.map { (number, line) ->
                val name = DECLARED.find(line)?.groupValues?.get(1)
                SavedState(path, name ?: "line $number: ${line.trim()}")
            }
        }.toSet()

        assertEquals(ALLOWED.keys.sortedBy { it.toString() }, saved.sortedBy { it.toString() })
    }

    @Test
    fun `intents carry only the launch's extras and the result's outcome`() {
        val extras = SourceScan.sources.flatMap { (path, text) ->
            (SourceScan.calls(text, INTENT_WRITES) + SourceScan.methodCalls(text, INTENT_WRITES)).map { call ->
                "${path.substringAfterLast('/')}: ${call.name}(${call.arguments.substringBefore(',').trim()})"
            }
        }

        assertEquals(INTENT_EXTRAS.keys.sorted(), extras.distinct().sorted())
    }

    @Test
    fun `only the crypto step's message reaches the clipboard`() {
        val writers = SourceScan.sources.filter { (_, text) -> CLIPBOARD.containsMatchIn(text) }.map { it.first }
        val callers = SourceScan.sources.filter { (_, text) -> SourceScan.calls(text, "rememberTextCopier").isNotEmpty() }.map { it.first }

        assertEquals(listOf("src/androidMain/kotlin/dev/openverify/sdk/ui/TextCopier.android.kt"), writers)
        // The copier's one caller: the server's message to sign, never a typed value (`CryptoWalletStep.kt`).
        assertEquals(listOf("src/commonMain/kotlin/dev/openverify/sdk/ui/steps/CryptoWalletStep.kt"), callers)
    }

    @Test
    fun `no shipped manifest sets backup rules, shared user ids or exported components`() {
        SdkModule.SHIPPED.forEach { module ->
            val manifest = declared(File(module.manifest).readText())

            MANIFEST_REFUSED.forEach { attribute -> assertFalse(attribute in manifest, "${module.name}: $attribute") }
        }
    }

    /**
     * Workflow 10E (C205.2): openverify-face's manifest holds a marker that removes ONNX Runtime's
     * telemetry provider from a host's merged manifest. A removal declares nothing, so it is left out
     * of what the scan above reads; a provider that is declared is still refused.
     */
    @Test
    fun `a marker that removes a library's provider declares nothing, and a declared provider is still read`() {
        val removal = """<provider
            android:name="ai.onnxruntime.TelemetryInitializer"
            tools:node="remove" />"""

        assertFalse("<provider" in declared("<application>$removal</application>"))
        assertTrue("<provider" in declared("""<application><provider android:name="a.B" android:authorities="c" /></application>"""))
        assertTrue("<provider" in declared("""<application><provider android:name="a.B" tools:node="merge" /></application>"""))
    }

    /** [manifest] without the markers that only remove a library's provider. */
    private fun declared(manifest: String): String = manifest.replace(PROVIDER_REMOVAL, "")

    private data class SavedState(val path: String, val name: String)

    private companion object {
        val STORAGE = listOf(
            "SharedPreferences", "getSharedPreferences", "PreferenceManager", "DataStore", "openFileOutput", "FileOutputStream",
            "FileWriter", "RandomAccessFile", "\\.writeText\\(", "\\.writeBytes\\(", "\\.appendText\\(", "\\.appendBytes\\(",
            "\\bcacheDir\\b", "\\bfilesDir\\b", "externalCacheDir", "getExternalFilesDir", "createTempFile", "MediaStore",
            "SQLiteDatabase", "openOrCreateDatabase", "androidx\\.room", "NSUserDefaults", "NSFileManager", "SystemFileSystem",
            // Final list (10C): the other ways to a file, a keystore entry or a persisted grant.
            "\\bnoBackupFilesDir\\b", "\\bcodeCacheDir\\b", "\\bobbDir\\b", "getDir\\(", "getDatabasePath", "\\.outputStream\\(", "\\.bufferedWriter\\(",
            "\\.printWriter\\(", "Files\\.(write|newOutputStream|newBufferedWriter|copy|createTemp)", "ObjectOutputStream", "FileChannel",
            "AccountManager", "takePersistableUriPermission", "openOutputStream", "DocumentsContract\\.createDocument",
            "NSKeyedArchiver", "writeToFile", "writeToURL", "kSecClass", "okio\\.FileSystem", "kotlinx\\.io\\.files",
        ).map(::Regex)

        val SAVED_STATE = listOf(
            "\\brememberSaveable\\b", "\\brememberTextFieldState\\b", "\\bSavedStateHandle\\b", "\\bonSaveInstanceState\\b",
            // Final list (10C): the savers and registries the calls above are built from.
            "\\b(listSaver|mapSaver|autoSaver)\\b", "\\bSaver\\s*[<(]", "\\brememberSaveableStateHolder\\b", "\\bSaveableStateRegistry\\b",
            "\\b[sS]avedStateRegistry\\b", "\\bcreateSavedStateHandle\\b", "\\brememberSerializable\\b", "\\bonRetainNonConfigurationInstance\\b",
            "\\bNSUserActivity\\b", "\\bencodeRestorableState\\b",
        ).map(::Regex)

        val DECLARED = Regex("""\b(?:val|var)\s+(\w+)""")

        private const val CONSENT = "src/commonMain/kotlin/dev/openverify/sdk/ui/ConsentScreen.kt"

        /** The saved state of Workflow 10C, all of it non-PII UI state (C213.2; review V03), each with its reason. */
        val ALLOWED: Map<SavedState, String> = mapOf(
            SavedState(CONSENT, "agreed") to "whether the required agreement is ticked: a flag, sent only when the person presses agree",
            SavedState(CONSENT, "ticked") to "which optional consents are ticked: their text keys (consent.*), never a text or a value",
            SavedState(CONSENT, "TICKED_SAVER") to "how `ticked` is saved: the set of text keys as a list",
            SavedState("src/androidMain/kotlin/dev/openverify/sdk/ui/CameraPermission.android.kt", "deniedState") to
                "whether the camera permission was denied, so the rationale survives a rotation",
        )

        /** Each intent write, by file and first argument, with what it carries. */
        val INTENT_EXTRAS: Map<String, String> = mapOf(
            "OpenVerifyInquiry.kt: putExtra(InquiryResults.EXTRA_INQUIRY_ID)" to "the launch: the inquiry's id, the host's own value",
            "OpenVerifyInquiry.kt: putExtra(InquiryResults.EXTRA_SESSION_TOKEN)" to "the launch: today's credential extra, to the SDK's unexported activity",
            "OpenVerifyInquiry.kt: putExtra(InquiryResults.EXTRA_ONE_TIME_TOKEN)" to "the launch: today's credential extra, to the SDK's unexported activity",
            "OpenVerifyInquiry.kt: putExtra(InquiryResults.EXTRA_API_BASE_URL)" to "the launch: the host's API address",
            "InquiryResults.kt: putExtra(EXTRA_LOCALE)" to "the launch: the host's locale (C190.3)",
            "InquiryResults.kt: putExtra(EXTRA_APPEARANCE)" to "the launch: light, dark or system (C190.3)",
            "InquiryResults.kt: putExtra(EXTRA_INQUIRY_ID)" to "the result: the inquiry's id",
            "InquiryResults.kt: putExtra(EXTRA_RESULT)" to "the result: completed, failed or canceled",
            "InquiryResults.kt: putExtra(EXTRA_INQUIRY_STATUS)" to "the result: the inquiry's status, a closed list",
            "InquiryResults.kt: putExtra(EXTRA_FAILURE_REASON)" to "the result: the failure reason's name, a closed list (C190.6)",
        )

        const val INTENT_WRITES = "putExtra|putExtras|putParcelableArrayListExtra|putStringArrayListExtra|setClipData|setData|setDataAndType"

        val CLIPBOARD = Regex("""ClipboardManager|setPrimaryClip|ClipData\.|UIPasteboard|LocalClipboard|ClipEntry""")

        /** A `<provider>` element whose only instruction is to remove a library's provider of that name. */
        val PROVIDER_REMOVAL = Regex("""<provider\b[^<>]*\btools:node="remove"[^<>]*/>""")

        /** What a shipped manifest never declares: backup rules of its own, or a way in for another app. */
        val MANIFEST_REFUSED = listOf(
            "android:allowBackup", "android:fullBackupContent", "android:dataExtractionRules", "android:backupAgent", "android:sharedUserId",
            "android:exported=\"true\"", "<provider", "<receiver", "<service", "android:usesCleartextTraffic", "android:networkSecurityConfig",
            "android:debuggable",
        )
    }
}
