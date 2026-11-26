# TDD evidence: console-ops (Workflow 8D Stage 1)

Agent `console-ops`, Workflow 8D Stage 1. Every command ran after `source scripts/env.sh`, from the
repository root unless it says otherwise. Output is abbreviated to the lines that matter; the load
average (`/proc/loadavg`) is beside every timing-sensitive run.

## Slice 0: the reviewer forms test made deterministic (8C fixer blocker)

The 8C API fixer's forced non-API gate failed at a load of up to 17.9 on two tests of
`apps/dashboard/src/components/cases/reviewer/forms.test.tsx`: `AssignmentControl` ("assigns to
oneself, to a member with cases:assign, and unassigns") and `SlaForm` ("sets a deadline and clears
it", `Unable to find ... "Clear SLA"`), while the file alone passed.

**Cause.** `useFormAction` (`components/use-form-action.ts`) runs `onSuccess` inside the action, so
the success toast is shown before React ends the action's transition. Until that transition
commits, every form of the control shares `pending: true`, and each `SubmitButton` reads its
pending label ("Unassigning…", "Clearing…") and is disabled. Both tests read the toast as "the
action is done" and then looked the next button up by its idle name at once. On an idle machine the
transition commits in the same scheduler task; under load React's scheduler yields inside it, and
the lookup lands in the window. Nothing the user did is dropped: the button is disabled while the
action runs and enabled after, so the product is right and the test's assumption is wrong.

**RED (seen failing under load, no code changed).** A scratchpad script started 36 busy loops
(12 CPUs), and the file ran five times:

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/cases/reviewer/forms.test.tsx --coverage.enabled=false
load 1.53  run 1 rc=1  FAIL AssignmentControl > assigns to oneself, ... and unassigns
                       TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Unassign"
                       Name "Assigning…" (disabled) ... Name "Unassigning…" (disabled)
load 24.60 run 2 rc=1  (the same)
load 34.33 run 3 rc=1  (the same)
load 40.22 run 4 rc=1  (the same)
load 43.23 run 5 rc=0  15 passed
```

The rendered tree in the failure shows the cause: every button of the control holds its pending
label and `disabled=""` while the toast is already on screen.

**Fix.** The test waits for what it acts on: `idleButton(name)` finds the submit button by its idle
name (`findByRole`, which appears only once `pending` is false) and asserts it is enabled; the two
lookups after a toast use it. No retry, no longer timeout, no skip.

**GREEN under the same load.**

```
load 33.43 run 1 rc=0  15 passed
load 39.67 run 2 rc=0  15 passed
load 43.07 run 3 rc=0  15 passed
load 44.49 run 4 rc=0  15 passed
load 45.12 run 5 rc=0  15 passed
load 45.80 run 6 rc=0  15 passed
```

## Slice 1: the workflow page (C141.5, C141.6)

Promote (C112.2), the cancel of older versions' runs (C116.2), the runs filters of
`listWorkflowRunsQuerySchema` (status, version, subject id, step errors), a cursor per list
(`versions-after`, `runs-after`, `deliveries-after`, 8C Stage 1 amendment 13) and each version's
grant and egress marks (C121.2, C121.4).

Stub `c5f2c762` (`promoteWorkflow`, `cancelOlderRuns` answering "Not built yet"), RED `27300763`.

**RED.**

```
$ pnpm exec vitest run 'src/app/workflows/[id]/page.test.tsx' src/app/workflows/actions.test.ts --coverage.enabled=false
 × copies the live version into the target environment as a draft, under workflows:publish
 × cancels the unfinished runs of versions older than the one named, answering the count
 × offers promoting the live version to another environment, saying it never replaces a draft or publishes
 × offers cancelling the runs of older versions with workflow-runs:write, saying effects stay made
 × filters the runs by status, version, subject and step errors from the URL
 × sends no filter value that is not well formed, and says it left it out
 × pages versions, runs and deliveries each by a cursor of its own, keeping the others in place
 × shows each version's grant and its egress marks in words
 × says a draft has no grant yet and a version with no egress sends none
 Tests  9 failed | 52 passed (61)
```

The two refusal tests of each action passed on the stub, which calls no API either; they stand
as guards.

**GREEN.** `promoteWorkflow` and `cancelOlderRuns` in `app/workflows/actions.ts`;
`components/workflows/workflow-operations.tsx` (both buttons behind `ConfirmActionButton`, the
words saying a promote makes a draft, never replaces one and never publishes, and that a cancel
leaves effects made); `run-filters.tsx` (each value checked by the contract's schema, a polite
status naming what was left out); `version-marks.tsx`; the page reads each cursor with
`parseCursor` and each list's `Pagination` keeps the others' cursors and the filters.

```
 Tests  61 passed (61)
$ pnpm exec eslint <the seven files>          lint=0
$ pnpm exec tsc --noEmit -p tsconfig.json     no error in these files (the only errors were in
                                              console-editor's uncommitted editor/document-model.ts)
```

Choices (contract deviations in the report): promote offers the other environments of
`meta.environments`, and is hidden during a rollout, without a live version, or without
`workflows:publish`; the cancel offers only published versions that have an older published version
listed; a filter value that is not well formed is left out and said, never sent.

## Slice 6 (landed early for console-editor's palette): decision templates (C128.5)

`apps/dashboard/src/components/workflows/decision-templates.ts`, a pure module. Exports:
`DECISION_TEMPLATE_KEYS` (`review-completed-inquiry`, `review-failed-inquiry`,
`review-report-match`), `DecisionTemplateKey`, `DecisionTemplate { key, name, description }`,
`DECISION_TEMPLATES`, `DecisionTemplateOptions { caseTemplateId?, decisionBasis?, contestRoute?,
biometricBasis? }`, `CASE_TEMPLATE_PLACEHOLDER` and `decisionTemplateDefinition(key, options)`.

Stub `a8ba248d`, RED `1377fa4c`:

```
$ pnpm exec vitest run src/components/workflows/decision-templates.test.ts --coverage.enabled=false
 × names each template in words, one per key
 × review-completed-inquiry is a valid definition by the contract   (and the other two keys)
 × ... marks the inquiry for review, then opens a case holding it, before anything else
 × ... declines only after a person resolved the case: no path reaches a decline without the wait
 × ... routes on the resolution with on-null on every route, and leaves an undecided case in review
 × puts the decision basis, contest route and biometric basis the operator gave on every decline
 × leaves the basis and route unset, and the case template a placeholder, when none was given
 × never approves a failed inquiry: that template only declines or leaves it in review
 × listens to the events its name says
 Tests  17 failed (17)            (the stub throws "not built yet" and lists no template)
```

**GREEN.** Each template is the "Review on report match" recipe's shape (C140.5): mark the inquiry
for review, open a case holding it, wait for `case.resolved` (30 days, continue on timeout), read
the case, route on the resolution with `on-null: skip-route`, approve or decline, `else` to the
output. The failed-inquiry template has no approve (C127.1: an approve from `inquiry.failed` needs
`override-failed`).

```
 Tests  17 passed (17)        eslint rc=0
```

**The draft check accepts every template.** A scratchpad script ran the engine's own check
(`checkDefinition` from `@openverify/workflow-engine` with the API's `WORKFLOW_ACTIONS` registry, as
`apps/api/src/workflows/recipes/recipes.test.ts` does) on each template, bare and filled, in `draft`
and `publish` mode:

```
$ (cd apps/api && NODE_OPTIONS='--conditions=@openverify/source' pnpm exec tsx <scratchpad>/check-templates.ts)
review-completed-inquiry bare draft errors: [] warnings: ["output_unread","output_unread","output_unread"]
... (all twelve lines) errors: []
rc=0
```

The warnings are the unread outputs of the decision steps, as the recipe has.

## Slice 2: the sandbox test-run panel and the Evaluate Code test (C120.7, C126.4, C141.9)

URL (in stub commit `7f431125`'s message, for console-editor's "Test this step"):
`/workflows/<wfl_id>/test-runs?start-step=<node id>&end-step=<node id>`, optional
`version-id=<wfv_id>` (the draft when left out); `run=<wfr_id>` shows a started run. A range of one
`evaluate_code` step is that step's test.

Stubs `7f431125` and `4fffce12`, RED `31e98253`:

```
$ pnpm exec vitest run 'src/app/workflows/[id]/test-runs/page.test.tsx' src/app/workflows/actions.test.ts src/components/workflows/recorded-messages.test.tsx --coverage.enabled=false
 × posts the kind and recipient with the run, and lists what was recorded in words
 × says a withheld body is hidden without pii:view, never empty
 × says when the run recorded nothing for that recipient
 × starts a test run on an object with its step range, overrides, hosts and acknowledgements
 × starts one on the draft from a synthetic payload, sending nothing left empty
 × refuses a payload or overrides that are not JSON at their pointers, without calling the API
 × says in words that a production environment runs no test run
 × searches by the recipient in the body and answers only this run’s records, bodies with pii:view
 × withholds every body without pii:view, keeping the origin
 × searches Slack records by the secret id, and refuses a malformed one without calling the API
 × says in words that test runs are for sandbox environments, and offers no form in production
 × offers the version, the trigger object, the step range, overrides, hosts and acknowledgements
 × takes the step range from the URL, so a step can be tested alone
 × shows a started run: its link, each step with its output, and the console lines
 × offers searching the messages the run recorded with sandbox:read, by a form that keeps the recipient out of the URL
 × carries no step value or console line into the page without pii:view
 × carries the values the API served into the page with pii:view, so the test above can fail
 × needs workflows:trigger
 Tests  18 failed | 39 passed (57)
```

Two corrections inside the GREEN commit, both in the RED test file: the panel's sandbox-only notice
is an informational `Alert`, whose role is `status`, so the test reads `status` (it had `alert`);
and the RED file did not typecheck (`environment = SANDBOX` inferred the literal kind `sandbox`, so
the production call was a type error), which `tsc` found after the RED commit; the parameter is now
typed with both kinds. Rule 5's "a RED test must typecheck" was missed for `31e98253`, recorded
here.

**GREEN.** `startTestRun` (`createWorkflowTestRunBodySchema`; JSON failures named at
`/data/attributes/trigger-payload` and `/overrides`; the API's `test_runs_sandbox_only` said in
words), `searchRecordedMessages` (`sandbox:read`; the recipient in the body; only this run's
records; subject and text only with `pii:view`), `components/workflows/test-run-form.tsx`,
`recorded-messages.tsx` (a form post, never a URL; "Recorded (sandbox)"), and the page
(`workflows:read` and `workflows:trigger`; production says "Sandbox only" and offers no form;
acknowledgement boxes from the catalogue: `irreversible:<step>` for a redaction or an adverse step,
`egress:<step>` for an egress step; step input, output and console as served, through `RunValue`).

```
 Tests  57 passed (57)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 3: manual runs from ids or a CSV, and the test-run link (C118.5, C141.7)

Stub `eeba1cdb`, RED `899502ba`:

```
$ pnpm exec vitest run 'src/app/workflows/[id]/page.test.tsx' src/app/workflows/actions.test.ts src/components/workflows/manual-runs.test.tsx --coverage.enabled=false
 × sends the ids typed, then links each run started and says each refusal by row and code
 × offers a CSV of ids instead, with one object-id column
 × starts one run per id, read from lines, spaces or commas, and answers runs and refusals
 × sends a CSV file as text
 × refuses a token that is not an id by its position, never echoing it, without calling the API
 × offers manual runs of the live version with workflows:trigger
 × links the sandbox test-run panel with workflows:trigger in a sandbox environment
 Tests  7 failed | 72 passed (79)          tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `startManualRuns` (ids split on lines, spaces or commas, each checked by `anyIdSchema`
and refused at `/data/attributes/object-ids/<i>` without echoing it; a CSV file sent as text;
`createWorkflowManualRunsBodySchema`), `components/workflows/manual-runs.tsx` (runs linked, each
refusal "`<id or Row n>`: words (code)", a polite count), the workflow page's "Manual runs" section
(`workflows:trigger` and a live version) and its "Test run" link (`workflows:trigger` in a sandbox
environment). One correction to the RED test inside GREEN: `getByLabelText(/CSV file/)` also
matched the radio "A CSV file of ids", so it reads the exact label `'CSV file'`.

```
 Tests  79 passed (79)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 4: a secret's description, hosts and placements (C125.2)

Stub `7377e16a`, RED `91db506f`:

```
$ pnpm exec vitest run src/app/secrets src/components/workflows/secret-forms.test.tsx --coverage.enabled=false
 × changes the description, the hosts and the placements by PATCH, never a value
 × clears the description when it is emptied
 × refuses a host or a placement the contract refuses, by its pointer, without calling the API
 × passes on the API’s refusal by pointer, as it refuses
 × edits the description, hosts and placements in a dialog, prefilled, and never asks for a value
 × shows a refused host by its pointer in the edit dialog
 × shows where each value may go, and offers editing a key with secrets:write (C125.2)
 Tests  7 failed | 18 passed (25)        tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `updateSecret` (`updateWorkflowSecretBodySchema`, an emptied description sent as
`null`, hosts and placements one per line), `EditSecretButton` (a `FormDialogButton` with no value
control; each refusal shown at its list by position, "Host 1: …", never by value; the words say a
production value needs a production user session), the secrets table's "May stand in" column and
row "Edit" with `secrets:write`.

```
 Tests  25 passed (25)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 5: the C143.7 workflow settings in the settings form

Stub `1a1273c4`, RED `f9763814`:

```
$ pnpm exec vitest run src/app/settings/actions-workflow.test.ts src/components/operators/settings-form-workflow.test.tsx --coverage.enabled=false
 × sends a changed window, cap and case retention, an empty case retention as null
 × sends a list typed one entry per line only when it changed, compared by value
 × turns the host allowlist on with its hosts, and off as null; the SMS countries likewise
 × refuses a port that is not a whole number by its pointer, without saving
 × refuses a host the contract refuses by its pointer, without saving
 × sends the private CIDRs with settings:privacy
 × never posts the private CIDRs for a principal without settings:privacy, even if sent
 × shows each workflow setting with its current value, lists one entry per line
 × shows the private networks read-only without settings:privacy, and posts nothing for them
 Tests  9 failed | 3 passed (12)          tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `WORKFLOW_NUMBER_FIELDS` and `WORKFLOW_LIST_FIELDS` in `settings-fields.ts` (ranges from
the contract's `WORKFLOW_*` bounds and `WORKFLOW_SETTING_LIMITS`), `workflow-settings-fields.tsx`
(the "Workflows in <environment>" fieldset; each setting only when the server reports it; the host
allowlist and SMS countries each with a box and a `-shown` marker, unticked meaning `null`; the
private networks read-only without `settings:privacy`), and `workflowSettingsOf` in
`app/settings/actions.ts` (numbers checked against their range, ports as whole numbers by entry
pointer, other entries by the contract's schema when the body is parsed, the private networks
dropped without `settings:privacy` whatever was posted; `sameValue` sends a list only when it
changed).

```
$ pnpm exec vitest run src/app/settings src/components/operators --coverage.enabled=false
 Tests  154 passed (154)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 6 (rest): "Start from a template" in the create form (C128.5)

RED `d4ecfd6a`:

```
$ pnpm exec vitest run src/app/workflows/actions.test.ts src/components/workflows/create-workflow-form.test.tsx --coverage.enabled=false
 × offers an empty draft or each review-first template, asking for the basis and route only with a template
 × saves the template as the new workflow’s draft, with the basis and route given, and never publishes
 × refuses an unknown template, basis or a contest URL that is not https, without creating anything
 Tests  3 failed | 49 passed (52)          tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `createWorkflow` reads the template and its values first (`decisionBasisSchema`,
`contestRouteSchema`, `biometricBasisSchema`, `idSchema('ctmpl')`, each refused at its own pointer
before anything is created), creates the workflow, reads its draft's lock version and saves the
template's definition there; it never calls publish. The form's "Start from a template" lists an
empty draft and `DECISION_TEMPLATES`, and asks for the case template, decision basis, contest route
URL and contact and biometric basis only with a template, saying a template makes a draft and
nothing is published.

```
$ pnpm exec vitest run src/app/workflows/actions.test.ts src/components/workflows/create-workflow-form.test.tsx src/app/workflows/page.test.tsx --coverage.enabled=false
 Tests  59 passed (59)        eslint rc=0        tsc --noEmit rc=0
```

(The same run over all of `src/app/workflows src/components/workflows` showed failures only in
console-editor's files under change: `draft/page.test.tsx`, `draft-editor*.test.tsx`,
`editor/workflow-canvas.test.tsx`.)

## Slice 7: Trust Device on the Phase 7 device view (C127.9)

Stub `0829ac54`, RED `c88f0ca5`:

```
$ pnpm exec vitest run src/app/devices src/components/signals/device-trust.test.tsx src/components/lifecycle/inquiry-sessions-trust.test.tsx --coverage.enabled=false
 × trusts the device with its reason code under devices:write, refreshing the inquiry
 × clears the mark with untrust
 × refuses a reason that is not a snake_case code at its pointer, never echoing it
 × says an untrusted device is not trusted, and that the mark changes no check or signal
 × shows when, by whom and why a device was trusted, a run linking its page
 × trusts a device with a reason code, with devices:write
 × clears the mark of a trusted device
 × shows the trust mark on every recorded device, and the control with devices:write
 × offers no control without devices:write
 Tests  9 failed | 1 passed          tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `app/devices/actions.ts` `setDeviceTrust` (`devices:write`; `meta { trust-reason }` held
to `deviceTrustReasonSchema`, refused at `/meta/trust-reason` without echoing it, or
`meta { untrust: true }`; refreshes the inquiry page), `components/signals/device-trust.tsx` (the
"Trust" detail: "Trusted for <code> at <time> by <actor>", a run linking `/workflows/runs/<id>`, or
"Not trusted", always with "Trusting a device changes no check and no signal: only a workflow
condition can read the mark."; the trust form or "Remove the trust mark" with `devices:write`, no
confirmation since both are reversible and audited), threaded as optional props through
`SessionDevice`, `InquirySessions` and `InquiryView` (`abilities.devicesWrite`,
`actions.trustDevice`), so Phase 7's literals stand.

```
$ pnpm exec vitest run src/app/devices src/components/signals src/components/lifecycle src/app/inquiries src/components/cases/reviewer --coverage.enabled=false
 Tests  365 passed (365)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 8: the webhook form's filter fields (C143.4)

Stub `643db6f0` (the optional `workflowIds`, `caseTemplateIds` and `listIds` of
`WebhookFormDefaults`, because the RED test did not typecheck without them), RED `83e4a740`:

```
$ pnpm exec vitest run src/components/integrations/webhook-form-phase8.test.tsx src/lib/api/webhooks.test.ts --coverage.enabled=false
 × reads the workflow, case template and list filters, separated by commas or spaces
 × shows each refusal at its filter, by the API’s pointer
 × starts an edit from the stored filters
 Tests  3 failed | 12 passed (15)        tsc --noEmit rc=0 after the stub
```

**GREEN.** `webhookAttributesFromForm` reads `workflow-ids`, `case-template-ids` and `list-ids`
(sent only when not empty, as the older keys are); the form's three fields with their errors under
`/data/attributes/filters/<key>` (`errorsUnder`), so the contract's and the API's refusals by
JSON Pointer show at their field; the edit page starts from the stored filters.

```
$ pnpm exec vitest run src/components/integrations src/lib/api/webhooks.test.ts src/app/webhooks --coverage.enabled=false
 Tests  158 passed (158)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 9: a list's purpose, a transaction type's adverse statuses, both types' contest routes

Stub `c20b3ded`, RED `31388c42`:

```
$ pnpm exec vitest run src/app/transaction-types src/app/account-types src/app/lists --coverage.enabled=false
 × says when no contest route is declared, and offers one in the edit form
 × lists the adverse statuses and the contest route in words, with a form to change them
 × says the purpose in words, and that adding to a block list is an adverse step
 × sets the adverse statuses and the contest route by PATCH
 × sends no adverse status and no contest route as an empty list and null
 × refuses a contest URL that is not https at its pointer, without calling the API
 × sends the contest route the form shows, or null when both are empty
 × sends the purpose the form posts
 Tests  8 failed | 105 passed (113)        tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `lib/contest-route-form.ts` (`contestRouteFromForm`: URL and contact through
`contestRouteSchema`, both empty is `null`, a refusal at `<pointer>/url`), and
`components/workflows/contest-route.tsx` (`ContestRouteWords`, the host first, "Not declared"
for none; `ContestRouteFields`). A list: "Purpose" in words (`LIST_PURPOSE_WORDS`: a block list's
add is an adverse step) and a select in the settings form, sent by `updateList`. An account type:
"Contest route" in its details and in its edit form, sent only beside `contest-route-shown`. A
transaction type: "Adverse statuses" and "Contest route" in its details and a "Decisions" form
(`TypeDecisionsForm`, one box per status of the newest version) posting
`setTransactionTypeDecisions` (`PATCH` with `adverse-statuses` and `contest-route`).

```
$ pnpm exec vitest run src/app/transaction-types src/app/account-types src/app/lists src/components/lists src/components/lifecycle src/components/transaction-types --coverage.enabled=false
 Tests  319 passed (319)        eslint rc=0        tsc --noEmit rc=0
```

## Slice 10: binding account actions and case actions (C118.7, C140.1, C141.7)

Stub `e5bb524c`, RED `99e04a38`:

```
$ pnpm exec vitest run src/app/workflows/binding-actions.test.ts --coverage.enabled=false
 × binds a running workflow to an account type with a label and its prefill, answering the action
 × changes the label, the prefill and the status
 × refuses an empty label at its pointer, and needs workflows:write
 × binds a running workflow to case templates with a label and its prefill
 × changes the templates, the label and the status
 Tests  5 failed (5)        tsc --noEmit rc=0 on the RED tree
```

**GREEN.** `app/workflows/binding-actions.ts` (`createAccountAction`, `updateAccountAction`,
`createCaseAction`, `updateCaseAction`, under `workflows:write`, through the contract's create and
update bodies; the prefill is each `prefill.<input>` control with a path, never a value),
`components/workflows/action-bindings.tsx` (`CreateBindingForm`, `EditBindingForm`: label, status,
case templates, and one prefill path per input of the bound workflow's live trigger),
`components/workflows/binding-pages.tsx`, and the routes `/account-actions`,
`/account-actions/[id]`, `/case-actions`, `/case-actions/[id]` (each with the console layout).

TDD gap (rule 1), recorded: the four pages' tests (`app/account-actions/page.test.tsx`,
`app/case-actions/page.test.tsx`) were written after the pages and passed at once; the actions
they post were RED first. No later slice cites them as RED evidence.

```
$ pnpm exec vitest run src/app/workflows/binding-actions.test.ts src/app/account-actions src/app/case-actions --coverage.enabled=false
 Tests  10 passed        eslint rc=0        tsc --noEmit rc=0
```

The workflows page links both binding lists with `workflows:write` (RED `45be57ce`:
`× links the account and case action bindings with workflows:write`, 1 failed | 7 passed; GREEN:
8 passed). The navigation is not changed, so its 27 links and their tests stand.

## Slice 1 follow-up: cancel older runs with archived versions (C116.2)

Found while writing the full-stack spec: a full publish archives the previous version, and the
public version list never holds archived versions, so a workflow at version 2 listed only version 2
and the cancel offered nothing. RED `test(dashboard): cancel older runs offers a live version…`:
`× offers the live version 2 even when version 1 is archived and so not listed` (1 failed | 28
passed). GREEN: every published version after version 1 is offered (29 passed).

## Slice 12: the full-stack spec `e2e/tests/ui-workflow-ops.spec.ts`

Five serial tests (budget 90 s, stated in the header), each making its own objects and ending them
in `finally`, with axe (platform-carry's `expectNoAxeViolations`, landed in `17526b3b`) on every
page opened: manual runs from ids (one started, one refused) then a cancel of the older version's
runs (the held run ends `canceled`); the sandbox test-run panel on a Slack draft (the run linked,
its message found by the secret's id, "Recorded (sandbox)"); a secret's hosts edited; a workflow
setting saved and restored; a webhook's edit form showing its workflow filter. Trust Device has no
step: a device exists only for a flow session with device recognition on, which is off by default
(its unit tests stand).

The spec found two things. A full publish archives the earlier version and the version list never
holds archived ones, so the cancel offered nothing (fixed test-first above). And a sandbox
record's `step-id` is the step run's `wfst_` id, not the node id, which the first run expected:

```
$ flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/ui-workflow-ops.spec.ts; rc=\$?; pnpm --filter @openverify/e2e e2e:stack:down; exit \$rc"
load 16.28 → 26.23, 01:45:01 → 01:51:57
  ✓ manual runs from ids, then a cancel of the older version’s runs (17.6s)
  ✘ the sandbox test-run panel … — expected "notify", the table held "wfst_01M6J41NYVKF2HYGAMZDG00N9Z Recorded (sandbox) … Hidden without pii:view"
rc=1
```

The spec now expects a `wfst_` id. The same one-call sequence:

```
load 25.77 → 23.37, 01:52:12 → 01:55:19 (3 min 7 s, stack down, build, up, spec, down)
  ✓ manual runs from ids, then a cancel of the older version’s runs (9.0s)
  ✓ the sandbox test-run panel links its run and finds the Slack message it recorded (14.9s)
  ✓ a secret’s allowed hosts are edited, and no value is asked for or shown (8.9s)
  ✓ an admin saves a workflow setting and restores it (9.6s)
  ✓ a webhook’s edit form shows its workflow filter (8.8s)
  5 passed (57.0s)
rc=0
```

(The developer holds no `pii:view`, so the record's subject and text read "Hidden without
pii:view", as the console withholds them.)

## Final gates (console-ops, Workflow 8D Stage 1)

Each exit code read from the command itself, its output sent to a file:

```
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e
  01:55:43 → 01:59:09 UTC, load 23.5        Tasks: 4 successful, 4 total        rc=0
$ pnpm --filter @openverify/dashboard test        (typecheck and lint ran in the gate above)
  first run 01:59 → 02:08: rc=1, 5 failures, all in console-editor's committed RED
  workflow-words.test.ts (its GREEN 881edc03 landed after); re-run:
  02:12:23 → 02:21:05 UTC, load 15.4 → 21.1
  Test Files 410 passed (410)    Tests 5487 passed (5487)
  All files  95.46 % statements | 88.09 % branches | 95.64 % functions | 95.48 % lines    rc=0
$ pnpm exec prettier --check --ignore-unknown <every tracked file in console-ops' paths>   rc=0
$ pnpm format:check     rc=1 only on other agents' uncommitted files (console-editor's
  editor/condition-model.ts, schema-form-model.ts, trigger-paths.ts; packages/db
  case-exports.ts); see the report
$ the one-call full-stack sequence of ui-workflow-ops.spec.ts (slice 12)    5 passed (57.0 s)  rc=0
```
