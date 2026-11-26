# Phase 10, Workflow 10C: release-checks (family D)

Agent `release-checks`, Stage 2, beside `nfc-sdk`, `api-nfc`, `demo-app`, `docs-android` and
`privacy-checks`. Deliverables: the consumer R8 rules and their proof on the minified demo (C215.1,
C215.4), the 16 KB checks (C216.1), the size baseline (C216.2, C216.3), the staged repository, the
consumer check and the release workflow (C217.2 to C217.4), and the lock and verification state of
what these resolve (C214.5).

Commands ran after `source scripts/env.sh`. Every Gradle call ran from `android/` as
`flock -E 75 -w <n> /tmp/openverify-gradle.lock ./gradlew --no-daemon ...`; outputs are abbreviated.
Times are wall seconds, with the lock wait and `cat /proc/loadavg` beside them. Five agents shared
the Gradle lock, so waits of 2 to 6 minutes were normal and several calls first ended with exit 75
(lock busy), which is recorded as such and never as a failure.

**No device ran any of this.** The host has no `/dev/kvm` and no attached device, and no CI run can
be counted on (rule 28). What only a device can show is listed in section 9.

## 1. What was there (contracts-10c's skeleton, read at `1696e9d8`)

- `android/scripts/check-elf-alignment.py` and `check-size.py`: stubs that printed `not-built` and
  exited 0. `android/consumer-check/`: a `base` project that only checked that the staged directory
  existed. `.github/workflows/android-release.yml`: one `notice` job.
- Both `consumer-rules.pro` files: comments only, wired into the AARs.
- The demo's `release` and `minifiedSmoke` build types built, with R8 in full mode.
- `infra/tests/ci-workflow.test.sh` had no section for `android-release.yml` (266 checks, all for
  `ci.yml`).

## 2. The release-check scripts (stdlib `unittest`, synthetic inputs only)

Tests: `android/scripts/tests/` (`support.py` builds synthetic ELF files; nothing reads a real
library, APK or size report). Run: `python3 -I -m unittest discover -s android/scripts/tests`.

**Stubs** `9ee6a687` (`check-consumer-rules.py`, `check-staged-repository.py`), later `44e316fb`
(`trust-staged-group.py`).

**RED** `65ed838b`:

```
$ python3 -I -m unittest discover -s android/scripts/tests
AttributeError: module 'check_staged_repository' has no attribute 'check_repository'
AttributeError: module 'check_staged_repository' has no attribute 'root_variants'
...
Ran 77 tests in 0.615s
FAILED (errors=101)
```

Every error was a missing function of a stub (the intended reason: nothing was built).

**GREEN** `540b70dd` (the four scripts): 75 of 77 passed. The two left were the committed-file tests,
which were still RED for their own reason and went GREEN with their deliverables:

```
FAIL: test_the_sdk_keeps_the_names_of_the_decoding_exceptions_and_nothing_else
AssertionError: Lists differ: ['-keepnames class kotlinx.serialization.S[93 chars]ion'] != []
ERROR: test_it_holds_the_two_existing_configurations_for_the_same_abis_and_no_other
FileNotFoundError: ... android/size-baseline.json
```

`34acafe4` (the rules) and `c28d9dcb` (the baseline) closed them: `Ran 77 tests ... OK`.
`74ef6b1e` (RED, 5 errors: `trust_group` missing) and `e4ad2700` (GREEN) added the verification-metadata
tool: `Ran 82 tests ... OK`.

One test of mine changed after RED, with the reason: `test_one_reference_device_per_abi` read
`REFERENCE_DEVICE["supportedLocales"]`; the reference device became one `locale`, so that
`size-baseline.json` holds no array and passes `prettier --check --ignore-path=.gitignore`.

What each script holds:

