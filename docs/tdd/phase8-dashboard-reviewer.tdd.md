# Phase 8, Workflow 8C Stage 1: `dashboard-reviewer` (C142.2 to C142.6, its part of C142.7)

The case page and its modules, comments and mentions, attachments with the streaming upload route,
case actions through available-actions, the compare panel, the print view, and the renditions in
the existing inquiry image views. Every slice went stub (when a name was missing), RED, GREEN.
Commands ran after `source scripts/env.sh`; outputs are abbreviated, never edited.

## Owned paths

- `apps/dashboard/src/app/cases/[id]/` (the page, its actions, the attachment upload and content
  routes)
- `apps/dashboard/src/components/cases/reviewer/`
- `apps/dashboard/src/app/files/[id]/rendition/route.ts`
- the inquiry image components moved to renditions, named in the first commit message:
  `components/verification-image.tsx` and the new `components/rendition-image.tsx`, with the tests
  that asserted the old image path
- `apps/dashboard/src/lib/api/{case-comments,case-attachments,case-actions,file-renditions}.ts`
- `apps/dashboard/src/testing/routes/reviewer.ts` and `apps/dashboard/src/testing/reviewer-fixtures.ts`
- `e2e/tests/ui-reviewer.spec.ts`, `e2e/tests/support/ui-reviewer.ts`

## Slice 1: inquiry images through renditions (C135.3, decision 63, P38)

Stub `51e7dcea` (the route, its BFF read, `RenditionImage`), `RENDITION_ATTEMPTS` stub, RED
`f8318d68`.

RED:

```
$ pnpm exec vitest run 'src/app/files/[id]/rendition/route.test.ts' src/lib/api/file-renditions.test.ts \
    src/components/rendition-image.test.tsx src/components/selfie-evidence.test.tsx \
    src/components/verification-card.test.tsx src/components/evidence/document.test.tsx \
    src/components/evidence/government-id-nfc.test.tsx 'src/app/inquiries/[id]/page.test.tsx' \
    'src/app/verifications/[id]/page.test.tsx' --coverage.enabled=false
 FAIL  src/app/files/[id]/rendition/route.test.ts > ... > answers 202 with its Retry-After ...
   AssertionError: expected 501 to be 404 / 401 / 502
 FAIL  src/lib/api/file-renditions.test.ts > ... Error: not built yet
 FAIL  src/components/rendition-image.test.tsx > ... Unable to find an accessible element with the role "status"
 FAIL  src/components/verification-card.test.tsx > ... toHaveAttribute("src", "/files/file_01JB…01/rendition")
 Test Files  9 failed (9)
      Tests  55 failed | 196 passed (251)
```

The tsc run of the dashboard exited 0 on the RED tree.

GREEN: `renditionAnswer` and `pageOf` in `lib/api/file-renditions.ts` (shared by the case
attachment content route), the route, `RenditionImage` (a polite status, at most 12 asks, then
"Try again"), and `VerificationImage` through `fileRenditionPath`. Two corrections of the RED tests
while going green, neither weakening them: the route test's module mock keeps the real helpers
(`importOriginal`), and the "stops after 12" case expects `?attempt=24`, because every request, the
image's and each check's, carries a counter of its own (the first case's `attempt=1` check then
`attempt=2` image says the same).

```
 Test Files  9 passed (9)
      Tests  251 passed (251)
```

ESLint on the changed files and `tsc --noEmit` exited 0.

## Slice 2: the case page (C142.2, C142.4, C142.7)

Stub `aa566ba7` (the page and its actions refusing, the fixtures and mock routes), RED `86955a16`.

RED (`tsc --noEmit` exited 0 on the RED tree):

```
$ pnpm exec vitest run 'src/app/cases/[id]/actions.test.ts' 'src/app/cases/[id]/page.test.tsx' --coverage.enabled=false
 × says in its header the status and its category, the resolution, the assignee, the queue and the SLA time left in words
 × offers only the statuses the version’s transition map allows from the current one
 × groups the held objects by type, with the state as attached beside the live one, each linked to its own page
 ...
 × sets a status with its resolution, comment, status tag and lock version
 Test Files  2 failed (2)
      Tests  36 failed | 4 passed (40)
```

