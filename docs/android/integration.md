# Integration guide

## How a flow runs

1. Your server creates the inquiry with an API key (`POST /api/v1/inquiries`), with its template, reference id, account and any field values: nothing about the inquiry is set on the device.
2. Your server asks for a session token (`POST /api/v1/inquiries/:id/resume`) and hands the app only `inquiry-id` and `session-token`, never the API key.
3. The app launches the SDK's activity through an activity-result contract. The SDK reads the session, renders the step the server's position names, reports only that step's own submission, and reads the session again.
4. The app receives an `InquiryResult`. It says how the flow ended **on this device**, never whether the person passed: confirm on your server with the inquiry's status or a webhook.

## The two contracts

```kotlin
val verify = registerForActivityResult(OpenVerifyInquiry.Contract()) { result ->
    when (result) {
        is InquiryResult.Completed -> { /* result.inquiryId, result.inquiryStatus: read the outcome on your server */ }
        is InquiryResult.Failed -> { /* result.reason: see failure-reasons.md */ }
        is InquiryResult.Canceled -> { /* the person left; the inquiry can be resumed later */ }
    }
}
verify.launch(
    OpenVerifyInquiry.Request(
        inquiryId = inquiryId,
        sessionToken = sessionToken,
        apiBaseUrl = "https://verify.example.com",
        locale = "es",                 // optional, BCP 47, at most 35 characters
        appearance = Appearance.SYSTEM, // SYSTEM, LIGHT or DARK
    ),
)
```

A one-time link (an inquiry and a one-time token, redeemed once for a session) goes through `OpenVerifyInquiry.OneTimeLinkContract()`:

```kotlin
val link = OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl = "https://verify.example.com")
verifyLink.launch(link)
```

- **The API is always yours.** `fromOneTimeLink` takes only the inquiry and the one-time token from the link; the API is the `apiBaseUrl` compiled into your app, never the link's origin (C190.2). Two links on different origins reach the same API.
- **Results carry no field value and no token.** `Completed(inquiryId, inquiryStatus)`, `Failed(inquiryId?, reason)` and `Canceled(inquiryId?)`; a one-time link's token never leaves the SDK.
- **`locale`** (C190.2, C199.2): a malformed tag (not BCP 47, longer than 35 characters, an underscore or a space) throws `IllegalArgumentException` with a fixed message that names no value; a well-formed tag the SDK does not bundle falls back without error. See [themes and languages](themes-and-languages.md) for the order the SDK chooses a language in.
- **`appearance`** (C198.5): `SYSTEM` follows the device as the session theme's mode allows; `LIGHT` and `DARK` force one; a forced dark with no dark palette in the session uses the built-in dark palette.
- `locale` and `appearance` travel as launch intent extras only (`dev.openverify.sdk.extra.LOCALE`, `dev.openverify.sdk.extra.APPEARANCE`), never in saved state.

## Optional components: the install registry

Call `OpenVerifyAndroid.install` once, from `Application.onCreate`, so it holds again after process death. A second call replaces the first, whole; each flow reads the components once, when it starts, so an install made during a flow applies to the next one.

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        OpenVerifyAndroid.install(
            OpenVerifyComponents(
                eventListener = { event -> Log.d("Verify", event::class.simpleName.orEmpty()) },
                transport = OpenVerifyAndroidTransport.okHttp(myOkHttpClient),
                // chipReader, faceDetectorFactory, integrityTokenProvider: 10B, 10C and 10E
                // sandboxSignalOutcome = SandboxSignalOutcome.BOT, // sandbox sessions only
            ),
        )
    }
}
```

| Component | When absent |
|---|---|
| `eventListener` | No event object is built ([events](events.md)) |
| `transport` | The SDK's own OkHttp client is used |
| `chipReader` | An `nfc` step shows "this app cannot read document chips" and offers the flow's fallback when it has one; in a sandbox it can still run with the test chip ([NFC](nfc.md)). The optional `openverify-nfc` module gives a reader: `OpenVerifyNfc.chipReader(context)` |
| `faceDetectorFactory` | The selfie keeps the manual shutter with the server's prompts. The optional `openverify-face` module gives a detector: `OpenVerifyFace.detectorFactory(context)` ([capture](capture.md)) |
| `integrityTokenProvider` | No integrity token is sent (Workflow 10B) |
| `sandboxSignalOutcome` | Nothing extra is sent. When set, `bot` or `human` rides on the signal body of a **sandbox** session only, and makes `inquiry/bot_score` 95 or 5 ([sandbox providers](../checks/sandbox-providers.md#sandbox-signal-outcome)); production sessions never carry it |

`:openverify-sdk` depends on no optional artifact: each capability is an interface the host installs (ADR 0009).

## The transport

`OpenVerifyAndroidTransport.okHttp(client)` derives the SDK's client from yours with `newBuilder()`, keeps your certificate pinner, timeouts, proxy, interceptors, connection pool and dispatcher, and forces redirects off. It carries every flow request and the one-time-link redemption.

- **Your interceptors see every flow request**, including the session token, images, typed values and (from 10C) chip files. Process them on the device only, and never put a logging interceptor on a client you pass to the SDK.
- Trust follows your app's network security configuration, which the SDK runs inside and cannot override: keep system trust anchors only and cleartext off in release builds.
- OkHttp's type is in this public signature, so OkHttp is an `api` dependency; a new OkHttp major version is a breaking SDK change after 1.0.

## Certificate pinning (a recipe)

The SDK pins nothing itself: each self-hosted install has its own certificates, and a pin set wrong locks every user out until a new app ships (decision 41; C256.2). If you pin, do it on your own client and pass it through the transport:

```kotlin
val pinned = OkHttpClient.Builder()
    .certificatePinner(
        CertificatePinner.Builder()
            // The SHA-256 of the API host's public key (its SubjectPublicKeyInfo), and a backup key you
            // hold in reserve, so a key rotation does not lock everyone out.
            .add("verify.example.com", "sha256/<primary key, base64>")
            .add("verify.example.com", "sha256/<backup key, base64>")
            .build(),
    )
    .build()

