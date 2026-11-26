# Sizes

What the SDK adds to an app, per ABI (Phase 10; plan C216). Only configurations whose artifacts exist in full are published here, and every figure in the tables is **measured**, not estimated. The figures are those of `android/size-baseline.json`; the host test `SizesPageTest` fails when this page and that file disagree.

## How the figures are measured

- **What is built:** the demo app's release bundle (`:demo-app:bundleRelease`): minified by R8 in full mode, with resources shrunk, as a host app's release build would be.
- **The tool:** bundletool, at the version `scripts/fetch_bundletool.py` pins by checksum.
- **Download size:** `bundletool get-size total` by ABI, the largest figure it reports for that ABI: the largest compressed download Google Play would serve such a device, over every screen density, language and Android version the bundle splits by.
- **Install size:** the bytes of the APK files bundletool selects for one reference device of that ABI (Android 14, 480 dpi, English), as they are stored on the device. It leaves out what Android adds after install: the compiled code and the app's own data.
- **The demo is the yardstick.** The figures are the demo app with the SDK, not the SDK's cost alone. The demo is a thin shell (one screen that launches the flow), so nearly all of each figure is the SDK with what it depends on: Jetpack Compose and Compose Multiplatform, CameraX, Ktor over OkHttp, and the barcode decoder's native library. An app that already uses some of these shares them, and pays less.
- A megabyte here is 10^6 bytes, and figures are rounded to a tenth.

## The configurations that exist

### `sdk`: the demo with `openverify-sdk` only

| ABI | Download | Install |
|---|---|---|
| `arm64-v8a` | 3.4 MB | 7.1 MB |
| `armeabi-v7a` | 3.3 MB | 6.6 MB |
| `x86` | 3.4 MB | 7.2 MB |
| `x86_64` | 3.4 MB | 7.2 MB |

### `sdk,nfc`: with `openverify-nfc` (the chip reader)

| ABI | Download | Install |
|---|---|---|
| `arm64-v8a` | 4.9 MB | 10.9 MB |
| `armeabi-v7a` | 4.8 MB | 10.4 MB |
| `x86` | 5.0 MB | 11.0 MB |
| `x86_64` | 4.9 MB | 11.0 MB |

### `sdk,face`: with `openverify-face` (YuNet through ONNX Runtime)

| ABI | Download | Install |
|---|---|---|
| `arm64-v8a` | 16.6 MB | 41.8 MB |
| `armeabi-v7a` | 15.3 MB | 31.2 MB |
| `x86` | 18.9 MB | 48.4 MB |
| `x86_64` | 18.8 MB | 48.5 MB |

### `sdk,nfc,face`: with both

| ABI | Download | Install |
|---|---|---|
| `arm64-v8a` | 18.1 MB | 45.6 MB |
| `armeabi-v7a` | 16.8 MB | 35.0 MB |
| `x86` | 20.4 MB | 52.3 MB |
| `x86_64` | 20.3 MB | 52.3 MB |

## What each optional artifact costs

The difference between a configuration and `sdk`, from the tables' own bytes (so it is the artifact with everything it depends on, after R8, in this demo):

| Artifact | ABI | Download | Install |
|---|---|---|---|
| `openverify-nfc` | `arm64-v8a` | +1.5 MB | +3.8 MB |
| `openverify-nfc` | `armeabi-v7a` | +1.5 MB | +3.8 MB |
| `openverify-nfc` | `x86` | +1.5 MB | +3.8 MB |
| `openverify-nfc` | `x86_64` | +1.5 MB | +3.8 MB |
| `openverify-face` | `arm64-v8a` | +13.2 MB | +34.7 MB |
| `openverify-face` | `armeabi-v7a` | +12.0 MB | +24.7 MB |
| `openverify-face` | `x86` | +15.5 MB | +41.2 MB |
| `openverify-face` | `x86_64` | +15.3 MB | +41.3 MB |

- **`openverify-nfc`** is the reader with JMRTD, SCUBA, cert-cvc and Bouncy Castle. Its consumer rules keep the LGPL libraries whole and unrenamed, so that they can be replaced, and keep what Bouncy Castle's provider loads by name; R8 therefore removes little of them. The minified demo holds 9,813 dex classes with it and 5,596 without.
- **`openverify-face`** is almost all ONNX Runtime's native library: `libonnxruntime.so` is 34.2 MB uncompressed on `arm64-v8a` (24.2 MB on `armeabi-v7a`, 40.7 MB on `x86`, 40.8 MB on `x86_64`), and R8 does not shrink native code. The YuNet model is 0.2 MB and the notices that travel with it 0.3 MB. This is the official `onnxruntime-android` 1.31.0 library. A custom build with only the operators YuNet needs would be smaller; it has **not been measured** (the build host has no Android NDK) and is not used.
- **Both together** cost the sum of the two, to within a few kilobytes.

## What is not measured

- **Play Integrity.** OpenVerify ships no such artifact (the owner declined it); what the host's own dependency adds is the host's to measure.
- **A custom ONNX Runtime build**, as above.
- **What Android adds after install** (the compiled code and the app's data), for every configuration.

## The size check

`android/scripts/check-size.py` measures the `sdk` configuration on every run of the Android gate, and the release workflow measures all four. It fails in two cases:

- a figure grew by more than 10% over `android/size-baseline.json`. A growth that is meant goes in with a baseline change in the same commit, where a reviewer sees it;
- a figure is above its configuration's **absolute cap**, which a baseline change cannot move. The caps are, for every ABI: `sdk` 5 MiB to download and 9 MiB installed; `sdk,nfc` 6 and 14 MiB; `sdk,face` 23 and 58 MiB; `sdk,nfc,face` 25 and 63 MiB. Each is the largest ABI's measured figure of the tables above plus 25%, rounded up to a whole MiB (2^20 bytes). They are provisional, and rest on the official ONNX Runtime library.

A bundle is recognised by what only its artifacts bring (the NFC permission; `libonnxruntime.so`), so a bundle built for one configuration cannot be measured as another.

## 16 KB pages

Every native library the SDK and its optional artifacts bring is aligned for 16 KB pages, which Google Play requires of apps that target Android 15 or later on 64-bit devices. Three checks run with the size check: `zipalign` on the minified demo APK, the bundle's page-alignment setting, and the ELF alignment of every library in every AAR and in the demo APK (`android/scripts/check-elf-alignment.py`). `openverify-face`'s own AAR holds no native library (ONNX Runtime's arrive as its dependency), so they are checked in a demo APK built with `face`: its 24 libraries, `libonnxruntime.so` and `libonnxruntime4j_jni.so` on four ABIs among them, are aligned. These are static checks: no library has been loaded on a 16 KB device or emulator image ([release and support policy](release-and-support.md#platform-levels-and-the-server)).
