# Phase 7, Workflow 7C Stage 1: `dashboard-signals`

The console surfaces of C108 for signals, sessions, list matches, the template version members, the
network sources page, the C107.7 settings, the audit pages' system entries, the account page's
signals and list-match sections with the two slots for the other agents, the custom-list report, the
words, the RSC payload test and `e2e/tests/ui-signals.spec.ts`.

Every command below ran after `source scripts/env.sh`, from the repository root unless stated.

## How this record was written

The first run stopped at 19:20Z with this file at section 1 only. Sections 2 onward were written
afterwards, on 2026-11-01, from two sources:

- the first run's shell log, `resume/7c-resume/dashboard-signals-shell-log.md` under the project's
  Claude directory (230 entries, 6,207 lines, taken from the OpenCode event stream);
- the commits themselves (`git show --name-status`).

Output below is copied from that log; `L<n>` is its line number. Nothing is written from memory. The
limits of the evidence, which each section applies:

- **Shortened commands.** The log cuts long commands to their head with `[...command cut]`, and long
  output with `[...]`. Where the `vitest run` line fell in the cut, the section says so and names the
  files from the RED commit instead of inventing a command.
- **Overwritten raw logs.** Each run wrote to a file under `/tmp/opencode/`, and a GREEN run reused
  its RED's file name. Only `nav.log`, `nav2.log` and `slot.log` still hold a RED. So any other RED's
  failure messages exist only where the command printed them.
- **RED reasons.** Where only a count was printed, the section says "count only". The tests failed
  against a stub, but the log cannot show the assertion that failed, so that reason is not claimed
  as seen.

Every test command below ran from `apps/dashboard` with `--coverage.enabled=false`, unless it says
otherwise.

| Section | Slice | Stub | RED | GREEN |
|---|---|---|---|---|
| 1 | Dependencies | | | `c14a8961` |
| 2 | Navigation and account slots | `57c02981` | `16754bc4` | `916669ee` |
| 3 | Words | `a7c32f7e` | `66092291` | `cf5933bd` |
| 4 | Fixtures | `ad9ec069` | | |
| 5 | Sessions cards | `ad9ec069` | `7e495b0c` | `5fac26ab` |
| 6 | Signals section | `7798bb14` | `ccaf0596` | `5c8c9d3e` |
| 7 | List matches | `2490facd` | `f8e3d8d1` | `0a3cf371` |
| 8 | The inquiry page wires both | | `43abf3b1` | `aaf059bc` |
| 9 | Template version documents | `be133f79` | `fdc33ee6` | `a97132bd` |
| 10 | Network sources page | `08d90167` | `a76fa65c` | `40a3c3c4` |
| 11 | C107.7 settings | `cad8ef22` | `ad44be34` | `1ba1efab` |
| 12 | System audit entries | `68f66551` | `b6b0c809` | `9089b336` |
| 13 | Account sections | | `0f78a855` | `a63c7eae` |
| 14 | Custom-list report, DB-IP on reports | | `7c9f52b9` | `c76b093d` |
| 15 | RSC payload | | `eb32c708` (guard) | |
| 16 | README | | | `d6c0f56f` |
| 17 | `ui-signals` spec | | `ac6da519` (acceptance) | |
| 18 | `ui-selfie` spec (this run) | | | `10390144` |

## 1. First slice: dependencies (rule 3)

`cytoscape` 3.34.3 and `cytoscape-fcose` 2.2.0, through the pnpm catalog, in `apps/dashboard`.
fcose resolves `cose-base` 2.2.0 and `layout-base` 2.0.1.

Release dates (npm registry, `npm view <name> time --json`), each at least 14 days before
2026-11-01:

