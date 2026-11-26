# TDD evidence: Workflow 2E console-gaps (C26, C27, C28 F012–F015)

- **Slice owner:** console-gaps (Workflow 2E, Stage 2, in parallel with clients-reason).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/dashboard/**`
  - `e2e/tests/ui-*.spec.ts` except `ui-flow-links.spec.ts`, and `e2e/tests/support/ui.ts`
  - `THIRD_PARTY_LICENSES.md` (unchanged: no dependency was added)
  - this file
- **Input:** `docs/plans/phase-2.plan.md` "Workflow 2E" (C26, C27, C28) and the binding handoff of api-gaps (`docs/tdd/phase2-api-gaps.tdd.md`).

Each slice follows the same cycle:
1. A stub commit (`chore`) when the tests need a name that does not exist yet, so the RED commit compiles and type-checks. The full-stack e2e runs `next build`, which type-checks every dashboard test.
2. The tests, run to see them fail for the intended reason (RED, `test` commit).
3. The smallest change that passes them (GREEN, `feat` or `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd apps/dashboard` is shown. "vitest run … --coverage.enabled=false" stands for `pnpm exec vitest run <files> --coverage.enabled=false` in `apps/dashboard`. Output is trimmed to the lines that matter.

## Slice 1: `/login/mfa` with the C25.1 codes, no attempt counter in the cookie

**Change.** The API now says why it refused a second factor:
- `mfa_code_invalid` keeps the operator on `/login/mfa`;
- `mfa_attempts_exhausted` returns them to `/login?reason=mfa-attempts`;
- `mfa_token_invalid` returns them to `/login?reason=mfa-invalid`, with "That sign-in is no longer valid. Sign in again."

The challenge cookie (`openverify_mfa`, httpOnly, SameSite=Strict, path `/login`, as long as the token) now holds only the token, the factor types and the expiry. The dashboard's attempt counter is gone, so the refusal no longer names the attempts left: "That code is not valid. After five wrong attempts you need to sign in again." The same applies to a refused security key.

A 401 without a known code counts as `token_invalid` (sign-in starts over), and a 400 as `invalid_code`. `POST /sessions/mfa/webauthn/options` refused with 401 also returns to `/login?reason=mfa-invalid`. While the next code is checked, the page hides the previous refusal, so the refusal on screen is always that code's own. The e2e helper relies on this now that every refusal reads the same.

Commits: `0944f16` (stub: widened types), `06c4c76` (RED), `e7e2917` (GREEN).

### RED

```text
$ vitest run src/lib/api/sessions.test.ts src/lib/mfa-challenge.test.ts src/app/actions/auth.test.ts src/components/mfa-login.test.tsx src/app/login/page.test.tsx src/app/login/mfa/page.test.tsx --coverage.enabled=false
     × holds no attempt count: the API counts wrong attempts and says when they ran out (C25.1)
AssertionError: expected [ 'e', 'f', 'n', 't' ] to deeply equal [ 'e', 'f', 't' ]
     × keeps the operator on /login/mfa after a wrong code, and counts nothing itself (C25.1)
AssertionError: expected { error: 'invalid_code', …(1) } to deeply equal { error: 'invalid_code' }
     × returns to sign in with a message when the API says the mfa-token is no longer valid (used, expired or revoked) (C25.1)
Caused by: Error: Expected a redirect, but the call completed
     × maps a 401 with the code mfa_code_invalid to invalid_code (C25.1)
     × explains why the operator is back here (mfa-invalid)
     × takes the previous refusal away while the next code is checked
expected document not to contain element, found <div ... role="alert"
 Test Files  5 failed | 1 passed (6)
      Tests  22 failed | 80 passed (102)
```

### GREEN

```text
$ vitest run (the same six files and src/app/actions/invitations.test.ts) --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  110 passed (110)
```

## Slice 2: `/roles/[id]` through `GET /dashboard/roles/:id` (C25.2)

The page reads one role with `getRole(id)`, which uses `apiRequest` with `roleDocumentSchema`. The API's 404 renders not found through `renderPage`. `findRole`, which searched every page of the list, is removed.

Commits: `b6587fa` (stub), `2a9c4f2` (RED), `11a8280` (GREEN).

```text
RED   $ vitest run src/lib/api/roles.test.ts src/app/roles/page.test.tsx --coverage.enabled=false
Error: Expected GET /dashboard/roles/role_01J9ZK3M5Q7R8S9T0V1W2X3Y62, got GET /dashboard/roles
Error: getRole(role_01J9ZK3M5Q7R8S9T0V1W2X3Y62) is not implemented yet
 Test Files  2 failed (2)
      Tests  7 failed | 21 passed (28)
GREEN $ vitest run src/lib/api/roles.test.ts src/app/roles/ --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  41 passed (41)
```

## Slice 3: C28 F012, F013, F014, F015

| Finding | Fix |
|---|---|
| F012 (WCAG 2.4.3) | Edit note moves focus into the note. Cancel and a successful save move it back to Edit note. Removing a custom-header row moves focus to the name field of the row that takes its place, else the row before it, else Add a header. Focus moves in an effect after the render that removed the control |
| F013 | The JSON editor's `aria-describedby` names the error list as well as its heading, so each error's path and detail are read out |
| F014 (WCAG 2.4.6) | `ConfirmActionButton` takes an `accessibleLabel`. A relation's Remove is named "Remove the spouse relation to acc_…" (or "from acc_…" for an incoming relation), and its dialog is titled the same with a question mark. The name starts with the visible label (WCAG 2.5.3) |
| F015 | `verificationTitles` numbers the verifications of a type by creation time when the inquiry has more than one ("Government ID, attempt 2"). One attempt keeps the plain name, so every existing name and e2e locator is unchanged |

Commits: `fabe804` (RED), `21575c2` (GREEN).

The GREEN commit renamed the relation buttons, which broke one more test that the RED run did not include: the account page test found two buttons named "Remove". `a0f11ea` changed that test to find them by the new names (listed in the report's contract deviations). The whole dashboard suite was run after every later GREEN.

```text
RED   $ vitest run src/components/json-editor.test.tsx src/components/lifecycle/note-editor.test.tsx src/components/integrations/custom-headers-editor.test.tsx src/components/lifecycle/account-relations.test.tsx "src/app/inquiries/[id]/page.test.tsx" --coverage.enabled=false
     × names the API's error details in its description, not only their heading (Workflow 2E F013)
Error: expect(element).toHaveAccessibleDescription()
     × moves focus into the note when editing starts, and back to Edit note on Cancel (WCAG 2.4.3, Workflow 2E F012)
     × returns focus to Edit note once the note is saved (WCAG 2.4.3, Workflow 2E F012)
     × moves focus to a control that remains when a row is removed (WCAG 2.4.3, Workflow 2E F012)
Error: expect(element).toHaveFocus()
     × names each row action and its dialog after the relation it removes (WCAG 2.4.6, Workflow 2E F014)
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Remove the spouse relation to acc_01JB0000000000000000000002"
     × gives retried verifications of one type distinct region names and headings (Workflow 2E F015)
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Government ID, attempt 1"
 Test Files  5 failed (5)
      Tests  6 failed | 62 passed (68)
GREEN $ vitest run (the same files, the verification card, confirm button and webhook form tests) --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  86 passed (86)
```

## Slice 4: the inquiry page (C25.4, C25.7, C26)

What changed on the inquiry page:
- **Details** gains "Template version": the pinned version's id. With `inquiry-templates:read` it links `/templates/<template>/versions/<version>`; for an answer without the relationship it shows an em dash.
- **Timeline:** reads `GET /events?filter[inquiry-id]=` and names the new events:
  - verification events by type, such as "Government ID verification passed" (a redacted event's stub still names its subject);
  - "Session started", "Session expired" and "Session canceled".
  With `verifications:read`, a verification event links its verification page.
- **Verification cards:** each card's ID links `/verifications/<id>`.
- **No resume.** The page offers none: `POST /inquiries/:id/resume` hands a session token to a client integration, and the console hands off with one-time links. The README says so; the UI does not.

Commits: `b246ddd` (stub: the timeline prop), `d54ca19` (RED, including the fixtures for verification and session events and the pinned version), `22b6541` (GREEN).

```text
RED   $ vitest run src/components/lifecycle/inquiry-timeline.test.tsx src/lib/api/inquiries.test.ts src/app/inquiries/ src/app/accounts src/components/lifecycle --coverage.enabled=false
AssertionError: expected { …(3) } to deeply equal { …(3) }            (filter[object-id] sent, filter[inquiry-id] expected)
AssertionError: expected [ 'verification.passed', …(3) ] to deeply equal [ …(4) ]
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "itmplv_01JB0000000000000000000001"
TestingLibraryElementError: Unable to find an element with the text: Template version.
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "ver_01JB0000000000000000000001"
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "Government ID verification passed"
      Tests  8 failed (+1 from F014, fixed in a0f11ea) | 228 passed
GREEN $ vitest run src/components/lifecycle/inquiry-timeline.test.tsx src/lib/api/inquiries.test.ts src/app/inquiries/ src/components/verification-card.test.tsx --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  110 passed (110)
$ (cd apps/dashboard && pnpm exec vitest run --coverage.enabled=false)
 Test Files  166 passed (166)
      Tests  1370 passed (1370)
```

## Slice 5: `/verifications/[id]` (C26)

**The page** (`verifications:read`) reads `GET /verifications/:id`. With `inquiries:read` it also reads the inquiry through the dashboard API, for two things the verification resource lacks: each file's kind, and the inquiry's redaction. It shows:
- the type, status, inquiry, country and ID class, and times;
- every check with its status, requirement, reasons and metadata (as terms and values);
- the files.

**The files:**
- **Images:** shown through the file proxy only with `pii:view` and `inquiries:read`, which `GET /files/:id/content` needs. Otherwise each image shows as "Hidden", and as "Redacted" after a redaction, which an alert also announces.
- **Without `inquiries:read`:** the files are listed by id and the inquiry id is not linked.

**Page states:** loading, error, not found (malformed id without a call, or the API's 404), forbidden (without a call), and a 401 sending the operator to sign in.

Commits: `c28d7b1` (stubs), `ba1f759` (RED), `f3fea04` (GREEN), `e0186de` (refactor: one `VerificationImage` for the card and the page).

Found in GREEN: the checks table's scroll region, captioned "Checks", repeated the section's region name. The caption is "Government ID checks", as on the inquiry page's cards, and the test's expected table name was corrected in the GREEN commit.

```text
RED   $ vitest run src/app/verifications/ --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "heading"
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Checks"   (x2)
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Files"    (x4)
TestingLibraryElementError: Unable to find an accessible element with the role "status" and name "Redacted"
Error: Expected notFound(), but the call completed                                                           (x2)
Caused by: Error: Expected a redirect, but the call completed
 Test Files  1 failed (1)
      Tests  14 failed | 2 passed (16)
GREEN $ vitest run src/app/verifications/ --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  16 passed (16)
REFACTOR $ vitest run src/app/verifications/ src/components/verification-card.test.tsx src/app/inquiries/ --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  114 passed (114)
```

## Slice 6: `/account-types/[id]` with an edit form (C25.3, C26)

**The page** (`accounts:read`) shows the type's fields: key, label and type. With `accounts:write` it adds `AccountTypeEditForm`:
- **Contents:** the name and the whole fields schema in the JSON editor, starting from the current schema.
- **Bound fields:** `EnvironmentField` and the type's id.
- **The action:** `updateAccountType` runs `runAction` with `environmentForm` (Workflow 2D F002). It validates with `updateAccountTypeBodySchema` and sends `PATCH /account-types/:id`; an empty schema text means no fields.
- **The API judges the change:** a removed or retyped key comes back as its 422, which the editor shows at the key's path (`/founded: cannot be removed: accounts may hold values for it`), with the problem's detail announced. A refused name (the seeded `user`) shows at the Name field. What was typed is kept.

**The list:** each type's name links its page. The list no longer says a type cannot be changed.

Commits: `64d4a88` (stubs), `6e6b160` (RED), `6ec0b88` (GREEN, with the name, editor and problem fields shared by the create and edit forms).

```text
RED   $ vitest run src/app/account-types src/components/lifecycle/account-type-form.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "form" and name "Edit the account type"   (x5)
AssertionError: promise rejected "Error: updateAccountType is not implement…" instead of resolving                      (x3)
Error: Expected notFound(), but the call completed                                                                       (x2)
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "business"
TestingLibraryElementError: Unable to find an element with the text: /Open a type to add fields or change their labels/
 Test Files  4 failed | 1 passed (5)
      Tests  20 failed | 22 passed (42)
GREEN $ vitest run src/app/account-types src/components/lifecycle/account-type-form.test.tsx --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  42 passed (42)
```

## Slice 7: `/api-keys` (C25.5, C25.6, C26)

**Expiry in one call.** `createApiKey` sends `expires-in-seconds` with the creation. The second call and its warning are gone (`CreatedApiKey.expiryProblem` removed). The form offers:
- the times it offered before;
- "At a date and time (UTC)", a `datetime-local` field with seconds, turned into seconds from now, rounded up.

A time that has passed, is more than 30 days away, or is not a date answers at the field (`/expires-at`) without calling the API. The token dialog says when the key expires.

**Personal data.** The list gains a "Personal data" column (Masked or Visible), and the key page a "Personal data" detail that explains masking.

**Clone dialog.** It describes a masked key's copy in words true for the operator: `maskedKey`, separate from the operator's own `piiMasked`.

**Rate limit panel.** "Your rate limit" shows the caller's `api` limit from `GET /rate-limits`. When the API cannot tell it (a 503 while the limiter fails open, or no answer), the panel says the limit is not available and the list still renders. A 401 still sends the operator to sign in.

Commits:
- `3524ee0`: stub.
- `8224f23`: RED.
- `583d744`, `e497294`: RED and GREEN for `utcTimestamp` (below).
- `3e31c41`: the type fix in a test (below).
- `8d91ce5`: GREEN for the pages.
- `c5fe3fa`, `046d398`, `9dc618e`: stub, RED and GREEN for the masked-key clone text.

```text
RED   $ vitest run src/app/api-keys src/components/integrations --coverage.enabled=false
Error: Unexpected API request: POST /api/v1/api-keys/key_01J9ZK3M5Q0000000000000063/expire
Error: 1 queued API answer was never used                                    (no GET /rate-limits yet)
TestingLibraryElementError: Unable to find an element with the text: Personal data.        (x2)
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Your rate limit"   (x2)
TestingLibraryElementError: Value "At a date and time (UTC)" not found in options
AssertionError: expected { ok: false, problem: { …(3) } } to match object { ok: false, …(1) }   (x3, /expires-at)
 Test Files  4 failed | 17 passed (21)
      Tests  17 failed | 108 passed (125)
```

**A cycle inside GREEN.** jsdom writes a `datetime-local` value with `step=1` as `12:00:30.000`, and a browser may write the fraction too. The action read it through `utcTimestamp`, which refused a fraction. So `583d744` first added a failing test for `utcTimestamp`; the form test's expectation now accepts either spelling.

```text
RED   $ vitest run src/components/integrations/filter-values.test.ts --coverage.enabled=false
     × takes the fractional seconds a browser may add to a value with seconds
AssertionError: expected undefined to be '2026-10-20T10:05:30.000Z'
GREEN (e497294) $ vitest run src/components/integrations/filter-values.test.ts src/app/api-keys/actions.test.ts src/components/integrations/api-key-form.test.tsx --coverage.enabled=false
      (all pass; the pages' tests still RED until 8d91ce5)
```

**A mistake, fixed.** `583d744` committed a test line that did not type-check: `toHaveValue` was passed a `FormDataEntryValue`. That commit ran vitest but not `tsc`. It was caught by the next `tsc` and fixed in `3e31c41`. In the meantime no e2e or `next build` ran, so no other agent's run was affected. From then on, every commit ran `tsc` and eslint first.

```text
GREEN $ vitest run src/app/api-keys src/components/integrations src/lib/api/api-keys.test.ts --coverage.enabled=false
 Test Files  22 passed (22)
      Tests  133 passed (133)
RED   (masked-key clone) Tests  2 failed | 12 passed (14): expect(element).toHaveTextContent() 'Like this key, the copy cannot see personal data.'
GREEN (masked-key clone) $ vitest run src/components/integrations/api-key-actions.test.tsx src/app/api-keys/ --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  48 passed (48)
```

## Slice 8: `/api-logs` by user (C25.9)

The filter form gains "User ID" (`?user-id=usr_…`). A malformed value is not applied, and the form says why. The filter is kept in the pagination links, and it is sent as `filter[user-id]`. In the table, a dashboard user's id links `/api-logs?user-id=<id>`: the requests made with that user's sessions.

Commits: `5163ee0` (RED), `1a309ae` (GREEN).

```text
RED   $ vitest run src/lib/api/api-logs.test.ts src/app/api-logs --coverage.enabled=false
AssertionError: expected {} to deeply equal { Object (user-id) }
AssertionError: expected { 'page[size]': '25' } to deeply equal { …(2) }
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46"
 Test Files  2 failed | 2 passed (4)
      Tests  3 failed | 22 passed (25)
GREEN $ vitest run src/lib/api/api-logs.test.ts src/app/api-logs --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  25 passed (25)
$ (cd apps/dashboard && pnpm exec vitest run --coverage.enabled=false)
 Test Files  168 passed (168)
      Tests  1421 passed (1421)
```

**Coverage additions (`4fc933c`).** The coverage report showed three branches without a test: a WebAuthn start the API could not answer, a finish without a challenge, and a rate limit read whose session ended. The behaviour was already in place, so these tests passed when written. They are coverage, not RED evidence.

## C27: full-stack UI specs (Chromium, under the e2e lock)

| Spec | Test |
|---|---|
| `ui-console-gaps.spec.ts` (new) | A reviewer edits an account type created through the API. A new field and a changed label are saved, and the API has them. A schema that leaves a field out shows "/legal_name … cannot be removed" in the editor and the API's detail; the type keeps the field and the typed text stays |
| `ui-console-gaps.spec.ts` (new) | An inquiry gets a government ID through the flow API (consent, both sides, submit); the worker runs its checks. On the inquiry page, Details shows the pinned `itmplv_` id. The timeline links "Government ID verification passed" (or failed, as the API says) and "… submitted", and shows "Session started". The link opens the verification page, whose "Government ID checks" table has a row for every check the API returned, and whose front image loads |
| `ui-integrations.spec.ts` | A developer creates a key that expires 30 s later, at a UTC date and time. The dialog says when it expires and the token works. The key page's expiry is within 2 s of the chosen time and reads "Masked: …", and the list labels it Masked. The token answers 401 once the expiry passes: the poll waits for the expiry plus at most 15 s, so the wait is no longer than needed. After a reload the list says Expired |
| `ui-mfa.spec.ts` | A wrong code keeps the seeded MFA admin on `/login/mfa`. The same challenge cookie, copied into a second browser context, signs in there with a valid code, which spends the token and proves it was still usable after the wrong code. A code in the first browser then returns to `/login?reason=mfa-invalid` with its message, and the challenge cookie is gone |
| `ui-navigation.spec.ts` | Account types now open their detail page from the list. The spec's inquiry gets a verification through the flow API, and the verification page is reached from the inquiry page |
| `support/ui.ts` | `submitTotpCode` waits for the server action's answer, then reads the refusal, which the page hid while the code was checked. The old helper told refusals apart by their attempt count, which the page no longer shows. `mfaCodeRefusal` and `submitTotpCode` are exported |

The first test of `ui-mfa.spec.ts` expected "That code is not valid. 4 attempts left."; it now expects the C25.1 wording (listed in the report's contract deviations).

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-console-gaps.spec.ts tests/ui-mfa.spec.ts tests/ui-integrations.spec.ts tests/ui-navigation.spec.ts'
  ✓   1 tests/ui-console-gaps.spec.ts:35:1 › an account type is edited: adding a field works, and removing one shows the API refusal at its path (C25.3) (1.5s)
  ✓   2 tests/ui-console-gaps.spec.ts:83:1 › the inquiry timeline shows its verification and session events, and the verification page its checks (C25.7) (2.7s)
  ✓   5 tests/ui-integrations.spec.ts:204:1 › a developer creates an API key with an expiry, sees it and the masked label, and the token answers 401 once it passed (C25.5, C25.6) (31.6s)
  ✓   7 tests/ui-mfa.spec.ts:71:1 › a wrong code keeps the operator on /login/mfa, and an mfa-token spent elsewhere returns them to sign in (C25.1) (11.9s)
  ✓  10 tests/ui-navigation.spec.ts:48:1 › an admin reaches every C23 page and its detail page from the console navigation (8.2s)
  11 passed (2.1m)
```

## Final gates (foreground, after the last code commit)

```text
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully                         (exit 0)
$ pnpm --filter @openverify/dashboard lint             (exit 0)
$ pnpm --filter @openverify/e2e typecheck && pnpm --filter @openverify/e2e lint   (exit 0)
$ pnpm --filter @openverify/dashboard test
 Test Files  168 passed (168)
      Tests  1424 passed (1424)
All files          |   98.43 |    94.36 |   98.68 |   98.45 |
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e              (exit 0, 3 min 8 s)
@openverify/flow:e2e:   25 passed (7.5s)
@openverify/e2e:e2e:   39 passed (3.1m)
 Tasks:    9 successful, 9 total
```

The 39 full-stack tests include the 5 new or extended tests above and clients-reason's new `ui-flow-links.spec.ts` test (C25.8). None is skipped or marked as an expected failure.
