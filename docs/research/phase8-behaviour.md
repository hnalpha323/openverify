# Phase 8 research: how Persona workflows and cases behave (clean-room notes)

Prepared 2026-10-27 for OpenVerify Phase 8 ("Workflows and cases", `docs/PLAN.md` §6 Phase 8 and the Cases and Workflows rows
of §2 [R1]): a durable workflow engine with every public trigger and step type, the action library (with Evaluate Code in
QuickJS and an SSRF-safe HTTPS request), an @xyflow/react editor, and cases with templates, queues, assignment, statuses, SLA
timers and events, comments, attachments, tags, redaction, export and print, and a reviewer UI.

Everything below is written in our own words. Field names, enum values, event names, step and action type names,
configuration keys and URL paths are reproduced only because they are short identifiers needed for functional parity; the
vendor's display names of steps are used only as identifiers. No sentences, UI copy or help text are copied. Anything the
public sources do not state is marked **not documented**; statements we infer, and that no source states, are marked
**(inference)**. Every citation key (`[O5]`, `[H22]`, `[C9]`, ...) is defined in "Sources and pins" with its full URL; every
source was read on 2026-10-27. Example people, emails and ids in the vendor's material are not reproduced; this note uses
`example.com` and fictional values. OpenVerify is not affiliated with Persona.

"OpenVerify today" means the working tree at `3b4ef08`, read on 2026-10-27, with Phase 6 being built by other agents: no
workflow, run, case, queue or comment resource exists, and `packages/workflow-engine` (PLAN §3) has not been created [R1] [R5]
[R6].

---

## Summary

1. **Eight trigger types.** The version attribute `trigger-type` takes `trigger-event`, `trigger-api`, `trigger-schedule`,
   `trigger-recurring`, `trigger-direct`, `trigger-account`, `trigger-case`, `trigger-verification` [O2] [D1]. Event triggers
   take any event name with criteria such as `trigger.template.token`; API triggers take `data.attributes.fields` against the
   version's `inputs`, with files as `{filename, data}` since 2026-10-27; scheduled runs come from another run's Schedule
   Workflow step; account and case triggers are one-click actions with parameter forms; the recurring and verification triggers
   are named but **not specified** [O5] [C9] [C14] [H2] [H26] [H32] [H33].
2. **Six step types** (action, wait, parallel, conditional, loop, module) plus output, module-input and map-output nodes [D1]
   [O8]. Waits on object events or time are capped at **30 days** and continue on timeout unless set to error; loops cap at
   **100**; conditionals take the first matching route of ordered AND/OR groups with an else; parallel branches join at one next
   step; modules cannot nest [D2] [H18] [H20] [H17] [H19] [H21].
3. **The expression language is not JSONLogic.** Conditions are built in a picker over method chains (`trigger >
   verification_government_id > country_code`) with array, string and email operators; parameters interpolate `{{ … }}`;
   secrets resolve from `current_run.environment.secrets.<key>` and are redacted in logs; run variables support `set`, `unset`,
   `push`, `remove` [H8] [H13] [H9] [H14]. No serialisation is public, so PLAN's JSONLogic is ours.
4. **Versions and rollouts.** Drafts, locked published versions, staged rollouts with `treatment` and `control` and a
   percentage, deployments, restore; runs stay on the version they started with; workflows are organisation-level with
   per-environment state [O2] [O3] [H4] [H5] [H6].
5. **Runs.** `in_progress`, `completed`, `errored` are the only statuses seen; `workflow-run.errored` carries the errored step
   and an error type (six are named, but as examples, not as a closed list (corrected in fact-check)); recovery is "resume
   from the last failed step" or "rerun with the latest version", dashboard-only;
   cancellation, run lifetime and retention are **not documented**; the API exposes only trigger, run list and retrieve, and
   version list [O4] [O6] [O7] [O8] [H10].
6. **About 45 actions** across inquiry, case, report, verification, graph, list, account, transaction, tags and objects,
   compute, communication and third-party apps (section 2). Evaluate Code's runtime and limits are **not documented**; Make HTTPS
   Request has five methods, headers, a JSON body, a response schema, retries, a timeout and the webhook `t=,v1=` HMAC, but no
   public network rules [H22] [H25] [D2].
7. **Cases** (`case_`): template-defined statuses in three categories (one `initial`, `intermediate`, `end`), resolutions,
   template-defined fields, queues (`cqueue_`), assignment by user or by policies (round robin, fewest open cases, case
   creator, inquiry creator; sorted by creation or SLA; capacity; availability), SLA in seconds up to 90 days with
   `case.sla-expired`, comments (`cscm_`), base64 PDF and image attachments, tags, and nine attachable object types with a
   1,000-object cap and snapshot semantics [O10]–[O23] [D6] [H94] [H56] [H118].
8. **Case templates have no versions** and only a retrieve API; layouts are tabs of about 30 modules, including a gallery of ID,
   selfie and document images; a side-by-side comparison layout is **not documented** [H93] [O11] [H104] [H109].
9. **Events:** four run webhooks and eleven case webhooks in the spec; the events page adds `workflow.published`,
   `workflow-version.published`, `case.updated`, `case.print-initiated`, `case-comment.created` and others [O8] [O23] [D4].
10. **What is honest for free:** the engine, every Persona-object action, cases and their API are real (our code over existing
    services); email, SMS and Slack are adapters with sandbox providers; the HTTPS guard and the QuickJS sandbox are ours and
    must state their limits; Trust Device, the recurring trigger, transition rules, SLA expiry for resolved cases and print are
    ours by definition [R3].

## Gap tables

Verdicts: **MATCH** (adopt the public behaviour), **OURS** (no public counterpart, or we deliberately differ; labelled as
ours), **DEFER** (a later phase), **HONEST** (needs a third-party account or cannot be done for free: an adapter with a
deterministic sandbox provider, ADR 0002 tier A [R3]). Row ids (W1, WA1, C1, …) are not citation keys; citation keys are always
in brackets, so the case row C3 and the changelog source [C3] are different things.

### Workflows (W)

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 8 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| W1 | Objects `wfl_`, `wfv_` (Help Center: `wflv_`), `wfd_`, `wfr_`, `srrun_` | Prefixes `wfl`, `wfv`, `wfd`, `wfr`, `srrun` in `ID_PREFIXES` (the OpenAPI spelling) plus ours for modules and step runs | Parity with the spec, which outranks the Help Center table | MATCH | [O1]–[O4] [H4] [R5] |
| W2 | Organisation-level workflows: one version history, per-environment active state | Environment-scoped workflows (templates, keys, secrets and providers are environment-bound in OpenVerify; ADR 0002 forbids sandbox providers in production), with a "promote" action that copies a published version into another environment | Cross-environment references are not documented and would bind production runs to sandbox objects | OURS (owner question) | [H6] [H30] [R3] |
| W3 | Event trigger on any event name; several events; criteria such as `trigger.template.token`; several workflows per event, no ordering; not retroactive | Same; criteria in the condition language (W16); a trigger never fires for events older than the version's activation | Parity | MATCH | [H2] [H3] [H7] [D4] |
| W4 | `POST /workflows/{id}/trigger`, `data.attributes.fields` checked against the version's `inputs`; file values `{filename, data}` | Same path and body; zod-validated input schema per version; 422 per field with `source.pointer`; idempotency key honoured | Parity; contracts first | MATCH | [O5] [C9] [C14] |
| W5 | Scheduled trigger created by Schedule Workflow (offset, units, before or after, from run time or a date field) | Same; a durable timer row per scheduled run (`srrun_`), cancellable when its subject is redacted | Parity; long waits beyond 30 days | MATCH | [H26] [D2] [O4] |
| W6 | Recurring trigger over matching objects; cadence and filter not documented | Ours: an interval or a five-field cron in UTC, an object type, a filter in the condition language, a batch cap per tick and a run per object | The public shape is not specified | OURS | [D1] |
| W7 | Manual runs from the dashboard (ids or CSV); inquiry-embedded workflows | Dashboard "create runs" (ids, CSV through the Phase 7 CSV reader); embedded workflows wait for the Phase 9 flow builder | Scope | MATCH / DEFER | [H10] [D1] [R1] |
| W8 | Account trigger (account actions with a parameter form; `POST /accounts/{id}/run-action` answers `workflow-run-id`) | Same path and answer; actions bound to an account type | Parity | MATCH | [O24] [H32] |
| W9 | Case trigger (case actions with an on-click parameter form, prefill from `case.fields`, `inquiry.fields`, `account.fields`) | Same; actions bound to case templates | Parity | MATCH | [H33] [H34] [H127] |
| W10 | Verification trigger "when a verification's state changes"; nothing more | An event trigger restricted to `verification.*` events with a verification-template filter (ours, defined) | Not specified | OURS | [D1] |
| W11 | `inquiry.escalated`, `verification.escalated` from asynchronous risk scoring | Not emitted: OpenVerify has no escalation score; the docs say so | Honest absence | HONEST | [H2] [D4] |
| W12 | Run Workflow; importers creating runs on a separate batch queue | Run Workflow now; an importer destination later | Scope | MATCH / DEFER | [D1] [H31] |
| W13 | Six step types plus trigger, output, module input and array-map-output nodes | Same node set in the definition schema | Parity | MATCH | [D1] [O8] [H11] [H20] [H21] |
| W14 | Wait on object events with a default resolution time (≤ 30 days; continue, or error if "error on expiration"); wait for time (≤ 30 days) | Same limits and both timeout behaviours; a wait is a durable timer plus an event subscription, never a sleeping worker | Parity | MATCH | [H18] [D2] [H27] |
| W15 | Parallel: all branches run and flow into one next step; join rule not documented | Join-all; a branch error fails the parallel step unless that branch's step continues on error; branches share no ordering | Must be defined to be testable | MATCH / OURS (join rule) | [H19] [H7] |
| W16 | Conditional: ordered routes, AND within a group, OR between groups, else last; picker over method chains; no serialisation is public | Same route semantics, serialised as JSONLogic (PLAN §3) with a restricted operator set; method-chain paths map to `var` paths | PLAN choice; the public format is unknown | MATCH (semantics) / OURS (JSONLogic) | [H16] [H17] [R1] |
| W17 | Loops: for each, while (a maximum is required), map (array output), sequential or parallel; at most 100 | Same, 100 cap, a list over the cap errors | Parity | MATCH | [H20] |
| W18 | Modules: inputs, no nesting, run inside the parent (one run), update parents to the latest module version, no rollout | Same | Parity | MATCH | [H21] |
| W19 | Method chains from `trigger`, `current_case`, `current_run`; operators; `{{ … }}` interpolation | Same roots and the documented operators; ours: a written grammar, no code execution in templates, a missing value is an `invalid-input-error`, output escaping per sink (JSON, HTML, header) | The grammar is not public; injection safety is ours | MATCH / OURS | [H8] [H9] [H13] [H15] |
| W20 | Run-scoped variables with `set`, `unset`, `push`, `remove`; read-only in modules; no order in parallel | Same | Parity | MATCH | [H14] |
| W21 | Platform secrets per environment, resolved lazily, `[REDACTED]` in logs, envelope-encrypted | Same reference path; values sealed with the existing KEK envelope; redaction of resolved values in step logs and outputs; `secrets:read` (metadata) and `secrets:write` | Parity; Phase 2 envelope already exists | MATCH | [H9] |
| W22 | Custom functions (`@name`, typed input and output, null opt-in) | Later; Evaluate Code covers the need | Scope | DEFER | [H23] |
| W23 | Drafts; locked published versions; staged rollout (treatment and control, 1–100 %); deployments; restore | Same; the rollout split is a stable hash of the trigger object id and the deployment id (ours), so one object always gets one side | Parity; the assignment rule is not documented | MATCH / OURS | [H4] [H5] [O2] [O3] |
| W24 | Active or inactive per environment; archived; API `status` `running`, `paused`, `archived` | Same values | Parity | MATCH | [O1] [H5] |
| W25 | Run `status`: `in_progress`, `completed`, `errored` seen; no enum | Those three plus ours `canceled`; waiting is `in_progress` with a `waiting-on` attribute (ours) | Defined vocabulary | MATCH / OURS | [O4] [O8] |
| W26 | `workflow-run.errored` context: `errored-step`, `error.type` (six values named as examples; the schema does not close the set (corrected in fact-check)), message only for configuration and input errors | Same shape and types | Parity; no PII in messages | MATCH | [O8] |
| W27 | Resume from the last failed step, or rerun with the latest version (dashboard only) | Same, plus API paths for both (ours); every action records an idempotency key per step attempt so a resume never repeats a completed side effect | Resume safety is not documented | MATCH / OURS | [H10] |
| W28 | Cancellation not documented | `POST /workflow-runs/{id}/cancel` (ours) | Operators need it | OURS | — |
| W29 | Run history in the dashboard; retention not documented | Runs and step logs kept under an environment retention setting, enforced by the C16 retention pass | Data minimisation | OURS | [H10] [H11] |
| W30 | Limits: 30-day waits, 100 iterations, 100/200 page sizes, rate limits, a run-creation quota | Same documented limits; ours: maximum steps per version, per-run wall time, per-workflow concurrency, a run-creation rate limit, all configurable | Bounded cost | MATCH / OURS | [D2] [H20] [H13] [D9] [H31] |
| W31 | Run events `workflow-run.created`, `.resumed`, `.errored`, `.completed`; `workflow.published`, `workflow-version.published` without webhook files | All six as events and webhooks | Parity | MATCH | [O8] [D4] |
| W32 | API: run list and retrieve, version list; no workflow create or publish API | The public paths plus a full workflow, version and publish API (ours) | Self-hosters manage configuration as code | MATCH / OURS | [O5]–[O7] [O27] |
| W33 | Simulate (sandbox, start and end steps, overrides) | A sandbox test run with input and step-output overrides that performs no external side effects (every adapter in sandbox mode); the full canvas simulation in Phase 9 | Partial parity now | OURS / DEFER | [H12] |
| W34 | Scopes `workflow.read`, `workflow.trigger` | `workflows:read`, `workflows:trigger`, plus ours `workflows:write`, `workflows:publish`, `workflow-runs:write` (resume, rerun, cancel) | Our `resource:action` style | MATCH (split) | [D8] [R6] |
| W35 | Plan gating ("enhanced" features) | None; every step available | Self-hosted | OURS | [H2] |
| W36 | A canvas editor with side panels, variables, diagnostics, version history and a runs tree | @xyflow/react editor over the same definition schema | PLAN §6 | MATCH (behaviour) / OURS (implementation) | [H3] [H11] [R1] |
| W37 | Custom events exist in the event schema; no creation path | Not in Phase 8 | No public contract | DEFER | [O9] |

