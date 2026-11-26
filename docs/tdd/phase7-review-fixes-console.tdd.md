# Phase 7 review fixes: console (Workflow 7C)

TDD evidence of the console fixer's items of the Workflow 7C review. Every cycle wrote the failing test first, ran it (RED) and then made the minimal change (GREEN). Commands run from `apps/dashboard` after `source scripts/env.sh` unless a line says otherwise.

## R012: the ip-address report's fields in words, with their evidence (C106.1, C108, ADR 0006)

Confirmed real by reading: `FieldResults` printed `tor-exit-node` as the raw enum, `vpn-detected` as `Yes`, and no code outside the tests read `field-details`.

**RED** (`cf0e2ede`):

```
$ pnpm exec vitest run src/components/reports/phase7-results.test.tsx src/lib/report-field-words.test.ts --coverage.enabled=false
exit=1
 × reads CLEARED as what was checked, with its tier and no beta badge, never as the enum
 × marks the H-tier VPN network beta, with its confidence and reasons
 × keeps the tier and the reasons of a field the run could not answer, which stays unknown
 × marks each IP-derived place and network approximate
 × never reads an unflagged address as clean: an unavailable field stays unknown
 × says the tor-exit-node value CLEARED as Checked against a fresh exit list: not found
 AssertionError: expected undefined to be 'Checked against a fresh exit list: no…'
 Test Files  2 failed (2)
      Tests  28 failed | 143 passed (171)
```

Two guards pass at RED on purpose: a hidden value is not marked approximate, and a Tor or flagged field never is.

**GREEN:** `IpFieldEvidence` renders `field-details` (tier, beta and confidence for H, reasons through `SIGNAL_EVIDENCE_REASON_WORDS`) and "approximate" on a shown `isp`, country, city, region and point; `VALUE_WORDS` gains `tor-exit-node`, `service-type`, `proxy-detected` (`false` reads "Checked: not found"), `flagged` (`false` says an unavailable field is still unknown), `client-address-source` and `error`. A field the run could not answer keeps its tier and reasons and still reads "Unavailable: ...".

```
$ pnpm exec vitest run src/components/reports src/lib/report-field-words.test.ts --coverage.enabled=false
exit=0
 Test Files  9 passed (9)
      Tests  239 passed (239)
$ pnpm typecheck    # exit 0
```

## K7C-1-console: reviewers see a rejected handoff (C96.3, C108)

Built on the API's `c6257ea4`, which serves `from-rejected-handoff` and `handoff-rejected-at`. That commit also made `GenericEvidence` print "From rejected handoff" as a type attribute, which turned its own API-order test red at HEAD: the same defect, seen from the other side.

**RED** (`3e90e575`):

```
$ pnpm exec vitest run src/components/verification-card.test.tsx src/components/lifecycle/inquiry-sessions-phase7.test.tsx src/components/evidence/generic.test.tsx --coverage.enabled=false
exit=1
 × is a group named after the verification, listing its type attributes in API order
 × marks a session the desktop rejected, in words, with when (C96.3, K7C-1)
 × reads a handoff the desktop kept as not rejected (C96.3, K7C-1)
 × reads a member a server did not send as unknown, never as "not rejected" (K7C-1)
 × marks a verification from a rejected handoff in words, whatever its status
 × marks a Phase 5 type the same way, not as an attribute of its evidence
 TestingLibraryElementError: Unable to find an accessible element with the role "note"
 TestingLibraryElementError: Unable to find an element with the text: Rejected (UTC)
$ pnpm exec vitest run src/app/verifications/ --coverage.enabled=false
exit=1
 × marks the verification in words, and changes nothing about its status
```

**GREEN:** `RejectedHandoffNote` (an info note, `role="note"`, shown only when the member is `true`) on `VerificationCard` and `VerificationView`; a "Rejected (UTC)" term in `SessionHandoff`, reading the time and the sentence, "Not rejected" for `null` and "Unknown" for a server that did not send it; `from-rejected-handoff` joins the attributes `GenericEvidence` leaves to the card and the view. The status badge is untouched, because a rejection decides nothing here.

```
$ pnpm exec vitest run src/components/verification-card.test.tsx src/app/verifications/ src/components/lifecycle/ src/components/evidence/ src/app/inquiries/ --coverage.enabled=false
exit=0
 Test Files  44 passed (44)
      Tests  595 passed (595)
$ pnpm exec tsc --noEmit    # exit 0
```

## K7A-8-console: the audit pages show system entries (owner decision 3 after 7A, C15)

