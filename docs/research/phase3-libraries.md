# Phase 3 (government ID) libraries and models: license and maintenance research

Checked 2026-10-20. Every license below was read from the LICENSE file at the commit or tag shown in **Sources**, and from PyPI JSON, npm registry or Maven POM metadata. Where those disagree, the row says so. "Released" is the first upload date of that version.

**Empirical checks.** Run in a scratch venv: Python 3.12, Pillow 13.0.0, zxing-cpp 3.1.1, pdf417gen 0.8.1, opencv-python-headless 5.0.0.93. Nothing in the repo was touched.

**Release-age rule.** Prefer versions at least 14 days old, so released on or before 2026-10-06.

Legend: ✅ passes policy · ⚠️ passes on paper but carries a caveat · ❌ fails policy

---

## 0. OCR runtime confirmation (the model choice is already settled)

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| `rapidocr` | PyPI | 3.10.0 (prev. 3.9.2) | 2026-10-08 (3.9.2: 2026-07-21) | Apache-2.0: PyPI `license_expression`, and LICENSE at RapidAI/RapidOCR tag v3.10.0 → commit bd941da. 3.10.0 adds `MODEL_LICENSES.md` (Apache-2.0 for the bundled PaddleOCR-derived ONNX files, with SHA-256s) | ⚠️ |
| `rapidocr-onnxruntime` | PyPI | 1.4.4 | 2025-01-17 | Apache-2.0 (metadata) | Legacy name, superseded by `rapidocr`. `requires_python <3.13` |

Notes:
- **Package and version.** The current package is **`rapidocr`**. 3.10.0 is 12 days old; 3.9.2 is the newest version past the 14-day mark.
- **3.9.2 pulls the GUI OpenCV build.** It depends on `opencv_python`, which clashes with `opencv-python-headless`, and that wheel also bundles Qt5 (LGPL-3). 3.10.0 switched to `opencv-python-headless`.
- **Bundled weights.** Both wheels (27 MB) embed `PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx` and `ch_ppocr_mobile_v2.0_cls_mobile.onnx`. The default `config.yaml` now uses **PP-OCRv6 small**, not PP-OCRv5. Official PaddlePaddle ONNX cards exist with `license: apache-2.0`: `PaddlePaddle/PP-OCRv6_small_det_onnx` @ 28fe589 and `PP-OCRv6_small_rec_onnx` @ b8f84f0. Pass explicit SHA-pinned model paths either way.
- **MPL at runtime.** The runtime transitive dependencies include **tqdm (`MPL-2.0 AND MIT`)**, plus **requests → certifi (MPL-2.0)**. Both would land in the vision image, which rule 4 does not allow; certifi is currently dev-only per THIRD_PARTY_LICENSES §5. The rest are permissive: pyclipper (MIT), shapely (BSD-3), PyYAML (MIT), omegaconf (BSD), antlr4 runtime (BSD), colorlog (MIT), six (MIT).

**Recommendation:** Do not add `rapidocr` as a runtime dependency. Instead, vendor RapidOCR's Apache-2.0 det/rec pre- and post-processing (DB box post-process plus CTC decode, with NOTICE attribution) on top of our existing onnxruntime, adding only `pyclipper` (MIT) and `shapely` (BSD-3). If the owner prefers the package, use `rapidocr==3.10.0` once it is 14 days old (2026-10-22), and record an explicit owner exception for certifi and tqdm.

---

