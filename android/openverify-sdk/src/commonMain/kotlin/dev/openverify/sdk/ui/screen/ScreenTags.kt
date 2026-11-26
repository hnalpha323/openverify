package dev.openverify.sdk.ui.screen

/** Semantics tags of the screen step (C195) and the failure screen (C197.3), for UI tests. */
internal object ScreenTags {
    /** The screen's heading, which takes focus on arrival (C195.8). */
    const val HEADING: String = "openverify:screen-heading"

    /** The error summary at the top, after a submission the device refused (C195.4). */
    const val SUMMARY: String = "openverify:screen-summary"

    /** The summary's link to the field [key]. */
    fun summaryLink(key: String): String = "openverify:screen-summary:$key"

    /** The control of the field [key] (a text field, a selector, a group or a checkbox). */
    fun field(key: String): String = "openverify:screen-field:$key"

    /** The country selector of the phone field [key]. */
    fun phoneCountry(key: String): String = "openverify:screen-phone-country:$key"

    /** The option [value] of the choice field [key] (a radio, a checkbox of a group). */
    fun choice(key: String, value: String): String = "openverify:screen-choice:$key:$value"

    /** The date picker button of the date field [key]. */
    fun datePick(key: String): String = "openverify:screen-date-pick:$key"

    /** The component [id] (a text, an image, a stepper, a button). */
    fun component(id: String): String = "openverify:screen-component:$id"

    /** The cancel confirmation's buttons. */
    const val CANCEL_CONFIRM: String = "openverify:screen-cancel-confirm"
    const val CANCEL_KEEP: String = "openverify:screen-cancel-keep"

    /** A submission on its way. */
    const val SAVING: String = "openverify:screen-saving"

    /** The server refused the submission for a reason no field shows. */
    const val REFUSED: String = "openverify:screen-refused"

    /** The failure screen's contest route (C197.3): its link button and its contact. */
    const val CONTEST_LINK: String = "openverify:contest-link"
    const val CONTEST_CONTACT: String = "openverify:contest-contact"
}
