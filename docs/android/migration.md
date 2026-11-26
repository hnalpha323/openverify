# Migrating from a builder-style mobile SDK

Some identity-verification SDKs start a flow from the device with a builder: the app names a template, sets the reference id and field values on the client, and listens to callbacks that return the inquiry's fields. This SDK works the other way round: **your server creates the inquiry, the device only runs it**, and the server decides every step. This page maps the builder's concepts onto it.

| A builder-style SDK | This SDK | Why |
|---|---|---|
| Start from a template or template version on the device | Your server creates the inquiry from its template (`POST /api/v1/inquiries`) and a session token (`POST /api/v1/inquiries/:id/resume`); the app launches `OpenVerifyInquiry.Contract()` with `Request(inquiryId, sessionToken, apiBaseUrl)` | A client that can create inquiries needs a public key and abuse controls; the server already holds the template, the account and the environment |
| Start from an existing inquiry | The same `Request`, always with a session token | The token is what binds the device to one inquiry |
| Set the environment, reference id or account on the client | Set at creation on your server | A reference id or account set on the device would be an identity link the client chooses |
| Prefill fields on the client | Pass `fields` when your server creates the inquiry; a step's `prefillFrom` shows them, editable | Values from your server cannot be altered on the way |
| A locale override on the builder | `Request.locale` (BCP 47), with the person's own choice in the selector first | See [themes and languages](themes-and-languages.md) |
| A light or dark style variant | `Request.appearance` (`SYSTEM`, `LIGHT`, `DARK`) | |
| Resource-name overrides for images and animations | None: the operator's theme set and copy, from the console | A resource-name API is fragile and cannot be held stable |
| A completion callback with the inquiry's fields | `InquiryResult.Completed(inquiryId, inquiryStatus)`, with no field value and no token | Your server has the fields; read them there, or take the webhooks |
| A cancel callback with the session token | `InquiryResult.Canceled(inquiryId)` | A token never leaves the SDK; create a new session to resume |
| An error callback with a free-text message | `InquiryResult.Failed(inquiryId, reason)` with a closed `FailureReason` | A closed list can be handled in code; see [failure reasons](failure-reasons.md) |
| An event listener for screens and camera states | `OpenVerifyComponents(eventListener = …)` | PII-free, for UI coordination only; see [events](events.md) |
| An inline fragment mode | Not offered in this release: the activity owns `FLAG_SECURE`, back handling and process death | Deferred |
| A one-time link code | `OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl)` with `OneTimeLinkContract()`; the API is always the one compiled into your app | See [App Links](integration.md#app-links-and-one-time-links-c2182) |

## What does not change

- Webhooks and the server API are the source of truth for every outcome; a device result coordinates your UI only.
- Sandbox inquiries behave as production ones, with the sandbox providers' deterministic answers ([sandbox providers](../checks/sandbox-providers.md)).
