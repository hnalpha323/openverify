# Phase 10, Workflow 10E, Stage 2: nfc-reader (the JMRTD reader in `openverify-nfc`, P1 granted)

Evidence for C209.2 to C209.4, the demo's reader check (C209.6) and known item KP10-43. Every step was test-first: stubs, then the tests seen failing for the intended reason (RED), then the implementation (GREEN). Commands ran from `android/` after `source scripts/env.sh`, each Gradle call as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...`. Output is abbreviated; counts are read from the tests' result files, never from a printed summary.

No real document was read by anyone. Chip data here is synthetic: the Utopia chip of `contracts/fixtures/emrtd/utopia-chip.json` and made-up bytes.

## 1. What was built

| Part | Files (under `android/openverify-nfc/src/main/kotlin/dev/openverify/nfc/` unless said) |
|---|---|
| The testable core | `ChipSession.kt` (the seam and `ChipFile`), `ChipReadOrchestrator.kt`, `ChipFailures.kt`, `LibraryLoggers.kt` |
| The JMRTD adapter | `JmrtdChipSession.kt` (the module's one Kover exclusion) |
| The reader | `NfcPort.kt` (`NfcPort`, `ChipFound`, `AdapterNfcPort`), `ResumedActivity.kt`, `NfcChipReader.kt`, `OpenVerifyNfc.kt` |
| The licence boundary | `consumer-rules.pro`, `src/main/resources/META-INF/openverify-nfc/` (four licence texts, `SOURCE.txt`, `NOTICE`), `NOTICE`, `README.md` |
| The demo | `android/demo-app/src/readerCheck/` (`ReaderCheck.kt`, `ReaderCheckActivity.kt`, strings, manifest); the hook `src/nfc/kotlin/.../NfcArtifact.kt` is as Stage 1a wrote it and now gives the real reader |

## 2. Checkpoint 1: the testable core (C209.3)

Stubs `e615ae5e9`, RED `fca9c8096`, GREEN `633b7f3ef`.

RED, on the stubs (`:openverify-nfc:testDebugUnitTest --tests 'dev.openverify.nfc.Chip*' --tests 'dev.openverify.nfc.LibraryLoggersTest'`):

```
ChipFailuresTest > a transport failure at the root is a lost chip() FAILED
ChipReadOrchestratorTest > a chip without EF CardAccess is opened with Basic Access Control, then read file by file, then asked to sign() FAILED
ChipReadOrchestratorTest > a chip that leaves the field is tag lost, at every step() FAILED
LibraryLoggersTest > a scripted read emits no record of the libraries' loggers() FAILED
... (43 lines)
48 tests completed, 43 failed
BUILD FAILED in 25s
```

The five that passed on the stubs assert constants of `ChipFile` and that the scripted chip's own logging reaches a handler outside a read.

GREEN: `BUILD SUCCESSFUL`; result files: `ChipReadOrchestratorTest` 37, `ChipFailuresTest` 7, `LibraryLoggersTest` 4, no failure.

What the tests hold, over `ScriptedChipSession` (a scripted fake that also logs through the libraries' loggers at every call):

- **Order.** Connect; EF.CardAccess; PACE when it is offered, with the MRZ key or the CAN, else BAC; DG14 and Chip Authentication when offered; COM, SOD, DG1, DG15, DG2; Active Authentication over the 8-byte nonce; close.
- **Fallbacks.** PACE refused with the MRZ key is followed by BAC; a CAN opens nothing but PACE; a file refused in a large block is read again in small ones, and the reader then stays with small blocks.
- **Files.** Only the kinds the server takes; no entry for DG11 or DG12; 1 MiB for DG2 and 64 KiB for the others, checked before reading; an empty or short file is refused.
- **Reported only.** PACE, PACE-CAM, BAC, Chip Authentication and Active Authentication outcomes go into `ChipDeviceReport`; the response is returned as given, `null` when the chip refuses or it is longer than 768 bytes.
- **Errors.** Every failure becomes one `ChipReadFailure` with the SDK's fixed message, no cause and nothing suppressed; the messages the fake throws hold a canary.
- **Loggers.** `org.jmrtd`, `net.sf.scuba` and `org.ejbca` are off for the read and put back after it, also when it fails; no record reaches a handler.

## 3. Checkpoint 2: the adapter and the JVM test of the real JMRTD service (C209.3)

Stub and Kover line `2df6440d1`, RED `220dcc0b8`, GREEN `dc9fad20d`.

RED (`--tests 'dev.openverify.nfc.JmrtdChipSessionTest'`): `16 tests completed, 12 failed`. The four that passed are the test's own arithmetic against the ICAO worked example and the CAN case, which need no adapter.

GREEN: 17 of 17 (one test, the responder's negative control, was added with the implementation; the provider assertion was changed to compare the installed providers before and after by identity, because Robolectric installs a provider of its own in the same JVM).

- **The responder** (`UtopiaChipResponder`, test code): a SCUBA `CardService` that answers selection, GET CHALLENGE and EXTERNAL AUTHENTICATE (BAC), secure messaging with the session keys (it checks every command's checksum and counter and protects every answer), READ BINARY in short and long blocks, and INTERNAL AUTHENTICATE for the nonces the fixture lists. **It implements no PACE and no Chip Authentication**, and the fixture has no EF.CardAccess and no Chip Authentication key: **PACE runs in no automated test**, and neither does Chip Authentication.
- **The worked example** (ICAO Doc 9303 Part 11, Appendix D): the test's key derivation gives K_seed `239ab9cb…fbae`, K_enc `ab94fdec…76f2`, K_mac `7962d9ec…1543`; its cipher and checksum give the example's cryptogram, checksum `5f1448eea8ad90a7` and session keys. JMRTD then opens a responder keyed with that document (`L898902C<`, `690806`, `940623`), and a protected command is answered, so JMRTD's derivation and session keys agree with the standard's.
- **The read.** JMRTD's `PassportService`, through `JmrtdChipSession` and the orchestrator, reads the six files byte for byte, all under secure messaging, selects nothing but the six and EF.CardAccess, and returns the fixture's Active Authentication response for the nonce `0011223344556677`, which the JDK verifies with DG15's key (the reader itself verifies nothing).
- **Errors as JMRTD raises them.** A wrong MRZ key is `access_denied`; a chip that leaves at command 1, 3, 4, 9 or 30 is `tag_lost`; a nonce the chip cannot sign gives no response and the files.
- **Providers.** `Security.getProviders()` is the same list of the same objects after a read. JMRTD 0.8.9 makes its own `BouncyCastleProvider` object (`org.jmrtd.Util`) and passes it to each algorithm; nothing installs one.

**The Kover exclusion** (C219.2), one line in `kover-excludes/nfc-reader.txt`: `dev.openverify.nfc.JmrtdChipSession*`. Reason: its PACE, Chip Authentication and ISO-DEP halves need a phone and a chip. The JVM test above runs its BAC, read and Active Authentication half. Module coverage with the exclusion: 192 of 196 lines (97.9%).

## 4. Checkpoint 3: the reader (C209.2)

Stubs `ac4738e75`, RED `8b7ec5dd1`, GREEN `9741290ae`, device-test change `b780a0c2a`, signature kept `86366b95a`, read limit `2ee5f3247`.

RED on the stubs: `102 tests completed, 24 failed`, for example:

```
NfcChipReaderTest | a read turns reader mode on for the resumed screen => expected:<[enable]> but was:<[]>
NfcChipReaderTest | a phone without NFC, or with NFC off, ends the rea => expected:<NFC_DISABLED> but was:<READER_BUSY>
AdapterNfcPortTest | NFC is ready when the phone has it and it is on => java.lang.AssertionError
ResumedActivityTest | the resumed activity is known from its resume to i => expected same:<android.app.Activity@…> was not:<null>
```

GREEN: 102 of 102. Two things were found on the way and fixed before the commit:

- Three tests run the chip on a real thread. Under virtual time the read's limit fired while that thread still worked, so those three run in real time and depend on no duration.
- A failed read thrown inside the reading thread outranked the limit that had ended it (`TAG_LOST` instead of `TIMEOUT`). The reading thread now hands a failed read back as a value.

**The route from the installed reader to the resumed activity** is the one the inventory records, with no public change: the reader keeps the application's context, registers `Application.ActivityLifecycleCallbacks` (`ResumedActivity`), holds the resumed activity weakly, and turns reader mode on for it when a read is asked for. It also turns reader mode off itself when that activity is paused.

**Device test** (`src/androidTest/.../ChipReaderDeviceTest.kt`, 2 tests, connected task `:openverify-nfc:connectedDebugAndroidTest`). It asserts what the device it runs on reports and never skips; each branch is named in the source.

Run on **a Pixel 9, Android 17**, under the device lock, the result read from the instrumentation's XML (`android/openverify-nfc/build/outputs/androidTest-results/connected/debug/TEST-Pixel 9 - 17.xml`):

```
# at 2ee5f3247, the phone unlocked: dumpsys nfc before and after: mScreenState=ON_UNLOCKED
<testsuite name="dev.openverify.nfc.ChipReaderDeviceTest" tests="2" failures="0" errors="0" skipped="0" time="5.610" timestamp="2026-11-11T17:59:38">
$ bash ../infra/scripts/check-connected-results.sh openverify-nfc openverify-nfc=2
dev.openverify.nfc.ChipReaderDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
connected tests: 2 passed
```

Gradle's task ended `BUILD FAILED` although both tests passed: KP10-31 (the wireless adb serial holds a colon).

Two earlier runs:

- At `9741290ae` both tests failed with a timeout. The phone was asleep and locked (`mScreenState=OFF_LOCKED`), so the test's screen was never resumed and the reader answered `reader_busy` (seen in the module's own log tag). The test's screen now shows itself over a lock screen, and a read that ends early fails with the failure's name instead of a timeout. No bound or requirement changed.
- At `b780a0c2a`: 2 of 2 with the phone locked (`ON_LOCKED`), when a phone does not poll.

Open: the branch for a device without an adapter or with NFC off has not run on a device.

## 5. Checkpoint 4: the licence boundary (C209.4) and KP10-43

**KP10-43.** RED `f321d5558`, GREEN `0f487f7e9`.

RED: `python3 -I -m unittest discover -s scripts/tests` gave `FAILED (failures=1)` (`test_openverify_nfc_keeps_the_lgpl_libraries_and_what_their_provider_resolves_by_name`: `[] != ['-keep class org.jmrtd.** { *; }', …]`), and `ConsumerRulesTest` 4 of 4 failed. 89 script tests before and after (one renamed, none removed).

What a minified build showed, before the rules (`-PopenverifyDemoArtifacts=sdk,nfc :demo-app:assembleRelease`, the reader present, the rules still comments): `org.jmrtd.PassportService -> ij3`, `net.sf.scuba.smartcards.IsoDepCardService -> sh2`, and no `org.bouncycastle.jcajce.provider.symmetric.DESede$Mappings` or `DESede$CBC` at all. JMRTD asks its provider for the retail MAC by name, and the provider loads classes by names it holds as text, so R8 had removed them.

The six rules: the three keeps of the LGPL libraries; `-keep` for `org.bouncycastle.jcajce.provider.**` and `org.bouncycastle.jce.provider.**`; `-keepnames` for the rest of Bouncy Castle. None names `dev.openverify` or `kotlinx.serialization`. `ConsumerRulesTest` reads the provider's own list of class names (1,434) and holds every one outside the post-quantum package to a kept package.

Proved where R8 applies them:

| | Before the rules | After |
|---|---|---|
| `sdk,nfc` release APK, dex classes | 6,192 | 9,813 |
| dex bytes | 5,756,064 | 8,728,232 |
| unsigned APK bytes | 10,294,326 | 11,392,090 |
| JMRTD, SCUBA, cert-cvc, Bouncy Castle classes renamed | all of JMRTD and SCUBA | none (six R8-made helper classes only) |
| `DESede$Mappings`, `DESede$CBC`, `ISO9797Alg3Mac` | absent | present, under their names |

- `minifiedSmoke` with `sdk,nfc`: 10,231 dex classes; `:demo-app:traceSmokeTestKeepRules` and `:demo-app:checkSmokeTestReferences` passed.
- `python3 -I scripts/check-consumer-rules.py`: `openverify-nfc-release.aar ships 6 consumer rule(s), as committed`; release and minifiedSmoke passed.
- Negative control: with one rule commented in the committed file and the AAR unchanged, the check printed `FAIL: openverify-nfc-release.aar ships [...], not the committed` and exited 1; restored, it exited 0.
- The consumer check (`-p consumer-check build`), which minifies an app from the staged AARs, passed with the rules.

Not shown: the minified app reading a chip. That needs a phone and a document, and the reader check is a debug build.

**The papers.** RED `5ade05d9b` (5 of 5 failed), GREEN `eed2871a2`. The four texts were copied by command from SPDX license-list-data v3.27.0 (`curl …/v3.27.0/text/<id>.txt`, then `cp`), never typed:

| File | SHA-256 |
|---|---|
| `LGPL-2.1-or-later.txt` | `5749785c…81d2` |
| `LGPL-3.0-or-later.txt` (with the GPL version 3 it adds to) | `996af051…ccb1` |
| `GPL-2.0-only.txt` | `aaf13547…0df3` |
| `Classpath-exception-2.0.txt` | `f36ecd7d…f194` |

`unzip -l classes.jar` of the release AAR lists `META-INF/openverify-nfc/NOTICE` and the four texts with `SOURCE.txt`. `LicenceTextsTest` holds each digest, the copy of `NOTICE`, the two SCUBA files' source location, and the README's statements.

## 6. Checkpoint 5: the demo (C218.1, C209.6)

RED `6902858a5`, GREEN `133b8a266`, strings and README `31a3f287f`.

RED, with the screen's sources moved aside (`-PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest --tests 'dev.openverify.demo.ReaderCheckTest'`): `8 tests completed, 7 failed`.

GREEN: the demo's debug tests are 96 and its smoke twins 9, in each of the four configurations (88 and 8 before).

- **Only in a debug build with `nfc`:** the class and its activity exist exactly there; the release manifest never names it; the build file names `src/readerCheck` only in the debug source set; `ReaderCheckAbsentTest` holds the minified build.
- **Pass or fail only:** the screen's whole text holds no byte of the fake chip as text or hex, no count and no timing.
- **No network, no flow, no file:** `FlowTransport` cannot be subclassed outside the SDK, so the tripwire is the JVM's default proxy selector, which HTTP clients ask before they connect; a control shows it refuses a connection. No SDK event is emitted and the app's data directory is unchanged, also after the screen is recreated, which clears the typed key.
- **Dropped at once:** every array the fake reader handed out is all zeros before the result is shown.
- **Stops when left:** pausing the screen cancels the read.

## 7. The gate at the end

Rule 17's eleven calls, in order, in one session, then `pnpm format:check`. Wall time, lock wait and load are beside each.

| Call | Result | Wall, lock wait, load |
|---|---|---|
| (1) ui | **failed: 1 of 522**, `A11yTimingTest` (below) | 445 s, 197 s, 8.7 |
| (1) flow | exit 0, 416 tests | 288 s, 216 s, 3.7 |
| (1) rest | exit 0, 1,752 tests | 100 s, 0 s, 3.0 |
| (2) screenshots | exit 0 | 11 s, 0 s, 2.2 |
| (3) `koverVerify checkKotlinAbi` | **failed** on the same one test; `:openverify-nfc:koverVerify checkKotlinAbi` exit 0 | 196 s, 0 s, 2.1 |
| (4) `testDebugUnitTest assembleDebug` | exit 0: nfc 111, demo 96 and 9, face 51 | 50 s, 0 s, 2.2 |
| (5) release APK, bundle, both AARs | exit 0 | 135 s, 0 s, 3.2 |
| (6) `:openverify-sdk:assemble` | exit 0 | 11 s, 0 s, 7.7 |
| (7) `lint` | exit 0 (nfc: 0 errors) | 42 s, 0 s, 6.8 |
| (8) device-test compile, four modules | exit 0, `checkSmokeTestReferences` ran | 115 s, 0 s, 5.4 |
| (9) release checks | script tests **1 of 89 failed** (`test_openverify_face_ships_no_rule_of_its_own_yet`, face-onnx's rules in progress); elf, consumer rules and size exit 0 | no lock |
| (10) staging, consumer check | exit 0, exit 0 | 24 s and 151 s, 0 s |
| (11) `sdk,nfc`, `sdk,face`, `sdk,nfc,face` | exit 0 each, 96 and 9 | 61, 56, 55 s, 0 s |
| `pnpm format:check` | exit 0 | 112 s, load 4.4 |

**The one failure that is this agent's doing and not its to fix.** `A11yTimingTest` (the SDK's, a shared file) lists every duration in the shipped sources and fails on a new one until `docs/android/accessibility.md` classifies it. The reader adds three: 5 s for one exchange, 5 minutes of waiting, 5 minutes for a read. Both files are outside nfc-reader's paths, so the exact change is in the report's contract deviations for integration-10e. Nothing was renamed to hide a duration from the scan.

## 8. Device proofs

- Ran: `ChipReaderDeviceTest`, both methods, adapter-on branch, on a Pixel 9, Android 17 (section 4).
- Open: the same two methods' branch for a device without an NFC adapter or with NFC off (an emulator, or a phone with NFC off).
- Open: the reader against a real chip, in the demo's reader check (decision 48): the owner's step.
- Open: the minified `sdk,nfc` build reading a chip (the consumer rules at run time).
