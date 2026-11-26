package dev.openverify.sdk

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * C190.4: the published, closed table of failure reasons. A new reason is a minor version in 0.x
 * and a major one after 1.0 (C214.4), so this list changes only with the README's table.
 */
internal class FailureReasonTableTest {

    @Test
    fun `the failure reasons are the eleven of Phase 9 and FLOW_HALTED, in this order (C190_4)`() {
        assertEquals(
            listOf(
                "INQUIRY_FAILED",
                "INQUIRY_EXPIRED",
                "SESSION_EXPIRED",
                "SESSION_CANCELED",
                "INQUIRY_REDACTED",
                "LINK_INVALID",
                "INVALID_REQUEST",
                "UNSUPPORTED_FLOW",
                "NETWORK_ERROR",
                "SERVER_ERROR",
                "STILL_PROCESSING",
                "FLOW_HALTED",
            ),
            FailureReason.entries.map { it.name },
        )
    }
}
