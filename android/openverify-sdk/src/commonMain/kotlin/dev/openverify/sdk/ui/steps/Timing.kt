package dev.openverify.sdk.ui.steps

import kotlin.time.Instant

// The code and wallet screens count down to the server's times (C55.4, C55.6, C57.2). The device's
// clock may differ from the server's, so these only guide the user: the server answers a send that
// comes too soon with the time it allows the next one.

/** Whole seconds from [now] until [then], rounded up; `0` once it has passed or without a time. */
internal fun secondsUntil(now: Instant, then: Instant?): Long {
    val left = (then ?: return 0) - now
    if (!left.isPositive()) return 0
    return (left.inWholeMilliseconds + 999) / 1000
}

/** Whole minutes from [now] until [then], rounded up; `0` once it has passed or without a time. */
internal fun minutesUntil(now: Instant, then: Instant?): Long {
    val seconds = secondsUntil(now, then)
    return (seconds + 59) / 60
}
