# Phase 5: server-side NFC chip verification (eMRTD Passive Authentication and friends)

Researched 2026-10-21 for OpenVerify Phase 5 (server-side Passive Authentication) and Phase 10 (`android/openverify-nfc`). The repository was only read; nothing in it was changed.

**Release-age rule.** A version counts as "at least 14 days old" if it was released on or before 2026-10-07.

**Empirical spike.** Everything marked *(spike)* was run on this machine with:
- Node v22.22.1, which bundles OpenSSL 3.5.5. This is the same Node as `infra/docker/apps.Dockerfile` (`node:22.22.1-bookworm-slim`).
- Python 3.12 with `cryptography` 50.0.2 (its wheel bundles OpenSSL 4.0.3), `asn1crypto` 1.5.1, Pillow 13.0.0 and `opencv-python-headless` 5.0.0.93. The Pillow and OpenCV versions are the ones the vision service already uses.
- The OpenSSL 3.0.13 CLI.

The spike scripts and the synthetic fixtures they produced are outside the repository, in this report's scratchpad folder:
- the spike's scratch scripts (not committed) (`gen_emrtd.py`, `gen_nonder.py`, `verify-spike.mjs`, `verify-nonder.mjs`, `aa-rsa.mjs`, `ml-node.mjs`, `jp2.py`, `py-verify.py`, `node-ec.mjs`, `py-ec.py`);
- its scratch fixtures (not committed).

**Research agents.** Three research agents covered §3 (trust anchors), §6–7 (JMRTD and test data) and §8 (mdoc). Their key claims were spot-checked against the primary sources:
- SCUBA's GPL+Classpath header and JMRTD's LGPL-2.1+ header, read in the downloaded source jars;
- the BSI master-list page and BSI's general terms;
- the ICAO master-list terms;
- Chrome's Digital Credentials API ship date;
- the npm versions they quoted.

## Recommendation summary

1. **Where it runs.** Passive Authentication (PA) runs in the **API worker (TypeScript)**, in a new pure package such as `@openverify/emrtd`.
   - Parse with `asn1js` 3.1.0, plus `pkijs` 3.4.1 (BSD-3) or the `@peculiar/asn1-*` 2.11.0 packages (MIT, already in the lockfile).
   - Do **every** signature check with `node:crypto`.
   - The spike found that WebCrypto-based verification fails on what real passports carry: `pkijs` `verify()` and `@peculiar/x509` `verify()` both fail. `@peculiar/webcrypto` 1.7.1 accepts named brainpool keys but fails on explicit parameters ("Cannot read key info parameters"). OpenSSL path validation and Python `cryptography` fail too. The cause is that Doc 9303-12 §4.1.6.3 *requires* **explicit EC domain parameters**, often on brainpool curves.
   - Node 22.22.1's bundled OpenSSL 3.5.5 handles them. It imported **all 2,259 CSCA keys** in the German, Dutch, Swiss and Italian master lists, 635 of them explicit-parameter EC. It also verified **every certificate whose issuing key was in the same list**.
2. **The vision service only touches pixels.** It decodes DG2 (JPEG / JPEG 2000) and runs SFace. Its Pillow 13.0.0 (bundling OpenJPEG 2.5.4, BSD-2) already decodes JPEG 2000. The only change is to allow `JPEG2000` on a DG2-only path, and to decode only after PA has verified the DG2 hash.
3. **Validate the chain ourselves.** Implement Doc 9303-12 Appendix D's *single-certificate* path validation. Pick the anchor by AKI→SKI, falling back to issuer DN as BSI TR-03135 §4.6.4.3.3 says; real lists need that fallback. Then check issuer name, validity "now", the CRL (D.1.2), link certificates and name changes.
   - Report BSI TR-03135 outcomes: `successful`, `failed`, `undetermined`, `not supported`.
   - **`undetermined` is never `passed`.** Examples are no anchor, no current CRL, or no embedded DSC.
4. **Trust anchors.**
   - Commit and ship none.
   - Pin each source's **issuer CSCA certificate** (stable for years), not the master-list file: BSI republishes about 1.7 times a month, so a file hash goes stale.
   - Verify every downloaded master list cryptographically against the pinned root, and protect against rollback.
   - The default source is the BSI list: commercial use is allowed, with conditions.
   - The Dutch, Italian and Swiss lists are opt-in.
   - The ICAO master list and PKD are gated (CAPTCHA, non-commercial, no robots). Only operator-supplied files can come from there.
   - The owner must decide on the terms (see the last section).
5. **Clone detection.** The only chip-authenticity proof the server can check is **Active Authentication over a server-issued, single-use 8-byte nonce** (DG15 key). Its signature is transferable. The spike verifies both RSA ISO/IEC 9796-2 and ECDSA-plain AA in `node:crypto`.
   - Chip Authentication and PACE-CAM are non-transferable by design. Store them as "device-reported" only.
   - Never trust a device boolean.
   - Add reuse detection: a blind index of the SOD signature.
6. **DG1 and DG2.**
   - DG1 → the existing `parseMrz`, compared with the OCR'd MRZ (`id_nfc_mrz_comparison`). DG1 also feeds `id_nfc_expired_detection`.
   - DG2 → the existing SFace pipeline (`id_nfc_selfie_comparison`, which needs its own calibrated threshold). Optionally also compare DG2 with the printed portrait (TR-03135 §4.7.6).
   - Inspection systems have had to read **ISO/IEC 39794-5** DG2 since 1 Jan 2026 (Doc 9303-10 §4.5.6).
7. **Test data.**
   - **Generate a synthetic "UTO" PKI and LDS deterministically, inside the tests**: seeded keys, RFC 6979 ECDSA and fixed times. No key files and no third-party chip data in git.
   - The spike produced byte-identical output on two runs, except for RSASSA-PSS, whose salt is random.
   - Every public test set found is unusable in git: the BSI TR-03105-5 ReferenceDataSet is non-commercial; JMRTD's test resources and the ICAO WG3 39794-5 "silver" DG2 contain real people's biometrics and/or carry no licence.
8. **Android (Phase 10).**
   - Pin `org.jmrtd:jmrtd` **0.8.9** (2026-10-03), `net.sf.scuba:scuba-sc-android` 0.0.27 and `org.bouncycastle:bcprov-jdk18on` 1.86 (MIT). Drop Spongy Castle and do not register a global provider; JMRTD passes its own Bouncy Castle provider.
   - The repo's licence notes need fixing: JMRTD is **LGPL-2.1-or-later**, not "LGPL-3.0"; `cert-cvc` is another LGPL artefact; SCUBA contains two **GPL-2.0-only WITH Classpath-exception-2.0** files.
   - PACE is now urgent: chips issued from 1 Jan 2027 must have PACE, and BAC issuance ends on 1 Jan 2028.
   - Upload raw EF.SOD, DG1, DG2, DG11, DG12, DG14, DG15, EF.CardSecurity, EF.CardAccess and EF.COM, plus the AA response.
9. **mdoc / verifiable credentials stay a later stretch goal**, outside Phase 5. Build the Phase 5 trust store generically so it can later hold IACA roots too. Wallets gate verifiers per deployer (Apple Business Connect, Google onboarding, EUDI access certificates), and the TypeScript libraries were reorganised in 2026.

---

## 1. Passive Authentication on the server

### 1.1 What the chip gives us (Doc 9303-10 §4.6–4.7)

| File | Tag | What it holds | Signed? |
|---|---|---|---|
| EF.COM | `60` | LDS version (`5F01`), Unicode version (`5F36`), list of present DG tags (`5C`) | **No.** The SOD has no hash of EF.COM. BSI TR-03135 says to check that every DG in EF.SOD is listed in EF.COM, and that EF.COM is deprecated |
| EF.SOD | `77` | CMS `ContentInfo` → `SignedData`, eContentType `id-icao-mrtd-security-ldsSecurityObject` = **2.23.136.1.1.1** | Itself the signature |
| DG1 | `61` → `5F1F` | The whole MRZ, character for character as printed (TD1 90, TD2 72, TD3 88 characters) | Hash in SOD |
| DG2 | `75` → `7F61` (BIT group) → `7F60` (BIT) → `A1` (header) + `5F2E` (ISO/IEC 19794-5) **or** `7F2E` (ISO/IEC 39794-5) | Face image(s) | Hash in SOD |
| DG11 / DG12 | `6B` / `6C` | Extra personal and document details (full name, place of birth, date of issue, …) | Hash in SOD |
| DG14 | `6E` | `SecurityInfos`: Chip Authentication public key and info, PACE info, `ActiveAuthenticationInfo` (the AA signature algorithm for ECDSA) | Hash in SOD |
| DG15 | `6F` | Active Authentication public key (`SubjectPublicKeyInfo`) | Hash in SOD |
| EF.CardAccess | (MF, `011C`) | PACE parameters | **No.** It must be checked against DG14 or EF.CardSecurity |
| EF.CardSecurity | (MF, `011D`) | `SignedData` with eContentType `id-SecurityObject` 0.4.0.127.0.7.3.2.1, signed by the Document Signer. It is required for PACE-CAM | Itself the signature |

Sources:
- Doc 9303-10, 8th ed., consolidated with Amendment 1 (14/6/24), §4.6.1, §4.6.2, §4.7.1, §4.7.2, §4.7.14, §4.7.15, and the EF.CardSecurity text at p. 27: https://www.icao.int/sites/default/files/publications/DocSeries/9303_p10_cons_en.pdf
- BSI TR-03135-1 v2.3 §4.6.4.4.1: https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/TechGuidelines/TR03135/BSI-TR-03135-1-v2-3.pdf

**EF.SOD structure.** Doc 9303-10 §4.6.2 and Appendix D:

```
LDSSecurityObject ::= SEQUENCE {
  version             INTEGER {v0(0), v1(1)},     -- V1 iff ldsVersionInfo present
  hashAlgorithm       DigestAlgorithmIdentifier,
  dataGroupHashValues SEQUENCE SIZE (2..16) OF DataGroupHash,  -- {dataGroupNumber INTEGER, dataGroupHashValue OCTET STRING}
  ldsVersionInfo      LDSVersionInfo OPTIONAL }   -- {ldsVersion PrintableString, unicodeVersion PrintableString}
```

- **Two versions.** V0 is the legacy object (LDS 1.7, Appendix D). V1 is LDS 1.8 and adds `ldsVersionInfo`. Only one EF.SOD is allowed on a chip. A verifier must accept both versions. Our spike fixture uses V1.
- **What the hash covers.** `dataGroupHashValue` is the hash of the **complete** DG EF, including its own tag and length. If the device trims, pads or re-encodes a data group, the hash will not match. Source: Doc 9303-10 §4.6.2.3, Note 1.
- **The `SignedData` profile** (Doc 9303-10 Table 37):
  - `version` is v3.
  - `certificates` must hold the Document Signer certificate.
  - `crls` should be absent.
  - Exactly one `signerInfo` is recommended.
  - `sid` is `issuerAndSerialNumber`, or `subjectKeyIdentifier`.
  - `signedAttrs` is mandatory.
  - `unsignedAttrs` may be ignored.
- **NULL parameters.** `DigestAlgorithmIdentifier` must omit NULL parameters, but inspection systems **must accept both** absent and NULL parameters (Doc 9303-10 §4.6.2.3, Note 2; Doc 9303-12 §9.1).
- **Signed attributes** (RFC 5652):
  - They must contain `contentType`, equal to the eContentType, and `messageDigest`, equal to the hash of eContent (§5.3).
  - The signature input is the DER of `signedAttrs` re-tagged from `[0] IMPLICIT` to the universal `SET OF`, that is, byte `0x31` (§5.4).
  - Use the **original bytes**. Re-encoding them breaks on any SOD whose attributes were not perfectly DER-encoded.
  - Source: https://www.rfc-editor.org/rfc/rfc5652#section-5.4