Built on the API's `e9b367a4`. There was no behaviour left to fix: `dashboard-signals` had built both audit pages for `actor { type: "system", id: null }`, so the page tests and the full-stack check (`af04ab9e`) guard behaviour already in place and **passed the first time they ran, with no RED**. The one change is a refactor, `214965a5`: the local `SystemAuditActor` and `ServedAuditActor` are gone for the contract's `ServedAuditActor`, and the type is what proves it.

One failure on the way was the test's own: a queued users answer the page never asked for, because the directory is read only when an entry names a user.

```
$ pnpm exec vitest run src/app/audit-logs/ src/components/operators/ --coverage.enabled=false
exit=0
 Test Files  14 passed (14)
      Tests  95 passed (95)
$ pnpm exec tsc --noEmit    # exit 0
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-signals.spec.ts'
exit=0
  ✓ 1 a developer reads an inquiry’s sessions, signals and list screening ... (14.0s)
  ✓ 2 the audit log shows the system’s handoff entry with no actor id and no link to entries by its actor (K7A-8, C15, C96) (3.5s)
  2 passed (21.1s)
loadavg 5.71 3.99 3.87
```

## K7B-2-console: the account page shows the graph component size (C101.6, C108)

Built on the API's `9f5a8874`.

**RED** (typechecks, `tsc=0`):

```
$ pnpm exec vitest run src/components/graph/account-graph-section.test.tsx --coverage.enabled=false
exit=1
 × shows the component size with the beta badge and when it was computed (K7B-2, C101.6)
 × shows the size even when no template binds account_id
 × says "Not computed yet" for an account newer than the last run, never a size
 × says "Components are off" while the setting is off, never a size
 TestingLibraryElementError: Unable to find an element with the text: Linked through strong identifiers: 4
```

The line `expect(screen.queryByText(/component/i)).toBeNull()` recorded the gap this item closes, so it went with the RED.

**GREEN:** `AccountGraphSection` reads `api.accounts.graphComponent` beside the templates and renders `AccountGraphComponent` above the panel, so the size shows even when no template binds `account_id`. The section is called only for a principal holding `graph:read`, which `slots-section.test.tsx` covers, so a viewer never reaches the route.

```
$ pnpm exec vitest run src/components/graph/account-graph-section.test.tsx --coverage.enabled=false
exit=0
```

## K7B-4-console: the transaction page shows its status history and labels (owner decision 8 after 7B, C108)

Built on the API's `10d81a5c`. The page has two cursor lists, so `Pagination` gained an optional `param` and `label`, and each list keeps the other's cursor in its links. The RED commit carries only the props those tests need to typecheck, because the stack's `next build` checks test files.

**RED** (`tsc=0`):

```
$ pnpm exec vitest run src/app/transactions/ src/components/pagination.test.tsx src/components/transactions/ --coverage.enabled=false
exit=1
 × names its cursor and its landmark, for a page with several lists
 × says who moved a status, for every actor type
 × lists the status changes as served, newest first, with who moved each
 × reads a redacted row as redacted, not empty, and keeps who moved it and when
 × lists the labels with their score and model version
 × says when there is no history and no label yet
 × never reads a redacted transaction's empty label list as no label yet
 × pages each list on its own, keeping the other's cursor in the link
 × ignores a cursor that is no row of the list
 × shows the latest label, and says the history needs a route the API does not serve yet
 Test Files  3 failed | 4 passed (7)
      Tests  10 failed | 35 passed (45)
```

**GREEN:** `TransactionHistory`, with `HISTORY_PAGE_SIZE` 10 for each list. A redacted transaction's empty label list reads "A redaction leaves no label to show", never "No label yet", because the API leaves redacted labels out. The history routes check only that the transaction exists, so a redacted transaction's page still loads.

```
$ pnpm exec vitest run src/app/transactions/ src/components/pagination.test.tsx src/components/transactions/ --coverage.enabled=false
exit=0
 Test Files  7 passed (7)
      Tests  45 passed (45)
$ pnpm exec tsc --noEmit    # exit 0
```

## K7B-3-console: the type and template editors read their versions from the version routes (owner decision 7 after 7B)

Built on the API's `0156e38f`. This replaces the workarounds of Stage 1 (7B Stage 4 amendment 14): both pages list every version with a cursor and open the latest draft by the `latest-version` relationship. `createGraphTemplate` now opens the first draft it already made, instead of making a second one, so the console no longer leaves an unreachable draft behind.

The API allows several drafts at once. So "New draft" shows only when the latest version is not a draft, otherwise the console would keep stranding drafts. That is why the full-stack type spec now opens "Version 1" rather than making "Version 2". The e2e helpers `publishedType` and `publishedTemplate` use the first draft too.

**RED** (`tsc=0`):

