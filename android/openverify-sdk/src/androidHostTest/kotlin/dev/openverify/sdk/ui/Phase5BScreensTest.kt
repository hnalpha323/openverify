package dev.openverify.sdk.ui

import android.Manifest
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.InputField
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.GraphicsMode

/**
 * C64.2: the Workflow 5B screens in the flow screen: the document step, the business registry and
 * website forms, and the camera of a document, which shows its own copy and a page-shaped frame
 * and goes back to the document step.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Phase5BScreensTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val camera = FakeCaptureCamera()
    private val documentStep = DocumentStep("proof", listOf(DocumentClass.UTILITY_BILL), listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA))

    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args) }

    @Before
    fun grantCamera() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(Manifest.permission.CAMERA)
    }

    @Test
    fun `the document, business registry and website steps each get their own screen`() {
        var state: FlowState by mutableStateOf(
            FlowState.Document(documentStep, documentStep.documentTypes, 90, 50, DocumentFile.MIME_TYPES, upload = true, camera = true),
        )
        rule.setContent { InquiryFlowScreen(state, camera, actions) }

        rule.onNodeWithText(text(Res.string.openverify_document_title)).assertExists()
        state = FlowState.Form(DatabaseBusinessStep("business"), listOf(InputField.BUSINESS_NAME), setOf(InputField.BUSINESS_NAME))
        rule.onNodeWithText(text(Res.string.openverify_business_title)).assertExists()
        state = FlowState.Form(BusinessWebsiteStep("website"), listOf(InputField.WEBSITE_URL), setOf(InputField.WEBSITE_URL))
        rule.onNodeWithText(text(Res.string.openverify_website_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertDoesNotExist()
    }

    @Test
    fun `a document's camera shows its own copy and a page-shaped frame, and goes back to the document step`() {
        rule.setContent { InquiryFlowScreen(FlowState.Capture(documentStep, FileKind.DOCUMENT, 0, 1), camera, actions) }

        rule.onNodeWithText(text(Res.string.openverify_document_capture_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_capture_instruction)).assertExists()
        rule.onNodeWithTag(TestTags.PAGE_GUIDE).assertExists()
        rule.onNodeWithTag(TestTags.DOCUMENT_GUIDE).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_document_capture_back)).performClick()

        assertEquals(listOf("backToDocument"), actions.calls)
    }

    @Test
    fun `an ID side's camera keeps its card frame and offers no way back to a document`() {
        rule.setContent {
            InquiryFlowScreen(FlowState.Capture(dev.openverify.sdk.flow.FakeFlowApi.DEFAULT_FLOW.steps[1], FileKind.FRONT, 0, 2), camera, actions)
        }

        rule.onNodeWithTag(TestTags.DOCUMENT_GUIDE).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_capture_back)).assertDoesNotExist()
    }
}
