# Cases

A case is a unit of review work: it holds the objects a person must look at (inquiries, accounts, reports, report runs, transactions, verifications, documents, graph queries), carries fields, tags, comments and attachments, moves through the statuses of its template, and is assigned, timed and resolved. Cases are environment-scoped, like every other object.

Workflow 8B built the API, the worker jobs and the workflow steps; the console pages come with Workflow 8C. Every route is in the OpenAPI document (`docs/api/openapi.json`) and in `@openverify/node` (`cases`, `caseTemplates`, `caseTemplateVersions`, `caseComments`, `caseActions`, `caseQueues`, `caseAssignmentPolicies`, `caseSlaPolicies`, `caseCalendars`, `caseExports`).

| Page | What it covers |
|---|---|
| [Templates and statuses](templates.md) | Templates, immutable versions, field schemas, statuses, transitions, resolutions, the history |
| [Queues and assignment](queues.md) | Queues, members, assignment policies and strategies, "next case", the re-assignment sweep |
| [SLA and calendars](sla.md) | Public deadlines, SLA policies, business calendars, holidays, pauses, firing |
| [Comments and notifications](comments.md) | Append-only comments, mentions, redaction of a comment, in-app notifications |
| [Attachments and scanning](attachments.md) | Uploads, renditions, the scanner port, what is served |
| [Search, bulk, export and print](export.md) | `POST /cases/search`, bulk actions, exports, print |
| [Redaction and retention](redaction.md) | What redacting a case removes and keeps, retention, held objects |
| [Case workflows](workflows.md) | Case actions, the case trigger, `current_case`, the case steps, the review recipe, the review request |

## Identifiers

`case_`, `ctmpl_` (template), `ctmplv_` (template version), `cqueue_`, `cscm_` (comment), `cap_` (assignment policy), `catt_` (attachment), `cact_` (case action), `cslap_` (SLA policy), `ccal_` (calendar), `cexp_` (export), `cblk_` (bulk action) and `unot_` (notification). Actors are always OpenVerify ids (`usr_`, `key_`, `wfr_`, `cap_`), never email addresses.

## Scopes

| Scope | Grants |
|---|---|
| `cases:read` | Read cases, their comments, history, held objects and attachments' metadata |
| `cases:write` | Create, edit fields, tags, held objects, comments, attachments, set the status (resolving included), bulk changes, assign oneself, `POST /cases/next` |
| `cases:assign` | Assign anyone else, bulk assign |
| `cases:redact` | Redact a case or anyone's comment; read an attachment's sealed original |
| `cases:export` | Exports (each download re-checks it) |
| `case-templates:read`, `:write`, `:publish` | Templates and versions |
| `case-queues:read`, `:write` | Queues, members, assignment and SLA policies, calendars |

Built-in roles: `admin` holds all; `developer` all but `cases:export`; `reviewer` `cases:read`, `cases:write`, `cases:assign`, `case-templates:read` and `case-queues:read`; `viewer` the three reads. Field values, comment messages and attachment content also need `pii:view` (users) or a key that can view PII.

## Reading a case

`GET /cases/:id` names each held kind's newest 50 in its relationships, with `held-object-counts` for the totals, and `GET /cases/:id/objects` pages them all. `?include=` adds `case-template`, `case-comments` (the newest 50), `case-queue` and each held kind (`accounts`, `inquiries`, `reports`, `verifications`, `txns`, `report-runs`, `graph-queries`), each resource as its own route serves it to the caller, masked the same. A kind needs its own route's read scope beside `cases:read` (`case-queues:read`, `accounts:read`, `inquiries:read`, `reports:read` for reports and their runs, `verifications:read`, `transactions:read`, `graph:read`); without it the kind is left out, never refused, because holding an object grants nothing. `GET /cases` and `POST /cases/search` read a page's held objects, comments and attachments in a fixed number of queries.

## Template visibility

A template's `visible-to-roles` narrows who sees its cases. An empty list means every role with `cases:read`. A user sees a restricted template's cases only through a listed role; an API key only when the key was minted with that template in its `case-template-ids` (set at minting, never wider than what the minting user sees, at most 100 ids; a clone copies it). The system (retention, a workflow run's own reads) sees every template.

Every exit applies it: the case routes, search, exports, `POST /cases/next`, bulk actions, `GET /events` and `GET /events/:id`, stored API logs, workflow runs and steps whose subjects include such a case, and notifications. Webhooks still receive these events: a webhook is a system exit an operator configures. `GET /workflow-trigger-deliveries` is not filtered, because a delivery names an event, a workflow and a run, never a case, and the run is filtered at its own route.

## Events

`case.created`, `case.assigned`, `case.resolved`, `case.reopened`, `case.status-updated`, `case.queue-updated`, `case.updated-fields`, `case.updated-tags`, `case.sla-expired`, `case.exported`, `case.redacted`, `case.updated`, `case.print-initiated`, `case-comment.created` and `case-template.deleted-field`. No case event carries a field value, a comment message or an attachment filename: `fields`, `message` and `attachments[].filename` are `null` in every payload. A webhook filter `case-template-ids` matches a case or a comment by its case's template; an `inquiry-template-ids` filter matches a case only when **every** inquiry it holds has a listed template, so a case holding no inquiry fails a present inquiry-template filter.

Not emitted: `case.agent-reviewed` (no review agent), `case-message.*` (no email module), `case-template.converted-field` (a field's type never changes), `user-notification.*` and `user.availability-updated` (notifications are console-only, and availability is deferred).

## Rate limits

| Policy | Limit | When the limiter cannot answer |
|---|---|---|
| `case-search` | 120 a minute per principal | Through (C12) |
| `case-create` | 600 an hour per environment, shared by `POST /cases`, the review request, the graph bulk action and `create_case` | Through for API callers; a `create_case` step defers (60, 300, 900 s) and never fails open |
| `case-exports` | 10 an hour per environment | Through |
| `case-attachments` | 60 a minute per principal | Through |

## Problems

The case problem codes and their statuses are in `packages/contracts/src/problem.ts` (`CASE_PROBLEM_STATUSES`), each with a golden problem in `contracts/fixtures/problems/cases/`. `object_already_attached` is reserved: attaching an object twice is a `no_change`, so no route raises it. A scan that ended in `error` answers a plain 409 with no code. No problem carries a field value, a comment, a filename or an address.
