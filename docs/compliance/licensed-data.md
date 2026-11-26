# Licensed and public-sector data

This is not legal advice.

Not reviewed by counsel.

Data an install downloads from publishers, under each publisher's terms, and the licence decisions that shape what ships. The rules are ADR 0005 (`docs/adr/0005-report-honesty-and-live-public-sector-data.md`) for reports and lists, ADR 0006 for network data and the trust store's own page for chip anchors.

## Sanctions and politically exposed persons

- **Synced at run time, never shipped.** The install's own sync downloads each list; nothing is in the repository or an image ([watchlist](../reports/watchlist.md)).
- **Enabled by default:** the OFAC lists (US government works), the EU Financial Sanctions Files (the operator supplies the catalogue's public token, `OPENVERIFY_EU_FSF_TOKEN`; credit the source) and the FCDO UK Sanctions List (Open Government Licence v3.0) (ADR 0005).
- **The UN Security Council list is enabled only by an environment admin's audited opt-in** (C254.1): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is `true` by default since the owner's answer to Q10 (granted 2026-11-21, on ADR 0005's reading), no image bakes a value, no seed opts an environment in, and each environment that screens `un-sc` holds an admin's acknowledgement of the UN's terms with the user and time, audited; an install that sets the variable `false` locks the list. The UN site's terms grant personal, non-commercial use; whether your use fits is yours to decide before you opt in.
- **Politically exposed persons** come from the operator's own Wikidata sync (CC0), sent with the operator's contact in `OPENVERIFY_WIKIDATA_USER_AGENT`; screening runs against the local mirror, never with an end user's name ([politically exposed persons](../reports/politically-exposed-person.md)).
- **Not used:** OFSI's closed list; OpenSanctions data (CC BY-NC).
- Each result names the sources that produced it, with their attribution.

## Adverse media

`adverseMedia` is unbound by default. Binding `gdelt-doc` needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`, because every query sends the screened name to a third party; only a URL, domain, dates, language, source country and a short title are stored (ADR 0005; [recipients](recipients.md)).

## Chip trust anchors (CSCA master lists)

- No master list, country signing CA, link certificate or revocation list of a real issuer is in the repository or an image. `trust-anchors/manifest.json` lists the sources an operator may sync, each pinned by its publisher's root ([NFC checks](../checks/nfc.md#the-trust-store)).
- The German BSI's list is enabled for the operator's own fetch: it may be used commercially as long as OpenVerify does not advertise with it, and may not be mirrored without consent. The Netherlands', Italy's and Switzerland's lists are opt-in after the operator's own legal review. ICAO's master list and PKD are non-commercial and are not fetched; an operator may import files it is entitled to (`OPENVERIFY_NFC_ALLOW_ICAO_CRLS`, off by default, lets the sync fetch ICAO PKD revocation lists; turning it on is your licence decision).
- The sync is the command `trust-anchors:sync`; the worker's periodic refresh runs only when `OPENVERIFY_TRUST_ANCHOR_REFRESH` is `true` (default `false`).

## Network data

DB-IP Lite (CC-BY-4.0, attribution shown with each network fact), the Tor exit list and cloud providers' published ranges are downloaded by the install itself ([network data](../network/README.md)). An IP-reputation file is the operator's own licence, read locally (`OPENVERIFY_IP_REPUTATION_MMDB_PATH`).

## Licence decisions in what ships

- **SCUBA's two files.** Two files of `net.sf.scuba:scuba-smartcards` (`CommandAPDU.java`, `ResponseAPDU.java`) are `GPL-2.0-only WITH Classpath-exception-2.0`. The owner granted an exception narrowly on 2026-11-08 (Phase 10 P1): unmodified, from Maven Central, and only inside the optional `openverify-nfc` artifact, with the GPL-2.0 and Classpath-exception texts and the files' source location in its notice. It is recorded in `THIRD_PARTY_LICENSES.md` section 6 and in the project's rule 4, and it is not a precedent. The core SDK depends on no part of it (`android/openverify-nfc/`).
- **Eigen inside ONNX Runtime** (MPL-2.0), unmodified, in `onnxruntime-android` (`openverify-face`), `onnxruntime-web`'s WebAssembly in the flow and the vision image's `onnxruntime` wheel: Phase 10 P2, granted narrowly on the same terms and recorded in the same section.
- **The vision image's OpenCV wheel** bundles FFmpeg (LGPL-2.1-or-later), libquadmath and libgfortran; the owner's decision on them is pending (KP11-39, open).

These records are about the software's licences; they do not change any data publisher's terms, which an operator accepts by syncing.
