# Compliance guide

This is not legal advice.

Not reviewed by counsel.

This guide maps what data-protection and biometric-privacy law asks of an organisation that runs identity verification onto what OpenVerify does at this commit, so that the organisation and its counsel can see which duties the software helps with and which remain theirs. It does not say that any deployment complies with any law, and nothing OpenVerify does makes a deployment compliant: whether yours is depends on facts only you hold (your purposes, your users, your contracts, your jurisdictions). Counsel's review of this guide is pending (owner item Q7); every page says so until it is recorded.

Every claim about the software names the contract or the path that holds it. Every legal source was re-read from its official text on 2026-11-20, or is marked "not re-read" with the reason where it is cited ([sources](sources.md)).

## Pages

| Page | What it covers | Contract |
|---|---|---|
| [Roles](roles.md) | Controller, processor, the hosting operator between two organisations, and the project | C278.1 |
| [Biometric data](biometric-data.md) | Special-category data, face and background lists, the EU AI Act's verification carve-out | C278.2 |
| [US state laws](us-state-laws.md) | Illinois BIPA, Washington RCW 19.375, Texas ch. 503, Colorado's 2024 amendment, California | C278.2 |
| [The DPIA and its inputs](dpia.md) | What the threat model, the data classification and the check catalog give an impact assessment | C278.2 |
| [Access and other requests](access-requests.md) | The access export, redaction for erasure, the time limits, the search you still make, the exemptions you judge | C278.2, C278.4, C253 |
| [Device and network data](device-and-network.md) | Session integrity on the strictly-necessary basis, device recognition, the network data, Android | C278.2 |
| [Lists, the graph and transactions](lists-graph-transactions.md) | Third-party data on lists, the graph as profiling, transaction records | C278.2 |
| [Workflows, cases, exports and analytics](operations.md) | Workflow egress, cases, exports and bulk reports, aggregated analytics | C278.2 |
| [Licensed and public-sector data](licensed-data.md) | Sanctions lists, the UN list (Q10), chip trust anchors, network data licences, the SCUBA files | C278.2 |
| [Third-party recipients](recipients.md) | Every provider an install can bind, what it sends where, and the egress that is not a provider (generated from the provider registry) | C278.2 |
| [Retention and backups](retention.md) | Every retention setting with its default, the retention pass, backups | C278.2 |
| [Breach response](breach-response.md) | What the install records, and the notification duties that stay yours | C278.2 |
| [Sharing between organisations](sharing.md) | Connect: both controllers' duties, consent records, recipients, transfers | C278.2 |
| [Questions for counsel](questions-for-counsel.md) | Q7's questions and every inference this guide makes | C278.4, Q7 |
| [Sources](sources.md) | Each legal source, where it was read, and the re-read result | C278.3 |
| [Record of processing](record-of-processing.md) | A template generated from the data classification and the recipient list | C278.5 |
| [Automated decisions](automated-decisions.md) | Phase 8's decision records and the four duties (Phase 8's page) | C128, H13 |
| [Session integrity: a strictly-necessary assessment template](session-integrity.md) | Probe by probe, what the session-integrity tier reads (Phase 10's page) | C211, H11 |

## What the software provides, and what only you can do

| Topic | What OpenVerify provides at this commit | What only the operator can do |
|---|---|---|
| A lawful basis | A consent step with recorded consent and notice keys (`POST /api/v1/flow/consent`); per-template choice of checks; a recorded basis for biometric lists (`biometric-lists-basis`) and for device recognition's exempt mode (`device-recognition-basis`) | Choose and document the basis for each purpose, including the Article 9 condition for biometric data |
| Notice | Built-in notice and consent texts, operator copy, and the digest of the text shown (`docs/android/themes-and-languages.md`) | Write your privacy notice; confirm the built-in texts suit you (the notice texts stay at ADR 0006's defaults until the owner confirms their wording, owner decision 8 after 7A; the built-in `share.consent.*` texts are not reviewed by counsel, C238.10) |
| Minimisation | Collection tiers off or on per environment (`signal-collection`), A-tier providers unbound until you bind them, face templates never shared | Decide what each template asks for |
| Access, erasure and other requests | The access export (C253), redaction routes for accounts and inquiries, retention settings | Identify the person, search beyond the account's links, judge exemptions, answer in time |
| Automated decisions | Decision records, the contest route and publish refusals (Phase 8, [automated decisions](automated-decisions.md)) | The basis, the notice, the human review you promise |
| Security | Sealed columns, roles and scopes, audit logs, MFA, rate limits (the [threat model](../security/threat-model.md), the [data classification](../security/data-classification.md)) | Run the install securely ([self-hosting](../self-hosting/README.md)), manage keys, train staff |
| Retention | Per-environment windows and the retention pass ([retention](retention.md)) | Set windows that match your purposes; align backups |
| Recipients | Every adapter unbound until configured, except GLEIF (`businessRegistry`) and RDAP (`domainAge`), which an unset variable binds ([recipients](recipients.md)) | Sign processor terms with each provider you bind ([recipients](recipients.md)); list them in your record |
| Breach | Audit logs, API logs, request ids | Detect, assess and notify ([breach response](breach-response.md)) |
| DPIA | Its inputs ([DPIA](dpia.md)) | Carry it out and keep it |

## Automated decisions

Phase 8's page [automated decisions](automated-decisions.md) is the guide's page on this topic: it lists what OpenVerify records and refuses for a decision a workflow makes (the decision record, `inquiry_decisions`, and the publish gates of C128) and the four duties the operator carries. Two points from 2026-11-20's re-read add to it:

- In the UK, section 80 of the Data (Use and Access) Act 2025 replaced Article 22 of the UK GDPR with Articles 22A to 22D (in force for its remaining purposes from 2026-02-05; [S4](sources.md)). In our reading of the text: a decision with a legal or similarly significant effect that rests solely on automated processing needs safeguards that let the person learn about it, make representations, obtain human intervention and contest it; where it rests on special-category data, such as biometric data, it is allowed only with explicit consent or under a contract or legal requirement that also meets Article 9(2)(g). Whether a given OpenVerify decision is "solely automated" depends on your review practice.
- The EU's Article 22 was not re-read (EUR-Lex returned no text, [S1](sources.md)).

## Honesty

This guide describes the law's demands and the software's features side by side. It is self-assessed, not reviewed by counsel, and it does not certify or attest anything; no page says that a deployment is lawful. The threat model and the security checklists are likewise self-assessed ([security](../security/README.md)).