### Actions (WA)

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 8 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| WA1 | Approve, Decline, Mark Inquiry for Review (events; `meta.comment` on approve and decline) | Same, through the existing transition service with actor `workflow-run`; the comment in the audit entry | Reuse | MATCH | [H40]–[H42] [O25] [R7] |
| WA2 | Create Inquiry from a template, optionally linked to an account | Same | Parity | MATCH | [H43] |
| WA3 | Inquiry Link Email and SMS (fixed SMS text with expiry; optional session token in the email link) | Email through the Phase 5 mail adapter (Mailpit in dev); SMS through the SMS adapter with the sandbox sink; a one-time link, never a reusable session token by default | Needs a provider; the session-token option weakens security | HONEST | [H44] [H45] |
| WA4 | Send Email with HTML and text, per-step SMTP settings, vendor no-reply sender by default | The environment's mail adapter only; no SMTP passwords in step configuration (a secret reference if per-step SMTP is ever added) | Secrets out of definitions | HONEST / OURS | [H46] [H47] |
| WA5 | Send SMS | SMS adapter with the sandbox sink and the Phase 5 pumping limits | Needs a provider | HONEST | [H48] |
| WA6 | Send Slack Message through an OAuth marketplace app | A Slack adapter (incoming-webhook URL or bot token held as a secret) with a deterministic sandbox provider that records messages; no OAuth app in Phase 8 | Needs a Slack account | HONEST | [H49] |
| WA7 | Zendesk, Salesforce, HubSpot, GPT, MX Bank steps | Not built; HTTPS requests cover them | Third-party accounts | DEFER | [H78]–[H83] |
| WA8 | Make HTTPS Request: five methods, headers, JSON body, response schema, retry intervals, timeout, `t=,v1=` HMAC signing | Same configuration and signing scheme; ours: HTTPS only, resolved-address checks against private, loopback, link-local, CGNAT and documentation ranges at connect time, no redirects by default, response size and time caps, content-type checks, retry only on network errors, 429 and 5xx | The vendor documents no network rules; PLAN §3 requires the guard | MATCH / OURS | [H25] [D2] [O28] [R1] |
| WA9 | Evaluate Code: JavaScript with properties and a typed return, editor test runs, retries; runtime not documented | QuickJS (PLAN §3) with memory, stack and time limits, no network and no host APIs by default, JSON-only inputs and output, the return type checked | Security boundary is ours | MATCH / OURS | [H22] [H24] [R1] |
| WA10 | Calculate | Same operators and `default` | Parity | MATCH | [H77] |
| WA11 | Update Variable | Same | Parity | MATCH | [H14] |
| WA12 | Run Report against an inquiry or account, fields editable; `run_report`; missing input errors | Same, over Phase 6 report templates and runs; the step's output exposes `has-match` and the report | Phase 6 C88 deferral | MATCH | [H66] [O8] [R2] |
| WA13 | Run Verification from a template, "complete on tentative", sandbox status override | Server-side verification types only (database and other adapter types); the sandbox override only in sandbox | Most OpenVerify verifications need the end user | MATCH / DEFER | [H67] [H27] |
| WA14 | Create Case, Assign, Update Status, Add Comment, Add To Queue, Attach Objects, Set and Clear SLA | Same | PLAN §6 | MATCH | [H50]–[H58] |
| WA15 | Send Case Message (email module templates, replies) | Later, with inbound email | Needs a mail inbox | DEFER | [H52] |
| WA16 | Tag Object, Remove Tag, Copy Tags | Same, over the existing tag service | Reuse | MATCH | [H59]–[H61] [R8] |
| WA17 | Fetch Persona Object, Update Object (`set`, `unset`, `append`, `push`, `remove`) | Same; Update Object limited to custom fields, tags and the documented attributes of each type | Writes must respect invariants | MATCH | [H62] [H63] |
| WA18 | Redact Object, all PII or selected fields; downstream cascade | All PII through the C16 redaction services; selected fields only where the field is a custom field | Reuse; field-level redaction of system fields can break invariants | MATCH / OURS | [H64] [H65] |
| WA19 | Run Workflow, Schedule Workflow, Module | Same | Parity | MATCH | [D1] [H26] [H21] |
| WA20 | Get List Match (boolean), Add Item To List, Add Item To Face List (after an inquiry step) | Same over Phase 7 lists; face items only from inquiries holding matching consent | Phase 7 C110 deferral | MATCH | [H70]–[H72] [R10] |
| WA21 | Sync Graph (modes), Run Graph Query (snapshot, async with a wait, `-1` while running) | Run Graph Query over Phase 7 queries; Sync Graph a validated no-op (Phase 7 indexes synchronously) | Phase 7 C110 deferral | MATCH / OURS | [H68] [H69] [R10] |
| WA22 | Find or Create Account | Same | Parity | MATCH | [H73] |
| WA23 | Create Transaction, Update Transaction Status, Set and Unset Relation | Same over Phase 7 transactions; objects a transaction-triggered run creates become the transaction's children | Phase 7 C110 deferral | MATCH | [H74]–[H76] [R10] |
| WA24 | Trust Device: one line, no specification | Ours: set a `trusted` flag on a Phase 7 device for the environment, read by signals and conditions, audit-logged, reversible | Not documented | OURS | [D1] |
| WA25 | Transliterate Fields (early access) | Later; the Phase 6 fold exists for matching | Scope | DEFER | [H79] |
| WA26 | Machine keys documented only for `run_report` | A documented snake_case key per action (`run_report`, `approve_inquiry`, `make_https_request`, `evaluate_code`, …) | The definition schema needs keys | OURS | [O8] |

### Cases (C)

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 8 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| C1 | `case` (`case_`) attributes and relationships of 3.1; actors as emails | Same attribute names; actor ids are our ids (`usr_`, `key_`, `wfr_`, policy ids), never email addresses in the API | Minimise PII in payloads | MATCH / OURS | [O10] |
| C2 | Case templates (`ctmpl_`): name, key, visible roles, resolutions, field schemas; no versions | Same fields; immutable template versions that each case pins (as Phase 6 report templates and Phase 7 transaction types) | Audit; the vendor already snapshots layouts per case | MATCH / OURS | [O11] [H92] [H93] [R2] |
| C3 | Template API: retrieve only | Full template API | Self-hosting | OURS | [O11] [C11] |
| C4 | Status categories `initial` (one), `intermediate`, `end`; defaults Open, Pending, Approved, Declined; `meta.status` | Same; an allowed-transitions map per template version (ours); 422 on a refused transition | The rule language is not public | MATCH / OURS | [D6] [H53] [O21] [C9] |
| C5 | Status tags, required comments on a status, checklists, rule-disabled status switcher | Status tags and required comments now; checklists and the switcher rule with the Phase 9 layout editor | Scope | MATCH / DEFER | [H91] [H101] [H121] |
| C6 | `case.resolved` on an end status, `case.reopened` on leaving it (from the examples) | Same, defined | Parity, defined | MATCH | [O23] |
| C7 | Queues (`cqueue_`, active or archived), one per case, `case-queue-id` | Same, plus a queue API (ours) | Parity | MATCH / OURS | [O12] [C6] |
| C8 | Assignment: manual; template and global policies (round robin, fewest open, case creator, inquiry creator; sort by created or SLA; capacity; routing by template or queue; availability) | Manual and policy assignment with the four methods, sort, capacity and routing by queue; availability and teams later | Phase 8 scope | MATCH / DEFER | [H92] [H94] [H96] [H95] [H120] |
| C9 | `assign` by `meta.user-email-address` | Accept it for parity and `meta.user-id` (ours) | Parity without forcing emails | MATCH / OURS | [O20] |
| C10 | SLA: seconds, at most 90 days (API) or about 61 days (Help Center), null clears; `sla-expires-at`; `case.sla-expired` | 90 days (the API value); `case.sla-expired` once per deadline, only for an unresolved case, from a durable timer; a new SLA re-arms it | Expiry semantics are not public | MATCH / OURS | [O15] [O16] [C3] [H100] [H57] |
| C11 | Notifications (assigned, SLA breached, mentioned) | Dashboard notifications; email through the mail adapter where configured | Minimal useful set | OURS | [H102] [H98] |
| C12 | Comments: `add-comment` `meta.message`; `case-comment` (`cscm_`) with `message` null after redaction; mentions notify | Same; append-only (no edit or delete, ours); a comment list path (ours); mention syntax ours | Audit integrity | MATCH / OURS | [O18] [O13] [H102] |
| C13 | `case-comment.created` (no webhook file) | Registered as event and webhook | Parity | MATCH | [D4] |
| C14 | Attachments: base64 PDF and images through `PATCH`; `attachments[] {filename, url, byte-size}` | Same body; ours: a size cap, magic-byte type checks, sealed storage through the existing storage service, short-lived signed URLs, no SVG or HTML | Untrusted uploads | MATCH / OURS | [O16] [O10] [H108] |
| C15 | Tags: `tag-name` or `tag-id` (arrays for `set-tags`); `case.updated-tags` context | Same; also accept OpenVerify's existing `tag-names` | Parity plus internal consistency | MATCH | [O22] [O23] [R8] |
| C16 | `object-ids` of nine types; once per case; 1,000 cap; idempotent remove; snapshot on attach | The types that exist (accounts, inquiries, reports, report runs, transactions, verifications, graph queries; documents where present); same cap and idempotency; ours: record the attach time and show "as attached" with a link to the live object | The snapshot store is not documented | MATCH / OURS | [O15] [O19] [C2] [C12] [H56] [H118] |
| C17 | `fields` from template field schemas, not inflected; custom fields only under `fields` | Same; reuse the Phase 7 field-schema validator; sealed when a schema marks PII | Reuse; rule 3 | MATCH | [O11] [C9] [R10] |
| C18 | `DELETE /cases/{id}` redacts; no cascade; comments nulled | Same; attachments deleted from storage; inquiry or account redaction leaves the case, whose links then show redacted stubs | Parity; rule 3 | MATCH / OURS | [O16] [H64] [H65] |
| C19 | CSV export of the filtered list with linked ids and tags; its own permission; `case.exported` | Same through the Phase 7 CSV writer; an export path (ours); `cases:export` | Parity | MATCH / OURS | [H117] [H128] [D4] |
| C20 | `case.print-initiated`; contents not documented | A print-friendly case page (audited, the event fired); PDF later with Phase 9 print | Phase 6 C88 put print in Phase 9 | OURS / DEFER | [D4] [H123] [R2] |
| C21 | Layouts of tabs and modules (inquiry, verification, gallery, event timeline, comments, attachments, tags, list matches, graph, signals, device, location, …), role and rule visibility | A fixed default layout with the core modules; per-module visibility by permission; the layout editor in Phase 9 | Scope | MATCH / DEFER | [H104] [H105] [H124] |
| C22 | Side-by-side images: not documented (the gallery groups ID, selfie and document images) | A comparison panel: ID portrait crop beside the selfie centre frame, the face-match score and liveness result with their tiers and stages, never a pass label the checks did not earn | Reviewer accuracy; ADR 0002 labels | OURS | [H109] [R3] |
| C23 | Bulk assign, status, queue, tags; asynchronous; logged per case | Same | Parity | MATCH | [H103] |
| C24 | `POST /cases/search` (AND, OR, NOT, depth 2, 20 clauses, eq/gt/gte/lt/lte, sort, pages ≤ 100); eventually consistent | Same body over Postgres, read-after-write consistent (ours) | Parity; no search cluster | MATCH / OURS | [O17] [C10] |
| C25 | `GET /cases` filters (status, template, account, reference id, inquiry, report) | Same | Parity | MATCH | [O15] |
| C26 | Eleven webhook events; the events page adds `case.updated`, `case.agent-reviewed`, `case.print-initiated`, `case-comment.created`, `case-message.*`, `case-template.*` | The eleven, plus `case.updated`, `case.print-initiated`, `case-comment.created` | Parity where we build the feature | MATCH / DEFER | [O23] [D4] |
| C27 | Scopes `case.read`, `case.write`, `case_template.read` | `cases:read`, `cases:write`, `cases:redact`, `cases:export`, `case-templates:read`, `case-templates:write`, `case-queues:read`, `case-queues:write` | Our style | MATCH (split) | [D8] [R6] |
| C28 | Dashboard permissions (assign, bulk assign, bulk resolve, export, analytics, list table) | Operator permissions with the same split | Parity | MATCH | [H123] |
| C29 | Analytics (status totals, resolution percentiles, assignment distribution, availability) | Phase 9 analytics | Scope | DEFER | [H116] |
| C30 | Email module, case messages, inbound routing | Later | Needs inbound mail | DEFER | [H52] [H119] |
| C31 | AML alert and SAR cases, STR, FinCEN filing | Not planned | Out of PLAN scope | DEFER | [H125] |
| C32 | Case Review Agents (LLM) | Not planned | Needs a model provider; tier A at best | DEFER | [H122] |
| C33 | A case-creation quota per environment | The existing rate limiter on case creation | Bounded cost | MATCH | [D9] |

## Corrections to the repository's records

1. **Events missing from `persona-surface.md`** (it lists the eleven case webhooks and four run webhooks, which match the
   spec [R4] [O23] [O8]). The events page adds `case.updated`, `case.agent-reviewed`, `case.print-initiated`,
   `case-comment.created`, `case-message.sent`, `case-message.received`, `case-template.converted-field`,
   `case-template.deleted-field`, `workflow.published`, `workflow-version.published`, `user.availability-updated` and the four
   `user-notification.*` events [D4].
2. **The condition language (PLAN §3 and §6).** "Conditional with JSONLogic" is OpenVerify's choice; no public source names
   JSONLogic or shows a serialisation [R1] [H16] [H17]. The plan should label it ours.
3. **The action list (PLAN §2, Workflows row).** It names 16 actions; the public catalogue has about 45 (section 2), including
   every case action (assign, status, comment, queue, attach, SLA), Fetch and Update Object, Find or Create Account, Calculate,
   Update Variable, Copy and Remove Tag, Run Verification, Schedule Workflow and the Phase 7 steps [R1] [H2]. "Add to list"
   in the row is right; "HTTPS request" is "Make HTTPS Request" with five methods, not the two the developer docs still state
   [D1] [H25].
4. **Version id prefix.** The Help Center table gives `wflv_`; every OpenAPI example uses `wfv_` [H4] [O2] [O7].
5. **SLA limit.** The API caps `sla-expires-in-seconds` at 90 days; the Help Center says "about 61 days" for workflow-set
   deadlines [O15] [H100].
6. **Run list filter.** `GET /workflow-runs` has one filter, `filter[status]`, described as filtering by workflow id [O6].
7. **Restore semantics.** One article says restoring a version creates a draft; another says reverting publishes it [H5] [H4].
8. **PLAN §2, Cases row.** Accurate as far as it goes; it should add status categories (initial, intermediate, end), queues
   driven by assignment policies, the 1,000-object cap and the snapshot semantics of attached objects [D6] [H94] [H118] [H56]
   [R1].

## Sources and pins

**Read date.** Every source below was read on **2026-10-27**, after reading each host's robots file, with at least two seconds
between requests to one host (sibling agents were using the same hosts), a descriptive User-Agent without contact details, and
no personal data sent. Robots files: `docs.withpersona.com` disallows only `/api/fern-docs/`; `help.withpersona.com` disallows
only `/gated/` (it carries a content-signals preamble that sets no signal); `api.github.com` and `raw.githubusercontent.com`
answered 404 (no restriction under RFC 9309). Names, email addresses and ids that appear in the vendor's examples are not
reproduced except as id prefixes; this note uses `example.com` and fictional values.

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, licence Apache-2.0 [G1], commit
**`e64dbfbd04968b4f48e41ad571eb85861ac969bf`** (HEAD on 2026-10-27, committed 2026-10-27T08:08:31Z) [G2], directory `2026-09-29/`
(tree `c30a98bcff4b629172eebd28706ff61c948b8d90`, 909 entries, not truncated) [G4]. This is the same pin as the Phase 7 notes
[R9]. Licence verdict: ✅ Apache-2.0 for reading; the repository is used for identifiers only and nothing from it is copied
into or shipped with OpenVerify (CLAUDE.md rule 4) [G1] [R11]. 75 files were downloaded from `raw.githubusercontent.com` at that commit and all 75 match the git blob hashes of the
tree. Every `O` link is `https://github.com/persona-id/persona-openapi/blob/e64dbfbd04968b4f48e41ad571eb85861ac969bf/2026-09-29/`
followed by the path shown (`{`/`}` written `%7B`/`%7D` in URLs).

