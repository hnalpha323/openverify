package dev.openverify.sdk

/**
 * The bot-detection outcome a sandbox session asks for (Phase 7 C90.9; owner decisions after
 * Workflow 7A, "Later phases"), so a test of a branch on `inquiry/bot_detected` can take either
 * route. It acts **only in a sandbox environment**: a production server ignores it, and nothing
 * about the device changes.
 *
 * ```
 * OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.BOT))
 * ```
 */
public enum class SandboxSignalOutcome {
    /** The sandbox reports the session as automated. */
    BOT,

    /** The sandbox reports the session as a person. */
    HUMAN,
}
