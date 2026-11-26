package dev.openverify.sdk.flow

import android.app.Application
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.i18n.CopyReview
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowSession
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * K10A-3 (Workflow 10A Stage 3 amendment 9): `flow.copy_key_ignored` says that a session's operator
 * copy holds a key the SDK does not place. One launch reads its session many times (after every
 * action, on every wait), so the code is logged once per launch, not once per read. What a launch
 * remembers is one flag in memory; no key and no id is logged.
 */
@RunWith(RobolectricTestRunner::class)
internal class CopyKeyIgnoredLogTest {

    private val application: Application = ApplicationProvider.getApplicationContext()
    private val ignoring: (FlowCopy?) -> CopyReview = { CopyReview(unsupported = emptyList(), ignored = listOf("synthetic.unplaced")) }

    @Before
    fun aDebuggableHost() {
        HostDebuggable.forget()
        application.applicationInfo.flags = application.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        HostDebuggable.read(application)
        ShadowLog.clear()
    }

    @After
    fun forgetTheFlag() {
        HostDebuggable.forget()
    }

    private fun logged(): List<String> = ShadowLog.getLogs().map { it.msg }.filter { it == CODE }

    /** [server]'s answers, each session carrying operator copy with a key the SDK does not place. */
    private class UnplacedCopyServer(val server: FakeFlowServer = FakeFlowServer()) : FlowApi by server {
        override suspend fun getSession(): FlowSession =
            server.getSession().copy(copy = FlowCopy(mapOf("en" to mapOf("synthetic.unplaced" to "Synthetic words"))))
    }

    @Test
    fun `two renders of one launch's session log the code once, and another launch logs it again`() = runTest {
        val session = FakeFlowServer().getSession()
        val launch = CopyNotes()

        ServerPosition.render(session, ignoring, launch)
        ServerPosition.render(session, ignoring, launch)
        val afterOneLaunch = logged()
        ServerPosition.render(session, ignoring, CopyNotes())

        assertEquals(listOf(CODE), afterOneLaunch)
        assertEquals(listOf(CODE, CODE), logged())
    }

    @Test
    fun `a coordinator that reads its session three times logs the code once`() = runTest {
        val api = UnplacedCopyServer()
        val coordinator = FlowCoordinator(api, INQUIRY_ID)

        coordinator.start()
        coordinator.start()
        coordinator.acceptConsent()

        assertEquals(true, api.server.calls.count { it == "getSession" } >= 3)
        assertEquals(listOf(CODE), logged())
    }

    @Test
    fun `a session whose copy is all placed logs nothing`() = runTest {
        val coordinator = FlowCoordinator(FakeFlowServer(), INQUIRY_ID)

        coordinator.start()

        assertEquals(emptyList<String>(), logged())
    }

    private companion object {
        const val CODE = "flow.copy_key_ignored"
    }
}
