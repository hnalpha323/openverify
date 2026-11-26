# Government ID chip (NFC) checks

This page describes the `government-id-nfc` verification type as Phase 5 ships it: what a client sends from an electronic passport or ID card's chip, how the server verifies it again, the trust store, the six checks, and what a pass means. The binding contracts are C52.4, C62 and C65.3 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

**Clients (Phase 10, Workflow 10C).** The Android SDK now runs the `nfc` step: the access key, the tap, the review of the chip's data, upload and submit ([NFC on Android](../android/nfc.md)). **The reader for real documents is built** (Workflow 10E): the SDK reads through a `ChipReader` the host app installs, and the optional module `android/openverify-nfc` gives one, on JMRTD. It is proved on the build host only, against a synthetic chip with Basic Access Control and Active Authentication; PACE and Chip Authentication run in no automated test, and **no real document has been read** (the owner's read is an open step of the release gate). That reader sends seven of the eight file kinds the server takes: it does not read EF.CardSecurity, which the server takes only when a client sends it. The [sandbox test chip](#the-sandbox-test-chip) still completes the step without a reader. The web flow cannot read a chip; it shows the step as needing the organisation's app and offers the flow's fallback. An API-driven client that reads the chip itself can still send its files through the flow API, as the end-to-end spec does with synthetic chips.

## Contents

- [What a pass means](#what-a-pass-means)
- [The step and the flow API](#the-step-and-the-flow-api)
- [When a client cannot read a chip](#when-a-client-cannot-read-a-chip)
- [What the device reports, and why the server ignores it](#what-the-device-reports-and-why-the-server-ignores-it)
- [How the server verifies a chip](#how-the-server-verifies-a-chip)
- [The checks](#the-checks)
- [Reuse of a chip across accounts](#reuse-of-a-chip-across-accounts)
- [The trust store](#the-trust-store)
- [The sandbox anchor](#the-sandbox-anchor)
- [The sandbox test chip](#the-sandbox-test-chip)
- [What the verification stores and serves](#what-the-verification-stores-and-serves)
- [Configuration](#configuration)
- [Privacy and retention](#privacy-and-retention)
- [Testing](#testing)
- [Known limits](#known-limits)

## What a pass means

A passed NFC verification means: **data signed by a document's issuer, bound to the person in the live selfie.** In detail, under the default template:

- the document signer's certificate chains to a country signing CA (CSCA) the trust store holds, the signed document security object (SOD) verifies, and every data group sent hashes as the SOD says (passive authentication), with no current CRL revoking the signer;
- the chip portrait (DG2) matches the inquiry's live selfie, whose liveness the selfie step required: this is what stops someone else presenting a stolen or copied set of chip files;
- the chip's MRZ (DG1) matches the MRZ the government ID step photographed, when the flow has one: this ties the chip to the booklet in the user's hands;
- the document has not expired.

It shows that **the chip itself was present only when Active Authentication passed**: the chip signed the server's own nonce with the key its signed DG15 holds. A chip without that key (many passports carry none) passes the chip authentication check as `chip_auth_not_server_verifiable`, a non-blocking answer, so such a pass rests on the selfie and MRZ bindings. Chip Authentication and PACE-CAM cannot be verified on the server (their transcripts are not transferable); what a device reports about them is shown to operators only, never evidence.

## The step and the flow API

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `nfc` | `government-id-nfc` | 3 | `androidOnly: true`, `maxAttempts` |

An `nfc` step must follow a `selfie` step, and a `government_id` step when the flow has one (C50.4, V18). In a production environment a template with an NFC step is refused with 422 `provider_not_configured` while the trust store holds no non-sandbox anchor, unless the type sets `accept-review-without-provider: true` (H28).

A client, in the order the Android SDK follows (Phase 10 C207.2: **the challenge before the tap**, so one tap covers access, reading and the chip's signature):

1. creates the verification (`POST /api/v1/flow/verifications`, `{ "type": "government-id-nfc" }`);
2. asks for a challenge when the person is ready to tap (`POST …/chip-challenges`, `{}`): 201 with an `id`, a `nonce` of 8 random bytes as 16 hex characters, returned once, and `expires-at` five minutes ahead. Only the nonce's SHA-256 is stored. A new challenge replaces the open one; the 11th cancels the verification (a retryable attempt), and the SDK asks for at most nine;
3. reads the chip, and lets it sign the nonce while it is still in the field (Active Authentication);
4. uploads the chip files as read, each to `POST …/files` with its kind: `chip-sod`, `chip-dg1`, `chip-dg2`, and when the chip has them `chip-dg14`, `chip-dg15`, `chip-com`, `chip-card-security`, `chip-card-access`. Each must start with its file's tag and a well-formed length; DG2 may be 1 MiB, the others 64 KiB. DG11 and DG12 are not taken. A chip file kind uploaded again to the same verification replaces the earlier upload: the verification holds one file of each kind, the checks read the latest read only, and the replaced file's row and stored object are deleted at upload, not kept until retention;
5. submits `{ "chip": { "challenge-id", "nonce", "active-authentication-response"?, "device-report"? } }` within the challenge's lifetime. The response is base64 of at most 1 KiB; the device report lists the protocols tried (`bac`, `pace`, `pace-cam`, `chip-authentication`, `active-authentication`) and their outcomes, and the read time.

The server takes steps 2 and 4 in either order: a challenge taken on a new verification before any file is uploaded stays open and is accepted at submit (held by a test against Postgres, `challenge-before-upload.integration.test.ts`). A client that uploads first and asks for the challenge afterwards needs the person to tap twice.

An SDK session at the current `nfc` step also receives, in the step's client view: `fallbackAvailable` (the step has an `exhausted` edge), `sandboxChipAvailable` (below) and, when the flow has a decided government ID read from a TD1 or TD3 MRZ, `prefillMrz` (the document number, date of birth and date of expiry, from which the chip's access key is made). `prefillMrz` is personal data: it is served only to a session whose client declared flow-spec 2 with the SDK's `User-Agent`, only while the `nfc` step is the current position, never to the web flow, and it is masked in the stored API logs. That keeps the values away from a client that cannot use them; it does not stop a holder of the session token who sends the SDK's `User-Agent`.

At submit the server parses the SOD (bounded) and requires every data group among 1, 2, 14 and 15 that the SOD lists: one missing answers 409 `chip_data_required`, so a client cannot withhold DG15 or DG14 unnoticed. A wrong, used or expired challenge is one 409 `chip_challenge_invalid`. A SOD the server cannot parse is still submitted, and passive authentication answers `chip_data_malformed` (review).

## When a client cannot read a chip

A phone without NFC, an app without a reader, a person who leaves NFC off, and every browser cannot read a chip. Such a client may say so (Phase 10 C207.9): `POST /api/v1/flow/verifications/:id/client-unable` with `{ "reason" }`, one of `nfc_unavailable`, `reader_not_installed`, `nfc_disabled_declined`, `read_failed` (Android: the reads of this chip did not finish and the step's chip challenges are spent) and `platform_unsupported` (the web flow).

- **Every reason is self-reported.** Nothing proves that a phone has no NFC, and any client can send any reason. The server stores the reason and the client's platform (`android`, `ios` or `web`) on the step's record as client-reported notes, for operators.
- The route is accepted only for the current step of type `nfc`, only when that step has an `exhausted` edge, and once per verification. Anything else answers 409 `client_unable_not_allowed`.
- The verification ends `canceled`: it never passes. The inquiry then leaves the step through its `exhausted` edge, to the fallback the flow's author drew (usually a document step).
- **The inquiry goes to review when it completes**, unless the step's `onFallback` is `continue` and the published version carries the acknowledgement `client-unable:<step id>`. `fallback:<step id>` covers a person who tried and failed; it does not cover a claim that no reader exists, so publish asks for `client-unable:<step id>` beside it whenever an `nfc` step's fallback continues. A version published before with `fallback:` alone still sends these inquiries to review.
- The person is never told whether their inquiry will be reviewed.
- Publish warns `nfc_fallback_missing` for a reachable `nfc` step without an `exhausted` edge: every web session and every Android session without a reader stops there.

## What the device reports, and why the server ignores it

With the submit a client may send a `device-report`: the protocols it tried (`bac`, `pace`, `pace-cam`, `chip-authentication`, `active-authentication`), how each ended, and the read time. The Android SDK sends its reader's report unchanged.

**None of it is evidence.** The access protocol (BAC or PACE) and Chip Authentication happen between the reader and the chip, and their transcripts cannot be verified by anyone else, so a modified client can report whatever it likes. The server therefore judges only what it can check itself: the signed files (passive authentication), the chip's signature over the server's own nonce (active authentication), the two bindings and the expiry. The report is shown to operators as what the client said, and is cleared when processing ends. The same holds for a `client-unable` reason, and for everything else a device says about itself.

## How the server verifies a chip

`@openverify/emrtd` (pure TypeScript over `asn1js` and `pkijs`, every cryptographic operation through `node:crypto`, C62.1) does the work:

- **Bounded parsing.** A TLV pre-scan (depth 32, 20,000 nodes) runs before any ASN.1 parser on every chip file, and the original byte ranges are kept for the signature checks. Keys are bounded: RSA of 1,024 to 8,192 bits with an exponent below 2³²; EC keys only on brainpool P-192 to P-512 and NIST P-192 to P-521, explicit domain parameters only when they equal one of those curves. Each verification runs under a 5-second budget.
- **Passive authentication** (C62.2) judges **integrity** apart from **revocation**:
  - `established`: an anchor chosen by the signer's authority key id (else by issuer name, accepted only when that anchor's key verifies the signer), not withdrawn and valid now; the signer's certificate verifies under it and has a signer's profile; the SOD's content type, digest and signature verify; every data group sent that the SOD lists hashes identically; DG1's issuer agrees with the certificates' country;
  - `broken`: an anchor chosen by key id verified the signer, the SOD parsed cleanly, and its signature fails or a data group's hash differs: proven tampering;
  - `not_established`: anything else, a trust-store gap or an issuer's defect among them;
  - revocation is `revoked` (on a current CRL), `unrevoked` or `undetermined` (no current CRL). Only a CRL issued under the name of the CSCA that issued the signer counts: serial numbers are unique per issuer only, so another CSCA of the same country can neither revoke the signer nor vouch for it, while a CRL that a rolled-over key signs under the same name still does.
  
  Each data group is `identical`, `not_identical`, `missing_from_upload` (the signed SOD lists it, the client did not send it) or `not_listed`. Passive authentication fetches nothing: it reads the trust store's anchors and CRLs.
- **Active authentication** verifies the response to the server's nonce with the DG15 key, trusted only once integrity is established: RSA by ISO/IEC 9796-2 scheme 1, or plain ECDSA.
- **The self-test.** Explicit-parameter brainpool keys are rare enough that some OpenSSL builds cannot verify them. The worker runs `selfTest()` when it starts, and the trust-store sync first thing; on a failing platform passive authentication answers `algorithm_unsupported` (review) for every chip, never a false break. CI's Node is pinned to the image's (22.22.1).
- **DG2** is decoded as the chip portrait only after its hash verified, through vision's guarded child (JPEG or JPEG 2000, at most 4 megapixels, `docs/checks/document.md`), and its face is compared with the inquiry's latest selfie centre photo.

## The checks

| Check | Default | Fails with | `not_applicable` with |
|---|---|---|---|
| `id_nfc_passive_authentication_detection` | required | `dg_hash_mismatch`, `sod_signature_invalid`, `dsc_revoked`, `specimen_issuer` | `trust_anchor_unavailable`, `trust_anchor_withdrawn`, `dsc_missing`, `crl_unavailable`, `certificate_expired`, `certificate_profile_invalid`, `issuer_country_inconsistent`, `algorithm_unsupported`, `chip_data_malformed`, `input_missing` |
| `id_nfc_chip_authentication_detection` | required | `active_authentication_failed` | `chip_auth_not_server_verifiable` (non-blocking), `active_authentication_withheld`, `active_authentication_unavailable`, `chip_data_malformed`, `integrity_not_established` |
| `id_nfc_mrz_comparison` | required | `document_number_mismatch`, `birthdate_mismatch`, `expiration_date_mismatch`, `name_mismatch`, `nationality_mismatch` | `not_requested` (non-blocking: no ID step), `no_reference_data`, `integrity_not_established` |
| `id_nfc_selfie_comparison` | required | `face_mismatch` | `no_reference_data`, `input_missing`, `integrity_not_established`, `execution_error` |
| `id_nfc_repeat_detection` (ours) | advisory | `chip_seen_on_other_account` (only with `sighting-outcome: fail`) | `chip_seen_on_other_account` (the default), `integrity_not_established` |
| `id_nfc_expired_detection` | required | `expired`, `expiration_date_invalid` (`expired_within_grace_period` rides on a pass) | `input_missing`, `integrity_not_established` |

Every one is a fraud check, and every result carries metadata of states, counts and flags only, never a data group's content.

**Failed only for proven tampering or revocation** (C62.3, decision 36). Integrity `broken` fails with `sod_signature_invalid` or `dg_hash_mismatch`; a DSC on a current CRL fails `dsc_revoked`. Integrity not established, and revocation undetermined under `strict`, answer `not_applicable` with their reason: a trust-store gap or an issuer's defect is ours to resolve, so the verification goes to review. A Utopia (`UTO`) chip in a production environment fails `specimen_issuer`, before anything else (V04).

**The data checks** read the parsed data groups whatever the revocation, and judge them on integrity (C62.4): with integrity established they are judged normally; without it a mismatch still fails (the data contradict the document or the face) and a match answers `integrity_not_established`, never `passed`; with integrity broken they answer `integrity_not_established`.

- **Chip authentication:** passes when the response verifies; fails when a well-formed response does not; `chip_data_malformed` for a malformed one; `active_authentication_withheld` (review) when the SOD lists DG15 and no response came; for a chip whose verified SOD lists no DG15, `chip_auth_not_server_verifiable`, or `active_authentication_unavailable` (review) with `require-active-authentication`.
- **MRZ comparison:** DG1 against the latest government ID reading of the same issuer and document category (P passport, V visa, any other a card), comparing the fields the ID's extraction took from its MRZ. OCR confusables (`0` and `O`, `1` and `I`) are tolerated, because the extraction does not record whether the printed check digits held.
- **Selfie comparison:** the chip portrait's face against the latest decided selfie's centre photo (of a passed or reviewed selfie verification, whose liveness was judged), at the selfie threshold, 0.394 by default, which was calibrated on studio portraits, not on chip portraits, and is provisional here. Without a selfie, `no_reference_data`: chip data alone does not identify the presenter. While the inquiry's latest selfie is still being judged, the job waits for its decision through its retries, then answers `no_reference_data` (review), so a chip is never bound to a selfie whose liveness may yet fail.
- **Expiry:** DG1's expiry date; an expired document fails even when unverified, a current one is evidence only with integrity established.

## Reuse of a chip across accounts

`id_nfc_repeat_detection` (ours, decision 35) counts **sightings**: earlier reads of the same SOD signature (by its blind index) whose verification's selfie comparison passed and which ended passed or in review, in an unredacted inquiry of another account. The current inquiry and its account's other inquiries are left out, and a read whose face did not match is never a sighting. A sighting answers `not_applicable` with `chip_seen_on_other_account` and the count in its metadata (review-level), unless the template sets `sighting-outcome: fail`. It is advisory by default, as the government ID repeat check is: one person on two accounts is an operator's policy (every inquiry created without a reference id gets a new account), and the selfie binding, not this check, stops a different person. It is evaluated only with integrity established.

## The trust store

**Nothing is committed and nothing ships** (C62.7): no master list, CSCA, link certificate or CRL of a real issuer is in the repository. `trust-anchors/manifest.json` lists the sources the operator may sync, each pinning its publisher's root CSCA by URL and SHA-256 (recorded on 2026-10-24 from the publisher's page and checked against the fingerprint published there; Italy publishes only SHA-1):

| Source | Publisher | Enabled |
|---|---|---|
| `bsi-de` | the German Federal Office for Information Security's master list | yes |
| `npkd-nl` | the Netherlands' master list | no |
| `ita` | Italy's master list | no |
| `che` | Switzerland's master list | no |

The disabled sources are opt-in after the operator's own legal review (decision 40). The BSI list may be used commercially as long as OpenVerify does not advertise with it, and may not be mirrored without consent, so it is fetched only by the operator (decision 38). ICAO's own master list and its PKD are non-commercial and not fetched; the operator may import files they are entitled to (decision 39).

**The sync** runs the self-test, then for each enabled source fetches through the outbound client (16 MiB lists, 5 MiB CRLs, 15 s, private networks refused; an answer without a content type is taken, since every payload is checked against its pin or signature, but a wrong type is refused), and:

1. checks the root against its pin (DER, PEM or inside a zip, read by a bounded reader);
2. verifies the master list against the root: the signer's profile and key usage, its issuer (the root or a link the root verifies), the content type, the digest and the signature over the original bytes; a list whose signer a current CRL revokes is refused;
3. imports self-signed CSCAs and, once a held anchor verifies them, link certificates; never a Utopia certificate or a master-list signer;
4. fetches national CRLs (a distribution point not under `icao.int`; ICAO PKD CRLs only with `OPENVERIFY_NFC_ALLOW_ICAO_CRLS=true`), each verified under its anchor, current (`thisUpdate ≤ now < nextUpdate`) and with a CRL number not below the stored one. A distribution point may redirect once, to an https URL, which the same client asks with its private-network refusal, cap and deadline; a second redirect is refused. The hop adds no trust: the CRL must still verify. A master list or a root certificate follows no redirect;
5. applies the list in one transaction under the source's advisory lock: a list older than the source's last is refused (rollback), and every membership of that source the new list leaves out is withdrawn. An anchor that no enabled source lists now is withdrawn, and passive authentication answers `trust_anchor_withdrawn`.

Every outcome is written to `trust_anchor_syncs` (`accepted`, `refused` or `failed`, with a reason code). Commands:

```bash
pnpm --filter @openverify/api trust-anchors:sync                    # every enabled source
pnpm --filter @openverify/api trust-anchors:sync --source bsi-de     # one source
pnpm --filter @openverify/api trust-anchors:sync --import list.ml --root root.pem   # a file you hold
scripts/fetch_trust_anchors.sh [same arguments]                      # the same, from the repository root
```

The command prints one line per source and exits 1 when one was refused or failed. With `OPENVERIFY_TRUST_ANCHOR_REFRESH=true` the worker runs the same sync every six hours. The sync never runs in CI. The console reads the store through `GET /api/v1/dashboard/trust-anchors` (`settings:read`): the sources and their last sync, usable and withdrawn anchors per country with the next expiry, CRL freshness, the sandbox anchors, and whether the refresh job runs and ICAO PKD CRLs are allowed (`settings`). The API reports these two as its own process reads `OPENVERIFY_TRUST_ANCHOR_REFRESH` and `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`, so give the API the same values as the worker; compose passes both to each.

**Without CRLs, review.** Without ICAO PKD CRLs, about a fifth to a third of issuers have no current CRL the sync can fetch, and some CSCAs name no distribution point at all. Under `strict` revocation (the default) those passports' passive authentication answers `crl_unavailable` and goes to review, while their data checks are still judged. The German CSCA's distribution point redirects: the sync follows one redirect when it names an https URL (a redirect to plain http still leaves German chips' revocation undetermined). The Dutch and Swiss lists, served without a content type, can be fetched once those sources are enabled.

## The sandbox anchor

`seed:dev` refuses to run in production mode and inserts the deterministic **Utopia** test CSCA (country `UT`, built by `@openverify/emrtd/testing` from a fixed seed, valid from 1 January of last year for 16 years), sandbox-only, with a CRL current for 90 days (re-running the seed refreshes it), under the enabled source `openverify-sandbox` (C62.8). The repository function that loads anchors for passive authentication takes the environment's kind and leaves sandbox-only anchors out, in SQL, for production environments. A Utopia chip in a production environment therefore never verifies, and fails `specimen_issuer`.

## The sandbox test chip

A device has no synthetic chip to tap, so in a **sandbox** environment the server builds one (Phase 10 C208): `POST /api/v1/flow/verifications/:id/sandbox-chip` with `{ "challenge-id", "scenario" }`. The Android SDK offers it on the tap screen as "Test chip (sandbox)" when the step's client view says `sandboxChipAvailable`, which the server sets only in a sandbox environment whose trust store holds the current Utopia anchor.

- **What the server builds:** a chip signed under the sandbox Utopia anchor, with DG1 from the latest decided government ID's MRZ (or a fixed synthetic one), a portrait, and a per-verification Active Authentication key in DG15 that signs the challenge's nonce.
- **What it returns:** every file but DG2, as base64, with the Active Authentication response. **No image leaves the server:** DG2 is attached to the verification on the server, from the stored selfie, and the answer says `dg2-attached: true`. The client uploads the returned files through the real upload route and submits as for any chip, so the checks above run unchanged.
- **Scenarios:** `match` (the default: every required check passes), `mrz-mismatch`, `face-mismatch` (the portrait of another person; fails the selfie comparison), `no-active-authentication` (answers `chip_auth_not_server_verifiable`) and `tampered-dg1` (fails `dg_hash_mismatch`).
- **`face-mismatch` needs fixture faces**, which are never committed and never shipped in an image. It is offered only where `OPENVERIFY_SANDBOX_CHIP_FACES` names the directory of generated fixture faces, `fixtures/generated/selfie/`, which `services/vision/tools/make_synthetic_fixtures.py` writes on a development host from the pinned public-domain faces; the chip carries its file `head-turn-b-center.jpg`. The end-to-end stack sets it to that directory, and the integration tests to a directory of their own; elsewhere it answers 422 `sandbox_chip_scenario_unavailable`.
- **The anchor.** Without the current Utopia anchor in the sandbox trust store the route answers 409 `sandbox_chip_anchor_missing`. `seed:dev` installs it but refuses production mode, so a deployment installs or refreshes it with:

  ```bash
  pnpm --filter @openverify/api trust:sandbox-utopia
  ```

  The anchor is sandbox-only in any mode: production environments' loaders never see it ([the sandbox anchor](#the-sandbox-anchor)).
- **Limits:** the route answers the 404 of an unknown route outside a sandbox environment, is accepted only for the session's own NFC verification, and is rate-limited per inquiry (`flow-sandbox-chip`, 10 an hour). The module that builds test chips is loaded only behind the environment check.
- **The label.** The scenario is recorded on the chip challenge and served as the verification attribute `sandbox-chip`, left out for every other chip, so a verification read from a test chip can always be told apart.
- **What it proves:** the flow, the client's screens and the server's checks, end to end. **Never a reader**, and never anything about a real document.

## What the verification stores and serves

- **`chip_reads`** (only once integrity was established): DG1's fields sealed, the SOD signature sealed with its blind index and a blind index of the document number, the integrity, whether the read is selfie-bound, the issuing country, and a non-personal summary of passive authentication. The chip portrait is stored as a server-written PNG (`chip-portrait`). The decision's `verification.*` event lists it among the verification's files.
- **The challenge's evidence:** the Active Authentication response (sealed with its nonce) and the device report are cleared when processing ends.
- **Attributes** (C52.8; server and console APIs, never the flow API): `name-first`, `name-last`, `birthdate`, `sex`, `expiration-date`, `identification-number` and `nationality` (personal data: masked without `pii:view`, `null` after redaction), `id-class`, `issuing-country` (ISO alpha-2, `UT` for Utopia), `passive-authentication` (`outcome`, `integrity`, `anchor-source`, `hash-algorithm`, `revocation`), `active-authentication` (`outcome`) and, only for a verification read from a [sandbox test chip](#the-sandbox-test-chip), `sandbox-chip` (the scenario). Without integrity there is no chip read, so the DG1 members, the class and the country are `null`.
- **The console** serves the chip portrait; the raw chip files answer 404 on its file route.

## Configuration

| Check | Key | Default | Basis |
|---|---|---|---|
| passive authentication | `revocation` (`strict`, `best-effort`) | `strict` | ICAO Doc 9303-12 App. D.1.2, BSI TR-03135 |
| passive authentication | `accept-sha1` | true, flagged | 36 of 609 German CSCAs are SHA-1 signed |
| chip authentication | `require-active-authentication` | false | decision 33 |
| repeat | `sighting-outcome` (`review`, `fail`) | `review` | decision 35 |
| selfie | `threshold` | 0.394 | the selfie threshold, uncalibrated for chip portraits |
| expiry | `grace-days` | 0 | ours |

Under `best-effort`, an undetermined revocation passes with the flag `revocation-undetermined`. The type also takes `accept-review-without-provider` (above). Every default is provisional and recorded as `threshold-basis` on the result.

## Privacy and retention

DG1, DG2, the SOD and the chip portrait are verification evidence and biometric data (decision 43): sealed or encrypted at rest, masked in views without `pii:view`, deleted or nulled by redaction. The Active Authentication response and the device report are cleared once processing ends; DG11 and DG12 are never taken. Rows follow the inquiry's retention, and the default keeps inquiries forever: set `inquiry-retention-days`.

## Testing

Chips are synthetic (C65.3, decision 42): `@openverify/emrtd/testing` builds keys from fixed seeds, CSCAs, signers, link certificates, CRLs, master lists and chips under the Utopia issuer, in 15 variants (tampered data groups, a malformed or version 0 SOD, SHA-1, issuer-and-serial signer ids, a wrong signer identifier, trailing bytes, an Active Authentication key that is not DG15's, and more). No key file or real chip data exists in the repository. The full-stack spec `e2e/tests/nfc-chip.spec.ts` acts as the Phase 10 reader would: it builds a chip under the seeded Utopia CSCA with this run's signer, the TD3 page's MRZ and person A's JPEG 2000 portrait, uploads it with the TD3 page as a one-sided ID and person A's selfie, and every required NFC check passes; the same files replayed into an inquiry of another account with person B's selfie fail `face_mismatch`, and the repeat check counts the first read as one sighting. A tampered DG1 is tested against Postgres only (V05), as are the races of every chip writer and the trust-store sync over synthetic lists.

## Known limits

- The DG2 path for ISO/IEC 39794-5 follows the published structure, but no licensed sample could be used to confirm it; ISO/IEC 19794-5 is the common case.
- BSI defect lists and ICAO deviation lists are not read (decision 41): a document with a known issuer defect ends in review.
- `issuer_mismatch` is never answered: the issuer selects the MRZ reading to compare, so a chip of another issuer finds no reference (`no_reference_data`).
- The MRZ comparison tolerates OCR confusables on every reading, since whether the printed check digits held is not recorded.