The four that passed on the stub are refusals (no permission, no API call), which a stub that
refuses everything also satisfies.

GREEN: `app/cases/[id]/{page,actions}.ts(x)` and `components/cases/reviewer/`: `load-case.ts` (every
read through its own route and scope; a held object the reader may not read is "No access" with no
link and no call), `case-view.tsx`, `case-sections.tsx` (details, fields, held objects with the
decision buttons of C142.4, timeline, comments, attachments), `case-modules.tsx` (Phase 7's
`ListMatches`, `AccountGraphComponent`, `InquirySignals`, `SessionDevice`, `SessionNetwork` with
`DbIpAttribution`, `TransactionHistory`, `TransactionRelations`), `case-words.ts`, `comment-text.tsx`
and `open-link.tsx`, the client forms (`status-control.tsx`, `case-forms.tsx`,
`case-action-form.tsx`, `attachment-upload.tsx`, `print-button.tsx`). One test-side change while
going green: the page test mocks `useRouter`, as `app/transaction-types/[id]/page.test.tsx` does,
because the upload form refreshes through the app router, which a test does not mount.

```
 Test Files  2 passed (2)
      Tests  40 passed (40)
```

ESLint on the slice's files and `tsc --noEmit` exited 0.

## Slice 3: the streaming upload route and the attachment content route (C135.1, C135.4, C142.7)

Stubs `e7bfbfbf` and the `UPLOAD_LIMIT_BYTES` constant (a route file may export only its handlers,
so the limit lives in `lib/api/case-attachments.ts`), RED `82a0639b`.

```
$ pnpm exec vitest run 'src/app/cases/[id]/attachments/route.test.ts' \
    'src/app/cases/[id]/attachments/[attachmentId]/content/route.test.ts' \
    src/lib/api/case-attachments.test.ts --coverage.enabled=false
   AssertionError: expected 501 to be 404 / 403 / 413 / 422 / 502
   AssertionError: promise rejected "Error: not built yet" instead of resolving
      Tests  30 failed (30)
```

