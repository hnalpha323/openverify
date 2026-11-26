# openverify-nfc

Optional add-on to the OpenVerify Android SDK: the reader of the NFC chip in electronic passports and identity cards (ICAO Doc 9303 eMRTD). It implements the SDK's `ChipReader`, so an `nfc` step can read a real document on a phone with NFC.

> **Status: the reader is built, and proved on the host only.** It is proved by its own host tests and by a JVM test of the real JMRTD service against a synthetic chip (below). **No real document has been read with this module yet:** that read is the owner's step, on a real phone, in the demo's reader check. PACE runs in no automated test, and neither does Chip Authentication. No conformance with ICAO or BSI test specifications is claimed.

The device reads and the server verifies. Nothing this module returns is a verdict: Passive Authentication, Active Authentication over the server's nonce, and the bindings of the chip's data to the photographed document and the selfie are the server's ([`docs/checks/nfc.md`](../../docs/checks/nfc.md)).

## Adding it to an app

Add the module beside the SDK ([`docs/android/release-and-support.md`](../../docs/android/release-and-support.md) says how the artifacts are obtained; no coordinates are published yet), then:

```kotlin
// build.gradle.kts of the app
android {
    packaging {
        // Both Bouncy Castle jars carry the same licence text at this path, and the packager
        // refuses two files at one path. A library cannot set this for its host.
        resources { pickFirsts += "META-INF/LICENSE.md" }
    }
}
```

```kotlin
// Application.onCreate
@OptIn(ExperimentalOpenVerifyApi::class)
OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = OpenVerifyNfc.chipReader(this)))
```

Call the factory once, when the process starts. The reader keeps the application's context and follows which of the app's activities is resumed; when the SDK's tap screen asks for a read, reader mode is turned on for that activity. Your app needs no R8 rule for the module: its consumer rules travel in the AAR.

The module's manifest declares `android.permission.NFC` (a normal, install-time permission) and `android.hardware.nfc` as **not required**, so an app that adds the module stays installable on phones without NFC. The core SDK declares neither.

## What a read does

One read is one tap. `OpenVerifyNfc.chipReader(context)` gives a `ChipReader` whose `read`:

1. turns on `NfcAdapter` reader mode for the resumed activity, for NFC-A and NFC-B with the NDEF check skipped, and waits for a document. Reader mode is on only while that screen is resumed and a read waits or talks; it is turned off when the read ends, is stopped, or the screen is left;
2. connects with ISO-DEP (a raised timeout; extended-length commands where the tag takes them) and reads EF.CardAccess;
3. opens the chip: **PACE** when EF.CardAccess offers it, with the MRZ key or the card access number (CAN); otherwise **BAC** with the MRZ key. A chip that refuses PACE with the MRZ key is tried with BAC. A CAN opens nothing but PACE;
4. reads DG14 and runs **Chip Authentication** when DG14 offers it, so that the rest is read under its keys;
5. reads the other files the server takes: EF.COM, the security object (EF.SOD), DG1, DG15 and DG2. **DG11 and DG12 are never read**: the module has no entry for them. A file is not read past what the server takes for it (1 MiB for DG2, 64 KiB for the others);
6. asks the chip to sign the server's 8-byte nonce (**Active Authentication**) when the chip has DG15, and returns the response as the chip gave it, unverified.

What the device did in steps 3, 4 and 6 goes into the device report, which operators see as what the device says, never as evidence.

- **Failures** are the SDK's `ChipReadException` with one of six reasons (`tag_lost`, `access_denied`, `unsupported_document`, `timeout`, `nfc_disabled`, `reader_busy`) and a fixed message. No message, status word or byte of JMRTD, SCUBA or the chip is passed on.
- **Nothing is kept.** The chip's bytes exist only in the result the read returns; the module writes no file, preference or log line with them. Its one logger writes constant codes, and only in a debuggable app. The `java.util.logging` loggers of JMRTD, SCUBA and cert-cvc are turned off for the read and put back after it.
- **Bouncy Castle is not installed as a security provider.** JMRTD makes a provider object for itself and passes it to each algorithm it asks for; the list of installed providers is the same after a read.
- **Off the main thread.** The exchange with the chip runs on an I/O thread; progress is told on the caller's.
- **An unusable optional file is read as absent.** An optional file (EF.CardAccess, EF.COM, DG14, DG15) that the chip says is empty, and an EF.CardAccess that cannot be parsed, are left out, so the MRZ key still opens such a chip with BAC. A file longer than the server takes still ends the read as `unsupported_document`.
- **Not read: EF.CardSecurity.** JMRTD 0.8.9 gives no secured route to a master-file file after PACE, so the module leaves that file out. The server takes it only when a chip has it.
- **Provisional constants**, each with its basis in the source: 5 s for one exchange, 1,024-byte blocks on a tag that takes extended-length commands (a refused large block is read again in 224-byte blocks), 5 minutes of waiting for a document, 5 minutes for a read once a chip answers. Checksums of the chip's protected answers are not checked on the device (JMRTD's own default): the server's Passive Authentication is what holds the bytes.