```
$ pnpm exec vitest run src/app/graph/ src/app/transaction-types/ --coverage.enabled=false
exit=1
 × opens a type's only draft by its latest-version relationship, and lists it
 × lists a published and a draft version, and opens the draft
 × lists the versions to a reader, with no draft action and no extra read
 × pages the versions by cursor, ignoring one that is no version
 × shows the version numbers, the published fields, statuses and relations, read-only
 × shows a template: its published configuration, the run form, a new draft and its rename and archive
 × opens a template's only draft by its latest-version relationship, and lists it (K7B-3)
 × lists a published and a draft version, and opens the draft (K7B-3)
 × pages the versions by cursor (K7B-3)
 × creates a template and opens its first draft, which holds the configuration (K7B-3)
 × opens the template when a server names no latest version
 Test Files  3 failed | 6 passed (9)
      Tests  11 failed | 82 passed (93)
```

**GREEN:** `VersionsTable`, shared by both pages, under a "Version history" section, as on the inquiry template page: a section named "Versions" clashed with the table's own scroll region of that name. A reader gets the list and no extra version read.

```
$ pnpm exec vitest run src/app/graph/ src/app/transaction-types/ src/components/lifecycle/ --coverage.enabled=false
exit=0
 Test Files  30 passed (30)
      Tests  272 passed (272)
$ pnpm exec tsc --noEmit    # exit 0
$ pnpm --filter @openverify/e2e exec tsc --noEmit    # exit 0
```

## K7B-6-console: the two transaction limits read in words at their pointers (owner decision 10 after 7B)

Built on the API's `7c062403`, which added `relation_cardinality_exceeded` and `related_objects_limit` to the problem codes. That turned `pnpm exec tsc --noEmit` red, because `TRANSACTION_PROBLEM_WORDS` must word every code, so the RED commit holds empty words to typecheck.

**RED** (`tsc=0`):

```
$ pnpm exec vitest run src/components/transactions/ src/app/transactions/actions.test.ts --coverage.enabled=false
exit=1
 × sets and removes a relation, wording a refused second target (K7B-6)
 × says every transaction problem code as a sentence
 × says to remove the current target, at the relation field
 × says the limit of related objects, at the object IDs
 Expected element to have accessible description: Remove the current target first.
 Received: Holds one target.
```

The first run of the form tests failed in my own helper, whose label regex also matched the "Relations" form. Asserting the control's accessible description fixed that and proves the words sit at the field.

**GREEN:** each limit has a title and, in `LIMIT_POINTER_WORDS`, what to do at the pointer, so the form does not say one sentence twice. The 100 comes from `TRANSACTION_LIMITS.relatedObjects`. Every other code keeps the API's words at its pointer.

```
$ pnpm exec vitest run src/components/transactions/ src/app/transactions/ src/no-sharp.test.ts src/instrumentation-client.test.ts --coverage.enabled=false
exit=0
$ pnpm exec tsc --noEmit    # exit 0
```

## K7B-11-console: the console reads a nullable explorer-url (owner decision 13 after 7B)

Built on the API's `4142ae7d`. Reading the code showed no dependency to remove: `explorer-url` appears only in the graph test fixture and one page comment, and every link (the account panel, the query list, the result page, an expansion) is built from the query's id. So there is **no runtime RED**; the tests guard behaviour already right.

The RED that exists is the type's, because the fixture took a `string`:

```
$ pnpm exec tsc --noEmit
tsc=2
src/app/graph/[id]/page.test.tsx(143,39): error TS2322: Type 'null' is not assignable to type 'string | undefined'.
src/app/graph/pages.test.tsx(61,42): error TS2322: Type 'null' is not assignable to type 'string | undefined'.
src/components/graph/account-graph-section.test.tsx(168,63): error TS2322: Type 'null' is not assignable to type 'string | undefined'.
```

**GREEN:** the fixture takes `null`, and the comment on `app/graph/[id]/page.tsx` no longer says every `explorer-url` points there.

```
$ pnpm exec tsc --noEmit    # exit 0
$ pnpm exec vitest run src/app/graph/ src/components/graph/account-graph-section.test.tsx --coverage.enabled=false
exit=1
 × previews the export's count, which needs accounts:read and pii:view
 TypeError: The export answers CSV: call graphQueries.exportCsv
 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 85 passed (86)
```

**Correction.** Commit `1f03cf28` carried this record with `exit=0` written before the run was read, and the run in fact exited 1. The one failure was not K7B-11's: the API's K7B-9 commit `90260e72` landed during the run and made `graphQueries.action` refuse `export`, which K7B-9-console below answers. The three K7B-11 tests passed in that run, and the whole graph directory exits 0 in the K7B-9 run below.

