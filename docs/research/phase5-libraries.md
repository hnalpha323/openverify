# Phase 5 (other verifications) libraries, data sources and licences

Checked 2026-10-20 to 2026-10-21. Each licence was read from the registry metadata (PyPI JSON, npm registry) and from the LICENSE file at the tag or commit shown, or inside the published wheel or tarball. Downloads were inspected in memory only. Data-source terms were read on the provider's own pages. Nothing in the repository was changed.

**Release-age rule.** pnpm and uv enforce a 14-day minimum release age, so a pinnable version was released on or before **2026-10-07**. Each table gives the latest version and the newest version that passes the rule.

**Scope.** Items 1–6 of the Phase 5 research brief: document/POA and PDF forensics, name and address matching, phone and email (with OTP), crypto wallets, KYB and business data, and database/AAMVA verification. Server-side NFC Passive Authentication and mdoc/verifiable credentials (also Phase 5 in `docs/PLAN.md` §6) are **not** covered here.

**Method.** Five parallel research passes, one per item (items 5 and 6 together), merged here. These load-bearing facts were then re-checked independently against primary sources:
- versions and dates of the recommended npm and PyPI packages;
- the nodemailer advisories (GitHub advisory API);
- BIP-322's status and its `smp`/`ful`/`pof` prefixes;
- the abuse.ch, GLEIF and SEC terms, and the Companies House reuse statement;
- the carltonnorthern, libpostal and libaddressinput licence text;
- the repo paths cited.

Legend: ✅ passes policy · ⚠️ passes on paper but carries a caveat · ❌ fails policy or is not recommended. "R / H / A" are the PLAN §4 tiers: real, heuristic (`beta`), adapter plus sandbox.

## Summary of recommendations

| Need | Recommendation | Fallback | Licence | Where / runtime or dev | Item |
|---|---|---|---|---|---|
| PDF render, text layer, fonts, annotations, forms, actions, revisions | **`pypdfium2==5.14.0`** in a killable subprocess per document (rlimits, timeout, page and pixel caps) | none permissive (poppler GPL; MuPDF, Ghostscript AGPL) | Apache-2.0 / BSD-3; PDFium BSD-3 + Apache-2.0; bundled FreeType (FTL), ICU (Unicode-3.0), libjpeg-turbo (IJG/BSD/Zlib), libpng, zlib, AGG notice, LLVM-exception: permissive but not named in rule 4 | vision, runtime | 1 |
| PDF metadata (Info, XMP), dictionary-level actions, object streams | **`pypdf==6.19.0`**; move to ≥ 6.21.2 on 2026-11-04 (9 read-path DoS fixes are newer than 14 days) | pypdfium2 plus our own raw-byte scanner only | BSD-3-Clause | vision, runtime | 1 |
| Incremental updates, escaped names, hidden actions | **Own raw-byte scanner** (~150 lines) and subprocess guard (~200 lines) | - | ours | vision | 1 |
| Document type classification (utility, bank, lease, pay stub, tax) | **Own lexicon + layout classifier** in `packages/checks` (~300 lines TS, ~500 lexicon entries, en/es/fr/de), `unknown` class, calibrated confidence | **No permissive, provenance-clean model exists** (LayoutLMv2/v3 CC BY-NC-SA; DiT, Donut, LayoutLM and LiLT trained on IIT-CDIP/RVL-CDIP, whose 16 labels contain none of our classes) | ours | checks (TS) | 1 |
| Issue date and issuer extraction | **Own** (~250 lines), reusing `parseVizDate` | - | ours | checks | 1 |
| Synthetic POA fixtures | Own minimal PDF writer + Pillow + `pypdf` incremental writer | - | ours / MIT-CMU / BSD-3 | dev | 1 |
| Jaro-Winkler, token-set | **Keep ours** (`name-matching.ts`, already shipped) and close 6 gaps (nicknames, initials, swapped fields, joined particles, titles/suffixes, non-Latin scripts) | Offline oracles `jellyfish` 1.2.1 and `rapidfuzz` 3.14.6 (MIT); `cmpstr@3.4.0` as a dev-only JS oracle | ours | checks | 2 |
| Nickname / diminutive table | **Own curated table** seeded from Wikidata (CC0) hypocorism items, reviewed by hand (~1,200–1,800 pairs, ~30 KB) | `carltonnorthern/nicknames` `names.csv` @ `ed160b3` (Apache-2.0), **only with owner sign-off**: its seed pages carry "all rights reserved" and "You may NOT use this page to begin a new nickname page" | ours (CC0 seed) | checks | 2 |
| Address normalisation and comparison | **Own "libpostal-style" normaliser** (~900–1,200 lines TS, ~55 KB data) seeded from libpostal `resources/dictionaries` (MIT), OpenCage `address-formatting/conf` (MIT) and Google libaddressinput postal regexes (CC-BY 4.0) | **None permissive with global coverage.** libpostal's models are ODbL-derived and 1.8–2.2 GB; `usaddress` is US-only Python | ours + MIT + CC-BY 4.0 (attribution) | checks | 2 |
| Partial date-of-birth matching | **Own rules R1–R6** (~150 lines): exact, precision-limited, range/circa, day-month transposition, single-component typo, two-digit-year century | - | ours | checks | 2 |
| Phone parse, validity, type, region | **`libphonenumber-js@1.13.14`** (`/max` metadata on the server) | `google-libphonenumber@3.2.47` | MIT (+ Apache-2.0 metadata notice) | checks / api, runtime | 3 |
| Phone line type (NANP) and carrier | **A-tier adapter** (e.g. Twilio Lookup) + sandbox. libphonenumber cannot tell US/CA mobile from landline; no permissive JS carrier data | Own `beta` "original carrier" table from Google's Apache-2.0 `resources/carrier` files | - | api | 3 |
| Disposable email domains | **Raw `disposable_email_blocklist.conf` @ `6fcca80`** (CC0, 9,213 domains) through `scripts/fetch-*` with SHA-256, plus org allow/deny overrides; optional validated refresh job | `disposable-email-domains-js@1.26.0` (CC0) | CC0-1.0 | api | 3 |
| Email syntax and MX | **WHATWG "valid email address"** + RFC 5321 length limits + `node:dns/promises` `Resolver` (null MX, implicit MX, NXDOMAIN, transient = never pass) | - | none needed | api | 3 |
| Email sending | **nodemailer** (already in use); bump to ≥ 10.1.4 on 2026-11-01 (three address-parser advisories of 2026-10-19); meanwhile pass only WHATWG-valid addresses | - | MIT-0 (owner confirmation already pending) | api | 3 |
| SMS sending | **Own `MessageSender` port**: Twilio, Vonage, Plivo over the existing `undici`; AWS via `@aws-sdk/client-sns@3.1147.0`; `sms:mailpit` dev adapter; sandbox | `twilio-verify` mode (Twilio generates and checks the code) | Apache-2.0 for the AWS client; no SDK otherwise | api | 3 |
| OTP | **Own**: 6 digits via `crypto.randomInt`; stored as HMAC-SHA-256 keyed from the KEK (HKDF); 10-minute life; single use; bound to verification, channel and destination; 5 attempts per code, 10 per verification; resend cooldowns; SMS-pumping controls. Basis: ASVS 5.0.0 V6.5/V6.6 and NIST SP 800-63B-4 §3.1.3 | - | ours | api | 3 |
| Crypto primitives | **`@noble/curves@2.4.0`, `@noble/hashes@2.4.0`, `@scure/base@2.4.0`, `@scure/btc-signer@2.4.1`** (one audited, script-free ESM set) | Without btc-signer: own BIP-143/341 preimages (~200 more lines) | MIT | checks, runtime | 4 |
| Address validity and ownership proof | **Own** (~1,000 lines): BTC/LTC/DOGE/TRON/XRP/SOL/EVM validators, EIP-55, EIP-191, strict SIWE/SIWS parser, BIP-137, BIP-322 legacy + simple (P2WPKH, P2TR), TRON message, Solana ed25519 | Full/PoF/multisig BIP-322 → `inconclusive`, never "passed" | ours | checks | 4 |
| EVM smart-contract wallets (ERC-1271 / ERC-6492) | **Adapter** with an operator-supplied RPC: own `eth_call` over `undici` (1271 only) | `viem@2.57.3` `verifyMessage` (27.9 MB, second noble line) | MIT | api | 4 |
| KYB identity, status, country | **GLEIF** LEI API (CC0, no key, 60 req/min), own client, 24 h cache; optional Golden Copy mirror | - | CC0 | api, R-tier default | 5 |
| KYB UK, incl. associated persons | **Companies House** provider, bound only when the operator supplies a free API key (600 req / 5 min) | - | No reuse restrictions; officer/PSC data is personal data | api, R+A | 5 |
| KYB US registrants | **SEC EDGAR** provider, bound only when the operator configures a User-Agent contact (10 req/s total); "active" stays `beta` | - | Public information | api, R+A | 5 |
| KYB elsewhere | **OpenCorporates adapter only** (ODbL share-alike; free tier excludes corporations) | - | ODbL / commercial | api, A | 5 |
| Domain age | **Own RDAP client** (~150 lines on `undici`, through the SSRF guard), IANA bootstrap (CC0), `unavailable` for TLDs without RDAP | WHOIS adapter | CC0 bootstrap | api, R | 5 |
| Malicious website | **Port + sandbox + opt-in feed provider shipping empty**; adapters for URLhaus (Auth-Key, paid for commercial use), Google Web Risk (paid), PhishTank, OpenPhish premium. **Re-tier from R+A to A** | CERT Polska list and/or Phishing.Database (MIT, provenance unverified), if the owner approves | various | api | 5 |
| Database verification, AAMVA DLDV | **Adapters + deterministic sandbox providers.** There is no free authoritative source in the US, UK, EU or India. The matching logic is R-tier | - | - | api | 6 |

### Corrections to the repository's records

- **PLAN §3 and §4.3, THIRD_PARTY_LICENSES §4.2:** URLhaus is **not CC0**. Commercial use "may require a paid subscription, which will be managed by Spamhaus", and both the API and the dumps need an Auth-Key. Google Safe Browsing and the OpenPhish community feed are non-commercial only. The malicious-website check becomes A-tier (§5).
- **PLAN §4.3 "libphonenumber type/carrier":** no permissively licensed carrier data exists in JS, and libphonenumber returns `FIXED_LINE_OR_MOBILE` for ordinary US and Canadian geographic numbers, because its fixed-line and mobile patterns for both are identical (§3.1).
- **THIRD_PARTY_LICENSES §4.2 "UK Companies House API: Open Government Licence":** Companies House says it imposes "no rules or requirements on how the information on the public register is used". Officer and PSC data stays personal data under UK GDPR (§5).
- **NIST reference:** "SP 800-63B §5.1.3" is Rev 3 numbering. The current SP 800-63B-4 (final, July 2025) puts out-of-band authenticators in §3.1.3, with PSTN restricted in §3.1.3.3 (§3.5). ASVS 4.0.3 V2.7/V2.8 became ASVS 5.0.0 V6.5/V6.6.
- **Incidental, outside scope:** `@aws-sdk/client-s3@3.1150.0`, pinned in `apps/api`, was released 2026-10-12, inside the 14-day window when it was adopted.

### Licences met here that rule 4 does not name

Every one of these is permissive, but none is literally on rule 4's list, so each needs the owner's confirmation (the same question already open for MIT-0 and 0BSD):

| Licence | Where it appears | Recommended? |
|---|---|---|
| FreeType Project License (FTL) | Compiled into pypdfium2's `libpdfium.so`. Its credit clause needs a line in our docs or NOTICE: "Portions of this software are copyright © <year> The FreeType Project (www.freetype.org). All rights reserved." | Yes, via pypdfium2 |
| Unicode-3.0 (ICU), IJG, Zlib, libpng-2.0, AGG 2.3 notice, Apache-2.0 WITH LLVM-exception | Compiled into `libpdfium.so` | Yes, via pypdfium2 |
| Adobe Core-14 AFM notice | Bundled in pypdf | Yes, via pypdf |
| MIT-0 | nodemailer (in use); cffi 2.1.1 (only if `cryptography` is added for AES PDFs) | Already pending |
| 0BSD | tslib (already pending); ethers' tslib | Already pending; ethers is not recommended |
| Unlicense | `tweetnacl`, and `fast-sha256` via `bip322-js` | No: both avoided |
| A permission statement, not a licence | CERT Polska Warning List ("may be used by any user for any purpose, including commercial purposes") | Only if the owner approves the feed |

---

## 1. Document / proof-of-address (POA)

Checked 2026-10-21 against PyPI JSON, npm, GitHub tags and API, wheel contents (inspected in memory) and the PDFium source. The 14-day rule allows versions released on or before 2026-10-07. Versions, dates and licence metadata of pypdfium2, pypdf, pikepdf and pdfminer.six were re-checked independently.

### 1.1 PDF parsing, forensic signals, rasterisation

