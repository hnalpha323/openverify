# Events

An optional listener (C192) tells the host app what the flow is doing, for **UI coordination only**: a progress indicator, a support log, an analytics count of steps shown. Events can be missed (process death, a crash), and they never say how a verification was decided: the server is the source of truth, so read the inquiry on your server or take its webhooks.

```kotlin
OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = { event ->
    when (event) {
        is OpenVerifyEvent.StepShown -> showStepType(event.stepType)
        is OpenVerifyEvent.Ended -> logEnd(event.result)
        else -> Unit
    }
}))
```

## Delivery

- The listener is called on the main thread. It must not block; an exception it throws is caught and dropped, so it never stops the flow.
- With no listener installed, no event object is built.
- `Started` and `Ended` are sent once per flow; a rotation repeats nothing.
- A launch the activity refuses (a malformed request) sends no event.

## The events

| Event | Members | When |
|---|---|---|
| `Started` | `inquiryId` | The flow started |
| `StepShown` | `stepType` | A new step is shown; the step is named by its flow-spec type only (`consent`, `screen`, `government_id`, `selfie`, `nfc`, `database`, `completion`, `failure`, …), never by its id |
| `CameraPermission` | `granted` | The camera became usable (`granted = true`), or the person refused the permission (`granted = false`, once per refusal, since Workflow 10B) |
| `CaptureFailed` | `reason`: `CAMERA_UNAVAILABLE`, `CAMERA_ERROR`, `OUT_OF_MEMORY` | A photo could not be taken. `CAMERA_UNAVAILABLE` is sent once when the preview can bind no camera use case at all (since Workflow 10B); falling back to the manual shutter is not a failure |
| `Submitted` | `stepType` | The server accepted a consent, a verification submission, a wallet signature, a chip submission or a screen |
| `Waiting` | none | Once per wait while the server decides (a wait, a verification being processed) |
| `Ended` | `result`: `COMPLETED`, `FAILED`, `CANCELED` | The flow ended on this device |

## What an event never carries

A field value, a typed value, a token, an image, a chip byte, an MRZ, a signal, a check result, a message from the server, a URL or a step id. A contract test (`OpenVerifyEventAllowlistTest`) holds every event's members to the table above, so a new member cannot appear without a review.