## What is proved, and how

| What | How | Where it ran |
|---|---|---|
| The protocol order, the fallbacks, the file list and limits, progress, and the mapping of every failure to one reason | Host tests of the orchestrator over a scripted chip (`ChipReadOrchestratorTest`, `ChipFailuresTest`) | The build host |
| No library log record during a read, and the loggers put back | `LibraryLoggersTest` | The build host |
| The real JMRTD service: BAC with its secure messaging, file selection and reads in short and long blocks, and INTERNAL AUTHENTICATE over a given nonce | `JmrtdChipSessionTest`: JMRTD's `PassportService`, through the module's adapter, against an in-process chip that answers the commands of the synthetic Utopia chip (`contracts/fixtures/emrtd/utopia-chip.json`), with the key values of ICAO Doc 9303 Part 11's worked example | The build host (JVM) |
| Reader mode on for the resumed screen and off on every way out, one read at a time, the limits, the chip off the caller's thread | `NfcChipReaderTest` over a fake of the phone's NFC; `AdapterNfcPortTest` over Robolectric's adapter | The build host |
| What a device's own NFC adapter does when the reader asks for reader mode, with no chip in the field | `ChipReaderDeviceTest` (2 tests), which asserts what the device it runs on reports | A Pixel 9, Android 17 (its adapter-on branch; see below) |
| The consumer rules in a minified app | The minified demo with this module: no class of JMRTD, SCUBA, cert-cvc or Bouncy Castle is renamed, and the classes Bouncy Castle's provider loads by name are present | The build host (R8's output; the minified app was not run against a chip) |

The device test ran on a Pixel 9 (Android 17) at commit `2ee5f3247`, with the phone unlocked, its NFC on and polling, and no chip near it: 2 of 2 passed, read from the instrumentation's result file. That is the test's adapter-on branch: the platform took reader mode for the resumed screen, the read waited and reported only that, no session with any chip was started, and reader mode was turned off when the screen was left and when the read was stopped. (An earlier run at `b780a0c2a` passed with the phone locked, when a phone does not poll.) On this phone Gradle's connected task ends as failed whatever the tests did, because the wireless adb serial holds a colon; the result is read from the result file.

What is **not** proved:

- **PACE runs in no automated test**: the in-process chip implements BAC only, and the synthetic chip has no EF.CardAccess. The PACE and Chip Authentication calls of the adapter are JMRTD's, in the order the host tests hold over the scripted chip.
- **No real document has been read.** The owner reads a real passport or identity card on a real phone in the demo's reader check, which shows pass or fail per protocol and file and sends and stores nothing. Until that is recorded, the reader is proved only by the JVM test against a synthetic chip.
- **The device test's other branch**: on a device without an NFC adapter, or with NFC off, the test asserts that a read ends at once as `nfc_disabled`. That branch has not run on a device.
- The sandbox test chip of the core SDK proves the flow and the server's checks, never this reader.

## Dependencies and their licences

| Library | Version | Licence |
|---|---|---|
| JMRTD (`org.jmrtd:jmrtd`) | 0.8.9 | `LGPL-2.1-or-later` (its source files; the POM says "LGPL" without a version) |
| cert-cvc (`org.ejbca.cvc:cert-cvc`), a JMRTD dependency | 1.4.13 | `LGPL-2.1-or-later` |
| SCUBA (`net.sf.scuba:scuba-smartcards`, `net.sf.scuba:scuba-sc-android`), the smart-card layer JMRTD builds on | 0.0.21, 0.0.27 | `LGPL-2.1-or-later`, except two files (below) |
| Bouncy Castle (`bcprov-jdk18on`, `bcutil-jdk18on`) | 1.86 | MIT |