OpenVerifyAndroid.install(OpenVerifyComponents(transport = OpenVerifyAndroidTransport.okHttp(pinned)))
```

- **Pin the host your app passes as the API base**, and keep at least two pins: the current key and a backup key that is not yet deployed. Plan how you will rotate before you ship.
- **A refused pin ends the call as a network error** (`Failed(NETWORK_ERROR)` once the person stops): OkHttp refuses the connection after the TLS handshake and before any request is sent, so no session token, image or typed value leaves the device.
- **Trust still comes first.** Pinning narrows which certificates your app accepts on top of your network security configuration; it never makes an untrusted certificate acceptable.
- **What it does not do:** on a rooted or hooked device the app itself can be changed, pins included (C256.5). Pinning protects people on ordinary devices from a mis-issued or intercepted certificate, not an attacker who controls the phone.

`CertificatePinningRecipeTest` (the SDK's host tests) runs this recipe against a TLS server with synthetic certificates: the client installed through `OpenVerifyAndroidTransport.okHttp` reaches the server when one of its pins matches and refuses the connection, with no request sent, when none does.

## Plain http to a loopback server

The SDK sends the session only over https, with one exception for development: plain `http` to `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` (the emulator's host alias) is allowed only when **your app is debuggable** (`android:debuggable`, a debug build). In a release build such a launch ends as `Failed(INVALID_REQUEST)` before any request is made: on a real phone `10.0.2.2` is an ordinary private address.

## The minimum server

The SDK declares `OpenVerify-Flow-Spec: 2` and renders the server's position (C193). It needs a server that answers the session with `spec-version: 2` and a `position`: an OpenVerify server with Phase 9's flow engine or later. Against an older server the flow shows the unsupported screen, which says the verification service is older than the app, and ends `Failed(UNSUPPORTED_FLOW)`.

What this SDK renders at flow-spec 2: consent with built-in or operator copy and consent digests; the government ID, selfie, document, phone and email code, database, AAMVA, crypto wallet (paste only), business database and business website steps; `screen` steps with the component catalogue (C148); waits, the halted state, completion and failure steps with the decision's contest route; the help and privacy links; the session theme; the five SDK languages. The server always skips a `device_handoff` step for an SDK session. Since Workflow 10C the `nfc` step is rendered too ([NFC](nfc.md)); it needs a server with that Workflow's `client-unable` route.

## App Links and one-time links (C218.2)

To open a tapped one-time link in your app, declare an intent filter for the flow domain you operate, verified with Android App Links (`android:autoVerify="true"`); the demo app's manifest carries a commented example and claims no domain. Before calling `fromOneTimeLink`:

1. Check that the link's host is the host compiled into your app, and refuse any other.
2. Always pass your compiled-in `apiBaseUrl` (the SDK never takes the API from the link).
3. Accept links only from your own server's messages.

A one-time link from anywhere else can still bind the person to someone else's inquiry on your own API: the link names the inquiry, so a person who taps a link another party sent them verifies for that party's inquiry. Treat a link like a session token in transit.

## What the activity does for you

- `FLAG_SECURE` on the flow's window: documents and selfies stay out of screenshots, screen recordings and recents (not out of accessibility services).
- On Android 12 and later, other apps' overlays are hidden while the flow is in front (`HIDE_OVERLAY_WINDOWS`); on Android 8 to 11 the consent and submit controls ignore touches delivered through an overlay.
- The system back gesture is handled by the flow and never skips a step; leaving before the end returns `Canceled`, and the inquiry stays resumable.
- Nothing the person typed is kept in saved state: after process death the flow resumes at the server's position with empty fields.