| Key | What | Path |
|---|---|---|
| O1 | Workflow schema | `components/schemas/workflow.yaml` |
| O2 | Workflow version schema (`trigger-type`, rollout, inputs, outputs) | `components/schemas/workflow-version.yaml` |
| O3 | Workflow deployment schema | `components/schemas/workflow-deployment.yaml` |
| O4 | Workflow run schema and included types | `components/schemas/workflow-run.yaml`, `components/schemas/workflow-run-included-objects.yaml` |
| O5 | Create a workflow run | `paths/workflows_{workflow-id}_trigger.yaml` |
| O6 | List and retrieve workflow runs | `paths/workflow-runs.yaml`, `paths/workflow-runs_{workflow-run-id}.yaml` |
| O7 | List workflow versions, example | `paths/workflow-versions.yaml`, `components/examples/workflow-version-list.yaml` |
| O8 | Run webhooks and example bodies (errored context) | `webhooks/workflow-run.{created,resumed,errored,completed}.yaml`, `components/examples/workflow-run-{created,resumed,errored,completed}-webhook-body.yaml` |
| O9 | Event schema (custom events) and the events list path | `components/schemas/event.yaml`, `paths/events.yaml` |
| O10 | Case schema | `components/schemas/case.yaml` |
| O11 | Case template schema, example, retrieve path | `components/schemas/case-template.yaml`, `components/examples/case-template.yaml`, `paths/case-templates_{case-template-id}.yaml` |
| O12 | Case queue schema | `components/schemas/case-queue.yaml` |
| O13 | Case comment schema | `components/schemas/case-comment.yaml` |
| O14 | Case `included` union | `components/schemas/cases-included-objects.yaml` |
| O15 | List and create cases | `paths/cases.yaml` |
| O16 | Retrieve, update, redact a case | `paths/cases_{case-id}.yaml` |
| O17 | Search cases, example | `paths/cases_search.yaml`, `components/examples/case-list-search.yaml` |
| O18 | Add a comment | `paths/cases_{case-id}_add-comment.yaml` |
| O19 | Add and remove objects | `paths/cases_{case-id}_add-objects.yaml`, `paths/cases_{case-id}_remove-objects.yaml` |
| O20 | Assign | `paths/cases_{case-id}_assign.yaml` |
| O21 | Set status | `paths/cases_{case-id}_set-status.yaml` |
| O22 | Tags | `paths/cases_{case-id}_add-tag.yaml`, `_remove-tag.yaml`, `_set-tags.yaml` |
| O23 | Case webhooks (11) and example bodies | `webhooks/case.*.yaml`, `components/examples/case-*-webhook-body.yaml` |
| O24 | Run an account action, example | `paths/accounts_{account-id}_run-action.yaml`, `components/examples/run-account-action.yaml` |
| O25 | Approve, decline, mark for review an inquiry; review body | `paths/inquiries_{inquiry-id}_{approve,decline,mark-for-review}.yaml`, `components/requestBodies/inquiries-review-request.yaml` |
| O27 | Root document (the full path index) | `openapi.yaml` |
| O28 | `Persona-Signature` header parameter | `components/parameters/persona-signature-header.yaml` |

| Key | GitHub API (`https://api.github.com/repos/persona-id/persona-openapi` + suffix) |
|---|---|
| G1 | (none): `license.spdx_id: Apache-2.0`, default branch `main`, pushed 2026-10-27T08:08:34Z |
| G2 | `/commits?per_page=5`: HEAD `e64dbfb`, 2026-10-27T08:08:31Z, root tree `86ef0bed3aa36d128138a384411ca70cf1ad6725` |
| G3 | `/git/trees/86ef0bed3aa36d128138a384411ca70cf1ad6725`: version directories `2020-05-18` … `2026-09-29`, `LICENSE`, `README.md` |
| G4 | `/git/trees/c30a98bcff4b629172eebd28706ff61c948b8d90?recursive=1`: 909 entries, `truncated: false` |

**Developer docs (D) and changelog (C).** `docs.withpersona.com`, version 2026-09-29, read as Markdown (`.md` suffix), from the
index `https://docs.withpersona.com/llms.txt` (18 lines, which lists the versions) and the version index
`https://docs.withpersona.com/2026-09-29/llms.txt` (579 lines) [D10]. All 97 changelog entries in
`https://docs.withpersona.com/2026-09-29/updates/changelog/llms.txt` were downloaded and searched for workflow, case and run
changes (one entry, 2026-10-27, is newer than the Phase 7 read).

| Key | URL (`https://docs.withpersona.com/2026-09-29/` + path) |
|---|---|
| D1 | `workflows.md` |
| D2 | `workflows-best-practices.md` |
| D3 | `building-workflows.md` |
| D4 | `events.md` |
| D5 | `cases.md` |
| D6 | `api-reference/cases.md` (status categories) |
| D8 | `api-keys.md` (permissions) |
| D9 | `rate-limiting.md` |
| D10 | `llms.txt` (and the root `https://docs.withpersona.com/llms.txt`) |

| Key | Changelog entry (`https://docs.withpersona.com/2026-09-29/updates/changelog/` + date + `.md`) | Subject |
|---|---|---|
| C1 | `2023/3/20` | cases gain `txns` |
| C2 | `2023/3/27` | an object attaches to a case only once |
| C3 | `2024/1/8` | `meta.sla-expires-in-seconds` on create and update |
| C4 | `2024/2/5` | `assigner-id`, `assigner-type` |
| C5 | `2024/4/15` | `case-assignment-policy` as updater |
| C6 | `2024/6/17` | `case-queue-id`, `case-queue` relationship |
| C7 | `2024/9/16` | case `attachments` attribute |
| C8 | `2025/6/23` | workflow `active-deployment` and `latest-published-version` includes |
| C9 | `2025/10/27` | case custom fields only under `fields`; `meta.status`; workflow run `data.attributes.fields` |
| C10 | `2025/12/16` | case search |
| C11 | `2026/5/4` | retrieve a case template, `case_template.read` |
| C12 | `2026/6/1` | remove objects from cases |
| C13 | `2026/8/24` | list workflow versions |
| C14 | `2026/10/27` | file parameters as uploaded data on run creation and account actions |

**Help Center (H).** Article ids under `https://help.withpersona.com/articles/<id>/`, each read as Markdown
(`https://help.withpersona.com/articles/<id>.md`, which the robots file points agents to), found through the index
`https://help.withpersona.com/llms.txt` (1,092 lines). 167 articles were downloaded; all answered 200.

| Key | Article (id) | Key | Article (id) |
|---|---|---|---|
| H1 | Workflows overview (`6i3aAp6lBK3FCf08HJgPjh`) | H50 | Create Case step (`3ly3uUwIUTVih1pkT5dfcE`) |
| H2 | Trigger events and step types (`4q44atlPvZvBNZAbYJzi3f`) | H51 | Assign Case step (`2jxWr65fU9sQT4oXgxL37b`) |
| H3 | Creating workflows (`20Zvcq50493eMUdt7aDhRY`) | H52 | Send Case Message step (`1hpRWQSF8KCnWL5koRs1yB`) |
| H4 | Versions and change management (`6YBOe6MD4R9WrwEuQND6jA`) | H53 | Update Case Status step (`5X9uN2ove7vml7Y6pCqVRx`) |
| H5 | Managing versions and state (`4cM7g2XVmqM6hicxsy9Js3`) | H54 | Add Comment To Case step (`1tc13BeQYGXUWUZZvXfnUI`) |
| H6 | Organisation-level workflows (`4rjJO3TZUWqgcL8DgQkSPq`) | H55 | Add Case To Queue step (`535ooKEj1NGAepFelRyyHy`) |
| H7 | Workflows FAQs (`1UNQQ1f6RKFlV0pfSplEKp`) | H56 | Attach Objects To Case step (`68OO1Ovqk7xRcYUDVMbWYa`) |
| H8 | Method chains (`6ADlpksU5PGtbzlxiT6KEh`) | H57 | Set Case SLA step (`6CQVTSr8yNXC1migQcPPDs`) |
| H9 | Platform secrets (`nlTpuEIPeSmXpKY4Bgs9ac`) | H58 | Clear Case SLA step (`5uSJhr6OzAlC9xhazLsXS2`) |
| H10 | Rerun, resume or run new (`59bQ0AVwLaOTr9TGHTyEzb`) | H59 | Tag Object step (`4bC9Bai4hyDj7vKTkw6tpk`) |
| H11 | Testing and auditing (output step, rollouts) (`6hnq0KFsYB3Edjt9ME4E9`) | H60 | Copy Tags step (`5jZLBmvVLUfBYv7bZoVUnv`) |
| H12 | Simulate (`2MsjIjgahao6eq2tOZ6vVG`) | H61 | Remove Tag step (`5CXuPun6KsPA8hzIKRGzsa`) |
| H13 | Conditional step operators (`5HnQvtkzFUkUSo9gdgECnX`) | H62 | Fetch Persona Object step (`2eCOz4EmTo8C2jHgMe4HZq`) |
| H14 | Workflow variables (`3tWNwJv7w6ZjmTKcguGyvI`) | H63 | Update Object step (`6KtH90sKpJju2uAPbGo5X`) |
| H15 | Accessing data in workflows (functions) (`4lC4iF7RKLohY3wiFLfsw2`) | H64 | Redact Object step (`48Fu5XOdmd1y5v1xvbCkn8`) |
| H16 | Editing logic within a conditional (`3bFJGcJP8OCRTImxNJ7jYX`) | H65 | Redaction and redaction policies FAQ (`42ubXB5lJPWNaITI0uJfrI`) |
| H17 | Conditional step (`36BS5SiFg4jDAPSTC6arD7`) | H66 | Run Report step (`20fGyKJCYgiR9NMY9nlKkN`) |
| H18 | Wait step (`6mS9gS6YULKFIYA6OVQWOB`) | H67 | Run Verification step (`5og9iSBjuzRbdpjHPwMUBH`) |
| H19 | Parallel step (`0Tw682FD90h4MGfL03BgB`) | H68 | Run Graph Query step (`1yqPtt4uqQ4C4qttQQTf4Q`) |
| H20 | Loop step (`2XtEr8q0u1N26rRos2Xrb5`) | H69 | Sync Graph step (`338LZn4WIhbRurb91DFRQF`) |
| H21 | Module step (`20hu83UClXhWNMnk5etciI`) | H70 | Get List Match step (`JhJwzlzBVgW4bxNdJJSot`) |
| H22 | Evaluate Code step (`7eNHMEGyHPLu35oakfyo79`) | H71 | Add Item To List step (`78GxoTrZkNkVTIDkmlkXfF`) |
| H23 | Custom functions (`a173Vc2K1RfXmRwQEQMZZ9`) | H72 | Add Item To Face List step (`gnAr5qyid6E0BOFNAxj2f`) |
| H24 | Custom code use cases FAQ (`1tvGosU60Q8aijO7A385vV`) | H73 | Find or Create Account step (`66GC6EDZ4qysMQLD77WPIQ`) |
| H25 | Make HTTPS Request step (`5QOFu1KYFl4l14DTWSnbV1`) | H74 | Create Transaction step (`6yTKeRbCEdxNfYBucXqBZU`) |
| H26 | Schedule Workflow step (`7GpG4JS4xu4IMSe88rVBM8`) | H75 | Update Transaction Status step (`7tVM7NL7V9mLUvNZO2q3vw`) |
| H27 | Workflow best practices (`63hzKuMfRsrD4AWYSQYmcF`) | H76 | Account relations (Set/Unset Relation) (`1aMbe1XEyhiAHgFz1oOjDj`) |
| H28 | Notified when a workflow is stuck (`1wRuVQRKN67X2AWIdvFKTq`) | H77 | Calculate step (`4Jj6MV8iuvPXxWZVO3MaiS`) |
| H30 | Migration to organisation-level workflows (`5HxSRhTO1UkxuboAUu4TDz`) | H78 | GPT Generate Message step (`47mo9PsRf2qgP95wFk1NVQ`) |
| H31 | Importers creating workflow runs (`2TuI1x5AUklJpvAaJ5xasG`) | H79 | Transliterate Fields step (`O7EaW2XMechbwEI9gvQ9jq`) |
| H32 | Account actions (`64EZm9gziZNEwZ9wX2yrU1`) | H80 | Zendesk steps (`7AacDvKX06ejFzLBJOB8q3`) |
| H33 | Case actions (`3QokSTOfV7ZC7hNDPQ5HnT`) | H81 | Salesforce steps (`6rTfuVypbZNFJZ5ubrG5Ye`) |
| H34 | Case action configurations (`vZwfn2PS7VVMZwZl33pWen`) | H82 | HubSpot steps (`5iU71LmEUcYyZSo8IEjWl0`) |
| H40 | Approve Inquiry step (`117xjV7kkJYJ1qC3mSvqzn`) | H83 | MX Bank report step (`4uOuGbL0foCuT0dQkHpLwg`) |
| H41 | Decline Inquiry step (`14RSXtT6iqdYd55vqEfUBE`) | H85 | Reviewing an inquiry (`3JkqiHmtOWftGHDPKYcOCW`) |
| H42 | Mark Inquiry for Review step (`1bYtJbqmu4UZJ4DXg0BXng`) | H92 | Cases template (`5WFMyVPjzgXQNljqg2xf4h`) |
| H43 | Create Inquiry step (`nvCvqDw3f4yRuiovvOHQC`) | H93 | Case templates and change management (`21zoRbGL1FxKkbgBwc7ZLI`) |
| H44 | Inquiry Link Email step (`6JY0X8SaMlhY7SbuZxXjyH`) | H94 | Global assignment policies and queues (`4jcpgOReCv6UnPQuPWrARs`) |
| H45 | Send Inquiry Link SMS step (`6n1Qeg6I9O4iZ8r5V0N5LH`) | H95 | Teams in cases (`2Ucor7PGqindbKCAEVoTRV`) |
| H46 | Send Email step (`27FwSlEyBXBFqP5CJwSzAH`) | H96 | Availability status (`4qTPmfbkQ6CIcbEJVagRVp`) |
| H47 | Using the Send Email action (SMTP) (`5t1l1MtN0gqHnLcqpPWMGp`) | H97 | Creating a case (`1PUJ9IFRuSGSURgzy1QHnY`) |
| H48 | Send SMS step (`19Lpb01dayUoovielLfTZd`) | H98 | Assign case deadlines (`RY8o9XcFcTA2hR1QvvAj4`) |
| H49 | Send Slack Message step (`cWDpbEP9l8WGpM83OWMyy`) | H99 | View case deadlines (`4zECCrH7xpQaB1xPkILd2V`) |
| H90 | Cases overview (`1EJCOF8bL5KRx4pQESw7VB`) | H100 | SLAs for deadline tracking (`5JQzBlB1uHQkyXLpysk1W1`) |
| H91 | Case status (`2P8swNyjlHKiZPDCy5gnAu`) | H101 | Requiring case comments (`2Vpk4ZySVIXjlA1Bvq0Qxk`) |
| H102 | Case notifications (`1YbMMKFxQ7iWKtg2J4AZ6M`) | H116 | Cases analytics (`7BOHplbhL1eCKfX45iJgva`) |
| H103 | Bulk actions (`2x8bKqO6qfIXQVsXy4BzLg`) | H117 | Case exports (`wGQEprHgiQmULwTb1g4WyT`) |
| H104 | Case modules reference (`71bfAMD6bNyf7zFW7Q1ghk`) | H118 | Why objects fail to attach (`3JzOvH6QIKLN0FfuH5ojXK`) |
| H105 | Module visibility (`2Q9Z1rKNix3YYxUoEnFtLc`) | H119 | Email attachment failures (`3QmLXcECBb6rzlDOblpcse`) |
| H106 | Case comments module (`4XaXup5gl39IyNGwXah2Nb`) | H120 | Cases Enhanced (`2EgyDJx3nt6M49pL9vedAm`) |
| H107 | Comments module (`62VQFE6r1bnKGwmCiN23RC`) | H121 | Checklists in cases (`7eJEf3vpyYeKm070roDdWy`) |
| H108 | Attachments module (`1tiJQMvnuoP0nGoA57mXfx`) | H122 | Case Review Agents data controls (`75PJZo5B7UpFFJko5ozoMj`) |
| H109 | Gallery module (`4Z0b6uVX2RrvPG4Zzzzzzz`) | H123 | Dashboard permissions reference (`6IQlWEmAy2E4emOYjzeLD8`) |
| H110 | Inquiry module (`5xANTo6xxrQmTQFR8e91XG`) | H124 | Case layout editor (`2f3VkwOHqq202m9kjOYyGk`) |
| H111 | Verification module (`7rxaI98RhhjyRxfl3FoLVK`) | H125 | AML case management and SAR filing (`3PQYXlkWnkxRyWmAijjVux`) |
| H112 | Device module (`1iVI1ODRccwLNt2D0wdUow`) | H127 | Prefilling case actions (`2AZYnI4y0QQTAC11ULfemP`) |
| H113 | Event timeline module (`5fSyvHVVxzvFqSaFnybqoX`) | H128 | Exporting data from the dashboard (`7Cd77Z8CdwuxCYNTgeZhtK`) |
| H114 | Cases field editor (`6hHtNHUvxOXRqVoMvOk2sX`) | H129 | Auto-creating a case for review (`7zHVvOEqQk7sqMUvS1MqhC`) |
| H115 | Filterable fields (`6l8SSZiOyJrLOyuKSquca7`) | H130 | Tags overview (`6smgSbjto50fTBeLJrIvA7`) |

