# TDD evidence: KMP migration Stage 2, kmp-network

- **Slice owner:** `kmp-network` (KMP migration Workflow, Stage 2 of 4, alone in `android/`).
- **Date:** 2026-10-22.
- **Plan:** `docs/plans/kmp-migration.plan.md`: K4 (the Ktor client), the S2 rows of K2, and the Stage 2 bullet of the Workflow.
- **Paths owned:** `openverify-sdk/src/*/kotlin/dev/openverify/sdk/api/**`, the URL parts of `OpenVerifyInquiry.kt`, the `api` tests and this file.
- **Owner's request behind the plan:** "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android".

**How the commands ran.** Every Gradle command ran in the foreground from `android/`, after `source scripts/env.sh`. Counted runs use `--rerun-tasks`. Output is trimmed to the lines that matter. The raw JUnit and Kover XML, the wire captures and the public API listing stay in the session scratchpad, outside git. The SHA-256 and the multiset comparison use the recipe in `docs/tdd/kmp-foundation.tdd.md`.

## 0. Starting point

Stage 1 ended at `1054236`: 649 SDK host tests in 35 classes (list SHA-256 `34200f34…`), Kover 97.77%, and the K7 baseline of 631 lines with SHA-256 `9b4c22f4…`. A first run here reproduced the 649 tests and the same SHA.

**A build-state gotcha.** The first `compileKotlinIosArm64` failed with `KLIB loader: The same 'unique_name=org.jetbrains.kotlin.native.platform.*' found in more than one library`. The two copies were `~/.konan` and the throwaway distribution of Stage 1's fresh-runner check. `openverify-sdk/build/konan.txt`, the output of `downloadKotlinNativeDistribution`, still named the throwaway copy. `./gradlew :openverify-sdk:downloadKotlinNativeDistribution --rerun` rewrote it to `~/.konan`. Nothing in git changed, and a `--rerun-tasks` gate also rewrites it.

**Today's wire, captured first.** A throwaway JUnit probe was never committed: it lived in the scratchpad and was copied into `androidHostTest` only while it ran. It sent every flow call and the redeem through the OkHttp client, to a MockWebServer per call. It recorded the request line, every header in order and the body, with the port and the multipart boundary normalised. Some highlights of that capture:

- headers in the order `Accept`, `User-Agent: OpenVerify-Android/0.1.0`, `Authorization` (flow calls only), `Content-Type`, `Content-Length`, `Host`, `Connection`, `Accept-Encoding`;
- JSON as `application/json; charset=utf-8`;
- multipart parts carry only `Content-Disposition` (quoted names) and, for the file, `Content-Type`;
- the upload has a `Content-Length` and is not chunked.

## 1. The URL seam: `ApiBaseUrl` and `OneTimeLinks`

**Stub** (`119e263`). Common `ApiBaseUrl` and `OneTimeLinks`, whose parsers refuse everything. 649 tests stayed green, and the iOS klibs compiled.

**RED** (`c98007e`). Two common suites state the rules: `ApiBaseUrlTest` (12 tests) and `OneTimeLinksTest` (8). Two host parity suites compare the parsers with what they replace:

- **`ApiBaseUrlParityTest`.** 112 inputs go through `HttpUrl` plus the old checks (copied verbatim into the test) and through `ApiBaseUrl.parse`. Both must accept or refuse each one, with the same scheme, host, port, `encodedPathSegments` and `toString()`. The session URL must be what `addPathSegments("api/v1/flow").addPathSegment("session")` built, and must survive Ktor's `Url` and OkHttp's re-parse unchanged. The inputs cover:
  - the SDK's own cases;
  - case and whitespace, including tabs inside;
  - WHATWG slash leniency (`https:host`, `https:\\host`);
  - user info, including an empty `@`;
  - empty queries and fragments;
  - host characters, percent-decoding and label lengths;
  - IPv4 forms and IPv6 forms (zeros, an IPv4-mapped address, an embedded IPv4, a zone ID, invalid ones);
  - every port edge (`0`, `65536`, empty, `+443`, `0443`, Arabic-Indic digits);
  - path prefixes (dot segments, escapes, spaces, non-ASCII, controls, an emoji).

  A sweep puts each of the 94 printable ASCII characters inside a host. Five IDN inputs pin the one allowed difference: HttpUrl punycodes the host, and the parser refuses it with a message naming the `xn--` form, which it then accepts.