| Candidate | Eco | Version (latest / ≥14-day) | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`pypdfium2`** (PDFium bindings) | PyPI | 5.14.0 / 5.14.0 | 2026-10-04 | pypdfium2 itself is Apache-2.0 / BSD-3-Clause (PyPI `license` "BSD-3-Clause, Apache-2.0, dependency licenses"; README "Licensing"; `LICENSES/` @ tag 5.14.0 → `21f85e2`); its docs are CC-BY-4.0. PDFium is BSD-3-Clause + Apache-2.0 (the wheel's `BUILD_LICENSES/pdfium.txt`). Compiled into `libpdfium.so` (PDFium build 8076, from bblanchon/pdfium-binaries 156.0.8076, MIT): abseil (Apache-2.0), fast_float (MIT), simdutf (MIT), lcms2 2.19 (MIT), OpenJPEG (BSD-2), **FreeType (FTL text only)**, **ICU (Unicode License v3)**, **libjpeg-turbo (IJG + BSD-3 + Zlib)**, **libpng (PNG Reference Library License v2)**, **zlib 1.3.2.1 (Zlib)**, **AGG 2.3 (one-paragraph permissive notice)**, **llvm-libc (Apache-2.0 WITH LLVM-exception)** | ✅ **use**, with an owner confirmation for the bolded permissive licences that rule 4 does not name |
| **`pypdf`** | PyPI | 6.21.2 / **6.19.0** | 2026-10-21 / 2026-09-16 | BSD-3-Clause (PyPI `license_expression`; LICENSE @ tag 6.19.0 → `d62cb58`). GitHub shows NOASSERTION because of the extra copyright lines. It bundles the Adobe Glyph List (BSD-3, agl-aglfn @ 4036a9c) and Core-14 AFM metrics (Adobe's custom permissive notice) | ✅ **use**, but see the advisories in 1.3 |
| `pdfminer.six` | PyPI | 20260107 / 20260107 | 2026-01-07 | MIT (LICENSE @ `9e1243c`). Bundles Adobe CMap data (7.9 MB of `.json.gz`), AFM and glyph-list notices. Requires `charset-normalizer` (MIT) and `cryptography` (Apache-2.0 OR BSD-3) | ⚠️ Licence passes but **not recommended**: unbounded inflate (see 1.3); CVE-2025-64512 (pickle ACE, fixed in 20251230); 249 open issues and PRs; last push 2026-03-13 |
| `pikepdf` | PyPI | 10.17.0 / 10.16.0 | 2026-10-11 / 2026-09-29 | **MPL-2.0** (LICENSE.txt @ v10.16.0 → `23290bd`). The cp312 wheel (2.6 MB) bundles libqpdf 30.4.2 (Apache-2.0) and libjpeg-turbo; its `third-party-licenses/` also ships GPL-3.0 + GCC-exception and OpenSSL texts. Requires Pillow, lxml and packaging | ❌ at runtime. Not needed for dev either: pypdf writes incremental updates |
| `PyMuPDF` | PyPI | 2.0 / 1.28.2 | 2026-10-19 / 2026-08-06 | **"Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License"** (PyPI; COPYING @ 1.28.2 `12786d1`; GitHub AGPL-3.0). 2.0 now pulls onnxruntime, networkx and pymupdf4llm | ❌ |
| `qpdf` CLI | GitHub / Debian | v12.4.2 | 2026-09-27 | Apache-2.0. The release `qpdf-12.4.2-bin-linux-x86_64.zip` bundles **libgnutls (LGPL-2.1+)**, nettle and hogweed, libidn2, libunistring, libtasn1, p11-kit and libffi. Debian 12.4.2-1 builds with `-DREQUIRE_CRYPTO_GNUTLS=ON` | ❌ as shipped. A from-source build with native crypto would pass, but it adds nothing pypdfium2 + pypdf lack |
| `qpdf` (PyPI) | PyPI | 0.2.0 | 2026-06-21 | MIT, but it is an **unrelated** "pdf_editor" project (benevantmathew) that requires PyMuPDF (AGPL), pikepdf (MPL) and PyPDF2 | ❌ Never install (name confusion) |
| `pdfjs-dist` (pdf.js) | npm | 6.4.299 / 6.4.299 | 2026-10-03 | Apache-2.0. 34.9 MB unpacked. Optional `@napi-rs/canvas` (MIT, native) for Node. Bundles a PDFium JBIG2 wasm (BSD-3), OpenJPEG wasm (BSD-2), qcms (MIT), a QuickJS scripting wasm, Adobe CMaps (BSD-3), ICC profiles (CC0), Foxit fonts (BSD-3) and **Liberation fonts under Red Hat's "GPL v2 with exceptions" EULA** (`standard_fonts/LICENSE_LIBERATION`) | ⚠️/❌ Not needed. The Liberation fonts fail rule 4 if shipped. Scripting CVEs: GHSA-hq66-cqwq-w95j / CVE-2026-16633 (≥5.6.83, fixed 6.2.108; `enableScripting` defaults to true) and CVE-2024-4367 |
| `pdf-lib` | npm | 1.17.1 | 2021-11-06 | MIT | ⚠️ Unmaintained. Skip |
| poppler `pdftoppm`, Ghostscript, MuPDF, `jbig2dec` | distro | - | - | GPL-2/3 (poppler); **AGPL-3.0** (Ghostscript, MuPDF, jbig2dec: LICENSE in ArtifexSoftware/jbig2dec) | ❌ |
| `cryptography` (optional pypdf extra, for AES-encrypted PDFs) | PyPI | 50.0.2 / 50.0.2 | 2026-09-30 | Apache-2.0 OR BSD-3-Clause. The abi3 wheel is 4.7 MB with a 14.4 MB `_rust.abi3.so`. It statically links OpenSSL and Rust crates, whose licence files the wheel does not ship. Requires **cffi 2.1.1 (`license_expression` MIT-0)** → pycparser 3.11 (BSD-3) | ⚠️ Optional only (see the recommendation) |

Packaging and maintenance:
- **pypdfium2:**
  - `py3-none-manylinux_2_17` wheels: 3,799,581 B for x86_64 and 3,719,672 B for aarch64 (7.8 MB `.so`).
  - **No Python dependencies** (ctypes). The ELF `DT_NEEDED` list is only libpthread, libm, **libgcc_s.so.1** (the system copy, GCC runtime exception), libc and ld-linux.
  - Repo: 4 open issues/PRs, pushed 2026-10-15, releases every 2–6 weeks tracking PDFium.
  - The repo's LGPL-3.0-or-later (`tests/resources/images.pdf`) and MPL-2.0 (`tests/resources/toc.pdf`) files are test data only (REUSE.toml) and are not in the wheel.
  - The default wheels are built **without V8/XFA**, so PDF JavaScript is never executed.
  - The README warns that PDFium "is inherently not thread-safe".
- **pypdf:** pure Python, `py3-none-any`, 395 KB (6.19.0). No runtime dependencies on 3.12; extras are `crypto`, `image` and `brotli`. 130 open issues/PRs; very active (8 releases since 2026-09-07).

### 1.2 Which library reads which forensic signal

| Signal | pypdfium2 (raw API in 5.14.0 bindings) | pypdf 6.19.0 | Own raw-byte scanner |
|---|---|---|---|
| Producer / Creator (Info) | `FPDF_GetMetaText`, `get_metadata_dict()` | `reader.metadata.producer/.creator` | - |
| XMP (CreatorTool, pdf:Producer, Create/Modify/MetadataDate, xmpMM DocumentID/InstanceID/History) | no XMP API | `reader.xmp_metadata` (capped by `xmp_maximum_*`) | fallback: uncompressed `<x:xmpmeta` packets only |
| CreationDate vs ModDate | raw `D:` strings (we parse them, about 20 lines) | `metadata.creation_date` / `.modification_date` | - |
| Incremental updates / xref sections | **`FPDF_GetTrailerEnds`** (one end offset per revision); **`FPDF_DocumentHasValidCrossReferenceTable`** (false means PDFium repaired the file) | reads the `/Prev` chain internally (`_startxref`, `xref`); no public count | count `%%EOF`, `startxref`, `xref`, `/Prev`, `/XRefStm`; bytes after the last `%%EOF`; a second `%PDF-` |
| Object streams | - | `reader.xref_objStm` | `/ObjStm` count |
| Fonts: subset tags `^[A-Z]{6}\+`, embedded or not, per-character font | `FPDFTextObj_GetFont`, `FPDFFont_GetBaseFontName`, `FPDFFont_GetIsEmbedded`, `FPDFText_GetFontInfo` / `GetFontWeight` / `GetFillColor`, `FPDFTextObj_GetFontSize` | `page._get_fonts()` (private) returns embedded and unembedded name sets | - |
| Annotations, AcroForm fields | `FPDFPage_GetAnnotCount`, `FPDFAnnot_GetSubtype`, `FPDF_GetFormType`, `FPDFAnnot_GetFormFieldName` | `page.annotations`, `reader.get_fields()` | `/AcroForm`, `/Annots` |
| JavaScript, OpenAction, AA, Launch, EmbeddedFile | `FPDFDoc_GetJavaScriptActionCount`, `FPDFAction_GetType`, `FPDFDoc_GetAttachmentCount` | Root dictionary `/OpenAction`, `/AA`, `/Names/JavaScript`; `reader.attachments` | **required** for `#xx`-escaped names (`/J#61vaScript`) and keys in unreferenced objects: `/JS /JavaScript /AA /OpenAction /Launch /EmbeddedFile /RichMedia /XFA /SubmitForm /GoToR /URI /JBIG2Decode /Encrypt` |
| Signatures, and edits after signing | `FPDF_GetSignatureCount` plus ByteRange compared with the trailer ends | - | - |
| Text layer vs rendered image | text page (`get_text_bounded`, `FPDFText_GetCharBox`), render mode (`FPDFTextObj_GetTextRenderMode`; 3 = invisible), page objects (`FPDFPage_CountObjects`, `FPDFPageObj_GetType`, `GetFillColor`) to find opaque fills drawn over text, plus `render()` for our OCR | `extract_text` (slower) | - |
| Embedded scans (JPEG) | `FPDFImageObj_GetImageFilter` + `GetImageDataRaw` give the raw DCT bytes, which go straight into the existing JPEG, EXIF and ELA forensics | - | - |

### 1.3 Hostile-PDF safety

- **pypdf.** Limits live in the frozen dataclass `pypdf.Configuration` (`pypdf/_configuration.py`), set through `overwrite_configuration(...)`, a ContextVar. The old `filters.ZLIB_MAX_OUTPUT_LENGTH` and similar constants are deprecated aliases.
  - **6.19.0 defaults:**
    - `maximum_declared_stream_length`, `array_based_stream_maximum_output_length`, the `jbig2`/`lzw`/`run_length`/`zlib_maximum_output_length` limits and `image_maximum_buffer_size`: all 75,000,000;
    - `zlib_maximum_recovery_input_length`: 5,000,000;
    - `flate_maximum_columns`: 250,000; `flate_maximum_row_length`: 4,000,000;
    - `xmp_maximum_input_length`: 5,000,000; `xmp_maximum_element_count`: 100,000;
    - `outline_maximum_entries`: 100,000 at depth 100; `page_tree_maximum_entries`: 100,000 at depth 100;
    - `xform_maximum_invocations_per_extraction`: 5,000;
    - `PdfReader(root_object_recovery_limit=10_000)`.
  - **6.21.2 adds:** `array_maximum_element_count` and `dictionary_maximum_element_count` (100,000 each), `brotli_maximum_output_length`, `stream_filters_maximum_length` (16), `stream_decoding_work_maximum_length` (300,000,000), `stream_parsing_work_maximum_count` (2,000,000), and `form_fields_maximum_entries` (100,000) at depth 100.
  - **`jbig2dec_binary` defaults to `shutil.which("jbig2dec")`, and jbig2dec is AGPL.** Set it to `None` and keep jbig2dec out of the image.
  - **Advisories:** 60 GHSAs since 2024-10, all medium, all denial of service (memory or CPU). **11 are fixed after 6.19.0**, 9 of them on the read path:
    - GHSA-39mj-jf6j-2qj3 and GHSA-7mh2-4gg2-979f (fixed 6.20.0, released 2026-10-09);
    - GHSA-f54x-cmq8-qg57, GHSA-cgf9-327m-v77c and GHSA-6vvc-x485-93v7 (6.21.0, 2026-10-16);
    - GHSA-5hx5-vpf9-5wcv (6.21.1, 2026-10-17);
    - GHSA-gmh7-3g9r-mjh5, GHSA-jr96-gvgh-j3r4 and GHSA-6c7f-9265-g8fw (6.21.2, 2026-10-21).

    The other two are writer-only: GHSA-qfv9-64jg-mh7p and GHSA-9mx8-4j7g-633p (6.20.1).
- **PDFium** (main, read 2026-10-21):
  - Flate output is capped at 1 GiB per stream (`kMaxTotalOutSize`, `core/fxcodec/flate/flatemodule.cpp`);
  - `kMaxObjectNumber = 24*1024*1024` (`cpdf_parser.h`);
  - `/Prev` loops are detected through a `seen_xref_offset` set (`cpdf_parser.cpp`);
  - parser recursion is capped at `kParserMaxRecursionDepth = 64`, held in a static global (`cpdf_syntax_parser.h`).

  PDFium memory-safety bugs are published as Chrome CVEs. NVD's 20 most recent PDFium CVEs date from 2026-04-15 to 2026-10-20, including CVE-2026-113022 (memory corruption, fixed in Chrome 156.0.8078.47), CVE-2026-110155 (buffer overflow), CVE-2026-95338 and CVE-2026-93382 (use after free). Whether build 8076 includes the CVE-2026-113022 fix was **not verified**. **PDFium must run in an isolated, killable process.**
- **pdfminer.six 20260107:** `PDFStream.decode` calls `zlib.decompress(data)` with **no output cap**. Its LZW and RunLength decoders also have no limits. CMaps now load from JSON (`cmapdb.py`), not pickle.

**Our own guard layer.** It reuses the `limits.BodySizeLimitMiddleware` route limits, `JobLimiter`, the `max_image_pixels` (40 MP) / `ImageTooLargeError` semantics of `imaging.decode_image`, and problem+json.
1. Sniff `%PDF-` within the first 1,024 bytes (ignore the declared type). Set a per-route body cap of 10–20 MiB.
2. Run all PDF work in a **fresh subprocess per document**: `subprocess.Popen([sys.executable, "-I", "-m", "openverify_vision.pdf.worker"])`, with the bytes on stdin and JSON plus page bitmaps on stdout.
   - The worker sets these limits itself before parsing: `RLIMIT_AS` about 1–1.5 GiB, `RLIMIT_CPU` about 20 s, `RLIMIT_FSIZE=0`, `RLIMIT_CORE=0`, low `RLIMIT_NOFILE`.
   - The parent enforces a wall-clock `communicate(timeout=…)` and then `kill()`.
   - Workers are bounded by `max_concurrent_jobs`. This also isolates PDFium's lack of thread safety from the service's thread pool.
   - The worker loads no onnxruntime; OCR runs in the parent on the returned bitmaps.
3. Before any page work, enforce:
   - a page-count cap (`FPDF_GetPageCount` ≤ 50; analyse the first 3 pages plus the last);
   - a page-box sanity check (≤ 14,400 pt a side);
   - a render scale of `min(200/72, sqrt(cap_px / (w·h)))`, with `cap_px ≤ max_image_pixels` and a smaller per-page cap of about 12 MP.
4. Lower the pypdf limits: output caps of about 20 MB, `page_tree_maximum_entries=1000`, `jbig2dec_binary=None`, `strict=False`.
5. Answer password-protected (user password) PDFs as unprocessable. Owner-password-only PDFs open normally.

### 1.4 Rasterisation for OCR

Use **pypdfium2** `PdfPage.render(scale=200/72, draw_annots=True, may_draw_forms=True)` after `init_forms()` (there is no JavaScript in the default build), and feed the bitmaps to the existing OCR. The rejected alternatives:
- pdftoppm (poppler): GPL;
- MuPDF and Ghostscript: AGPL;
- pdf.js: would need Node, native `@napi-rs/canvas` and the GPL-EULA fonts excluded, with a history of scripting CVEs;
- Pillow: can only write PDFs, not render them.

The dashboard must not open uploaded PDFs in pdf.js. Show the server-rendered PNGs instead.

### 1.5 Document type classification (utility bill, bank statement, lease, pay stub, tax form)

**Models: none qualifies, so do not ship one.**
- `microsoft/layoutlmv3-base` and `layoutlmv2-base-uncased` are **CC BY-NC-SA 4.0**.
- `microsoft/dit-base-finetuned-rvlcdip` (MIT card @ 87fb1d9), `naver-clova-ix/donut-base(-finetuned-rvlcdip)` (MIT), `microsoft/layoutlm-base-uncased` (MIT) and LiLT (MIT) are all pre-trained on **IIT-CDIP** and/or fine-tuned on **RVL-CDIP**:
  - RVL-CDIP's card licence is "other": it derives from the Legacy Tobacco Document Library, whose documents remain third-party copyright, offered under court agreements or fair use;
  - its 16 labels (letter, form, email, … invoice, budget, memo) contain **none** of our 5 classes.
- Hugging Face community "bank statement" and "payslip" models are single-author, have under 500 downloads and do not disclose their training data (likely real PII documents), or are CC BY-NC-SA.

**Design (deterministic, R tier).** Keep to C32.2, where vision measures and TypeScript decides. Vision returns OCR lines with boxes (and, for born-digital PDFs, the PDFium text layer). Classification runs in `packages/checks`:
- **Normalisation.** NFKC, casefold, fold diacritics (reuse `normalizeName`), map common OCR confusions (0/O, 1/l/I, 5/S). Fuzzy-match phrases with Jaro-Winkler ≥ 0.93 for tokens of 5 characters or more (reuse `jaroWinkler` from `name-matching.ts`).
- **Lexicons:** JSON per class × language (en/es/fr/de first, about 25 phrases each), with weights.
  - **Anchors (weight 3):**
    - bank: statement of account / Kontoauszug / relevé de compte / extracto de cuenta;
    - utility: kWh, m³, therms, Zählerstand, consommation;
    - lease: lease agreement / Mietvertrag / contrat de location / bail / contrato de arrendamiento;
    - pay stub: pay stub / payslip / Gehaltsabrechnung / Entgeltabrechnung / bulletin de paie / nómina;
    - tax: Form W-2, 1099-(NEC|MISC|INT|DIV), 1040, P60, P45, SA302, T4, Lohnsteuerbescheinigung, Steuerbescheid, avis d'imposition, Modelo 100.
  - **Medium (weight 2):** amount due, billing period, service address, opening/closing balance, Anfangs-/Endsaldo, solde, net pay, gross pay, YTD, Brutto/Netto, salaire net, líquido a percibir, landlord/tenant, Vermieter/Mieter, bailleur/locataire, arrendador/arrendatario, security deposit/Kaution/dépôt de garantie/fianza, tax year.
  - **Weak (weight 1, shared):** account number, due date, IBAN, page x of y.
- **Layout features from boxes:**
  - a right-aligned money column (≥ 5 lines whose right edges align within 1% of the width and match a money pattern);
  - a left date column (≥ 5 dates) plus a running-balance column, pointing to a bank statement;
  - a valid IBAN (mod-97);
  - earnings and deductions in two columns, pointing to a pay stub;
  - numbered box labels ("1 Wages, tips…", "Box 12"), pointing to a tax form;
  - long full-width prose lines with few numbers, several pages and signature lines, pointing to a lease;
  - meter and unit tokens, pointing to a utility bill.
- **Scoring.** `s_c = Σ w_f` with a cap on repeats; softmax with temperature `T` over the 5 classes plus `other` (constant θ). Answer **`unknown`** when the top probability is under 0.5 or the margin under δ. Confidence is the calibrated probability (the existing calibration harness in `packages/checks/src/calibration`). The language is the one with the most anchor hits, which also sets the date order.
- **Size:** about 300 lines of TypeScript plus about 500 lexicon entries.

**Issue date and issuer.**
- **Issue date:** label-anchored ("statement date", "bill date", "invoice date", "issue date", "date of issue", "period ending", Rechnungsdatum, date de facture / d'émission, fecha de emisión / de factura). The value is on the same line to the right, or on the line below within 1.5 line heights.
  - Dates go through the existing `parseVizDate` (`packages/checks/src/viz.ts`: en/es/fr/de month names, DMY/MDY).
  - For a "statement period A–B" range, take B.
  - Dates inside a detected transaction column are excluded.
  - The PDF `CreationDate` is only a weak tie-breaker, and a fabrication cue when it precedes the printed date.
- **Issuer:** the tallest line or lines in the top 25% of page 1 that are not an address or a date, plus any web or email domain found in the text.
- **Size:** about 250 lines of TypeScript.

### 1.6 What Phase 3 vision already provides

- **OCR:** `services/vision/src/openverify_vision/ocr/__init__.py` (`OcrEngine.read_text`, PP-OCRv6 small). Full pages need two contract changes:
  - `MAX_TEXT_LINES = 200` and `MAX_TEXT_LENGTH = 200` (`schemas.py`) are too low for dense statements, so add a document-page variant (for example 600 lines per page);
  - `DetectionParams.max_side_len = 2000` (`ocr/detection.py`) means an A4 page at 200 DPI is read at about 171 DPI, which is acceptable.
- **Document detection:** `document.py` gates on the ID-1 and TD3 aspect ratios only, landscape only. Photographed A4 (1.414) or Letter (1.294) pages in portrait would not be found, so add page aspects and portrait orientation. PDFs need no detection.
- **Forensics:**
  - `forensics/ela.py` compares the portrait with the rest. For documents, compare the amount, name and address line cells with the other text cells, on JPEG-origin images only, never on PDF renders.
  - `forensics/jpeg.py` (quantization tables, double compression), `forensics/exif.py` and `forensics/upload.py` apply as they are to photos, and to raw DCT streams extracted from scanned PDFs.
- **Safe decoding and limits:** `imaging.py` and `limits.py`, as in 1.3.

### 1.7 Synthetic POA fixtures (dev)

- **Rejected generators:**
  - `reportlab` 5.0.1 (2026-08-20; BSD) ships the **DarkGarden font under GPL** (`reportlab/fonts/DarkGarden-copying-gpl.txt`) in its wheel, so it fails a strict reading of rule 4;
  - `fpdf2` 2.8.9 is LGPL-3.0-only ❌;
  - `borb` 3.0.9 is AGPL ❌.
- **Use instead:**
  - our own minimal PDF writer (standard-14 Helvetica text, about 150 lines) or pypdfium2's page-object API;
  - Pillow's PDF save for image-only "scans";
  - `pypdf.PdfWriter(clone_from=…, incremental=True)` (present in 6.19.0) for the "edited" variants, with the incremental update, changed producer and amount overlay.

**Recommendation:**
- **Runtime (vision):**
  - Add **`pypdfium2==5.14.0`** for rendering, the text layer, fonts, page objects, annotations and forms, JavaScript and attachment counts, trailer ends and signature count.
  - Add **`pypdf==6.19.0`**, moving to **≥ 6.21.2 on 2026-11-04** (or sooner with an owner exception), for Info and XMP, dictionary-level actions and object streams.
  - Alongside them, write our own raw-byte scanner (about 150 lines) and the subprocess guard layer (about 200 lines).
  - Add `cryptography==50.0.2` only if the slice decides pypdf must parse AES-encrypted PDFs. Otherwise encrypted files get PDFium-only signals.
- **Scoring:** every signal ships `stage: beta` with a confidence. The score is a composite: incremental revisions, a repaired xref, editor producers, ModDate after the printed date, Info/XMP disagreement, DocumentID ≠ InstanceID, mixed subsets of one base font, a different font inside an amount line, invisible or covered text, mismatch between the text layer and OCR, edits after signing, JavaScript or launch actions. No single weak cue fails the check.
- **Fallback:** pypdfium2 plus our own scanner only (drop pypdf; XMP only from uncompressed packets).
- **Classification:** our own lexicon and layout classifier in `packages/checks` (TypeScript). There is no permissive, provenance-clean model for these classes.
- **Never use:** PyMuPDF, pikepdf (at runtime), the qpdf release binaries or the Debian build, poppler, Ghostscript, MuPDF, jbig2dec, PyPI `qpdf`, borb, fpdf2, reportlab, or pdf.js on the server.

### 1.8 Sources

- PyPI JSON (read 2026-10-21): https://pypi.org/pypi/pypdfium2/5.14.0/json · https://pypi.org/pypi/pypdf/json · https://pypi.org/pypi/pypdf/6.19.0/json · https://pypi.org/pypi/pypdf/6.21.2/json · https://pypi.org/pypi/pdfminer.six/20260107/json · https://pypi.org/pypi/pikepdf/10.16.0/json · https://pypi.org/pypi/PyMuPDF/json · https://pypi.org/pypi/qpdf/json · https://pypi.org/pypi/cryptography/50.0.2/json · https://pypi.org/pypi/cffi/json · https://pypi.org/pypi/pycparser/json · https://pypi.org/pypi/charset-normalizer/json · https://pypi.org/pypi/reportlab/5.0.1/json · https://pypi.org/pypi/fpdf2/json · https://pypi.org/pypi/borb/json
- Wheels inspected in memory: pypdfium2-5.14.0 manylinux x86_64 (`dist-info/licenses/data/linux_x64/BUILD_LICENSES/*`, `pypdfium2_raw/bindings.py`, `version.json`, ELF `DT_NEEDED`), pypdf 6.19.0 and 6.21.2 (`_configuration.py`, `_page.py`, `_writer.py`, `_codecs/*`), pdfminer_six-20260107 (`pdftypes.py`, `cmapdb.py`, `cmap/README.txt`), pikepdf-10.16.0 cp312 (`pikepdf.libs`, `third-party-licenses/`), cryptography-50.0.2 abi3, reportlab-5.0.1 (`fonts/`).
- LICENSE files at tags:
  - https://github.com/py-pdf/pypdf/blob/d62cb58d3988b291b0435eddfd118c4f8f6b6a46/LICENSE
  - https://github.com/pdfminer/pdfminer.six/blob/9e1243c4ad000bf9bbe60e81fc8dde2fccc0ed3b/LICENSE
  - https://github.com/pikepdf/pikepdf/blob/23290bd753eaf3feeaa265da9a191c6d1cd54612/LICENSE.txt
  - https://github.com/pypdfium2-team/pypdfium2/tree/21f85e273036f3bade4f67d896e1d05927e5f4b1/LICENSES and its REUSE.toml
  - https://github.com/pymupdf/PyMuPDF/blob/12786d12b2962a1d77fd13b103162eddf749644c/COPYING
  - https://github.com/ArtifexSoftware/jbig2dec/blob/master/LICENSE
- Repo metadata (GitHub API, 2026-10-21): py-pdf/pypdf, pdfminer/pdfminer.six, pikepdf/pikepdf, pypdfium2-team/pypdfium2, pymupdf/PyMuPDF, qpdf/qpdf, mozilla/pdf.js, bblanchon/pdfium-binaries.
- Advisories:
  - https://github.com/py-pdf/pypdf/security/advisories (GHSA-39mj-jf6j-2qj3, GHSA-7mh2-4gg2-979f, GHSA-f54x-cmq8-qg57, GHSA-cgf9-327m-v77c, GHSA-6vvc-x485-93v7, GHSA-5hx5-vpf9-5wcv, GHSA-gmh7-3g9r-mjh5, GHSA-jr96-gvgh-j3r4, GHSA-6c7f-9265-g8fw, GHSA-qfv9-64jg-mh7p, GHSA-9mx8-4j7g-633p, GHSA-7hfw-26vp-jp8m)
  - https://github.com/pdfminer/pdfminer.six/security/advisories/GHSA-wf5f-4jwr-ppcp and https://github.com/advisories/GHSA-f83h-ghpp-7wcc (CVE-2025-64512)
  - https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j and https://github.com/advisories/GHSA-wgrm-67xf-hhpq
  - https://nvd.nist.gov/vuln/detail/CVE-2026-113022 · https://nvd.nist.gov/vuln/detail/CVE-2026-110155 · https://nvd.nist.gov/vuln/detail/CVE-2026-95338 · https://nvd.nist.gov/vuln/detail/CVE-2026-93382 (NVD API `keywordSearch=PDFium`, 136 total)
- PDFium source:
  - https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fxcodec/flate/flatemodule.cpp
  - https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fpdfapi/parser/cpdf_parser.cpp
  - https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fpdfapi/parser/cpdf_parser.h
  - https://github.com/chromium/pdfium/blob/main/core/fpdfapi/parser/cpdf_syntax_parser.h
- qpdf: https://github.com/qpdf/qpdf/releases/tag/v12.4.2 (`qpdf-12.4.2-bin-linux-x86_64.zip` contents) · https://sources.debian.org/src/qpdf/12.4.2-1/debian/rules/ · https://sources.debian.org/src/qpdf/12.4.2-1/debian/control/
- pdf.js and pdf-lib: https://registry.npmjs.org/pdfjs-dist (6.4.299 tarball: `standard_fonts/LICENSE_LIBERATION`, `wasm/LICENSE_*`, `iccs/LICENSE`, `cmaps/LICENSE`) · https://registry.npmjs.org/pdf-lib · https://registry.npmjs.org/@napi-rs/canvas
- Models and data (Hugging Face API and cards, 2026-10-21):
  - https://huggingface.co/microsoft/layoutlmv3-base (@cfbbbff) · https://huggingface.co/microsoft/layoutlmv2-base-uncased · https://huggingface.co/microsoft/dit-base-finetuned-rvlcdip (@87fb1d9) · https://huggingface.co/naver-clova-ix/donut-base · https://huggingface.co/naver-clova-ix/donut-base-finetuned-rvlcdip · https://huggingface.co/microsoft/layoutlm-base-uncased · https://huggingface.co/SCUT-DLVCLab/lilt-roberta-en-base
  - https://huggingface.co/datasets/aharley/rvl_cdip (licence "other", 16 labels) · https://www.industrydocuments.ucsf.edu/help/copyright/ (court agreements or fair use; rights stay with the creators) · https://arxiv.org/abs/2111.15664 (Donut pre-training on IIT-CDIP + SynthDoG)
  - Model searches: https://huggingface.co/api/models?search=bank%20statement · …?search=payslip · …?search=document%20classification
- Repo: `services/vision/src/openverify_vision/{imaging,limits,settings,document,schemas}.py`, `ocr/__init__.py`, `ocr/detection.py`, `forensics/{ela,jpeg,exif,upload}.py`; `packages/checks/src/{viz,name-matching,dates}.ts`; `packages/core/src/check-registry.ts` (document_* entries).

## 2. Name and address matching

Checked 2026-10-21. Versions come from the npm registry (`https://registry.npmjs.org/<name>`) and PyPI JSON (`https://pypi.org/pypi/<name>/json`). Licences were read from the LICENSE file at the tag or commit shown. The carltonnorthern licence and README, the libpostal training-data labels and the libaddressinput data licence were re-checked independently.

### 2.0 What already exists in `packages/checks`

**`src/name-matching.ts` (185 lines, 183 lines of tests):**
- `normalizeName` does NFKD, strips marks, lowercases, maps ß/æ/ø/œ/þ/ð/đ/ł/ı/ħ, drops apostrophes, turns other punctuation into spaces, and keeps non-Latin scripts.
- Jaro is computed over code points.
- `jaroWinkler` has `prefixScale` (default 0.1, limited to 0–0.25), `boostThreshold` (default 0.7, Winkler's rule) and a 4-character prefix cap.
- `tokenSetSimilarity`, plus `compareNames` (plain and token-sort).
- The test vectors are reference values from jellyfish (MIT), as `name-matching.test.ts` says.

**`src/extraction/agreement.ts`:**
- `namesAgree` uses the ICAO 9303 transliteration renderings (Ä→AE or A, Ø→OE or O, and so on) with a per-token Jaro-Winkler of at least 0.92 (C31.2).
- `allowMissingTokens` lets user data leave out a middle name or reorder tokens.
- `truncated` covers MRZ prefix and initial truncation.
- Addresses get a 12-word abbreviation map, compared in order (numbers exactly, words with Jaro-Winkler ≥ 0.92).
- Postal codes compare alphanumerically, with prefix ≥ 5 (ZIP+4).
- Birthdates must be exactly equal, allowing the OCR confusables.

`government-id/comparison.ts` compares last name against last name and given against given (`name-threshold` default 0.88).

**Gaps for Phase 5** (database, document and AAMVA comparisons):
1. **No nickname equivalence** (Bill ↔ William).
2. **Initials.** "J. Smith" against "John Smith" is accepted only in MRZ `truncated` mode. On the user-data path, Jaro-Winkler("J", "JOHN") is about 0.78, below 0.92.
3. **Swapped fields.** Given and family names entered in each other's fields fail, because `compareName` compares field to field.
4. **Joined versus spaced particles and compounds.** "McDonald" vs "Mc Donald", "DeLuca" vs "De Luca" and "GarciaLopez" vs "Garcia-Lopez" are compared token by token; the joined form is never tried.
5. **Titles and generational suffixes** (Dr, Mr, Jr, Sr, II, III) are not stripped.
6. **Non-Latin scripts never agree.** `renderings()` keeps only `[A-Z]` after NFKD, so a Cyrillic, Greek or Arabic name yields no tokens. Cross-script matching needs the ICAO 9303 Part 3 §6 transliteration tables (overlaps Phase 6).
7. Winkler's long-string adjustment (jellyfish's `long_tolerance`) is not implemented. This is optional.

The MRZ parser already accepts unknown date parts (`mrz.ts`, `allowUnknownParts` with `<<`).

### 2.1 Jaro-Winkler: keep ours; use other libraries only as test oracles

| Candidate | Eco | Latest (released) | ≥14-day pick | Licence (verified) | Size / maintenance | Verdict |
|---|---|---|---|---|---|---|
| **Own** (`name-matching.ts`) | (ours) | - | - | Apache-2.0 | 185 lines, 100% tested | ✅ **keep** |
| `jellyfish` | PyPI | 1.3.0 (2026-10-16) | **1.2.1** (2025-10-11) | MIT (classifier; LICENSE @ codeberg tag v1.2.1 `7d50927`, © 2015 James Turk) | Rust core, wheel about 212 KB; moved to Codeberg | ✅ **oracle** (already the source of our vectors) |
| `rapidfuzz` | PyPI | 3.14.6 (2026-08-30) | 3.14.6 | MIT (`license_expression`; LICENSE @ v3.14.6 `d1b4a18`). Bundled submodules: rapidfuzz-cpp (MIT) and taskflow (MIT, LICENSE @ `130f795`) | cp312 wheels about 1.19 MB; very active | ✅ second oracle |
| `cmpstr` | npm | 3.4.0 (2026-09-14) | 3.4.0 | MIT (LICENSE @ v3.4.0 `8eac81f`) | 731 KB unpacked, 0 dependencies, active | ⚠️ JS oracle candidate. Its exact JW variant (prefix scale, 0.7 threshold) is not verified |
| `talisman` | npm | 1.1.4 (2021-01-21) | 1.1.4 | MIT (LICENSE.txt @ v1.1.4 `3fcb2e3`) | 550 KB, stale | ⚠️ not needed |
| `jaro-winkler` | npm | 0.2.8 (2016-10-04) | 0.2.8 | MIT (GitHub) | Abandoned since 2016 | ⚠️ not needed |
| `natural` | npm | 8.1.1 (2026-02-27) | 8.1.1 | MIT | 13.8 MB unpacked; dependencies include mongoose, pg, redis, memjs, wordnet-db | ❌ in practice: far too heavy |
| `string-similarity-js` / `fastest-levenshtein` | npm | 2.1.4 / 1.0.16 | same | MIT | Dice coefficient only / Levenshtein only | Not applicable |
| `Levenshtein` | PyPI | 0.27.5 | - | **GPL-2.0-or-later** | - | ❌ |
| `nameparser` | PyPI | 2.5.0 (2026-10-19) | 2.3.0 | **LGPL** (classifier) | - | ❌ |

**Recommendation:**
- Keep our implementation and add no dependency.
- Extend the hard-coded vector table with values computed once, offline, from **jellyfish 1.2.1** and **rapidfuzz 3.14.6**, both MIT, using the same defaults.
- Fallback, if a live JS cross-check in Vitest is wanted: `cmpstr@3.4.0` as a dev-only dependency, after confirming its JW parameters.
- Close gaps 1–6 above in our own code.

### 2.2 Nickname and diminutive tables

| Candidate | Eco / form | Latest | ≥14-day | Licence (verified) | Contents / size | Verdict |
|---|---|---|---|---|---|---|
| **carltonnorthern/nicknames** `names.csv` | GitHub HEAD `ed160b3` (2026-08-02) | - | - | **Apache-2.0** (`License.txt`, added 2017-04-20 in `5da29ff`) | 2,827 `has_nickname` triplets, 1,232 formal names, 2,252 distinct names, 77,855 bytes. English; its README says it is "heavily biased towards traditionally African American names" | ⚠️ **Provenance**, see below |
| `nicknames` (same project) | PyPI | 1.0.1 (2026-03-06) | 1.0.1 | Apache-2.0 | 18 KB | ⚠️ same data |
| `nicknames-curated` (same project; repository field points to NickCrews/nicknames) | npm | 0.2.1 (2026-03-04) | 0.2.1 | Apache-2.0 | 430 KB | ⚠️ same data |
| onyxrev/common_nickname_csv | GitHub `b28d65b` (2013) | - | - | README: "Released as public domain"; no LICENSE file | 1,431 pairs, 28 KB | ⚠️/❌ **96% of its pairs (1,328 of 1,377) also appear in carltonnorthern**, so it is almost certainly the same seed relabelled |
| `nicknames` (ryanburgess) | npm | 1.0.2 (2015) | - | MIT | Random pet nicknames | Not applicable |
| Wikidata hypocorism items (`P31 = Q1130279`) | data | live | - | **CC0** | 671 items, 507 of them with P460 (counted via the `haswbstatement` search API) | ⚠️ Clean licence but poor structure (see below). Use as a seed |
| opensanctions/rigour `person_names.txt` @ `06573c9` | GitHub / PyPI rigour 2.6.1 (≥14-day: 2.5.0) | - | - | Code MIT; data from Wikidata (CC0) | 171,833 lines, 10.2 MB. **Cross-script variant groups, not nicknames**: the "bill" group has no "william" | ✅ for gap 6 and Phase 6 only |
| Wiktionary | data | - | - | **CC BY-SA 4.0 + GFDL** | - | ❌ |
| SSA / Census name lists | - | - | - | Not verified (ssa.gov returned 403) | Frequencies only, no nickname relations | Not applicable |

**carltonnorthern provenance:**
- The README says the list was "initially created by mining" caagri.org/nicknames.html (Center for African American Research). That page carries "COPYRIGHT © 2004 - ALL RIGHTS RESERVED".
- The author's 2010 blog post names a different seed: tngenweb.org/franklin/frannick.htm. The archived page says: **"Copyright is for all pages on this Franklin Co., TN site. You may NOT use this page to begin a new nickname page or copy this page for sale."**
- Nickname facts are not copyrightable, but the original compilation may be. This is a legal call for the owner.

**Wikidata structure:**
- Bill (Q18245781) has P460 pointing to William plus 17 other-language forms (Willem, Guillaume, Wilhelm, Guillermo, …), so translation and diminutive are conflated.
- Peggy (Q16280537) is not typed hypocorism and links only to Peg, not Margaret.

**Recommendation:**
- **Build our own curated table:**
  - **Scope:** about 400–600 formal English given names → about 1,200–1,800 pairs, about 25–35 KB JSON, plus a short list of high-frequency es/fr/de/it hypocorisms.
  - **Seed:** Wikidata CC0 hypocorism items with P460, filtered to same-language links and reviewed by hand. Each row records its source, either a Wikidata QID or "authored".
  - **Code:** a dev-only generator of about 150 lines and a TS lookup/match module of about 120 lines.
  - **Matching rule:** nickname equivalence counts as token agreement with a distinct reason (`nickname_match`) and a lower confidence, never a blanket pass. One nickname maps to many formal names: "chris" to 18 in carltonnorthern, "al" to 14.
- **Fallback, only with the owner's sign-off on provenance:** carltonnorthern `names.csv` @ `ed160b3` (Apache-2.0), vendored with NOTICE attribution. Never use onyxrev.

### 2.3 Address parsing and normalisation

| Candidate | Eco | Latest (released) | ≥14-day | Licence (verified) | Size / maintenance | Verdict |
|---|---|---|---|---|---|---|
| libpostal (C code) | GitHub | tag v1.1.4 `ffafa3f` (2025-10-18); HEAD `25099c5` (2025-12-06) | v1.1.4 | **MIT** (LICENSE, © 2015 openvenues) | 4.9k stars, 299 open issues/PRs | ⚠️ The code is fine, but useless without its models |
| libpostal default models (GitHub release v1.0.0, 2017-04-07: `parser.tar.gz` 752,483,239 B; `language_classifier.tar.gz` 50,334,317 B; `libpostal_data.tar.gz` 10,190,140 B) | download | - | - | No separate licence. The README labels three of the parser training sets **"(ODBL)"** (OSM addresses, places, ways); the others are GeoPlanet (CC-BY) and OpenAddresses ("various licenses, mostly CC-BY"). The language classifier is trained "on all of OpenStreetMap" | README: about 1.8 GB; training data "over 100GB unzipped" | ❌ ODbL-derived runtime data, plus size |
| libpostal Senzing model (v1.2.0, public-read-libpostal-data S3) | download | - | - | Repo is Apache-2.0, but the model is trained on OSM + OpenAddresses + Senzing customer data | about 2.2 GB | ❌ |
| `postal` (pypostal) | PyPI | 1.1.11 (2025-10-29) | 1.1.11 | MIT | 22 KB sdist; needs libpostal + models | ❌ (via the models) |
| `node-postal` | npm | 1.3.0 (2025-06-02) | 1.3.0 | MIT | Native addon (`nan`), so it would need an `allowBuilds` entry; needs libpostal | ❌ (via the models) |
| `usaddress` | PyPI | 0.5.16 (2025-08-07) | 0.5.16 | MIT (LICENSE @ `aa7699b`, © 2014 The Atlanta Journal Constitution) | 70.6 KB wheel including the `usaddr.crfsuite` model. Canonical training set: 1,513 hand-labelled addresses with undocumented provenance. The repo also holds OSM-derived and IIT Bombay `us50` (NCSA-style) files, not in the wheel. US only, Python | ⚠️ Not recommended (Python while matching lives in TS, US-only, unclear provenance) |
| `python-crfsuite` | PyPI | 0.9.12 (2025-12-23) | 0.9.12 | MIT (LICENSE.txt @ `c2eee32`); bundles CRFsuite (BSD) and liblbfgs (MIT) | Wheel about 282 KB | ✅ (only if usaddress is used) |
| `probableparsing` | PyPI | 0.0.1 (2016) | 0.0.1 | MIT | 3 KB | ✅ |
| `usaddress-scourgify` | PyPI | 0.7.1 (2026-08-07) | 0.7.1 | MIT (LICENSE @ `cf66bdc`); PyPI has no licence metadata | Depends on `yaml-config` 0.1.5, **which has no licence metadata** (not verified) | ⚠️ Not recommended |
| `parse-address` | npm | 1.1.2 (2019) | 1.1.2 | ISC for "the new code" only. It ports Perl Geo::StreetAddress::US 1.04, "same terms as Perl itself" (Artistic or GPL) | 74 KB | ❌ |
| `addresser` | npm | 1.1.22 (2026-08-12) | 1.1.22 | MIT (LICENSE @ `d32f89d`) | 973 KB; bundles US/CA city lists generated from GeoNames postal dumps (CC BY 4.0) with no attribution | ⚠️ Not recommended |
| `@zerodep/address-parse` | npm | 0.1.11 (2024-10-27) | 0.1.11 | MIT (LICENSE.md @ `e5fff5a`) | 90 KB, 0 dependencies, US/CA only | ⚠️ Reference only |

Data and abbreviation sources:

| Source | Licence (verified) | What it gives | Verdict |
|---|---|---|---|
| **libpostal `resources/dictionaries/`** @ `25099c5` | MIT | Synonym files for about 60 languages: street types (en 8,492 B), directionals, unit and level types, post office, stopwords | ✅ **seed for our tables**. Exclude `all/given_names.txt` ("derived from Wikipedia", CC BY-SA) and `categories` / `place_names` (Nominatim Special Phrases on the OSM wiki, **CC BY-SA 2.0**) |
| **OpenCageData/address-formatting** `conf/` @ `cbf2348` | MIT (© 2020 OpenCage GmbH) | Per-country templates and abbreviations in 25 languages | ✅ Take only `conf/`; the test cases are OSM-derived |
| **google/libaddressinput** data (`testdata/countryinfo.txt` @ `81eb962`, 1.7 MB, updated 2026-05-11; live at chromium-i18n.appspot.com/ssl-address/data) | README: "Data licensed under the **CC-BY 4.0**" | 257 regions, **180 with a postal-code regex**, formats, required fields, US/CA `sub_keys` / `sub_names` / `sub_zips` (state ↔ ZIP prefix) | ✅ attribution needed |
| GeoNames postal dump (`allCountries.zip` 19.7 MB, `US.zip` 634 KB; rebuilt daily) | **CC BY 4.0** (`export/zip/readme.txt`); GB_full contains Royal Mail data | Postcode → place name | ✅ optional, later |
| USPS Publication 28 | **USPS-copyrighted**, not public domain. The page footer reads "Copyright © USPS. All Rights Reserved"; the USPS terms say material "may not … be reproduced … without prior written permission". The House Report on 17 U.S.C. §105 says the section "does not apply to works created by employees of the United States Postal Service" | The authoritative US abbreviations | ⚠️ Cite and cross-check only; **do not copy the tables** |
| UPU S42 | UPU Technical Standards Manual; no open licence found | Templates for about 16 countries | ❌ |
| OSM / OpenAddresses | OSM is **ODbL**; OpenAddresses varies by source | - | ❌ at runtime |

**Recommendation: our own "libpostal-style" normaliser in `packages/checks/src/address/` (TS).**

The libpostal idea is to normalise each side into canonical expansions and compare components. Scope:
1. **Normalise (about 150 lines).**
   - NFKC/NFKD with marks stripped, case folding, punctuation (keep `#` and `/`), the No./#/№ number marker.
   - Ordinal words to digits (Fifth → 5th), and `½` handling.
   - Joined German suffixes split off (Rosenstraße → rosen strasse).
2. **Dictionaries (about 600 entries, about 15 KB).**
   - Street types, directionals, unit and level types, and PO-box words for en, de, fr, es, it, nl and pt.
   - Seeded from libpostal and OpenCage (both MIT), checked against Pub 28 by hand.
   - US/CA subdivisions from libaddressinput (CC-BY) or Wikidata (CC0). Reuse `iso3166.ts` and `id-po-box-detection.ts`.
3. **Postal codes (about 120 lines + about 40 KB generated JSON).**
   - Validate with the 180 libaddressinput regexes.
   - Canonical formatting for US (5 or 5+4), CA, GB, NL, IE, BR, JP, PL, PT and SE.
4. **Light parse of OCR lines and free text (about 250 lines).**
   - Template order by country: US/CA/AU put number then street, then city, state and zip. DE/FR/ES/IT/NL put street then number, then zip and city. GB puts the postcode last.
   - Unit before or after the street, and PO box.
5. **Component-wise compare (about 200 lines)**, each component reported as match, partial, mismatch or missing; only reason codes leave the module:
   - country: exact after code normalisation;
   - postcode: canonical exact;
   - house number: exact after normalisation;
   - street: Jaro-Winkler ≥ 0.92 after type and directional canonicalisation, type position free;
   - unit: exact; present on one side only = partial;
   - city: Jaro-Winkler ≥ 0.90 or a known alias;
   - subdivision: code or name, plus a ZIP-prefix ↔ state consistency signal.

**Estimate:** about 900–1,200 lines of TS, about 1,500 lines of tests and about 55 KB of committed generated data. It replaces the 12-word `ADDRESS_WORDS` map.

**Fallback:** none permissive with global coverage. US-only `usaddress` 0.5.16 in the vision service is a poor fit.

### 2.4 Partial date-of-birth matching

**Evidence:**
- **ICAO 9303 Part 3, §3.8, VIZ:** "Where a date of birth is completely unknown … with Xs representing unknown elements", and "If only part of the date of birth is unknown, only that part (day, month, year) of the date shall be represented by Xs".
- **ICAO 9303 Part 3, §4.8, MRZ:** dates are `YYMMDD` with no century rule; "If all or part of the date of birth is unknown, the relevant character positions shall be completed with filler characters (<)".
- **OFAC `SDN.CSV`** (2026-10-21, 8,205 DOB / alt. DOB entries): 6,927 full dates, 1,017 year only, 49 month + year, 144 ranges ("1955 to 1957") and 68 "circa".
- **EU FSF XML 1.1** (4,369 `<birthdate>` elements): `circa` (197 true), `year`, `monthOfYear`, `dayOfMonth`, `yearRangeFrom`/`To` (55 ranges) and `calendarType`.
- **Companies House** officers and PSCs publish only `{month, year}` (§5.2).

**Rule set (our own; about 150 lines of TS):**
- **Representation.** Parse each side into `{year, month?, day?, circa?, range?}`. `X`, `<`, `00` and missing parts mean unknown.
- **No evidence is not a mismatch.** An unparseable or absent date returns `not_compared` (C31.2).

| Rule | Condition | Result |
|---|---|---|
| R1 exact | Year, month and day known and equal | `match` |
| R2 precision-limited | Every component known on both sides is equal, the year is known on both, and one side is less precise | `partial_match` with `precision`, at lower confidence. Config decides whether it passes; default: pass for database sources, review for user ↔ document |
| R3 range / circa | The year falls in [Y1, Y2], or within circa Y ± 1 (configurable) | `partial_match` (`approximate`) |
| R4 day/month transposition | Same year, D1 = M2 and M1 = D2, D ≠ M, both ≤ 12 | `transposed`, review |
| R5 single-component typo | Only one component differs, by one digit or by swapped adjacent digits (1987/1978) | `near_match`, fails with a reason |
| R6 two-digit year | Choose the century that gives a date not after today and an age ≤ 120; if both qualify, prefer the younger and flag `century_inferred` | As R1 or R2 |

Only the Gregorian calendar is supported. Today `fieldsAgree('birthdate')` is exact with confusables, so R2–R6 are new.

### 2.5 Policy failures to avoid

- **ODbL-derived data at runtime:** libpostal's default and Senzing models; any OSM extract.
- **Copyleft:** `parse-address` (Perl Artistic/GPL heritage), `Levenshtein` (GPL-2.0+), `nameparser` (LGPL), and Wiktionary or Wikipedia-derived lists, including libpostal's `all/given_names.txt`.
- **Copying:** do not copy USPS Pub 28 tables or the CAAGRI / TNGenWeb nickname pages.
- **Dependency bloat:** `natural`.

### 2.6 Sources

**Repo (read-only):** `packages/checks/src/name-matching.ts` and `.test.ts`, `extraction/agreement.ts`, `government-id/comparison.ts`, `id-po-box-detection.ts`, `mrz.ts` (lines 242–268).

**Registries:**
- npm: https://registry.npmjs.org/{natural,jaro-winkler,talisman,string-similarity-js,fastest-levenshtein,cmpstr,parse-address,addresser,@zerodep%2Faddress-parse,nicknames,nicknames-curated,node-postal}
- PyPI: https://pypi.org/pypi/{rapidfuzz,jellyfish,usaddress,probableparsing,usaddress-scourgify,python-crfsuite,postal,nicknames,nameparser,Levenshtein,yaml-config,rigour}/json

**Licences and data at a ref:**
- https://github.com/rapidfuzz/RapidFuzz/blob/v3.14.6/LICENSE and `.gitmodules`
- https://github.com/taskflow/taskflow/blob/130f7952469c01eef8d7b635710bf9a8043f3172/LICENSE
- https://codeberg.org/jpt/jellyfish/raw/tag/v1.2.1/LICENSE
- https://github.com/komed3/cmpstr/blob/8eac81f03c1f0eb1094053c94fb2b001def92b40/LICENSE
- https://github.com/Yomguithereal/talisman/blob/3fcb2e323bcd27dbb4d1fd12872202b3bdfcbfd7/LICENSE.txt
- https://github.com/NaturalNode/natural/blob/master/LICENSE.txt
- https://github.com/carltonnorthern/nicknames/blob/ed160b3af2d17e1af8ebd570f10a10e4dade4ff4/License.txt, plus `README.md`, `CHANGELOG.md`, `names.csv` and `js/package.json`
- https://github.com/onyxrev/common_nickname_csv/tree/b28d65b89d92c24b6c89bd0efc035b3d77fc1f39
- https://github.com/openvenues/libpostal/blob/25099c506612b34b23b1bfe286ca6321fcf06f35/LICENSE, plus `README.md` (Training data, Data files, Senzing), `src/libpostal_data.in` and `resources/dictionaries/README.md`
- https://github.com/openvenues/libpostal/releases/tag/v1.0.0
- https://github.com/Senzing/libpostal-data
- https://github.com/openvenues/pypostal/blob/master/LICENSE
- https://github.com/openvenues/node-postal/blob/master/LICENSE
- https://github.com/datamade/usaddress/tree/aa7699b53a0843fc443f9e87285b88cbd9eaf50a (`LICENSE`, `raw/LICENSE.md`, `training/`)
- https://github.com/scrapinghub/python-crfsuite/blob/c2eee3267750c585d3ef5eebaf632d3ee7855249/LICENSE.txt
- https://github.com/chokkan/crfsuite/blob/master/COPYING
- https://github.com/chokkan/liblbfgs/blob/master/COPYING
- https://github.com/GreenBuildingRegistry/usaddress-scourgify/blob/cf66bdc42aebc57d48fe41e32e108fdcde347e3c/LICENSE
- https://github.com/hassansin/parse-address/blob/0e09672012c09380cff6c65b4dc52942f63d3394/LICENSE.md
- https://fastapi.metacpan.org/v1/source/TIMB/Geo-StreetAddress-US-1.04/US.pm
- https://github.com/moneals/addresser/tree/d32f89d5226c7e4fcf825978ae51d9b421d6034f
- https://github.com/cdepage/zerodep/blob/e5fff5acabc91d5d78c5e3151d3e927f571fc422/LICENSE.md
- https://github.com/OpenCageData/address-formatting/tree/cbf23487c13ad437cadab0083ef79fe5f1d1823e
- https://github.com/google/libaddressinput/blob/81eb9628382b07d371d8ea0b11badf7de3857fd5/README.md and `testdata/countryinfo.txt`
- https://chromium-i18n.appspot.com/ssl-address/data/GB
- https://github.com/opensanctions/rigour/tree/06573c96205ddab8ac097fa90b6cb6fe07ef80f0

**Provenance and terms:**
- https://www.caagri.org/nicknames.html
- https://ws-dl.blogspot.com/2010/08/lookup-for-nicknames-and-diminutive.html
- https://web.archive.org/web/2010id_/http://www.tngenweb.org/franklin/frannick.htm
- https://www.wikidata.org/wiki/Wikidata:Licensing
- https://en.wiktionary.org/wiki/Wiktionary:Copyrights
- https://wiki.openstreetmap.org/wiki/Wiki_content_license
- https://www.openstreetmap.org/copyright
- Wikidata `wbgetentities` for Q18245781, Q16280537 and Q1130279, and `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P31=Q1130279`
- https://download.geonames.org/export/zip/readme.txt
- https://pe.usps.com/text/pub28/28apc_002.htm
- https://about.usps.com/who/legal/terms-of-use.htm
- https://www.law.cornell.edu/uscode/text/17/105
- https://www.upu.int/UPU/media/upu/documents/PostCode/S42_International-Addressing-Standards.pdf

**Date-of-birth evidence:**
- https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf (§3.8, §4.8)
- https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV
- https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content (the EU publishes the download link with a fixed public `token` query parameter on its Financial Sanctions Files page; omitted here)

**Not verified:** `cmpstr`'s exact Jaro-Winkler parameters; the `yaml-config` licence; SSA terms (403); WDQS counts (rate-limited, so the search API was used instead).

## 3. Phone and email

Checked 2026-10-21. Release-age rule: versions released on or before 2026-10-07. Versions, dates and licences come from the npm registry (`registry.npmjs.org/<name>`) and PyPI JSON. Licence files were read inside the published tarball or wheel, or at the git tag shown. The repo's Node is `>=22.18.0` (root `package.json` engines); local Node is 22.22.1.

Three findings change the plan:
- **Phone line type.** Offline, libphonenumber cannot tell a US or Canadian mobile number from a landline.
- **Carrier data.** No maintained, properly licensed carrier data exists in JS.
- **nodemailer.** New address-parser advisories are fixed only in a release that is 3 days old.

### 3.1 Phone numbers: parsing, validity, type, region

| Candidate | Eco | Version (latest / ≥14-day) | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`libphonenumber-js`** | npm | 1.13.15 / **1.13.14** | 2026-10-08 / 2026-09-24 | MIT (`LICENSE` in the 1.13.14 tarball, © catamphetamine). The tarball also ships `LICENSE.Apache` (Apache-2.0 text) for the metadata derived from Google's. README: "Google's `libphonenumber` is licensed under Apache 2 … this library is licensed under MIT" | ✅ **use** |
| `google-libphonenumber` | npm | 3.2.47 / 3.2.47 | 2026-09-29 | `(MIT AND Apache-2.0)`: an MIT wrapper around libphonenumber 9.0.40 (Apache-2.0). Both texts are in one `LICENSE` file | ✅ fallback |
| `awesome-phonenumber` | npm | 7.8.0 | 2026-02-18 | MIT, plus `LICENSE.libphonenumber` (Apache-2.0). Bundles libphonenumber **9.0.24** | ⚠️ metadata 16 upstream releases behind |
| `libphonenumber-geo-carrier` | npm | 2.0.0 | 2026-03-26 | `"MIT"` in package.json only. The tarball has **no LICENSE file and no Apache-2.0 notice** for the Google carrier data it repackages | ⚠️ not recommended: 13 MB, depends on `bson`, peer-pins libphonenumber-js 1.12.31, 8 stars |
| `phonenumbers` (Python) | PyPI | 9.0.41 / 9.0.40 | 2026-10-08 / 2026-09-24 | Apache-2.0 (`license_expression`) | ⚠️ Only if phone logic ever moves to Python. 2.6 MB wheel with `carrier`, `geocoder` and `timezone`. `phonenumberslite` (473 KB) drops those three |

**Notes**

- **Metadata sets in libphonenumber-js** (sizes from the 1.13.14 tarball; 10.2 MB unpacked across all builds):

  | Set | Size | What it does |
  |---|---|---|
  | `min` (default) | 84 KB | Checks length only, so `isValid()` behaves like `isPossible()` |
  | `max` | 157 KB | Validates the digits; needed for `getType()` |
  | `mobile` | 99 KB | `max` rules for mobile numbers only |

  The README says: "`.getType()` only works when import from 'libphonenumber-js/max'". Types returned: `MOBILE`, `FIXED_LINE`, `FIXED_LINE_OR_MOBILE`, `PREMIUM_RATE`, `TOLL_FREE`, `SHARED_COST`, `VOIP`, `PERSONAL_NUMBER`, `PAGER`, `UAN`, `VOICEMAIL`.
- **Server and flow use different sets.** Use `libphonenumber-js/max` on the server (`packages/checks`). The flow can use `/min` for input formatting.
- **Release cadence.** libphonenumber-js releases match Google's two-weekly metadata releases by date: 1.13.14 and libphonenumber v9.0.40 both came out on 2026-09-24, and 1.13.15 and v9.0.41 both on 2026-10-08. google-libphonenumber lags: 3.2.47 bundles 9.0.40, and it skipped 9.0.36 to 9.0.39.
- **The numbering plan cannot tell US or Canadian mobiles from landlines.** In `PhoneNumberMetadata.xml` @ v9.0.40, the `fixedLine` and `mobile` patterns are identical for US and CA, so `getType()` returns `FIXED_LINE_OR_MOBILE`. The US has no `voip` type at all. So "is this a mobile / is this VoIP" for North America needs a paid lookup adapter such as Twilio Lookup Line Type Intelligence.
- **"Valid" means a valid range, not a working number.** The libphonenumber FAQ: a valid range is one "from which numbers can be freely assigned … Do not rely on libphonenumber to determine whether numbers are currently assigned to a specific user and reachable." Only the OTP proves reachability.
- **Carrier data in JS.**
  - Neither JS port has it. google-libphonenumber lists `PhoneNumberToCarrierMapper` under "Unavailable methods and classes", and libphonenumber-js and awesome-phonenumber have no carrier API.
  - The upstream data is Apache-2.0: `google/libphonenumber/resources/carrier/en/*.txt` @ v9.0.40 is 206 files, 657 KB, each with an Apache-2.0 header.
  - It shows only the *original* carrier. FAQ: in regions with number portability "we return the original carrier for the supplied number."
  - If wanted, build it ourselves: fetch the files at a pinned tag with SHA-256 through `scripts/fetch-*`, do a longest-prefix lookup (about 60 lines), add a NOTICE entry, and ship it as `beta` and informational only. Otherwise use a provider adapter.
- **Region.** Use `phoneNumber.country`, not `isValidNumberForRegion`. The FAQ says to use the latter "Rarely! Many people have phone numbers that do not belong to the country they live in."

**Recommendation:** `libphonenumber-js@1.13.14` (`/max` on the server) in `packages/checks`. Fallback: `google-libphonenumber@3.2.47`. Line type and carrier for NANP numbers, and porting-aware carrier everywhere, ship as an A-tier adapter (Twilio Lookup or similar) with a sandbox provider. If an offline carrier signal is wanted, use our own table built from Google's Apache-2.0 carrier files, marked "original carrier" and `beta`.

### 3.2 Disposable-email domain lists

| Candidate | Eco | Version (latest / ≥14-day) | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **disposable-email-domains/disposable-email-domains**: raw `disposable_email_blocklist.conf` | GitHub data | HEAD `b63df8b` / **`6fcca80`** | 2026-10-19 / 2026-10-07 | **CC0-1.0** (`LICENSE.txt` "CC0 1.0 Universal … Public Domain Dedication"; README "Licensed under CC0"). GitHub's API reports `NOASSERTION` because it does not parse the file | ✅ **use** |
| `disposable-email-domains` (PyPI, D. Ingram) | PyPI | 0.0.284 / 0.0.275 | 2026-10-20 / 2026-10-06 | MIT for the wrapper (wheel `LICENSE.txt`, © 2016 Dustin Ingram); the list itself is CC0 | Not needed (the API is TS) |
| `disposable-email-domains-js` (mziyut) | npm | 1.26.0 | 2026-09-21 | CC0-1.0 (npm metadata, GitHub) | ⚠️ fallback: the same list repackaged. Publishes are irregular (2026-05-07, then 2026-09-21) although the upstream README calls it "updated weekly" |
| `disposable-email-domains` (npm, ivolo) | npm | 1.0.62 | 2022-09-28 | MIT (npm). GitHub reports no licence file | ❌ stale since 2022 |
| `disposable-domains` (tompec) | npm | 2.0.5 / 2.0.1 | 2026-10-19 / 2026-04-13 | MIT. Pulls `lodash`, `validator`, `top-level-domains` | ⚠️ unnecessary dependencies |
| `mailchecker` (FGRibreau) | npm | 6.0.21 | 2026-07-18 | MIT (`LICENSE` © 2013 F.-G. Ribreau) | ⚠️ alternative: `list.txt` has 57,703 lines; its curation rules were not checked |
| `fakefilter` (7c) | npm | 1.1.1703 / 1.1.1689 | daily | BSD-3-Clause (`LICENSE.md` © 2022 7c) | ⚠️ secondary source: automated daily, drops a domain after a year of inactivity; BSD needs an attribution notice |
| wesbos/burner-email-providers | GitHub | HEAD (pushed 2026-07-20) | - | MIT (GitHub) | ⚠️ 27,277 lines. npm `burner-email-providers` is a different, 2021 package (findie) |

**Notes**

- **Size and churn of the recommended list.**
  - Pinned `6fcca80` (2026-10-07): 9,213 domains, 130,453 bytes, sha256 `e3bd73552549f2fef7997b4892909835907f0045742a06d961bc9af8d7380f79`.
  - HEAD `b63df8b` (2026-10-19): 9,913 domains, 143,411 bytes, sha256 `db1f4fcc116e32b2eabc6cd72f196387d0068482d9cb84e44a5de57933ea0f7b`.
  - That is about 700 domains added in 12 days.
- **Update cadence.** 108 commits since 2026-07-23 (about 90 days). A scheduled workflow (`fetch-domains.yml`, cron `0 0 * * *`) scrapes provider pages daily and opens PRs.
- **Contribution rule.** Contributors must show a screenshot that the domain issues disposable addresses.
- **The upstream allowlist is gone.** `allowlist.conf` was removed on 2026-04-12 (commit `0bccfe34e0`, "remove allowlist and the attached logic"). OpenVerify needs its own per-organization allowlist override.
- **Matching rule.** Match the registrable domain and walk up the parents (`a.b.example.com` → `b.example.com` → `example.com`). The README says `@xxx.yyy.zzz` should match `yyy.zzz` where `zzz` is a public suffix.

**Recommendation:** Do not take a package. Add the raw file to a `scripts/fetch-*` manifest pinned by commit and SHA-256 (start with `6fcca80`, which is past 14 days), bake it into the API image, and parse it into a `Set` at startup (about 140 KB).

Add an optional refresh job, off by default. A BullMQ repeatable job would fetch `main` and validate it:
- line format;
- size between 5,000 and 50,000 lines;
- no more than ±15% change from the pinned list.

It would then store the list with its commit and SHA-256, and record which list each check used. Add org-level allow and deny overrides. Fallback: `disposable-email-domains-js@1.26.0` (CC0). If a second source is wanted, add `fakefilter`'s txt list (BSD-3, NOTICE entry).

### 3.3 Email syntax and MX lookup

- **Syntax.** Use the WHATWG HTML "valid email address", which the spec itself calls "a willful violation of RFC 5322":
  - ABNF: `email = 1*( atext / "." ) "@" label *( "." label )`, label ≤ 63.
  - Regex: ``/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/``.

  Then add the RFC 5321 §4.5.3.1 limits:
  - local part ≤ 64 octets;
  - domain ≤ 255 octets;
  - path ≤ 256 octets.

  Also require at least one dot in the domain for deliverable addresses. Convert an IDN domain with `url.domainToASCII()` first (tested: `bücher.de` → `xn--bcher-kva.de`). Internationalised (SMTPUTF8) local parts are rejected, which is a documented limit.
- **Validation also protects nodemailer.** The pattern rejects `"`, `<`, `>`, `(`, `)`, `;`, `,` and whitespace, which are the characters behind the 2026-10-19 nodemailer address-parser advisories (§3.4).
- **MX lookup with `node:dns/promises`.**
  - Use a dedicated `new Resolver({ timeout: 3000, tries: 2 })`. Node 22 documents the options `timeout` (ms, `-1` = default), `tries` (default 4) and `maxTimeout`.
  - `resolve*()` "always perform a DNS query on the network … does not use libuv's threadpool", unlike `lookup()`.
  - `resolveMx(hostname)` returns `[{ priority, exchange }]` and takes no options, so it exposes no TTLs. Cache in Valkey with fixed TTLs: 1 h positive, 5 min negative.
- **Outcomes, tested on Node 22.22.1:**

  | Result | Meaning | Check outcome |
  |---|---|---|
  | `example.com` → `[{"exchange":"","priority":0}]` | **Null MX**: RFC 7505 §3, preference 0 and the zero-length label `"."` | The domain "does not accept email": fail |
  | `ENODATA` (e.g. `github.io`) | No MX record | Apply the RFC 5321 §5.1 implicit MX: query `resolve4`/`resolve6` on the domain itself. "If an empty list of MXs is returned, the address is treated as if it was associated with an implicit MX RR" |
  | `ENOTFOUND` (NXDOMAIN) | Domain does not exist | Fail. §5.1: "MUST be reported as an error" |
  | `ETIMEOUT` / `ESERVFAIL` / `ECONNREFUSED` | Transient | `unknown` or retry, **never pass** (rule 5) |

- **No SMTP probing.** Do not probe with `RCPT TO`: it is unreliable and abusive to third parties. Only the OTP proves the mailbox.

### 3.4 Sending: email and SMS adapters

| Candidate | Eco | Version (latest / ≥14-day) | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`nodemailer`** (already in `apps/api`, 10.0.15) | npm | 10.2.0 / 10.0.16 | 2026-10-21 / 2026-10-07 | **MIT-0** (npm). Owner confirmation of MIT-0 is already pending (THIRD_PARTY_LICENSES §2.1.1) | ✅ keep, with the advisory caveat below |
| `twilio` | npm | 6.2.0 / 6.1.2 | 2026-10-12 / 2026-09-28 | MIT (`LICENSE` @ 6.1.2) | ❌ Not needed: 16.6 MB unpacked, pulls `axios`, `jsonwebtoken`, `dayjs`, `qs`, `xmlbuilder`, `https-proxy-agent`, `scmp` |
| `@aws-sdk/client-sns` | npm | 3.1155.0 / 3.1147.0 | 2026-10-21 / 2026-10-06 | Apache-2.0 | Optional AWS adapter (shares `@smithy/*` with the `client-s3` already in use) |
| `@aws-sdk/client-pinpoint-sms-voice-v2` (End User Messaging SMS) | npm | 3.1155.0 / 3.1147.0 | 2026-10-06 (3.1147.0) | Apache-2.0 | Optional alternative to SNS (2.1 MB) |

- **nodemailer advisories** (re-checked against the GitHub advisory API).
  - GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h (medium, published 2026-10-19) affect `>= 3.0.0, < 10.1.4`. They are recipient confusion in `addressparser`; for example `<"a@evil.com>"@good.com>` was delivered to `evil.com`. They are **fixed only in 10.1.4 (2026-10-18), 3 days old.**
  - The repo's 10.0.15 is already past the older high-severity issue (GHSA-4ffr-jq9g-5ffx, fixed in 10.0.13).
  - Mitigation until 10.1.4 passes 14 days (2026-11-01): pass only addresses that passed the §3.3 WHATWG check, which excludes every trigger character, and pass them as `{ address }` objects. Bump to ≥ 10.1.4 on or after 2026-11-01.
- **No SMS SDK is needed.** Each provider is one HTTPS call through the existing `undici` (7.30.1, MIT):
  - **Twilio Messaging:** `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, `application/x-www-form-urlencoded`, `To` + (`From` | `MessagingServiceSid`) + `Body`, HTTP Basic (API key and secret, or Account SID and Auth Token).
  - **Twilio Verify** (Twilio generates and checks the code): `POST https://verify.twilio.com/v2/Services/{ServiceSid}/Verifications` (`To`, `Channel` = `sms` | `call` | `email` | …), then `…/VerificationCheck` (`Code`, plus `To` or `VerificationSid`). The SID is deleted once expired "(after 10 minutes)". `CodeLength` is 4–10.
  - **Vonage SMS API:** `POST https://rest.nexmo.com/sms/json`, form-encoded `from`, `to`, `text`. Basic auth, or a signed `sig` with MD5, SHA1, SHA-256 or SHA-512 HMAC over the sorted `&key=value` string.
  - **Plivo:** `POST https://api.plivo.com/v1/Account/{auth_id}/Message/`, JSON `src` | `powerpack_uuid`, `dst`, `text`, Basic `auth_id:auth_token`.
  - **AWS:** SNS `Publish` (`PhoneNumber`) or End User Messaging SMS `SendTextMessage`. Both need SigV4, so use the SDK client. SNS SMS is now delivered by AWS End User Messaging SMS.
- **Delivery-status webhooks are optional; leave them out of Phase 5.** The code entry is the proof, so delivery receipts are not needed. If added later:
  - Twilio signs with **HMAC-SHA1 keyed by the Auth Token** over `url + Σ sorted(key + value)`, base64 (twilio-node 6.1.2 `getExpectedTwilioSignature`, compared with `scmp`, with and without the port). JSON bodies add a `bodySHA256` query parameter. Twilio's guide says "Don't implement your own signature validation", although the algorithm is about 25 lines.
  - Plivo V2 signs with HMAC-SHA256(Auth Token, URL + nonce).
- **Development and tests.**
  - Email goes to **Mailpit** through the existing `createMailer`. The e2e helper already reads `GET /api/v1/search?query=to:"…"` and `GET /api/v1/message/<id>`.
  - Mailpit has no SMS feature. Add an `sms:mailpit` dev adapter that delivers the SMS text as an email to `<e164-digits>@sms.mailpit.test`, so e2e tests read SMS codes the same way. Add a `log` adapter that logs only a redacted destination and never the code.
  - A deterministic **sandbox provider** accepts a fixed code in sandbox environments only. It follows the existing `providers/sandbox.ts` pattern, where a sandbox binding refuses to start in production.

### 3.5 OTP specification (phone OTP and email OTP)

**Standards basis**

- **OWASP ASVS 5.0.0** (released 2025-05-30, tag `v5.0.0_release` @ `5cf9b03`), V6 Authentication. In 4.0.3 these were V2.7 (out-of-band verifier) and V2.8 (one-time verifier).

  | Requirement | Text (paraphrased) |
  |---|---|
  | 6.5.1 | OOB codes "only successfully usable once" |
  | 6.5.3 | Generated with a CSPRNG |
  | 6.5.4 | "minimum of 20 bits of entropy (typically … 6 random digits is sufficient)" |
  | 6.5.5 | "Out of band requests must have a maximum lifetime of 10 minutes" |
  | 6.6.1 | PSTN/SMS OTP only for a previously validated number, with stronger alternatives offered |
  | 6.6.2 | Codes "bound to the original authentication request … not usable for a previous or subsequent one" |
  | 6.6.3 | Code-based OOB "protected against brute force attacks by using rate limiting" |
  | 6.3.6 | Email is not used as an authentication factor (L3) |

  ASVS 4.0.3 2.7.5 ("retains only a hashed version of the authentication code") was **deleted in 5.0.0 as "INSUFFICIENT IMPACT"** (`5.0/mappings/mapping_v4.0.3_to_v5.0.0.yml`).
- **NIST SP 800-63B-4** (final, July 2025; supersedes SP 800-63B of 2017/2020). The PLAN's "§5.1.3" is the Rev 3 numbering; Rev 4 moved it to §3.1.3.
  - **§3.1.3.2 Out-of-Band Verifiers:**
    - secrets "at least six decimal digits … using an approved random bit generator";
    - "the authentication SHALL be considered invalid unless completed within 10 minutes";
    - accepted "only once during the validity period";
    - below 64 bits, rate limiting is required, and "Generating a new authentication secret SHALL NOT reset the failed authentication count".
  - **§3.1.3.1:** "Email SHALL NOT be used for out-of-band authentication", but "Confirmation codes that are sent to validate email addresses … are not authentication processes and not affected by the above prohibition."
  - **§3.1.3.3:** "Use of the PSTN for out-of-band verification is restricted". Verifiers "SHOULD consider risk indicators (e.g., device swap, SIM change, number porting …)".
  - **§3.2.2:** consecutive failures limited to "no more than 100" (an upper bound).
  - **§3.2.9:** PSTN is the one restricted authenticator.
  - Rev 3 §5.1.3.1 additionally excluded "voice-over-IP (VOIP) or email".
- **Our use is contact verification, not authentication.** We still apply the authenticator mechanics.

**Spec**

1. **Generate** `crypto.randomInt(0, 1_000_000)` and zero-pad it to 6 digits. Node's `randomInt` draws from `randomFillSync`/`randomFill` and "avoids modulo bias".
2. **Store** only `HMAC-SHA-256(K_otp, verificationId ‖ channel ‖ normalisedDestination ‖ code)`. Compare with `crypto.timingSafeEqual`.
   - A plain or salted hash of a 6-digit code falls to enumerating 10⁶ values; only a keyed HMAC protects it at rest.
   - Derive `K_otp` from the KEK with HKDF (info `openverify/otp/v1`) or take a dedicated secret. A KEK rotation then only voids codes that are at most 10 minutes old.
   - Encrypt the destination with the `encrypted` column helper. Key rate limits on a blind index (HMAC of the E.164 number or lower-cased email).
3. **Lifetime:** 10 minutes by default, configurable lower and never higher.
4. **Single use:** consume atomically on success, inside the verification lock.
5. **Binding:** a code is valid only for its verification, channel and destination. Changing the destination voids it.
6. **Attempts:** 5 wrong entries void the code. Allow at most 10 failed entries per verification across resends, because a new code does not reset the count (NIST). Then mark the verification `failed`. The user can start a new verification within the template's max attempts.
7. **Resend rules:**
   - a new code voids the previous one;
   - cooldowns of 30 s, 60 s, 120 s and so on;
   - at most 5 sends per verification;
   - per destination at most 5 per hour and 10 per day;
   - per inquiry and per client IP limits, enforced with the existing C12 GCRA limiter in Valkey.
8. **Toll fraud and SMS pumping.** Twilio: attackers trigger OTPs to number ranges for a revenue share; the sign is "a spike of messages sent to a block of adjacent numbers" and "you will likely not see a completed verification cycle". OWASP API4:2023 says to rate limit and to "Configure spending limits for all service providers".
   - Require `isValid()` with `max` metadata.
   - Refuse `PREMIUM_RATE`, `SHARED_COST`, `TOLL_FREE`, `UAN`, `PAGER` and `VOICEMAIL`. `VOIP` is a configurable deny.
   - Keep a per-template country allowlist for SMS, empty meaning SMS is off.
   - Keep a per-prefix velocity counter (the first 6–8 E.164 digits) and an alert on low send-to-verify conversion.
   - Send only after consent and an active flow session.
9. **Message:** the code, the operator's display name and "do not share". The last line uses the origin-bound format `@<flow-host> #<code>` (WICG draft community report) for autofill and phishing resistance. No PII in the text.
10. **Logging:** never log the code. Redact destinations in pino. Events carry the verification id only.
11. **Honesty:** provider errors and timeouts give `errored` or a retry, never `passed`. The phone `beta` signals (line type, carrier) are separate checks with a confidence score.

**Recommendation:** Generate, store and verify codes ourselves, behind a small `MessageSender` port (`email:smtp`, `sms:twilio`, `sms:vonage`, `sms:plivo`, `sms:aws`, `sms:mailpit` for development, `sandbox`). Fallback: a `twilio-verify` mode in which Twilio generates and checks the code. In that mode OpenVerify stores no code but still enforces items 6–8.

### 3.6 Sources

- npm registry: https://registry.npmjs.org/libphonenumber-js, …/google-libphonenumber, …/awesome-phonenumber, …/libphonenumber-geo-carrier, …/twilio, …/nodemailer, …/disposable-email-domains, …/disposable-email-domains-js, …/disposable-domains, …/mailchecker, …/fakefilter, …/burner-email-providers, …/@aws-sdk/client-sns, …/@aws-sdk/client-pinpoint-sms-voice-v2. Tarballs inspected: libphonenumber-js 1.13.14, google-libphonenumber 3.2.47, awesome-phonenumber 7.8.0, libphonenumber-geo-carrier 2.0.0.
- PyPI JSON: https://pypi.org/pypi/phonenumbers/json, https://pypi.org/pypi/phonenumberslite/json, https://pypi.org/pypi/disposable-email-domains/json (0.0.275 wheel inspected)
- libphonenumber: https://github.com/google/libphonenumber/blob/master/FAQ.md ; https://github.com/google/libphonenumber/tree/v9.0.40/resources/carrier/en ; https://github.com/google/libphonenumber/blob/v9.0.40/resources/PhoneNumberMetadata.xml ; releases https://github.com/google/libphonenumber/releases
- google-libphonenumber commits: https://github.com/ruimarinho/google-libphonenumber/commits (2f86594 "Update libphonenumber@9.0.40")
- python-phonenumbers README: https://github.com/daviddrysdale/python-phonenumbers
- Disposable list: https://github.com/disposable-email-domains/disposable-email-domains (LICENSE.txt, README, `.github/workflows/fetch-domains.yml` @ b63df8b; allowlist removal https://github.com/disposable-email-domains/disposable-email-domains/commit/0bccfe34e0); https://github.com/mziyut/disposable-email-domains-js ; https://github.com/7c/fakefilter ; https://github.com/FGRibreau/mailchecker ; https://github.com/wesbos/burner-email-providers ; https://github.com/ivolo/disposable-email-domains ; https://github.com/tompec/disposable-email-domains
- Node 22 docs: https://nodejs.org/docs/latest-v22.x/api/dns.html ; https://nodejs.org/docs/latest-v22.x/api/crypto.html ; https://github.com/nodejs/node/blob/v22.22.1/lib/internal/crypto/random.js
- RFC 7505: https://www.rfc-editor.org/rfc/rfc7505 ; RFC 5321 §4.5.3.1 and §5.1: https://www.rfc-editor.org/rfc/rfc5321
- WHATWG valid email address: https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
- nodemailer: https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md ; advisories https://github.com/nodemailer/nodemailer/security/advisories/GHSA-85x2-q946-cp5h , …/GHSA-m943-m63m-w62w , …/GHSA-8c8m-p3m8-cjg8 , …/GHSA-4ffr-jq9g-5ffx (also https://api.github.com/repos/nodemailer/nodemailer/security-advisories)
- Twilio: https://www.twilio.com/docs/messaging/api/message-resource ; https://www.twilio.com/docs/verify/api/verification ; https://www.twilio.com/docs/verify/api/verification-check ; https://www.twilio.com/docs/verify/api/service ; https://www.twilio.com/docs/usage/webhooks/webhooks-security ; https://github.com/twilio/twilio-node/blob/6.1.2/src/webhooks/webhooks.ts ; https://www.twilio.com/docs/glossary/what-is-sms-pumping-fraud ; https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence ; https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- Vonage: https://developer.vonage.com/en/api/sms ; https://developer.vonage.com/en/getting-started/concepts/signing-messages
- Plivo: https://www.plivo.com/docs/messaging/api/message/send-a-message ; https://www.plivo.com/docs/messaging/concepts/signature-validation
- AWS: https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-phone-number-as-subscriber.html ; https://docs.aws.amazon.com/sns/latest/api/API_Publish.html ; https://docs.aws.amazon.com/pinpoint/latest/apireference_smsvoicev2/API_SendTextMessage.html
- Mailpit API: https://mailpit.axllent.org/docs/api-v1/
- OWASP ASVS 5.0.0 V6: https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x15-V6-Authentication.md ; 4.0.3 V2: https://github.com/OWASP/ASVS/blob/v4.0.3_release/4.0/en/0x11-V2-Authentication.md ; mapping: https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/mappings/mapping_v4.0.3_to_v5.0.0.yml
- OWASP API4:2023: https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b/authenticators/ ; status https://csrc.nist.gov/pubs/sp/800/63/b/4/final ; Rev 3 https://pages.nist.gov/800-63-3/sp800-63b.html
- WICG origin-bound one-time codes: https://wicg.github.io/sms-one-time-codes/
- Gmail sender requirements: https://support.google.com/a/answer/81126

## 4. Crypto wallets

Read on 2026-10-21 from the npm registry JSON (`https://registry.npmjs.org/<name>`), LICENSE files at the tagged commit, the spec sources and the OFAC SDN CSV. Release-age cutoff: on or before 2026-10-07. Versions, dates and licences of the recommended packages, and the BIP-322 status, were re-checked independently.

### 4.1 Libraries

| Candidate | Eco | Version (latest / newest ≥14 d) | Released | License (verified) | Verdict |
|---|---|---|---|---|---|
| **`@noble/curves`** | npm | 2.4.0 / same | 2026-08-27 | MIT: npm, and LICENSE @ tag 2.4.0 = `656c436` (equals npm `gitHead`) | ✅ **use** (note 1) |
| **`@noble/hashes`** | npm | 2.4.0 / same | 2026-08-27 | MIT: LICENSE @ `663c2ae` | ✅ **use** (note 2) |
| **`@scure/base`** | npm | 2.4.0 / same | 2026-08-28 | MIT: LICENSE @ `d93da4f` | ✅ **use** (note 3) |
| **`@scure/btc-signer`** | npm | 2.4.1 / same | 2026-08-29 | MIT: LICENSE @ `373d2f3`. Its extra dependency `micro-packed` 0.11.1 is also MIT | ✅ **use, for Bitcoin only** (note 4) |
| `micro-eth-signer` | npm | 0.20.1 / same | 2026-08-29 | MIT: LICENSE @ `f593820` | ⚠️ Not needed at runtime. Possible dev cross-oracle (note 5) |
| `viem` | npm | 2.57.8 (2026-10-21) / **2.57.3** (2026-10-04) | see versions | MIT: LICENSE @ tag `viem@2.57.3`. GitHub's licence detector says NOASSERTION, but the file is MIT. All transitive dependencies are MIT | ⚠️ Fallback, only inside the ERC-1271/ERC-6492 RPC adapter (note 6) |
| `ethers` | npm | 6.17.0 / same | 2026-06-18 | MIT. Transitive `tslib` 2.7.0 is **0BSD**, already an owner-to-confirm item in THIRD_PARTY_LICENSES | ❌ Not recommended (note 7) |
| `siwe` (+ `@spruceid/siwe-parser`) | npm | 3.0.0 / same | 2025-01-21 | Apache-2.0 on npm; the repo carries both LICENSE-APACHE and LICENSE-MIT. Parser dependencies: `apg-js` (BSD-2-Clause), `@noble/hashes` ^1, `@stablelib/random` (MIT) | ⚠️ Not recommended (note 8) |
| `bip322-js` | npm | 4.0.0 / same | 2026-08-21 | MIT: LICENSE @ `b9cc205`. Transitive **`fast-sha256` 1.3.0 is Unlicense**, which rule 4 does not name | ⚠️ Dev oracle only, and only if the owner accepts Unlicense (note 9) |
| `bitcoinjs-lib` | npm | 7.0.4 (2026-10-13) / 7.0.2 (2026-09-07) | see versions | MIT | Not needed. It has no message signing |
| `bitcoinjs-message` | npm | 2.2.0 / same | 2021-01-28 | MIT, but it depends on `secp256k1` ^3.0.1, which has a native **install script** (`npm run rebuild …`, `gypfile: true`) | ❌ Stale (repo last pushed 2024-02), and the install script runs into our pnpm `allowBuilds` policy |
| `tweetnacl` | npm | 1.0.3 / same | 2020-02-10 | **Unlicense** | ❌ Not needed: `@noble/curves` has ed25519. Unlicense is not in rule 4 |
| `bs58` / `bs58check` | npm | 6.0.0 / 4.0.0 | 2024-06 | MIT (`base-x` MIT; bs58check pulls `@noble/hashes` ^1) | Not needed: covered by `@scure/base` |
| `bech32` | npm | 2.0.0 | 2021-02-15 | MIT, no dependencies | Not needed. Stale |
| `ethereum-cryptography` | npm | 3.2.0 | 2025-04-25 | MIT | Not needed: it only re-exports noble v1 |
| `@solana/web3.js` / `@solana/kit` | npm | 3.1.1 / 3.0.2; kit 8.5.0 / 8.4.0 | 2026-10-19 / 2026-10-07; 2026-10-13 / 2026-09-28 | MIT | ❌ Not needed: base58 plus ed25519 is enough (note 10) |
| `bitcoin-address-validation` | npm | 4.0.0 / same | 2026-09-18 | MIT (its dependencies `bech32`, `base58-js` and `sha256-uint8array` are MIT) | ✅ Optional dev cross-oracle for BTC addresses (p2pkh, p2sh, p2wpkh, p2wsh, p2tr) |
| `multicoin-address-validator` | npm | 0.5.26 | 2025-06-04 | MIT | ❌ Nine odd dependencies (`browserify-bignum`, `bundle`, `cbor-js`, …), 890 KB |
| `tiny-secp256k1` / `secp256k1` | npm | 2.2.4 / 5.0.2 | 2025-06 / 2026-08 | MIT | Not needed. `secp256k1` has a `node-gyp-build` install script (❌ under `allowBuilds`). `tiny-secp256k1` is WASM with no script |

Package notes:
1. **`@noble/curves`:**
   - 1.59 MB unpacked, 72 files. ESM-only (`type: module`, no `require` export), Node ≥20.19.0 (Node 22 is fine).
   - No install scripts. npm provenance attestation present.
   - Its only dependency is `@noble/hashes`, pinned at exactly 2.4.0.
   - Audits listed in the README at 2.4.0:
     - Trail of Bits, v0.7.3, 2023-01 (PDF in the repo);
     - Kudelski, v1.2.0, 2023-09;
     - Cure53, v1.6.0, 2024-09. Its scope was ed25519/ed448, BLS, bn254 and hash-to-curve, so **not secp256k1**;
     - Trail of Bits, v2.3.0, 2026-08, scope "everything". This one is stated in the README only; there is no PDF in `audit/` at 2.4.0.
   - API gotchas we must code around:
     - v2 `recoverPublicKey` and `verify` **hash with SHA-256 by default**. Pass `{prehash:false}` with our own keccak or double-SHA-256 digest.
     - The `'recovered'` signature layout is **`[recid, r, s]`**, so Ethereum's `r‖s‖v` must be reordered.
     - Recovery does **not** check low-s. Use `Signature.hasHighS()` if we want to.
     - `ed25519.verify` defaults to ZIP-215. Pass `{zip215:false}` for strict RFC 8032.
2. **`@noble/hashes`:** 692 KB, no dependencies, ESM-only. Subpaths: `sha2.js`, `sha3.js` (`keccak_256`), `legacy.js` (`ripemd160`), `blake2.js`. Cure53 audited v1.0.0 (2022-01); the scope excluded blake3, sha3-addons, sha1 and argon2, so keccak, sha256 and ripemd160 were in scope.
3. **`@scure/base`:** 145 KB, no dependencies.
   - Provides `base58`, `base58xrp`, `base58xmr`, `createBase58check(sha256)`, and `bech32`/`bech32m` with a `limit` argument (90 by default; it can be raised, or set to `false` for Cardano).
   - Audits: Cure53 at v1.0.0 (2022-01); self-audit at 2.2.0 (2026-04).
   - Its README warns that base58 is O(n²): cap the input length before decoding.
4. **`@scure/btc-signer`:**
   - 1.12 MB. Dependencies: `@scure/base`, `micro-packed`, and `@noble/*` 2.4.0, the same set as above.
   - Audits: Cure53 at v0.3.0 (2023-02); self-audit at 2.2.0.
   - Useful pieces:
     - `Address(network).decode()` with custom network params (works for LTC);
     - `Transaction` accepts version 0;
     - public `preimageWitnessV0` and `preimageWitnessV1` (BIP-143 and BIP-341 sighash).
   - **It has no message-signing API** (no BIP-137 or BIP-322 verify). It only carries BIP-322 PSBT metadata.
5. **`micro-eth-signer`:** 3.07 MB. Same noble 2.4.0 stack plus `@noble/ciphers`. It has `eip191Signer` and `addr.isValid`/`addChecksum`; `addr.isValid` also returns true for non-checksummed addresses. It has no audit of its own.
6. **`viem`:**
   - 27.9 MB unpacked. Its dependencies (`ox` 0.14.45, `ws`, `isows`, `abitype`, `@scure/bip32` 1.7.0, `@scure/bip39` 1.6.0, `@noble/curves` 1.9.1, `@noble/hashes` 1.8.0) bring in a **second noble major line**.
   - It has `verifyMessage` (ERC-1271 and ERC-6492 through a public client) and `viem/siwe` (`parseSiweMessage`, `validateSiweMessage`, `verifySiweMessage`).
   - It releases almost daily, so always pin a version at least 14 days old.
7. **`ethers`:** 13 MB, old noble (curves 1.2.0), and `@types/node` and `tslib` as runtime dependencies.
8. **`siwe`:** it has a **peer dependency on `ethers` ^5.6.8 || ^6.0.8**. The repo was last pushed 2025-05-30.
9. **`bip322-js`:**
   - CommonJS, 158 KB.
   - Dependencies: `@bitcoinerlab/secp256k1` ^1.2.0 (MIT, wraps noble v1), `@noble/*` ^2.3, `bitcoinjs-lib` ^7, `ecpair` ^3, and `fast-sha256` (Unlicense).
   - Supports P2PKH, P2SH-P2WPKH, P2WPKH and single-key P2TR.
   - "Loose" BIP-137 verification is **on by default**.
   - **It does not handle the `smp`/`ful`/`pof` prefixes** that BIP-322 gained on 2026-04-20: there is no `smp` string in the 4.0.0 dist, so it would reject the official prefixed test vectors.
10. **Solana packages:** web3.js is 13 MB, kit is 3.9 MB across 27 sub-packages, and `@solana/errors` brings `chalk`, `commander` and a CLI binary. If wallets return offchain-message v1 envelopes, `@solana/offchain-messages` 8.4.0 (MIT) is an optional later addition.

### 4.2 Address validity per chain

Priority comes from the OFAC SDN CSV of 2026-10-20, counting "Digital Currency Address - …" entries: XBT 262, ETH 87, TRX 87, USDT 43, LTC 8, XMR 6, DASH 5, ZEC 3, BCH 2, USDC 2, SOL 2, DOGE 2, and BTG/ETC/XVG/BNB 1 each. USDT and USDC live on the ETH and TRON address formats. This also tells Phase 6's crypto watchlist which tickers to map.

| Chain | Rule | Spec / source |
|---|---|---|
| **Bitcoin legacy** | Base58check (checksum = first 4 bytes of double SHA-256). 21-byte payload: version + HASH160. P2PKH `0x00` ("1"), P2SH `0x05` ("3"); testnet `0x6f` (m/n) and `0xc4` ("2") | Bitcoin Core `src/kernel/chainparams.cpp` @ 44997c3 |
| **Bitcoin segwit** | HRP `bc`/`tb` (`bcrt` regtest). Witness version 0..16. Program 2..40 bytes; **v0 must be 20 or 32 bytes**; v1 Taproot is 32 bytes. **Bech32 for v0, bech32m (const 0x2bc830a3) for v1+.** At most 90 characters. Reject mixed case | BIP-173 (Deployed), BIP-350 (Deployed) |
| Bitcoin silent payments | HRP `sp`/`tsp` (BIP-352). Not an on-chain address | Treat as unsupported for ownership proof |
| **EVM (ETH, BSC, Polygon, Base, Avalanche C-chain…)** | `0x` + 40 hex digits. EIP-55: **keccak-256 (not SHA3-256)** of the lowercase hex ASCII, then uppercase each letter whose hash nibble is ≥8. All-lower and all-upper are valid but carry **no checksum**: flag them, don't fail them. The same address works on every EVM chain, so the chain comes from SIWE `Chain ID` | EIP-55 (Final; 8 test cases in the spec) |
| **TRON** | 21 bytes = `0x41` + last 20 bytes of keccak-256(X‖Y). Base58check, double SHA-256, 34 characters starting "T" | developers.tron.network/docs/account; TronWeb `src/utils/crypto.ts` `isAddressValid` @ 974ea0b |
| **Litecoin** | P2PKH `0x30` ("L"); P2SH `0x32` ("M") and legacy `0x05` ("3", **ambiguous with BTC**); testnet 111/196/58. Bech32 HRP `ltc`/`tltc`/`rltc`. MWEB `ltcmweb` stealth addresses are out of scope | litecoin `chainparams.cpp` @ ec1b648 |
| **Solana** | Base58 (Bitcoin alphabet), 32..44 characters, must decode to **exactly 32 bytes**. **There is no checksum**, so this is a format check only. On-curve means an ed25519 key that can sign. **Off-curve means a PDA, "no private key exists", so it cannot prove ownership** | solana.com/docs/core/accounts, /docs/core/pda; kit `addresses/src/address.ts` |
| **XRP** | Ripple alphabet `rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz`, type prefix `0x00` ("r"), double SHA-256 4-byte checksum, 25–35 characters. X-addresses (X…/T…) are optional | xrpl.org/docs/concepts/accounts/addresses (`@scure/base` `base58xrp`) |
| Dogecoin | Base58check `0x1e` ("D"), P2SH `0x16`. No segwit | dogecoin `chainparams.cpp` |
| Bitcoin Cash | CashAddr `bitcoincash:`/`bchtest:`, 40-bit BCH-code checksum, reject mixed case, version byte gives type and hash size | bitcoincash.org `spec/cashaddr.md` |
| Cardano | Bech32 `addr`/`addr_test`/`stake`. "Cardano does not impose a length limit", so use `limit:false`. Header nibbles carry type and network | CIP-19, CIP-5 |
| Cosmos | Bech32 `cosmos1…`, 20-byte (or 32-byte module) addresses | cosmos-sdk ADR-028 |
| Polkadot / Kusama | SS58: base58 of prefix + key + 2-byte checksum = blake2b-512("SS58PRE"‖data). Prefixes 0 / 2 / 42 (generic) | polkadot-sdk `primitives/core/src/crypto.rs` @ 298bf2c; wiki.polkadot.com |
| TON | 36 bytes (flags, workchain, 32-byte id, CRC16), 48 characters base64 or base64url. Raw form `wc:hex` | docs.ton.org/foundations/addresses/formats |
| Monero / Zcash / Dash | Monero uses `base58xmr`. Format checks only if wanted; ownership proof is out of scope | — |

**Suggested default chain set:** BTC, EVM, TRON, LTC, SOL, XRP and DOGE, all with real checksums except SOL. BCH, ADA, ATOM, DOT and TON come later.

### 4.3 Ownership proof by signed challenge

| Scheme | Chains | Spec (status) | What is signed / how it is verified | Library |
|---|---|---|---|---|
| **EIP-191 `personal_sign`** | EVM | EIP-191 (Final) | `keccak256("\x19Ethereum Signed Message:\n" + decimal byte length + message)`. 65-byte `r‖s‖v`, with v 27/28 (accept 0/1 too). Recover, then address = last 20 bytes of keccak(uncompressed pubkey without 0x04). EIP-2 low-s binds **transactions only**; "ecrecover … will keep accepting high s-values". The nonce is single-use, so accept high-s and record a flag | noble `secp256k1.recoverPublicKey([recid,r,s], digest, {prehash:false})` + `keccak_256` |
| **EIP-4361 SIWE** | EVM | EIP-4361 (Final, requires 55/155/191/1271) | ABNF message (note 1). Verify that domain, URI and chain-id match the server's expectation, the nonce equals the stored single-use nonce, the time window holds and the address matches; then EIP-191 recovery | Own strict parser |
| **ERC-1271** | EVM smart accounts | ERC-1271 (Final) | `eth_call isValidSignature(bytes32,bytes)` must return `0x1626ba7e`. SIWE says ERC-1271 "SHOULD be used", resolved on the message's chain-id. **Needs an RPC, so adapter only** | `undici` eth_call (own ABI encoding) or viem |
| **ERC-6492** | Undeployed (counterfactual) smart accounts | ERC-6492 (Final) | Signature ends in `0x6492…6492` (32 bytes); verify by deployless `eth_call`. **RPC, adapter only** | viem `verifyMessage` |
| **BIP-137** | BTC/LTC legacy | BIP-137 (Deployed) | Double SHA-256 of `"\x18Bitcoin Signed Message:\n" + varint(len) + msg`. Base64 of 65 bytes: header, r, s. Header ranges: 27–30 P2PKH uncompressed, 31–34 P2PKH compressed, 35–38 P2SH-P2WPKH, 39–42 P2WPKH; recid = header − base. Wallets disagree (note 2) | Own (~80 lines) on noble |
| **BIP-322** | BTC (any script) | BIP-322 (**Complete**; last change 2026-06-05 @ 4061a54; CC0) | Formats and verification steps in note 3 | Own code + `@scure/btc-signer` preimages + noble `secp256k1`/`schnorr` |
| **Solana `signMessage` / `signIn` (SIWS)** | SOL | Wallet Standard `solana:signMessage`/`solana:signIn` (anza-xyz/wallet-standard @ c4d06f9, Apache-2.0); SIWS ABNF (phantom/sign-in-with-solana @ 6f085ac, MIT) | Ed25519 over **`signedMessage`**: "the wallet may prefix or otherwise modify the message", so also check that the signed bytes equal, or properly envelope, our challenge (offchain message v1, sRFC 3). SIWS reuses SIWE's fields (chain-id `mainnet`/`solana:mainnet`…, nonce ≥8 alphanumeric) | noble `ed25519.verify(..., {zip215:false})` + own parser |
| **TRON `signMessageV2`** | TRX | TronWeb (no formal spec; TronWeb is MIT) | `keccak256("\x19TRON Signed Message:\n" + len + msg)`, recover, keccak address, `0x41`, base58check, compare | Own (~40 lines) |
| XRP | XRP | none found | No XRPL standard for off-chain arbitrary-message signing was found; wallet sign-in APIs are vendor-specific (not exhaustively checked) | Validity only; ownership via adapter |

Notes on the table:
1. **SIWE message format:**
   - `[scheme://]domain wants you to sign in with your Ethereum account:` / address / [statement] / `URI:` / `Version: 1` / `Chain ID:` / `Nonce:` (≥8 alphanumeric) / `Issued At:` (RFC 3339) / optional `Expiration Time:`, `Not Before:`, `Request ID:`, `Resources:`.
   - The statement must not contain `\n`.
   - The address SHOULD be EIP-55.
   - "Sessions MUST be bound to the address."
2. **BIP-137 in practice:**
   - **Electrum** (`electrum/bitcoin.py` @ a8e19f1) signs with only the compressed and uncompressed headers, and on verify tries every P2PKH-type script (p2pkh, p2wpkh-p2sh, p2wpkh). Its source notes "`bitcoin-cli verifymessage` does NOT enforce the low-S rule".
   - bip322-js documents the same wrong-header problem and calls the tolerant mode "loose".
   - **Owner policy:** strict, or loose but restricted to the claimed address's script type.
3. **BIP-322:**
   - Tagged hash `sha256_tag("BIP0322-signed-message", m)`.
   - Virtual `to_spend` (scriptSig `OP_0 PUSH32[hash]`, output = the address's scriptPubKey) and `to_sign` (version 0, spends `to_spend:0`, one `OP_RETURN` output).
   - Formats:
     - **legacy** = BIP-137, "MUST be restricted to P2PKH";
     - **simple** = `smp` + base64 witness stack (P2WPKH, P2WSH, P2TR);
     - **full** = `ful` + `to_sign` tx;
     - **proof of funds** = `pof` + finalized PSBT.
   - "Signers MUST prefix"; verifiers may assume simple when no prefix is present.
   - Results: valid, valid at time T and age S, **inconclusive**, or invalid.
   - **Scope for us:**
     - simple P2WPKH: BIP-143 sighash + ECDSA;
     - simple P2TR key path: BIP-341 `SIGHASH_DEFAULT` + BIP-340 Schnorr;
     - legacy P2PKH.
   - Full, PoF, P2WSH and multisig return **inconclusive**: they need a script interpreter and the UTXO set. Never "passed".

Design notes:
- **Challenge.** The server issues a 128-bit single-use nonce, stored hashed with constant-time compare (the C40 selfie-capture pattern). Use the SIWE/SIWS format for EVM and SOL, and a SIWE-shaped plain-text message (domain, address, nonce, issued-at, expiry, statement) for BTC, LTC and TRON. `crypto_wallet_statement_comparison` is the exact byte match of the signed statement and fields against what the server issued.
- **The client needs no crypto library.** The browser flow asks the wallet to sign:
  - EVM: EIP-1193 `personal_sign`;
  - Solana: Wallet Standard `solana:signIn` / `solana:signMessage`;
  - Bitcoin: provider APIs are non-standard, so offer a copy/paste path (show the challenge, accept a pasted base64 signature).
- **Hostile-input bounds.** Before decoding, cap:
  - addresses at ≤128 characters (base58 is O(n²));
  - signatures at ≤1 KiB for legacy/simple;
  - SIWE/SIWS messages at ≤4 KiB.
- **Where it lives.** It all fits `packages/checks` (pure TS). The API worker only adds the optional RPC adapter.
- **Test vectors:**
  - BIP-173/350 valid and invalid address lists (BSD-2-Clause);
  - BIP-322 `bip-0322/basic-test-vectors.json` (tx_hashes 3, simple 4, error 8) and `generated-test-vectors.json` (simple 4, full 10, proof_of_funds 3, error 28). These carry `smp`-prefixed signatures and are CC0 as part of the BIP;
  - EIP-55's 8 cases;
  - the EIP-4361 example messages (CC0).

**Recommendation:**
- **Runtime, in `packages/checks`:** `@noble/curves@2.4.0` + `@noble/hashes@2.4.0` + `@scure/base@2.4.0` + `@scure/btc-signer@2.4.1` (pulls `micro-packed@0.11.1`). All are MIT, at least 14 days old, ESM, without install scripts, by one author, audited (scope caveats in note 1 of 4.1), and they share one dependency set.
- **Own code, about 1,000 lines of TS plus tests:**

  | Part | Lines |
  |---|---|
  | Chain registry and address validators (BTC/LTC/DOGE/TRON/XRP/SOL/EVM) | ~250 |
  | EIP-55 | ~30 |
  | EIP-191 recover | ~40 |
  | SIWE/SIWS strict parser and validator | ~220 |
  | BIP-137 | ~80 |
  | BIP-322 legacy + simple (P2WPKH, P2TR), on btc-signer's `preimageWitnessV0`/`V1` | ~200 |
  | TRON message | ~40 |
  | Solana verify | ~40 |
  | Challenge builder | ~60 |

- **Fallback:**
  - **Without btc-signer:** write the BIP-143 and BIP-341 preimages ourselves for the fixed one-in/one-out `to_sign`, about 200 more lines.
  - **EVM smart-contract wallets (ERC-1271/6492):** an adapter. Either `viem@2.57.3` `verifyMessage`, accepting its 27.9 MB and second noble line, or our own ERC-1271 `eth_call` over the existing `undici` (6492 then stays unsupported). Without an RPC, contract wallets get "inconclusive", not "passed".
- **Dev-only cross-oracles:** `bitcoin-address-validation@4.0.0` (MIT) and `micro-eth-signer@0.20.1` (MIT). Skip `bip322-js`: it brings Unlicense through `fast-sha256` and fails the prefixed official vectors. If it is used anyway, strip the prefix first.
- **Do not use:** `bitcoinjs-message` (native install script, stale), `ethers`, `siwe` (peer-depends on `ethers`), `tweetnacl` (Unlicense), `multicoin-address-validator`, `@solana/web3.js` / `@solana/kit`.

### 4.4 Sources

**npm registry JSON** (`https://registry.npmjs.org/<name>`): @noble/curves, @noble/hashes, @noble/ciphers, @noble/secp256k1, @noble/ed25519, @scure/base, @scure/btc-signer, @scure/bip32, @scure/bip39, micro-packed, micro-eth-signer, micro-sol-signer, viem, ox, abitype, ethers, siwe, @spruceid/siwe-parser, apg-js, @stablelib/*, bitcoinjs-lib, bitcoinjs-message, secp256k1, bip322-js, @bitcoinerlab/secp256k1, ecpair, fast-sha256, tiny-secp256k1, tweetnacl, bs58, bs58check, base-x, bech32, ethereum-cryptography, @solana/web3.js, @solana/kit, @solana/errors, @solana/keys, @solana/addresses, @solana/offchain-messages, bitcoin-address-validation, multicoin-address-validator.

**LICENSE and README at tag:**
- https://github.com/paulmillr/noble-curves/blob/656c4364dffa44c64aa0c49914b8000b278b67a9/LICENSE (+ README Security, `src/abstract/weierstrass.ts`)
- https://github.com/paulmillr/noble-hashes/blob/663c2aeeffc308ac0cded59bd32f7c212adacfc2/LICENSE
- https://github.com/paulmillr/scure-base/blob/d93da4f8fbd7146c3af51c72d65945af72193a7c/LICENSE
- https://github.com/paulmillr/scure-btc-signer/blob/373d2f3ed32478fcf52a088c14c769df3d29acb8/LICENSE (+ `src/payment.ts`, `src/transaction.ts`)
- https://github.com/paulmillr/micro-eth-signer/blob/f593820575b3e1db1cd09fef7b6fd5d4057983e0/LICENSE
- https://github.com/ACken2/bip322-js/blob/b9cc205351737fe50fe877a6c67c40324cfb1449/LICENSE (+ README; 4.0.0 tarball inspected)
- https://github.com/wevm/viem/blob/viem@2.57.3/LICENSE
- https://github.com/spruceid/siwe (LICENSE-APACHE, LICENSE-MIT)

**Audits:**
- https://cure53.de/audit-report_noble-crypto-libs.pdf
- https://cure53.de/pentest-report_hashing-libs.pdf
- https://cure53.de/audit-report_micro-btc-signer.pdf
- https://github.com/trailofbits/publications/blob/master/reviews/2023-01-ryanshea-noblecurveslibrary-securityreview.pdf

**Bitcoin specs:**
- https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
- https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki
- https://github.com/bitcoin/bips/blob/master/bip-0137.mediawiki
- https://github.com/bitcoin/bips/blob/4061a54418f62a5a1ae44f4604e56373329bfad3/bip-0322.mediawiki (+ `bip-0322/*.json`; history via the GitHub commits API)

**Ethereum specs:**
- https://eips.ethereum.org/EIPS/eip-55
- https://eips.ethereum.org/EIPS/eip-191
- https://eips.ethereum.org/EIPS/eip-4361
- https://eips.ethereum.org/EIPS/eip-1271
- https://eips.ethereum.org/EIPS/eip-6492
- https://eips.ethereum.org/EIPS/eip-2
- Markdown read at ethereum/ERCs @ 077adf8

**Other specs and sources:**
- Solana: https://solana.com/docs/core/accounts, https://solana.com/docs/core/pda, https://github.com/anza-xyz/kit (`packages/addresses/src/address.ts`, `packages/offchain-messages/README.md`), https://github.com/solana-foundation/SRFCs/discussions/3, https://github.com/anza-xyz/wallet-standard (`packages/core/features/src/signMessage.ts`, `signIn.ts`), https://github.com/phantom/sign-in-with-solana
- TRON: https://developers.tron.network/docs/account, https://github.com/tronprotocol/tronweb (`src/utils/crypto.ts`, `src/utils/message.ts`, `src/utils/constants.ts`)
- XRP: https://xrpl.org/docs/concepts/accounts/addresses
- Chain parameters: https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp, https://github.com/litecoin-project/litecoin/blob/master/src/chainparams.cpp, https://github.com/dogecoin/dogecoin/blob/master/src/chainparams.cpp
- Electrum: https://github.com/spesmilo/electrum/blob/master/electrum/bitcoin.py
- Other chains: https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md, https://cips.cardano.org/cip/CIP-0019, https://cips.cardano.org/cip/CIP-0005, https://github.com/cosmos/cosmos-sdk/blob/main/docs/architecture/adr-028-public-key-addresses.md, https://wiki.polkadot.com/learn/learn-account-advanced/, https://github.com/paritytech/polkadot-sdk/blob/master/substrate/primitives/core/src/crypto.rs, https://docs.ton.org/foundations/addresses/formats, https://github.com/monero-project/monero/blob/master/src/common/base58.cpp
- OFAC SDN CSV: https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV (publication of 2026-10-20)
- viem docs: https://viem.sh/docs/actions/public/verifyMessage, https://viem.sh/docs/siwe/utilities/parseSiweMessage

**Not verified:** the Trail of Bits 2026-08 audit of noble-curves 2.3.0 is stated only in the README, with no PDF in the repo. The absence of an XRPL message-signing standard was not exhaustively checked.

## 5. KYB and business data sources

Checked 2026-10-21. "Observed" means a live request made that day. The GLEIF terms, the SEC fair-access policy, the abuse.ch terms and the Companies House reuse statement were re-read independently.

Four findings change the plan:
- **URLhaus is not CC0.** abuse.ch's terms (effective 4 November 2025, last updated 21 October 2026) say commercial use of URLhaus "may require a paid subscription, which will be managed by Spamhaus". Its API and its dumps both need an Auth-Key. CC0 covers only Feodo Tracker, SSL Blacklist and YARAify.
- **The OpenPhish Community feed is non-commercial only.**
- **Google Safe Browsing is non-commercial only**, and v4 is deprecated. The commercial product is Web Risk (paid).
- **PhishTank has closed new registrations.**

So PLAN §3 and §4.3 ("URLhaus / phishing feeds (CC0)") and THIRD_PARTY_LICENSES §4.2 need correcting.

| Source | Data licence | Auth / registration | Rate limit | Bulk download | Caching | Attribution | Verdict |
|---|---|---|---|---|---|---|---|
| **GLEIF LEI API + Golden Copy** | **CC0 1.0**: "The data available through the Access Service are provided under the CC0 licence" | None (no key, no account; observed) | **60 requests per minute per user** (API docs, "Terms & Conditions") | Yes, free:<br>• published 3 times a day<br>• Level 1 LEI-CDF, Level 2 RR-CDF and Reporting Exceptions<br>• CSV, JSON or XML zips<br>• delta files for 8 h, 24 h, 7 d and 31 d | Unrestricted (CC0) | None required. Don't imply GLEIF endorsement; the GLEIF logo needs permission. Breach carries CHF 100,000 liquidated damages per case | ✅ **R-tier, on by default** |
| **UK Companies House Public Data API** | Companies House: "We impose no rules or requirements on how the information on the public register is used" (the gov.uk page's own text is OGL v3.0). Users remain "responsible for complying with any applicable data protection … legislation": officer and PSC data stays personal data | **Free API key per deployment**:<br>1. Companies House account<br>2. application (Test → sandbox, Live → production)<br>3. "REST API key"<br>HTTP Basic, key as the username, password blank | **600 requests per 5 minutes**. Then 429 for the rest of the window; repeat offenders "banned without notice"; higher limits on request | Yes, free:<br>• company data, monthly CSV (471 MB zip)<br>• PSC snapshot, daily JSON (33 zips of ~73 MB)<br>• accounts, daily iXBRL<br>No free officers bulk product. The streaming API needs a separate stream key | No caching rule. UK GDPR storage limitation applies to personal data | None required. Suggest "Source: Companies House" | ✅ **R+A**: a real provider, bound only when the operator supplies a key |
| **SEC EDGAR (data.sec.gov)** | "public information… may be copied or further distributed… without the SEC's permission" | No key ("These APIs do not require any authentication or API keys"). **A User-Agent is mandatory**, in the form "Sample Company Name AdminContact@<sample company domain>.com". A request without one got 403 (observed) | **10 requests per second in total**, "regardless of the number of machines". The SEC "reserves the right to limit request rates"; over the limit, the IP is limited until it stays under the threshold for 10 minutes | Yes:<br>• `submissions.zip`, 1.57 GB<br>• `companyfacts.zip`, 1.41 GB<br>Both rebuilt nightly around 3 a.m. ET | Unrestricted | "Please consider appropriate citation to the SEC as the source". Don't use the SEC seal or logos | ✅ **R-tier**, once the operator configures the User-Agent contact |
| **OpenCorporates** | **ODbL** (share-alike). Non-share-alike only for a fee | API key required. Free keys go only to "Permitted Users" (journalists, NGOs, academics). "financial institutions, corporations, government departments and regulatory authorities" are excluded | Default 200 per month, 50 per day | No; scraping is prohibited | Not addressed | A "from OpenCorporates" link, at least 70% of the largest font or 7 px | ❌ as built-in (ODbL share-alike). **Adapter only**, under the operator's paid licence |
| **RDAP (domain age)** | IANA bootstrap: IANA protocol registries are **CC0 1.0** ("may be freely used by any party for any purpose"). Registry data: each registry's own terms, e.g. Verisign "lawful purposes only" | None | None published. Verisign forbids "high volume, automated, electronic processes" and may restrict access "in its sole discretion". No rate-limit headers observed | Bootstrap `dns.json` only; per-domain queries, no bulk | Bootstrap: cache by HTTP `Expires` (RFC 9224 §8; observed `max-age=86400`). Results: Verisign's terms set no restriction | None | ✅ **R-tier** for gTLDs and the 72 ccTLDs with RDAP. Other TLDs answer "unavailable" |
| **abuse.ch URLhaus** | **Not CC0.** Terms §4.1: commercial or for-profit use "may require a paid subscription, which will be managed by Spamhaus". CC0 covers only Feodo Tracker, SSL Blacklist and YARAify (§3.4) | **Auth-Key required** for the API and every dump URL (`…/v2/files/exports/<AUTH-KEY>/recent.csv`, per the URLhaus API docs). Free from auth.abuse.ch | Volumes "reasonably expected for non-commercial or non-profit purposes". Dumps are generated every 5 minutes; fetch no more often than that | Dumps, with the key | Not addressed. §7.3 bars derivative works without consent, and AI training without Spamhaus's written consent | Not addressed | ❌ as built-in. **Adapter only**, with the operator's key and acceptance of the terms |
| **OpenPhish Community** | Proprietary. Use only for "academic, independent, or personal research". Commercial uses explicitly barred, including "customer protection" and "detection" | None for the community `feed.txt` | Updated every 12 hours | Text file | No redistribution to third parties | n/a | ❌. **Adapter only**, with a commercial OpenPhish feed |
| **PhishTank (Cisco Talos)** | No licence text: the "Terms of Use" link redirects to the home page (observed). The FAQ says commercial use is "Yes, it is OK" | An app key is needed for automation; without one you are "limited to a few downloads per day". **"New user registration temporarily disabled"** (observed) | Hourly database, "on the hour". Unlimited HEAD/ETag requests with a key | `online-valid.{json,csv,xml}`, plain or `.gz`/`.bz2` | Not addressed | A descriptive User-Agent is required (`phishtank/[username]`) | ⚠️ **Adapter only**: no licence text, and no new keys can be issued |
| **Phishing.Database** (GitHub) | **MIT** (LICENSE @ 12a20bf, © 2018-2025 Krog, Chababy and contributors) | None (GitHub raw files) | GitHub's limits | `phishing-domains-ACTIVE.txt`, `phishing-links-ACTIVE.txt` and others; hourly "NEW-last-hour" files | MIT | Keep the MIT notice | ⚠️ The licence passes, but the README doesn't name its upstream feeds, so provenance is unverified. Owner decision |
| **CERT Polska Warning List** (`hole.cert.pl/domains/v2/domains.{txt,json,csv}`, 2.5 MB) | No named licence, but explicit permission: "may be used by any user for any purpose, including commercial purposes" | None | Not stated | Yes; updated continuously (observed) | Allowed | Not required | ⚠️ Permissive in effect, but not a licence rule 4 names. Covers phishing aimed at Polish users only. Owner decision |
| **Google Safe Browsing v4/v5** | "The Safe Browsing API is for non-commercial use only"; v4 is "deprecated" | API key | n/a | Update API | Per API | n/a | ❌ non-commercial. Use Web Risk instead |
| **Google Web Risk** | Google Cloud terms; results "must not be redistributed" | A Google Cloud project with **billing enabled** and the Web Risk API enabled | Billed per call: `uris.search` is free up to 100,000 calls a month, then $0.50 per 1,000 | Update API (`threatLists.computeDiff`, free) | A local cache is **required**, held until each `expireTime` (positive and negative caching) | n/a | ✅ **Adapter only** (paid, operator's account) |

### 5.1 GLEIF

GLEIF holds 3,468,041 LEI records, of which 1,989,053 are ISSUED and ACTIVE (observed through the API's `meta`).

**Endpoints (all observed):**
- `GET /api/v1/lei-records?filter[entity.legalName]=…` or `filter[lei]=…`.
- `/api/v1/fuzzycompletions?field=entity.legalName&q=…` matches fuzzily: "appel inc" finds Apple Inc.
- `/api/v1/autocompletions?field=fulltext&q=…`.
- Relationships: `direct-parent`, `ultimate-parent`, `direct-children`, `ultimate-children`.

**Fields per check:**
- **`database_business_identity_comparison`:**
  - `entity.legalName.name`, and `otherNames[]` (including `PREVIOUS_LEGAL_NAME`).
  - `entity.legalAddress` and `headquartersAddress`: `addressLines`, `city`, `region` (ISO 3166-2), `country`, `postalCode`.
  - `entity.registeredAt.id` with `entity.registeredAs`. The first is a registration-authority code (for example `RA000585` is Companies House, England and Wales); the second is the local company number. Together they link an LEI to the national register.
- **`database_business_active_business_detection`:** `entity.status` (`ACTIVE` or `INACTIVE`), `registration.status` (`ISSUED`, `LAPSED`, `RETIRED` and others) and `nextRenewalDate`. `LAPSED` only means the LEI wasn't renewed, not that the business stopped, so treat it as a warning, not a failure.
- **`database_business_associated_persons_comparison`:** GLEIF holds **no natural persons**, only parent and child entities, so it can't serve this check.
- **`database_business_enabled_country_detection`:** `entity.jurisdiction` or `legalAddress.country`.

**Bulk files:** the 16:00 UTC publish (observed, from `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest`):

| File | CSV zip | XML zip | JSON zip |
|---|---|---|---|
| Level 1 (lei2) | 482 MB | 849 MB | 881 MB |
| Level 2 RR | 23 MB | 32 MB | 34 MB |

- Level 1 CSV delta files: intraday 1.5 MB, last day 3.2 MB, last week 11 MB, last month 50 MB.
- The API itself was serving the 08:00 UTC Golden Copy (`publishDate 2026-10-21T08:00Z`), one publish behind the newest file.
- The 00:00, 08:00 and 16:00 UTC times appear only in a 2018 GLEIF service catalogue. The current page says only "three sets … daily".

### 5.2 Companies House

The public data API is at `https://api.company-information.service.gov.uk`; it answers 401 without a key (observed).

**Endpoints:**
- `/company/{n}`, `/company/{n}/officers` and `/company/{n}/persons-with-significant-control`
- `/search/companies` and `/advanced-search/companies`
- `/officers/{id}/appointments`
- `/disqualified-officers/...`
- `/company/{n}/insolvency`

**Fields per check:**
- **Identity:** `company_name`, `registered_office_address`, `company_number`, `date_of_creation`, `jurisdiction` and `sic_codes`.
- **Active business:**
  - `company_status` takes one of: `active`, `dissolved`, `liquidation`, `receivership`, `converted-closed`, `voluntary-arrangement`, `insolvency-proceedings`, `administration`, `open`, `closed`, `registered`, `removed`.
  - `company_status_detail` refines it; `active-proposal-to-strike-off` should be a warning.
  - `date_of_cessation`.
- **Associated persons:**
  - Officers carry `name`, `officer_role`, `appointed_on`, `resigned_on` (null means still in post) and `date_of_birth: {month, year}`. **Only the month and year of birth are public**, so this feeds the partial-DOB rule in §2.
  - PSCs carry `name`, `natures_of_control` and the same month-and-year date of birth.
- **Enabled country:** GB only.

**Practical points:**
- **Enumerations:** the `company_status` values come from `constants.yml` in `companieshouse/api-enumerations`. That repository has **no LICENSE**, so re-type the values (they are facts) rather than vendoring the file.
- **Sandbox:** `https://api-sandbox.company-information.service.gov.uk`, with a key from a Test application and a test-data generator (`test-data-sandbox…`) that creates companies. Live and sandbox keys are separate.
- **Sign-in:** goes through the Companies House identity service (`identity.company-information.service.gov.uk`; observed redirect). Companies House is moving its services to GOV.UK One Login. Whether the Developer Hub already requires One Login was **not confirmed**; the operator follows whatever the sign-in page asks.
- **Personal data:** officer and PSC details are personal data. Keep only the comparison outcome and minimal provenance (company number, `etag`). Anything retained goes through the `encrypted` column helper with a retention period.

### 5.3 SEC EDGAR

**Endpoints:**
- `https://data.sec.gov/submissions/CIK##########.json` returns:
  - `name` and `formerNames[{name, from, to}]`;
  - `addresses.{business, mailing}`;
  - `stateOfIncorporation`, `ein`, `sic` and `sicDescription`, `entityType`, `category`, `tickers`;
  - `filings.recent.{filingDate, form, …}`.
- `/api/xbrl/companyfacts/…` holds the XBRL financial data.

**Finding a company's CIK by name:** there is no documented name-search API.
- Use `https://www.sec.gov/Archives/edgar/cik-lookup-data.txt`, which maps every entity name to its CIK and is refreshed nightly.
- `/files/company_tickers.json` covers listed companies only.
- `efts.sec.gov/LATEST/search-index` answers, but it is the website's undocumented back end, so don't depend on it.

**Limits of the data:**
- **No legal status:** EDGAR has no "active" field. "Filed within N months" is only a heuristic, so that check ships as `stage: beta` with a confidence score.
- **No associated persons:** the submissions API has no officers or PSCs.
- **Coverage:** SEC registrants only.

**Calling it:**
- data.sec.gov doesn't support CORS, so every call is server-side.
- The 10 requests/second cap applies to the whole organisation, so enforce it with a token bucket shared through Valkey.

### 5.4 OpenCorporates

ODbL share-alike is incompatible with shipping its data in a permissively licensed product. The free tier excludes corporations and financial institutions, and scraping is prohibited. Ship a port only, for operators who buy a non-share-alike key.

### 5.5 RDAP (domain age)

**Bootstrap file** (`https://data.iana.org/rdap/dns.json`, published 2026-09-30; observed):
- 592 services covering 1,203 TLDs, of which **72 are ccTLDs**.
- `.com` and `.net` go to `rdap.verisign.com` and `.org` to PIR; `.uk` (Nominet), `.ca`, `.fr`, `.ai` and `.app` are also covered.
- **Not covered:** `.de`, `.io`, `.co` and `.me`.
- Two services are HTTP-only; require HTTPS.
- Lookup is a label-wise longest match, right to left (RFC 9224 §4).

**Reading the age:**
- The age comes from the `events[]` entry with `eventAction: "registration"` (RFC 9083 §4.5). Observed: example.com 1995-08-14, bbc.co.uk 1994-12-13.
- A dropped and re-registered domain shows its new registration date, which is the right behaviour for this check.
- ICANN made RDAP "the definitive source" for gTLD registration data on 28 January 2025.

**TLDs without RDAP:**
- Answer `domain_age_unavailable`, never a pass.
- Port-43 WHOIS is unreliable as a fallback. **DENIC returns no creation date at all**, only `Changed:` (observed), while whois.nic.io does give a `Creation Date`.
- Keep WHOIS as an optional adapter, not the default.

**Implementation:**
- **Library:** none needed. The npm candidates are small and young (`rdapper` 0.18.0, `node-rdap` 1.0.0, both MIT). About 150 lines on undici cover bootstrap caching, longest match, `events` parsing and a per-host throttle.
- **SSRF:** registry URLs, and any registrar redirects in `links[rel=related]`, come from third parties. Route them through the existing SSRF-guarded sender (`apps/api/src/webhooks/ssrf.ts`, `http-sender.ts`).
- **Throttle:** no registry publishes a number, so at most 1 request per second per RDAP host (our own conservative choice).
- **Cache:** results for 24 hours, keyed by registrable domain.

### 5.6 Malicious-website feeds

No free source is both acceptable under rule 4 and useful worldwide for commercial use. The candidates, most useful first:
1. **CERT Polska:** explicit commercial permission, but Polish phishing only.
2. **Phishing.Database:** MIT, but unclear provenance.
3. **abuse.ch Feodo Tracker and SSL Blacklist:** CC0, but they list botnet command servers and certificates, not phishing websites. Marginal.

Phishing Army's licence and sources pages render only with JavaScript, so they could not be verified; not recommended.

Fetching the customer's website itself (content, backlinks) must also go through the SSRF guard: block private ranges, re-check after DNS resolution, cap size and time.

**Recommendation:**
1. **GLEIF: the default R-tier KYB source, no key.**
   - Live API lookups behind a shared Valkey token bucket of 60 per minute, with a 24-hour result cache.
   - An optional Golden Copy mirror for high-volume deployments (Level 1 plus RR CSV, about 505 MB zipped, deltas every 8 hours).
   - Use `registeredAt` plus `registeredAs` to hop to the national register.
2. **Companies House: a real provider, enabled only when `OPENVERIFY_COMPANIES_HOUSE_API_KEY` holds a live key.**
   - CI uses a separate sandbox key.
   - Budget 600 requests per 5 minutes.
   - It's the only free source for `associated_persons` (GB).
   - Store outcomes, not officer lists.
3. **SEC EDGAR: a real provider, enabled only when `OPENVERIFY_SEC_EDGAR_USER_AGENT` holds the operator's organisation name and contact address.**
   - The provider refuses to start without it.
   - At most 10 requests per second globally.
   - `cik-lookup-data.txt` for name to CIK.
   - "Active" stays beta.
4. **OpenCorporates:** port only.
5. **Domain age:** our own RDAP client (R-tier), "unavailable" for TLDs without RDAP, and an optional WHOIS adapter.
6. **Malicious website: re-tier from "R+A (CC0)" to A plus an opt-in feed provider.**
   - A port with a deterministic sandbox.
   - A built-in feed-list provider whose default list ships **empty** until the owner approves CERT Polska and/or Phishing.Database.
   - Adapters for:
     - URLhaus: operator's Auth-Key; the operator accepts the abuse.ch/Spamhaus terms;
     - Google Web Risk: operator's GCP billing;
     - PhishTank;
     - OpenPhish premium.
   - Never use Safe Browsing (non-commercial).
7. **Fix the records:**
   - PLAN §3 and §4.3, and THIRD_PARTY_LICENSES §4.2: URLhaus is not CC0.
   - Companies House "Open Government Licence (API terms)" should read "no reuse restrictions on register information; personal data under UK GDPR".

### 5.7 Sources

**GLEIF:**
- https://www.gleif.org/en/meta/lei-data-terms-of-use
- https://api.gleif.org/docs ("Terms & Conditions": 60 requests per minute)
- https://www.gleif.org/en/lei-data/gleif-api
- https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy
- https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest
- https://api.gleif.org/api/v1/lei-records, `/fuzzycompletions`, `/autocompletions`, `/registration-authorities/RA000585` (observed)
- https://www.gleif.org/_documents/blog/20180314-gleif-service-catalog-published/2018-03-14_ServiceCatalog_v1.0.pdf (2018 publication times)

**Companies House:**
- https://developer.company-information.service.gov.uk/get-started
- https://developer.company-information.service.gov.uk/how-to-create-an-application
- https://developer.company-information.service.gov.uk/developer-guidelines
- https://developer.company-information.service.gov.uk/api-testing
- https://developer-specs.company-information.service.gov.uk/guides/rateLimiting
- https://developer-specs.company-information.service.gov.uk/guides/authorisation
- https://developer-specs.company-information.service.gov.uk/streaming-api/guides/authentication
- https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference, plus `/resources/companyprofile` and `/resources/officersummary`
- https://www.gov.uk/guidance/companies-house-data-products
- https://www.gov.uk/guidance/search-the-companies-house-register
- https://download.companieshouse.gov.uk/en_output.html
- https://download.companieshouse.gov.uk/en_pscdata.html
- https://github.com/companieshouse/api-enumerations (`constants.yml`; no licence)
- https://nibusinessinfo.co.uk/content/companies-house-use-gov.uk-one-login

**SEC:**
- https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/webmaster-frequently-asked-questions
- https://www.sec.gov/privacy
- https://data.sec.gov/submissions/CIK0000320193.json (observed)
- https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip
- https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip
- https://www.sec.gov/Archives/edgar/cik-lookup-data.txt

**OpenCorporates:**
- https://api.opencorporates.com/documentation/API-Reference
- https://opencorporates.com/terms-of-use-2/

**RDAP:**
- https://data.iana.org/rdap/dns.json
- https://www.iana.org/help/licensing-terms
- https://www.rfc-editor.org/rfc/rfc9224.html
- https://www.rfc-editor.org/rfc/rfc9083.txt (§4.5)
- https://www.verisign.com/domain-names/registration-data-access-protocol/terms-service/index.xhtml
- https://www.icann.org/en/announcements/details/icann-update-launching-rdap-sunsetting-whois-27-01-2025-en
- whois.denic.de and whois.nic.io (observed)
- npm registry search for `rdap`

**Feeds:**
- https://abuse.ch/terms-of-use/
- https://urlhaus.abuse.ch/api/
- https://openphish.com/terms.html
- https://openphish.com/phishing_feeds.html
- https://phishtank.org/developer_info.php
- https://phishtank.org/faq.php
- https://phishtank.org/register.php
- https://github.com/Phishing-Database/Phishing.Database (LICENSE and README @ 12a20bf)
- https://cert.pl/en/warning-list/
- https://hole.cert.pl/domains/v2/domains.txt
- https://phishing.army/license/ (JavaScript-only, unverified)
- https://developers.google.com/safe-browsing/v4
- https://developers.google.com/safe-browsing/reference
- https://docs.cloud.google.com/web-risk/docs/overview
- https://docs.cloud.google.com/web-risk/docs/quickstart
- https://docs.cloud.google.com/web-risk/docs/caching
- https://cloud.google.com/web-risk/pricing

**Repo files:** `apps/api/src/webhooks/ssrf.ts`, `apps/api/src/webhooks/http-sender.ts`.

## 6. Database verification and AAMVA DLDV

**Conclusion: there is no free, authoritative, open source for verifying name, address or birthdate in any market checked.** Every authoritative record sits behind statute, contract, fees and a permitted purpose.
- The matching logic (Jaro-Winkler, nickname table, address normalisation, partial DOB; §2) is R-tier in `packages/checks`.
- The record source ships only as **adapters plus deterministic sandbox providers**.

| Market | Authoritative source | Access | Why it can't be built in |
|---|---|---|---|
| US: DMV records | **AAMVA DLDV** | "AAMVA must approve all customers before implementing DLDV". An NDA comes before the documentation or rates. Fee-based, with revenue shared with jurisdictions | Contract, NDA and fees. DPPA (18 U.S.C. §2721(b)(3)) lets a legitimate business "verify the accuracy of personal information submitted by the individual" |
| US: SSN, name, DOB | **SSA eCBSV** | Only "permitted entities": GLBA §509 financial institutions, or their service providers, subsidiaries, affiliates, agents, subcontractors or assignees (Economic Growth Act §215(b)(4)).<br>Needs the holder's **written or e-signed consent**.<br>Annual tiered subscription; the 12-tier schedule from 7 April 2025 starts at $5,100 for up to 10,000 transactions | Eligibility, consent and fees. ssa.gov answered 403 to direct fetches; these figures come from search-result extracts of ssa.gov pages, so re-check before quoting |
| US: credit header | Experian, Equifax, TransUnion, LexisNexis and similar | Commercial contracts. Use is governed by GLBA (15 U.S.C. §6802(e) exceptions) and, for consumer reports, FCRA permissible purposes (15 U.S.C. §1681b) | Licensed data with no public API (vendor terms not reviewed) |
| UK | Full electoral register through credit reference agencies; certified digital verification services (DVS) providers | The full register may only be used for listed purposes, such as "checking applications for loans or credit" and "preventing and detecting crime".<br>Anyone can buy the open register, but people can opt out of it, so it isn't authoritative.<br>The statutory DVS register lists providers "certified against the UK digital verification services trust framework" | Commercial or statutory access. The HMPO Document Checking Service pilot (Aug 2020 to Mar 2022, 50p per check) is withdrawn |
| India | Aadhaar e-KYC | Only UIDAI-appointed authentication and e-KYC agencies, under the Aadhaar (Authentication and Offline Verification) Regulations 2021 (Schedule A criteria, UIDAI agreement) | Statutory appointment |
| EU and elsewhere | National population or ID registries | Government contracts, country by country | Not checked country by country. No pan-EU open source exists |

### 6.1 AAMVA DLDV details

From AAMVA's "DLDV Overview for Customers" (text layer of the PDF, last modified 2024-02-14):
- **Returns** a "True" or "False" indicator for each attribute submitted.
- **Attributes listed:**
  - Document Number and State Code;
  - First, Middle and Last Name, and Name Suffix;
  - Street, City, State and Zip Code;
  - Issue Date and Expiration Date;
  - Eye Color, Height, Weight and Gender.
- **Date of birth isn't in that list.** Confirm with AAMVA's documentation under NDA.
- **What it doesn't do:** it doesn't "return to the requestor the actual data", "validate that the physical document is genuine", "provide a verification of photo or signature", or "store the verification request data".
- **Coverage:** participating jurisdictions appear only on AAMVA's interactive map. Vendor pages (Ping, IDScan) cite 44 jurisdictions, about 73% of the US population, but those are secondary sources; use the map.
- **Fit with the existing code:**
  - Match-only answers fit the existing `AamvaLookupProvider` port (`apps/api/src/ports.ts:476-483`), whose result already carries `outcome` and `mismatchedFields`.
  - `aamva_name_comparison` and `aamva_identification_number_comparison` can reuse the `aamva` binding (`OPENVERIFY_PROVIDER_AAMVA_{SANDBOX,PRODUCTION}`, `apps/api/src/providers/index.ts:46`) instead of adding a new kind.

### 6.2 Proposed sandbox rules

These follow the existing conventions in `apps/api/src/providers/sandbox.ts` and `docs/checks/sandbox-providers.md`:
- Phase 3 keys on the last four characters of the identification number (`SANDBOX_MAGIC`: `0000` no match, `9999` not found).
- Phase 4 keys on tokens in `reference-id` (`SANDBOX_SELFIE_MAGIC`).
- Results are labelled `{id:"sandbox", sandbox:true}`.
- A sandbox binding on production refuses to start (`readProviderSettings`).

**Database verification** (new kind `database`; `OPENVERIFY_PROVIDER_DATABASE_{SANDBOX,PRODUCTION}`):
- The sandbox returns a **record, not a verdict**, so the real R-tier matcher runs.
- By default the record echoes the submitted name, address and date of birth, so everything matches.
- Tokens in `reference-id` change the record:
  - `sandbox-database-not-found`: no record.
  - `sandbox-database-name-mismatch`: a different surname.
  - `sandbox-database-nickname`: the formal given name (submitted "Bob", record "Robert"), which exercises the nickname table.
  - `sandbox-database-address-mismatch`: a different street and postcode.
  - `sandbox-database-address-variant`: the same address with abbreviations swapped ("Street" to "St", "Apartment" to "Apt"), which exercises normalisation.
  - `sandbox-database-birthdate-mismatch`: date of birth shifted by one year.
  - `sandbox-database-birthdate-partial`: year and month only.
- When several tokens are present, the first in a fixed order wins, as in Phase 4.

**AAMVA comparisons:** keep `0000` (no match on name and birthdate) and `9999` (not found), and add:
- `0001`: name mismatch only (`aamva_name_comparison` fails, the identification number passes);
- `0002`: address mismatch only.

**KYB** (kind `businessRegistry`, camelCase like the existing `ProviderKind` values `publicFigure` and `selfieAgeEstimate`; `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_{SANDBOX,PRODUCTION}`; production values `gleif`, `companies-house`, `sec-edgar`). Keyed on the last four characters of the registration number:
- `0000`: identity mismatch;
- `9999`: not found;
- `8888`: inactive or dissolved;
- `7777`: associated person not on the record;
- anything else: a match that echoes the input.

**Domain age and malicious website** (kinds `domainAge` and `maliciousWebsite`):
- The sandbox answers only for reserved names (RFC 2606 and 6761, `.example` and `.test`), with **no network call**:
  - `new.example`: registered 3 days ago;
  - `old.example`: registered 20 years ago;
  - `nordap.test`: unavailable;
  - `malicious.example`: listed;
  - anything else: not listed.
- Real domains answer `unavailable` in sandbox.

Real providers must never honour magic values, the same rule as `docs/checks/sandbox-providers.md` ("Adding a provider").

### 6.3 Sources

- https://www.aamva.org/DLDV/
- https://www.aamva.org/getmedia/cb603635-3454-4331-b2c6-288d894f7fc4/AAMVA-DLDV-Overview-for-Customers.pdf
- https://docs.pingidentity.com/pingone/identity_verification_using_pingone_verify/p1_verify_aamva_dldv.html (secondary)
- https://www.ssa.gov/dataexchange/eCBSV/ (403 to direct fetch; content via search extracts)
- https://www.ssa.gov/dataexchange/eCBSV/documents/eCBSV%20User%20Agreement%20-%20Costs%20of%20Service.pdf
- https://www.law.cornell.edu/uscode/text/18/2721
- https://www.law.cornell.edu/uscode/text/15/6802
- https://www.law.cornell.edu/uscode/text/15/1681b
- https://www.gov.uk/electoral-register/opt-out-of-the-open-register
- https://www.access-dvs-register.service.gov.uk/register/guidance
- https://www.gov.uk/guidance/apply-for-the-document-checking-service-pilot-scheme (withdrawn)
- https://uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verification_Regulations_2021.pdf
- Repo files: `apps/api/src/providers/index.ts`, `apps/api/src/providers/sandbox.ts`, `apps/api/src/ports.ts` (lines 455-515), `docs/checks/sandbox-providers.md`

## Needs the owner

Nothing below puts anyone's email address, key or account in code. Every credential is an operator-supplied environment variable, with a placeholder in `.env.example`, and each provider stays unbound (sandbox only) until it is set.

### A. Accounts, keys, terms and contact details (per deployment, or for the project's own CI)

| # | What | Who acts | Item |
|---|---|---|---|
| A1 | **SMS provider account** (Twilio, Vonage, Plivo or AWS): API credentials, a sender (number, Messaging Service or sender ID), geo-permissions and a provider-side spending limit. US long codes need **A2P 10DLC brand and campaign registration**; some countries require sender-ID registration. With no provider set, SMS OTP stays off outside sandbox | Operator | 3 |
| A2 | **Email sending:** an SMTP relay and a sending domain with SPF or DKIM, and SPF + DKIM + DMARC above 5,000 messages a day to Gmail. `OPENVERIFY_SMTP_URL` and `OPENVERIFY_MAIL_FROM` already exist. No personal address in code or defaults | Operator | 3 |
| A3 | **Optional paid phone lookups** (e.g. Twilio Lookup Line Type Intelligence or SIM-swap) for NANP line type and porting-aware carrier | Operator | 3 |
| A4 | **Companies House:** a Companies House account (identity service, moving to GOV.UK One Login), a **Live application with a REST API key** for production, and a separate **Test application** key for sandbox (proposed `OPENVERIFY_COMPANIES_HOUSE_API_KEY` plus a sandbox-key variable). For the project's own CI: decide whether to register a Test application and store its key as a CI secret | Operator; owner for CI | 5 |
| A5 | **SEC EDGAR User-Agent:** an organisation name and contact address in `OPENVERIFY_SEC_EDGAR_USER_AGENT` (the SEC's format: "Sample Company Name AdminContact@<domain>"). The provider refuses to start without it. Never in code, fixtures or docs | Operator | 5 |
| A6 | **abuse.ch URLhaus:** register at auth.abuse.ch for an Auth-Key and accept the abuse.ch/Spamhaus terms, including any paid commercial subscription | Operator | 5 |
| A7 | **Google Web Risk:** a Google Cloud project with billing and the Web Risk API enabled, and acceptance that results "must not be redistributed" | Operator | 5 |
| A8 | **PhishTank, OpenPhish premium, OpenCorporates (non-share-alike):** each needs the operator's own account or commercial licence. PhishTank is not accepting new registrations | Operator | 5 |
| A9 | **EVM RPC endpoint** (optional) for ERC-1271/6492 smart-contract wallets, with an API key if the RPC provider needs one. Do not ship a default public RPC: it would leak users' addresses to a third party. Without one, the result is `inconclusive` | Operator | 4 |
| A10 | **AAMVA DLDV:** AAMVA approval, an NDA before documentation and rates, and fees. **SSA eCBSV:** permitted-entity eligibility, a user agreement, consent capture and an annual fee. Commercial database providers: their contracts. The project ships only the sandbox providers | Operator | 6 |

### B. Licence and provenance decisions

| # | Decision | Recommendation | Item |
|---|---|---|---|
| B1 | Confirm the permissive licences that rule 4 does not name (table at the top): FTL (with its credit line), Unicode-3.0, IJG, Zlib, libpng-2.0, the AGG notice and the LLVM exception inside pypdfium2; the Adobe AFM notice in pypdf; MIT-0 (cffi, only if `cryptography` is added) | Accept, and add NOTICE and THIRD_PARTY_LICENSES rows | 1, 3 |
| B2 | **Nickname source:** our own table from a CC0 Wikidata seed plus authored rows, or `carltonnorthern/nicknames` (Apache-2.0) despite its seed pages' "all rights reserved" and "You may NOT use this page to begin a new nickname page" | Own table | 2 |
| B3 | **CC-BY 4.0 attribution** for Google libaddressinput data (and GeoNames, if used): NOTICE and THIRD_PARTY_LICENSES §4 rows | Accept | 2 |
| B4 | **USPS Publication 28** is USPS-copyrighted, not public domain. Build our tables from MIT sources (libpostal dictionaries, OpenCage) and cite Pub 28 only as a cross-check | Accept | 2 |
| B5 | **Malicious-website feeds on by default:** CERT Polska (a permission statement, Polish phishing only) and/or Phishing.Database (MIT, upstream provenance unverified). Otherwise the built-in list ships empty | Ship empty; let operators opt in | 5 |
| B6 | **Unlicense** (`tweetnacl`, `fast-sha256` via `bip322-js`): decide only if either is wanted | Not needed | 4 |

### C. Policy decisions

| # | Decision | Recommendation | Item |
|---|---|---|---|
| C1 | **14-day rule vs security fixes.** nodemailer 10.1.4 (three medium address-parser advisories, 2026-10-19) becomes pinnable on 2026-11-01. pypdf 6.21.2 (9 read-path DoS fixes after 6.19.0) becomes pinnable on 2026-11-04. PDFium gets new memory-safety CVEs about monthly. Exempt security releases from the rule, or wait | Wait, with the mitigations given (strict address validation; PDF work in a killable subprocess), unless the owner prefers a dated exception | 1, 3 |
| C2 | **Disposable-list refresh:** may the deployed API fetch `raw.githubusercontent.com` on a schedule (network egress), or does the list change only with releases through the pinned fetch script? | Release-pinned by default; refresh job opt-in | 3 |
| C3 | **OTP key:** derive the HMAC key from the KEK with HKDF (no new secret), or add `OPENVERIFY_OTP_KEY` to `.env.example` as a placeholder | HKDF from the KEK | 3 |
| C4 | **Partial-DOB defaults:** whether R2 (precision-limited) passes by default for database sources, and whether R4 (transposition) and R5 (typo) go to review or fail | R2 passes for database sources and goes to review for user ↔ document; R4 review; R5 fail with a reason | 2 |
| C5 | **Crypto verification policy:** accept non-checksummed (all-lower or all-upper) EVM addresses with a flag; strict vs "loose" BIP-137 headers; accept high-s ECDSA signatures; the default chain allowlist | Accept with flags; loose restricted to the claimed address's script type; accept high-s with a flag; BTC, EVM, TRON, LTC, SOL, XRP, DOGE | 4 |
| C6 | **Password-protected PDFs** (user password): reject as unprocessable, or accept a password from the user (more PII handling) | Reject | 1 |
| C7 | **New provider kinds and sandbox magic values** (`database`, `businessRegistry`, `domainAge`, `maliciousWebsite`; AAMVA `0001`/`0002`; KYB `0000`/`9999`/`8888`/`7777`; reserved `.example`/`.test` domains), before they go into `docs/checks/sandbox-providers.md` | Confirm | 6 |
| C8 | **Re-tier `business_website_malicious_website_detection`** from R+A to A, and correct the PLAN and THIRD_PARTY_LICENSES rows listed at the top | Accept | 5 |
