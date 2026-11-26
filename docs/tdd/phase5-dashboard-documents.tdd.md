# TDD evidence: Phase 5, Workflow 5C Stage 1, `dashboard-documents`

Slice owner: `dashboard-documents` (Workflow 5C Stage 1, in parallel with `dashboard-people` and `dashboard-records`). Date: 2026-10-24.

## Plan task

C66 of `docs/plans/phase-5.plan.md` for the document and government ID chip types, and the read-only "Chip trust store" page (C62.10, V19):

- **Document:** the page-1 preview through the authenticated file route; the class and its confidence (uncalibrated, `beta`); the extracted fields, masked without `pii:view`; the fabrication components with their weights in words; the original PDF as an attachment download only; "What a pass means".
- **Chip:** integrity, revocation, the anchor's source, the signer certificate's validity, the data-group table (`identical`, `not_identical`, `missing_from_upload`, `not_listed` in words), Active Authentication, the chip portrait beside the selfie (alt text names the image, never the person), earlier sightings as a count, the device report as client-reported and never evidence; "What a pass means".
- **Chip trust store** from `GET /api/v1/dashboard/trust-anchors`: sources, enabled, last sync, the list's signing time and SHA-256, anchors per country, withdrawn anchors, CRL freshness, the sandbox anchor labelled sandbox-only, and only what the route returns.
- **Words** for every C51.2 reason of both types, each module's test iterating the contracts' reason list first.
- **One full-stack spec**, `e2e/tests/ui-documents.spec.ts`, with its own data.

## Owned paths

- `apps/dashboard/src/lib/reason-words/{document,government-id-nfc}.ts` and their tests;
- `apps/dashboard/src/lib/{document,government-id-nfc}-{words,evidence}.ts` and their tests;
- `apps/dashboard/src/components/evidence/{document,government-id-nfc}.tsx` (replacing the 5A placeholders) and their tests;
- `apps/dashboard/src/testing/fixtures/{document,government-id-nfc}.ts`, `apps/dashboard/src/testing/routes/documents.ts`;
- the trust store page: `apps/dashboard/src/app/trust-anchors/` (page, layout, loading, error, the API call, the page test) and `apps/dashboard/src/components/trust-store/` (view, words, their tests);
- `e2e/tests/support/documents.ts`, `e2e/tests/ui-documents.spec.ts`;
- this file.

No dependency was added. No shared dashboard file, mock route or e2e helper was edited.

## Environment

Every shell ran `source scripts/env.sh` first. Unit runs while iterating:

```bash
pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false
```

Two other agents committed RED tests to the same package during this stage. Runs of whole folders therefore showed their failures (`phone-number`, `email-address`, `database`, `business-website`); each evidence line below names my own files only.

## Decisions

