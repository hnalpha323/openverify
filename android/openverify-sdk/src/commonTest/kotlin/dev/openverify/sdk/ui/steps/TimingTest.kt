package dev.openverify.sdk.ui.steps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/** The countdowns of the code and wallet screens, to the server's times (C55.4, C55.6, C57.2). */
class TimingTest {

    private val now = Instant.parse("2026-10-20T12:00:00Z")

    @Test
    fun secondsUntilATimeAreRoundedUp() {
        assertEquals(30, secondsUntil(now, now + 30.seconds))
        assertEquals(31, secondsUntil(now, now + 30.seconds + 200.milliseconds))
        assertEquals(1, secondsUntil(now, now + 1.milliseconds))
    }

    @Test
    fun minutesUntilATimeAreRoundedUp() {
        assertEquals(10, minutesUntil(now, now + 10.minutes))
        assertEquals(10, minutesUntil(now, now + 9.minutes + 1.seconds))
        assertEquals(1, minutesUntil(now, now + 59.seconds))
    }

    @Test
    fun aTimeThatHasPassedOrIsUnknownIsZero() {
        assertEquals(0, secondsUntil(now, now))
        assertEquals(0, secondsUntil(now, now - 5.seconds))
        assertEquals(0, minutesUntil(now, now - 1.minutes))
        assertEquals(0, secondsUntil(now, null))
        assertEquals(0, minutesUntil(now, null))
    }
}
