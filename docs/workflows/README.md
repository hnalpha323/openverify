# Workflows

A workflow reacts to something that happened in an environment and acts on OpenVerify's objects, or on the outside world through the few steps that leave it. It is a JSON graph, versioned and published by a person, run by a durable engine over Postgres. Valkey only wakes steps up, so losing it delays work and never loses it.

**Tier.** The engine and every step and trigger type are R-tier. Email, SMS and Slack are A-tier: adapters with a deterministic sandbox provider that records and never sends, refused in production. Run Report and Get List Match pass H-tier results from earlier phases and are `beta`: each match says its method, tier, stage and confidence. A workflow never passes a check, and [ADR 0007](../adr/0007-workflows-authority-egress-decisions-sandboxing.md) holds the rules this section follows.

## Where to read

| Page | What it says |
|---|---|
| [Triggers](triggers.md) | The eight trigger types, delivery, loop guards |
| [Steps](steps.md) | Action, wait, parallel, conditional, loop, module, output |
| [Conditions](conditions.md) | Our JSONLogic dialect, the null rules, PII taint |
| [Templates](templates.md) | `{{ path }}` value templates and each sink's encoding |
| [Actions](actions.md) | Every action: delivery, adverse flag, stage and grant (generated) |
| [Delivery](delivery.md) | What a retry or a resume can repeat |
| [Evaluate Code](evaluate-code.md) | QuickJS, its limits, what the sandbox does not cover |
| [HTTPS request](https-request.md) | The guard, signing, and personal data leaving OpenVerify |
| [Messaging](messaging.md) | Email, SMS and Slack: recipients, links, budgets, sandbox records |
| [Secrets](secrets.md) | Values per environment, bound to hosts and placements |
| [Recipes](recipes.md) | Installable drafts |
| [Limits](limits.md) and [errors](errors.md) | Every constant and every code (generated) |
| [Automated decisions](../compliance/automated-decisions.md) | What a production decline owes the person |

## From a draft to a run

1. `POST /workflows` creates a paused workflow with an empty draft.
2. `PUT /workflows/:id/draft` saves a definition at its `lock-version`, and `POST .../draft/validate` answers its problems without saving. Save refuses what the draft check refuses, so a graph with a dangling node stays in the editor. Validate runs the publish check too, but not the rules that need the environment.
3. `POST /workflows/:id/publish` freezes the draft. **A user publishes, never an API key** (403). The publisher must hold every scope of the derived grant, `workflows:publish`, `pii:view` when the grant needs unmasked values, and `environments:production` in production. Publishing does not start a workflow.
4. `POST /workflows/:id/activate` starts it. `pause` stops new runs. A run in flight keeps its version: publishing changes new runs only.

Staged rollout publishes below 100%: the new version is `treatment`, the old one `control`, a subject always gets one side, and `POST .../rollout` finishes (100) or undoes (0) it. A module cannot roll out, nor can a first publish, which has no control, or a version whose trigger differs from the control's. Restore makes a draft of an old version, which then passes every publish rule. Promote copies a published version into another environment **as a draft**, re-resolving each reference by name or key; none or several candidates refuse it.

## What a run acts with

A run is an actor of its own (`workflow-run`), recorded in the audit log, on list items and in decisions. It acts with its version's frozen grant, which is API scopes and a PII flag, derived from its steps and bounded by the publisher.

- A principal starting a run needs `workflows:trigger` and every scope of the grant, or 403 naming what is missing.
- A child run's grant must be a subset of its parent's effective grant, checked when it starts.
- An event carries the principal that caused it. An adverse step of a run that event started needs that principal to hold the step's scope, or the step errors `cause_lacks_scope` and the inquiry goes to review. The end user's flow and system jobs have no principal and are exempt.
- A sweep compares each running workflow's publisher with its live version every 60 s. A publisher who lost a right an egress or adverse step needs pauses the workflow (`publisher_revoked`), its runs end at their next such step, and only a rerun after a new publish goes on. A lost scope that only internal, non-adverse steps use leaves it running, flagged, on its frozen grant.

## Run values

Run values are sealed, and masked **fail closed**: without PII visibility every step input and output, run output, variable and trigger snapshot is `null`, except members the registry or the contract marks non-PII. An Evaluate Code result, an HTTPS body with no schema and an undeclared variable are always masked. A stored API log masks them the same way. Runs are read with `workflow-runs:read`, which viewers do not hold. A purged `null` is told from a masked one by `values-purged-at`.

`workflow-run-retention-days` (default 30) nulls a finished run's values and deletes its trigger files; `workflow-run-history-retention-days` (default 365) deletes the skeleton. An unfinished run is never removed by retention; the 90-day deadline bounds it.

Redacting an object finds its runs through `workflow_run_subjects` and nulls their values, cancels scheduled runs about it, and ends an unfinished run with `subject_redacted`, because its state is sealed in the values being nulled. A run with more subjects than the limit is reached by any redaction in its environment. A copy a run made of a subject's value into a comment or a case field goes with the subject; other copies are named in the redaction's audit entry.

## Test runs

`POST /workflows/:id/test-runs`, in sandbox environments only, runs a draft or a published version on an object or a synthetic payload. A synthetic payload is the trigger's flattened view, as a run reads it, and may be partial: a member it leaves out reads as `null` in the run, while a member it carries must be one the view holds, of its type, and not `null` where the view holds none; otherwise the answer is 422 `trigger_input_invalid` at `/data/attributes/trigger-payload/<member>`, never with the value. An API trigger's payload is read by its declared inputs instead. Its grant is derived as publish would, and the caller must hold it. An irreversible or adverse step is simulated unless the request acknowledges it: no effect and no decision record. An HTTPS step must be overridden, or it errors `test_run_egress_disabled`; a real call needs a user with `pii:view`, the host in `allow-hosts`, and `egress:<step id>`. Every message goes to the recording provider. Events a test run causes trigger nothing unless the request opts in. An object a test run creates carries its step (`workflow_run_step_id`), which names the run; it has no `test-run-id` column of its own.
