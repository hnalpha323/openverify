# Phase 4 (selfie checks and liveness) models, libraries and data: license and maintenance research

Checked 2026-10-21.
- **How licences were verified.** Every licence below was read from the LICENSE file at the commit or tag in **Sources**, and from npm registry, PyPI JSON, Maven POM, Hugging Face API `cardData` or model-card metadata. Where those disagree, the row says so. **For model weights, the training-data terms were checked separately.** A permissive tag on a weight file does not lift a non-commercial restriction on the images it was fitted on, so each model row gives code / weights / data. "Released" is the first upload date of that version (npm `time`, PyPI upload time, Maven `Last-Modified`, or the Git tag date).
- **Empirical checks.** Run in scratch venvs and containers only:
  - Python 3.12 with numpy 2.5.4, opencv-python-headless 5.0.0.93 and onnxruntime 1.31.0;
  - scratch-only tools: scikit-image 0.26.0, tf2onnx 1.17.0 with tensorflow-cpu 2.21.0, torch 2.14.1 CPU;
  - a throwaway `pgvector/pgvector:pg17` container;
  - Playwright's Chromium (build 1248, Chrome 156).

  Repo weights and fixtures were only read. **Nothing in the repo was touched.** All fixture-based numbers come from 3 public-domain faces plus synthetic variants: they test plumbing and direction, not accuracy.
- **Release-age rule.** Prefer versions at least 14 days old, so released on or before 2026-10-07.

Legend: ✅ passes policy · ⚠️ passes on paper but carries a caveat · ❌ fails policy

---

## Summary of recommendations

| § | Need | Recommendation | New runtime dependency or weights |
|---|---|---|---|
| 1 | Client face guidance, web | `onnxruntime-web@1.30.0` + the pinned YuNet; optionally the FaceMesh V2 ONNX from §2 for dense landmarks. **Not** `@mediapipe/tasks-vision` ≥ 1.0.0 (telemetry) | npm `onnxruntime-web` 1.30.0 (MIT) |
| 1 | Client face guidance, Android | `onnxruntime-android` 1.30.0 with its telemetry provider removed (or 1.28.0) + YuNet. **Not** the MediaPipe AARs or ML Kit | Maven `com.microsoft.onnxruntime:onnxruntime-android` (MIT) |
| 2 | Server head pose | FaceMesh V2 (Apache-2.0, inside `face_landmarker.task`) converted to ONNX at fetch time, SQPNP against MediaPipe's canonical mesh, measured *relative to the session's own centre frame*. YuNet 5-point PnP as a sign-only fallback | `face_landmarker.task` (sha256 `64184e22…c9ff`) → derived ONNX; `tf2onnx` 1.17.0 dev-only |
| 3 | Passive liveness | Keep the MiniFASNetV2 + V1SE ensemble, with upstream preprocessing reimplemented exactly and the YuNet box transform and threshold calibrated. ⚠️ Training data undisclosed | none |
| 4 | Age estimation | No clean model exists. Ship an `AgeEstimationProvider` adapter plus a deterministic sandbox provider; not executed without a provider | none |
| 5 | Deepfake / AI face / mask | No clean model exists. Weight-free spectral, JPEG-grid, noise and metadata heuristics (`stage: beta`) plus a `SuspiciousEntityProvider` adapter and sandbox | none |
| 6 | Covering and glasses | Landmark-ROI heuristics (skin relative to the forehead, texture, lip band; bridge and rim edges, lens glare). Legal read on US 10,395,094 B2 | none |
| 7 | Pose repeat | Yaw-spread check (§2), a geometric planarity test (homography residual of tracked face points: planar 0.05–0.33 % vs 3-D re-pose 0.6–2.2 % of face width), SFace cosine, duplicate hash. SSIM implemented in OpenCV | dev-only `scikit-image==0.26.0` (test oracle) |
| 8 | Background similarity | YuNet person mask, Lab colour-layout vector in pgvector for retrieval, ORB + RANSAC on background pixels to verify. Drop `imagehash` | none |
| 9 | Face search | pgvector 0.8.7 HNSW (`*_cosine_ops`) on a **keyed orthogonal rotation** of the SFace embedding (`halfvec(128)`), per environment, with iterative scan | none (new secret `OPENVERIFY_FACE_INDEX_KEY`) |
| 10 | Calibration fixtures | Commons `PD-USGov*` official portraits: NASA, State and Armed Forces ✅, Congress ⚠️ with a per-file credit check. About 450 people and 1,500 genuine pairs after de-duplication, with the demographic skew reported. OpenCV-only screen, print and composite spoof simulations, labelled pipeline-only. 2.5-D re-posed MJPEG head-turn clips for e2e | fetch-script entries only; fix the `fetch_fixtures.py` template regex and add 429 backoff |
| 11 | Capture integrity | Label, settings, capabilities and frame-stats features as risk signals; a server-nonce, random-order, short-window pose challenge with single-use consumption. No colour-flash challenge without a patent review | none |

---

## 0. Cross-cutting findings (owner decisions)

1. **Telemetry in the inference runtimes, including the one already shipped.**
   - **MediaPipe Tasks.** Web builds ≥ 1.0.0 and **every** published Android AAR (0.10.35 included) send usage telemetry to Google, with no opt-out.
     - Verified markers `odml.pa.googleapis.com` and `_mediapipeLoggerGetEncodedApiKey` are present in the npm tarballs of 1.0.0, 1.0.1 and 1.1.0, and absent from 0.10.35.
     - Google's maintainer, in issue #6291 (2026-07-06): "We are not adding an official API to disable this data collection … You can build the SDK from source … or you can block access to the host."
   - **ONNX Runtime.** Official builds have telemetry **ON by default** on Linux, macOS, Android and iOS through the 1DS SDK (`docs/Privacy.md` @ v1.30.0); WebAssembly builds have none.
     - The vision service's locked `onnxruntime` 1.31.0 wheel contains `https://mobile.events.data.microsoft.com/OneCollector/1.0/`.
     - **The repo sets `ORT_DISABLE_TELEMETRY` nowhere** (grep of Dockerfiles, compose, `.env.example` and Python).
     - **Action, independent of Phase 4:**
       - set `ORT_DISABLE_TELEMETRY=1` in the vision image and compose environment;
       - call `onnxruntime.disable_telemetry_events()` at startup (present in 1.31.0);
       - add a test that asserts both.
2. **Release age.** `services/vision` locks `onnxruntime==1.31.0`, published 2026-10-09 and younger than 14 days. 1.30.0 (2026-09-10) is the newest that complies.
3. **Eigen (MPL-2.0) is compiled into ONNX Runtime** (`ThirdPartyNotices.txt` and `cmake/deps.txt` @ v1.30.0), and also into TFLite/LiteRT and MediaPipe.
   - That includes the onnxruntime wheel already in the vision image. Rule 4 admits MPL only for unshipped tooling.
   - This needs the same kind of documented owner exception as the OpenCV wheel caveat in phase3 §6: unmodified, file-level copyleft, licence text shipped.
4. **The data-provenance standard used in §4–§6 also catches models already in `models/manifest.json`.**
   - **YuNet** is trained on WIDER FACE, which is `cc-by-nc-nd-4.0` per the dataset card `CUHK-CSE/wider_face` @ db171f1.
   - **SFace** was trained on CASIA-WebFace, VGGFace2 and MS-Celeb-1M per its paper; which one produced the zoo model is not stated. opencv_zoo issues #313 (2026-07-22) and #318 (2026-10-01) ask exactly this and are open.
   - **MiniFASNet**'s training data is proprietary and undisclosed (Silent-Face issue #146, open).
   - Either:
     - (a) record an explicit policy that the weight file's licence governs and that data provenance is a documented caveat, which also changes some ❌ verdicts in §4–§6 to ⚠️; or
     - (b) treat these as replace-when-possible.
   - The report applies the strict reading throughout, so the decision stays visible.
5. **Patents** (not legal advice):
   - **Nose-bridge-gradient glasses detection:** Tencent US 10,395,094 B2 (listed expiry 2037), close to the planned heuristic. Fujifilm US 7,657,086 B2 expires 2027.
   - **Screen colour-flash liveness:** iProov "Flashmark", "patented since 2012"; USPTO US 10,796,178 and US 12,125,313, whose assignees were not verified.
   - Get a freedom-to-operate read before shipping either.
6. **PLAN §3 and Phase 10 edits.**
   - "MediaPipe Face Landmarker (client)" becomes ONNX Runtime + YuNet / the converted FaceMesh ONNX.
   - "pHash (`imagehash`)" becomes our own OpenCV pHash/dHash.
   - "selfie active liveness with MediaPipe" (Phase 10) becomes `onnxruntime-android`.

---

## 1. Client-side face guidance and pose challenge

Checked 2026-10-21. Tarballs and AARs were downloaded into empty scratch directories and inspected with `tar`/`zipfile` (Python run with `-I`); nothing was executed from them. "Released" is the registry publish time (npm `time`, Google Maven / Maven Central `Last-Modified`).

The client model only drives UX (face in frame, distance, "turn left" prompts). The server re-detects the face and recomputes pose from the uploaded frames (§2), so a weak or tampered client model costs usability, not security. That lowers the bar for accuracy and raises the bar for licence and privacy hygiene, since this code runs on every end user's device.

### 1a. Web

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| `@mediapipe/tasks-vision` | npm | **1.1.0** (latest 1.1.1, 2026-10-14, too new) | 2026-10-06 | npm `license: Apache-2.0`; **the tarball has no LICENSE or NOTICE file**, and neither the JS bundle nor the wasm carries a licence header. Source LICENSE is Apache-2.0 at tag v1.1.0 (commit 821db8a). **Overlay:** Google's "MediaPipe APIs Terms of Service" (modified 2026-04-07) says use of MediaPipe Solution APIs "is subject to the Google APIs Terms of Service" | ❌ as shipped: **built-in telemetry to Google that cannot be switched off** (see notes) |
| `@mediapipe/tasks-vision` | npm | **0.10.35** | 2026-04-27 | Same: npm Apache-2.0, no LICENSE in the tarball, source Apache-2.0 at tag v0.10.35 (f8ef212; same LICENSE bytes as v1.1.0). The ToS overlay above predates it | ⚠️ The last web build with no telemetry code. It is frozen at an April 2026 build, and the ToS overlay needs owner review |
| `@mediapipe/tasks-vision` | npm | 1.0.0 / 1.0.1 | 2026-07-28 / 2026-07-31 | as 1.1.0 | ❌ Telemetry logger present in both (checked) |
| `face_landmarker.task` (float16, v1) | GCS | `…/face_landmarker/float16/1/` | object generation 1683136941916318 (2023-05-03) | Model cards say **"Licensed under Apache License, Version 2.0"**: FaceMesh V2 (2022-09-15), Blendshape V2 (2022-11-11) and BlazeFace short-range (2021-06-09). The models were trained on Google's own consented captures, and the cards name no third-party dataset | ✅ weights (intended-use caveats below) |
| `blaze_face_short_range.tflite` (float16, v1) | GCS | `…/blaze_face_short_range/float16/1/` | 2023-04-26 | Apache-2.0 (BlazeFace short-range card). Byte-identical to the `face_detector.tflite` inside the `.task` | ✅ (not needed separately) |
| `@mediapipe/face_mesh` (legacy Solutions) | npm | 0.4.1657299874 | 2022-07-08 | Apache-2.0 (npm) | ❌ Legacy API, superseded by Tasks, unmaintained since 2022 |
| `@tensorflow-models/face-landmarks-detection` + `@tensorflow/tfjs-*` | npm | 1.0.6 / 4.22.0 | 2024-10-10 / 2024-10-21 | Apache-2.0 (npm; repo Apache-2.0). The `tfjs` runtime runs the same Google FaceMesh/BlazeFace weights | ⚠️ No telemetry, but stale (no release in 2 years). Default model URLs point at `tfhub.dev` (now Kaggle) and must be overridden. Kaggle model-page licence not verified |
| `@litertjs/core` (LiteRT.js) | npm | 2.5.3 | 2026-07-17 | Apache-2.0 (npm; repo google-ai-edge/LiteRT is Apache-2.0 per the GitHub API; LICENSE not read at a tag, because npm versions do not map to repo tags) | ⚠️ Runs the Apache-2.0 `.tflite` files from the `.task` directly. A static scan of the JS and wasm found no telemetry endpoint, but runtime traffic was not observed. Needs our own detector, crop and landmark pipeline. wasm about 9.4 MB |
| **`onnxruntime-web`** + YuNet (already in `models/manifest.json`) | npm | **1.30.0** | 2026-09-14 | MIT: LICENSE at tag v1.30.0 (f2c39fe) and npm metadata. YuNet is MIT (already verified). ORT's `docs/Privacy.md` @ v1.30.0: "WebAssembly … do[es] not include telemetry". No telemetry or CDN URLs found in `ort.wasm.min.mjs` or the wasm | ✅ **use** (default). Same model as the server. Only 5 landmarks |
| `face-api.js` | npm | 0.22.2 | 2020-03-22 | MIT (npm; repo spdx MIT) | ❌ Unmaintained since 2020 (475 open issues). Weights of mixed provenance: SSD detector trained on WIDER FACE; landmarks trained on an unnamed "~35k images" set; age model trained on IMDB/Wiki/UTK/MegaAge |
| `@vladmandic/face-api` | npm | 1.7.15 | 2025-02-05 | MIT | ❌ Repo **archived** (2025-02); same weights as face-api.js |
| `@vladmandic/human` | npm | 3.3.6 | 2025-08-26 | Code MIT (LICENSE @ d0c4c83), but "included models are included under license inherited from the original model source": InsightFace, SSR-Net on IMDB-WIKI, and anti-spoof/liveness models of unknown provenance | ❌ Model provenance; low activity (last push 2025-12) |

**Telemetry in MediaPipe Tasks (the deciding finding):**
- **What the 1.x bundle does.** `vision_bundle.mjs` (1.0.0, 1.0.1 and 1.1.0) contains a logger that POSTs protobuf usage events to **`https://odml.pa.googleapis.com/v1/log`**, using an API key that the wasm returns from `_mediapipeLoggerGetEncodedApiKey`. It sends on graph start, every 60 s and on `close()`.
  - **Payload:** task type, running mode, OS (from the user agent), SDK version, and latency and dropped-frame statistics. No image data is sent.
  - **Created unconditionally** in the task factory. There is no public opt-out (`enableLogging` is internal).
- **0.10.35 has none of this:** no logger, no endpoint, and no `_mediapipeLoggerGetEncodedApiKey` export.
- **The published binaries are not built from the public tree.**
  - Web: at v1.1.0, `mediapipe/tasks/web/core/BUILD` generates `task_logger_factory.ts` as a `DummyTaskLogger`, yet the npm build ships a real logger.
  - Android: the public `tasks/core/BUILD` generates `TasksStatsLoggerFactory` from `TasksStatsDummyLogger`, while the published AAR contains `TasksStatsProtoLogger` and `RemoteLoggingClient`.
- **Google's position, in issue #6291** (comment by schmidt-sebastian, 2026-07-06): "we will be rolling out telemetry for all of our platforms … We are not adding an official API to disable this data collection … You can build the SDK from source, which will not include telemetry, or you can block access to the host."
- **Google's terms.** The MediaPipe ToS and privacy notice say the APIs "send metrics … to Google" and "will contact Google servers from time to time" for updated models. They make the integrator "responsible for obtaining informed consent from your app users".
- **Why it matters here.** For a self-hosted IDV product, that would put an undisclosed Google data flow on every verification. Blocking it with `connect-src 'self'` works, because the logger stops after its first failed send, but each attempt still logs a CSP violation.

**Model facts (`face_landmarker.task`):**
- **Contents and pins.** A zip of 3,758,596 bytes, SHA-256 `64184e22…0bc9ff`, containing:
  - `face_detector.tflite` (BlazeFace short-range, 229,746 bytes);
  - `face_landmarks_detector.tflite` (FaceMesh V2, 478 3-D landmarks, 2,553,590 bytes, `c7d54204…43d5`);
  - `face_blendshapes.tflite` (52 blendshapes, 955,312 bytes, `4f36dded…2082`);
  - `geometry_pipeline_metadata_landmarks.binarypb` (19,376 bytes).
- **Head pose for free.** The geometry metadata is what makes `outputFacialTransformationMatrixes: true` return a 4×4 canonical-face→camera transform per face, so yaw, pitch and roll can be read straight from its rotation part.
  - Check the `Matrix.data` element order before decomposing (not verified here).
  - Blendshapes (`eyeBlinkLeft`, `jawOpen`, …) give blink and smile challenges at no extra cost.
- **Intended-use clauses** (not licence terms, but quote them in our docs):
  - BlazeFace: "**Any form of surveillance or identity recognition is explicitly out of scope and not enabled by this technology**"; "not intended for human life-critical decisions".
  - FaceMesh V2 and Blendshape V2: "not intended for human life-critical decisions" and "do not provide facial recognition or identification".
  - Using them only for capture guidance stays inside that scope. Recognition happens server-side with SFace.
  - The FaceMesh card also says it is unsuitable for faces "looking away from the camera (more than 80°)", which is irrelevant for ±30° pose prompts.

**Self-hosting recipe** (applies to MediaPipe 0.10.35, LiteRT.js or ORT-web alike):
- **Load from our own origin, never a CDN.**
  - `FilesetResolver.forVisionTasks(basePath)` only builds `${basePath}/vision_wasm[_module][_nosimd]_internal.{js,wasm}`. There is no CDN default; the README examples use jsDelivr, and the default is a relative path.
  - Vite fingerprints filenames, so pass a hand-built `WasmFileset` (`{wasmLoaderPath, wasmBinaryPath}`) instead, using `?url` imports of `@mediapipe/tasks-vision/vision_wasm_internal.{js,wasm}`, which the package `exports` expose.
  - Not built here; verify in the slice.
- **Model loading.** Fetch the model from our origin and pass `modelAssetBuffer` after checking its SHA-256 with `crypto.subtle.digest`, which gives integrity even for a cached copy. `scripts/fetch_models.py` pins the GCS URL by SHA-256, and GCS also accepts `?generation=1683136941916318`.
- **CSP.** `script-src 'self' 'wasm-unsafe-eval'` (the loader injects a classic `<script>` and calls `WebAssembly.instantiateStreaming`; no `eval` or `new Function` was found in the glue), plus `connect-src 'self'` and `worker-src 'self'` if run in a Worker.
- **GPU delegate.** `delegate: "GPU"` uses WebGL2 via OffscreenCanvas (Safari ≥ 17). The CPU (XNNPACK/SIMD) path is enough for one face.

**Bundle size** (raw / gzip -6):

| Component | Raw | gzip |
|---|---|---|
| MediaPipe 1.1.0: `vision_bundle.mjs` | 156 KB | 45 KB |
| MediaPipe 1.1.0: loader `.js` | 335 KB | 81 KB |
| MediaPipe 1.1.0: SIMD wasm | 13.0 MB | 3.85 MB |
| MediaPipe 1.1.0: no-SIMD wasm | 12.2 MB | 3.73 MB |
| `face_landmarker.task` | 3.76 MB | 3.33 MB |
| **MediaPipe 1.1.0 first load** | **≈17 MB** | **≈7.3 MB** |
| MediaPipe 0.10.35: SIMD wasm | 11.2 MB | 3.29 MB |
| MediaPipe 0.10.35: bundle | 137 KB | 40 KB |
| ORT-web 1.30.0: `ort-wasm-simd-threaded.wasm` | 14.2 MB | 3.68 MB |
| ORT-web 1.30.0: `ort.wasm.min.mjs` | 50 KB | 16 KB |
| YuNet | 0.23 MB | |

- **ORT-web threading.** Threads need COOP/COEP cross-origin isolation, otherwise ORT falls back to a single thread.
- **ORT-web size.** A reduced-operator ORT build would shrink the wasm considerably (not measured).

### 1b. Android

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| `com.google.mediapipe:tasks-vision` + `tasks-core` | **Google Maven** (not on Maven Central) | 1.1.0 (newest ≤ 2026-10-07; 1.1.1 is 2026-10-14) | 2026-10-06 | POM: "The Apache Software License, Version 2.0". `META-INF/NOTICE` (2.8 MB) opens with the **MediaPipe Tasks Privacy Notice** ("send metrics … to Google … You are responsible for obtaining informed consent"), followed by an aggregated third-party list of 229 entries (incl. Eigen MPL-2.0, googleurl MPL/GPL/LGPL tri-licence, gcc runtime) whose actual linkage cannot be verified. Also subject to the ToS overlay | ❌ **Clearcut telemetry** (`RemoteLoggingClient` → `com.google.android.datatransport` CCT, log source `COREML_ON_DEVICE_SOLUTIONS`) with no switch. An OSS SDK would force it on every integrator |
| same | Google Maven | 0.10.35 | 2026-04-27 | as above | ❌ Same telemetry classes already present (and the same `transport-*` POM dependencies). No telemetry-free published Android build exists |
| MediaPipe built from source (Bazel; public tree uses the dummy loggers) | source | v1.1.0 / 821db8a | - | Apache-2.0 | ⚠️ Removes telemetry, but means a heavy Bazel + NDK build in our CI. Not attempted |
| `com.google.mlkit:face-detection` | Google Maven | 16.1.7 | 2024-08-07 | POM: **"ML Kit Terms of Service"**. The terms forbid reverse engineering ("may not … attempt to extract the source code"), incorporate the Google APIs ToS, and send metrics. Closed-source binary (17.7 MB AAR) | ❌ |
| `com.google.android.gms:play-services-mlkit-face-detection` | Google Maven | 17.1.0 | 2022-08 | POM: "ML Kit Terms of Service". Also needs Play services | ❌ |
| `com.google.mlkit:face-mesh-detection` | Google Maven | 16.0.0-beta3 | 2024-08 | ML Kit ToS (same family; POM not read) | ❌ |
| **`com.microsoft.onnxruntime:onnxruntime-android`** + YuNet | Maven Central | **1.30.0** (1.31.0 is 2026-10-09, too new) | 2026-09-14 | MIT (POM; LICENSE @ v1.30.0). AAR 53.0 MB; arm64 `libonnxruntime.so` 33.0 MB (12.4 MB gzipped); minSdk 24. **Telemetry: since 1.29.0 the AAR merges a `TelemetryInitializer` ContentProvider plus the `INTERNET` permission and sends 1DS events to `mobile.events.data.microsoft.com`, "ON by default" (ORT `docs/Privacy.md`)** | ✅ with telemetry disabled, or pin 1.28.0. Remove the provider (`tools:node="remove"`) and set `ORT_DISABLE_TELEMETRY=1` before ORT loads |
| same | Maven Central | 1.28.0 | 2026-07-27 | MIT. The 196-byte manifest has no telemetry provider; POSIX telemetry was added in commit ddb4898 on 2026-07-24, after this release | ✅ Fallback pin with no telemetry code at all (arm64 `.so` 28.6 MB) |
| `org.opencv:opencv` (Android AAR, includes `FaceDetectorYN`) | Maven Central | 5.0.0 | 2026-06-11 | POM: Apache-2.0 | ⚠️ Same YuNet code path as the server, but heavy: AAR 153 MB, arm64 `libopencv_java5.so` 33.5 MB (13.6 MB compressed) plus `libc++_shared` |

**MediaPipe Android transitive dependencies** (all permissive per their POMs):
- guava 27.0.1-android: Apache-2.0
- flogger and flogger-system-backend 0.6: Apache-2.0
- protobuf-javalite 4.26.1: BSD-3-Clause
- `com.google.android.datatransport:transport-{api,runtime,backend-cct}`: Apache-2.0. This is the telemetry transport.
- androidx.annotation: Apache-2.0
- optional `litertlm-android` 0.18.0

