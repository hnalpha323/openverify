# TDD evidence: Workflow 5B Stage 2, `emrtd` (Phase 5)

- **Slice owner:** the Workflow 5B Stage 2 `emrtd` agent, in parallel with `vision-document`, `fixtures-5b`, `checks-5b` and `clients-5b` (disjoint paths).
- **Date:** 2026-10-23.
- **Base:** `2d3839f5` (the Workflow 5B Stage 1 amendments).
- **Input:** the plan's `emrtd` bullet: C62.1-C62.4 and C62.6 (the bounded TLV pre-scan, the parsers over asn1js and pkijs keeping original byte ranges, the key and curve bounds with the explicit-parameter allowlist, `parseDg1` and `parseDg2`, `verifyPassiveAuthentication` with integrity apart from revocation and per-data-group results, Active Authentication over the server nonce, `selfTest()`, the NFC evaluators with the C62.4 integrity rules) and C65.3 (`@openverify/emrtd/testing`). Owned paths: `packages/emrtd/`, `packages/checks/src/nfc/`, `packages/contracts/src/nfc-check-reasons.ts`, `packages/core/src/check-config/nfc.ts`.

Each unit follows the same cycle: a stub (`chore`) so the RED commit compiles and type-checks; the test, seen failing for the intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`). All commands ran after `source scripts/env.sh`, from `packages/emrtd` unless shown otherwise. Output is trimmed to the lines that matter. Every key, certificate, chip file and MRZ in these tests is synthetic: keys derive from fixed labels at run time (no key file exists), the issuer is the specimen state Utopia (`UTO`, `UT`), and no real chip data, master list or issuer certificate is read or committed.

The research prototype (`resume/nfc-spike-scripts`, outside the repository) was read for what worked: Passive Authentication through `node:crypto` over the original signed-attribute and TBS bytes, explicit-parameter brainpool keys imported by OpenSSL 3.5.5 and recognised as their named curve, ISO/IEC 9796-2 scheme 1 through a raw RSA public operation, and plain ECDSA through `dsaEncoding: 'ieee-p1363'`; and for what failed (pkijs' and @peculiar/x509's WebCrypto `verify()` on explicit parameters). The package was written fresh; no spike code was copied.

## 1. Byte helpers and the DER writer

The self-test and the test builders write DER themselves (the parsers never do). Stub: `bytes.ts`, `der.ts`. RED:
```
$ pnpm exec vitest run src/der.test.ts --coverage.enabled=false
 FAIL  src/der.test.ts > the byte helpers > writes and reads hex in either case
EmrtdNotImplementedError: toHex is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
 FAIL  src/der.test.ts > the byte helpers > refuses "abc" as hex
AssertionError: expected error to be instance of RangeError
      Tests  15 failed (15)
```
GREEN (`18e707b6`, Prettier layout `b6f0b092`):
```
$ pnpm exec vitest run src/der.test.ts --coverage.enabled=false
      Tests  15 passed (15)
```

## 2. The bounded TLV pre-scan and reader (C62.1)

Stub `094307e5` (`tlv.ts`; `prescanTlv` moves there, re-exported by `parse.ts`, and reports the outer TLV's `end` so the caller decides about trailing bytes). RED `5ce13ca8`:
```
$ pnpm exec vitest run src/tlv.test.ts --coverage.enabled=false
EmrtdNotImplementedError: prescanTlv is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 2 arguments)
      Tests  23 failed | 1 passed (24)
```
The one that passed checks that `parse.ts` re-exports the same function. GREEN `6b712f99`:
```
      Tests  24 passed (24)
```
The cases: depth 32 taken and 33 refused, 20,000 TLVs taken and 20,001 refused, BER long-form and indefinite lengths, one to four tag bytes, and twelve malformed headers (a length past its parent, an indefinite primitive, an end-of-contents where a TLV belongs, five tag bytes, five length bytes, ...).

## 3. asn1js behind the pre-scan, the key bounds, the seeded test keys (C62.1, C65.3)

Stub `43b3cb52` (`asn1.ts`, `keys.ts`, `testing/keys.ts`, the algorithm OID tables, the OpenSSL names of the allowlisted curves). RED `b218bcd7`:
```
$ pnpm exec vitest run src/keys.test.ts src/asn1.test.ts src/testing/keys.test.ts --coverage.enabled=false
EmrtdNotImplementedError: decodeAsn1 is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 3 arguments)
EmrtdNotImplementedError: testKeyPair is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 2 arguments)
EmrtdNotImplementedError: seededBytes is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 2 arguments)
 Test Files  3 failed (3)
      Tests  60 failed | 1 passed (61)