- **`OneTimeLinksParityTest`.** 49 links go through `fromOneTimeLink`'s old HttpUrl code (verbatim) and through `OneTimeLinks.parse`. They include `OpenVerifyInquiryOneTimeLinkTest`'s links, encoded names and values, `+`, empty and repeated pairs, a second `#`, tabs, user info, an IPv6 origin and explicit API base URLs. An IDN origin is the one difference.

```text
$ ./gradlew --continue :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 \
    :openverify-sdk:testAndroidHostTest --tests '*.ApiBaseUrlTest' --tests '*.OneTimeLinksTest' --tests '*.ApiBaseUrlParityTest' --tests '*.OneTimeLinksParityTest'
> Task :openverify-sdk:compileTestKotlinIosSimulatorArm64
> Task :openverify-sdk:compileTestKotlinIosArm64
189 tests completed, 106 failed
ApiBaseUrlParityTest: 119 tests, 68 failed   [1] "https://api.example.com" :: OkHttp accepted 'https://api.example.com' as https://api.example.com/ but the parser refused it
ApiBaseUrlTest: 12 tests, 9 failed           acceptsHttpsAndTheLocalDevelopmentHosts() :: IllegalArgumentException: ApiBaseUrl.parse is not implemented yet
OneTimeLinksParityTest: 50 tests, 23 failed  [1] "https://verify.example.com/#inquiry-id=…" :: HttpUrl read '…' but OneTimeLinks refused it
OneTimeLinksTest: 8 tests, 6 failed          readsTheFragmentWithTheApiOnTheLinksOrigin() :: IllegalArgumentException: OneTimeLinks.parse is not implemented yet
```

Every failure is an input the oracle accepts. The tests that pass on the stub are the refusals, which a parser that refuses everything already meets.

**GREEN for the parser, and a finding** (`67f4c1f`). `HttpUrlParts` splits an http(s) URL as HttpUrl does. It trims ASCII whitespace, takes any slashes or backslashes, and treats only an empty user info as no credential. It percent-decodes the host and canonicalises it: lower case, RFC 5952 IPv6, an IPv4-mapped address as IPv4, the WHATWG forbidden characters, label lengths. Ports are 1 to 65535, with an optional sign as `Integer.parseInt` reads it. Path segments drop tabs and newlines, escape the HttpUrl encode set, keep `%` escapes and resolve dot segments. A non-ASCII host is kept as written, with `isAsciiHost` false. `ApiBaseUrl.parse` adds the rules: ASCII host, no query or fragment, no credentials, https unless the host is local. `resolve(...)` builds request paths as `addPathSegment` did.

130 of the 131 tests passed on the first run. The one failure was the third assertion for `https://api.example.com/a%zz`. HttpUrl accepted it and sent the stray `%` as it was, and the parser agreed, but Ktor's `Url` throws `URLDecodeException: Wrong HEX escape: %zz`. Every request on that base URL would fail. So the input moved out of the parity list into a test of its own: OkHttp accepted it, Ktor's `Url` throws, the parser refuses it. `ApiBaseUrlTest` gained the same rule. Both were seen failing before the rule existed:

```text
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*.ApiBaseUrlParityTest'
122 tests completed, 4 failed
[1] https://api.example.com/a%zz :: Expected java.lang.IllegalArgumentException to be thrown, but nothing was thrown.
[2] https://api.example.com/a% :: …   [3] https://api.example.com/a%4/ :: …   [4] https://api.example.com/%/x :: …
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*.ApiBaseUrlTest'
ApiBaseUrlTest > refusesAPathPrefixWithAMalformedPercentEscape() FAILED
13 tests completed, 1 failed
```

