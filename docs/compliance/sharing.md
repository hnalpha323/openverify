# Sharing between organisations (Connect)

This is not legal advice.

Not reviewed by counsel.

Connect moves a person's verified data from one organisation (the source) to another (the destination) on the same install, with the person's consent or the source's attested consent ([Connect](../connect/README.md); ADR 0010, `docs/adr/0010-connect-release-hardening-and-deployment.md`). Each organisation is a controller of its own copy. This page maps their duties onto what the software records. A hosting operator between two clients is on [roles](roles.md).

## Off unless allowed

Connect is served only when the install sets `OPENVERIFY_CONNECT_ENABLED=true` (default `false` in the images and the chart), and an organisation receives connections only after its admin turns on `connect-inbound` (C231.10). Activating a connection is the destination's admin's act in the console, behind a step-up, with an `agreement-reference`: the reference of the data-sharing agreement between the two organisations, sealed, which the platform does not judge (C231.3).

## Both controllers' duties, and the software's side

| Duty | What the software records or enforces | What stays yours |
|---|---|---|
| A basis to disclose and to receive | A consent record on each side (`consent-record`, `cnsr_`): `flow` records from the `share-consent` step, witnessed in a session, or `attested` records with the operator's own text, labelled "not witnessed" (C236) | Whether consent is the right basis, and the agreement between you |
| Telling the person who receives what | The source-side text always names the destination; the categories, the purpose, the expiry, the destination's retention term and how to withdraw are filled in by the server; the digest of the text served is kept (C236.3, C238.3) | The wording: the built-in `share.consent.*` texts are **not reviewed by counsel** and are marked so to the operator; publishing a step that uses them needs the audited acknowledgement `share-consent-default-text` (C238.10, Q7) |
| Biometric categories | A separate, unticked biometric tick with its own text and digest; face templates are never shared (C236.7) | The Article 9 condition at each end ([biometric data](biometric-data.md)) |
| Withdrawal | Withdrawal by API, console or, while the flow session lives, the person's own exit; future transfers stop; a copy already made is not recalled, and the counterparty receives `connect/share-token.consent-withdrawn` (C237) | Acting on the event at your end; giving the person a way to withdraw after the flow ends (the text names your contact, `withdrawal-contact`) |
| What a copy counts for | A cloned result is never a fresh pass; it lands in review unless the destination's template accepts cloned results, and is marked as cloned everywhere (C235) | Whether to rely on another organisation's checks |

**Whether operator-mediated withdrawal is as easy as giving consent.** Article 7(3) of the UK GDPR (re-read on 2026-11-20, [S2](sources.md)) lets a person withdraw at any time and asks that withdrawing be as easy as consenting. Once the flow has ended, withdrawal in this release goes through the organisation's own contact; whether that meets the rule is a question for counsel ([questions for counsel](questions-for-counsel.md)). The EU text was not re-read ([S1](sources.md)).

## Recipients, erasure and rectification

- **The disclosure record.** A redeemed share token is kept, holding ids only, while the source object or any destination copy exists (C241.4). It lets the source name each recipient on request, as Article 15(1)(c) asks, and the access export names each recipient of a redeemed share ([access requests](access-requests.md)).
- **Telling recipients.** Article 19 of the UK GDPR (re-read, [S2](sources.md)) asks a controller to tell each recipient of a rectification, erasure or restriction unless that is impossible or disproportionate, and to tell the person who the recipients are if asked. When the source redacts an object after redemption, the destination receives `connect/share-token.source-redacted`, advisory only: its operator decides what its own law requires (C241.2). The platform cannot reach a copy outside itself.
- Before redemption, a source's redaction fails its pending tokens (C241.1).

## Transfers between jurisdictions

When the destination organisation is established outside the source's jurisdiction, a share can be a restricted transfer whatever server holds both rows. Chapter V of the UK GDPR, as amended from 2026-02-05 (re-read, [S2](sources.md)), allows a transfer only on the routes its Article 44A names: a destination approved by regulations, appropriate safeguards (such as standard data protection clauses), or a listed derogation. The EU's Chapter V was not re-read ([S1](sources.md)). The `agreement-reference`'s help text asks for the agreement that also records the transfer safeguards. Whether a given share is a restricted transfer is a question for counsel.

## Information to the person

For an attested redemption, where the destination receives data it did not collect from the person in a session it witnessed, Article 14 of the UK GDPR (re-read, [S2](sources.md)) asks the destination to tell the person, within a reasonable period and at the latest within a month (or at first contact, or before a further disclosure), who it is, its purposes and basis, the categories of data, the recipients, any transfer, the retention period, the person's rights and the source of the data, subject to the exceptions in Article 14(5). The software gives the destination the source's organisation name in each copy's provenance (C235.1) and the categories in the token; the notice itself is the destination's.

## Illinois BIPA at the destination

BIPA's section 15(b), as previously published, asks for written notice of the purpose and the length of term, and a written release, before biometric data is collected (**not re-read on 2026-11-20: TLS verification failed, [S5](sources.md)**). For a destination-side `share-consent` step that can receive biometric categories, the server fills the destination's retention term into the text (`{retention}`) and publish refuses the step when the template and the environment have no retention to fill in (`share_consent_retention_missing`, C238.9). The release's wording is yours.

## Retention

Consent records keep their bare fact for `consent-proof-retention-days` (default 0) after the covered data is gone; tokens that expired or failed are deleted after 30 days; connections and their agreement references are kept ([retention](retention.md)).