```
GREEN `5475a27e`:
```
      Tests  61 passed (61)
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  137 passed (137)
```
Before the RED commit, one table of `keys.test.ts` built a test key while the file was collected, so the whole file failed at collection; the case moved into its own test so each case fails on its own. A scratch probe (not committed) showed what the import rests on: Node 22.22.1 (OpenSSL 3.5.5) reads explicit brainpool, P-256 and secp256k1 parameters as `brainpoolP256r1`, `prime256v1` and `secp256k1`, and refuses the same parameters with `b` changed by one ("Failed to read asymmetric key"). The explicit-parameter allowlist is therefore OpenSSL's exact match against its built-in curves, checked against `ALLOWED_CURVES`, after our own field-size bound; secp256k1 is refused named and explicit.

## 4. Signature algorithms, certificates and CRLs, the Utopia X.509 builders (C62.2, C62.7, C65.3)

Stub `a8701a6e` (`signatures.ts`; the original-byte fields of `ParsedCertificate` and `ParsedCrl` (TBS, signature algorithm and value, SPKI, the normalised DN keys, the CRL issuer's country) and `unknownCriticalExtensions`; `verifyCertificateSignature` and `verifyCrlSignature` take `{ acceptSha1 }`; `testing/x509.ts` with the builders' overrides; `testSignatureAlgorithm`). RED `cc86d178`:
```
$ pnpm exec vitest run src/signatures.test.ts src/pki.test.ts src/testing/x509.test.ts src/stubs.test.ts --coverage.enabled=false
EmrtdNotImplementedError: buildCsca is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
EmrtdNotImplementedError: checkSignature is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
EmrtdNotImplementedError: describeSignatureAlgorithm is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 2 arguments)
EmrtdNotImplementedError: parseCertificate is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
 Test Files  3 failed | 1 passed (4)
      Tests  39 failed | 16 passed (55)
```
The 16 that passed are the remaining stub cases of `stubs.test.ts`. GREEN `1a11322b`:
```
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  11 passed (11)
      Tests  176 passed (176)
```
One RED expectation was wrong and was corrected in the GREEN commit: the builder test expected node's `X509Certificate.ca` to be true for the "DSC with `cA` true" defect, but OpenSSL's `ca` (`X509_check_ca`) also requires `keyCertSign`, which a signing key does not carry. The test now reads `cA` with `parseCertificate` and pins OpenSSL's `false`. Every other builder check is against node's `X509Certificate` (subject, issuer, `checkIssued`, `verify` on explicit brainpool, RSA-3072 PSS and P-256 keys) or asn1js (the CRL).

## 5. EF.SOD, DG1, DG2, DG15, DG14 and the synthetic chips (C62.1, C62.2, C62.5, C65.3)

Refactor `b30c1dfc` (the DN and serial readers move to `names.ts`, suite green: 176 passed). Stub `de56c8f6` (`cms.ts`, `readSod` and `SodContents`, `activeAuthenticationHashOf`, `testing/chip.ts` with five more variants (`tampered-sod-signature`, `message-digest-mismatch`, `content-type-mismatch`, `wrong-signer-identifier`, `unlisted-dg15`), the 39794-5 portrait option, the AA digest option, `TestCertificate.issuerName`). RED `93632f86` and `591a8e48` (the issuer name):
```
$ pnpm exec vitest run src/parse.test.ts src/testing/chip.test.ts src/stubs.test.ts --coverage.enabled=false
EmrtdNotImplementedError: buildChip is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
EmrtdNotImplementedError: parseSod is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
 Test Files  2 failed | 1 passed (3)
      Tests  53 failed | 10 passed (63)
$ pnpm exec vitest run src/testing/x509.test.ts --coverage.enabled=false
     × writes a Document Signer the CSCA issued
     × certifies the new CSCA key with the old one, under the same name
      Tests  2 failed | 6 passed (8)
```
GREEN `94a4d078`:
```
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  13 passed (13)
      Tests  223 passed (223)