`67f4c1f` holds the parser together with these new RED tests. The full suite ran 842 tests: only the 29 `OneTimeLinks` REDs and these 5 failed, and every other test passed.

**GREEN for the rule** (`6539beb`). A path prefix may use `%` only in `%XX` escapes. Rerun with `--rerun`: 135 tests, 0 failed.

**Refactor** (`ef0e2d2`). `SessionCredentials.parseApiBaseUrl` returns the common `ApiBaseUrl`. `FlowApiClient` and `OneTimeLinkClient`, still on OkHttp, build their URLs with `ApiBaseUrl.resolve` and no longer with `HttpUrl`. The safety net was green: 842 tests, with only the 29 `OneTimeLinks` REDs failing, and `FlowApiClientTest` (75) and `OneTimeLinkClientTest` (6) passing unchanged.

**Move** (`e265338`). `SessionCredentials.kt`, now import-free, moves to `commonMain` as a 100% rename. The common, iOS and Android main compiles pass.

**GREEN** (`4a0bdd7`). `OneTimeLinks.parse` reads the fragment, cut at a second `#`, as a query: pairs split at `&` and the first `=`, percent-decoded with `+` as a space. It requires one inquiry ID, one one-time token and no session token. It checks both credentials, then the API base URL: the link's origin unless one is given, and a link with user info has no origin to offer. 58 tests passed, 0 failed.

**Refactor** (`87910c0`). `OpenVerifyInquiry.fromOneTimeLink` calls `OneTimeLinks.parse`. Its HttpUrl import and parameter constants are gone, and the KDoc of `Request` and `fromOneTimeLink` names the `xn--` rule. All 842 tests passed: `OpenVerifyInquiryOneTimeLinkTest` (16), `OpenVerifyInquiryRequestTest` (8) and `OpenVerifyInquiryActivityTest` (10) unchanged, and 0 baseline lines missing.

## 2. The transport seam: Ktor over OkHttp

**Stub** (`9bc0b83`). It names the seams the RED needs, with placeholder bodies, while the OkHttp path keeps working:

- `flowHttpClient(engine)`;
- `isJsonMediaType` (always `false`);
- `PLATFORM_NAME`;
- `sharedOkHttpClient`, which still returns the old client;
- `defaultFlowHttpClient()`, which throws;
- internal `FlowApiClient` and `OneTimeLinkClient` constructors on a Ktor `HttpClient`. They validate their arguments, then throw `NotImplementedError("… is not on Ktor yet")`.

The full suite passed: 842 tests. One fix was needed: the stub's secondary constructor made Kotlin refuse the `init`-assigned `authorization` ("Property must be initialized"), so the property got a direct initializer, with the URL still parsed before the token.

**RED** (`12a6626`). Four new suites:

