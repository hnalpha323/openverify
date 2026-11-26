package dev.openverify.demo.smoke

import android.os.Bundle
import androidx.activity.ComponentActivity
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyAndroidTransport
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.OpenVerifyEventListener
import dev.openverify.sdk.OpenVerifyInquiry
import okhttp3.OkHttpClient
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.concurrent.LinkedBlockingQueue
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * The smoke test's launcher (C215.2; review V01). It exists only in the `minifiedSmoke` build and is
 * not exported: the instrumentation starts it in-process, with the certificate of its loopback
 * server. The launcher installs `OpenVerifyAndroidTransport.okHttp` over a client that trusts that
 * certificate alone, then starts the session contract, so the build stays non-debuggable and https
 * only, and R8 minifies the transport path as for a host app that installs one.
 */
class SmokeLauncherActivity : ComponentActivity() {
    private val verify = registerForActivityResult(OpenVerifyInquiry.Contract()) { result ->
        SmokeReport.ended(result)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        val certificate = intent.getStringExtra(EXTRA_CERTIFICATE_PEM)
        val inquiryId = intent.getStringExtra(EXTRA_INQUIRY_ID)
        val sessionToken = intent.getStringExtra(EXTRA_SESSION_TOKEN)
        val apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL)
        if (certificate == null || inquiryId == null || sessionToken == null || apiBaseUrl == null) {
            finish()
            return
        }
        OpenVerifyAndroid.install(
            OpenVerifyComponents(
                transport = OpenVerifyAndroidTransport.okHttp(SmokeTrust.clientTrusting(certificate)),
                eventListener = SmokeReport,
            ),
        )
        verify.launch(OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl))
    }

    companion object {
        const val EXTRA_CERTIFICATE_PEM = "dev.openverify.demo.smoke.CERTIFICATE_PEM"
        const val EXTRA_INQUIRY_ID = "dev.openverify.demo.smoke.INQUIRY_ID"
        const val EXTRA_SESSION_TOKEN = "dev.openverify.demo.smoke.SESSION_TOKEN"
        const val EXTRA_API_BASE_URL = "dev.openverify.demo.smoke.API_BASE_URL"
    }
}

/**
 * What the smoke launch told this process: each event's name (a shown step with its flow-spec type),
 * and how the flow ended, both as text made here. The device test reads only this text, so it names
 * no SDK class: its APK is built against the minified app, where R8 may have removed or renamed any
 * SDK member the app does not use. The names are constants, so the minified build reports the same.
 */
object SmokeReport : OpenVerifyEventListener {
    val events = LinkedBlockingQueue<String>()
    val results = LinkedBlockingQueue<String>()

    override fun onEvent(event: OpenVerifyEvent) {
        events.put(
            when (event) {
                is OpenVerifyEvent.Started -> "Started"
                is OpenVerifyEvent.StepShown -> "StepShown ${event.stepType}"
                is OpenVerifyEvent.CameraPermission -> "CameraPermission"
                is OpenVerifyEvent.CaptureFailed -> "CaptureFailed"
                is OpenVerifyEvent.Submitted -> "Submitted"
                OpenVerifyEvent.Waiting -> "Waiting"
                is OpenVerifyEvent.Ended -> "Ended"
            },
        )
    }

    /** Records how the flow ended: `Completed <inquiry> <status>`, `Failed <inquiry> <reason>` or `Canceled <inquiry>`. */
    fun ended(result: InquiryResult) {
        results.put(
            when (result) {
                is InquiryResult.Completed -> "Completed ${result.inquiryId} ${result.inquiryStatus.wireValue}"
                is InquiryResult.Failed -> "Failed ${result.inquiryId} ${result.reason.name}"
                is InquiryResult.Canceled -> "Canceled ${result.inquiryId}"
            },
        )
    }

    fun reset() {
        events.clear()
        results.clear()
    }
}

/** The smoke launch's TLS trust: one certificate, handed over at run time, and nothing else. */
object SmokeTrust {
    /** A client that trusts the certificate in [certificatePem] alone. */
    fun clientTrusting(certificatePem: String): OkHttpClient {
        val trustManager = trustManagerFor(certificatePem)
        val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
        return OkHttpClient.Builder().sslSocketFactory(context.socketFactory, trustManager).build()
    }

    /** The trust manager that accepts the certificate in [certificatePem] alone. */
    fun trustManagerFor(certificatePem: String): X509TrustManager {
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(certificatePem.byteInputStream())
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("smoke", certificate)
        }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
            .trustManagers.filterIsInstance<X509TrustManager>().single()
    }
}