## K7B-9-console: the console calls the new @openverify/node methods (owner decisions 12 and 21 after 7B)

Built on the API's `90260e72`. That commit broke the export's count preview, because `graphQueries.action` now throws on any `export`, a preview included, as owner decision 12 says. The preview is JSON and needs no key, so it goes through `apiRequest`, which decision 21 allows.

The tag, biometric and file tests assert what only the node client sends: an `Idempotency-Key` on a POST, or its `user-agent` on a GET. `exportGraphCsv` is a stub at RED so the tests typecheck.

**RED** (`tsc=0`):

```
$ pnpm exec vitest run src/lib/api/graph.test.ts src/app/graph/ src/app/transactions/ --coverage.enabled=false
exit=1
 × previews the export's count, which needs accounts:read and pii:view
 × adds, removes and sets tags through the tag routes
 × redacts, with the never fields only when asked, and redacts the biometrics
 × streams the API's CSV as it answers it, as a download that is never stored
 × reduces an API 403 to 403, saying it in words and never passing the problem on
 × streams the bytes as a download to an operator with pii:view, never stored
 × posts the export action through the node client, with the session, an Idempotency-Key of its own and the BFF headers ...
 Test Files  5 failed | 5 passed (10)
      Tests  18 failed | 91 passed (109)
```

**GREEN:**

- `addTag`, `removeTag`, `setTags` and `redactBiometrics` in `app/transactions/actions.ts`. The console has no file upload, so `uploadFile` has no caller to change.
- `fileContent` in the file route, which keeps its own session and `pii:view` checks. It now buffers the file rather than streaming it, because the client answers bytes.
- `exportCsv` in `exportGraphCsv`. It answers only the text, so that client's `fetch` asks for `text/csv` and records the answered type. The route therefore keeps its origin, selection and session checks, its status words, the exact `content-type` and its 502 for an answer that is not CSV.

Every case of the route test stays, with `exported()` or `refused()` in place of a raw `Response`. One assertion moved with the code: the key's format is the client's ULID rather than `randomUUID`, and "sends a new key for each export" still holds.

```
$ pnpm exec tsc --noEmit    # exit 0
$ pnpm exec vitest run src/lib/api/ src/app/graph/ src/app/transactions/ src/components/graph/ --coverage.enabled=false
exit=0
 Test Files  43 passed (43)
      Tests  438 passed (438)
```

## Final gates

Each exit code below was read from the command itself, with its output in a file.

```
$ (pnpm --filter @openverify/dashboard typecheck && pnpm --filter @openverify/dashboard lint && pnpm --filter @openverify/dashboard test)
exit=0
 Test Files  327 passed (327)
      Tests  4775 passed (4775)
 All files  |  97.95 |  92 |  98.31 |  97.92
$ pnpm format:check
exit=0
$ pnpm turbo run lint typecheck --force    # at 011c53ab
exit=0
 Tasks:    30 successful, 30 total
 Cached:   0 cached, 30 total
```

The e2e gate at `011c53ab`, on one fresh stack, under `/tmp/openverify-e2e.lock`:

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
exit=0    79 passed (20.9s)    loadavg 1.39 2.88 8.06
$ ... playwright test --shard=1/3
exit=0    36 passed (2.2m)     loadavg 2.49 2.76 6.70
$ ... playwright test --shard=2/3
exit=0    39 passed (5.7m)     loadavg 13.40 7.63 7.56
$ ... playwright test --shard=3/3
exit=0    33 passed (7.1m)     loadavg 9.90 18.17 14.02
```

Two earlier attempts failed, neither on console code:

1. **Shard 1 at `89b58fa5`: 1 failed, 35 passed.** `operators.spec.ts:104` expected the seeded default template on the first page of a newest-first list. Counted on the live stack, 26 templates existed at the failure and the default ranked 26th, one past the page of 25: `handoff.spec.ts` had grown from 2 tests to 3. Shards 2 and 3 passed. The spec is on the API fixer's side of the split, so it was left alone, and the API fixer fixed it in `011c53ab`.
2. **Shard 1 re-run on a stack another agent had already used: 3 failed, 33 passed.** All three were `429 Too many codes were asked`, the OTP budget of a stack that shard 1 had already run on. Reusing that stack was a mistake here, because the gate calls for a fresh one, and the run above used a fresh one.

Two commits landed with a check still red, because the commit was chained after the command rather than after reading its result: `1f03cf28` carried a wrong `exit=0`, corrected in the K7B-11 section, and `70519582` left a lint error, fixed in `89b58fa5`. After those, a commit waited for the exit codes.