AAR facts:
- `tasks-core` 1.1.0 is 29.4 MB, with `libmediapipe_tasks_jni.so` per ABI: arm64 14.4 MB, armeabi-v7a 10.1 MB, x86 20.2 MB, x86_64 17.6 MB.
- `tasks-vision` 1.1.0 is 0.6 MB.
- minSdk 24, which is compatible with our SDK's minSdk 26.

**Cross-cutting caveats, outside §1 but found here:**
- **Eigen (MPL-2.0) is compiled into every runtime in this section:** ORT `ThirdPartyNotices.txt` @ v1.30.0, the MediaPipe NOTICE, and TFLite. The vision service's existing `onnxruntime` wheel has the same issue, so it needs the same owner exception as the OpenCV-wheel caveat in phase3 §6. Rule 4 only admits MPL for unshipped tooling.
- **The vision service's installed `onnxruntime` 1.31.0 Linux wheel** (`services/vision/.venv`) contains the 1DS endpoint `https://mobile.events.data.microsoft.com/OneCollector/1.0` and the `ORT_DISABLE_TELEMETRY` switch.
  - The vision container should set `ORT_DISABLE_TELEMETRY=1`, or block egress.
  - `onnxruntime>=1.31.0` (2026-10-09) is also younger than the 14-day rule.

**Recommendation:**
- **Web default: `onnxruntime-web@1.30.0` + YuNet** (the MIT model the server already pins).
  - It drives face presence, centring, size and a 5-landmark yaw/roll estimate for the prompts.
  - It has no telemetry, needs no Google terms, and is the same detector as the server.
  - Write the YuNet decode and NMS ourselves; it is small.
- **Dense landmarks or blendshapes.** If we want them (pitch prompts, blink or smile challenges), use the **Apache-2.0 FaceMesh V2 and Blendshape V2 weights extracted from `face_landmarker.task`** (pinned SHA-256s above) on a runtime we control. Either:
  - convert them to ONNX at fetch time with tf2onnx 1.17.0, as recommended for the server in §2 (parity with TFLite measured there: 2e-4 px, 4.8 MB, about 8 ms on CPU), and run that same ONNX on `onnxruntime-web` (preferred: one runtime, one artefact); or
  - run the `.tflite` files with `@litertjs/core`.

  Do **not** take a dependency on the `@mediapipe/tasks-vision` binaries ≥ 1.0.0.
- **If the owner still prefers the MediaPipe Tasks API** for speed of delivery, pin `@mediapipe/tasks-vision@0.10.35`, self-host the wasm and model, and enforce `connect-src 'self'`. Record an owner exception for the Google APIs ToS overlay and for the frozen version.
- **Android: `onnxruntime-android@1.30.0` + YuNet**, with ORT telemetry disabled:
  - manifest-merger removal of `ai.onnxruntime.TelemetryInitializer`;
  - `Os.setenv("ORT_DISABLE_TELEMETRY", "1", true)` before the first ORT call;
  - a unit test asserting the merged manifest has no `INTERNET`-only-for-telemetry provider;
  - or pin 1.28.0.

  Add the extracted FaceMesh V2 ONNX/TFLite later if needed.