**Repository (R).** Read-only paths in the repository at `3b4ef08` (Phase 6 being built in the same tree).

| Key | Path |
|---|---|
| R1 | `docs/PLAN.md` §2 (Cases and Workflows rows), §3 (workflow code step, editor, SSRF guard), §5, §6 (Phases 1, 8, 9) |
| R2 | `docs/plans/phase-6.plan.md` (C70.4 events, C84.3 `on-report-match`, C88 deferrals, decisions 28 and 48) |
| R3 | `docs/adr/0002-check-tiers.md` |
| R4 | `docs/research/persona-surface.md` (case and workflow events and paths) |
| R5 | `packages/contracts/src/ids.ts` (`ID_PREFIXES`) |
| R6 | `packages/core/src/permissions.ts` (`API_SCOPES`) |
| R7 | `packages/contracts/src/inquiry-actions.ts` |
| R8 | `packages/contracts/src/tags.ts` |
| R9 | `docs/research/phase7-behaviour.md` (L15 list-item creator, T10, GR6, the OpenAPI pin) |
| R10 | `docs/plans/phase-7.plan.md` (C110, decisions 18 and 41, the graph explorer actions) |
| R11 | `CLAUDE.md` rules 4 and 5 |

**Downloads.** Everything fetched sits under
the research downloads (kept outside git) in `docs-index/`,
`docs-pages/`, `changelog/`, `gh-api/`, `openapi-e64dbfb/`, `help-index/`, `help-articles/` and `help-articles-2/` (about
2.6 MB in total); the fetcher and the blob checker are `scripts/bh_fetch.py` and `scripts/bh_verify_blobs.py`. Nothing
downloaded was executed.

## 1. Workflows

### 1.1 The objects and their ids

| Object | Id prefix | What it is (our words) | Sources |
|---|---|---|---|
| Workflow | `wfl_` | The named automation. `status` is one of `paused`, `running`, `archived` (open enum); relationships `latest-published-version` and `active-deployment` (requestable with `include` since 2025-06-23) | [O1] [C8] |
| Workflow version | `wfv_` in the OpenAPI examples; the Help Center table says `wflv_` | One revision. `status` `draft`, `published`, `archived`; `trigger-type` (null until a trigger is attached); `live`; `rollout-label` (`treatment`, `control`); `rollout-percentage` 1–100; `last-updater` (a user's email, null when the vendor changed it); `inputs[] {name, type, required}`; `outputs[] {name}`; `description` (the change note, null on drafts); `published-at` | [O2] [O7] [H4] |
| Workflow deployment | `wfd_` | Which versions serve traffic: `status` `active`/`inactive`, `configuration.versions[] {token, percentage 1–100, label}` | [O3] |
| Workflow run | `wfr_` | One execution: `status`, `created-at`, `completed-at`, `meta.processing-time-seconds`; relationships `workflow`, `workflow-version`, `creator` | [O4] |
| Scheduled run | `srrun_` | A run planned for later by another run's Schedule Workflow step; it appears as a run's `creator` and as an `included` type; its schema file exists but this note did not read it | [O4] |
| Module | not documented | A reusable set of steps with declared inputs, called from a parent workflow; it never runs alone | [H21] |
| Custom function | not documented | A published JavaScript function with one typed input and one typed output, reusable in pickers as `@name`; environment-scoped | [H23] |
| Platform secret | not documented | An organisation-level named credential with a sandbox and a production value | [H9] |

Workflows are **organisation-level** since July 2023: one version history for all environments, publishing reaches every
environment at once, and each environment has its own active or inactive state; before the migration a workflow lived in a
single environment [H6] [H30]. The public API exposes runs and versions only; creating, editing and publishing workflows is
dashboard-only, and there is no public path to read a workflow by id (the workflow object is reachable only through `include`)
[O27] [O5] [O6] [O7].

### 1.2 Trigger types

The version attribute `trigger-type` carries eight values (open enum): `trigger-account`, `trigger-api`, `trigger-case`,
`trigger-direct`, `trigger-event`, `trigger-recurring`, `trigger-schedule`, `trigger-verification` [O2]. The developer docs list
the same eight kinds [D1]; the Help Center presents only event, API and scheduled as "event types" and treats a run started by
another workflow or by a person as not an event [H2] [H3].

| Trigger | `trigger-type` | How it starts and what it carries | Sources |
|---|---|---|---|
| Event | `trigger-event` | Fires on a platform event; any name on the events page can be used (inquiry, verification, account, case, transaction, report, workflow and more); one workflow may listen to several events; several workflows may listen to the same event and then start together with no ordering between them | [D1] [D4] [H2] [H7] [H27] |
| API | `trigger-api` | `POST /workflows/{workflow-id}/trigger`; the body's `data.attributes.fields` must match the version's parameter schema (`inputs`); without a schema the steps have nothing to read | [O5] [H2] [C9] |
| Scheduled | `trigger-schedule` | Started at a planned time by another run's Schedule Workflow step (an offset in units before or after the step's own run time or a date field of an object); recommended for anything beyond the 30-day wait cap | [D1] [D2] [H26] |
| Recurring | `trigger-recurring` | Runs over a set of matching objects (accounts, cases, inquiries, reports, transactions) on a recurring schedule, optionally narrowed by a filter. The cadence syntax, the filter language and the batch size are **not documented** | [D1] |
| Manual / direct | `trigger-direct` | Started on an attached source object, for example from a dynamic-flow inquiry template (an embedded workflow); the dashboard's "create new runs" takes pasted object ids or a CSV and makes one run per object | [D1] [H10] [H7] |
| Custom events | (an event trigger) | The event schema describes customer-created events (a dotted name such as `custom.object.processed`, the body returned exactly as sent, an optional context), but no public path creates one; whether they can start workflows is **not documented** | [O9] |
| Account | `trigger-account` | An account action: a workflow started from the account's actions menu, with a configurable parameter form; also `POST /accounts/{account-id}/run-action` (`data.account-action-id` `accac_…`, `data.parameters`), which answers with the `workflow-run-id` it created | [D1] [O24] [H32] |
| Case | `trigger-case` | A case action: a reviewer clicks it in a case; its first step (an on-click trigger) declares the form fields (label, type, optional), prefillable from the case, its inquiry or its account | [D1] [H33] [H34] |
| Verification | `trigger-verification` | Fires when a verification's state changes; configuration is **not documented** beyond that sentence | [D1] |

Other ways a run starts: the Run Workflow action (one workflow starts another) [D1]; importers whose destination is
"workflow run", one run per CSV or S3 row, for event, API and case or account action workflows, on a separate batch queue
that does not compete with real-time runs but counts against the run-creation quota [H31]. Workflows are **not retroactive**:
an event that happened before the workflow was active never starts it; older objects are pushed through by creating runs
manually [H7].

**Escalation events.** `inquiry.escalated` and `verification.escalated` fire when the vendor's risk analysis raises an object's
risk level; that analysis runs asynchronously, so a workflow started by `inquiry.completed` can finish before the escalation is
known [H2] [D4].

**Trigger criteria.** An event trigger can carry criteria on the trigger object, typically
`trigger.template.token` equal to one or several template ids; with no criteria the workflow runs for every object that emits
the event in that environment, which the vendor advises against [H2] [H3] [H7]. The criteria language is the same picker and
method-chain language as conditional steps (1.5) **(inference: the articles show the same picker; they do not say so)**.

### 1.3 Step types

Six step types in the developer docs: action, wait, parallel, conditional, loop and module [D1]. The run-error context names the
same six kinds (`action`, `conditional`, `parallel`, `loop`, `module`, `wait`) and an action step's `action-key`
(`run_report` in the example) [O8]. The editor also has structural nodes: the trigger node, an output node created with every
workflow, an input node in modules, and an array-map-output node at the end of a map loop [H11] [H21] [H20].

| Step | Behaviour as documented | Limits and failure behaviour | Sources |
|---|---|---|---|
| Action | Runs one action from the library (section 2) on an object chosen from the trigger or an earlier step | Every action has an optional "continue on error"; Evaluate Code and Make HTTPS Request also have retry intervals, and the HTTPS request a timeout | [D1] [H22] [H25] |
| Wait, on objects | Pauses until one of the chosen events happens on a target object (created, assigned, status changes; at least one event must be ticked), or until a default resolution time in seconds | The resolution time is capped at 30 days; on timeout the run continues, unless "error on expiration" is ticked, which errors the run | [D1] [D2] [H2] [H18] [H27] |
| Wait, for time | Pauses for a number of seconds | At most 30 days | [D2] [H18] |
| Parallel | Splits into branches that all run; every branch flows into one shared next step | The join rule when a branch errors is **not documented**; we read "funnels into the same next step" as join-all **(inference)** | [H19] [H7] |
| Conditional | Ordered routes, each a set of conditions combined with AND inside a group and OR between groups; the first route whose conditions hold is taken; the last route is always an else; a route with no conditions is a catch-all | Continue on error is available | [H17] [H16] [H2] |
| Loop | `for each` over a list; `while` a condition holds (a maximum iteration count is required); `map` producing a new array through an array-map-output node; each runs sequentially or in parallel | At most 100 iterations; a list over 100 items errors the step; continue on error is available | [H20] [D1] |
| Module | Calls a published module with mapped inputs; the module's steps run inside the parent run, which counts as one run | No nesting; not available to inquiry-embedded workflows or to account and case actions; a module cannot be published by staged rollout; parents can be updated to the latest module version | [H21] |
| Output | Declares the values the run returns; surfaced in the runs table; version-specific | — | [H11] [O2] |
| Update Variable (an action under Compute) | Writes a run-scoped variable | See 1.5 | [H14] |

**The expression language is not JSONLogic.** Conditions are built in a picker from method chains, operators, literal values
and "expressions" (formulas inside a route); the public pages show no JSON serialisation of a condition, and no source names
JSONLogic or any other standard [H2] [H8] [H13] [H17]. PLAN §6 chooses JSONLogic for OpenVerify [R1]; that is ours.

### 1.4 What happens when steps fail

- A step error errors the run unless the step has "continue on error" [H17] [H20] [H22] [H25].
- `workflow-run.errored` carries a `context` (rolling out; `{}` where not enabled): `errored-step {name, key, type,
  action-key}` (null when the run failed as a whole, for example by expiring) and `error {type, message}`. Error types named:
  `missing-input-error`, `invalid-input-error`, `configuration-error`, `resource-error`, `unknown-error`, and `run-failure`
  for a whole-run failure. The message is shown only for configuration and input errors; every other type gets a fixed generic
  text [O8].
- A run "expiring" is named as a whole-run failure [O8], but the run lifetime is **not documented**.
- Recovery from the dashboard: **resume from the last failed step** (advised for transient errors; the run continues) or
  **rerun with the latest published version** (advised for configuration errors; a new run) [H10]. The API has no resume,
  rerun or cancel path [O27]. Cancelling a run is **not documented** anywhere.
- An approve or decline action does not end the run; it continues to the output node [H27].
- A variable read before it holds a value errors the action that reads it [H14].
- Each run stays pinned to the version it started with; later publishes never change past runs [H4].
- The vendor's advice for a stuck run is a second workflow on the same event that waits and alerts, because a stuck run cannot
  alert about itself [H28].

### 1.5 Reading the trigger and earlier steps

- **Method chains.** A value is addressed from a root through attributes and relationships, shown in the docs as
  `trigger > verification_government_id > country_code` and, in operator examples, as dotted paths such as
  `current_case.accounts.collect_from_each(inquiries)` [H8] [H13]. Roots seen: `trigger` (the object that started the run, or
  the current inquiry in an inquiry branching step), `current_case` and `current_run` [H8] [H13] [H9]. Custom fields sit under
  `fields` (`trigger.fields.first_name`), system attributes directly on the object [H15].
- **Operators** on arrays: `.count`, `.first`, `.last`, `includes()`, `filter('key','operator','value')`, `sort_asc(key)`,
  `sort_desc(key)`, `collect_from_each(relation)`, `page_size(n)` (default 100, at most 200), `page_number(n)` (at most 100);
  on strings: `length`, `trim`, `split`, `replace-all`/`replace_all`, `replace-chars`/`replace_chars`; on emails: `domain`,
  `username`; and `convert_to()` between string, number, boolean, date and datetime. `filter` and `sort` work only on indexed
  fields of each object **(the set is not documented)** [H13] [H15] [H8].
- **Templating.** Text parameters interpolate chains in double braces, shown as
  `Bearer {{current_run.environment.secrets.api_key}}` [H9]. A formal grammar, escaping rules and the behaviour on a missing
  value are **not documented**.