GREEN: the upload route checks the case id, the origin (the graph export route's rule), a
multipart type and the declared length (10 MiB and 64 KiB of framing) before reading anything, then
streams `request.body` to the API with `duplex: 'half'` and an `Idempotency-Key` of its own; its
answers are a status and a sentence of ours (the API's problem code picks the sentence, its text is
never passed on). The content route passes the rendition through `renditionAnswer` as a download
named `case-attachment-<id>.<ext>`.

```
      Tests  58 passed (58)   (with the file rendition route's suite)
```

ESLint on the slice's files and `tsc --noEmit` exited 0.

## Slice 4: the compare panel and the page shortcuts (C142.3, C142.4, 2.1.4, 2.5.7)

`@panzoom/panzoom` 4.6.2 landed through `dashboard-workflows`' catalog slice. Stubs `CompareViewer`
and `CaseShortcuts`, RED `0e5675c7`:

```
$ pnpm exec vitest run src/components/cases/reviewer/compare-viewer.test.tsx \
    src/components/cases/reviewer/case-shortcuts.test.tsx --coverage.enabled=false
      Tests  10 failed | 1 passed (11)
$ pnpm exec vitest run 'src/app/cases/[id]/page.test.tsx' --coverage.enabled=false
 × compares the ID front with the centre selfie, with the similarity, threshold, basis and result ...
   TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Compare"
      Tests  2 failed | 16 passed (18)
```

The one that passed on the stub checks that a letter alone and an undefined chord move nothing.

GREEN: `compare-viewer.tsx` (panzoom on each stage through CSSOM writes only, our own buttons for
every key so nothing needs a drag, the keys read only when the viewer itself is the event target,
"Link views", brightness, contrast and grayscale as CSS filters set through a ref, the side poses
on request), `compare-section.tsx` (the chip portrait or the ID front beside the centre selfie,
through the selfie card's own helpers `idComparisonOf`, `thresholdText`, `THRESHOLD_ORIGIN_WORDS`
and `CheckStatusBadge`, with the check's tier and beta stage; no image without `pii:view`), and
`case-shortcuts.tsx` (Alt+Shift chords by physical key, `aria-keyshortcuts` set on their targets
only while on, a dialog listing them, the choice kept in this browser's storage behind try/catch).

Three test-side corrections while going green, none weakening a check: Vitest follows
`@panzoom/panzoom`'s `main`, a UMD build inside a `"type": "module"` package, so the two test files
that render the viewer point the module at its ES build (bundlers read `module`); the decision test's
selector `[aria-keyshortcuts*="A"]` also matched the viewers' `ArrowUp`, so it now checks that no
element has an access key and no decision button a shortcut.

```
$ pnpm exec vitest run 'src/app/cases/[id]' src/components/cases/reviewer --coverage.enabled=false
      Tests  79 passed (79)
```

ESLint (the React compiler's rules included) and `tsc --noEmit` exited 0.

## Slice 5: the print view (C142.5)

Stub `print.css` (a comment only), RED:

```
$ pnpm exec vitest run 'src/app/cases/[id]/print-view.test.ts' --coverage.enabled=false
 × is imported by the case page
 × sets the printed page and its margins
 × hides the navigation, the header, the toasts and every control, only on a case page
 × keeps each image with its caption, and shows the footer
      Tests  4 failed (4)
```

GREEN: `app/cases/[id]/print.css`, imported by the page: every rule inside `@media print`, scoped
by `body:has([data-case-print])` so no other page's printout changes; `@page` margins; navigation,
header, toasts and controls hidden; images and rows kept whole; the footer shown. `PrintButton`
calls `POST /cases/:id/print` and only on success `window.print()`; closed `<details>` open on
`beforeprint` and close on `afterprint`; `PrintFooter` takes the time as the browser prints.

```
$ pnpm exec vitest run 'src/app/cases/[id]' --coverage.enabled=false
      Tests  72 passed (72)
```

## Slice 6: the RSC payload, the DB-IP line, and the client forms' behaviour (C142.6, C92.8)

These tests cover behaviour slice 2 built together with the page (its forms, the comment tokenizer,
the words), so they were written after it and passed on first run, except one: the upload form read
its file through `new FormData(form).get('file') instanceof File`, which jsdom's file input does not
satisfy (the global `File` there is Node's). It now reads `input.files[0]` from the form's own
control, as a browser exposes it too; that change went in with these tests. This is a recorded
departure from RED-first for the forms of slice 2, not for any later slice.

- `app/cases/[id]/rsc-payload.test.tsx`: without `pii:view`, no field value, comment text, filename,
  prefilled value or image route (`/files/:id/rendition|content`, an attachment's content) is in the
  payload; with it, each is, so the check looks where they would be.
- `app/cases/[id]/page.test.tsx`: the location module closes with "IP geolocation by DB-IP" linking
  `https://db-ip.com` (Phase 7's `DbIpAttribution`) when a session shows an IP location.
- `components/cases/reviewer/forms.test.tsx`: the status control asks for a resolution, a status tag
  and a comment only when the chosen status needs them; a mention is inserted at the caret; the
  assignment forms; the SLA form; a case action's typed parameters and the run it links; the upload
  posts to the streaming route, says the route's sentence, refuses over 10 MiB before sending, and
  offers nothing once the policy is full; Print records first and opens the dialog only then, and
  prints nothing after a refusal; `<details>` open for printing and close after; the footer is
  stamped as the browser prints. jsdom's constraint validation does not see a file set by
  user-event, so those two tests submit the form directly.
- `components/cases/reviewer/case-words.test.tsx`: durations, SLA states, labels, timeline
  sentences, scan and rendition words, sizes; `CommentText` keeps markup as text.

```
$ pnpm exec vitest run src/components/cases/reviewer 'src/app/cases/[id]' --coverage.enabled=false
      Tests  110 passed (110)
```

## Slice 7: the compare panel without a comparison (C142.3)

RED: an inquiry whose `selfie_id_comparison` names no document (`id_verification_id` absent) showed
the selfie alone.

```
 × puts the newest ID front beside the selfie when no comparison names one, saying it was not compared
   TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Government ID front viewer"
```

GREEN: the newest front of any government ID of the inquiry stands beside the selfie, with the alt
text "Government ID front, not compared" and a sentence that nothing compared it; the numbers stay
the check's own ("Failed", "Not run"). 111 tests of the slice's folders pass; ESLint exits 0.

## Slice 8: the export entry point (C138.1, C142.2)

RED: `× offers the exports to cases:export, and to nobody else` (no link). GREEN: an "Exports" link
to `dashboard-cases`' `/cases/exports` for `cases:export` alone. An export takes a filter or a
search and neither names one case (`CASE_SEARCH_ATTRIBUTES` has no case id), so the case page's
entry point is the exports page. 113 tests of the slice's folders pass; ESLint exits 0.

## The full-stack spec (C142.6)

`e2e/tests/ui-reviewer.spec.ts` with `e2e/tests/support/ui-reviewer.ts`, budget 90 s. The data is
the spec's own: a published case template, a running `trigger-case` workflow with one required
input and its case action, an inquiry completed through the sandbox's simulate actions, and an
inquiry with a government ID front and a centre selfie uploaded through the flow API (the pose
through a sandbox `upload` capture, C40.3). The reviewer signs in once (`signInAs`).

1. Keyboard only: Alt+Shift+V, Tab into the ID front's viewer, `+`, `r`, ArrowRight, `0`; with focus
   on a viewer button `r` changes nothing; the compare panel shows Beta. A comment with a mention
   reads "@you". The case action runs through its form and links its `wfr_`. A 10 MiB JPEG goes
   through the streaming route (past a server action's 1 MB and the proxy's buffer) and lists as
   10.0 MiB. Print records `print-initiated` before `window.print()` (stubbed: headless Chromium has
   no dialog), and under print media the footer shows and the navigation hides. The case resolves
   to Approved (End), and the held inquiry is approved behind its confirmation.
2. The case page under an injected nonce script CSP (`injectNonceCsp`, `recordCspViolations`):
   no violation, and the viewer zooms.

Two runs failed before it passed, each on the spec: a selfie verification created since Phase 4
takes a pose only with its capture (409 `selfie_capture_required`), so the helper starts an
`upload` capture first; and a viewer holds a second status while its rendition is being prepared,
so the spec reads the one that starts "Zoom".

```
$ flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && \
    pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && \
    OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-reviewer.spec.ts; \
    rc=\$?; pnpm --filter @openverify/e2e e2e:stack:down; exit \$rc"
  ✓  1 … a reviewer compares, comments, runs a case action, uploads 10 MiB, prints, resolves and decides (6.3s)
  ✓  2 … the case page loads under an injected nonce script CSP with no violation (1.2s)
  2 passed (10.6s)
rc=0   (the whole sequence 83 s, load 2.50 3.94 5.05)
```

## Final gates (on `f53b106e`, each read from its exit code, output sent to files)

| Gate | Exit | Notes |
|---|---|---|
| `pnpm --filter @openverify/dashboard typecheck` | 0 | load 1.20 |
| `pnpm --filter @openverify/dashboard lint` | 0 | |
| `pnpm --filter @openverify/dashboard test` | 0 | 374 files, 5,194 tests, 97.02% statements, 90.07% branches, 224 s |
| `pnpm format:check` | 0 | |
| `pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | 0 | 4 of 4 tasks |
| the full-stack sequence of `tests/ui-reviewer.spec.ts` under one hold of the e2e lock | 0 | 2 passed in 10.9 s; the sequence 87 s at a load of 6.60 5.49 4.60; the stack rebuilt the dashboard (`.next/e2e/BUILD_ID` 14:22:52, after the last commit) |

My stack is down. No axe run: no axe package is in the repository, and this agent may add none
(team rule 3); see the report's blockers.