- **`FlowApiClientContractTest`** (19 tests, kotlin.test and Ktor's MockEngine, common style). It covers:
  - the SDK headers and the token;
  - paths under a prefix;
  - JSON bodies with the exact content type;
  - the `{}` submit;
  - quoted multipart parts in order, the file's name and type, and a known request length;
  - every status mapping, with problem and request ID;
  - the last `x-request-id` winning, as OkHttp's `header()` returns it, and the fallback to the problem;
  - problem detection by media type;
  - Retry-After in seconds only;
  - an invalid 2xx;
  - UTF-8 bodies;
  - a 302 not followed;
  - an IOException as `Network`;
  - cancellation that reaches the engine and is never wrapped;
  - validation before any request.
- **`OneTimeLinkClientContractTest`** (4 tests). The redeem has no `Authorization`. It covers `LinkRefused`, the other failure kinds, and credentials refused before any request.
- **`JsonMediaTypeParityTest`** (35 inputs, host). `isJsonMediaType` against `toMediaTypeOrNull()?.subtype`, including malformed parameters, which OkHttp refused.
- **`OkHttpTransportTest`** (5 tests, host). The shared OkHttp client keeps its 15/30/60 s timeouts and follows no redirect. The default flow client is one Ktor client over it. A host app's `OkHttpClient()` follows no redirect for a flow call, and keeps `retryOnConnectionFailure(false)`. A server-closed pooled connection fails the next call, as OkHttp does without retries. The shared client retries it.

The two contract suites sat in `androidHostTest` until `FlowApiClient` was common (section 3), because they need it. They use only common APIs.

```text
$ ./gradlew --continue :openverify-sdk:compileKotlinIosArm64 :openverify-sdk:testAndroidHostTest
905 tests completed, 41 failed
FlowApiClientContractTest: 19 tests, 18 failed      aFlowCallSendsTheSdkHeadersAndTheSessionToken() :: kotlin.NotImplementedError: FlowApiClient is not on Ktor yet
OneTimeLinkClientContractTest: 4 tests, 4 failed    redeemPostsTheLinkWithoutCredentialsAndReturnsTheSession() :: kotlin.NotImplementedError: OneTimeLinkClient is not on Ktor yet
JsonMediaTypeParityTest: 35 tests, 17 failed        [2] "application/json" :: expected: <true> but was: <false>
OkHttpTransportTest: 5 tests, 2 failed              the default flow client is one Ktor client … :: kotlin.NotImplementedError: The flow clients are not on Ktor yet
                                                    the shared OkHttp client keeps its 15, 30 and 60 second timeouts and never follows a redirect :: expected: <false> but was: <true>
FlowApiClientTest: 75 tests, 0 failed
OneTimeLinkClientTest: 6 tests, 0 failed
```

The contract test that passed on the stub refuses malformed arguments, which happens before the transport. The three `OkHttpTransportTest` guards that passed pin behaviour today's OkHttp path already has; mutants below show that they can fail. gitleaks blocked the first commit attempt, on a variable named `apiKey` holding a synthetic `key_…` string. It was renamed, and the hook was not bypassed.

**A RED correction** (`ef0b2e4`). On the GREEN build, one assertion failed: `expected: <UTF-8> but was: <null>` for `Accept-Charset`. The plan's first accepted difference came from the spike. Ktor 3.5.2's `HttpPlainText` adds `Accept-Charset` only when a charset other than UTF-8 is configured: "RFC-9110 assumes UTF-8 as the default encoding. The Accept-Charset header is deprecated". So the request carries no `Accept-Charset`, exactly as with OkHttp. The assertion now pins its absence.

**GREEN** (`cdd4d37`).

- **`FlowHttp`.** Rebuilt on Ktor in portable code: `send(method, url, deserializer, authorization, body)`. It reads the status, the last `Content-Type`, `x-request-id` and `Retry-After`, and the body as UTF-8 with a leading BOM skipped, all inside the exchange. A `kotlinx.io.IOException` becomes `Network`. The status mapping, problem parsing and `InvalidResponse` are unchanged.
- **`FlowApiClient`.** It sends explicit `PartData` parts: quoted names, the file with its type and a `Content-Length`, so the request length is known, as OkHttp's was. The submit sends `TextContent("{}", application/json; charset=utf-8)`. Its constructors are a public `(apiBaseUrl, sessionToken, json)` on the shared client and an internal one on a Ktor client.
- **`FlowHttpPlatform.android.kt`** (`@file:JvmName("FlowApiClients")`). It holds:
  - the shared OkHttp client: 15/30/60 s, and now no redirects at the client itself;
  - `defaultFlowHttpClient()`, Ktor's OkHttp engine with `preconfigured` set to that client;
  - `okHttpFlowClient(client)`, which disables both kinds of redirect again and keeps the client's own `retryOnConnectionFailure`, which Ktor's engine config forces on;
  - the factories `FlowApiClient(url, token, OkHttpClient, json)` and the internal `OneTimeLinkClient(url, OkHttpClient, json)`.

```text
$ ./gradlew --continue :openverify-sdk:compileKotlinIosArm64 :openverify-sdk:testAndroidHostTest
BUILD SUCCESSFUL in 39s
905 tests in 43 classes; 0 not passing; baseline lines missing: 0; baseline classes with a different count: {}
```

**The wire, after.** The same probe, unchanged, ran on the Ktor client. `diff wire-before.txt wire-after-ktor.txt` shows only a `Content-Length` line in each multipart part, plus the changed request totals: `front` 279 to 419 and the selfie 637 to 939 (Ktor's longer boundary is part of each total). Request lines, header names, values and order, JSON bodies, part order, dispositions and part types are identical. Neither `Accept-Charset` nor `Transfer-Encoding: chunked` appears.

```text
81c81   < Content-Length: 279   > Content-Length: 419
87a88   > Content-Length: 5\r
92a94   > Content-Length: 6\r
104c106 < Content-Length: 637   > Content-Length: 939
110a113 > Content-Length: 12\r   (and 31, 22, 4, 6 for the other selfie parts)
```

**Mutants** (temporary, file copies restored, `git status` empty afterwards). The run covered `OkHttpTransportTest`, `FlowApiClientContractTest` and `FlowApiClientTest`:

| Mutant | Caught by |
|---|---|
| drop `retryOnConnectionFailure(okHttpClient.retryOnConnectionFailure)` | `a host app's OkHttp client keeps its choice not to retry a failed connection` |
| `followRedirects(true)` in the OkHttp engine config | `a host app's OkHttp client … does not follow one for a flow call` |
| the shared client gets `retryOnConnectionFailure(false)` | the shared client's settings test and `the shared client retries a failed pooled connection` |
| `followRedirects = true` in `flowHttpClient` | the same `OkHttpTransportTest` test, `redirectsAreNotFollowed…` (MockEngine) and `FlowApiClientTest`'s `redirects are not followed` |

The retry tests rely on a server-closed pooled connection. Ten `--rerun` runs of `OkHttpTransportTest` all passed: 5 tests each, 0 failed.

## 3. The common seam, the iOS actual and the moves

**Seams** (`73db1d0`). `commonMain/api/FlowHttpPlatform.kt` declares `expect val PLATFORM_NAME` and `expect fun defaultFlowHttpClient()`, beside `flowHttpClient(engine)`, which moved there from `FlowHttp.kt`. The Android declarations become `actual`. `iosMain/api/FlowHttpPlatform.ios.kt` is `PLATFORM_NAME = "iOS"` with one `flowHttpClient(Darwin.create())`. Ktor's Darwin delegate answers every native redirect with `completionHandler(null)`, and its failures are `DarwinHttpRequestException : kotlinx.io.IOException`, so they become `Network`. `iosTest/api/IosFlowHttpPlatformTest.kt` pins `"iOS"` and one shared client on the Darwin engine. It compiles on Linux and runs on the simulator from Phase 10.

```text
$ ./gradlew --continue :openverify-sdk:compileCommonMainKotlinMetadata :openverify-sdk:compileIosMainKotlinMetadata :openverify-sdk:compileKotlinIosArm64 \
    :openverify-sdk:compileKotlinIosSimulatorArm64 :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:testAndroidHostTest
BUILD SUCCESSFUL in 47s
905 tests in 43 classes; sha256 36bf30aa…; 0 not passing; baseline lines missing: 0
```

**Moves** (`99070d7`, six 100% renames). `FlowHttp.kt`, `FlowApiClient.kt`, `OneTimeLinkClient.kt` and `OneTimeLinkFlowApi.kt` move to `commonMain`, and the two contract suites to `commonTest`. Before the move, no JVM, OkHttp, okio, JUnit or Android import was left in any of them. The common and iOS metadata compiles and the iOS main and test klibs compile them all. `testAndroidHostTest` was UP-TO-DATE: the classes are byte-identical.

**Lint** (`f020251`). The first final gate failed `lintAndroidMain` with `FlowHttp.kt:134: Error: Found byte-order-mark in the middle of a file [ByteOrderMark]`. The file-writing tool had turned the `\uFEFF` escape in `removePrefix("\uFEFF")` into the character itself. A scan of every changed file found two more decoded escapes in test inputs: a soft hyphen and a no-break space. All three are escapes again, with the same values.

`commonMain` now has no OkHttp, okio, `java.*`, `android.*` or `R.` import. Its `androidx.compose` imports are Compose Multiplatform's common packages, from Stage 1. `FlowApiClientTest`, `OneTimeLinkClientTest`, `OneTimeLinkFlowApiTest`, `OpenVerifyInquiry{OneTimeLink,Request,Activity}Test`, `demo-app`, `openverify-nfc` and every Gradle file are unchanged since `1054236`: `git diff --stat` is empty.

## 4. Public API

A `javap -public` listing of the AAR, Stage 1's method, was diffed against Stage 1's final listing:

- **`OpenVerifyInquiry` and all its nested types:** no change.
- **`FlowApiClient`:** the constructor `(String, String, OkHttpClient, Json)` and its defaults bridge are gone (decision 7). A public `(String, String, Json)` constructor replaces the old default arguments, so Kotlin calls `FlowApiClient(url, token)` and `FlowApiClient(url, token, json = …)` still compile. The `(String, String, io.ktor.client.HttpClient, Json)` constructor is Kotlin `internal`.
- **New facade `dev.openverify.sdk.api.FlowApiClients`:** its public member is `FlowApiClient(String, String, OkHttpClient, Json)`, the decision 7 factory, so a Kotlin call `FlowApiClient(url, token, okHttpClient)` still compiles. Its other members are Kotlin `internal`.
- **Everything else in the diff is Kotlin `internal`,** which the JVM shows as public: `FlowHttp`, `SessionCredentials`, `OneTimeLinkClient`, `ApiBaseUrl`, `HttpUrlParts`, `OneTimeLinks`, `OneTimeLinkParts` and the `*Kt` facades.

## Final gate

```text
$ (cd android && ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 1m 20s
188 actionable tasks: 188 executed
$ (cd android && ./gradlew :openverify-sdk:koverXmlReport)     # that run's report, for the table below
```

`assemble` ran `compileCommonMainKotlinMetadata`, `compileIosMainKotlinMetadata`, `compileKotlinIos{Arm64,SimulatorArm64}` and `compileTestKotlinIos{Arm64,SimulatorArm64}`. The only Kotlin warnings are Stage 1's 11 `KLIB loader … same 'unique_name'` notices. `lint` passes. The host tests print SLF4J's three-line "No SLF4J providers were found" warning once per test JVM. That is the plan's accepted SLF4J line.

**Tests.** There are 905 SDK host tests in 43 classes and 18 demo tests in 3 classes (`DemoFormTest` 10, `DemoViewModelTest` 6, `MainActivityTest` 2). None was skipped, failed or errored. Every one of the 631 baseline lines is present (multiset containment, 0 missing), and each of the 31 baseline classes keeps its count. The full list hashes to `36bf30aab5ce3bb522e6c698cd05c2410061ce521d372e622709f2d1203130c7`.

| Class (under `dev.openverify.sdk`) | Baseline | Stage 1 | Final |
|---|---|---|---|
| `InquiryResultsTest` | 24 | 24 | 24 |
| `InquiryViewModelTest` | 16 | 16 | 16 |
| `OpenVerifyInquiryActivityTest` | 10 | 10 | 10 |
| `OpenVerifyInquiryContractTest` | 11 | 11 | 11 |
| `OpenVerifyInquiryOneTimeLinkTest` | 16 | 16 | 16 |
| `OpenVerifyInquiryRequestTest` | 8 | 8 | 8 |
| `api.ApiBaseUrlParityTest` (new, `androidHostTest`) | – | – | 122 |
| `api.ApiBaseUrlTest` (new, `commonTest`) | – | – | 13 |
| `api.FlowApiClientContractTest` (new, `commonTest`) | – | – | 19 |
| `api.FlowApiClientTest` | 75 | 75 | 75 |
| `api.JsonMediaTypeParityTest` (new, `androidHostTest`) | – | – | 35 |
| `api.OkHttpTransportTest` (new, `androidHostTest`) | – | – | 5 |
| `api.OneTimeLinkClientContractTest` (new, `commonTest`) | – | – | 4 |
| `api.OneTimeLinkClientTest` | 6 | 6 | 6 |
| `api.OneTimeLinkFlowApiTest` | 5 | 5 | 5 |
| `api.OneTimeLinksParityTest` (new, `androidHostTest`) | – | – | 50 |
| `api.OneTimeLinksTest` (new, `commonTest`) | – | – | 8 |
| `camera.CameraFactsTest` | 16 | 16 | 16 |
| `camera.CaptureCameraTest` | 8 | 8 | 8 |
| `camera.CapturePlatformTest` | – | 2 | 2 |
| `camera.CapturedImageTest` | 7 | 7 | 7 |
| `camera.DeviceLabelTest` | – | 7 | 7 |
| `camera.ImageEncodingTest` | 6 | 6 | 6 |
| `camera.LensFacingTest` | – | 4 | 4 |
| `camera.PickedPhotosTest` | 12 | 12 | 12 |
| `camera.TakePictureOrNullTest` | – | 5 | 5 |
| `flow.FlowCoordinatorTest` | 114 | 114 | 114 |
| `flow.FlowNavigatorTest` | 9 | 9 | 9 |
| `flow.JsonLogicTest` | 36 | 36 | 36 |
| `flow.SelfieCaptureProtocolTest` | 3 | 3 | 3 |
| `model.ContractFixturesTest` | 37 | 37 | 37 |
| `model.SelfieCaptureModelTest` | 19 | 19 | 19 |
| `model.WireModelTest` | 23 | 23 | 23 |
| `mrz.BacKeySeedTest` | 13 | 13 | 13 |
| `mrz.MrzTest` | 17 | 17 | 17 |
| `mrz.MrzVectorsTest` | 44 | 44 | 44 |
| `ui.CameraPermissionGateTest` | 6 | 6 | 6 |
| `ui.CaptureScreenTest` | 24 | 24 | 24 |
| `ui.ConsentScreenTest` | 10 | 10 | 10 |
| `ui.InquiryFlowScreenTest` | 16 | 16 | 16 |
| `ui.MessagesTest` | 19 | 19 | 19 |
| `ui.SpanishMessagesTest` | 4 | 4 | 4 |
| `ui.StatusScreensTest` | 17 | 17 | 17 |
| **Total** | **631** | **649** | **905** |

The new cases:

- **`ApiBaseUrlParityTest`:** 112 parity inputs, the 94-character ASCII sweep (one test), 5 IDN cases and 4 stray-escape cases.
- **`OneTimeLinksParityTest`:** 49 links and the IDN case.
- **`commonTest`:** `ApiBaseUrlTest`, `OneTimeLinksTest` and the two contract suites run on the host now and on the iOS simulator from Phase 10. `iosTest/api/IosFlowHttpPlatformTest` (2 tests) compiles only.

**Kover** measures line coverage with the same rule and exclusions:

| Package (under `dev.openverify.sdk`) | Baseline | Stage 1 | Final |
|---|---|---|---|
| root | 98.77% (161 / 163) | 98.77% (161 / 163) | 98.70% (152 / 154) |
| `api` | 98.35% (239 / 243) | 98.35% (239 / 243) | 99.38% (481 / 484) |
| `camera` | 96.77% (90 / 93) | 97.06% (99 / 102) | 97.06% (99 / 102) |
| `flow` | 98.86% (433 / 438) | 98.86% (433 / 438) | 98.86% (433 / 438) |
| `model` | 98.74% (472 / 478) | 98.74% (472 / 478) | 98.74% (472 / 478) |
| `mrz` | 100.00% (17 / 17) | 100.00% (17 / 17) | 100.00% (17 / 17) |
| `ui` | 90.70% (156 / 172) | 90.70% (156 / 172) | 90.70% (156 / 172) |
| **Total** | **97.76% (1568 / 1604)** | **97.77% (1577 / 1613)** | **98.10% (1810 / 1845)** |

The root package lost 9 lines, all covered: `fromOneTimeLink`'s parsing moved into `api/OneTimeLinks.kt`. In `api`, the 3 partly covered lines are a `FlowApi` line from before this stage and the empty `dispose` lambdas of the multipart parts.

**Build time** on this machine with warm caches: 1 min 20 s for the gate (188 tasks), the same as Stage 1's 1 min 21 s.

## Accepted wire differences, as confirmed

1. **A `Content-Length` header on every multipart part.** Ktor writes one on each text part. The SDK declares the file part's, which also keeps the upload's total `Content-Length` and avoids chunked encoding. The boundary is Ktor's random hex instead of OkHttp's UUID.
2. **SLF4J's "no providers" warning,** printed once per process on Android.
3. **No `Accept-Charset`.** Unlike the plan's list, none is sent. Ktor 3.5.2 adds it only for charsets other than UTF-8.

## Decisions (for the plan; `docs/plans/` is Stage 4's to edit)

1. **The `expect` declarations live in `commonMain/api/FlowHttpPlatform.kt`,** with `flowHttpClient(engine)`. The actuals and the OkHttp factories are in `androidMain/api/FlowHttpPlatform.android.kt` and `iosMain/api/FlowHttpPlatform.ios.kt`, not in `FlowHttp.android.kt` or `FlowHttp.ios.kt`. The iOS actual needs `flowHttpClient` while `FlowHttp.kt` was still in `androidMain`, and `FlowHttp.kt` could not hold an `expect` before its move. This keeps the move a pure rename, as Stage 1 did with `CapturePlatform.kt`.
2. **The parser lives in `api/ApiBaseUrl.kt`,** with `HttpUrlParts` (the WHATWG-style splitter that `OneTimeLinks` also uses). `SessionCredentials.parseApiBaseUrl` delegates to it.
3. **A path prefix with `%` outside a `%XX` escape is refused.** This is a second difference from HttpUrl, found in GREEN: Ktor's `Url` throws `URLDecodeException` on it, so no request could be made.
4. **JSON is read as UTF-8** (RFC 8259 §8.1), and a leading BOM is skipped as OkHttp skipped it. A `charset` parameter other than UTF-8 is no longer followed. Our API always sends UTF-8, and this keeps Android and iOS alike: the Darwin engine knows only UTF-8 and ISO-8859-1.
5. **`xn--` labels are taken as written** (lower-cased), as decision 3 says. OkHttp also punycode-decodes them: it refuses malformed ones, and rewrites some (an `xn--abc-` label becomes `abc`). On Android, such a host passes construction and then fails each request with an `IllegalArgumentException`, which `FlowCoordinator` shows as `INVALID_RESPONSE`.
6. **The public JVM facade of the OkHttp factory is named `FlowApiClients`,** through `@file:JvmName`, so Java calls `FlowApiClients.FlowApiClient(…)`.
7. **A host app's own `OkHttpClient` keeps its `retryOnConnectionFailure`.** Ktor's OkHttp engine config forces it on, so `okHttpFlowClient` restores it. The shared client now refuses redirects itself, besides Ktor's `followRedirects = false` and the engine's own override.

## Follow-ups

- **Phase 10 (macOS CI):** run `iosSimulatorArm64Test`, which covers the common contract suites and `IosFlowHttpPlatformTest`. Check Darwin redirects, timeouts (NSURLSession's default is 60 s without data, against Android's 15/30/60 s) and cancellation on a device.
- **Stage 4:** amend K4's accepted list (no `Accept-Charset`; add the escape refusal and UTF-8 decoding), and K2's file names (`ApiBaseUrl.kt`, `FlowHttpPlatform{,.android,.ios}.kt`). Add `src/iosTest/kotlin/dev/openverify/sdk/api/` to K1. Licence rows for Ktor and kotlinx-io already exist in Stage 1's list; this stage adds no dependency.
- **A malformed `xn--` API host** fails at request time on Android instead of at construction (decision 5). A punycode check in common code would close that gap if it matters.