- **Secrets.** `current_run.environment.secrets.<snake_case_key>` resolves the environment's value at the moment the step runs;
  resolved values are replaced by `[REDACTED]` in run logs, run history and step inspection, stored with envelope encryption,
  and never shown to run viewers; the vendor warns that redaction does not cover values written into messages that leave the
  platform. Key names cannot be renamed. Permissions `organization-secret.view` (metadata only) and
  `organization-secret.write` [H9].
- **Variables.** Declared per workflow with a type (Persona objects, string, number, boolean, object, array; defaults only for
  string, number, date, boolean); updated by an Update Variable action with `set`, `unset`, `push`, `remove` (the last two for
  arrays); scoped to one run; no ordering guarantee between parallel updates; not declarable in modules (a parent's variable
  passes in read-only); available in case and account actions but not in inquiry-embedded workflows [H14].
- **Custom functions.** JavaScript `export default function ({ previous }) { … }`, one input and one output whose types lock
  at creation, a draft and a published revision, null inputs refused unless the function opts in (a declared `T | null`), and
  environment-scoped [H23].
- **Earlier steps' outputs** are offered in the same picker [H22] [H25]; the JSON shape of a step output is **not documented**.

### 1.6 Versioning and publishing

- Editing creates a **draft**; publishing a draft creates a new locked version; one draft at a time; a new draft can start from
  any version [H4] [H5].
- **Staged rollout.** Publishing asks for a rollout percentage (default 100) and, for organisation-level workflows, the
  environments to activate or deactivate. Below 100 the new version is `treatment` and the previous `control`; the runs table
  shows which side served each run; editing is locked until the rollout is finished (100) or undone (0) [H5] [H11] [O2] [O3].
- **Restore.** One article says restoring creates a new draft to edit and publish [H5]; another says reverting publishes the old
  version with a rollout choice [H4]. Both are vendor statements; they disagree on whether a draft step comes between.
- **State.** Active or inactive per environment, archived (permanently removed from the dashboard; deactivated first) [H5] [H6].
  The API's workflow `status` uses `running`, `paused`, `archived` [O1].
- **Version list.** `GET /workflow-versions?filter[workflow-id]=wfl_…` (required filter) returns published versions and the
  current draft, newest first, never archived versions; `live`, `rollout-label` and `rollout-percentage` are relative to the
  calling key's environment (a production-only version is not live for a sandbox key); during a rollout two versions report
  `live: true`; `updated-at` does not move when `inputs` or `outputs` change; it needs the Workflows API product feature and
  workflow read permission [O7] [C13].
- **Events.** `workflow.published` and `workflow-version.published` exist on the events page but have no webhook file in the
  OpenAPI [D4] [O27].

### 1.7 Runs: statuses, history, retention

- **Statuses.** The run schema leaves `status` as a free string; the examples show `in_progress` (created and resumed),
  `completed` and `errored` [O4] [O8]. No enum, no waiting, canceled or timed-out value is documented.
- **Creator.** `null` (API-started in the example), `administrator` (`admn_`), `user`, `event` (`evt_`, the triggering event,
  included in full with its payload) or `scheduled-run` (`srrun_`) [O4] [O5] [O8].
- **List.** `GET /workflow-runs`, newest first, cursor pagination, one filter `filter[status]` whose description says it filters
  by workflow id (a contradiction in the spec; which one the server honours is **not documented**); `GET
  /workflow-runs/{wfr_…}` [O6].
- **History.** Dashboard runs view per workflow with the decision tree, the errored step highlighted with its message, the output
  values, and filters by version [H10] [H11]. Events (and so run-creating events) are viewable for 3 months [D4]. Run retention is
  **not documented**.
- **Rollout attribution** is shown per run (treatment or control) [H11].

### 1.8 Concurrency, quotas and limits

| Limit | Value | Sources |
|---|---|---|
| API rate limit (production default) | 300 requests per minute per environment; optional per-key limits inside it; `RateLimit-*` headers; 429 | [D9] |
| Creation quotas | Per-product quotas (inquiries, verifications, reports, cases, transactions) with `Quota-*` headers | [D9] |
| Workflow run creation | A run-creation quota, described as daily, visible on the rate-limits page; its value is **not documented** | [H31] |
| Wait | 30 days, for both kinds | [D2] [H27] |
| Loop | 100 iterations or items | [H20] |
| Arrays in chains | 100 per page by default, 200 at most, page number at most 100 | [H13] |
| Concurrent runs per workflow, parallel branch count, run duration, step count, code CPU and memory | **not documented** | — |

Runs triggered by different workflows on the same event, or by `inquiry.created` and `inquiry.completed`, have no ordering
guarantee; the vendor suggests checking for a tag set by the earlier workflow and waiting if it is missing [H27] [H7].

### 1.9 Run events and webhooks

| Event | Webhook file | Payload | Sources |
|---|---|---|---|
| `workflow-run.created` | yes | the run with `included` workflow, version and creator event; `context: {}` | [O8] |
| `workflow-run.resumed` | yes | same shape as created | [O8] |
| `workflow-run.errored` | yes | same, plus the `errored-step` and `error` context of 1.4 | [O8] |
| `workflow-run.completed` | yes | same, `completed-at` and `processing-time-seconds` set | [O8] |
| `workflow.published` | no | — | [D4] |
| `workflow-version.published` | no | — | [D4] |

Webhook deliveries carry `Persona-Signature` (`t=<unix>,v1=<hex HMAC>`) and attempt headers as for every other event [O8]
[O28].

### 1.10 The API surface

| Method and path | Body and answer | Scope | Sources |
|---|---|---|---|
| `POST /workflows/{workflow-id}/trigger` | `{ data: { attributes: { fields: {…} } } }` (required since 2025-10-27; `meta.params` and top-level attributes refused); file values must be `{ filename, data }` with base64 data, including nested and array values and undeclared fields, else 400 with `source.pointer` (2026-10-27); answers the run (200 in the spec, `in_progress`); `Idempotency-Key` accepted; 409 and 422 listed | `workflow.trigger` | [O5] [C9] [C14] [D8] |
| `GET /workflow-runs`, `GET /workflow-runs/{id}` | 1.7 | `workflow.read` | [O6] [D8] |
| `GET /workflow-versions` | 1.6 | `workflow.read` | [O7] [C13] |
| `POST /accounts/{account-id}/run-action` | 1.2; file parameters uploaded the same way since 2026-10-27 | not stated in the spec | [O24] [C14] |

### 1.11 Testing: Simulate

Sandbox only. Pick a start and an end step on one execution level, give a trigger object (existing, new from a template, or
none), override step inputs or outputs (for example a report match), run, and inspect the path; links to records the simulation
created are shown. Only inquiry, case and transaction event-triggered workflows; not API, recurring, scheduled or other events;
not modules on their own [H12]. Whether simulated actions have real side effects (emails sent, reports billed) is **not
documented**; the article shows real report ids being created **(inference: side effects are real inside the sandbox)**.

### 1.12 Plan gating (not relevant to OpenVerify, recorded for completeness)

Many steps are gated by the vendor's plans ("enhanced" features: API and scheduled triggers, Evaluate Code, HTTPS requests,
Schedule Workflow, Send Email and SMS, modules, loops) [H2] [H3] [H22] [H25] [H26] [H21] [H20]. A self-hosted OpenVerify has no
plans; every step is available.

### 1.13 OpenVerify today

At `3b4ef08` (read 2026-10-27, Phase 6 in progress) there is no `packages/workflow-engine`, no workflow, run, case or queue
resource, no `wfl`/`wfr`/`case` id prefix, and no workflow or case scope; the API scopes stop at the Phase 6 report scopes
[R5] [R6]. Inquiry decisions exist as `approve_inquiry`, `decline_inquiry`, `mark_for_review_inquiry` actions with the
transitions `completed|failed|needs_review → approved|declined` and `completed|failed → needs_review` [R7]; tags exist with
`add-tag`/`remove-tag` (`meta.tag-name`) and `set-tags` (`meta.tag-names`) [R8].

## 2. The action catalogue

The developer docs list 21 actions [D1]; the Help Center documents about 45 step articles, grouped in the editor under App
Integration, Case, Communicate, Compute, Inquiry, List, Report and Other (plus Accounts, Graph, Transaction, Verification and
Marketplace in the step paths) [H2] [H3]. Display names are the vendor's; this note uses them only as identifiers for parity.
Machine keys are documented for one action only: `run_report` [O8]. Every action has the "continue on error" option unless
stated [H40]–[H83]. "In / out" is what the step takes and what later steps can read.

### 2.1 Inquiry

| Action | In / out | Side effects and rules | Sources |
|---|---|---|---|
| Approve Inquiry | the inquiry | `inquiry.approved`; the API path takes an optional `meta.comment` for audit and stops further progress on the inquiry; it starts other workflows and webhooks | [H40] [O25] [D4] |
| Decline Inquiry | the inquiry | `inquiry.declined`; same body and rules | [H41] [O25] |
| Mark Inquiry for Review | the inquiry | `inquiry.marked-for-review` (status `needs_review`); an approved or declined inquiry cannot be marked; no body in the API path | [H42] [O25] [H129] |
| Create Inquiry | an inquiry template, optionally an account / the new inquiry | creates an inquiry (and its events) | [H43] |
| Inquiry Link Email | address, inquiry, subject, greeting, body, call to action, an "include session token" option / — | sends the link by email; the session-token option lets anyone holding the link continue the same session (the vendor flags the security trade-off) | [H44] |
| Send Inquiry Link SMS | phone, inquiry / — | fixed message text that states the expiry; expiry configurable, default given as 60 seconds; changing it changes the text | [H45] |

### 2.2 Case

| Action | In / out | Side effects and rules | Sources |
|---|---|---|---|
| Create Case | a case template (fields and other attributes may be set) / the case | `case.created`; the template decides the team and the layout; assignment follows the template's or a global policy (3.4) | [H50] [H97] |
| Assign Case | case, assignee type (a user or a team), assignee | `case.assigned`; the assignee is notified; `assigner-type: workflow-run` | [H51] [O10] [C4] |
| Update Case Status | case, status | `case.status-updated`, and `case.resolved` when the status is an end status **(inference: the events page does not tie them)** | [H53] [D4] |
| Add Comment To Case | case, text | a comment visible to the team | [H54] |
| Add Case To Queue | case, queue | `case.queue-updated` | [H55] [D4] |
| Attach Objects To Case | case, objects / — | attaches **a snapshot**: an inquiry attached while pending carries only the verifications finished at that moment; at most 1,000 objects per case; an object attaches to a case only once | [H56] [H118] [C2] |
| Set Case SLA | case, a target in minutes, hours or days | sets `sla-expires-at`; the Help Center says up to about 61 days, the API says up to 90 days (3.6) | [H57] [H100] [O15] |
| Clear Case SLA | case | clears the deadline | [H58] |
| Send Case Message | new message (case) or reply (an earlier case message), to, cc, a message template from the case template's email module | `case-message.sent` **(inference from the event name)**; content cannot be edited in the step | [H52] [D4] |

### 2.3 Report, verification and graph

| Action | In / out | Side effects and rules | Sources |
|---|---|---|---|
| Run Report | a report template; the report fields, editable; the object to run against (inquiry or account) / the report | creates and runs a report; key `run_report`; a missing input is a `missing-input-error` naming the field (for example `report_template_id`) | [H66] [O8] |
| Run Verification | a verification template, field values (defaulted from the trigger), a "complete on tentative" option, and a sandbox-only "override default status" (also exposed as `debug_forced_status`) / the verification | creates and runs a verification | [H67] [H27] |
| Run Graph Query | a graph query template and its fields; optional snapshot; optional asynchronous mode / the query | asynchronous mode needs a later Wait on `graph-query.completed`; a read before completion sees an account count of `-1` (running), not `0` (finished, none) | [H68] |
| Sync Graph | an account; a mode: non-embedding similarity nodes (default), all nodes, or selective (named templates) | brings the account's graph data up to date; skipping it does not error but queries stale data | [H69] |
| Run MX Bank Get Account Owners Report | a vendor report template | third-party report | [H83] |

### 2.4 List, account, transaction and device

| Action | In / out | Side effects and rules | Sources |
|---|---|---|---|
| Get List Match | a list, the item fields and the value / a boolean | none (a read) | [H70] |
| Add Item To List | a list, item fields and the value | adds a list item (creator: the workflow run, per the Phase 7 notes) | [H71] [R9] |
| Add Item To Face List | an inquiry-producing earlier step (trigger, Create Inquiry, Fetch Object), a face list | adds the inquiry's face; only after an inquiry-based step | [H72] |
| Find or Create Account | account type, identifier kind (for example reference id), identifier value (concatenable) / the account | creates the account when none matches | [H73] |
| Create Transaction | transaction type and fields / the transaction | creates a transaction | [H74] |
| Update Transaction Status | transaction, status (defaults `created`, `approved`, `declined`, `needs_review` plus custom) | status change and its event | [H75] |
| Set Relation / Unset Relation | source object, relation key, target object | adds or removes an account or transaction relation; relations are read as `account.relations.<key>` | [H76] |
| Trust Device | not documented | marks devices as trusted; no article, inputs or effect are public | [D1] |

### 2.5 Any object

| Action | In / out | Side effects and rules | Sources |
|---|---|---|---|
| Tag Object | an object, one or more tags (existing or new) | adds tags; taggable: accounts, cases, inquiries, reports, transactions, verifications | [H59] [H130] |
| Remove Tag | an object, tags | removes tags | [H61] |
| Copy Tags | from, to, excluded tags | copies tags between objects | [H60] |
| Fetch Persona Object | object type, id / the object | a read, so later steps can act on any object | [H62] |
| Update Object | an object, a list of `{field, operator, value}` with `set`, `unset` (any type), `append`, `push`, `remove` (arrays) | writes fields on cases, accounts, inquiries and other objects | [H63] |
| Redact Object | an object; all PII or selected fields | permanent; cascades downstream (an account redacts its inquiries; an inquiry never redacts its account); cases, lists and exports redact only themselves; field-level redaction is possible only through this step | [H64] [H65] [D1] |

### 2.6 Compute and control

| Action | In / out | Rules | Sources |
|---|---|---|---|
| Evaluate Code | JavaScript, named properties (fields or objects), a return type (`Boolean`, `Number`, `Object`, `String`, nothing) / the value | a type mismatch errors the step; a test run with stub arguments in the editor; retry intervals (several, "assessed in parallel"); continue on error. The runtime, the engine, CPU and memory limits, the time limit, network access and the APIs the code can call are **not documented**; the vendor's own examples call third-party APIs from code (for example a risk vendor's scores), so outbound network access exists in some form **(inference)** | [H22] [H24] |
| Custom functions | see 1.5; sandbox runs "with the sandbox limits in place" (not stated) | | [H23] |
| Calculate | variables, each `operator` (`add`, subtract, multiply, divide, `SUM`, `AVG`), `left`, `right`, `default` (used when the operation fails); one return variable | | [H77] |
| Update Variable | variable, `set`/`unset`/`push`/`remove`, value | | [H14] |
| Make HTTPS Request | 2.7 | | [H25] [D2] |
| Run Workflow | another workflow | starts a separate run (the docs say chaining) | [D1] |
| Schedule Workflow | target workflow, the object the scheduled run is about, base time (this run, or a date field), offset, units, before or after | a later separate run (`scheduled-run` creator); the vendor's answer to waits over 30 days | [H26] [D2] [O4] |
| Transliterate Fields (early access) | name and address fields / romanised output variables | in-process (no external call); Chinese (Pinyin), Japanese, Korean, Arabic (ICAO), Cyrillic, Georgian, Armenian, Devanagari; not Hebrew or Thai | [H79] |
| Module | 1.3 | | [H21] |