- **Reject:**
  - published MediaPipe Android AARs (telemetry with no switch, in every version);
  - ML Kit (proprietary ToS);
  - face-api.js and @vladmandic/* (unmaintained or unclear weights).
- **Update PLAN §3.** Its "MediaPipe Face Landmarker (client)" row and the Phase 10 "selfie active liveness with MediaPipe" bullet should be updated accordingly.

---

## 2. Server-side head pose (yaw / pitch / roll) for the pose challenge

The server re-measures the pose of each challenge frame (centre, left, right, and so on) independently of the client. Two routes: (a) the 5 YuNet landmarks we already have, solved with `cv2.solvePnP` against a generic 3-D face; (b) a dense-landmark model. Policy rule for (b): a model fails if its weights were trained on research-only data. That rules out almost every academic head-pose model, because they are trained on **300W-LP**, which is derived from 300W ("Commercial use (i.e., use in training commercial algorithms) is not allowed") and fitted with the **Basel Face Model** (internal, non-commercial research only).

| Candidate | Eco / source | Version / commit | Released | License: code / weights / training data (verified) | Verdict |
|---|---|---|---|---|---|
| **(a) YuNet 5 landmarks + `cv2.solvePnP` (SQPNP)** with a generic 3-D face | existing (`opencv-python-headless` 5.0.0.93 + YuNet in the manifest) | - | - | Code Apache-2.0 (OpenCV); no new weights. The 3-D reference points come from MediaPipe's Apache-2.0 canonical face (next row) | ⚠️ **Fallback / coarse only.** Works for the sign of a turn, but YuNet's landmarks are biased toward an upright face (measured below) |
| MediaPipe canonical face geometry (`canonical_face_model.obj`, 468 vertices; `geometry_pipeline_metadata_detection.pbtxt`, 6 detection keypoints) | GitHub google-ai-edge/mediapipe | tag v1.0.0 = 6d31f1e | 2026-07-28 | Apache-2.0 (repo LICENSE @ 6d31f1e, plus the Apache header in the `.pbtxt`) | ✅ Source of the 3-D model points for both (a) and (b). Small numeric constants; vendor them with attribution |
| **(b) MediaPipe Face Landmarker v2** (`face_landmarks_detector.tflite` inside `face_landmarker.task`), converted to ONNX | storage.googleapis.com `mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | object Last-Modified 2023-05-03; sha256 `64184e22…c9ff`, 3,758,596 B | 2023-05-03 | Weights **Apache-2.0** (model card "MediaPipe Face Mesh V2", model date 2022-09-15, "LICENSED UNDER Apache License, Version 2.0"). Training data: Google's own smartphone captures "via an AR application" (Face Mesh V2 card). The sibling BlazeFace card states "consented images", the Face Mesh V2 card does not mention consent (not verified for that model). No public dataset is involved | ✅ **Recommended.** Same model the web client runs (§1), so client guidance and server verification agree |
| Conversion tool `tf2onnx` (dev/build only) | PyPI | 1.17.0 (+ `tensorflow-cpu` 2.21.0 to run it) | 2026-03-04 (TF: 2026-03-06) | Apache-2.0 (`license_expression`) / Apache-2.0 | ✅ Build-time only, never in the runtime image. TF wheel is 274 MB |
| `tflite2onnx` | PyPI | 0.4.1 | 2022-11-13 | Apache-2.0 | ❌ in practice: fails on this model (`IndexError`, float16 unsupported, tested) and unmaintained since 2022 |
| Run the `.tflite` directly with `ai-edge-litert` | PyPI | 2.3.0 | 2026-10-06 | Apache-2.0 classifier, but its runtime dependencies include **tqdm (MPL-2.0 AND MIT)** | ⚠️ Same MPL-at-runtime problem as `rapidocr` in Phase 3; a 21.8 MB wheel and a second inference runtime. Not recommended |
| 6DRepNet / 6DRepNet360 (thohemp) | GitHub | 464b2ba / b06e4fe | last push 2024-07 / 2024-06 | Code MIT. Weights trained on **300W-LP** (+ BIWI 70/30 variant; 6DRepNet360 adds **CMU Panoptic**: "shared only for research purposes, and this cannot be used for any commercial purposes") | ❌ weights |
| Hopenet (natanielruiz/deep-head-pose) | GitHub | f7bbb99 | last push 2023-05 | Code Apache-2.0 (LICENSE.md). Weights on Google Drive, trained on 300W-LP | ❌ weights |
| FSA-Net (shamangary) | GitHub | 4361d0e | last push 2022-12 | Code Apache-2.0. Weights on 300W-LP / BIWI | ❌ weights |
| yakhyo/head-pose-estimation | GitHub | 42556cb | last push 2026-10-20 | Code MIT. Weights "Trained on 300W-LP" (README) | ❌ weights |
| SynergyNet (choyingw) | GitHub | 9de11e2 | last push 2026-02 | Code MIT. Weights on 300W-LP, and the 3DMM bases are **BFM**-derived ("internal, non-commercial research, evaluation or testing purposes only", BFM licence PDF §2.1/§3.1) | ❌ |
| 3DDFA_V2 (cleardusk) | GitHub | 1b6c676 | last push 2024-02 | Code MIT. Trained on 300W-LP; ships BFM-derived files | ❌ |
| img2pose (vitoralbiero) | GitHub | fd5473e | last push 2022-08 | **CC BY-NC 4.0** (README badge); trained on WIDER FACE | ❌ |
| PFLD (polarisZhao/PFLD-pytorch, guoqiangqi/PFLD) | GitHub | b00750c / d654b2e | 2022-06 / 2025-05 | **No LICENSE file** (all rights reserved). Trained on **WFLW**, whose images are WIDER FACE ("Creative Common License (cc by-nc-nd)" on the WIDER FACE page) | ❌ |
| STAR (ZhenglinZhou) | GitHub | 9b12574 | 2024-06 | No LICENSE file. Weights on WFLW / 300W / COFW | ❌ |
| SPIGA (andresprados) | GitHub / PyPI `spiga` | 656f90a | 2024-05 | Code BSD-3-Clause. Weights per dataset (WFLW, 300W, MERLRAV, COFW): research-only data | ❌ weights |
| InsightFace `2d106det` / `1k3d68` | GitHub deepinsight/insightface | c6c3af7 | 2026-10-19 | Code MIT, but "the models trained with these data are available for non-commercial research purposes only" (README "License") | ❌ |
| OpenCV `cv2.face` Facemark LBF + `lbfmodel.yaml` | opencv_contrib (Apache-2.0); model in kurnianggoro/GSOC2017 | 7523caa | 2020-06 | `cv2.face` is **not** in `opencv-python-headless` (contrib only, checked: `'face' in dir(cv2)` is False on 5.0.0). Model repo has **no LICENSE**; the model is trained on **HELEN** (Flickr images, no licence); 56 MB | ❌ |
| OpenCV Zoo | GitHub opencv/opencv_zoo | 47534e2 (pinned) and HEAD 48b10fa (2026-10-20) | - | Has **no face-landmark, head-pose or anti-spoofing model** at either commit (models/: YuNet, SFace, eDifFIQA, facial-expression, MediaPipe palm/hand/person/pose, …) | n/a. Precedent: `pose_estimation_mediapipe` is a MediaPipe `.tflite` converted with tf2onnx and shipped under Apache-2.0 |

### Empirical checks

Run in a scratch venv: Python 3.12, opencv-python-headless 5.0.0.93, onnxruntime 1.31.0, tf2onnx 1.17.0, tensorflow-cpu 2.21.0. Inputs were the PD fixtures (`fixtures/generated/selfie-{a,b}.jpg`, `fixtures/faces/*`), read-only. Nothing in the repo was touched.

**(a) 5-point PnP.** The 3-D points use MediaPipe canonical coordinates in cm (Y up, Z toward the viewer; flip Y and Z for OpenCV camera axes), in YuNet's order:

| Point | x | y | z |
|---|---|---|---|
| right eye | -3.1511 | 2.6246 | 3.4657 |
| left eye | 3.1511 | 2.6246 | 3.4657 |
| nose tip | 0 | -1.1269 | 7.4756 |
| right mouth corner | -2.4562 | -4.3426 | 4.2839 |
| left mouth corner | 2.4562 | -4.3426 | 4.2839 |

- The eye points are the detection-keypoint centres in `geometry_pipeline_metadata_detection.pbtxt`, equal to the midpoint of mesh vertices 33/133 and 362/263. The mouth corners are mesh vertices 61 and 291.
- Intrinsics: f = image width, principal point at the centre, no distortion.
- `SOLVEPNP_ITERATIVE` **cannot be used with 5 non-coplanar points without an initial guess**: its DLT initialisation needs at least 6. Use `SOLVEPNP_SQPNP`, or EPnP followed by LM refinement.

Synthetic test: the 3-D model projected with known pose (yaw ±40°, pitch ±25°, roll ±20°, 400 samples per row):

| Condition | SQPNP median abs. error yaw / pitch / roll | p90 |
|---|---|---|
| exact model, no noise | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |
| landmark noise 2 % of inter-ocular distance (IOD) | 1.0 / 1.1 / 0.6 | 2.6 / 2.9 / 1.5 |
| noise 5 % IOD | 2.7 / 3.2 / 1.6 | 6.2 / 7.5 / 4.0 |
| noise 3 % + 8 % face-shape jitter | 3.3 / 3.5 / 1.8 | 8.4 / 8.5 / 4.6 |
| … + true focal length 0.7·W (model assumes W) | 3.9 / 3.9 / 1.8 | 9.6 / 9.3 / 4.6 |

The pure-geometry yaw ratio `(x_nose − x_eye_mid) / IOD`, computed after de-rolling by the eye line, gives the turn direction correctly in 98–100 % of samples with |yaw| > 15°. Its magnitude is poor, though: median error 4–6° and p90 12–16° after fitting sin(yaw) ≈ k·ratio (k ≈ −0.9…−0.96). Roll from the eye line has a median error of 1–3°.

**The real limit is YuNet's landmarks, not PnP.** Rotating a PD selfie in-plane by a known angle and re-detecting shows that YuNet's landmarks are pulled toward an upright template:

| In-plane rotation | Eye-line angle (YuNet) | Eye-line angle (truth) | Landmark error |
|---|---|---|---|
| 10° | −10.9° | −15.9° | up to 0.12 IOD |
| 20° | −15.3° | −25.9° | up to 0.21 IOD |
| 30° | −21.4° | −35.9° | up to 0.27 IOD (left eye and left mouth corner worst) |

Through 5-point PnP, a 20° roll read back as −10…−11° (or +19…+21° in the other direction, which is asymmetric). Pitch drifted by up to 24° under pure in-plane rotation (selfie-b at 30°: pitch +22°). Frontal studio portraits read pitch +9…+14° (bias), and mirroring person-a-id moved pitch from 8.7° to 18.0°.

**Conclusion for (a):** good enough for the *sign* of yaw relative to the user's own centre frame. It is not good enough for calibrated angle thresholds, pitch challenges ("look up/down"), or roll. Real yawed faces were not available, so yaw compression on real turns is **unverified**.

**(b) MediaPipe Face Landmarker → ONNX.**

- **Conversion and parity.** `python -m tf2onnx.convert --tflite face_landmarks_detector.tflite --opset 17` succeeds. Against the TFLite interpreter on a real face crop, the maximum absolute difference is 2.0e-4 px on the 478×3 landmarks and 1.5e-5 on the presence logit.
- **Model shape.** Input `[N,256,256,3]` RGB float in [0,1]: a face crop with 25 % margin, which per the model card should be rotation-aligned ("not suitable for … inclined from the vertical orientation (more than 8°)"). Outputs:
  - `Identity` [N,1,1,1434]: 478 × (x, y, z) in input pixels;
  - `Identity_1`: face-presence logit;
  - `Identity_2` [N,1]: an undocumented third output (**unverified**).
- **Size and speed.** The ONNX file is 4.8 MB (fp16 weights expanded to fp32); about 8 ms per inference on CPU (onnxruntime 1.31, this machine).
- **Byte stability.** Two tf2onnx runs give **different bytes** (random initializer names and `unk__NNNN` dimension names). After canonical renaming (tensors renamed by topological order, symbolic dimensions renamed, doc strings cleared, about 30 lines of `onnx` code), both runs are **byte-identical** (sha256 `b3d0b72e…ddfd3` on this machine) and numerically identical to the raw conversion. Cross-machine reproducibility is **unverified**.
- **Pose quality.** Pose from all 468 points with `solvePnP(SQPNP)` against `canonical_face_model.obj`. The test crops were *not* rotation-aligned, the worst case.

  | Image | In-plane rotation | Roll delta read back |
  |---|---|---|
  | selfie-a | 10° | −9.4° |
  | selfie-a | 20° | −18.5° |
  | selfie-a | 30° | −24.9° |
  | selfie-a | −20° | +17.6° |
  | selfie-b | 10° | −9.4° |
  | selfie-b | 20° | −17.4° |
  | selfie-b | 30° | −22.0° |
  | selfie-b | −20° | +18.2° |

  Yaw and pitch stay within about ±2° of their 0° values. The yaw sign flips under mirroring. Presence was 1.000 on every frame.

**Recommendation:**
1. **Server pose = MediaPipe Face Landmarker converted to ONNX, run on our existing onnxruntime.** The pipeline:
   - YuNet box;
   - de-roll the crop by the YuNet eye line (one or two iterations);
   - 1.5× square crop, 256², RGB/255;
   - 478 landmarks;
   - `solvePnP(SQPNP)` against the canonical mesh, f ≈ image width.

   Check the **pose deltas relative to the session's own centre frame**, not absolute angles: this removes the per-person pitch bias and the unknown focal length.
2. **Pinning.** Pin `face_landmarker.task` by sha256 (`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`). Either:
   - (i) convert at fetch time in a dev-only tool environment (tf2onnx 1.17.0 + tensorflow-cpu 2.21.0), then canonicalise and verify a pinned sha256 *of the output* (works if it proves reproducible across machines); or
   - (ii) publish the canonical ONNX as an OpenVerify release asset with its sha256, recording the source `.task` digest and the converter versions in the manifest.

   TensorFlow never enters the runtime image.
3. **Fallback.** Keep YuNet + 5-point SQPNP (no extra weights) as the fallback and for the coarse left/right sign test only. Document its upright bias.
4. **Excluded.** Do not use any 300W-LP, WFLW, BIWI, Panoptic, BFM or InsightFace-trained head-pose model.

---

## 3. Passive liveness (presentation-attack detection)

| Candidate | Eco / source | Version / commit | Released | License: code / weights / training data (verified) | Verdict |
|---|---|---|---|---|---|
| **MiniFASNetV2 (scale 2.7) + MiniFASNetV1SE (scale 4.0)**, upstream `.pth` | GitHub minivision-ai/Silent-Face-Anti-Spoofing | HEAD b6d5f04 (2020-08-05; last push 2023-10) | 2020-06/08 | **Code and the committed `.pth` files: Apache-2.0** (LICENSE @ b6d5f04, "Copyright 2020 Minivision"; the weights sit in `resources/anti_spoof_models/` of the same repo). **Weights: no separate statement**, and an open issue asking exactly this (#146, opened 2026-10-14) is unanswered. **Training data: undisclosed and proprietary**: never published; issue #108 says it is the company's internal collection; the README gives no dataset name | ⚠️ **Keep, with a documented provenance caveat** (same class of caveat as SFace and YuNet, below) |
| **Pinned ONNX** (`MiniFASNetV2.onnx`, `MiniFASNetV1SE.onnx`, already in `models/manifest.json`) | GitHub yakhyo/face-anti-spoofing, release `weights` | repo @ aea85c1 (pinned; HEAD now 01a3890, 2026-10-20). Assets uploaded 2025-12-20 | 2025-12-20 | Repo LICENSE is the Apache-2.0 text, but **its appendix line is unfilled** ("Copyright [yyyy] [name of copyright owner]"; GitHub detects Apache-2.0). The GitHub release digests equal the manifest sha256s (V2 `b32929ad…3907`, V1SE `ebab7f90…3676`). Exported with `torch.onnx.export`, opset 17, dynamic batch (`onnx_export.py`); ONNX producer "pytorch 2.8.0" | ✅ for the **conversion chain**: proven functionally identical to upstream (below). The weights inherit the ⚠️ above |
| deepface `FasNet` (serengil/deepface) | PyPI `deepface` | 0.0.103 (0.0.102 = 2026-10-09) | 2026-10-20 | Code MIT. It uses **the same MiniFASNet weights**: the PyTorch backend downloads from minivision `master`; the ONNX and TF backends from serengil/deepface_models release v1.0 (re-uploaded 2026-09-30, different bytes: V2 `2e0b0bdc…`, V1SE `1e2645be…`). Identical fusion (sum, argmax, /2). Runtime dependencies include tqdm (MPL), requests → certifi (MPL), gdown, pandas, opencv-contrib, retina-face | ❌ as a dependency (adds nothing over our own 60 lines; MPL at runtime). Useful only as a cross-check of the preprocessing |
| hairymax/Face-AntiSpoofing | GitHub | eed4e27 (2022-09) | - | **No LICENSE file**; trained on **CelebA-Spoof** ("available for non-commercial research purposes only … You agree not to further copy, publish or distribute any portion") | ❌ |
| CDCN / CDCN++ (ZitongYu/CDCN) | GitHub | fd8370e (2023-03) | - | LICENSE opens with "It is just for research purpose, and commercial use should be contacted with authors first", then MIT text. No released weights; trained on **OULU-NPU** (signed institutional EULA required; terms not public, **unverified**) / SiW / CASIA-SURF | ❌ |
| OpenCV Zoo | GitHub opencv/opencv_zoo | 47534e2 / HEAD 48b10fa | - | No anti-spoofing model in `models/` at either commit | n/a |
| InsightFace / commercial PAD SDKs (ID R&D, FaceTec, KBY-AI, …) | - | - | - | Non-commercial (InsightFace models) or proprietary | ❌ (adapter-only territory) |

### Licence-chain proof for the pinned ONNX files

1. **Same weights, re-saved.** Downloaded the upstream `2.7_80x80_MiniFASNetV2.pth` (1,849,453 B, sha256 `a5eb02e1…bec0`) and `4_0_0_80x80_MiniFASNetV1SE.pth` (1,856,130 B, `84ee1d37…5990`) at b6d5f04 (legacy torch pickle). Also downloaded yakhyo's `MiniFASNetV2.pth` / `MiniFASNetV1SE.pth` (zip format, keys renamed). Loaded all four with `torch.load(weights_only=True)`, torch 2.14.1 CPU. The tensor values are bit-identical (max abs diff 0.0); only the key names differ.
2. **ONNX matches the upstream model.** Built upstream's own `src/model_lib/MiniFASNet.py` (`conv6_kernel=(5,5)` for 80×80, `num_classes=3`), loaded the upstream `.pth`, and compared softmax outputs with our pinned ONNX on random 0–255 inputs:
   - V2: max |Δ| = 1.2e-7;
   - V1SE: max |Δ| = 9.3e-9.

   Conv weights are not byte-identical in the ONNX file because BatchNorm is folded at export, which is expected.
3. **Conclusion.** The manifest's ONNX files are an Apache-2.0 redistribution of Minivision's Apache-2.0 checkpoints. The only open questions are the undisclosed training data, and Minivision never explicitly confirming that the LICENSE covers the checkpoints (issue #146).

### Exact preprocessing and fusion (upstream `test.py`, `src/generate_patches.py`, `src/anti_spoof_predict.py`, `src/data_io/functional.py` @ b6d5f04)

1. **Crop box.** Input is the face box `[x, y, w, h]` from upstream's own detector (`Widerface-RetinaFace.caffemodel`, a Caffe SSD-style net run on a ≤192² downscale). `CropImage._get_new_box` then works as follows:
   - `scale = min((H−1)/h, (W−1)/w, s)` with s = 2.7 for V2 and 4.0 for V1SE. The scale is parsed from the filename: `4_0_0_80x80…` gives `info[0]='4'`, so 4.0;
   - a box of `w·scale × h·scale` around the box centre;
   - if it overflows an image edge, it is **shifted back inside, keeping its size** (not clamped);
   - `img[t:b+1, l:r+1]`, then `cv2.resize` to 80×80 (bilinear). The aspect ratio is not preserved: the box's w:h is squashed to 1:1.

   yakhyo's `onnx_inference.py` **clamps instead of shifting** (asymmetric, smaller crops at edges). Reimplement upstream's shift.
2. **Pixels: BGR, float32, raw 0–255, no mean or std.** `to_tensor` deliberately skips `/255`: the code reads `# return img.float().div(255)  modify by zkx` / `return img.float()`. The layout is CHW, NCHW batch 1.
3. **Per-model output.** 3 logits, softmax. **Class 1 = real.** Classes 0 and 2 are undocumented attack types (community reading in issue #93: "electronic" vs other attacks, **unverified**).
4. **Fusion.** Sum the two softmax vectors, take the argmax; `score = sum[label] / 2`, the mean probability. A calibrated variant should threshold **mean P(real)** rather than argmax. Upstream also requires a **3:4 portrait frame** (`check_image`: width/height must equal 3/4, "because the Android APK video stream is 3:4") and a face within ±30° rotation (README).

### Empirical checks

Scratch venv: Python 3.12, OpenCV 5.0.0.93 (YuNet), onnxruntime 1.31.0, with OpenCV 4.14.0.94 only to run upstream's Caffe detector, because **OpenCV 5.0 removed `cv2.dnn.readNetFromCaffe`**. The fixtures are PD faces and are synthetic attacks, *not* real recaptures.

| Input (640×480 unless noted) | mean P(real) | V2 | V1SE |
|---|---|---|---|
| `selfie-a` fake-camera frame (a crop of a studio photo, i.e. a *digital injection*) | 0.971 | 0.962 | 0.980 |
| `selfie-b` fake-camera frame | 0.997 | 0.996 | 0.999 |
| full-frame "screen" simulation (½-res resample + sinusoidal moiré + gamma + blur), a / b | 0.923 / 0.997 | | |
| "print" simulation (desaturate, lifted blacks, halftone-like dots, noise), a / b | 0.958 / 0.998 | | |
| JPEG q30, a / b | 0.977 / 0.993 | | |
| **screen shown inside a dark scene with a visible bezel** (70 % of frame), a / b | **0.046 / 0.490** (argmax class 2 for both) | 0.020 / 0.733 | 0.071 / 0.246 |
| PD studio portraits at 640 px (person-a-id, person-a-selfie, person-b-selfie) | 1.000 / 0.975 / 0.993 | | |

Box and scale mismatch, YuNet vs upstream detector on the same frames:

| Frame | Detector | Box w:h | Box height / frame | Effective crop scale |
|---|---|---|---|---|
| selfie-a | YuNet | 0.76 | 0.41 | 2.44 (both models) |
| selfie-a | upstream | 0.96 | 0.36 | 2.70 / 2.80 |
| selfie-b | YuNet | 0.77 | 0.44 | 2.25 |
| selfie-b | upstream | 0.99 | 0.39 | 2.56 |

YuNet boxes are taller and start higher than upstream's (box top y = 121–123 vs 145–147).

Readings:
- (i) Both models score **digitally injected** frames, and synthetic full-frame moiré, print and compression, as real. They react to **context cues in the wide crop** (bezel, screen edge), which is what the 2.7/4.0 crop design is for.
- (ii) At normal selfie framing (face about 40 % of frame height), the 4.0 crop is **clipped to about 2.2–2.8**. V1SE never sees its trained context unless the face is ≤ ¼ of the frame height.
- (iii) Feeding YuNet boxes shifts the crop geometry relative to training.

**Known weaknesses** (from the README, issues and the above):
- The author's own answer to a 0.99–1.00 false accept (issue #62) is "The open source model has its limitations."
- The README warns that RGB silent liveness "depend[s] on camera model and scene", and claims TPR 97.8 % at FPR 1e-5 only for the APK model on a private test set.
- No independent cross-dataset evaluation of these exact checkpoints was found (searched 2026-10-21; **unverified**).
- Not a defence against injection (virtual cameras, emulators, deepfakes), high-quality bezel-less replays, or 3-D masks.
- Sensitive to face scale, framing and detector box geometry.
- Trained on 3:4 Android frames.

**Recommendation:**
1. **Keep the MiniFASNet ensemble** (no alternative passive PAD with permissive weights and permissive data exists) as `stage: beta`, reporting mean P(real) as the confidence score.
2. **Reimplement upstream preprocessing exactly:** shift-not-clamp crop, BGR, raw 0–255, 80×80, sum of softmax.
3. **Adapt YuNet boxes** toward the upstream detector's near-square, lower-centred box (e.g. square on the box height with a centre offset). Calibrate the transform and the threshold on the fixture set rather than reusing upstream's 0.5.
4. **Take the passive frame at a framing where the 4.0 context fits**, or accept the clipped scale and calibrate on it. Record the effective scale in the check details.
5. **Treat passive liveness as one layer**: active pose challenge (§2) plus capture integrity (§11) are what stop injection.
6. **Licensing.** Document the weights caveat in THIRD_PARTY_LICENSES: Apache-2.0 by repository LICENSE, training data undisclosed, upstream issue #146 open. Optionally fill the manifest `upstream` field with the upstream `.pth` sha256s above, so the chain can be re-verified. Do not depend on deepface; do not use CelebA-Spoof, OULU, SiW or CASIA-trained models.

---

## 4. Age estimation (`selfie_age_comparison`, A/H tier)

Checked 2026-10-21. For each model the licence of the **code**, of the **weights** and of the **training data** was read separately. A weight file is only as clean as the data it was fitted on. A permissive tag on a model card does not remove a non-commercial restriction on the images, and neither does an Apache-2.0 base backbone. Sizes are the published file sizes. Hugging Face (HF) shas are the model-repo commits read through `https://huggingface.co/api/models/<id>`.

### 4.1 Ready-made models

| Candidate | Source | Version / commit | Released | Code / weights / training-data licence (verified) | Verdict |
|---|---|---|---|---|---|
| OpenCV Zoo | opencv/opencv_zoo | main @ 48b10fa | 2026-10-20 | The `models/` listing at that commit has no age or demographic model. The face entries are `face_detection_yunet`, `face_recognition_sface`, `face_image_quality_assessment_ediffiqa` and `facial_expression_recognition` | n/a: nothing to adopt |
| Levi & Hassner `age_net.caffemodel` (45.7 MB; the classic OpenCV-DNN age demo) | GilLevi/AgeGenderDeepLearning | @ 2d591d4 | 2018-06-29 | **Code and weights:** the repo has no LICENSE file, only "Copyright 2015, Gil Levi and Tal Hassner … provided 'as is'", so all rights are reserved. **Data:** Adience. Its LICENSE.txt grants use "for your research purposes only", and "All images are copyright by the original authors" | ❌ |
| deepface `Age` model (`age_model_weights.h5` 538.8 MB; `.onnx` 538.7 MB, sha256 `6f86e678…`) | serengil/deepface + serengil/deepface_models | deepface v0.0.101 @ 606a86d (newest at least 14 days old; v0.0.102 is from 2026-10-09 and v0.0.103 from 2026-10-20). Weights: release `v1.0` @ b55240f | 2026-09-16 / weights 2021-07-02 | **Code and weights repo:** MIT. **Weights:** transfer-learned from **VGG-Face**, which Oxford VGG says "can be used for non-commercial research purposes". They were then fine-tuned on the **Wiki half of IMDB-WIKI** (author's tutorial), and IMDB-WIKI is "made available for academic research purpose only". The deepface README itself warns that "License types will be inherited" | ❌ |
| yu4u/age-gender-estimation (Keras, WideResNet) | GitHub | @ 6af6148 | 2020-08-21 | **Code:** MIT (LICENSE). **Weights:** release v0.5 (`weights.29-3.76_utk.hdf5`), trained on **IMDB-WIKI** (research only) and **UTKFace** ("available for non-commercial research purposes only"). The README's own licence section restates the IMDB-WIKI conditions | ❌ |
| yu4u/age-estimation-pytorch | GitHub | HEAD (last push 2024-07-25) | 2024-07 | **Code:** MIT (repo metadata). **Weights:** trained on **APPA-REAL**, whose ChaLearn page states no licence; the images were collected from the internet. Exact terms are unverified, so treat the weights as not cleared | ❌ |
| SSR-Net (shamangary) | GitHub | @ f98b6cb | 2019 (README "last update 2019/09/19") | **Code:** Apache-2.0 (LICENSE on master). **Weights:** trained on IMDB-WIKI (research only), **MORPH2** (access by application form) and MegaAge-Asian (non-commercial). The MORPH2 terms themselves were not read and are unverified | ❌ |
| **MiVOLO** v1 checkpoints (Google Drive) | WildChlamydia/MiVOLO | @ 37475e3 | 2026-06-04 | **Code:** Apache-2.0 since 2026-03-11. Commit 0b5b308 removed the earlier `license/en_us.pdf` and `ru.pdf` custom licence, and fd5e933 added the Apache-2.0 file. **Weights:** trained on IMDB-clean (from IMDB-WIKI, research only), UTKFace (non-commercial) or LAGENDA, and hosted on mutable Google Drive. The LAGENDA checkpoint is published only as a "demo". **Pipeline:** needs `ultralytics==8.1.0`, which is **AGPL-3.0**, for its person+face YOLOv8 detector | ❌ |
| **MiVOLO v2** (`model.safetensors` 115 MB, LFS oid `96efb470…`) | HF `iitolstykh/mivolo_v2` | @ 5339352 | 2026-03-11 | **Card:** `license: apache-2.0`. **Data:** the card says only "trained on proprietary and open-source datasets", without naming them, so provenance is undisclosed. It is a face+body model that runs with `trust_remote_code`. Best accuracy of the group (paper arXiv:2403.02302) | ⚠️ The weight licence is permissive, but the data is unknown and possibly includes IMDB-clean or UTK. Do not fetch or ship it. At most, an operator may supply it to an adapter |
| InsightFace `genderage.onnx` (buffalo_l pack) | deepinsight/insightface | @ c6c3af7 | 2026-10-19 | **Code:** MIT. **Models:** the README says the training data "and the models trained with these data … are available for non-commercial research purposes only", and the python-package README repeats this | ❌ |
| **FairFace** ResNet-34 (`res34_fair_align_multi_7_20190809.pt`, `fairface_alldata_4race_20191111.pt`) | joojs/fairface (dataset) + dchen236/FairFace (code) | @ fb82308 / @ 74b4f93 | dataset README 2026-01-04 / code 2023-04-06 | **Dataset:** README says "License: CC BY 4.0", with no LICENSE file. Per the paper, the images come from YFCC-100M filtered to **CC BY and CC BY-SA** ("allow derivative work and commercial usages"). Its comparison table also lists Twitter and newspapers as sources. No per-image author attribution ships with it. **Code repo:** no licence. **Weights:** Google Drive (mutable), with no stated weight licence. **Init:** torchvision `resnet34(pretrained=True)`, i.e. ImageNet. **Outputs:** an 18-way head (**7 race** + 2 gender + **9 coarse age bins**: 0-2, 3-9, 10-19, 20-29, …, 70+) | ⚠️ / ❌ Too coarse for 18/21 decisions. The race head is a problem under EU AI Act Art. 5(1)(g), which bans biometric categorisation that infers race. The weights carry no licence. Do not ship |
| `nateraw/vit-age-classifier` (343 MB) | HF | @ 4b5acc3 | 2024-07-28 | **Card:** no `license` field, so all rights reserved by default. **Data:** `nateraw/fairface` (CC-BY-4.0 tag). **Base:** ViT-B/16 in21k | ❌ |
| `dima806/facial_age_image_detection` | HF | @ ad35933 | 2024-10-19 | **Card:** `apache-2.0`. **Base:** `google/vit-base-patch16-224-in21k`. **Data:** a Kaggle notebook whose input dataset the card does not name (unverified) | ❌ Undisclosed data |
| `prithivMLmods/Age-Classification-SigLIP2` (372 MB), `open-age-detection`, `facial-age-detection` | HF | @ b41e62c / @ 65bdfec / @ ceb5703 | 2025-03-28 / 2025-05-20 / 2025-05-29 | **Cards:** `apache-2.0`. **Base:** SigLIP2, Apache-2.0, trained on Google's proprietary WebLI. **Data:** `prithivMLmods/Age-Classification-Set` @ 4f36af4 and `Face-Age-10K` @ 7965e76, both *tagged* apache-2.0 but **with no provenance for the face images**. Face-Age-10K's 200×200 crops match UTKFace's aligned-crop size (an inference, unverified) | ❌ Licence-laundering risk |
| `google/vit-base-patch16-224-in21k` (base only) | HF | @ b456956 | 2024-02-05 | **Weights:** `apache-2.0`. **Data:** ImageNet-21k, whose terms of access say "Researcher shall use the Database only for non-commercial research and educational purposes" (image-net.org) | ⚠️ The usual ImageNet-pretraining caveat. It applies to every ViT-based row above |

### 4.2 Age-labelled datasets (the data that would taint or clear weights)

| Dataset | Terms (verified on the official page unless marked) | Verdict |
|---|---|---|
| IMDB-WIKI (ETH) | "made available for academic research purpose only" | ❌ |
| Adience (OUI) | LICENSE.txt: "use … for your research purposes only"; images © their authors | ❌ |
| UTKFace | "available for non-commercial research purposes only"; age labels were estimated by DEX, then checked by a human | ❌ |
| AgeDB (iBUG) | "available for non-commercial research purposes only", with no redistribution | ❌ |
| MegaAge / MegaAge-Asian (CUHK, SenseTime) | "available for non-commercial research purposes only" | ❌ |
| APPA-REAL (ChaLearn LAP) | No licence on the dataset page; the images are from the internet (unverified) | ❌ until cleared |
| MORPH-II | Access by application (via SSR-Net README); the licence terms were not read (unverified) | ❌ until cleared |
| CelebA (the source of most attribute and genderage models) | "available for non-commercial research purposes only" | ❌ |
| **FairFace** | README: CC BY 4.0. Sources are YFCC-100M CC BY / CC BY-SA images plus Twitter and newspapers (paper Table 1). YFCC-100M itself is distributed under the Yahoo Webscope agreement plus per-photo CC terms; the Webscope text was not read (unverified) | ⚠️ Attribution is not shipped per image, and it is unsettled whether ShareAlike reaches trained weights |
| **LAGENDA** (MiVOLO authors) | 67,159 images from **Open Images**. Google lists those images as "having a CC BY 2.0 license" but makes "no representations or warranties regarding the license status of each image", while the Open Images annotations are CC BY 4.0. LAGENDA's own page says "The license for this dataset is CC 2.0", which is ambiguous about the variant | ⚠️ The cleanest age-labelled source found. Per-image attribution is recoverable from the Open Images metadata (Author/OriginalURL columns). No public model trained only on it is available |
| Casual Conversations v1/v2 (Meta) | Paid, consenting participants with **self-reported** age. Meta's pages describe the use as assessing already-trained models under its data user agreement. The agreement text was not read (unverified) | ⚠️ Evaluation only, for an operator, under Meta's agreement. Not for training. Not fetched by our scripts |

**Consent and biometric-law overlay.** None of the scraped datasets above (FairFace, LAGENDA, IMDB-WIKI, UTKFace) has subject consent for biometric processing.
- **Litigation precedent.** IBM's YFCC-100M-derived "Diversity in Faces" set led to BIPA class actions: *Vance v. IBM*, N.D. Ill. No. 1:20-cv-00577 (partially dismissed 2020-09-15), plus parallel suits against Microsoft and Amazon (summary judgment for the defendants, W.D. Wash., 2022-10-17).
- **Regulatory use.** Facial age estimation is a mainstream age-assurance method. Secondary sources report that Ofcom's 16 January 2025 Online Safety Act guidance lists it among methods "capable of" being highly effective, though Ofcom notes weaker accuracy at younger ages. NIST runs a standing evaluation (FATE Age Estimation & Verification).
- **EU AI Act.** Art. 5(1)(g) prohibits biometric categorisation that infers race, among other attributes. Age is not on that list, but an operator must still assess Annex III 1(b) (biometric categorisation by protected attributes) for its deployment. This is an interpretation, not legal advice.

**Recommendation:**
- **No clean model.** No age-estimation weights were found where the code, the weights *and* the training data all pass rule 4.
- **What to ship in Phase 4:**
  - an **`AgeEstimationProvider` adapter interface**, returning an estimated age, an uncertainty interval and a model id;
  - a **deterministic sandbox provider**, for example one that derives the estimate from the inquiry's sandbox fixture or DOB, with a magic value that forces a mismatch.
- **How `selfie_age_comparison` decides:**
  - it compares the estimate ± uncertainty with the DOB-derived age from the ID and with the template's min/max limits;
  - with no provider configured it reports not executed, never passed (rule 5);
  - a configured provider's result is `stage: beta`.
- **Do not fetch or ship any third-party age weights**, MiVOLO v2 and FairFace included. An operator may point the adapter at an ONNX model of their own choosing and own that licence decision. Document MiVOLO v2 (Apache-2.0 card, undisclosed data) as the most capable "bring your own" option.
- **Clean path for a later phase.** The only one visible is to **train our own small age regressor on LAGENDA**: Open Images CC BY 2.0 images, with attribution carried from the Open Images metadata. Use YuNet-aligned crops and a backbone not pretrained on ImageNet, or one with cleared pretraining data. It needs explicit owner and legal sign-off first, because of the biometric-consent exposure above. It is out of scope for Phase 4.

---

## 5. Deepfake, AI-generated face and mask detection (`selfie_suspicious_entity_detection`, H/A tier)

Checked 2026-10-21. The licences of code, weights and training data are each listed. A detector inherits the terms of the datasets it was trained on.

### 5.1 Training datasets (they decide whether any pretrained detector is usable)

| Dataset | What it is | Terms (verified unless marked) | Verdict |
|---|---|---|---|
| FaceForensics++ (+ Google/Jigsaw DFD, hosted with it) | YouTube source videos manipulated with DeepFakes, Face2Face, FaceSwap, NeuralTextures and FaceShifter | Code MIT (repo LICENSE @ b952e41). The dataset is behind a Google Form plus the **FaceForensics Terms of Use** PDF: "Researcher shall use the Database only for non-commercial research and educational purposes" (§1), and a researcher's employer is also bound (§6) | ❌ |
| DFDC (Meta, 2020) | 100k+ clips from 3,426 **paid, consenting** actors | The download terms on ai.meta.com could not be retrieved (dataset page 404 on 2026-10-21). Secondary sources describe a non-commercial research licence (**unverified**). The Kaggle competition rules page did not render | ❌ until the terms are read |
| Celeb-DF v2 | YouTube celebrity videos | Released under "Terms to Use Celeb-DF" (Google Form; README @ 713a441). The originals are "obtained from the Internet" | ❌ |
| DeeperForensics-1.0 | Consented actors | README @ 7589587: "publicly available for non-commercial research purposes", bound by `dataset/Terms_of_Use.pdf`; only the perturbation code is MIT | ❌ |
| ForgeryNet | 2.9 M images, 221k videos | README @ 09e9737: "RESTRICTED to non-commercial research and educational purposes" | ❌ |
| WildDeepfake | 707 internet deepfake videos | Agreement form, terms not public (README @ b23d5a9, repo moved to xingjunm/wild-deepfake; **unverified**). Content is scraped from the internet | ❌ |
| DeepSpeak v1/v1.1/v2 (faridlab) | Consented speakers | HF datasets are gated (`manual`) under a custom `license: other` hosted as a Google Doc (v2 @ dd0d22e); text not read (**unverified**) | ❌ until cleared |
| CNNDetection ProGAN train set (Wang et al. 2020) | LSUN-based real/fake set, used by most "universal" AI-image detectors | Repo LICENSE @ ea0b562: **CC BY-NC-SA 4.0** | ❌ |
| 3DMAD (Idiap) | 3-D mask attacks, 17 subjects, Kinect | Zenodo record 4068477 `access_right: restricted` (Idiap request/EULA; text not read, **unverified**) | ❌ |
| HiFiMask, CelebA-Spoof | Mask / PAD sets | HiFiMask: CASIA-SURF application agreement (**unverified**). CelebA-Spoof's live images come from CelebA, which is "available for non-commercial research purposes only" | ❌ |

### 5.2 Pretrained detectors

| Candidate | Source | Version / commit | Released | Code / weights / training-data licence (verified) | Verdict |
|---|---|---|---|---|---|
| selimsef DFDC winner (EfficientNet-B7 NS ensemble, 7 × 267 MB) | GitHub | @ 89c6290; weights release `0.0.1` | 2021-11-08 / weights 2020-06-06 | Code MIT. Weights trained on **DFDC** (terms above). The backbone is `tf_efficientnet_b7_ns` (timm, ImageNet + JFT pseudo-labels) | ❌ |
| UniversalFakeDetect (Ojha et al., CVPR 2023): CLIP ViT-L/14 + linear head | WisconsinAIVision | @ 030495a | 2026-08-19 | Code MIT. The `fc_weights.pth` head was trained on the CNNDetection ProGAN set (**CC BY-NC-SA 4.0**). Backbone: OpenAI CLIP (repo MIT; WIT-400M data undisclosed) | ❌ |
| CNNDetection (Wang et al., CVPR 2020) | peterwang512 | @ ea0b562 | 2024-07-26 | Code, weights and data are all **CC BY-NC-SA 4.0** | ❌ |
| **GRIP ClipBased-SyntheticImageDetection** (Cozzolino et al., CVPRW 2024): CLIP features + linear SVM | grip-unina | @ c76ef7f | 2024-11-24 | **Code:** Apache-2.0 (README "License", `LICENSE.md`).<br>**Head weights:** in-repo via LFS (`clipdet_latent10k_plus/weights.pth`, 5,155 bytes, oid `1c9c9f48…`).<br>**Backbone:** `laion/CLIP-ViT-L-14-CommonPool.XL-s13B-b90K` (HF @ d979a50, `license: mit`, **1.71 GB**). It was trained on DataComp CommonPool, which is Common-Crawl-scraped and has no image licences.<br>**Head training data:** 10k COCO real images (Flickr; mixed CC licences, some NC) + 10k LDM fakes generated from COCO captions | ⚠️ The most permissive real option, but it detects **fully synthetic images, not face swaps**. Needs open_clip + torch (ONNX export unverified) and backbone provenance has the same caveat as ImageNet. Candidate for an optional, off-by-default adapter in a later phase |
| GRIP DMimageDetection (Corvi et al., ICASSP 2023): ResNet-50 | grip-unina | @ 745ad9e | 2024-05-30 | Code Apache-2.0. Trained on the ProGAN set (CC BY-NC-SA) or on LDM fakes + COCO/LSUN reals | ❌ (ProGAN variant) / ⚠️ (LDM variant: COCO/LSUN image terms) |
| `prithivMLmods/deepfake-detector-model-v1` (was `Deep-Fake-Detector-Model`; SigLIP2, 372 MB) | HF | @ c5cb24c | 2025-05-24 | Card `apache-2.0`. Data `prithivMLmods/OpenDeepfake-Preview` @ 233167b is *tagged* Apache-2.0 but states **no source** for its real or fake faces | ❌ Licence-laundering risk |
| `prithivMLmods/Deep-Fake-Detector-v2-Model` (ViT-B/16) | HF | @ 3a99ae2 | 2025-02-02 | Card `apache-2.0`; data "a curated dataset of real and deepfake images" (undisclosed) | ❌ |
| `dima806/deepfake_vs_real_image_detection` (ViT-B/16, 343 MB) | HF | @ 29e4cf9 | 2025-01-04 | Card `apache-2.0`; data is a Kaggle dataset not named on the card. The author warns of "significant concept drift" | ❌ |
| `Organika/sdxl-detector` | HF | @ b37fede | 2024-09-06 | **`cc-by-nc-3.0`**. The card says to use it for "non-commercial … fair uses only", because the base model was trained on Reddit-scraped images | ❌ |
| `umm-maybe/AI-image-detector` | HF | @ c7e223b | 2024-01-03 | Card `cc-by-4.0`, but trained on Reddit-scraped **art**. Its card says it "is not a deepfake photo detector" | ❌ (data, and unfit for purpose) |
| `haywoodsloan/ai-image-detector-deploy`, `Wvolf/ViT_Deepfake_Detection` | HF | @ 4ae1822 / @ f7f34ca | 2026-08-24 / 2024-01-08 | Apache-2.0 card with no data disclosure / no licence | ❌ |
| 3-D mask / PAD models | - | - | - | No permissively licensed model trained on permissive mask data was found. MiniFASNet (§3) targets print and replay, not 3-D masks | ❌ (none) |

### 5.3 Weight-free heuristics (H-tier default)

Every heuristic below works on the selfie and pose frames we already decode, with OpenCV and NumPy only (`cv2.dft`, `cv2.dct`, `np.fft`). Several reuse Phase 3 forensics code: the block DCT and the noise residual.

1. **Azimuthal-average spectrum (high-frequency tail).** Durall, Keuper, Pfreundt & Keuper, "Unmasking DeepFakes with simple Features", arXiv:1911.00686; Durall, Keuper & Keuper, "Watch your Up-Convolution", CVPR 2020, arXiv:2003.01826, DOI 10.1109/CVPR42600.2020.00791.
   - **Method:** take the 2-D FFT of the grey face crop, then log power, then a 1-D azimuthal average over radius, normalised. Up-convolution generators fail to reproduce the natural high-frequency tail, which shows as excess or deficit energy in the last ~25 % of radii.
   - **Score:** the tail-slope deviation of the face crop from the background of *the same frame*. Self-referencing cancels the camera and JPEG pipeline.
2. **Periodic up-sampling peaks in the noise residual.**
   - Sources: Zhang, Karaman & Chang, "Detecting and Simulating Artifacts in GAN Fake Images", WIFS 2019, arXiv:1907.06515, DOI 10.1109/WIFS47025.2019.9035107. Frank et al., "Leveraging Frequency Analysis for Deep Fake Image Recognition", ICML 2020, arXiv:2003.08685 (2-D DCT grid artefacts). Dzanic, Shah & Witherden, "Fourier Spectrum Discrepancies in Deep Network Generated Images", NeurIPS 2020, arXiv:1911.06465. Corvi et al., "On the detection of synthetic images generated by diffusion models", ICASSP 2023, arXiv:2211.00680, DOI 10.1109/ICASSP49357.2023.10095167. Corvi et al., "Intriguing properties of synthetic images", CVPRW 2023, arXiv:2304.06408 (diffusion models also show peaks).
   - **Method:** compute a high-pass residual (image minus a 3×3 median or denoised copy), average the patch-wise |FFT|² over patches, then score the peak-to-local-median ratio. **Mask out the k/8 cycles/pixel frequencies (JPEG grid) and Nyquist/2 (demosaicing)**, because genuine camera JPEGs peak there. Peaks elsewhere in the face region, absent from the background, are suspicious.
3. **JPEG grid / blocking-artefact inconsistency** (pasted or swapped face). Li, Yuan & Yu, "Passive detection of doctored JPEG image via block artifact grid extraction", Signal Processing 89(9), 2009, DOI 10.1016/j.sigpro.2009.03.025. Bianchi & Piva, "Detection of Nonaligned Double JPEG Compression Based on Integer Periodicity Maps", IEEE TIFS 7(2), 2012, DOI 10.1109/TIFS.2011.2170836. Bianchi & Piva, "Image Forgery Localization via Block-Grained Analysis of JPEG Artifacts", IEEE TIFS 7(3), 2012, DOI 10.1109/TIFS.2012.2187516.
   - **What it flags:** a face region whose earlier compression grid is *shifted* relative to the frame's, i.e. non-aligned double JPEG.
   - **Caveats:** our own client re-encode is aligned by construction, and many webcams deliver MJPEG, so *aligned* double compression is normal. Only misalignment confined to the face counts. Applies to uploads and to frames whose content was itself pre-compressed.
4. **Face vs background noise-level inconsistency.** Mahdian & Saic, "Using noise inconsistencies for blind image forensics", Image and Vision Computing 27(10), 2009, DOI 10.1016/j.imavis.2009.02.001.
   - **Method:** blockwise σ̂ = median(|HH₁ wavelet coefficients|)/0.6745, or the Laplacian residual already used in Phase 3. Compare the face crop with the neck and background. Blended face swaps are usually smoother than their surroundings.
5. **Canonical landmark positions** (StyleGAN/FFHQ-aligned faces). Yang, Li, Qi & Lyu, "Exposing GAN-synthesized Faces Using Landmark Locations", IH&MMSec 2019, arXiv:1904.00167. Raw StyleGAN outputs place the eyes and mouth at near-fixed image coordinates. Use YuNet's 5 landmarks normalised by image size, and flag a near match to the FFHQ template. It only applies to uploaded or API-submitted stills, and a crop defeats it.
6. **Corneal specular highlights.** Hu, Li & Lyu, ICASSP 2021, arXiv:2009.11924, DOI 10.1109/ICASSP39728.2021.9414582. Compare the IoU of the two eyes' highlight masks.
7. **Pupil shape.** Guo, Hu, Wang, Chang & Lyu, ICASSP 2022, arXiv:2109.00162, DOI 10.1109/ICASSP43922.2022.9746597. Check whether an ellipse fits the pupil boundary.
   - Both 6 and 7 were evaluated on 1024² FFHQ/StyleGAN faces. In a VGA selfie (face ≈ 216 px tall) the iris is about 10–15 px across, so neither is feasible on camera frames. Use them on high-resolution uploads only, or not at all; 7 also needs a pupil-segmentation model.
8. **Visual-artefact prompts for human review** (eye-colour mismatch, missing reflections, teeth detail, blending seams). Matern, Riess & Stamminger, WACVW 2019, DOI 10.1109/WACVW.2019.00020. Use them as reviewer guidance in the case UI, not as scores.
9. **Provenance metadata.**
   - **C2PA:** C2PA Technical Specification 2.3 (spec.c2pa.org). Read `c2pa.actions` → `digitalSourceType`.
   - **IPTC:** the IPTC Photo Metadata XMP property `Iptc4xmpExt:DigitalSourceType`, with IPTC NewsCodes (vocabulary modified 2024-10-23) `trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`, `compositeSynthetic` and `algorithmicMedia`.
   - **Reading the result:** a positive hit is a strong "suspicious" signal; absence means nothing, since metadata is trivially stripped.
   - **Scope:** applies only to uploaded or API images. Frames captured through our flow (canvas → JPEG) carry no metadata.
   - **Libraries:** Pillow `getxmp()` reads XMP and needs `defusedxml`. `c2pa-python` (MIT OR Apache-2.0) remains the Phase 3 "later" item.
- **3-D masks.** No image-level frequency signature exists. Remote photoplethysmography (Liu, Yuen, Zhang & Zhao, ECCV 2016, DOI 10.1007/978-3-319-46478-7_6) needs several seconds of stable framing, which the head-turn challenge corrupts. Not recommended for Phase 4.

**Limits.**
- **Robustness and generalisation.** Spectral detectors lose most of their power under resizing and recompression (Frank 2020; Corvi 2023 robustness experiments). Diffusion models leave weaker spectral traces than GANs (Ricker, Damm, Holz & Fischer, arXiv:2210.14571). Our own capture path downsizes and JPEG-encodes.
- **Out of reach.** Real-time face swaps injected through a virtual camera pass through video codecs and are mainly a capture-integrity problem (§11). Masks and good replays defeat all of the above.
- **How the check reports.** It ships as **`stage: beta`** with a confidence score and per-signal evidence, with outcomes `suspicious` / `not_flagged` / `inconclusive`. It never reports "passed" (rule 5), because not being flagged is not evidence of authenticity.

**Recommendation:**
- **Do not ship any pretrained deepfake, AI-face or mask weights in Phase 4.** Every face-forgery detector found is trained on FF++, DFDC, Celeb-DF, DeeperForensics, ForgeryNet or CNNDetection data (non-commercial or unverified), or on undisclosed data under an Apache-2.0 tag.
- **H-tier default, built from NumPy and OpenCV only:**
  - heuristic 9 (provenance metadata, uploads only);
  - heuristic 2 (residual spectral peaks, JPEG frequencies masked, face versus own background);
  - heuristic 1 (azimuthal tail deviation);
  - heuristic 4 (face/background noise inconsistency);
  - heuristic 3 (non-aligned JPEG grid confined to the face);
  - heuristic 5 (FFHQ-canonical landmarks, uploads only).
  - Fuse them into a calibrated confidence. Calibrate the false-positive rate on the public-domain real fixtures and their recompressed variants. Report the detection rate only on synthetic fixtures whose generator licence allows output use; choose that generator in the implementing slice (unverified here).
- **Adapter:** a `SuspiciousEntityProvider` interface plus a **deterministic sandbox provider** with magic inputs that force `suspicious`, for H/A tiers and commercial vendors.
- **Later phase (optional, off by default):** a CLIP-linear-probe adapter. Either take GRIP's Apache-2.0 head, or, better, fit our own linear SVM on a *clean* reference set: public-domain real photos plus outputs of a permissively licensed generator. The paper shows 10–1,000 pairs suffice (arXiv:2312.00195, Fig. 3). Record the backbone-data caveat (CommonPool or WIT) in THIRD_PARTY_LICENSES.

---

## 6. Face covering and glasses detection (H tier)

Neither check has a permissively licensed model whose training data is also clean. Every public mask or glasses classifier found is trained on WIDER FACE, MAFA, CelebA or web-scraped images. Both checks therefore ship as **heuristics on landmark-defined regions**, `stage: beta`, with a confidence score.

| Candidate | Eco / source | Version / commit | Released | License: code / weights / training data (verified) | Verdict |
|---|---|---|---|---|---|
| **Landmark-ROI heuristics** (OpenCV + NumPy only) on YuNet or MediaPipe landmarks | ours | - | - | Apache-2.0 (OpenCV), BSD-3 (NumPy); no weights | ✅ **use** (but see the patent note) |
| **MediaPipe Face Landmarker** as the ROI provider (478 points give exact lower-face, lip, nose-bridge and eye-rim polygons) | see §2 | `face_landmarker.task` sha256 `64184e22…c9ff` | 2023-05-03 | Apache-2.0 (model card) | ✅ if §2's recommendation is adopted. **No per-landmark visibility or occlusion output.** The presence score stayed 0.72–1.00 under synthetic masks |
| MediaPipe blendshapes (`face_blendshapes.tflite`, 52 coefficients) | same `.task` | same | same | Apache-2.0 (Blendshape V2 card, 2022-11-11) | ⚠️ Not an occlusion signal; useful only for expression challenges (blink, smile), out of scope here |
| YuNet confidence / landmarks | existing | `face_detection_yunet_2026may.onnx` | - | MIT | ⚠️ **One score per face, no per-landmark confidence.** Outputs are `cls_*` (1), `obj_*` (1), `bbox_*` (4) and `kps_*` (10) per anchor, and OpenCV computes `score = sqrt(cls·obj)` (`face_detect.cpp` @ 5.0.0). The score moved only from 0.94–0.95 to 0.90–0.92 with a synthetic mask, and YuNet still places mouth corners on the mask. Use as context, not as a covering signal |
| AIZOOTech/FaceMaskDetection | GitHub | 256dc65 (2022-01) | - | Code MIT; weights trained on **WIDER FACE (cc by-nc-nd) + MAFA** (README) | ❌ |
| chandrikadeb7/Face-Mask-Detection | GitHub | 7e50074 (2023-03) | - | Code MIT; dataset from **Bing image search scraping** and Kaggle (README "Dataset"); ImageNet-pretrained MobileNetV2 | ❌ |
| Glasses classifiers trained on CelebA attributes (many community repos) | - | - | - | CelebA: "available for non-commercial research purposes only" (CelebA page) | ❌ |
| InsightFace attribute or occlusion models | deepinsight/insightface @ c6c3af7 | - | - | Non-commercial research only | ❌ |
| OpenCV Zoo | opencv_zoo @ 47534e2 / 48b10fa | - | - | No mask, occlusion or glasses model (`face_image_quality_assessment_ediffiqa` and `facial_expression_recognition` exist, but neither detects covering) | n/a |

### Heuristics: ROIs from 5 YuNet points or MediaPipe polygons; IOD = inter-ocular distance

**Face covering** (mask, scarf, hand) over the lower face:
- **Self-referenced colour.** Compare the median L\*a\*b\* colour of the lower-face ROI with the same person's forehead and cheek ROIs. This avoids absolute skin thresholds, which are biased across skin tones.
- **Skin-pixel fraction.** YCrCb box 133 ≤ Cr ≤ 173, 77 ≤ Cb ≤ 127, from Chai & Ngan 1999 (bounds confirmed via a patent quoting them; not re-read in the paper itself). Use it only as one feature, and only relative to the forehead's own skin fraction.
- **Texture.** Laplacian variance or LBP histogram of the lower ROI against the forehead. Fabric is smoother or periodic; a hand adds strong edges.
- **Lip evidence** (with MediaPipe): colour contrast along the lip polygon. A covered mouth has no red-shifted lip band.

**Glasses:**
- edge density (Canny) in a nose-bridge window between the eyes (frame bridge);
- horizontal-edge energy in a band 0.15–0.35 IOD below each eye (lower rim);
- specular highlights (near-saturated pixels) inside the eye ROIs (lens glare).

Sunglasses add: eye ROIs much darker than the cheeks, and the eye or iris structure is missing.

### Empirical checks

Scratch venv, OpenCV 5.0.0.93. 640×480 selfie framings of the PD fixtures: person-a-id wears glasses, the other two do not. Synthetic masks were flat blue with pleats, or flat black. **n = 3 people; this checks the plumbing, not accuracy.**

| Case | YuNet | MP presence | Bridge edge | Rim edge | ΔE lower vs ref | Skin frac. lower |
|---|---|---|---|---|---|---|
| person-a-id (glasses) | 0.948 | 1.000 | **0.148** | **0.161** | 16.9 | 0.97 |
| person-a-selfie | 0.941 | 1.000 | 0.044 | 0.030 | 7.4 | 0.91 |
| person-b-selfie | 0.947 | 1.000 | 0.052 | 0.011 | 10.8 | 0.98 |
| + blue mask (a-id / a-selfie / b) | 0.905 / 0.910 / 0.924 | 0.995 / 0.992 / 0.717 | - | - | 15.1 / 15.6 / 11.0 | **0.00 / 0.00 / 0.03** |
| + black mask (a-id / a-selfie / b) | 0.908 / 0.910 / 0.922 | 1.000 | - | - | 62.5 / 62.2 / 64.8 | **0.00** |

Readings:
- The bridge and rim edge features separate glasses from no glasses about 3× on this tiny set.
- The skin fraction collapses under flat synthetic masks. **ΔE alone does not separate** a light-blue mask from a smiling, lipsticked lower face (16.9 vs 15.1).
- Skin-toned or patterned masks, beards, and dark skin under poor light are the expected failure modes (**unverified**: no realistic fixtures).
- Detector and landmarker confidence are not usable covering signals.

### Patent note (not legal advice; claims paraphrased from Google Patents, statuses as Google lists them)

- **US 7,657,086 B2** (Fujifilm). "Automatic eyeglasses detection using a nose ridge mask": a statistical decision from nose-ridge pixels against learned statistics of faces with and without glasses. Priority 2006-01-31; anticipated expiration **2027-06-11**.
- **US 10,395,094 B2** (Tencent). "Detecting glasses in a face image": locate the nose bridge and eyes, compute the grey-scale gradient across the nose bridge, and declare glasses when the ratio of mean gradient to mean gradient magnitude is below a threshold. Priority 2015-11-25; anticipated expiration **2037-02-07**. A nose-bridge gradient heuristic is close to this claim.
- **US 11,521,423 B2** (Apple). "Occlusion detection for facial recognition processes": landmark-based per-region occlusion scores. Claims not reviewed.

**Recommendation:**
1. **Ship both checks as H-tier heuristics**, `stage: beta`, using OpenCV and NumPy only.
   - Covering: lower-face skin fraction *relative to* the forehead, plus a texture ratio, plus (with MediaPipe) a lip-band contrast test. Combine them in a small logistic score calibrated on synthetic fixtures; output a confidence, never a hard "passed" without one.
   - Glasses: a multi-cue score (bridge edges plus lower-rim edges plus lens highlights) rather than any single nose-bridge statistic. Ask the owner for a legal read on US 10,395,094 B2 before shipping a nose-bridge-gradient feature in the US; the Fujifilm patent expires in 2027.
2. **Use MediaPipe landmarks for the ROIs when available** (§2); fall back to YuNet 5-point geometry.
3. **Do not ship** any mask or glasses model trained on WIDER FACE, MAFA, CelebA or scraped data.
4. **Build covering and glasses fixtures synthetically** from PD faces (masks, scarves, hands, clear and dark glasses composited along landmarks) for calibration, and label the reported FAR/FRR "synthetic".

---

## 7. Pose repeat (static replay) (`selfie_pose_repeat_detection`)

Checked 2026-10-21. Empirical checks ran in a scratch venv (Python 3.12, numpy 2.5.4, opencv-python-headless 5.0.0.93, scikit-image 0.26.0) against the repo's existing weights and fixtures, read-only.

The check has to tell two cases apart. A live person turning their head gives frames that differ in 3-D pose. A held photo or screen, or a still image fed through a virtual camera, gives frames that differ only by a 2-D (planar) motion. Section 2 supplies the per-frame pose, so most of this section is about the image-similarity side.

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **OpenCV-only SSIM / MS-SSIM** (own code, about 25 lines: Wang et al. 2004 constants, 11×11 Gaussian σ = 1.5, `cv2.BORDER_REFLECT`, 5-pixel border crop; MS-SSIM via `cv2.pyrDown` with the Wang–Simoncelli–Bovik 2003 weights) | (existing) `opencv-python-headless` | 5.0.0.93 | 2026-07-02 | Apache-2.0 (OpenCV; wheel caveat in phase3 §6) | ✅ **use**. Matches scikit-image to within 1.8e-15 (see below) |
| `skimage.metrics.structural_similarity` | PyPI `scikit-image` | 0.26.0 | 2025-12-20 | BSD-3-Clause. PyPI classifier "BSD License"; the metadata licence text lists BSD-3-Clause and BSD-2-Clause file sections. It pulls `scipy` 1.18.1 (2026-08-21, 35.3 MB cp312 wheel), `networkx` 3.7, `imageio` 2.38.0, `tifffile`, `lazy-loader` 0.6 and `packaging`. The scipy wheel bundles `libscipy_openblas`, **`libgfortran` (GPL-3.0+ with the GCC runtime exception) and `libquadmath` (LGPL-2.1+)**. numpy 2.5.4's wheel already bundles the same two libraries (`numpy.libs/`), so this is no new class of caveat, only about 50 MB more | ⚠️ Not needed at runtime. ✅ as a **dev-only test oracle** (`dev` group) |
| `cv2.quality.QualitySSIM` | opencv-contrib | - | - | Apache-2.0 | ❌ Not in the headless main wheel (`hasattr(cv2, "quality")` is False in 5.0.0.93) |
| `sewar` | PyPI | 0.4.8 (0.4.9 is from 2026-10-17, too new) | 2026-05-01 | MIT (metadata) | ⚠️ Needs scipy, and adds nothing over our own SSIM. Skip |
| SFace cosine between pose frames | (existing weights) | `face_recognition_sface_2021dec` | - | Apache-2.0 (manifest) | ✅ **use** as an identity-continuity and "same image" signal |
| YuNet landmark geometry plus the server pose estimate (§2) | (existing weights) | `face_detection_yunet_2026may` | - | MIT (manifest) | ✅ **use**. The yaw delta between the pose frames is the primary signal |
| **Planarity test, geometric.** `goodFeaturesToTrack` in the face box, then `calcOpticalFlowPyrLK` with a forward-backward check, then a `findHomography(LMEDS)` fit; score the median reprojection residual as a share of face width | (existing) OpenCV | 5.0.0.93 | - | Apache-2.0 | ✅ **use (primary image signal).** A photo or screen moved, tilted or turned as a rigid plane fits one homography almost exactly; a head does not |
| Planarity test, photometric: ORB + RANSAC homography refined with `cv2.findTransformECC(MOTION_HOMOGRAPHY)`, then SSIM of the registered face ROI | (existing) OpenCV | 5.0.0.93 | - | Apache-2.0 | ⚠️ Secondary only. Resampling blur under strong foreshortening lowers the SSIM of genuinely planar motion (measured below) |

**Empirical check (no new data).**
- **Test input.** `fixtures/generated/selfie-a.y4m` is the repo's fake-camera clip: one public-domain still, cropped with a slow ~1% drift, 30 frames at 640×480 and 15 fps. It is a textbook static replay, so these numbers describe the positive class.
- **Cross-check of our SSIM.** It was compared with scikit-image on 256×256 crops of the person A selfie:

  | Pair | Both implementations | Absolute difference |
  |---|---|---|
  | identical | 1.000 | 0 |
  | 2 px shift + noise + JPEG q70 | 0.85723 | 1.8e-15 |
  | 20 px shift | 0.64165 | 1.6e-15 |
  | different photo | 0.12566 | 7.8e-16 |

  Runtime: 5.4 ms per 256×256 pair.
- **Signals on the clip**, frame 0 against frames 7 and 22, with a different photo of the same person for comparison:

  | Signal | Frames 7 / 22 (static replay) | Different photo, same person |
  |---|---|---|
  | SFace cosine | 0.960 / 0.973 (frame 15 equals frame 0 exactly: 1.000) | 0.649 |
  | SSIM of SFace-aligned 112×112 crops | 0.604 / 0.611 | 0.256 |
  | Max landmark delta (eye-distance units) | 0.116 / 0.026 | 0.109 |
  | Face-ROI SSIM, raw | 0.483 / 0.498 | - |
  | Face-ROI SSIM after homography registration | **0.967 / 0.966** | - |

  - **A 20° turn of the whole photo** about the vertical axis (a pure perspective warp, as when someone tilts a printout) still registers at **0.831** on this clip. On a 900×720 portrait it registers at only 0.643, which is below the 3-D re-poses in the next table. Photometric SSIM is therefore confounded by resampling blur.
  - **Aligned-crop SSIM and raw landmark deltas are too noisy to use alone.** YuNet's landmark jitter on a drifting still is as large as the difference between two different photos.
- **Live versus planar.** No live head-turn clip exists in the repo. As a proxy for the live class, the 2.5-D re-posed PD portraits from §10.4 (a) were used: a 3-D canonical mesh rendered at a known yaw, so they carry real face parallax, though hair and background stay static. They were compared with the same portrait turned as a rigid plane about its own vertical axis through the face, then JPEG q85. Each frame was compared with the 0° frame:

  | Pair | Tracked points | Median homography residual (px / % of face width) | p90 (px) | Registered face-ROI SSIM | SFace cosine |
  |---|---|---|---|---|---|
  | 3-D re-pose, yaw −10 / −20 / −30° | 55 / 50 / 38 | 0.63 / 1.14 / 2.23 px (0.62 / 1.12 / 2.21 %) | 2.10 / 3.36 / 4.76 | 0.787 / 0.718 / 0.659 | 0.967 / 0.928 / 0.864 |
  | 3-D re-pose, yaw +10 / +20 / +30° | 58 / 49 / 40 | 0.83 / 1.25 / 1.36 px (0.82 / 1.23 / 1.34 %) | 1.73 / 2.86 / 3.84 | 0.836 / 0.762 / 0.722 | 0.945 / 0.871 / 0.832 |
  | **Planar photo turned 10 / 20 / 30°** | 67 / 65 / 64 | **0.05 / 0.14 / 0.33 px (0.05 / 0.14 / 0.32 %)** | 0.21 / 0.39 / 0.74 | 0.971 / 0.643 / - | - |

  - The geometric residual separates the planar motion from the 3-D re-poses by about 4–10× at every angle tested. The face is about 100 px wide in these frames.
  - SFace cosine falls steadily with yaw (0.83–0.97). A threshold near 0.95 therefore flags only near-identical frames, not real turns of ≥ 15°.
  - **Caveat:** these are synthetic re-poses (mesh depth only; no ears, hair or skin deformation), so the live class is still **unverified**. Real heads should leave larger residuals, while camera noise and motion blur will raise the planar residuals. Calibrate on privately recorded, consenting volunteers (§10.4 b).

**Gaps:**
- **Video replay.** A replayed *video* of the real person turning on cue defeats every image-similarity signal here. That attack belongs to the random challenge order and short validity window (§11), passive PAD (§3) and capture integrity (§11).
- **Exact duplicates.** Byte-identical or SSIM ≥ 0.99 raw frames are the trivial case. Hash each frame (SHA-256) and flag duplicates outright.

**Recommendation:**
- **Flag a static replay** when any of the following holds; every threshold is a placeholder for the §10 calibration harness:
  1. **Yaw spread too small.** The server-estimated yaw spread across the left and right frames is below a minimum (primary signal).
  2. **Planar motion.** The face points tracked between the centre frame and each turned frame fit one homography with a median residual below about 0.5 % of face width. Registered face-ROI SSIM serves as a secondary cue.
  3. **Same image.** SFace cosine between *different* pose frames exceeds about 0.95.
  4. **Duplicate frame**, by exact hash or near-identical raw SSIM.
- **Report** as `stage: beta`, with a confidence and per-signal evidence. Implement SSIM in OpenCV and add `scikit-image==0.26.0` only to the vision `dev` group as a test oracle. Add no new weights.

---

## 8. Selfie background similarity (`selfie_similar_background_detection`, Lists: Selfie background)

Checked 2026-10-21. The fraud-farm pattern is many *different* identities photographed in the *same* room within a short period. The signal therefore needs two things: robustness to re-framing (the subject moves, the camera shifts) and a cheap search across an environment's recent selfies.

| Candidate | Eco | Version | Released | License: code / weights / data (verified) | Verdict |
|---|---|---|---|---|---|
| **Person mask from YuNet**: head-and-shoulders region grown from the face box | (existing) | - | - | MIT (YuNet) | ✅ **use**. No new weights |
| **Coarse colour layout**: 8×6 grid of mean Lab over the masked background, after a σ = 6 blur | (existing) OpenCV | 5.0.0.93 | - | Apache-2.0 | ✅ **use** for candidate retrieval (stored as a `vector`, §9) |
| **ORB + RANSAC homography** on background pixels only | (existing) OpenCV | 5.0.0.93 | - | Apache-2.0 (ORB is in OpenCV main; no patent known to us, not formally checked) | ✅ **use** to verify the top-k candidates |
| pHash / dHash, own code (`cv2.dct` or a 9×8 resize), whole frame or tiles | (existing) OpenCV | - | - | Apache-2.0 | ⚠️ Catches exact image reuse only (that is `selfie_repeat_detection` territory); fails on re-framing (below) |
| HSV histogram (`cv2.calcHist` + Bhattacharyya) | (existing) OpenCV | - | - | Apache-2.0 | ⚠️ Weak; supporting evidence only |
| `ImageHash` | PyPI | 4.3.2 | 2025-02-01 | BSD-2-Clause (metadata). Depends on `scipy` and `PyWavelets` 1.10.0 (`MIT AND BSD-3-Clause`) | ⚠️ Not needed: pHash and dHash are about 10 lines each with OpenCV, and this would pull in scipy. PLAN §3 lists `imagehash`; replace that with our own code |
| `cv2.img_hash` | opencv-contrib | - | - | Apache-2.0 | ❌ Not in the headless main wheel |
| OpenCV Zoo `image_classification_mobilenet` (`…mobilenetv2_2022apr.onnx`, 13,964,571 B, LFS sha256 `c0c3f76d…32ad5`) as a generic embedding | GitHub LFS @ 47534e2 | 2022apr | - | **Directory LICENSE:** Apache-2.0. **Weights:** V2 from `onnx/models`; V1 from `wjc852456/pytorch-mobilenet-v1`, which has no licence (GitHub API `license: null`). **Data:** ImageNet-1k, whose terms of access say "Researcher shall use the Database only for non-commercial research and educational purposes" | ⚠️ The usual ImageNet caveat. ImageNet features are tuned to objects, not room identity. Not recommended |
| OpenCV Zoo `image_classification_ppresnet` (ResNet-50, 102,567,035 B, LFS sha256 `ad5486b0…a405`) | GitHub LFS @ 47534e2 | 2022jan | - | Apache-2.0 (PaddleHub port); ImageNet-1k | ⚠️ Same caveat, and 100 MB. Not recommended |
| OpenCV Zoo `human_segmentation_pphumanseg` (6,163,938 B, LFS sha256 `552d8a98…df24`) as a precise person mask | GitHub LFS @ 47534e2 | 2023mar | - | **Directory LICENSE:** Apache-2.0 (© PaddlePaddle Authors). **Training data:** PaddleSeg describes it only as "a big human segmentation dataset" plus portrait fine-tuning. PP-HumanSeg14K is released only on email request with the purpose stated (PaddleSeg `contrib/PP-HumanSeg/paper.md` @ 3c4db66) | ⚠️ Undisclosed training data. Optional later refinement of the mask; the YuNet box mask is enough to start |
| General self-supervised or CLIP embeddings (DINOv2, OpenCLIP and others) | - | - | - | Not re-verified here. They carry the same web-scrape provenance caveat as the CLIP backbone in §5 | ⚠️ Not for Phase 4 |

**Empirical smoke test.** Three fixture photos plus one synthetic re-frame; illustrative only, not calibration.
- **Re-frame:** the person A selfie shifted 30 px, scaled to 0.95, brightness +10, re-encoded as JPEG q75.
- **The fixtures share a look.** The NASA portraits use similar studio backdrops, which makes them a realistic hard negative.

| Pair | Tile dHash (bits differing / 64) | HSV Bhattacharyya distance | Lab layout ΔE | ORB good matches / RANSAC inliers |
|---|---|---|---|---|
| A selfie vs its re-frame (**same backdrop**) | 28.5 | 0.495 | **11.8** | 716 / **701** |
| A selfie vs B selfie (different studio session) | 31.3 | 0.628 | 46.1 | 42 / 31 |
| B selfie vs A ID portrait (different NASA backdrops) | - (no common background tiles) | 0.586 | **16.5** | 31 / 13 |
| A ID portrait vs the re-frame | - | 0.659 | 55.1 | 1 / 0 |

- **Tile hashes do not survive re-framing.** The same backdrop shifted by 30 px differs as much as unrelated pairs (≈ 28–31 of 64 bits).
- **The colour layout makes a good recall stage, but not a proof.** Two different NASA backdrops scored 16.5.
- **ORB + RANSAC separates cleanly:** 701 inliers against 13–31.
- **Legitimately shared backdrops exist:** studios, corporate onboarding kiosks, a family's shared home. The fraud signal is the same background across *different* SFace identities within a time window, and it should route to review, not fail on its own.
- **Privacy.** A background is personal data too (home interiors). The stored layout vector is low-resolution (48 cells), and verification re-reads the already-stored, encrypted selfie objects. No separate background image is kept.

**Recommendation:**
- **Pipeline, with no new weights:**
  1. YuNet head-and-shoulders mask.
  2. Store a 144-d Lab layout vector (48 cells × 3; masked cells filled with the frame's background mean and recorded in a validity bitmap) per selfie in pgvector, scoped by environment, with an HNSW index (§9).
  3. Query the k nearest within a time window, and keep those belonging to *other* face identities.
  4. Verify each candidate with ORB + RANSAC on background pixels: a minimum inlier count and inlier ratio, calibrated.
  5. Emit a `stage: beta` signal with a confidence. List-match ("Lists: Selfie background") reuses the same vector and verifier.
- **Drop `imagehash` from PLAN §3.** Keep pHash/dHash, our own OpenCV code, only for exact-image reuse.
- **Not now:** ImageNet-trained embeddings and PP-HumanSeg stay out of Phase 4 because of their data caveats.

---

## 9. Face similarity search (`selfie_repeat_detection`, `selfie_account_comparison`, Lists: Face)

Checked 2026-10-21 against the repo, the pinned Docker image and a throwaway pgvector container. The container was `docker run --rm`, with no volume and none of the `openverify` compose volumes.

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **pgvector** in `pgvector/pgvector:pg17` (the image the repo pins). Local image digest `sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d`, PostgreSQL 17.11 | Docker Hub / GitHub | extension **0.8.7** (`vector.control` in the image) | 2026-10-01 (tag v0.8.7 → f37c13f) | **PostgreSQL License.** LICENSE at v0.8.7 is the PostgreSQL/UC Berkeley text; GitHub's API reports `NOASSERTION` because it does not recognise the text | ✅ **already present.** Migration `0001_schema_v1.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`, but **no vector column exists yet**. `verifications.ts` says biometric embeddings are not persisted in Phase 1 |
| pgvector inside PGlite (unit tests) | npm `@electric-sql/pglite` | 0.4.6, bundling pgvector **0.8.1** (`dist/vector.tar.gz`) | - | Apache-2.0 / PostgreSQL | ✅ HNSW, `halfvec`, `bit` and iterative scans (since 0.8.0) all work in unit tests |
| Drizzle column types | npm `drizzle-orm` | 0.45.4 (repo pin) | - | Apache-2.0 | ✅ `pg-core/columns/vector_extension/{vector,halfvec,bit,sparsevec}` and `sql/functions/vector` (`cosineDistance`, `hammingDistance`, …) are present |
| `pgvector` (Python client) | PyPI | 0.5.0 (0.5.1 is from 2026-10-09, too new) | 2026-07-06 | MIT | Not needed: the vision service never talks to Postgres; the API does |

**HNSW vs IVFFlat for 128-d SFace embeddings.**
- **What the pgvector README (v0.8.7) says:**
  - **HNSW:** "better query performance than IVFFlat (in terms of speed-recall tradeoff), but has slower build times and uses more memory". Also: "an index can be created without any data in the table since there isn't a training step".
  - **IVFFlat:** must be created "*after* the table has some data", with `lists` of about rows/1000 and `probes` of about √lists. An index built on an empty table therefore stays poor.
- **For a self-hosted product that starts empty, use HNSW.** Use cosine (`vector_cosine_ops`, operator `<=>`) on L2-normalised SFace features. OpenCV Zoo's `sface.py` uses cosine ≥ 0.363 (equivalently L2 ≤ 1.128) as its 1:1 match threshold.
- **1:N needs a stricter threshold than 1:1.** The false-match rate grows roughly with gallery size (FMR_1:N ≈ N × FMR_1:1), so calibrate a separate, stricter threshold in §10.
- **Measured in the throwaway container** (pg17 + pgvector 0.8.7):
  - **Setup:** 200,000 random 128-d vectors over 50 environments (4,000 each), plus 100 planted near-duplicates (cosine distance ≈ 0.055). HNSW at the defaults (`m` 16, `ef_construction` 64), `max_parallel_maintenance_workers = 0`. Docker's 64 MB `/dev/shm` breaks a parallel build with a 512 MB `maintenance_work_mem`, which is worth knowing for the compose file.
  - **Size:** the index is **159 MB** for `vector(128)` and **109 MB** for `halfvec(128)`; the table is 285 MB with both columns.
  - **Planner:** given a B-tree on `environment_id`, it chose **exact search** (bitmap scan on the environment, then sort). That is the right plan for small environments and gives perfect recall: 100/100.
  - **Forced through HNSW:** 99/100 duplicates found, with or without `hnsw.iterative_scan = strict_order`, for both `vector` and `halfvec`.
  - **Caveat.** Random vectors are a worst case for recall; real face embeddings cluster. Iterative scan matters when the global nearest neighbours belong to *other* environments, for example the same face enrolled across many tenants. Post-filtering at `ef_search` = 40 can then return nothing.
- **Tenant isolation.** The pgvector README ("Filtering", "Multitenancy") recommends partial indexes or list partitioning for tenant isolation. Always filter `environment_id = $1`, the same scoping rule as the blind index (C31.8). Set `hnsw.iterative_scan = strict_order` (or `relaxed_order` plus a materialised CTE with `ORDER BY distance + 0` on PG 17+) and `SET LOCAL hnsw.ef_search` to 100 or more. Put the distance threshold *outside* the materialised CTE, as the README advises.

**Can the embedding be encrypted and still searched? The privacy trade-off.**
- **Why embeddings need protection.** Under GDPR, biometric data used for unique identification is personal data (Art. 4(14)) and a special category (Art. 9(1)). Under BIPA (740 ILCS 14/15) it needs a retention schedule, written release and a reasonable standard of care. Deep face templates can also be inverted into recognisable faces (Mai, Cao, Yuen & Jain, IEEE TPAMI 2019, arXiv:1703.00832). So treat an embedding as sensitively as the selfie itself.
- **The conflict.** The repo encrypts PII with AES-GCM under per-row AAD (`sealValue`, `ENCRYPTED_COLUMNS`). Such a column cannot carry an ANN index. The options:

| Option | How | Searchable in Postgres | Protection | Cost and limits |
|---|---|---|---|---|
| A. Plain `vector(128)` | Column readable by the API role; disk-level encryption; redaction and retention delete the row | ✅ HNSW | A DB dump or SQL injection yields raw SFace templates (invertible) | Simplest. Inconsistent with the rest of the schema's at-rest encryption |
| B. Sealed embedding, brute force in the application | `sealValue` blob; per query, decrypt the environment's embeddings and run a NumPy/TS dot product | ❌ (O(N) scan) | Same as other PII; only the KEK holder can read it | 100k × 128 float32 is 51 MB per query to decrypt and compare. Estimated, not measured: feasible up to about 10⁵ per environment and a few queries per second, and it does not scale beyond that |
| **C. Keyed orthogonal transform** (a cancelable template) | Store `R_env · e`, where `R_env` is a random 128×128 orthogonal matrix derived from a dedicated secret and the environment id. For example: HMAC-SHA-256 subkey, as for the blind index, seeding a DRBG for a Gaussian matrix, then QR. Rotation preserves cosine and L2 **exactly** | ✅ HNSW unchanged | A dump alone gives templates in an unknown rotated space, so NbNet-style inversion needs `R` first. Templates are unlinkable across environments and installs, and **renewable**: re-key in place with `R₂·R₁ᵀ`, no plaintext needed | **Keyed obfuscation, not encryption.** The key holder inverts it exactly. Anyone with ≥ 128 known (embedding, stored vector) pairs recovers `R` by least squares, for example an insider who enrols their own selfies and can read the table. Relative geometry (who is near whom) stays visible. ISO/IEC 24745 terms: unlinkability and renewability are met; irreversibility only against someone without the key |
| D. LSH / binary blind index | Sign bits of `R·e` (SimHash), banded, each band HMAC'd into a blind-index table; candidates are then compared after decrypting (B) | Exact-match lookup only | Leaks only band collisions | Recall drops (a fuzzy-extractor-style design); research-grade, and needs calibration. pgvector's `binary_quantize` plus `bit_hamming_ops` is the unkeyed variant |
| E. Homomorphic encryption | CKKS-style encrypted dot products (Boddeti, BTAS 2018, arXiv:1805.00577: 16 KB per template, 0.01 s per match at 512-d) | ❌ | Strong | 100k matches ≈ 1,000 s per query. Not viable for 1:N in Phase 4 |

**Recommendation:**
- **Option C**, with A-level operational controls:
  - **Table:** a dedicated `face_templates` table with `environment_id`, subject reference, `model` (`sface_2021dec`), `source` (selfie / ID portrait / list), `created_at` and a `halfvec(128)` or `vector(128)` of the rotated, L2-normalised embedding. `halfvec` halves the index (109 vs 159 MB per 200k) with the same measured recall.
  - **Index and query:** HNSW `*_cosine_ops`; every query filtered by environment, with iterative scan.
  - **Key:** a new `OPENVERIFY_FACE_INDEX_KEY`, separate from the KEK and the blind-index key, with a `face-index:rebuild` re-key command mirroring `blind-index:rebuild`. Add the rows to redaction and to C16 retention.
  - **Scope:** never search across environments.
- **Documentation.** Say plainly that the rotated vectors are still biometric data (pseudonymised, not anonymised), that 1:N search is identification rather than 1:1 verification and must be covered by the inquiry's consent text, and that whether a deployment falls under EU AI Act Annex III 1(a) needs the operator's legal review (an interpretation, not legal advice).
- **Option B as an operator setting** for small installs that want every biometric field sealed.
- **Model migrations.** Do not keep plaintext embeddings for them: SFace templates are not portable across models anyway. Re-embed from the stored, encrypted selfie objects while they are retained, and drop the rest.

---

## 10. Fixtures for FAR/FRR calibration

Checked 2026-10-21.

**How the counts were measured.** The Commons API was queried serially with a descriptive User-Agent, and each figure below is a count rather than a guess unless it is marked "est.". The method:
1. Harvest every file in the category with `generator=categorymembers&prop=imageinfo|templates`.
2. Read the file's structured-data **depicts (P180)** with `wbgetentities ids=M<pageid>`.
3. Keep a file only if all of these hold:
   - it transcludes a `Template:PD-USGov*`;
   - its title does not say crop, crew, poster, group or similar;
   - it has exactly one depicts value, and that value is a human (Wikidata P31 = Q5).
4. De-duplicate by Commons sha1 and group by person.

Near-duplicates (the same photograph re-uploaded or re-scanned) were measured on a random sample:
- 60 persons and 195 files, seed 20261021;
- 500 px standard thumbnails;
- YuNet + SFace from `models/manifest.json`, OpenCV 5.0.0;
- a pair counts as a near-duplicate when SFace cos > 0.93 or the aligned-crop pixel correlation is > 0.95.

### 10.1 Public-domain face sources

| Source | Template / licence (verified) | People with ≥ 2 images | Verdict |
|---|---|---|---|
| **NASA official portraits**. Commons `Category:Official portrait photographs of NASA` (806 files) plus its sub-categories Gemini crew portraits (74), Portraits in an Apollo space suit (133), Portraits in an EMU (132) and STS crew portraits (348); **1,479 unique files** | `{{PD-USGov-NASA}}` on 1,445 of 1,479 files (98%), via the templates API. The template (rev 910313555) says "solely created by NASA… not protected by copyright unless noted" and warns about non-NASA (e.g. Roscosmos) images. The remaining 32 are CC BY / BY-SA uploads and must be skipped | **Measured 109** persons with ≥ 2 solo, depicts-tagged images (271 images); 74 of them have photos from ≥ 2 different years. 30% of files carry no depicts, so title matching would add more (**est. 130–160**). Skew: 88 male / 21 female; births 1910s–1980s | ✅ **use** (already the source of `fixtures/manifest.json`). Spans careers: candidate → official → EMU portraits years apart, which is good for ageing |
| **Members of Congress official portraits**. Commons `Category:Official portraits of members of the {83rd, 107th…119th} United States Congress` (**2,974 files**) plus `…by name` (228 per-member categories, 2,451 files) | `{{PD-USGov-Congress}}` on 2,860 of 2,974, `{{PD-USGov}}` on 93; 13 are CC BY / BY-SA. **Caveat in the template text** (rev 910308621): PD "may be because it was taken by an employee of the Congress… **or because it has been released into the public domain and posted on the official websites of a member**". The second route is a release claim, not 17 U.S.C. §105, and member photos are sometimes by private photographers | **Measured 237** (per-Congress set) and **~320** combined with the by-name set (union by-source count: 199 + 74 + 38 + 6 shared with other sets) (2 to 3+ portraits across terms). 173 have ≥ 2 years. Better balance: 142 male / 95 female; births 1920s–1990s. The median smallest image is only **400 px wide** (bioguide-sized), still adequate for 112×112 SFace crops | ⚠️ **use, with a per-file author/credit check**. Accept House/Senate photographer, GPO Pictorial Directory or bioguide credit; skip campaign or third-party credits |
| `unitedstates/images` (GPO Member Guide scrape; repo CC0) | README @ aec3e4a: "The photos… are from the Government Printing Office, which has assured us that all photos are public domain". That is a third-party assurance (2014 Sunlight/Public Knowledge call), not a GPO licence. The current memberguide/bioguide terms were not re-checked (**unverified**); a 2008 bioguide copyright page warned "Not all images are in the public domain" | About 1 photo per member: an **impostor pool only** | ⚠️ optional for extra impostors. Prefer Commons, which has per-file licence review and sha1 |
| **Armed Forces / DoD official portraits**. Commons `Official portrait photographs of the United States {Armed Forces, Air Force, Army, Marine Corps, Navy, Space Force, Department of Defense}`: **1,616 files** | `PD-USGov-Military-*`, `PD-USGov-DOD`, `PD-USGov-Military` | **Measured 23**, because only 21% of files carry depicts. Promotion portraits (O-6 → O-7 → O-8…) give several photos per person; title matching (e.g. "Helms sj", "sj2", "sj4") would add more (**est. 60–100**). 18 male / 5 female in the measured set | ✅ **use**. **Gotcha:** the existing `fetch_fixtures.py` regex `^PD-USGov(-[A-Za-z0-9]+)*$` **rejects template names that contain a space**, such as `PD-USGov-Military-Air Force` (249 files), `…-National Guard`, `…-Marine Corps` and `…-Space Force`. It should allow `[A-Za-z0-9 ]` |
| **Department of State official portraits**. Commons `Official portrait photographs of the United States Department of State`: **959 files** | `PD-USGov-DOS` (also `PD-USGov-State`, which means the Department of State, not a US state) | **Measured ~85** (ambassadors and officials over several postings) | ✅ use |
| **Union of the five sets above** | Only files carrying a `PD-USGov*` template | **532** persons with ≥ 2 distinct-sha1 solo images (1,508 images; 2,340 genuine pairs before near-duplicate removal); **1,529** persons with ≥ 1 image, giving about 1.17 M one-image-per-person impostor pairs. 392 persons have ≥ 2 dated years. In the 60-person sample, 192 of 195 images had exactly one YuNet face (3 had several), 35 pairs were near-duplicates, and **85% of persons kept ≥ 2 distinct photos** → **est. ~450 persons (≈ 400–500), about 1,500 genuine pairs**. SFace cos on the 362 distinct-photo genuine pairs: min 0.37 / median 0.71 / max 0.93 | ✅ **realistic calibration pool** |
| NIST SD-32 **MEDS-I/II** (Multiple Encounter Dataset) | data.gov lists the NIST open licence, but the NIST page (updated 2025-08-28) now says "Please visit our dataset request website to download the data". The content is "an extract of submissions of **deceased persons** with prior multiple encounters", i.e. booking photos, prepared by MITRE for the FBI | Hundreds with multiple encounters (not counted) | ❌ **do not use**. Download is gated (no pinned URL); the photos are criminal-justice mugshots taken without consent and submitted by many agencies (so not clearly §105 federal works); an IDV product should not calibrate on them |
| FBI wanted posters, Library of Congress "no known restrictions" photos | Not federal-employee works, or status unknown | n/a | ❌ |
| **Synthetic faces**: StyleGAN2/3 + FFHQ, DigiFace-1M, Microsoft Face Synthetics, SynthASpoof | FFHQ: dataset **CC BY-NC-SA 4.0** and "should not be used for development or improvement of facial recognition technologies" (README @ 4826aa6). StyleGAN3: **NVIDIA Source Code License (non-commercial)** @ c233a91. DigiFace-1M @ 1d173f3 and FaceSynthetics @ 50797c9: "**non-commercial** research". SynthASpoof @ 612757a: **CC BY-NC-SA 4.0**, "product development… is not allowed" | n/a | ❌ **all four**. Rule 4 forbids non-commercial weights and data |
| Lee Perry-Smith 3-D head scan (three.js example asset) | **CC BY 3.0** (`LeePerrySmith_License.txt` @ three.js 4500a36) | n/a (a single person) | ⚠️/❌ CC-BY is on the licence list, but it is a real person's likeness and not public domain, so it conflicts with rule 3 ("Test faces come only from public-domain sources") |
| **MakeHuman assets** (synthetic CG humans) | Assets (base mesh, targets, textures) are **CC0 1.0**. LICENSE.md @ a8bc2d5: "no output from MakeHuman contains any trace of program logic… no limitation on what you can do with this combined output". The application code is **AGPL-3.0**: author with it once, never depend on it | Synthetic, no identity | ✅ **for pose ground truth only**: exact yaw/pitch/roll. Not usable for FAR/FRR or PAD |

Notes:
- **Demographic and domain skew.** Report this alongside every FAR/FRR number:
  - The union is 67% male (359 / 172).
  - Births centre on the 1940s–1970s, with no minors.
  - Skin-tone distribution was not measured: Wikidata ethnicity is sensitive and unreliable. It very likely skews light-skinned, given the occupations.
  - These are studio portraits (frontal, even lighting, DSLR), so ID↔selfie and selfie↔selfie error rates will be **optimistic**.
  - Use them to measure the pipeline and to catch regressions, not as a fairness claim.
  - Pair the PD photos with the existing synthetic degradations (blur, noise, JPEG, low light, small face) to approximate selfie conditions.
- **Statistical resolution.** About 1,500 genuine pairs bound FRR at roughly 0.2% (rule of three, 95%) when there are zero errors. 1.17 M impostor pairs nominally reach about 3×10⁻⁶ FAR, but they are not independent: 1,529 identities, many of them look-alike official portraits. Report FAR at 10⁻³ and 10⁻⁴ only, with a bootstrap over identities rather than over pairs.
- **Label cleaning.** Depicts tags can be wrong; one sample genuine pair scored cos 0.37. Do **not** drop low-similarity genuine pairs automatically with SFace: that removes the hard cases and biases FRR downwards. Have a human review the lowest-scoring genuine pairs once, then pin the decision in the manifest.
- **Privacy and consent.** Public domain covers copyright only. Embedding real, identifiable people's faces is still biometric processing (GDPR Art. 9 in the EU, BIPA in Illinois) even for public officials. Mitigations (not legal advice; owner decision):
  - keep the images out of git (already the case);
  - never persist embeddings beyond a calibration run;
  - document the purpose;
  - honour removal requests.

  Commons also tags some portraits with `{{Personality rights}}`.

### 10.2 Pinning a Commons file: URL, SHA-256 and revision

Verified on 2026-10-21 against the live API:
1. **Query.**

   ```
   https://commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo|templates&iiprop=url|sha1|size|timestamp|archivename|extmetadata&iilimit=max&tltemplates=Template:PD-USGov|…&format=json&formatversion=2
   ```

   - `sha1` is 40-hex SHA-1. Commons publishes no SHA-256.
   - Take the licence from `prop=templates` (or the wikitext at a pinned `oldid`), not from `extmetadata.LicenseShortName`, which only says "Public domain" for any PD tag.
   - **New since the earlier manifest:** the API now appends `?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original` to `url`. Strip the query string before pinning.
2. **Download and hash.** Download the original, check `size` and `sha1` against imageinfo, compute SHA-256, and pin `url` + `sha256` + `size`. The existing script already does this. Also record the file-page revision id (`prop=revisions&rvprop=ids|timestamp`) as the licence evidence.
3. **The current-version URL is not immutable.**
   - The URL `https://upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<Name>` always serves the **latest** revision. `<a>/<ab>` are the first 1 and 2 hex characters of `md5("<Name>")`, with underscores for spaces; this was checked on `Jim_Lovell_official_1964_portrait.jpg` → `9/98`.
   - A re-upload (for example a crop or colour fix) changes the bytes behind the same URL. The SHA-256 pin then fails loudly, which is the desired behaviour.
4. **Pinning an older revision.**
   - Superseded revisions live at `https://upload.wikimedia.org/wikipedia/commons/archive/<a>/<ab>/<archivename>`, where `archivename` = `<YYYYMMDDHHMMSS>!<Name>` (`!` → `%21`).
   - The timestamp is when the revision was **superseded**: one second before the next upload in the example, 20151212114455 vs 2015-12-12T11:44:56Z. You cannot know it until the file is replaced.
   - Verified: the 2012 revision of the Lovell portrait returns HTTP 200 with content-length 9,060,651, equal to imageinfo `size`.
   - Recovery procedure: on a pin mismatch, look in imageinfo history (`iilimit=max`) for the revision whose sha1 matches the pin, and switch to its archive URL.
5. **Etiquette and limits.**
   - **WMF User-Agent policy** (oldid 564705, edited 2026-03-27): a descriptive UA with contact information, otherwise the client "may be blocked without notice". Generic `curl` or `python-urllib` UAs can return 403.
   - **Wikitech Robot policy** (edited 2026-03-16), for upload.wikimedia.org:
     - concurrency ≤ 2;
     - ≤ 25 Mbps;
     - originals or standard thumbnail sizes only;
     - honour `Retry-After` on 429.
   - **Observed:** serial thumbnail fetches with a 0.3 s gap drew `HTTP 429 "Your bot is making too many requests"` (twice) during a 195-file run.
   - The current `fetch_fixtures.py` has **no 429/Retry-After handling**. A ~1,000-image calibration set needs ≥ 1 s spacing, Retry-After backoff, and resumable skip-if-present (which already exists).
   - Pin **originals**, not thumbnails: thumbnails are re-rendered on demand, so their bytes may change. This is **unverified** empirically.
6. **Deletions.** Files can be deleted after a licence review, which returns 404. Let the calibration manifest tolerate a few missing entries (report N used), rather than failing the whole run, but keep a hard failure on digest mismatch.

### 10.3 Spoof fixtures without real people (presentation-attack simulation)

| Technique | Recipe (OpenCV + NumPy only) | Reference | Verdict |
|---|---|---|---|
| **Screen replay (moiré)** | LCDMoire pipeline: (1) resample each pixel into a 3×3 subpixel block `[K K K; R G B; R G B]`; (2) random projective transform (corner jitter ≤ 0.2 × size) + 3×3 Gaussian; (3) Bayer CFA sampling + Gaussian sensor noise; (4) bilinear demosaic + OpenCV denoise; (5) JPEG. **Prototype, run here** on `person-a-selfie.jpg`: high-band spectral peak/median rose from **28 (source) to 739** with no optical blur (an unrealistically strong rainbow moiré). An anti-alias blur before resampling with **σ ≈ 0.45 camera px** gave a faint, realistic-looking moiré (score **97**). The 3×3 mosaic darkens the image, so add gain/gamma afterwards. The screen-to-sensor pitch ratio and σ are the two knobs | Yuan et al., "AIM 2019 Challenge on Image Demoireing: Dataset and Study", arXiv:1911.02498 (LCDMoire), following Liu, Shu & Wu, arXiv:1804.03809. Real-capture contrast: Sun, Yu & Wang, arXiv:1805.02996 | ✅ (pipeline tests only) |
| **Phone/monitor composite** | Perspective-warp the PD face into a quad, then draw a 3–6% dark rounded bezel. Add: a raised black level (backlight bleed, +10–20/255); a gamma/colour-temperature shift (cooler white point); an additive elliptical specular glare; and optionally the moiré step. Make two variants: bezel visible, and full-frame crop (the common attack) | (no single paper; composition of the above) | ✅ (exercises a bezel/edge heuristic and glare) |
| **Print attack** | sRGB → CMYK with gamut compression (desaturate, paper white ≈ (240, 235, 225), black ≈ 30); clustered-dot ordered dither per channel at classic screen angles (C 15°, M 75°, Y 0°, K 45°) or Floyd–Steinberg error diffusion; paper texture (low-amplitude filtered noise); a slight cylindrical bend (`cv2.remap`); then camera noise + JPEG | Solanki, Madhow, Manjunath & Chandrasekaran, "Modeling the print-scan process for resilient data hiding", SPIE 5681 (2005) pp. 418–429 (DOI **unverified**); Floyd & Steinberg, Proc. SID 17(2) 1976; Ulichney, *Digital Halftoning*, MIT Press 1987 | ✅ (pipeline tests only) |
| **Static replay** | The existing `services/vision/tools/fake_camera.py` already loops a still with a 1% drift. That is exactly the "static replay" case for `selfie_pose_repeat_detection` (pose frames too similar) | repo | ✅ |
| Learned spoof synthesis (spoof-trace disentanglement; SynthASpoof data) | Liu et al. ECCV 2020, arXiv:2007.09273 (model weights trained on research-only FAS datasets); SynthASpoof CC BY-NC-SA | n/a | ❌ |

**Honesty caveat.**
- Simulated spoofs test the plumbing, plus gross detectors such as the FFT moiré peak, bezel edges and glare. They do **not** measure APCER/BPCER: MiniFASNet was trained on real recaptures, and its response to synthetic artefacts says little about real attacks.
- Real presentation-attack rates need a physical ISO/IEC 30107-3 campaign: consenting subjects, real printers, screens and masks, ideally run by a third-party lab.
- Docs and calibration reports must say this.
- E2E tests should assert pipeline behaviour (the check ran and was recorded, the status moved), not model accuracy.

### 10.4 Video fixtures for Chromium `--use-file-for-fake-video-capture`

Facts read from `media/capture/video/file_video_capture_device.cc` @ chromium/chromium **5b65a97** (2026-08-19) and checked empirically with Playwright 1.64.1's bundled **Chromium 156.0.8078.4**:

| Aspect | Y4M (`*.y4m`) | MJPEG (`*.mjpeg`) |
|---|---|---|
| Selection | File name ends with `y4m` (case-insensitive) | Ends with `mjpeg`; anything else → "Unsupported file format" |
| Pixel format | **I420 only**: `C420`, `420jpeg`, `420mpeg2`, `420paldv`; interlaced-mixed is rejected (`CHECK`) | Raw concatenation of JPEG images, each parsed with `ParseJpegPicture`; no container |
| Frame rate | Taken from `F<num>:<den>` with **integer division** (30000/1001 → 29) | **Fixed `kMJpegFrameRate = 30`** |
| Frame header | Parser skips exactly 6 bytes (`FRAME\n`), so frame parameters are not supported. The repo writer already complies | n/a |
| Looping | Rewinds to frame 0 at EOF. A new parser (so frame 0) is created on each `AllocateAndStart`, i.e. each new capture session | Same |
| Size | 640×480 = 460,800 B/frame, about 41 MB for 6 s at 15 fps | Measured 55 KB/frame at 480×600, q85 (12-frame test clip = 665 KB) |
| **Observed in the browser** | `track.label` = **the file's absolute path**; `getSettings()` {640×480, frameRate 15, resizeMode none}; `getCapabilities()` frameRate max 15, `facingMode: []`; enumerateDevices lists audio as "Fake Default Audio Input" | Accepted; `frameRate` 30, 480×600 |

Practical consequences for the e2e pose challenge:
- One file per **browser launch**: the switch is process-wide, so each clip needs its own `chromium.launch`.
- The clip loops on a fixed schedule while the server's pose order is random. Choose one of:
  - **(i)** a cyclic clip (centre → left → centre → right → centre → up…) whose period is shorter than the per-pose timeout, with the flow waiting for the requested pose;
  - **(ii)** a sandbox/test-only deterministic challenge seed.
  - Option (i) keeps the production code path intact.
- The capture-integrity heuristic (§11) will see `label` = a file path. That is a useful, deterministic "virtual/injected camera" fixture, but tests that expect a pass must allow it in test mode.
- Prefer **MJPEG** for multi-second head-turn clips (≈ 8× smaller). Keep Y4M where an exact frame rate or exact pixels (I420, BT.601) matter.

**Head-turn synthesis options:**

| Option | Realism | Licence / ethics | Measured here | Verdict |
|---|---|---|---|---|
| **(a) 2.5-D re-posing of a PD portrait** | Medium up to about ±20°, then visible artefacts: hair, ears and background stay static, the far cheek stretches, and there is a seam/disocclusion patch at the old face hull. Cheap and deterministic, and it preserves identity | PD portrait + **MediaPipe `canonical_face_model.obj`**: 468 vertices / 468 UVs / 898 faces, Apache-2.0 (repo LICENSE; `BUILD` `licenses(["notice"])`), 45,999 B, **sha256 `8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618`**, identical at a908d66 (last change 2020-09-17) and master 0e152b3. No new Python dependency | Prototype (fit the mesh to YuNet's 5 points with SQPnP, texture-map, render yaw θ with per-triangle `warpAffine` + painter's order). YuNet still detects every frame (score 0.94–0.95). SFace cos to the source: **0.968 / 0.929 / 0.860** at θ = −10 / −20 / −30°, and 0.950 / 0.871 / 0.841 at +10 / +20 / +30°. **YuNet's 5-point landmarks lag the geometry** (0.1–0.2 IOD error): PnP on YuNet points estimated only about 6–12° of yaw for a rendered ±20–30°, while PnP on the exact projected mesh points recovered −28.8 / −19.2 / +19.2 / +28.7° | ✅ **use for e2e plumbing**, with yaw ≤ ±25°. ⚠️ Do **not** calibrate pose thresholds on it: landmark bias plus artefacts. The visible seams may also trip passive liveness, so expect `selfie_liveness_detection` to be uncertain on these clips |
| **(b) Recording a consenting volunteer** | Highest: real skin, parallax, hair and blink | Needs written, specific consent, and a CC0 release if it is to be public. Consent withdrawal is impossible once published, and it is biometric data under GDPR Art. 9. Cannot go into the public repo or a public fetch URL without that release | n/a | ⚠️ Only for **private** manual calibration (local, or CI secrets storage), never committed or publicly fetched |
| **(c) CG head render** (MakeHuman CC0 mesh + texture, scripted yaw/pitch/roll) | Low photo-realism (CG skin), but **exact ground-truth angles** and a full 3-D head (ears, hair cap) with no disocclusion artefacts | Assets and output CC0. Author once with MakeHuman/MPFB2 (AGPL/GPL tools, so outside the build; owner to confirm this counts as an authoring tool, not a dependency). Render with our own OpenCV/NumPy rasterizer (as in (a)) or `trimesh` 5.1.1 (MIT, 2026-10-02) + `pyrender` 0.1.45 (MIT, last release 2021-02-18, stale). Ship the mesh as a fetched, SHA-256-pinned asset | Not prototyped | ✅ for **pose-estimator accuracy tests** (yaw/pitch error vs truth). ❌ for FAR/FRR and PAD |

**Recommendation:**
1. **Build the calibration set from Commons `PD-USGov*` official portraits.** Use NASA (✅), Department of State (✅), Armed Forces (✅) and Congress (⚠️, with a per-file credit check), grouped by structured-data *depicts*. That is a measured **532** people with ≥ 2 distinct-sha1 solo images and about 1,529 with ≥ 1; after near-duplicate removal, about **450 people and about 1,500 genuine pairs** are realistic. Pin each original by URL (query string stripped) + SHA-256 + size + sha1 + file-page `oldid`. Extend `fetch_fixtures.py`:
   - allow spaces in template names;
   - add Retry-After/429 backoff with ≥ 1 s spacing and ≤ 2 concurrency;
   - add an archive-URL fallback for re-uploaded files;
   - tolerate a few 404s in calibration mode.
2. **Report the skew with every FAR/FRR number.** That means 67% male, adult, studio portraits. Bootstrap over identities, and have a human review the lowest-scoring genuine pairs.
3. **Reject** MEDS, synthetic GAN/diffusion faces (FFHQ/StyleGAN, DigiFace-1M, Face Synthetics, SynthASpoof) and CC-BY real-person scans.
4. **Spoof fixtures:** generate the screen-replay (LCDMoire recipe, σ ≈ 0.45 px), phone-composite and print-halftone fixtures with OpenCV + NumPy, and label them as pipeline fixtures, not PAD evidence.
5. **Head-turn video:** render 2.5-D re-posed PD portraits (canonical face mesh, Apache-2.0, sha256 `8bac8044…e618`) into **MJPEG** clips that cycle through the poses, for e2e. Use CC0 MakeHuman renders only for pose-accuracy unit tests. Keep volunteer recordings private, with written consent. A real ISO/IEC 30107-3 test campaign remains the only way to state attack-detection rates.

---

## 11. Capture integrity on the web (part of `selfie_liveness_detection`)

Checked 2026-10-21.
- **Empirical probe:** Playwright's Chromium (build 1248, `HeadlessChrome/156.0.8078.4`) on a `http://localhost` page (a secure context), via `p4/scripts/camera-probe.mjs`. It ran with `--use-fake-ui-for-media-stream`, first with `--use-fake-device-for-media-stream` alone, then with `--use-file-for-fake-video-capture=fixtures/generated/selfie-a.y4m` added.
- **No new dependency** is needed: everything below is platform API.

### 11.1 What the browser exposes, and what it is worth

| Signal | API (spec) | Observed in Chromium 156 | Value as a virtual-camera signal | Verdict |
|---|---|---|---|---|
| Device label | `MediaStreamTrack.label`, `MediaDeviceInfo.label` (Media Capture and Streams, CRD 2025-10-09) | Fake device: `fake_device_0`. **File-backed fake device: the label is the file path** (`…/fixtures/generated/selfie-a.y4m`) | The spec says labels are free text: "Applications can't assume that the label contains any specific information". Labels are empty until camera permission is granted or a track is live ("camera information can be exposed"). Known defaults are listed below | ⚠️ Cheap denylist; trivially renamed |
| Settings | `getSettings()`: width, height, frameRate, aspectRatio, resizeMode, deviceId, groupId, plus exposure/focus where supported | Fake device 640×480 @ 20 fps, `resizeMode: none`, synthetic `exposureMode`/`focusMode`. File device 640×480 @ **15 fps (the Y4M header's `F15:1`)** | A frame rate or size that matches a file's header, or a constant rate exactly, is suggestive at most | ⚠️ Risk feature only |
| Capabilities | `getCapabilities()`; the spec calls it a fingerprinting vector ("likely persistent, cross-origin information") | Fake device: width 1–3840, frameRate 0–20, **`facingMode: []`**. File device: **width.max = 640 = the file's width**, frameRate.max 15 | `facingMode` empty on a UA claiming to be a phone is a mismatch. A fixed, tiny capability set is typical of some virtual cameras (per-driver behaviour, **unverified**) | ⚠️ Risk feature only |
| `groupId` | `MediaDeviceInfo.groupId` ("same physical device") | Every fake device had its own groupId | A webcam with a built-in mic usually shares a groupId with an `audioinput`; absence proves nothing | ⚠️ Weak |
| Frame statistics | `MediaStreamTrack.stats` → `deliveredFrames`, `discardedFrames`, `totalFrames` (W3C mediacapture-extensions, `MediaStreamTrackVideoStats`) | Present: 30/0/30 after 1.5 s at 20 fps | Frame-timing regularity: a perfectly regular source vs a real sensor's jitter under auto-exposure (**unverified as a discriminator**) | ⚠️ Collect, calibrate later |
| Per-frame timing | `requestVideoFrameCallback` metadata (`captureTime` where the UA provides it), `MediaStreamTrackProcessor` | Both APIs present | Lets the client attach a capture timestamp to each challenge frame | ✅ use in the protocol (11.3) |
| Automation | `navigator.webdriver` | `true` under Playwright | Phase 7 signal collector; spoofable | ⚠️ |

**Known virtual-camera default labels:**
- **"OBS Virtual Camera" on all three platforms**, verified in obs-studio @ 95d5223 (release 32.2.2):
  - Windows DirectShow filter: `RegisterFilter(..., L"OBS Virtual Camera")`;
  - macOS camera extension: `localizedName: "OBS Virtual Camera"`;
  - Linux: OBS runs `modprobe v4l2loopback exclusive_caps=1 card_label='OBS Virtual Camera'`.
- **v4l2loopback** (GPL-2.0; not a dependency, we only match its names): default label `Dummy video device (0x%04X)`; `card_label` is a module parameter any user can set (v4l2loopback @ e27cd86).
- **Others commonly reported** (ManyCam, XSplit VCam, Snap Camera, e2eSoft VCam, CamTwist, vMix, NVIDIA Broadcast and the like): **unverified exact strings.** Collect them from field data rather than guessing.
  - Several are used legitimately: NVIDIA Broadcast, Camo, DroidCam, Continuity Camera. So a label hit is a risk signal for review, not an automatic fail.

**What JS cannot see.** None of the following is reliably detectable from page script:
- a USB HDMI-capture dongle (it enumerates as a generic UVC camera);
- a modified browser build;
- an extension or devtools script that replaces `getUserMedia` (detectable with `Function.prototype.toString` checks, which are easily defeated);
- emulators.

Label and settings heuristics stop only unsophisticated attackers. Injection detection is now standardised separately from presentation-attack detection: **CEN/TS 18099:2024**, *Biometric data injection attack detection*, published 2024-11-27 by CEN/TC 224. ISO/IEC 30107-3 covers PAD testing only. An ISO/IEC 25456 follow-up is reported by a vendor blog as in development (**unverified**). ENISA's *Remote Identity Proofing – Attacks & Countermeasures* (2022) and its 2024 good-practices follow-up treat face presentation and injection attacks as the main threats.

### 11.2 Native and SDK side (for contrast)

On Android the SDK talks to CameraX directly, so a browser-level virtual camera is impossible. Rooted or hooked devices (virtual-camera Xposed/LSPosed modules) and emulators remain. The plan's device-signals module and the optional Play Integrity adapter (Phase 10) are the counterparts there.

### 11.3 Server-nonce challenge protocol (design)

The goal: make a pre-recorded clip useless without the server's fresh, unpredictable instructions, bind every frame to one short-lived challenge, and re-verify everything server-side. The client is untrusted throughout.

**1. Issue.** `POST /…/selfie-challenges` (inquiry-session token required) creates a challenge:
- **Fields:**
  - `challenge_id`;
  - `nonce`: 128 bits from a CSPRNG;
  - `poses`: random order. For example `center` first, then two or three distinct prompts drawn from {left, right, up, down}, or blink/smile when dense landmarks are available (§1, §2);
  - `issued_at`, `expires_at` (`issued_at` + 90–120 s);
  - per-pose dwell bounds (e.g. 0.3–8 s).
- **Storage:** server-side in Valkey, `SET ov:challenge:<id> <json> NX EX 120`, bound to the inquiry session and environment.
- **Client view:** the client gets the pose list and the nonce, nothing else.

**2. Capture.**
- **Per prompt:** the client prompts in order; when its local model (§1) sees the pose held, it captures 1–3 frames.
- **Per frame it records:**
  - the pose index;
  - the `performance.now()` delta since challenge receipt and `Date.now()`;
  - the `requestVideoFrameCallback` `captureTime` when available;
  - the frame's SHA-256.
- **Environment snapshot:** label, `getSettings()`, `getCapabilities()`, `stats` and `navigator.webdriver`, captured once with the first frame.
- **Upload:** frames go up as they are captured, so the server records receipt times (preferred), or all together in one multipart with a manifest. Every request carries `challenge_id` and `nonce`.

**3. Verify** (server, in order; any hard failure ends the attempt):
1. **Fresh and single-use.** The challenge exists, is unexpired and belongs to this session. Consume it atomically on final submit (`GETDEL`, or a Lua compare-and-delete), so it cannot be replayed.
2. **Timing:**
   - total elapsed time within bounds;
   - per-pose dwell within bounds;
   - client timestamps monotonic;
   - client deltas consistent with server receipt deltas, within a skew tolerance.
3. **Content:**
   - exactly one face per frame (§4.2 multiple faces);
   - the server-estimated pose (§2) matches the requested pose *and order*;
   - quality gates pass.
4. **Identity continuity.** SFace cosine between every pair of challenge frames is above the same-person threshold, so the face cannot be swapped mid-challenge. The frontal frame is also the one compared with the ID portrait.
5. **Replay and spoof signals.** Pose repeat and planarity (§7); MiniFASNet on the frontal frames (§3); the §5 heuristics.
6. **Capture-integrity features** from 11.1. They feed a risk score with evidence, and fail outright only on clear cases (e.g. a label matching the Chromium file-capture pattern in production).

**4. Report.** `selfie_liveness_detection` returns its components (active, passive, integrity) with confidences, as `stage: beta`. It never reports "passed" when a component was not executed (rule 5).

**What it does and does not stop:**
- **Stops:** printed photos, static screens and stills through a virtual camera (§7), and pre-recorded turn videos (wrong order or timing).
- **Does not stop a live attacker running real-time reenactment or face swap through a virtual camera or capture dongle**, because they can follow the prompts. That residual risk is why passive PAD, the §5 heuristics, capture integrity and the Android SDK path are layered, and why the docs must say that this is not iBeta/ISO 30107-3 or CEN/TS 18099 certified.

**Not recommended without a freedom-to-operate review:** a server-chosen screen colour-flash sequence whose facial reflections are analysed.
- iProov markets this as patented ("Flashmark"; "patented since 2012" per its site).
- USPTO documents US 10,796,178 ("Method and device for face liveness detection") and US 12,125,313 ("Method and system for chrominance-based face liveness detection") describe screen-colour illumination liveness. Their assignees and claims were **not verified**.

---

## Policy failures to avoid

1. **MediaPipe Tasks** (`@mediapipe/tasks-vision` ≥ 1.0.0 and every `com.google.mediapipe:tasks-*` AAR): built-in Google telemetry with no opt-out, plus the Google APIs ToS overlay. 0.10.35 (web only) is the last telemetry-free web build and is ⚠️ at best. Also avoid `mediapipe` on PyPI, which pulls `opencv-contrib-python`, matplotlib and certifi.
2. **ML Kit face detection and face mesh**: the proprietary "ML Kit Terms of Service".
3. **face-api.js, `@vladmandic/face-api`, `@vladmandic/human`, legacy `@mediapipe/face_mesh`**: unmaintained or archived, with weights of research-only or unclear provenance.
4. **Head-pose and landmark models trained on 300W-LP, the Basel Face Model, WFLW (WIDER FACE images), BIWI or CMU Panoptic**:
   - 6DRepNet / 6DRepNet360, Hopenet, FSA-Net, yakhyo/head-pose-estimation, SynergyNet, 3DDFA_V2;
   - img2pose (CC BY-NC);
   - PFLD and STAR (no licence);
   - SPIGA's weights;
   - InsightFace `2d106det` / `1k3d68`;
   - OpenCV LBF `lbfmodel.yaml` (no licence; HELEN).
5. **Conversion and runtime tools**: `tflite2onnx` is broken on this model and unmaintained; `ai-edge-litert` brings tqdm (MPL) into the runtime.
6. **Passive PAD alternatives**:
   - deepface as a dependency (MPL runtime dependencies; same weights);
   - hairymax/Face-AntiSpoofing (CelebA-Spoof, no licence);
   - CDCN (research-only);
   - InsightFace and commercial PAD SDKs.
7. **Age models**:
   - deepface Age (VGG-Face NC + IMDB-WIKI), Levi–Hassner (no licence; Adience), yu4u (IMDB-WIKI/UTKFace/APPA-REAL), SSR-Net;
   - MiVOLO v1 (IMDB-clean/UTK + AGPL `ultralytics`), InsightFace genderage;
   - FairFace weights (no weight licence; race head);
   - Hugging Face age models with no licence or undisclosed data.
8. **Deepfake and AI-image detectors** trained on FF++, DFDC, Celeb-DF, DeeperForensics, ForgeryNet or CNNDetection data:
   - selimsef DFDC, UniversalFakeDetect, CNNDetection;
   - Organika/sdxl-detector (CC BY-NC 3.0);
   - Hugging Face detectors with undisclosed data.
9. **Mask and glasses classifiers** trained on WIDER FACE/MAFA, CelebA attributes or Bing-scraped images (AIZOOTech, chandrikadeb7, CelebA-attribute repos).
10. **OpenCV contrib-only modules** (`cv2.quality`, `cv2.img_hash`, `cv2.face`): absent from `opencv-python-headless`. Do not switch to `opencv-contrib-python` for them.
11. **Fixtures**:
    - NIST MEDS (gated; mugshots of deceased arrestees);
    - FFHQ/StyleGAN (BY-NC-SA / NVIDIA NC), DigiFace-1M, Microsoft Face Synthetics, SynthASpoof (non-commercial);
    - the CC-BY Lee Perry-Smith head scan (a real person, not public domain).
12. **Release age (younger than 14 days on 2026-10-21):**
    - npm: `@mediapipe/tasks-vision` 1.1.1 (2026-10-14).
    - PyPI:
      - `onnxruntime` 1.31.0 (2026-10-09; already locked in `services/vision`);
      - deepface 0.0.102 / 0.0.103, `pgvector` 0.5.1, sewar 0.4.9, imageio 2.38.1, tifffile 2026.10.15, `mediapipe` 1.1.1.
    - Maven: `onnxruntime-android` 1.31.0 (2026-10-09).
13. **Pre-existing, needs an owner exception or a fix:**
    - ONNX Runtime telemetry is on by default in the vision container (set `ORT_DISABLE_TELEMETRY=1`);
    - Eigen (MPL-2.0) is compiled into onnxruntime;
    - the training-data provenance of YuNet (WIDER FACE, CC BY-NC-ND), SFace (CASIA-WebFace / VGGFace2 / MS-Celeb-1M) and MiniFASNet (undisclosed) is unresolved (§0).
14. **Patents** (freedom-to-operate before shipping):
    - nose-bridge-gradient glasses detection (US 10,395,094 B2);
    - screen colour-flash liveness (iProov-style; US 10,796,178 / US 12,125,313, assignees unverified).

---

## Sources

Grouped by section. Unless stated otherwise, registries and APIs were read on 2026-10-21. Scratch scripts and downloads live under the session scratchpad `p4/` and are not part of the repo.

### 1. Client-side face guidance and pose challenge

**npm** (registry JSON at `https://registry.npmjs.org/<name>`, read 2026-10-21):
- `@mediapipe/tasks-vision`
  - 1.1.0: tarball SHA-256 `46fc3d3d13fa5de631915929d045be2f74bb32e909d7a5b3a322b28976f54165`, integrity `sha512-ZJqh0wMK…336cg==`, unpacked 40,563,652 B. File SHA-256s:
    - `vision_wasm_internal.wasm` `782eda3e…6eef`
    - `vision_wasm_nosimd_internal.wasm` `b802041d…0011`
    - `vision_bundle.mjs` `9d5fc9ef…b10c`
  - 0.10.35: tarball SHA-256 `84597a25e13d123b5f4cbe768bb72e97a2c28c7a465f0ace287d8cbe5246bff0`, integrity `sha512-HOvadwVR…/egg==`
  - 1.0.1: tarball SHA-256 `ee318eaa3d42230aa10910d114faf2a488c577c4e4d33c7cb04126924aca505f`
  - 1.0.0: telemetry string checked
- `onnxruntime-web` 1.30.0: tarball SHA-256 `d2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71`
- `@litertjs/core` 2.5.3: tarball SHA-256 `a97660833e9e7e1063c95e12016718881240b14f7438728a2f62785e912d30fd`
- Metadata only: `@tensorflow-models/face-landmarks-detection` 1.0.6 (default `tfhub.dev` model URLs found in `dist/`), `@tensorflow-models/face-detection` 1.0.3, `@tensorflow/tfjs-core|backend-webgl|backend-wasm` 4.22.0, `face-api.js` 0.22.2, `@vladmandic/face-api` 1.7.15, `@vladmandic/human` 3.3.6, `@mediapipe/face_mesh`

**Maven:**
- Google Maven `https://dl.google.com/android/maven2/com/google/mediapipe/{tasks-vision,tasks-core}/{0.10.35,1.0.0,1.1.0}/`, plus `group-index.xml`
  - `tasks-core-1.1.0.aar` SHA-256 `8fd870589d83d4ec9df50043e6ab053d88442cb90b6410c990c93538b5a07a2c`
  - `tasks-vision-1.1.0.aar` `f4e50c114c14efe8762523ba2f9e6610b4da186bb4ee227bf49ca3e801caf6cc`
  - `tasks-core-0.10.35.aar` `4edf2f33c840d682c751b3ca951b1ae0465373734776d7fb37dcef936de28ad0`
- `…/com/google/android/datatransport/transport-{api/3.0.0,backend-cct/3.1.0,runtime/3.1.0}` POMs
- `…/com/google/mlkit/face-detection/16.1.7/`, `…/com/google/android/gms/play-services-mlkit-face-detection/17.1.0/`, `…/com/google/mlkit/face-mesh-detection/` metadata
- Maven Central `https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/{1.28.0,1.29.0,1.30.0}/`
  - `onnxruntime-android-1.30.0.aar` SHA-256 `e7fb945e402205f6db858d65bb78d2bdb0812317b383976c9e3bceb4862c73f1`
  - 1.28.0 and 1.29.0 inspected by HTTP range reads of the zip directory
- `…/org/opencv/opencv/5.0.0/` (POM; AAR directory via range reads)
- POMs for flogger 0.6, protobuf-javalite/protobuf-parent 4.26.1 and guava/guava-parent 27.0.1-android

**Model files** (downloaded 2026-10-21):

| Model | URL | Size (B) | SHA-256 |
|---|---|---|---|
| Face Landmarker | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task | 3,758,596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| BlazeFace short-range | https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite | 229,746 | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |

- **Face Landmarker:** GCS generation 1683136941916318, md5 `sOcnSQehZEQE/vZrKN1thQ==`. Inner files:
  - `face_landmarks_detector.tflite` `c7d54204ce0448474c7f3fa9af494787c0965cbdd6f20fc72867e43046bd43d5`
  - `face_blendshapes.tflite` `4f36dded049db18d76048567439b2a7f58f1daabc00d78bfe8f3ad396a2d2082`
  - `geometry_pipeline_metadata_landmarks.binarypb` `bdbcda96dfcb7da883da124aaa2c55dee49770d934f0fcc71747f8c21bdc75b4`
- **BlazeFace short-range:** GCS generation 1682480001338381.

**Model cards** (PDFs, read in full):

| Card | URL | SHA-256 |
|---|---|---|
| MediaPipe Face Mesh V2 | https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf | `c6add060…565a` |
| Blendshape V2 | https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf | `c8e9cf60…45ae` |
| BlazeFace (Short Range) | https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf | `cd335c06…f758` |

**Source repositories:**
- **google-ai-edge/mediapipe**
  - LICENSE at v1.1.0 (821db8a4428baf58bf4c09a0330c937e6e0a3753) and v0.10.35 (f8ef212d5c962c0e853db7e59d217056b187084b): identical Apache-2.0 text, SHA-256 `8707eef0…0ed8`
  - At 821db8a: `mediapipe/tasks/web/core/BUILD` (dummy `task_logger_factory` genrule), `mediapipe/web/graph_runner/graph_runner_logging_lib.ts`, `mediapipe/tasks/web/core/{task_logger.ts,task_runner.ts}`, and `mediapipe/tasks/java/com/google/mediapipe/tasks/core/BUILD` (dummy `logging_factory` genrule)
  - Telemetry library added to the public tree in d4c145f909 (2026-07-17)
  - Issue #6291 "Mediapipe now includes undocumented telemetry": https://github.com/google-ai-edge/mediapipe/issues/6291
- **microsoft/onnxruntime** v1.30.0 (f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7): `LICENSE` (MIT), `ThirdPartyNotices.txt` (Eigen, MPL-2.0, line 417 ff.), `docs/Privacy.md`, `java/src/main/android-telemetry/java/ai/onnxruntime/TelemetryInitializer.java`, `java/src/main/java/ai/onnxruntime/OrtEnvironment.java` (`setTelemetry`), `cmake/deps.txt` (Eigen pin). POSIX telemetry commit ddb4898232d969763eb85b11b12a4cc77ee97f60 (2026-07-24, "Add POSIX telemetry (#27379)").
- **vladmandic/human** @ d0c4c83155fd2325dbb4725ffcaf0ed0109f319c: `LICENSE`, `README.md`, and the wiki `Models.md`.
- **justadudewhohacks/face-api.js** `README.md` (training-data statements).
- **PINTO0309/PINTO_model_zoo** `410_FaceMeshV2` @ cc2999f: a third-party ONNX conversion hosted on a mutable S3 tarball. Reference only; not recommended.
- **opencv/opencv_zoo** @ 47534e2: `models/face_detection_yunet/LICENSE` (MIT).

**Terms and policy pages** (read 2026-10-21):
- **MediaPipe:**
  - APIs Terms of Service: https://developers.google.com/edge/mediapipe/legal/tos (last modified 2026-04-07)
  - Tasks privacy notice: https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice (via https://goo.gle/mediapipe-privacy; last modified 2026-06-05)
- **ML Kit Terms of Service:** https://developers.google.com/ml-kit/terms (last modified 2025-05-14)
- **Model download links:**
  - https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
  - https://developers.google.com/edge/mediapipe/solutions/vision/face_detector

### 2. Server-side head pose (yaw / pitch / roll) for the pose challenge

- **MediaPipe** v1.0.0 (6d31f1ebc3284db74d211d62bdc4f0a0c29ea120):
  - https://github.com/google-ai-edge/mediapipe/blob/6d31f1ebc3284db74d211d62bdc4f0a0c29ea120/LICENSE
  - …/mediapipe/modules/face_geometry/data/canonical_face_model.obj
  - …/face_model_with_iris.obj
  - …/geometry_pipeline_metadata_detection.pbtxt
  - Release list via `gh api repos/google-ai-edge/mediapipe/releases`: v1.1.0 2026-10-07, v1.1.1 2026-10-14.
- **Face Landmarker task:** https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task (HTTP headers 2026-10-21: Last-Modified 2023-05-03, x-goog-hash md5 `sOcnSQehZEQE/vZrKN1thQ==`; sha256 computed locally `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`). Zip members:
  - `face_detector.tflite` 229,746 B
  - `face_landmarks_detector.tflite` 2,553,590 B
  - `face_blendshapes.tflite` 955,312 B
  - `geometry_pipeline_metadata_landmarks.binarypb` 19,376 B
- **Model cards** (PDF, text read 2026-10-21):
  - https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf (Apache-2.0, 2022-09-15, input and orientation limits)
  - https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf (Apache-2.0, 2021-06-09, "consented images")
  - https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf (Apache-2.0, 2022-11-11)
- **PyPI JSON** (read 2026-10-21): tf2onnx 1.17.0, tflite2onnx 0.4.1, ai-edge-litert 2.3.0 (`requires_dist` includes tqdm), tensorflow-cpu 2.21.0, mediapipe 1.1.1 (2026-10-14).
- **OpenCV:**
  - opencv_zoo `models/` listing @ 47534e27c9851bb1128ccc0102f1145e27f23f98 and @ 48b10fa505aeb51fbd127fc60a5c660040e823b7;
  - `models/pose_estimation_mediapipe/README.md` (tf2onnx conversion precedent);
  - OpenCV 5.0.0 `modules/objdetect/src/face_detect.cpp` @ 40738fb16ceddb5fb3fea747585f7ce6abb0605b (YuNet output parsing).
- **Head-pose and landmark repos** (licence via `gh api repos/<r>`, README read at HEAD):

  | Repo | Commit |
  |---|---|
  | thohemp/6DRepNet | 464b2ba55c3d9b3d3b707c6271cf329a983ded20 |
  | thohemp/6DRepNet360 | b06e4fed77f802fbf05319b85bb65215087d5c7a |
  | natanielruiz/deep-head-pose | f7bbb9981c2953c2eca67748d6492a64c8243946 (LICENSE.md Apache-2.0) |
  | shamangary/FSA-Net | 4361d0e48103bb215d15734220c9d17e6812bb48 |
  | yakhyo/head-pose-estimation | 42556cb18b0c7dd72bb8c0416e6854f88325094a |
  | choyingw/SynergyNet | 9de11e2831b85254d776ca748fa2ffd68aedf4ba |
  | cleardusk/3DDFA_V2 | 1b6c67601abffc1e9f248b291708aef0e43b55ae |
  | vitoralbiero/img2pose | fd5473efb83d78c530afc7db12b7c2aa631ea5cb |
  | polarisZhao/PFLD-pytorch | b00750c37deaf5d133933d080d4b7a6421826812 |
  | guoqiangqi/PFLD | d654b2e22109225e3bd4e0dbce31cb0ad8b915a7 |
  | ZhenglinZhou/STAR | 9b125749b0d35766ed83d047036d1aa5e384984c |
  | andresprados/SPIGA | 656f90a76a6800e6091bbce519550e86e04cf17f |
  | deepinsight/insightface | c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52 (README "License") |
  | kurnianggoro/GSOC2017 | 7523caa8539ef58c5f4132bf99b13c617fbb58df (README: LBF model trained on HELEN) |

- **Dataset terms:**
  - 300-W: https://ibug.doc.ic.ac.uk/resources/300-W/ ("provided for research purposes only. Commercial use (i.e., use in training commercial algorithms) is not allowed").
  - 300W-LP / AFLW2000-3D: http://www.cbsr.ia.ac.cn/users/xiangyuzhu/projects/3DDFA/main.htm (synthesised from 300W with the BFM).
  - Basel Face Model licence: https://faces.dmi.unibas.ch/bfm/content/basel_face_model/downloads/BFM_NonCommercial_License_Agreement.pdf (§2.1, §3.1 read).
  - WIDER FACE: http://shuoyang1213.me/WIDERFACE/ ("cc by-nc-nd").
  - CMU Panoptic: http://domedb.perception.cs.cmu.edu/.
  - BIWI: research-only per the Hugging Face mirror card https://huggingface.co/datasets/ETHZurich/biwi_kinect_head_pose (original ETH page not retrieved, so **unverified** at source).

### 3. Passive liveness (presentation-attack detection)

- **minivision-ai/Silent-Face-Anti-Spoofing** @ b6d5f04ad78778917853b25c778acef6d5626d15:
  - files: `LICENSE`, `README.md`, `README_EN.md`, `test.py`, `src/generate_patches.py`, `src/anti_spoof_predict.py`, `src/utility.py`, `src/data_io/functional.py`, `src/data_io/transform.py`, `src/model_lib/MiniFASNet.py`, `resources/anti_spoof_models/*.pth`, `resources/detection_model/*`;
  - repo metadata via `api.github.com/repos/minivision-ai/Silent-Face-Anti-Spoofing` (Apache-2.0, 1,833 stars, 49 open issues, last push 2023-10-03);
  - issues #146 (weights permission, open, no reply as of 2026-10-21), #132 and #108 (dataset not public), #93 (classes), #62 (false accept; author reply).
- **yakhyo/face-anti-spoofing** @ aea85c1fa14e4d52a7910af75d59ef51e62a2267: `LICENSE`, `README.md`, `onnx_export.py`, `onnx_inference.py`, `utils.py`. Release `weights` assets and sha256 digests via `api.github.com/repos/yakhyo/face-anti-spoofing/releases`.
- **serengil/deepface** @ 3ecb6f15f5e3f8bdc5380197063dc2d430d3947f: `deepface/models/spoofing/{FasNetUtils.py,onnx/FasNet.py,pytorch/FasNet.py,tf/FasNet.py}`. PyPI JSON for `deepface`. serengil/deepface_models release v1.0 assets (`gh api`).
- **Other repos:**
  - hairymax/Face-AntiSpoofing @ eed4e278d80e60c2c63ea8e480886266e566ec63 (README "DataSet"; no licence file);
  - ZitongYu/CDCN @ fd8370e8f32bdd090a3552f5a1fe4c301fa99f2b (`LICENSE`).
- **Dataset terms:**
  - CelebA-Spoof: https://github.com/ZhangYuanhan-AI/CelebA-Spoof ("Dataset Agreement");
  - OULU-NPU: https://sites.google.com/site/oulunpudatabase (EULA by institutional staff, terms not shown).
- **Related caveat** (outside this section, for consistency): opencv_zoo issues #313 and #318 (2026-07/10) ask for SFace's training-data provenance; the only maintainer reply (ShiqiYu, #318) points to the Apache-2.0 LICENSE. YuNet is trained on WIDER FACE (cc by-nc-nd). The same "licence file only, data undisclosed or NC" caveat therefore applies to models already in the manifest.
- **Search for independent MiniFASNet evaluations** (2026-10-21, none found): https://arxiv.org/pdf/1904.08241 (cross-dataset replay APCER context); https://repository.mercubuana.ac.id/103681/ (thesis, single setup, full text restricted, **unverified**).

### 4. Age estimation (`selfie_age_comparison`, A/H tier)

**GitHub, read at the commit shown:**
- opencv_zoo `models/` @ 48b10fa505aeb51fbd127fc60a5c660040e823b7: https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models
- GilLevi/AgeGenderDeepLearning @ 2d591d4663b3faf778377f6b4377285a96262cb5: README (copyright notice) and the `models/` listing.
- Adience: https://talhassner.github.io/home/projects/Adience/Adience-data.html and https://talhassner.github.io/home/projects/Adience/LICENSE.txt
- deepface v0.0.101 @ 606a86deb50ebe913be319f8a17eef4caf75e5d7: `LICENSE`, `README.md` ("Licence" section), `deepface/models/demography/Age.py` (`WEIGHTS_URL`). PyPI JSON https://pypi.org/pypi/deepface/json (release dates 0.0.99–0.0.103).
- deepface_models @ b55240f7c4f9884f0e381bd02310d00e7d8de82b, release `v1.0`. Assets and digests via `api.github.com/repos/serengil/deepface_models/releases/tags/v1.0`.
- Training data of the deepface age model: https://sefiks.com/2019/02/13/apparent-age-and-gender-prediction-in-keras/
- VGG-Face terms: https://www.robots.ox.ac.uk/~vgg/software/vgg_face/
- IMDB-WIKI terms: https://data.vision.ee.ethz.ch/cvl/rrothe/imdb-wiki/
- yu4u/age-gender-estimation @ 6af6148f6eb09bf16e7164490730c71c61c89f3e: `LICENSE`, `README.md`. yu4u/age-estimation-pytorch: README on master, repo metadata.
- UTKFace: https://susanqq.github.io/UTKFace/
- APPA-REAL: https://chalearnlap.cvc.uab.es/dataset/26/description/
- AgeDB: https://ibug.doc.ic.ac.uk/resources/agedb/
- MegaAge: http://mmlab.ie.cuhk.edu.hk/projects/MegaAge/
- CelebA: https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html
- SSR-Net @ f98b6cbe1c9c8c78649e5a331f94113564521525 (`git ls-remote`): `LICENSE` and `README.md` on master.
- MiVOLO @ 37475e3f8818b5f22448003feec3e64b01bfb188: `LICENSE`, `README.md`, `requirements.txt`. Licence history in commits 0b5b3083b94c63ac8cb0bfa51c890acbce3a13bb (custom PDF licence removed) and fd5e933 ("Add Apache License 2.0"), both 2026-03-11.
- LAGENDA: https://wildchlamydia.github.io/lagenda/
- Open Images licensing: https://storage.googleapis.com/openimages/web/factsfigures_v7.html
- InsightFace @ c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52: `README.md` and `python-package/README.md` ("License").
- FairFace:
  - dataset README, joojs/fairface @ fb823086827337b4044e7f0abd3f2035e76b7c5f;
  - code, dchen236/FairFace @ 74b4f93e527f1fb2b27b2b425227c3ded0521830 (`predict.py`: ResNet-34, 18 outputs, age bins);
  - paper arXiv:1908.04913 (§3, Table 1; the PDF text was read).
- YFCC-100M distribution terms (Webscope; secondary sources only): https://arxiv.org/abs/1503.01817, https://code.flickr.net/?p=2751
- ImageNet terms of access: https://image-net.org/download.php

**Hugging Face** (`/api/models/<id>` plus README at the sha):
- iitolstykh/mivolo_v2 @ 53393526c220e34cdd7b722b36d22b6f9e5f4241
- nateraw/vit-age-classifier @ 4b5acc345d9692c3ff4f45d250531afd3a3da0ef
- dima806/facial_age_image_detection @ ad35933da48272de7295530766f3d6c56702eba8
- prithivMLmods/Age-Classification-SigLIP2 @ b41e62c0f7b338910c3139c76c183f8dba8a8aca
- prithivMLmods/open-age-detection @ 65bdfec470b7562cebb2d28daa034b3b5a203d96
- prithivMLmods/facial-age-detection @ ceb570360eb639cf8496deabc3eeb4da4cb66bcc
- google/vit-base-patch16-224-in21k @ b4569560a39a0f1af58e3ddaf17facf20ab919b0

**Hugging Face datasets:**
- nateraw/fairface @ 1b19d5f
- prithivMLmods/Age-Classification-Set @ 4f36af456e95ec11cde1ce4ff1bfc92317df5ec6
- prithivMLmods/Face-Age-10K @ 7965e76008af2dd716a95ec5b795c7184dc11892

**Context:**
- Casual Conversations: https://ai.meta.com/datasets/casual-conversations-dataset/ and https://ai.meta.com/datasets/casual-conversations-v2-dataset/ (agreement text not read).
- Vance v. IBM: https://www.docketalarm.com/cases/Illinois_Northern_District_Court/1--20-cv-00577/Vance_v._International_Business_Machines_Corporation/48/
- Vance v. Microsoft: https://law.berkeley.edu/wp-content/uploads/2025/03/19-Vance-v-Microsoft-Corporation.pdf
- Ofcom guidance (secondary summary): https://www.scl.org/ofcom-publishes-final-guidance-on-age-checks-to-protect-children-online/
- NIST FATE AEV: https://pages.nist.gov/frvt/html/frvt_age_estimation.html
- MiVOLO papers: arXiv:2307.04616, arXiv:2403.02302.

### 5. Deepfake, AI-generated face and mask detection (`selfie_suspicious_entity_detection`, H/A tier)

**Datasets and terms:**
- FaceForensics:
  - repo @ b952e41cba017eb37593c39e12bd884a934791e1 (`LICENSE`, `README.md` "Access");
  - Terms of Use PDF http://kaldir.vc.in.tum.de/faceforensics/webpage/FaceForensics_TOS.pdf (read 2026-10-21);
  - arXiv:1901.08971.
- DFDC: arXiv:2006.07397; https://ai.meta.com/datasets/dfdc/ (HTTP 404 on 2026-10-21); https://www.kaggle.com/competitions/deepfake-detection-challenge/rules (did not render).
- Celeb-DF: https://github.com/yuezunli/celeb-deepfakeforensics @ 713a4419fdd5144eda098ba741c7f99b7ef974e5 ("Privacy Statement"); arXiv:1909.12962.
- DeeperForensics-1.0: https://github.com/EndlessSora/DeeperForensics-1.0 @ 7589587e381aa51d48683d881a62c30b150e3ef8 ("Terms of Use"); arXiv:2001.03024.
- ForgeryNet: https://github.com/yinanhe/forgerynet @ 09e97374097cda672ed62665bcc99686f1dee2b4 ("License and Citation"); arXiv:2103.05630.
- WildDeepfake: https://github.com/xingjunm/wild-deepfake @ b23d5a9c377220af82a0fb0d18e24f39e00a43d1.
- DeepSpeak: HF datasets faridlab/deepspeak_v1 @ ee85b6d, v1_1 @ 24ea202, v2 @ dd0d22e (API `cardData`).
- CNNDetection: https://github.com/peterwang512/CNNDetection/blob/ea0b5622365e3a9cd31d1b54b6b5971131a839ab/LICENSE.txt; arXiv:1912.11035.
- 3DMAD: https://zenodo.org/records/4068477 (DOI 10.34777/8w63-0q90), https://www.idiap.ch/en/scientific-research/data/3dmad.
- CelebA: https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html. CelebA-Spoof: https://github.com/ZhangYuanhan-AI/CelebA-Spoof.

**Models:**
- selimsef/dfdc_deepfake_challenge @ 89c6290490bac96b29193a4061b3db9dd3933e36 (`LICENSE`, `README.md`, `download_weights.sh`); release 0.0.1 assets via `gh api repos/selimsef/dfdc_deepfake_challenge/releases`.
- UniversalFakeDetect @ 030495aea3300a8b54c0ec37ec7fe1dd7e63c619 (`LICENSE`, `README.md` "Training"); arXiv:2302.10174.
- grip-unina/ClipBased-SyntheticImageDetection @ c76ef7f5e158c5aba9e55b8b94ab0079720d281e:
  - `README.md` "License";
  - `networks/openclipnet.py` (backbone table);
  - `weights/clipdet_latent10k_plus/{config.yaml,weights.pth}` (LFS pointer);
  - `data/train_set/README.md`;
  - paper arXiv:2312.00195 (PDF text read for the reference-set description).
- grip-unina/DMimageDetection @ 745ad9e1eee82bdac4aab6e1e7e7dbf20753633a (`README.md`).
- openai/CLIP @ d05afc436d78f1c48dc0dbf8e5980a9d471f35f6 (repo licence MIT).
- HF laion/CLIP-ViT-L-14-CommonPool.XL-s13B-b90K @ d979a50bf428edbb14b32c4dce7da2d49f7f46ed.
- Hugging Face (`/api/models/<id>` + README at the sha):
  - prithivMLmods/deepfake-detector-model-v1 @ c5cb24c6a159dd2b57ca15c6a1065bd0ce8fa380 (dataset prithivMLmods/OpenDeepfake-Preview @ 233167b4c9bc37129b837547e99e62d166a51721);
  - prithivMLmods/Deep-Fake-Detector-v2-Model @ 3a99ae26f52c7ac7c3a53103b6cf3a8b617f7093;
  - dima806/deepfake_vs_real_image_detection @ 29e4cf9efc543845610045f6ba7e88e5cf9d9301;
  - Organika/sdxl-detector @ b37fede8562cb72b89ec201c0987f96ba21b518a;
  - umm-maybe/AI-image-detector @ c7e223baf11bc40528af364ba7bdea030ef42f9e;
  - haywoodsloan/ai-image-detector-deploy @ 4ae1822603cb1ec980c217cfde1ef1b8e0477a16;
  - Wvolf/ViT_Deepfake_Detection @ f7f34ca885b39dfa712057fa3cc34c9372003003.

**Papers** (arXiv IDs checked against the arXiv API; DOIs resolved through the Crossref API on 2026-10-21):
- 1911.00686
- 2003.01826 / 10.1109/CVPR42600.2020.00791
- 1907.06515 / 10.1109/WIFS47025.2019.9035107
- 2003.08685
- 1911.06465
- 2211.00680 / 10.1109/ICASSP49357.2023.10095167
- 2304.06408
- 2210.14571
- 1904.00167
- 2009.11924 / 10.1109/ICASSP39728.2021.9414582
- 2109.00162 / 10.1109/ICASSP43922.2022.9746597
- 2312.00195
- 10.1016/j.sigpro.2009.03.025
- 10.1109/TIFS.2011.2170836
- 10.1109/TIFS.2012.2187516
- 10.1016/j.imavis.2009.02.001
- 10.1109/WACVW.2019.00020
- 10.1007/978-3-319-46478-7_6

**Provenance standards:**
- C2PA Technical Specification 2.3: https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification.html (`digitalSourceType` on `c2pa.created`).
- IPTC Digital Source Type NewsCodes: https://cv.iptc.org/newscodes/digitalsourcetype/ (JSON, modified 2024-10-23).

### 6. Face covering and glasses detection (H tier)

- **Repos** (licence via `gh api repos/<r>`, README at HEAD):
  - AIZOOTech/FaceMaskDetection @ 256dc65f726cb78d82936b2c61c55a5adc2cf05d;
  - chandrikadeb7/Face-Mask-Detection @ 7e500749401bad4bb338790fbdb89b58e41ef2d9;
  - deepinsight/insightface @ c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52;
  - opencv/opencv_zoo `models/` @ 47534e27c9851bb1128ccc0102f1145e27f23f98 and 48b10fa505aeb51fbd127fc60a5c660040e823b7.
- **YuNet outputs:**
  - ONNX graph outputs read with `onnx` 1.23.2 from `models/face_detection_yunet_2026may.onnx` (read-only);
  - https://github.com/opencv/opencv/blob/40738fb16ceddb5fb3fea747585f7ce6abb0605b/modules/objdetect/src/face_detect.cpp (lines 158–231: output names, `std::sqrt(cls_score * obj_score)`, 5 keypoints).
- **MediaPipe model cards:** Face Mesh V2 and Blendshape V2 (URLs in §2 sources).
- **Dataset terms:**
  - CelebA: https://mmlab.ie.cuhk.edu.hk/projects/CelebA.html ("Agreement");
  - WIDER FACE: http://shuoyang1213.me/WIDERFACE/ ("cc by-nc-nd").
- **Skin colour:**
  - D. Chai and K. N. Ngan, "Face segmentation using skin-color map in videophone applications", IEEE TCSVT 9(4):551–564, 1999 (https://webarchive.lib.cuhk.edu.hk/20210328154327mp_/http:/www.ee.cuhk.edu.hk/~knngan/TCSVT_v9_n4_p551-564.pdf);
  - the Cb/Cr bounds as quoted in US 8,199,165 (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8199165).
- **Patents:**
  - https://patents.google.com/patent/US7657086B2/en
  - https://patents.google.com/patent/US10395094B2/en
  - https://patents.google.com/patent/US11521423 (read 2026-10-21; status and expiry as displayed by Google Patents, which labels them assumptions).

### 7. Pose repeat (static replay) (`selfie_pose_repeat_detection`)

- **SSIM:** Z. Wang, A. C. Bovik, H. R. Sheikh, E. P. Simoncelli, "Image Quality Assessment: From Error Visibility to Structural Similarity", IEEE TIP 13(4):600–612, 2004, DOI 10.1109/TIP.2003.819861.
- **MS-SSIM:** Z. Wang, E. P. Simoncelli, A. C. Bovik, "Multiscale structural similarity for image quality assessment", Asilomar 2003, DOI 10.1109/ACSSC.2003.1292216.
- **PyPI JSON** (`https://pypi.org/pypi/<name>/json`, read 2026-10-21): scikit-image 0.26.0 (licence text and classifiers), scipy 1.18.1, networkx 3.7, imageio 2.38.0 / 2.38.1, tifffile 2026.9.20 / 2026.10.15, lazy-loader 0.6, sewar 0.4.8 / 0.4.9.
- **Wheel contents:**
  - `scipy-1.18.1-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl`: `unzip -l` shows `scipy.libs/libgfortran-*.so.5.0.0`, `libquadmath-*.so.0.0.0` and `libscipy_openblas-5f890258.so`.
  - The vision venv's `numpy.libs/` holds the same libraries.
- **OpenCV 5.0.0.93 module probe** (vision venv): no `cv2.quality`, no `cv2.img_hash`, no `cv2.face`. Present: `findTransformECC`, `ORB_create`, `SOLVEPNP_SQPNP`.
- **Planar-motion and parallax tests:** two views of a plane are related by a homography, and residual parallax relative to a plane indicates depth. Textbook background: R. Hartley and A. Zisserman, *Multiple View Geometry in Computer Vision*, 2nd ed., CUP 2004, ch. 13 ("Scene planes and homographies"); not re-read for this report.
- **Scratch scripts** (not in the repo): `p4/scripts/ssim_check.py`, `p4/scripts/pose_repeat_check.py`, `p4/scripts/planarity_repose.py`. The re-posed frames are `p4/dl-s10/warp/yaw*.jpg`, made by the §10 prototype.

### 8. Selfie background similarity (`selfie_similar_background_detection`, Lists: Selfie background)

- **OpenCV Zoo @ 47534e27c9851bb1128ccc0102f1145e27f23f98:**
  - `models/` listing (GitHub contents API);
  - `models/{image_classification_mobilenet,image_classification_ppresnet,human_segmentation_pphumanseg}/{LICENSE,README.md}`;
  - Git LFS pointers for the three ONNX files above (oid and size).
  - Upstream main is at 48b10fa (2026-10-20), with typo fixes only since the pin.
- **wjc852456/pytorch-mobilenet-v1:** GitHub API `license: null`, last push 2018-07-31.
- **PaddleSeg @ 3c4db66de1d9d59d0628ed87590b6308a2f4aa2a:** `LICENSE` (Apache-2.0), `contrib/PP-HumanSeg/README.md`, `contrib/PP-HumanSeg/paper.md` (PP-HumanSeg14K access by email); arXiv:2112.07146.
- **ImageNet terms of access:** https://image-net.org/download.php (read 2026-10-21; clauses 1 and 6).
- **PyPI JSON:** ImageHash 4.3.2, PyWavelets 1.10.0.
- **ORB:** E. Rublee et al., "ORB: An efficient alternative to SIFT or SURF", ICCV 2011, DOI 10.1109/ICCV.2011.6126544.
- **Scratch scripts** (not in the repo): `p4/scripts/bg_check.py`, `p4/scripts/bg_check2.py`.

### 9. Face similarity search (`selfie_repeat_detection`, `selfie_account_comparison`, Lists: Face)

- **pgvector v0.8.7** (tag → f37c13f68b57d2c3472b2214fbcff699d6d34876):
  - https://github.com/pgvector/pgvector/blob/f37c13f68b57d2c3472b2214fbcff699d6d34876/LICENSE
  - `CHANGELOG.md` (0.8.7, 2026-10-01; 0.8.0 iterative index scans, 2024-10-30)
  - `README.md` sections Indexing, HNSW, IVFFlat, Filtering, Multitenancy, Iterative Index Scans, Half-Precision, Binary Quantization
- **Docker image** `pgvector/pgvector:pg17`, digest `sha256:ac08538c…a75d` (local, created 2026-10-01): `/usr/share/postgresql/17/extension/vector.control` → `default_version = '0.8.7'`.
- **PGlite 0.4.6:** `dist/vector.tar.gz` → `vector.control` `default_version = '0.8.1'`.
- **Repo context:**
  - `packages/db/drizzle/0001_schema_v1.sql` (extension only);
  - `packages/db/src/tables/verifications.ts` (no embeddings in Phase 1);
  - `packages/db/src/blind-index.ts` (subkey pattern to mirror);
  - `packages/db/src/encrypted-columns.ts`.
- **SFace thresholds:** https://github.com/opencv/opencv_zoo/blob/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/sface.py (`_threshold_cosine = 0.363`, `_threshold_norml2 = 1.128`).
- **Template inversion:** G. Mai, K. Cao, P. C. Yuen, A. K. Jain, "On the Reconstruction of Face Images from Deep Face Templates", arXiv:1703.00832 (TPAMI 2019).
- **FHE matching:** V. N. Boddeti, "Secure Face Matching Using Fully Homomorphic Encryption", arXiv:1805.00577 (BTAS 2018).
- **Biometric template protection:** ISO/IEC 24745:2022 (requirements named here from the standard's abstract; full text not read). Cancelable biometrics: N. K. Ratha, J. H. Connell, R. M. Bolle, IBM Systems Journal 40(3), 2001 (not re-read).
- **Law:**
  - GDPR Art. 4(14), Art. 9(1);
  - Illinois BIPA 740 ILCS 14/15;
  - EU AI Act Regulation (EU) 2024/1689, Annex III point 1(a), which excludes 1:1 verification from "remote biometric identification". Text not re-read for this report; treat as unverified.
- **Scratch SQL** (not in the repo): `p4/scripts/pgv.sql`, `p4/scripts/pgv2.sql`.

### 10. Fixtures for FAR/FRR calibration

**Wikimedia Commons API** (`https://commons.wikimedia.org/w/api.php`, queried 2026-10-21, `formatversion=2`, UA `OpenVerify-research/1.0 (https://github.com/hnalpha323/openverify)`):
- `action=query&list=categorymembers&cmtitle=Category:Official portrait photographs of NASA` (+ `Category:Gemini crew portraits`, `Portraits in an Apollo space suit`, `Portraits in an Extravehicular Mobility Unit`, `STS crew portraits`)
- `…Category:Official portraits of members of the {83rd,107th,…,119th} United States Congress`, `…Congress by name` (228 sub-categories)
- `…Category:Official portrait photographs of the United States {Armed Forces, Air Force, Army, Marine Corps, Navy, Space Force, Department of Defense, Department of State}`
- `prop=categoryinfo`
- `generator=categorymembers&prop=imageinfo|templates&iiprop=url|sha1|size|extmetadata|timestamp&tlnamespace=10`
- `action=wbgetentities&ids=M<pageid>` (P180)
- `prop=imageinfo&iiprop=timestamp|sha1|url|archivename|size&iilimit=max` for `File:Jim Lovell official 1964 portrait.jpg`, `File:Christina Koch official portrait in an EMU.jpg`, `File:Douglas Hurley in 2018.jpg`
- Archive URL checked: `https://upload.wikimedia.org/wikipedia/commons/archive/9/98/20151212114455%21Jim_Lovell_official_1964_portrait.jpg` (HTTP 200, 9,060,651 B)

**Wikidata API:** `https://www.wikidata.org/w/api.php?action=wbgetentities` (P31, P21, P569) for about 2,050 depicted QIDs (with overlap across sets).

**Commons licence templates** (`action=parse`, revision ids):
- Template:PD-USGov-Congress rev 910308621
- Template:PD-USGov-NASA rev 910313555
- Template:PD-USGov rev 910310116

**Policies:**
- WMF User-Agent policy: https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy (oldid 564705, 2026-03-27)
- Robot policy: https://wikitech.wikimedia.org/wiki/Robot_policy (edited 2026-03-16)

**Congress photos:**
- https://github.com/unitedstates/images @ aec3e4a88af843b282c0576f420b930f6a9a46ad (README "Public domain"; repo CC0-1.0)
- https://sunlightfoundation.com/2014/03/05/congress-in-photos-a-civic-hacking-success-story/
- Archived bioguide copyright page (2008): https://www.webharvest.gov/congress110th/20081212021638/http://bioguide.congress.gov/copyright.htm (from search; not re-read)

**NIST MEDS:**
- https://www.nist.gov/itl/iad/btg/special-database-32-multiple-encounter-dataset-meds (updated 2025-08-28)
- https://catalog.data.gov/dataset/multiple-encounter-dataset-meds-ii-nist-special-database-32

**Synthetic and 3-D data licences:**

| Item | Ref | URL / file |
|---|---|---|
| NVlabs/ffhq-dataset | 4826aa6ea77aa7f1a7802b938ed7c40afb985cda | README "Licenses" |
| NVlabs/stylegan3 | c233a919a6faee6e36a316ddd4eddababad1adf9 | LICENSE.txt "non-commercially… research or evaluation purposes only" |
| microsoft/DigiFace1M | 1d173f305de9afefafb8589ce8e726ec685863e5 | README |
| microsoft/FaceSynthetics | 50797c97ea0784581a0ffe4007e9e1aa75629323 | README |
| meilfang/SynthASpoof | 612757adbb223f1e350c4937d87439c3e92c6761 | README "License" (CC BY-NC-SA 4.0) |
| mrdoob/three.js `examples/models/gltf/LeePerrySmith/LeePerrySmith_License.txt` | 4500a366ccfd5a59aa2ed296c386fa42bb4edb8c | (file) |
| makehumancommunity/makehuman | a8bc2d54ff0ac92e78ff71431b1023eda42bf482 | LICENSE.md §B (AGPL code), §C (CC0 assets), §D (output) |
| makehumancommunity/mpfb2 | b1a2dc98776da9d1eea751b159d42cf61778fe2e | licence not read (**unverified**) |
| google-ai-edge/mediapipe `mediapipe/modules/face_geometry/data/canonical_face_model.obj` | a908d668c730da128dfa8d9f6bd25d519d006692 (and master 0e152b35eeea3cc9e8b55886428982b82de5925b) | repo LICENSE (Apache-2.0); `data/BUILD` `licenses(["notice"])` |

**Python packages** (PyPI JSON, read 2026-10-21):
- trimesh 5.1.1 (MIT, 2026-10-02)
- pyrender 0.1.45 (MIT, 2021-02-18)
- moderngl 5.13.0 (MIT, 2026-10-07)
- mediapipe 1.1.1 (Apache-2.0, 2026-10-14; depends on `opencv-contrib-python`, `matplotlib` and `certifi`, so it is not suitable even as a dev tool next to `opencv-python-headless`)

**Chromium:**
- https://github.com/chromium/chromium/blob/5b65a97f94c0808cfae4bdbecf1ad8997088616f/media/capture/video/file_video_capture_device.cc
- `…/file_video_capture_device_factory.cc` and `…/media/base/media_switches.cc` at the same commit
- Empirical run: Playwright 1.64.1, Chromium 156.0.8078.4, with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=<file>` (the repo's `fixtures/generated/selfie-a.y4m`, and a scratch `turn.mjpeg`)

**Papers:**
- Yuan et al., arXiv:1911.02498 (LCDMoire)
- Liu, Shu & Wu, arXiv:1804.03809
- Sun, Yu & Wang, arXiv:1805.02996
- Liu et al., arXiv:2007.09273
- Fang, Huber & Damer, arXiv:2303.02660 (SynthASpoof)
- Solanki et al., SPIE 5681:418–429 (2005), https://vision.ece.ucsb.edu/node/405
- Floyd & Steinberg (1976)
- Ulichney (1987)

**Scratch prototypes** (not in the repo), under `…/scratchpad/p4/s10tools/`:
- `pose_warp.py`: 2.5-D re-posing and YuNet/PnP check
- `recapture_sim.py`: LCDMoire-style recapture
- `neardup.py`: near-duplicate rate
- `harvest.py`, `wd.py`, `union.py`: counts
- `pw/label.mjs`: Chromium track label

### 11. Capture integrity on the web (part of `selfie_liveness_detection`)

- **W3C specifications:**
  - Media Capture and Streams, CRD 2025-10-09: https://www.w3.org/TR/2025/CRD-mediacapture-streams-20251009/ (`MediaDeviceInfo.label` and `groupId` definitions; "camera information can be exposed"; `getCapabilities` fingerprinting note).
  - Media Capture and Streams Extensions (editor's draft, read 2026-10-21): https://w3c.github.io/mediacapture-extensions/ (`MediaStreamTrackVideoStats`, `VideoFrameMetadata.captureTime`).
- **Empirical probe:** `p4/scripts/camera-probe.mjs`, using the repo's `playwright-core@1.64.1` read-only and Playwright Chromium build 1248. The output is summarised in the table.
- **OBS Studio** @ 95d5223b66da1c162acdb61c1bae2b9123a60f0e (latest release 32.2.2, 2026-08-14): `plugins/win-dshow/virtualcam-module/virtualcam-module.cpp` (l. 162, 186), `plugins/mac-virtualcam/src/camera-extension/OBSCameraProviderSource.swift` (l. 22), `plugins/linux-v4l2/v4l2-output.c` (l. 106).
- **v4l2loopback** @ e27cd86c924112ab1fb5e792a7ea43a37ab2903f: `v4l2loopback.c` (`card_label` parameter; default `"Dummy video device (0x%04X)"`).
- **CEN/TS 18099:2024:** https://www.evs.ee/en/cen-ts-18099-2024 (catalogue entry: publication date and scope).
- **ENISA:** https://www.enisa.europa.eu/publications/remote-identity-proofing-attacks-countermeasures (2022). Summary read; the full PDF was not re-read.
- **iProov:** https://www.iproov.com/iproov-system/technology/patented-concepts.
- **USPTO:**
  - https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10796178
  - https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12125313

  Titles from search results only; claims and assignees not read.
