package dev.openverify.consumercheck

import android.os.Bundle
import androidx.activity.ComponentActivity
import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyInquiry

/**
 * C217.3: what a host app writes against the published SDK, compiled against the staged AAR alone.
 * It is never run: the build proves that the root module resolves for an Android consumer, that the
 * public entry points compile from the published artifact, and that R8 minifies the result with the
 * rules the AAR ships.
 */
class ConsumerActivity : ComponentActivity() {
    private var last: String = "none"

    private val verify = registerForActivityResult(OpenVerifyInquiry.Contract()) { result ->
        last = when (result) {
            is InquiryResult.Completed -> "completed: ${result.inquiryStatus}"
            is InquiryResult.Failed -> if (result.reason == FailureReason.SERVER_ERROR) "failed: server" else "failed: ${result.reason}"
            is InquiryResult.Canceled -> "canceled"
        }
        title = last
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val inquiryId = intent.getStringExtra("inquiry-id") ?: return
        val sessionToken = intent.getStringExtra("session-token") ?: return
        val apiBaseUrl = intent.getStringExtra("api-base-url") ?: return
        verify.launch(OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl))
    }
}