### 2.7 Make HTTPS Request

- **Methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`; a JSON body for `POST`, `PUT`, `PATCH` [H25]. The developer docs still say "POST and GET" [D1].
- **URL** typed or taken from the run; **headers** as key and value pairs, values interpolated, typically
  `Authorization: Bearer {{current_run.environment.secrets.…}}` [H25] [H9].
- **Signing:** a step secret signs the request with `Persona-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, the
  same scheme as webhooks; the vendor advises verifying it on every POST and reusing the webhook secret if the same endpoint
  already verifies webhooks [D2] [O28].
- **Response:** an optional response schema describes what the step reads back [H25]; the parse rules (content types, size cap,
  non-2xx handling) are **not documented**.
- **Retries and timeout:** a list of retry intervals and a request timeout in seconds, after which the step errors [H25]. Which
  responses are retried (network errors only, 5xx, 429) is **not documented**.
- **Address restrictions** (private ranges, DNS rebinding, redirects, allowed ports): **not documented**. The step is gated to the
  vendor's higher plans [H25]. Everything OpenVerify does here (PLAN §3: private ranges blocked, DNS-rebinding defence) is ours
  [R1].

### 2.8 Communicate and third parties (all need an account the operator holds)

| Action | Inputs | Notes | Sources |
|---|---|---|---|
| Send Email | to, subject, HTML body with a text fallback; advanced: from, SMTP host, port (25 default; 587, 110, 465, 2525), TLS, user, password, HELO domain | without SMTP settings mail goes from the vendor's own no-reply address; the vendor advises sending only with consent | [H46] [H47] [D1] |
| Send SMS | to, text | consent advised | [H48] [D1] |
| Send Slack Message (OAuth) | workspace (installed through the vendor's marketplace), recipient type (user or channel), recipient id, message | | [H49] |
| Zendesk, Salesforce, HubSpot | create, update, search records or tickets, add or remove ticket tags, through OAuth instances | | [H80] [H81] [H82] |
| GPT Generate Message | the customer's OpenAI key, model, prompt, max tokens, temperature, top-p, frequency and presence penalties | | [H78] |

### 2.9 What the catalogue leaves open

- Machine keys of every action except `run_report`; the JSON shape of each step's configuration and output [O8].
- Idempotency of actions on resume: whether "resume from the last failed step" can repeat an email, an HTTP call or a report
  run that had partly happened is **not documented** [H10].
- Trust Device's inputs and effect [D1].
- Evaluate Code's runtime and limits [H22].
- HTTPS request network rules and response handling [H25].

## 3. Cases

### 3.1 The case object

`case` (`case_`). Attributes: `status` (a string defined by the template: the examples mix `Open` and `open`), `name` (short
names such as `MRR-3` or `KCAS-1`; that they are the template key plus a counter is **(inference)** from the template key
being shown in the case list [H92]), `resolution` (nullable), `created-at`, `updated-at`,
`assigned-at`, `resolved-at`, `redacted-at`, `sla-expires-at`, `creator-id`/`creator-type` (`user`, `workflow-run`),
`assignee-id`, `assigner-id`/`assigner-type` (`case-assignment-policy`, `user`, `workflow-run`), `resolver-id`/`resolver-type`
(`api-key`, `user`, `workflow-run`), `updater-id`/`updater-type` (`api-key`, `case-assignment-policy`, `user`,
`workflow-run`), `tags` (names), `fields` (template-defined, keys never inflected), `attachments[] {filename, url, byte-size}`.
User actors are identified by email address in these attributes (the examples use addresses at the vendor's domain); policies
by `cap_…`, runs by `wfr_…` [O10] [C4] [C5] [C7] [C9]. Relationships: `case-template`, `case-queue` (nullable),
`case-comments`, `accounts`, `inquiries`, `reports` (polymorphic `report/<type>`), `verifications` (polymorphic
`verification/<type>`), `txns` [O10] [C1] [C6]. The `included` union covers accounts, comments, templates, queues, inquiries,
23 report types, transactions and 13 verification types [O14].

A case can also carry arbitrary external data as JSON through its fields [D5].

### 3.2 Case templates

| Aspect | Public behaviour | Sources |
|---|---|---|
| Resource | `case-template` (`ctmpl_`): `status` `active`/`archived`, `name`, `resolutions[]` (for example `Approved`, `Declined`), `created-at`, `updated-at`, `archived-at`, `field-schemas[] {type, key, label, config}` (the same field-schema union as accounts and transactions; the example shows `string` with `max-char-length` and `sanitize`, and `multi-choices` with `options` and `allow-empty`) | [O11] [C11] |
| API | `GET /case-templates/{id}` only (since 2026-05-04, scope `case_template.read`); no list, create or update | [O11] [C11] [O27] |
| Creation (dashboard) | name, a template key (prefix of case names in the list), and the roles that can see cases of this template | [H92] |
| No versions | Edits apply at once to new cases; existing cases keep the layout they had when created; no history, no undo | [H93] [H92] |
| Layout | Tabs, each a screen of drag-and-drop modules (3.11); non-visual settings (fields, statuses, actions) live under Settings; the same editor serves account-type layouts | [H92] [H124] |
| Fields | Field editor: label, key (used by the API), type (array, date, integer, string and others); create, edit, deactivate, delete; defaults; type conversion keeps the key; up to 10 filterable fields (not calculated, file, hash or relation); search over `fields.*` needs the field marked searchable | [H114] [H115] [O17] |
| Statuses | Each template has its own; `initial` (exactly one; new cases start there), `intermediate`, `end` (the decisions); defaults Open, Pending, Approved, Declined | [D6] [H53] [H91] |
| Status rules | Optional status tags per status (a reason picked on change; can be required); a required comment on entering a status; a checklist module whose items can be required before given statuses; a rule that disables the status switcher until conditions hold | [H91] [H101] [H121] |
| Assignment | A template-level policy (distribution method and assignees: all users, a subset, or teams), superseded by global policies where used (3.4) | [H92] [H94] [H95] |
| Notifications | Chosen users are emailed when a case of this template is created | [H92] |
| Actions | Workflow actions (published workflows with an on-click trigger and a parameter form, prefillable from `case.fields.…`, `inquiry.fields.…`, `account.fields.…`) and system actions (update fields, update tags, update queue, update SLA, redact); each can be shown or disabled by rule; placed in the header menu, on a button component, or on rows of data-table and resource modules | [H33] [H34] [H127] |
| Events | `case-template.converted-field`, `case-template.deleted-field` (the events page lists the first twice) | [D4] |

### 3.3 Statuses and transitions

- `status` is a template-defined label; its category (initial, intermediate, end) decides the lifecycle; search also exposes a
  `state` attribute whose values are **not documented** (we read it as the category, **inference**) [D6] [O17].
- `POST /cases/{id}/set-status` with `meta.status` (required in `meta` since 2025-10-27) [O21] [C9].
- Entering an end status sets `resolution`, `resolved-at` and the resolver, and fires `case.resolved`; leaving it fires
  `case.reopened` (the reopened example shows `resolution` back to null) **(inference from the example payloads)** [O23].
- Which transitions a template permits is enforced ("only transitions permitted by each case template's status rules are
  applied" in bulk changes), but the rule language is **not documented** beyond the switcher, status tags, required comments and
  checklists [H103] [H91].
- A Workflow commonly waits for the case to resolve, then approves or declines the inquiry from the resolution [H129] [H27].

### 3.4 Queues and assignment

- **Queue** `case-queue` (`cqueue_`): `status` `active`/`archived`, `name`, timestamps; archiving is permanent; a case is in at
  most one queue; set with `case-queue-id` on create or update (null removes) [O12] [C6] [H94].
- Queues group cases by filters on status, tags, verification check status and report matches, as determined by global
  assignment policies; cases enter a queue through a workflow step or a case action (for example a status change a queue picks
  up). The dashboard queue view filters by date range and assignees and searches by case, reference, account or inquiry id
  [H94] [H55].
- **Global assignment policies** (`cap_…` as assigner): a distribution (round robin, case creator, inquiry creator, fewest open
  cases), a sort order (created at, SLA expiration), agents (teams and users; all by default), "assign when agent is" and
  "unassign when agent is" availability filters, a per-agent maximum case capacity, and routing sources (case templates or
  queues) in priority order, each drained by the sort order [H94] [C5].
- **Availability**: available, busy, unavailable, set by each user; assignment follows it only when the policy says so;
  `user.availability-updated` event [H96] [D4].
- **Teams** group users for assignment and analytics filters [H95].
- **Manual**: `POST /cases/{id}/assign` with `meta.user-email-address` (required); the Assign Case step can target a user or a
  team; bulk assign replaces existing assignees [O20] [H51] [H103].
- What happens to an assignment when a case resolves, the tie-breaking in fewest-cases and round-robin state across restarts are
  **not documented**.

### 3.5 SLA

- `meta.sla-expires-in-seconds` on create and update (seconds from now, at most 90 days, `null` clears) sets
  `sla-expires-at` [O15] [O16] [C3]. The workflow step takes minutes, hours or days, described as up to "about 61 days" [H57]
  [H100]: the two limits disagree.
- Set also by the Update SLA system action (a date and time) and cleared by Clear Case SLA [H33] [H58].
- **Expiry.** `case.sla-expired` fires when the deadline passes [D4] [O23]; the example payload shows an open case. Whether it
  fires for a case already resolved, whether it fires once or again after a new SLA, and the detection latency are **not
  documented**; we read "expired" as "deadline reached while unresolved" **(inference)**.
- Assignees get a breach notification; AML case management adds reminders a chosen interval before the deadline; lists sort by
  SLA; global policies can prioritise by SLA [H100] [H102] [H125] [H99] [H94].

### 3.6 Comments

- `POST /cases/{id}/add-comment` with `meta.message` (string, at least one character); it answers the case [O18].
- `case-comment` (`cscm_`): `message` (null once redacted; identifiers and times kept), `created-at`, `updated-at`,
  `redacted-at`, `commenter-id` (an email in the example), `commenter-type` (`user` in the example) [O13].
- Mentions: a user tagged in a comment is notified [H102]; the mention syntax is **not documented**. Editing and deleting
  comments are **not documented** (`updated-at` exists) [O13].
- Preset comments (saved texts) in the comments module; required comments on chosen status changes [H107] [H106] [H101].
- `case-comment.created` is on the events page with no webhook file [D4] [O27].

### 3.7 Attachments

- Added with `PATCH /cases/{id}` `data.attributes.attachments[] {data (base64), filename}`, described as PDF and image files;
  read back as `attachments[] {filename, url, byte-size}` with an access-token URL on the vendor's file host [O16] [O10] [C7].
- The attachments module uploads and shows PDF or image files [H108]. A size limit for case attachments is **not
  documented**; the email module's limit is 15 MB per email, with a listed set of file types [H119].
- No attachment event exists [D4].

### 3.8 Tags

- `add-tag` (`meta.tag-name` or `meta.tag-id`), `remove-tag` (same), `set-tags` (`meta.tag-name[]` and/or `meta.tag-id[]`;
  replaces all); `tags[]` on create creates missing tags [O22] [O15].
- `case.updated-tags` carries `context.added-tags[]` and `context.removed-tags[]` [O23].
- A tag manager governs tags organisation-wide (search, deactivate) [H130].

### 3.9 What a case holds

- `meta.object-ids` on create and `add-objects` accept accounts, documents, graph queries, inquiries, reports, report runs,
  SARs, transactions and verifications; `remove-objects` is idempotent (detaching an absent object is a no-op; since 2026-06-01)
  [O15] [O19] [C12].
- Each object attaches to a case once; at most 1,000 objects per case [C2] [H118].
- Attaching takes a **snapshot** of the object's state (the workflow article says so for inquiries) [H56]. How a snapshot is
  stored or refreshed is **not documented**.
- Search matches `account_id`, `inquiry_id` and `tag_id` only against the 50 most recently added of each [O17].
- Related cases (through linked accounts) appear in a module [H104].

### 3.10 Redaction

- `DELETE /cases/{id}` redacts permanently, case by case; `case.redacted`; the example shows fields, tags, attachments and
  actor attributes cleared, relationships kept [O16] [O23].
- Case redaction does not cascade: cases, lists and exports redact only themselves, while an account's redaction cascades to
  its inquiries [H64] [H65]. Whether redacting an inquiry or an account touches the cases holding it is **not documented**.
- Comments keep identifiers with a null message after redaction [O13].
- An organisation-wide redaction policy (2 days to 2 years) is enabled by the vendor; it is off by default to protect graph
  and case use [H65].

### 3.11 Export and print

- **Export.** The dashboard exports the filtered case list as one CSV with linked object ids (account, inquiry, report) and
  tags; finished exports are listed with creator and time and announced by email; an unfiltered export is every case ever;
  exports contain PII; the "Export Cases" permission is separate from case access [H117] [H128]. `case.exported` is the event
  [D4] [O23]. There is no export API path [O27].
- **Print.** Only the event `case.print-initiated` and a role setting that covers "export, download PDF, and print" across
  products are public; what a printed case contains is **not documented** [D4] [H123]. (Verifications have a public `print`
  path; cases do not [R4].)
- SAR cases export XML or PDF for filing (AML product) [H123] [H125].

### 3.12 The reviewer screens

The case page is the template's layout: tabs of modules. Documented modules [H104]: inquiry (attached inquiries, each
expandable, fields chosen per template), verifications (one verification's details; government ID or selfie fields
configurable), account, report, report run, transaction, data table, data display, info (status, assignee, SLA), comments,
event timeline (every event on the case and its attached objects, for debugging), tags, list matches, **gallery** (images and
files from a chosen data path: government ID front photos, the first file of document verifications, selfie centre photos),
markdown, graph, signals, checklist, location, device (IP, threat rating, network country), attachments, email, account
similarity by selfie (other accounts whose consented selfies matched), assignee history, select and input components, buttons,
SAR and STR. Modules can be hidden by role and by rules (field, condition, value; AND and OR groups) [H105] [H109] [H110]
[H111] [H112] [H113].

**Side-by-side images** are not documented as such: the gallery shows ID front, selfie and document images together in one
module [H109]; a dedicated face-comparison layout (ID portrait beside selfie, with the match score) is **not documented** and
would be ours.

Bulk actions on the list: assign, change status (respecting template rules), change queue, add or remove tags; asynchronous,
logged on each case's timeline with the actor and the old and new values [H103]. Saved views and column configuration exist
[H123].

### 3.13 Case events and webhooks

| Event | Webhook file | Notes | Sources |
|---|---|---|---|
| `case.created`, `case.assigned`, `case.resolved`, `case.reopened`, `case.status-updated`, `case.queue-updated`, `case.updated-fields`, `case.sla-expired`, `case.exported`, `case.redacted` | yes | payload: the case with `included` objects; `context` empty in the examples | [O23] [D4] |
| `case.updated-tags` | yes | `context.added-tags`, `context.removed-tags` | [O23] |
| `case.updated` | no | on the events page only | [D4] |
| `case.agent-reviewed` | no | an AI case-review agent reviewed the case | [D4] [H122] |
| `case.print-initiated` | no | | [D4] |
| `case-comment.created` | no | | [D4] |
| `case-message.sent`, `case-message.received` | no | email module | [D4] |
| `case-template.converted-field`, `case-template.deleted-field` | no | | [D4] |

### 3.14 Permissions

- API scopes: `case.read`, `case.write`, `case_template.read` (the template scope added for the 2026-05-04 endpoint) [D8] [C11].
- Dashboard permissions: case details (create, list, view, edit, which covers resolving and taking actions), case templates,
  case actions, assign, bulk assign, bulk resolve, case analytics, case list table (changes the shared view), SAR details,
  export, file and configuration; organisation settings to redact and to export, download PDF and print across products; team
  management permissions [H123] [H95].
- Template visibility by role; module visibility by role; the vendor presents audit logging, checklists, comments and
  role-based PII access as the compliance basis of cases [H92] [H105] [H90].

### 3.15 The API surface for cases

| Method and path | Body | Notes | Sources |
|---|---|---|---|
| `GET /cases` | `filter[status]`, `filter[case-template-id]`, `filter[account-id]`, `filter[reference-id]`, `filter[inquiry-id]`, `filter[report-id]` | newest first, cursor pages | [O15] |
| `POST /cases` | `data.attributes {case-template-id (required), creator-email-address, case-queue-id, fields, tags[]}`, `meta {object-ids[], sla-expires-in-seconds}` | 201; custom fields only under `fields` since 2025-10-27 | [O15] [C9] |
| `GET /cases/{id}` | — | `include` | [O16] |
| `PATCH /cases/{id}` | `data.attributes {attachments[], case-queue-id, fields}`, `meta.sla-expires-in-seconds` | | [O16] |
| `DELETE /cases/{id}` | — | redact | [O16] |
| `POST /cases/{id}/set-status` | `meta.status` | | [O21] |
| `POST /cases/{id}/assign` | `meta.user-email-address` | | [O20] |
| `POST /cases/{id}/add-comment` | `meta.message` | | [O18] |
| `POST /cases/{id}/add-objects`, `remove-objects` | `meta.object-ids[]` | | [O19] |
| `POST /cases/{id}/add-tag`, `remove-tag`, `set-tags` | `meta.tag-name`/`tag-id` (arrays for set) | | [O22] |
| `POST /cases/search` | `query` (AND/OR/NOT, depth 2, at most 20 clauses per AND or OR, leaf `{attribute, operator (eq, gt, gte, lt, lte), value}`), `sort {attribute, direction}`, `page {after, before, size 1–100, default 10}` | eventually consistent (about a minute; not for read-after-write); attributes `template`, `case_template_id`, `status`, `state`, `resolution`, `created_at`, `updated_at`, `resolved_at`, `sla_expires_at`, `assignee`, `case_queue`, `case_queue_id`, `resolver`, `account_id`, `inquiry_id`, `tag_id`, `fields.*`; some not sortable | [O17] [C10] |
| `GET /case-templates/{id}` | — | | [O11] [C11] |

There is no public path to list templates, list or manage queues, read or edit comments, manage assignment policies, export or
print [O27]. Case creation has a per-environment creation quota [D9].

### 3.16 Analytics, notifications and the AI agent (recorded, mostly later)

- Analytics: totals by status, resolution-time percentiles (p50, p75, p95, in hours), assignment distribution, availability
  time metrics (computed per UTC day, about 6 hours behind) [H116].
- Notifications (dashboard or email): assigned to me, SLA breached on my case, tagged in a comment; per-template "case created"
  emails [H102] [H92].
- Case Review Agents: an LLM reviews a case against instructions, with decision authority configurable (recommend or decide);
  `case.agent-reviewed` [H122] [D4]. Out of scope for an open-source Phase 8 (needs a model provider; ADR 0002 tier A at best).

### 3.17 OpenVerify today

No case, case template, queue, comment or assignment resource; no `cases:*` scope; the dashboard has inquiry review pages with
images but no case pages; PLAN §2's Cases row lists the features of this section without the events page's extra events [R1]
[R4] [R6].

## 4. Where workflows and cases meet reports, lists, graph, transactions and the dashboard

**Reports (Phase 6 C88 and decision 28).** Phase 6 deferred "the workflow Run report action and match conditions" and "cases
holding reports" to Phase 8, and shipped an inquiry-template rule `on-report-match: needs_review` (ours, off by default, also
covering an errored completion report) as the stopgap [R2]. Publicly, a workflow runs a report from a template against an
inquiry or account, with editable report fields, and later steps condition on "report criteria" such as a watchlist or
adverse-media match [H66] [D1]; report events (`report/<type>.ready`, `.matched` and the rest) can start workflows because
every event on the events page can [D4] [R2]. The vendor's recommended shape is: run reports in parallel, tag on a hit, create
a case, attach the report, wait for the case to resolve, then decide the inquiry [H27] [H14]. Cases hold reports and report runs
through `object-ids` and show them in report and report-run modules [O15] [H104]. The exact field a condition reads for "has a
match" is **not documented**; Phase 6's `has-match` attribute (ours, defined) is the natural target (**inference**). Nothing
public replaces `on-report-match`; Phase 8 can ship an equivalent seeded workflow and keep the rule for installs without
workflows (ours).

**Lists (Phase 7 C110).** Get List Match (a boolean), Add Item To List and Add Item To Face List (only after an inquiry-based
step, so the image comes from a consenting inquiry in OpenVerify's Phase 7 terms) are the public steps [H70] [H71] [H72]
[R10]. Cases show list matches in a module [H104]; the inquiry page shows matches made "during the inquiry" and by workflows
[H85]. The public product has no list events, so "re-screen a custom-list report when its list changes" (Phase 7 C110 and
decision 41) has no public trigger; Phase 7's own `list-match.created` (ours) is the natural event trigger, and a list-version
change trigger would be ours too [R10].

**Graph (Phase 7 C110 and GR6).** Run Graph Query (a template, fields, an optional snapshot, an asynchronous mode that must be
followed by a Wait on `graph-query.completed`, the `-1` count while running) and Sync Graph (modes) are public [H68] [H69].
Phase 7 indexes the graph synchronously and needs no Sync step, so Sync Graph can be a no-op that only validates its account
(ours) [R10]. Cases accept graph queries in `object-ids` and have a graph module [O15] [H104]. The explorer's "create case"
bulk action, deferred by Phase 7, needs Phase 8's case create [R10].

**Transactions (Phase 7 C110 and T10).** Create Transaction, Update Transaction Status and Set/Unset Relation are public steps;
`transaction.created` is the documented API-first trigger; Run Verification's sandbox-only `debug_forced_status` can read a
transaction field [H74] [H75] [H76] [D3] [H27]. Cases hold transactions (`txns`) and have a transaction module; simulation
supports transaction event triggers [O10] [H104] [H12]. Persona's transaction redaction cascades to child objects; Phase 7
deferred that cascade because only Phase 8 creates children (inquiries, verifications and reports made by a workflow run that a
transaction triggered) [R10]. How the public product records that a workflow-created object is a transaction's child is **not
documented** (**inference: through the run's trigger object**).

**Signals and auto-decline (Phase 7 decision 18).** Phase 7 never declines on a signal; it leaves that to a Phase 8 workflow
[R10]. The public examples do exactly that (decline when an inquiry's IP is on a list; mark for review on IP-versus-entered
location distance) [H1] [R10]. Phase 8 makes this possible but not the default (ours: section "Needs the owner").

**Accounts.** Account actions are workflows with an account trigger and a parameter form, runnable from the account page and
`POST /accounts/{id}/run-action` [H32] [O24]; Find or Create Account and Update Object write accounts [H73] [H63]. Phase 6 left
"re-screening when a linked account's fields change" to a Phase 8 workflow trigger (`account.updated-fields`) [R2] [R10].

**Dashboard (Phase 9 overlap).** The public editor is a canvas of steps with a side panel per step, a variables panel, a
diagnostics panel, version history, staged rollout, a runs table with outputs and a decision-tree view, and Simulate in sandbox
[H3] [H11] [H12] [H14]. Case templates use a separate tabbed layout editor with modules [H92] [H124]. PLAN puts the workflow
editor (@xyflow/react) in Phase 8 and the inquiry flow builder in Phase 9 [R1]; the case layout editor is not named in either
phase (**owner question**).

**What the public product defers or leaves undocumented here:** the recurring trigger's cadence and filter; the verification
trigger's configuration; Trust Device; Evaluate Code's runtime and network rules; HTTPS request network rules and response
parsing; run statuses as an enum, cancellation, run lifetime and retention; workflow create, edit and publish by API; the
condition serialisation; how a snapshot of an attached object is kept; case transition rules; print contents; comment edits
and deletion; SLA expiry semantics for resolved cases.

## What Phase 8 should take from this (proposed)

Recommendations for the Phase 8 plan, not decisions; owner questions follow. The engine, sandbox and editor engineering is the
subject of the sibling notes `phase8-workflow-engine.md`, `phase8-actions-sandbox.md` and `phase8-editor-cases.md`; this list
fixes only the public contract and its honest limits.

### Must match (parity)

1. **Ids and resources.** `wfl`, `wfv`, `wfd`, `wfr`, `srrun`, `case`, `ctmpl`, `cqueue`, `cscm` in `ID_PREFIXES`, plus ours
   for case template versions, assignment policies (`cap`), modules, secrets and step runs. Zod schemas are the contract and
   generate the OpenAPI, as usual.
2. **Workflow version attributes** of 1.1 (`trigger-type` with its eight values, `live`, `rollout-label`,
   `rollout-percentage`, `inputs`, `outputs`, `description`, `published-at`) and the run attributes and relationships of 1.7
   (`creator` of type `user`, `api-key` (ours), `event`, `scheduled-run`).
3. **Triggers:** event (with criteria, several workflows per event, no ordering, not retroactive), API
   (`POST /workflows/{id}/trigger` with `data.attributes.fields`, the version's input schema, file values as
   `{filename, data}`), scheduled (from Schedule Workflow), account and case actions with parameter forms (and
   `POST /accounts/{id}/run-action` answering `workflow-run-id`), manual runs from ids, Run Workflow.
4. **Steps:** action, wait (object events with a default resolution time, or time; both at most 30 days; continue, or error on
   expiration), parallel, conditional (ordered routes, AND groups OR'd, else), loop (for each, while, map; sequential or
   parallel; at most 100), module (inputs, no nesting, one run), output; continue on error everywhere; run variables.
5. **References:** method-chain paths from `trigger`, `current_case` and `current_run`, the documented operators, `{{ … }}`
   interpolation, `current_run.environment.secrets.<key>` with `[REDACTED]` in every log and output.
6. **Versioning:** draft, publish (locked), staged rollout with treatment and control, restore, per-environment active state,
   archive.
7. **Runs and errors:** `in_progress`, `completed`, `errored`; the `errored-step` and `error.type` context; resume from the
   failed step and rerun with the latest version; each run pinned to its version.
8. **Events:** `workflow-run.created`, `.resumed`, `.errored`, `.completed`, `workflow.published`,
   `workflow-version.published`; the eleven case webhooks plus `case.updated`, `case.print-initiated`, `case-comment.created`.
9. **Actions** of section 2 marked MATCH, including every Phase 6 and Phase 7 deferral (Run Report with `has-match` in its
   output; Get List Match, Add Item To List, Add Item To Face List; Run Graph Query, Sync Graph; Create Transaction, Update
   Transaction Status, Set and Unset Relation; Trust Device as ours).
10. **Cases:** the resource, template, queue and comment attributes of 3.1–3.6; status categories with exactly one initial
    status; `set-status` with `meta.status`; `assign` with `meta.user-email-address` (and our `user-id`); comments with
    `meta.message`; attachments as base64 through `PATCH`; tags with `tag-name`/`tag-id`; `object-ids` with once-only
    attachment, the 1,000 cap and idempotent removal; `meta.sla-expires-in-seconds` (90 days, `null` clears); redaction without
    cascade; the list filters and `POST /cases/search` with the same body; CSV export with linked ids and tags; bulk assign,
    status, queue and tags.

### Ours, keep and label

1. **JSONLogic** as the stored condition format (PLAN), a restricted operator set, and a documented mapping from method-chain
   paths; the editor's picker writes it.
2. **Execution guarantees the vendor does not state:** at-least-once step execution with a per-attempt idempotency key so a
   resume never repeats a completed side effect; join-all parallel semantics; a cancel path; durable timers for waits, SLAs
   and schedules; a per-workflow concurrency cap; per-run limits (steps, wall time); run retention under C16.
3. **Make HTTPS Request** with the vendor's configuration and signing scheme, and our SSRF guard (HTTPS only, resolved-address
   checks at connect time against private, loopback, link-local, CGNAT, multicast and documentation ranges for IPv4 and IPv6,
   no redirects by default, size, time and content-type caps, retries only on network errors, 429 and 5xx). State what it does
   not cover: a public endpoint the operator allows can still be malicious; responses are untrusted data; secrets sent in
   headers leave the platform.
4. **Evaluate Code** in QuickJS with memory, stack and time limits, JSON in and out, no network and no host objects by default.
   State what it does not cover: a QuickJS or WASM escape is a vulnerability outside our control; CPU exhaustion inside the
   limits still costs a worker slot; code that is given secrets can return them.
5. **Third-party actions** (email, SMS, Slack) only as adapters with deterministic sandbox providers that record what would
   have been sent (ADR 0002 tier A; CLAUDE.md rule 5) [R3] [R11]; no per-step SMTP passwords; one-time links in inquiry-link
   messages. Any client library such an adapter needs must pass rule 4's licence list, which the sibling notes check [R11].
6. **Workflow and case template APIs** (create, version, publish), a queue API, comment listing, export by API: the public
   product exposes none, and self-hosters need configuration as code.
7. **Versioned case templates** that cases pin; allowed transitions per version.
8. **Case actor ids** instead of emails; append-only comments; attachment caps and type checks; attachments in sealed storage
   with short-lived URLs.
9. **SLA expiry defined:** fires once per deadline, only while unresolved, re-armed by a new SLA.
10. **A comparison panel** in the case reviewer (ID portrait beside the selfie, the face-match score and liveness result with
    their tier and stage), because the public product documents only a gallery.
11. **Environment-scoped workflows** with a promote action (owner question 1).

### Build order (proposed slices)

1. **Contracts first:** ids, resources, events, scopes, the workflow definition schema (steps, actions, conditions, inputs and
   outputs), the run and error contract, the case resources; stubs, then RED tests.
2. **Engine core:** definitions and versions, the publish rules, event and API triggers, action steps with idempotency, waits
   and timers, conditional, parallel, loop, module, variables, secrets, errors, resume and rerun, cancel, run events.
3. **Action library on existing services:** inquiry decisions, tags, objects, redaction, reports, accounts, lists, graph,
   transactions, devices.
4. **Sandboxed actions:** Make HTTPS Request with the guard; Evaluate Code in QuickJS; email, SMS and Slack adapters with their
   sandbox providers.
5. **Cases:** templates and versions, statuses and transitions, queues, assignment policies, SLA timers, comments, attachments,
   tags, objects, redaction, search, export, bulk actions, case and account actions as triggers.
6. **Dashboard:** the @xyflow/react editor (definition round-trip, validation, diagnostics), runs view with step logs, version
   history and rollout; the case list, case page with the default layout and the comparison panel, print page.
7. **End to end:** an inquiry-completed workflow that runs a report, creates a case, waits for its resolution and decides the
   inquiry; an API-triggered workflow with an HTTPS request to a local test receiver; a case SLA expiring with a fake clock.

### Nice to have / later

Custom functions; recurring-trigger presets; importer-created runs; full canvas Simulate; case layout editor, checklists and
the status-switcher rule; teams and availability-driven assignment; case analytics; the email module and case messages;
Zendesk, Salesforce, HubSpot and OpenAI steps; Transliterate Fields; custom events; AML alert and SAR cases; case review
agents.

### Open questions (no public answer)

- The recurring trigger's cadence syntax, filter and batch size; the verification trigger's configuration.
- What Trust Device does.
- The runtime, limits and network rules of Evaluate Code; the network rules and response parsing of Make HTTPS Request.
- Run lifetime, cancellation, retention and a full status enum.
- How conditions are serialised; how filters and sorts choose their indexed fields.
- How a case keeps the snapshot of an attached object; how transitions between case statuses are restricted.
- When `case.sla-expired` fires for resolved cases; what a printed case contains; whether comments can be edited.
- Whether resuming a run can repeat a side effect.

## Needs the owner

Each item gives the decision, the default we recommend, and why. Phase 8 can proceed on the defaults; record the answers in the
Phase 8 plan and `docs/PROGRESS.md`.

1. **Workflow scope.** The public product runs one organisation-level workflow in every environment, with per-environment
   state [H6].
   - **Default:** environment-scoped workflows with a "promote" action that copies a published version into another environment
     and re-resolves its template, list and secret references by key, refusing any reference that has no counterpart. Reason:
     OpenVerify's templates, keys, secrets and providers are environment-bound, and ADR 0002 forbids sandbox providers in
     production [R3].
2. **Condition format.** PLAN names JSONLogic; the vendor publishes no format [R1] [H17].
   - **Default:** JSONLogic as the stored format with an allowlisted operator set (comparison, logic, `in`, `var`, our
     method-chain operators as named custom operations), a depth and size cap, and the editor's picker as the only author.
3. **Automated declines (Phase 7 decision 18, GDPR Art. 22).** A Decline Inquiry action lets a workflow decide with no human
   [H41] [R10].
   - **Default:** allowed, but publishing a version in which a decline is reachable without a case or a human wait requires an
     explicit acknowledgement recorded in the audit log, and the docs name the operator's duty to offer human review
     **(not legal advice)**.
4. **Evaluate Code network access.** The vendor's examples call third-party APIs from code [H24].
   - **Default:** no network and no host APIs inside QuickJS; external calls go through Make HTTPS Request and its guard.
5. **HTTPS request destinations.** Internal services sometimes live on private addresses.
   - **Default:** private, loopback, link-local and CGNAT ranges always refused in production; an environment-level CIDR
     allowlist (off by default, audit-logged) for operators who need internal endpoints; sandbox may allow loopback for tests.
6. **Third-party actions.** Slack, Zendesk, Salesforce, HubSpot and OpenAI need accounts [H49] [H80]–[H82] [H78].
   - **Default:** Slack through an incoming-webhook or bot-token adapter with a recording sandbox provider in Phase 8; the
     others not built (Make HTTPS Request covers them).
7. **Case template versioning.** The vendor's templates have none [H93].
   - **Default:** immutable versions that each case pins, as Phase 6 decision 26 did for report templates [R2].
8. **Actor identity in case payloads.** The vendor identifies users by email [O10].
   - **Default:** our ids in the API, emails only in the dashboard for viewers with `users:read`; `assign` accepts both.
9. **Comments.** Edits and deletion are not documented [O13].
   - **Default:** append-only; redaction nulls the message as the vendor does.
10. **Attachments.** No public size or type limit for case attachments [O16] [H108].
    - **Default:** PDF, PNG and JPEG by magic bytes, 10 MB per file, 50 files per case, sealed storage, links valid 5 minutes
      (all ours, provisional).
11. **SLA cap.** 90 days in the API, about 61 days in the Help Center [O15] [H100].
    - **Default:** 90 days.
12. **Run retention.** Not documented; step inputs and outputs carry PII.
    - **Default:** step payloads kept 30 days, run metadata and errors 365 days, both environment settings enforced by the C16
      retention pass.
13. **The stopgap rules.** Phase 6 `on-report-match` and Phase 7 `on-list-match` / `on-signal` route to review without
    workflows [R2] [R10].
    - **Default:** keep them, document workflows as the preferred route, and seed a disabled "review on report match" workflow
      that does the same thing.
14. **Case layout editor.** Neither PLAN Phase 8 nor Phase 9 names it [R1].
    - **Default:** Phase 8 ships a fixed default case layout with per-module visibility by permission; the drag-and-drop layout
      editor joins the Phase 9 flow-builder work.
15. **Simulate.** The vendor's simulation runs in sandbox with overrides [H12].
    - **Default:** Phase 8 ships sandbox test runs with input and output overrides through the API and a minimal panel; the
      canvas simulation waits for Phase 9.
16. **Trust Device.** The public docs give one line [D1].
    - **Default:** a reversible, audit-logged `trusted` flag on a Phase 7 device record, readable by conditions and signals;
      it never skips a check.
17. **Correct the records.**
    - **Default:** in the Phase 8 contracts slice, add the events of "Corrections" item 1 to `persona-surface.md`, and amend
      PLAN §2 (Workflows and Cases rows) and §3 (label JSONLogic as ours).

## Fact-check (2026-10-27)

**Method.** An independent pass, run 2026-10-27 between 22:40 and 23:15 UTC. Every source below was fetched again; the
researchers' downloads were used only to re-hash their 75 OpenAPI files. Each host's `robots.txt` was read before any other
request to it (RFC 9309), at most one request per 1.2 s per host, redirects never followed automatically (each hop fetched
after its own robots check), User-Agent `OpenVerify-factcheck/1.0 (research; no contact)`, the GitHub API used
unauthenticated, no personal data sent. Downloads sit in new directories `downloads/fc-gh-api/`, `fc-gh-api2/`,
`fc-openapi/` and `fc-persona/`, stored exactly as served; the readers are `scripts/fc_fetch.py`, `fc_read.py` and
`fc_html.py`, run with `python3 -I`; nothing downloaded was executed. Repository facts were read, never changed, at
`3a3ef409`. Result: **24 confirmed, 1 corrected, 0 could not verify.**

| # | Fact | Result | Primary source re-read |
|---|---|---|---|
| 1 | OpenAPI pin, tree, licence, 75 files | **Confirmed.** HEAD is still `e64dbfb` (committed 2026-10-27T08:08:31Z, pushed 08:08:34Z). Its root tree `86ef0be` lists `2026-09-29` as `c30a98b`, whose recursive listing has 909 entries and is not truncated. `LICENSE` at the commit is the Apache-2.0 text (its blob hash matches the root tree). The researchers' 75 files re-hash to the tree 75 of 75; the 63 workflow and case files fetched fresh for this check match 63 of 63 | `https://api.github.com/repos/persona-id/persona-openapi` (+ `/commits`, `/git/trees/86ef0be…`, `/git/trees/c30a98b…?recursive=1`); raw `LICENSE` at `e64dbfb` |
| 2 | `trigger-type`: eight values, open | **Confirmed.** The eight values, nullable until a trigger is attached, with the vendor's note that values may be added | `components/schemas/workflow-version.yaml` at `e64dbfb` |
| 3 | Id prefixes | **Confirmed.** `wfl_`, `wfv_`, `wfd_`, `wfr_`, `srrun_`, `case_`, `ctmpl_`, `cqueue_`, `cscm_`, `cap_` (an `assigner-id` example) and `accac_` (the run-account-action example) all occur in the spec files; `wflv_` occurs in none of them; the Help Center versions article's table gives `wflv_` | 63 OpenAPI files; Help Center `6YBOe6MD4R9WrwEuQND6jA` |
| 4 | `POST /workflows/{workflow-id}/trigger` body, dates, files, scope | **Confirmed.** `data.attributes.fields` required, no other keys allowed; the 2025-10-27 changelog moved fields there from `meta.params` and top-level attributes; the 2026-10-27 changelog requires file values as `{filename, data}` with base64 data and answers 400 with `source.pointer` otherwise, including nested, array and undeclared fields; `workflow.trigger` is on the permissions page | `paths/workflows_{workflow-id}_trigger.yaml`; changelog `2025/10/27.md`, `2026/10/27.md`; `api-keys.md` |
| 5 | Waits capped at 30 days; longer via Schedule Workflow | **Confirmed.** Both wait kinds are capped at 30 days; the page names the remedy as a Scheduled trigger with the `Schedule Workflow Run` action | `workflows-best-practices.md` |
| 6 | Wait on object: resolution time in seconds; continue unless "error on expiration" | **Confirmed** | Help Center `6mS9gS6YULKFIYA6OVQWOB` |
| 7 | Loop limits | **Confirmed.** For each, while (maximum required, up to 100) and map; sequential or parallel; lists over 100 items error | Help Center `2XtEr8q0u1N26rRos2Xrb5` |
| 8 | Conditional semantics | **Confirmed.** Routes in order, only the first match runs, AND inside a route, OR groups, a final else; a route without conditions catches all | Help Center `36BS5SiFg4jDAPSTC6arD7`, `3bFJGcJP8OCRTImxNJ7jYX` |
| 9 | Module limits | **Confirmed.** No nested modules; one run with its parent; not in inquiry-template embedded workflows or in actions (only event, API, recurring and schedule triggers); no staged rollout of a module | Help Center `20hu83UClXhWNMnk5etciI` |
| 10 | Method-chain operators and page limits | **Confirmed** (`page_size` default 100, at most 200; `page_number` at most 100) | Help Center `5HnQvtkzFUkUSo9gdgECnX` |
| 11 | Platform secrets | **Confirmed** (page last updated 2026-09-30) | Help Center `nlTpuEIPeSmXpKY4Bgs9ac` |
| 12 | `workflow-run.errored` context | **Corrected (precision).** The shape is as stated (`errored-step {name, key, type, action-key}`, null when the run failed as a whole; `error {type, message}`; `context` is `{}` until enabled), but the schema introduces the six error types with "for example", so the set is open, not a closed enum. Summary item 5 and row W26 said "one of six" / "six values"; both were corrected in place | `webhooks/workflow-run.errored.yaml` at `e64dbfb` |
| 13 | Run statuses and creator types | **Confirmed.** `status` is a plain string; the four run examples show `in_progress` (created, resumed), `errored` and `completed`; `creator` is null or `administrator`, `user`, `event` or `scheduled-run` | `components/schemas/workflow-run.yaml`; the four `workflow-run-*-webhook-body.yaml` examples |
| 14 | Events page and webhook files | **Confirmed.** The page lists the two publish events and the four run events; the tree holds webhook files for the four run events only | `events.md`; tree `c30a98b` |
| 15 | Make HTTPS Request and its signature | **Confirmed.** Five methods; a JSON body for PATCH, POST and PUT; headers; an optional response schema; retry intervals; a timeout in seconds. The best-practices page describes `t=` and `v1=` over the timestamp and body joined by a dot, and its sample code computes HMAC-SHA256 in hex; it recommends the header for POST requests and reusing the webhook secret | Help Center `5QOFu1KYFl4l14DTWSnbV1`; `workflows-best-practices.md` |
| 16 | Evaluate Code | **Confirmed.** Return types Boolean, Number, Object, String or Nothing; retries; continue on error; no runtime or limits stated | Help Center `7eNHMEGyHPLu35oakfyo79` |
| 17 | Case status categories and `set-status` | **Confirmed.** One `initial` status per template (new cases start in it), `intermediate`, `end`; defaults Open, Pending, Approved, Declined; `meta.status` required (moved from `data.attributes` on 2025-10-27) | `api-reference/cases.md`; Help Center `5X9uN2ove7vml7Y6pCqVRx`; `paths/cases_{case-id}_set-status.yaml`; changelog `2025/10/27.md` |
| 18 | SLA limits | **Confirmed.** Create and update take `meta.sla-expires-in-seconds` "max of 90 days", nullable, and the update says null clears it (added 2024-01-08); the Help Center gives about 61 days for workflow-set and manually set deadlines | `paths/cases.yaml`, `paths/cases_{case-id}.yaml`; changelog `2024/1/8.md`; Help Center `5JQzBlB1uHQkyXLpysk1W1` |
| 19 | Case webhooks and events-page extras | **Confirmed.** `webhooks/` holds exactly the eleven case files named; the events page adds `case.updated`, `case.agent-reviewed`, `case.print-initiated`, `case-comment.created`, `case-message.sent`, `case-message.received` and the two `case-template.*` events (the converted-field one twice) | tree `c30a98b`; `events.md` |
| 20 | Attachable objects | **Confirmed.** The nine types (SARs written `sars`); once per case (changelog 2023-03-27); at most 1,000 per case (the FAQ); `remove-objects` idempotent; an attach is a snapshot in time | `paths/cases.yaml`, `_add-objects.yaml`, `_remove-objects.yaml`; changelog `2023/3/27.md`; Help Center `3JzOvH6QIKLN0FfuH5ojXK`, `68OO1Ovqk7xRcYUDVMbWYa` |
| 21 | `POST /cases/search` limits | **Confirmed.** AND, OR and NOT; nesting depth 2; at most 20 clauses per AND and per OR; eq, gt, gte, lt, lte; page size 1 to 100, default 10; searchable about a minute after a change, not for read-after-write | `paths/cases_search.yaml` |
| 22 | Case templates have no versions | **Confirmed** | Help Center `21zoRbGL1FxKkbgBwc7ZLI` |
| 23 | Redaction cascade | **Confirmed.** An account's redaction reaches its inquiries, never the reverse; cases, lists and exports redact only themselves; the organisation-level policy is off by default | Help Center `48Fu5XOdmd1y5v1xvbCkn8`, `42ubXB5lJPWNaITI0uJfrI` |
| 24 | API scopes | **Confirmed** (`workflow.read`, `workflow.trigger`, `case.read`, `case.write`, `case_template.read`; the page calls its list non-exhaustive) | `api-keys.md` |
| 25 | Rate limit and quotas | **Confirmed.** 300 requests per minute per production environment by default; per-key limits inside it; creation quotas including Case creation; importer-created runs count against a daily workflow-run creation quota | `rate-limiting.md`; Help Center `2TuI1x5AUklJpvAaJ5xasG` |

Sources re-read (all 2026-10-27): `https://docs.withpersona.com/2026-09-29/` + `workflows-best-practices.md`, `events.md`,
`api-reference/cases.md`, `api-keys.md`, `rate-limiting.md`, `workflows.md`, `updates/changelog/{2026/10/27,2025/10/27,2024/1/8,2023/3/27}.md`;
`https://help.withpersona.com/articles/<id>.md` for the articles named above; `https://raw.githubusercontent.com/persona-id/persona-openapi/e64dbfbd04968b4f48e41ad571eb85861ac969bf/2026-09-29/<path>`.
