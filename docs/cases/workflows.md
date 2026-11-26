# Case workflows

Workflows are documented in [docs/workflows](../workflows/README.md); this page covers what cases add.

## The case trigger and case actions

A case action (`cact_`, `workflows:write`) binds a running workflow whose live version has the `trigger-case` trigger to 1 to 50 case templates, with a `label`, the `header` placement (the only one before Phase 9) and a parameter form: the trigger's `inputs`, each optionally prefilled from `case.fields.<key>`, `inquiry.fields.<key>` or `account.fields.<key>` of the case's first held inquiry or account. Prefills are rendered under the viewer's mask, so a masked field stays empty; the run reads the live value under its own grant.

- `GET /cases/:id/available-actions` (`cases:read` and `workflows:trigger`) lists the actions of the case's template the caller may run, filtered by the caller's grant; a redacted case lists none.
- `POST /cases/:id/run-action` takes `data.case-action-id` and `data.parameters` (personal data, masked in stored logs), validates the parameters, needs the version's grant (403 naming every missing scope) and answers the run. The run's creator is the case action, and its `trigger` is the case.

An event trigger on any `case.*` or `case-comment.*` event works as every event trigger does. A recurring trigger can walk cases (`object-type: case`); its filter is a workflow condition over `trigger`, not the case-search grammar.

## `current_case`

A workflow whose every start is about a case (a `trigger-case`, an event trigger on case or case-comment events only, a recurring or direct trigger over `case`) has `current_case` in scope: the case's flattened view, read live and unmasked when the run starts, because case events carry no field value. `status`, `status-category` and `resolution` are plain; `fields` and attachment filenames are personal data, so the taint rules apply to them. It is `null` when the case is gone.

## The case steps

Each runs through the same services as the routes, inside the step's own transaction, acting as the run (`workflow-run`), exactly once. Their grants are `cases:write` (`assign_case`: `cases:assign`).

| Step | What it does |
|---|---|
| `create_case` | Template, fields, tags, queue, held objects from paths, an SLA in minutes, hours or days. Counts against `case-create`; past it, or when the limiter cannot answer, it retries at 60, 300 and 900 seconds and makes nothing meanwhile. A case a transaction's run makes is that transaction's child. |
| `assign_case` | A user (the manual rule), or a named policy (no change on an assigned case, or when nobody is eligible). |
| `update_case_status` | Status, resolution, comment, status tag, by the version's map. |
| `add_case_comment` | A comment by the run, at most 10,000 characters. |
| `add_case_to_queue` | Sets the queue; its policy assigns on entry. |
| `attach_objects_to_case` | Holds more objects; answers how many were new. |
| `set_case_sla`, `clear_case_sla` | The public deadline. `set_case_sla` refuses a case in a status that pauses the SLA (`action_refused`), because its output names an expiry instant. |

`fetch_object`, `tag_object`, `update_object` and `redact_object` take the `case` type too; a fetched case is its flattened view. A missing case is `object_not_found`, a redacted one `subject_redacted`. A run writing a templated value into a case's fields or a comment records the copy, so redacting the source redacts it (C120.9).

## Decisions from a case

Resolving a case decides nothing by itself. A workflow waits on `case.resolved` (correlated by the case id), reads the resolution and calls the inquiry's own approve or decline step. The decision record then says whether a person took part, at run time: a case resolution counts as a person's step only when a user resolved it (never a key, a run or a bulk job), the case holds the decision's subject (or a report of that inquiry), and the resolver holds `inquiries:write`. Such a decision is not solely automated, and its `human-step` is `case-resolution`.

## Recipes

"Review on report match" (`review-on-report-match`) is installed paused by `seed:dev` and by `POST /workflow-recipes/review-on-report-match/install`: a completion report that matched or errored marks its inquiry for review and opens a case holding the inquiry and the report; when a person resolves the case `Approved` or `Declined`, the run approves or declines the inquiry; a wait that times out after 30 days decides nothing. An errored report is reviewed, never read as "no match". Before publishing, name the case template (the placeholder fails `reference_unknown`), and before production give the decline its `decision-basis` and `contest-route`. Its trigger listens to every completion report of the environment; add a criterion to narrow it. The full-stack suite runs both paths.

## The review request

`POST /inquiries/:id/review-requests` (users with `cases:write`; an API key gets 403) takes `meta.statement` (1 to 10,000 characters, personal data) and opens a case on the template named by the contest route of the inquiry's newest decline, holding the inquiry, with the statement as its first comment by the relaying user. It answers 409 when no decline names a case template, 410 for a redacted inquiry, and counts against `case-create`. A decline's contest route may name a case template (`contest-route.case-template-id`).

## The graph's "create case"

`POST /graph-queries/:id/actions` with `action: create-case`, `case-template-id` and an optional `case-queue-id` (`graph:read` and `cases:write`, an `Idempotency-Key`) creates one case holding the selected accounts (at most 500; redacted and consolidated ones are skipped), with the query's id in its origin, and answers its `case-id` (`null` for a preview or when nothing could be held).
