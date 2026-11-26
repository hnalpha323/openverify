package dev.openverify.sdk.capture.barcode

import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep

/** The retry reason of `id_barcode_detection` (Phase 3 C33): the established class carries a PDF417 and none was decoded. */
internal const val BARCODE_NOT_FOUND: String = "barcode_not_found"

/**
 * C203.3, C201.2: whether [state] is the `government_id` side the server's guidance marks as
 * barcode-bearing. The session names no barcode side; the server's mark is the existing
 * `barcode_not_found` hint family, a retry hint that says the document's class carries a PDF417 that
 * was not decoded. It names the side with the barcode: the back of a two-sided or back-only ID, the
 * front of a front-only one. `capture-pipeline` analyses this side at C201.2's barcode width.
 */
internal fun isBarcodeBearing(state: FlowState.Capture): Boolean {
    val step = state.step as? GovernmentIdStep ?: return false
    if (state.retryHints.none { BARCODE_NOT_FOUND in it.reasons }) return false
    val barcodeSide = if (step.sides == DocumentSides.FRONT) FileKind.FRONT else FileKind.BACK
    return state.kind == barcodeSide
}
