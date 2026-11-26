package dev.openverify.demo

import android.content.Intent
import android.net.Uri
import dev.openverify.sdk.Appearance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C218.2 (decisions 53 and 65; review P03): a tapped link is opened only when its host is the host
 * compiled into the app, and always against the compiled-in API, never the link's origin.
 */
@RunWith(RobolectricTestRunner::class)
class AppLinksTest {

    private fun link(origin: String) = "$origin/#inquiry-id=${DemoFormTest.INQUIRY_ID}&one-time-token=$ONE_TIME_TOKEN"

    @Test
    fun `a one-time link on the compiled-in host is opened against the compiled-in API`() {
        val opened = AppLinks.oneTimeLinkOrNull(link("https://verify.example.com"))

        assertNotNull(opened)
        assertEquals(DemoFormTest.INQUIRY_ID, opened!!.inquiryId)
        assertEquals("https://verify.example.com", opened.apiBaseUrl)
        assertEquals(AppLinks.API_BASE_URL, opened.apiBaseUrl)
    }

    @Test
    fun `the API is the compiled-in one whatever the flow domain is`() {
        val opened = AppLinks.oneTimeLinkOrNull(link("https://flow.example.org"), host = "flow.example.org", apiBaseUrl = "https://api.example.net")

        assertEquals("https://api.example.net", opened?.apiBaseUrl)
    }

    @Test
    fun `the host is compared without regard to case`() {
        assertNotNull(AppLinks.oneTimeLinkOrNull(link("https://VERIFY.Example.COM")))
    }

    @Test
    fun `the pickers' choices ride on the link's launch`() {
        val opened = AppLinks.oneTimeLinkOrNull(link("https://verify.example.com"), LaunchOptions(LocaleChoice.AR, Appearance.DARK))

        assertEquals("ar", opened?.locale)
        assertEquals(Appearance.DARK, opened?.appearance)
    }

    @Test
    fun `a link on any other host is refused`() {
        listOf(
            "https://evil.example",
            "https://verify.example.com.evil.example",
            "https://evilverify.example.com",
            "https://sub.verify.example.com",
            "https://verify.example.com.",
            "https://verify.example.com@evil.example",
            "https://evil.example/verify.example.com",
            "https://evil.example?verify.example.com",
        ).forEach { origin ->
            assertNull(origin, AppLinks.oneTimeLinkOrNull(link(origin)))
        }
    }

    @Test
    fun `a link that is not plain https on the default port, or names a user, is refused`() {
        listOf(
            "http://verify.example.com",
            "https://verify.example.com:8443",
            "https://user@verify.example.com",
            "https://user:secret@verify.example.com",
            "intent://verify.example.com",
        ).forEach { origin ->
            assertNull(origin, AppLinks.oneTimeLinkOrNull(link(origin)))
        }
    }

    @Test
    fun `the default https port may be written out`() {
        assertNotNull(AppLinks.oneTimeLinkOrNull(link("https://verify.example.com:443")))
    }

    @Test
    fun `no link, a link that is no URL, or a link without a one-time token is refused`() {
        assertNull(AppLinks.oneTimeLinkOrNull(null))
        assertNull(AppLinks.oneTimeLinkOrNull(""))
        assertNull(AppLinks.oneTimeLinkOrNull("https://verify.example.com/ #not a link"))
        assertNull(AppLinks.oneTimeLinkOrNull("https://verify.example.com/"))
        assertNull(AppLinks.oneTimeLinkOrNull("https://verify.example.com/#inquiry-id=${DemoFormTest.INQUIRY_ID}"))
    }

    @Test
    fun `only a view intent carries a link`() {
        val uri = Uri.parse(link("https://verify.example.com"))

        assertEquals(uri.toString(), AppLinks.linkOf(Intent(Intent.ACTION_VIEW, uri)))
        assertNull(AppLinks.linkOf(Intent(Intent.ACTION_MAIN)))
        assertNull(AppLinks.linkOf(Intent(Intent.ACTION_SEND, uri)))
        assertNull(AppLinks.linkOf(Intent(Intent.ACTION_VIEW)))
        assertNull(AppLinks.linkOf(null))
    }

    companion object {
        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        const val ONE_TIME_TOKEN = "ovo_ooooooooooooooooooooooooooooooooooooooooooo"
    }
}