They arrive by Maven coordinates through the module's POM, never shaded or copied; the AAR holds none of their code. cert-cvc's own older Bouncy Castle jar is excluded, since it holds the same classes.

- **Two SCUBA files are under another licence.** `CommandAPDU.java` and `ResponseAPDU.java` in `scuba-smartcards` are Oracle's files under **`GPL-2.0-only WITH Classpath-exception-2.0`**. The project's licence rule refuses GPL code, so they are here under a recorded exception, granted narrowly on 2026-11-08 (Phase 10 owner item P1, decided under the owner's delegation): those two files, unmodified, taken from Maven Central, only inside this optional artifact. The Classpath exception exists so that independent modules may link the files on their own terms. Their source is in `scuba-smartcards-0.0.21-sources.jar` on Maven Central (`https://repo1.maven.org/maven2/net/sf/scuba/scuba-smartcards/0.0.21/`).
- **The licence texts travel in the AAR**, as resources of its classes, under `META-INF/openverify-nfc/`: `licenses/LGPL-2.1-or-later.txt`, `licenses/LGPL-3.0-or-later.txt` (with the GPL version 3 it adds to), `licenses/GPL-2.0-only.txt`, `licenses/Classpath-exception-2.0.txt`, and `NOTICE`, which names the two files' source location. Each text was copied by a command from release v3.27.0 of SPDX's licence list and is held to its digest by a test.
- **Consumer R8 rules** (`consumer-rules.pro`, in the AAR) keep `org.jmrtd.**`, `net.sf.scuba.**` and `org.ejbca.cvc.**` whole and under their own names, so the LGPL libraries stay replaceable in a minified app. They also keep the classes Bouncy Castle's provider loads by name (`org.bouncycastle.jcajce.provider.**`, `org.bouncycastle.jce.provider.**`), which R8 cannot see are used, and hold Bouncy Castle's names. No rule names the SDK or your app.

This module's own code is LGPL-3.0, which the libraries' "or later" grants allow (`docs/research/phase5-nfc.md` §7.1).

## What your app takes on (not legal advice)

An app that includes this module distributes LGPL libraries, and with them obligations of its own. In outline, for you to check with your own counsel:

- **Replaceability (relinking).** Your users must be able to replace the LGPL libraries with a modified version and run your app with it. Keep the libraries as separate, unobfuscated classes (the module's consumer rules do), and do not forbid the reverse engineering needed to debug such a modification: your app's terms may not ban it for these libraries.
- **Notices.** Ship the libraries' copyright notices and licence texts with your app, and say that it uses them. The texts are in the module's AAR (above), so they are in your app unless your build removes them.
- **Source.** Offer the libraries' source, or point to where it is published (Maven Central's sources jars for the versions you ship).
- **The two SCUBA files** come under GPL version 2 with the Classpath exception: ship that licence text too, and leave the files unmodified.

An app that does not add this module has none of these obligations: the core SDK is Apache-2.0 and names none of these libraries.

## Android only; iOS reads the chip separately

`:openverify-sdk` is a Kotlin Multiplatform library (Android now, iOS later; `docs/adr/0004-mobile-kotlin-multiplatform.md`). This module is not: it stays a plain Android library, because JMRTD and SCUBA are Java-only and their LGPL code must stay in this one artifact.

On iOS, the next release reads the chip through Apple's CoreNFC with NFCPassportReader (MIT), in a Swift package under `ios/` (decision 6 of `docs/plans/kmp-migration.plan.md`). It is a separate component with its own licence row, and it never links JMRTD.

The interface both readers implement, `ChipReader`, and the MRZ key seed input, `BacKeySeed.mrzInformation`, live in the SDK's common code. `ChipReader.read` is experimental (`@OptIn(ExperimentalOpenVerifyApi::class)`) until the iOS reader shows the interface fits it.

## Tests

```bash
cd android
./gradlew :openverify-nfc:testDebugUnitTest :openverify-nfc:koverVerify    # host tests; line coverage gated at 80%
./gradlew :openverify-nfc:assembleDebugAndroidTest                         # compiles the device test
./gradlew :openverify-nfc:connectedDebugAndroidTest                        # runs it on a connected device
```

The coverage gate leaves out one class, the JMRTD adapter (`JmrtdChipSession`), because the half of it that needs a phone and a chip cannot run on the host; the JVM test above runs the other half.
