package dev.openverify.demo

import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.OpenVerifyEventListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The demo's event log (C218.1): the names of the events the flow told this app, newest last, kept
 * in memory only. An event's name is all it keeps: a constant of this app, so the minified build shows
 * the same names.
 */
class EventLog(private val capacity: Int = CAPACITY) : OpenVerifyEventListener {
    private val mutableNames = MutableStateFlow<List<String>>(emptyList())

    /** The names of the last [capacity] events, oldest first. */
    val names: StateFlow<List<String>> = mutableNames.asStateFlow()

    override fun onEvent(event: OpenVerifyEvent) = mutableNames.update { (it + nameOf(event)).takeLast(capacity) }

    /** Forgets every name. */
    fun clear() {
        mutableNames.value = emptyList()
    }

    companion object {
        /** How many names the log keeps. */
        const val CAPACITY = 50

        /** The log of this process, which the installed components write to. */
        val shared = EventLog()

        /** The event's name, and nothing it carries. */
        fun nameOf(event: OpenVerifyEvent): String = when (event) {
            is OpenVerifyEvent.Started -> "Started"
            is OpenVerifyEvent.StepShown -> "StepShown"
            is OpenVerifyEvent.CameraPermission -> "CameraPermission"
            is OpenVerifyEvent.CaptureFailed -> "CaptureFailed"
            is OpenVerifyEvent.Submitted -> "Submitted"
            OpenVerifyEvent.Waiting -> "Waiting"
            is OpenVerifyEvent.Ended -> "Ended"
        }
    }
}