```
Two RED test helpers were wrong and were corrected in the GREEN commit: the chip test read the SignerInfo's `[0]` key identifier as an OCTET STRING (asn1js gives an implicitly tagged primitive, so the test reads its value bytes), and the "unknown LDS digest" case spliced a shorter LDS object into a built SOD without fixing the outer lengths; it now writes a whole SOD by hand. Neither changed what the tests assert of the parsers.

The builder's SOD is checked independently of the parsers: asn1js reads the SignedData, every listed hash is recomputed from the uploaded data group, and node:crypto verifies the DSC's signature over the re-tagged signed attributes (ECDSA on explicit brainpool, RSA `rsaEncryption` and RSASSA-PSS). The ISO/IEC 9796-2 AA response is recovered with a raw RSA public operation in the test and its header, trailer and `H(M1 || nonce)` checked. The 39794-5 path (representation blocks `[1]` → representation → `[1]` → `[0]` → `[0]` → image `[0]`, optionally under application tag `65`) follows the research note §5; no 39794-5 sample can be committed (research §6), so it is pinned only against our own builder.

## 6. The self-test (C62.9)

Stub `93daf5f2` (`ec.ts`, the explicit EC writer; `runSelfTest`, `selfTestCases`, `SELF_TEST_CURVES`). RED `cc8b3045`:
```
$ pnpm exec vitest run src/self-test.test.ts --coverage.enabled=false
EmrtdNotImplementedError: selfTest is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 0 arguments)
EmrtdNotImplementedError: runSelfTest is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
EmrtdNotImplementedError: selfTestCases is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 0 arguments)
EmrtdNotImplementedError: explicitEcParameters is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
      Tests  4 failed (4)
```
GREEN `2a0e9dcf`:
```
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  14 passed (14)
      Tests  226 passed (226)
```
"Runs as emrtd's first test" (C62.9) is literal: `vitest.global-setup.ts` runs `selfTest()` before any test file and stops the suite, naming the Node and OpenSSL versions and the failing curves, when explicit brainpool cannot be verified. Each case signs with `@noble/curves` (pure JavaScript, RFC 6979) and verifies through the verifier's own `importPublicKey` and `checkSignature`, so the self-test exercises the path PA uses, not a separate one.

## 7. Passive Authentication (C62.1, C62.2, C62.7, C62.9)

Stub `fade548d` (`PassiveAuthenticationOptions.issuerCountry`, required, and `selfTest`, optional; `input_missing` joins `INTEGRITY_GAPS`, which `apps/api/src/emrtd-contract.test.ts` still accepts: 3 passed). That stub commit left `stubs.test.ts` without the new required option, so it did not type-check until the RED commit that followed (`684a8707`) added it; no other path was affected. RED `684a8707`:
```
$ pnpm exec vitest run src/passive-authentication.test.ts src/stubs.test.ts --coverage.enabled=false
EmrtdNotImplementedError: verifyPassiveAuthentication is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 3 arguments)
 Test Files  1 failed | 1 passed (2)
      Tests  43 failed | 9 passed (52)