## 1. PDF417 decoding (AAMVA)

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`zxing-cpp`** | PyPI | 3.1.1 | 2026-07-29 | Apache-2.0: PyPI `license_expression` and LICENSE @ v3.1.1 (287c85d). The wheel compiles in the zint backend (BSD-3-Clause, submodule 55541e1) with embedded fonts: Arimo (Apache-2.0) and an OCR-B subset ("freely use, modify and/or distribute … without limitation") | ✅ **use** |
| `pyzbar` | PyPI | 0.1.9 | 2022-03-15 | MIT wrapper, but it loads **libzbar (LGPL-2.1**, LICENSE.md @ mchehab/zbar 77ad19a) | ❌ Two reasons: ZBar has no PDF417 decoding (default `codes` omits pdf417, and `decoder/pdf417.c` is a FIXME stub), and libzbar is LGPL |
| `zxing` (python-zxing) | PyPI | 1.0.4 | 2026-02-26 | **LGPLv3+** (metadata) | ❌ |
| `pyzxing` | PyPI | 1.2.2 | 2026-07-17 | MIT (LICENSE @ 3f64949) | ⚠️ Shells out to the Java ZXing jar, so it needs a JRE in the image. Not recommended |
| `pdf417decoder` | PyPI | 1.0.8 | 2021-05-04 | **CPOL 1.02** (README; a port of a CodeProject C# library); classifier "Other/Proprietary" | ❌ |
| **`zxing-wasm`** | npm | 3.1.5 / 3.1.4 (latest 3.1.6) | 2026-10-06 / 2026-09-10 (3.1.6: 2026-10-19) | MIT (LICENSE @ v3.1.5 b7dcf63 and v3.1.4 ba54ad0). Wraps zxing-cpp (Apache-2.0) | ✅ **use** for in-browser pre-check |
| `@zxing/library` | npm | 0.23.0 | 2026-04-29 | Apache-2.0 (LICENSE @ v0.23.0 1722d07) | ⚠️ Repo says "maintenance mode"; its PDF417 decoder needs BigInt; 11.9 MB unpacked. Fallback only |
| **`io.github.zxing-cpp:android`** | Maven Central | 3.1.1 | 2026-07-29 | Apache-2.0 (POM, and repo LICENSE @ v3.1.1) | ✅ **use** on device. 2.9 MB AAR with native .so files; depends on CameraX `camera-core`, which the SDK already uses |
| `com.google.zxing:core` | Maven Central | 3.5.4 | 2025-11-11 | Apache-2.0 (parent POM, and LICENSE @ zxing-3.5.4 f651b0a) | ⚠️ Pure Java, 610 KB, maintenance mode. Fallback only |
| `com.journeyapps:zxing-android-embedded` | Maven Central | 4.3.0 | 2021-10-25 | Apache-2.0 (POM; COPYING @ v4.3.0 24d0294) | ⚠️ Stale (last release 2021, 126 open issues/PRs). Not recommended |
| `com.google.mlkit:barcode-scanning` | Google Maven | 17.3.0 | 2024-08 | **"ML Kit Terms of Service"** (POM). Closed-source binary | ❌ |

Maintenance signal for zxing-cpp: pushed 2026-10-06, 46 open issues/PRs, about 2.1k stars, three releases in 2026.

Empirical check: a synthetic AAMVA-shaped payload was encoded with `pdf417gen` and decoded with zxing-cpp 3.1.1. It decoded correctly in three cases: the clean render, a perspective-warped + blurred + noisy + JPEG q60 "photo", and a numpy array input.

**Gotcha:** zxing-cpp 3.x's default `text` uses HRI mode, which renders AAMVA control characters as `<LF><RS><CR>`. Read `.bytes`, or pass `text_mode=zxingcpp.TextMode.Plain` (both checked byte-exact).

**Recommendation:**
- **Server:** `zxing-cpp==3.1.1` (cp312 abi3 manylinux_2_28 x86_64 and aarch64 wheels, about 1.1 MB, no Python dependencies).
- **Web:** `zxing-wasm@3.1.5`, `reader` subpath (about 1.04 MiB of wasm). The wasm URL defaults to jsDelivr, so override it with `prepareZXingModule` and serve the wasm ourselves (privacy and CSP).
- **Android:** `io.github.zxing-cpp:android:3.1.1`.

All three share one decoder core, so their behaviour is consistent.

---

## 2. PDF417 generation (synthetic fixtures, dev only)

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`pdf417gen`** | PyPI | 0.8.1 | 2025-01-23 | MIT. LICENSE @ tag 0.8.1 (71a06e2) is the verbatim MIT text under a "PDF417-Py License" heading, which is why GitHub reports NOASSERTION. PyPI classifier: MIT | ✅ **use** |
| `zxing-cpp` writer (`create_barcode(..., BarcodeFormat.PDF417)`) | PyPI | 3.1.1 | 2026-07-29 | Apache-2.0 + zint BSD-3 (see §1) | ✅ second, independent encoder |

**Pillow compatibility.** pdf417gen 0.8.1 renders on **Pillow 13.0.0** with warnings treated as errors. It uses `PIL.Image.Resampling`, which needs Pillow ≥ 9.1, so its `Pillow>=3.3.0` floor understates the requirement (harmless). It is pure Python (30 KB wheel) and its only dependency is Pillow. Repo: last push 2025-05-04, 3 open issues.

**Recommendation:** Add `pdf417gen==0.8.1` to the vision `dev` dependency group, for the `tools/` fixture generator. Use the zxing-cpp writer only as a cross-check encoder.

---

## 3. MRZ parsing and ICAO 9303 check digits

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **Own implementation** | (ours) | - | - | Apache-2.0 | ✅ **use**. About 200 lines; test vectors from ICAO Part 3 Appendix A and the Parts 4–6 examples |
| `mrz` | npm | 5.0.2 | 2026-03-11 | MIT (LICENSE @ v5.0.2 ce4ad68) | ✅ TS-side parser (already planned) and cross-oracle. Formats: TD1, TD2, TD3, French ID, Swiss DL |
| `PassportEye` | PyPI | 2.2.2 | 2025-03-06 | MIT (LICENSE @ c584943) | ⚠️ sdist only. Pulls scikit-image, scikit-learn, matplotlib, pytesseract (needs the Tesseract binary) and pdfminer. Dev-only oracle at most; not recommended |
| `mrz` | PyPI | 0.6.2 | 2020-08-31 | **GPLv3** (LICENSE @ c462e0c) | ❌ (already in Excluded) |
| `fastmrz` | PyPI | 2.1.2 | 2025-11-28 | **AGPL-3.0** (LICENSE @ bb1d4ee) | ❌ |
| `readmrz` | PyPI | 0.0.2 | 2022-12-13 | MIT classifier | ⚠️ Abandoned; 10.9 MB wheel. Skip |
| DocsaidLab MRZScanner ONNX (`mrz_detection_20250222`, `mrz_recognition_20250221`) | GitHub release 1.0.7 | 1.0.7 | 2026-01-13 | Repo Apache-2.0, but the weights are fine-tuned on **MIDV-2020** (licence gated behind an acceptance form; faces from a commercial generator), with DocVQA and MIT Indoor backgrounds | ⚠️ Training-data provenance is unclear. Do not ship |

**Authoritative, freely downloadable specifications:**
- **ICAO Doc 9303, Eighth Edition (2021).** Index: https://www.icao.int/publications/doc-series/doc-9303
  - **Part 3** (common to all MRTDs): https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf
    - §4.6: name convention; primary/secondary identifiers separated by `<<`, filler `<`.
    - §4.8: dates.
    - **§4.9: check digits.** Modulus 10, repeating weights 7-3-1. `<` counts as 0 and A–Z map to 10–35.
    - §5: nationality and issuer codes, including the non-ISO codes listed in §7 below.
    - Appendix A: worked check-digit examples.
  - **Part 4** (TD3, passports): …/9303_p4_cons_en.pdf
  - **Part 5** (TD1, ID cards): …/9303_p5_cons_en.pdf
  - **Part 6** (TD2): …/9303_p6_cons_en.pdf
  - **Part 7** (MRV-A/B visas): …/9303_p7_cons_en.pdf

  All five returned HTTP 200 (application/pdf).
- **AAMVA 2020 DL/ID Card Design Standard, Ver 1.0** (125 pp): https://www.aamva.org/getmedia/99ac7057-0f4d-4461-b0a2-3a5532e1b35c/AAMVA-2020-DLID-Card-Design-Standard.pdf. Landing page: https://aamva.org/assets/best-practices,-guides,-standards,-manuals,-whitepapers/aamva-dl-id-card-design-standard-(2020). Annex D (normative), "Mandatory PDF417 Bar Code":
  - **Table D.1, header:**
    - `@` compliance indicator, then LF, RS and CR separators;
    - `"ANSI "` file type;
    - 6-digit IIN;
    - **AAMVA version `10`** for this 2020 standard (01–09 identify earlier editions);
    - jurisdiction version;
    - number of entries.
  - **Table D.2:** subfile designator.
  - **Table D.3, mandatory elements:** DCA DCB DCD DBA DCS DAC DAD DBD DBB DBC DAY DAU DAG DAI DAJ DAK DAQ DCF DCG DDE DDF DDG.
  - **Table D.4, optional elements:** includes **DDA, compliance type: `F` = compliant, `N` = non-compliant**, which is "DHS required" for REAL ID. Also DDB (card revision date) and others.
  - **Copyright:** "© AAMVA 2020 – All rights reserved". Cite it and write our own element tables; do not paste its text.

**Recommendation:** Implement MRZ parsing and check digits ourselves in Python and TS, test them against the ICAO examples, and use npm `mrz@5.0.2` as the TS parser and as a cross-oracle in Vitest. MRZ localisation is classical: a morphological blackhat filter plus contour detection on the rectified crop, then RapidOCR recognition. No MRZ-specific model is needed.

---

## 4. Document detection and perspective correction

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **OpenCV-only pipeline** (already a dependency) | PyPI | opencv-python-headless 5.0.0.93 | 2026-07-02 | Apache-2.0 (OpenCV), but see the §6 wheel caveat | ✅ **use as baseline** |
| DocAligner ONNX (`lcnet100_h_e_bifpn_256_fp32.onnx` 4.8 MB; `fastvit_t8_h_e_bifpn_256_fp32.onnx` 13.2 MB) | GitHub release 1.1.1 | 1.1.1 | 2026-01-13 | Apache-2.0 (LICENSE @ 3275b0f). Release assets carry GitHub sha256 digests (lcnet100 `f4117b78…`, fastvit_t8 `950070fd…`) | ⚠️ Optional, behind a flag. The README does not name the training datasets (the docs site is JS-only). Needs owner/legal review before shipping |
| `docaligner-docsaid` / `mrzscanner-docsaid` (pip) | PyPI | 1.1.1 / 1.0.7 | 2026-01-13 | Apache-2.0, but they depend on `capybara-docsaid` → **`pillow-heif`, whose binary wheels are GPLv2** (bundled libheif and libde265 are LGPLv3, x265 is GPLv2; PyPI metadata says BSD-3-Clause, which disagrees with the wheel's own LICENSES_bundled.txt). They also pull `opencv-python` (GUI), `pdf2image`, `requests` and `tqdm` | ❌ Never install. If DocAligner is used, take only the ONNX file |
| PaddlePaddle `PP-LCNet_x1_0_doc_ori` (0/90/180/270 page orientation) | Hugging Face | @ d3b95a6 | 2025-07-22 | `license: apache-2.0` (cardData) | ⚠️ Paddle format only; would need paddle2onnx. Optional |
| PaddlePaddle `UVDoc` / tanguymagne/UVDoc | Hugging Face / GitHub | @ 16c3f0e / 4c9b82b | 2025-07 / 2024-07 | apache-2.0 / MIT | Not needed. It unwarps curved pages; ID cards are rigid |
| niuwagege/LDRNet | GitHub | HEAD dbeeb1b | last push 2023-11 | MIT code; weights not assessed | Not recommended (inactive) |
| Ultralytics YOLO (v5/v8/11) and its pretrained weights | PyPI/GitHub | - | - | **AGPL-3.0** | ❌ Not allowed |

**OpenCV recipe** (every call confirmed present in 5.0.0):
- **Find the card:** downscale, then bilateral or Gaussian blur, then Canny (or adaptive threshold), then `findContours`, then `approxPolyDP` keeping the largest convex 4-gon.
- **Fallback:** `createLineSegmentDetector` or `HoughLinesP` with line intersection, or `minAreaRect`.
- **Refine and rectify:** `cornerSubPix`, then `getPerspectiveTransform` + `warpPerspective` to the canonical aspect ratio: ID-1 85.60 × 53.98 mm (≈1.586, ISO/IEC 7810) or TD3 page 125 × 88 mm.

**Recommendation:** Ship the OpenCV-only detector as the R-tier implementation. Keep a DocAligner ONNX adapter as an optional, off-by-default plugin pending provenance review. Do not take on any pip package from DocsaidLab.

---

## 5. Image forensics building blocks

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **Pillow** (already a dependency) | PyPI | 13.0.0 | **2026-10-16** (4 days old; 12.3.0 is from 2026-07-01) | MIT-CMU (`license_expression`) | ✅ JPEG quantization tables (`JpegImageFile.quantization`, 2×64 entries, tested); EXIF via `getexif()` / `get_ifd(ExifTags.IFD.Exif)` (tested); ELA via re-save + `ImageChops.difference` (tested) |
| **OpenCV + NumPy** (already dependencies) | PyPI | 5.0.0.93 / 2.5.4 | - | Apache-2.0 / BSD-3 (+0BSD/MIT/Zlib/CC0) | ✅ `cv2.dct` blockwise DCT (double-JPEG heuristics on decoded pixels), `np.fft`/`cv2.dft` (moiré peaks), `ORB_create`/`SIFT_create` (copy-move), Laplacian/Sobel (noise residual) |
| `ExifRead` | PyPI | 3.5.1 | 2025-08-23 | BSD-3-Clause (LICENSE @ tag 3.5.1, 93b807e) | ✅ Optional: only if MakerNote or software-tag depth beyond Pillow is needed |
| `piexif` | PyPI | 1.1.3 | 2019-07-01 | MIT | ⚠️ Unmaintained since 2019. Not needed |
| `exif` | PyPI | 1.6.1 | 2024-12-10 | MIT classifier (GitLab, not checked) | Not needed |
| `scikit-image` | PyPI | 0.26.0 | 2025-12-20 | BSD-3-Clause | ✅ Optional (`restoration.estimate_sigma` for noise level). 13.6 MB cp312 wheel |
| `jpegio` (raw DCT coefficients) | PyPI | 0.2.8 | 2021-10-15 | Apache-2.0 (metadata) | ❌ in practice: **no cp312 wheels** (cp38–cp310 only), 73 MB sdist, abandoned |
| `jpeglib` (raw DCT coefficients) | PyPI | 1.0.2 | 2025-09-18 | **MPL-2.0** | ❌ at runtime |
| `c2pa-python` (content credentials; AI-generator provenance) | PyPI | 0.38.0 | 2026-09-29 | MIT OR Apache-2.0 (metadata) | ⚠️ Later phase. 15 MB native Rust wheel; audit the bundled crate licenses first |
| **CAT-Net** weights (JPEG-artifact forgery localisation) | Google Drive | v1/v2 | README relicense 2026-08-05 | Code Apache-2.0 and weights CC-BY-4.0, **stated only in the README** (no LICENSE file, @ 5eb8590) | ⚠️ Not for Phase 3. Weights sit on mutable Google Drive; the training mix includes CASIA v2, IMD2020 and FantasticReality (research-only terms); needs DCT input via jpegio (no cp312 wheel); PyTorch only |
| TruFor (GRIP-UNINA) | GitHub | @ ae54475 | - | "informational and nonprofit purposes" only | ❌ |
| Noiseprint (GRIP-UNINA) | GitHub | @ c06034e | - | GRIP custom licence (non-commercial) | ❌ |
| ManTraNet | GitHub | @ 59436db | - | "academic or non-commercial purposes only" | ❌ |
| DocTamper (model and dataset) | GitHub | @ 2d53389 | - | "non-commercial use only" | ❌ |
| MVSS-Net | GitHub | @ cc2aed7 | - | No licence (all rights reserved) | ❌ |
| IML-ViT | GitHub | @ 07dd2be | - | Code MIT, but weights are initialised from **MAE (CC BY-NC 4.0**, LICENSE @ facebookresearch/mae efb2a80) and trained on CASIA v2 | ❌ |
| PhotoHolmes | GitHub | @ 223762c | - | Apache-2.0 base, but each method carries its own licence (e.g. TruFor) | ⚠️ Do not depend on it |
| `Jwalit/document-moire-detector` / `WUCHAN/document-moire-detector-ONNX` | Hugging Face | @ 06fc3fd / c0784d1 | 2026-04 / 2026-08 | `apache-2.0` tag. DeiT-small base (Apache-2.0, facebookresearch/deit 7e160fe), fine-tuned on an RVL-CDIP derivative whose terms defer to the UCSF Industry Documents copyright page | ⚠️ Single-author community model, trained on generic documents (not IDs), with unclear data terms. Do not ship |

No permissively licensed, provenance-clean **document recapture or presentation-attack** model was found; the other hits are commercial (ID R&D, KBY-AI, Recognito). MiniFASNet, which already ships, is face-only.

**OpenCV 5.0 gotcha (tested):** `cv2.Laplacian` with float32 input and CV_64F output raises "Unsupported combination". uint8 → CV_64F still works, and that is what `quality.py` uses. Match depths for Tenengrad and Sobel on float inputs.

**Recommendation:** Build ELA, quantization-table and double-JPEG heuristics (block DCT via `cv2.dct`), FFT moiré, ORB copy-move, chroma statistics and EXIF software tags from Pillow, OpenCV and NumPy only. Every forensic check stays `stage: beta` with a confidence score. Add `ExifRead==3.5.1` only if needed. Use no pretrained forgery or recapture model in Phase 3.

---

## 6. Face detection on the ID portrait

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| YuNet + SFace via `cv2.FaceDetectorYN` / `cv2.FaceRecognizerSF` | (existing) | weights in `models/manifest.json` | - | MIT / Apache-2.0 (already verified) | ✅ Nothing new needed (both classes present in 5.0.0.93, tested) |
| `opencv-python-headless` wheel | PyPI | 5.0.0.93 (newer 4.14.0.94 is on the 4.x line) | 2026-07-02 | OpenCV itself is **Apache-2.0** (LICENSE @ opencv 5.0.0, 40738fb). The wheel's `LICENSE.txt` is **MIT** (opencv-python packaging @ tag 93, b83046c) while PyPI metadata says "Apache 2.0", a minor packaging-vs-library disagreement | ⚠️ See the bundled-binaries caveat below |

**Bundled-binaries caveat (pre-existing, affects Phase 1 too).** The Linux wheel ships these shared libraries in `opencv_python_headless.libs/`:
- **FFmpeg** (libavcodec, libavformat, libavutil, libswresample, libswscale; LGPL-2.1+). Its `LICENSE-3RD-PARTY.txt` says FFmpeg "is redistributed within all opencv-python packages".
- **libquadmath** (GCC, LGPL-2.1+) and **libgfortran** (GPL-3.0+ with the GCC Runtime Library Exception), both from OpenBLAS (AlmaLinux 8 RPMs per the bundled auditwheel SBOM). These two are *not* listed in `LICENSE-3RD-PARTY.txt`.
- OpenSSL 1.1.1k (OpenSSL/SSLeay dual licence; el8 backport build).
- libvpx, libaom, libavif, libpng, zlib and bzip2 (permissive).

These are unmodified, dynamically linked LGPL libraries, which is LGPL-compliant. But it conflicts with rule 4 ("LGPL code lives only in `android/openverify-nfc`"), the same way sharp/libvips did in Phase 1.

**Recommendation:** No new face component. Owner decision needed on the OpenCV wheel, one of:
- (a) record a documented exception in THIRD_PARTY_LICENSES (unmodified, dynamically linked, replaceable `.so` files; ship the license texts in the image); or
- (b) build OpenCV in the vision Dockerfile from source with `-DWITH_FFMPEG=OFF` and without OpenBLAS (`ENABLE_HEADLESS=1 CMAKE_ARGS=...` via opencv-python), so no LGPL or GPL-runtime `.so` files ship.

---

## 7. Country and ID-format data

| Candidate | Eco | Version | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`iso3166`** | PyPI | 3.0.0 | 2026-09-03 | MIT: PyPI `license_expression`, `LICENSE.txt` in the 3.0.0 sdist, and repo HEAD 1d513b9. There is no git tag for 3.0.0; the latest tag is v2.1.1 | ✅ **use**. Pure Python, 10 KB; 250 entries (alpha-2, alpha-3, numeric), including user-assigned `XKX` |
| **`i18n-iso-countries`** | npm | 7.14.0 | 2025-02-17 | MIT (LICENSE @ v7.14.0, 55c3a72) | ✅ **use** in TS (alpha-2/alpha-3/numeric plus localized names). Quiet since 2025-02; 58 open issues/PRs |
| Wikidata P297 / P298 | data | live | - | CC0 | ✅ Cross-check source for a generated table |
| `pycountry` | PyPI | 26.2.16 | 2026-02-17 | **LGPL-2.1-only** (`license_expression`; LICENSE.txt @ 4ba3951) | ❌ |
| `pycountry-convert` | PyPI | 0.7.2 | 2018-02-18 | MIT, but it requires `pycountry` (LGPL) and lists pytest as a runtime dependency | ❌ |
| `country-converter` | PyPI | 1.3.2 | 2025-10-22 | **GPLv3** | ❌ |
| `world-countries` (mledoze/countries) | npm | 5.1.0 | 2025-02-26 | **ODbL-1.0** (LICENSE @ c2ac004); npm metadata has no license field | ❌ |

Coverage gaps and data tables:
- **MRZ codes are not pure ISO alpha-3.** None of the tables above contains the ICAO Part 3 §5 codes, so hand-code these 26 values with a §5 citation:
  - **Part A, non-ISO state codes:** `D` (Germany), `GBD`, `GBN`, `GBO`, `GBP`, `GBS`, `RKS` (Kosovo).
  - **Part B, other codes reserved by ISO 3166/MA:** `EUE`.
  - **Part C, United Nations:** `UNO`, `UNA`, `UNK`.
  - **Part D, other issuing authorities:** `XBA`, `XIM`, `XCC`, `XCE`, `XCO`, `XEC`, `XPO`, `XES`, `XMP`, `XOM`, `XDC`.
  - **Part E, persons without a defined nationality:** `XXA`, `XXB`, `XXC`, `XXX`.
- **AAMVA IINs.** https://aamva.org/identity/issuer-identification-numbers-(iin) lists **72 six-digit IINs** (57 US, 13 Canada, 2 Mexico), from 604426 to 636062. The page is © AAMVA with no data licence. IINs are short factual identifiers, so hand-curate a JSON table (IIN → jurisdiction, 2-letter code, country) with the source URL and retrieval date. **The page has a typo:** 636020 Colorado is listed with abbreviation "GM"; it should be CO. Annex D says "the full 6-digit IIN should be encoded".

**Recommendation:**
- **Country table.** Use a generated, committed ISO 3166-1 table (alpha-2 ↔ alpha-3 ↔ numeric) as the single source for TS and Python. Build it from `iso3166==3.0.0` (MIT), cross-checked against Wikidata (CC0), and overlay the ICAO §5 extras. Alternatively, use `iso3166` in Python and `i18n-iso-countries@7.14.0` in TS.
- **IIN table.** Hand-curate the AAMVA IIN table as described above.

---

## Policy failures to avoid

1. **pyzbar / ZBar:** no PDF417 decoding, and libzbar is LGPL-2.1.
2. **python-zxing (`zxing` on PyPI):** LGPLv3+.
3. **pdf417decoder:** CPOL 1.02.
4. **Google ML Kit barcode-scanning:** proprietary "ML Kit Terms of Service".
5. **`mrz` (PyPI):** GPLv3.
6. **fastmrz:** AGPL-3.0.
7. **Ultralytics YOLO (any version) and its weights:** AGPL-3.0.
8. **pycountry:** LGPL-2.1-only. pycountry-convert depends on it, and country-converter is GPLv3.
9. **world-countries / mledoze/countries:** ODbL-1.0.
10. **DocsaidLab pip packages** (`docaligner-docsaid`, `mrzscanner-docsaid`, via `capybara-docsaid`): they pull `pillow-heif`, whose wheels are GPLv2 (LGPLv3 libheif/libde265 plus GPLv2 x265; metadata wrongly says BSD-3), and the GUI `opencv-python`.
11. **jpeglib:** MPL-2.0, at runtime.
12. **`rapidocr` as-is:** it brings certifi (MPL-2.0) and tqdm (MPL-2.0 AND MIT) into the runtime image, and 3.9.2 also pulls GUI `opencv_python` (Qt5 LGPL-3).
13. **Forgery models:** TruFor (nonprofit only), Noiseprint (GRIP non-commercial), ManTraNet (non-commercial), DocTamper (non-commercial), MVSS-Net (no licence), IML-ViT (MAE CC BY-NC weights).
14. **Pre-existing:** the `opencv-python-headless` Linux wheel bundles FFmpeg (LGPL-2.1+), libquadmath (LGPL-2.1+) and libgfortran (GPL-3.0+ with runtime exception). This needs an owner exception or a custom build (§6).
15. **Release age:** `zxing-wasm` 3.1.6 (2026-10-19), `barcode-detector` 3.2.3 (2026-10-19), `rapidocr` 3.10.0 (2026-10-08) and Pillow 13.0.0 (2026-10-16, already pinned in pyproject) are all under 14 days old.

## Sources

**Python packages** (PyPI JSON, read 2026-10-20 at `https://pypi.org/pypi/<name>/json`): zxing-cpp, pyzbar, pdf417gen, pdf417decoder, pyzxing, zxing, rapidocr, rapidocr-onnxruntime, opencv-python-headless, pillow, mrz, PassportEye, fastmrz, readmrz, ExifRead, piexif, exif, pycountry, iso3166, country-converter, pycountry-convert, ImageHash, jpegio, jpeglib, scikit-image, babel, tqdm, certifi, requests, pyclipper, shapely, omegaconf, antlr4-python3-runtime, colorlog, six, PyYAML, pillow-heif, docaligner-docsaid, mrzscanner-docsaid, capybara-docsaid, c2pa-python, defusedxml.

**npm packages** (registry, read 2026-10-20 at `https://registry.npmjs.org/<name>`): zxing-wasm, @zxing/library, @zxing/browser, barcode-detector, mrz, i18n-iso-countries, world-countries, iso-3166-1.

**Maven artifacts:**
- `https://repo1.maven.org/maven2/com/google/zxing/{core,zxing-parent}/3.5.4/*.pom`
- `…/com/journeyapps/zxing-android-embedded/4.3.0/`
- `…/io/github/zxing-cpp/android/3.1.1/`
- `https://dl.google.com/android/maven2/com/google/mlkit/barcode-scanning/17.3.0/`

**LICENSE files read at a commit or tag:**

| Component | Ref | URL |
|---|---|---|
| zxing-cpp | v3.1.1 | https://github.com/zxing-cpp/zxing-cpp/blob/287c85df6f961c8efbfb5ffd736cd9457b8b890e/LICENSE |
| zint (submodule) | 55541e1 | https://github.com/zint/zint/blob/55541e139e62b9209b71cd9b0ba9010cec28b1d9/LICENSE, plus the headers of `backend/common.c` and `backend/fonts/{normal,upcean}_woff2.h` |
| pdf417-py | 0.8.1 | https://github.com/ihabunek/pdf417-py/blob/71a06e2a36d73372412fd2a75b1a3707e8174073/LICENSE |
| RapidOCR | v3.10.0 / v3.9.2 | https://github.com/RapidAI/RapidOCR/blob/bd941dae09da793e76c6ba15c7aaf40f8424232a/LICENSE and `python/MODEL_LICENSES.md`; v3.9.2 = 095232a |
| ZBar | 77ad19a | https://github.com/mchehab/zbar/blob/77ad19ae9bc3d0fa0f2208be99e562fb96a6e392/LICENSE.md, plus `meson_options.txt` and `zbar/decoder/pdf417.c` |
| pyzbar | ff28926 | https://github.com/NaturalHistoryMuseum/pyzbar/blob/ff2892666fa7cd305f0a95f9808159809c6fc222/LICENSE.txt |
| pdf417decoder | 08c0117 | https://github.com/sparkfish/pdf417decoder (README "License: CPOL") |
| pyzxing | 3f64949 | https://github.com/ChenjieXu/pyzxing/blob/3f6494943034b5b68d025c7ac0b5db02e3d0b657/LICENSE |
| zxing-wasm | v3.1.5 / v3.1.4 | https://github.com/Sec-ant/zxing-wasm/blob/b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54/LICENSE; v3.1.4 = ba54ad0 |
| zxing-js/library | v0.23.0 | https://github.com/zxing-js/library/blob/1722d0744fb5e8b47aebfbeb2b648e17c95e8595/LICENSE |
| zxing (Java) | zxing-3.5.4 | https://github.com/zxing/zxing/blob/f651b0a0375676e47144f73397dddff8868b0e4c/LICENSE |
| zxing-android-embedded | v4.3.0 | https://github.com/journeyapps/zxing-android-embedded/blob/24d02945fec5f2c5a65b24ea7848cb5ca18f9f81/COPYING |
| cheminfo/mrz | v5.0.2 | https://github.com/cheminfo/mrz/blob/ce4ad68a038abe3f1fa16a574ae15d23b77fcc51/LICENSE |
| PassportEye | c584943 | https://github.com/konstantint/PassportEye/blob/c584943d49b5942c289f9ff019c157dee728057c/LICENSE |
| fastmrz | bb1d4ee | https://github.com/sivakumar-mahalingam/fastmrz/blob/bb1d4ee38eb1eaa88cd80e1eba88bacc1842cd76/LICENSE |
| Arg0s1080/mrz | c462e0c | https://github.com/Arg0s1080/mrz/blob/c462e0c8ca72f0396b9d1d17062434cd1c32b76a/LICENSE |
| DocsaidLab MRZScanner | 7f98880 | https://github.com/DocsaidLab/MRZScanner (`dataset/README.md`) |
| DocAligner | 3275b0f | https://github.com/DocsaidLab/DocAligner/blob/3275b0f07f8e99d8c01cb0774dea2549be1416b6/LICENSE; release 1.1.1 assets and digests via the GitHub API |
| LDRNet | dbeeb1b | https://github.com/niuwagege/LDRNet |
| UVDoc | 4c9b82b | https://github.com/tanguymagne/UVDoc |
| OpenCV | 5.0.0 | https://github.com/opencv/opencv/blob/40738fb16ceddb5fb3fea747585f7ce6abb0605b/LICENSE |
| opencv-python | tag 93 | https://github.com/opencv/opencv-python/blob/b83046cda41133f1bf2e73e99dba16a1248f103a/LICENSE.txt; installed wheel's `LICENSE-3RD-PARTY.txt` and `sboms/auditwheel.cdx.json` |
| ExifRead | 3.5.1 | https://github.com/ianare/exif-py/blob/93b807e47ab79d39bd3f5fcff2a10339a34b70b8/LICENSE |
| pycountry | 26.2.16 | https://github.com/pycountry/pycountry/blob/4ba3951667c2ed98363a3640c9022cf1b7a59300/LICENSE.txt |
| python-iso3166 | HEAD + sdist | https://github.com/deactivated/python-iso3166/blob/1d513b96ca4aac39ac46d636a7f317c88043de72/LICENSE.txt and `iso3166-3.0.0.tar.gz/LICENSE.txt` |
| i18n-iso-countries | v7.14.0 | https://github.com/michaelwittig/node-i18n-iso-countries/blob/55c3a72603faf0185661e80841074e1c2fcf8db5/LICENSE |
| mledoze/countries | c2ac004 | https://github.com/mledoze/countries/blob/c2ac0049c14edcf2436c7aa1b2493222a020b462/LICENSE |
| pillow-heif 1.8.1 | wheel | `pillow_heif-1.8.1.dist-info/licenses/LICENSES_bundled.txt` (cp312 manylinux x86_64 wheel) |
| CAT-Net | 5eb8590 | https://github.com/mjkwon2021/CAT-Net (README "License"; relicensed 2026-08-05 in commit 331b805) |
| TruFor | ae54475 | https://github.com/grip-unina/TruFor (README and `test_docker/LICENSE.txt`) |
| noiseprint | c06034e | https://github.com/grip-unina/noiseprint/blob/c06034eedc9235b642a4da9ea8ef25901d6add93/LICENSE.txt |
| ManTraNet | 59436db | https://github.com/ISICV/ManTraNet (README "Licence") |
| DocTamper | 2d53389 | https://github.com/qcf-568/DocTamper (README) |
| MVSS-Net | cc2aed7 | https://github.com/dong03/MVSS-Net (no licence file) |
| IML-ViT | 07dd2be | https://github.com/SunnyHaze/IML-ViT |
| MAE | efb2a80 | https://github.com/facebookresearch/mae/blob/efb2a8062c206524e35e47d04501ed4f544c0ae8/LICENSE |
| PhotoHolmes | 223762c | https://github.com/photoholmes/photoholmes |
| DeiT | 7e160fe | https://github.com/facebookresearch/deit/blob/7e160fe43f0252d17191b71cbb5826254114ea5b/LICENSE |

**Hugging Face model and dataset metadata** (`https://huggingface.co/api/models/<id>`, read 2026-10-20):
- PaddlePaddle/PP-LCNet_x1_0_doc_ori @ d3b95a6
- PaddlePaddle/UVDoc @ 16c3f0e
- PaddlePaddle/PP-OCRv6_small_det_onnx @ 28fe589
- PaddlePaddle/PP-OCRv6_small_rec_onnx @ b8f84f0
- Jwalit/document-moire-detector @ 06fc3fd
- WUCHAN/document-moire-detector-ONNX @ c0784d1
- aharley/rvl_cdip (dataset card, "Licensing Information")

**Specifications:**
- ICAO Doc 9303, 8th ed. 2021: https://www.icao.int/publications/doc-series/doc-9303. Part 3 text read in full for §4.6–4.9 and §5; Parts 4–7 PDFs confirmed at `https://www.icao.int/sites/default/files/publications/DocSeries/9303_p{3,4,5,6,7}_cons_en.pdf`.
- AAMVA 2020 DL/ID Card Design Standard Ver 1.0: https://www.aamva.org/getmedia/99ac7057-0f4d-4461-b0a2-3a5532e1b35c/AAMVA-2020-DLID-Card-Design-Standard.pdf (Annex D Tables D.1–D.4 read).
- AAMVA IIN list: https://aamva.org/identity/issuer-identification-numbers-(iin) (parsed 2026-10-20).
- MIDV-2020: https://l3i-share.univ-lr.fr/MIDV2020/midv2020.html (licence gated behind an access form) and https://arxiv.org/abs/2107.00396.