### 1.2 Algorithms in use (Doc 9303-12 §4.1.6, Doc 9303-11 §6.1.2)

- **Hashes.** SHA-224, SHA-256, SHA-384 and SHA-512 are "the only permitted hashing algorithms" (Doc 9303-12 §4.1.6.4).
  - Older documents still in circulation may carry **SHA-1**. One example is the fixture SOD in `@li0ard/tsemrtd`, whose `hashAlgorithm` is 1.3.14.3.2.26 ([tests/sod.test.ts](https://github.com/li0ard/tsemrtd/blob/main/tests/sod.test.ts)).
  - BSI TR-03105 Part 5.1 v1.5 added a "SHA-1 deprecation profile" ([protocolbench summary](https://blog.protocolbench.org/2020/02/version-1-5-of-bsi-tr-03105-part-5-1-available/)).
  - **Recommendation:** accept SHA-1 only for documents issued before a configurable cut-off date, and report it in check metadata.
- **RSA.** Doc 9303-12 §4.1.6.1 makes RFC 4055 mandatory: issuers "SHOULD" use RSASSA-PSS, and receivers "MUST also be prepared to verify" RSASSA-PKCS1-v1_5.
  - PSS parameters come from the `AlgorithmIdentifier`. When they are absent, RFC 4055 §3.1 defaults apply: SHA-1, MGF1-SHA-1 and a salt of 20.
  - In SODs the SignerInfo `signatureAlgorithm` is often plain `rsaEncryption` (1.2.840.113549.1.1.1). The hash then comes from `digestAlgorithm`. The spike's RSA SOD uses exactly this and verifies.
  - https://www.rfc-editor.org/rfc/rfc4055#section-3.1
- **ECDSA.** X9.62 or ISO/IEC 15946.
  - **"The elliptic curve domain parameters … MUST be described explicitly … no named curves, no implicit parameters … MUST include the optional co-factor. ECPoints MUST be in uncompressed format"** (Doc 9303-12 §4.1.6.3).
  - The Internet PKI forbids exactly this: "specifiedCurve … MUST NOT be used in PKIX" (RFC 5480 §2.1.1, https://www.rfc-editor.org/rfc/rfc5480#section-2.1.1).
  - So **explicit parameters are the norm in eMRTD certificates, not an edge case.** Brainpool curves (RFC 5639) and the NIST P-curves both occur. BSI TR-03111 is the recommended ECC guideline.
- **DSA** under FIPS 186-4 is still allowed (Doc 9303-12 §4.1.6.2). It is rare, and treated as `undetermined` until a real sample appears.
- **Active Authentication signatures are a different format** (Doc 9303-11 §6.1.2):
  - RSA uses **ISO/IEC 9796-2 scheme 1 with message recovery**. The trailer is `0xBC` for SHA-1, otherwise two bytes such as `0x34CC` for SHA-256.
  - ECDSA uses the **plain (r‖s)** format of TR-03111, with the algorithm OID taken from DG14's `ActiveAuthenticationInfo`.
- **Mixed algorithms are normal.** A CSCA can be RSA while its DSCs are ECDSA, and the reverse. Receiving states "MUST support all algorithms" (Doc 9303-12 §4.1.6).

Sources:
- Doc 9303-12 (Amendment 1, 14/6/24): https://www.icao.int/sites/default/files/publications/DocSeries/9303_p12_cons_en.pdf
- Doc 9303-11 (Amendment 2, 23/2/26): https://www.icao.int/sites/default/files/publications/DocSeries/9303_p11_cons_en.pdf
- RFC 5639: https://www.rfc-editor.org/rfc/rfc5639
- BSI TR-03111: https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/TechGuidelines/TR03111/BSI-TR-03111_V-2-1_pdf.pdf

### 1.3 The verification procedure

The inspection steps (Doc 9303-11 §5.1.1) are:
1. Read the SOD, which must contain the DSC.
2. Build and validate a path from a trust anchor to the DSC, as Doc 9303-12 describes.
3. Verify the SOD signature with the DSC key.
4. Hash each data group and compare.

Doc 9303-11 §5.1.1 also lists best-practice checks:
- **DocumentType extension** (OID 2.23.136.1.1.6.2). If it is present, it must be consistent with the document code in DG1 and in the printed MRZ. If it is absent, `keyUsage` must be `digitalSignature` and there must be no EKU.
- **Country codes** must agree across the DSC subject and SAN, the CSCA subject and SAN, DG1 and the visual MRZ.
- **Date of issue.** The date of issue (DG12, when present) should fall inside the DSC's **PrivateKeyUsagePeriod**.

**Path validation** (Doc 9303-12 §6.1 and Appendix D):
- **The path is always a single certificate**: trust anchor (CSCA) → DSC. CSCAs have `pathLenConstraint` 0, and there are no intermediate CAs (Table 6, Note 1).
- **Choose the anchor by the DSC's Authority Key Identifier.** "There could be several Trust Anchors for the CSCA … the one that MUST be used is the one that contains the public key that matches the value of the Authority Key Identifier extension in the certificate being validated" (App. D.1.1.1).
  - BSI TR-03135 §4.6.4.3.3 adds that some countries issue certificates without AKI/SKI. In that case fall back to matching on issuer DN, accept if any matching CSCA verifies, and cross-check the country codes.
- **Checks on the DSC** (App. D.1.1.3 a):
  - the signature verifies with the anchor key;
  - the validity period covers the current time;
  - it is not revoked;
  - its issuer equals the anchor's subject;
  - any critical extension it carries is understood.
  - BSI TR-03135 §4.6.4.3.4 additionally requires the **CSCA** to be valid at verification time, using a reliable time source.
- **Link certificates** (Doc 9303-12 §4.1.4.3):
  - When a CSCA rolls its key, it issues a self-issued link certificate: same issuer and subject, signed by the old key, certifying the new key. A Master List may contain both roots and links.
  - A link certificate whose signature verifies against an already-trusted key needs no out-of-band check. Revoking the old CSCA also revokes the new one (§4.1.5.1).
  - BSI TR-03135 §4.6.4.3.3 warns: "If there is only a CSCA link certificate, the digital signature of this CSCA link certificate SHALL NOT be verified, since the check would fail."
  - Practical rule: import link certificates as additional trust anchors **only after** verifying them against an anchor already held. Otherwise treat them as non-anchors.
- **Lifetimes** (Table 1 and App. A): a DSC private key is used for up to about 3 months, and its certificate lasts about 10 years plus that period. A CSCA key is used for 3–5 years, and its certificate lasts 13–15 years. The `PrivateKeyUsagePeriod` extension is **mandatory** in CSCA, link and DS certificates (Table 6). It must be encoded as GeneralizedTime with at least one of `notBefore` and `notAfter`.
- **CRLs** (Doc 9303-12 §4.1.5, §7.1.4, App. D.1.2):
  - Each CSCA must issue a complete CRL at least every 90 days (and at most every 48 hours), within 48 hours of any revocation, always signed with its *newest* key. There are no partitioned, delta or indirect CRLs.
  - The CRL Distribution Points extension is mandatory and "revocation status checks are a mandatory part of the validation procedure" (§7.1.1.4). Its values point at the PKD (`https://pkddownload1.icao.int/CRLs/<ICAO>.crl`) and/or the issuer's own website.
  - Processing (D.1.2.3):
    1. If no current CRL is available, the result is **UNDETERMINED**.
    2. The CRL issuer's country must match the certificate issuer's country.
    3. The CRL's anchor may be a different key of the same CSCA.
    4. Verify the CRL signature. A failure means **UNDETERMINED**.
    5. If the serial number is listed, the certificate is revoked.
- **Do not use a generic RFC 5280 / Web PKI path builder.** Use Appendix D's subset. The pitfalls in §1.5 explain why.

**Results.** BSI TR-03135 §2.5.2 and §4.6.4 give every partial check one of five values: `successful`, `failed`, `undetermined`, `not supported` or `aborted`. The tables also state how to combine them. For example, a missing DSC or an unknown hash algorithm makes the security object `undetermined`, not `failed` (Table 4.28). The per-DG integrity states are `identical`, `not identical`, `present` (not read), `not present` and `non conformance` (Table 4.42).

**Proposed mapping to OpenVerify statuses** (`packages/core/src/enums.ts`: `passed | failed | not_applicable | pending`):
- `successful` → `passed`.
- `failed` → `failed`.
- `undetermined` → `failed`, with an `undetermined` reason such as:
  - `nfc_trust_anchor_unavailable`;
  - `nfc_crl_unavailable`;
  - `nfc_dsc_missing`;
  - `nfc_algorithm_unsupported`.
- `not supported` → `not_applicable`.

`undetermined` must **never** become `passed` (CLAUDE.md rule 5). Workflows can route `undetermined` to manual review.

### 1.4 Spike: end-to-end server-side PA in Node *(spike)*

`gen_emrtd.py` deterministically generates a test PKI for the fictional ICAO specimen state **UTO**:
- **CSCA A:** brainpoolP256r1 with **explicit domain parameters**, as Doc 9303-12 §4.1.6.3 requires. With it come a link certificate (old key → new key), DSC A, a revoked DSC and a v2 CRL with AKI and cRLNumber.
- **CSCA B:** RSA-3072, which signs RSA-2048 DSC B with **RSASSA-PSS**. DSC B signs the SOD with PKCS#1 v1.5 and uses `rsaEncryption` as the SignerInfo algorithm.
- **LDS files:**
  - EF.COM;
  - DG1, with the Doc 9303 specimen MRZ `P<UTOERIKSSON<<ANNA<MARIA…`;
  - DG2, an ISO/IEC 19794-5 record holding a synthetic gradient JPEG 2000;
  - DG14, with `ActiveAuthenticationInfo` for ecdsa-plain-SHA256;
  - DG15, a P-256 Active Authentication key;
  - three EF.SODs;
  - an Active Authentication response to a fixed 8-byte nonce.

`verify-spike.mjs` parses with **pkijs 3.4.1 and asn1js 3.1.0** and does every signature check with **`node:crypto`** (`createPublicKey` from SPKI DER, then `crypto.verify`). Results:

| Case | Result |
|---|---|
| A: brainpool explicit, ECDSA SOD | DG1/2/14/15 hashes `match`; `messageDigest` ✔; `contentType` ✔; SOD signature ✔; anchor found by AKI ✔; DSC signature ✔; CRL → `UNREVOKED` |
| B: RSA DSC with an RSASSA-PSS-signed certificate; PKCS#1 v1.5 SOD with an `rsaEncryption` SignerInfo | all ✔ |
| Revoked DSC | signature ✔, CRL → `REVOKED` |
| One bit flipped in DG1 | DG1 `MISMATCH`, the others `match` |
| Wrong trust store | `trustAnchorFound: false` |
| Link certificate verified with the old CSCA key | ✔ |
| AA, ECDSA plain (`dsaEncoding: 'ieee-p1363'`) over the server nonce, with the DG15 key | ✔; with a different nonce ✘ |
| AA, RSA ISO/IEC 9796-2 scheme 1, SHA-1 and SHA-256 trailers (`aa-rsa.mjs`, raw RSA via `publicDecrypt(RSA_NO_PADDING)`) | ✔; a replay with a new nonce ✘ |
| **`pkijs` `SignedData.verify()`** (its WebCrypto engine), brainpool explicit | **✘** "Incorrect type for ECDSA public key parameters" |
| `pkijs` `SignedData.verify()`, RSA | ✔ |
| **`@peculiar/x509` `X509Certificate.verify()`** (WebCrypto), brainpool explicit | **✘ returns `false`** |
| Node `X509Certificate.verify()`, brainpool explicit and RSA-PSS | ✔ ✔ |
| **OpenSSL 3.0.13 `openssl verify -CAfile csca-a.pem dsc-a.pem`** | **✘** "error 94 … Certificate public key has explicit ECC parameters" (same with and without `-x509_strict`) |
| OpenSSL `openssl cms -verify -noverify` on all three SODs | ✔ (an independent cross-check of our encoding) |

**Two more spike results:**

- **Non-DER signed attributes** (`gen_nonder.py`, `verify-nonder.mjs`). I signed a SOD over a `signedAttrs` SET with a non-minimal (BER) length.
  - `pkijs` with `signedAttrs.encodedValue` (the original bytes) plus `node:crypto`: **verifies ✔**.
  - **`openssl cms -verify` fails**, because it re-encodes the attributes as DER before checking.
  - Lesson: always verify over the received bytes.
- **Real CSCA master lists** (`ml-node.mjs`). These are the four lists the trust-anchor agent downloaded (§3), parsed with `pkijs`, `asn1js` and `node:crypto`; the run took 4.6 s in total.

  | Master list | Keys imported | Explicit-parameter EC keys | Verified against a key in the same list | Issuing key not in the list |
  |---|---|---|---|---|
  | DE | 609/609 | 172 | 597 | 11 links + 1 LV link without AKI |
  | NL | 413/413 | 115 | 413 | 0 |
  | CH | 567/567 | 158 | 555 | 11 + 1 |
  | IT | 670/670 | 190 | 655 | 12 + 3 (LV, LT) |

  - Curves seen: brainpoolP256r1/P384r1/P512r1 and P-256/384/521.
  - The "issuing key not in the list" entries are link certificates whose old key is no longer in the list. A typical example is LV `serialNumber=004→005`, which has no AKI and `pathlen:1` (non-conformant). They are not crypto failures.
  - The AKI→SKI lookup needed the **issuer-DN fallback** for the 80–113 certificates per list that have no AKI. Estonia's link certificates only verify that way.
  - One of the four lists had a certificate whose SKI extension `pkijs` could not parse, so the parser must tolerate bad extensions per certificate.
  - **`asn1js` 3.1.0 caps parsing at `maxNodes` 10,000 by default**, and parsing a master list failed with "Maximum ASN.1 node count exceeded". Pass explicit `{maxNodes, maxDepth, maxContentLength, parseEmbedded:false}` for master lists, and keep the tight defaults for untrusted chip uploads. The limits are new in 3.1.0 (README "Parsing Untrusted Input"); 3.0.10 has none.

`py-verify.py` and `py-ec.py` test Python. `cryptography` 50.0.2 **refuses** the explicit brainpool key: "ECDSA keys with explicit parameters are only supported when they map to secp256r1, secp384r1, or secp521r1. No custom curves are supported." The cryptography 47.0.0 changelog says the same (https://cryptography.io/en/latest/changelog/). Verification only works after our own code maps the explicit parameters to a named curve through asn1crypto, and then rebuilds the key from the point.

### 1.5 Pitfalls (with sources)

1. **Explicit EC parameters**, mandatory in eMRTD (§1.2):
   - **OpenSSL ≥ 3.0 path validation (`X509_verify_cert`) always rejects them**, with `X509_V_ERR_EC_KEY_EXPLICIT_PARAMS`. In 1.1.1 this applied only in strict mode. OpenSSL maintainers called it intentional ("Explicit curve parameters are dangerous") and said a flag to re-enable them is "very unlikely". The workaround is a verify callback (https://github.com/openssl/openssl/issues/20117). The same failure is reported for ICAO CSCAs in rust-openssl (https://github.com/sfackler/rust-openssl/issues/2220).
   - **Python `cryptography` only maps explicit parameters to P-256/384/521** (spike and changelog).
   - **WebCrypto supports only P-256/384/521 named curves**, so it cannot load brainpool at all, nor explicit-parameter keys (https://nodejs.org/docs/latest-v22.x/api/webcrypto.html, `EcKeyImportParams.namedCurve`). That rules out `pkijs.verify` and `@peculiar/x509.verify` (spike).
   - **Node `crypto.createPublicKey` (OpenSSL 3.5.5) imports explicit brainpool parameters and recognises them as `brainpoolP256r1`** (spike, `node-ec.mjs`).
2. **Distro OpenSSL builds can lack brainpool.**
   - RHEL 7/8 OpenSSL disabled the brainpool curves through a patch. Fedora (openssl-3.0.8-2, F39) and RHEL 9 re-enabled them in 2023 (https://bugzilla.redhat.com/show_bug.cgi?id=2132679, https://packages.fedoraproject.org/pkgs/openssl/openssl/fedora-39.html). RHEL also restricts explicit curves (https://issues.redhat.com/browse/RHEL-5304).
   - Official Node binaries bundle their own OpenSSL, so our container is safe. A self-hoster running a distro-built `nodejs` might not be.
   - **Recommendation:** run a self-test at worker start that imports an explicit-parameter brainpool P-256/384/512 SPKI and verifies a known signature. If it fails, PA reports `undetermined` (`nfc_algorithm_unsupported`) instead of silently failing.
   - `@noble/curves` 2.4.0 (MIT, audited by Cure53) exports `brainpoolP256r1/384r1/512r1` from `@noble/curves/misc.js`. Its weierstrass factory also accepts arbitrary explicit curves, so it is a pure-JS fallback if ever needed (README, https://github.com/paulmillr/noble-curves).
3. **No DSC embedded, or a wrong signer identifier.**
   - Doc 9303 says the DSC MUST be included. BSI TR-03135 §4.6.4.2.1 still requires systems to handle "one, several or no DS certificate(s)", and to look DSCs up in trusted Document Signer lists. §4.8.2.2.4 adds the "Wrong Signer Identifier" defect.
   - Without the ICAO PKD's DSC download (see §3) this is `undetermined` (`nfc_dsc_missing`).
   - Match the signer by `issuerAndSerialNumber` or by `subjectKeyIdentifier`, and also try every embedded certificate.
4. **Unusual or invalid encodings.**
   - BSI TR-03135 §4.8.2 lists production defects that real documents carry:
     - "Document Signer Certificate incorrectly encoded or malformed";
     - "Document Security Object Malformed" (where a failed signature must be `undetermined`, not `failed`);
     - "EF.COM and EF.SOD Discrepancy";
     - "Issuing Country Defect", such as a 3-letter code where a 2-letter one is expected;
     - "Validity Period Incorrect".
   - States publish these through BSI Defect Lists (TR-03129-2) and ICAO Deviation Lists (Doc 9303-12 §10).
   - Defensive parsing:
     - accept BER as well as DER in outer containers, including long-form lengths and trailing bytes after the `77` TLV;
     - always hash and verify **original byte ranges**: the signed attributes, the TBS certificate and the DG files. OpenSSL's `cms -verify` re-encodes signed attributes and so fails on non-DER ones; the original-bytes path passes (spike, §1.4);
     - accept NULL or absent digest parameters;
     - accept `rsaEncryption` as a signature algorithm;
     - accept PSS without parameters (RFC 4055 defaults).
   - Doc 9303-12 §7.1 also requires inspection systems to handle certificates made to the **earlier (6th-edition) profiles** in its Appendix C.
5. **Validity time.** Doc 9303-12 App. D and BSI TR-03135 validate at the **current time**, not at signing time.
   - A DSC valid for about 10 years plus 3 months normally outlives the document. If a DSC has expired while the document has not, the issuer made a mistake ("Validity Period Incorrect" defect → `undetermined`).
   - Do **not** silently switch to a chain model.
6. **Name changes.** A CSCA may change its DN through a link certificate carrying the `nameChange` extension (2.23.136.1.1.6.1). For CRLs, matching the **country** is enough (Doc 9303-12 App. D.1.2.3 b, D.3).
7. **Hash-algorithm mismatch.** The LDS `hashAlgorithm` (used for the DG hashes) and the SignerInfo `digestAlgorithm` (used for signedAttrs and `messageDigest`) can differ. Use each in its own place.
8. **EF.CardAccess is unsigned.** Doc 9303-11 §4.2 says the inspection system "MUST verify the authenticity of the contents of EF.CardAccess using EF.DG14 or EF.CardSecurity". On the server, check that the uploaded EF.CardAccess SecurityInfos are present in DG14 (hash-verified) or in EF.CardSecurity (signature-verified).
9. **`@peculiar/x509` needs a global `reflect-metadata` polyfill.** `tsyringe` throws at import time without it (spike). This is one more reason to verify with `node:crypto` and use the `@peculiar/*` or `pkijs` packages only as parsers.

---

## 2. Libraries and where the code should live

### 2.1 TypeScript (npm registry and tarball LICENSE files, read 2026-10-21)

| Package | Latest (date) | Newest ≥14 days old (date) | Licence (verified in the tarball) | In our lockfile now? | Role / notes |
|---|---|---|---|---|---|
| **`pkijs`** | 3.4.3 (2026-10-21) | **3.4.1** (2026-09-20) | BSD-3-Clause (GlobalSign / Peculiar Ventures LICENSE) | no | **Parser**: keeps the original `signedAttrs` bytes (`encodedValue`) and `tbsView`. Its `verify()` cannot handle eMRTD EC keys. 3.4.2 and 3.4.3 are small bug fixes (KeyTrans error propagation; minimal DER for ECDSA r and s), and 3.4.1 added OCSP checks ([releases](https://github.com/PeculiarVentures/PKI.js/releases)). `engines.node >=16`. Pins `@noble/hashes` **1.8.0** exactly (MIT; a nested duplicate). Dependencies: `asn1js`, `bytestreamjs` (BSD-3), `pvutils` and `pvtsutils` (MIT), `tslib` (0BSD) |
| **`asn1js`** | 4.0.0 (2026-10-19, major) | 3.0.10 (2026-04-20) | BSD-3-Clause | **3.1.0** (2026-10-16) | Generic BER/DER parser that keeps `valueBeforeDecode`. 3.1.0 added limits for untrusted input (`maxNodes` default 10,000, `maxDepth`, `maxContentLength`, `parseEmbedded`). That is good for chip uploads, but it must be raised for master lists (§1.4). Use the locked 3.1.0, which is 5 days old, rather than the limit-less 3.0.10. Stay on 3.x; 4.0.0 is a new major only 2 days old |
| **`@peculiar/asn1-cms`, `-x509`, `-schema`, `-ecc`, `-rsa`** | 2.11.0 (2026-10-12) | 2.10.0 (2026-09-27) | MIT | **2.11.0** | Typed schema classes; `@li0ard/tsemrtd` builds on them. Re-serialisation is DER, so take original bytes from elsewhere |
| `@peculiar/x509` | 2.2.0 (2026-10-15) | 2.1.0 (2026-09-04) | MIT | **2.2.0** | Parsing is fine. **Do not use `verify()`** (WebCrypto). Needs `reflect-metadata` |
| `@peculiar/webcrypto` | 1.7.1 (2026-05-01) | 1.7.1 | MIT | no | Imports **named** brainpool keys, but explicit-parameter keys fail with "Cannot read key info parameters" (spike). Not needed |
| `@noble/curves` | 2.4.0 (2026-08-27) | 2.4.0 | MIT | no | Optional pure-JS brainpool and custom-curve fallback (see §1.5 #2) |
| `@li0ard/tsemrtd` | 0.3.5 (2026-09-28) | 0.3.5 | MIT | no | Parser for EF.COM, DG1–DG15 (19794 **and** 39794 faces) and EF.SOD; no verification. One maintainer, 7 stars. Its `tests/dgs` redistributes the ICAO WG3 DG2 silver datasets, which carry no licence (see §6). Useful as a reference; not recommended as a dependency ([repo](https://github.com/li0ard/tsemrtd)) |
| `@gwydion-id/icao-9303-models` | 0.1.4 (2026-09-22) | — | **LGPL-3.0-or-later** | no | ❌ licence |

Repository activity, from the GitHub API on 2026-10-21:

| Repository | Stars | Last push | Open issues |
|---|---|---|---|
| PKI.js | 1,401 | 2026-10-21 | 79 |
| ASN1.js | 300 | 2026-10-21 | 8 |
| asn1-schema | 45 | 2026-10-12 | 10 |
| x509 | 137 | 2026-10-15 | 33 |
| noble-curves | 965 | 2026-09-08 | 3 |

**Recommended TypeScript stack:**
- Parse with **`asn1js` (3.1.0, already locked) plus `pkijs` 3.4.1**, or with `asn1js` plus the already-locked `@peculiar/asn1-cms` and `@peculiar/asn1-x509` 2.11.0, taking raw byte ranges from `asn1js` `valueBeforeDecode`.
- Do **all** cryptography with **`node:crypto`**:
  - `createPublicKey({format:'der', type:'spki'})`;
  - `crypto.verify(hash, data, key, sig)`;
  - `{padding: RSA_PKCS1_PSS_PADDING, saltLength}` for PSS;
  - `{dsaEncoding:'ieee-p1363'}` for plain ECDSA;
  - `publicDecrypt(RSA_NO_PADDING)` for 9796-2 AA.
- The `@peculiar` route adds **no new packages** to the lockfile. `pkijs` adds four: `pkijs`, `bytestreamjs`, `pvutils` 1.x and `@noble/hashes` 1.8.0, all BSD-3 or MIT.
- Either way the eMRTD-specific code is small: TLV unwrapping, `LDSSecurityObject`, DG1/DG2/DG14/DG15 parsing, Appendix D path validation, AA. It is easy to cover at 80% or more with the synthetic fixtures (§6).
- Node-side caveat for `node:crypto` PSS: it uses the same hash for MGF1 as for the message. A PSS `AlgorithmIdentifier` whose MGF1 hash differs from its message hash must be reported as `undetermined`. The spike checks for this.

### 2.2 Python (PyPI JSON, 2026-10-21)

| Package | Latest (date) | Newest ≥14 days old | Licence | Notes |
|---|---|---|---|---|
| `cryptography` | 50.0.2 (2026-09-30) | 50.0.2 | Apache-2.0 OR BSD-3-Clause | Brainpool works with **named** curves only. Explicit parameters only for P-256/384/521 (§1.4) |
| `asn1crypto` | 1.5.1 (2022-03-15) | 1.5.1 | MIT | Mature, but no release since 2022 (58 open issues, last push 2026-07-18). Parses `SpecifiedECDomain` |
| `pyasn1` / `pyasn1-modules` | 0.6.4 (2026-07-09) / 0.4.2 (2025-03-28) | same | BSD-2-Clause / BSD | Lower-level |
| `pymrtd` (ZeroPass) | not on PyPI (404); GitHub v0.6.6 | — | **LGPL-3.0** plus a commercial licence | ❌ licence. It verifies SOD, DSC and ISO 9796-2 AA, so it is useful as a reference only (https://github.com/ZeroPass/pymrtd) |

**Verdict: the API (TypeScript worker) is the better home. The vision service only handles DG2 pixels.** Reasons:
1. **Algorithm coverage for free.** Node's bundled OpenSSL loads ICAO explicit brainpool parameters, while Python `cryptography` rejects them (spike). A Python implementation would need its own explicit→named curve table and key rebuild. That is security-critical code we would have to own.
2. **No new dependencies.** `asn1js` and the `@peculiar/asn1-*` packages are already in `pnpm-lock.yaml` through `@simplewebauthn/server`, and are already listed in THIRD_PARTY_LICENSES.md.
3. **Trust belongs with the decision.**
   - The trust store holds CSCA anchors, link certificates, CRLs and their verification state. It is configuration with an audit trail and belongs in Postgres next to the check registry, decision engine and audit log.
   - The vision service is a stateless ML worker behind a service token (`services/vision/src/openverify_vision/auth.py`). It should not hold trust anchors or make trust decisions.
   - `packages/checks` is consumed only by `apps/api`. `node:crypto` is already used in `packages/db` and `packages/node`.
4. **Suggested layout.**
   - A new pure package **`@openverify/emrtd`** (`packages/emrtd`) holds the parsers, PA, AA and Appendix D validation, with no I/O.
   - Check evaluators for the four `id_nfc_*` checks go in `packages/checks`.
   - Trust-store tables, the master-list importer and the CRL cache go in `packages/db` and `apps/api`.
   - The vision service gets one change: a DG2 path that accepts **JPEG 2000** (`imaging.py` currently allows only `JPEG`, `PNG` and `WEBP` through Pillow's `formats=`).

---

## 3. CSCA trust anchors

**What Doc 9303 requires:**
- **Out-of-band trust.** "For the initial public key obtained from a CSCA, trust MUST be established through an out-of-band mechanism". Later keys may be accepted through link certificates (Doc 9303-12 §6.1.1).
- **A master list is a signed list of CSCA certificates "trusted" by the receiving State that publishes it.** It is CMS `SignedData` with eContentType `id-icao-cscaMasterList` **2.23.136.1.1.2**, wrapping `CscaMasterList ::= SEQUENCE { version INTEGER (v0), certList SET OF Certificate }`. It is signed by a **Master List Signer**, whose certificate has EKU **2.23.136.1.1.3** and must be inside the list together with its CSCA (§5.3, §7.1.1.3, §9).
- **A list conveys no trust by itself.** "a receiving State making use of Master Lists MUST still determine its own policies for establishing trust" (§5.3).
- **The PKD is meant to be open.** Doc 9303-12 §5.1.2 says PKD read access "SHALL be available to PKD participants and non-participants. Access control SHALL NOT be implemented". The real download site does not follow that (below).

### 3.1 Sources

All checked 2026-10-21. The trust-anchor research agent downloaded the four free lists into a scratch folder outside the repository (never committed).

| Publisher | Download | Format | Gate / terms | Cadence | Size, SHA-256 (today) |
|---|---|---|---|---|---|
| **BSI (Germany)** | Page https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.html; file `…/GermanMasterList.zip?__blob=publicationFile` (the bare `.zip` returns HTML) | zip containing `DE_ML_2026-10-01-11-50-52.ml` (DER CMS) | **No click-through.** The page says commercial use is allowed if you do not advertise with the list and do not give "den Anschein einer Kooperation mit dem BSI" (re-checked). BSI's general terms (https://www.bsi.bund.de/DE/Service/Nutzungsbedingungen/Nutzungsbedingungen_node.html) add: §II downloads are non-commercial unless BSI consents, and "nur unverändert"; §VII mirroring needs prior written consent (re-checked). No open-data licence | Current list 2026-10-01: 609 certificates from 119 issuers. The BSI file version went from v=17 (Jan 2022) to v=112, about **1.7 republications a month**. BSI's `v=` parameter only defeats caching, so old versions cannot be fetched | zip 521,335 B `a0d2b448…a6a`; .ml 934,771 B `2bc0f28b…a9f` |
| **Netherlands** (Justid PKD department for RvIG) | https://www.npkd.nl/masterlist.html → https://www.npkd.nl/files/ml/NL_MASTERLIST.mls | DER CMS | No click-through. Footer only: "All rights reserved © 2026" | Signed 2025-07-29, 2025-12-20, 2026-10-20 | 627,000 B `4b9d0604…0dc`. **The page's own published SHA-256 and count (411) did not match the served file (413 certificates)**, which is another reason not to pin the file |
| **Italy** (Ministry of the Interior) | https://csca-ita.interno.gov.it/html/csca.html → `…/certificatiCSCA/IT_MasterListCSCA.zip` | zip containing a .ml | No terms on the site. Italian CAD art. 52(2) may make unlicensed public-body data open by default; needs legal review | Signed 2026-09-07 | .ml 1,024,451 B `70eeab7e…14e` |
| **Switzerland** (fedpol / BIT) | https://www.bit.admin.ch/en/sg-pki-csca-production-en → https://www.pki.admin.ch/MasterList/Current-Swiss-MasterList.ml | DER CMS | Federal site terms: "Any reproduction requires the prior written consent" (https://www.admin.ch/gov/en/start/terms-and-conditions.html) | Signed 2026-07-16 | 868,144 B `9e6d9751…2d2` |
| **ICAO Master List** | https://www.icao.int/icao-pkd/icao-master-list | .ml | **Gated:** an "I agree" form plus reCAPTCHA. Terms: no copying or downloading "except for your own personal/ organizational non-commercial use"; no "resell, publish, repackage or otherwise disseminate"; no "robot, spider or other automatic device" (https://www.icao.int/sites/default/files/Security/FAL/icao-pkd-icao-master-list-terms-and-conditions.html, re-checked) | "updated at 3-monthly intervals". Signed by an ICAO signer under a UN CSCA, available to States on request | **Not downloaded** |
| **ICAO PKD download** | https://download.pkd.icao.int/ → https://pkddownload.icao.int/ | LDIF: DSCs and CRLs, master lists, deviation lists | **Gated:** a checkbox plus an image CAPTCHA; same non-commercial, no-dissemination, no-robots terms | Continuous | **Not downloaded** |

**PKD membership.** Only States and other document issuers can be participants. Everyone else is a "User".
- 2026 fees: US$15,900 registration plus US$18,421.85 a year (https://www.icao.int/sites/default/files/2026-02/B-Fin-255-PKD-Fee-Schedule-2026_0.pdf; MoU https://www.icao.int/sites/default/files/2025-06/MoU-FINAL.Version-8-dated-1-January-2016_1.pdf).
- A private-sector pilot was limited to 50 companies; enrolment closed on 2026-08-16. A paid programme is expected in 2027 (https://www.icao.int/icao-pkd/private-sector-pilot).

**Other national publishers:**
- Austria, the UK and Sweden publish CSCA certificates and CRLs but no master list.
- Malta's site was Cloudflare-blocked.
- Nigeria's master-list link returns 404.
- No public list was found for Spain, France, Hungary or Canada.

**Coverage.** Across the four free lists there are 714 unique certificates for 136 `C=` values; 323 certificates are in all four. Contents differ between lists. For example, only Italy carries GM, KG, KP, SL and XO.

### 3.2 What the real lists contain (agent's asn1crypto count, matched by the Node spike in §1.4)

| | DE | NL | IT | CH |
|---|---|---|---|---|
| Certificates / distinct `C=` | 609 / 117 | 413 / 129 | 670 / 136 | 567 / 100 |
| Signature: PKCS#1 v1.5 / PSS / ECDSA | 312 / 133 / 164 | 204 / 91 / 118 | 344 / 142 / 184 | 305 / 114 / 148 |
| …of which signed with SHA-1 | 36 | 27 | 48 | 41 |
| EC keys explicit / named | **172 / 4** | 115 / 3 | 190 / 7 | 158 / 4 |
| Link certificates (AKI ≠ SKI) | 222 | 0 | 234 | 210 |
| Expired on 2026-10-21 | 2 | 0 | 3 | 15 |
| Master list signer key | ECDSA brainpoolP256r1, explicit | RSA-4096 | RSA-2048, PSS-SHA512 | ECDSA brainpoolP256r1, explicit |

CRL distribution points in the German list:
- 150 certificates name **none**;
- **123 name only the ICAO PKD URL**, which sits behind the gated terms;
- 275 name only a national URL;
- 61 name both.

So revocation will be **undetermined** for roughly a fifth to a third of issuers unless the owner accepts the ICAO terms.

### 3.3 Verifying a master list

The agent tested this on all four lists:
1. Get the publishing State's **CSCA certificate from its own website** and compare its published fingerprint.
   - DE CSCA07: SHA-256 `20:84:AE:D7:…:91:AD:A8`, on the BSI root-certificate page https://www.bsi.bund.de/EN/Themen/Oeffentliche-Verwaltung/Elektronische-Identitaeten/Public-Key-Infrastrukturen/CSCA/Root_Cert_Germany/Root_Certificate_node.html, together with the CSCA06→07 link certificate. Its key usage ends 2027-12-01 and the next rollover is "planned for 2027".
   - NL serial 7 and CH 2023/2026 fingerprints are on their own pages.
   - Italy publishes only a SHA-1 fingerprint.
   - Never use the CSCA embedded in the list as its own trust anchor.
2. Parse `ContentInfo` → `SignedData` (v3). Require eContentType 2.23.136.1.1.2, and require the signed `contentType` attribute to match.
3. Find the signer by `sid`: an SKI for DE and NL, issuer and serial for IT and CH.
4. Check the signer certificate:
   - its EKU contains 2.23.136.1.1.3 and its key usage is `digitalSignature`;
   - it is valid at `signingTime`;
   - its AKI equals the pinned CSCA's SKI, or a link chain reaches it;
   - its signature verifies.
5. Fetch the CSCA's CRL from the signer certificate's distribution point. The German one, `http://www.bsi.bund.de/csca_crl`, redirects to `http://download.gsb.bund.de/BSI/crl/DE_CRL.crl`; today's copy is number 40, valid to 2027-01-18. Verify the CRL and check that the signer is not on it.
6. Check `messageDigest` = H(eContent). Verify the SignerInfo signature over the **original** signed-attribute bytes, re-tagged as SET.
7. **Anti-rollback:** reject a list whose `signingTime` is older than the last accepted one.
8. Import `certList` as **candidate** anchors, recording which list each came from.

**Tooling results:**
- The OpenSSL 3.0 CLI verified the RSA-signed lists (NL, IT) with `cms -verify`. It failed on DE and CH with error 94 (explicit parameters).
- `openssl dgst` and `node:crypto` verified all four.

### 3.4 Recommendation: how OpenVerify gets trust anchors without committing them

- **Commit and ship nothing.** No master list, CSCA or CRL goes into git or a container image, and no CDN mirror. That respects BSI §VII, the Swiss terms and ICAO's terms.
- **Operator-run sync** using the same TypeScript verification code as PA (`node:crypto` handles the explicit-parameter signer keys):
  - for example `pnpm --filter @openverify/api trust-anchors:sync`, alongside `retention:run`;
  - a thin `scripts/fetch-trust-anchors` wrapper to fit the `scripts/fetch-*` rule;
  - a scheduled BullMQ job that refreshes lists and CRLs.

  A standard-library-only Python fetcher like `fetch_models.py` cannot verify brainpool signatures.
- **Pin the root, not the file.** The fetch manifest, a committed and reviewable JSON like `models/manifest.json`, holds per source:
  - the stable master-list URL;
  - the publisher's CSCA certificate URL **and its SHA-256**;
  - the expected eContentType and signer EKU.

  The sync runs §3.3 and accepts a new CSCA only through a link certificate that verifies under the pinned key. It writes the accepted list's SHA-256, `signingTime` and certificate count to an **uncommitted** local lock file and to the database (audit trail).

  This keeps the spirit of "pinned SHA-256": the trust root is pinned and every list is cryptographically bound to it. A file hash would go stale within weeks.
- **Default sources:**
  - BSI only, since it is the only one with an explicit commercial-use statement;
  - NL, IT and CH opt-in after the owner's legal review;
  - ICAO only as an **operator-supplied file**, an "import a master list I obtained under my own agreement" path with no automated download. The import still verifies the signature against an operator-pinned UN or ICAO CSCA.
- **Merge policy:** default to accepting a CSCA found in at least one verified list. Keep per-anchor provenance and allow a per-country deny list.
- **CRLs:**
  - fetch per CSCA from the distribution points (national URLs only, unless ICAO is enabled);
  - cache them and refresh before `nextUpdate`;
  - treat a stale CRL as no CRL, which makes revocation UNDETERMINED (App. D.1.2.3).
- **Sandbox:** the synthetic UTO test CSCA (§6) is seeded only into sandbox environments, and the import code refuses it in production.

---

## 4. Chip access and chip authenticity: what runs on the device, and what the server can prove

| Mechanism | Where it runs | What the server can verify afterwards | Source |
|---|---|---|---|
| **BAC** (3DES, keys from document number, date of birth and expiry) | Device ↔ chip only | Nothing directly. Success only shows that the device knew an MRZ the chip accepts. **Server equivalent:** DG1 (hash-verified) equals the MRZ OCR'd from the photographed document (`id_nfc_mrz_comparison`) | Doc 9303-11 §4.3 |
| **PACE** (MRZ or CAN; GM, IM or CAM mappings) | Device ↔ chip only | Nothing directly. **Timeline (Amendment 2, 23/2/26):** PACE is mandatory in chips issued from **1 Jan 2027**; BAC-only issuance stops from **1 Jan 2028**; all BAC documents are out of circulation by **1 Jan 2038**. The Android SDK must support PACE now | Doc 9303-11 §4.1 |
| **Passive Authentication** | **Server** (re-run) | Everything in §1. It proves the data is authentic and unmodified. It "does not prevent exact copying of the contactless IC's content or chip substitution" | Doc 9303-11 §5 |
| **Active Authentication** (DG15 key; INTERNAL AUTHENTICATE over an **8-byte** RND.IFD) | Device sends the nonce; chip signs | **Yes, fully.** The **server issues the nonce**, the device passes it to the chip, uploads the response, and the server verifies it with the DG15 key (whose hash PA has verified). The signature is transferable: this is the "challenge semantics" in App. C. Nonces must not be reused, including the BAC/PACE nonce. RSA uses ISO/IEC 9796-2 scheme 1, recovering M1 and checking H(M1‖RND.IFD); ECDSA uses plain r‖s. The spike verifies both in `node:crypto` | Doc 9303-11 §6.1, App. C |
| **Chip Authentication** (v1; static DH/ECDH key in DG14) | Device ↔ chip | **No.** It is ephemeral-static key agreement that ends in fresh secure-messaging keys. "Challenge Semantics are prevented because the transcripts produced by this protocol are non-transferable." A client could fabricate any "CA succeeded" claim or transcript. The server can only check that DG14 is hash-valid and that the CA key exists | Doc 9303-11 §6.2 |
| **PACE-CAM** (EF.CardSecurity CA key) | Device ↔ chip | **No.** The server could check PK_Map,IC = KA(CA_IC, PK_IC) from uploaded values, but anyone holding PK_IC can produce a consistent pair (pick CA_IC, compute PK_Map), because the server did not take part in the key agreement. The server *can* verify EF.CardSecurity's signature (PA on it) | Doc 9303-11 §4.4.3.5, §6 |
| **Terminal Authentication / EAC** (DG3 fingerprints, DG4 iris) | Needs CVCA/DV certificates from the issuing states | Not available to OpenVerify. Skip DG3 and DG4 | Doc 9303-11 §7; Doc 9303-12 §4.2 |

BSI says the same in TR-03110-1 v2.20 (https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/TechGuidelines/TR03110/BSI_TR-03110_Part-1_V2-2.pdf):
- PA "does not prevent cloning of MRTD chips" (p. 5);
- CA transcripts "are non-transferable" (p. 15);
- an AA signature is "a transferable proof" (App. B).

**Options to make CA verifiable on the server** (decision for a later phase):
- **(a) Remote APDU relay.** The server acts as the inspection system: it derives the BAC/PACE keys from the MRZ, runs CA and holds the session keys, while the phone only tunnels APDUs. This is a significant protocol and latency project.
- **(b) Accept CA as `device-reported`.** Record it as metadata only, so it can never pass a check on its own.

**Recommendation for `id_nfc_chip_authentication_detection`:**
- It passes **only** on a server-verified AA over a server nonce.
- If the chip has no DG15 (for example many EU passports, which rely on EAC/CA), the result is `not_applicable` with reason `nfc_chip_auth_not_server_verifiable`. The device's CA claim goes into metadata.
- Following BSI TR-03135 Table 4.23, one successful protocol is enough. Processing sequence 1 (TR-03135 §4.6.2.1) is: if DG14 has CA parameters, run CA; otherwise, if DG15 exists, run AA. Both can be run.

**What the server must not trust from the device:**
- any boolean or status ("PA ok", "CA ok", "AA ok", "chip genuine");
- hashes the device computed;
- the device's choice of DSC or CSCA;
- decoded images or parsed fields (re-parse DG1 and DG2 from raw bytes on the server);
- the MRZ the device used for BAC/PACE;
- the AA nonce: only the server's own, unexpired, unused nonce bound to this verification counts;
- timestamps.

**Clone detection: what PA alone does not prove.** PA proves that the bytes were signed by a trusted issuer. It does not prove:
- that a chip was present: the data could have been copied from someone else's passport (for example a hotel scan) and replayed by a modified app or a chip emulator;
- that the chip belongs to this physical booklet;
- that the holder is the person in DG2.

Mitigations in order of strength:
1. Server-nonce AA, where DG15 exists.
2. DG2 ↔ selfie match together with liveness (`id_nfc_selfie_comparison` plus the Phase 4 liveness checks).
3. DG1 ↔ OCR'd MRZ, and DG2 ↔ the printed portrait (BSI TR-03135 §4.7.6), which tie the chip to the photographed booklet.
4. **Reuse detection.** Keep a keyed blind index (the repo already has `blind-index` infrastructure) of the SOD signature value and the DG1 hash. The same chip data in two inquiries with different selfies is a strong replay signal.
5. Android app integrity (Phase 10 Play Integrity adapter).

Relay attacks, where a genuine chip far away answers through a relay, defeat AA alone. The selfie-to-DG2 match is what ties it back to the person.

---

## 5. DG1 and DG2

**DG1 → MRZ.**
- DG1 is `61` → `5F1F` → the MRZ as one string with no line breaks: 90 characters (TD1), 72 (TD2) or 88 (TD3). It is identical to the printed OCR-B MRZ (Doc 9303-10 §4.7.1).
- Split it into 30-, 36- or 44-character lines and pass them to the existing `parseMrz` in `packages/checks/src/mrz.ts`, which handles TD1/TD2/TD3 and MRV-A/B. Do **not** apply the C31.3 OCR corrections to chip data: it is exact text.
- `id_nfc_mrz_comparison` compares field by field (document code, issuer, number, nationality, DOB, sex, expiry, optional data, names) with the consolidated OCR MRZ.
  - Any mismatch fails, but the reason codes distinguish a name-truncation difference from a number or date difference.
  - The `nfc` extraction source and its consolidation precedence already exist (`packages/core/src/extraction.ts`, `packages/checks/src/extraction/consolidate.ts`).
  - `id_nfc_expired_detection` then consumes the DG1 expiry.
  - Also cross-check the DG1 issuer against the DSC and CSCA country (Doc 9303-11 §5.1.1, best practice 2; BSI TR-03135 §4.6.4.5, which needs an ICAO 3-letter ↔ ISO 2-letter table; `packages/checks/src/country-codes.ts` exists).

**DG2 → face image.** The structure is `75` → `7F61` → (`02` = number of instances) → `7F60` → `A1` biometric header (`87` format owner and `88` format type are required) → one of:
- **`5F2E`: ISO/IEC 19794-5:2005.** A binary record: `FAC\0`, `010\0`, record length, image count. Then per image: a 20-byte facial information block, 8 bytes per feature point, a 12-byte image information block (byte 1: **0 = JPEG, 1 = JPEG 2000**; width and height), then the image bytes.
- **`7F2E`: ISO/IEC 39794-5.** `A1` → application tag `65`, BER/DER with implicit tags. The image is at `…/A1 representation blocks/30/A1/A0/A0/80`. Checked on the ICAO WG3 silver dataset with `openssl asn1parse` *(spike)*.

**39794-5 is no longer optional.** Doc 9303-10 §4.5.6 says inspection systems "MUST be able to handle ISO/IEC 39794 data by 1-1-2026". Issuers may use either format during 2026–2030 and must use 39794 from 1-1-2030. The ICAO TR "ISO/IEC 39794-5 Application Profile for eMRTDs" (v1.00, August 2023) limits DG2 to 2D JPEG and JPEG 2000. It currently returns 404 at its old icao.int path, so cite Doc 9303-10 and the WG3 repository instead. The WG3 GitHub repository publishes the ASN.1 modules (ISO licence: use permitted with attribution) and two "silver" DG2 samples: https://github.com/ICAO-TRIP-ISO-WG3/39794-5-AP (no repository licence; last push 2024-10-11).

**JPEG 2000 decoding** *(spike, using the vision service's own versions)*:
- **Pillow 13.0.0:** `features.check('jpg_2000')` is `True`, with **OpenJPEG 2.5.4** bundled. Pillow's wheel LICENSE carries the OpenJPEG **BSD-2-Clause** text.
- **opencv-python-headless 5.0.0.93:** build information says "JPEG 2000: build (ver 2.5.3)". `LICENSE-3RD-PARTY.txt` says "OpenJPEG library is redistributed within all opencv-python packages", under BSD-2-Clause.
- Both decoded the spike's JP2 and a raw J2K codestream (`FF4FFF51`, which some chips store instead of a JP2 box). Pillow also decoded the 413×531 JP2 inside the WG3 39794-5 silver sample.
- So **no new dependency is needed.** Add `"JPEG2000"` to the allowed formats for a DG2-only decode path, keeping the existing pre-decode `max_pixels` guard.
- DG2 images can be greyscale. Convert to RGB before YuNet and SFace.
- **Decode DG2 only after PA has verified its hash.** An attacker cannot then feed a crafted JPEG 2000 to OpenJPEG unless an issuing state signed it. The exception is the sandbox test CSCA, which is not trusted in production.

**DG2 → selfie.** Send the DG2 image to `/v1/embed/face` (SFace) and compare with the selfie embedding through the existing `face-match.ts`.
- Chip portraits are small, heavily compressed (often 10–20 KB JPEG 2000) and sometimes years old. Calibrate a **separate threshold** for `id_nfc_selfie_comparison` (it is already `beta` and model-based in the registry) rather than reusing the ID-front threshold.
- Add an optional DG2 ↔ printed-portrait comparison (BSI TR-03135 §4.7.6).
- The biometric image is subject to the same consent, encryption and retention rules as selfies.

---

## 6. Test data without real passports

**Generate everything ourselves, deterministically.** The spike shows this is easy:
- **Keys from seeds.**
  - EC keys: `derive_private_key(seed mod n)`.
  - RSA keys: primes from a seeded SHA-256 counter with Miller–Rabin, then `RSAPrivateNumbers`. This takes about 40 lines.
  - **No private key file is committed**, which also keeps gitleaks quiet.
- **Deterministic signatures.** ECDSA uses RFC 6979 (`cryptography` `ECDSA(..., deterministic_signing=True)`). RSA PKCS#1 v1.5 is deterministic by nature.
- **Fixed times** for certificate validity, CRL `thisUpdate`, `nextUpdate` and `signingTime`.
- **Result.** Two runs produced **byte-identical** certificates, CRL, EF.COM, DG1, DG2, DG14, DG15, EF.SOD (ECDSA) and the AA response. Only RSASSA-PSS outputs differ, because the salt is random. Create those inside the test, or check them only by verification, never by golden bytes.
- **Encoding cross-check.** OpenSSL's `cms -verify` accepted all three SODs.

**Recommended fixture design:**
- A TypeScript generator in `packages/emrtd/src/testing/`, mirroring the existing `packages/checks/src/testing`. Use `@noble/curves` (RFC 6979 by default) or `node:crypto` for signing, so tests need no Python. Keep `gen_emrtd.py` only as an independent cross-implementation check, if at all.
- A **UTO** test CSCA, matching `SANDBOX_TEST_ISSUER = 'UTO'`, trusted **only in sandbox environments** and never in production trust stores.
- Variants to generate:
  - brainpool P-256, P-384 and P-512 with explicit parameters, plus P-256 named and explicit;
  - RSA PKCS#1 v1.5 and PSS, with and without PSS parameters;
  - SOD V0 and V1;
  - SHA-1 legacy;
  - DSC embedded and missing; `sid` as SKI or as issuer+serial;
  - a revoked DSC; a stale CRL; an expired DSC; a link-certificate rollover;
  - a tampered DG; trailing bytes after the SOD;
  - EF.COM/SOD discrepancy;
  - 19794-5 JPEG, 19794-5 JPEG 2000 and 39794-5 DG2, built from our own public-domain faces in `fixtures/faces`, never third-party portraits;
  - RSA 9796-2 and ECDSA AA.
- Use the ICAO specimen MRZ (ERIKSSON ANNA MARIA, UTO) or MRZs from the existing synthetic ID generator.

**Third-party test vectors, and why none should be committed:**
- **ICAO WG3 39794-5 silver DG2 datasets** (https://github.com/ICAO-TRIP-ISO-WG3/39794-5-AP/tree/main/DG2-Dataset). The repository has **no licence**; the README calls the files "guidance". The image is a photograph of a real-looking person. That fails both rule 3 (public-domain faces only) and rule 4. Use them for local, manual interoperability checks only. `@li0ard/tsemrtd` has copied them into its MIT repository, which does not change their status.
- **BSI downloads** (TR index page, https://www.bsi.bund.de/EN/Themen/Oeffentliche-Verwaltung/Elektronische-Identitaeten/Technische-Richtlinien/technische-richtlinien.html):
  - **TR-03105-5 ReferenceDataSet** (`…/TR03105/BSI_TR-03105-5_ReferenceDataSet_zip.zip`);
  - **EAC Worked Example** (`…/TR03110/BSI_TR-03110_EAC-Worked-Example.zip`).
  - Their contents and terms are in the table below.
- **ICAO TR "RF and Protocol Testing Part 4: Conformity test for Inspection Systems"** (v3.0, November 2025, with new 39794 DG2 test cases). These are test *specifications* rather than data: https://www.icao.int/sites/default/files/TRIP/Publications/TR-RFProtocolTesting_ConformTestInspecSys_p4.pdf

**Public test data, checked by the JMRTD research agent.** BSI's terms were re-checked in this report.

| Source | Contents | Terms | Usable in git or CI? |
|---|---|---|---|
| JMRTD `src/test/resources` (https://sourceforge.net/p/jmrtd/jmrtd/ci/main/tree/jmrtd/src/test/resources/) | `bsi2008/` (specimen MUSTERMANN ERIKA, "CSCA BDR TEST"), `loes2006/` (Dutch specimen), 39794 samples, `silver.jp2`, WSQ | No separate licence. The **DG2/DG3/DG4 contain real people's faces and fingerprints** | ❌ |
| BSI TR-03105-5 ReferenceDataSet (2014) | DG1–4, DG14, DG15, EF.COM, EF.SOD (a test PKI with RSA-PSS), **DG14/DG15 private keys**, biometric images | BSI general terms §II: downloads "nur zu nicht kommerziellen Zwecken" and "nur unverändert" (https://www.bsi.bund.de/DE/Service/Nutzungsbedingungen/Nutzungsbedingungen_node.html) | ❌ non-commercial. The same files also appear in the JMRTD, pymrtd and tsemrtd tests |
| ISO/IEC 39794-5 samples (https://standards.iso.org/iso-iec/39794/-5/ed-1/en/) | `.der` and `.xml` | ISO licence: unmodified use | ❌ |
| ICAO WG3 39794-5 silver DG2 (see above) | Full DG2 with a JPEG 2000 portrait | No licence; real-looking face | ❌ (manual, local interoperability checks only) |
| Doc 9303 worked examples (Part 11 BAC and PACE appendices, Part 10 App. A) | Fictional KDF, BAC and PACE vectors | ICAO copyright; free download | ✅ short cited vectors in tests (mainly for the Android module) |
| Permissive "ICAO test certificates" | — | none found | — |

**Synthetic-data tools.** None is usable for server fixtures:

| Tool | Licence | Notes |
|---|---|---|
| JMRTD | LGPL-2.1+ | Its constructors (`SODFile(…, privateKey, dsc)`, `DG1File`, `DG15File`, `CardSecurityFile`) can generate data, but **only inside `android/openverify-nfc` tests** |
| pymrtd (https://github.com/ZeroPass/pymrtd) | LGPL-3.0 plus a commercial licence | ❌ |
| dmrtd | LGPL-3.0 | ❌ |
| vsmartcard and OpenPACE | GPL-3.0 | ❌ |
| self.xyz `app/` | BSL-1.1 | ❌ |
| `@zkpassport/utils` passport-generator | No licence | ❌ |
| `@li0ard/tsemrtd` | MIT | A parser only |
| `beaujeant/pypassport` | MIT | Re-licensed from code that was originally LGPL and GPL, so its provenance is doubtful |

**Conclusion:** generate our own, as above.

---

## 7. JMRTD on Android (`android/openverify-nfc`)

Checked by the JMRTD research agent against Maven Central, the SourceForge git history and the jar and source-jar contents. jmrtd.org refused connections all day. The licence headers were re-checked in the downloaded source jars.

### 7.1 Artefacts

The cut-off for "at least 14 days old" is 2026-10-07; every pinned version meets it.

| Artefact | Pin | Released | Licence: POM / files | Notes |
|---|---|---|---|---|
| `org.jmrtd:jmrtd` | **0.8.9**: both the latest and the newest at least 14 days old | 2026-10-03 | POM: "LGPL", no version. **Files: LGPL "version 2.1 … or (at your option) any later version"** (157 of 159 files; re-checked in `SODFile.java`). The repo's `LICENSE` holds the LGPL-3.0 text. The jars ship no licence | https://repo1.maven.org/maven2/org/jmrtd/jmrtd/0.8.9/jmrtd-0.8.9.pom. Unreleased fix on `main` (bd0633f, 2026-10-20): the TD2 composite check digit and **AA Le under AES secure messaging** |
| `net.sf.scuba:scuba-smartcards` | 0.0.21 | 2026-08-22 | LGPL-2.1+, **except `CommandAPDU.java` and `ResponseAPDU.java`: Oracle "GPL version 2 only" with the Classpath exception** (re-checked) | A transitive dependency of JMRTD |
| `net.sf.scuba:scuba-sc-android` | 0.0.27 (AAR, `minSdk 10`) | 2026-08-23 | LGPL-2.1+ | `IsoDepCardService`. Adds the `android.permission.NFC` permission |
| `org.ejbca.cvc:cert-cvc` | 1.4.13 | 2021-06-23 | LGPL-2.1+ | A transitive dependency. JMRTD excludes its old `bcprov-jdk15on` |
| `org.bouncycastle:bcprov-jdk18on` / `bcutil-jdk18on` | 1.86 | 2026-09-11 | **MIT** text in `META-INF/LICENSE.md` | `bcpkix` is only used in JMRTD's own tests |

**Recommended SPDX entries for the NOTICE:**
- JMRTD: `LGPL-2.1-or-later`
- SCUBA: `LGPL-2.1-or-later AND GPL-2.0-only WITH Classpath-exception-2.0`
- cert-cvc: `LGPL-2.1-or-later`
- Bouncy Castle: `MIT`

The repo currently says "LGPL-3.0" in `android/openverify-nfc/NOTICE`, the README, `PLAN.md` §3 and §9, and THIRD_PARTY_LICENSES.md line 177. That is a valid choice under "or later", but it is not what the files say.

**LGPL compliance:**
- depend through Maven coordinates; do not shade or repackage;
- ship the LGPL and GPL+CE texts in the AAR;
- consumer R8 rules keep `org.jmrtd.**`, `net.sf.scuba.**` and `org.ejbca.cvc.**` unobfuscated, so the libraries can be relinked.

SHA-256 values for Gradle dependency verification are in the agent's notes, for example `jmrtd-0.8.9.jar` = `89959d0c…5409`, checked against Maven's `.sha256`.

### 7.2 Bouncy Castle, Spongy Castle and API levels

- **Spongy Castle is dead** (last release 1.58.0.0, 2017-08-30). Use `bcprov-jdk18on` 1.86.
- Android's own Bouncy Castle is repackaged as `com.android.org.bouncycastle`, so there is no class clash (https://android.googlesource.com/platform/external/bouncycastle/+/refs/heads/main/Android.bp).
- Since Android P, asking for the platform `"BC"` provider by name fails (https://android-developers.googleblog.com/2018/03/cryptography-changes-in-android-p.html).
- **JMRTD 0.8.9 passes its own `new BouncyCastleProvider()` object explicitly** to the EC, ECDH, ECDSA, RSA-PSS and MAC operations. Its comment says some Android providers lack brainpool and explicit curves (`org/jmrtd/Util.java`; CHANGELOG 0.8.8). So **do not** call `Security.insertProviderAt`.
- A duplicate `META-INF/versions/9/OSGI-INF/MANIFEST.MF` in the two Bouncy Castle jars will probably need a `packaging.resources.excludes` entry. This is inferred, not tested.
- **API levels.** Everything needed is far below our minSdk 26:
  - `IsoDep`: API 10;
  - `isExtendedLengthApduSupported`: 16;
  - `NfcAdapter.enableReaderMode`: 19;
  - `java.util.Base64`: 26.
  - JMRTD targets Java 8 class files and uses no `java.awt`, `javax.imageio`, streams or lambdas, so no desugaring is needed.
  - Create `new IsoDepCardService(isoDep)` directly; `CardService.getInstance` uses reflection and would need keep rules.
- **The reference app is not a model.** `tananaev/passport-reader` (README says Apache-2.0, but there is **no LICENSE file**, and it includes LGPL `legacy/Passport.java`) is outdated: JMRTD 0.7.18, Spongy Castle, and a global provider insert. Its on-device PA is weak: revocation is off, and it unpacks master lists with `cms -verify -noverify` (https://github.com/tananaev/passport-reader).

### 7.3 What JMRTD 0.8.9 does

Classes and methods are from the sources jar.

| Feature | API | Notes |
|---|---|---|
| BAC | `PassportService.doBAC(BACKey)` | Required for older chips |
| PACE | `doPACE(PACEKeySpec.createMRZKey/createCANKey, oid, PACEInfo.toParameterSpec(...), paramId)` | Generic, Integrated and **CAM** mappings (`PACECAMResult`). 0.8.8 fixed the PACE-CAM IV. **Mandatory in chips issued from 2027-01-01** (Doc 9303-11 §4.1) |
| Chip Authentication | `doEACCA(keyId, oid, publicKeyOID, publicKey)` | Keys from `DG14File` or `CardSecurityFile` |
| Active Authentication | `doAA(publicKey, digestAlg, sigAlg, challenge)` | **The challenge must be exactly 8 bytes.** It returns `AAResult.getResponse()` raw and **does not verify it**, which fits a server-nonce design. Run AA **after** PACE or BAC; the AES Le fix is pending upstream |
| Terminal Authentication | `doEACTA` | Needs CVCA/DV certificates we cannot get, so DG3 and DG4 are out of reach |
| Files | `COMFile`, `SODFile`, `CardAccessFile`, `CardSecurityFile`, `DG1File` (`MRZInfo`), `DG2File` → `FaceImageInfo` (19794 and 39794), `DG11File`, `DG12File`, `DG14File`, `DG15File` | `EF_SOD` and `EF_CARD_SECURITY` share file ID `0x011D` (application vs MF) |
| Verification | — | **There is no PA, trust store or chain check.** `SODFile` only compares `messageDigest`. The old `VerificationStatus` and `MRTDTrustStore` were removed in 2015 (https://sourceforge.net/p/jmrtd/jmrtd/ci/6557cfd4040d1cbb4fc51bc65750c8bfc87bbdf0/) |

**DG2 on the device.** JMRTD returns raw image bytes plus a MIME type (`image/jpeg` or `image/jp2`). Android cannot decode JPEG 2000 (https://developer.android.com/media/platform/supported-formats).
- **Upload the raw DG2 and decode it on the server** (§5).
- For an on-device preview only, `io.github.michaldvorak-gemalto:jp2-android` 1.1.0 is BSD-2-Clause and wraps OpenJPEG 2.5.4 (https://github.com/ThalesGroup/JP2ForAndroid).
- **Do not use jj2000.** Its licence is custom and non-permissive, and `edu.ucar:jj2000` mislabels it Apache-2.0 in its POM.

### 7.4 What the SDK uploads

The SDK uploads to a new endpoint, for example `POST /v1/verifications/{id}/nfc`, as multipart raw bytes, all envelope-encrypted at rest like other uploads.

**Before reading:**
1. The SDK calls `POST …/nfc-challenge`.
2. The server returns an **8-byte CSPRNG nonce**. It is single-use, has a TTL of about 5 minutes, is bound to the verification and is stored hashed.

**After reading, the SDK uploads:**
- **EF.SOD, DG1, DG2**: required;
- DG11 and DG12, if readable;
- DG14 and DG15, if present;
- **EF.CardSecurity**: signed, holds the CA and PACE-CAM keys, verified with the same PA code;
- **EF.CardAccess and EF.COM**: unsigned, hints only;
- **the AA response** to the server nonce, plus the nonce ID;
- **low-trust telemetry**: the protocols attempted (BAC or the PACE OID and mapping, CA OID and key ID), their results and error codes, the chip's ATR/ATS, and read timings. This is shown to operators, never used as evidence.

**The server re-does everything:** it parses, hashes, runs PA, verifies EF.CardSecurity, verifies AA, compares DG1 with the OCR'd MRZ, and compares DG2 with the selfie.

**Size.** The payload is usually well under 200 KB; a JPEG 2000 DG2 is often 15–30 KB. Enforce a per-file cap and pass explicit `asn1js` limits.

**Privacy.** A stored AA signature is a transferable proof that this chip answered at this time (Doc 9303-11 App. C). Give it the same retention as other verification evidence, and redact it with the inquiry.

---

## 8. Stretch goal: mDL / mdoc and verifiable credentials

**Recommendation: keep this out of Phase 5.** Treat it as a separate stretch slice after Phase 5, or as part of Phase 11 (Connect / reusable KYC).

The one thing to do now: build the Phase 5 trust store and the path validator generically, so the same module can later hold IACA roots. mdoc issuer authentication has the same shape as PA:

| | Passport (PA) | mdoc |
|---|---|---|
| Signed object | CMS SOD | COSE_Sign1 MSO |
| What it covers | DG hashes | `valueDigests` |
| Signer certificate | DSC | DS certificate |
| Chains to | CSCA | IACA |

Reference: ISO/IEC 18013-5 2nd-edition working draft §12.8.1 and §12.8.3, public at https://github.com/ISOWG10/ISO-18013.

**Why not now:**
- End-to-end testing needs a physical phone with a wallet, and there is no emulator here.
- Real wallets gate verifiers, and a self-hosted open-source project cannot ship any of these credentials. Each deployer has to obtain their own:
  - **Apple:** Safari 26 supports only `org-iso-mdoc`, with **signed ReaderAuth** using a certificate from **Apple Business Connect** (https://webkit.org/?p=17431, https://developer.apple.com/wallet/get-started-with-verify-with-wallet/).
  - **Google Wallet:** production needs relying-party onboarding, Terms of Service acceptance, a demo video and a certificate signed by Google. "Signed Requests are required to enable Cross Device flows" (https://developers.google.com/wallet/identity/verify/accepting-ids-from-wallet-online, https://developers.google.com/wallet/identity/verify/relying-party-onboarding).
  - **EUDI wallets:** they require a relying-party **access certificate** for every presentation (ARF annex 2, https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework).
- The TypeScript libraries were reorganised this year (below).

**Standards status** (checked by the mdoc research agent; the Chrome entry re-checked):

| Standard | Status |
|---|---|
| OpenID4VP 1.0 | **Final**, 9 July 2025 (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) |
| HAIP 1.0 | Final (https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html) |
| ISO/IEC TS 18013-7:2025 (2nd edition) | Annex A: REST API; Annex B: OpenID4VP; Annex C: Digital Credentials API, protocol `org-iso-mdoc`, with an HPKE-encrypted response (https://www.iso.org/standard/91154.html) |
| W3C Digital Credentials API | Working Draft (https://www.w3.org/TR/digital-credentials/) |
| Chrome | **Enabled by default from Chrome 141** (blog dated 2025-10-03). Supports OpenID4VP and Annex C. Desktop works by QR with a BLE proximity check (https://developer.chrome.com/blog/digital-credentials-api-shipped) |
| Firefox | Not supported; Mozilla's standards position is negative (https://github.com/mozilla/standards-positions/issues/1003) |
| SD-JWT | RFC 9901 (https://www.rfc-editor.org/rfc/rfc9901.html) |
| SD-JWT VC | Still a draft (draft-ietf-oauth-sd-jwt-vc-19, https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/) |

**What a remote verifier implements:**
1. **Request.** Issue a nonce and a single-use P-256 recipient key.
2. **Response encryption.** `org-iso-mdoc` uses HPKE (DHKEM(P-256)/HKDF-SHA256/AES-128-GCM). OpenID4VP over the DC API uses a JWE (`dc_api.jwt`).
3. **SessionTranscript.** Rebuild it for the protocol used. For `org-iso-mdoc`: `[null,null,["dcapi", SHA-256(cbor([EncryptionInfo, origin]))]]`. For OpenID4VP: `OpenID4VPDCAPIHandover`.
4. **Issuer chain.** Validate the DS certificate to an IACA under RFC 5280, with matching country and state.
5. **Issuer signature.** Verify the MSO COSE_Sign1.
6. **Digests.** Recompute every IssuerSignedItem digest.
7. **Validity.** Check `validFrom`, `validUntil` and the signing time.
8. **Device authentication.** Verify DeviceSignature over the SessionTranscript.
9. **Revocation.** Optionally check the Token Status List or identifier list (2nd edition).
10. **Trust anchors.** Operators upload IACAs. AAMVA's VICAL is free but behind Terms and Conditions (https://aamva.org/identity/mobile-driver-license-digital-trust-service/relying-parties).

**Libraries** (npm registry checked 2026-10-21; licences read from the files):

| Package | Latest | Newest ≥14 days old | Licence | Note |
|---|---|---|---|---|
| **`@owf/mdoc`** | 0.8.3 | **0.8.2** (2026-10-07) | Apache-2.0 | OpenWallet Foundation identity-common-ts, created 2026-02, 12 stars. Has the Annex C and OpenID4VP DC API handovers and status-list checks. HPKE, COSE and X.509 are **callbacks you implement**. Ships real-wallet fixtures |
| `@auth0/mdl` | 3.0.1 | — | Apache-2.0 | GitHub repository **archived** (https://github.com/auth0-lab/mdl) |
| `@animo-id/mdoc` | — | — | — | Superseded by `@owf/mdoc` |
| `@openid4vc/openid4vp` | 0.8.0 | **0.7.0** | Apache-2.0 | — |
| `@sd-jwt/sd-jwt-vc` | 0.23.0 | **0.22.0** | Apache-2.0 | Avoid `@sd-jwt/core` ≤ 0.19.0 (advisory GHSA-f9j6) |
| `hpke` (panva) | — | — | MIT | — |
| `cbor-x` | — | — | MIT | — |
| `pymdoccbor` (Python) | — | — | Apache-2.0 | No DeviceAuth or HPKE |
| **multipaz** (Kotlin) | 0.101.0 | — | Apache-2.0 | minSdk 26, so a candidate for the Android side |

Licence flags:
- `pako` is "(MIT AND **Zlib**)". It arrives transitively through `@owf/token-status-list`, and Zlib is not on the CLAUDE.md allow-list.
- `androidx.credentials`' Play-services adapter (`play-services-auth`) is under the proprietary Android SDK License. It could only ever be an optional adapter, like Play Integrity.

**Effort and verdict.** The server crypto is roughly 2–3 engineer-weeks on top of `@owf/mdoc`. That is the agent's estimate, not measured. Real end-to-end testing needs hardware and per-deployer onboarding.

**Recommended scope, when this slice is taken up:**
- mdoc only: `org-iso-mdoc` plus `openid4vp-v1-unsigned`;
- `@owf/mdoc` 0.8.2 pinned;
- tests run against fixtures;
- a sandbox provider;
- new check ids added to PLAN §4 first;
- SD-JWT VC and EUDI PID later.

### Addendum (2026-11-20, Phase 11 Workflow 11E, C282; connect correction 3)

The Phase 11 Connect research (`docs/research/phase11-connect.md`, "Corrections to the repository's records" item 3, read on 2026-10-29) found this section's standards table and library rows out of date. Workflow 11E's `integration-11e` re-read each source on 2026-11-20; the table above is kept as it was written on 2026-10-21, and this addendum is the newer record. Nothing here is adopted: the wallet work stays deferred (Phase 5 C68 and its decision 44; Phase 11 C286; PLAN "Next release: Phase 11 deferrals (C286)").

| Item | This section (2026-10-21) | Connect research (2026-10-29) | Re-read on 2026-11-20 | Source re-read |
|---|---|---|---|---|
| HAIP 1.0 | Final, undated | Final, 24 December 2025 | Final, dated 24 December 2025 | https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html |
| SD-JWT VC | `draft-ietf-oauth-sd-jwt-vc-19` | `draft-ietf-oauth-sd-jwt-vc-22` (2026-10-27), in IESG evaluation | `draft-ietf-oauth-sd-jwt-vc-27` (dated 16 November 2026), the IESG Evaluation state still listed; still a draft, not an RFC | https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/ and https://www.ietf.org/archive/id/draft-ietf-oauth-sd-jwt-vc-27.txt |
| W3C Digital Credentials API | Working Draft | Working Draft, 20 October 2026 | Working Draft, dated 19 November 2026 | https://www.w3.org/TR/digital-credentials/ |

Library rows, from the npm registry's metadata (`https://registry.npmjs.org/<package>`) on 2026-11-20. "Pinnable" is the newest release published at least 14 days before that day (on or before 2026-11-06), the version rule 3 of the Phase 11 rules would allow; each licence is the registry's for that version.

| Package | This section: latest, pinnable | Connect research: latest, pinnable | Re-read on 2026-11-20: latest (date), pinnable (date) | Licence |
|---|---|---|---|---|
| `@openid4vc/openid4vp` | 0.8.0, 0.7.0 | 0.9.0, 0.7.0 | 0.10.0 (2026-11-16), 0.9.2 (2026-11-03) | Apache-2.0 |
| `@sd-jwt/sd-jwt-vc` | 0.23.0, 0.22.0 | 0.24.0, 0.22.0 | 0.25.0 (2026-11-16), 0.24.3 (2026-11-03) | Apache-2.0 |
| `@owf/mdoc` | 0.8.3, 0.8.2 | 0.9.2, 0.8.2 | 0.10.0 (2026-11-16), 0.9.3 (2026-11-03) | Apache-2.0 |
| `jose` | not listed | 6.2.12 (C286's figure, the version OpenVerify pins for OIDC) | 6.2.18 (2026-11-18), 6.2.15 (2026-11-01) | MIT |

When the wallet work is adopted these are read again on that day, as C286 says; `pako`'s "MIT AND Zlib" (through `@owf/token-status-list`) is decided then, and `@sd-jwt/core` 0.19.0 and earlier stay avoided (advisory GHSA-f9j6).

---

## Needs the owner

These are terms to accept, downloads only the owner may approve, and policy calls. Nothing here was accepted or downloaded behind a gate.

### Terms of use and data sources

1. **The BSI German master list** (the recommended default source):
   - Commercial *use* is allowed on the list's page, provided OpenVerify does not advertise with it and does not suggest cooperation with BSI. So no BSI name or logo in the product UI.
   - BSI's general terms require prior written consent for mirroring (§VII) and for unchanged-only redistribution (§II).
   - **Decide** whether to:
     - accept these conditions for operator-side fetching;
     - document them for self-hosters;
     - ask csca-germany@bsi.bund.de for written consent if any cache or image redistribution is ever wanted.
2. **The ICAO master list and the ICAO PKD** (download.pkd.icao.int):
   - Both sit behind an "I agree" form plus a CAPTCHA.
   - Their terms allow only personal or organisational *non-commercial* use, and forbid republishing, dissemination and robots.
   - **Decide** whether to:
     - (a) stay out;
     - (b) support only operator-supplied files that the operator obtained under their own agreement;
     - (c) consider the paid private-sector programme expected in 2027.
   - PKD participation (US$15,900 plus US$18,421.85 a year) is for document issuers only.
3. **CRLs hosted on the ICAO PKD** (`pkddownload1/2.icao.int/CRLs/<ISO3>.crl`). 123 of the 609 German-list CSCAs name *only* these URLs. Whether fetching them automatically falls under the ICAO terms has not been tested or decided.
   - Without them, revocation stays **undetermined** for those issuers.
   - **Decide** whether to accept the terms, or to live with `undetermined`.
4. **The Netherlands, Italy and Switzerland lists:**
   - NL is "All rights reserved", with no terms.
   - CH needs "prior written consent" for reproduction.
   - For IT, CAD art. 52(2) may make the list open by default.
   - **Decide**, after legal review, whether these are enabled by default, opt-in, or require asking the publishers.
5. **Licence-policy exception.** None of the trust-anchor sources carries a licence on the allow-list in CLAUDE.md rule 4.
   - **Approve** a documented exception: "public-sector PKI data fetched by the operator at runtime, never committed or redistributed".
   - Fix THIRD_PARTY_LICENSES.md line 231. It currently reads "ICAO / BSI CSCA master list | Public", which is inaccurate; PLAN §3 likewise says "public BSI list".
6. **The "pinned SHA-256" rule.**
   - **Approve** pinning each source's *CSCA certificate* SHA-256 and verifying every downloaded list against it, instead of pinning the file's SHA-256. Master lists are reissued about monthly, and the Dutch page's own published hash was already wrong today.
   - Also approve the fetch being a TypeScript CLI (`trust-anchors:sync`) wrapped by `scripts/fetch-trust-anchors`, because a standard-library Python script cannot verify brainpool signatures.

### Android licences

7. **JMRTD stack licences** (`android/openverify-nfc`):
   - **Approve** correcting the NOTICE, README, `PLAN.md` and THIRD_PARTY_LICENSES.md from "LGPL-3.0" to **LGPL-2.1-or-later**.
   - **Approve** adding `cert-cvc` (LGPL-2.1+).
   - **Decide** on SCUBA's two Oracle files, licensed **GPL-2.0-only WITH Classpath-exception-2.0**. That licence is neither on the allow-list nor LGPL, and JMRTD cannot run without them. They would be confined to the optional NFC artefact and need an explicit, documented exception.
8. **Third-party test data.** None of these may be committed under the current rules:
   - the BSI TR-03105-5 ReferenceDataSet and the EAC Worked Example: BSI terms, non-commercial and unchanged-only;
   - JMRTD's test resources: real biometrics, no licence;
   - the ICAO WG3 39794-5 silver DG2 samples: no licence, a real-looking face;
   - the ISO 39794-5 samples: ISO licence.

   **Decide** whether to ask BSI or ICAO WG3 for permission. The recommended alternative is fully synthetic fixtures (§6), which need no approval.

### Verification policy

9. **Trust and verification policy defaults:**
   - Accept SHA-1-signed CSCAs, DSCs and SODs from legacy documents? 36 of the 609 German-list certificates are SHA-1-signed.
   - Accept CSCAs that have expired but still anchor valid documents?
   - Merge rule across lists: one verified list is enough.
   - **Revocation policy:** treat `undetermined` as not-passed (strict, as in BSI TR-03135), or let templates opt into "best effort". Strict is recommended per CLAUDE.md rule 5. With ICAO CRLs unavailable, a noticeable share of passports would then end `undetermined` and go to manual review.
10. **Status mapping.** Confirm the proposed mapping of TR-03135 results to OpenVerify statuses (§1.3).
    - `undetermined` → `failed` with an explicit reason code. It never becomes `passed`.
    - `not supported` → `not_applicable`. For example, chips without DG15 for `id_nfc_chip_authentication_detection`, because CA cannot be verified on the server.

### Privacy and later phases

11. **Privacy and retention:**
    - Raw DG1, DG2, DG11 and DG12 are PII and biometrics. Envelope-encrypt them, keep them under biometric consent, and give them the shortest retention.
    - The SOD contains hashes of personal data.
    - A stored AA signature is a transferable proof that the chip was present.
    - **Approve** treating all of this as biometric or verification evidence under the existing retention and redaction jobs.
12. **mdoc and verifiable credentials** (later stretch slice): AAMVA VICAL requires accepting its Terms and Conditions. Apple Business Connect, Google Wallet relying-party onboarding and EUDI access certificates are per deployer; OpenVerify cannot ship them. `pako`, a transitive dependency of `@owf/mdoc`, is "MIT AND **Zlib**"; Zlib is not on the allow-list. The owner previously accepted Zlib only inside NumPy.
13. **`tslib` (0BSD).** It is already flagged at THIRD_PARTY_LICENSES.md line 86. `pkijs` and the `@peculiar` packages also depend on it.