```
The PA case that passed is the source scan (no network module or `fetch(` in the package), which pins what already held. GREEN `ad4bd6df`:
```
$ pnpm exec vitest run src/passive-authentication.test.ts --coverage.enabled=false
      Tests  44 passed (44)
$ pnpm exec vitest run
 Test Files  15 passed (15)
      Tests  269 passed (269)
All files          |   94.68 |    86.86 |   98.79 |   94.67 |
```
Lint refused `/<+$/` (`regexp/no-super-linear-move`); the MRZ filler is cut with `indexOf` instead. The variants and their answers are listed in the handoff; the decisions the cases pin: a DN-only anchor never makes integrity `broken` (H02), so a tampered DG1 under a DSC without AKI is `not_established`/`trust_anchor_unavailable` with `issuer-dn-match` and `dg-hash-mismatch` flagged; tampering stays `broken` when the DSC has also expired; a failed self-test overrides even `broken` (a platform that cannot verify brainpool would misread a genuine signature as invalid).

## 8. Active Authentication (C62.6)

Stub `a87c3b6e` (`ActiveAuthenticationInput.dg14`, an optional hint). RED `a2b4daf5`:
```
$ pnpm exec vitest run src/active-authentication.test.ts src/stubs.test.ts --coverage.enabled=false
EmrtdNotImplementedError: verifyActiveAuthentication is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
 Test Files  1 failed | 1 passed (2)
      Tests  18 failed | 7 passed (25)
```
GREEN (the commit after `a2b4daf5`):
```
$ pnpm exec vitest run src/active-authentication.test.ts --coverage.enabled=false
      Tests  18 passed (18)
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  286 passed (286)
```
The order of the answers is the C62.6 table's: integrity first (`untrusted_key`: an unverified SOD cannot say whether DG15 is the chip's), then the SOD's listing (`not_listed`, which the evaluator answers `chip_auth_not_server_verifiable`, or `active_authentication_unavailable` with `require-active-authentication`), then a missing DG15 or response (`withheld`), then a key or response that cannot be read (`malformed`), then the signature (`verified` or `failed`). A wrong-length or past-the-modulus response is malformed; a well-formed one whose representative lacks the 9796-2 header or a known trailer, or whose hash differs, failed. The test of the `n - s` representative covers ISO/IEC 9796-2's second form.

## 9. CSCA master lists (C62.7, C65.3)

Stub `8607ae51` (`MASTER_LIST_LIMITS`, `ParsedMasterList.unreadableCertificates`, `testing/master-list.ts` with `TEST_MASTER_LIST_VARIANTS`). RED `753bc2f8` (also `stubs.test.ts`, now the check that no source file still calls `notImplemented(`):
```
$ pnpm exec vitest run src/master-list.test.ts src/stubs.test.ts --coverage.enabled=false
     × leaves no stub in any source file
     × verifies a list against its pinned root
     × refuses the wrong-content-type variant: content_type_invalid
EmrtdNotImplementedError: buildMasterList is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
      Tests  12 failed | ... 
```
GREEN (the commit after `753bc2f8`):
```
$ pnpm exec vitest run
 Test Files  17 passed (17)
      Tests  297 passed (297)
All files          |   94.85 |    87.25 |   98.46 |   94.84 |
```
One RED expectation was wrong and was corrected in the GREEN commit: it expected the listed certificates in the order given, but `certList` is a `SET OF`, which DER keeps sorted by encoding; the test now compares the sorted digests. The variants and their refusals: `wrong-content-type` → `content_type_invalid`, `signer-not-embedded` → `signer_missing`, `signer-without-eku` → `signer_profile_invalid`, `tampered-content` → `message_digest_mismatch`, `bad-signature` → `signature_invalid`; a signer from another CSCA of the same name → `signer_not_issued_by_root`; a signer expired at the signing time → `signer_expired`; a signer under a newer CSCA whose link from the pinned root the list carries → verified.

## 10. The Utopia PKI of the seed and the e2e run, and the generation-time bound (C62.8, C65.3, C65.5)

Stub `4d2c9762` (`testing/utopia.ts`: `buildUtopiaCsca`, `buildUtopiaCrl`, `buildUtopiaChip`, `testTrustStore`; `UTOPIA` and `UTOPIA_CSCA_SEED` move there). RED `887785a5`:
```
$ pnpm exec vitest run src/testing/utopia.test.ts src/stubs.test.ts --coverage.enabled=false
EmrtdNotImplementedError: buildUtopiaCsca is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
EmrtdNotImplementedError: buildUtopiaChip is not implemented yet (owner: emrtd, Workflow 5B Stage 2; 1 arguments)
     × leaves no stub in any source file
 Test Files  2 failed (2)
      Tests  8 failed | 6 passed (14)
```
The RSA generation bound passed at RED: it times builders already built (C65.3: "a test bounds generation time"). GREEN (the commit after `887785a5`):
```
$ pnpm exec vitest run
 Test Files  18 passed (18)
      Tests  305 passed (305)
All files          |   94.91 |    87.21 |    98.5 |    94.9 |
```
Measured before choosing the bounds (a scratch test, not committed; fresh seeds, three runs): an RSA-3072 CSCA 519-892 ms, an RSA-2048 DSC 113-200 ms, a chip with an RSA-2048 AA key 112-147 ms. The bounds (10 s for a fresh RSA set, 2 s for an EC Utopia chip) leave room for a loaded `pnpm test`.

## 11. The NFC evaluators (C62.3, C62.4, C62.6), in `packages/checks/src/nfc/`

Stub `3cd2d004` (the inputs, the C62.4 rule, the PA options from the template, `nfcIssuerCountry`, `nfcChipFields`, six evaluators, `NFC_EVALUATOR_OUTCOMES` by status, `NFC_EVALUATORS`, `evaluateGovernmentIdNfcChecks`, the test inputs). RED `028eafa8`:
```
$ pnpm --filter @openverify/checks exec vitest run src/nfc --coverage.enabled=false
Error: not implemented (1792756800000)
Error: not implemented (2, 2026-10-23T12:00:00.000Z)
Error: not implemented (D<<)
 Test Files  8 failed (8)
      Tests  81 failed (81)
```
GREEN `ee842e23`:
```
$ pnpm --filter @openverify/checks exec vitest run src/nfc --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  81 passed (81)
$ ... --coverage.include='src/nfc/**'
All files          |   98.26 |    90.69 |     100 |   98.22 |
```
Two RED inputs were wrong and were corrected in the GREEN commit: the selfie test asked for a threshold of 0.999, which the registry schema refuses (`faceThresholdSchema` is 0.25-0.6), so it now uses a portrait at similarity 0.54 that passes the default and fails 0.6; the truncated-name MRZ line had 45 characters instead of 44. The checks run under `api-nfc`'s calls as the job will make them (the last describe of `evaluate.test.ts` runs real Utopia chips through `verifyPassiveAuthentication` and `verifyActiveAuthentication`): every required check of a chip read with its own face passes and the default template decides `passed`; the same chip with another face fails `face_mismatch` (and the decision `failed`) while the repeat check records the sighting at review level; in production the chip fails `specimen_issuer`; a tampered DG1 fails `dg_hash_mismatch` and withholds every DG1 verdict. The `C51.2` row of each check is mirrored by status in `NFC_EVALUATOR_OUTCOMES`, and a matrix of 13 inputs × 2 templates asserts no result carries a reason outside it.

## 12. Hardening found in review of the built code

- RED `2afecb41`, GREEN `cb9951d6`: a DG15 key under the RSASSA-PSS OID made `verifyActiveAuthentication` throw (`Error: Unsupported JWK Key Type.`); it now answers `malformed`, and a refused plain-ECDSA verification answers not verified.
- Refactor `6d791815`: the PA time budget also bounds parsing the store's anchors (the DN fallback over a large store); suite green (306 passed).
- RED `5fbbce7b`, GREEN (the commit after it): PKCS#1 v1.5 under an RSASSA-PSS-only DSC key made OpenSSL throw, which `checkSignature` read as `invalid`, so an issuer inconsistency would have read as a broken SOD (`failed`). OpenSSL answers a malformed signature with `false` and throws only when the key may not be used that way (a scratch probe, not committed), so a throw is now `unsupported` (review):
```
$ pnpm exec vitest run src/signatures.test.ts --coverage.enabled=false
     × answers unsupported, not invalid, when the key may not make the scheme (a PSS-only key, PKCS#1)
AssertionError: expected 'invalid' to be 'unsupported' // Object.is equality
      Tests  1 failed | 23 passed (24)
$ pnpm exec vitest run --coverage.enabled=false
 Test Files  18 passed (18)
      Tests  307 passed (307)
```

## 13. Final gates (all in the foreground)

```
$ pnpm --filter @openverify/emrtd typecheck        # tsc --noEmit: clean
$ pnpm --filter @openverify/emrtd lint             # eslint .: clean
$ pnpm --filter @openverify/emrtd build            # tsc -p tsconfig.build.json; the dist runs under plain Node:
  {"ok":true,"failures":[],"node":"22.22.1","openssl":"3.5.5"}   established unrevoked
$ pnpm --filter @openverify/emrtd test
 Test Files  18 passed (18)
      Tests  307 passed (307)
All files          |   94.95 |    87.21 |    98.5 |   94.94 |      (6.2 s)
$ pnpm --filter @openverify/checks test
 Test Files  148 passed (148)
      Tests  2893 passed (2893)
All files          |   98.72 |     90.9 |   99.41 |   98.69 |      (21.6 s)
$ pnpm typecheck        Tasks: 13 successful, 13 total
$ pnpm lint             Tasks: 13 successful, 13 total (52 s)
$ pnpm format:check     All matched files use Prettier code style! (61 s)
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   68 passed (35.2s)
@openverify/e2e:e2e:   60 passed (8.1m)
 Tasks:    10 successful, 10 total
real	12m16.875s
```
`apps/api/src/emrtd-contract.test.ts` (contracts-5b) still passes with `input_missing` among the integrity gaps: 3 passed.
