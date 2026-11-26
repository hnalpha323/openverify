package dev.openverify.sdk

import android.content.Context
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.INQUIRY_ID
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.TOKEN
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ServerPosition
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_unsupported_server_message
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.ui.FakeCaptureCamera
import dev.openverify.sdk.ui.InquiryFlowScreen
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.screen.ScreenFormState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.jetbrains.compose.resources.getString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Workflow 10A integration-10a: the hooks the Stage 3 reports named as missing, each through the
 * real activity. android-screens' `LocalScreenEnvironment` had no provider, so in the app every
 * `screen` step rendered unsupported (C195): the activity now provides it from the session it last
 * read, the chosen language and the view model's screen drafts.
 */
@RunWith(RobolectricTestRunner::class)
class IntegrationHooksTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()
    private val contract = OpenVerifyInquiry.Contract()

    /** A loopback MockWebServer over plain http, which C190.2 allows only under the SDK's own test override. */
    @Before
    fun startServer() {
        LoopbackHttp.testOverride = true
        server.start()
    }

    @After
    fun stopServer() {
        LoopbackHttp.testOverride = null
        server.close()
    }

    /**
     * Phase 9's golden v2 session, positioned on its `extra_details` screen, with operator copy for
     * every component text (C162.2: component texts are always operator copy).
     */
    private fun screenSession(): MockResponse {
        val session = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session-v2.json")).jsonObject
        val english = mapOf(
            "extra_details.title.body" to "A few more details",
            "extra_details.nickname.label" to "Nickname",
            "extra_details.tax_number.label" to "Tax number",
            "extra_details.continue.button" to "Continue to the next step",
        ).mapValues { (_, text) -> JsonPrimitive(text) }
        val copy = JsonObject(mapOf("messages" to JsonObject(mapOf("en" to JsonObject(english)))))
        val body = JsonObject(session + mapOf("copy" to copy, "locales" to OpenVerifyJson.parseToJsonElement("""{"enabled":["en"],"default":"en"}""")))
        return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body.toString()).build()
    }

    @Test
    fun `the activity renders the screen step the session names, with its operator copy (C195, C162_2)`() {
        server.enqueue(screenSession())
        val intent = contract.createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString(), locale = "en"))

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(intent).use {
            compose.waitUntil(timeoutMillis = 10_000) {
                compose.onAllNodesWithText("A few more details").fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(timeoutMillis = 5_000) {
                compose.onAllNodesWithText("Continue to the next step").fetchSemanticsNodes().isNotEmpty()
            }
        }
    }
}

/** The dispatcher's half of android-driver's missing hook: the unsupported screen is told why. */
@RunWith(RobolectricTestRunner::class)
class IntegrationDispatchTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `a server before flow-spec 2 is said to be older than the app, through the dispatcher (C193_2)`() {
        rule.setContent {
            InquiryFlowScreen(FlowState.Unsupported(ServerPosition.SERVER_BEFORE_SPEC_2), FakeCaptureCamera(), RecordingActions())
        }

        rule.onNodeWithText(runBlocking { getString(Res.string.openverify_unsupported_server_message) }).assertExists()
    }
}

/** The view model keeps a screen's drafts in memory while the screen shows, and forgets them after (C195.5, C213.2). */
@OptIn(ExperimentalCoroutinesApi::class)
internal class IntegrationScreenDraftsTest {

    private val dispatcher = StandardTestDispatcher()

    @org.junit.jupiter.api.BeforeEach
    fun setMain() = Dispatchers.setMain(dispatcher)

    @org.junit.jupiter.api.AfterEach
    fun resetMain() = Dispatchers.resetMain()

    @org.junit.jupiter.api.Test
    fun `a screen's drafts are forgotten once the flow leaves the screen`() = runTest(dispatcher) {
        val screen = ScreenStep(
            "about_you",
            listOf(
                TextComponent("heading", "title", "about_you.heading.title"),
                ButtonComponent("go", "about_you.go.label", "submit"),
            ),
        )
        val email = EmailOtpStep("email")
        val api = FakeFlowServer(
            steps = listOf(screen, email) + FakeFlowApi.DEFAULT_FLOW.steps.takeLast(2),
            inquiryStatus = InquiryStatus.PENDING,
            consent = FlowConsent(FakeFlowApi.NOW),
        )
        val viewModel = InquiryViewModel(FlowCoordinator(api, FakeFlowApi.INQUIRY_ID), FakeFlowApi.INQUIRY_ID)
        advanceUntilIdle()
        viewModel.screenDrafts["about_you"] = ScreenFormState(emptyMap(), emptySet())
        val whileShown = viewModel.screenDrafts["about_you"]

        viewModel.submitScreen(emptyMap(), null)
        advanceUntilIdle()

        assertEquals(email, (viewModel.state.value as FlowState.Otp).step)
        assertNotNull(whileShown)
        assertNull(viewModel.screenDrafts["about_you"])
    }
}
