# OpenVerify: progress log

Newest entries first. Each phase records its status, verification numbers, blockers and next steps. See `docs/PLAN.md` §6 for the phase definitions.

| Phase | Title | Status |
|---|---|---|
| 0 | Bootstrap (toolchain, repo, scaffold) | **done** (2026-10-20) |
| 1 | Walking skeleton (contracts + thin E2E) | **done** (2026-10-20; [plan](plans/phase-1.plan.md)) |
| 2 | Core platform depth | **done** (2026-10-20; [plan](plans/phase-2.plan.md)): Workflows 2A (backend), 2B (review and fixes), 2C (dashboard, web flow, Android), 2D (review of 2C and fixes) and 2E (API gaps, remaining console pages, 2D carry-over) |
| 3 | Government ID checks | **done** (2026-10-21; [plan](plans/phase-3.plan.md)): Workflows 3A (contracts, vision, check logic, wiring, integration) and 3B (console and client surfaces, review, fixes) |
| 4 | Selfie & liveness | **done** (2026-10-22; [plan](plans/phase-4.plan.md)): Workflows 4A (contracts, vision, check logic, fixtures, both clients' capture, wiring, integration) and 4B (console surfaces, face-match calibration, review, fixes) |
| 5 | Other verifications | **done** (2026-10-24; [plan](plans/phase-5.plan.md), four review passes): Workflows 5A, 5B and 5C; the Android SDK moved to Kotlin Multiplatform first (2026-10-22, [plan](plans/kmp-migration.plan.md), ADR 0004) |
| 6 | Reports | **done, with three open budget lines** (2026-10-30; [plan](plans/phase-6.plan.md), three adversarial reviews and a verification round): Workflows 6A and 6B (2026-10-28), 6C (2026-10-29) and 6D (2026-10-30). The C78.7 budgets at 100,000 and 2,000,000 names and the 60 s re-screen are missed and carried, unmoved, to Phase 11 (owner decision 1 after 6C; [calibration](calibration/watchlist-phase6d.md)) |
| 7 | Signals, lists, graph, transactions | **done** (2026-11-02; [plan](plans/phase-7.plan.md), three adversarial reviews and a verification pass, [resolution](plans/phase-7-review-resolution.md)): Workflows 7A (2026-10-31), 7B (2026-11-01) and 7C (2026-11-02) |
| 8 | Workflows & cases | **done** (2026-11-04; Workflows 8A, 8B, 8C and 8D; two acceptance lines carried to Phase 9 by name; planned 2026-10-27; [plan](plans/phase-8.plan.md), three adversarial reviews and a verification round, [resolution](plans/phase-8-review-resolution.md)) |
| 9 | Dashboard completeness & flow builder | **done** (2026-11-08; Workflows 9A (2026-11-05), 9B (2026-11-06), 9C (2026-11-07) and 9D (2026-11-08); WCAG 2.2 AA audit: automated part done, manual part not run, no conformance claimed; planned 2026-10-29; [plan](plans/phase-9.plan.md), C147–C179, Workflows 9A–9D; three adversarial reviews (96 findings: 4 CRITICAL, 20 HIGH, 50 MEDIUM, 22 LOW) and a verification round (9 partly resolved, 17 new), all resolved, [resolution](plans/phase-9-review-resolution.md); research `research/phase9-*.md`) |
| 10 | Android SDK + demo | **done locally; CI pending** (2026-11-11; Workflows 10A (2026-11-09), 10B and 10C (2026-11-10), 10D and 10E (2026-11-11); the release gate's owner items and the CI-green bar of decision 72 are listed in the phase close). Planned (2026-10-29; Android only, iOS moves to the next release, owner decision 2026-10-29; [plan](plans/phase-10.plan.md), C190–C225, Workflows 10A–10E; three adversarial reviews (80 findings: 0 CRITICAL, 17 HIGH, 47 MEDIUM, 16 LOW) and a verification round (10 partly resolved, 14 new), all resolved, [resolution](plans/phase-10-review-resolution.md); owner items P1–P5 decided 2026-11-08 by the orchestrator under the owner's delegation (P1 and P2 granted narrowly, P3 and P5 declined, P4 pending the owner's accounts; the plan's "Orchestrator decisions before Workflow 10A"); research `research/phase10-android-*.md`) |
| 11 | Connect / reusable KYC + hardening | **done locally, CI pending** (2026-11-22): Workflows 11A (2026-11-13), 11B (2026-11-14), 11C (2026-11-16), 11D (2026-11-20), 11E (2026-11-20), 11F (2026-11-21) and 11G (2026-11-22) done locally; the release tag is the owner's (Q6, Q7 and P4 open). Planned (2026-10-29; [plan](plans/phase-11.plan.md), C230–C289, Workflows 11A–11G; three adversarial reviews (92 findings: 1 CRITICAL, 31 HIGH, 40 MEDIUM, 20 LOW) and a verification round (7 partly resolved, 16 new), all resolved, [resolution](plans/phase-11-review-resolution.md); the C78.7 item stays conditional on Workflow 6D's calibration; owner items decided 2026-11-21 under the owner's delegation (Q1–Q5, Q8 and Q10–Q12 granted; Q9 declined; Q6 and Q7 pending, both needing counsel); research `research/phase11-*.md`) |

## 2026-11-25: The open-source release (a public repository with a fresh history; README, community files, illustrations and screenshots)

**Status: done; public.** On the owner's instruction of 2026-11-25 ("Prepare nice readmes , screenshots, illustrations and make it available to everyone. make it opensource and follow all conventions and good practices"), OpenVerify was published as the public repository `hnalpha323/openverify`. The owner's decisions: a fresh public history (a single squashed commit of this tree under the GitHub noreply address, because every commit of the development history carries a personal address), with the development history kept private as an archive; Workflow 12A published with it and the device retest done afterwards; the repository public at once; GitHub-only contact.

- **Commit ids.** The ids cited in this log, in `docs/tdd/` and in the plans before this entry are those of the private development history. The public history starts with the squashed commit of this tree; its second commit points the ASVS and MASVS rows' `reviewed_commit` at that root, which holds the same tree as the archive's tip, where no row was stale (C274.6).
- **Documentation:** the README rewritten (logo, features, how a verification works, the architecture, the quick start, a first inquiry, the project's status, the documentation index); `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SUPPORT.md`, `CHANGELOG.md`, issue forms, the pull request template and `CODEOWNERS`; the logo and two illustrations in light and dark (`docs/assets/`); screenshots of the flow and the console from the end-to-end stack's synthetic data, reproducible with the opt-in spec `e2e/tests/docs-screenshots.spec.ts`.
- **REL-VISIBILITY done** (Q1): `SECURITY.md` and the vulnerability policy say the repository is public and the private reporting channel open, and the records rule follows the checklist's line (test-first, `docs/tdd/release-open-source.tdd.md`). ASVS v5.0.0-15.1.1 reviewed again (still met). `release:check`: 0 errors, 62 owner items.
- **Still the owner's:** Q6 and Q7 (counsel), P4, REL-ENVIRONMENT, REL-GHCR, REL-NPM, KP11-39, the first green CI run (D69-CI), and Workflow 12A's device retest on the Pixel 9 (the phone was offline).

## 2026-11-22: Workflow 12A done (reading a Quebec driver licence from phone captures)

**Status: done locally; the owner's device retest pending.** Published with the open-source release (above). Every test uses synthetic Quebec-format SPECIMEN cards (TREMBLAY / MARIE, T1234-567890-12); no photograph or OCR text of the owner's card was read or kept.

**Why.** In the owner's live test of 2026-11-22, a real Quebec licence went through the hosted flow on a Pixel 9 and failed three times: the back gave no PDF417; parseViz read none of the front's fields; the whole-image blur score was about 38.5 against 100; `id_handwriting_detection` flagged clean print; a missing required field failed the inquiry. Plan: `docs/plans/phase-12a.plan.md`.

- Range: base 4ea2493bf, agents' last commit 18fda7d25 (11 commits). One run, `wf_abe8b23f-87c` (2026-11-22, 4.5 h): 5 of 5 agents, 0 errors, 696 tool uses; claude-opus-5-5.
- **contracts-12a:** the plan and the deterministic generator `services/vision/tools/synthetic_quebec.py` (17 tests), `contracts/fixtures/quebec-dl/`.
- **capture-12a:** the web flow takes document photos at full camera resolution (JPEG 0.92, long side up to 4096, metadata removed) with a sharpness and size check and a retake prompt in five locales, and a barcode band on the back; Android takes document stills up to 4096x3072 at quality 92.
- **vision-12a** (partial): bounded PDF417 recovery (every required back decodes except the dense back under glare, beyond zxing-cpp's erasure limit; blur and motion never give a wrong payload); the `text_layout` document fallback; blur measured on the text at a fixed card width of 1000 px; stroke statistics only from 120 samples.
- **checks-12a:** parseViz reads the Quebec shapes (format hints, glued labels, year-month-day dates, digit confusions, the number pattern, the layout rule for the unlabeled names); AAMVA tolerance; `missing-fields-outcome: review`, on in the seeded template, so a missing field gives `needs_review`, never a failed inquiry; blur judged on the rectified card with an OCR legibility rescue; handwriting no longer tripped by the confidence drop alone; the `ca-dl-qc` number grammar.
- **integration-12a:** the end-to-end proof (the five required fields from the barcode alone, the printed front alone and both, on every legible capture: flat, phone-1080, -soft, -tilt, -q75, -glare, phone-full), the blur calibration through the real analysis, the legibility floor 0.8, the committed vision answers with `quebec-phone-capture.test.ts`, the stale generated documents; the images rebuilt.
- **Orchestrator (Stage 3, `docs/tdd/phase12a-orchestrator.tdd.md`):** `min-document-blur-score` 96.56 → 67.1; `min-document-tenengrad` 8583.33 not applied (it fails a genuine Phase 3 card; it stays template-only, as Phase 3 decided); ASVS v5.0.0-2.1.2 reviewed again. validate-full on bdf1612ac: 45 of 47 rows green; `test` held one defect, the Android flow fixtures stale after the review routing (regenerated, the SDK's stackTest green on them, cd159f82a), and timeouts under load recorded and not retried (KP11-44, KP11-67, the watchlist shortcuts' Phase 7 class); `integration` met KP11-102 again.
- **Open:** the handwriting false positive can recur under glare (advisory); `docs/calibration/blur-phase12a.md` says `id_blur_detection` stays beta while the registry says ga; the dense back under glare; the Quebec back never qualifies for the OCR rescue; Q12A-1 to Q12A-3 hold their defaults; the device retest.

## 2026-11-22: Phase 11 done (Connect and hardening: Workflows 11A-11G done locally, CI pending; the owner-gated release artifacts wired and never run, Q6, Q7 and P4 open)

**Status: done locally; CI pending.** The owner has no Actions minutes, so nothing in Phase 11 is proved by CI (rule 24). Seven Workflows, each pushed once after the orchestrator's own validate-full: 11A (2026-11-13), 11B (2026-11-14), 11C (2026-11-16), 11D (2026-11-20), 11E (2026-11-20), 11F (2026-11-21) and 11G (2026-11-22, below). "CI-green" (decision 69, the plan's Acceptance) waits for the first CI run, release.yml's staged run and android-release.yml's run on the final commit (D69-CI, KP10-59). Nothing was published, signed, attested, made public or dispatched.

### Workflow 11G done (the owner-gated release artifacts)

- Range: base 9003bc311, start 4b3a06a0f, checkpoint abb3bf251 (55 commits). One run, `wf_cbff5ff1-18e` (2026-11-21 to 22, 10.4 h): 5 of 5 agents done, 0 errors, 902 tool uses; claude-opus-5-5; about $149 at API list prices. The 11F push's run 44961662119 started no step, so no CI failure was passed in.
- **contracts-11g:** the base checks; the inventory of 11A-11F as built; the 17 owner states read from PROGRESS, equal to the orchestrator's; the owner steps checked read-only (private repository, no `release` environment, `OPENVERIFY_PUBLISH` unset, GHCR and the npm scope not checkable without credentials), each a release-time owner line; pins: github/codeql-action v4.39.3 by commit and uv 0.13.7, each at least 14 days old; the dependency review: Next.js 16.4.2 → 16.4.5 (exact catalog pin, 18 days old, fixes its seven medium advisories; the stack's first start then came up with no security stop), Node 22.22.1 → 22.23.4 by digest, vision's python:3.12-slim to its 2026-11-05 build, fast-uri 3.1.9 and 4.2.3 (KP11-96 done); the image gate still fails on Debian findings with no Debian fix (1 critical and 37 high in each Node image) and 4 highs in the Node binary that 22.23.5 fixes (eligible 2026-11-25), recorded and not allowlisted (KP11-42 open); the Gradle advisories, build tooling only, stay in the H14 table (KP11-97 open).
- **publish-11g (Q1-Q4):** release.yml's publish job wired for images and chart by digest, cosign keyless signing, GitHub attestations and npm by trusted publishing with provenance over the staged tarballs; a dry-run input (default true); only `vars.OPENVERIFY_PUBLISH == 'true'` on `main`, in environment `release`; no key path, no stored token; tested statically.
- **codeql-11g (Q1 granted, Q9 declined):** `.github/workflows/codeql.yml` and its config, informational, only on a public repository, outside decision 69's bar; `infra/tests/codeql-workflow.test.sh`; never run.
- **records-11g:** Q1 (SECURITY.md and the vulnerability policy: the private channel opens with the public release); Q5 (uv 0.13.3 replaced by 0.13.7 in ci.yml, the vision Dockerfile and images.test.sh); Q8 (`vendorNaming` on: `docs/migration/from-persona.md`, docs-only, with a not-affiliated line; product UI and branding unchanged); Q10 (the three unlock hooks wired test-first, KP11-31 fixed; the documented install default true; every environment still needs an admin's audited opt-in; no seed opts in); Q11 (both licence rows accepted; the API image's label decided; vision stays `pending-owner` for KP11-39); Q12 (recorded; Locust in the next release); P2's record checked; the checklist's DEVICE-PROOFS line set from the orchestrator's 22 of 22 after 11F.
- **integration-11g:** six fixes test-first (the UN opt-in route's description, the publish job's main check at job level, a renamed load-compose check, the release notes' wording for granted and declined items, ADR 0010 rule 4's "nothing is signed", four ASVS rows reviewed again); the checklist (169 lines: 36 done, 86 open, 40 owner, 7 ci-pending; new REL-VISIBILITY, REL-ENVIRONMENT, REL-GHCR, REL-NPM, REL-README, D69-CI, KP11-97 to KP11-102); the notes re-rendered; "## Workflow 11G Stage 2 amendments" and "## Workflow 11G Stage 3 amendments (integration-11g)".
- **Validation at the final tree** (integration-11g, alone): every step passed. API 11,009 at 93.43%; dashboard 7,384 at 95.67%; integration 579; vision 2,725 at 97.46%; the twelve Android calls (SDK host 2,739); e2e mocked 349, shards 50/52/49/48, sweep 109, stackTest 3 (no Next.js stop this run); WebKit 7; six images; 36 infra scripts and 3 chart contracts; load/ 242; `--verify-ids` 253 and 24; the eight supply-chain steps; chart checks; kind 1.35 and 1.37; DAST on the images mode (26 scans, 117,217 answers, no 5xx, High 0, FAIL 0; `docs/security/dast-2026-11-22.md`); release:check 0 errors, 63 owner items; gitleaks over 8,108 commits; PII 0 kept. Skipped by their conditions: the clean-build pass, the benchmarks, the device suites (no android/ change).

**Owner items at the close:** Q1-Q5, Q8 and Q10-Q12 granted and built (Q2-Q4 wired, not yet published); Q9 declined, its outcome built; **Q6 and Q7 pending** (counsel); Phase 10 P1 and P2 granted narrowly, P3 and P5 declined, **P4 pending** (the owner's Central Portal account, key and namespace).

**Known items.** Open in 11G: KP11-42 (the image gate's Debian and Node-binary findings; Node 22.23.5 eligible 2026-11-25) and KP11-97 (the Gradle medium advisories). Deferred with their owners (the next release per PLAN's "Next release: Phase 11 deferrals (C286)", rule 6's failures under load, the owner, the release gate): the 68 of `known-11g`, KP11-102 among them, and KP11-103 (below).

**Carried forward:**
- C88's deferrals (phase-6.plan.md), each with its reason
- C110's deferrals (phase-7.plan.md), each with its reason
- C145's deferrals (phase-8.plan.md), each with its reason
- C223's deferrals (phase-10.plan.md), each with its reason
- C286's deferrals and Phase 11's open items are placed by PLAN's "Next release: Phase 11 deferrals (C286)".

**The release tag (the owner's steps; `pnpm release:check --tag` refuses until each is done):** Q6 and Q7 (counsel) and P4; the release-time owner steps (make the repository public, create the `release` environment with its reviewer, set `OPENVERIFY_PUBLISH`, the first GHCR packages, npm's trusted publishers); KP11-39 (the vision image's bundled FFmpeg, libquadmath and libgfortran); the image gate's findings (KP11-42); the version strings (0.0.0 against 0.1.0) and the dated android/CHANGELOG.md; the first CI run, release.yml's staged run (`docs/release/staged-run.json`) and android-release.yml on the final commit; the medium advisories past 90 days.

**How the run went (orchestrator).**
- Phase 11 cost: 11A-11G in nine Workflow runs on claude-opus-5-5; per-phase time, tokens and cost are in the orchestrator's phase report.
- `validate-full.sh` on `abb3bf251`: every row rc 0 but two. `stack-test` passed (152 s): Next.js 16.4.5 no longer stops the dashboard build (KP11-42's Next.js half).
  - `test` (2,334 s, every package at once): KP11-67's re-key case met the shared 60 s guard again (the file 131 s; 22 s alone, 4 of 4), the only failure; API 11,008 of 11,009. Carried (rule 6).
  - `integration` (810 s): `src/worker.integration.test.ts` met its 180 s hook guard, then 6 of 7 cases timed out with refused connections to its container (25 s alone, 7 of 7): **KP11-103**, cause not established, not patched or retried (rule 6); carried to the next release. db 110 of 110; integration-11g's Validation passed the file in its own call.
  - Evidence: `docs/tdd/phase11-orchestrator.tdd.md`.
- release.yml, android-release.yml and CodeQL are not dispatched: no Actions minutes (rule 24). The repository stays private.

## 2026-11-21: Phase 11, Workflow 11F done (dynamic testing, a review of all of Phase 11 and fixes: ZAP 2.17.0 against the production images with no high finding, four reviewers and a verifier with no CRITICAL or HIGH finding, 31 items fixed test-first, the checklist, release notes and met-row evidence brought to the final tree)

**Status: done locally; CI pending.** The owner has no Actions minutes, so nothing is proved by CI (rule 25). Nothing was dispatched or re-run; the orchestrator pushes once, after its own validate-full. The 11E push's run 44854752893 started no step in any of its 19 jobs, so no CI failure was passed in. release.yml and android-release.yml are not dispatched (decision 50, C267.1): each staged run is recorded open until Actions minutes allow.
- Range: base b45a0a498, start 1746797ae, checkpoint 2002ecc05 (135 commits).
- Nine agents, all done: dast-11f; the reviewers privacy-security-law, correctness-honesty, supply-chain-deployment-ci and documentation-coverage; the verifier; fix-server, fix-clients and fix-records.

**Outcome.**
- **DAST (C283):** `security/zap/` (run.sh prepare, api, flow, console, report and revoke; rules.tsv with the pinned image's 115 rules, 27 FAIL and 16 IGNORE, each with its reason; 23 API groups; triage.tsv), held by `infra/tests/zap.test.sh` and `security/tests/test_dast_zap.py`. ZAP 2.17.0 by digest, with its THIRD_PARTY_LICENSES.md row. The e2e stack ran in its images mode on this host (rung (i): host networking was reachable). The complete run covered both hosted flow variants, the console with a seeded admin's session, the flow API and every operation of 23 API groups: 117,770 requests, no 5xx, no High alert, no alert of a FAIL rule; 5 Medium and 46 Low alerts, each triaged. Report `docs/security/dast-2026-11-21.md`. No application fix was needed.
- **Review of all of Phase 11 (`4db86122d..HEAD`):** 0 CRITICAL, 0 HIGH, 5 MEDIUM (F001, F002, F004, F006, F007), 2 LOW (F003, F005). The verifier had nothing to verify; its table, `docs/release/verified-findings.md`, keeps no row, with a dated sentence. Met-row evidence (C274.3): 22 rows sampled, 20 supported; ASVS v5.0.0-16.2.4 and v5.0.0-16.4.1 moved from met to partial (KP11-74), and every row whose evidence 11F changed was reviewed again (C274.6).
- **fix-server (10):** nosniff on every API answer (KP11-70); face-scan:benchmark out of the compiled commands (KP11-71); hydrated fields left out of a share's source, so data from another organisation is never passed on (F001/F002); migration `0037_phase11f_session_amr`, so an SSO session keeps the provider's amr (KP11-26, server half); the ASN seed cache (KP11-91); the consent-digest comments (KP11-73); the calibration writers keep the summary block (KP11-75); release:check's verifier-table vocabulary (F006) and the wording rule's clause scope (F007); the e2e stack holder streams container logs, so a long-held stack always reaches compose down.
- **fix-clients (9):** the Secure console cookie is `__Host-openverify_session` (KP11-78); the sessions page shows the provider's sign-in methods (KP11-90); the palette by the draft's trigger (KP10-15); the error boundary logs kind and digest only (KP11-80); KP11-66 with its cause established (86 labelled checkboxes, each label resolved by walking the whole document; the refusal case from 63 s to 24 s at 1/32 of a CPU); eight new form tests (KP11-95); ConsentDigests.kt's comment (KP11-79); the font-scale sweep's scroll axis (KP10-53); FlowApiException.InvalidResponse's fixed decode code (KP10-56).
- **fix-records (12):** gateway.httpRoute.parentRefs (KP11-84); load-phase11.md's incremental-key-df wording (KP11-82); custom-list.md's cap of 5,000 (KP11-85); government-id.md's compromised-list note (KP11-86); the compose app profile keeps one database role, decided and recorded (KP11-83); the vision image labelled `pending-owner` while KP11-39 waits (F004); the DAST console scan's cookie name; ci.yml's SDK host-test floor to 2,739; the readiness integration test's pool times out, so its afterAll never hangs (cause established at load 16.8); docs:selfhost after 0037; the checklist test from 11F on. Also the checklist states, the release notes, the CI records and the "## Workflow 11F review amendments" section (`d119134d1`, with "### The Validation as run (fix-records, 2026-11-21)" in `2002ecc05`).

**Known items.**
- Fixed in 11F: KP10-15, KP10-53, KP10-56, KP11-26, KP11-66, KP11-70, KP11-71, KP11-73, KP11-75, KP11-78, KP11-79, KP11-80, KP11-82 to KP11-86, KP11-90, KP11-91, KP11-95; and F001, F002, F004, F006, F007.
- Open, with owners (fix-records' carried list in the review amendments; PLAN's "Next release: Phase 11 deferrals (C286)" places them): KP10-19, KP10-24, KP10-26, KP10-28, KP10-30, KP10-35 part 2, KP10-55, KP10-57, KP11-5, KP11-6, KP11-8, KP11-10, KP11-19, KP11-20, KP11-21, KP11-24, KP11-25, KP11-27 (eight C16 steps), KP11-28, KP11-29, KP11-30, KP11-33, KP11-34, KP11-38, KP11-44, KP11-52 to KP11-62, KP11-67, KP11-68 (the init's log is now kept and quoted, `b01cad1cf`; its cause is open), KP11-69, KP11-72 (16.3.1/16.3.2), KP11-74, KP11-76, KP11-77, KP11-81, KP11-88 and KP11-89 (both wait on KP11-20's and KP11-21's server checkpoints, never made), KP11-92, KP11-93, KP11-94; and F003, F005.
- Failures under load met in 11F, recorded and not retried into green (rule 6): KP11-38 (fix-records' first API run: operator-patterns.test.ts's CPU budget, 103.1 and 120.1 ms against 100 ms at shard load 8-10; the owner's budget-unit decision), KP11-42 (Next.js 16.4.2's security notice stopped the first stack start in several calls; nothing upgraded), KP11-44 (screen-catalogue at 1/32 of a CPU; cause not established).
- Owner and release gate: KP11-39, KP11-40, KP11-41, KP11-31 (Q10), KP11-9, E002, KP10-16, KP10-17, KP11-23, KP10-58, KP10-59, KP10-60, KP10-61, KP11-63, KP11-64, KP11-65; KP10-51 and KP11-4 until the android job's first measured run; KP10-31 open by design.

**Owner decisions (2026-11-21).** Decided by the orchestrator under the owner's delegation ("take the decisions yourself and lets finish this project"). Each takes the plan's recommended default (C289) unless it needs what only the owner or a lawyer can supply. Nothing is published, signed, made public or dispatched before the owner's release tag; Workflow 11G builds the granted items.

**Q1:** granted (2026-11-21, delegated): private until the release, public at the owner's release step; the orchestrator changes no visibility.

**Q2:** granted (2026-11-21, delegated): GHCR under the owner's account, images by digest with SBOM and signature, the chart as an OCI artifact.

**Q3:** granted (2026-11-21, delegated): cosign keyless from the public repository's release workflow, SLSA provenance by GitHub attestations.

**Q4:** granted (2026-11-21, delegated): `@openverify/node`, `@openverify/js` and `@openverify/react` published with provenance once public.

**Q5:** granted (2026-11-21, delegated): the compliant default; the 14-day rule covers toolchain binaries, base images and Actions, and uv 0.13.3 is replaced.

**Q6:** pending; it needs counsel: weights stay fetched at start, and the release notes say the review is open.

**Q7:** pending; it needs counsel: "not reviewed by counsel" and the texts' marker stay.

**Q8:** granted (2026-11-21, delegated): a factual docs-only migration page naming the source system, no logo, no copied text, a not-affiliated line; product UI and branding keep the bar.

**Q9:** declined (2026-11-21, delegated): buy nothing; the SAST baseline gates, and CodeQL runs informational once the repository is public (Q1).

**Q10:** granted (2026-11-21, delegated): an environment admin may enable `un-sc` with an audited acknowledgement of the UN's terms.

**Q11:** granted (2026-11-21, delegated): MIT-0 (`nodemailer`) and EPL-1.0 (JUnit 4, test scope) accepted.

**Q12:** granted (2026-11-21, delegated): ZPL-2.1 as unmodified dev tooling in `load/`; a grant after 11D's Stage 1a, so Locust waits for the next release.

Phase 10's P1 and P2 stay granted narrowly and P3 and P5 declined (2026-11-08); P4 stays pending (it needs the owner's Central Portal account, key and namespace).

**Validation at the final tree** (fix-records, alone; every call in the foreground):
- PASS: install; format:check; forced typecheck 20/20 and lint in three calls; fetches and variant groups; db 2,395; watchlist 840; e2e 161; dashboard 7,384 in 623 files at 95.67%; the other 14 packages (docs-tools 428); js 19; API 10,992 in 872 files at 93.43% (the re-run after the readiness fix); benchmark 133; integration (db 110, graph 13, api 121, 139 and 196); vision 2,725 at 97.46%; security/python 258.
- PASS: all twelve Android calls (SDK host tests 533 + 427 + 1,779 = 2,739; 97 screenshots; demo 97 and 9; nfc 116; face 51; 98 release-check tests; staging and consumer-check; three demo combinations; cyclonedxBom 188, 195 and 190).
- PASS: openapi and workflow docs, no diff; e2e mocked 349, shards 50/52/47/49, sweep 109, stackTest 3 of 3 (the first stack start stopped on the Next.js notice and was started once more); WebKit 7 of 7; six images; infra 35 scripts, images.test.sh as 9 subcommands, 3 chart contracts; load/ 242; `--verify-ids` 253 and 24; supply-chain.sh's eight steps; chart-checks; kind 1.35 and 1.37; DAST (High 0, FAIL 0, 116,932 requests, no 5xx); release:check 0 errors, 85 owner items; gitleaks over 8,049 commits; PII 0 kept.
- First-run failures: API 2 of 10,991 (KP11-38, above); integration api 2/3's afterAll hang, fixed test-first, then passed.
- Skipped by the rules: the clean-build pass (no lockfile or verification-metadata change), the benchmarks (none touched).
- **Device suites (step 22):** on the Pixel 9 (Android 17) nfc 2 of 2 and face 4 of 4 passed; the SDK passed 7 of 14, its 7 activity and camera tests failing with the phone dozing behind its keyguard ("No compose hierarchies found"); the demo smoke test did not run. No agent unlocks the owner's phone. The orchestrator re-ran all four with the owner at the phone (below): 22 of 22.

**Carried forward:**
- C88's deferrals (phase-6.plan.md), each with its reason
- C110's deferrals (phase-7.plan.md), each with its reason
- C145's deferrals (phase-8.plan.md), each with its reason
- C223's deferrals (phase-10.plan.md), each with its reason
- C286's deferrals and 11F's open items are placed by PLAN's "Next release: Phase 11 deferrals (C286)".

**Still open for the release (release:check's owner items):** the version strings (0.0.0 against 0.1.0) and the undated android/CHANGELOG.md, both for the tag; `docs/release/staged-run.json`, after release.yml's first staged run.

**How the run went (orchestrator).**
- `wf_fdda577e-ab6` (2026-11-21, 18.0 h): 9 of 9 agents, 0 errors, 1,346 tool uses; 135 commits `1746797ae..2002ecc05` on base `b45a0a498`. claude-opus-5-5 for the agents and the orchestrator, with a small share on claude-sonnet-5-5 (about $5); about $316 at API list prices.
- `validate-full.sh` on `2002ecc05`: every row rc 0 but two.
  - `integration` (820 s, every package at once): seed:load's "creates the accounts, then the inquiries in their statuses" (C268.3) met the shared 60 s guard, and the next case failed on the cut-off step's record (the file 198 s; 35 s alone, 6 of 6): **KP11-102**, the class of KP11-67, cause not established, not patched or retried (rule 6). api integration 467 of 469; db 110 of 110.
  - `stack-test`: the dashboard's `next build` was stopped by Next.js 16.4.2's security notice again (KP11-42, 11G's dependency review); stackTest did not run. fix-records' Validation ran stackTest 3 of 3 on this tree.
  - The `test` row passed every package at once (API 10,992; KP11-66 and KP11-67 not met).
- **Device suites, with the owner at the phone** (screen kept on while plugged in with `adb shell svc power stayon true`): `:openverify-sdk:connectedAndroidDeviceTest`, nfc, face and `:demo-app:connectedMinifiedSmokeAndroidTest` on `2002ecc05`'s tree, read by `check-connected-results.sh`: **22 of 22** (SDK 14, demo smoke 2, nfc 2, face 4). Each Gradle exit 1 is KP10-31. 11F's nine open device proofs are closed.
  - Evidence: `docs/tdd/phase11-orchestrator.tdd.md`.
- CLAUDE.md names the DAST commands (`security/zap/run.sh`, `infra/tests/zap.test.sh`).
- release.yml and android-release.yml are not dispatched: no Actions minutes (rule 25); the staged runs stay open.

## 2026-11-20: Phase 11, Workflow 11E done (documentation and the security records: the threat model and the ASVS and MASVS checklists with their tests, the security records, the self-hosting, compliance and sharing guides, the generated catalog, API reference and neutral migration mapping, the release checklist with pnpm release:check and generated notes, ADR 0010 final and the records corrected)

**Status: done locally; CI pending.** The owner has no Actions minutes, so nothing is proved by CI (rule 25). Nothing was pushed, dispatched or re-run; the orchestrator pushes once, after its own validate-full. The 11D push's run 44785912432 started no step in any of its 19 jobs, so no CI failure was passed in. Nothing under android/ changed in 247f6af3c..HEAD: no device suite ran, and no device proof is open from 11E.
- Range: base aa00b57bb, start 247f6af3c, checkpoint 778dfd414.
- Eight agents, all done: contracts-11e, docs-security, docs-records, docs-selfhost, docs-compliance, docs-catalog, docs-release and integration-11e.

**Outcome.**
- `packages/docs-tools` (private): 412 tests in 51 files at 97.56%. It holds the generators, record tests, the wording test (C274.5), the vendor-name test (neutral while Q8 is pending), the docs tree (48 documents, no draft left) and `pnpm release:check`.
- Security records (docs/security/), self-assessed and never certified:
  - **Threat model:** 172 rows (122 control, 22 operator, 16 accepted, 12 gap).
  - **ASVS 5.0.0 L2:** 253 rows (148 met, 38 partial, 7 gap, 51 n/a, 9 operator).
  - **MASVS v2.1.0:** 24 rows (12, 8, 0, 3, 1).
  - **Other records:** crypto inventory, generated data classification, logging inventory, vulnerability policy; SECURITY.md (the channel opens with the public release, Q1).
  - **Review commit:** fc8cb31ee (against 7d813b436), confirmed on the final tree by integration-11e; no stale row.
- **Self-hosting guide** (17 pages): a generated configuration reference (125 entries) and hardening checklist; C272's settings; sizing from the 11D load machine.
- **Compliance guide:** not legal advice and not reviewed by counsel (Q7). Sources were re-read on 2026-11-20; EU GDPR, BIPA, Texas and the CCPA sections are marked not re-read. It has generated recipients and record-of-processing pages.
- Generated catalog pages:
  - the check catalog (89 checks, 11 report types, 19 signals) and the API reference (401 paths, 501 operations; scopes from the committed docs/api/route-table.json);
  - the neutral migration mapping (534 identifiers), and the sharing guide (10 pages).
- **Release records:** the release checklist (150 lines: 10 done, 89 open, 47 owner, 4 ci-pending), generated release notes, and `pnpm release:check` (default: 0 errors, 80 owner items; `--tag` refuses).
- **C282:** ADR 0010 final (rule 6 written); PLAN corrected (k6 only as excluded; "Next release: Phase 11 deferrals (C286)"); THIRD_PARTY_LICENSES.md corrected; the surface index confirmed; the Phase 5 section 8 addendum; the C88 note.
- **Plan sections:** "Workflow 11E Stage 1a amendments (contracts-11e)" 1-17, "Workflow 11E Stage 2 amendments" (six subsections) and "Workflow 11E Stage 3 amendments (integration-11e)" 1-12.

**Known items.**
- Fixed in 11E:
  - KP11-45 (docs-security);
  - KP11-32, KP11-43, KP11-48 (docs-selfhost);
  - KP11-46 (docs-compliance);
  - KP11-22 (docs-catalog);
  - KP11-47, KP11-49, KP11-50 (docs-release);
  - KP11-51 (integration-11e: FFmpeg, libquadmath and libgfortran recorded as pending the owner beside the OpenCV row; not an exception row).
- Carried, not fixed:
  - **to 11F:** KP11-10, KP11-19, KP11-20, KP11-21, KP11-24, KP11-25, KP11-26, KP11-27, KP11-28, KP11-29, KP11-30, KP11-33, KP11-34, KP11-38, KP11-44, KP10-56, KP10-24, KP10-19, KP10-15, KP10-28, KP10-55, KP10-53, KP10-57, KP10-35 part 2, KP10-26, KP10-30, KP11-5, KP11-6, KP11-8, KP11-52 to KP11-62, KP11-66, KP11-67, KP11-68. None was met in this Validation; KP11-67 was met again in the orchestrator's validate-full (below).
  - **to 11G:** KP11-42, with the Next.js 16.4.2 security notice, which stopped the first e2e stack start again; nothing was upgraded.
  - **open until the android job's first measured run (KP10-59):** KP10-51, KP11-4.
  - **open by design:** KP10-31.
- Owner and release gate: KP11-39, KP11-40, KP11-41, KP11-31 (Q10), KP11-9, E002, KP10-17, KP10-16, KP11-23, KP10-58, KP10-59, KP10-60, KP10-61, KP11-63, KP11-64, KP11-65.

**Owner items, as recorded:**
- Q1-Q12: all pending, each building its default (C289).
- Phase 10: P1 granted narrowly, P2 granted narrowly, P3 declined, P4 pending, P5 declined (phase-10.plan.md, "Orchestrator decisions before Workflow 10A" item 2).
- Phase 5 decisions 46 (tslib's 0BSD) and 31 (libpdfium's notice licences) are recorded as confirmed under the owner's delegation; the owner may reverse either.

**Handed to 11F** (code and record defects found by the documents; nothing changed in 11E):
- **fix-server:**
  - no route-to-rate-policy table;
  - the API sends nosniff only on file routes;
  - face-scan:benchmark is in the API image;
  - six missing ASVS tests;
  - stale consent-digest comments;
  - vision and code-runner logs have no redaction list;
  - two calibration generators drop the summary block;
  - to review: a tenth data class, and previous forms for four secrets.
- **fix-clients:**
  - the console cookie has no prefix;
  - ConsentDigests.kt's comment;
  - the console's and the flow server's logs.
- **fix-records:**
  - force-ssl-redirect on the API host;
  - load-phase11.md:556's incremental-key-df wording;
  - the compose migrate service uses one role;
  - the HTTPRoute has no parentRefs value;
  - custom-list.md's cap of 2,000;
  - government-id.md's compromised-list note.
- **Orchestrator:** CLAUDE.md's "secrets as *_FILE" for the compose app profile (KP11-87): corrected by the orchestrator at the close (below).

**Validation at the final tree** (integration-11e, alone; every step passes; times in seconds with the load):
- Install, then format 119.
- Typecheck 173. Lint: api 250, dashboard and contracts 224, the other 17 packages 369.
- Unit suites:
  - db 2,392;
  - watchlist 840 and e2e 155;
  - dashboard 7,235 at 95.62%;
  - the other 15 packages. The first call failed in docs-tools at load 40: the API route collector met its 50 s guard. It was fixed test-first by committing the route table, not retried, and the step passed again.
  - js 19;
  - API 10,963 in 868 files at 93.42%.
- benchmark 133.
- Integration 110 + 13 + 456.
- Vision 2,722 at 97.45%; security/python 196.
- Android gate, eleven calls:
  - SDK host tests 532 + 427 + 1,773 = 2,732 with --rerun, none skipped;
  - screenshots 97; demo 97 and 9; nfc 116; face 51;
  - release checks 98;
  - cyclonedxBom 188, 195 and 190 components;
  - every Gradle lock wait 0.003-0.004 s.
- openapi and workflow docs: no diff. Added: docs:all with git diff, no diff.
- e2e:
  - mocked 349;
  - the first stack start was stopped by the Next.js notice; restarted in 110 s;
  - shards 50, 52, 47 and 49, all passing (296, 362, 289, 428 s);
  - sweep 109; stackTest 3 of 3.
- Images rebuilt: api 3f3a7a90, dashboard 8f90c62f, flow 73cfae47, flow-noguidance 301b70ea, code-runner 96ad9d9e, vision f1ab18a3.
- Infra: 34 scripts plus 3 chart contracts, 2,999 checks (13 skipped).
- load/ 242; `--verify-ids` pass.
- supply-chain.sh: all eight steps pass, no new advisory. chart-checks: all four pass.
- `pnpm release:check`: 0 errors, 80 owner items.
- gitleaks: 7,910 commits, no leaks. PII filter: 0 kept (1,205 tree, 1,641 history).
- Stub check: the anchored grep, draftsRemaining and missingFromTree all empty. The literal grep matches four files that quote the marker in prose; amended in Stage 3 amendment 7.
- Skipped by the rules: the clean-build pass, WebKit, the benchmarks, kind, ZAP, the device suites.

**Carried forward:**
- C88's deferrals (phase-6.plan.md), each with its reason
- C110's deferrals (phase-7.plan.md), each with its reason
- C145's deferrals (phase-8.plan.md), each with its reason
- C223's deferrals (phase-10.plan.md), each with its reason
- C286's deferrals and the address key's per-country handling are placed by PLAN's "Next release: Phase 11 deferrals (C286)".

**Device proofs:** none open from 11E. The Phase 10 close's "Unproved on a device or an emulator" lines stay open (checklist DEVICE-PROOFS).

**Still open for the release (release:check's owner items):**
- the version strings (0.0.0 against 0.1.0) and the undated android/CHANGELOG.md, both for the tag;
- docs/release/staged-run.json, after release.yml's first staged run;
- docs/release/verified-findings.md, 11F's verifier's to write.

**How the run went (orchestrator).**
- `wf_ccff33db-acb` (2026-11-20, 5.6 h): 8 of 8 agents, 0 errors; 122 commits `247f6af3c..778dfd414` on base `aa00b57bb`. claude-opus-5-5 for the agents and the orchestrator; about $207 at API list prices.
- `validate-full.sh` on `778dfd414`, with four rows added for 11E (`docs-render`: docs:all then `git diff --exit-code docs`; `release-check`; `verify-ids`; `docs-drafts`, no "Draft: written in Workflow 11E" line left), each rc 0. Every row rc 0 but two.
  - `test` (2,522 s, every package at once): API `src/watchlists/rekey-batch.test.ts` "leaves every derived column identical for each candidate size" met the shared 60 s guard again (the file 168 s; 24 s alone, 4 of 4), the only failure: **KP11-67**, met twice now under load and never alone. Not patched or retried (rule 6); it stays 11F's. API 10,962 of 10,963; every other package passed, dashboard 622 of 622 files (KP11-66 not met).
  - `stack-test`: the dashboard's `next build` was stopped by Next.js 16.4.2's security notice, as after 11D; `:openverify-sdk:stackTest` did not run. Nothing was upgraded; the notice stays with 11G's dependency review under KP11-42. The e2e row (2,116 s) and the dashboard image built without the stop; android/ is unchanged in 11E, and integration-11e's Validation ran stackTest 3 of 3.
  - Evidence: `docs/tdd/phase11-orchestrator.tdd.md`.
- A stray, untracked `checks.ts` stub left at the repository root by an agent was moved out of the tree; nothing referenced it.
- CLAUDE.md names 11E's commands (`org:create`, `db:grant-runtime`, `api-keys:pepper-status`, `user:allow-password`, `watchlists:rebuild-key-df`, the load stack and its takes, `--verify-ids`, the docs-tools renders, `pnpm release:check`) and now says the compose app profile passes secrets as environment variables from `.env`, with each process also reading a secret's `<NAME>_FILE` form, which the Helm chart uses (KP11-87).

## 2026-11-20: Phase 11, Workflow 11D done (performance: the load harness, the matcher's write cost, C78.7 and the re-screen at base and head, database tuning, two calibrations, review and fixes)

**Status: done locally; CI pending.** The owner has no Actions minutes, so nothing is proved by CI (rule 25). Nothing was dispatched or re-run; the orchestrator pushes once, after its own validate-full. The 11C push's run 43843705201 started no step in any of its 19 jobs, so no CI failure was passed in. Nothing under android/ changed in d44e537db..baf7e3229: no device suite ran and no device proof is open.
- Range: start 69fd529c0, base d44e537db, checkpoint baf7e3229.
- Ten agents: contracts-11d, load-harness and matcher-write-11d done; matcher-c787-11d, calibration-load-11d and calibration-matcher-11d partial (each with its rows reported as not measured or invalid, below); the two reviewers and the verify pass returned (1 HIGH, 2 MEDIUM, 2 LOW; P001 blocking); fix-11d done.

**Outcome.**
- The HTTP load harness (load/: vegeta 12.13.0 and the httpx driver; Locust not adopted while Q12 is pending) measured the stack on the compose app profile (project openverify-load).
- The matcher's write cost and C78.7 were measured at base d44e537db and head with this calibration's seed eab27c87.
- Three reports are published and amended by fix-11d, each with a schema-checked summary block: docs/calibration/load-phase11.md (amendments 1-11), watchlist-phase11.md (amendments 1-9) and lists-phase11.md (findings 1-2 actioned).
- Plan sections: "Workflow 11D Stage 1a amendments (contracts-11d)", "Stage 2 and 3 amendments" and "Workflow 11D review amendments" (items 1-14).

**Verdicts (each with its gap).**
- C269.1 API reads at 100/s: missed. 390.0 ms against 150, gap +240.0.
- API writes: met. 130.9 ms, gap -169.1.
- Flow upload at 10/s: not measured (knee 5/s).
- Console login: met. 61.0 ms, gap -439.0. The two-step sign-in is reported at 131.6 ms.
- Verification, government ID: invalid. The knee is 1 session/s over 150 s, but a sustained take at it saturated (median 72.65 s). The selfie and document rows were not measured.
- Webhook first attempt: invalid. 6,037 of 15,000 events missing, and the lag bound broke.
- Screening at 2,000,000 names: met at concurrency 1 (14,592/h against at least 10,000, gap +4,592); not measured at concurrency 4.
- Connect redemption: not measured. Account export: invalid.
- Fairness (C269.2), retaken after P001: missed at the default cap (victim p95 2,926.0 ms against idle 110.0 ms, ratio 26.6 against at most 2, gap +24.6); not measured at "ceiling 200" (one valid of five, every attempt 33-61 times idle).
- Soak: invalid (the driver saturated). Limiter refusal: the API row is reported (5.44 ms); the login row is invalid on one lag (refused from the 51st and the 11th).
- C272: jit off not recommended (reads 3.93 times worse); the runtime role's statement_timeout 370 s and idle_in_transaction_session_timeout 60 s; the pool is 10 connections per process. All three are for the guide.
- C93.2 network lookup: met (0.0064 ms). City Lite verify: not measured (DB-IP answers 403).
- Workflow 7B rows: reported (lists-match 28.7 ms, graph-queries 322.6 ms, transactions-search 470.8 ms). transactions-write was not measured; lists-import is invalid.
- R007 dense graph: p95 11.3/16.5/23.8 ms at 2/4/6 hops over 75/125/175 accounts (rings of 50).
- C271, the matcher:
  - identity identical (70,500 quality pairs; 300/300 each scale, also at the fix-11d head);
  - C78.7 at 100,000 names: met (head 69.0 ms with retrieval-reach on, base 67.9, gap -31.0);
  - C78.7 at 2,000,000 names: missed (head 314.1 ms, base 323.8, gap +64.1);
  - the re-screen at 1,000 entries: met (48.4 s, gap -11.6);
  - small-sync total cost: missed at 100 entries (+2.5 s, inside the takes' spread), met at 300 (-1.1 s);
  - the gate: met (72.1 ms; 62.8 ms at the final head).
- The levers: retrieval-reach is kept and shipped on. rescreen-bound-memo is kept but stays off (no gain). stored-name-analysis and rescreen-prepared-index were not built.
- C270 at 2,000,000 names:
  - incremental-key-df: identical and 127.5 s against 272.9 s on a 1,000-entry change, so kept by rule 5, but shipped off because the gate's 100,000-name import ran past its hook with it on;
  - REKEY_BATCH: 10,000 (2,149.7 s against 2,270.5 s);
  - the GIN options: the clean every 50 batches is taken (500.3 s against 518.4 s); C269.4 met in every configuration (status quo 1.53 times idle).
- Lists: fuzzy-name cap 5,000 (calibrated). Face-list threshold 0.72 (calibrated; FNIR 25.3%). The background thresholds are not calibrated.

**Review findings fixed (fix-11d).**
- P001 (HIGH): fairness.
- P002: missing webhook events.
- P003: discard rules 1 and 2 in run.py.
- Watchlist finding 1: dump-and-restore in place of the template copy. The backend's exit code 2 still struck 3 of 25 restores; each was run again before any timing.
- Verdict actions: retrieval-reach on; REKEY_BATCH 10,000; GIN_CLEAN_EVERY_BATCHES 50; incremental-key-df off by C271.4; list constants 5,000 and 0.72.
- Harness followups: verification's address, the login emails, the two-step unit, R007's rings.
- Small fixes: the build excludes the load seed; calibration:report gets --experimental-transform-types; the vegeta ledger row is held by a test.
- CI wiring: load/'s gate in the vision job, install-vegeta --offline-only in supply-chain, load-compose --static-only in infra (ci-workflow.test.sh 527).
- Met in the Validation: a picomatch allowlist entry (GHSA-fc5q-39xc-vjpf, no fixed release, devDependencies only, expires 2027-01-31); the PII scan skips the gitignored results trees.

**Validation at the final tree** (fix-11d, alone; numbers per step).
- Install and format: pass.
- Forced typecheck (151 s) and lint in three calls: pass.
- Unit suites:
  - db 2,392; watchlist 840; e2e 155;
  - dashboard 7,235 in 622 files at 95.62%;
  - the 13 other packages pass; js 19;
  - API 10,963 in 868 files at 93.42%. The first merge failed on match.test.ts pinning the old cap; it was fixed and shard 3 re-run.
- benchmark:typecheck and benchmark:test: 133.
- Integration: db 110, graph 13, api 121 + 139 + 196 = 456.
- Vision: 904 + 827 + 957 = 2,688 at 97.45%. security/python: 196.
- Android gate, eleven calls:
  - SDK host tests 532 + 427 + 1,773 = 2,732 (--rerun), none skipped;
  - demo 106; nfc 116; face 51;
  - release checks 98 tests;
  - cyclonedxBom 188/195/190 components;
  - every Gradle lock wait 0.008-0.011 s.
- Clean-build pass, WebKit, kind and device suites: skipped by the rules.
- openapi and workflow docs: no diff.
- e2e:
  - mocked 349;
  - the first stack start was stopped by Next.js's own security notice (no upgrade made; restarted in 101 s);
  - chromium shards 50, 52, 47, and **48 + 1 failed in shard 4** (ui-reviewer.spec.ts:202: sign-in 503 login_unavailable when the login limiter's Valkey store timed out, load 2.60->2.81; the class of KP11-33, 11F's; not retried);
  - console sweep 109; stackTest 3 of 3.
- Images rebuilt: api sha256:2188842f, dashboard f09edfe9, flow bc423198, flow-noguidance bced8a72, code-runner cf69719c, vision a6fd601f.
- Infra: 34 scripts and the chart's 3 contracts, 2,998 checks, 13 skipped.
- Benchmarks, reported:
  - workflow benchmark: effectful 10/45/40 and control-flow 85/196/200 steps/s at 1/8/32 clients;
  - **KP11-7** analytics:benchmark: --teardown; --seed in 4 calls (20 batches); --measure (build of 365 days 437.7 s, 5-minute refresh 1.9 s, after-midnight refresh 34.1 s, reads 8-59 ms over 90 days and 17-508 ms over 400 days, load 1.75->1.99); --teardown.
- load/'s gate: 242 at 96.62%.
- supply-chain.sh: osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii and allowlist all pass after the two fixes above.
- chart-checks lint, unittest, kubeconform and trivy: pass.
- gitleaks: 7,785 commits, no leaks. PII filter: 0 kept over the tree (1,205) and history (1,641).

**For the release checklist and the release notes (C271.4, C284.4).**
- Missed budgets:
  - C78.7 at 2,000,000 names, 314.1 ms against 250 (profile: state 6.5 / retrieval 45.7 / loads 57.7 / rest 184.9 ms; the remaining lever is stored-name-analysis);
  - small-sync total cost at 100 entries, +2.5 s;
  - fairness at the default cap, 26.6 times idle (the per-environment cap does not protect a victim on the shared queue);
  - api-reads at 100/s, 390.0 ms against 150 (one API process).
- Not measured or invalid: flow upload, Connect redemption, verification (all three rows), webhook, account export, transactions-write, lists-import, the soak, the login limiter, screening at concurrency 4, fairness at the ceiling.
- Other release-notes lines:
  - the face-list threshold 0.72 costs FNIR 25.3% (owner may revert, decision 3 after 7B);
  - the background-list thresholds are not calibrated (no licensed pair set);
  - incremental-key-df is off (a large sync is slower with it);
  - jit off not recommended; statement_timeout 370 s;
  - whether C78.7 is judged over several seeds stays an owner question.

**Q12:** pending; Locust not adopted.

**Known items.**
- KP11-7: done (Validation, above).
- Carried, not fixed:
  - to 11E: KP11-22, KP11-32, KP11-43 (and the guide's figures from the three reports);
  - to 11F: KP11-10, KP11-19, KP11-20, KP11-21, KP11-24, KP11-25, KP11-26, KP11-27, KP11-28, KP11-29, KP11-30, KP11-33 (met again: e2e shard 4, above), KP11-34, KP11-38, KP11-44, KP10-56, KP10-24, KP10-19, KP10-15, KP10-28, KP10-55, KP10-53, KP10-57, KP10-35 part 2, KP10-26, KP10-30, KP11-5, KP11-6, KP11-8; and from 11D: the lists-import completion member, lists-benchmark --measure's outputs, the soak's generator, the write stalls, the errored watchlist runs, the webhook delivery lag and Valkey timeouts under overload, incremental-key-df's large-sync cost, stored-name-analysis, rescreen-prepared-index, the benchmark containers' health-probe load, console-login's 34.7 s stall; and from the orchestrator's validate-full, KP11-66, KP11-67 and KP11-68 (below);
  - to 11G: KP11-42, plus the Next.js security notice for its dependency review;
  - recorded open until the android job's first measured run (KP10-59): KP10-51, KP11-4;
  - open by design: KP10-31.
- Owner and release gate: KP11-39, KP11-40, KP11-41, KP11-31 (Q10), KP11-9, E002, KP10-17, KP10-16, KP11-23, KP10-58, KP10-59, KP10-60, KP10-61; also City Lite's 403, the benchmark host's backend exits (exit code 2 under heavy writes), and the several-seeds question.

**Device proofs:** none open; android/ unchanged.

**Scratch left (outside git):** /tmp/fx*, /tmp/openverify-eval-11d/fx*, load/results/fix11d (gitignored). The hook refuses rm -rf, so remove them by hand.

**How the run went (orchestrator).**
- `wf_b2aa80e0-ad8` (2026-11-16 to 18, 53.5 h): 10 of 10 agents, 0 errors, 2,240 tool uses; 161 commits `69fd529c0..baf7e3229` on base `d44e537db`. claude-opus-5-5 for the agents and the orchestrator; about $988 at API list prices. The owner restarted the PC after fix-11d returned; the close resumed on 2026-11-20.
- `validate-full.sh` on `baf7e3229`, with load/'s gate added as its own row (fix-11d's CI wiring, install-vegeta and load-compose, already runs in the infra loop): every row rc 0 but two.
  - `test` (2,653 s, every package at once): two cases met the shared 60 s guard, each the only failure of its suite. Dashboard `role-form.test.tsx` "shows the API's refusal, such as a name already taken" (67 s; the file's other five cases took 17-58 s each; 12 s for the file alone, 6 of 6) is recorded as **KP11-66** (11F fix-clients, the class of KP11-25 and KP11-44). API `src/watchlists/rekey-batch.test.ts` "leaves every derived column identical for each candidate size" (C270.2, nine re-keys of 1,200 entries; 26 s for the file alone, 4 of 4) is recorded as **KP11-67** (11F, the same class). Their cause under load is not established, so neither was patched or retried (rule 6). API 10,962 of 10,963; dashboard 621 of 622 files.
  - `stack-test`: three starts of the reusable stack, and `:openverify-sdk:stackTest` ran in none. Twice the dashboard's `next build` was stopped by Next.js 16.4.2's own security notice, as in fix-11d's Validation; nothing was upgraded, and the notice goes to 11G's dependency review with KP11-42. Once `objectstore-init` exited 1 (healthy and exit 0 when started by hand straight after; cause not established: **KP11-68**, 11F). The e2e row and the dashboard image built without the stop. android/ is unchanged, and fix-11d's Validation ran stackTest 3 of 3 on this tree.
  - Evidence: `docs/tdd/phase11-orchestrator.tdd.md`.
- CLAUDE.md names load/'s gate and `seed:load`.

## 2026-11-16: Phase 11, Workflow 11C done (supply chain and deployment: five production images, digests and checksummed tools everywhere, the per-push supply-chain job, the SAST and PII baselines, SBOMs with a licence check, the Helm chart on kind, the web SDK packages, release.yml staging only)

**Status: done locally; CI pending.** The owner has no Actions minutes, so nothing is proved by CI (rule 27). The Validation ran on the final tree, and the phone ran the device suites.
- Range: start 2a83a93e7, base f544fbd2c, checkpoint 4758c01d5.
- Nine agents: contracts-11c, images-11c, scanners-11c, sast-pii-11c, chart-11c and chart-policy-11c done; sdk-web-11c done; sbom-release-11c done with a blocker (FFmpeg inside opencv-python-headless); integration-11c partial (the images-mode spec runs, Docker Desktop host networking).
- Two runs: the first stopped cleanly at 98% weekly usage after contracts-11c, and a continuation with per-agent notes finished the other eight.

**Built**
- Images:
  - five production images, openverify/{api,dashboard,flow,vision,code-runner}:<tag>, plus flow:<tag>-noguidance;
  - multi-stage, uid/gid 10001, read-only root with a writable /tmp, bases by digest, OCI labels, no dev tooling;
  - 19 compiled API commands; the flow reads its API origin at start (/config.json); vision refuses models whose SHA-256 differs; secrets as files in every process;
  - the code runner's tcp: transport with its token;
  - the compose app profile on the images.
- Supply chain:
  - 12 checksummed, signature-checked installers;
  - infra/scripts/supply-chain.sh (osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist) behind an expiring allowlist;
  - eslint-plugin-security 4.2.0 in lint (ceiling 168, 42 and 5);
  - the PII-pattern scan with its checksum filter and the pre-commit hook;
  - SBOMs (Syft; the CycloneDX Gradle plugin for the three AARs) with security/check-sbom-licences.py;
  - release.yml (build, verify, stage, publish behind `release` and OPENVERIFY_PUBLISH; never run).
- Chart (deploy/helm/openverify/): restricted pods; default-deny network policies; one projected Secret per process as *_FILE; the migrate hook with db:grant-runtime; probes on /ready and the worker heartbeat; the pool check; models jobs and pvc; the runner as its own Deployment; chart-checks.sh; kind.sh.
- Web packages: publishable @openverify/js, @openverify/node (private packages vendored) and @openverify/react through a pack tool; apps/demo-web.
- integration-11c: the per-push supply-chain job; the e2e images mode (built; its spec runs blocked on this host); the Android tooling floors; the vision bumps; seven cross-area defects fixed test-first.

**Numbers at the close** (load 0.2 to 33.5; every Gradle lock wait 0 s):
- Unit:
  - API 10,886 in 858 files at 94.16% (8 blob shards, 168-215 s each, merge 43 s);
  - dashboard 7,235 at 95.65%; db 2,357 at 89.88%; watchlist 820; e2e 155; js 19;
  - contracts 4,905, checks 3,849, core 2,007, workflow-engine 2,042, flow 1,678, flow-spec 527, node 508, config 443, emrtd 338, signals 192, ui 58, react 55, demo-web 18.
- Integration 110, 13, and 123 + 129 + 193 = 445. Benchmark 119.
- Vision 2,688 at 97.45% (three parts: 149, 182, 315 s). security/python 196 at 97.08%.
- Android:
  - (1) 532 + 427 + 1,773 = 2,732, none skipped; 97 screenshots; demo 97 and 9; nfc 116; face 51; 98 release-check tests;
  - staging and the consumer check passed; cyclonedxBom 188, 195 and 190 components;
  - the 9b clean-build pass from a second empty Gradle home green.
- e2e: mocked 349 (136 s); stack up 115 s; shards 50, 52, 47 and 49 (297, 367, 304, 409 s); sweep 109 (326 s); stackTest 3 (71 s); WebKit theme-csp 7.
- Images (warm cache): api 604 MB 157 s, dashboard 388 MB 127 s, flow 349 MB 35 s, flow-noguidance 330 MB 33 s, vision 707 MB, code-runner 380 MB 40 s.
- Infra: 32 scripts plus the chart's 3 contracts, 2,842 checks, 12 skipped (filled installers).
- supply-chain.sh steps: osv 3 s (22 findings, 5 allowlisted, 0 failing); pnpm-audit 32 s (840 signatures); pip-audit 2 s; zizmor 1 s; trivy-config 4 s; chart 18 s; pii 5 s; allowlist 1 s.
  - OSV, the npm registry and PyPI were queried live on 2026-11-16 around 06:21Z.
  - Trivy config uses the checks bundle 2.3.0 by digest and no vulnerability database.
- Chart: lint on Helm 4.3.1 and 3.22.1; 196 unit tests per Helm; kubeconform 1.35.9, 1.36.5 and 1.37.1; Trivy config clean.
- kind:
  - 1.35: create 37, load 50, fixtures 79, models 9, install 28, smoke 15, upgrade 47, delete 3 s;
  - 1.37: 44, 48, 90, 2, 28, 16, 47, 4 s;
  - each smoke: 37 of 37 migrations, /ready 200, a sandbox inquiry; each upgrade to revision 2 with the no-guidance flow, 7 of 7 pods.
- gitleaks: no leaks. PII: 0 kept of 1,204 (tree) and 1,640 (history).
- Device suites on the Pixel 9 (Android 17): SDK 14, demo 2, nfc 2, face 4, 22 of 22 from the XML (KP10-31 on Gradle's exit).
- Workflow benchmark (reported): effectful 17, 46 and 48 steps/s at 1, 8 and 32 clients; control-flow 91, 207 and 206.
- CI estimates (not measured on a runner):
  - supply-chain: 134 s of run steps emulated locally, 4 to 7 minutes with setup, timeout 20;
  - lint peak RSS 4.17 GB (api) and 3.65 GB (contracts) with the plugin, under the 4 GB heap;
  - release.yml 35 to 45 minutes.
  - The baseline is Phase 10's fix-records table.
- SBOM counts (sbom-release-11c): images api 288, dashboard 152, flow 93, flow-noguidance 92, vision 134, code-runner 103; AARs 188, 196, 191; npm 1 each; source:pnpm 860, source:vision 61.
- Owner items in the licence report: nodemailer MIT-0 (image:api, pending-owner).
- Allowlist: 5 entries for android/consumer-check's own tooling, expiring 2027-02-12.

**Open, with owners**
- Images-mode spec runs: 11A and 11B's six specs; 7A's signals, handoff and ip-address-report; 9's flow-embed, ui-preview, flow-bundle and ui-client-address; 8's workflow-code. They need Docker Desktop's host networking on (the owner's setting) or a Linux Docker engine.
- Vision image licence: FFmpeg 8.1.1, libquadmath and libgfortran inside opencv-python-headless (owner decision; release.yml's verify fails on it).
- release.yml's image scan gate fails today on the Debian base findings and Node 22.22.1 in every image. pypdf is now fixed. 11G's release preparation moves the bases and Node within rule 3, or adds reviewed entries.
- Recorded open (KP10-59): the supply-chain job's measured time, release.yml's first staged run and android-release.yml's first run. KP10-51 and KP11-4 wait for the android job's first measured run.
- Carried:
  - to 11D: KP11-7;
  - to 11E: KP11-22, KP11-32, plus the HSTS and body-limit guide for other ingress controllers, the HTTPRoute parentRefs example, clamd, the models pvc layout, face-scan:benchmark's warning and the version strings;
  - to 11F: KP11-10, KP11-19, KP11-20, KP11-21, KP11-24, KP11-25, KP11-26, KP11-27, KP11-28, KP11-29, KP11-30, KP11-33, KP11-34, KP10-56, KP10-24, KP10-19, KP10-15, KP10-28, KP10-55, KP10-53, KP10-57, KP10-35 part 2, KP10-26, KP10-30, KP11-5, KP11-6, KP11-8;
  - open by design: KP10-31;
  - owner and release gate: KP11-31 (Q10), KP11-9, E002, KP10-17, KP10-16, KP11-23, KP10-58, KP10-59, KP10-60, KP10-61.
- Owner items with their 11C state:
  - Q1-Q4: nothing published, signed or attested; publish never runs.
  - Q5: uv 0.13.3 left as is (11G).
  - Q6: no weights in an image; the models Job or a claim.
  - Q9: no CodeQL.
  - Q10: OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED false everywhere.
  - Q11: nodemailer reported as owner and image:api labelled pending-owner.
  - Q7, Q8 and Q12: unchanged.
  - Phase 10 P2: Eigen passes only in its named artifacts; the no-guidance flow is built and smoked (C289).
  - P4: Maven Central pending.
  - New: zizmor's online audits need a read-only token (owner question).
- Device proofs: none open (22 of 22 ran on the phone).

**How the run went (orchestrator).**
- `wf_317a8c5f-3ee` (2026-11-14, 7.6 h): contracts-11c done; the seven Stage 2 agents were stopped cleanly at 98% weekly usage (git lock held, nothing cut in half). Their uncommitted work stayed in the tree and was saved beside a per-agent note (commits, owned files, last words).
- `wf_314e144d-01b` (2026-11-15 to 16, 13.3 h): the continuation copy embedded contracts-11c's report and ran the other eight, 8 of 8, 0 errors. 235 commits `2a83a93e7..4758c01d5` on base `f544fbd2c`. claude-opus-5-5 for the agents and the orchestrator; about $580 at API list prices for the two runs.
- `validate-full.sh` after the Workflow, on `4758c01d5`, with 11C's rows added (the five images and the no-guidance flow in place of `openverify/apps:dev`, images.test.sh per subcommand and the chart's contracts, security/python, `supply-chain.sh` per step, kind install and upgrade on 1.35 and 1.37, the PII filter over history): 41 of 42 rows rc 0. `test` failed once: `packages/sdk-react/scripts/pack-real.test.ts`'s contracts build hook passed the shared 60 s guard while every package tested at once (alone, the file takes 27 s). The orchestrator gave its six build hooks a named 240 s bound, as the API's heavy hooks have (`docs/tdd/phase11-orchestrator.tdd.md`), and re-ran the row in the same form (`7cbb6bc16`): react 55 of 55, every other package green but one flow case, `screen-catalogue.test.tsx` "collects every kind into one submission", which met its 60 s guard (2.3 s alone; it passed in the first run on the same flow code). Its cause under load is not established: it is recorded as KP11-44 and carried to 11F (fix-clients, with KP11-25), not patched or retried. So every package's suite passed on this tree at least once in the all-at-once form.
- CLAUDE.md names 11C's commands (Stage 3 amendment 10) and the `app` profile's images and compiled seed.

## 2026-11-14: Phase 11, Workflow 11B done (platform hardening: session limits, the Valkey login limiter, pepper rotation, OIDC sign-in, data-store TLS and the two database roles, /ready and the worker heartbeat, per-environment queue caps, the linear-time pattern rule, the per-account access export, conditional list syncs, HSTS and the verified console CSP)

Status: done locally; CI pending. The owner has no Actions minutes; nothing is proved by a CI run (rule 25).

**What was built**
- **Sessions and sign-in:**
  - C245: idle and absolute session limits and the session-ending events;
  - C246: the shared Valkey login limiter, failing closed for login and the step-up;
  - C247: pepper rotation with api-keys:pepper-status, and the scope bound;
  - C248: OIDC sign-in with PKCE, state, nonce, a callback per provider, linking by subject, tenant pins, just-in-time provisioning (off by default), enforcement and user:allow-password.
- **Platform:**
  - C249: TLS settings with production warnings, `_FILE` secrets, the migration role with db:grant-runtime, the migrate lock (exit 75), and the SECURITY DEFINER functions with delete guards;
  - C250: /ready, the worker heartbeat with worker-health, OPENVERIFY_INTERNAL_LISTEN, the drain, org:create, and the metrics and configuration registries.
- **Queues:** C251, the queue_slots admission, the fair sweep and the recovery. Five queues are capped; workflow-step is clamped.
- **Ingestion and patterns:**
  - C252: the pattern rule;
  - C253: the per-account access export;
  - C254: conditional list syncs with the forced full check, and the UN opt-in, built locked;
  - the parser-backed transaction PDF page count.
- **Headers:** C255.1 HSTS, off at 0.
- **One migration:** 0036_phase11_hardening.

**Known items**
- Fixed: KP11-11, KP11-12, KP11-13, KP11-14, KP11-16, KP11-17, KP11-18, KP10-27, KP10-54, K7C-R008, K7C-R009.
- KP11-15: already done (e3ddd8a5c).
- KP11-10: part built; the rest carried to 11F.

**Carried forward**
- 11C: KP10-51, KP10-52, KP11-4.
- 11D: KP11-7. 11B added migration 0036 but did not change the rollup SQL; analytics:benchmark still needs --teardown and --seed before --measure.
- 11E: KP11-22, plus the 11B documents (the self-hosting guide, monitoring.md, the threat model, the ASVS rows).
- 11F: KP11-19, KP11-20, KP11-21, KP11-24, KP11-25, KP10-56, KP10-24, KP10-19, KP10-15, KP10-28, KP10-55, KP10-53, KP10-57, KP10-35 part 2, KP10-26, KP10-30, KP11-5, KP11-6, KP11-8. Also:
  - KP11-10's remainder: 49 id families, three name parameters, and the dashboard and flow operations;
  - C248.6's amr display;
  - C253.4's deletion in the C16 steps that are not a redaction cascade;
  - the ten capped queues without admission;
  - the conditional list's double fetch.
- Open by design: KP10-31.
- The owner's and the release gate's: KP10-16, KP10-17, KP10-58, KP10-59, KP10-60, KP10-61, E002, KP11-9, KP11-23.
- Q10 is pending. OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED stays false everywhere, and its three unlock hooks are wired only after the owner confirms.

**Device proofs:** none opened by 11B. Android was unchanged, so nobody used the phone.

**What 11C needs:**
- /ready and the worker-health exec probe (`node dist/worker-health.js`, `OPENVERIFY_WORKER_HEARTBEAT_FILE`);
- OPENVERIFY_INTERNAL_LISTEN;
- the two database roles, with db:grant-runtime run after every db:migrate and OPENVERIFY_MIGRATION_DATABASE_URL;
- OPENVERIFY_HSTS_MAX_AGE;
- apps/api/src/config-registry.ts and apps/api/src/metrics-registry.ts.

**How the run went (orchestrator).**
- One run, `wf_d6c359af-036`, claude-opus-5-5 (agents and orchestrator), 437 commits `9e1cb5e9e..7b8caa732` on base `cdff9dac8`. The owner's PC froze at about 14:06 EST on 2026-11-13 and restarted, killing seven running agents (foundation-11b and the six Stage 2 agents) mid-work; contracts-11b had finished. The orchestrator saved the two agents' uncommitted work as a patch, removed the dead Testcontainers, wrote each interrupted agent a note (its commits, where it stopped, which uncommitted files were its own) and resumed the run: contracts-11b replayed from cache and no committed step was redone. The resumed run: 9 of 9 agents with no error, 14.9 h, 2,273 tool calls, 3.76 M subagent tokens.
- From 11B on, an agent that runs alone gates an intermediate checkpoint on the affected scope and runs the full gate at its last (owner decision, 2026-11-12); contracts-11b's four checkpoints took about 4.5 h, against about 9 h for 11A's five.
- sso-oidc, quotas and integration-11b reported "partial"; integration-11b wired the worker's quota passes (quotas' blocker) and carried the amr display (sso-oidc's) and KP11-10's remainder to 11F by name.
- `validate-full.sh` after the Workflow, on `7b8caa732`: 26 of 26 rows rc 0. No row was added.

## 2026-11-13: Phase 11, Workflow 11A done (Connect: connections with a console activation and step-up, versioned share policies, share tokens with peek and asynchronous redemption into clones and hydrates with provenance, consent records on both sides, the share_consent step on the web and the Android SDK, the Connect console pages, three workflow actions and three triggers)

Status: done locally; CI pending. Ten agents, 242 commits, cf23603cf..346194bb5 (base 4db86122d). No CI run is counted on: the owner has no Actions minutes.

- **What 11A built:**
  - Migration 0035_phase11_connect.
  - Connections (C231), share tokens and the peek (C232, C233), redemption with clone, hydrate and fill-inquiry (C234), provenance and the cloned-results rule (C235), consent records with attest, decline and withdrawal (C236, C237), the share_consent step (C238), events on both sides (C239), the one cross-tenant module and the generic 404 (C240), redaction and retention (C241), the console under /settings/connect (C242), the actions create_share_token, redeem_share_token and expire_share_token (C243).
  - Connect is off unless OPENVERIFY_CONNECT_ENABLED is set and the organisation turns on connect-inbound.
- **Proved locally** (every step exit 0; times with load in docs/tdd/phase11-integration-11a.tdd.md):

  | Step | Result |
  |---|---|
  | format:check | 0 |
  | forced typecheck | 0 |
  | forced lint in 3 calls | 0 |
  | API unit | 10,117 tests in 766 files, 94.28% lines (8 blob shards and a merge) |
  | dashboard | 6,985 at 95.66% |
  | db | 2,272 at 89.86% |
  | watchlist | 820 |
  | e2e unit | 144 |
  | core | 2,007 |
  | contracts | 4,771 |
  | checks | 3,849 |
  | workflow-engine | 1,996 |
  | flow | 1,625 |
  | node | 504 |
  | flow-spec | 511 |
  | emrtd | 338 |
  | config | 308 |
  | signals | 192 |
  | ui | 58 |
  | js | 19 |
  | watchlist benchmark | typecheck and 119 tests |
  | integration | db 87, graph 13, api 103, 115 and 178 (396) |
  | vision | 2,639 at 97.41% |
  | Android gate | 11 calls (SDK host 2,732 = ui 532, flow 427, rest 1,773; 97 screenshot tests over 217 goldens; demo 97 and 9; openverify-nfc 116; openverify-face 51; 98 release-check tests) |
  | clean-build pass | one new empty Gradle home, 2.9 GB, no 429, no lockfile or metadata change |
  | openapi:write, workflow-docs:write | no diff |
  | mocked flow suite | 349 |
  | chromium shards | 49, 48, 49, 47 (293, 326, 301, 385 s) |
  | console sweep | 108 |
  | stackTest | 3 classes (10A, 10C, 11A) |
  | WebKit theme-csp | 7 |
  | images | 3 built |
  | infra tests | 11 scripts, 1,267 checks (ci-workflow 411, 0 skipped) |
  | gitleaks | no leaks |
- **Workflow benchmark (reported, not gated):** effectful 16, 49 and 48 steps/s; control-flow 91, 212 and 208 steps/s (at 1, 8 and 32 clients).
- **PGlite migration (foundation-11a's measure):** cold 5,985 and 6,520 ms before 0035, 5,447 and 5,632 ms after; warm about 1.2 to 1.3 s.
- **The phone:** Pixel 9, Android 17. Device suites 22 of 22 (openverify-sdk 14, demo-app 2, openverify-nfc 2, openverify-face 4), twice, read from the instrumentation XML (Gradle's exit is KP10-31). 11A added no device test.
- **The 11A spec:** e2e/tests/connect.spec.ts in 21 s, driven by the API and @openverify/node with the console in Chromium. The client-side redemption ran through the Android SDK's FlowApiClient in stackTest (AndroidConnectFlowStackTest, about 15 s).
- **Known items:**
  - KP11-1 fixed (contracts-11a).
  - KP11-2 fixed (clients-connect).
  - KP11-3 fixed (integration-11a: floor 2,732, from 2,691 + 5 + 36).
- **Deferred:**
  - 11B: KP10-54 (api-redeem deletes a rolled-back copy's objects), KP10-27.
  - 11C: KP10-51, KP10-52, KP11-4.
  - 11D: KP11-7 (analytics:benchmark --measure needs --teardown and --seed first: 11A added migration 0035 and the rollup predicates).
  - 11F: KP10-56, KP10-24, KP10-19, KP10-15, KP10-28, KP10-55, KP10-53, KP10-57, KP10-35 part 2, KP10-26, KP10-30, KP11-5, KP11-6, KP11-8.
  - Open by design: KP10-31.
  - Owner and the release gate: KP10-16 (now with 23 share strings), KP10-17, KP10-58, KP10-59, KP10-60, KP10-61, E002, KP11-9.
- **Carried out of 11A** (Stage 4 amendment 10):
  - 11B:
    - the probe's other 55 families and the dashboard and flow routes;
    - Connect buckets in GET /rate-limits;
    - consent_records in SUBJECT_PII_TABLES;
    - the token lock in the redaction hook;
    - a sweep for pending tokens;
    - connect-redeem under C251's cap.
  - 11E: the sharing guide's limits.
  - 11F:
    - the waiting position (C238.4) and C235.8's skip;
    - verification and check provenance and cloned;
    - hydrated fields on accounts and transactions;
    - relied-on-cloned;
    - earlier policy versions;
    - the sample flag;
    - the client view's label members;
    - source-decided-at;
    - the core name-list cross-checks;
    - clonedInquiryReview for fill-inquiry;
    - the clone's extraction gaps;
    - ShareTokenAuditAction.
  - Owner: Q7 (counsel on the English share.consent texts).
- **Unproved on a device:** none new. Phase 10's open lines stand.
- **Acceptance of 11A, line by line:**
  - Met: the connection is created, activated in the console with a step-up, deactivated and reactivated (spec, second pass), with tokens expiring as C231.4 says (the api-connect suites and races).
  - Met: a token is refused without a covering consent and created with one (spec, workflow-connect, api-connect).
  - Met: peek shows only the policy's attributes in the envelope (spec, api-connect).
  - Met: clone and hydrate copy what the policy allows, never a face template, with provenance (api-redeem suites; spec).
  - Partly met: a cloned pass counts only under accept-cloned-results, and a cloned failure never declines (api-redeem, connect-logic; the H01 live run in stackTest). C235.8's skip end to end is carried.
  - Met: clones stage no verification.* event, and workflows and analytics count only what C235.4 counts.
  - Met: a copy cannot be re-shared (source_is_copy).
  - Met: a redemption copies nothing outside the stored categories (H04).
  - Met: consent texts are recorded by digest; attestation needs its scope; a decline stands; withdrawal expires a token (spec, api-consent).
  - Met: a sandbox key cannot change a connection (matrix).
  - Partly met: the probe answers 404, or the same validation 400, on the 75 server operations of the seeded families; the rest are carried to 11B.
  - Met: share-consent works on the web (mocked suite 349) and the Android SDK (host tests, goldens, stackTest), with no token in any URL.
  - Met: every race test passes in both orders, as do the matrix and the import boundary.
  - Met: the 11A spec passes on the shards.

**How the run went (orchestrator).**
- Two runs. The first (`wf_c931feae-144`, claude-fable-5-2, 2026-11-11) was stopped cleanly by the orchestrator after 56 minutes inside Stage 1a because the owner's weekly Fable allowance was nearly spent; it left ten commits and nothing broken. The continuation (`wf_221c6924-30d`, claude-opus-5-5, agents and orchestrator) gave contracts-11a a note and ran all ten agents: 10 of 10 with no error, 27.6 h, 3,196 tool calls, 6.69 M subagent tokens.
- Stage 1a (contracts-11a alone, five checkpoints each re-running every suite) took about nine hours. From 11B on, an agent that runs alone gates an intermediate checkpoint on the affected scope and runs the full gate at its last (owner decision, 2026-11-12).
- api-redeem, workflow-connect and integration-11a reported "partial"; integration-11a settled every blocker of the first two (the cross-tenant entry points, the worker's redeem wiring, the workflow-run creator) and carried three deliverables by name (above).
- `validate-full.sh` after the Workflow, on `346194bb5`: 26 of 26 rows rc 0 (install to gitleaks; e2e 1,827 s, test 1,892 s). No row was added: the third stackTest class and the Connect spec run inside the existing rows.

## 2026-11-11: Phase 10 done (the Android SDK, its two optional artifacts and the demo; done locally, CI pending)

**Status: done locally; CI pending.** Decision 72's bar ("done means CI-green": the final push's `android` and `android-instrumented` jobs and one green release matrix) waits on GitHub Actions minutes. No run after 42937477615 (the 10C push) ran a step, and nothing in Phase 10's close rests on a CI run or an emulator.

### What Phase 10 built

- **10A, the renderer:** the server-position driver (the SDK renders what the server's position names and never chooses a path), the public API with its install registry and seams, the screen catalogue, themes on Material 3, five languages with right to left, operator copy and consent digests.
- **10B, capture and device integrity:** the frame pipeline beside preview and capture, document and selfie guidance held to the web's vectors, the "barcode found" hint, "more time" on a selfie; emulator, root and hooking indicators as beta signals that are never decisive alone; the `IntegrityTokenProvider` seam with the server's sandbox provider.
- **10C, NFC, shipping and the demo:** the `nfc` step behind the `ChipReader` seam with the sandbox test chip and the `client-unable` route; consumer R8 rules, 16 KB and size checks, dependency locking and verification, the staged local Maven repository with its consumer check, the release workflow; the demo app; thirteen pages of `docs/android/`.
- **10D, accessibility, review and fixes:** the automated accessibility audit over every screen state (180 states of 20 screens, 205 goldens), the review of all of Phase 10 with every HIGH and MEDIUM finding fixed, and the first runs on the owner's Pixel 9.
- **10E, the owner-gated artifacts:** `openverify-nfc` with the JMRTD chip reader (P1) and `openverify-face` with YuNet through ONNX Runtime (P2), four measured size configurations with caps, and the release check that the licence texts travel in the AARs. No Play Integrity artifact (P3 declined); nothing published (P4 pending).

### Unproved on a device or an emulator

- device proof open: `OrtTelemetryDeviceTest` (both methods) and `YunetInferenceDeviceTest` (both methods): on an emulator (x86_64); passed on a Pixel 9 only.
- device proof open: `ChipReaderDeviceTest` (both methods): on an emulator or a phone with NFC off or absent: the `nfc_disabled` branch.
- device proof open: the reader against a real passport or identity-card chip in `ReaderCheckActivity` (BAC, PACE, Chip Authentication, Active Authentication): the owner's step. PACE and Chip Authentication run in no automated test.
- device proof open: the R8-minified `sdk,nfc` build reading a chip, and the minified `sdk,face` build running a selfie step: the consumer rules at run time (shown from R8's outputs only).
- device proof open: the demo on a phone through a capture step, a selfie step with the detector and an `nfc` step with the sandbox chip.
- device proof open: `CaptureScreenLayoutDeviceTest` (both), `MinifiedSmokeTest` (both), `NfcPlatformDeviceTest` (both) and `NfcTapLifecycleDeviceTest`'s off-or-absent branch: on an emulator or a phone with NFC off.
- device proof open: `IntegrityProbesDeviceTest.theProbesAnswerWithinTheBoundAndTheDeviceReportsWhatItIs` with `openverifyDeviceKind=emulator`, and `CameraXFramePipelineTest`'s 1,280 px side on the CI emulator.
- device proof open: every connected task on a serial without a colon: that Gradle's exit follows the tests (KP10-31, open by design).
- device proof open: the release matrix's API 26, API 34 and 16 KB API 35 legs: never dispatched.

### The release gate (Phase 11's acceptance; no agent closes one)

- **KP10-17 (owner):** the manual TalkBack, font-scale and keyboard pass, rows A1 to A14; the statement says "not yet evaluated for conformance" for Android.
- **KP10-16 (owner):** the fluent review of the machine-drafted es, fr, de and ar texts. 10E added no SDK string; `openverify_finalizing_title` and `openverify_finalizing_message` left the list.
- **KP10-58 (owner step):** the real-document chip read (decision 48, C209.6), in the demo's reader check: a debug build with `-PopenverifyDemoArtifacts=sdk,nfc`, pass or fail per document type and protocol only.
- **KP10-60 (owner, P4):** Maven Central: the namespace, the Portal account and token, the GPG key, the `maven-central` environment. Until then the staged repository is the release.
- **KP10-59 (CI pending):** Actions minutes, and with them the release matrix on the final push (C220.3; P5 declined, the standard runner only), every emulator proof above, the new modules' device tests on `android-instrumented`, and decision 72.
- **KP10-61 (owner):** the Google Play Data safety categories, and the sandbox chip's 1 MiB selfie limit.
- **Owner decisions newly asked:** review E002 (whether the detector's numbers on the public-domain portrait `person_a_id` may stay in `contracts/fixtures/flow/yunet-face-frame-vectors.json`); the vision image's `onnxruntime` wheel, which carries Eigen under P2 through Phase 4 decision 11; whether to move the ONNX Runtime pin to 1.31.1.
- **Deferred to Phase 11:** KP10-51 to KP10-57, KP10-35 part 2, KP10-24, KP10-26, KP10-19, KP10-27, KP10-28, KP10-30, KP10-15; EF.CardSecurity after PACE; an SDK host test over the YuNet face-frame vectors; `analytics:benchmark --measure`. KP10-31 stays open by design.

### CLAUDE.md

The orchestrator applied integration-10e's lines in `b75c61020`: rule 4's two recorded owner exceptions (P1, P2), `openverify-face` in the Layout table, and the two fetches its build needs.

## 2026-11-11: Phase 10, Workflow 10E done (the owner-gated artifacts); done locally, CI pending

Run on base `b826da9b5` (start `0e5a5ec68`); 65 commits to `49645478e`, none pushed by an agent. Parts built: `face-onnx` and `nfc-reader`. Four agents (contracts-10e, face-onnx, nfc-reader, integration-10e) and two reviewers.

### The parts

- **`openverify-nfc` (P1):** `OpenVerifyNfc.chipReader(context)` on JMRTD 0.8.9. PACE where EF.CardAccess offers it, else BAC; Chip Authentication where offered; COM, SOD, DG1, DG15, DG2; Active Authentication over the server's nonce. 116 host tests, 97.9% of lines.
  - **Proof:** orchestrator tests over a scripted chip, and JMRTD's real service on the JVM against an in-process synthetic Utopia chip (BAC, secure messaging, the reads, Active Authentication; `contracts/fixtures/emrtd/utopia-chip.json`).
  - **Not proved:** PACE and Chip Authentication run in no automated test; EF.CardSecurity is not read; no real document has been read.
  - Six consumer rules, proved on the minified demo. The licence texts travel in the AAR. A debug-only reader check in the demo.
- **`openverify-face` (P2):** `OpenVerifyFace.detectorFactory(context)`, YuNet through `onnxruntime-android` 1.31.0. 51 host tests, 97.1% of lines, no Kover exclusion. The model is checked by SHA-256 before every session.
  - **Inference:** within 0.0005 px and 0.000001 of the server runtime's numbers on a public-domain fixture frame, on the host and on a Pixel 9.
  - **Telemetry, the measured window only:** on a Pixel 9 (Android 17, awake, unlocked, on charge, commit `d6af3cc37`) the app's counters read 0 bytes received and 0 sent over a 124.4 s window, twice, with a 30 s control of 0 bytes; no telemetry class was loaded and no file appeared.
  - **ORT spike:** not measured (no Android NDK on the build host). The official AAR ships.
- **Not built:** `openverify-integrity-play` (P3 declined); `scuba-fork` (P1 granted).
- **Sizes, measured with bundletool 1.18.3 (download / install, arm64-v8a):** `sdk` 3.38 / 7.07 MB; `sdk,nfc` 4.90 / 10.89 MB; `sdk,face` 16.61 / 41.80 MB; `sdk,nfc,face` 18.14 / 45.62 MB. The other three ABIs are in `android/size-baseline.json` and `docs/android/sizes.md`. Absolute caps per configuration: 5 and 9 MiB; 6 and 14; 23 and 58; 25 and 63. ONNX Runtime's libraries pass the three static 16 KB checks.
- **Counts:** SDK host 2,691 (ui 522, flow 416, rest 1,753); demo 97 and 9 in each of four configurations; 95 screenshot tests over 205 goldens; `A11yCatalog` 180 states of 20 screens (K10A-1 removed `Finalizing`); 98 release-check tests; `ci-workflow.test.sh` 409 checks, 0 skipped.

### Review

Two read-only reviewers: 5 findings, CRITICAL 0, HIGH 0, MEDIUM 3, LOW 2. Four fixed test-first; none refuted.
- **E001:** a release check that the licence papers are in the staged AARs.
- **E004:** an unusable optional chip file is read as absent, so BAC still opens the chip.
- **E003:** the logger scan no longer returns silently.
- **E005:** the reader-mode pause race.
- **E002, carried to the owner:** the detector's numbers on a public-domain portrait in git.

Integration also fixed a defect its clean-build pass found: a screenshot golden compared before its review photo was drawn on a loaded machine; one 10D golden had been recorded without its photo and was re-recorded.

### Known items

Fixed: K10A-1, KP10-41, KP10-42, KP10-44, KP10-45, KP10-47, KP10-49 (contracts-10e); KP10-43 (nfc-reader); KP10-46, KP10-48, KP10-50 (integration-10e). Deferred as listed in the phase close.

### Validation (integration-10e; every step exit 0)

- Install and `format:check`; forced typecheck (154 s); forced lint in three calls (207, 223, 326 s).
- Unit: the three calls and `@openverify/js`; dashboard 6,761 at 95.59%; API in eight shards and a merge, 9,677 tests in 726 files at 94.41%.
- `benchmark:typecheck` and `benchmark:test`; integration db 83, graph 13, api 99 + 103 + 107.
- Vision: 2,639 tests at 97.41% (1,358 + 1,281, split after file 58 of 108).
- The Android gate, eleven calls, lock wait 0 s; no call neared 10 minutes.
- **The clean-build pass (9b):** from an empty Gradle home the gate line's six tasks took 1,519 s with the downloads (10D: 779 s). After the golden's fix, Maven Central answered 429 to two further empty homes, so the counting run was made from clean in the first cold home with its build cache removed. Every step of `ci.yml`'s android job and every device-less, secret-less step of `android-release.yml`'s gate exited 0.
- OpenAPI and workflow docs unchanged.
- e2e: 332 mocked; 192 on four shards (48, 48, 49, 47; 330, 452, 373, 393 s); the sweep's 104; `stackTest` 2 of 2; WebKit `theme-csp` 7 of 7 through Docker.
- Three docker builds; `infra/tests` 1,260 checks in 11 scripts; gitleaks over 6,701 commits, no leaks.
- The workflow benchmark was reported; `analytics:benchmark --measure` was not run.

### On the phone (a Pixel 9, Android 17; results from the instrumentation's XML; Gradle's exit failed each time, KP10-31)

- At `d6af3cc37`: SDK 14 of 14, demo 2 of 2 on its minified build, `openverify-nfc` 2 of 2 (NFC on, no chip present), `openverify-face` 4 of 4. `check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4`: 22 passed.
- One flow of the demo's `sdk,nfc,face` debug build against the local stack through `adb reverse`: the 10A flow to completion (`status: completed`). No selfie or `nfc` step.

### CI

- No run is counted on; nobody dispatched, re-ran or pushed. Run 43018061783 on the base started no step.
- Both workflows are written as if they ran and held by the contract: the YuNet and fixture-face fetches; floors of 2,691, 97 and 9, 116 and 51; the new modules' device tests with their minimums; three merged-manifest steps; four size configurations in the release gate.
- **Estimate:** a push stays at about 225 to 240 billed minutes plus what the new steps add (the modules' host tests inside the gate line, two more manifest steps of about 1.5 minutes each, the modules' device tests with the telemetry test's 5 minutes). The android job's first Gradle step alone took 25.3 minutes locally from an empty home, against a timeout of 60: read its whole time on the first run and split it above 45.

### Owner items

- **P1:** granted; built and accepted on the host. The real-document read is open.
- **P2:** granted; built and accepted. It settles Phase 4 decision 11: the flow serves `EIGEN-SOURCE.txt`; the vision wheel's Eigen is tabled and named for the owner.
- **P3:** declined. No Google code; the host recipe stands.
- **P4:** pending. Nothing uploaded; the staged repository is the release; `dev.openverify` is provisional.
- **P5:** declined. The standard runner only; the matrix was not dispatched.

### Acceptance of 10E (per part)

- `openverify-face` runs YuNet through ONNX Runtime over a public-domain fixture frame within the vectors' tolerance, with no telemetry provider and no bytes counted over C205.2's window: **done on a phone** (the 10E decisions put the phone in the emulator's place); the emulator run is **CI pending**. "No extra permission": `ACCESS_NETWORK_STATE` arrives from ONNX Runtime's manifest unless the host removes it, as the Stage 1a amendment records and the docs say.
- The JMRTD reader passes its orchestrator tests and the JVM test of the real JMRTD service against the synthetic chip: **done**. Its device test: **done for the adapter-on branch** on the phone; the no-adapter branch is **CI pending**. The owner's real-document result: **owner step**, open.
- The Play Integrity client: **declined** (P3), with its stated outcome in the README and here.
- The first Central deployment: **open** (P4 pending).
- Owner-gated acceptance line (C205, C209, C211.6, C217.5): each part is built and accepted, declined with its outcome stated, or recorded open with its decision pending: **done**.
- Process: every validation command passes locally: **done**. On GitHub, with the device jobs and the release matrix: **CI pending** (decision 72).

**How the run went (orchestrator).**
- 11.5 h, 6 of 6 agents with no error, 716 tool calls, 2.48 M subagent tokens, all on **claude-fable-5-2** (agents and orchestrator). Run `wf_211d2ce6-10e`.
- face-onnx and nfc-reader each reported "partial" on tests in files they could not edit; integration-10e settled all of them.
- `validate-full.sh` after the Workflow, on `b75c61020`: 26 of 26 rows passed. It gained a fixture-fetch row, openverify-face's release AAR, the floors 2,691, 97 and 9, 116 and 51, and the `sdk,face` and `sdk,nfc,face` manifest calls.
- The 10D push's CI run (43018061783) started no step (the account's spending limit); it cost nothing and proves nothing.

## 2026-11-11: Phase 10, Workflow 10D done (accessibility, review, fixes)

**Status: done locally; CI pending.** The owner has no GitHub Actions minutes left (2026-11-10), so no run of this push is counted on and nothing below rests on one. Decision 72's "done means CI-green" waits on Actions minutes. Device-only behaviour is proved by host tests and, where the phone could run it, by the instrumentation's own output from one Pixel 9; the rest is listed under "Unproved on a device or an emulator".

**Outcome.** Workflow 10D audits the Android SDK's accessibility on the host, reviews all of Phase 10, fixes what the review and the carried items found, and validates the whole tree locally, including one clean pass of the CI android job's steps from a cold Gradle home.

- **Model:** claude-fable-5-2.
- **The accessibility audit (C212, android-a11y-audit):**
  - 181 states of 20 screens held as code; 205 goldens (113 new); Google's Accessibility Test Framework on every golden: 0 errors, 118 warnings left for a person;
  - the SDK's own rules over every state on the host: names, touch targets, heading first, status nodes, cut-off text in five languages and a pseudo-locale at font scale 2.0, focusable controls, announcements counted as live-region changes;
  - 4 defects found and fixed test-first: the capture screen did not scroll (text cut off and Cancel unreachable at font scale 2.0); the heading was not read first on 46 states; "Saving your consent" was not announced; texts drawn outside the one text composable in 22 files;
  - the hardware keyboard's Tab order cannot be tested on the host; it is a manual row;
  - the statement says "not yet evaluated for conformance" for Android. The manual pass (14 rows, A1 to A14) is not run.
- **Review:** four lenses and one verifier (12 findings after deduplication: 0 CRITICAL, 2 HIGH, 4 MEDIUM, 6 LOW; privacy, security and law: 1 HIGH; correctness and honesty: 1 HIGH, 1 LOW; build, licences, performance and CI: 3 MEDIUM, 3 LOW; accessibility and UX: 1 MEDIUM, 2 LOW; the verifier confirmed both HIGH findings and refuted or downgraded none). No CRITICAL or HIGH finding was skipped and no MEDIUM was dropped.
- **Fixed (fix-sdk, fix-server, fix-records):**
  - KP10-32 (HIGH): the demo's minified smoke test starts and passes, with keep rules traced at build time for the 153 library classes the test shares with the app, on the smoke build only;
  - A001 (HIGH): the server asks a session for an integrity token only when its consent showed `notice.play-integrity`; A002 (HIGH): Arabic-Indic and Persian digits become ASCII in typed fields;
  - A010 (an expired wallet message has its own button), KP10-38 (NFC activity and device tests), K10A-2 (values in sentences are bidi-isolated), KP10-35 part 1 (the barcode guide shows only on a frame that can carry a read), KP10-36, KP10-37, KP10-29, KP10-25, K10A-3;
  - KP10-39 pinned (a chip file kind uploaded again replaces the earlier one), KP10-40 (the sandbox chip signs through `@openverify/emrtd/testing`);
  - KP10-33 (the infra job installs gitleaks before the workflow contract; records corrected), A006 (a device run is held to 14 and 2 tests), A005 (floors 2,677 and 81 + 8), A004 (the android job's timeout is 60 minutes).
- **Carried:** K10A-1 (LOW; needs `android/` and `docs/` in one change: Workflow 10E's first agent); the six LOW review findings A003, A007, A008, A009, A011 and A012 (not fixed in 10D; listed in the 10E decisions); KP10-31 (open by design: the Android Gradle plugin 9.4.1 ends a connected task as failed on a serial with a colon); KP10-35 part 2; the selfie time warning over the heading (audit gap K7); KP10-24, KP10-26, KP10-19, KP10-27, KP10-28, KP10-30, KP10-15 (Phase 11, as decided before 10D).
- **Validation (validation-10d, alone and last, on `83b39eca5`; every step passed; evidence `docs/tdd/phase10-validation-10d.tdd.md`):**
  - format, forced typecheck (122 s) and forced lint in three calls (178, 196, 288 s);
  - unit tests: 34,962 in 17 packages, each at or above 80%; the API 9,677 in 726 files at 94.41% (eight shards and a merge); the dashboard 6,761 at 95.59%;
  - integration: db 83, graph 13, api 309; vision: 2,635 tests at 97.41%;
  - Android: 2,677 SDK host tests, none skipped (the floor is 2,677); the demo's 81 and 8; 95 screenshot tests over 205 goldens; `koverVerify`, `checkKotlinAbi`, lint, the 16 KB, consumer-rules and size checks, the staged repository and the consumer check;
  - **KP10-34:** the CI android job's steps, and the release workflow's gate steps that need no device and no secret, once, in order, after `clean`, from a new empty Gradle home: every step exit 0, and no step read what no earlier step built. The gate line took 779 s as six calls and the second step 171 s; the consumer check's lockfiles and verification metadata resolve cold. Proved locally, never by CI;
  - OpenAPI and workflow docs unchanged by their write commands;
  - e2e: the mocked flow suite 332; on one fresh stack 192 chromium tests in four shards (263, 332, 284, 376 s), the console sweep's 104 (284 s) and `stackTest` 2 of 2; 27.1 minutes for the stack, the shards and the sweep; WebKit's `theme-csp` 7 of 7 through Docker, as local evidence;
  - images (apps, vision, code-runner); 11 infra tests (1,230 checks; `ci-workflow.test.sh` 379 with 0 skipped); the workflow benchmark, reported; gitleaks over 6,630 commits, no leaks.
- **On the phone (a Pixel 9, Android 17), read from the instrumentation's own output:** the SDK's device suite 14 of 14 in seven classes; the demo's minified smoke test 2 of 2; `check-connected-results.sh . openverify-sdk=14 demo-app=2` passes. Gradle exits failed on both tasks with no failing test (KP10-31). The demo's debug build walked the 10A flow against the local stack through `adb reverse` (consent, the database form, a screen, the completion); the inquiry ended `completed`. That flow has no camera or NFC step.
- **CI minutes:** none spent. The last run read is 42937477615 (the 10C push). fix-records' table: no job is inside the last 25% of its timeout by a measured time, so none is split; the android job has no whole measured time since 10B and its timeout is 60 minutes. A push is estimated at 225 to 240 billed minutes.
- **The release matrix (C220.3):** not dispatched. P5 is declined, so it runs on the standard runner. It waits on Actions minutes: recorded open, not attempted.
- **Commits:** base `c60d51b9`; the fixers ended at `83b39eca5`; validation-10d's records are `cefe36f91`, `f922f77a1`, `dc406a604` and `fa1d79e79`; before the Workflow the orchestrator's `6c2ffc9af` and `19430fe88` (both Android workflows build openverify-nfc's release AAR before the consumer-rules check: the one real failure of CI run 42937477615) and the 10D decisions `27a65be91`; after it `ced4603e9` (CLAUDE.md, KP10-33 part 5); then this entry.
- **Records:** the plan's "## Workflow 10D Stage 1 amendments (android-a11y-audit)" and "## Workflow 10D review amendments" with "### Validation as run (validation-10d)". Evidence: `docs/tdd/phase10-{android-a11y-audit,fix-sdk,fix-server,fix-records,validation-10d}.tdd.md`.

### Unproved on a device or an emulator

- **Proved on the phone in 10D (a Pixel 9 only):** the SDK's 14 device tests and `MinifiedSmokeTest`'s 2, at `83b39eca5`, from the XML (`tests="14" failures="0" errors="0" skipped="0"` across seven suites; `tests="2" failures="0" errors="0" skipped="0"`); the demo's debug build through the 10A flow. KP10-21 and KP10-22 hold on the phone.
- **Open, needs an emulator:** `CaptureScreenLayoutDeviceTest` (both methods); `MinifiedSmokeTest` (both); `IntegrityProbesDeviceTest` with `openverifyDeviceKind=emulator` (C210.6's emulator half and the 500 ms bound there); `CameraXFramePipelineTest`'s 1,280 px barcode side on the CI emulator (KP10-21's emulator half, with the requirement's decision); that an emulator runs all 14 and 2 tests for `check-connected-results.sh`; the release matrix's API 26 and 34 legs and its 16 KB API 35 leg.
- **Open, needs an emulator or a phone with NFC off:** `NfcPlatformDeviceTest` (both methods) and `NfcTapLifecycleDeviceTest`'s branch for a device whose NFC is off or absent.
- **Open, needs a serial without a colon (an emulator or USB):** that Gradle's exit follows the tests on both connected tasks (KP10-31).
- **Open, needs the phone:** the demo through a capture step and an nfc step with the sandbox test chip; the sandbox `match` chip with a real phone's selfie.
- **Open, needs a person:** the manual TalkBack, font-scale and keyboard pass (KP10-17, rows A1 to A14); the owner's real-document NFC read in the demo's reader-check mode (it needs 10E's reader).
- **Known items:** KP10-32, KP10-33, KP10-34, KP10-36, KP10-37, KP10-38, KP10-39, KP10-40, KP10-29, KP10-25, K10A-2 and K10A-3 done; KP10-35 part 1 done and part 2 carried; KP10-31 open by design; K10A-1 open.

### Open for the release gate (Phase 11's acceptance)

- The manual accessibility pass by a person; the statement stays "not yet evaluated for conformance" for Android until then.
- The owner's real-document NFC read (decision 48).
- The release matrix, and the `android` and `android-instrumented` jobs of the final push, when Actions minutes exist.
- Machine-drafted strings for the owner's review, one more: `openverify_crypto_new_message` (KP10-16).
- Phase 10 owner items as decided before 10A: P1 and P2 granted narrowly (10E's); P3 declined; P4 pending; P5 declined.

**How the run went (orchestrator).**
- 7.6 h, 10 of 10 agents with no error, 731 tool calls, 2.68 M subagent tokens, all on **claude-fable-5-2** (agents and orchestrator). Run `wf_6de68795-279`.
- The first launch (`wf_3bebe354-974`) stopped after 8.6 minutes: android-a11y-audit's session was logged out. It left two commits and uncommitted edits in 23 SDK files. After the owner logged in again the Workflow was started again with a continuation note; the audit agent kept that work and finished.
- Before the Workflow the orchestrator read CI run 42937477615 (the 10C push): `android` failed at the consumer-rules check because no CI step built openverify-nfc's release AAR (the local tree had a stale one); fixed test-first in `6c2ffc9af` and `19430fe88`. `unit-api-coverage` never started (the account's spending limit).
- `validate-full.sh` after the Workflow, on `ced4603e9`: 25 of 25 rows passed. Its android row now starts with `clean`, its `android-10a` row builds openverify-nfc's release AAR, and its floors are 2,677, 81 and 8.


## 2026-11-10: Phase 10, Workflow 10C done (NFC in the SDK, shipping and the demo)

**Status: done locally; CI pending.** The owner has no GitHub Actions minutes left (2026-11-10), so no run of this push is counted on and nothing below rests on one. Decision 72's "done means CI-green" waits on Actions minutes. Device-only behaviour is proved by host tests, RED then GREEN, with each device test kept unweakened and listed under "Unproved on a device".

**Outcome.** Workflow 10C (`wf_61f1925b-25e`) gives the Android SDK its NFC step, makes the SDK shippable, and builds the demo, the Android docs and the cross-cutting privacy checks.

- **Model:** claude-fable-5-2 (Workflows 10A and 10B ran on claude-opus-5-5).
- **NFC (family N):**
  - on the server: the `client-unable` route and the sandbox test chip route, the nfc client view's `fallbackAvailable`, `sandboxChipAvailable` and `prefillMrz`, the publish acknowledgement `client-unable:<step id>` and the warning `nfc_fallback_missing`, and the command `trust:sandbox-utopia` (migration 0034);
  - in the SDK: MRZ or CAN entry, the chip challenge requested only on "I'm ready", the tap with progress by file, retries (at most 9 challenges, 300 s each), the DG1 review before any upload, upload and submit, the per-reason "cannot read document chips" screens and the client-unable report, with five reasons since Stage 3 (`read_failed` at the challenge cap);
  - exercised end to end with the sandbox test chip only: openverify-nfc ships no reader until Workflow 10E (P1);
  - the web flow's nfc screen offers "use another way" in five locales;
  - the console labels a verification read from a sandbox test chip "Test chip (sandbox)".
- **Shipping (family D):**
  - consumer R8 rules (two `-keepnames` lines), proven on the minified demo's R8 outputs and on a consumer of the staged AAR, not by running the minified app;
  - the 16 KB checks (16 native libraries in the minified demo, all aligned), the size check against `android/size-baseline.json` at 10%;
  - a staged Maven repository (`dev.openverify`, provisional) with a consumer check that has its own lockfile and verification metadata;
  - `android-release.yml` with gate, devices and publish jobs, which uploads nothing without the owner's keys and has never been dispatched.
- **The demo app:** language, appearance and sandbox-outcome pickers, an event log, the App Links example, merged-manifest allowlists for `sdk` and `sdk,nfc`, and the `minifiedSmoke` build with its smoke device test and host twins.
- **Docs:** `docs/android/privacy.md` (a 49-row wire-member table held by a test), `nfc.md`, `release-and-support.md`, `sizes.md`, `android/CHANGELOG.md`, the SDK README, `docs/checks/nfc.md`.
- **Privacy checks:** `FLAG_SECURE` on every SDK window, protections on every field and control, saved-state and exception canaries, the final storage, intent, clipboard, log, manifest and network-trust lists, and the module boundary. No privacy defect was found in the SDK as built.
- **Commits:** base `f71b0f6d` (the 10B push); the 10C decisions `4e2a0c32`; the agents ended at `b8bde96c3`; the orchestrator's closing commits are `a04c3239e`, `801b06001`, `4fbd294fa` and the commit of this entry (the agents' 142 commits are `4e2a0c32..b8bde96c3`, 368 files changed; the orchestrator's closing commits follow).
- **Agents:** nine.
  - contracts-10c (Stage 1a, alone) and carry-10c (Stage 1a): done.
  - api-nfc, nfc-sdk, privacy-checks, release-checks, demo-app and docs-android (Stage 2): done, no blockers.
  - integration-10c (Stage 3, alone): **cut off by a usage limit** after 27 commits (`098ededb6..b8bde96c3`), inside Validation step 4 (the API unit shards). It returned no report and wrote neither its evidence file, the plan amendments nor a draft of this entry. The orchestrator finished its validation and assembled its evidence from its transcript, commits and logs.
- **Records:** the plan's "## Workflow 10C Stage 1a amendments (contracts-10c)" (items 1 to 25); "Stage 2 amendments" and "Stage 3 amendments (integration-10c)" written by the orchestrator at the close from the reports' contractDeviations.
  - Evidence: `docs/tdd/phase10-{contracts-10c,carry-10c,api-nfc,nfc-sdk,privacy-checks,release-checks,demo-app,docs-android,integration-10c}.tdd.md` (nine files; the last assembled by the orchestrator).
  - Inventory: `docs/research/phase10-inventory.md` §10.

**Settled in Stage 3** (integration-10c, before the cut-off; RED before GREEN where a RED commit is named):
- **The built NFC routes document no 501**, and both document C52.1's 422; the OpenAPI snapshot is regenerated (`098ededb6`, `0a33b1f17`).
- **A fifth client-unable reason, `read_failed`**, for a read that was tried and did not finish; the SDK reports it at the challenge cap instead of `nfc_unavailable` (`dddd49852`, `0a33b1f17`, `5ceb214b0`, `5ed713c2d`).
- **The two host CPU budgets hold under load.** carry-10c's `ContextDeviceProbeCostTest` and `BarcodeSideCostTest` failed in three agents' gates at load 10 to 44; they are now multiples of a reference workload measured beside them (`5b7989d10`).
- **Test inputs.** The host tests' declared inputs name every file the privacy scans and the docs tests read (`4b587331e`); the wire table test no longer tolerates an unbuilt NFC call (`847925eff`).
- **The e2e stack** reads the sandbox chip's other face from the generated fixture set; `.env.example` names `OPENVERIFY_SANDBOX_CHIP_FACES`, unset (`521e62182`, `60aa3fcb4`).
- **The 10C full-stack spec and stackTest.** `e2e/fixtures/android-10c/flow.json` with its builder; `e2e/tests/flow-nfc-android.spec.ts` (sandbox chip match, face-mismatch, and `nfc_unavailable` to the document fallback in needs_review); `AndroidNfcFlowStackTest` beside 10A's class (`fe78a7a8f`, `cb5e21764`, `72f1e66d1`, `d3cae87a8`). Run by integration-10c on a stack of its own: the spec 3 passed in 25.3 s (after two runs with 1 failed on the spec's own expectations, corrected), and the stack test 1 test in 16.9 s, filtered to its class. Their run inside the e2e gate is the orchestrator's (table below).
- **The console label** "Test chip (sandbox)" with its scenario and what it does not prove (`6c7df95e0`, `2659b646a`).
- **`androidx.activity` is an `api` dependency** of the SDK, held at scope compile in the staged POM (`c176eae8c`, `01464231e`).
- **`FakeFlowServer` walks an nfc step** as the engine does (`bf2fa64b7`, `19942f767`).
- **The size baseline** re-measured for `sdk` and `sdk,nfc`, and `docs/android/sizes.md` with it (`75367eda2`).
- **ci.yml's 10C steps**, written and held by `ci-workflow.test.sh`, no run claimed (`cdcea5e86`, `629c4d82b`).
- **PLAN §6** says what 10C built (`b8bde96c3`).

**Two defects found by Stage 2 in earlier work, fixed:**
- since `testBuildType = "minifiedSmoke"`, `:demo-app:testDebugUnitTest` did not exist and the gate ran none of the demo's tests (demo-app, `adcfeee4a`);
- R8 renamed kotlinx.serialization's exception classes, so `FlowApiException.InvalidResponse.causeClass` read `gj2` in a minified host (release-checks, `34acafe49`).

**Known items: 15** (from the 10C decisions).
- **KP10-21** (the barcode side's 640x480 analysis on the CI emulator): fixed on the host by carry-10c, RED `8059622a7`, GREEN `6b99c5790`. The SDK judges a barcode side by its first frame and only a barcode-bearing side asks 1,280 px. The analysis size is asked, not guaranteed (C201.2 amended). Proved on a Pixel 9 at the close (below); the CI emulator run is open. The unweakened device test will fail on the CI emulator by that camera's size list; the decision is the phone run: the requirement is not amended, and the emulator's profile is not changed before a run shows the cause.
- **KP10-22** (the probes' 520 ms on the CI emulator): fixed on the host by carry-10c, RED `f69dcec41`, GREEN `660aaa50d`: each read once per collection, no Regex (69.6 ms to about 24 ms of host CPU on a large synthetic process). Proved on a Pixel 9 at the close (below).
- **KP10-23** (one constant for 1,280 px): fixed by carry-10c, RED `b8943ffca`, GREEN `fbe9f2302`.
- **Deferred as decided:** KP10-24, KP10-25, KP10-26, KP10-29, KP10-18 and the optional KP10-19 (to 10D); KP10-27 and KP10-28 (Phase 11); KP10-30 (after KP10-21's device proof); KP10-15 (console); KP10-16 (the owner's fluent review, now with 75 SDK NFC strings and six web nfc keys per locale); KP10-17 (the manual TalkBack pass, a release gate).

**Validation.**
- integration-10c completed steps 1 to 4 short of the API merge, each exit 0: install, format:check 104 s, forced typecheck 137 s, forced lint 195 + 214 + 309 s, models, data, variant groups, bundletool, the three unit calls outside the API (375, 399 and 169 s) and @openverify/js; the eight API shards ran 136 to 179 s, each rc 1 with only the per-shard coverage-threshold errors in its output (the blob reporter prints no test results, so the shards alone do not show that the API tests passed; the merge never ran).
- The orchestrator's full local validation on the final tree:

| Row | Exit | Seconds |
|---|---|---|
| install | 0 | 0 |
| models | 0 | 1 |
| data | 0 | 0 |
| variant-groups | 0 | 8 |
| format | 0 | 122 |
| lint | 0 | 318 |
| typecheck | 0 | 138 |
| test | 0 | 2035 |
| benchmark-typecheck | 0 | 45 |
| benchmark-test | 0 | 11 |
| integration | 0 | 467 |
| vision | 0 | 573 |
| android | 0 | 596 |
| android-10a | 0 | 282 |
| android-10c | 0 | 76 |
| openapi | 0 | 21 |
| e2e | 0 | 1819 |
| stack-test | 0 | 154 |
| image | 0 | 285 |
| image-vision | 0 | 31 |
| image-code-runner | 0 | 88 |
| workflow-benchmark | 0 | 146 |
| benchmark | 0 | 61 |
| infra | 0 | 81 |
| gitleaks | 0 | 9 |

All 25 rows exit 0 at `b8bde96c3` (the `android` rows from a fresh Gradle home with verification on; `android-10c` is new: the bundletool fetch, the release checks' tests, the three static checks, both floors and the `sdk,nfc` manifest; `infra.log` holds no FAILED line). After the orchestrator's three closing commits: `ci-workflow.test.sh` 368 passed, every `infra/tests/*.test.sh` green, `format:check` green, and `:openverify-sdk:assembleAndroidDeviceTest lint` green from a second cold Gradle home (338 s).

**Numbers.**
- SDK host-test floor: **2,602** (ci.yml; 2,321 at the base). The demo's floor: **80 + 8**. The SDK floor is 2,321 + 40 (carry-10c) + 25 (contracts-10c) + 113 - 1 (nfc-sdk) + 90 (privacy-checks) + 12 (docs-android) + 2 (integration-10c), measured with `--rerun` as ui 476, flow 401, rest 1,725, none skipped.
- Stage 2 gates measured 2,600 SDK host tests (ui 476, flow 401, rest 1,723): contracts-10c +25, carry-10c +40, nfc-sdk +113 and -1, privacy-checks +90, docs-android +12.
- API unit suite 9,673 tests in 726 files at 94.41% (api-nfc's gate); API integration project 304; mocked flow suite 332; demo host tests 88; Python release-check tests 82; goldens 59 + 33.
- `ci-workflow.test.sh`: 341 checks at release-checks' close (266 at the base); 366 after integration-10c's ci.yml section.
- Size baseline (`android/size-baseline.json`, the demo with the SDK): `sdk` download / install in bytes: arm64-v8a 3,377,103 / 7,070,770; armeabi-v7a 3,289,560 / 6,554,682; x86 3,445,891 / 7,193,626; x86_64 3,420,392 / 7,173,158. `sdk,nfc` (without the reader): download 99 bytes higher on every ABI, install equal.
- Migration 0034 added (`chip_challenges.sandbox_scenario`); the next is 0035.
- New build-only dependencies: `com.vanniktech.maven.publish` 0.37.0, Dokka 2.2.0, bundletool 1.18.3 (fetched), `okhttp-tls` 5.4.0 (demo device tests); all Apache-2.0.
- New variable: `OPENVERIFY_SANDBOX_CHIP_FACES` (optional; set by the e2e stack only).

**CI.**
- The 10B push's run 42762952128 on `f71b0f6d` failed only in android-instrumented, on KP10-21 and KP10-22 (read by contracts-10c). It is the last run this project has.
- No run of the 10C push is counted on. ci.yml's 10C steps (the bundletool fetch, the release checks' tests, the minified release build, the 16 KB, consumer-rules and size checks, the `sdk,nfc` manifest, both floors, the minifiedSmoke smoke test on the emulator) are written and held by `ci-workflow.test.sh`; none has run.
- `android-release.yml` has never been dispatched.

**On a real phone, at the close (orchestrator).** The owner attached a Pixel 9 (Android 17, API 37, arm64-v8a, 4 KB pages) on 2026-11-10, reached from WSL by wireless adb. Evidence: `docs/tdd/phase10-integration-10c.tdd.md`, "Closed by the orchestrator".
- **The SDK's device tests: 9 of 9 pass** (`am instrument`: "OK (9 tests)").
  - **KP10-21 proved on a phone:** the barcode side's analysis came at 1280x960 beside a 4080x3072 still; a frame copy cost 0.56 ms and a full-resolution guide crop (3672x2315) 2.32 ms. The 1,280 px requirement stands unchanged. Its run on the CI emulator (a 320x640 display) is still open and waits on Actions minutes.
  - **KP10-22 proved on a phone:** the probes' cold run took 94.9 ms and 98.0 ms (bound 500 ms, target 50 ms; maps 43.7 ms, threads 7.1 ms, mounts 2.4 ms, each read once). The 50 ms target is not met on this phone and is still only reported.
  - **C210.6 on a phone:** the Pixel reports no emulator indicator. The device test asserted "the CI emulator reports itself" on every device; it now asserts per device kind (an emulator names an indicator, a phone names none), and the kind comes from the run: both emulator jobs pass `-Pandroid.testInstrumentationRunnerArguments.openverifyDeviceKind=emulator` (RED `a04c3239e` in `ci-workflow.test.sh`, GREEN `801b06001`). Told it was an emulator, the Pixel run failed on that assertion, as it must.
  - **Espresso 3.7.0** on the SDK's device-test classpath (`4fbd294fa`): with 3.5.0 every Compose device test failed at its first `onIdle` on Android 16 or later (`NoSuchMethodException: InputManager.getInstance`). Lockfile and verification metadata refreshed and checked from a cold Gradle home.
- **KP10-31 (new, to 10D):** on this phone `:openverify-sdk:connectedAndroidDeviceTest` exits failed ("There were failing tests") although its own report shows 9 tests, 0 failures, 100%, and the raw instrumentation ends "OK (9 tests)". Cause not found.
- **KP10-32 (new, HIGH, to 10D): the demo's minifiedSmoke device test cannot start.** `:demo-app:connectedMinifiedSmokeAndroidTest` ran 0 tests: the test runner, inside the minified app's process, died with `NoClassDefFoundError: androidx.tracing.Trace`; with that class kept, the next was `kotlin.LazyKt`. R8 removes from the app what the runner shares with it. CI's emulator step would fail the same way. C215.2's device proof is therefore not open but disproved, and the SDK's consumer rules stay proved only statically (from R8's outputs). No rule was committed: the fix is a design choice for 10D (keep rules for the runner's shared libraries on the smoke build only, or a self-contained test module that drives the minified app from outside).
- The demo's debug build is installed on the phone; it expects the API at the emulator's `10.0.2.2:3000`, so a flow on a real phone needs a reachable stack (10D).

**Unproved on a device.** No device ran anything during the Workflow itself (the host has no KVM); the section above says what the Pixel 9 then proved. Each line is as its agent wrote it, with its state after the phone run in brackets. No emulator has run any of it.
- carry-10c: device proof open: CameraXFramePipelineTest.theBarcodeSideIsReadAtLeast1280WideAndItsCopyIsMeasuredAgainstAFullResolutionCrop: that a camera listing a 4:3 size of 1,280 px inside its preview class gives it beside the still, that the SDK's barcodeRead is the frame's on a device, and both copy costs on a device (F11); on the CI emulator it fails at the 1,280 px assertion by the camera's size list [proved on the Pixel 9; the CI emulator run is open]
- carry-10c: device proof open: IntegrityProbesDeviceTest.theProbesAnswerWithinTheBoundAndTheCiEmulatorReportsItself: the 500 ms bound, the 50 ms target, each read's share of the time, and C210.6's emulator indicator, none proved on a device yet [proved on the Pixel 9, where the test is now `theProbesAnswerWithinTheBoundAndTheDeviceReportsWhatItIs`; the emulator half of C210.6 is open]
- nfc-sdk: device proof open: NfcPlatformTest (host twin over Robolectric; no device test class exists): that PackageManager.FEATURE_NFC and NfcAdapter.isEnabled report a real phone's NFC state without a permission, and that Settings.ACTION_NFC_SETTINGS opens the system's NFC settings from the application context
- nfc-sdk: device proof open: NfcStepScreenTest 'the reader is told when the tap screen is resumed and when it is left' (host twin): that leaving the app during a tap pauses the read and returning restarts it on a real activity lifecycle
- release-checks: device proof open: demo-app's minifiedSmoke smoke device test (:demo-app:connectedAndroidTest; demo-app names the class and method): that the R8-minified demo runs a flow with the SDK's consumer rules; here the rules are proven only from R8's outputs [disproved: KP10-32]
- release-checks: device proof open: android-release.yml devices leg API 35 google_apis_ps16k (:openverify-sdk:connectedAndroidDeviceTest, ZxingCppBarcodeReaderDeviceTest and CameraXFramePipelineTest): that the 16 KB-aligned native libraries load and run on a 16 KB device; the image may not boot on the standard runner (P5 declined), then it stays an open item of the release gate
- demo-app: device proof open: MinifiedSmokeTest.theMinifiedFlowLoadsItsSessionOverTlsThroughTheInstalledTransportAndReturnsItsResult: that the build R8 minified as release loads its session over TLS through the installed transport, decodes it, shows the consent step, delivers events and returns Canceled through the contract after a BACK key [did not run: KP10-32]
- demo-app: device proof open: MinifiedSmokeTest.plainHttpToLoopbackIsRefusedBeforeAnyRequest: that the non-debuggable minified build ends a plain-http loopback launch Failed(INVALID_REQUEST) with no request [did not run: KP10-32]
- integration-10c wrote no such line. Its ci.yml steps for the minified release build, the 16 KB, consumer-rules and size checks are static ("nothing is loaded or run on a device here"), and its minifiedSmoke step on the emulator is "written and held, no run claimed".
- From 10B, still with no passing device run: the two carried device tests above (both failed in run 42762952128 before carry-10c's host fixes; neither has run since). [both now pass on the Pixel 9; neither has run on an emulator since]
- Also unproved, with no device test: the sandbox `match` chip on a real phone (a selfie whose DG2 exceeds 1 MiB answers 422); the publish job of `android-release.yml`; the release device matrix; the owner's real-document chip read (10E).

**Owner items.** P1 and P2 granted narrowly, built in 10E. P3 and P5 declined. P4 pending: the release is the staged local repository; the `maven-central` environment, its four secrets, the real repository address in the POMs and the group `dev.openverify` are the owner's.

**Open items and who takes them.**
- **Closed by the orchestrator at this close:** the plan's Stage 2 and Stage 3 amendment sections and integration-10c's evidence file; the full local validation; the phone run above with its two fixes. KP10-21's requirement is decided: 1,280 px stands, proved on a phone; nothing about the CI emulator is changed before a run shows its cause.
- **To 10D (review and fixers):**
  - **KP10-32 (HIGH)** the minifiedSmoke device test cannot start, and **KP10-31** Gradle's failed exit on a passing phone run (both above); a flow on the real phone against a local stack;
  - **KP10-33:** `ci-workflow.test.sh`'s android-release section skips its secret scan when gitleaks is missing, and ci.yml's infra job runs that test (`ci.yml:315`) before it installs gitleaks (`:323-326`): reorder, or make the skip a failure there;
  - `trust:sandbox-utopia`, and that `testDebugUnitTest` also runs the demo's minifiedSmoke twins, in CLAUDE.md's command list; `@openverify/node` regenerated after `0a33b1f17`; the consumer check's lockfile from a fresh Gradle home after `01464231e`; `docs/android/nfc.md:64` ("fetched" faces; the code uses the generated set); the plan's Validation block gains `check-consumer-rules.py` and the `sdk,nfc` call;
  - hide the barcode guide on a frame that cannot carry a read, and give the document gates a 640 px copy on a barcode side (carry-10c);
  - `submitProtection()` on DocumentStep's three picker buttons and OtpStep's continue-after-limit (privacy-checks);
  - a fixed message at `model/WireEnums.kt:35`; `causeClass` as a fixed code (privacy-checks, release-checks);
  - one activity-level NFC test, and device test classes for the two NFC device proofs that have none (nfc-sdk);
  - whether the upload route replaces a chip kind uploaded twice (nfc-sdk);
  - a prehashed signer in `@openverify/emrtd/testing` in place of `signNonceDigest`'s arithmetic (api-nfc);
  - `docs/android/accessibility.md` (C212.3);
  - KP10-18, KP10-24, KP10-25, KP10-26, KP10-29, and the optional KP10-19.
- **To 10E:** the JMRTD reader and openverify-face; `DemoComponents.of` gains `chipReader` and `faceDetectorFactory`; the new modules in the privacy checks' module table; the commented nfc consumer rules; the NOTICE and README of openverify-nfc; the consumer check's lockfile after any SDK dependency change.
- **To Phase 11:** KP10-27, KP10-28; the manual TalkBack pass (KP10-17); the API 35 16 KB leg if its image cannot boot on the standard runner.
- **Owner:** the 1 MiB selfie limit of the sandbox chip before a real-device demo; P4; the fluent review of the machine-drafted texts (KP10-16); the Data safety categories in `docs/android/privacy.md`; Actions minutes for the emulator runs (the phone is there since this close).

**Carried forward:** KP10-15, KP10-16, KP10-17, KP10-18, KP10-19, KP10-24 to KP10-30, with the reasons of the 10C decisions; KP10-21 and KP10-22 are proved on a phone and wait only on an emulator run. New: KP10-31, KP10-32 (HIGH), KP10-33.

## 2026-11-10: Phase 10, Workflow 10B done (capture and device integrity, Android)

**Outcome.** Workflow 10B (`wf_73846d37-8f3`) builds the Android SDK's capture pipeline and device integrity.
- **Capture:**
  - the CameraX analysis pipeline, with its fallback to the manual shutter;
  - document guidance ported from the vision service and calibrated on 246 synthetic renders;
  - a zxing-cpp "barcode found" hint;
  - selfie guidance (the YuNet port and the machine, held to the web's vectors), active only with an installed detector, which nothing in 10B installs;
  - the "more time" extension;
  - `capture-method` and `capture-trigger` stored as client-reported (migration 0033).
- **Device integrity:**
  - 16 probe codes in 3 families feeding three beta, never-decisive signals;
  - the debugger facts in `bot_score` v3 and `automation_artefact_count` v2;
  - Play Integrity: the routes, a sandbox provider and a `play-integrity` provider (our REST code, a fake endpoint in tests), the decode job, the two A-tier signals, and the publish rules `signal_not_decisive_alone` and `play_integrity_notice_missing`;
  - decision 66's notices in five locales.
- **Commits:** base `7d985a77` (the 10A push); the 10B decisions `bf3a87e3`; 10B's 196 commits `e12c6e37..d02eb0d2`; then this entry. 469 files changed.
- **Agents:** nine, one call each, all returned, no error:
  - contracts-10b alone (Stage 1a), partial: decision 66's texts were left undone when its context ran out, and integration-10b built them;
  - foundation-10b (Stage 1b, done) beside capture-pipeline (done), document-guidance (done), pdf417-guidance, selfie-guidance, device-integrity-android and api-integrity (Stage 2);
    - the last four are partial only on hooks in shared files and on one shared 10A test, and integration-10b settled each, test-first;
  - integration-10b alone (Stage 3), done, with no blockers.
- **Records:** the plan's "## Workflow 10B Stage 1a amendments (contracts-10b)", "Stage 1b amendments", "Stage 2 amendments" (one subsection per agent) and "Stage 3 amendments (integration-10b)".
  - Inventory: `docs/research/phase10-inventory.md` §9.
  - Evidence: `docs/tdd/phase10-{contracts-10b,foundation-10b,capture-pipeline,document-guidance,pdf417-guidance,selfie-guidance,device-integrity-android,api-integrity,integration-10b}.tdd.md` (nine files).
  - New pages: `docs/android/capture.md`, `docs/android/device-integrity.md`, `docs/compliance/session-integrity.md` and `docs/calibration/android-document-guidance.md`.

**Settled in Stage 3** (integration-10b, RED before GREEN):
- **The shared 10A test that blocked six agents' Android gate.** `OpenVerifyInquiryActivityComponentsTest`'s "no signals call" failed because `collect` now reads off the main thread; the test now waits in steps that idle Robolectric's paused main looper.
- **Integrity requests now leave the device.** `FlowApiClient` sends the challenge and the token through `IntegrityRequests`.
- **Coordinator and launch hooks:**
  - the selfie window carries its thresholds;
  - `nativeCaptureMethods` decides the camera check and the sandbox upload;
  - each launch provides the selfie guidance;
  - a passport-only front shows the TD3 page frame.
- **Server hooks:**
  - the signal jobs read the bound `deviceIntegrity` provider;
  - publish and validate pass `deviceIntegrityBound`;
  - the integrity routes no longer return 501 (OpenAPI sha256 `407571a0…b0d4`).
- **Decision 66:**
  - `notice.play-integrity` is the 21st COPY_KEY;
  - the Android session-integrity wording names the probes;
  - the consent rows are appended under `web-a8a42feea15e8a73` and `android-0.1.0-6ed3979d273c180e`;
  - C200.4 is amended: the Android digests file holds the latest catalog version only.
- **Two integration defects:**
  - `infra/docker-compose.yml` passed neither the `deviceIntegrity` binding nor the Play Integrity settings;
  - the digest exporter mixed two catalog versions.
- **The full-stack spec.** `e2e/tests/device-integrity.spec.ts` has 2 tests. Binding the sandbox provider on the e2e stack makes every v2 flow there show `notice.play-integrity`.

**Known items: 17** (from the 10B decisions).
- **Fixed** (each test-first):
  - KP10-5 to KP10-12 by contracts-10b;
  - KP10-13 by foundation-10b;
  - KP10-14 by capture-pipeline;
  - KP10-20 by integration-10b (`69971d48`).
- **KP10-4 stays open until this push's CI.** That run must prove three things:
  - the android job, including the screenshot comparison on the runner;
  - android-instrumented, with the new `CameraXFramePipelineTest`, `ZxingCppBarcodeReaderDeviceTest` and `IntegrityProbesDeviceTest` beside 10A's `CameraXCaptureCameraTest`;
  - the probes' time against the 50 ms target and the barcode copy costs, from the log lines the emulator step now prints.
- **Deferred as decided:** KP10-15 (console), KP10-16 (the owner's fluent review, now with `notice.play-integrity` and the probe-naming text), KP10-17 (the manual TalkBack pass, a release gate), KP10-18 (to 10D) and KP10-19 (optional).

**Validation.**
- integration-10b, every step exit 0:
  - API 9,565 tests at 94.41%; dashboard 6,755; every package at 80% or more;
  - integration 81, 13, and 97/101/90; vision 2,624 at 97.41%;
  - Android: 2,321 SDK host tests, none skipped; 60 screenshot tests over 59 goldens; Kover 97.73%; all eight gate calls passed, and CI's Android calls passed from a fresh `GRADLE_USER_HOME`;
  - e2e: mocked suite 328; chromium shards 51/45/46/47; sweep 104; stackTest; WebKit theme-csp 7 of 7;
  - images, the 11 infra tests, and gitleaks (6,410 commits, no leaks).
- The orchestrator's `validate-full.sh` on `d02eb0d2`: all 24 rows green (install, models, data, variant groups, format, forced lint and typecheck, units 1,784 s, the benchmark checks, integration 399 s (db 81, api 301), vision 2,624 in 559 s, the Android gate 477 s from a fresh Gradle home, the 10A Android step 228 s (129 tasks executed), OpenAPI with no diff, e2e 293 passed in 27.2 min after the mocked flow suite's 328, `:openverify-sdk:stackTest`, the three images, the workflow and analytics benchmarks, the infra tests, gitleaks on 6,413 commits with no leaks).

**Numbers.**
- SDK host-test floor: **2,321** (CI).
- `ci-workflow.test.sh`: 266 checks.
- Migration 0033 added (`files.capture_trigger`); the next is 0034.
- New dependency: `io.github.zxing-cpp:android` 3.1.1 (Apache-2.0), with verification metadata written from a cold Gradle home.

**CI.**
- The 10A push's run 42603210118 was read with the 10B decisions.
- The push of this entry is 10B's CI proof: KP10-4's android and android-instrumented jobs, and the gitleaks "verifying the cached copy" line (KP10-2's cache).
- Its result is recorded with the 10C decisions.

**Carried forward:**
- To a later contracts agent:
  - a session member naming the barcode-bearing side;
  - one constant for the 1,280 px barcode analysis width;
  - `extendCapture` returning its outcome (then drop `SelfieExtensions`);
  - `client-elapsed-ms` past ten extensions.
- To the server:
  - a sweep for integrity tokens whose decode was never enqueued;
  - the coupled-outcome limit of `signal_not_decisive_alone` for a trigger verification on workflows.
- The PDF417 read becomes a gate once the emulator confirms the calibration.
- To 10D:
  - `StateHooksTest`'s device-integrity pin, replaced by a real `integrity.request` case;
  - K10A-1 to K10A-3 (KP10-18).
- The owner and release-gate items above (KP10-16, KP10-17).

**How the run went (orchestrator).**
- 16.3 h, 9 agents, 2,402 tool calls, all on **claude-opus-5-5** (agents and orchestrator).
- contracts-10b's context ran out before decision 66, and integration-10b built it.
- device-integrity-android's move of `collect` off the main thread broke a shared 10A test for the five Stage 2 agents that ran after it. Each reported it against its owner rather than as passed, and integration-10b fixed it first.

## 2026-11-09: Phase 10, Workflow 10A done (the Android renderer)

**Outcome.** Workflow 10A (`wf_a77cca0a-ee3`) builds the Android renderer of flow-spec 2: the SDK declares spec 2 and renders the server's position for every supported step type, the screen step, waits and halted flows; themes, appearance, five languages with right to left, and the public API frozen in an ABI dump.
- **Commits:** base `c60d51b9`; the 10A decisions `c7bc6f49`; 10A's 209 commits `0064fffb..45b44d6e`; then this entry. 478 files changed.
- **Agents:** eleven, one call each, all done, no error:
  - contracts-10a alone (Stage 1a: the inventory, spike (a), ADR 0009, then checkpoints common, P, R, L and S);
  - foundation-10a (Stage 1b: the gate split, spikes (b) and (c), plumbing) beside android-logic, android-i18n and api-android-10a (Stage 2);
  - android-driver, android-screens and android-theme (Stage 3), android-sdk-api after the driver;
  - carry-10a (the CI and carried Phase 9 known items, no Android path) beside Stages 1b to 3;
  - integration-10a alone (Stage 4).
- **Records:** the plan's "## Workflow 10A Stage 1a amendments (contracts-10a)", "Stage 1b amendments (foundation-10a)", "Stage 2 amendments", "Stage 3 amendments" and "Stage 4 amendments (integration-10a)"; ADR `docs/adr/0009-android-optional-artifacts-device-guidance-licence-boundary.md`; the inventory `docs/research/phase10-inventory.md`; evidence in `docs/tdd/phase10-*.tdd.md` (eleven files); `docs/android/` (six pages).

**Acceptance of 10A** (integration-10a, line by line), all **met**:
1. Spec 2 is declared and the server's position is rendered for every supported step type, the screen step with C148's catalogue, waits and halted (`FlowDriverTest`, `ServerPositionTest`, `StepRegistryTest`; the screen step in the app through `LocalScreenEnvironment`, `IntegrationHooksTest`).
2. No transition is evaluated on the device: `FlowNavigator` and `JsonLogic` are deleted (78 test invocations named).
3. The visibility, pattern and digit ports pass every exported vector (visibility 47 cases and 23 refusals; patterns 579 matches, 49 refusals, 8 pathological; digits 17).
4. Theme, appearance, logo, five locales, right to left, the selector, operator copy with legal keys failing closed, and consent digests matching the server's 83 vectors through the real consent screen. Two in-step unsupported screens end `Canceled`, not `Failed(UNSUPPORTED_FLOW)`: carried to 10B.
5. The public API and seams, and nothing else, are in the ABI dump (`AbiDumpTest` against `api/expected-public.txt`; `checkKotlinAbi` on both modules).
6. The migrated coordinator suites pass over `FakeFlowServer` (assertion changes in the Stage 3 amendments).
7. Every 10A request fixture (7 files) parses with its zod schema (`apps/api/src/routes/flow/flow-requests.android.test.ts`).
8. The 10A spec `e2e/tests/flow-android.spec.ts` (2 tests, an API-driven client with the Android User-Agent and `OpenVerify-Flow-Spec: 2`) passes on the shards, and `:openverify-sdk:stackTest` drives the SDK's own `FlowApiClient`, driver and `AndroidDeviceSignals` (BOT) through the same flow on the stack (`e2e/fixtures/android-10a/flow.json`; the server stores the signal body: `signals-collected`, `device-type`, `inquiry/bot_score` 95).

**Defects found and fixed in Stage 4** (test-first): the theme mapped `errorContainer` to `surface`, so Material drew body text in `danger` red (now `canvas`; 21 goldens re-recorded through the explicit record call after reading their comparison images); screen steps showed the unsupported screen in the app (no `LocalScreenEnvironment` provider); the server-too-old message was not passed; the web flow sent `copy-source: custom` for mixed operator and default texts, which the server refuses with 422 (now only when every text is the operator's).

**Known items: 8** (from the 10A decisions).
- Fixed by carry-10a, each RED then GREEN:
  - **KP10-1** (`ui-a11y-focus.spec.ts:55` in CI): RED `2ef994f6` reproduced the race under load; GREEN `5ff100d2`: the check settles two frames, then polls up to 1 s; coverage that lasts still fails; `toasts.tsx` unchanged. Trace upload: RED `19a0861d`, GREEN `d0972f6c` (`include-hidden-files: true`).
  - **KP10-2** (gitleaks 5xx): RED `50474ef2` (offline fake curl); GREEN `3f8cfd58`: five attempts with backoff on 5xx, timeouts and connection failures, 4xx fails at once, both checksums kept, a verified cache; CI cache RED `e004e49e`, GREEN `a46386d2`.
  - **KP10-3** (the selfie auto-capture uploaded the live frame): GREEN `f0861d50`: the full-resolution copy drawn with the judged guidance sample is uploaded; the manual shutter takes the live frame.
  - **K9-7** (`dba6d24f`): `GET /workflows?filter[kind]=module` feeds the draft page's modules.
  - **R002** (`c319f4d7`): only the session's resolved theme's logo and font are served.
  - **R004** (`08a8d36d`): `servedReviewStatus` is read by the flow-spec reader, the API and the console.
  - **R008** (`f2a2c91e`): the refresh benchmark touches inquiries, verifications, checks and cases (refresh-5-minute 55 ms → 1,992 ms).
- **K9-4** deferred, as decided (a contract change in flow-spec 2's component schema plus an owner decision; C198.9 stays dormant).

**Validation.**
- integration-10a, every step in Phase 9's order, each exit code read from the command:
  - install, format check, forced typecheck (17 tasks), forced lint (three calls);
  - units: API 9,472 tests at 94.39% (8 shards and a merge); dashboard 6,722 at 95.58%; contracts 4,401, checks 3,826, workflow-engine 1,984, core 1,655, flow 1,503, the rest at 80% or more;
  - integration 78, 13 and 285; vision 2,601 at 97.48%;
  - Android gate (a) to (f): 1,934 SDK host tests, 43 screenshot tests with comparison, Kover and the ABI check, debug, release and bundle, the AAR and the iOS klibs, lint;
  - OpenAPI and workflow docs: no diff;
  - e2e: mocked flow suite 328; stack up 93 s; chromium shards 49, 45, 49 and 44; console sweep 104; stackTest 1; Docker WebKit theme-csp 7 of 7;
  - images, the 11 infra tests, gitleaks (6,213 commits, no leaks).
- The orchestrator's `validate-full.sh` on `45b44d6e`: all 24 rows green (install, models, data, variant groups, format, forced lint and typecheck, units 1,749 s, the benchmark checks, integration 387 s, vision 541 s, the Android gate 294 s, the 10A Android step, OpenAPI with no diff, e2e 291 passed in 26.3 min (187 chromium, then the console sweep's 104), `:openverify-sdk:stackTest` 1 test, the three images, the workflow and vision benchmarks, the infra tests, gitleaks on 6,195 commits with no leaks). The 10A Android step found the screenshot comparison up to date, so it was re-run alone with `--rerun-tasks`: 128 tasks executed, 43 screenshot tests compared, 0 failures (2 min 56 s).

**Numbers.** SDK host-test floor 1,366 − 78 + 646 = **1,934** (CI). Goldens: 42 files, 43 tests. `contracts/fixtures/api` holds 194 files. `infra/tests/ci-workflow.test.sh` 264 checks. No migration (next is 0033).

**CI.** No run since 42476248527 on the base. The push of this entry is 10A's CI proof: the e2e job with KP10-1's fix and the uploaded traces (the artifact holding `e2e/.artifacts/test-results` confirms the hidden-files cause), the infra and secrets jobs with KP10-2's retry and cache, and the android job's new step (screenshots with comparison, `checkKotlinAbi`, `:demo-app:bundleRelease`; estimated +3 to 5 min on 9.3 of 45). Its result is recorded with the 10B decisions.

**Carried forward:**
- To 10B Stage 1a (the plan's Stage 4 amendment 9): the consent-mismatch screen hook; `Failed(UNSUPPORTED_FLOW)` for an unfillable consent legal text and a screen with missing copy; custom-copy digest cases; the waiting, halted and help-link key-map entries; `generateSdkStringTables`; the decoded image asset loader; `CameraPermission(false)` and `CaptureFailed(CAMERA_UNAVAILABLE)`; `keepScreenOn` on the waiting screen; internal `FileKind` and `InquiryStatus` serializers.
- To 10C: the android-10a fixture and `AndroidFlowStackTest` extended with the NFC match flow through the sandbox chip.
- To 10D: `FlowState.Finalizing`'s dead code; the `sdkText` call sites; logging `flow.copy_key_ignored` once per session.
- To the console's owner: `palette-model.ts` refuses module entries for account and case triggers.
- To Phase 11: seed cases in the analytics benchmark population.
- K9-4 (above); Phase 9's P7 to P9.
- To the owner and the release gate: the fluent review of the es, fr, de and ar SDK catalogs and the two `nativeApp` wordings (`notice.session-integrity`, `consent.processing`); C197.2's halted wording against the web's; the manual TalkBack pass; the consent-record console label (D4); the manual accessibility pass of Phase 9 (14 rows).

**How the run went (orchestrator).** 15.2 h, 11 agents, 2,338 tool calls. carry-10a's analytics `--measure` left the seeded `openverify-analytics-benchmark` container running; the orchestrator stopped it (kept with its seed). `validate-full.sh` gained two rows for 10A (`android-10a`: screenshots with comparison, `checkKotlinAbi`, the demo bundle; `stack-test`: `:openverify-sdk:stackTest` on the reusable stack).

## 2026-11-08: Phase 9 done (Workflow 9D: audit, review, fixes)

**Outcome.** Workflow 9D closes Phase 9 (C147-C179).
- **Commits:** 9D's 174 on its decisions commit 47461ca7 (47461ca7..6cc99c87), then this entry. Phase 9 in all is e56e4e9c..6cc99c87, 1,120 commits.
- **Agents:** eleven, all of which returned:
  - a11y-audit alone (Stage 1);
  - the Stage 2 review and the Stage 3 verifier;
  - fix-flow, fix-builder and fix-console in parallel (Stage 4a);
  - fix-api alone;
  - validation-9d alone and last.
- **Reports:** a11y-audit was partial on its last gate (the /graph/[id] sweep at its limit), which fix-console settled with R009. fix-builder was partial on K9-4 (below). The others were done.
- **Records:** the plan's "## Workflow 9D Stage 1 amendments" and "## Workflow 9D review amendments" (7b2d5420b, with "### Validation as run" c848f98b/6cc99c87); evidence in docs/tdd/phase9-{a11y-audit,fix-flow,fix-builder,fix-console,fix-api,validation-9d}.tdd.md.

**Known items: 35** (console 16, builder 5, api 11, flow 3).
- 33 fixed.
- 2 partial, both fix-builder's:
  - K9-4: the screen editor works by keyboard and single pointer, but the drag-and-drop canvas and per-component style overrides are not built;
  - K9-7: loop and module authoring is built, but the draft page passes no modules list.
- K9-27 and K9-30 were settled by documenting.
- The one HIGH, K9-35 (WebKit's own style-src-attr report for a native select), is fixed with a measured engine baseline. The CSP, the native select and the WebKit project are unchanged.

**Review.**
- Fixed: R001, R003, R005, R006, R007, R009, R010.
- Four read-only lenses gave 10 findings after dedup: 0 CRITICAL, 1 HIGH, 6 MEDIUM, 3 LOW. The verifier confirmed the HIGH (R005); none was refuted or downgraded.
- The HIGH and all six MEDIUM are fixed. The three LOW are not routed to fixers by design and are carried to Phase 10: R002 (the flow's theme-asset read serves any asset of the session's environment, not only its theme's), R004 (`effectiveReviewStatus` is unused by production code), R008 (the refresh benchmark times only the inquiries branch of dirtyDays).
- Dropped MEDIUM items: none.
- Skipped: the optional REPORT_BULK_FILE_CODES export; the sweep's smaller graph query, not needed after R009; the embed entry's seam, optional (P6).

**What landed:**
- **Accessibility (C171): WCAG 2.2 AA audit: automated part done, manual part not run, no conformance claimed.**
  - The WCAG-EM sample was drawn from a seed committed before the draw.
  - The CI matrix grew to 188 axe runs; the full cross product ran once (3,276 runs, 0 violations, no exception).
  - Seven defects were fixed test-first (D1-D7): dark runs really dark, the session-ended variant, the matrix gaps, the 24 px checkbox, the builder's single-pointer path, toasts clear of focus, the fallback text's lang.
  - Own tests: 2.4.11, 2.5.8 and 3.2.6 on 16 step types with aria snapshots, and four console ui-a11y specs.
  - The statement says "not yet evaluated for conformance".
- **Builder:**
  - C155.4 modules; C155.7 copy and promote dialogs and diff badges; C150.9-C150.11 warnings and waitFor editing;
  - Phase 8's R005 loops, while and list predicates;
  - the screen editor (by buttons, with Data, Logic visibility and Design) and C155.10's two full-stack items, by keyboard;
  - the outline following the canvas.
- **Console:**
  - the error page under the real-header CSP (/error-probe in development mode only);
  - no_environment_role in words; the 9A/9B settings view; the WebAuthn step-up; webhook names;
  - comparison-source words; the analytics CSV download from the suppressed tables; non-string transaction field filters in saved views;
  - the bulk upload without report-templates:read, and bulk codes in words;
  - case template layout positions named; relation kinds and redacted relations in words;
  - the /csp-reports address bound; the graph table paged.
- **API and platform:**
  - DS8: GET /dashboard/users/:id/roles and /permissions, with the console's preselected scopes and effective permissions;
  - K19's SBX-2003 and the "Other lists" step;
  - migration 0032 (closed_through, the $start entry step, reasons per check use, the webhooks updated_at trigger);
  - the environment sender name on every per-environment email;
  - case notifications following preferences. Behaviour change: with the defaults, Phase 8's case emails stop until a user opts in.
  - FE2 expiry windows; the export_list_kind_refused problem; the promote copying theme assets; real calendar days (R003);
  - globalTimeout 60 and the e2e job 80 minutes (R006); the dark embed fixture.
- **Flow:**
  - the contest words in five catalogs;
  - json-logic.ts removed;
  - the flow server streaming safely (R005);
  - a bundle test proving no evaluator ships (R007).

**Validation.** Two runs:
- validation-9d, alone, on cf34a038 (after it only its two docs commits): every step passed, each exit code read from the command (table below).
- the orchestrator's full run, `validate-full.sh` on 6cc99c87, alone: all 22 rows exited 0 (format 103 s; forced lint 298 s and typecheck 122 s, 17 of 17; `test` 1,670 s, 17 of 17 packages, the API 692 files and 9,428 tests, the dashboard 579 files and 6,715 tests; integration 374 s; vision 531 s, 2,601 tests; Android 196 s; OpenAPI 19 s, no diff; e2e 1,626 s with the mocked flow 328 passed (Chromium and Firefox; WebKit was proven by validation-9d's Docker run) and the full stack 287 passed; the three images; workflow and vision benchmarks; infra 77 s, no failed script; gitleaks 7 s, 5,984 commits, no leaks).

Notes on validation-9d's run:
- The gitleaks installer test needed nine runs: GitHub's release host answered 504 for about an hour. Eight runs failed, each failed check on that 504, and the ninth passed 9 of 9 with the code unchanged.

| Step | Result | Time | Load |
|---|---|---|---|
| 1. Frozen install; format:check | passed | 1 s; 99 s | 0.5-1.6 |
| 2. Forced typecheck | 17 of 17 | 123 s | 1.5-5.6 |
| 2. Forced lint (CI form, three calls) | api; dashboard and contracts; the other 14 | 182, 203, 295 s | 1.5-5.0 |
| 3-4. Fetches; variant groups | passed | 7 s | 1.5 |
| 5. Unit outside the API | watchlist/e2e/db; dashboard (6,715 tests, 95.59%, one call); the other 12 | 346, 362, 146 s | 1.2-13.5 |
| 5. @openverify/js | 19 tests | 5 s | |
| 5. API unit | 8 shards of 126-156 s plus a 33 s merge; 692 files, 9,428 tests, 94.39% | | 5.2-10.1 |
| 6. Watchlist benchmark checks | passed | 42, 10 s | |
| 7. Integration | db 78; graph 13 (template 14.8 s); api 89/99/79 | 87; 33; 65/165/79 s | 3.5-16.6 |
| 8. Vision | 1,471 + 1,130 tests, 97.48% | 248 + 305 s | 2.1-13.0 |
| 9. Android | 1,366 host tests (floor 1,366) | 71, 11, 10 s | 1.8-3.4 |
| 10. OpenAPI and workflow docs | no diff (sha256 e229bd12…a175a852f) | 19, 2 s | |
| 11. Mocked flow suite | 328 passed (321 Chromium, 7 Firefox) | 111 s | 2.2-9.4 |
| 11. WebKit via Docker (theme-csp) | 7 passed | 17 s | 7.3-8.0 |
| 11. Full-stack e2e | stack up 90 s; shards 47/46/46/44; sweep 104 (/graph/[id] 11.1 s) | 229/309/270/377 s; 307 s | 1.5-3.7 |
| 12. Images | apps, vision, code-runner | 147, 3, 39 s | |
| 13. Infra tests | all 11 passed (install-gitleaks on its ninth run, after the host outage) | | |
| 15. gitleaks | 6,003 commits, no leaks | 8 s | |

Unit tests in all: 34,412 in 17 packages, each at or above 80%.

**Benchmarks** (step 14, reported only):
- **Workflow engine:** effectful steps ran at 19/47/49 steps a second at 1/8/32 clients, control flow at 95/205/208 (load 1.4-2.4).
- **Analytics,** re-seeded after 0032, on 1 M inquiries (load 2.2):
  - build 369 s;
  - 5-minute refresh 55 ms (2 days);
  - pass after midnight 30.1 s (30 days);
  - reads at 30, 90 and 400 days up to 33, 51 and 396 ms.

**CI.**
- **9C push (CI 42382549247):** 17 of 18 jobs green. e2e failed at 7.5 min on 5 WebKit theme-csp tests, the cause being WebKit's own select report; fixed as K9-35.
- **9D push:** its CI run is read on this push and recorded in the orchestrator's state; it is the first CI proof of C160.9's three-engine line (WebKit with K9-35's baseline) and the first full-stack CI run since 9A, against the 60-minute globalTimeout (the job's timeout is 80). Past 75% of it, Phase 10's first integration agent splits or raises it.

**Carried forward:**
- **C177 deferrals:**
  - **Flow:**
    - weighted-random splits and request criteria on deployments, undeploy and publish without deploy;
    - parallel steps; initial-step-name;
    - several steps of one verification type on exclusive branches;
    - File upload, Home, List Container, Device Handoff Button, ID type select, country multi select, international database inputs, the bank component and dynamic images;
    - address autocomplete; "test in sandbox" with draft-pinned inquiries;
    - ICU plural and select in operator copy; client-reported screen-view analytics.
  - **Themes and languages:**
    - machine translation; SVG logos; a bundled web font and the OFL-1.1 exception;
    - translating the console; locales beyond the five;
    - operator fonts on native clients.
  - **Analytics:**
    - noise-based privacy against differencing;
    - the SQL explorer; the session map; availability metrics.
  - **Settings:**
    - SSO, SAML and SCIM; per-template role constraints and "assigned to me";
    - a finer split of pii:view; the unused-permission review;
    - OAuth client credentials on webhooks; key inflection and payload filters; template-restricted API keys;
    - the console idle timeout;
    - a separate listener or ingress denial for /api/v1/internal/*;
    - the public batch-jobs resource and its events.
  - **Carried:**
    - teams, availability and availability-driven assignment;
    - the public print routes and a server-made PDF;
    - sdk-react and apps/demo-web;
    - npm publication of @openverify/js.
- **The manual accessibility pass** (owner, a person, release gate): 14 rows, results table empty. VoiceOver needs an Apple device.
- **WebKit locally** (owner step, optional): `pnpm --filter @openverify/flow exec playwright install-deps webkit`, which needs sudo. The Docker browser server already covers the theme CSP spec.
- **Known items reported partial or skipped:**
  - K9-4: the drag-and-drop screen canvas, and per-component style overrides with live contrast. The overrides need a style member in flow-spec 2's component schema (C148.2), and the owner decides it. Both go to Phase 10.
  - K9-7: the workflow draft page's modules list. It needs a read that says which workflows start with module-input. Phase 10.
- **Dropped MEDIUM items:** none.
- **Review LOW findings:** R002, R004, R008 (above), to Phase 10.
- **Routed, not built:** flow-bundle.spec.ts once failed under load in fix-flow's run. The suspected cause is the auto-capture uploading the live frame instead of the judged one. It passed in every later gate. Phase 10's flow work takes it, test-first.
- **Handover and orchestrator items, carried or deferred:**
  - P1: logicalPropertiesConfig() in the root eslint.config.js (owner).
  - P3: the CLAUDE.md wording of 9A Stage 1a amendment 15 (owner).
  - P5, deferred to Phase 10: the session's organization-display-name, the font's unicode-range (TH5) and ProblemMembers lists.
  - P7: the theme asset list route.
  - P8: device dimensions on the rollups.
  - P9: console editing of case-action placement and visible-when.
  - The real-font proof.
  - @openverify/node's ETag, If-Match, validate, diff, restore, copy, used-by, promote and include: 'files', with Phase 10's SDK work.
  - The fluent review of the es, fr, de and ar catalogs (owner).
  - Closed: P2, nested quantifiers stay refused, revisit with the Kotlin port. Dropped: K15 (P4).
  - Nobody: a user deletion path calling forgetAnalyticsAssigneeInTx.
- **What C175 hands on:**
  - **Phase 10** (Android, commonMain): OpenVerify-Flow-Spec 1, 2; rendering the server's position, and the screen step in Compose; the strict visibility evaluator and the Kotlin port of C148.3's matcher against the golden vectors; the theme onto MaterialTheme; operator copy; fr, de and ar with an RTL review; digit normalisation; waiting states; exhausted routes; the 2.2.1 warning and extension; prefillFrom; the consent digests; device.platform and kind; locale.
  - **Phase 11:** SSO; the idle timeout; production images (the flow server its own image) and the Helm chart; npm publication of @openverify/js, sdk-react and demo-web; the threat model's embed boundary and the ASVS CSP rows; denying /api/v1/internal/* at the ingress, or binding it to OPENVERIFY_INTERNAL_LISTEN; Connect's share-consent step.

**How the run went (orchestrator).**
- Before launch the owner said "make the open decisions yourself and record them in the plan". The orchestrator read the 9C push's CI, diagnosed the WebKit failure in a Docker WebKit (WebKit itself reports `style-src-attr` for a native `<select>` under a CSP without `unsafe-inline`; a script-free page reproduces it), made it K9-35 (HIGH, fix-flow), and recorded nine decisions in the plan ("Orchestrator decisions before Workflow 9D", 47461ca7).
- 11 of 11 agents returned with no error: 3.46 M subagent tokens, 1,753 tool calls, about 12.1 h.
- WebKit now runs locally without sudo through Playwright's browser server in Docker (`mcr.microsoft.com/playwright:v1.64.1-noble`, `PW_TEST_CONNECT_WS_ENDPOINT`), so the three-engine line no longer depends on CI alone.
- Phase 9 is closed. Phase 10 starts in a new session, after its plan is refreshed against Phase 9 as built.

## 2026-11-07: Phase 9, Workflow 9C done (the console)

**Outcome.** Workflow 9C built the operator console for Phase 9 on 9A's flow and 9B's platform. Commits e68cfa48..017d8e36 on base 69ebd7fa (323), then the orchestrator's load fix 46ab6df4..a7920d11 and this entry. Seven console builders ran in parallel, then integration-9c beside docs-9c, then validation-9c alone. Three builders were partial; what they did not build is carried to 9D by name (plan S9C-12, S9C-16 and the "### Handover to 9D").

Outcome per acceptance line:
- **Templates (C153, C154):** done in the console: generated member forms with tiers shown; check panels with the branches that read each check; settings, links, report-config, signal and list forms; ETag and If-Match with the 412 dialog; validate, diff, restore, used-by and deployments. Not built: the copy and promote dialogs (the clients exist).
- **Builder and preview (C155, C156): partial.**
  - Built: the shared GraphAdapter editor, the flow adapter, the outline first, canvas, palette, branches with onNull and each fact's tier, stage and source, autosave, publish with acknowledgements; the preview frame and protocol with asset messages; simulate with presets; the workflow test-run overlay.
  - Not built: C155.4 modules, C155.5's screen editor, the canvas diff badges, C150.9-C150.11's warnings and waitFor editing, Phase 8's R005 loop and module authoring.
- **Themes (C160):** sets, revisions, restore, live contrast, assets and the default set in the console. The WebKit CSP failure of 9B's CI run is fixed: the flow's theme now goes to one `:root:root:root` rule on its same-origin stylesheet instead of `<html>`'s inline style (S9C-1). The three-engine line is proven on this push's CI run.
- **Languages and copy (C161, C162):** the translations editor, CSV through a console route, and review status wherever a locale is enabled.
- **Analytics and data (C163-C166):** six views from the suppressed answer, tables first; d3-scale and d3-shape charts, client-only; definitions, denominators, zone and freshness; saved views on every C165.1 list; the new filters (and GET /dashboard/inquiries now applies them, DA1); exports per type with the personal-data confirmation; bulk report creation with per-row outcomes. Not built: an analytics CSV download.
- **Settings (C167-C170):**
  - The console's nonce CSP (C170) is enforced, with zero violations on every console page except the error page, which the spec does not reach yet.
  - Done: the role editor on grantable scopes; per-environment assignments; resend, reactivate and MFA reset with a TOTP step-up; sessions; the audit explorer's filters; key rotation, note, age and blocklist; webhook name, description, alerts and delivery search; notification preferences; the 9A and 9B settings.
  - AC2 (orchestrator decision): PATCH /dashboard/users/:id with status active on a deactivated user answers 422 `user_reactivation_required`; reactivation goes only through POST /reactivate.
  - Carried: no_environment_role in words, the read-only settings view, the WebAuthn step-up, effective permissions (DS8).
- **Accessibility (C171):** axe once per console page (97 pages, from the build's route manifest) and at each state of the 9C specs, with no exceptions. WCAG 2.2 AA audit: automated part done for the console pages, manual part not run, no conformance claimed. The full cross product and the statement are 9D's.
- **Carried (C172, C173):** done: the layout editor with keyboard and single-pointer alternatives, checklists, the switcher's requirements, preset comments, action placements, the inquiry's reports, coverage words, verification files, print views with their audit call, the trust-store flags, the graph expansion. Not built: K19's "Other lists" check (needs a watchlist fixture entry) and the comparison-source words. K15 dropped (no record names its options).
- **End to end (C178.4):** the 9A, 9B and 9C specs pass on four chromium shards plus the new `console-sweep` project (axe per page and the real-header CSP spec), which runs after them.
- **Records:** apps/dashboard/README.md's 9C sections and S4B-18's doc pages (export columns, the bulk report CSV, the delivery search's paging, per-inquiry expiry) are written; stale passages in docs/flows, docs/themes, docs/i18n and docs/analytics are settled.

**CI changes.** unit-dashboard runs as two blob shards plus a unit-dashboard-coverage job that merges them and applies the 80% gate (it took 16.2 of 20 minutes on 9B's push). The unit-api job names say "of 3". The e2e job keeps 70 minutes (estimated about 40); the Firefox and WebKit install stays in it.

**Validation.** Two runs, both green:
- validation-9c, alone, on 639b6d58 (the API re-gated on 95059082): all 15 steps exited 0 (table below);
- the orchestrator's full run, `validate-full.sh` on 017d8e36: 21 of 22 rows exited 0 (format 97 s; lint 295 s; typecheck 139 s; integration 352 s; vision 535 s; Android 193 s; OpenAPI 19 s; e2e 1,630 s with the mocked flow 168 passed and the full stack 277 passed; the three images; workflow and vision benchmarks; infra 72 s; gitleaks 8 s, 5,805 commits, no leaks). `test` failed on one file only: `apps/api/src/openapi.test.ts`'s hook passed its 120 s guard at a load of about 20 (it passed alone in 18 s). The hook formatted the 8 MB OpenAPI document with Prettier (4.6 s of CPU) to compare it byte for byte. The orchestrator fixed it test-first (46ab6df4 stub, 974aaa0f RED, a7920d11 GREEN; `docs/tdd/phase9-orchestrator.tdd.md`): the test compares compact texts (content and key order) and Prettier runs only when `openapi:write` writes. The API's forced lint and typecheck passed, `openapi:write` reproduced the file byte for byte, and the `test` row, run again in the same all-at-once form, passed: 17 of 17 packages in 1,740 s, the API 688 files and 9,380 tests at 94.37%.

| Step | Result | Time | Load |
|---|---|---|---|
| 1. Frozen install; format:check | passed | 0 s; 95 s | 0.0-1.2 |
| 2. Forced typecheck | 17 of 17 | 122 s | 1.4-5.6 |
| 2. Forced lint (CI form, three calls) | api; dashboard and contracts; the other 14 | 179, 196, 293 s | 1.5-5.1 |
| 3. Fetch models and data; 4. variant groups | passed | 6 s | |
| 5. Unit tests outside the API | watchlist/e2e/db; dashboard (6,538 tests, 95.58%); the other 12 | 341, 349, 145 s | 1.5-7.8 |
| 5. @openverify/js | 19 tests | 4 s | |
| 5. API unit | 8 shards of 122-155 s plus a 32 s merge; 9,376 tests after the fix, 94.36% statements | | 7.1-11.1 |
| 6. Watchlist benchmark typecheck and test | passed | 41, 9 s | |
| 7. Integration | db 78; graph 13; api 89/99/79 | 85; 32; 63/158/76 s | 3.3-17 |
| 8. Vision | 1,471 + 1,130 tests, 97.48% coverage | 245 + 301 s | 2.0-12.9 |
| 9. Android | 1,366 host tests (floor 1,366) | 68, 10, 11 s | 2.0-3.4 |
| 10. OpenAPI and workflow docs | no diff | 19, 2 s | |
| 11. Mocked flow suite | 168 passed (163 Chromium, 5 Firefox; WebKit cannot start on this host) | 59 s | 2.4-8.7 |
| 11. Full-stack e2e | stack up 85 s; shards 47/42/45/41; console sweep 102 | 233/264/247/364 s; 407 s | 1.6-4.5 |
| 12. Images | apps, vision, code-runner | 204, 13, 77 s | |
| 13. Infra tests | all 11 passed (1,044 checks) | | |
| 15. gitleaks | 5,822 commits, no leaks | 8 s | |

Unit tests in all: 34,181 in 17 packages, each at or above 80%.

**Benchmarks** (step 14, reported only):
- Workflow engine, effectful steps: 16/50/50 steps a second at 1/8/32 clients. Control flow: 93/211/213.
- Analytics, on 1 M inquiries: build 357 s; 5-minute refresh 55 ms (2 days); pass after midnight (30 days) 28.1 s; reads at 30, 90 and 400 days up to 41, 56 and 354 ms.
- validation-9c found that the refresh step had timed an empty pass on every repeated `--measure` (the updated_at trigger replaced an unchanged value with the wall clock). Fixed test-first (9994adad, 95059082).

**CI.** 9B's push (CI 42331362147) failed only e2e, at 7.5 minutes, on WebKit's theme CSP spec; the cause was the CSSOM inline-style write above, fixed in 9C. Other jobs, minutes of timeout: unit-api 20.0/16.0/19.4 of 40, node 11.1 of 25, unit-db 12.6 of 25, unit-dashboard 16.2 of 20, integration 12.5 of 30, android 9.3 of 45, android-instrumented 8.9 of 60, vision 9.0 of 30. 9C's own CI run is read on this push.

**Follow-ups:**
- The orchestrator reads this push's CI: the e2e job (WebKit's first theme CSP run with the fix, and the first full-stack CI run since 9A's), the two unit-dashboard shards and unit-dashboard-coverage. Past 75% of a timeout, 9D's fix-api rebalances.
- 9D per the Handover: a11y-audit (C171 end to end, the manual checklist and the statement), fix-console (the builder items, the settings words and views, the analytics CSV download, the error-page CSP trigger), fix-api (DS8, K19's fixture entry, S4B-14).
- The owner: logicalPropertiesConfig wiring, C148.3's nested quantifiers, the CLAUDE.md wording of Stage 1a amendment 15, and optionally WebKit's host libraries (`playwright install-deps webkit`).

**Carried forward:** the Handover's "Still open" list (S4B-14, S9C-12, S9C-16), C177's deferrals, and the manual accessibility pass (a person).

**How the run went (orchestrator).**
- Before launch the owner said "Launch 9C right now and make decisions yourself". The orchestrator decided the open items and recorded them in the plan ("Orchestrator decisions before Workflow 9C"): TH1 confirmed (#000000), AC2 as above, the WebKit failure to integration-9c, unit-dashboard to be split, Stage 2 as three agents, the heavy-call slot lock for the builders' dashboard suites.
- 10 of 10 agents returned with no error: 5.6 M subagent tokens, 2,610 tool calls, about 9.0 h.
- The orchestrator stopped cleanly after the push at the owner's request (2026-11-07); 9D is prepared (eleven agents: P-A `fix-builder`, P-B `validation-9d`) but not launched.
- Three reports were partial: dashboard-settings (two items), dashboard-flow-builder (the screen editor and modules) and dashboard-cases-reports (K19, K15). All are carried by name.

## 2026-11-06: Phase 9, Workflow 9B done (the platform)

**Outcome.** Workflow 9B built the platform's API and package side of Phase 9 on 9A's flow. The console for all of it is 9C's. Commits 228c468b..e8b29895 on base 6a290723 (291).

What it built:
- Theme sets with the unrounded WCAG contrast gate, revisions, restore and archiving; logos re-encoded through vision; the flow's theme application (prefers-color-scheme, style-variant, fonts and logo through the session token).
- Analytics rollups in each environment's reporting zone, with dirty-day refresh, redacted contributions, rebuild and retention, and six read-only answers. Suppression covers small counts, rates with strict bounds and exact complementary cells over the time lattice.
- Asynchronous CSV exports (creator only, 24 hours, masking, refused over 50,000 rows), saved views with the PII-filter rule, the new inquiry and transaction filters, the webhook delivery search, and bulk report creation with per-row outcomes.
- Environment-scoped roles with organisation-level permissions, grantable, invitation resend, reactivation, the superset and step-up rules, MFA on by default, a console MFA reset, sessions and revocation, and the audit explorer with an IP blind index and retention.
- One-call key rotation, key notes, age warnings and attribute blocklists; webhook names, descriptions, attempt headers and failure alerts with notification preferences; the sender name.
- Case layout, checklists with the transition guard, preset comments, action placements and visibility; latest-run-notes, verification files and redacted-at, print audits, and graph node expansion.
- The 9A carried items: preview, simulate and presets with the replay of 9A's inquiries, flow_run_grants, the embed and redirect publish checks, v2 template creation, comparison-source, the session's links, prefill by input name, the handed-off phone's consent, and the per-inquiry expiry windows.
- The `.gitleaks.toml` OpenVerify token rule (synthetic allowlist, entropy floor 3.5), checked by `infra/tests/gitleaks-config.test.sh`.

**Acceptance lines 9B covers:**
- Themes (C160): API, gate and flow done. Firefox and WebKit run in CI only.
- Analytics and data (C163-C166): API done, console 9C.
- Settings (C167-C169): API done; C170 is 9C's.
- Carried (C172, C173): API done, console 9C.
- Builder and preview (C156): preview and simulate API done.
- Serving and embedding (C158): the publish checks are done.
- End to end: the 9B specs (theme sets, analytics, exports, bulk reports, environment roles, key rotation, webhook failure alert, flow-branching with the replay) pass on the shards.
- Records: docs/themes, docs/analytics and docs/settings are written.
- Charts: no chart dependency exists yet. The owner chose B9 (b), d3-scale and d3-shape (ISC), to be added before 9C.

**Validation.** Two runs, both green:
- validation-9b, alone, on the final tree f7494687, every step exiting 0 (table below);
- the orchestrator's full run, `validate-full.sh` on e8b29895: all 22 steps exited 0 (install, models, data, variant groups; format 94 s; lint 325 s; typecheck 138 s; unit tests 1,667 s; benchmark typecheck and test; integration 454 s; vision 547 s; Android 198 s; OpenAPI 19 s; e2e 1,108 s with the mocked flow 163 passed and the full stack 154 passed; the three images; workflow and analytics benchmarks; infra 76 s; gitleaks 8 s).

| Step | Result | Time | Load |
|---|---|---|---|
| 1. Frozen install; format:check | passed | 1 s; 109 s | 0.7-1.4 |
| 2. Forced typecheck | 17 of 17 | 171 s | 1.7-5.2 |
| 2. Forced lint (CI form, three calls) | api; dashboard and contracts; the other 14 | 220, 196, 348 s | 1.3-4.8 |
| 3. Fetch models and data; 4. variant groups | passed | 7 s | 1.4 |
| 5. Unit tests outside the API | watchlist/e2e/db; dashboard; the other 12 | 398, 310, 183 s | 1.3-15 |
| 5. @openverify/js | 19 tests | 7 s | |
| 5. API unit | 8 shards of 143-193 s plus a 34 s merge; 9,372 tests, 94.36% statements | | 7-11 |
| 6. Watchlist benchmark typecheck and test | passed | 44, 11 s | |
| 7. Integration | db 78; graph 13 (template in 15.9 s of 180); api 89/99/79 | 92; 35; 89/176/110 s | 2.8-15 |
| 8. Vision | 1,471 + 1,130 tests, 97.48% coverage | 316 + 393 s | 12.4-1.3 |
| 9. Android | 1,366 host tests (floor 1,366) | 125 s re-run; others up to date | 1.9-4.2 |
| 10. OpenAPI and workflow docs | no diff | | |
| 11. Mocked flow suite | 163 passed | 84 s | 2.6-10.6 |
| 11. Full-stack e2e | stack up 171 s; shards 53/51/50 | 297/384/408 s | 1.4-3.2 |
| 12. Images | apps, vision, code-runner | 212, 9, 58 s | |
| 13. Infra tests | all 11 passed | | |
| 15. gitleaks | 5,497 commits, no leaks | 7 s | |

**Benchmarks** (step 14, reported only):
- Workflow engine, effectful steps: 13/38/39 steps a second at 1/8/32 clients. Control flow: 69/158/165.
- Analytics, on 1 M inquiries, 2 M attempts, 12 M checks and 3 M step records:
  - build: 379.3 s;
  - 5-minute refresh: 58 ms;
  - pass after midnight (30 days): 29.4 s;
  - reads at 30, 90 and 400 days, in ms: up to 33, 55 and 333 (load 1.4-2.5).

**CI.** 9A's push (8bd5c545) ran as CI 42070468737: 15 of 15 jobs green. unit-api shard 1 took 28.1 of 40 minutes (the closest), shard 2 24.5, e2e 24.6 of 70, node 13.5 of 25, unit-db 11.6 of 25. 9B splits unit-api into three shards. 9B's own CI run is read on this push.

**Follow-ups:**
- The orchestrator reads the first 9B CI run: the Firefox/WebKit step time (over 3 minutes: integration-9c moves it under `schedule:`) and the three unit-api shard times.
- The owner decides TH1 (built-in focus #000000) and AC2 (PATCH /users/:id status active). B9 is decided: (b).
- The owner wires logicalPropertiesConfig into the root eslint.config.js.

**Carried forward:**
- S4B-14:
  - migrations: closed_through, a reserved start step in the transition rollup, check-reason type and requirement, device dimensions, W3's updated_at trigger;
  - per-environment senders passing mail-sender-name, and case notifications reading notification preferences;
  - the unsettled remainder in core;
  - flow starts outside the engine skipping the after-start window, and handoff redemption not extending the expiry;
  - an export_list_kind_refused code and EXPORT_CSV_COLUMNS.lists;
  - the session's organization-display-name and font unicode-range;
  - ProblemMembers lists;
  - promote passing assets;
  - docs/flows text.
- S4B-18: doc pages for export columns, bulk CSV, the delivery search's links.next and the per-inquiry expiry rules; the K19 fixture.
- The real-font proof (no WOFF2 tooling in either lockfile).
- 9D's S4-12 items.
- C177's 9B deferrals:
  - analytics: differential privacy, the SQL explorer, the session map, availability metrics;
  - settings: SSO/SAML/SCIM, per-template role constraints, a pii:view split, the unused-permission review, webhook OAuth credentials, key inflection and payload filters, template-restricted keys, the console idle timeout, a separate internal listener, the public batch-jobs resource;
  - themes: SVG logos, a bundled web font, operator fonts on native clients, machine translation, console translation, locales beyond five.
- The manual WCAG audit (9D) is still to run.

**How the run went (orchestrator).**
- 9B was refreshed against 9A before launch. The S4-12 items got owners (plan "Orchestrator decisions before Workflow 9B"), and foundation-9b's checkpoints took 9A's scoped gates.
- During contracts-9b, at the owner's request ("parallelize everything in 9b that can be parallelized ... safely"), an `ecc:planner` review found that every builder waited for foundation-9b's whole call, against the plan's own Risks row.
- The owner chose the core plan, 21 agents:
  - foundation-9b as six chained calls (A, U, W, X, C, F), each releasing its builder;
  - the carry agents at Stage 1a's end, with two follow-ons;
  - a four-slot lock for heavy test calls;
  - Stage 4 split into integration-9b, docs-9b and validation-9b.
- The run was stopped seconds after contracts-9b returned and resumed from the new script. contracts-9b replayed from the cache.
- 21 of 21 agents returned with no error: 9.7 M subagent tokens, 4,107 tool calls, about 15.8 h after the resume (20.6 h in all).
- Three reports were partial: contracts-9b on visx; api-analytics and api-exports on gate failures confined to other agents' in-flight files, which later agents settled.

## 2026-11-05: Phase 9, Workflow 9A done (the flow)

**Outcome.** Flow-spec 2 is built and validated on the full stack: a graph of steps and port-labelled edges, with screens of components, branches with ordered routes and onNull, closed-list actions and exhausted fallbacks. It migrates losslessly from v1 (12 goldens, and an equivalence test against v1's walk).

The server flow engine decides every step and requires only the verifications on the path taken. It records a step record, refuses any step but the current one (409 flow_step_not_current), and serves the v1 projection that keeps today's Android SDK safe (FlowCoordinatorProjectionTest, 26 tests, over 16 golden projections served byte for byte). A flow-spec 1 version keeps its stored v1 flow.

Also built:
- typed template fields and API-only prefill;
- template versions with ETag and If-Match, drafts with problems, validate, diff, restore, copy, used-by, promote, deployments and their events;
- operator copy, the translations API (JSON and CSV) and consent digests;
- en, es, fr, de and right-to-left ar (all machine-drafted, none reviewed);
- the web flow on the server's position;
- the flow server with per-request frame-ancestors, failing closed, now serving the compose app profile;
- the credential-free preview frame;
- @openverify/js at 2.5 KB gzipped;
- the theme plumbing 9B builds on.

C147-C162 and C171.2-C171.4 are built for 9A, with C178.4's 9A specs, except the parts carried below. Commits e9bca8cf..28b0a269 on base 1fc4f384.

**Per agent:**
- contracts-9a: contracts, ADR 0008, release age, and the green projection proof after the owner's option (i).
- foundation-9a: migration 0030, hooks, frozen routes, the CI split into unit-db, and the a11y helpers.
- flow-spec-logic: graph rules, migration, the Pike-VM pattern matcher, the strict visibility evaluator, nextPosition and flowOutcome, the projection, and flow conditions in workflow-engine.
- flow-i18n: fr, de and ar; RTL; pseudo-locales; review statuses; the locale exports and consent-texts.json.
- api-flow-engine: the engine, the session members, screens, selfie extension and races.
- api-flow-actions: run_workflow and the instant actions, the flow-failure decision record, provisional snapshots and the sweep.
- api-templates: drafts, publish with acknowledgements, operations, copy, translations and the consent check. Simulate, presets, preview resolve, the embed and redirect publish checks, and v2 template creation are not built.
- flow-renderer: the screen step (22 kinds), the server position, copy and languages, consent digests, capture methods, the 2.2.1 extension, and the mocked suite at 158.
- flow-server-embed: the flow server, embed and redirect rules, the internal route, the preview entry, @openverify/js and its bridge.
- integration-9a: the defects and hooks above, the 9A specs, compose, docs, CI, the amendments and validation.

**Numbers (each exit 0, load average beside):**
- frozen install and format;
- forced typecheck: 17 tasks, 170 s (load 0.9);
- forced lint, as CI runs it: 16 tasks in 270 s, then api in 172 s (load 1.5 to 3.1);
- unit: 23,137 tests outside the API in two calls (342 s and 382 s), every package at least 80%:
  - db 92.61%, flow 95.14%, dashboard 96.39%, contracts 99.19%, flow-spec 96.27%, js 100%;
- API: 8,558 tests in 622 files, 94.33% statements and 84.82% branches (two shards, 499 s and 439 s, load 6 to 7);
- integration: db 78, graph 13 (template 15.1 s), api 81, 97 and 76;
- vision: 2,601 tests at 97.48%;
- Android: 1,364 host tests, none skipped;
- OpenAPI and workflow docs: no diff (sha256 0295349b…44ff);
- mocked flow suite: 158 in 50.6 s (load 3 to 7);
- full stack: 146 tests in shards of 49, 52 and 45 in 4.2, 5.7 and 4.6 min, plus 1.3 min for the stack start (load 1.2 to 3.8); 10 OTP sends, 9 from 127.0.0.1;
- the 9A specs: branching 4 tests in 25.2 s, and the other four specs 5 tests in 15.2 s (load 2);
- images: apps 209 s, vision 44 s, code-runner 72 s;
- the ten infra tests;
- workflow benchmark: effectful 48 and control-flow 208 steps/s at 32 clients (load 2.3);
- gitleaks: clean over 5,198 commits.
- PGlite migration (foundation-9a's): 4,472 ms before and 4,514 ms after 0030, unchanged within noise.
- CI before 9A (run 41802158981): node 21.2, unit-api 25.2 and 14.2, e2e 17.1, integration 13.8 min. The times after the unit-db split are read on this push.

**Open items:**
- **Owner decisions:**
  - the root ESLint wiring of the logical-properties rule (a hook refuses agents);
  - C148.3's nested quantifiers;
  - the CLAUDE.md wording of Stage 1a amendment 15;
  - the v1 session flow choice (amendment 20);
  - the four machine-drafted catalogs, which need fluent reviewers.
- **Carried to 9B:**
  - preview resolve (api-themes); simulate and presets with the C178.4 replay; the embed and redirect publish checks; v2 template creation;
  - flow_run_grants in 0031, and the biometricTemplates export;
  - the resume expiry window, the per-inquiry expiry meta columns, and comparison-source evidence;
  - the session's links; prefill by input name; the v2 handed-off phone's consent step;
  - theme application and real-font proof (api-themes).
- **Carried to 9D:** contest-route words in five locales; the embedded axe types not run; json-logic.ts removal; the embed entry's seam.
- **WCAG 2.2 AA:** the automated part only so far. The manual audit is carried to 9D and the release gate; no conformance is claimed.
- **C177 deferrals touched by 9A:** the batch-jobs resource, initial-step-name, parallel steps, address autocomplete, machine translation, SVG logos, the bundled web font, console translation, and several verification steps of one type.

**How the run went (orchestrator).**
- The first contracts-9a stopped at Stage 1a by design: the projection host test went red on today's Android SDK. The owner chose option (i), a
  `server-continuation` placeholder for spec-1 clients (plan, "Owner decision after Workflow 9A's stop").
- The rerun (`wf_e28f2c33-359`) spent most of Stage 1a's 5h17m in whole-repo gates. foundation-9a's five intermediate checkpoints then took a
  gate scoped to what each changed, with the whole gate once at (OPENAPI) (orchestrator decision, `resume/` STATE 2026-11-04).
- A weekly usage limit stopped six agents mid-work. A continuation (`wf_9b3088ad-ee3`) embedded the three finished reports and resumed the
  six from per-agent notes on their commits and drafts. integration-9a then ran alone.

**Orchestrator's slices after the Workflow** ([evidence](tdd/phase9-orchestrator.tdd.md)):
- The full validation of `28b0a269` failed one case only: C58.7's classifier bound, at 2,688 ms of CPU against 2,000 (about 300 ms alone).
  It now bounds the work at 16 runs of a reference workload measured beside it (`031eaa36`, `28015021`).
- pypdf 6.21.2 (C67 date item; the same licence blob) and `jsdom` pinned exactly at 29.1.1 (R011), test-first (`35d1f788`, `1044ec0a`).
- The full validation of the final tree is the push's gate; the CI times of the unit-db split are read on this push.

## 2026-11-04: Phase 8 done (Workflows 8C and 8D: the console, two reviews, fixes)

Workflow 8C (`1f0510b9..3e0652f1`, 140 commits; 10 agents, none errored, run `wf_829d13e3-569`) built the Phase 8 console, reviewed all of Phase 8 and fixed what it found. Its workflow console ran short: one agent built a part of C141, and the review's HIGH R010 named the rest. So Workflow 8D (`3e0652f1..f0a32761`, 166 commits; 11 agents, none errored, run `wf_b159aa21-037`) finished C141 and the carried items that were fixable, then reviewed what it changed. 8D was not in the plan: it was added because Phase 8's Console acceptance line needs C141, and Phase 9's flow builder moves this editor into a shared graph editor (C155.1). The plan's "Workflow 8C" and "Workflow 8D" amendment sections are the record, and each agent's evidence is in `docs/tdd/phase8-*.tdd.md`.

| Item | What landed |
|---|---|
| Workflow console (C141) | The workflows and runs pages; drafts in an outline the keyboard fully drives (APG tree with an editing menu), the `@xyflow/react` canvas with dagre tidy-up and diff and problem badges, undo and redo, the action palette, JSON-Schema step forms with a variable picker, the condition builder, the trigger, inputs, variables and outputs panels; publish with acknowledgements, rollout, restore, promote; runs with resume, rerun, cancel, cancel-runs, redaction and the path over a read-only canvas; test runs, manual runs, trigger deliveries; secrets; the workflow settings; decision templates; decision records and reopen; account actions; the recipes |
| Case console (C142) | Cases, templates and versions, queues, SLA policies and calendars, exports, the reviewer's case page with its modules, comments, attachments as renditions, case actions, the compare panel (keyboard zoom and pan, linked views) and the print view; the graph's "create case" |
| Reviews | 8C: 0 CRITICAL, 2 HIGH (R001 a decision on a catch-all route was never recorded, fixed; R010 C141 unbuilt, finished in 8D), 13 MEDIUM, 1 LOW. 8D: 0 CRITICAL, 0 HIGH, 7 MEDIUM, 1 LOW |
| Fixed known items | Among them K8-17 (HIGH: 8A's `fetch_object` answered a shape other than the one publish checks, so a route on it silently took `else`), K8-35 (opposite lock orders on a queue and its cases deadlocked and the route answered 500), case emails through an outbox, the assignment drain, recovery sweeps for stuck exports, scans and renditions, `GET /cases` batched to a fixed number of queries, P22's attachment retention, the dispatcher's rotation, code-runner backpressure, a JSON export capped at 64 MiB, the pull's one ordered scan per queue, and the four load-sensitive tests that failed 8C's validation |
| Accessibility | `@axe-core/playwright` (test tooling, MPL-2.0 under CLAUDE.md rule 4's exception) runs on every Phase 8 console page in the ui specs, which found and fixed real defects |
| Migration | `0029_phase8d` |

**8C's validation** (`3e0652f1`) was red only on four tests that failed under the whole parallel unit suite and passed alone, so 8C was not pushed on its own. 8D made each deterministic test-first, by doing less work or by reading the injected clock, never by a retry or a longer timeout, and they pass below.

**TDD gaps disclosed by the agents** are in each TDD file; no test was weakened.

**Validation** (the plan's list) on `f0a32761`, a full run on the first pass, every step rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` | pass |
| TypeScript unit (16 packages, `--force`, one call) | 30,119 tests in 23 min 5 s, none skipped. Statements / branches: api 8,253 at 94.84 / 85.87; dashboard 5,580 at 96.4 / 89; db 1,993 at 92.56 / 85.09; workflow-engine 98 / 92.23 |
| Integration (Testcontainers) | db 78; api 254 (the graph project included); 339 s |
| Vision | 2,600 tests in 9 min 4 s; ruff, mypy |
| Android | SDK 1,334 host tests, 0 failed or skipped (read from the XML results); Kover gate; assemble; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 79 mocked flow specs; 137 full-stack tests in 14.7 min, none skipped |
| Images (apps, vision, code runner), benchmarks (selfie median 0.39 s, government ID 2.57 s, document 1.68 s, each within its budget; workflow engine 48 effectful and 207 control-flow steps a second at 32 clients, reported), infra tests (CI contract 220, code runner 55, compose 531, apps image context 43, vision container 55, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11), gitleaks (4,862 commits) | pass, no leaks |

**CI.** The push of `1bc82ef4` (Workflow 8B) ran as CI 41682793143: 14 of 14 jobs green, about 135 billable minutes. `node` took 15.9 of 20 minutes, past the 15-minute line of 8A's Stage 1b amendment 1, so its timeout became 25 test-first (`338a841a`, `1f0510b9`; `docs/tdd/phase8-orchestrator.tdd.md`).

**Acceptance.** 17 of 20 lines are ticked; a tick means no known item stays open against the line and its tests passed in this validation. Open: **Cases**, K8-27's three named problems, which Phase 9's 9B takes; **Console**, loop and module authoring (raw JSON only today), which Phase 9's 9C takes in the shared graph editor; **Process** was ticked after CI 41802158981 passed this close's push (`3cc18901`): 14 of 14 jobs green, about 140 billable minutes. `node` took 21.3 of its 25 minutes, inside the last 25% again, so 9A's foundation splits it (its CI step reads the latest green run).

**Owner items (defaults taken; nothing blocks).** Every default is marked in the plan's 8C and 8D sections. These matter most:
1. **Case emails** are link-only, tried at most three times with a 5-minute lease, and dropped where no SMTP server is set.
2. **A declined inquiry's face-data deletion** does not redact a case's image attachments; the C16 pass does when the selfie inquiry's biometric data is redacted.
3. **An export** holds at most 64 MiB, and a running export is reclaimed after a 15-minute lease.
4. **The assignment drain** runs every 60 s in batches of 100 policies and 50 cases.
5. **The format gate** (8B owner item 6): `.prettierignore` still hides `apps/api/src/services` from `pnpm format:check`.

**Carried forward:**
- **To Phase 9** (its plan's "Phase 7 and 8 outcomes" section): K8-27 (9B); loop and module authoring (9C); Phase 7's two console items, `RelationForm`'s raw target and a redacted transaction's relations alert (9D).
- **To Phase 11:** a full-stack Trust Device spec (R006: it needs device recognition on for the shared e2e environment), metrics (K8-9: no metrics facility exists), the flow bundle budget (K8-25), a multi-page guarded PDF task (K8-32), a unit test of the wait-event form (8D's R007), and the C78.7 budgets.
- **The date items (C67):** pypdf 6.21.2 from 2026-11-04T16:45Z with R011; pypdfium2 waits for a release bundling PDFium 8125 and the owner's HarfBuzz answer.
- **For operators:** after upgrading, run the migrations (`0029_phase8d`).

**Next:** the pypdf bump with R011 in the gap after 2026-11-04T16:45Z, then Phase 9 (Workflow 9A).

## 2026-11-03: Phase 8, Workflow 8B done (cases)

Workflow 8B (`367560b4..90f71b39`, 198 commits; 13 agents, none errored) built cases, in one Claude Code run, `wf_7f0ba238-c58`, from 01:32Z to 16:00Z. The plan's 8B amendment sections (items 1 to 118 of contracts-8b's and integration-8b's numbering) are the record, and each agent's evidence is in `docs/tdd/phase8-*.tdd.md`.

| Item | What landed |
|---|---|
| Cases | Versioned templates with statuses in the public categories, resolutions and the Phase 7 field-schema union; cases with sealed fields and their keys, held objects with their attached state, comments with mentions, tags, timelines, search compiled to parameterised SQL with the `fields.*` PII rule, bulk actions with one outcome per case, notifications |
| Queues and SLA | Queues and members, assignment policies, the pull and the reassign sweep, SLA timers in business time with calendars, `case.sla-expired` |
| Files | Attachments typed by their magic bytes, the sandbox scanner and our own clamd client, metadata-free renditions from the vision service (`POST /v1/renditions`), exports (CSV neutralised, JSON masked, 24 hours), print |
| Workflows | Case actions and available actions, the case trigger, `current_case`, the eight case steps with an exactly-once test, the review request, the "Review on report match" recipe, the graph's "create case" |
| Records | Redaction and retention of cases and their copies, `docs/cases/` (nine pages), migration `0028_phase8b`, 13 prefixes, 10 scopes, four case rate-limit policies |

**Reports.** Seven agents reported done and six partial. Each partial named a gate that was red on another agent's work in progress or a join in another agent's file, and `integration-8b` closed them: the review recipe was refused at publish until the engine typed a case, bulk actions stayed `pending` because the worker gave their job no publisher, attachments were missing from the case's own routes and from its redaction, and `create_case` failed instead of waiting at its rate limit. Its specs found one more: a webhook filtered by case template never received a case event, because `toEventSubject` dropped the template.

**TDD.** Stub, RED, GREEN held for most slices. The gaps are named in the TDD files: one route service of `api-case-files` was written before its test and moved aside for the RED run, and several commits went in red or with a lint error and were fixed in the next. Plan item 47's three rendition join tests are not written (carried). No test was weakened.

**The format gate.** The inventory found `api-cases`' uncommitted prettier rewrap of one test, which led to an older gap: `.prettierignore`'s bare `services/` and `data/` match at any depth, so `pnpm format:check` has never checked `apps/api/src/services` (434 files, 101 unformatted) or `packages/checks/src/data` (16). The test is `ff46c20f`. The fix, anchoring both and keeping `packages/*/data/` out, was refused by a config-protection hook that guards `.prettierignore` in this environment, so `493eea11` reverts the test and the fix waits for the owner (item 6 below). No behaviour depends on it.

**Validation** (the plan's list) on `493eea11`, which holds the same tree as `90f71b39`, a full run on the first pass, every step rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` | pass |
| TypeScript unit (16 packages, `--force`, one call) | 29,196 tests in 20 min 37 s, none skipped. Statements / branches: api 8,137 at 94.58 / 85.55; dashboard 4,811 at 97.93 / 92; db 1,982 at 93.05 / 85.59; workflow-engine 98 / 92.29; contracts 99.3 / 93.56; core 99.83 / 98.4 |
| Integration (Testcontainers) | db 73; api 250 (the graph project included); 307 s |
| Vision | 2,600 tests in 8 min 54 s; ruff, mypy |
| Android | SDK 1,334 host tests, 0 failed or skipped (read from the XML results); Kover gate; assemble; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 79 mocked flow specs; 117 full-stack tests in 13.9 min, none skipped |
| Images (apps, vision, code runner), benchmarks (selfie median 0.43 s, government ID 2.64 s, document 1.68 s, each within its budget; workflow engine 48 effectful and 205 control-flow steps a second at 32 clients, reported), infra tests (CI contract 219, code runner 55, compose 531, apps image context 43, vision container 55, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11), gitleaks (4,553 commits) | pass, no leaks |

**CI.** The push of `367560b4` (Workflow 8A) ran as CI 41557289819: 14 of 14 jobs green, about 132 billable minutes. `unit-api` shard 1 took 22.3 of its 30 minutes, so `integration-8b` raised each `unit-api` shard to 40 minutes. `node` took 14.3 of 20, under the 15-minute line that would have raised it (8A Stage 1b amendment 1).

**Owner items (defaults taken; nothing blocks):**
1. **Item 73:** replacing a queue's members unassigns their open cases of that queue at once (reason `member-left`).
2. **Item 66:** a workflow run's copy into a case empties that case's fields rather than redacting the whole case.
3. **Item 80:** a scan that errored answers a plain 409, and an unscannable original is not served even to `cases:redact`.
4. **Item 81:** an export's selection is frozen as case ids when it is asked for.
5. **Items 85 and 86:** `set_case_sla` refuses a case in a pausing status; a review request uses the case template the newest decline names, and answers 409 when none does.
6. **The format gate:** anchor `services/` and `data/` in `.prettierignore` and add `packages/*/data/`, then run `pnpm exec prettier --write` on what `prettier --list-different .` lists; `ff46c20f`'s test checks it. It needs the config-protection hook allowed for that one edit.

**Carried forward:**
- **To 8C's known list:** item 107 (HIGH: 8A's `fetch_object` returns a shape other than the one publish checks, so a route on it silently takes `else`), item 77's lock order (a deadlock answers 500), and items 102 to 117: the held-kind includes, case emails (none is sent yet), P22's attachment retention, P19's audit schemas, the status hook's publisher, a drain job for policies, sweeps for stuck exports and renditions, the three rendition join tests, batching `GET /cases` (about 1,700 queries for a page of 100), and smaller items.
- **The date items (C67):** unchanged. pypdf 6.21.2 from 2026-11-04T16:45Z, with R011.
- **For operators:** after upgrading, run the migrations (`0028_phase8b`); the compose `app` profile passes the scanner's name to the API.

**Next:** Workflow 8C (console, review, fixes), on this commit.

## 2026-11-03: Phase 8, Workflow 8A done (the workflow engine and its actions)

Workflow 8A (`0d27c8f5..75a51121`, 299 commits; 14 agents, none errored) built the engine and its actions, in one Claude Code run, `wf_0991854a-3a6`, from 04:43Z to 23:57Z on 2026-11-02. The plan's amendments 1 to 128 are the record, and each agent's evidence is in `docs/tdd/phase8-*.tdd.md`.

| Item | What landed |
|---|---|
| Foundation | `packages/workflow-engine`, 13 prefixes, 10 scopes, the `workflow_run` actor in every table and reader that pins one, 17 problem codes, ADR 0007, `0027_phase8a`, the `readCsv` move, and the frozen routes that Stage 3 filled |
| Engine | The graph check, canonical hash and upgrades, our JSONLogic dialect, templates and sinks, variable scope and taint, `advance`, fenced claims, leases, waits, joins, loops, modules, retries, timers, one run per subject |
| Workflows and runs | Drafts, versions, publish with its grant and every C116.4 rule, rollout, restore, promote, the diff, cancel, resume, rerun, test runs, run redaction and retention |
| Triggers | Event, API, manual, recurring, scheduled, verification and account triggers, with loop guards |
| Actions | The C127 object actions, the C128 decision record and gates, the list re-screen, transaction children, Trust Device, the reopen, the contest route |
| Egress | HTTPS with the guard, secrets, email, SMS, Slack and the sealed sandbox lists, and Evaluate Code in a QuickJS sandbox: the `code-runner` pool, its child entry, its image and a compose service with no network |
| Docs and CI | `docs/workflows/` (14 pages, three generated and checked by a test), `docs/compliance/automated-decisions.md`, the infra job runs `code-runner.test.sh` whole, the SDK host-test floor is 1,334 |

**Reports.** Eight agents reported done and six partial. Every partial named a blocker that `integration-8a` then cleared, and the validation below is what shows it: no action ran in a real worker until the handler tables, egress settings, secrets at publish and the API's step producer were wired; four load-sensitive tests failed under load (`pool.test.ts`, `card-guard.test.ts`, `platform.integration.test.ts`, `currentPrompt` in `e2e/tests/support/flow.ts`); and stored API logs left `data.parameters` and `prefilled-value` unmasked.

**Defects found and fixed before the close (plan amendments 98 to 120):** a `find_or_create_account` value in the plain `reference-id` column, a child inquiry's biometric objects left in storage after a redaction, an idempotency fingerprint that held a digest of `secret-value`, an Evaluate Code `source` read as a template, and the API-log gap above are the ones that touch PII or secrets.

**TDD gaps disclosed by the agents:** `api-actions`' 26 handlers were written beside their tests and never ran RED against a stub. `api-engine`'s waits, redaction, retention and sweep tests went in with their GREEN commits, and its run-route RED was never observed. `api-egress`'s messenger, message handlers and Evaluate Code took their RED afterwards, through a stub put in for one run. `api-workflows`' publish, rollout, promote and sweep, and `engine-logic`'s scope, taint, sinks and graph check, were drafted first, then moved aside so the RED runs are real; their tests did not drive the design. `foundation-8a`'s `InTx` forms are a refactor and have no RED. Several agents' commits went in red or with a lint error because the commit was chained to a run, and each is fixed in a later commit and named in its TDD file. No test was weakened.

**Throughput is reported, not gated, and is well below the research figure.** The real executor in one Node process did 50 effectful and 213 control-flow steps a second at 32 clients. The research note's 1,577 and 2,880 were bare pgbench statements, so the plan's capacity reasoning used numbers one process cannot reach. Fewer reads per step and one job claim per run row are the likely gains; neither is measured.

**Validation** (the plan's list) on `75a51121`, a full run on the first pass, every step rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` | pass |
| TypeScript unit (16 packages, `--force`, one call) | 27,819 tests in 18 min 29 s, none skipped. Statements / branches / functions / lines: api 7,675 at 95.08 / 86.17 / 96.8 / 95.16; workflow-engine 1,926 at 98.01 / 92.32 / 99.1 / 98.19; db 1,814 at 92.94 / 85.58 / 93.37 / 93.08; every other package at or above 94.97% statements |
| Integration (Testcontainers) | db 69 tests in 15 files; api 247 in 42 files; 303 s together |
| Vision | 2,547 tests at 97.43% coverage in 8 min 37 s; ruff, mypy |
| Android | SDK 1,334 host tests, 0 failed or skipped (read from the XML results); Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 79 mocked flow specs; 113 full-stack tests in 13.0 min, none skipped |
| Images, benchmarks (selfie median 0.40 s, government ID 2.56 s, document 1.69 s, each within its budget), infra tests (CI contract 219, code runner 55 with its compose checks live, compose 527, apps image context 43, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (4,352 commits) | pass, no leaks |

The commit after `75a51121` changes only this file and the plan. Phase 8's acceptance lines stay unticked until 8C closes the phase.

**Owner items (defaults taken; nothing blocks).** Every default is marked in the plan. These matter most:
1. **Amendment 111:** `find_or_create_account` on a declared field finds through a keyed digest, so a rotated blind-index key finds nothing and creates a new account rather than merging.
2. **Amendment 82:** a child verification redacts its whole inquiry, because no verification-level redaction exists. That is wider than C127.7 reads.
3. **Amendment 38:** an unfinished run reached by a redaction ends `errored` with `subject_redacted`, and an overflowed run ends on any redaction in its environment.
4. **Amendment 49:** `PUT /draft` refuses an unfinished graph, so the 8C editor keeps unfinished work client-side. If drafts should save half-built, this changes before 8C.
5. **Amendments 16 and 17:** `{"===": [x, true]}` with `x` null follows `on-null`, and a condition that only tests a path needs no `on-null`.
6. **Amendment 19:** a `while` at `max-iterations` fails rather than stops, and a failed loop or parallel waits for what is still running.
7. **Whether 50 effectful steps a second in one process is enough** for a first release.

**Carried forward:**
- **To 8C's known list (`K8-6` to `K8-15`):** plan amendment 126's seven items, branch coverage of `workflows/engine` and `workflows/runs` (79.59% and 73.42% in `api-engine`'s run, before Stage 4; neither fails a gate), the null-actor CHECK clauses (Stage 1a amendment 16), and a test that every `$ref` in the OpenAPI snapshot resolves.
- **The console for 8C:** list purpose, device trust, adverse statuses, contest routes, `publisher_scope_lost`, the `publisher_revoked` banner and a run's audit link.
- **The date items (C67):** unchanged. pypdf 6.21.2 from 2026-11-04T16:45Z, with R011; nothing of 8A depends on them.
- **For operators:** after upgrading, run the migrations (`0027_phase8a`).

**Next:** Workflow 8B (cases), on this commit.

## 2026-11-02: Phase 7 done (Workflow 7C: console, review, fixes)

Workflow 7C (`2f276d9b..3cd74e2a`, 189 commits; 10 agents, none errored) built the console half of Phase 7, reviewed the whole phase and fixed what the review and the 7A and 7B known lists held. It ran as two runs: `oc_mvy4ueqi-67ccca` (OpenCode, from 17:57Z) was stopped cleanly at 19:21Z before its API key ran out, with its work committed, and the continuation `wf_0fd8acbd-ebc` (Claude Code, 19:28Z to 02:02Z, 6 h 35 min) resumed the three console agents from orchestrator notes and ran the reviewers, the verifier and both fixers as planned. Evidence is in `docs/tdd/phase7-dashboard-{signals,lists-transactions,graph}.tdd.md` and `phase7-review-fixes-{api,console}.tdd.md`; every deviation is in the plan's "Workflow 7C ... amendments" sections.

| Item | What landed |
|---|---|
| Console (C108) | Signals, sessions, devices, list matches, template versions, network sources, settings and audit; lists, items, imports, transactions and the type editor; the graph explorer with its table view, CSP test and exports |
| Reviewed fixes | All 41 known items (`knownOpen` is empty, checked against both fixers' `fixed` lists), among them the five HIGH: `K7A-1` a session-cap expiry leaves no canceled capture's object, `K7A-2` email handoff proven end to end through Mailpit, `K7B-1` redaction reaches transactions, `K7B-2` the account's graph component, `K7C-1` a verification from a rejected handoff is marked |
| Review | 12 findings (0 CRITICAL, 5 HIGH, 3 MEDIUM, 4 LOW). R001 to R004, R006 and R012 fixed; R005 refuted and unchanged; R007 half done; R008 to R011 left at LOW |
| Migrations | `0025_phase7c` (the file index, K7B-5) and `0026_transaction_relations_page_index` (K7C-2) |

**Orchestrator, closing 7C** (`3cd74e2a..` this entry; `docs/tdd/phase7-orchestrator.tdd.md`):
- **The CI-only failure fixed before validation** (`953be170` RED, `770b5823` GREEN), so the validated commit holds it. The custom-list test needed `data/` files that a clean checkout does not have. The report job now takes `ReportJobDeps.matcherData`, and the test injects synthetic data, including a list it cannot read.
- **The hidden-data sweep.** All 15 unit suites passed in a tracked-files-only worktree of `770b5823` in 16 min 56 s, nothing cached, and the same worktree with the pre-fix files reproduced CI's failure. So no other unit test needs a fetched file.
- **K7C-2: a transaction's relations are served and shown** (7 commits, `docs/tdd/phase7-transaction-relations.tdd.md`). C108 names relations on the transaction page, which could set and remove them but not list them, and no known item covered it. `GET /transactions/:id/relations`, the resource `transaction-relation`, `@openverify/node`, the console's list and an e2e that sets one and removes it. On 100,000 relations the migration takes a page from 19.5 ms to 0.06 ms.
- **Records.** The console fixer's seven amendments went into the plan, whose placeholder had been waiting for them, and the Phase 7 acceptance lines are checked (below).

**Acceptance.** All 15 lines are ticked. A tick means no known item stays open against the line and its tests passed in this validation, not that every sub-line was walked again by hand. The Process line was ticked once CI had passed the pushed commit. Each of the five HIGH items was traced to a test in this run, and the plan lists them.

**Findings left open:**
- **R005, unchanged (owner to confirm):** an address with no AS record reads `low` at capped confidence 0.5. The verifier refuted the finding at 0.72 on the full text of C93.4, the API fixer agreed, and `lookup.test.ts` pins it.
- **R007, half done:** the graph benchmark's docs now say what its figures measure. Its figures come from tiny neighbourhoods and do not yet support the plan's caps; dense scenarios are Phase 11's.
- **R008, R009, R010:** Phase 11 hardening, as the plan's "Later phases" states.
- **R011:** `jsdom` becomes an exact pin in the pypdf gap, so the close does not move the validated commit.

**TDD gaps disclosed by the agents:** `5c8c9d3e` landed 21 minutes after the inquiry page's GREEN `aaf059bc`, so that commit holds a stub; the RSC payload test has never been seen failing on a leaked value; its network sources test has no positive control; `ui-signals` has never been seen RED. K7A-8-console and K7B-11-console had no behaviour left to fix, so their tests are guards with no runtime RED. None of these is a known defect.

**CI.** The push of `2f276d9b` ran as CI 41334061210: 12 of 14 jobs green, and the new `lint` job's first run passed. Only `unit-api` shard 1 failed, on the CI-only test above, so `unit-api-coverage` was skipped. The push of `f8c488ad` then ran as CI 41387332060, the first CI run of that fix, of K7C-2 and of 7C's code: 14 of 14 jobs green in 18 minutes, about 125 billable minutes, so Phase 7's Process line is ticked too.

**Validation** (the plan's list) on `f606062c`, a full run on the first pass, every step rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` (119) | pass |
| TypeScript unit (15 packages, `--force`) | 23,145 tests in 14 min 42 s. Statements / branches / functions / lines: api 5,964 at 95.66 / 87.16 / 97.7 / 95.71; dashboard 4,782 at 97.95 / 92.02 / 98.31 / 97.92; checks 3,791 at 98.78 / 91.64 / 99.41 / 98.76; contracts 2,665 at 99.13 / 92.99 / 98.53 / 99.12; db 1,543 at 94.79 / 87.49 / 95.99 / 94.97; core 1,186 at 99.92 / 98.34 / 100 / 99.92; flow 1,096 at 95.47 / 89.4 / 96.26 / 95.49; watchlist 819 at 98.63 / 90.2 / 99.15 / 98.61; node 321; emrtd 318; signals 192; config 187; flow-spec 117; e2e helpers 110; ui 54; every package at or above 80% |
| Integration (Testcontainers) | db 69 tests in 15 files (97 s); api 217 in 36 files (276 s) |
| Vision | 2,547 tests at 97% coverage in 8 min 50 s; ruff, mypy (78 files) |
| Android | SDK 1,333 host tests, 0 failed or skipped (the CI floor); demo tests; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 79 mocked flow specs in 25.5 s; 109 full-stack tests in 11.5 min |
| Images, benchmarks (selfie median 0.41 s, government ID 2.54 s, document 1.68 s, each within its budget), infra tests (CI contract 217, compose 468, apps image context 43, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (4,051 commits) | pass, no leaks |

The commit after `f606062c` changes only this file and the plan.

**Owner items (defaults taken; nothing blocks):**
1. **R005**, above.
2. **Which actions need a confirmation.** Redaction, biometric redaction, detaching an object and archiving a type are confirmed. Changing a status, adding a label, attaching objects, setting or removing a relation and editing tags are plain submits. If "each behind a confirmation" was meant literally, those five gain a confirmation (`dashboard-lists-transactions` item 4 in the plan).
3. **Console memory.** The dashboard now reads a transaction file and a graph export whole before answering, instead of streaming (amendment 29), so one download can hold up to 20 MB there.
4. **`TRANSACTION_LIMITS.fileMaxBytes`** stays 20,000,000 bytes, provisional.

**Carried forward:**
- **The date items (C67):** pypdf 6.21.2 from 2026-11-04T16:45Z, with R011; the first pypdfium2 with PDFium 8125 or later, once it is 14 days old.
- **The C78.7 budgets:** unchanged, open for Phase 11 (C271).
- **The C100.6 CSV writer has two copies,** in `components/lists/csv.ts` and `packages/checks/src/csv/`; a rule change must land in both.
- **Console, for Phase 9:** the options of `RelationForm` print the raw target, and a redacted transaction's alert does not say that its relations stay.
- **For operators:** after upgrading, run the migrations (`0025_phase7c`, `0026_transaction_relations_page_index`).

**Next:** Phase 8 (Workflow 8A). The pypdf bump lands with R011 in the first gap between Workflows after its date, and 8C's known list holds both C67 date items until then.

## 2026-11-01: Phase 7, Workflow 7B done (lists, graph, transactions)

Workflow 7B (`919c95b3..7d25d079`, 236 commits; 12 agents in 10 roles, none errored) built the lists, graph and transactions half of Phase 7. It ran as two runs: `wf_1d1d87f2-ab4` (Claude Code, 2026-10-31 19:57Z) stopped on the account's weekly usage limit at about 03:25Z with four agents done and four mid-work, all of whose work was already committed. The continuation `oc_mvxb21o2-e97f02` (OpenCode, 04:03Z-12:13Z) embedded the four finished reports, resumed the four stopped agents from orchestrator notes, and ran the other four as planned. Each agent's evidence is in `docs/tdd/phase7-<agent>.tdd.md`, and every deviation is in the plan's "Workflow 7B ... amendments" sections.

| Item | What landed |
|---|---|
| Lists (C97, C98, C99, C106.2) | Lists of every C97 kind with key inputs and golden vectors (`packages/checks/src/lists`, the name kinds in `packages/watchlist/src/list-keys`), items, on-demand and screening matches with tiers, `on-list-match`, `list_match_count`, list-config publish rules, compromised-ID lookup, item retention, the 1,000,000-item benchmark |
| Biometric lists (C97.4, C99.7) | Face and background lists through vision's new `/v1/mask/background`, with the embed job, cache, matcher and redaction |
| Importers (C100) | CSV imports, strict decoding, sealed staging applied through the list writer under the row lock, sweep and purge, the `importers` policy, the OWASP-safe CSV writer |
| Transactions (C104, C105) | Transaction types as versioned schemas with the pure engine (`packages/core/src/transactions`), ajv strict publish, transactions with sealed fields, append-only history and labels, objects, relations, files, filters, redaction and retention |
| Graph (C101-C103) | In-transaction indexing, components, query templates and queries with sealed parameters, the `graph-unmask` policy and export |
| Custom-list report (C106) | The report type, job, completion case and seeded template |
| Migration | `0024_phase7b` (one file for the Workflow) |

Integration-7b found and fixed five defects test-first: platform-file ids read `fil_` instead of `file_`; a multipart part's filename leaked into stored API logs; a deeply nested type body answered 500; the radius allowed 0.5; and an import could skip itself, because the producer wrote `enqueued_at` after adding the job that `SKIP LOCKED` then met.

**Orchestrator, closing 7B** (`7d25d079..` this entry; `docs/tdd/phase7-orchestrator.tdd.md`):
- **Integration fixed before the push.** Four full runs of `pnpm test:integration` each failed one different file: three Testcontainers Postgres starts refused their first connection or never bound their port, and once `graph-engine.integration.test.ts` overran its 180 s hook building a 100,000-account graph. Each file passed alone. Fixed test-first (`65ee106e..7b31ce17`): one start helper, `startIntegrationPostgres`, polls a real `select 1` and starts a fresh container after a failed start (K7B-13, now off 7C's list); and, as owner decision 17 provides, the C102.8 graph is built once into a template database by a global setup, and the test copies it (its hook went from 139.9 s to about 5 s under the full suite; no guard raised, no case cut). Integration then passed twice in a row.
- **CI heap:** lint moves to a job of its own, one package at a time under a 4 GB heap, and typecheck runs two at a time under the same heap (measured peaks: lint api 3.35 GB, contracts 2.85 GB).
- **nodemailer 10.0.15 to 10.1.6** (C67), test-first, past the three address-parser advisories fixed in 10.1.4. 10.1.7 was not yet 14 days old in the gap.

**Owner decisions:** "## Owner decisions after Workflow 7B" in the plan holds 21 decisions; the main ones: redacting an account or an inquiry reaches its transactions (except `never` fields); a new `GET /accounts/:id/graph-component`; version list routes for transaction types and graph templates; the face and background list thresholds and the 2,000 fuzzy-name candidate cap stay provisional until Phase 11's calibration, and over the cap a list reads `unscreened`, never "no match". 7C's known list holds 38 items after K7B-13's fix (5 HIGH: `K7A-1` orphaned selfie objects, `K7A-2` the email handoff not proven end to end, `K7B-1` redaction not reaching transactions, `K7B-2` and its console twin, the account graph component), plus the three built into the 7C script (`K7C-1`, its console half, `K7A-8`'s console half). These lines of the Phase 7 acceptance stay open until 7C.

**Harness (2026-11-01):** the owner moved orchestration from Claude Code to OpenCode when Claude Code's limit stopped 7B. The Workflow scripts run unchanged under either through `resume/harness/run-workflow.mjs`, and the build state lives in harness-neutral files, so either can continue the build.

**CI.** The push of `919c95b3` (Phase 6 and 7A) ran as CI 41257053492: 12 of 13 jobs green, about 95 billable minutes. Only `node` failed: `@openverify/contracts#lint` exhausted Node's default 2 GB heap on the runner (exit 134), so that job's typecheck and non-API unit tests did not run on GitHub until this push. The fix above goes with this push, and that run is the first check of the new `lint` job.

**Validation** (the plan's list) on `7d25d079` (full run), then every step the closing commits could affect on `d90eff26` and `7b31ce17`, every step rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` | pass |
| TypeScript unit (15 packages, `--force`) | 22,063 tests in 13 min 23 s. Statements / branches / functions / lines: api 5,871 at 95.6 / 87.04 / 97.62 / 95.64; dashboard 3,971 at 98.71 / 93.48 / 99.15 / 98.72; checks 3,791 at 98.79 / 91.66 / 99.41 / 98.76; contracts 2,616 at 99.12 / 93.67 / 98.52 / 99.11; db 1,512 at 95.24 / 87.4 / 96.8 / 95.42; core 1,178 at 99.92 / 98.46 / 100 / 99.92; flow 1,088 at 95.27 / 89.27 / 95.74 / 95.28; watchlist 759 at 98.63 / 90.2 / 99.15 / 98.61; emrtd 318; node 305; config 187; signals 186; flow-spec 117; e2e helpers 110; ui 54; every package at or above 80% |
| Integration (Testcontainers), on `7b31ce17`, twice in a row | db 69 tests in 15 files; api 217 in 36 files (293 s and 308 s); the graph-engine hook 4.5 to 5.3 s |
| Vision | 2,547 tests at 97.43% coverage in 8 min 39 s; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,327 host tests, 0 failed (the CI floor); demo tests; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 79 mocked flow specs in 30.3 s; 99 full-stack tests in 10.4 min |
| Images, benchmarks (selfie median 0.40 s, government ID 2.57 s, document 1.66 s, each within its budget), infra tests (CI contract 209, compose 468, apps image context 43, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (3,837 commits) | pass, no leaks |

On `d90eff26` (the CI change and nodemailer): install, format, lint, typecheck, the API suite (589 s), the full-stack e2e (738 s, 99 tests), the apps image, infra and gitleaks, rc=0. On `7b31ce17` (the integration fix): lint and typecheck (30 of 30), format, api 5,880 unit tests at 95.61% lines, db 1,525 at 95.17%, `benchmark:typecheck`, `benchmark:test` (119), infra and gitleaks (3,851 commits), rc=0.

**Carried forward:**
- **The date items (C67):** pypdf 6.21.2 from 2026-11-04T16:45Z, in the first gap after that; the first pypdfium2 with PDFium 8125 or later, once it is 14 days old.
- **The C78.7 budgets:** unchanged, open for Phase 11 (C271).
- **For operators:** after upgrading to 7B, run the migrations (`0024_phase7b`).

**Next:** Workflow 7C (console, review, fixes).

## 2026-10-31: Phase 7, Workflow 7A done (signals, network data, device handoff)

Workflow 7A (`0a8d60ed..ce772d10`, 289 commits; run `wf_f1c962a5-c59`, 13 agents in 10 roles, none errored, 14.8 h) built the signal, network and handoff half of Phase 7. Each agent's evidence is in `docs/tdd/phase7-<agent>.tdd.md`, and every deviation is in the plan's "Workflow 7A ... amendments". The orchestrator's closing fixes are in `docs/tdd/phase7-orchestrator.tdd.md`.

| Item | What landed |
|---|---|
| Signals (C90, `packages/core`, `packages/checks`) | A registry of 13 signals, each with its tier, stage, version and provisional thresholds, and a frozen enum of null reasons. Values are computed from stored facts by an outbox job after completion. `on-signal` only ever moves `completed` to `needs_review` |
| Network data (C92, C93, C106.1) | `packages/signals` parsers, interval sets and MMDB reads over operator-synced data; the sync on one shared runner, with the watchlist sync moved onto it and its tests unchanged; the `ip-address` report |
| Collection (C94) | A browser collector of 3,875 B gzipped against a 4,096 B budget. It reads nothing before consent, and session integrity needs its notice. Android signals, with a build-breaking guard against reading hardware ids |
| Sessions and devices (C91) | Network and device facts on sessions, device routes masked without `pii:view`, the session cap, `expire-all` by inquiry, and migration `0023_phase7a` |
| Handoff (C96) | QR, email and SMS handoff with single-use tokens, a preview that consumes nothing, the phone's own consent, a locked desktop, and "this was not me". The flow uses `lean-qr`, the smallest measured |
| Default template | Flow metadata v3 shows `notice.session-integrity`, so session integrity collects by default |
| Test tooling | A reusable e2e stack (`e2e:stack:up` / `e2e:stack:down`, `OPENVERIFY_E2E_REUSE_STACK=1`), run in three shards |

Integration-7a found and fixed four defects: creating an `ip-address` report answered 500; the last screen's signal body arrived after completion, so `bot_score` always read `collector_missing` on a one-step flow; the flow offered a retry after a non-retryable failure; and a redaction test matched a worker pid against a birth year.

**Orchestrator, closing 7A** (`ce772d10..` this entry):
- Three unit tests failed only at a load of 47 (a wall-clock budget, two 60 s hang guards), and were fixed so they no longer measure the machine.
- One full-stack test failed when the Docker stack stalled for about five minutes: the object store refused an upload and Valkey timed out. No code changed. The cause is inferred, since another project's containers shared the machine.
- **A defect:** `.dockerignore` missed nested env files, so `e2e/.env.e2e` entered locally built apps images. Fixed test-first; no image has been published.
- The CI infra job now runs the flow headers contract's static half, and the PDFium CVE record is corrected (`docs/tdd/c67-dependency-bumps.tdd.md`).

**Owner decisions:** "## Owner decisions after Workflow 7A" in the plan holds 18 decisions, 22 known items for 7C (`K7A-1` to `K7A-17`, `K7C-1` and its console half, `K7A-8`'s console half, `D001`, `D002`) and the later-phase items. Three are HIGH: `K7A-1`, a session-cap expiry orphans a canceled selfie's storage objects; `K7A-2`, the email handoff is not proven end to end; and `K7C-1`, reviewers cannot see which verifications came from a rejected handoff. These lines of the Phase 7 acceptance stay open until 7C.

**Owner order change (2026-10-31):** "we need to parallelize stuff we can". 7B starts as soon as this entry is committed. The first November push carries this commit by its SHA while 7B runs, instead of holding 7B until the push. If that CI run finds a defect, the fix goes with 7B's push.

**Prepared beside the validation:** every later Workflow script (7B, 7C, 8A to 8C, 9A to 9D, 10A to 10E, 11A to 11G) was refreshed against 7A, and each passes its dry run at its expected agent count. What depends on 7B or later is marked in each script's notes. The refresh also confirmed that 7A left C271's starting point unchanged: the matcher path's diff since 6D is empty.

**CI.** Nothing since `9882aee3` has been pushed. October's minutes are spent, so CI on Phase 6 and 7A is read after the push.

**Validation** (the plan's list). A full run on `ce772d10`, then the steps these fixes could affect on `e8d93f55`. Every step below answered rc=0:

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck`, `benchmark:test` (119) | pass |
| TypeScript unit (15 packages, `--force`, on `e8d93f55`) | 19,631 tests in 11 min 52 s. Statements / branches / functions / lines: api 4,963 at 96.17 / 88.36 / 97.93 / 96.21; dashboard 3,945 at 98.71 / 93.47 / 99.15 / 98.71; checks 3,464 at 98.74 / 91.51 / 99.38 / 98.72; contracts 2,283 at 98.98 / 94.53 / 98.27 / 98.97; db 1,194 at 95.39 / 88.75 / 96.59 / 95.65; flow 1,088 at 95.27 / 89.27 / 95.74 / 95.28; core 787 at 99.85 / 97.33 / 100 / 99.85; watchlist 718 at 98.62 / 90.18 / 99.14 / 98.6; emrtd 318 at 94.97 / 87.25 / 98.5 / 94.96; node 253 at 98.87 / 94.06 / 100 / 99.13; signals 186 at 96.31 / 91.08 / 98.68 / 96.18 |
| Integration (Testcontainers) | api 172 in 31 files, db 65 in 14 files (5 min 31 s) |
| Vision | 2,533 tests at 97.42% coverage in 11 min; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,327 host tests and 18 demo tests; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright (on `e8d93f55`) | 79 mocked flow specs in 22.7 s; 95 full-stack tests in 10.2 min |
| Images, benchmarks (selfie median 0.50 s, government ID 3.15 s, document 1.98 s, each within its budget), infra tests on `e8d93f55` (CI contract 209, compose 468, apps image context 43, flow headers 11, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (3,599 commits) | pass, no leaks |

**Carried forward:**
- **The date items (C67):** nodemailer 10.1.7 from 2026-11-01T18:25Z, in the gap between 7B and 7C; pypdf 6.21.2 from 2026-11-04T16:45Z, in the first gap after that; the first pypdfium2 with PDFium 8125 or later, once it is 14 days old. PDFium build 8076 lacks the fixes for CVE-2026-110155 and CVE-2026-118345, behind the guarded child until then.
- **The C78.7 budgets:** unchanged, open for Phase 11 (C271).
- **For the owner:** the wording of the notice texts (en, es), on top of the items in each plan.
- **For operators:** after upgrading to 7A, run the migrations (`0023_phase7a`). Session integrity now collects on the default template.
- **On this machine:** the three 6D benchmark databases remain in the `openverify_postgres-data` volume. The orchestrator was refused access to that volume, and they cost only disk space.

**Next:** Workflow 7B (lists, graph, transactions), then 7C (console, review, fixes).

## 2026-10-30: Phase 6 done, with Workflow 6D (closure: matcher latency, the re-screen, the redaction guard), and three budgets carried open

Workflow 6D (`9882aee3..dd1eeb98`, 101 commits besides the planning docs; runs `wf_665f5bdb-6c8`, stopped for a re-login at 12:35, then the continuation `wf_d2827c5c-42e`; 8 agents, none errored) closed Phase 6 under owner decisions 2 to 8 after 6C. Each agent's evidence is in `docs/tdd/phase6-<agent>-6d.tdd.md`, the calibration in `docs/calibration/watchlist-phase6d.md`, and the decisions in the plan's "Workflow 6D Stage 1 and 2 amendments" and "Workflow 6D review amendments".
- **Stage 1:** `matcher-6d`, `rescreen-6d` and `platform-6d`, in parallel.
- **Stage 2:** `calibration-6d`, alone on the machine (seed `9dd9b3530f47966b9f1b88e78445c08f`, drawn after the method commit `5c1420ca`).
- **Review:** two read-only reviewers. They found 2 issues: no CRITICAL, HIGH or MEDIUM, and 2 LOW.
- **Verify:** nothing to verify; the verifier recorded the Stage 1 and 2 amendments (`36836567`).
- **Fix:** `fix-6d`.

| Item | What landed |
|---|---|
| Screening latency (`matcher-6d`; decision 3) | Profile first, then remove repeated work, every created match identical. The 2,000,000-name profile's largest cost was the analysed-name cache's eviction, which read past deleted slots of a JavaScript Map; it now keeps its order in a linked list. Five new switches, all on and all kept by the calibration: `name-lru`, `token-cache` (a name token built once and shared), `indexed-matrix`, `ratio-check` (a pair whose relaxed alignment provably cannot reach the floor is refused before aligning it; full alignments on the slowest subjects fell from 4,208 to 5) and `token-pairs`. `token-memo` saved nothing and was removed. Namesake grouping and `jit = off` in `loadEntries` were not built: the profile does not support them |
| The re-screen (`rescreen-6d`; decision 4, review C004) | The key frequencies are one consistent set per re-screen (a source with at most 500,000 key rows is read whole, once), each pinned configuration is resolved once, one screening per candidate subject per page, and a name-bound check. C004: a `list_update` run reads its sync's changed entries page by page (at most 1,000 at a time), with the same matches. No JIT setting: no plan crosses `jit_above_cost` |
| The redaction guard (`platform-6d`; decision 5) | `transitionInquiryStatus` refuses a redacted inquiry's move to `pending`, `completed` or `failed`, so a redacted open inquiry is never settled but still expires: webhook consumers get `inquiry.expired`, never `inquiry.completed` or `inquiry.failed`. The sandbox actions answer 409. A Postgres race test covers both orders of each outcome, and the expiry sweep expires 503 inquiries with 501 redacted among them in one run. Phase 3's G002 carries a note |
| One table definition (`platform-6d`; decision 6) | `packages/watchlist/src/testing/heavy-headed.ts` defines the heavy-headed table once; the C78.7 gate and the benchmark both draw from it, and it rewrites the 6C seed's tables byte for byte. The gate keeps the 6C evaluation seed |
| Calibration (`calibration-6d`; decisions 7 and 8) | The bootstrap's list under test is fixed, so a drawn case counts every match it kept. Every observation carries the SHA-256 of its full created matches. **Identity: identical** in 70,500 (query, preset) pairs and in the 300 performance subjects at each scale. **Executed runs: kept** (626, 213 and 2,676 runs, each keeping a match on a changed entry; 0 missed of 2,637). Every 6D change is **kept**; nothing was reverted |
| Review fixes (`fix-6d`) | The two identity steps write distinct files. Migration `0022_watchlist_changed_page_index` reads a changed-entry page by index range instead of sorting the whole changed set (697 ms a page after a 51,592-entry sync at 2,000,000 names), with a Postgres plan test; the re-screen was re-measured after it and every verdict stands. The G002 note and the review amendments |

**The budgets** (owner decision 1 after 6C: none moves; a budget still missed is an open line carried to Phase 11):

| Budget | Base `9882aee3` | Head | Verdict |
|---|---|---|---|
| C78.7, 100,000 names, p95 100 ms | 354.3 ms | 180.9 ms | **missed**, +80.9 ms |
| C78.7, 2,000,000 names, p95 250 ms | 1,152.5 ms | 808.0 ms | **missed**, +558.0 ms |
| Re-screen, 1,000 changed entries and 200,000 subjects, 60 s | 208.2 s | 71.2 s (after migration 0022; 74.3 s before) | **missed**, +11.2 s |
| Re-screen total cost at 100 and 300 entries, no higher than the base | 88.6 s, 90.8 s | 42.5 s, 40.7 s | met |
| The C78.7 gate in `test:integration` (the 6C seed's table, timing asserted) | | p95 65.0 ms (median of three) | passes |

6D took the scoring down by 67% at both scales. At 2,000,000 names the p95 is now retrieval (594.8 of 808.0 ms), in the searches that reach the cap of 2,000 candidates or a pair of tokens out of reach; 6D did not change retrieval (decision 3). This seed draws a heavier table than the 6C seed's: the cap binds in 25 of 300 searches at 100,000 names, against none on the 6C table, where the head's gate measures 65.0 ms.

**Open lines of the Phase 6 acceptance**, carried to Phase 11's performance hardening (Phase 11 plan C271):
- "Matching meets the C78.7 budgets": missed at 100,000 and 2,000,000 names (retrieval at scale, the cap-reaching and out-of-reach pair lookups; list-name analysis stored at sync time).
- The re-screen within 60 s: missed by 11.2 s (its fixed part of about 25 s, the token-pair memo for the name bound).
- `result_truncated` at `tolerant` is 2.55% at 100,000 names and 1.80% at 2,000,000 on this draw, above the 1% target and identical at base and head. A truncated screening is still reported as truncated, never as no match (C78.5).
- Whether a later calibration judges C78.7 over several seeds is for the owner at Phase 11.

**Review LOW items, carried to Workflow 7C's fixers as known items:** D001, the re-screen's frequency reader repeats the table-size count on every call when a source is too large to read whole (`apps/api/src/jobs/reports/rescreen.ts`; correct, a small repeated cost); D002, the screening-level equivalence test of the new switches covers only person subjects (`packages/watchlist/src/match/shortcuts.test.ts`; the pair-level test covers businesses).

**CI.** Phase 6's pushes were green: run 40647828588 (6A, `6f88d72d`, 11 jobs), 40692785090 (the 6B check branch, `ec07bebe`, 13 jobs), 40736115726 (6B, `94ab63f9`, 13 jobs) and 40890257755 (6C, `9882aee3`, 13 jobs, about 93 billable minutes). October's minutes are spent, so 6D is pushed after the November reset, and CI is read when it finishes while Workflow 7A runs.

**Validation** (the plan's list, on `main` at `dd1eeb98`, one full run, every step rc=0):

| Suite | Result |
|---|---|
| Install, model and data fetch, `build:variant-groups`, format, lint and typecheck (`--force`), `benchmark:typecheck` | pass |
| TypeScript unit (14 packages, `--force`) | 18,307 tests, 14 of 14 packages (e2e helpers 97 included), in 9 min 36 s. Coverage (statements / branches / functions / lines): api 4,561 at 96.42 / 88.56 / 98.12 / 96.45; dashboard 3,924 at 98.71 / 93.48 / 99.15 / 98.71; checks 3,307 at 98.73 / 91.31 / 99.32 / 98.71; contracts 2,076 at 99.23 / 96.17 / 98.28 / 99.21; db 1,013 at 95.92 / 89.91 / 96.65 / 96.24; flow 1,012 at 96.35 / 89.91 / 96.96 / 96.39; core 771 at 100 / 97.6 / 100 / 100; watchlist 718 at 98.62 / 90.18 / 99.14 / 98.6; emrtd 318 at 94.97 / 87.25 / 98.5 / 94.96; node 250 at 98.87 / 94.06 / 100 / 99.13 |
| Integration (Testcontainers) | api 159 in 28 files, db 63 in 13 files (197 s), the C78.7 gate's machine-independent checks included |
| Vision | 2,532 tests at 97% coverage in 8 min 30 s; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,264 host tests and 18 demo tests, none skipped; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 69 mocked flow specs in 21.6 s; 91 full-stack tests in 9.6 min |
| Apps and vision images, benchmarks (selfie median 0.38 s, government ID 2.59 s, document 1.68 s, each within its budget), infra tests (CI contract 207, compose 431, apps image context 24, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (3,298 commits) | pass, no leaks |

The validation script now also builds the variant groups and runs `benchmark:typecheck`, as the Phase 7 plan's amended Validation list requires.

**Planned beside 6D** (2026-10-29): Phases 9, 10 (Android only) and 11, each with three adversarial reviews and a verification round (the table above). Their open owner items are recorded in each plan with defaults, so no build waits on them.

**Carried forward:**
- **The date items (C67):** nodemailer 10.1.4 or later on or after 2026-11-01; pypdf 6.21.2 or later on or after 2026-11-04; the first pypdfium2 with a PDFium build cut on or after 2026-10-20, once it is 14 days old. The orchestrator does them between Workflows.
- **For operators:** after upgrading to 6D, run the migrations (0022 is an index only); no re-key is needed (`KEYS_VERSION` is still `names-2`).

**Next:** the Phase 7 plan gains a "Phase 6 outcomes that amend this plan" section (no change signal, the redirect rule, the redaction guard for Phase 7's outboxes, the `report_type` CHECK migration, migrations from 0023, the frozen scorer and benchmark imports). Then Workflow 7A (signals, network data, device handoff), pushed with 6D after the November reset.

## 2026-10-29: Phase 6, Workflow 6C done (matching within reach of its budgets, false alerts measured, carried fixes)

Workflow 6C (`94ab63f9..7ced006b`, 197 commits; run `wf_f5b00ff4-1ba`, 10 agents, none errored) rebuilt retrieval and scoring for list scale, measured false alerts for the first time, and finished the items carried out of 6B. Each agent's evidence is in `docs/tdd/phase6-<agent>-6c.tdd.md`, and each stage's decisions are in the plan's "Workflow 6C …" sections.
- **Stage 1:** `evaluation-set-6c`, `matcher-6c`, `ingestion-6c` and `api-reports-6c`, in parallel.
- **Stage 2:** `calibration-6c` and `console-tests-6c`.
- **Review:** two read-only reviewers. They found 4 issues: no CRITICAL, 1 HIGH, 3 MEDIUM and no LOW.
- **Verify:** an adversarial verifier confirmed the HIGH finding.
- **Fix:** `fix-6c`.

| Item | What landed |
|---|---|
| Retrieval and scoring (`matcher-6c`; decisions 1, 3, 4, 13, 19) | **Retrieval:**<br>- A key is used alone only while at most a quarter of the cap (500 entries) holds it. Frequencies count live entries.<br>- Unordered pair keys cover every two keyed tokens, in each fold and through the variant groups (`KEYS_VERSION` `names-2`, re-key after upgrading).<br>- A pair whose keys are all over the bound records `truncated`, and is looked up up to the cap, so namesakes are still screened.<br>- The rare-key lookup is folded into one statement. The probes are fenced, retrieval runs with `jit = off` (JIT had cost up to 680 ms a statement at 2,000,000 names), and GIN pending lists are emptied after each sync.<br><br>**Scoring:** six switchable shortcuts, each with equivalence tests at every preset.<br><br>**Other:**<br>- The OSA typo rule (`scorer-2`).<br>- `lossy_script` from each source's own scripts.<br>- The variant-group file carries rigour's MIT notice.<br>- The re-screen prepares the changed entries once, screens each report at its pinned configuration, and inserts runs only where a match would be kept or cannot be decided, plus runs for stale evidence.<br>- The C78.7 gate on a heavy-headed list, with machine-independent assertions everywhere and timing only under `OPENVERIFY_C787_TIMING=assert` |
| Evaluation set (`evaluation-set-6c`; decisions 5, 7, 8) | A held-out population drawn from heavy-headed laws (listed persons and companies with one variant case each, and customers who are never listed), embedded in the 100,000- and 2,000,000-name performance tables. Every customer alert is false by construction; customers that no screening can tell apart are counted separately. The post-hoc analyses of 6B are committed steps (`typo-kinds`, `<scale>-unlisted`, `<scale>-compact`), which reproduce 6B's published figures exactly. The benchmark helpers are now inside the package's typecheck and test |
| Calibration (`calibration-6c`; `docs/calibration/watchlist-phase6c.md`) | Seed `e8223c34916200e2b8e51f0b47981804`, base `94ab63f9` against head `e880a9fc`, on byte-identical data. All five decisions are **kept**.<br>- **Recall:** every paired lower bound is at or above +0.0 pp, against a −1 pp margin. Persons at `tolerant` gain +14.3 pp at 100,000 names and +14.2 pp at 2,000,000.<br>- **False alerts per 1,000 at `tolerant`:** persons 186.7 → 174.0 at 100,000 names and 551.7 → 461.6 at 2,000,000; companies unchanged.<br>- **Transpositions:** 0 → 61 of 61 for persons in the 6B set.<br>- **Screening p95:** 282.8 → 109.5 ms at 100,000 names (budget 100 ms; a quieter run gave 93.0) and 1,529.9 → 399.4 ms at 2,000,000 names (budget 250 ms).<br>- **Cap and truncation at 2,000,000 names:** the cap binds in 129 → 6 of 300 searches, and `result_truncated` falls from 19 → 0 of 300.<br>- **Re-screen at 1,000 changed entries:** 97.7 → 91.0 s against 60 s, with runs 11,312 → 2,465 and none missed (0 of 2,429) |
| Ingestion (`ingestion-6c`; decisions 9, 10, 20, 21) | List memberships (OFAC's non-SDN lists) and a PEP relative's class. Both are risk data, hashed only when present, so records without them keep both 6A golden hashes. The change signal is removed; every check compares SHA-256. The stream's one redirect keeps scheme, host and port. The UN note says the list cannot be enabled in this release |
| Report API (`api-reports-6c`; decisions 9, 11, 12, 14-18) | The phone reasons `prepaid`, `payphone` and `other_line_type`. Review and dismissal need `pii:view` (403 otherwise). The sources document carries template names and types, the GDELT attribution and the matcher's state, and only the environment's own media figures, plus one install-wide flag. Decision 9's evidence is in the contract and the sealed snapshot. Every redaction writes a `redact` action naming its actor. There are three more Postgres races |
| Console and tests (`console-tests-6c`) | The sources page shows template names, the API's attribution and the matcher state. The coverage sentence of decision 6, "Other lists" and the related PEP's class, per-member query lengths, the redaction actor in the history, and the `pii:view` refusal in words. 31 Testcontainers files use `POSTGRES_TEST_COMMAND`. The order-sensitive db tests stamp their rows |
| Review fixes (`fix-6c`) | **C001 (HIGH):** the re-screen's entry and report id lists are bound 500 to a statement. A sync that changed more than 65,535 entries could never be re-screened, and monitoring stopped silently.<br>**C003:** decision 3's no-miss check is a committed step (`rescreen-check`). It was re-measured at `f19085a0`: 91.0 s at 1,000 entries, 0 missed.<br>**C002 (interim):** intervals that exclude their own point are marked.<br>**Builders' follow-ups done:**<br>- the worker passes the blind-index key;<br>- decision 9's evidence reaches the snapshots;<br>- the constants' sources cite the calibration;<br>- the benchmark's heap, step budget and cap columns;<br>- test hygiene;<br>- docs.<br><br>**C004 carried** (see the owner decisions) |
| Orchestrator | `shortcuts.test.ts` timed out at the full validation's load (90 to 157 s against 60 s). It now shares one baseline per preset and runs one pass per test, at most 3.8 s alone (`22d76091`, evidence `1d15b0a6`). Re-running the unit step then failed two other tests on wall-clock limits. Every C58.7 bound in `packages/checks` is now measured in CPU time with the existing `cpuMilliseconds`, with each budget unchanged: 12 tests; beside 24 busy loops the wall clock read 197 to 287 ms, against 89 to 102 ms of CPU and a 200 ms budget (`9a36c7af`, `f7323c35`). The flow's async waits allow 10 s instead of 1 s (`7705737a`). Evidence: `9bd3b71a`. Also: the master plan moves iOS to the next release (`91c83e02`), and the owner decisions after 6C and Workflow 6D are in the plan (`5177b275`) |

**CI.** October has one run left (see "CI minutes" below). It is used for the push after this entry.

**Validation** (the plan's list, on `main` at `9bd3b71a` (the full run on `7ced006b`, then format, lint, typecheck, unit and gitleaks again on `9bd3b71a`)):

| Suite | Result |
|---|---|
| Earlier runs | The full run on `7ced006b` failed only its unit step, on `shortcuts.test.ts` (four tests at 90 to 157 s against 60 s). The first re-run of the unit step, after the split, failed one wall-clock bound in `checks` (245.7 ms against 200 ms) and one 1 s wait in `flow`. Each was fixed test-first (see the orchestrator row) |
| Install, model and data fetch, format, lint and typecheck (`--force`) | pass |
| TypeScript unit (14 packages, `--force`) | 18,078 tests, 14 of 14 packages, in 646 s. Coverage (statements / branches / functions / lines): api 4,527 at 96.36 / 88.26 / 98.09 / 96.40; dashboard 3,924 at 98.71 / 93.48 / 99.15 / 98.71; checks 3,307 at 98.73 / 91.31 / 99.32 / 98.71; contracts 2,076 at 99.23 / 96.17 / 98.28 / 99.21; flow 1,012 at 96.35 / 89.91 / 96.96 / 96.39; db 995 at 95.90 / 89.94 / 96.63 / 96.21; core 771 at 100 / 97.6 / 100 / 100; watchlist 638 at 98.68 / 89.88 / 99.01 / 98.67; emrtd 318 at 94.97 / 87.25 / 98.5 / 94.96; node 250 at 98.87 / 94.06 / 100 / 99.13 |
| Integration (Testcontainers) | api 153 in 27 files (218 s), db 60 in 12 files (113 s) |
| Vision | 2,532 tests at 97% coverage in 9 min 2 s; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,264 host tests and 18 demo tests, none skipped; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 69 mocked flow specs in 37.7 s; 91 full-stack tests in 9.5 min |
| Apps and vision images, benchmarks (selfie median 0.47 s, government ID 2.77 s, document 1.72 s, each within its budget), infra tests (CI contract 207, compose 431, apps image context 24, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks | pass, no leaks |

**Owner decisions** (2026-10-29, under the standing approval; the plan's "Owner decisions after Workflow 6C", 10 items, revised after an adversarial review of the draft: 16 findings, 3 HIGH, all applied). **Phase 6 is not done after 6C.** The acceptance line "Matching meets the C78.7 budgets" is unmet. Two confirmed defects are open: review C004 (a `list_update` run holds every entry its sync changed) and a redacted pending inquiry that can still settle.
- **No budget moves (decision 1).** The draft raised the 2,000,000-name budget to 500 ms after 6C had measured 399.4 ms; the review called that moving it to fit, and it was withdrawn. The budgets stay at 100 ms, 250 ms and 60 s.
- **The stopping rule.** After Workflow 6D, a budget still missed is recorded as an open acceptance line with its profile. It is carried to Phase 11's performance hardening, now in PLAN §6. There is no further Phase 6 Workflow.
- **Workflow 6D closes Phase 6.**
  - `matcher-6d`: profile, then remove repeated work, every created match identical (namesake groups on every field the scorer reads).
  - `rescreen-6d`: the fixed cost (frequencies once, one array parameter, configurations resolved once), and C004 as page-wise runs with `keptOnly`, identical by construction and with no frequency prefilter.
  - `platform-6d`: the status UPDATE refuses a redacted inquiry moving to `pending`, `completed` or `failed`, so it still expires and the sweep is never held. One shared heavy-headed table serves the gate and the benchmark.
  - `calibration-6d`: a fixed-list bootstrap, a digest of the full created matches at base and head, the inserted runs executed, then performance.
- **iOS moves to the next release** (owner, 2026-10-29). This release ships the web platform and Android. Phase 10 is Android only, and the shared Kotlin code stays iOS-ready (PLAN §6 "Next release: iOS", `91c83e02`). A virtual macOS is not an option: Apple's licence allows it only on Apple hardware, and this machine has no KVM.
- **CI minutes** (owner, 2026-10-28 and 2026-10-29).
  - **The cost.** One full CI run bills about 100 GitHub Actions minutes (13 jobs, each rounded up).
  - **The cadence.** Main is pushed once per Workflow after a green full validation, never for a single fix. There are no dispatch check branches and no pull requests, and only failed jobs are re-run.
  - **No waiting.** The next Workflow starts right after a push, without waiting for CI.
- **Carried:**
  - company entities in the tables, to the next quality calibration;
  - write cost (incremental key frequencies, re-key batches, GIN pending lists), to Phase 11;
  - JIT off for the application's role, to Phase 11's self-hosting guide;
  - the "Other lists" e2e check and the reports index's coverage words, to Phase 9.

**Carried forward:**
- **The date items (C67):**
  - nodemailer 10.1.4 or later, on or after 2026-11-01;
  - pypdf 6.21.2 or later, on or after 2026-11-04;
  - the first pypdfium2 with a PDFium build cut on or after 2026-10-20, once it is 14 days old.
- **For operators** (from 6A): watch the first real EU and UN syncs and the first `pep:sync`. After upgrading to 6C, run `watchlists:rekey` (`docs/reports/README.md`).

**Next:** Workflow 6D (`docs/plans/phase-6.plan.md`, "Workflow 6D"):
- **Stage 1:** `matcher-6d`, `rescreen-6d` and `platform-6d`.
- **Stage 2:** `calibration-6d`, alone.
- **Review:** two reviewers.
- **Verify:** a verifier.
- **Fix:** `fix-6d`.

Then Phase 7. Beside the builds, the research for Phases 9, 10 (Android) and 11 runs now (run `wf_d74babcf-26f`, notes in the resume kit), so their plans are ready when their turn comes.

## 2026-10-28: Phase 6, Workflow 6B done (the reports console, the matcher's evaluation, review and fixes)

Workflow 6B (`6f88d72d..ec07bebe`, 143 commits; run `wf_8d84d22b-486`, 10 agents, none errored) built the console surfaces for reports and measured the matcher, then reviewed all of Phase 6 and fixed what the review found. The orchestrator then added 20 commits (`04f75be4..8ceccdc0`). Each agent's evidence is in `docs/tdd/phase6-<agent>.tdd.md`, and each stage's decisions are in the plan's "Workflow 6B …" sections.
- **Stage 1:** `dashboard-reports`, `dashboard-report-config` and `evaluation-6`, in parallel.
- **Review:** four read-only reviewers (privacy and security, correctness and honesty, ingestion and licences, the console). They found 14 issues: no CRITICAL, 3 HIGH, 8 MEDIUM and 3 LOW.
- **Verify:** an adversarial verifier confirmed all three HIGH findings and refuted none.
- **Fix:** `fix-api` and `fix-console`, on disjoint paths.

| Item | What landed |
|---|---|
| Reports console (C86) | A "Reports" navigation group with Reports, Report templates and Watchlist sources. The index shows the result beside the coverage, so "No match" appears only beside a ready report and an errored one reads "Not screened". The detail page has errors per source; tiers, stage, provider and thresholds; the masked query; sources with their provenance and staleness; matches with review and dismissal dialogs; the ignore list; the results of each type; monitoring; history; tags; and redaction. Also: create report, the reports sections on the inquiry and account pages, words for every report event, problem code and run note, and the "Reports (days)" retention setting. RSC payload tests: without `pii:view`, no query value, matched name, entry name, article title, address or wallet reaches the page. Dashboard: 3,831 tests at 98.68% statements and 93.25% branches |
| Report configuration (C86) | Report templates: list, detail and versions, a JSON editor that shows the API's 422 pointers in place beside the resolved configuration, publish with every problem in words, new draft, and archive or activate. The read-only watchlist sources page, which shows every state (not configured, needs re-key, stale, sandbox, refusal, override, pending re-screen), the template warnings, the GDELT budget line and the attributions |
| Evaluation (C78.7, C78.8) | `docs/calibration/watchlist-phase6.md`, from a CSPRNG seed and a held-out build with 15,924 groups dropped. Persons under `tolerant`: recall 65.8% over the set's mix, typos 71.0%, order swaps 100%, held-out cross-script groups 14.6%. Precision was 100% and alerts were 0 per 1,000 at every preset, but the set is too sparse to produce a false alert (see the owner decisions). Screening p95 was 290.8 ms at 100,000 names (budget 100 ms) and 2,309 ms at 2,000,000 (budget 250 ms). At 2,000,000 names the cap bound in 47.7% of searches and 7.0% would end `result_truncated`. The re-screen fits its 60 s budget up to 300 added entries and takes 99 s at 1,000 |
| Review fixes (`fix-api`) | R008: the XML reader measures each construct from its opening and refuses a DOCTYPE at `<!D`; 300 MB of hostile input is now refused in under 30 ms at 91 MB, where it used to exhaust the heap. R001: the outbox sweep takes environments in turn, so one tenant's budget-waiting backlog no longer starves the others. R002: recurring caps are read under an advisory lock. R005: a resume keeps a next run that is still ahead. R007: the first name keeps its trigram fallback. R009: an empty publication is refused. R003: the log test has positive controls. A sync no longer rewrites unchanged entries (evaluation-6; 19.3 s against 23.6 s for 100 added entries). Migration 0021 counts failed checks and backs off exponentially (K6A-11). Also: `hops`, `names` and `lookup` on the ports (K6A-8 (a)–(c)), four more Postgres races (K6A-7), `general_delivery` among the address designators, CI's `unit-api` in two blob shards with a merged 80% gate (K6A-13), the static parts of every infra test in CI (P5-7), and an e2e `compose up` retry on a port clash (P5-5) |
| Review fixes (`fix-console`) | R012: the create-report action takes only the field shapes its form renders, which closes a prototype pollution through a field named `query/__proto__/…` (HIGH). P5-1: verification events in words. P5-2: a document's preview is shown once. P5-3: files whose kinds cannot be read never say "not stored". R013: template pickers page through up to 1,000 templates. R006: post-hoc figures are marked run 1 only |
| Orchestrator | The console fixer's amendments in the plan (`04f75be4`). The API is ready within 5 s even when the watchlist-source reconciliation is slow: under a load average of 11 it had reached Fastify's 10 s onReady timeout and stopped the API (`67c2b01a`, `36215061`). The e2e API-key expiry is filled without zero seconds, which Playwright refused about once in 60 runs (`229948a7`). Evidence: `docs/tdd/phase6-orchestrator.tdd.md` (`a4e43e2b`). The owner decisions after 6B and Workflow 6C (`ec582d6b`), revised after an adversarial review of the addendum: 22 findings, 8 HIGH, all applied (`5885b968`). The C73.8 log test reads one followed log stream, since a 500 ms window closed before Docker's first chunk under load (`b9ef8b82`). The workspace-wide runs' hang guards cover the load they now reach: 60 s per test and hook, 120 s for the PGlite hooks, and the integration suites capped at half the CPUs with a minute per test (`04206892`, `45fbf056`). Before that, a 1.6 s test took 18.4 s at a load average of 52.8 on 12 CPUs, and 22 Postgres containers migrated at once. The migrated test database is kept on disk, named by a hash of the migrations, so each test file opens it instead of migrating again; the db suite alone drops from 114 s to 51 s, and the cache keeps eight templates (`21349847`, `dfee3ffb`). A report resource is built from one read-only repeatable-read snapshot of the report and its matches. Before this, a poll during a run's completion could see `has-match` disagree with the matches and answer 500 (`3d3c7b1e`, found by the e2e in the second validation). The watchlist repository is split for 6C without changing behaviour (`23eb8e49`). Evidence: `docs/tdd/phase6-orchestrator.tdd.md` (`a4e43e2b`, `ebd8b83c`, `8ceccdc0`) |

**CI.**
- Run 40647828588 on the 6A push (`6f88d72d`) passed all 11 jobs.
- Before this push, run 40692785090 on branch `ci/6b-check` (`ec07bebe`) passed all 13 jobs. That run tested the new `unit-api` matrix: each shard took 12 to 13 minutes and the merge job 34 s. It also confirmed that the infra job runs the workflow contract test on the runner (193 passed). The test's two skips there, actionlint and `gh` pin verification, run locally.

**Validation** (the plan's list, on `main` at `8ceccdc0`):

| Suite | Result |
|---|---|
| Earlier runs | The first run (on `229948a7` and the docs after it) and the second (on `ebd8b83c`) failed only the steps below. Each failure was traced and fixed test-first; see the orchestrator row. Load: up to 52.8 on 12 CPUs in the unit step. **Unit:** timeouts at 20 s, and PGlite hooks at 60 s. **Integration:** tests at 30 s, and one Docker port-forward event. **Vision:** two CPU-time budgets, which my own suite runs overlapped. **Playwright:** one 500 from the report race |
| Install, model and data fetch, format, lint and typecheck (`--force`) | pass |
| TypeScript unit (14 packages, `--force`) | 17,865 tests, 14 of 14 packages, in 591 s (955 to 1,032 s in the two earlier runs). Coverage (statements / branches / functions / lines): api 4,482 at 96.37 / 88.31 / 98.12 / 96.41; dashboard 3,864 at 98.72 / 93.37 / 99.14 / 98.72; checks 3,304 at 98.73 / 91.32 / 99.32 / 98.71; contracts 2,071 at 99.22 / 96.16 / 98.27 / 99.21; flow 1,012 at 96.35 / 89.91 / 96.96 / 96.39; db 968 at 95.54 / 89.74 / 96.4 / 95.87; core 769 at 100 / 97.6 / 100 / 100; watchlist 470 at 98.71 / 90.7 / 98.61 / 98.74; emrtd 318 at 94.97 / 87.25 / 98.5 / 94.96; node 250 at 98.87 / 94.06 / 100 / 99.13 |
| Integration (Testcontainers) | api 146 in 27 files (204 s), db 60 in 12 files (131 s) |
| Vision | 2,532 tests at 97.42% coverage in 9 min 10 s; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,264 host tests and 18 demo tests, none skipped; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 69 mocked flow specs in 20.8 s; 91 full-stack tests in 9.9 min |
| Apps and vision images, benchmarks (selfie median 0.51 s, government ID 3.01 s, document 1.77 s, each within its budget), infra tests (CI contract 203, compose 431, apps image context 24, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (2,984 commits) | pass, no leaks |

**Owner decisions** (taken 2026-10-28 under the standing approval; the plan's "Owner decisions after Workflow 6B", 26 items). **Phase 6 is not done after 6B.** Two lines of its acceptance are unmet:
- the C78.7 budgets;
- a false-alert rate the evaluation can actually measure. Post hoc, a quarter of unlisted names drawn from a realistic law alerted.

Phase 7 reuses the matcher. So **Workflow 6C** closes Phase 6:
- **Retrieval:**
  - an absolute document-frequency bound tied to the candidate cap;
  - unordered pair keys over every pair of a name's tokens, so a partly common name is never missed silently (the search records `truncated` when a token cannot be reached);
  - the rare-key lookup folded into the candidate query;
  - a named mechanism for loads and scoring at 100,000 names, measured against the existing early stop.
- **The C78.7 gate** on a heavy-headed law with the shipped groups.
- **A faster forward screen** for the re-screen, with runs for matches whose evidence changed.
- **The OSA typo rule.**
- **A held-out set that measures false alerts,** with a calibration report at 6C's base and head that keeps or reverts each change.
- **Carried items:**
  - the frozen record additions: `alias-quality` is dropped as a duplicate of `names[].quality`, and list memberships and a relative's PEP class are risk data, hashed only when present;
  - the three missing races;
  - the redaction actor;
  - the phone reasons;
  - `pii:view` for review and dismissal in the API;
  - three additive members on the sources document;
  - the variant groups' MIT notice;
  - the redirect's port;
  - test hygiene.

Changed decisions and carried items:
- **The change signal (K6A-6) is dropped.** The SHA-256 comparison is always correct. An HTTP conditional request is carried to Phase 11 as optional.
- **Carried to Phase 11:**
  - a per-tenant cap on pending media runs;
  - the UN list opt-in.
- **Carried to Phase 9:** the dashboard inquiry document's reports, the run notes on the report resource, and a create-template form.

**Carried forward:**
- **The date items (C67):**
  - nodemailer 10.1.4 or later, on or after 2026-11-01;
  - pypdf 6.21.2 or later, on or after 2026-11-04;
  - the first pypdfium2 with a PDFium build cut on or after 2026-10-20, once it is 14 days old.
- **For operators** (from 6A): watch the first real EU and UN syncs and the first `pep:sync`.

**Next:** Workflow 6C (`docs/plans/phase-6.plan.md`, "Workflow 6C"):
- **Stage 1:** `evaluation-set-6c`, `matcher-6c`, `ingestion-6c` and `api-reports-6c`.
- **Stage 2:** `calibration-6c` and `console-tests-6c`.
- **Review:** two reviewers.
- **Verify:** a verifier.
- **Fix:** `fix-6c`.

The watchlist repository split it needs is done (`23eb8e49`). Then Phase 7.

## 2026-10-28: Phase 6, Workflow 6A done (the report types, watchlist ingestion and matching, providers, monitoring)

Workflow 6A (`fe4850ca..0381e13c`, 401 commits, the Phase 7 and Phase 8 plans among them) built the report resource and its nine types, the `@openverify/watchlist` package (list ingestion and name matching), the report providers, monitoring and the end-to-end specs. It ran in four stages, path-owned and test-first. Each agent's evidence is in `docs/tdd/phase6-<agent>.tdd.md`; each stage's decisions are in the plan's "Workflow 6A … amendments" sections.
- **Stage 1a:** `contracts-6`, alone.
- **Stage 1b:** `foundation-6`, alone, in three checkpoints.
- **Stage 2:** `watchlist-ingest`, `watchlist-matcher`, `fixtures-6` and `risk-logic`, in parallel.
- **Stage 3:** `api-reports`, `api-watchlists` and `api-providers`, in parallel.
- **Stage 4:** `integration-6a`.

| Item | What landed |
|---|---|
| Contracts (C69–C72, C87) | The report registry: nine types, all `beta` except `crypto-address-watchlist`, which became `ga` at Stage 4 once its C79.3 vectors passed. The report and match state machines, with one test per C75.8 row. 45 report event names, 13 problem codes and 13 golden API fixtures. The PII marks (23 attribute names), with a collision walk over every exported resource and body. The `@openverify/node` report groups. ADR 0005 on report honesty and live public-sector data |
| Plumbing (C73, C83, C85) | Migration 0020: sealed and blind-indexed report tables. The frozen Phase 6 API surface. The provider kinds `adverseMedia`, `emailIntelligence`, `phoneIntelligence`, `addressVerification` and `cryptoExposure`. The report limits and list settings. Postgres is started without logging bind parameters (C73.8) |
| Watchlist ingestion (C77) | A guarded XML reader on `saxes` (no DOCTYPE, depth 64, node and attribute caps) and our own single-member ZIP reader. Parsers for OFAC's enhanced XML (SDN and Consolidated), EU FSF, the UK Sanctions List, the UN consolidated list and the Wikidata PEP query. A hostile-input set fails each parser closed. The diff and the PEP rules |
| Matching (C78, C79) | Transliteration, name keys, 156,706 variant groups built from rigour (MIT; the groups are Wikidata CC0), scoring, presets, and crypto address canonicalisation by the C79.3 table. The C78.7 gate: screening p95 61.4 ms over 105,517 synthetic names on Postgres, alone, and 73.3 ms inside the integration suite |
| Synthetic fixtures (C77.5) | `@openverify/watchlist/testing`: the `openverify-sandbox` list (68 entries, three versions) and `openverify-sandbox-pep` (62 entries), the PEP import answers, the held-out set generator, and a round trip through each publisher's format |
| Risk logic (C82) | Email: 237 free-mail domains, 17 relay domains and a DMARC walk of at most 8 queries. The phone risk table. Address designators and US ZIP prefixes. The media lexicon: 352 terms in 12 categories and 4 languages |
| Reports API (C70–C75, C84) | Creation with the linking scopes, the lock order, the rate limit and the recurring and media caps. Masked reads, filters, tags and history. The run framework and its sweep. The four matching jobs. Dismissal and review. Redaction, with the inquiry and account cascades. The `report-config` publish rule. The completion hook. Consolidation. The console routes. 12 Postgres race tests |
| Lists (C76, C80.1) | The sources manifest, the sync and its CLIs, the re-screen after a list update, the refresh tick, the Wikidata PEP sync, and the sandbox lists imported by `seed:dev` |
| Providers (C81–C83) | The GDELT adapter (one request per 5 s install-wide, with a per-environment share), HIBP, Twilio Lookup, Smarty and crypto exposure, with a sandbox provider for each. The five provider-backed report jobs. The golden email, phone, address and media reports are rebuilt from those jobs and tied to them by a test |
| End to end and docs (C89) | Four full-stack specs: `report-watchlist`, `report-monitoring`, `report-inquiry` and `report-risk`. `seed:dev` publishes a `Default <type>` template for each type in each environment (18). `docs/reports/`: an overview and one page per type. The Phase 6 sandbox values are in `docs/checks/sandbox-providers.md` |

**Interruptions.**
- **Before 6A (2026-10-27, 12:20–12:27).** CI run 40536008063 on the Phase 5 push failed one chance-match test.
  - That test and a second like it were fixed test-first (`767801d2..ace1c8e2`, evidence `fe4850ca`).
  - Both were green on branch `ci/phase5-chance-matches` (run 40540937935). They reach `main` with this push.
- **About 17:46: the session's login expired.**
  - `foundation-6` stopped in checkpoint 3, leaving uncommitted C83 provider drafts.
  - 6A continued as a new run (`wf_3759aa92-245`) from a continuation script. The script embeds the five finished reports and gives the stopped agent a note listing its commits and drafts.
- **19:55: a duplicate agent.**
  - `api-reports` asked for `@openverify/watchlist` as an `apps/api` dependency, which the orchestrator added (`11971cbe`).
  - Replying to it by message started a second copy of the agent outside the Workflow, and both copies committed to the same paths.
  - The second copy was stopped. Its template work (the source catalog, templates and versions) was kept, and `api-reports` took it over as slices T1 and T2.
  - Workflow agents are no longer messaged.
- **About 20:44: the login expired again,** stopping Stage 3 and `integration-6a`.
  - 6A continued as run `wf_08f67db1-42a` with a note for each agent.
  - That run stops before Stage 4 if a Stage 3 agent returns nothing.
- **After the run.**
  - The orchestrator checked the split `api-reports` work:
    - the publish rule, the seeded templates and the template routes are built;
    - a stale "answer 501" comment was fixed (`de9c7d68`).
  - It recorded the owner decisions (`3ac1fc84`).
  - It made three tests cheaper that had timed out under the validation's load (`5bd9e7f2`, `86596222`).

**Two items carried to 6B** (why `api-reports` and `integration-6a` reported `partial`):
- **The change signal.** The `watchlist_sources.last_change_signal` column and the sync's change-signal step are not built. Until they are, every check downloads the whole file and compares its SHA-256: correct, only slower.
- **Five C74.6 race tests.** Five of the Postgres race tests are missing (Stage 4 amendment 18). Twelve are built, including the two `integration-6a` added.

**Validation** (the plan's list, on `main` at `3ac1fc84`; the steps the test fixes touch were run again at `86596222`):

| Suite | Result |
|---|---|
| Install, model and data fetch, format, lint and typecheck (`--force`) | pass |
| TypeScript unit (14 packages, `--force`) | First run: 17,027 of 17,030 passed in 797 s. Three tests timed out at 20 s, only under that load. Their cost was in the tests: an element-wise comparison of 209 KB byte arrays, and a page-wide role query over 84 event checkboxes. Both were fixed (`5bd9e7f2`, `86596222`; `docs/tdd/phase6-orchestrator.tdd.md`). The re-run of format, lint, typecheck, unit tests and gitleaks after the fixes passed: 17,030 tests, 14 of 14 packages, in 752 s. Coverage (statements / branches / functions / lines): api 4,471 at 96.36 / 88.26 / 98.08 / 96.4; checks 3,304 at 98.73 / 91.32 / 99.32 / 98.71; dashboard 3,056; contracts 2,071 at 99.22 / 96.16 / 98.27 / 99.21; flow 1,012 at 96.35 / 89.91 / 96.96 / 96.39; db 962 at 95.47 / 89.69 / 96.43 / 95.81; core 769 at 100 / 97.6 / 100 / 100; watchlist 467; emrtd 318 at 94.97 / 87.25; node 250 at 98.87 / 94.06 |
| Integration (Testcontainers) | api 141, db 59 |
| Vision | 2,532 tests at 97% coverage in 8 min 45 s; ruff, mypy (78 files) |
| Android (`--rerun-tasks`) | SDK 1,264 host tests and 18 demo tests, none skipped; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 69 mocked flow specs in 22.7 s; 86 full-stack tests in 9.7 min (82 at the Phase 6 base) |
| Apps and vision images, benchmarks (selfie median 0.41 s, government ID 2.62 s, document 1.73 s, each within its budget), infra tests (CI contract 182, compose 431, apps image context 24, connected results 11, gitleaks installer 9, pre-commit hook 11, vision container 55), gitleaks (2,819 commits on the re-run) | pass, no leaks |

**Owner decisions** (taken 2026-10-28 under the standing approval; the plan's "Owner decisions after Workflow 6A"):
- **Frozen record additions.** Three optional members on the frozen watchlist record:
  - `alias-quality`: weak AKAs are still screened, with the reason `weak_alias`;
  - `list-memberships`: an OFAC Consolidated (non-SDN) listing is never shown as an SDN-level block;
  - `relative-of-class`: a PEP relative carries the class of the PEP they relate to.
- **Phone reasons.** `prepaid` and `payphone` raise the risk to `medium`. `other_line_type` contributes nothing, and the level stays undetermined.
- **General delivery.** `general_delivery` is added to the address designators. It carries no risk, because the address report has no risk level.
- **Port amendments**, all additive:
  - `hops` on crypto exposure;
  - the environment and every screened name on the adverse-media search;
  - `lookup` on the phone answer, so "not checked" is never read as "no SIM swap";
  - an actor on report redaction;
  - a per-source script read for coverage.
- **Unchanged contracts.**
  - An unknown article language stays `und`, the BCP 47 code for "undetermined".
  - `email-domain` keeps its 253-character cap. The query address is capped at 254, so no domain can exceed it.
- **The change signal with a back-off.** Migration 0021 adds the change signal and a failure count. A failing source waits a doubling interval, starting at 15 minutes and capped at its refresh interval and at 24 hours.
- **Test time.**
  - CI's `unit-api` job is split into two blob-report shards plus a merge job.
  - Locally, the full-stack e2e runs in three shards and the API suite in two shards.
- **Old suites.** The 31 Phase 1–5 Testcontainers files adopt `POSTGRES_TEST_COMMAND`.

**Carried forward** (beyond 6B):
- **Optional matcher performance:**
  - build the key frequencies incrementally from the diff (about 7 s at 25,000 names);
  - fold the rare-key lookup into the candidate query (retrieval is most of the screening p95).
- **Operators:**
  - watch the first real EU and UN syncs for `refused_schema`;
  - watch the first `pep:sync` for query cost on the broad classes (watchlist-ingest amendments 11 and 12).
- **Re-screen scope:** the re-screen after a list update screens candidates with the most permissive configuration a template can hold. A report whose own configuration would not match gets a run that finds nothing new. Reading each report's pinned configuration would need a new read of the template versions.
- **Date items (C67):**
  - nodemailer 10.1.4 or later, on or after 2026-11-01;
  - pypdf 6.21.2 or later, on or after 2026-11-04;
  - the first pypdfium2 with a PDFium build cut on or after 2026-10-20, once it is 14 days old.

**Next:** Workflow 6B, with 20 known items:
- **Stage 1:** `dashboard-reports`, `dashboard-report-config` and `evaluation-6`.
- **Review:** four reviewers of all of Phase 6, then an adversarial verifier.
- **Fixes:** `fix-api` and `fix-console`.

Then Phase 7.

## 2026-10-24: Phase 5 done, with Workflow 5C (the console for all nine types, review, fixes)

Workflow 5C (`f27b5611..c4e43044`, 186 commits, 6.5 hours) ran in two stages, path-owned and test-first. All ten agents finished; one Stage 1 agent ended `partial` on two items, both closed afterwards. Two follow-ups came after it:
- **The orchestrator** closed those two items in six commits.
- **A one-agent completion** (`a486611c..13c8d061`, 23 commits) closed the last C66 gap and the four LOW findings.

The evidence is in `docs/tdd/phase5-dashboard-{people,records,documents}.tdd.md`, `phase5-review-fixes*.tdd.md` and `phase5-5c-completion.tdd.md`. Every decision is in the plan's "Workflow 5C Stage 1 amendments", "Workflow 5C review amendments" and "Workflow 5C completion amendments".
- **Stage 1 (C66, the console), in parallel:** `dashboard-people`, `dashboard-records` and `dashboard-documents`.
- **Stage 2, a review of all of Phase 5:**
  - four reviewers: privacy and security, check correctness, vision, clients and console;
  - a verifier for every HIGH finding;
  - a TypeScript fixer, and a Python and Kotlin fixer, which also took the 13 known items queued by 5B.

| Item | What landed |
|---|---|
| Console, people types | Words for every C51.2 reason of the phone, email and crypto wallet checks. Each word list is read from the evaluators' own values, so a new value without words fails a test. Evidence views: the destination exactly as the API masked it, the sends, attempts and channel, the labelled sandbox sender and the limit that refused the user; for wallets, the addresses, chain, scheme, address type, checksum and flags. Every check row shows its category and says "Advisory" for a check the template does not require. The settings page shows the text-message budget, and the navigation links the chip trust store |
| Console, records types | Words for all 48 reasons of the 18 database, AAMVA, business registry and business website checks; a miss from a non-authoritative source reads as going to review, never as fraud. Evidence views: entered values beside each field's level, the match groups, sandbox sources labelled, the register's status and how it was read, associated persons as an advisory result, the domain's resolution and registration day, listings and backlinks |
| Console, documents and chips | Document evidence: what a pass means, the class with its beta, uncalibrated confidence, the extracted fields (hidden without `pii:view`), recency and expiry, the fabrication cues table as an advisory beta result, the page-1 preview through the file route, and the original PDF as a download only. Chip evidence: integrity apart from revocation, the trust anchor labelled sandbox-only, the data-group table, Active Authentication, the device report as client-reported, the chip portrait beside the selfie centre photo it was compared with, and earlier sightings as a count. A read-only "Chip trust store" page for `settings:read` |
| Orchestrator | The file route passes a document's PDF only as the API's attachment, so it downloads and never renders. RED unit tests first, and a browser test that saves the PDF and checks its bytes, shown failing against the old route. Also recorded the Python and Kotlin fixer's ten plan amendments and brought `docs/checks/document.md` in line |
| Completion | The chip portrait now shows beside the selfie on the verification page and on the inquiry card. Four LOW fixes: the wallet path's eleventh message (P026), a new code after a resume (P027), Android's length refusals (P028), and a CI `infra` job running the vision container contract's static half (P019). The live half now runs the guarded probe and one real PDF analysis inside the image. SDK host tests went from 1,256 to 1,264; the orchestrator raised CI's floor to 1,264, test-first |

**Review findings:** 28 in all; none refuted or downgraded. Every finding is fixed with a RED test first.
- **0 CRITICAL.**
- **7 raised as HIGH:**
  - the verifier confirmed all seven;
  - five at HIGH;
  - the two CRL findings at MEDIUM, at a confidence (0.6) too low to downgrade, so they stayed blocking.
- **17 MEDIUM.**
- **4 LOW.**

| Id | Severity | Finding | Fix |
|---|---|---|---|
| P006 | HIGH | A printed day above 31 threw, so one odd line failed the whole document job | A date past 31 reads as no date |
| P001, P007 | HIGH, confirmed as MEDIUM | Revocation was judged against any CRL of the CSCA's country, not the issuing CSCA's own | CRLs are matched by the issuer's name as well as the country |
| P009 | HIGH | A 17 KB born-digital PDF tied up vision's unguarded parent for 49 s of OCR | OCR is bounded by work (2,400 line units) and a 40 s deadline |
| P010 | HIGH | The empty-environment test could not fail | The probe reads the environment the child was started with |
| P020 | HIGH | The flow bundle served no libphonenumber licence notice | Both notices served, pinned by SHA-256 |
| P021 | HIGH | The full-stack suite exceeded the API's per-address login limit | One kept session per seeded operator for the whole run |
| P003, P012–P017 | MEDIUM | PDF analysis: a child killed on its own limits was retried as a 503; truncated scans, over-complex pages, masks and form clips were judged silently | Each is refused as unreadable (422 `pdf_unprocessable`, `document_unreadable`), and the masks and clips are honoured |
| P011 | MEDIUM | A DSS in the same increment hid an edit after signature | A DSS increment may only add DSS data |
| P018 | MEDIUM | A same-user child could read the parent's environment through `/proc` | The vision parent is non-dumpable |
| P004 | MEDIUM | The wallet signature check accepted any signed bytes | Only our challenge's bytes (or a Solana envelope naming the key) pass |
| P005 | MEDIUM | The NFC face binding could use a selfie that later failed | The NFC job waits for the selfie's decision |
| P002 | MEDIUM | asn1js exceptions escaped as plain errors | They become `chip_data_malformed` |
| P008, P025 | MEDIUM | The golden fixtures of the 5A types carried invented check metadata | They carry what the evaluators write, and a test ties them together |
| P022, P023, P024 | MEDIUM | Android kept a stale signature for a new message; a racy live-region check; evidence titles not headings | Drafts keyed on the challenge; the check holds the upload; headings at the right level |
| P019, P026–P028 | LOW | See the completion row above | Fixed |

**Known items from 5B:** K1–K6, K8–K11 and K13 are fixed:
- the submitted-verification sweep;
- the CRL redirect;
- the missing Content-Type opt-in;
- GCRA pacing for KYB and RDAP;
- RDAP `Expires`;
- persons only when collected;
- the deterministic head-turn camera;
- the sandbox SMS sender;
- the compose flags;
- later signatures;
- the trust-store settings in the route.

K7 needed no change: `chip-races` passed 66 of 66 runs under heavy load. K12 was already pinned by `apps-image-context`.

**Three tests that failed only under load**, fixed before the push. The first full validation, on `675b1ce6` (2026-10-24), failed in two unit tests, and each had passed in the agents' own runs. On 2026-10-27 the orchestrator reproduced both with every package running at once. A heavier reproduction also failed a third test. Each was fixed test-first; the evidence is under "Orchestrator, 2026-10-27" in `docs/tdd/phase5-5c-completion.tdd.md`.
- **The C58.7 classifier budget (`checks`):** the test measured 2,577 ms of CPU against 2,000. CPU time on this Hyper-V guest still grows with load, so the budget stays and the work is cheaper. `documentLines` now folds each printed word once per document, and `foldDocumentToken` folds only the rendering it keeps. The case takes about 245 ms of CPU instead of 480, and the classifier's output is unchanged.
- **The events timeline order (`db`):** PGlite's `now()` reads the wall clock to the millisecond. It ties two writes, and under load it stepped back by up to 11 ms. The test assumed write order, but the C1 order is right. The events tests now stamp each event they order with its own `created_at`; only the tests changed.
- **The authenticator dialog (`dashboard`):** the secret step rendered while the start action had not yet ended, so Escape did nothing there. The start action now holds the dialog open only until its answer is in.

**Validation** (the plan's list, on `main` at `d410b04a`):

| Step | Result |
|---|---|
| Install, models, data | lockfile up to date; every model and data file at its pin |
| Format, lint, typecheck | pass (lint and typecheck with `--force`) |
| Unit tests (`pnpm turbo run test --force`, all packages at once, 618 s) | 15,068 passed: api 3,853, dashboard 3,044, checks 2,919, contracts 1,809, flow 1,012, db 848, core 711, emrtd 318, node 226, flow-spec 113, e2e 90, config 71, ui 54. Each package's 80% coverage gate held; the lowest was emrtd, at 94.97% of lines and 87.25% of branches |
| Integration (Testcontainers) | api 124 (25 files), db 57 (11 files) |
| Vision (ruff, format, mypy, pytest) | 2,531 passed, coverage 97.42% |
| Android (`--rerun-tasks`, full gate) | SDK 1,264 host tests (0 skipped), demo 18; Kover and lint pass |
| OpenAPI | regenerated, no diff |
| End to end | mocked flow 69 (20.8 s); full stack 82 (8.7 min) |
| Images | apps and vision images build |
| Benchmarks | selfie median 0.40 s (budget 3 s); government ID 2.63 s (5 s); document 1.71 s (4 s) |
| Infra tests | apps-image-context 14, check-connected-results 11, ci-workflow 181, compose 329, install-gitleaks 9, pre-commit-hook 11, vision-container 55; none failed |
| gitleaks | 2,413 commits, no leaks |

**Decisions taken** (owner-delegated, recorded in the plan):
- **Trust store:** the trust-anchors answer carries its settings (K13, a contract change).
- **Wallets:** a wallet signature must cover our challenge (P004).
- **NFC:** the face binding waits for the selfie's decision (P005).
- **Document refusals:** a PDF that stops a child on its own limits, a truncated scan and an over-complex page are refused as unreadable, not retried. 503 covers only outages, spawn failures and the deadlines.
- **The console:** it offers a document's PDF only as a download.
- **CI:** an `infra` job runs the vision container contract's static half; the live half stays a local gate until a CI job builds the vision image.

**Carried forward:**
- **Date items (C67):**
  - nodemailer 10.1.4 or later, on or after 2026-11-01;
  - pypdf 6.21.2 or later, on or after 2026-11-04;
  - the first pypdfium2 release bundling a PDFium build cut on or after 2026-10-20, once 14 days old.
- **From 5B, unchanged:**
  - the Companies House and EDGAR answer shapes, unchecked live;
  - the document extraction limits in `docs/checks/document.md`;
  - MRZ check digits not stored;
  - an EDGAR name-search prefilter;
  - an iOS `DocumentPicker` in Phase 10.
- **Console follow-ups:**
  - **API changes needed:** the settings API's SMS ceiling as its own member; an AAMVA attribute naming the ID verification its values came from.
  - **Shared code:** a shared EVM chain-name table; shared evidence parts (outcome, beta label, part) across the records views.
  - **Gaps:** words for the `verification.*` events; the document preview shown twice on the Files section; on a verification page seen without `inquiries:read`, the chip portrait should point rather than read "not stored".
- **Test infrastructure:**
  - 16 other `db` test files assert newest-first order on rows written back to back, and most do not stamp `created_at`. They depend on the wall clock in the same way, though none failed in the validation;
  - under heavier load than the validation (one more busy core), two `flow` tests hit the 20 s test timeout, and four `db` and `api` `beforeAll` hooks hit the 60 s one while migrating PGlite. `pnpm test` runs 13 packages with 6 workers each on 12 vCPUs;
  - re-measure the e2e timeouts now that the full-stack suite has 82 tests;
  - a compose-up retry on Docker Desktop port errors;
  - the live half of `vision-container.test.sh` in CI;
  - the static parts of the other infra tests in the `infra` job;
  - the axe-core accessibility check.
- **Docs:** README rows for the records views.

**Next:** Phase 6 (reports): `docs/plans/phase-6.plan.md`, Workflow 6A (engine, ingestion, matching, types), then 6B (console, evaluation, review, fixes).

## 2026-10-24: Phase 5, Workflow 5B done (documents, business verification and NFC)

Workflow 5B (`0db60dcb..6a8c7e54`, 315 commits) built the last three groups of Phase 5 types:
- documents, such as proof of address;
- business verification, from registers and websites;
- NFC chip verification on the server, with its trust store.

It ran in four stages, path-owned and test-first, without interruption (10.8 hours). All ten agents finished `done`, none blocked. Each agent's evidence is in `docs/tdd/phase5-<agent>.tdd.md`; each stage's decisions are in the plan's "Workflow 5B … amendments" sections.
- **Stage 1:** `contracts-5b`, alone.
- **Stage 2:** `checks-5b`, `emrtd`, `vision-document`, `fixtures-5b` and `clients-5b`, in parallel.
- **Stage 3:** `api-document`, `api-nfc` and `api-kyb`, in parallel.
- **Stage 4:** `integration-5b`.

| Item | What landed |
|---|---|
| Contracts (C60.1, C60.4, C62, C63) | The vision document contract (pydantic and zod) and three new vision routes; pypdfium2 5.14.0 and pypdf 6.19.0, pinned, with their NOTICE credits and the PDFium CVE record; the `@openverify/emrtd` package; migration 0018 (four verification tables and five install-wide trust-store tables, sealed, blind-indexed, rewrapped and redacted); the provider kinds `businessRegistry`, `domainAge`, `maliciousWebsite` and `backlink`; `GET /dashboard/trust-anchors` |
| Vision (C60.1–C60.4) | Each PDF and chip portrait is decoded in a fresh guarded child: empty environment, no new privileges, limits of 1.5 GiB of memory and 20 s of CPU, and no files or processes. It is killed at 30 s or 64 MiB of output. Also: a bounded raw-byte and XMP scanner, PDF measurements, page rendering and JPEG 2000 portrait conversion. Median 1.61 s per document against a 4 s budget |
| Document checks (C60.5, C60.6) | Text layer against OCR; our own phrase lists for en, es, fr and de; a classifier on seven layout features; extraction of the issue date, a lease's term, the tax year, the issuer and the addressee (through the C58 library); recency and expiry by class; 14 fabrication cues (advisory). Held-out set: 48 of 59 acceptable, and no document read as a different covered class |
| eMRTD (C62.1–C62.4, C62.6) | Bounded BER-TLV ahead of asn1js and pkijs; key and curve bounds; ECDSA, RSA and PSS through `node:crypto`; the SOD and DG1, DG2 and DG15; Passive Authentication against the trust store (CRLs, link certificates); Active Authentication; master-list checks; a self-test. A synthetic "Utopia" CSCA serves tests and the sandbox only |
| NFC in the API (C62.5–C62.10) | Single-use chip challenges and the submit guard. The NFC job: integrity, AA, the data groups against the printed MRZ, the chip portrait against the selfie, and sightings across accounts. The trust-store sync: pinned roots, CRL monotonicity, rollback refusal and withdrawal. The console route, and the sandbox anchor in `seed:dev` |
| KYB (C61) | GLEIF, Companies House, SEC EDGAR and a sandbox register, through the outbound client. The business evaluator: the status table, associated persons and the PSC threshold. Website: RDAP domain age, a feed-list check for malicious sites (the list ships empty) and backlinks (sandbox) |
| Fixtures (C65.2, C60.7) | A synthetic proof-of-address set: 47 files in English and Spanish, from our own PDF writer, with phone photos. A hostile PDF set. A 59-file held-out set in six languages, written before the classifier was read. Three pinned public-domain IRS forms |
| Clients (C64) | Web and Android steps for documents, business registers and business websites. They run one attempt at a time, show the guidance windows, and check the file's type and the 10 MiB limit before upload. NFC still needs an API-driven client until Phase 10. SDK host tests went from 1,177 to 1,256 (CI floor 1,256) |
| Integration | Three full-stack specs: `document-poa`, `kyb`, `nfc-chip`. A harness ran vision's real analysis over all 106 fixtures; it found four extraction defects, all fixed test-first: the US city line, tax-form labels, a lease's addressee and clause terms, and Spanish door numbers. Vision now runs alone on an internal network as uid 10001, with a read-only root, no capabilities and 4 GiB. New docs: `docs/checks/document.md`, `business.md`, `nfc.md` |

**Validation** (the plan's list, on `main` at `6a8c7e54`):

| Step | Result |
|---|---|
| Install, models, data | lockfile up to date; every model and data file at its pin |
| Format, lint, typecheck | pass (all 26 lint and typecheck tasks) |
| Unit tests (`pnpm turbo run test --force`, all packages at once, 594 s) | 13,869 passed: api 3,802, checks 2,900, dashboard 1,946, contracts 1,804, flow 1,006, db 844, core 711, emrtd 307, node 226, flow-spec 113, e2e 85, config 71, ui 54; each package's 80% coverage gate held |
| Integration (Testcontainers) | api 122 (24 files), db 57 (11 files) |
| Vision (ruff, format, mypy, pytest) | 2,456 passed, coverage 97.26% |
| Android (`--rerun-tasks`, full gate) | SDK 1,256 host tests (0 skipped), demo 18; Kover and lint pass |
| OpenAPI | regenerated, no diff |
| End to end | mocked flow 68 (20.0 s); full stack 70 (7.5 min) |
| Images | apps and vision images build |
| Benchmarks | selfie median 0.40 s (budget 3 s); government ID 2.51 s (5 s); document 1.63 s (4 s) |
| Infra tests | apps-image-context 14, check-connected-results 11, ci-workflow 174, compose 326, install-gitleaks 9, pre-commit-hook 11, vision-container 42; none failed |
| gitleaks | 2,185 commits, no leaks |

**Decisions taken** (owner-delegated; recorded in the plan's "Owner-delegated decisions after Workflow 5B"):
- **Licences:**
  - Decision 31: the licences compiled into PDFium count as permissive (FTL, Unicode-3.0, IJG, Zlib, libpng-2.0, AGG, the LLVM exception, the Adobe AFM notice).
  - Decision 46: `tslib`'s 0BSD is accepted.
- **CRL downloads** may follow one https redirect, re-checked against the SSRF rules. This closes the German CSCA's gap.
- **A missing Content-Type** is accepted only for signature-verified trust-store payloads (the Netherlands and Swiss lists).
- **A later signature's own increment** is not an edit after signature (two-party leases).
- **The trust-anchors route** reports the refresh and ICAO-CRL settings.
- **KYB lookups** fetch officers and PSCs only when the step collects persons.
- **Kept:**
  - opening a document or business step creates its verification;
  - one-field entries carry no required mark;
  - the other 5A defaults.

**Queued for Workflow 5C** as known items:
- **K1:** a repair sweep for a failed post-commit enqueue.
- **K2, K3, K10, K13:** the four decisions above that touch the trust store (CRL redirect, missing Content-Type, the settings in compose and in the route).
- **K4:** KYB pacing on the GCRA limiter.
- **K5:** RDAP bootstrap refresh following `Expires`.
- **K6:** officers and PSCs only when persons are collected.
- **K7, K8:** make `chip-races` and the Phase 4 head-turn specs deterministic under load.
- **K9:** bind the sandbox SMS sender in `phase5TestDependencies`.
- **K11:** multi-signed documents.
- **K12:** pin `trust-anchors/manifest.json` in the apps image.

**Carried forward:**
- **Date items (C67):**
  - nodemailer 10.1.4 or later, on or after 2026-11-01;
  - pypdf 6.21.2 or later, on or after 2026-11-04;
  - the first pypdfium2 release bundling a PDFium build cut on or after 2026-10-20, once 14 days old, with the CVE record updated.
- **Unchecked API shapes:** the Companies House and EDGAR answer shapes follow their published references and were not checked live, since both need a key or a contact. Re-check them, and the sources' terms, with an operator key.
- **Extraction limits**, stated in `docs/checks/document.md`:
  - a party named in a prose clause is not read;
  - an issuer may read as the title line;
  - a small copy-moved patch is not seen;
  - uncovered Romance-language documents can read as covered.
- **MRZ check digits:** whether the printed MRZ's check digits held is not stored, so the NFC MRZ comparison tolerates OCR confusables.
- **Later:**
  - EDGAR name search (about 0.7 s a lookup) needs a prefilter;
  - an iOS `DocumentPicker` is due in Phase 10;
  - the axe-core accessibility check is still open, from 5A.
- **CI changes proven only locally:** the vision job's 30 minutes with three benchmarks, the e2e job's 70 minutes and the federal-forms cache. This push's CI run is their first real test.

**Next:** Workflow 5C (the console for all nine types, a review of all of Phase 5, fixes), then Phase 6 (reports).

## 2026-10-23: Phase 5, Workflow 5A done (plumbing, phone and email codes, crypto wallets, database and AAMVA)

Workflow 5A (`7e80351..f135a28d`, 390, the pause entry and the Phase 6 plan among them commits) opened every layer to the nine new verification types and built the first five of them: phone and email one-time codes, crypto wallets, database and AAMVA. It ran in four stages, path-owned and test-first. Each agent's evidence is in `docs/tdd/phase5-<agent>.tdd.md`; each stage's decisions are in the plan's "Workflow 5A … amendments" sections.
- **Stage 1a:** `contracts`, alone.
- **Stage 1b:** `foundation`, alone.
- **Stage 2:** `checks-contact-crypto`, `checks-matching`, `flow-5a` and `android-5a`, in parallel.
- **Stage 3:** `api-otp`, `api-crypto` and `api-database`, in parallel.
- **Stage 4:** `integration-5a`.
- **Follow-up:** a one-agent `flow-5a` completion run (below).

| Item | What landed |
|---|---|
| Contracts (C50–C52, C55, C57.1) | Eleven verification types (`database_business` replaces `business`; `aamva` and `business_website` are new); the `submitted → skipped` move; the `sandbox:read` scope; CAIP-2 chain ids; check categories; the registry for all of PLAN §4.3 plus seven new checks; config schemas with a basis per default; 22 problem codes with golden problems; migration 0016 |
| Plumbing (C53, C54, C63) | Migration 0017 (sealed, blind-indexed, rewrapped and redacted tables); the outbound HTTP client; per-type hooks (job, attribute, guidance, submit, cancel, publish), with government ID and selfie moved behind them unchanged, plus a skip hook; the frozen route schemas; the provider kinds `sms`, `database` and `evmRpc`; masking built from the contracts' PII marks; the log keys and their lint rules; `data/manifest.json` and `scripts/fetch_data.py` |
| Phone and email codes (C55, C56) | Send and confirm under fail-closed limits (per address, inquiry, destination, number prefix, country share and environment budget). Codes are stored only as an HMAC. Resend waits are 30, 60, 120 and 240 s. The sandbox SMS sink sits behind `sandbox:read`. MX and disposable-domain checks. Destination rules: premium-rate, shared-cost and (unless allowed) VoIP numbers are refused, and so are the published nodemailer advisory payloads |
| Crypto wallets (C57) | Server-built messages (EIP-4361, Sign-In with Solana, CAIP-122) and single-use challenges. Signatures are checked for EVM (EIP-191, and ERC-1271 through `evmRpc`), Bitcoin (BIP-137, BIP-322 simple), TRON and Solana against the published vectors |
| Matching, database and AAMVA (C58, C59) | The matching library: match levels, three-valued match groups, partial-date rules R1–R6, two foldings, 1,390 nickname pairs and address matching. The database and AAMVA evaluators. The inputs route for every form type answers one 422 with a pointer per member. The silent AAMVA step runs through the skip hook |
| Web flow (C64.1) | Phone, email, crypto wallet (EIP-6963 or `window.ethereum`, or a pasted signature), the database and AAMVA forms, and the silent wait. A refused value takes focus. 21 new mocked Playwright specs on a frozen clock, with a fake EIP-1193 wallet (no key or crypto library in the bundle) |
| Android (C64.2) | Phone, email, database, AAMVA (form and silent) and crypto wallet (paste only) steps, in `commonMain`, in English and Spanish. SDK host tests went from 972 to 1,177 (the CI floor is now 1,176) |
| End to end and docs | Four full-stack specs: `phone-otp`, `email-otp`, `crypto-wallet`, `database`. `docs/checks/contact.md`, `crypto-wallet.md` and `database.md`, each with "What a pass means". The "Phase 5 providers" section of `docs/checks/sandbox-providers.md` |

**Interruptions.**
- **2026-10-22:** the owner paused the build in Stage 1b (the entry below). It resumed the same evening from the resume kit, with the WIP re-applied.
- **2026-10-23, about 01:10:** the weekly usage limit stopped Stage 2. The run was resumed (same run id) after a per-agent note on each stopped agent's commits and drafts.
- **flow-5a and the content filter.** flow-5a's second run was ended by the API ("Output blocked by content filtering policy") while it wrote the form fields, most likely a long hand-written list of country names.
  - `integration-5a` finished the forms on flow-5a's RED; country names now come from `Intl.DisplayNames`.
  - With the owner's approval, a completion run did the rest: the mocked specs, two focus fixes (WCAG 3.3.1 and 4.1.3) and the evidence.
  - Every later Workflow prompt forbids writing long reference lists by hand.

**Validation** (the plan's list, on `main` at `f135a28d`):

| Suite | Result |
|---|---|
| Install, model and data fetch, format, lint and typecheck (`--force`) | pass |
| TypeScript unit (12 packages, `--force`) | 12,222 tests in 8 min, every package at or above 80%: api 3,327 at 97.42 / 90.41 / 98.9 / 97.43; checks 2,223 at 98.76 / 90.91 / 99.69 / 98.68; dashboard 1,946 at 98.56 / 94.62 / 98.87 / 98.56; contracts 1,778 at 99.85 / 97.86 / 100 / 99.85; flow 924 at 96.49 / 89.99 / 97.23 / 96.52; db 770 at 98.71 / 92.13 / 99.37 / 98.64; core 711 at 100 / 96.61 / 100 / 100 |
| Integration (Testcontainers) | api 102, db 52 |
| Vision | 1,925 tests at 99.81% coverage; ruff, mypy |
| Android (`--rerun-tasks`) | SDK 1,177 host tests and 18 demo tests, none skipped; Kover gate; assemble, iOS klibs included; lint |
| OpenAPI | `openapi:write` leaves `docs/api/openapi.json` unchanged |
| Playwright | 59 mocked flow specs in 15.4 s; 60 full-stack tests in 7.2 min |
| Apps image, selfie benchmark (median 0.40 s), infra tests (CI contract 158, compose 278, apps image context 12, connected results 11, gitleaks installer 9, pre-commit hook 11), gitleaks (1,869 commits) | pass, no leaks |

**Carried forward:**
- A failed post-commit enqueue from a decision hook (for example a server-created AAMVA attempt) is only logged. A repair sweep is needed.
- The Phase 4 head-turn specs (`reload-between-uploads`, `selfie-repeat`) failed under heavy CPU load (load average 10–13) during `api-crypto`'s run: the fake camera's auto-shutter took off-pose stills. They were green in integration and in this validation. They should be made deterministic.
- Bind the sandbox SMS sender in `phase5TestDependencies` and drop the seven per-test overrides.
- An axe check in the mocked flow specs would need axe-core (MPL-2.0, under rule 4's dev-tooling exception).
- Date items (C67): nodemailer 10.1.4 or later on or after 2026-11-01; pypdf 6.21.2 or later on or after 2026-11-04.
- Phase 10 (iOS): country names and a clipboard copier as iOS actuals.
- Refresh the Wikidata nickname review and the pinned matching sources periodically.

**Decisions for the owner** (new in 5A; each default is already in use):
- An `otp-ip-hour` refusal is not recorded, so "continue" after one answers 409 and the user waits for the window. The alternative is to record it (a `limited_reason` value and a migration, or a 429 member).
- Required marks appear on the forms only, not on the one-field phone, email and code entries.
- A resumed form whose values the server holds: the web flow offers "Send for checking", while Android submits it at once.
- The crypto wallet step is paste-only on Android, so a wallet-only step cannot be completed there.
- The OTP limits and the SMS budget (200 an hour, ceiling 1,000) are provisional (Phase 5 decisions 7 and 52).
- The nickname table holds authored rows plus 132 reviewed Wikidata pairs. Non-Latin nicknames are absent (decision 32).

**Next:** Workflow 5B (documents, KYB, NFC), then 5C (console, review, fixes). The Phase 6 plan (reports) is written and reviewed (`docs/plans/phase-6.plan.md`, `72fb857`: five research notes, three adversarial reviews and a verification round, 82 findings resolved). Its two Workflow scripts are ready.

## 2026-10-22: Paused during Phase 5, Workflow 5A (Stage 1a done, Stage 1b part-done)

The owner paused the build. The state, exactly:
- **GitHub (`origin/main`) is `7e80351`**: Phases 0–4 and the Kotlin Multiplatform move, green in all ten CI jobs (run 39747344553). Nothing after it has been through the full validation, so `main` is not pushed past it; a copy of local `main` is pushed as the backup branch `wip/phase5a-paused-2026-10-22`, and CI does not run on it.
- **Local `main` (this entry sits on it)** carries Workflow 5A's work since `7e80351`:
  - **Stage 1a `contracts`, done** (`0e4f949..5b11009`, 89 commits): C50, C51 for all of §4.3, C52, the C55 constants, C57.1 chain ids, `sandbox:read`, the C59.4 AAMVA amendment, migration 0016, the decode-only client changes, the C67 record corrections, its plan amendments ("Workflow 5A Stage 1a amendments") and `docs/tdd/phase5-contracts.tdd.md`. It ran the full gates, e2e included.
  - **Stage 1b `foundation`, part-done** (`df17719..bde2c3f`, 14 commits): the Workflow 5A dependencies, the checks folder stubs and entry point, `data/manifest.json` and `scripts/fetch_data.py` with the CI data cache and the Node 22.22.1 pin, migration 0017 with the four 5A tables and repositories (sealing, blind indexes, `otpKey`, redaction), `blind-index:rebuild`, and the C54.6 outbound HTTP client; evidence so far in `docs/tdd/phase5-foundation.tdd.md`. Not done yet: the C54 hooks, the frozen route schemas and the OpenAPI snapshot, the wiring, the masking lists, the log keys, the provider kinds and variables, the dashboard generic view, and the rest of its plan bullet.
  - **Its uncommitted work at the pause** (mailer, rate-limit plugin, ports, providers, cache, DNS, fakes; untested) is kept, not committed: `git stash` entry "phase5a-foundation-wip 2026-10-22", the branch `wip/phase5a-foundation-2026-10-22` (pushed as a backup) and a patch in the resume kit.
- **Resume kit** (outside the repo): `~/.claude/projects/-home-mhnoor-persona-opensource/resume/`: `README.md` (the steps), `resume-workflow-5a.mjs` (Workflow 5A from Stage 1b, with Stage 1a's report embedded), `validate-full.sh`, the WIP patch, Stage 1a's report, the earlier Workflow scripts as templates (4B's review stage serves 5C), and the NFC spike scripts for 5B's `emrtd` agent.

**Left to build:** Workflow 5A from Stage 1b (then Stages 2–4), Workflows 5B and 5C (scripts to write from the plan's Workflow sections, as 5A's was), then Phases 6–11 (`docs/PLAN.md` §6), each planned, reviewed and built the same way.

**Decisions waiting for the owner** (each has a default the build already uses):
- Phase 4: the 21 decisions in `docs/plans/phase-4.plan.md`, Workflow 4A's list above, and from 4B: WCAG 2.2.1 for the 180 s capture limit, and whether a first passive-liveness failure keeps a retry. Decision 11 needs an explicit licence exception: Eigen (MPL-2.0) ships to browsers inside onnxruntime-web's WASM.
- The Kotlin Multiplatform move: its 10 decisions (above, and in `docs/plans/kmp-migration.plan.md`), including macOS CI cost and the iOS app's timing.
- Phase 5: the decisions list in `docs/plans/phase-5.plan.md` (accounts and keys for SMS, Companies House, SEC EDGAR, URLhaus; the BSI, ICAO, Dutch, Italian and Swiss CSCA list terms; licence exceptions for pypdfium2's bundled notices and SCUBA's Classpath-exception files; OTP and crypto policies; and the rest).
- Earlier phases: the Phase 2 and Phase 3 lists in their entries below.
- Housekeeping: delete `fixtures/faces/calibration/.previous` (gitignored hard links); the old `ci/*` branches on GitHub and two old worktrees (`git worktree list`) can be removed; an optional `.claude/settings.json` allowlist would cut permission prompts.

## 2026-10-22: The Android SDK moved to Kotlin Multiplatform (iOS-ready)

The owner asked on 2026-10-21 for mobile code that ports easily to iOS. Kotlin stays; `android/openverify-sdk` became one Kotlin Multiplatform library with Compose Multiplatform, before Phase 5 adds Android code (`docs/plans/kmp-migration.plan.md`, ADR 0004). One Workflow (`cb8de40..d285201`, 52 commits) ran four agents in sequence, a behaviour-preserving refactor with the existing tests as the safety net: `kmp-foundation` (the baseline, Gradle, the moves, CI), `kmp-network` (Ktor), `kmp-ui` (screens, strings and platform seams), `kmp-integration` (ADR, licences, plan amendments, a review pass). Each has its own `docs/tdd/kmp-<stage>.tdd.md`.

| Item | What landed |
|---|---|
| Layout | `:openverify-sdk` targets Android, `iosArm64` and `iosSimulatorArm64` on AGP 9's KMP library plugin. `commonMain` holds 84% of the main code (4,675 of 5,568 lines): the model, MRZ, the flow engine, the API client, the view model, every screen and all 111 strings plus one plural. `androidMain` keeps the Activity entry points, CameraX, bitmap encoding, the photo picker and the camera permission; `iosMain` holds compile-only placeholders until Phase 10. `demo-app` and `openverify-nfc` are unchanged |
| Libraries | Compose Multiplatform 1.11.1 (Material3 1.9.0), Ktor 3.5.2 (on the existing OkHttp client on Android, NSURLSession on iOS), the JetBrains lifecycle viewmodel 2.9.6; all Apache-2.0 but the SLF4J API (MIT). Android still resolves Compose 1.11.4, material3 1.4.0 and OkHttp 5.4.0 |
| Public API | Every public name kept; the one change is `FlowApiClient(…, OkHttpClient)`, now a same-named factory (a binary break, fine while unpublished) |
| iOS on Linux | `:openverify-sdk:assemble` compiles the iOS main and test klibs on Linux (Kotlin 2.4's klib cross-compilation), so CI catches non-portable shared code without a Mac; linking and running on iOS wait for macOS CI in Phase 10 |
| Fix found on the way | The consent locale is taken from the texts shown, so a mid-flow language change no longer records the old locale |
| CI | The android job runs `testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint`, caches the Kotlin/Native toolchain, and fails on fewer than 928 SDK host tests or any skipped one; the emulator job runs `connectedAndroidDeviceTest` |

**Tests.** The 631 baseline test cases (SHA-256 of the sorted list recorded before any change) are all present, every class keeping its count; 297 new tests cover the seams (the Ktor contract on a MockEngine, URL-parser parity with OkHttp, resources, the camera permission, the consent locale): 928 SDK host tests in 48 classes, 18 demo tests, 1 device test, nothing skipped. Kover went from 97.76% to 98.11% (gate 80%).

**Review** (the kotlin-reviewer checklist over all 130 changed files): no CRITICAL or HIGH; one MEDIUM fixed test-first (resource strings Compose Multiplatform would display wrongly are now caught); two iOS-only items recorded for Phase 10 (the Darwin client's default NSURLSession cache, an unclosed Skia image).

**Validation** (on `main` at `9a43ef5`): format; the Android gate above with `--rerun-tasks` (928 + 18 tests, 0 skipped); every infra test (CI contract 150, compose live 191, and the rest); gitleaks over 1,477 commits. No TypeScript, Python or vision code changed.

**Owner decisions** (defaults in the plan): one module now; Material3 1.9.0; non-ASCII API host names refused; macOS CI from Phase 10 (about $30–60 a month while the repository is private); the iOS app in Phase 10 (a Mac and an Apple Developer account); iOS NFC through CoreNFC with NFCPassportReader (MIT) unless we write BAC/PACE in shared Kotlin; Compose Multiplatform 1.12, Ktor 3.6 and OkHttp 5.5 wait for a compileSdk 37 change.

**Carried forward:** Gradle hygiene (declare kotlinx-io and skiko directly, drop an unused lifecycle artifact); the Phase 10 iOS items (an ephemeral NSURLSession, a Swift-facing entry point, the bundled resources, a live-region check).

## 2026-10-22: Phase 4 done, with Workflow 4B (console surfaces, face-match calibration, review, fixes)

Workflow 4B (`060d289..5b3fb92`, 110 agent commits) ran in two stages, path-owned and test-first. Every decision is recorded in the plan as a "Workflow 4B Stage 1 amendment" or a "Workflow 4B review amendment".
- **Stage 1, in parallel:** `surfaces-dashboard` (C47, `docs/tdd/phase4-surfaces-dashboard.tdd.md`) and `calibration` (C49, `docs/tdd/phase4-calibration.tdd.md`).
- **Stage 2, review of all of Phase 4:** four reviewers (privacy and security, check correctness, vision, clients and console), one verifier for every CRITICAL and HIGH finding, then TypeScript, Python and Android fixers (`docs/tdd/phase4-review-fixes*.tdd.md`).

| Item | What landed |
|---|---|
| C47, console | The selfie card and page show the pose photos in prompt order, each named by its pose; the government ID front beside the centre photo with the similarity, the threshold and how it was set (calibrated, provisional or set by the template, read from each result's provenance); the side similarities and the passive score with their thresholds; the liveness components and every flag in words; the prompt timings. The inquiry page lists its selfie captures with what became of each. Every selfie reason and `selfie.*` event has words. The settings page edits the two face settings, and each session shows the consent it recorded. `ui-selfie.spec.ts` covers it in the browser |
| C49, calibration | `fetch_fixtures.py --harvest-calibration` builds the set from Commons PD-USGov NASA, State and Military official portraits by rules fixed before any score: one named person per file (structured data or a per-person category through Wikidata), no personality-rights or Congress file, JPEG originals. 707 pseudonymous identities, 1,832 photos pinned by SHA-256 (the images are never committed). The first tails review exposed identity-grouping errors in the harvest rules, which were fixed test-first before the final measurement; the second review kept 106 of 107 photos and excluded one misattribution. `docs/calibration/selfie-phase4.md` (report) and `selfie-phase4-method.md` (method) name no one |
| Defaults | **`FACE_MATCH_DEFAULTS` moved from 0.363 to 0.394, basis `calibrated`**, by the rule fixed in advance (0.363 lay below the FAR 1e-3 interval). Three synthetic-face clear levels that flagged genuine photos moved to the genuine 99th percentile, still provisional |

**Calibration** (studio portrait pairs, not selfie against ID card; 1,574 genuine and 249,571 impostor pairs; 95% bootstrap over identities):

| Threshold | FAR | FRR |
|---|---|---|
| 0.363 (SFace's published value) | 2.40e-3 (1.99e-3–2.87e-3) | 0 |
| **0.394 (the new default)** | **7.57e-4 (5.62e-4–9.87e-4)** | **0** (rule-of-three floor 1.91e-3) |
| 0.4364 (FAR 1e-4, resolvable at this size) | 9.62e-5 | 1.27e-3 |
| 0.5 (`selfie_repeat_detection`) | 4.01e-6 | 9.53e-3 |

Expected false matches per 1:N search at 0.394: 0.76 at N = 1,000, 7.6 at 10,000, 76 at 100,000 (at the repeat default 0.5: 0.004, 0.04, 0.4). Skew: 588 men, 117 women, 2 unknown; a median age gap of 3 years between a person's photos; per-group FRR unmeasured. On these genuine portraits the passive-liveness mean is below 0.27 for 5% of photos, so still or retouched portraits often read as spoofs (stated in `docs/checks/selfie.md`).

**Review findings** (1 CRITICAL, 9 MEDIUM, 6 LOW; none refuted). Fixed with a RED test first: the CRITICAL and every MEDIUM, plus the four known items from 4A:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| H001 | CRITICAL | A database error on a background-layout query was logged with the layout in its message | Failed queries no longer carry their parameters into logs, Valkey or stderr |
| H002 | MEDIUM | The calibration test "bootstraps over identities" could not fail | A clustered-impostor fixture that fails a pair bootstrap |
| H003 | MEDIUM | The passive-liveness default's genuine rejection rate was unstated | The report and the selfie doc state it |
| H007, H008 | MEDIUM | An empty side crop gave an untyped 500; a selfie request held every full-size decode at once | The crop is clamped; one full-size decode at a time |
| H009 | MEDIUM | Apache-2.0 attribution missing for the derived MiniFASNet preprocessing and MediaPipe points | `services/vision/NOTICE` and file headers |
| H010 | MEDIUM | The download rate budget skipped `--calibration` and parallel downloads | One shared budget |
| H013 | MEDIUM | The web selfie kept working on a frozen frame after the camera track ended | The track's `ended`/`mute` releases the camera with an error |
| H014 | MEDIUM | Android started the capture clock before the camera permission | The capture is created once the camera can show |
| H015 | MEDIUM | No warning or extension for the 180 s capture limit (WCAG 2.2.1) | Partly: Android states the limit; the rest is an owner decision |
| K201–K204 | known | The expiry job left capture objects; no 409 problem fixtures; an unused replay lookup; ORT notices unnamed | All fixed |

**Validation** (the plan's list in order, on `main` at `d49d733`):

| Suite | Result |
|---|---|
| Install, model fetch, format, lint, typecheck (`--force`) | pass |
| TypeScript unit (12 packages, `--force`) | 9,482 tests in 5 min 24 s, every package at or above 80%: api 2,479 at 97.63 / 90.63 / 98.62 / 97.66; dashboard 1,805 at 98.52 / 94.49 / 98.84 / 98.53; contracts 1,409 at 100%; checks 1,330 at 98.97 / 89.69 / 99.66 / 98.9; flow 728 at 96.71 / 91.46 / 96.66 / 96.77; db 684 at 98.82 / 91.83 / 99.3 / 98.76 |
| Integration (Testcontainers) | api 62, db 46 |
| Vision | 1,889 tests at 99.81% coverage; ruff, mypy |
| Android (`--rerun-tasks`) | SDK 631 and demo 18 unit tests; Kover gate; assemble; lint |
| Playwright | 38 mocked flow specs; 50 full-stack tests in 6.8 min |
| Apps image, C41.5 benchmark (median 0.39 s), gitleaks (1,422 commits), CI contract (132), compose live (191), apps image context (8), connected-results (11), gitleaks installer (9), pre-commit hook (11) | pass |

GitHub CI on Workflow 4A's push (`97d11ed`) was green in all ten jobs, emulator included: the head-turn clips read the same yaw ratios to four decimals on GitHub's AMD runner as locally, and the selfie benchmark took a median of 0.45 s on 2 vCPUs.

**Carried forward:**
- WCAG 2.2.1 and the 180 s capture limit: an extend route, or restarts that do not count toward the cap, plus a 20 s warning in both clients (owner decision; the web flow has no warning yet).
- Whether a first-attempt `passive_liveness_low` should keep a retry (it is fraud today; changing it changes C30.1).
- The calibration covers studio portraits only; a selfie-against-ID-card calibration needs consented volunteer captures.
- Two sample API fixtures still show the old threshold 0.363 in their recorded metadata (cosmetic).
- `fixtures/faces/calibration/.previous` (the first harvest's hard links, gitignored) can be deleted by the owner; the agent's deletion was blocked by a safety hook.

**Next.** The owner asked on 2026-10-21 for mobile code that ports easily to iOS: before Phase 5, the Android SDK moves to Kotlin Multiplatform and Compose Multiplatform (`docs/plans/kmp-migration.plan.md`, four sequential agents, every existing test kept). Phase 5 (`docs/plans/phase-5.plan.md`: contracts C50–C68, Workflows 5A, 5B, 5C) follows; its plan went through three adversarial reviews and a verification pass (111 findings, all resolved but one rejected with evidence and one part-deferred; `docs/plans/phase-5-review-resolution.md`).

## 2026-10-21: Phase 4, Workflow 4A done (selfie checks and liveness)

Workflow 4A (`cbe3d5c..62fc9fa`, 286 agent commits) ran in four stages, path-owned and test-first. Every agent committed stub, RED and GREEN steps, then refactored on a green suite. Every decision an agent took is recorded in the plan as a "Workflow 4A Stage N amendment".
- **Stage 1, `contracts`:** the registry, reasons and config defaults with their basis, the capture resource and storage, the vision schemas and stubs, the shared capture constants with the yaw measurement, the default template, dependencies and plumbing (`docs/tdd/phase4-contracts.tdd.md`).
- **Stage 2, in parallel:**
  - `vision-face`: face quality, head pose, passive liveness, occlusion;
  - `vision-integrity`: cross-pose consistency, the synthetic-face cues, the background layout and `/v1/compare/background`;
  - `checks-logic`: all 15 §4.2 evaluators, the cascade, the calibration report's selfie mode;
  - `fixtures`: the head-turn clips and the other synthetic selfie fixtures, the fetcher's calibration mode, the calibration and benchmark tools;
  - `flow-capture`: the C40 protocol and in-browser guidance in the web flow;
  - `android-capture`: the C40 protocol on Android.

  Each has its own `docs/tdd/phase4-<agent>.tdd.md`.
- **Stage 3, in parallel:** `api-flow` (the capture routes and services, consent, the API resources) and `api-worker` (the selfie job, face data, the scan, the providers, retention and rebuild).
- **Stage 4, `integration`:** the e2e specs, the benchmarks, the check docs, integration defects and the full validation (`docs/tdd/phase4-integration.tdd.md`).

| Item | What landed |
|---|---|
| C39 | Covering becomes user behaviour; five checks move to version 2. `SELFIE_CHECK_REASONS` lists every reason the evaluators emit (the new shared `not_consented` among them). Every selfie threshold has a config key and a default labelled `provisional` with its basis, recorded per result in `provenance['threshold-basis']`. `FACE_MATCH_DEFAULTS` (0.363) replaces every copy of the face-match threshold |
| C40 | Selfie captures (`self_`): a 128-bit nonce stored as SHA-256 and compared in constant time, a 180 s expiry, center first then a random side order, one upload per pose with `capture-id`, `nonce` and `client-elapsed-ms`, a submit that consumes the capture once (repeat-safe), supersede on a new capture, and the 11th capture cancelling the verification. `selfie.*` events, the C40.10 verification attributes, `?include=selfies`, migration 0015. Every writer follows the C40.6 lock order, with 13 Postgres race tests |
| C41 | Vision selfie analysis v2 per pose: landmarks, face-region quality, head pose (YuNet yaw ratio and SQPnP), passive liveness (the MiniFASNet V2 and V1SE ensemble, within 7.6e-7 of upstream's own pipeline), covering and glasses heuristics, five synthetic-face cues and the IPTC digital source type, an 8 × 6 Lab background layout, and cross-pose identity, planarity, SSIM and duplicates. `/v1/compare/background` compares up to five candidates. ONNX Runtime telemetry is off in the service and the image |
| C42 | Sealed face templates, written only for a passed verification whose liveness and ID comparison passed, with the optional matching consent re-checked under the inquiry lock. The worker scans them newest first in batches of 1,000 up to `face-search-max-templates` (default 50,000), leaving out the inquiry's own account. `selfie_backgrounds` (`vector(144)`, HNSW) feed the background check. Templates go on decline, failure, redaction and after `face-template-retention-days` (default 365). `face-index:rebuild` re-embeds without ever creating a row |
| C43 | All 15 checks have an evaluator at their tier, so no enabled selfie check answers `not_implemented`. Cascade contract tests: an insufficient turn alone, or a dark centre alone, fails one user-behaviour check and stays retryable; liveness and pose repeat never fail on it. Liveness reports its passive, active and integrity components, capped at confidence 0.6. The sandbox test-capture rule lets the e2e camera through in sandbox only |
| C44 | Ports for age estimate, public figure and suspicious entity, with deterministic sandbox providers (`OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_*`, `_SELFIE_PUBLIC_FIGURE_*`, `_SUSPICIOUS_ENTITY_*`); a sandbox binding on a production variable stops startup |
| C45 | The default template asks for three poses with active liveness and offers the matching consent as an optional key. The generator (version 6) renders head-turn MJPEG clips of person A and person B, a static replay, spoofs, coverings and glasses. Five e2e specs moved to the protocol and four are new: the static replay gets a pose hint, an unbound A-tier check goes to review, the same face on two consenting accounts trips `selfie_repeat_detection`, and the built flow runs under its CSP with no outside request |
| C46 | The web flow keeps the camera open, runs YuNet in the browser (`onnxruntime-web` 1.30.0, single-threaded WASM, every file SHA-256-checked, CSP `script-src 'self' 'wasm-unsafe-eval'`), captures each pose automatically once it is held, and offers the shutter after 10 s or when the model cannot load. Android follows the protocol with a manual shutter. Both offer the matching consent unticked |
| C48 | The carry-overs: telemetry, the fetcher, the PLAN rows, the Vitest module cache, the capture step's focus, Android's `UNKNOWN` status, the brightness fixture, the licence rows, the image's YuNet model |
| Integration | Defects found and fixed test-first: the dashboard inquiry page crashed on an inquiry with a capture; capture ids were missing from the timeline query; the golden analysis fixture's left pose turned right; the apps image could not build (`.dockerignore` left out `models/manifest.json`); two flow tests failed only under load |
| Orchestrator | GitHub's runner caught the flow's screen focus moving in a passive effect after an API answer (the race the note editor had). The hook is now a layout effect, with a test that fails on the passive version (`db7c0c2`, `565e165`) |

**Measurements:**
- **Yaw anchor** (C40.11): `min-side-yaw-ratio-change` 0.077 (the median change YuNet reads for a rendered 12° turn), `max-center-yaw-ratio` 0.021 (5°). The clips turn 24°, because at 22° the smallest change (0.076) missed the 1.25 × trigger.
- **End-to-end clips** (server readings): person A's centre 0.0076, turns +0.203 and −0.129, ID similarity 0.68. Person B's centre −0.0147 and turns ±0.111, the smallest margins; ID similarity 0.15, so `face_mismatch`. The static replay turns only 0.013 and 0.045, so a pose retry.
- **C41.5 benchmark:** median 0.44 s for three poses at 1,280 px (0.39 s on an idle machine), against the 3 s budget. The synthetic-face cues take the largest share (156 ms).
- **C42.4 scan:** 50,000 sealed templates decrypted and scored in a median of 2.4–2.5 s. Readings are bimodal: two to four runs in ten take 5.1–5.7 s.
- **In-browser guidance:** YuNet takes 13–15 ms per frame on a 320 × 256 input in Chromium; the ORT session starts in about 0.36 s.

**Validation** (the plan's list in order, on `main` at `62fc9fa`):

| Suite | Result |
|---|---|
| Install, model fetch, format | pass |
| Lint and typecheck (`--force`) | pass |
| TypeScript unit (12 packages, `--force`) | 9,267 tests in 5 min 53 s, every package at or above 80%:<br>api 2,449 at 97.6 / 90.58 / 98.55 / 97.64<br>dashboard 1,658 at 98.43 / 94.33 / 98.74 / 98.45<br>contracts 1,405 at 100%<br>checks 1,318 at 99.02 / 90.12 / 99.64 / 98.96<br>flow 712 at 96.56 / 91.39 / 96.18 / 96.66<br>db 678 at 98.82 / 91.8 / 99.29 / 98.76<br>core 569, node 212, flow-spec 88, e2e harness 79, ui 54, config 45 |
| Integration (Testcontainers) | api 62, db 46 |
| Vision | 1,806 tests at 99.89% coverage; ruff, mypy |
| Android (`--rerun-tasks`) | SDK 616 and demo 18 unit tests; Kover gate; assemble; lint |
| Playwright | 38 mocked flow specs; 48 full-stack tests in 6.4 min |
| Apps image | builds; its flow carries YuNet at the pinned digest |
| Benchmark (C41.5) | median 0.44 s |
| gitleaks (1,307 commits scanned); CI contract with actionlint (132); compose, live (191); apps image context (8); connected-results checker (11); gitleaks installer (9); pre-commit hook (11) | pass |

**Known limits** (documented in `docs/checks/selfie.md`):
- the protocol does not stop real-time face swaps through a virtual camera, a looping head-turn video, stills shown in turn, or 3-D masks; capture method, timings and the device snapshot are client claims;
- MiniFASNet scores the simulated screen replay (0.59) and print (0.54) above the 0.5 default, and injected or synthetic frames as real;
- YuNet's own frontal bias (about ±0.03) exceeds the 0.021 centre limit, so some genuine users will meet the manual shutter or a pose retry;
- the covering heuristic misses hands, beards and skin-toned masks; rimless glasses are missed;
- planarity, the duplicate rule and the synthetic cues are measured on synthetic re-poses only, never on live captures.

**Carried into Workflow 4B:**
- C47, the console surfaces; C49, the face-match calibration on PD-USGov portraits;
- the synthetic-signal scale: clean re-encoded photos read up to 2.19 on the spectral-tail cue, which the fusion treats as fully suspicious at 1.0, so genuine uploads can fail the advisory suspicious-entity check;
- the expiry job leaves deleted capture files' objects in storage (crypto-shredded); no golden 409 problem fixtures for the four capture codes; Stage 1's unused `findReplayedFiles`; the served ORT notices not named in `THIRD_PARTY_LICENSES.md`;
- the review of all of Phase 4, and a GitHub CI run for the clips and auto-capture on hosted runners.

**Decisions to confirm (owner)**, besides the 21 in the plan:
- the centre limit 0.021 stays stricter than YuNet's frontal bias until real captures can calibrate it;
- the clips turn 24° (within the planned ±25°);
- a stored ID front that is gone or unreadable gives `no_reference_data` (review) instead of failing the selfie job;
- `face-index:rebuild` deletes a template when the new model finds no face in its centre photo;
- the sandbox providers see the birthdate only when `selfie_age_comparison` is enabled;
- any canceled verification of a pending inquiry counts as a failed attempt;
- Chromium's plain fake camera label `fake_device_0` is not on the virtual-camera list;
- the compose test's live checks run the `openverify` project on the developer's own volumes;
- a native speaker should review the new Spanish strings (retry reasons, guidance, the matching consent).

## 2026-10-21: Phase 3 done, with Workflow 3B (console and client surfaces, review, fixes)

Workflow 3B (`70e78f1..7210740`, 83 commits) ran in two stages, path-owned and test-first. Every decision is recorded in the plan as a "Workflow 3B Stage 1 amendment" (16) or a "Workflow 3B review amendment" (15, plus two deferred items).
- **Stage 1, in parallel:**
  - `surfaces-dashboard`: C37 in the console, and E003 (`docs/tdd/phase3-surfaces-dashboard.tdd.md`);
  - `surfaces-clients`: C37 in the web flow and on Android, and the 2E carry-over (`docs/tdd/phase3-surfaces-clients.tdd.md`).
- **Stage 2, review of all of Phase 3:** four reviewers (privacy and security, check correctness, vision, clients and console), one verifier for every CRITICAL and HIGH finding, then a TypeScript fixer and a Python fixer (`docs/tdd/phase3-review-fixes.tdd.md`, `docs/tdd/phase3-review-fixes-python.tdd.md`). Android had no findings.

| Item | What landed |
|---|---|
| C37, console | Check results list required failures, then required checks without evidence, then advisory failures, and fold the rest into a disclosure that counts them by status. A needs_review verification says why. Each result shows a text Beta badge, its confidence when there is one, every reason in words with its code ("Not configured" for an unbound provider), and its provenance. Needs review has its own badge tone. The verification page lists every extraction attribute, "Hidden" without `pii:view` and "Redacted" after redaction; a test helper proves no masked value reaches the RSC payload. The template editor names the check and setting of each config error |
| C37, clients | The 20 reasons a retry hint can carry come from the contracts, through a shared fixture, with English and Spanish strings on the web and messages on Android. Android gains a complete Spanish resource set, and consent records `es` on a Spanish device. A verification in review ends on the normal "submitted" screen on both clients. The Kotlin MRZ code is checked against all 23 MRZ vectors |
| 2E carry-over | E002 (the select border guard can now fail), E003 (`/api-keys` reports every error in one refusal), the `FlowRenderer` retry focus, and a create answered 2xx with an unexpected body (both clients read the session and reuse the verification) |
| K101 | The ID portrait is the largest face inside the document quad, so a card held beside a face yields the card's portrait. `POST /v1/embed/face` takes `subject` (`selfie` by default, or `document`), and the API sends `document` when it re-embeds a stored ID front |
| K102, K103 | The vision image ships `NOTICE`. The CI model cache keeps the OCR dictionary (key prefix `models-v2-`), and the API fixture shows the calibrated pHash distance 13 |

**Review findings** (1 CRITICAL, 3 HIGH, 8 MEDIUM; none refuted, all fixed with a RED test first):

| Id | Severity | Finding | Fix |
|---|---|---|---|
| G001 | CRITICAL | API logs showed the government ID extraction to readers without `pii:view` (the Developer role) | The API log masker nulls every extraction attribute at any depth, in whole bodies and truncated previews |
| G002 | HIGH | A verification processed while its inquiry was being redacted wrote a fresh, unredacted extraction and an event carrying it | The write locks the inquiry first and reads `redacted_at`; a redacted inquiry writes nothing and the verification fails without data. A Postgres test covers both lock orders |
| G004 | HIGH | A genuine US licence printing `USA` alone in its header failed the required `id_extraction_inconsistency_detection` (barcode IIN compared with an ICAO code) | Issuer codes compare only within one scheme; ICAO codes compare as countries |
| G010 | HIGH | An elongated upload of a few hundred bytes made a text-detector input of up to 95 Mpx (10 GB, 34 s, or an OOM kill) | The detector input's longer side is capped at 2,000 px and normalised in float32; such uploads now answer at once |
| G003 | MEDIUM | The blind index was equal for the same number in every environment and organization | A per-environment subkey; existing databases need one `blind-index:rebuild` |
| G005 | MEDIUM | An MRZ with an invented state code (`ZZZ`) passed | Issuing state and nationality must be ISO or ICAO codes (or `UTO`) |
| G006 | MEDIUM | 29 February was valid in any MRZ year, and the date then vanished from the extraction | Only years that can be leap years |
| G007 | MEDIUM | Any name agreed with a longer name it prefixes (`DOE` / `DOEBERT`) | Prefixes only for a full, truncated MRZ name field |
| G008 | MEDIUM | A passport holder with a single name failed `id_extracted_properties_detection` on every retry | A valid MRZ stating a single name satisfies `name-first` (`single-name: true`) |
| G009 | MEDIUM | Error-level analysis counted as measured on a side without a portrait, inflating tamper confidence | Counted only on a side with a portrait |
| G011 | MEDIUM | OCR recognised up to 1,000 detected lines but reported 200 | Only the first 200 lines in reading order are recognised; batches are bounded |
| G012 | MEDIUM | The full-stack happy path failed under the new folded check layout | The spec opens the folded checks before reading them |

**CI fix.** The push of `70e78f1` failed one vision test on GitHub's runner: the copy-move variant test expected `TM_SQDIFF` to score exactly 0, but OpenCV sums in floating point, and the score differs by CPU (20.0 there). The test now uses the best match only to locate the source and compares the pixels exactly, which is also stricter (a one-pixel change still scored 0.0 locally). It was proven on a branch with all 10 CI jobs green, then landed as `d098987`.

**Validation** (the plan's list in order, on `main` at `a7ff43a`):

| Suite | Result |
|---|---|
| Install, model fetch, format | pass |
| Lint and typecheck (`--force`) | 12 tasks each, none cached |
| TypeScript unit (12 packages, `--force`) | 8,405 tests in 6 min 18 s, every package at or above 80%:<br>api 2,197 at 97.54 / 90.51 / 98.46 / 97.6<br>checks 1,119 at 98.7 / 90.15 / 99.52 / 98.62<br>db 638 at 98.84 / 92.37 / 99.41 / 98.78<br>dashboard 1,655 at 98.43 / 94.33 / 98.74 / 98.45<br>flow 540 at 98.81 / 95.63 / 99.27 / 98.87<br>contracts 1,291 at 100% |
| Integration (Testcontainers) | db 46, api 38 (including the new redaction race test) |
| Vision | 1,243 tests at 100% coverage (4,401 statements, 648 branches); ruff, mypy |
| Android (`--rerun-tasks`) | 534 unit tests (SDK 516, demo 18); Kover gate; assemble; lint |
| Playwright | 29 mocked flow specs; 44 full-stack tests in 4.1 min |
| gitleaks (1,037 commits scanned); CI contract with actionlint (125); connected-results checker (11); compose static (190); gitleaks installer (9); pre-commit hook (11) | pass |

**Upgrading a database written before `395c58f`:** run `pnpm --filter @openverify/api blind-index:rebuild` once (G003).

**Follow-ups** (none blocking; the detail is in the two Stage 1 TDD files):
- the web flow decodes flow API answers strictly, so a value a newer server adds shows the generic error during a rolling deploy;
- on Android, an `UNKNOWN` verification status leads to a new attempt;
- the capture step's "Try again" loses focus while it runs (the F016 pattern applies);
- Vitest 5's module cache keeps `import.meta.glob` results stale when a matching file is added;
- Android does not check the created verification id's format;
- the console cannot say "Redacted" on the verification page without `inquiries:read`, and the inquiry cards do not show the extraction;
- `rscPayloadOf` could guard the other PII pages;
- a native speaker should review the Spanish copy, the Android consent texts in particular.

**Decisions to confirm (owner)**, besides the eight from Workflow 3A below:
- a verification whose inquiry was redacted during processing fails without data (G002);
- the blind index uses a per-environment subkey, so existing databases need a rebuild (G003);
- MRZ issuing states must be ISO or ICAO codes, with `UTO` accepted for the sandbox (G005);
- a valid MRZ that states a single name satisfies `name-first` (G008);
- OCR reads at most 200 lines per side (G011); a total recognition budget for very dense pages is open;
- the vision image ships `NOTICE` but not the Apache License text, which needs a copy under `services/vision/` or a wider build context;
- the Android SDK speaks Spanish on a Spanish device, beyond the message strings C29.4 asked for.

## 2026-10-21: Phase 3, Workflow 3A done (government ID checks)

Workflow 3A (`ec047e0..7f520b8`, 278 commits) ran in four stages, path-owned and test-first. Every agent committed stub, RED and GREEN steps, then refactored on a green suite.
- **Stage 1, `contracts`:** the shared contracts, storage, vision schemas and stubs, dependencies, and the CI and e2e plumbing (`docs/tdd/phase3-contracts.tdd.md`).
- **Stage 2, in parallel:**
  - `vision-document`: document detection, rectification, document quality, portrait clarity and pHash, plus 1B F021 and F022;
  - `vision-ocr`: the vendored OCR runtime, PP-OCRv6 small, MRZ localisation and reading;
  - `vision-forensics`: barcodes (zxing-cpp) and every forensic measurement;
  - `checks-logic`: data tables, parsers, extraction and all §4.1 evaluators;
  - `fixtures`: the marker-free synthetic card, the variants, the AAMVA images and the calibration tool.

  Each has its own `docs/tdd/phase3-<agent>.tdd.md`.
- **Stage 3, `api-wiring`:** the worker, extraction storage, the C34 lookups, the C35 providers, the default template and the C38 API items (`docs/tdd/phase3-api-wiring.tdd.md`).
- **Stage 4, `integration`:** calibration, the benchmark, the e2e specs, the check docs and the full validation (`docs/tdd/phase3-integration.tdd.md`).

Every decision an agent took is recorded in the plan as a "Workflow 3A Stage N amendment".

| Item | What landed |
|---|---|
| C29 | Every registry entry has `version`, `modelBased` and `inputs`. Model-based and H-tier checks are `beta`. Every result carries `stage`, `confidence` and `provenance` (implementation version, model digests, provider, thresholds), persisted by migration 0010. `GOVERNMENT_ID_CHECK_REASONS` lists every reason an evaluator may emit. Kebab-case per-check config is validated by the template schema |
| C30 | `decideVerification` returns `passed`, `failed`, `needs_review` or `pending`. The verification status `needs_review` comes from migration 0011. A government ID sent to review settles the inquiry as `completed`, then `needs_review`, with both events in order. The last-attempt rule records `execution_error` or `input_missing` per check. Utopia (`UTO`) is the sandbox test issuer and a specimen issuer in production |
| C31 | The extraction comes from MRZ, AAMVA and the label-anchored VIZ parser (EN/ES/FR/DE), consolidated under the agreement rules with OCR correction limited to C31.3. It is stored in `government_id_extractions` (migration 0012, sealed fields, a blind index under `OPENVERIFY_BLIND_INDEX_KEY`, a banded front pHash). It is masked without `pii:view`, cleared by redaction and included in the KEK rewrap. `blind-index:rebuild` exists, and migration 0013 adds the class group it needs |
| C32 | Vision v2 per side: document detection (contour, lines, full frame) and rectification; document quality; text (PP-OCRv6 small on a vendored RapidOCR runtime, without `pyclipper` or `shapely`); MRZ; barcodes; portrait clarity; forensics; pHash. F021 answers a typed `inference_failed` 500. F022 checks the service token before the body is read |
| C33 | `zxing-cpp` 3.1.1; dev dependencies `pdf417gen`, `iso3166` and `mrz` (oracle). The OCR models are pinned by commit and SHA-256. Data tables: ISO 3166 and ICAO codes, 72 AAMVA IINs, 51 US licence grammars, 21 national checksums, the frozen specimen markers and the feature table. MRZ and AAMVA vectors are in `contracts/fixtures/` |
| C34 | The repeat lookup (blind index plus pigeonhole pHash bands, another account only, redacted rows skipped) is a BitmapOr of 9 indexes, 12.8 ms at 50,000 rows. Inconsistent-repeat, inquiry and account comparisons re-embed faces from the encrypted files, so no embedding is stored |
| C35 | A-tier ports with deterministic sandbox providers. A sandbox provider bound to production stops the API and the worker at startup. A check with no provider bound answers `provider_not_configured` |
| C36 | The default template (16 required, 16 advisory, 3 A-tier disabled). The happy card (CALDERWOOD NORA, `UT4829163`) carries no specimen marker. The generator (version 5) adds 22 variants, the AAMVA barcode-only images, a calibration run and the report `docs/calibration/government-id-phase3.md`. New e2e specs cover expired, blurred then retaken, specimen, and needs_review through an unbound A-tier provider |
| C38 | Lock fixes F015, F016 and F025, each with a Postgres test. Migration 0014 recreates 28 list indexes `DESC NULLS FIRST` (EXPLAIN shows Index Scan instead of Sort). The event fixtures name the template version. The e2e flow submit helper |
| Docs | `docs/checks/government-id.md` covers all 36 checks; `docs/checks/sandbox-providers.md` lists every magic value |

**Calibration** (synthetic fixtures only, so every H-tier check stays beta). The defaults now take the report's midpoints:

| Key | Default | Margin |
|---|---|---|
| `min-document-blur-score` | 96.56 | 81.55 |
| `min-document-width-px` | 616 | 308 |
| `max-document-glare-ratio` | 0.055 | 0.046 |
| `min-front-back-phash-distance` | 13 | 13 |
| `max-color-inconsistency-score` | 0.622 | 0.377 |
| `max-electronic-replica-score` | 0.418 | 0.416 |
| `max-handwriting-score` | 0.383 | 0.079 |

No genuine card fails any check. 16 fraud and capture variants trip their check. Three are missed and documented as limits:
- the translucent `specimen-overprint` (the OCR does not read the stamp across the portrait);
- the synthetic portrait swap and copy-move (tamper scores 0.394 and 0.41, inside the genuine range up to 0.441).

The pHash half of `id_repeat_detection` stays off: distinct holders sharing a photo are 0–10 bits apart, re-encodings 0–2.

**Benchmark (C32.4).** Both sides at 1,600 px take a median of 2.62 s on a Xeon E5-1650 v3, within the 5 s budget. OCR of the visual zone is 1.56 s of that. The CI vision job logs the benchmark without gating on it.

**Validation** (the plan's list in order, on `main` at `7f520b8`):

| Suite | Result |
|---|---|
| Install, model fetch, format | pass |
| Lint and typecheck (`--force`) | 12 tasks each, none cached |
| TypeScript unit (12 packages, `--force`) | 8,115 tests in 4 min 58 s, every package at or above 80%:<br>api 2,189 at 97.54 / 90.47 / 98.46 / 97.59<br>checks 1,083 at 98.77 / 90.13 / 99.52 / 98.69<br>db 635 at 98.84 / 92.37 / 99.41 / 98.78<br>dashboard 1,429 at 98.43 / 94.42 / 98.69 / 98.45<br>flow 524 at 98.8 / 95.55 / 99.26 / 98.87<br>contracts 1,290 at 100% |
| Integration (Testcontainers) | db 46, api 36 |
| Vision | 1,223 tests at 100% coverage (4,377 statements, 648 branches); ruff, mypy |
| Android (`--rerun-tasks`) | 477 unit tests; Kover gate; assemble; lint |
| Playwright | 25 mocked flow specs; 43 full-stack tests in 3.6 min |
| gitleaks (950 commits scanned); CI contract with actionlint (121); connected-results checker (11); compose static (190); gitleaks installer (9); pre-commit hook (11) | pass |

**Known limits** (documented in `docs/checks/government-id.md`):
- the OCR misses translucent overprints;
- tamper does not separate the synthetic swap or copy-move;
- vertical cards and cards turned more than 45° are not found;
- `compromised_list_match` cannot fire until the Phase 7 lists;
- every e2e run submits the same card, so the advisory `id_repeat_detection` fails across runs.

**Carried into Workflow 3B:**
- the C37 console and client surfaces: the Beta badge, confidence, reasons in words, "not configured", the extraction fields, the Phase 3 retry-hint strings, the Kotlin MRZ vectors;
- E002 and E003;
- the `FlowRenderer` retry focus;
- the create-with-unexpected-body retry;
- the ID portrait is the largest face on the whole upload, not inside the document quad (a card held up beside a face);
- the vision image does not ship `services/vision/NOTICE`;
- the CI model cache misses the OCR dictionary.

**Decisions to confirm (owner)**, besides the 12 in the plan:
- non-retryable vision 4xx answers (a wrong service token, for example) are recorded as `execution_error` instead of failing the verification;
- `verification.*` webhook payloads carry the extraction unmasked; the Events API masks it per principal;
- the F025 lock order, with its new 409;
- `id_age_comparison` is enabled without limits in the default template, so it answers `age_limits_not_configured`;
- the calibrated defaults: at a 616 px minimum document width, a card that fills less than about half of a 1,280-pixel frame gets the `resolution_too_low` hint;
- the specimen fixture approach (a printed banner, plus a separate overprint variant);
- `min-document-tenengrad` stays template-only;
- missing OCR models answer 200 with null text-model versions, read as not measured, rather than 503.

## 2026-10-20: Phase 2 done, with Workflow 2E (API gaps, the remaining console pages, the 2D carry-over)

Workflow 2E (`68f0d54..80b1b6b`, 69 commits) ran in three stages, path-owned and test-first, with RED, GREEN and refactor commits:
- **Stage 1, `api-gaps`:** C25 items 1–9 in contracts, db, API and `@openverify/node` (`docs/tdd/phase2-api-gaps.tdd.md`).
- **Stage 2, in parallel:**
  - `console-gaps`: C26, the C27 UI specs and the 2D items F012–F015 (`docs/tdd/phase2-console-gaps.tdd.md`);
  - `clients-reason`: C25.8 in the web flow and on Android, and the 2D items F018 (Android), F010, F016, F022 and F023 (`docs/tdd/phase2-clients-reason.tdd.md`).
- **Stage 3:** two read-only reviewers, for the API (security and correctness) and the clients. They found 0 CRITICAL, 0 HIGH, 1 MEDIUM and 2 LOW. One fixer fixed the MEDIUM test-first (`docs/tdd/phase2-review-2e-fixes.tdd.md`).

| Item | What landed |
|---|---|
| C25.1 | The MFA sign-in routes answer 401 with `mfa_code_invalid`, `mfa_attempts_exhausted` or `mfa_token_invalid`. `/login/mfa` follows the code, and the dashboard's own attempt counter is gone |
| C25.2 | `GET /dashboard/roles/:id`; `/roles/[id]` reads it (404 for an unknown or foreign role) |
| C25.3 | `PATCH /account-types/:id`, additive only: 422 with a JSON Pointer to each removed or retyped key, under a row lock. `/account-types/[id]` edits it in the JSON editor |
| C25.4 | Every inquiry answer and `inquiry.*` event names its pinned `inquiry-template-version`; the inquiry page links it |
| C25.5, C25.6 | `POST /api-keys` takes `expires-in-seconds`, and the console creates a key with its expiry in one call. Every key answer carries `pii-masked`, shown as Masked or Visible |
| C25.7 | `GET /events?filter[inquiry-id]=` (inquiry, verification and session events, through existing indexes); the inquiry timeline uses it and links verification events |
| C25.8 | The flow API's `session_canceled` carries `reason`. The web flow and Android end on the link-expired, redacted or ended screen. An unknown reason falls back to the ended screen without losing the code |
| C25.9 | `GET /api-logs?filter[user-id]=`, served by a new index (migration 0009); `/api-logs` filters and links by user |
| C26 | `/verifications/[id]` (checks, reasons, metadata, files) and `/account-types/[id]`; the API key rate-limit panel |
| C27 | `ui-console-gaps.spec.ts` (new), plus additions to `ui-integrations`, `ui-mfa`, `ui-navigation` and `ui-flow-links` |
| 2D F018 (Android) | After a lost `createVerification` answer, OkHttp timeouts included, the coordinator reads the session and reuses the newest `initiated` verification |
| 2D F010, F012–F016 | The flow's language select uses `border-control`; focus stays on a remaining control; JSON errors are described by path and detail; relation actions are named; retries are numbered ("Government ID, attempt 2"); the one-time-link flow keeps focus on Try again |
| 2D F022, F023 | The refused-link test detects a second redeem; the picked-photo test proves camera and GPS metadata are stripped |
| 2E E001 (MEDIUM, review) | The verification page blamed `pii:view` for images hidden by a missing `inquiries:read`. It now names the right permission and links no inquiry the operator cannot open |

**Surface.** Of the 50 API path files, 48 now have a console page or client behind them: 2E adds `verifications/{verification-id}` and `rate-limits`. The two left are by design: `inquiries/{inquiry-id}/resume` (the console hands off with one-time links) and `inquiry-sessions/{inquiry-session-id}` (the list on the inquiry page shows as much).

**CI on GitHub (Workflow 2D push of `68f0d54`, run 39508211213).** Two jobs failed:
- **e2e:** `ui-client-address.spec.ts` failed with `bind EINVAL 127.0.0.2`. GitHub's runners resolve `localhost` to `::1` first, and an IPv6 socket cannot bind an IPv4 source address. The request now asks for IPv4 (`family: 4`).
- **android-instrumented:** the emulator system image download failed ("unknown archive"), a runner-side failure; it passed on the re-run.

The fix was proven on a branch (run 39509844908, all 10 jobs green) before it was cherry-picked onto `main` as `0645cd9`.

**CI on GitHub (Workflow 2E push of `58c1487`, run 39527933756).** 9 of 10 jobs passed. The integration job failed after all 39 db tests passed, on two unhandled `57P01` errors: idle clients of a test pool got the stopping container's shutdown notice after `pool.end()`, and nothing listened on the pool. Every integration test now builds its pool with `createIntegrationPool` (`@openverify/db/testing`), which ignores only that notice (`8007269..977e9e3`; evidence in `docs/tdd/phase2-review-2e-fixes.tdd.md`).

**Validation** (the plan's list in order, on `main` at `80b1b6b`):

| Suite | Result |
|---|---|
| Install, format | pass |
| Lint and typecheck (`--force`) | 12 tasks each, none cached |
| TypeScript unit (12 packages, `--force`) | 7,112 tests in 5 min 17 s; every package at or above 80% (api 2,065 at 97.56 / 90.48 / 98.37 / 97.63; dashboard 1,427 at 98.43 / 94.42 / 98.69 / 98.45; flow 522 at 98.8 / 95.54 / 99.26 / 98.87; contracts 1,224 at 100%) |
| Integration (Testcontainers) | db 39 (including two query-plan tests for C25.7 and C25.9), api 32 |
| Vision | 446 tests; ruff, mypy; 100% coverage |
| Android (`--rerun-tasks`) | 474 unit tests (SDK 456, demo 18); Kover gate; assemble; lint |
| Playwright | 25 mocked flow specs; 39 full-stack tests in 2.9 min |
| gitleaks (665 commits scanned), CI contract with actionlint (115), connected-results checker (11), compose static (188), gitleaks installer (9), pre-commit hook (11) | pass |

**Carried into Phase 3** (none blocking; the detail is in the plan's Workflow 2E "Result"):
- review LOWs E002 (a browser-test guard that cannot fail) and E003 (`/api-keys` reports a bad custom expiry and bad key attributes one at a time);
- the 53 older descending list-index columns are `NULLS LAST`, so lists sort after the index scan instead of stopping at the page size;
- the web flow's `FlowRenderer` retry loses focus while it runs;
- both clients retry a create whose 2xx answer had an unexpected body as a new create;
- two event fixtures lack the `inquiry-template-version` relationship;
- the 2B lock gaps F015, F016 and F025 (planned for Phase 3 already).

**Decisions to confirm (owner):**
- C25.3: `fields-schema` in `PATCH` is the whole new schema (a key left out is a removal), and the seeded `user` type keeps its name.
- C25.1: after a deploy, a pending MFA challenge from before 2E is dropped, and the operator signs in again; a refusal no longer counts the attempts left.
- `/api-keys` gains an "At a date and time (UTC)" expiry choice.
- Android: an expired or redacted inquiry now ends the host app's flow with `INQUIRY_EXPIRED` or `INQUIRY_REDACTED` instead of `SESSION_CANCELED`, and `Problem` gains a parameter (a release note for SDK users).
- The dashboard file content route keeps needing `inquiries:read` as well as `pii:view`.

## 2026-10-20: Phase 2, Workflow 2D done (review of 2C, verification and fixes)

Workflow 2D reviewed Workflow 2C (`70369f2..5625a96`) along six dimensions with read-only reviewers: BFF security, authorization and exposure, React and Next.js, accessibility, the clients (web flow and Android), and test honesty with the UI e2e. After deduplication there were 23 findings: 0 CRITICAL, 1 HIGH, 14 MEDIUM and 8 LOW. A verifier confirmed the HIGH; nothing was refuted or downgraded.

Two path-owned fixers then worked test-first, with RED, GREEN and refactor commits:
- **TypeScript:** the HIGH, every MEDIUM in `apps/` and `packages/`, and the four items Workflow 2C left for 2D (K001–K004);
- **Android:** F017.

The evidence is in `docs/tdd/phase2-review-2c-fixes.tdd.md` and `docs/tdd/phase2-review-2c-fixes-android.tdd.md`. Phase 2 is **not done**: Workflow 2E (API gaps, the remaining console pages, the 2D carry-over) remains.

| ID | Severity | What was wrong | Fix |
|---|---|---|---|
| F002 | HIGH | The session's environment is shared by every tab, so a settings form opened in the sandbox could save production, and skip the production confirmation | `runAction` takes the form's `environment-id` (the `EnvironmentField` its page renders). A missing or stale one answers "The environment changed" without calling the API. Settings, new API key, new webhook and new account type |
| K001 | (2C item) | Check details reached principals without `verifications:read` through inquiry includes | `GET /inquiries/:id?include=verifications` needs `verifications:read` (403 `forbidden` naming it). `GET /dashboard/inquiries/:id` answers without it with the relationship ids and an empty `included`, and the page says the permission is needed |
| K002 | (2C item) | An operator could remove roles or permissions they could not grant | `assertCanChangeAccess` applies the grant rule to removing roles, changing a user's status, removing permissions from a role and deleting a role (403 naming the permissions). The console explains instead of offering |
| K003 | (2C item) | Three workarounds for React 19 form resets, and some forms still lost input | One `useFormAction` hook for every server-action form, keeping no action state (documented in `apps/dashboard/README.md`) |
| K004 | (2C item) | Every 403 inside a form read "You do not have access"; `Badge` copied; lifecycle test API local | Actions show the API's own 403 detail; `Badge` exported; the route-matching test API moved to `src/testing` |
| F003 | MEDIUM | One invalid typed filter wiped the status checkboxes and selects | The parsers return the selected values separately from what is sent |
| F004 | MEDIUM | A submit before hydration was a native GET, which could put custom header values in the URL | `useFormAction` keeps the server action on the form, so React replays it |
| F005 | MEDIUM | Sign out swallowed a failed session revocation | One retry on a connection error; otherwise `/login?reason=signout-incomplete` says the session may still be valid |
| F006 | MEDIUM | Some forms announced nothing when refused with field errors only | A `role=alert` summary is always rendered |
| F007 | MEDIUM | Focus fell to `<body>` when a confirmed action removed its opener | Focus returns to the opener, or to `#content` while it is gone |
| F008 | MEDIUM | Toasts shown as a dialog closed went into an inert live region | The dialog leaves live regions out of its inert set |
| F009 | MEDIUM | The "Hidden" tooltip could not be hovered or dismissed (WCAG 1.4.13) | Hoverable, and Escape dismisses it |
| F010 | MEDIUM | Form controls were outlined at 1.47:1 (WCAG 1.4.11) | A `border-control` token at 4.6:1 or more for inputs, selects, textareas and the JSON editor |
| F011 | MEDIUM | Some failures were reported only in a toast that left after 6 s (WCAG 2.2.1) | Error toasts stay until dismissed |
| F017 | MEDIUM | The Android sandbox photo picker could decode about 268 MB of pixels and crash the host app | Sampling keeps the decoded side under 4,096; over 40 megapixels is refused from the header; `OutOfMemoryError` and other failures give "could not use this photo" |
| F018 | MEDIUM | A timed-out create was retried as a new verification, using up an attempt | Web flow: after a lost answer, the session is read and the `initiated` verification reused. **Android half left for 2E** |
| F019 | MEDIUM | Tests asserted once on what an action renders later | They wait through `later()` |
| F020 | MEDIUM | Nothing tested the client-address chain end to end | `ui-client-address.spec.ts`: a forged `X-Forwarded-For` and BFF headers are ignored, and the audit entry records the real peer |
| F021 | MEDIUM | `mockApi` answered any request from a queue and ignored unused answers | `replyTo` by method and path; `restore()` fails on unused or mismatched answers |

**Contract changes in 2D** (recorded in the plan as amendments marked "Workflow 2D", for the owner to confirm):
- **C12/C15 (K001):** an `include` needs the included resource's own permission. Event payloads (`events:read`) and API-log bodies (`api-logs:read`) are unchanged.
- **C15 (K002):** the no-escalation rule is symmetric. The last-admin 409 is unchanged.
- **Dashboard only:** the four environment-bound actions need the `environment-id` field (F002), and a 403 answered to an action shows the API's detail (K004).

**CI on GitHub (Workflow 2C).** The push of `5625a96` (run 39487535832) failed twice:
- **Node job timeout:** the job reached its 20-minute limit, with the unit step at 13 min 15 s. The api and dashboard unit tests now run in their own jobs, `unit-api` and `unit-dashboard`, each uploading its coverage; the node job runs every other package. `infra/tests/ci-workflow.test.sh` checks the split (115 checks). This supersedes the 2C decision to keep the api tests in the node job.
- **Integration job:** an idle Postgres client ended with FATAL 57P01 during a test's teardown, and node-postgres throws an `error` event nobody listens to. The API and the worker now log a lost connection (error class and SQLSTATE only) instead of crashing (`apps/api/src/pool-errors.ts`).

Both fixes were proven on a branch before being cherry-picked onto `main`: run 39491672533, all 10 jobs green, with node at 7 minutes, unit-api at 8 and unit-dashboard at 5.

**Validation** (the plan's list in order, on `main` after the last code commit `e41c296`):

| Suite | Result |
|---|---|
| Install, format | pass |
| Lint and typecheck (`--force`) | 12 tasks each, none cached |
| TypeScript unit (12 packages, `--force`) | 6,906 tests in 7 min 15 s; every package at or above 80% (dashboard 1,347 at 98.42 / 94.38 / 98.71 / 98.43; api 2,020 at 97.56 / 90.34 / 98.36 / 97.62; flow 495 at 98.76 / 95.54 / 99.24 / 98.83) |
| Integration (Testcontainers) | db 37, api 32 |
| Vision | 446 tests; ruff, mypy; 100% coverage |
| Android (`--rerun-tasks`) | 446 unit tests (SDK 428, demo 18); Kover gate; assemble; lint |
| Playwright | 19 mocked flow specs; 34 full-stack tests (16 Phase 1 and 2A, 17 Workflow 2C UI, and the 2D `ui-client-address.spec.ts`) in 2.5 min |
| gitleaks (593 commits), CI contract with actionlint (115), connected-results checker (11), compose static (163), gitleaks installer (9), pre-commit hook (11) | pass |

The first uncached `pnpm test` failed on 2 of the dashboard's 1,347 tests, which pass alone. Both failures came from turbo's load, about 60 Vitest workers on 12 CPUs:
- **The busy-button test** asserted a transient state against a stub that answered on a timer. It now answers when the test says so; RED was shown with a stub that answers at once.
- **The role-form test** spent its time computing the accessible names of 31 checkboxes per query. It now finds them by label, at about half the time.

Both fixes are recorded in the TypeScript TDD file.

**Left for Workflow 2E** (added to the plan as C28):
- the Android half of F018 (`FlowCoordinator`);
- the LOW findings F012–F016, F022 and F023;
- the flow's language select, still outlined with `border-line`.

F001 (the TOTP secret kept in action state) was settled by K003.

**Decisions to confirm (owner):**
- the K001 and K002 amendments above;
- F005: when revocation fails, sign out still clears the cookie and then says the session may still be valid;
- F011: error toasts stay until dismissed, while success toasts still leave after 6 s;
- F017: on Android, a picked photo over 40 megapixels is refused (the vision service's default limit).

## 2026-10-20: Phase 2, Workflow 2C done (dashboard, web flow and Android)

Workflow 2C built the clients on the reviewed Workflow 2A and 2B API: the operator dashboard for every Phase 2 feature (C21–C23), the web flow and Android changes of C19, and the Playwright UI specs of C24. Six agents ran in three stages, each test-first with RED, GREEN and refactor commits:
- **Stage 1:** dashboard-shell, and clients in parallel (they shared only the e2e stack);
- **Stage 2:** dashboard-operators, dashboard-lifecycle and dashboard-integrations;
- **Stage 3:** e2e-ui-integration (wiring, API gaps, the 2B carry-overs, CI, this entry).

The evidence is in `docs/tdd/phase2-{dashboard-shell,clients,dashboard-operators,dashboard-lifecycle,dashboard-integrations,e2e-ui}.tdd.md`. Phase 2 is **not done**: Workflow 2D (the review of 2C) remains.

| Area | What landed |
|---|---|
| dashboard-shell | **C21 BFF:** a custom Node server (`apps/dashboard/server.ts`) that records the socket peer and trusts `X-Forwarded-For` only to `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS`; the BFF headers; a typed API layer on `@openverify/node`; one error mapping (401 to sign-in, `mfa-required` to the security page, 403 to an inline panel); `renderPage` and `runAction`. **Console:** navigation for every C23 route, gated by permission; the environment banner and switcher; dialogs with a focus trap, the one-time secret dialog, masked values, the JSON editor, toasts and pagination. **C22:** sign-in with a TOTP code, a recovery code or a security key; `/account/security` with a QR code computed on the server; `/accept-invitation`. Also 2B F029 in `@openverify/node`, the compose dashboard and the e2e stack on `server.ts`, and C24 spec 1 |
| clients | **Web flow (C19):** one-time links redeemed with the session token in memory only; inactive, canceled and redacted sessions on their own final screens; the sandbox banner and a selfie upload fallback; request timeouts (1B F018). **Android:** `OpenVerifyInquiry.fromOneTimeLink`, the same final screens, the sandbox banner and a photo-picker fallback (re-encoded as JPEG, so no metadata leaves the device), every `takePicture` failure recoverable (1B F025), a demo that keeps its session across rotation (1B F026), and Kotlin decoding of `inquiry-session.json`. Ten new mocked flow specs, and C24 spec 10 |
| dashboard-operators | `/users`: invite with the roles the operator may grant, change roles, deactivate and reactivate, resend an invitation. `/roles`: built-in roles read-only; custom roles with a permission checklist by area. `/audit-logs`: filters in the URL, an entry page linking related entries. `/settings`: require MFA and the environment's retention, with production changes confirmed. Forms keep what was typed after a refusal (React 19 resets them otherwise). C24 specs 2 and 8 |
| dashboard-lifecycle | `/inquiries`: filters for statuses, tags, account, reference ID and a created range. `/inquiries/[id]`: decisions by status and permission, redaction behind a typed confirmation, tags, note and fields, the one-time link shown once, sessions, the timeline, sandbox simulation, and masked and redacted values. `/accounts` and `/accounts/[id]`: fields, tags, archive, relations both ways, inquiries, consolidation and redaction. `/account-types`. `/templates` and its versions: a JSON draft editor that shows the API's errors by path, and publish. C24 specs 3, 6, 7 and 9 |
| dashboard-integrations | `/webhooks`: create, edit, enable, disable, archive, clone, rotate with an overlap, send a test event, replay, and deliveries with their attempts. `/api-keys`: only the operator's own scopes, allowed IP ranges, an expiry, the token shown once, rename, clone and expire. `/api-logs` and `/events`: filters in the URL, bodies as JSON with masked values shown as "Hidden", truncated bodies by size and preview. C24 specs 4 and 5 |
| e2e-ui-integration | **API gaps closed:** `GET /dashboard/me` now lists the organization's environments, which unblocked spec 8; users in `GET /dashboard/users` carry `mfa-enabled`, shown as the `/users` MFA column. **2B carry-overs:** F026 (the OpenAPI document declares `OpenVerify-Version`, `Idempotency-Key`, the RateLimit headers, 429 and the idempotency problems on every server operation), F027 (the redaction 503, and 410 where it is answered) and F035 (a lost idempotency lease is logged). **Also:** a navigation spec that reaches every C23 page; audit entries about API keys link the key; two dashboard tests that raced a server action's answer under load fixed; the unused Phase 1 inquiry reads removed; the CI e2e job renamed and checked; the unit-test headroom measured; the compose `app` profile run live; license records |

**C24 UI specs** (full stack, Chromium; all pass, none marked as an expected failure):

| # | Spec | Tests |
|---|---|---|
| 1 | `ui-mfa.spec.ts`: TOTP sign-in; a security key added and used (CDP virtual authenticator); an authenticator app added from its QR code and secret, then used | 3 |
| 2, 8 | `ui-operators.spec.ts`: an admin invites, the email arrives in Mailpit, the invitee accepts and signs in with the role; a developer switches to production and the banner changes; a reviewer is offered no production and the API refuses it | 3 |
| 3, 6, 7, 9 | `ui-lifecycle.spec.ts`: a reviewer approves and a viewer sees "Hidden" and no actions; a template draft is edited (an error shown by path) and published, and a new inquiry pins it; two accounts are consolidated and the inquiries move; an inquiry is redacted, its files answer 410 and its fields read "Redacted" | 4 |
| 4, 5 | `ui-integrations.spec.ts`: a webhook created, edited, rotated and sent a test event that the receiver verifies with both secrets, listed as delivered; an API key whose token is shown once, works, and answers 401 once expired | 2 |
| 10 | `ui-flow-links.spec.ts`: a one-time link opens the flow once, in the sandbox (banner, uploaded selfie), and the reused link is refused; a session expired through the API ends the flow on its own screen; so does a reload | 3 |
| | `ui-navigation.spec.ts` (Stage 3): every C23 page and its detail page reached from the navigation; a viewer is not offered API logs or audit logs, and opening them shows the inline panel | 2 |
| 11 | The 3 Phase 1 and 13 Workflow 2A full-stack specs, unchanged | 16 |

**Contract changes in 2C** (recorded in the plan):
- `GET /dashboard/me` meta gains `environments: [{ id, kind }]`, every environment of the organization, oldest first. No route named them, so the C21 switcher could not learn the production environment's id. It is optional in the contract, so earlier answers still parse.
- The user resource gains an optional `mfa-enabled` (an active, confirmed factor), sent by `GET /dashboard/users`.
- The OpenAPI document gains `components.parameters`, `components.headers` and `components.responses` for the C12 behaviour (2B F026).
- The single-spec e2e command in the plan's shared-resource rules is corrected: `pnpm --filter @openverify/e2e exec playwright test tests/<spec>.spec.ts`. The `e2e -- <file>` form runs the whole suite, because pnpm 12 forwards the `--`.

The agents' own deviations (each in its TDD file) include these:
- login lands on `/`, which opens the first page the role allows;
- the e2e stack opens the dashboard on `localhost`, the WebAuthn origin;
- an invitation takes an email and roles only, and the invitee chooses their name;
- the inquiry status filter became a checkbox group;
- check details on the inquiry page need `verifications:read`;
- redaction is confirmed by typing "redact";
- account types can be created but not edited, because the API has no update route.

**Validation** (the plan's list in order, after the last code commit `c16dc1b`; `docs/tdd/phase2-e2e-ui.tdd.md`):

| Suite | Result |
|---|---|
| Install, lint, typecheck, format | pass (lint and typecheck with `--force`: 12 tasks each, none cached) |
| TypeScript unit (12 packages, `--force`) | 6,798 tests in 4 min 33 s; every package at or above 80% (dashboard 1,264 at 98.42 / 94.3 / 98.77 / 98.44; api 2,004 at 97.54 / 90.21 / 98.35 / 97.61; flow 490 at 98.73 / 95.61 / 99.23 / 98.8) |
| Integration (Testcontainers) | db 37, api 32 |
| Vision | 446 tests; ruff, mypy; 100% coverage |
| Android (`--rerun-tasks`) | 440 unit tests (SDK 422, demo 18); Kover 97.08%; assemble; lint 0 errors |
| Playwright | 19 mocked flow specs; 33 full-stack tests (16 Phase 1 and 2A, 17 Workflow 2C UI) in 2.3 min |
| gitleaks (526 commits), CI contract with actionlint (103), connected-results checker (11), compose static (163) | pass |
| Compose `app` profile, live | Every service healthy under a throwaway project; seeded; a developer signed in through `server.ts` and switched to production. Removed afterwards |

Two earlier passes each failed once in `pnpm test`, on a different dashboard test each time: both read a server action's answer before it had rendered, under turbo's load. Both were fixed test-first, and the dashboard suite then passed six more loaded runs.

**CI headroom.** On `main` before 2C the node job took 12 min 32 s, of which 9 min 19 s were unit tests (run 39453307034). Measured on this machine, 2C raises the suite's CPU time by 28% (2,380 s to 3,037 s), so the step should take about 12 minutes, below the plan's 14-minute threshold. The api tests therefore stay in the node job, and `ci.yml` records the measurement. The e2e job's name now says it runs the dashboard UI specs, and `infra/tests/ci-workflow.test.sh` checks the name and that the suite runs unfiltered. CI on GitHub has not run Workflow 2C yet: nothing was pushed.

**Surface now driven by the dashboard and the clients** (`docs/research/persona-surface.md`; no new identifiers, since 2C adds no API resources). Of the 50 path files the API covers (Workflow 2A entry), 46 now have a console page or client behind them:
- **Accounts (11):** `accounts`, `accounts/{account-id}` and its `add-objects`, `add-relation`, `add-tag`, `consolidate`, `relations`, `remove-objects`, `remove-relation`, `remove-tag`, `set-tags`.
- **Inquiries (14):**
  - `inquiries`, `inquiries/{inquiry-id}` and its `add-tag`, `approve`, `decline`, `expire`, `generate-one-time-link`, `mark-for-review`, `perform-simulate-actions`, `remove-tag`, `set-tags`;
  - `inquiry-sessions`, `inquiry-sessions/expire-all`, `inquiry-sessions/{inquiry-session-id}/expire`.
- **Templates (3):** `inquiry-templates`, `inquiry-templates/{inquiry-template-id}`, `inquiry-template-versions`.
- **Integrations (15):**
  - `webhooks`, `webhooks/{webhook-id}` and its `archive`, `clone`, `disable`, `enable`, `rotate-secret`;
  - `api-keys`, `api-keys/{api-key-id}` and its `clone`, `expire`;
  - `api-logs`, `api-logs/{api-log-id}`;
  - `events`, `events/{event-id}`.
- **Other (3):** `account-types/{account-type-id}`, and `user-audit-logs` with `user-audit-logs/{user-audit-log-id}` (the console reads the same entries through the dashboard API).
- **End-user clients:**
  - one-time links (`inquiries/{inquiry-id}/generate-one-time-link`) open in the web flow and on Android;
  - an expired or canceled session (`inquiry-sessions/{inquiry-session-id}/expire`, `expire-all`) ends either client on its own screen.
- **No page yet (4):** `inquiries/{inquiry-id}/resume`, `inquiry-sessions/{inquiry-session-id}`, `rate-limits` and `verifications/{verification-id}`. The inquiry page shows its checks from the inquiry's included verifications.
- **Webhook events:** unchanged at 33 of 142. The webhook form offers every one of them.

**Decisions to confirm (owner):**
- **Carried from Workflow 2B (accepted as they are):**
  - F024: the invitation email is sent inside the transaction, on purpose.
  - F010, crypto-shred part: deferred. A redacted file keeps its wrapped data key; the stored objects are deleted.
  - F014, re-execution part: deferred, since closing it would change C12.
  - F030: Stage 3 scenario 12 drives `runRetention` through the CLI.
- **Contract additions made in 2C:**
  - `meta.environments` lists production to every role, including roles without `environments:production`. The switch itself is still refused (403), and the console offers it only to roles that may use it.
  - The user resource gains `mfa-enabled`.
- **The api package's unit tests stay in the node job.** The step is estimated at about 12 minutes of the job's 20 (see the validation below). Measure it on the next push; past about 14 minutes, split it out.
- **Android test dependencies:** the demo app's tests use the JUnit Vintage engine (EPL-2.0, test scope, `THIRD_PARTY_LICENSES.md` §5) and, through Robolectric, JUnit 4 (EPL-1.0), as the SDK already did.
- **Android sandbox uploads:** production on Android stays camera-only. The sandbox photo picker does not apply EXIF orientation.
- **One-time links after a reload:** a one-time link's session lives in memory only, so a reload cannot resume it. The flow says the page came from a one-time link.
- **API keys with an expiry** are created, then expired, in two calls (`POST /api-keys` takes no expiry). If the second call fails, the console still shows the token, with a warning.

**Open API gaps** (reported by the agents, not fixed; the dashboard works around them where it can):
- **MFA sign-in errors:** `POST /dashboard/sessions/mfa` answers a wrong code and a spent `mfa-token` with the same 401 and no `code`. The dashboard counts attempts itself.
- **Check details:** `GET /inquiries/:id?include=verifications` and `GET /dashboard/inquiries/:id` return check details to principals without `verifications:read`. The dashboard hides them on the server. Whether the API should withhold them is for 2D, because it changes Phase 1 behaviour for API keys.
- **Missing routes:**
  - no `GET /dashboard/roles/:id` (the dashboard finds a role in the list);
  - no `PATCH /account-types/:id`.
- **Missing attributes:**
  - the inquiry does not name its pinned template version;
  - `POST /api-keys` takes no expiry, and the `api-key` resource does not say whether it is `pii-masked`.
- **Timeline:** `GET /events` cannot list the events of an inquiry's verifications and sessions, so the inquiry timeline shows only the inquiry's own events.

**For Workflow 2D (review of 2C):**
1. **BFF security:**
   - the `server.ts` peer-address marking and the proxy-hop rule;
   - the BFF token;
   - cookie flags, including the `mfa-token` cookie scoped to `/login` and its attempt count;
   - Origin checks on server actions;
   - that no one-time secret (API key and webhook secrets, TOTP secret and otpauth URI, recovery codes, one-time link) reaches a URL, browser storage, a log or a client prop beyond its dialog.
2. **Authorization:**
   - the check-details gap above;
   - `PATCH /dashboard/users/:id` and `PATCH /dashboard/roles/:id` let an operator remove roles or permissions they could not grant, because `assertCanGrant` checks only what is added (dashboard-operators);
   - confirm that listing production in `meta.environments` is acceptable.
3. **React 19 form resets.** Three workarounds exist: operators' `useKeptFormAction`, integrations' `useSubmitAction` and `FormDialogButton`. Some forms still lose their input after a refusal: controls inside `ConfirmActionButton`, `/accept-invitation`, and the TOTP name form. They should share one hook.
4. **Shell polish:**
   - `displayProblemOf` turns every 403 into "You do not have access", which hides the API's specific detail inside forms;
   - `Badge` is not exported, so its tone classes are copied twice;
   - the route-matching test API in `components/lifecycle/testing` could serve every page test.
5. **Accessibility of the new pages:** dialogs, landmark names (table captions that repeat a section heading), and keyboard paths through the editors.
6. **Clients:**
   - the web flow's fragment handling and its no-secret `sessionStorage` marker;
   - the timeouts;
   - on Android: `OneTimeLinkFlowApi` (mutex, process death) and `PickedPhotos` (25 MiB cap, re-encoding).
7. **Tests and CI:**
   - the e2e stack's `next build` type-checks test files, so any committed RED test that imports a missing module breaks every full-stack run;
   - two dashboard tests read a server action's answer before it had rendered, and failed only under turbo's load (fixed in Stage 3, with `src/testing/later.ts` to make such races deterministic); review the other tests that assert right after a click for the same shape;
   - check the node job's time on GitHub.
8. **Phase 3:** the lock gaps 2B F015, F016 and F025 stay there.

## 2026-10-20: Phase 2, Workflow 2B done (review, verification and fixes)

Workflow 2B reviewed the Workflow 2A backend (`9206658..018e895`) along six dimensions with read-only reviewers: operator security and authorization, data protection, TypeScript correctness, database, contracts with the client and e2e, and silent failures with test quality.
- **Findings:** 35 after deduplication (1 critical, 10 high, 17 medium, 7 low), plus two known items queued beforehand (K001, K002).
- **Verification:** skeptic agents tried to refute each critical and high finding. None was refuted. Three highs were downgraded to medium (F002, F003, F006), so 8 were blocking.
- **Fixes:** one test-first fixer, 59 commits, a regression test for each fix. The evidence is in `docs/tdd/phase2-review-fixes.tdd.md`, and the contract changes are marked "Workflow 2B" in C12–C18 of the plan.

| Finding | Fix |
|---|---|
| F005 (critical), F017 | API-log and idempotency copies of list answers and event reads kept redacted PII, because redaction matched one `resource_id`. They now record every subject id their stored text mentions (`subject_ids`, GIN-indexed, migration 0005), and redaction clears any overlap |
| F001 | A user without `pii:view` could mint an API key that read PII unmasked. Such keys, and their clones, are now stored masked (`api_keys.pii_masked`, migration 0004) |
| F007 | Redacting an account now also redacts every account consolidated into it |
| F008 | The preview of a truncated API-log body is cut from the PII-masked JSON |
| F009 | Webhook custom header values are stored as `[REDACTED]` in API logs |
| F011 | A webhook-delivery job that exhausted its BullMQ retries no longer blocks its own re-enqueue for 7 days: the sweep replaces it |
| F018, F006 | Redacting an open inquiry cancels its sessions and revokes its unused one-time links; flow writes, `resume` and `generate-one-time-link` then answer 410 `redacted` |
| K001 | The built-in developer and reviewer roles gain `verifications:read` (the C15 table is amended); the startup sync updates existing organizations |
| K002 | `account.created` for an inquiry's new account is dispatched after the commit, with `inquiry.created`, not by the 30 s sweep |
| Medium | F002 (no factor changes from an MFA-unsatisfied session once a factor exists), F003 (a production session stops working when the user loses `environments:production`), F004 (MFA attempts reserved before checking, so parallel guesses count), F010 in part (storage deletes an object without version ids plainly), F012, F013, F020 (account locks during consolidation and relations), F014 (idempotency leases fence a stale holder), F019, F022, F023 (indexes in migrations 0006–0008; expired user sessions, one-time links and MFA challenges are purged), F021 (a webhook attempt is recorded once), F028 (`@openverify/node` drops members a newer server adds instead of failing), F031 (an incomplete retention run fails the job and `retention:run` exits 1), F032, F033, F034 |

**Not fixed, for the owner** (also in the plan's 2C section):
- 2B F024: the invitation email is sent inside the database transaction, on purpose. A failed send leaves no invited user.
- 2B F010, crypto-shred part: a redacted file keeps its wrapped data key. The S3 objects are deleted; nulling the key needs a constraint change and a `kek:rewrap` change.
- 2B F014, re-execution part: a retry whose stored answer was lost runs the request again. Closing it would change C12.
- Carried into Workflow 2C or Phase 3: F026 and F027 (OpenAPI omits the C12 platform headers and some redact statuses), F029, F035, and the lock gaps F015, F016 and F025.

**Validation** (orchestrator re-run after the last fix commit, `018e895..520178b` plus plan commits):

| Suite | Result |
|---|---|
| Install, format, typecheck, lint | pass |
| TypeScript unit (12 packages, `--force`) | 5,620 tests in 3 min 51 s; every package at or above 80% (api 1,985 tests at 97.53 / 90.09 / 98.32 / 97.59) |
| Integration (Testcontainers) | db 4 files, api 10 files (the 2B fixer: db 37 tests, api 32), including a real BullMQ-on-Valkey test for F011 and Postgres 17 lock tests for F012 and F013 |
| Playwright | 9 mocked flow specs; 16 full-stack specs |
| gitleaks (full history), actionlint, CI contract (101), connected-results checker (11), compose static (158) | pass |
| Vision, Android | unchanged since the last green run (no files changed) |

**CI on GitHub:**
- Phase 1 CI was proven on branch `ci/phase1-ci-fixes` (run 39423185715). That run also fixed CameraX binding on a background thread in production code (40e62dc). A results checker (`infra/scripts/check-connected-results.sh`) now fails the emulator job when the camera instrumented test was skipped rather than run.
- Workflow 2A passed every CI job on the preview branch `ci/phase2-preview` (run 39438436695). The node job took 11 min 50 s of its 20-minute limit.
- `main` was pushed with Workflows 2A and 2B: every job passed (run 39453307034, commit 1963c04), including the emulator job with the camera test proven to have run. The node job took 12 min 32 s of its 20-minute limit, so Workflow 2C measures it again and splits the api unit tests into their own job if needed.
- A flaky `pnpm test` (PGlite `beforeAll` hooks timing out at a load of 59 on 12 CPUs) was fixed by capping Vitest at half the CPUs per package (`TEST_MAX_WORKERS = '50%'`, d62b1a4).

## 2026-10-20: Phase 2, Workflow 2A done (backend)

Workflow 2A ran nine agents, each test-first with RED, GREEN and refactor commits; the evidence is in `docs/tdd/phase2-*.tdd.md`.
- **Stage 1:** contracts-v2 (C9–C20 schemas, fixtures, core additions), db-v2 (schema v2, migration 0003, repositories), api-foundation (principals, PII masking, problem types, ports and stubs).
- **Stage 2:** api-inquiries (C10, C11), api-lifecycle (C13, C16), api-platform (C12), api-integrations (C14, the C18 client), api-operators (C15).
- **Stage 3:** e2e-integration (wiring, seed, API-level e2e, infra and CI).

Phase 2 is **not done**: Workflow 2B (review), 2C (dashboard UI, web flow and Android for C19) and 2D remain.

| Area | What landed |
|---|---|
| contracts, core | C9 vocabulary (ids, `ovo_`/`ovm_`/`ovi_` tokens, recovery codes, problem types, API versions, tags, list filters); every C10–C16 resource and request body; the C17 events; the verification state machine, permissions and built-in roles, tag rules, webhook payload helpers, check config schemas; the twelve C20 fixtures and dual-signature vectors |
| db | Migration 0003 (accounts, roles, MFA, idempotency keys, API logs, one-time links and the Phase 2 columns), with an in-place backfill of Phase 1 rows; repositories for every area with the atomic operations the services need; Phase 2 encrypted columns bound to their row (F004) |
| api | C10 inquiry actions, tags, one-time links, sessions, simulation and the expiry job (F005, F015); C11 template versions and check thresholds; C12 user-session principals, idempotency, GCRA rate limits, API versions, API logs, API keys and the Events API; C13 accounts; C14 complete webhooks; C15 RBAC, users, invitations, roles, audit logs, MFA (TOTP, WebAuthn, recovery codes), environment switch and settings, `user:reset-mfa`; C16 redaction, the daily retention job and `kek:rewrap` |
| node | The C18 typed server API client (`createClient`) |
| e2e-integration | Seed with one operator per built-in role, a production environment, template settings and a TOTP-enrolled admin (`seed:dev --mfa-admin`); `retention:run [--now]`; the event object-id backfill in `db:migrate`; storage deletes every object version; OpenAPI declares user sessions on server operations; 13 API-level e2e specs; compose and `.env.example` settings with Mailpit for invitations; GitHub Actions pinned to commit SHAs (F009); license records |

**Full-stack e2e** (`pnpm e2e`, one private stack): the three Phase 1 browser specs and thirteen Phase 2 API-level specs through `@openverify/node`:
1. A template version is drafted, edited and published; inquiries keep the version they pinned (their flow and expiry).
2. A one-time link is redeemed once through the flow API; the second redeem answers the generic 401.
3. An idempotent replay returns the stored response (`Idempotent-Replayed: true`); the key with another body answers 422.
4. Every server API response carries `RateLimit-*` and `OpenVerify-Version`; `GET /rate-limits`; an unknown version answers 400.
5. During a secret rotation, each delivery carries two signatures, and each secret alone verifies it.
6. A simulated event (flagged `simulated`) and a replayed event are delivered.
7. Consolidating accounts moves the inquiries and archives the source.
8. Approve, decline and mark-for-review emit their events and `inquiry.transitioned`, delivered signed.
9. A reviewer can approve but gets 403 creating an API key; a viewer sees masked fields.
10. An admin enrolled in TOTP signs in with password and code through the dashboard API.
11. Redaction deletes the stored files (no version left in the versioned bucket) and stubs the stored events.
12. The retention job, run with an injected clock, redacts a finished inquiry past its template's retention.
13. An invitation arrives through Mailpit and the invitee joins with the role given.

**Validation** (the plan's list, run in order after the last code commit; `docs/tdd/phase2-e2e.tdd.md`):

| Suite | Result |
|---|---|
| Install, lint, typecheck, format | pass (36 turbo tasks, none cached) |
| TypeScript unit (12 packages) | 5,569 tests; every package at or above 80% on every metric (api 1,951 at 97.48 / 90.09 / 98.3 / 97.55) |
| Integration (Testcontainers) | 65 (db 37, api 28), including the redaction, retention, idempotency, rate-limit, webhook, MFA and expiry runs on Postgres 17, Valkey 9.1 and RustFS |
| Vision | 446 tests; ruff, mypy; 100% coverage |
| Android | 343 unit tests (rerun without Gradle's cache); Kover 97.29%; assemble and lint |
| Playwright | 9 mocked flow specs; 16 full-stack specs (3 Phase 1, 13 Phase 2) |
| gitleaks (355 commits), compose static tests (158), CI contract with actionlint and SHA pins checked on GitHub (101) | pass |

The compose `app` profile was also brought up live under a throwaway project: every service healthy, `db:migrate`, `seed:dev --mfa-admin`, and an invitation delivered to the compose Mailpit.

**Surface covered so far** (`docs/research/persona-surface.md`):
- API resources, 50 of 183 path files:
  - `account-types/{account-type-id}`;
  - `accounts`, `accounts/{account-id}` and its `add-objects`, `add-relation`, `add-tag`, `consolidate`, `relations`, `remove-objects`, `remove-relation`, `remove-tag`, `set-tags`;
  - `api-keys`, `api-keys/{api-key-id}` and its `clone`, `expire`;
  - `api-logs`, `api-logs/{api-log-id}`;
  - `events`, `events/{event-id}`;
  - `inquiries`, `inquiries/{inquiry-id}` and its `add-tag`, `approve`, `decline`, `expire`, `generate-one-time-link`, `mark-for-review`, `perform-simulate-actions`, `remove-tag`, `resume`, `set-tags`;
  - `inquiry-sessions`, `inquiry-sessions/expire-all`, `inquiry-sessions/{inquiry-session-id}` and its `expire`;
  - `inquiry-template-versions`, `inquiry-templates`, `inquiry-templates/{inquiry-template-id}`;
  - `rate-limits`, `user-audit-logs`, `user-audit-logs/{user-audit-log-id}`, `verifications/{verification-id}`;
  - `webhooks`, `webhooks/{webhook-id}` and its `archive`, `clone`, `disable`, `enable`, `rotate-secret`.
- Webhook events, 33 of 142: every `account.*` event the surface lists (13), `inquiry.approved`, `.completed`, `.created`, `.declined`, `.expired`, `.failed`, `.marked-for-review`, `.redacted`, `.started`, `.transitioned`, `.updated-tags`, the three `inquiry-session.*` events, and `verification.canceled`, `.created`, `.failed`, `.passed`, `.skipped`, `.submitted`.

**Decisions to confirm (owner):**
- `nodemailer` is MIT-0 and `tslib` is 0BSD: both more permissive than MIT, but rule 4 does not name them (`THIRD_PARTY_LICENSES.md` §2.1.1).
- The seed now requires `OPENVERIFY_SEED_{DEVELOPER,REVIEWER,VIEWER}_{EMAIL,PASSWORD}`; an existing `.env` needs them added (`.env.example` has placeholders).
- File deletion removes every stored version, so the S3 credentials need `s3:ListBucketVersions` and `s3:DeleteObjectVersion` (the development bucket has versioning on, and a plain delete kept the ciphertext).
- C15 as written gives the developer and reviewer roles no `verifications:read`, and C15 audit actors have no system type (the database records `system` for jobs and CLIs). Both were followed as written.

**Carried into Workflows 2B and 2C:**
- `account.created` staged while an inquiry is created is delivered by the worker's 30 s sweep, not at once: the locked `AccountsService.resolveForInquiry` port has no after-commit hook.
- The dashboard BFF does not send `x-openverify-client-ip` and `x-openverify-bff-token` yet, and `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` (dashboard side, C15) is not read anywhere; add it to `.env.example` and compose with that change.
- `expires-at` comes from the API's clock and `created-at` from the database's, so they can differ by milliseconds.
- CI has not run on GitHub: nothing was pushed. (Since then: green on the preview branch and on `main`; see the Workflow 2B entry.)

## 2026-10-20: Phase 1 done (Workflow 1B: review, verification and fixes)
Workflow 1B ran nine agents:
- six read-only reviewers: API security, async and edge security, TypeScript correctness, React, Python and Kotlin;
- one adversarial verifier for the high-severity findings;
- two test-first fixers.

The reviewers reported 26 findings: 0 critical, 3 high, 14 medium and 9 low.
- **High.** One was confirmed: a vision call that failed permanently, or ran out of retries, left the verification `submitted` and the inquiry `pending` forever. The verifier refuted a second high as a duplicate of it, and downgraded the third (an abandoned `initiated` verification blocking completion) to medium.
- **Low.** All are deferred to owners in the Phase 2 plan.
- **No issue was found in these areas:**
  - cross-environment access, SQL injection, authentication bypass and PII in logs;
  - SSRF bypasses and the envelope crypto design;
  - camera teardown and polling leaks;
  - vision thread safety.

**Fixed (each with a regression test first; evidence in `docs/tdd/phase1-review-fixes*.tdd.md`):**

| Finding | Fix |
|---|---|
| F006 (high) | An image vision cannot read fails the image-quality checks with the new reason `image_unreadable`, and the user can retry. A job that fails permanently fails the verification and the inquiry, with their events |
| K001 (known) | Re-uploading a file kind while the verification is `initiated` replaces the earlier file, so a page reload between uploads no longer strands the user. A new full-stack spec covers it |
| F001, F002, F012, F013 | Flow races closed with row locks: uploads and submits re-check status inside the transaction, one file per kind (a unique index in migration 0002), one open attempt per type, and attempt limits counted atomically |
| F011 | The inquiry outcome ignores still-`initiated` verifications |
| F014 | API-side inquiry and verification events are staged in the same transaction as the change |
| F008 | The dashboard cookie's `Secure` flag comes from the deployment (`OPENVERIFY_DASHBOARD_INSECURE_COOKIES`), not from a request header |
| F016, F017 | Flow: focus follows capture-mode changes; a 409 on submit reloads the session instead of looping |
| F019, F020 | Vision: 16-bit greyscale images are scaled, not clipped. Concurrent image jobs are capped, with a 503 and `Retry-After` when the queue is full |
| F023, F024 | Android: attempts count against `maxAttempts`, and a decided or expired inquiry ends the flow |

**Moved to Phase 2:**
- F003 and F007, the operator login limiter keyed on the BFF's address. They need a trusted-proxy design, now in C15 of the Phase 2 plan.
- All low findings, owners listed in the plan.

**Final validation (orchestrator re-run of the full plan list):** every step passed.

| Suite | Result |
|---|---|
| Install, typecheck, lint, format | pass |
| TypeScript unit (12 packages) | 3,211 tests; every package ≥80% coverage (api 853 tests) |
| Integration | 33 (db 23, api 10) |
| Vision | 446 tests; ruff, mypy; 100% coverage |
| Android | 340 unit tests; Kover 97.29%; assemble and lint |
| Playwright | 9 mocked flow specs and 3 full-stack specs |
| actionlint, gitleaks (207 commits), compose static tests (113) | pass |

**Contract notes from the fixes:**
- C7 gains the reason `image_unreadable`.
- C3 keeps its shapes:
  - creating a verification while one is `initiated` returns that one;
  - re-uploads replace the earlier file;
  - submitting a type that already passed answers 409.
- C6 gains a 503 with `Retry-After`.

## 2026-10-20: Phase 1, Workflow 1A done (the walking skeleton runs end to end)
Nine agents: contracts, db and vision (Stage 1); api-http, api-worker, flow-web, dashboard and android (Stage 2); e2e-integration (Stage 3). Every slice used RED → GREEN TDD; the evidence is in `docs/tdd/phase1-*.tdd.md`.

The full-stack e2e (`e2e/`, run by `pnpm e2e`) starts a private stack: compose project `openverify-e2e`, real API, worker, vision models, flow and dashboard. Two specs pass:
- **Positive.** Person A's ID and selfie (synthetic TD1 card, Chromium fake camera) complete the inquiry with all 7 C7 checks passed. A signed `inquiry.completed` webhook verifies with `@openverify/node`, and the seeded operator sees the result and the images in the dashboard.
- **Negative.** Person B's selfie fails `selfie_id_comparison` (`face_mismatch`). The inquiry ends `failed`, and a signed `inquiry.failed` webhook verifies.

| Area | What landed | Tests (final run) | Coverage |
|---|---|---|---|
| contracts | `@openverify/contracts` (C1–C5 zod schemas, IDs, tokens, builders), `@openverify/node` (webhook signing and verification), the C8 golden fixtures | 466 + 61 | 100% |
| db | Schema v1 (13 tables, prefixed ULIDs, composite tenant keys), migration 0001, encrypted PII columns, tenant-scoped repositories with cursor pages, a PGlite test database | 342 unit + 22 integration | 100 / 96.86 / 100 / 100 |
| vision | C6 analyze and embed endpoints (YuNet multi-scale, SFace), pinned public-domain faces, a synthetic TD1 ID and `.y4m` fake-camera clips | 432 (real-model tests included) | 100% |
| api-http | zod config, S3 storage with per-file envelope encryption, C2 server API, C3 flow API with session tokens, the container and server entrypoints, the OpenAPI snapshot | in `@openverify/api` | see below |
| api-worker | BullMQ verification worker, the 7 Phase 1 evaluators and face match (`packages/checks`), the event outbox, a webhook dispatcher with an SSRF guard and retries | in `@openverify/api`; checks 450 | checks 99.81 / 97.84 / 100 / 99.8 |
| dashboard | C4 routes and Argon2id operator auth, the Next.js BFF (login, httpOnly cookie, inquiry list and detail, image proxy). `sharp` removed | dashboard 192 | 97.61 / 94.76 / 100 / 97.56 |
| flow-web | Session bootstrap from the URL fragment, the flow-spec renderer (consent, ID upload and camera, selfie, completion and failure), polling with retry hints, en and es, CSP | 408 unit + 9 mocked e2e | 98.45 / 94.98 / 99.06 / 98.54 |
| android | kotlinx.serialization models (C8), the OkHttp flow client, `FlowCoordinator`, Compose and CameraX screens, `OpenVerifyInquiry.Contract`, the demo app | 311 + 10 | 97.41% lines (Kover) |
| e2e-integration | Dev seed and migrate scripts, the full-stack e2e project, the compose `app` profile (with the image to build it), the merged `.env.example`, CI `format` and `e2e` jobs, license records | e2e harness 39 unit + 2 full-stack | 95.87 / 88.46 / 92.59 / 96.73 |

`@openverify/api` (api-http, api-worker, dashboard routes, seed): 818 unit tests at 97.83 / 91.78 / 98.65 / 97.94, plus 6 integration tests. Across the workspace: 3,148 unit tests in 12 packages, 28 integration tests, 432 vision tests, 321 Android tests and 11 Playwright specs. Every command in the plan's validation list passes locally (`docs/tdd/phase1-e2e.tdd.md`). CI on GitHub has not run yet, because nothing was pushed.

**Decisions to confirm (owner):**
- JUnit 4 (`junit:junit` 4.13.2, EPL-1.0) is a transitive test-only dependency through Robolectric. Rule 4 names only MPL-2.0 and EPL-2.0 (`THIRD_PARTY_LICENSES.md` §5).
- The shared Vitest timeout is now 20 s, because tests run starved when turbo runs every package at once.
- The compose `app` profile uses one development image for the TypeScript apps (it keeps dev dependencies). Production images are a later phase.

**Carried into Workflow 1B and later phases:**
- **API: re-uploading a kind.** The flow tracks uploaded kinds in memory. After a page reload between two uploads, it reuses the `initiated` verification and uploads the same kind again, which the API answers with 409. Either accept a re-upload of the same kind (last wins), or expose the uploaded kinds in the C3 flow view.
- **Flow: selfie upload fallback.** There is no selfie upload fallback in sandbox, because C3 does not expose the environment kind.
- **Flow: response headers.** CSP `frame-ancestors`, `Permissions-Policy: camera=(self)` and `Referrer-Policy` need a serving layer; `vite preview` sends none.
- **Dashboard: login across organizations.** C4 login has no organization field, and emails are unique per organization only, so login checks every account with that email.
- **Docs outside this phase's owned paths.** `CLAUDE.md` should read `uv run mypy src tools`, list `pnpm e2e`'s prerequisites (`scripts/fetch_fixtures.py`, `tools/make_synthetic_fixtures.py`), and mention `seed:dev`. ADR 0003 still describes the step routes the flow dropped.
- **Calibration (Phase 4).** SFace's 0.363 threshold has a thin margin for some impostor pairs; calibrate on a larger public-domain set.

## 2026-10-20: Phase 0 done
Eight agents in one workflow. Every slice used RED → GREEN TDD with checkpoint commits, and its evidence is in `docs/tdd/phase0-*.tdd.md`. The verify agent re-ran everything in the shared tree and in a fresh clone with `CI=true`.

| Area | What landed | Tests | Coverage |
|---|---|---|---|
| ts-foundation | pnpm 12 + turbo workspace, TS 6.0 strict, ESLint 10 type-aware, Prettier, the shared Vitest 80% gate, a conventions test | 33 (config) | 100% |
| domain-core | `core`: enums, inquiry state machine, a `CHECK_REGISTRY` of every PLAN §4 check, decision engine. `checks`: ICAO 9303 MRZ (TD1/TD2/TD3) with check digits, name matching (Jaro-Winkler and token-set), 7 ID checks. `flow-spec`: zod schema, `parseFlow`, and a JSON Schema export | 654 | 99.8–100% |
| db-api | AES-256-GCM envelope encryption with rotatable KEKs, schema v0 (orgs, environments, api_keys), migration, a Testcontainers pgvector test. Fastify `buildApp` with problem+json, request IDs, pino redaction, `/openapi.json`, scoped API-key auth | 120 unit + 10 integration | db 98.6%, api 99.1% lines |
| web-apps | `ui` accessible primitives (Tailwind v4). `flow`: Vite/React 19 consent-first shell with i18n, camera permission and a Playwright smoke test. `dashboard`: Next 16 login and inquiries shells | 174 + 1 e2e | ≥97.7% |
| vision | uv project. Quality checks for blur, glare and brightness. Safe image decoding with format and pixel limits. FastAPI `/health` and token-authenticated `/v1/quality`. A pinned model manifest with fetcher (YuNet, SFace, MiniFASNet V2/V1SE), a lazy YuNet wrapper, a non-root Dockerfile | 167 | 100% |
| android | Gradle 9.8.2, AGP 9.4.1, Kotlin 2.4.21, compileSdk 36 / minSdk 26. Modules `openverify-sdk`, `openverify-nfc` (LGPL notice) and `demo-app`. ICAO check digit and BAC key seed | 30 | 100% (Kover) |
| infra-ci | docker-compose: pgvector pg17, **Valkey**, **RustFS** + bucket init, Mailpit. GitHub Actions CI: node, integration, vision, android, emulator, gitleaks. gitleaks pre-commit hook. THIRD_PARTY_LICENSES. ADRs 0001–0002 | 126 contract assertions | n/a (shell/config) |
| verify | Fixed three integration breaks: `allowBuilds` for pnpm 12, the uncommitted lockfile, and YAML formatting | 1,315 total across all suites | all gates ≥80% |

**Decisions made by the orchestrating session** (the owner should confirm):
- Valkey replaces Redis, and RustFS replaces MinIO, for license reasons (ADR 0001).
- Weak-copyleft tooling (MPL-2.0, EPL-2.0) is allowed only for build, test and dev use and never shipped (`CLAUDE.md` rule 4; THIRD_PARTY_LICENSES §5).
- The pnpm `allowBuilds` decisions are all false.
- The gitleaks pre-commit hook is enabled locally (`core.hooksPath`).

**Carried into later phases:**
- Phase 1:
  - Drop the optional LGPL `sharp` dependency from `next`.
  - Add a CI job for Playwright and `format:check`.
  - Add a DB-backed API-key lookup and a server entrypoint.
  - Map DomainError codes to problem types.
  - Use RE2 or a time limit for operator-supplied regexes.
- Phase 3:
  - Pick the OCR model set; the ModelScope license metadata needs checking.
  - Calibrate the blur and glare thresholds.
  - Add MRV visas and national ID layouts.
- Phase 10: confirm the exact LGPL version of JMRTD 0.8.9 and SCUBA, and decide on compileSdk 37.
- Before release: legal review of SFace's upstream license.

## 2026-10-19: Phase 0 started
- Toolchain installed userland:
  - pnpm 12.14
  - uv 0.13.3
  - Temurin JDK 21.0.12
  - Android SDK: platform-tools r37, android-36, build-tools 36.1.0
- Already available: Docker 29.7.2 (Docker Desktop WSL integration), Node 22.22.
- Latest stable Android build stack: AGP 9.4.1, Kotlin 2.4.21, Gradle 9.8.2.
