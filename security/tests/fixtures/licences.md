# Third-party licenses (synthetic test ledger)

A small copy of THIRD_PARTY_LICENSES.md's shape for security/check-sbom-licences.py's tests. Every
row is invented or shortened; the real file is read by its own tests.

## 1. Development infrastructure and CI (in use)

| Component | Version | License | Source | Usage | Status |
|---|---|---|---|---|---|
| gitleaks | 8.30.1 | MIT | github.com/gitleaks/gitleaks | Dev tool, not shipped | verified 2026-10-20 |

**Images OpenVerify builds (Workflow 11C, C257.5).** Published images redistribute the packages of their base distribution, some of them under the GPL. That is ordinary aggregation beside our own code, not linking (not legal advice).

## 2. Runtime and build libraries

### 2.1 In use (Phase 0 and Phase 1)

| Component | Version | License | Source | Usage | Status |
|---|---|---|---|---|---|
| Fastify, fastify-plugin | 5.12.7, 6.0.1 | MIT | npm | `apps/api` HTTP server | verified 2026-10-20 |
| NumPy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 (all permissive) | PyPI | `services/vision` | verified 2026-10-20 |
| tslib | 1.14.1, 2.8.1 | 0BSD | npm | Transitive TypeScript helpers | verified 2026-10-20. **Owner to confirm:** 0BSD is not literally named in rule 4 |
| nodemailer | 10.1.6 | **MIT-0** | npm | `apps/api` SMTP mailer | verified 2026-11-01. **Owner to confirm (Phase 11 Q11):** rule 4 names MIT, not MIT-0 |
| @node-rs/argon2 (+ `@node-rs/argon2-linux-x64-gnu` prebuilt) | 2.2.2 | MIT | npm | `apps/api` passwords | verified 2026-10-20 |
| mailsender | 1.0.0 | LicenseRef-Custom | npm | a synthetic row whose decision is still to come | pending owner decision |

### 2.1.4 Vendored source in Phase 3 (Workflow 3A Stage 2, `vision-ocr`, C33)

| Component | Version | License | Source | Usage | Status |
|---|---|---|---|---|---|
| RapidOCR v3.10.0 (vendored source, commit `bd941da`) | tag v3.10.0 | Apache-2.0: `LICENSE` at the commit | github.com/RapidAI/RapidOCR | `services/vision/src/openverify_vision/ocr/detection.py`: DB pre- and post-processing | verified 2026-10-21 |

### 2.1.20 Added in Phase 10 (Workflow 10E Stage 1a, `contracts-10e`)

| Component | Version | License | Source | Use | Status |
|---|---|---|---|---|---|
| ONNX Runtime for Android (`com.microsoft.onnxruntime:onnxruntime-android`) | 1.31.0 | MIT (POM). Its native library holds Eigen (MPL-2.0): section 6 | Maven Central | `android/openverify-face` | adopted 2026-11-11 |
| JMRTD (`org.jmrtd:jmrtd`) | 0.8.9 | `LGPL-2.1-or-later` | Maven Central | **Shipped only by `android/openverify-nfc`** | adopted 2026-11-11 (POM) |
| cert-cvc (`org.ejbca.cvc:cert-cvc`) | 1.4.13 | `LGPL-2.1-or-later` | Maven Central | JMRTD's dependency, **only in `android/openverify-nfc`** | adopted 2026-11-11 (POM) |
| SCUBA (`net.sf.scuba:scuba-smartcards`, `net.sf.scuba:scuba-sc-android`) | 0.0.21, 0.0.27 | `LGPL-2.1-or-later`, except two files: section 6 | Maven Central | **only in `android/openverify-nfc`** | adopted 2026-11-11 (POM) |
| Bouncy Castle (`org.bouncycastle:bcprov-jdk18on`, `bcutil-jdk18on`) | 1.86 | MIT (the POM names the "Bouncy Castle Licence") | Maven Central | **only in `android/openverify-nfc`** | adopted 2026-11-11 (POM) |

### 2.2 Planned (`docs/PLAN.md` §3)

| Component | License | Source | Planned use | Status |
|---|---|---|---|---|
| plannedlib | LicenseRef-Unknown | npm | A planned library | to verify on adoption |

## 5. Build/test/dev-only weak-copyleft exceptions

| Component | License | Pulled in by | Scope | Decision |
|---|---|---|---|---|
| lightningcss | MPL-2.0 | vite 8 | CSS build tooling | allowed 2026-10-20 |
| JUnit 4 (`junit:junit` 4.13.2) | **EPL-1.0** | Robolectric | Test scope only | **owner to confirm**: rule 4 names only MPL-2.0 and EPL-2.0 |
| certifi | MPL-2.0 | httpx (dev dependencies of services/vision) | Not installed in the image | allowed 2026-10-20 |
| `@axe-core/playwright` 4.14.0 | MPL-2.0 | `e2e/package.json` | Test tooling only | allowed 2026-11-04 |

## 6. Owner exceptions to rule 4 (shipped code)

| Component | License | Shipped in | Conditions of the exception | Decision |
|---|---|---|---|---|
| Two files of SCUBA: `net/sf/scuba/smartcards/CommandAPDU.java` and `ResponseAPDU.java` in `net.sf.scuba:scuba-smartcards` 0.0.21 | `GPL-2.0-only WITH Classpath-exception-2.0` | **Only `android/openverify-nfc`**, the optional LGPL-3.0 artifact; never `:openverify-sdk` | Unmodified | granted 2026-11-08 (Phase 10 P1) |
| Eigen, compiled into the native library of `com.microsoft.onnxruntime:onnxruntime-android` 1.31.0 | MPL-2.0 | **Only `android/openverify-face`**, inside ONNX Runtime's official AAR | Unmodified | granted 2026-11-08 (Phase 10 P2) |
| Eigen, compiled into onnxruntime-web 1.30.0's WASM | MPL-2.0 | `apps/flow`: the WASM browsers download | Unmodified; the source location is served beside it | granted 2026-11-08 (Phase 10 P2) |
| Eigen, compiled into the `onnxruntime` wheel 1.31.0 | MPL-2.0 | The vision service's image (`services/vision`; the row of section 2.1) | Unmodified, inside the wheel | granted 2026-11-08 (Phase 10 P2), through Phase 4 decision 11 |

## Excluded components

| Component | License | Why excluded | Replacement |
|---|---|---|---|
| MinIO server | AGPL-3.0 | Not permissive | RustFS |
