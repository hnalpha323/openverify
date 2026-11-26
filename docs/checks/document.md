# Document and proof-of-address checks

This page describes the `document` verification type as Phase 5 ships it: the upload, how vision measures a PDF or a photo in a sandboxed child, the classifier and the extraction, the seven document checks, the held-out evaluation, and what a pass means. The binding contracts are C52, C53.3, C60 and C65.2 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

**Everything here is our own reading of the document.** No third-party document service is called. The classifier and the extraction are rules over lexicons and layout (R tier, model-based through the OCR); the fabrication score is a heuristic (H tier, `beta`, with a confidence). None of the constants was fitted to the generated fixtures (C60.5, H23).

## Contents

- [What a pass means](#what-a-pass-means)
- [The step and the upload](#the-step-and-the-upload)
- [How vision reads a document](#how-vision-reads-a-document)
- [The three isolation layers](#the-three-isolation-layers)
- [Classification](#classification)
- [The held-out evaluation](#the-held-out-evaluation)
- [Extraction](#extraction)
- [The checks](#the-checks)
- [Fabrication](#fabrication)
- [What the verification stores and serves](#what-the-verification-stores-and-serves)
- [Configuration](#configuration)
- [Privacy and retention](#privacy-and-retention)
- [The fixtures](#the-fixtures)
- [Known limits](#known-limits)

## What a pass means

A passed document verification means: **a recent document of an accepted type, addressed to the applicant.** In detail, under the default template:

- the document reads as one of the step's accepted classes (utility bill, bank statement, lease, pay stub, tax document) in a covered language;
- its name, address and issue date were found in visible text;
- it has not expired (a lease's end), and it is recent: issued within 90 days, a lease in force today, or a tax document within 18 months;
- the name printed on it matches the reference (the inquiry's fields, else the latest passed or reviewed government ID, else the account), at least partially.

It does **not** mean the document is genuine. The fabrication score (advisory by default) looks for edit traces; a clean score is no proof of authenticity, and a skilled forgery leaves none of the traces it reads. It does not mean the applicant lives at the address today, nor that the issuer exists: no issuer is contacted. The address comparison is advisory by default, so a bill at a previous address can pass.

## The step and the upload

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `document` | `document` | 3 | `documentTypes` (one or more of the five classes), `captureMethods` (`upload`, `camera`), `maxAttempts` |

A client creates the verification, uploads one file of kind `document` to `POST /api/v1/flow/verifications/:id/files`, and submits (C52). The flow view's guidance (C52.2) carries what the client shows before the upload:

- `accepted-types`: the step's classes;
- `max-age-days`: the template's recency window (90 by default);
- `max-pages`: 50;
- `accepted-mime-types`: JPEG, PNG, WebP and PDF for an upload step; the image types only for a camera-only step, since a camera makes no PDF.

The server types the file by its bytes, not by its name or declared type: a JPEG, PNG or WebP magic number at the start is a photo; otherwise `%PDF-` within the first 1,024 bytes is a PDF; anything else is refused with 415. Files are capped at 10 MiB (413). Submitting before the file was uploaded answers 422.

**Clients** (C64). Both clients make the attempt's verification when the screen opens, because only a verification carries guidance; `verification.created` therefore fires when the screen opens. Both upload the file exactly as picked, so vision measures the original bytes (its EXIF, its JPEG history). On Android, a photo taken with the SDK's own camera screen is a JPEG the SDK encoded, without EXIF. The web flow's camera input (`capture="environment"`) takes images only, beside the file input that also takes PDFs. Neither client renders a PDF: a picked file is shown by its name and size.

## How vision reads a document

The worker sends the file to vision's `POST /v1/analyze/document`, then asks `POST /v1/render/document-page` for page 1 as a PNG of at most 1,600 pixels (the preview). Vision measures; it decides nothing (C60.1):

- **Text layer** (born-digital PDFs): every line with its box, fonts and size, and whether it is **visible**. A line is hidden when it is drawn in render mode 3 or 7, lies off the page, is clipped away, is under 2 pt high, is covered by a later opaque fill or image, or is painted in the background's colour. Hidden lines carry their reason and are never read as content.
- **OCR** (PP-OCRv6 small): on a page with visible text, each visible line's own box is read again by OCR, padded by 0.3 of its height, and `text_layer_ocr_agreement` says how far the two agree. A page without visible text (a scan) and a photo are read whole, by detection and recognition. Pages analysed: the first three and the last, of at most 50.
- **PDF structure** from a bounded raw-byte scan and pypdf: producer, creator, dates, XMP fields (from a bounded scan that refuses `<!DOCTYPE` and `<!ENTITY`; XMP never reaches an XML parser), revisions (the linearized first-page section excluded), a repaired cross-reference, EOF markers and trailing bytes, object streams, fonts, annotations, form fields, the action counts (JavaScript, Launch, SubmitForm, GoToR, RichMedia, embedded files; a GoTo open action counts nothing), signatures and edits after a signature (an increment adding only a DSS or a document timestamp is not an edit).
- **Photo forensics:** EXIF software and dates, JPEG quality, a double-compression score, a text-cell error-level score and a copy-move score.

Vision's refusals become the type check's user-behaviour failures, which the user can fix: an encrypted PDF (`document_password_protected`; OpenVerify asks for no password), more than 50 pages (`document_too_many_pages`), too large (`document_too_large`), and anything it cannot open (`document_unreadable`). A PDF that stops the guarded child on its own limits (CPU, memory, a crash, the output cap), that the raw scanner cannot read to its end, or whose pages are too complex to judge (more than 20,000 drawn objects, forms nested deeper than 8) is refused as `document_unreadable` too, because a retry would hit the same limit. An outage, a failed spawn, the 30 s kill timer or the 40 s OCR deadline (`503 guarded_worker_failed`) is retried while the job has attempts left, then answers `execution_error` and the verification goes to review. The worker waits 45 s for these routes (C60.2), longer than the child's 30 s kill timer, so it receives vision's own answer. The preview may be missing when vision could not render it on the job's last attempt; no preview is ever made up.

On the development machine (Xeon E5-1650 v3, 12 threads) the analysis of a 3-page born-digital bill takes a median of 1.6 to 2.2 s, against a 4 s budget: about 0.3 to 0.4 s in the guarded child and the rest in the OCR of the text-layer boxes. CI runs `tools/benchmark_document.py` in the vision job and logs the figure, never gating on a runner's speed.

## The three isolation layers

PDFium and OpenJPEG are large C and C++ parsers of untrusted input, so vision never runs them in its own process (C60.2, decision 48). Three layers contain a compromised parse. Each stops some things and not others:

| Layer | What it is | It stops | It does not stop |
|---|---|---|---|
| The child | Every PDF and every JPEG 2000 decode runs in a fresh `python -I -B -m openverify_vision.guarded.worker` with an empty environment, the bytes on stdin, and only the standard library, pypdfium2, pypdf and Pillow imported. Before it reads the document it sets `PR_SET_NO_NEW_PRIVS` and the limits: 1.5 GiB of address space, 20 s of CPU, no file growth, no core dump, no new process or thread, 64 open files. The parent kills it after 30 s, caps its output at 64 MiB and validates every answer and raster. | Memory and CPU exhaustion, decompression bombs, runaway pages, file writes, core dumps, new threads and processes (so no `exec`), privilege gain through setuid, the service token reaching the child, the child reading the parent's environment, open files or memory (vision makes itself non-dumpable), a hostile child flooding the parent | Code running inside the child opening a socket on vision's network, or reading what the vision user can read (the read-only models) |
| The container | Vision runs as uid 10001 on a read-only root filesystem (a tmpfs `/tmp` holds the multipart spool), with every capability dropped, `no-new-privileges` and Docker's default seccomp profile, under a 4 GiB memory limit | Privilege escalation, persistence, capability use, the host's memory being exhausted | Use of the vision process's own network |
| The network | Vision sits alone on the compose network `vision`, which is `internal` and shared only with the API and the worker; it reaches no data store, no other service and no internet (its models are mounted read-only) | A compromised vision reaching Postgres, Valkey, the object store, Mailpit, the other services or the internet | Reaching the API's HTTP port on that network (every sensitive route needs a credential the child does not hold), or a compromised vision returning false measurements (the worker checks their shape, not their truth) |

`infra/tests/vision-container.test.sh` checks the container and network layers in two halves:

- **Static, in CI** (the `infra` job, on every push and pull request). It reads the compose configuration and the Dockerfile. It checks that vision sits alone on the internal network and runs as 10001 on a read-only root, with every capability dropped, no new privileges and Docker's default seccomp profile. It also checks for no published port, a memory limit and no `jbig2dec`.
- **Live, on a developer machine only.** It builds the image and needs the model weights, so it is run by hand before a release:
  - From inside the vision container, `postgres` does not resolve and Postgres' address cannot be reached, while the running vision can (the control).
  - The process runs as 10001 with no effective capability, no new privileges and a seccomp filter. `/` is read-only and `/tmp` writable. The image carries pypdfium2 5.14.0 and pypdf 6.21.2 and no `jbig2dec`.
  - The guarded child is started inside the image as vision starts it. It reads back its limits, no new privileges and an empty environment. It can neither fork, start a thread nor read its non-dumpable parent's `/proc` entries.
  - A real PDF is analysed through the running vision: its page, its visible text and the OCR of it.

The vision suite checks the child itself: its limits read back, its imports, every overrun ending in a worker failure, and the hostile set.

**Operators:**

- Vision makes itself non-dumpable (`PR_SET_DUMPABLE` 0) when it starts, so a same-user child cannot read its `/proc` entries (the service token, the spooled uploads) or its memory, whatever Yama's `ptrace_scope` is. Keeping `ptrace_scope` at the distribution default of 1 or higher is still good practice.
- No seccomp filter of our own ships: a hand-written denylist is bypassable and a correct allowlist for a process running PDFium is fragile (decision 48). Docker's default profile stays on.
- The PDFium build pypdfium2 5.14.0 bundles (8076) carries the fix for CVE-2026-113022 but not those for CVE-2026-110155 (AGG) and CVE-2026-118345 (OpenJPEG); the child is the mitigation, and the first pypdfium2 bundling PDFium 8125 or later is adopted once it is 14 days old (`THIRD_PARTY_LICENSES.md`, decision 30).
- Vision needs `OPENVERIFY_VISION_SERVICE_TOKEN` of at least 32 characters; the API and the worker send it.

## Classification

The classifier (`packages/checks/src/document/`, C60.5) reads the visible text-layer lines of a born-digital page and the OCR lines of everything else, never a hidden line:

- **Lexicons.** OpenVerify's own phrase lists for English, Spanish, French and German (`lexicons/{en,es,fr,de}.ts`): for each class its anchor cues (weight 3), medium cues (2) and weak cues (1), each counted at most three times; language-neutral cues (kWh, m³, therms, IBAN, BIC) count for whichever language the document is in. A word of five letters or more reads as a lexicon word at a Jaro-Winkler similarity of 0.93 with the same first letter, so an OCR slip still counts.
- **Layout.** Seven features with their own weights (2 for a feature of one class, 1 for one that several share): a money column, a transaction table, a valid IBAN, earnings beside deductions, numbered boxes, a contract layout and meter readings.
- **The decision.** A softmax at temperature 1.0 over the five classes, with `other` at the constant score 2.0. The top class wins when its probability reaches `min-confidence` (0.5 by default) and leads the next by 0.15; otherwise the answer is `unknown`. With these integer weights a winning class always leads by enough, so the margin rule only binds when an operator lowers `min-confidence` below 0.5.
- **Language and script.** The covered language with the most distinct lexicon entries, at least two, decides; a tie goes to the first of en, es, fr, de, so a bilingual page stays covered. A document in another language or script is `unknown`.
- **Identity documents.** A page with an MRZ-like line, or with at least three identity labels of one covered language (surname, date of birth, nationality), is positively an identity document: it answers `other` and fails `document_type_not_accepted`, the one `other` that is the user's to fix.

Every class value is uncalibrated, so the type check's `confidence` is the top probability, recorded as such (`beta`).

## The held-out evaluation

`fixtures-5b` wrote a held-out set before the classifier's code was read, and it was never used to tune anything (C60.7, H23): 59 synthetic documents in layouts other than the main set's, among them the 2025 IRS W-2, 1099-NEC and 1040 (public-domain blank forms fetched by `scripts/fetch_fixtures.py` with pinned SHA-256 digests and filled with synthetic values), receipts, invitations, newsletters and menus, a TD3 passport page and a TD1 card front, and bills and statements in Italian and Portuguese, which the lexicons do not cover. Each sidecar names the truth (`label`), the answer C60.5 should give (`expected_answer`) and every answer that is not an error (`acceptable_answers`).

Integration measured it on 2026-10-24 with the real models: vision's analysis in process on each file (generator version `7+9067ea6fbfe9+2026-10-24`), then the classifier as the job runs it, every class accepted. Rows are the truth, columns the classifier's answer:

| Truth \ answer | utility_bill | bank_statement | lease | pay_stub | tax_document | other | unknown | Total |
|---|---|---|---|---|---|---|---|---|
| utility_bill | 8 | · | · | · | · | 2 | · | 10 |
| bank_statement | · | 6 | · | · | · | · | 4 | 10 |
| lease | · | · | 8 | · | · | · | · | 8 |
| pay_stub | · | · | · | 7 | · | · | 1 | 8 |
| tax_document | · | · | · | · | 11 | 2 | · | 13 |
| other | · | · | · | · | · | 10 | · | 10 |

- **48 of the 59 answers are acceptable.** No document was read as another covered class: every miss is `other` or `unknown`, which the type check answers with `document_type_unknown` and sends to review, never to a failure.
- **The misses:** layout C of the English and the Spanish utility bill (`other`), the Spanish bank statements in layouts B and C and the photo of B, and the Spanish pay stub in layout C (`unknown`, a probability of 0.39), and the English tax document of layout B and its photo (`other`).
- **Uncovered languages:** of the four Italian and Portuguese documents, one was `unknown` as C60.5 says; the Italian and Portuguese bills and the Portuguese statement were read as their true class (the Romance function words overlap with Spanish), where the rule says `unknown`. That answer names the right class, but it is not the documented behaviour.
- **By language** (acceptable of total): English 23 of 26, Spanish 14 of 19, French 5 of 5, German 5 of 5, Italian 1 of 2, Portuguese 0 of 2. **By form:** layout B 19 of 24 PDFs and 8 of 10 photos, layout C 6 of 10, the federal forms 5 of 5, the other documents 8 of 8, the identity pages 2 of 2.
- The identity pages answered `other` and failed `document_type_not_accepted`; the receipts, invitations, newsletters and menus answered `other`.

These are figures on synthetic documents of one generator, not a rate on real mail. They say the rules hold on layouts the classifier was not written against, and where they fail they fail towards review.

**Covered languages:** English, Spanish, French and German. A document in any other language is meant to answer `unknown` (review).

## Extraction

The fields come from visible lines only, after their labels: on the label's line, on the same row to its right, or on the line below within 1.5 line heights. A value read from a text-layer line is checked against the OCR of that line's box; when they disagree the OCR value is taken, and when OCR reads nothing there the field is left out (either way the fabrication score's text-layer cue is set).

- **Issue date,** by rank: (1) an issue-date label (statement, bill or invoice date, date of issue, date of agreement); (2) the end of a labelled period (billing period, period ending); (3) a bare "Date" opening a line; (4) for a lease, its start; (5) for a tax document, the end of its tax year (never stored as the issue date, since it is not printed). Two different dates under one rank are a conflict: no issue date, and recency answers `input_missing`.
- **Dates** are read in the document language's convention with the reference country:

  | Language | Reference country | Numeric date order |
  |---|---|---|
  | English | US, PH | month first |
  | English | CA, or none | both readings |
  | English | any other | day first |
  | Spanish | US | both readings |
  | Spanish | any other | day first |
  | French, German | any | day first |

  A two-digit year is 20yy. Only the reference country (the inquiry's, then the ID's, then the account's) sets the order, never a country guessed from a postal-code pattern. A date with two readings whose recency outcomes differ answers `input_missing`.
- **A lease's term:** a labelled start and end, a range ("1 March 2026 to 28 February 2027"), a start and a duration in months or years, or a clause that begins and ends on dates ("the lease begins on … and ends on …", "el contrato comienza el … y termina el …", "le bail commence le … et prend fin le …", "beginnt am … endet am …").
- **Name and address:** the addressee block, a name line above the street lines and the line holding the country's postal code, aligned at their left edge. A `Label: value` line (an employer number, a payer) ends the block, so a field above the name is never taken for its top line. Without a block topped by a name, a labelled holder (account holder, customer, tenant, employee) gives the name, and the nearest address block printed after that label is the holder's (a lease's premises after its tenant, never the landlord's address above). The town keeps its state across a comma ("MERIDALE, UT 00041"). The address lines go through the C58 address reader.
- **Issuer:** the tallest line in the top quarter of page 1 that is not a field, an amount or an address line, else a web or email domain printed on the document.

## The checks

| Check | Default | Fails with (user behaviour unless marked) | `not_applicable` with |
|---|---|---|---|
| `document_type_detection` | required | `document_type_not_accepted`, `document_unreadable`, `document_password_protected`, `document_too_large`, `document_too_many_pages` | `document_type_unknown` |
| `document_extracted_properties_detection` | required | `name_not_found`, `address_not_found`, `issue_date_not_found`, `issuer_not_found` | `input_missing` |
| `document_expired_detection` | required | `document_expired` | `feature_absent` (non-blocking), `input_missing` |
| `document_recency_detection` | required | `document_too_old` | `input_missing` |
| `document_fabrication_detection` | advisory | the cue reasons below (fraud) | `input_missing` |
| `document_name_comparison` | required | `document_name_mismatch` (category `fraud`) | `no_reference_data`, `input_missing` |
| `document_address_comparison` | advisory | `address_mismatch`, `postal_code_mismatch` (fraud) | `no_reference_data`, `input_missing` |

**One mistake fails one check** (C60.6, H22). `document_type_not_accepted` fails only when one of the five classes wins outside the step's `documentTypes`, or when `other` wins on a positively identified identity document; every other `other` or `unknown` goes to review. Until the type check has established an accepted class, the properties, expiry, recency and comparison checks answer `input_missing` instead of piling failures on a wrong upload. The fabrication check is not gated.

**Expiry and recency follow the class:**

| Class | Expiry | Recency |
|---|---|---|
| Utility bill, bank statement, pay stub | `feature_absent` (they print none) | issued within `max-age-days` (90) |
| Lease | the lease's end, before today minus `grace-days`, fails `document_expired`; a lease without an end (a periodic tenancy) is `feature_absent` | the printed term covers today; an ended term, a start more than a day ahead, only a start, or two different ends answer `input_missing` (an ended lease is failed by the expiry check alone) |
| Tax document | `feature_absent` | issued within 18 months (the latest tax year; ours, provisional) |

A date more than one day in the future is `input_missing`, never a pass.

**The comparisons** read the inquiry's fields, else the extraction of the inquiry's newest passed or reviewed government ID (a failed one never: its reading may be what failed), else the account's fields; with none, `no_reference_data`. A joint addressee ("A & B", "A and B") matches on either holder. The name comparison is required by default (decision 16), as a user-behaviour check with category `fraud`: a bill in a partner's or a former name can be replaced with another (V12). The address comparison answers `postal_code_mismatch` only when the postal code is the one contradiction, else `address_mismatch`; the matching library's levels are described in `docs/checks/database.md`.

## Fabrication

The score is `1 − Π(1 − wᵢ·sᵢ)` over the measured cues, with the weak cues' combined contribution capped at 0.45, so only a medium or a strong cue can reach the default `max-fabrication-score` of 0.5 (C60.6). A failure names the reasons of the cues that contributed at least 0.1, and its metadata lists every component (`id`, `strength`, `weight`, `signal`, `contribution`). The confidence is margin-based and capped at 0.6.

| Cue | Reason | Strength | Weight |
|---|---|---|---|
| incremental revisions | `pdf_incremental_update` | weak | 0.15 |
| a repaired cross-reference | `pdf_incremental_update` | weak | 0.1 |
| an editor as producer | `pdf_editor_producer` | weak | 0.2 |
| created before the printed issue date | `pdf_created_before_issue_date` | weak | 0.15 |
| Info and XMP disagree | `pdf_metadata_inconsistent` | weak | 0.1 |
| an image editor in EXIF | `image_editor_software` | weak | 0.2 |
| another font in an amount line | `pdf_font_inconsistent` | medium | 0.45 |
| mixed subsets of one base font | `pdf_font_inconsistent` | medium | 0.4 |
| text layer against OCR | `pdf_text_layer_mismatch` | medium | 0.45 |
| double JPEG compression with error levels | `image_tampered` | medium | 0.45 |
| hidden or covered text over a field | `pdf_hidden_text` | strong | 0.7 |
| edits after a signature | `pdf_signature_invalidated` | strong | 0.7 |
| active content | `pdf_active_content` | strong | 0.6 |
| copy-move | `image_tampered` | strong | 0.6 |

Corrections that keep genuine documents under the threshold: DocumentID differing from InstanceID and a modification date after the printed date are no cues; an embedded file alone is no active content (e-invoices embed their XML); hidden text counts only on a born-digital page, over a line holding a digit, when it is covered or painted in the background's colour; a single medium cue cannot fail the default threshold alone; an edit that leaves only weak traces (an increment and an editor producer, about 0.32) passes by design. The check passes only when a medium or strong cue was measured: a photo without its double-compression, error-level or copy-move scores answers `input_missing`.

**A clean score proves nothing.** The cues are traces of common edits; a document generated from scratch carries none. Keep the check advisory unless your own data supports more.

## What the verification stores and serves

- **`document_extractions`** (one row per verification): the class, its confidence, the page count, the media type and the extracted fields, sealed to the row. A refused or failed analysis writes no row.
- **The preview:** page 1 as a PNG of at most 1,600 pixels (a photo's preview has no EXIF), stored as the server-written kind `document-preview`, replaced on every re-run of the job. The decision's `verification.*` event lists it among the verification's files.
- **Attributes** (C52.8, server and console APIs, never the flow API): `document-type`, `document-type-confidence`, `page-count`, `mime-type`, and `fields` (`name`, the `address-*` parts, `issue-date`, `issuer`, `expiration-date`). Before the job runs only `mime-type` is set. `fields` is personal data: masked member-wise without `pii:view`, `null` after redaction; the other members stay.
- **The console's file route** (`GET /api/v1/dashboard/files/:id/content`, `inquiries:read` and `pii:view`): a PDF is served as an attachment named `document-<file id>.pdf` (`Content-Disposition: attachment`, `nosniff`, `no-store`), so a browser downloads it and never renders it; photos and the preview are served inline. Each file's bytes must be what its kind holds and its record names, else an opaque 500. Every view is audited as `file.viewed`.

No extracted value reaches a log, an event other than the verification's own, or a check's metadata: results carry classes, levels, flags, counts and field names (C51.4).

## Configuration

| Check | Key | Default | Basis |
|---|---|---|---|
| type | `min-confidence` (0–1) | 0.5 | ours: the classifier is uncalibrated |
| properties | `required-properties` (⊆ `name`, `address`, `issue-date`, `issuer`) | `name`, `address`, `issue-date` | the public proof-of-address default |
| expired | `grace-days` (0–365) | 0 | ours, as `id_expired_detection` |
| recency | `max-age-days` (1–3,650) | 90 | the public default; 365 is advised for business papers |
| fabrication | `max-fabrication-score` (0–1) | 0.5 | ours |
| name, address | `min-match-level` (`partial`, `full`) | `partial` | ours |

Every default is provisional and recorded as `threshold-basis` on the result. The window does not apply to leases and tax documents, which follow the table above.

## Privacy and retention

The uploaded file and the preview are encrypted at rest with a key per file; the extracted fields are sealed to their row. Redaction deletes the document and preview objects and nulls the fields. Rows follow the inquiry's retention, and the default keeps inquiries forever: set `inquiry-retention-days` for the environment (C53.6).

## The fixtures

Every test document is synthetic (C65.1, C65.2): invented holders, issuers ("Utopia Water Board"), cities and unassigned postal codes, each page marked as a synthetic test document. `services/vision/tools/make_synthetic_fixtures.py` writes, into the gitignored `fixtures/generated/`:

- **the main set** (`poa/`): the five classes in English (US Letter) and Spanish (Spain, A4), each as a born-digital PDF and a phone photo of the print; date cases (a bill 200 days old, one dated 30 days ahead, a lease signed long ago and in term, an ended lease, a January W-2 read in October); a password-protected PDF; 13 edited variants and 6 genuine ones that must stay under the threshold (linearized, signed then extended for long-term validation, a GoTo open action, distinct XMP ids, generated after the printed date, a scan);
- **the hostile set:** 15 files (XMP entity expansion and external entities, a 10 MB XMP packet, a flate bomb, too many pages, a huge page box, page-tree and xref loops, deep nesting, every dangerous action, a JBIG2 image, truncation, a non-PDF, a JPEG 2000 and a PNG bomb), each with the answer vision must give within seconds;
- **the held-out set** (`poa-held-out/`), above.

The documents are dated around the day the generator runs (its stamp names the day), so the e2e stack generates them again each day and they stay current. Each file has a JSON sidecar with its truth and what C60.6 expects of it. The full-stack spec `e2e/tests/document-poa.spec.ts` uploads the current bill in the hosted flow (it passes with its preview), the bill whose amount is covered by a white box (the advisory fabrication check fails with its components, the verification passes), and the old bill (`document_too_old` with a retry hint) followed by the current one.

## Known limits

- **Prose contracts.** The name is read from an addressee block or a `Label: value` field. A party named in a clause ("de otra parte, como arrendataria, …") is not read, so such a lease fails `name_not_found` and its address may be the landlord's.
- **The issuer** of a lease or a tax form may read as the document's title line when no taller heading names the company.
- **The OCR of born-digital pages** reads the text-layer boxes only: text drawn only as an image on such a page (a logo, a pasted image of a number) is not read.
- **Clips and overlays.** A text clip (render modes 4 to 7) and an annotation drawn over text are seen only through the text-layer agreement, and clips are read as bounding boxes.
- **Signatures.** An increment that adds only a later signature (its signature dictionary, field, widget and AcroForm entries) is not an edit after the first signature, so a lease signed by two parties in turn does not show `edits_after_signature`. Any other change in that increment still is, the Info dictionary and XMP metadata included.
- **Unread lines.** The OCR of one document is bounded at 2,400 line units (a line's width in line heights), shared among the analysed pages. On a very dense document the lines past a page's share are not read; they are left out of the text-layer agreement, not counted as disagreeing.
- **Photo forensics.** The text-cell error level needs a paste on the photo's 8×8 JPEG grid; a small copy-moved patch (on the order of 15×20 pixels) is not seen (the generated copy-move photo scores 0.0); a JPEG 2000 scan inside a PDF is not measured as a photo.
- **Annotations** are counted on the analysed pages only (the first three and the last).
- **Uncovered languages** that share function words with Spanish can be read as covered (see the held-out results).
- **Not a calibrated classifier:** the type confidence is a probability of our own rules, not a measured accuracy.