| Script | What it checks | Fails when |
|---|---|---|
| `check-elf-alignment.py` | `p_align` of every `PT_LOAD` of every `jni/*/*.so` in every built AAR and every `lib/*/*.so` in the minified demo APK (ELF32 and ELF64, either byte order); `zipalign -c -P 16 -v 4` on that APK; `bundletool dump config` naming `PAGE_ALIGNMENT_16K` | a segment is under 16 KB or no multiple of it; a library has no load segment or is no ELF; no AAR was built; the APK holds no native library (the scan would prove nothing); zipalign or bundletool is missing or fails |
| `check-size.py` | download and install size per ABI of a configuration against `size-baseline.json` | a figure grew by more than 10%; an ABI is on one side only; the bundle is not the configuration named (told by the NFC permission); the configuration's artifact does not exist |
| `check-consumer-rules.py` | the rules in the built AARs, in R8's merged `configuration.txt` and in its `mapping.txt` | the AAR's `proguard.txt` differs from the committed file; the rules did not reach the consumer; a kotlinx.serialization exception class was renamed; the anchors are missing |
| `check-staged-repository.py` | the staged repository: three modules, files, four checksums each, POM members, licences, OkHttp at `compile`, no optional or copyleft dependency, the root's Android variant, the AAR's rules, real javadoc and sources, no key, nothing for iOS | any of them is missing or wrong |
| `trust-staged-group.py` | rewrites the consumer check's verification metadata (section 6) | (a tool, not a check) |
| `scan-staged-repository.sh` | unpacks every staged AAR and jar (and `classes.jar` inside an AAR) and runs `gitleaks dir` with `.gitleaks.toml` | a finding, a missing repository, a missing gitleaks |

## 3. The consumer rules (C215.1, C215.4)

**How the need was found.** The SDK's main sources were searched for every way a name crosses a
string or reflection boundary (`Class.forName`, `ServiceLoader`, `::class`, `simpleName`,
`qualifiedName`, `javaClass`, enum `name`, `valueOf`, `serializer(`). One was found that R8 breaks:

```
openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/api/FlowApiException.kt:80
    public val causeClass: String? = cause?.let { it::class.simpleName }
```

Its KDoc promises a name "such as `MissingFieldException`". The others need no rule: every
serializer is named in code (`X.serializer()`), wire names are literals the compiler plugin wrote,
enum constants keep their `name()`, the activity is named by the manifest, `Class.forName` in the
probes names foreign classes, and zxing-cpp's rule (`-keep class zxingcpp.** { *; }`) arrives from its
own AAR.

**RED on the real build** (the demo's `release` and `minifiedSmoke` outputs as contracts-10c left
them, rules empty):

```
$ python3 -I android/scripts/check-consumer-rules.py
AAR: openverify-sdk.aar ships 0 consumer rule(s), as committed
FAIL: release: kotlinx.serialization.SerializationException is not in the mapping: without it the check proves nothing
FAIL: release: kotlinx.serialization.MissingFieldException was renamed to gj2: InvalidResponse.causeClass would read 'gj2'
FAIL: release: kotlinx.serialization.UnknownFieldException was renamed to oc4: InvalidResponse.causeClass would read 'oc4'
FAIL: release: kotlinx.serialization.json.JsonDecodingException was renamed to q32: InvalidResponse.causeClass would read 'q32'
FAIL: minifiedSmoke: ... (the same four)
check-consumer-rules: failed            (exit 1)
```

`SerializationException` itself was absent because R8 had merged it into its subclasses.

**GREEN** `34acafe4`, `android/openverify-sdk/consumer-rules.pro`:

```
-keepnames class kotlinx.serialization.SerializationException
-keepnames class * extends kotlinx.serialization.SerializationException
```

`-keepnames` keeps a name only for a class R8 keeps anyway. After
`./gradlew --no-daemon :demo-app:assembleRelease :demo-app:bundleRelease :demo-app:assembleMinifiedSmoke :openverify-sdk:assemble publishAllPublicationsToStagingRepository`
(exit 0, 386 s, lock wait 153 s, load 12.5):

```
$ python3 -I android/scripts/check-consumer-rules.py
AAR: openverify-sdk.aar ships 2 consumer rule(s), as committed
AAR: openverify-nfc-release.aar ships 0 consumer rule(s), as committed
release: R8 read the SDK's rules from the library and kept every serialization exception's name
minifiedSmoke: R8 read the SDK's rules from the library and kept every serialization exception's name
check-consumer-rules: passed (R8's outputs only; the minified app was not run)      (exit 0)
$ grep '^kotlinx.serialization.*Exception' demo-app/build/outputs/mapping/release/mapping.txt
kotlinx.serialization.MissingFieldException -> kotlinx.serialization.MissingFieldException:
kotlinx.serialization.SerializationException -> kotlinx.serialization.SerializationException:
kotlinx.serialization.UnknownFieldException -> kotlinx.serialization.UnknownFieldException:
kotlinx.serialization.json.JsonDecodingException -> kotlinx.serialization.json.JsonDecodingException:
kotlinx.serialization.json.JsonEncodingException -> kotlinx.serialization.json.JsonEncodingException:
kotlinx.serialization.json.JsonException -> kotlinx.serialization.json.JsonException:
```

