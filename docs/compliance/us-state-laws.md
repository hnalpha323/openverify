# US state laws on biometric data

This is not legal advice.

Not reviewed by counsel.

Four state laws that bear on face matching, and California's privacy law, each with what the software provides beside it. Each summary is ours; several sources could not be re-read on 2026-11-20 and say so where they are cited ([sources](sources.md)). Other states have enacted or amended biometric and privacy laws; this page does not list them.

## Illinois: the Biometric Information Privacy Act (740 ILCS 14)

**Not re-read on 2026-11-20: the Illinois General Assembly's site failed TLS certificate verification on both of its host names, and the check was not bypassed ([S5](sources.md)).** The points below are the Act and Public Act 103-0769 as previously published and recorded in the Phase 11 research, unverified against today's text:

- a publicly available written policy with a retention schedule and destruction guidelines, destroying the data when the purpose is met or within three years of the person's last interaction, whichever comes first (section 15(a));
- before collection, telling the person in writing that biometric data is collected, its specific purpose and the length of term it is collected, stored and used, and obtaining a written release (section 15(b));
- no sale or profit from the data (15(c)), disclosure only in listed cases (15(d)), and reasonable care in storing and transmitting it (15(e));
- a private right of action with liquidated damages per violation (section 20); Public Act 103-0769 (2024) counts repeated collection by the same method from the same person as one violation.

| Duty | What OpenVerify provides | What stays yours |
|---|---|---|
| Retention schedule and destruction | `face-template-retention-days` (default 365 days), `inquiry-retention-days` (unset by default: set it), `item-retention-days` on biometric lists, redaction routes and the retention pass ([retention](retention.md)) | The written public policy, windows that meet the three-year limit, applied to backups too |
| Notice and written release before collection | Consent keys per template, the separate `consent.biometric-matching` tick, the digest of the text shown, the destination's retention term filled into Connect's consent text (`{retention}`, C238.9) | The wording of the notice and release (the built-in texts are not reviewed by counsel), the purpose and the term |
| No sale; limited disclosure | Providers unbound until configured; Connect only with consent ([sharing](sharing.md)) | Your contracts and practices |
| Reasonable care | Sealed templates, access control, audit ([threat model](../security/threat-model.md)) | Running the install securely |

## Washington: RCW 19.375

Re-read on 2026-11-20 ([S6](sources.md)). In our reading:

- **Enrolment for a commercial purpose** needs, first, one of three alternatives: notice, consent, **or** a mechanism that prevents the later use of the identifier for a commercial purpose (RCW 19.375.020(1)); the notice and consent required depend on the context.
- An enrolled identifier may not be sold, leased or otherwise disclosed for a commercial purpose without consent, except in listed cases (among them providing a product the person asked for, legal compliance, and a third party contractually bound not to disclose further).
- Reasonable care against unauthorised access; retention only as long as reasonably necessary to comply with law, to protect against fraud or security risks, or to provide the service the identifier was enrolled for.
- Enforcement is by the attorney general only, under the Consumer Protection Act (RCW 19.375.030); financial institutions subject to Title V of the Gramm-Leach-Bliley Act are outside the chapter (RCW 19.375.040).
- **The definition of a biometric identifier excludes physical or digital photographs and data generated from them** (RCW 19.375.010). Whether a face template computed from a selfie photograph falls inside that exclusion is an open question for counsel ([questions for counsel](questions-for-counsel.md)).

The software side is the same as for Illinois: consent and notice keys, retention windows, providers unbound until configured, sealed templates.

## Texas: Business and Commerce Code chapter 503

**Not re-read on 2026-11-20: the Texas statutes site rendered no statute text without script ([S7](sources.md)).** As recorded in the Phase 11 research and unverified against today's text: notice and consent before capturing a biometric identifier for a commercial purpose, limits on sale and disclosure, destruction within a year of the purpose ending (with exceptions), and civil penalties enforced by the attorney general. The software side is as above.

## Colorado: the 2024 amendment (HB24-1130)

Re-read on 2026-11-20 on the General Assembly's bill page ([S8](sources.md)); the codified section was not read. The bill amends the Colorado Privacy Act for biometric identifiers: disclosure and consent before collection, limits on employers asking employees to consent, a written policy with a retention schedule and deletion deadlines (made public, with exceptions), and a protocol in that policy for responding to a security incident that may compromise biometric data. Approved 2024-05-31; effective 2025-07-01. The page does not say whether the Act's usual applicability thresholds apply to these duties; that is for counsel.

What the software offers here: the retention settings and the retention pass ([retention](retention.md)), consent keys, and the records a breach protocol starts from ([breach response](breach-response.md)).

## California: the CCPA as amended, and the CPPA's regulations

- **The statute:** Civil Code sections 1798.140 (biometric information processed to identify a consumer is sensitive personal information) and 1798.121 (the right to limit the use and disclosure of sensitive personal information). **Not re-read on 2026-11-20: the California Legislature's site answered HTTP 403 ([S9](sources.md)).**
- **The regulations** (re-read on 2026-11-20, the CPPA's announcement of 2025-09-23, [S10](sources.md)): the rules on cybersecurity audits, risk assessments and automated decision-making technology (ADMT) took effect on 2026-01-01, with later dates for some duties:
  - risk assessments from 2026-01-01, with an attestation and a summary due by 2028-04-01;
  - ADMT duties for significant decisions from 2027-01-01;
  - cybersecurity audit certifications due 2028-04-01, 2029-04-01 or 2030-04-01, by annual revenue (over $100 million; $50 million to $100 million; under $50 million).

What the software offers: the decision record and the contest route of Phase 8 ([automated decisions](automated-decisions.md)), retention and redaction, masking without `pii:view`, and the audit log. Whether OpenVerify's decisions are ADMT "significant decisions" for you, and what your risk assessment says, is yours.
