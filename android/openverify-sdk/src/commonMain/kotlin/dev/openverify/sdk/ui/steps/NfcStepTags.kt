package dev.openverify.sdk.ui.steps

/** Semantics tags of the NFC step's screens (C207.5), for UI tests. */
internal object NfcStepTags {
    /** The MRZ entry's three fields and the CAN field. */
    const val DOCUMENT_NUMBER = "openverify:nfc-document-number"
    const val BIRTH_DATE = "openverify:nfc-birth-date"
    const val EXPIRY_DATE = "openverify:nfc-expiry-date"
    const val CAN = "openverify:nfc-can"

    /** The entry screens' "Continue", and the switch between the MRZ and the CAN entry. */
    const val CONTINUE = "openverify:nfc-continue"
    const val SWITCH_ACCESS = "openverify:nfc-switch-access"

    /** The tap screen's "I'm ready", "Change the document details" and "Stop reading". */
    const val READY = "openverify:nfc-ready"
    const val CHANGE_DETAILS = "openverify:nfc-change-details"
    const val STOP = "openverify:nfc-stop"

    /** The phase's words, a polite live region; the notice beside it; the file being read and its progress bar. */
    const val PHASE = "openverify:nfc-phase"
    const val NOTICE = "openverify:nfc-notice"
    const val FILE = "openverify:nfc-file"
    const val PROGRESS = "openverify:nfc-progress"

    /** The sandbox test chip: its label, its scenario selector and its button (C208.2). */
    const val SANDBOX_LABEL = "openverify:nfc-sandbox-label"
    const val SANDBOX_SCENARIO = "openverify:nfc-sandbox-scenario"
    const val SANDBOX = "openverify:nfc-sandbox"

    /** The DG1 review: what the chip says, and its two answers. */
    const val REVIEW = "openverify:nfc-review"
    const val CONFIRM = "openverify:nfc-confirm"
    const val REFUSE = "openverify:nfc-refuse"

    /** The tips' "Try again". */
    const val TRY_AGAIN = "openverify:nfc-try-again"

    /** The "cannot read document chips" screens' actions. */
    const val OPEN_SETTINGS = "openverify:nfc-open-settings"
    const val RECHECK = "openverify:nfc-recheck"
    const val ANOTHER_WAY = "openverify:nfc-another-way"
    const val CONTINUE_LATER = "openverify:nfc-continue-later"
}