`android/openverify-nfc/consumer-rules.pro` stays a commented placeholder: the module has no reader
and no dependency in 10C; the `org.jmrtd`, `net.sf.scuba` and `org.ejbca.cvc` rules are written there
as comments for 10E, and a unit test holds the file to no active rule.

**What this proves and what it does not.** R8 (full mode, resources shrunk) builds the demo's
`release` and `minifiedSmoke` types with no rule in the demo for the SDK, the rules travel in the AAR
(`proguard.txt`), reach R8's merged configuration, and keep the names. It does not prove that the
minified app runs: that is the demo's smoke device test (demo-app's), which needs a device.

## 4. The 16 KB checks (C216.1)

```
$ python3 -I android/scripts/check-elf-alignment.py
ELF: 0 native libraries in 7 AARs (openverify-nfc-0.1.0.aar, openverify-nfc-debug.aar, openverify-nfc-release.aar, openverify-sdk-android-0.1.0.aar, openverify-sdk-debug.aar, openverify-sdk-release.aar, openverify-sdk.aar)
ELF: 16 native libraries in demo-app-release-unsigned.apk
  lib/arm64-v8a/libandroidx.graphics.path.so: 16 KB-aligned
  lib/arm64-v8a/libimage_processing_util_jni.so: 16 KB-aligned
  lib/arm64-v8a/libsurface_util_jni.so: 16 KB-aligned
  lib/arm64-v8a/libzxingcpp_android.so: 16 KB-aligned
  ... (the same four on armeabi-v7a, x86 and x86_64)
zipalign: 36.1.0 -c -P 16 -v 4 demo-app-release-unsigned.apk: verified (16 libraries listed)
bundletool: bundletool-all-1.18.3.jar dump config demo-app-release.aab: PAGE_ALIGNMENT_16K
check-elf-alignment: passed (static checks only; nothing was loaded on a 16 KB device)      (exit 0)
```

Our own AARs hold no native code, so the plan's AAR scan alone would have checked nothing; the APK
scan reaches the four libraries a host really ships per ABI (zxing-cpp's, two of CameraX's and
`androidx.graphics.path`). All 16 are aligned on all four ABIs. The script is strict on the 32-bit
ABIs too, although Google Play's rule covers 64-bit devices only: every library is aligned today, so
a 4 KB library on any ABI is a change to look at.

## 5. The size baseline (C216.2, C216.3)

`android/size-baseline.json`, written by `check-size.py --write-baseline`. Every figure is measured
with the pinned bundletool 1.18.3 over `:demo-app:bundleRelease`; none is estimated.

- `download_bytes`: `bundletool get-size total --dimensions=ABI`, the MAX column.
- `install_bytes`: the bytes of the APK files `bundletool extract-apks` selects for the reference
  device of that ABI (API 34, 480 dpi, `en`), as stored on the device; without ART's compiled code and
  the app's data.
- The yardstick is the demo app, so a figure is the demo with the SDK, not the SDK's own cost.

The two configurations whose artifacts exist; the face and Play Integrity configurations are absent
(P2 waits for 10E, P3 is declined), and the script refuses their names. The figures of the final
measurement are in section 8.

The `sdk,nfc` bundle is built with `-PopenverifyDemoArtifacts=sdk,nfc`, which writes the same output
file as the default build; `check-size.py` tells the two apart by the NFC permission that only
openverify-nfc's manifest declares, so one cannot be measured as the other:

```
$ python3 -I android/scripts/check-size.py --configuration sdk,nfc        (over the sdk bundle)
FAIL: the bundle declares no NFC permission, so it was built without openverify-nfc, not as 'sdk,nfc'
check-size: failed          (exit 1)
```