- **One group per evidence.** The shared page test finds a Phase 5 verification's evidence as the single `role="group"` of the Evidence region. Each evidence is therefore one labelled group (`<type> evidence`), with parts titled by plain text, `<dl>` terms and captioned tables (no `<details>`, `<fieldset>` or nested group). Headings were not used inside the evidence: it sits under an `h4` on the card and an `h2` on the page, so no level fits both.
- **Values as the API sent them.** Dates are strings and never parsed, so a masked or redacted answer cannot be told apart by formatting. The shared page test also requires every PII value of the golden fixture in the Evidence region for a reviewer and none for a viewer, in the page and the RSC payload.
- **Honest outcomes.** One `Outcome` part shows a result's status badge, "Beta" when its stage is `beta`, "Required" or "Advisory: it does not decide the verification", and its reasons in the type's words. A missing result reads "Not run" and a missing value "Not recorded". `not_applicable` is never shown as a pass.
- **Signer validity.** Passive authentication's metadata carries no certificate dates. Established integrity requires both the CSCA and the document signer to be valid at verification time (`checkProfiles` in `@openverify/emrtd`), so established reads "Valid at verification time". `certificate_expired`, `certificate_profile_invalid` and `dsc_missing` are named. Anything else reads "Not judged: integrity was not established", never valid.
- **Passive authentication with a redacted result.** The states come from the result's metadata, else from the `passive-authentication` attribute, which survives a redaction (C52.8).
- **Sources read at test time.** The words tests read the cues, layout features, unknown reasons, date sources and flags (`packages/checks/src/document`), the chip states, outcomes, schemes, protocols, flags and compared fields (`packages/emrtd`, `packages/checks/src/nfc`), the sync reasons (`apps/api/src/trust-anchors/sync.ts`, `packages/db/src/repositories/trust-anchors.ts`, `MASTER_LIST_FAILURES`) and the trust sources (`trust-anchors/manifest.json`). A value added there without words fails the test. No long list was written by hand: languages and countries come from `Intl.DisplayNames`.
- **Files.** The evidence shows the preview, the original's download link and the chip portrait only when the card or page passes `files` and `media`. `dashboard-people` added them to `EvidenceProps` during this stage (`6e5554f7`, `110c4f09`). The chip evidence also takes `inquiryFiles` (the selfie centre photo). Until the card and page pass it, the chip evidence points to the selfie verification its comparison names, rather than claiming no selfie was compared (§9).
- **The PDF download.** The link is `<a href="/files/<id>/content" download>`. The dashboard's file route (`app/files/[id]/content/route.ts`, a shared file) still passes images only, so the download answers 502 until it passes `application/pdf` with the API's `Content-Disposition: attachment` (see the report's follow-ups).
- **Trust store page.** It lives at `/trust-anchors` behind `settings:read`, as its API route does; `dashboard-people` added the navigation entry under Organization (`ebc84c62`). It is read-only: no control changes the store. It says plainly that the API does not report `OPENVERIFY_TRUST_ANCHOR_REFRESH` or `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`.

## 1. The document reasons in words (C51.2)

**RED** `c5f57c1a`: `lib/reason-words/document.test.ts` iterates `DOCUMENT_CHECK_IDS` and `DOCUMENT_CHECK_REASONS` first, then requires words of the module's own for every code of the C51.2 rows (`DOCUMENT_CHECK_OUTCOMES`), and checks the explanations that carry honesty (an unrecognised class goes to review; each fabrication reason is a trace).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words/document.test.ts --coverage.enabled=false
 ❯ src/lib/reason-words/document.test.ts (72 tests | 57 failed)
     × document_type_detection says document_type_not_accepted in words
     × words document_type_not_accepted for a document itself
     …
```

**GREEN** `c6d9c74c`: the 31 codes in words, with explanations (a password-protected PDF, the cascade's `input_missing`, `feature_absent` for a lease without an end, each fabrication cue's strength).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words/document.test.ts src/lib/reason-words/index.test.ts src/lib/reason-words/lookup.test.tsx --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  86 passed (86)
```

## 2. The chip reasons in words (C51.2, C62.3)

**RED** `4bced908`: `lib/reason-words/government-id-nfc.test.ts` iterates `NFC_CHECK_IDS` and `NFC_CHECK_REASONS` first; it also requires tampering (`dg_hash_mismatch`, `sod_signature_invalid`) to read as tampering and the trust-store gaps as review, `chip_auth_not_server_verifiable` never as a pass, and the MRZ mismatches against the photographed ID (the shared words say "from the MRZ", which is wrong for a chip).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words/government-id-nfc.test.ts --coverage.enabled=false
      Tests  59 failed | 21 passed (80)
```

**GREEN** `5d19f1e2`:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/reason-words/government-id-nfc.test.ts src/lib/reason-words/index.test.ts src/lib/reason-words/lookup.test.tsx --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  94 passed (94)
```

## 3. The document vocabulary (`lib/document-words.ts`)

**Stub** `be4cc80c`: the names, with empty tables. **RED** `bfffbbdb`: the classes (`DOCUMENT_CLASSIFICATIONS`), the fields in API order (`documentFieldsSchema`), the 14 fabrication cues (equal to `FABRICATION_SIGNAL_IDS` in the evaluator), their strengths, the layout features, the unknown reasons, the issue-date sources, the nine recency and expiry flags, the reference sources (all read from the evaluators' source), the match levels (`MATCH_LEVELS`), language names and the pass line.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/document-words.test.ts --coverage.enabled=false
     × names the class utility_bill
     × says the cue hidden-text-over-field in words, with what it looks for
     × says the date flag no-issue-date in words
     …
      Tests  60 failed | 2 passed (62)
```

**GREEN** `f5c2b5ad`:

```
      Tests  62 passed (62)
```

## 4. Reading the document evidence (`lib/document-evidence.ts`)

**Stubs** `9b515c3f` (the data shape), `c867f57f` (the file finders take a verification id). **RED** `1af82661` with `testing/fixtures/document.ts` (the golden bill, its checks changed one at a time, its files): the stored class, the uncalibrated confidence, the probabilities highest first, the minimum confidence from provenance, the fields in API order (all null when masked), the fabrication score, limit, weak-cue cap and components (a component or strength of the wrong shape left out), the dates, the properties, the comparisons, the preview and the original.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/document-evidence.test.ts --coverage.enabled=false
AssertionError: expected undefined to be 'document_type_detection'
AssertionError: expected [] to deeply equal [ 'utility_bill', 'other', …(4) ]
…
      Tests  13 failed | 1 passed (14)
```

**GREEN** `6f649602`:

```
      Tests  14 passed (14)
```

## 5. The document evidence component (`components/evidence/document.tsx`)

**Stub** `4dbe0778`: the component takes the document's props and still renders the generic view. **RED** `7f6d4456` with `testing/routes/documents.ts`: one group with what a pass means; the class, type check, confidence (Beta, uncalibrated), probabilities table; an unrecognised class never as a pass; the fields, hidden and redacted; the dates; the comparisons; fabrication as advisory and beta, with its cue table; a check not run; the preview through the file route and the PDF as a download only; a photo original; hidden and redacted files; no preview; no files given; and the verification page with a masked answer leaking nothing to the page or the RSC payload.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/document.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an element with the text: Class, which matches selector 'dt'.
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Document class probabilities"
TestingLibraryElementError: Unable to find an accessible element with the role "img" and name "Document preview, page 1"
…
      Tests  18 failed | 2 passed (20)
```

**GREEN** `642d7392`. One RED assertion was corrected in the GREEN commit, as its message says: an empty field reads as the console's em dash with "None" for screen readers, so `/^None$/` became "contains None".

```
      Tests  20 passed (20)
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/index.test.tsx src/components/evidence/generic.test.tsx src/components/verification-card.test.tsx src/components/lifecycle/inquiry-timeline.test.tsx --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  72 passed (72)
$ (cd apps/dashboard && npx vitest run src/app/verifications src/app/inquiries --coverage.enabled=false)
 Test Files  7 passed (7)
      Tests  154 passed (154)
```

## 6. The chip vocabulary (`lib/government-id-nfc-words.ts`)

**Stub** `08e18918`. **RED** `5d67c062`: integrity and revocation (equal to `INTEGRITY_STATES` and `REVOCATION_STATES` in `@openverify/emrtd`), the revocation gaps, the data-group states, the Active Authentication outcomes and schemes, the device-reported protocols (`DEVICE_REPORTED_PROTOCOLS`), how the anchor was chosen, every flag passive authentication adds (`flags.add(…)` in `passive-authentication.ts`, and the checks' `revocation-undetermined`), the MRZ fields compared, the data-group names, the pass line, the device-report note and the sandbox anchor note.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/government-id-nfc-words.test.ts --coverage.enabled=false
     × says the integrity established in words, with what it means
     × says the data-group state missing_from_upload
     × says the flag link-anchor in words
     …
      Tests  54 failed | 2 passed (56)
```

**GREEN** `a0b50ab0`:

```
      Tests  56 passed (56)
```

## 7. Reading the chip evidence (`lib/government-id-nfc-evidence.ts`)

**Stub** `c996a5d5`. **RED** `e169d5b8` with `testing/fixtures/government-id-nfc.ts` (the golden Utopia chip read, its checks changed one at a time, its files, the selfie centre photos): passive authentication with every state and the anchor, the data groups by number (entries of the wrong shape left out), the signer validity for each integrity reason (never valid when broken), the attribute as the fallback once the metadata is gone, nothing claimed without a result, Active Authentication with the device report apart, the comparisons, sightings and expiry, the fields in API order (null when masked), the portrait and the selfie centre photo.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/government-id-nfc-evidence.test.ts --coverage.enabled=false
     × reads passive authentication: integrity, revocation, algorithms and the anchor
     × says how the signer certificate stood when integrity is not established for certificate_expired
     …
      Tests  13 failed | 2 passed (15)
```

**GREEN** `0c81d48b`:

```
      Tests  15 passed (15)
```

## 8. The chip evidence component (`components/evidence/government-id-nfc.tsx`)

**Stub** `061f8c6a`. **RED** `8becbb43`: one group with what a pass means; DG1's fields, hidden and redacted; integrity apart from revocation; the anchor source labelled sandbox-only; the anchor choice and the signer certificate; the data-group table; a trust-store gap never as a pass; Active Authentication and its scheme; a chip without an AA key never as a pass; the device report as client-reported; the MRZ comparison; the selfie comparison as beta with its threshold; sightings as a count; expiry; the portrait beside the selfie centre photo, hidden without `pii:view`; and the page with a masked answer.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/government-id-nfc.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Government ID chip data groups"
TestingLibraryElementError: Unable to find an element with the text: Device report, which matches selector 'dt'.
…
      Tests  18 failed | 1 passed (19)
```

**GREEN** `4fd1cdd5`:

```
      Tests  19 passed (19)
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence src/components/verification-card.test.tsx src/components/lifecycle/inquiry-timeline.test.tsx --coverage.enabled=false
 Test Files  13 passed (13)
```

## 9. The selfie photo when the inquiry's files are not given

Once `dashboard-people` passed the verification's own files to the evidence (`110c4f09`), the chip evidence would have read "No selfie photo in the inquiry was compared" on every card and page, since neither passes the inquiry's files: a false statement.

**RED** `6a820f27`:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/government-id-nfc.test.tsx --coverage.enabled=false
     × never says no selfie was compared when it was given only the verification’s own files
Error: expect(element).not.toHaveTextContent()
      Tests  1 failed | 19 passed (20)
```

**GREEN** `f3aa70d7`: without `inquiryFiles` the evidence says "Shown with the selfie verification" and names the verification the comparison recorded.

```
      Tests  20 passed (20)
```

**Refactor** `2f40c1ca`: the document and chip props build on the `files` and `media` members the shared `EvidenceProps` now carries; the chip adds only `inquiryFiles`. The evidence, card and lib suites stayed green (7 files, 124 tests).

## 10. The trust store words (`components/trust-store/trust-store-words.ts`)

**Stub** `05de21ee`: the page at `/trust-anchors`, its layout, loading and error states, its API call, the view and the words, as names. **RED** `948d1641`: the sync outcomes (`TRUST_ANCHOR_SYNC_OUTCOMES`), CRL freshness (`TRUST_CRL_FRESHNESS`), every reason the sync, the trust-store repository and the master-list check record (read from their source), each source of `trust-anchors/manifest.json` plus the seed's and the import's, country names (Utopia as the test issuer), and the note on the two settings the API does not report.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/trust-store/trust-store-words.test.ts --coverage.enabled=false
     × says the sync reason list_signing_time_rollback in words
     × names the source bsi-de
     …
      Tests  32 failed | 1 passed (33)
```

**GREEN** `59eb7cf8`:

```
      Tests  33 passed (33)
```

## 11. The trust store page and view

**RED** `0a46c5f4` (`components/trust-store/trust-store-view.test.tsx`, `app/trust-anchors/page.test.tsx`, the trust store fixtures from the golden `dashboard-trust-anchors.json`): the summary (the production anchor, when the answer was made, the settings note), the sources table with each sync in words and a refusal's reason, anchors per country by name, withdrawn anchors (and "Its sources were disabled"), CRL freshness as text, the sandbox anchors labelled sandbox-only, an empty store; the page with `settings:read`, read-only, its six section headings; the forbidden panel without the permission (no request) and on a 403; the title, the layout, the loading and error states.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/trust-anchors src/components/trust-store --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Chip trust store"
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Trust anchor sources"
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Summary"
…
      Tests  12 failed | 36 passed (48)
```

**GREEN** `14f84b5d`. The RED test's two withdrawn anchors shared one subject, so its row lookup found two; the GREEN commit gives the second its own subject, as its message says.

```
 Test Files  3 passed (3)
      Tests  48 passed (48)
```

## 12. The full-stack spec (`e2e/tests/ui-documents.spec.ts`, `682fd715`)

Written after the units' GREEN, as an acceptance test: it pins built behaviour against the real stack and was never run RED against the placeholders. Three tests, each making its own data through the flow API and the sandbox providers, changing no setting:
- the covered-amount bill (`poa/en/utility-bill/edited-covered-amount.pdf`, prefilled with the holder's sidecar fields): a reviewer reads the evidence on the inquiry page, the preview decodes through the file route, the download link is a same-origin `download` link and no `embed`, `object` or `iframe` exists; a viewer sees the fields and the preview "Hidden";
- a Utopia chip with the TD3 page and person A's selfie: the chip evidence on the verification page, the chip portrait decoded, one image in the files list (the raw chip files are listed by kind);
- the trust store: a viewer opens it from the navigation, its production-anchor answer agrees with the API's, the seeded `openverify-sandbox` source and its Utopia anchor show; a reviewer has no link and gets the forbidden panel.

The first run failed all three: at least the trust store test because the helper `tableRow` built its `has` locator from the table, which never matches inside a row (the run's artifacts were removed by the next agent's stack before they could be read). The helper now builds it from the page.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-documents.spec.ts'
  3 failed
$ (same, after the helper fix, --reporter=line)
[e2e +39.2s] stack ready; logs in e2e/.artifacts/logs
[1/3] … a reviewer reads a proof-of-address document’s evidence, and a viewer sees its fields hidden (C60, C66)
[2/3] … a reviewer reads a chip verification’s evidence: integrity, revocation, the sandbox anchor, the data groups, Active Authentication and the portrait (C62, C66)
[3/3] … the chip trust store shows the sandbox source and anchor as the API reports them, to a role with settings:read only (C62.10, C66)
[e2e +55.8s] stopping the services
  3 passed (57.7s)
```

The three tests together took about 17 s after the stack was ready, each far within the 90 s budget.

## 13. Pins written after the code (`41821069`)

Two honest-display paths the coverage report showed untested: a document whose recency had no usable issue date (`not_applicable`, `input_missing`, the flag `no-issue-date`) reads "Not applicable" with "Not enough read to judge" and the date note, never "Passed"; and a chip read before its checks ran reads "Not run" and "Not recorded" for every state, with an empty data-group table. Both passed when written.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/document.test.tsx src/components/evidence/government-id-nfc.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  42 passed (42)
```

## 14. The pass lines say what the docs say

The other two console agents check their pass lines against `docs/checks/<page>.md` sentence by sentence (the shared `testing/check-docs.ts`). The document and chip lines were my own summaries, so they now follow the same rule.

**RED** `952b9293`: each sentence of `DOCUMENT_PASS_MEANS` and `NFC_PASS_MEANS` must appear in the "What a pass means" section of `document.md` and `nfc.md`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/document-words.test.ts src/lib/government-id-nfc-words.test.ts --coverage.enabled=false
AssertionError: A pass means a recent document of an accepted type, addressed to the applicant: …: expected 'a passed document verification means:…' to contain 'a pass means a recent document of an …'
AssertionError: A pass means data signed by a document’s issuer, …: expected 'a passed nfc verification means: data…' to contain 'a pass means data signed by a documen…'
      Tests  2 failed | 116 passed (118)
```

**GREEN** `6ba2f1d4`: the document line is the docs' first sentence and its two "It does not mean" sentences; the chip line is its first sentence and the one on Active Authentication. The component tests still pass.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/document-words.test.ts src/lib/government-id-nfc-words.test.ts src/components/evidence/document.test.tsx src/components/evidence/government-id-nfc.test.tsx --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  160 passed (160)
```

## 15. One sign-in per role in the spec (`85548407`)

The first full `pnpm e2e` (§16) passed this spec's three tests, but nine later tests of other specs failed with `Sign-in answered 429: … Too many sign-in attempts`. The API's login limits (C4: 10 per email and 50 per address in 15 minutes, `DEFAULT_LOGIN_RATE_LIMITS`) count every attempt, the suite runs in about 12 minutes from one address, and the three new console specs added sign-ins. This spec signed in six times (the reviewer three times, the viewer three times, one of them through the API). It now signs each role in once in a `beforeAll` (`signedInStates`), keeps the session (`storageState`), opens each page from it, and uses the viewer's session token for the API read: two attempts.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-documents.spec.ts --reporter=line'
  3 passed (56.0s)
```

## 16. Final gates (foreground, on the final code)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/dashboard test` (80% gate) | 225 files, 3,025 tests passed; statements 98.64%, branches 93.98%, functions 99.14%, lines 98.63% |
| `pnpm --filter @openverify/dashboard typecheck`, `lint` | pass |
| `pnpm typecheck && pnpm lint && pnpm format:check` | pass (13 of 13 typecheck and lint tasks; Prettier clean) |
| `flock /tmp/openverify-e2e.lock pnpm e2e`, first run (before §15) | mocked flow suite 68 passed; full stack 73 passed, 9 failed, all `Sign-in answered 429` or a sign-in left on `/login`, from test 65 on; this spec's three passed (4.7 s, 7.1 s, 1.5 s) |
| `flock /tmp/openverify-e2e.lock pnpm e2e`, after §15 | mocked flow suite 68 passed; full stack 74 passed, 8 failed (12.8 min), the same cause; this spec's three passed |

**The full-stack suite fails on the sign-in limit, not on this slice.** The second run's API log holds 58 `POST /api/v1/dashboard/sessions`, all from 127.0.0.1, against the per-address limit of 50 in 15 minutes, which leaves eight attempts refused, as many as the failed tests (`ui-records` ×5, `ui-selfie` ×2, `verification-completes` ×1, which run after the new console specs in file order). `ui-documents` now makes 2 of the 58. The fix belongs to the shared e2e helpers or the API configuration (the report's blockers and follow-ups).

The coverage reports of the first two whole-suite runs went to a private directory (`--coverage.reportsDirectory`), because another agent's run held `apps/dashboard/coverage` at the time; the gate's thresholds are the same. The last run used the package's own `test` script.

## Existing tests changed

None. Two of this slice's own RED assertions were corrected in their GREEN commits, each said in the commit message: an empty field's text (§5) and the second withdrawn anchor's subject (§11).

## 17. Orchestrator completion: the original PDF download (after Workflow 5C)

This slice ended `partial`: its own gate found that "Download the original PDF" answered 502, because the file route passed on images only. The route is outside the slice's paths and no fixer was assigned it, so the orchestrator finished it, test-first (`4677517a` RED, `d3dcd7b2` GREEN, `7f786207` spec).

**What changed.** `app/files/[id]/content/route.ts` passes a 200 `application/pdf` on only when the API's `content-disposition` starts with `attachment`, unchanged, with `nosniff` and `private, no-store`. A PDF without a disposition, or shown `inline`, stays 502 with no body and no disposition.

**RED**, `pnpm --filter @openverify/dashboard exec vitest run "src/app/files/[id]/content/route.test.ts" --coverage.enabled=false`:

```
     × passes a PDF on as a download, keeping the API's attachment disposition unchanged 13ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/app/files/[id]/content/route.test.ts > GET /files/:id/content > passes a PDF on as a download, keeping the API's attachment disposition unchanged
AssertionError: expected 502 to be 200 // Object.is equality
- Expected
+ Received
```

The two refusal cases passed already: they pin the existing guard.

**GREEN**, same command:

```
      Tests  18 passed (18)
```

Typecheck and lint passed for the dashboard and e2e packages.

**End to end.** `ui-documents.spec.ts` now clicks the link, then checks the download: a server-named `.pdf` whose first bytes are `%PDF-`. The assertion was written after the fix. Against the old route (a scratch revert, since restored) it fails:

```
  ✘  1 [chromium] › tests/ui-documents.spec.ts:60:1 › a reviewer reads a proof-of-address document’s evidence, and a viewer sees its fields hidden (C60, C66) (3.7s)
    Error: expect(received).toMatch(expected)
      101 |     const [saved] = await Promise.all([page.waitForEvent('download'), download.click()]);
```

With the fix, `flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-documents.spec.ts'`:

```
  3 passed (55.9s)
```
