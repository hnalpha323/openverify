package dev.openverify.sdk.camera

/**
 * C201.2 (decision 17): which camera frames the guidance reads. A camera delivers 15 to 60 frames a
 * second; the guidance reads [hz] of them (`guidance-hz`, 8), and every other frame is closed at once
 * without a copy. Frames are taken on a fixed schedule from the first one, so a 30 fps camera gives 8
 * a second, not 7.5; a frame that comes a whole interval late restarts the schedule from itself, so a
 * slow camera never gets a burst. A clock that goes back (a new camera session) starts a new schedule.
 * Not thread-safe: one analyzer thread calls it.
 */
internal class FrameSampler(hz: Int) {
    init {
        require(hz in 1..MAX_HZ) { "FrameSampler: the rate is 1 to $MAX_HZ frames a second" }
    }

    private val intervalNanos: Long = NANOS_PER_SECOND / hz

    /** When the next frame is due, on the camera's clock; [UNSET] before the first. */
    private var nextDue: Long = UNSET

    /** Whether the frame stamped [timestampNanos] (the camera's monotonic clock) is read. */
    fun take(timestampNanos: Long): Boolean {
        val due = nextDue
        val restart = due == UNSET || timestampNanos < due - intervalNanos
        if (!restart && timestampNanos < due) return false
        nextDue = if (restart || timestampNanos - due >= intervalNanos) timestampNanos + intervalNanos else due + intervalNanos
        return true
    }

    internal companion object {
        /** C201.2: `guidance-hz` of `selfie-capture.json` and `document-capture.json` (the schema's constant). */
        const val GUIDANCE_HZ: Int = 8

        private const val MAX_HZ = 60
        private const val NANOS_PER_SECOND = 1_000_000_000L
        private const val UNSET = Long.MIN_VALUE
    }
}