No absolute cap is set (C216.2: after 10E's ORT spike).

## 6. The staged repository and the consumer check (C217.2, C217.3)

**The staged repository.** `publishAllPublicationsToStagingRepository` writes
`android/build/staging-repo/dev/openverify/{openverify-sdk, openverify-sdk-android, openverify-nfc}/0.1.0/`
(95 files). The publishing plugin validates a deployment only at the Central Portal, which nothing
here reaches, so `check-staged-repository.py` holds the repository to what the Portal asks for. RED on
the real repository:

```
$ python3 -I android/scripts/check-staged-repository.py
FAIL: openverify-sdk: the POM has no scm/developerConnection
FAIL: openverify-sdk-android: the POM has no scm/developerConnection
FAIL: openverify-nfc: the POM has no scm/developerConnection
check-staged-repository: failed         (exit 1)
```

GREEN `34acafe4` (both publication blocks name `developerConnection`, the same placeholder address as
`url`):

```
staged repository: dev.openverify:{openverify-sdk, openverify-sdk-android, openverify-nfc}:0.1.0, 95 files, every checksum matches
  the root's Gradle metadata names openverify-sdk-android (staged) and openverify-sdk-iosarm64, openverify-sdk-iossimulatorarm64 (not staged: ...)
  unsigned: nothing is signed or uploaded without the owner's key (Phase 10 P4)
check-staged-repository: passed         (exit 0)
```

**The consumer check** (`android/consumer-check/`, `0e519429`): a host app, a build of its own, that
asks for `dev.openverify:openverify-sdk:0.1.0` (the root module) and `openverify-nfc` from the staged
repository, which is the only repository allowed to answer for that group (`exclusiveContent`). Only
its minified `release` variant is built. RED runs while it was written:

```
> C217.3: an Android consumer of dev.openverify:openverify-sdk resolved
  {...openverify-sdk-android:0.1.0=openverify-sdk.aar}, not {...=openverify-sdk-android-0.1.0.aar}
```

(the Android target's Gradle metadata names its file `openverify-sdk.aar` at the URL
`openverify-sdk-android-0.1.0.aar`; the check now compares module coordinates, not file names), then
the finding of section 10, item 1:

```
e: ConsumerActivity.kt:4:17 Unresolved reference 'activity'.
e: ConsumerActivity.kt:18:26 Unresolved reference 'registerForActivityResult'.
> Task :compileReleaseKotlin FAILED
```

GREEN (the consumer declares `androidx.activity` itself, as every host does):

```
$ ./gradlew --no-daemon -p consumer-check build          (exit 0, 167 s, lock wait 129 s, load 11.5)
check-staged-repository: passed
consumer check: dev.openverify:openverify-sdk:0.1.0 resolved to dev.openverify:openverify-sdk-android:0.1.0, dev.openverify:openverify-nfc:0.1.0 from the staged repository; 113 modules in all, none for iOS
consumer: R8 read the SDK's rules from the published AAR and kept every serialization exception's name
check-consumer-rules: passed (R8's outputs only; the minified app was not run)
BUILD SUCCESSFUL in 2m 47s
```

So an Android consumer resolves the root module although its Gradle metadata still names two iOS
modules that are not staged (contracts-10c's open question), the public entry points compile against
the published AAR, and R8 reads the consumer rules out of the published AAR, not only out of the
project dependency the demo uses.

## 7. Locks and verification metadata (C214.5)

**The parent build.** Nothing here adds a dependency or a configuration to it, so
`android/gradle/verification-metadata.xml` and the four parent lockfiles are unchanged. The
`sdk,nfc` demo build resolves the same external modules (openverify-nfc has no dependency).

**The consumer check** is a build of its own, so it has its own lock state and metadata
(`android/consumer-check/gradle.lockfile`, `settings-gradle.lockfile`,
`gradle/verification-metadata.xml`, 443 components), written as rule 1 asks, in a scratch worktree
(`/tmp/ov-rc-wt`, removed) holding a copy of the staged repository:

```
$ GRADLE_USER_HOME=/tmp/ov-rc-gh1 ./gradlew --no-daemon -p consumer-check build --write-locks --write-verification-metadata sha256
BUILD SUCCESSFUL in 3m 51s          (232 s, lock wait 221 s, load 12.6; 47 tasks executed)
$ python3 -I android/scripts/trust-staged-group.py
trust-staged-group: verification-metadata.xml trusts dev.openverify; 3 component(s) of it removed, 443 kept
$ GRADLE_USER_HOME=/tmp/ov-rc-gh1 ./gradlew --no-daemon -p consumer-check build --write-locks      (31 s; the staged group left out of the lock state)
$ GRADLE_USER_HOME=/tmp/ov-rc-gh2 ./gradlew --no-daemon -p consumer-check build                    (a second fresh home, verification on)
BUILD SUCCESSFUL in 3m 39s          (220 s, load 9.9)
```

The staged group is trusted without a checksum and ignored by the lock state: its artifacts are
built by the call before the consumer check and change with every commit, and the settings file lets
the group come from the staged repository only. That verification is on was shown by changing one
digit of one checksum in the worktree:

```
> Dependency verification failed for configuration ':releaseRuntimeClasspath'
  One artifact failed verification: okhttp-android-5.4.0.module (com.squareup.okhttp3:okhttp-android:5.4.0) from repository MavenRepo
```

**Outside Gradle's resolution** (unchanged, pinned elsewhere): the Gradle distribution (the wrapper's
`distributionUrl`; ci.yml and the release workflow check the wrapper JAR), the JDK (Temurin 21), the
Android SDK platform and build-tools (`zipalign` comes from build-tools), Robolectric's `android-all`
downloads, the Kotlin/Native toolchain (`~/.konan`), bundletool (`scripts/fetch_bundletool.py`, by
SHA-256) and gitleaks (`infra/scripts/install-gitleaks.sh`, by SHA-256).

## 8. The release workflow (C217.4, C220.3)

**RED** `d71a9e28` (the new `android-release.yml` section of `infra/tests/ci-workflow.test.sh`, a
named borrowed edit; the file's porcelain was empty first):

```
$ bash infra/tests/ci-workflow.test.sh
FAIL - release: its jobs are gate, devices and publish (['notice'])
FAIL - release: gate: gitleaks scans the unzipped staged repository before it is uploaded as a workflow artifact (review P25) (None [])
FAIL - release: publish: it runs only inside the environment maven-central (None)
... (44 in all)
# 279 passed, 44 failed, 0 skipped          (exit 1)
```

**GREEN** `3441663a`:

```
$ bash infra/tests/ci-workflow.test.sh
# 341 passed, 0 failed, 0 skipped           (exit 0)
```

75 of the 341 are the release section's: the structure, actionlint, the version step run on five
synthetic inputs (the declared version passes; another version, a SNAPSHOT, two numbers and shell text
are refused) and the secret scan run on three synthetic repositories (clean passes; a private key
generated by `openssl` at run time inside a staged jar fails; a missing repository fails).

The publishing plugin's switches were read from the build, not assumed:

```
$ ./gradlew --no-daemon -PmavenCentralPublishing=true -PmavenCentralAutomaticPublishing=false -PsignAllPublications=true --no-configuration-cache :openverify-sdk:tasks --all
publishToMavenCentral - Publishes to Maven Central
publishAndReleaseToMavenCentral - Publishes to Maven Central and automatically triggers release
signAndroidPublication, signKotlinMultiplatformPublication, ...
$ ./gradlew --no-daemon :openverify-sdk:tasks --all        (no property)
(no MavenCentral task and no sign task)
```

So the committed build cannot sign or upload; only the publish job's call can. Nothing was signed,
uploaded or dispatched, and the publish job has never run: its Gradle call is unproved beyond the
task's existence.

## 9. What only a device or the owner can show

- The minified demo running: demo-app's smoke device test on `minifiedSmoke`.
- A 16 KB device loading the libraries: the release matrix's API 35 `google_apis_ps16k` leg, which
  may not boot on the standard runner (P5 declined); then it is an open item of the release gate.
- The release workflow itself: never dispatched (rule 19), so its jobs are held by the contract test
  and actionlint only.
- The Central upload: the owner's namespace, Portal token, GPG key and `maven-central` environment
  (P4).

## 10. Findings in other owners' files (for integration-10c)

1. **`androidx.activity` is published at scope `runtime`.** `OpenVerifyInquiry.Contract` extends
   `ActivityResultContract`, so a consumer that does not declare `androidx.activity` itself cannot
   compile against the published SDK (section 6). C214.4 already treats OkHttp this way. Change in
   `android/openverify-sdk/build.gradle.kts`, `androidMain.dependencies`:
   `implementation(libs.androidx.activity.compose)` to `api(libs.androidx.activity.compose)`, with the
   lockfiles refreshed; then the consumer check's own `implementation(libs.androidx.activity.compose)`
   line goes, and `check-staged-repository.py` can hold the scope as it holds OkHttp's.
2. **`InvalidResponse.causeClass` is a class name read as text.** The consumer rule keeps it working
   under R8. A fixed code per failure kind would need no rule; that is a public-API decision.
3. **The Android target's Gradle metadata names its AAR `openverify-sdk.aar`** at the URL
   `openverify-sdk-android-0.1.0.aar` (the KMP Android library plugin's output name). Gradle and Maven
   consumers resolve it; it is recorded because a file-name check would trip on it.

## 11. The final gates as run (checkpoint 1)

All in the foreground, each its own call. Five agents were running their final gates at the same
time, so the Gradle lock was the bottleneck: four calls first ended with exit 75 (lock busy for 240 s
or 380 s) and were run again; those are not failures.

| Call | Command | Exit | Wall | Lock wait | Load after |
|---|---|---|---|---|---|
| fetch | `python3 -I scripts/fetch_bundletool.py` | 0 | (present) | | |
| unit | `python3 -I -m unittest discover -s android/scripts/tests` (82 tests) | 0 | 0.7 s | | 6.6 |
| (1) ui | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui` | 0 | 45 s | 164 s | 13.5 |
| (1) flow | `... -PhostTestGroup=flow` | 0 | 112 s | 365 s | 33.7 |
| (1) rest | `... -PhostTestGroup=rest` | 1, then 0 | 245 s, then 46 s | 380 s, 333 s | 44.0, 18.5 |
| (2) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 45 s | 75 s | 5.7 |
| (3) | `koverVerify checkKotlinAbi` | 0 | 151 s | 117 s | 2.8 |
| (4) | `testDebugUnitTest assembleDebug` | 0 | 23 s | 160 s | 7.4 |
| (4) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 33 s | 19 s | 5.1 |
| (5) | `:openverify-sdk:assemble` | 0 | 22 s | 52 s | 4.1 |
| (5) | `lint` | 0 | 10 s | 161 s | 4.6 |
| (6) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 11 s | 26 s | 4.2 |
| (7) | `python3 -I scripts/check-elf-alignment.py && python3 -I scripts/check-size.py` | 0, 0 | about 15 s | | 4.0 |
| (7+) | `python3 -I scripts/check-consumer-rules.py` | 0 | 2 s | | 4.0 |
| (8) | `publishAllPublicationsToStagingRepository` | 0 | 68 s | 19 s | 5.6 |
| (8) | `-p consumer-check build` | 0 | 139 s | 27 s | 9.6 |
| scan | `bash android/scripts/scan-staged-repository.sh` (gitleaks dir, 12.0 MB unpacked) | 0 | 1 s | | |
| infra | `bash infra/tests/ci-workflow.test.sh` (341 passed) | 0 | | | 6.6 |
| format | `pnpm format:check` | 0 | | | |

Several Gradle calls were short because another agent's gate had just built the same inputs (tasks
up to date or from the build cache), so these wall times are not a cold measurement. The new calls,
when they really ran: the minified demo with its bundle, the SDK and the staged repository in one
call 386 s at load 12.5; an R8 bundle of the demo alone 141 to 239 s at load 8.5 to 12; the consumer
check 139 to 167 s warm and 220 to 232 s from a fresh Gradle home.

**The one failure, in another owner's test.** Call (1) rest exited 1 once, at load 44:

```
BarcodeSideCostTest > the document guidance still fits its interval on a barcode side's frame() FAILED
    org.opentest4j.AssertionFailedError at BarcodeSideCostTest.kt:69
1723 tests completed, 1 failed
```

It is carry-10c's CPU-budget test (`barcode < INTERVAL_MS / 2`, a thread-CPU median of a 1280x960
frame; 39.8 to 44.3 ms at load 4.5). It passed on the next run at load 18.5 with nothing changed. It
is not in release-checks' paths and was not edited; it is reported to integration-10c as a test that
fails only under load (rule 6: to be made deterministic, never retried).

**Host tests.** The `rest` group ran 1,723 tests, none skipped. The `ui` and `flow` groups came from
the build cache in these calls, so their counts were not read here; integration-10c measures the
floor.

**The size baseline at this checkpoint** (tree `15a7dd89`, load 6.6; bundletool 1.18.3; bytes):

| ABI | `sdk` download | `sdk` install | `sdk,nfc` download | `sdk,nfc` install |
|---|---|---|---|---|
| arm64-v8a | 3,376,937 | 7,070,770 | 3,377,057 | 7,070,770 |
| armeabi-v7a | 3,289,394 | 6,554,682 | 3,289,514 | 6,554,682 |
| x86 | 3,445,725 | 7,193,626 | 3,445,845 | 7,193,626 |
| x86_64 | 3,420,226 | 7,173,158 | 3,420,346 | 7,173,158 |

`sdk,nfc` is 120 bytes of download above `sdk`: openverify-nfc holds a manifest and no code until
10E's reader. The first measurement of this Workflow (before nfc-sdk's and demo-app's work landed) was
3,290,244 and 6,885,728 bytes on arm64-v8a, so the other agents' work so far added 2.6%. The baseline
moves with the tree: integration-10c re-measures both configurations at the Workflow's end and commits
the baseline with its last change.

**Checkpoint 1** is this file's commit, "Workflow 10C release-checks checkpoint 1".
