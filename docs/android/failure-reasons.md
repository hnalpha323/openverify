# Failure reasons

`InquiryResult.Failed(inquiryId, reason)` names one of a closed list of reasons (C190.4). A new reason is a minor-version change while the SDK is 0.x, and a major one after 1.0. A failure says how the flow ended on this device; the inquiry's state, and whether the person passed, are read on your server.

| `FailureReason` | What happened | What the host should do |
|---|---|---|
| `INQUIRY_FAILED` | The inquiry failed: the flow ended on its failure step, or the server failed the inquiry | Read the inquiry on your server; do not relaunch the same inquiry. The failure screen showed the operator's contest route when the decision has one |
| `INQUIRY_EXPIRED` | The inquiry expired before the person finished | Create a new inquiry to verify the person |
| `SESSION_EXPIRED` | The session token was refused or has expired | Create a new session (`POST /api/v1/inquiries/:id/resume`) and launch again |
| `SESSION_CANCELED` | The session was canceled: its inquiry left `created` or `pending` (it finished elsewhere). A session canceled because its inquiry expired or was redacted reports `INQUIRY_EXPIRED` or `INQUIRY_REDACTED` | Check the inquiry on your server before starting again |
| `INQUIRY_REDACTED` | The inquiry was redacted, so nothing more can be collected | Create a new inquiry |
| `LINK_INVALID` | A one-time link was refused: already used, expired, revoked or unknown | Generate a new link |
| `INVALID_REQUEST` | The inquiry id, session token or API base URL was malformed or did not match, or a plain-http API was given to an app that is not debuggable | Fix the request; it is never the person's fault |
| `UNSUPPORTED_FLOW` | The flow needs a step, component, copy or rule this SDK version does not render, or the server is older than flow-spec 2 | Update the SDK, or change the template; the unsupported screen never skips a step |
| `NETWORK_ERROR` | The server could not be reached and the person closed the flow | Offer to try again later; the inquiry is resumable |
| `SERVER_ERROR` | The server refused a request or answered unexpectedly, and the person closed the flow | Check the server's logs with the request id; offer to try again |
| `STILL_PROCESSING` | The person closed the flow while the server had not yet decided the photos, or the inquiry after its last attempt | The decision still happens on the server: read the inquiry, or wait for its webhook |
| `FLOW_HALTED` | The server stopped the flow at its loop caps (Phase 9 C151.2): the verification cannot continue on this device | An operator resumes or expires the inquiry; do not relaunch |

`InquiryResult.Canceled(inquiryId)` means the person left before the end; the inquiry can be resumed with a new session. `InquiryResult.Completed(inquiryId, inquiryStatus)` means the flow reached its end; it never means the person passed.

**Unsupported screens inside a step.** Two cases are decided where the step is resolved, before the person picks a language: a `screen` whose component text no catalog holds, and an operator's legal consent text that cannot be filled as written (for example `{organization}` with no display name set). Both show the unsupported screen, never the SDK's own words, and closing either reports `Failed(UNSUPPORTED_FLOW)` (since Workflow 10B; the first release of this page recorded them as `Canceled`).

**A phone or app that cannot read a document chip is not a failure.** On an `nfc` step such a device offers the flow's fallback, or "continue later", which returns `Canceled` and leaves the inquiry resumable ([NFC](nfc.md#when-the-phone-or-the-app-cannot-read-a-chip)).
