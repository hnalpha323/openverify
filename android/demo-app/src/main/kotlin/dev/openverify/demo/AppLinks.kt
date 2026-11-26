package dev.openverify.demo

import android.content.Intent
import dev.openverify.sdk.OpenVerifyInquiry
import java.net.URI
import java.net.URISyntaxException

/**
 * The App Links example (C218.2). The manifest's commented intent filter would hand this app a tapped
 * one-time link. A link from anywhere but your own server's messages can still bind the person to
 * someone else's inquiry on your own API, so treat a link like a session token in transit
 * (docs/android/integration.md).
 */
object AppLinks {
    /** The flow domain compiled into this app. A placeholder: the demo claims no domain. */
    const val HOST = "verify.example.com"

    /** The API compiled into this app, which every link is opened against. */
    const val API_BASE_URL = "https://verify.example.com"

    /** The link an intent carries, or `null` when it is not a view of one. */
    fun linkOf(intent: Intent?): String? = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString

    /**
     * The one-time link to launch, or `null` for a link this app refuses. A link is opened only when it
     * is plain `https` on [host] exactly (no other port, no user), and always against [apiBaseUrl]:
     * the link supplies the inquiry and its one-time token, never the server (review P03).
     */
    fun oneTimeLinkOrNull(
        link: String?,
        options: LaunchOptions = LaunchOptions(),
        host: String = HOST,
        apiBaseUrl: String = API_BASE_URL,
    ): OpenVerifyInquiry.OneTimeLink? {
        val uri = try {
            URI(link?.trim().orEmpty())
        } catch (_: URISyntaxException) {
            return null
        }
        val onHost = uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(host, ignoreCase = true) &&
            uri.userInfo == null &&
            (uri.port == -1 || uri.port == HTTPS_PORT)
        return if (onHost) DemoForm.oneTimeLinkOrNull(link.orEmpty(), apiBaseUrl, options) else null
    }

    private const val HTTPS_PORT = 443
}