| Package | Version | Published | Licence (the tarball's `LICENSE` file) |
|---|---|---|---|
| cytoscape | 3.34.3 | 2026-09-07 | MIT, "Copyright (c) 2016-2026, The Cytoscape Consortium" |
| cytoscape-fcose | 2.2.0 | 2023-01-17 | MIT, "Copyright (c) 2018 - present, iVis-at-Bilkent" |
| cose-base | 2.2.0 | 2023-01-17 | MIT, "Copyright (c) 2019 - present, iVis@Bilkent" |
| layout-base | 2.0.1 | 2021-06-25 | MIT, "Copyright (c) 2019 iVis@Bilkent" |

The licences were read with `npm pack <name>@<version>` into `/tmp/opencode/lic` and `head` of each
`package/LICENSE`. None has an install script (`npm view ... scripts.install scripts.postinstall
scripts.preinstall` printed nothing), so `allowBuilds` is unchanged; `pnpm install` added 4 packages
and wrote no `minimumReleaseAgeExclude` entry:

```
$ pnpm install
✓ Lockfile passes supply-chain policies
Packages: +4
Done in 1.2s using pnpm v12.14.0
```

`THIRD_PARTY_LICENSES.md` §2.1.13 lists the four; the §2.2 "to verify on adoption" row is gone.
A dependency has no behaviour of its own, so it has no RED test; the explorer's tests are
`dashboard-graph`'s.

## 2. Navigation and the two account slots (C108, F32)

Stub `57c02981`: `components/graph/account-graph-section.tsx` and
`components/transactions/account-transactions-section.tsx`, rendering nothing, with
`{ accountId, permissions }` frozen. Lint refused the first two forms of the stub (L636, L652:
`no-meaningless-void-operator`, then `no-unused-vars`), so each is a typed `const` answering
`Promise.resolve(null)`.

RED `16754bc4`, seen failing for its reason. The navigation (L344, L403):

```
$ pnpm exec vitest run src/components/nav.test.tsx --coverage.enabled=false
exit=1
     × is the console navigation, with a labelled list per group 348ms
      Tests  1 failed | 1 passed (2)
```

`nav-items.test.ts` at L344 (its command is cut in the log):

```
exit=1
     × lists every C23 console route, each gated by the permission that reads it 15ms
     × is linked under Organization after Settings, read with settings:read as its API route is 2ms
     × is shown to a role that reads settings, and hidden from one that does not 2ms
[...]
 FAIL  src/components/nav-items.test.ts > the Phase 7 pages (C108) > shows lists:read its own items only
 FAIL  src/components/nav-items.test.ts > the Phase 7 pages (C108) > shows graph:read its own items only
 FAIL  src/components/nav-items.test.ts > the Phase 7 pages (C108) > shows transactions:read its own items only
 FAIL  src/components/nav-items.test.ts > visibleNavGroups > shows an admin everything
      Tests  9 failed | 17 passed (26)
```

The slots (L753-L770; `/tmp/opencode/slot.log` still holds this run):

```
$ pnpm exec vitest run "src/app/accounts/[id]/slots-section.test.tsx" --coverage.enabled=false
exit=1
     × calls it with the account id and the principal's permissions, under graph:read 81ms
     × shows the forbidden panel in the section when the API refuses its read 163ms
     × calls it with the account id and the principal's permissions, under transactions:read 17ms
     × shows the forbidden panel in the section when the API refuses its read 96ms
      Tests  4 failed | 4 passed (8)
tsc=0
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Graph"
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Transactions"
```

GREEN `916669ee`. `OptionalSection` moved out of `inquiry-view.tsx` into
`components/lifecycle/optional-section.tsx`, beside the new `SlotSection`. The run after the move
(L876; its command is cut in the log) and then the slice's own (L914):

```
exit=0
 Test Files  34 passed (34)
      Tests  333 passed (333)

$ pnpm exec vitest run "src/app/accounts" src/components/nav-items.test.ts src/components/nav.test.tsx --coverage.enabled=false
exit=0
      Tests  82 passed (82)
```

## 3. Words: events, signals, list screening and network facts (C108)

Stub `a7c32f7e`: `lib/signal-words.ts`, `lib/list-match-words.ts` and `lib/network-words.ts` with
empty records. RED `66092291`. The log cuts the command (L1775); the four files are the RED commit's
`signal-words`, `list-match-words`, `network-words` and `event-words` tests. Each iterates the
contracts' list, and `event-words.test.ts` now iterates `EVENT_NAMES`:

```
lint=0
exit=1
 Test Files  4 failed (4)
      Tests  205 failed | 172 passed (377)

× says inquiry.created in words 7ms
     × says inquiry.started in words 1ms
     × says inquiry.completed in words 1ms
```

GREEN `cf5933bd`, with the surfaces that call `eventWords` run too (L1949, L1959):

```
exit=0
      Tests  377 passed (377)

$ pnpm exec vitest run src/components/lifecycle src/components/integrations src/app/events --coverage.enabled=false
lint=0
exit=0
      Tests  253 passed (253)
```

`compromised_list_unavailable` was already worded (`lib/check-reasons.ts:122`, L1490), so it was
checked and not added a second time.

## 4. Fixtures (`ad9ec069`)

`testing/signals-fixtures.ts`: synthetic sessions, devices, networks, signals, list matches and
network sources, with the stubs the sessions section needs. It carries its own parse test (L2404):

```
$ pnpm exec vitest run src/testing/signals-fixtures.test.ts --coverage.enabled=false
lint=0
      Tests  1 passed (1)
```

## 5. The Sessions section as cards (C108, C92.8)

RED `7e495b0c`. Lint and `tsc` first stopped the test file itself (L2537), and were fixed before the
commit (L2568). Count only:

```
$ pnpm exec vitest run src/components/lifecycle/inquiry-sessions-phase7.test.tsx src/components/lifecycle/inquiry-sessions.test.tsx "src/app/inquiries/[id]/page.test.tsx" --coverage.enabled=false
lint=0
exit=1
      Tests  27 failed | 48 passed (75)
```

Two existing test files changed with it, because C108 changes the behaviour they check (see the
report's deviations): `inquiry-sessions.test.tsx` finds a card, not a row, and `page.test.tsx` mocks
the new per-session read and asserts its `include=device,network`.

On the way to GREEN one test failed for a reason worth keeping (L2695, L2701): the new "Signals
collected" fallback read "Not reported", the same words as the consent's:

```
     × says when a session has no consent yet, and when the server does not report it 57ms
      Tests  1 failed | 28 passed (29)
TestingLibraryElementError: Found multiple elements with the text: Not reported
```

The new text became "Not reported by this server". GREEN `5fac26ab` (L2741, L2781):

```
$ pnpm exec vitest run src/components/lifecycle/inquiry-sessions-phase7.test.tsx src/components/lifecycle/inquiry-sessions.test.tsx --coverage.enabled=false
exit=0
      Tests  29 passed (29)
```

```
exit=0
      Tests  273 passed (273)
```

The 273-test run's command is cut in the log; lint on the changed files then exited 0 (L2790).
**Known cost:** this commit broke
`e2e/tests/ui-selfie.spec.ts`, which still looked for the table. It was found by a full-stack shard
and fixed in section 18.

## 6. The Signals section (C108)

Stub `7798bb14`. RED `ccaf0596`. The first attempt had a TS2322 in the test (L2849); the test was
fixed before the commit, and that commit's `tsc | grep signals/` printed nothing (L2883). Count only:

```
$ pnpm exec vitest run src/components/signals/inquiry-signals.test.tsx --coverage.enabled=false
lint=0
exit=1
      Tests  8 failed | 1 passed (9)
```

GREEN in the tree at 18:23Z (L2932), committed at 18:52Z as `5c8c9d3e`:

```
exit=0
      Tests  9 passed (9)
```

**That commit came late, after later slices.** `aaf059bc` (section 8, 18:31Z) still contains the
stub of `inquiry-signals.tsx` (`git show aaf059bc:<path>`), so section 8's GREEN run read the
uncommitted implementation from the working tree. Its "shows the signals" test cannot pass at that
commit alone; that follows from reading the commit, and was not run. L4903 shows the file still
modified at 18:52Z, and `5c8c9d3e` holds that one file. HEAD is unaffected.

## 7. List matches and dismissal (C99, C108; H02, H15, H31)

Stub `2490facd`. RED `f8e3d8d1`. Lint stopped the stub twice (L3194, L3235) and was clean before the
commit (L3246). The log cuts the command at L3198; the files are
`app/list-matches/actions.test.ts` and `components/signals/list-matches.test.tsx`. Count only:

```
exit=1
      Tests  19 failed | 1 passed (20)
```

The first implementation failed on a real bug (L3368, L3377): `formString` already trims, and answers
`undefined` for an absent field, so the extra `.trim()` threw. It was removed.

```
     × posts the reason and refreshes the page it came from 30ms
     × refreshes the account page for a dismissal made there 4ms
     × requires a reason, on its field, without calling the API 3ms
     × says a match dismissed already in words (409 list_match_not_open) 2ms
      Tests  4 failed | 16 passed (20)
TypeError: Cannot read properties of undefined (reading 'trim')
 ❯ optional src/app/list-matches/actions.ts:25:43
```

GREEN `0a3cf371` (L3447):

```
$ pnpm exec vitest run src/app/list-matches src/components/signals/list-matches.test.tsx --coverage.enabled=false
exit=0
      Tests  20 passed (20)
lint=0
```

## 8. The inquiry page shows both sections, each behind its scope

RED `43abf3b1`, seen failing by name (L3466):

```
$ pnpm exec vitest run "src/app/inquiries/[id]/signals-section.test.tsx" --coverage.enabled=false
exit=1
     × shows the signals to anyone who reads the inquiry, grouped by layer 533ms
     × shows the screening from the inquiry read, and the matches with lists:read 229ms
     × offers dismissal with lists:write 213ms
     × reads no matches without lists:read, and still shows the screening 185ms
     × shows the forbidden panel for the matches when the API refuses them 179ms
      Tests  5 failed (5)
```

Mid-way (L3513, L3520) the hidden table caption "List matches" made a second region of that name:

```
      Tests  2 failed | 276 passed (278)
TestingLibraryElementError: Found multiple elements with the role "region" and name "List matches"
```

`ListMatches` took a `caption` prop, default "List matches of this inquiry". GREEN `aaf059bc`
(L3564; see the note in section 6 on what the tree held):

```
$ pnpm exec vitest run "src/app/inquiries/[id]" src/components/signals --coverage.enabled=false
exit=0
      Tests  80 passed (80)
lint=0
```

## 9. Template versions: `signal-config` and `list-config` (C108, H20)

Stub `be133f79`. RED `fdc33ee6`. A TS2345 in `version-documents.test.ts` (L3938) was fixed before the
commit. Count only (L3950):

```
$ pnpm exec vitest run src/lib/version-problem-words.test.ts src/components/lifecycle/version-editor-phase7.test.tsx src/app/templates/version-documents.test.ts src/app/templates/[id]/versions/[versionId]/signal-config.test.tsx --coverage.enabled=false
exit=1
      Tests  35 failed | 1 passed (36)
```

The implementation passed all but one test (L4026). That failure was in the test: the JSON editor
renders `<code>{pointer}</code>: {detail}`, so an exact `findByText('not a signal')` found nothing.
The test was changed before GREEN to assert `aria-invalid` and the accessible description, still
naming the error `not a signal` at `/collect/0`:

```
     × shows an error in the document it is about, by its path inside it 1176ms
      Tests  1 failed | 245 passed (246)
TestingLibraryElementError: Unable to find an element with the text: not a signal.
```

GREEN `a97132bd` (L4071; the log's run after the test change covers that file):

```
$ pnpm exec vitest run src/components/lifecycle/version-editor-phase7.test.tsx --coverage.enabled=false
exit=0
      Tests  4 passed (4)
```

## 10. The network sources page (C92, C108)

Stub `08d90167`. RED `a76fa65c`. The log cuts the command at L4190; the files are
`app/network-sources/page.test.tsx` and `components/network/network-sources-view.test.tsx`. Count
only:

```
lint=0
exit=1
      Tests  11 failed | 2 passed (13)
```

GREEN `40a3c3c4` (L4287):

```
$ pnpm exec vitest run src/components/network src/app/network-sources --coverage.enabled=false
lint=0
exit=0
      Tests  13 passed (13)
```

## 11. The C107.7 settings (C108)

Stub `cad8ef22`. RED `ad44be34`, which includes the trap the brief names: `saveSettings` compared
`signal-collection` with `!==`, always true for an object. Count only (L4666):

```
$ pnpm exec vitest run src/components/operators/settings-form-phase7.test.tsx src/app/settings/actions-phase7.test.ts src/app/settings/page-phase7.test.tsx --coverage.enabled=false
lint=0
exit=1
      Tests  24 failed | 4 passed (28)
```

The first implementation left three failures (L4853), the third being the audit trail, which did not
exist yet:

```
     × lets a principal with settings:privacy change the collection tiers 1189ms
     × shows every Phase 7 setting read-only with settings:read alone 195ms
     × shows the audit trail of the collection tier changes with audit-logs:read 653ms
      Tests  3 failed | 129 passed (132)
```

`listSettingsChanges` (`lib/api/audit-logs.ts`) and `components/operators/collection-changes.tsx`
were added next. GREEN `1ba1efab` (L4899; its command is cut in the log, and the run before it, at
L4843, used `src/components/operators src/app/settings`):

```
lint=0
exit=0
      Tests  135 passed (135)
```

## 12. System audit entries (K7A-8)

Stub `68f66551`: the local `ServedAuditActor` widens `AuditActor` with `{ type: "system", id: null }`,
a `tsc` error at L5025 fixed in that stub. RED `b6b0c809` (L5038):

```
$ pnpm exec vitest run src/components/operators/audit-actor.test.tsx --coverage.enabled=false
exit=1
     × reads a system entry as "System", with no id 65ms
     × links the entries of a user or an API key 5ms
      Tests  2 failed | 3 passed (5)
```

GREEN `9089b336` (L5077; its command is cut):

```
lint=0
exit=0
      Tests  93 passed (93)
```

The console fixer finishes this when the API serves the shape (K7A-8).

## 13. The account page's Signals and List matches sections (C108, C92.8)

RED `0f78a855` (L5124):

```
$ pnpm exec vitest run src/app/accounts/[id]/signals-section.test.tsx src/components/signals/list-matches.test.tsx --coverage.enabled=false
lint=0
exit=1
     × carries the DB-IP line beside a match on an IP location (C92.8) 182ms
     × shows the signals of its latest inquiries with inquiries:read, in words 581ms
     × lists the account matches with lists:read 105ms
     × offers dismissal with lists:write 97ms
     × shows the forbidden panel when the API refuses the matches 87ms
      Tests  5 failed | 18 passed (23)
```

GREEN `a63c7eae` (L5175; its command is cut; `/tmp/opencode/ac.log` still holds this run):

```
lint=0
exit=0
 Test Files  30 passed (30)
      Tests  262 passed (262)
   Duration  21.96s (environment 34%, tests 25%, import 19%, transform 13%, setup 8%)
```

## 14. The custom-list report, and DB-IP on the ip-address results (C106, C92.8, C108)

RED `7c9f52b9` (L5473), seen failing by name and, for one, by message (L5485):

```
$ pnpm exec vitest run src/components/reports/phase7-results.test.tsx --coverage.enabled=false
lint=0
exit=1
     × shows each matched item with its source, method, tier and value 268ms
     × marks an H-tier item beta, with its confidence, score and approximate 29ms
     × lists the lists searched, each unscreened list "not screened" with its reason, never "no match" 77ms
     × shows each list read with its version, normaliser version, item count and screening time 31ms
     × carries the DB-IP line beside the IP location it shows 139ms
     × says "no match" only beside ready, as the page does 5ms
      Tests  6 failed | 1 passed (7)
TestingLibraryElementError: Unable to find an accessible element with the role "list" and name "Lists searched"
```

GREEN `c76b093d`. Its command is cut in the log; `/tmp/opencode/rp.log` still holds this run, which
was the widest of the slices:

```
lint=0
exit=0
 Test Files  95 passed (95)
      Tests  2495 passed (2495)
   Duration  41.70s (environment 31%, import 27%, tests 14%, setup 14%, transform 13%)
```

## 15. The RSC payload (`eb32c708`)

`testing/rsc-payload-signals.test.tsx` was written after the surfaces, so it is a guard, not a RED
for a behaviour. **It has never been seen failing on a leaked value.** Three of its four tests have
positive controls, so an empty payload fails them: the inquiry's payload must hold the device class,
the score's words and the match id, the account's the match id, and the report's the list id.
**The network sources test has no positive control**, so an empty payload would pass it. That is an
open followup, not fixed here.

The first run failed three of four (L5646). The log cuts the first two messages; the third is a
control expecting a list name the payload does not carry:

```
$ pnpm exec vitest run src/testing/rsc-payload-signals.test.tsx --coverage.enabled=false
lint=0
exit=1
     × holds no personal value on the inquiry Sessions, Signals and List matches sections 76ms
     × holds no personal value on the account Signals and List matches sections 23ms
     × holds no personal value on a custom-list report 699ms
- Synthetic blocked emails
```

The fix was in the test: a mock of `GET /dashboard/reports`, and that control moved to the list id.
No `not.toContain` changed (L5663-L5678):

```
exit=0
      Tests  4 passed (4)
```

## 16. The README (`d6c0f56f`)

"Signals, lists, graph and transactions in the console" in `apps/dashboard/README.md`. Documentation
has no RED.

## 17. `e2e/tests/ui-signals.spec.ts` (`ac6da519`)

An acceptance spec over surfaces already built and unit-tested, committed at 19:09Z with lint and
`tsc` clean (L6103, L6106) and before any run, because no stack was up (L6115). **It has not been
seen RED.** Its first run, on a fresh stack, passed (L6164):

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-signals.spec.ts'
exit=0

Running 1 test using 1 worker

  ✓  1 [chromium] › tests/ui-signals.spec.ts:34:1 › a developer reads an inquiry’s sessions, signals and list screening in words without personal data, dismisses its match, and a viewer reads the collection tiers and the network sources (C90-C99, C108) (23.9s)

  1 passed (29.1s)
```

The run's last whole-suite attempt (L6178) did not reach a test: another agent's Vitest held
`apps/dashboard/coverage`, which is why the final gate below has its own directory.

```
Error: The coverage report directory "/home/mhnoor/persona-opensource/apps/dashboard/coverage" is already in use by another Vitest process (pid 1701262
```

## 18. `e2e/tests/ui-selfie.spec.ts` (this run, `10390144`)

Commit `5fac26ab` (section 5) turned the Sessions table into cards. The other Stage 1 agent's shard 3
found what that broke (`/tmp/opencode/dlt-s3.log`), which is the RED for this slice:

```
  1) [chromium] › tests/ui-selfie.spec.ts:71:1 › a reviewer reads a selfie in the console: the photos in prompt order, the ID comparison with its threshold ...
    Error: expect(locator).toHaveText(expected) failed
    Locator: getByRole('region', { name: 'Sessions', exact: true }).getByRole('table', { name: 'Inquiry sessions' }).getByRole('row').filter({ has: getByRole('r...
    Expected: "consent.biometric, consent.processing, notice.session-integrity"
    Timeout: 30000ms
    Error: element(s) not found
  1 failed
  30 passed (4.9m)
```

Only the way the spec finds the session changed, from a table row to
`getByRole('list', { name: 'Inquiry sessions' }).getByRole('article', { name: 'Session <id>', exact: true })`.
The three assertions and their expected text are unchanged. `term()` is the CSS match
`dt:text-is("<name>") + dd`, and it works inside the card: `ConsentTerm` keeps `dt` and `dd` as
siblings, and no other part of the card uses those three terms.

GREEN, on the stack another agent's restart had just built from this tree:

```
$ flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-selfie.spec.ts'
exit 0

Running 2 tests using 1 worker

  ✓  1 [chromium] › tests/ui-selfie.spec.ts:71:1 › a reviewer reads a selfie in the console: the photos in prompt order, the ID comparison with its threshold and basis, liveness in words, the capture and the consent (C47) (22.8s)
  ✓  2 [chromium] › tests/ui-selfie.spec.ts:240:1 › an admin changes the face template retention on the settings page, a value out of range is refused on its field, and the original is restored (C42.6, C47) (1.7s)

  2 passed (28.0s)
```

The first attempt at this run (exit 1) found no stack, because the other agent's `e2e:stack:up` had
just replaced it (`no reusable e2e stack is running`). Rule 7 says that is not a test failure.

## 19. Final gates (this run, HEAD `9e11966c`)

Each gate's output went to a file, and each result below is the command's own exit code. The first
unit pass (19:38Z to 19:50Z, all exit 0) was overtaken by three `apps/dashboard` commits from other
agents, so these were run again on the final tree. Only `apps/flow`'s mocked suite was not repeated:
nothing under `apps/flow` or `packages/` changed after it.

```
$ pnpm --filter @openverify/dashboard test --coverage.reportsDirectory=/tmp/openverify-7c/signals-coverage
dashboard test exit=0
 Test Files  326 passed (326)
      Tests  4705 passed (4705)
   Duration  205.77s (tests 31%, environment 30%, import 21%, setup 11%, transform 5%, worker 2%)
All files          |   97.91 |    91.93 |   98.26 |   97.87 |

dashboard typecheck exit=0
dashboard lint exit=0
format:check exit=0

$ pnpm turbo run lint typecheck --force
turbo lint typecheck --force exit=0
 Tasks:    30 successful, 30 total
Cached:    0 cached, 30 total
  Time:    4m2.871s

$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e      (19:50Z)
flow e2e exit=0
  79 passed (22.2s)
```

The e2e gate, on one fresh stack started at 21:10:48Z from `9e11966c`, with no other agent on it:

```
shard 1/3 exit=0
Running 37 tests using 1 worker, shard 1 of 3
  37 passed (2.2m)
shard 2/3 exit=0
Running 37 tests using 1 worker, shard 2 of 3
  37 passed (4.8m)
shard 3/3 exit=0
Running 32 tests using 1 worker, shard 3 of 3
  32 passed (4.3m)
```

### Why two earlier attempts at this gate failed

Neither failure is in this slice's code, and neither was retried away: each was traced first. Stack
state carries over between runs, and three agents ran their gates on one stack:

- **Shard 3, 2 failed, 30 passed**, on the stack of 19:53Z after shard 1 had run twice, shard 2 once
  and shard 3 once: `tests/ui-people.spec.ts:62` and `:124` got `send a code answered 429`
  ("Too many codes were asked for"). `otp-ip-hour` allows 10 sends an hour per environment and
  address, and every spec comes from one address. That stack's logs are gone, so the sends were
  not counted on it. The measurement below is what supports the cause.
- **Shard 1, 1 failed, 36 passed**, at 20:21Z, on a stack `dashboard-graph`'s shard 1 had just used:
  `tests/operators.spec.ts:55` expects the seeded template on the first page of
  `inquiryTemplates.list()`. The page holds 25, newest first, and one pass of shard 1 creates 25
  (`POST /inquiry-templates` in `api.log`: 25 before 20:21:40Z, 25 in this run). So a second pass of
  shard 1 on one stack always fails there.

Measured on the clean run above, from `api.log`: one full pass sends 8 codes (5, 1 and 2 by shard)
and creates 45 templates. So a pass fits the budget of 10, with two to spare, and both failures need
a second run on the same stack.

This run's own part in the collisions: at 20:30Z its `e2e:stack:down` queued on the lock behind
another agent's `e2e:stack:up` and took that new stack down, ending that agent's next two runs
(rule 7 treats that as no test failure). From then on this run waited for the other two gates to end
before starting its own.
