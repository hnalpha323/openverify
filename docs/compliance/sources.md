# Legal sources and their re-read

This is not legal advice.

Not reviewed by counsel.

Every statute, regulation and guideline the compliance guide cites, the official place it was read from, and the result of the re-read that C278.3 asks for before the guide is committed (decision 45). A source that could not be read is never read some other way: a challenge page, a failed TLS check or a page that needs script is recorded as it happened, and every page that relies on the source says "not re-read on <date>: <reason>" where it cites it. Each summary on these pages is in our own words; no page reproduces a legal text.

All re-reads were made on 2026-11-20 by `docs-compliance` (Workflow 11E). The evidence, with the commands and the answers, is in [the TDD file](../tdd/phase11-docs-compliance.tdd.md).

## The sources

| Id | Source | Read from | Result | Cited on |
|---|---|---|---|---|
| S1 | Regulation (EU) 2016/679 (the EU GDPR): Articles 7(3), 9, 12(3), 14, 15(1)(c), 19, 22, 28, 30, 33, 35 and Chapter V | `eur-lex.europa.eu`, the CELEX page and the ELI page | **not re-read on 2026-11-20: EUR-Lex returned an empty body for both pages** (the 2026-10-29 research met a challenge page there too). Every EU article number in the guide is cited from the Regulation as published, and the UK text below was read in its place where the UK text has the same article | every page |
| S2 | The UK GDPR as amended: Articles 7, 9, 12, 14, 15, 19, 28, 30, 33, 35 and Chapter V | `legislation.gov.uk/eur/2016/679/article/<n>` and `/chapter/V` (latest revised text) | re-read on 2026-11-20 | [biometric data](biometric-data.md), [access requests](access-requests.md), [roles](roles.md), [DPIA](dpia.md), [breach response](breach-response.md), [sharing](sharing.md), [record of processing](record-of-processing.md) |
| S3 | The UK GDPR's Article 12A (the applicable time period) | `legislation.gov.uk/eur/2016/679/article/12A` answered 404; read instead in section 76 of the Data (Use and Access) Act 2025, which inserts it (S4) | re-read on 2026-11-20 through S4 | [access requests](access-requests.md) |
| S4 | Data (Use and Access) Act 2025, sections 76, 78 and 80 | `legislation.gov.uk/ukpga/2025/18/section/<n>` | re-read on 2026-11-20: s. 76 in force from 2026-02-05 (S.I. 2026/82); s. 78 in force from Royal Assent, treated as in force from 2024-01-01; s. 80 in force for its remaining purposes from 2026-02-05 | [access requests](access-requests.md), [README](README.md#automated-decisions) |
| S5 | Illinois Biometric Information Privacy Act, 740 ILCS 14, and Public Act 103-0769 | `www.ilga.gov` and `ilga.gov` | **not re-read on 2026-11-20: both hosts failed TLS certificate verification ("unable to verify the first certificate"), and the check was not bypassed** (the same failure as on 2026-10-29) | [US state laws](us-state-laws.md), [sharing](sharing.md) |
| S6 | Revised Code of Washington, chapter 19.375 | `app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true` | re-read on 2026-11-20 | [US state laws](us-state-laws.md) |
| S7 | Texas Business and Commerce Code, chapter 503 | `statutes.capitol.texas.gov/Docs/BC/htm/BC.503.htm` | **not re-read on 2026-11-20: the page rendered site navigation only, no statute text without script** | [US state laws](us-state-laws.md) |
| S8 | Colorado HB24-1130 (biometric identifiers in the Colorado Privacy Act) | `leg.colorado.gov/bills/hb24-1130` (the bill page) | re-read on 2026-11-20 (the bill page's summary: approved 2024-05-31, effective 2025-07-01); the section as codified in the Colorado Revised Statutes was not read | [US state laws](us-state-laws.md) |
| S9 | California Civil Code sections 1798.140 and 1798.121 (the CCPA as amended) | `leginfo.legislature.ca.gov` | **not re-read on 2026-11-20: the site answered HTTP 403** | [US state laws](us-state-laws.md) |
| S10 | The California Privacy Protection Agency's announcement of 2025-09-23 (the regulations on cybersecurity audits, risk assessments and automated decision-making technology) | `cppa.ca.gov/announcements/2025/20250923.html` | re-read on 2026-11-20 | [US state laws](us-state-laws.md) |
| S11 | Regulation (EU) 2024/1689 (the AI Act), Annex III point 1 | `ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3` (the Commission's AI Act Service Desk) | re-read on 2026-11-20 on the Service Desk; the Official Journal text on EUR-Lex was not read (S1's failure) | [biometric data](biometric-data.md) |
| S12 | Article 29 Working Party, Opinion 9/2014 on device fingerprinting (WP 224), section 7.5 | `ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp224_en.pdf` | re-read on 2026-11-20 | [device and network data](device-and-network.md) |
| S13 | CNIL, délibération n° 2020-091 of 17 September 2020 (guidelines on cookies and other trackers), paragraph 49 | `legifrance.gouv.fr` (HTTP 403), then the CNIL's own PDF on `cnil.fr` | **re-read in part on 2026-11-20**: Légifrance answered 403; the CNIL's PDF was read, but our text extraction lost part of paragraph 49's list, so its item on authentication and its security was not legible. The paragraph is cited as Phase 7 recorded it | [device and network data](device-and-network.md) |
| S14 | The Privacy and Electronic Communications (EC Directive) Regulations 2003, Schedule A1, paragraph 4 | `legislation.gov.uk/uksi/2003/2426/schedule/A1` | re-read on 2026-11-20: inserted on 2026-02-05 by the Data (Use and Access) Act 2025 | [device and network data](device-and-network.md) |
| S15 | Proceeds of Crime Act 2002, section 333A (tipping off in the regulated sector) | `legislation.gov.uk/ukpga/2002/29/section/333A` | re-read on 2026-11-20 (subject to the exceptions of ss. 333B to 333D) | [access requests](access-requests.md) |

## What a re-read is, and is not

- A re-read checks that the guide's short description of a provision matches the official text on that day. It does not interpret the provision for any deployment, and it does not follow later amendments: the UK pages showed revisions dated as late as 2026-09-30, and an operator reads the text in force on its own date.
- State breach-notification laws are named on [breach response](breach-response.md) only as a category, so no single statute is cited or re-read there.
- Counsel's review of the guide is the owner's (Q7) and has not happened: see [questions for counsel](questions-for-counsel.md).
