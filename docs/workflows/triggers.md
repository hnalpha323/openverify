# Triggers

A version has one trigger, which says what starts a run.

| `trigger-type` | Starts when | Notes |
|---|---|---|
| `trigger-event` | An event of the environment is committed | Below |
| `trigger-verification` | A `verification.*` event | An event trigger, with `verification-types` |
| `trigger-api` | `POST /workflows/:id/trigger` | Inputs validated by the version |
| `trigger-direct` | `POST /workflows/:id/manual-runs` | One run per object id, or a CSV of ids |
| `trigger-schedule` | A Schedule Workflow step's time comes | Waits past 30 days live here |
| `trigger-recurring` | A cron or an interval | Ours |
| `trigger-account` | `POST /accounts/:id/run-action` | Bound by an account action (`accac_`) |
| `trigger-case` | A case action | Workflow 8B |

## Event triggers

The trigger is delivered through the event outbox: a delivery row is written in the event's own transaction, so it exists if and only if the event committed, once per event and workflow. Criteria are evaluated by the worker, never inside the transaction, so a rule can never slow or fail an inquiry's move.

- **Criteria** are a [condition](conditions.md) over the event's [trigger view](conditions.md#the-trigger-view). One that reads a nullable path declares `on-null`: `error`, `admit` or `skip`.
- **Not retroactive.** An event older than the version's activation never starts it. A delivery to a paused or archived workflow ends `refused` with `workflow_not_running`, never pending.
- **Order.** Runs have no order between them, and several workflows may listen to one event. An action re-reads the subject rather than trusting the snapshot. `one-run-per-subject` on the trigger makes a later run for a subject wait until the earlier one ends.
- **Rollout.** A delivery holds no version, so the worker chooses by time: the subject's side if it was live at the event, otherwise the version live then.
- `GET /workflow-trigger-deliveries` lists what did not start a run with its `reason-code`: `filtered`, `refused` and `expired` rows are never silent.

Simulated webhook events never trigger. `workflow-run.*`, `workflow.published` and `workflow-version.published` never trigger either. `inquiry.escalated` and `verification.escalated` are not emitted, because OpenVerify has no escalation score.

- **Subject filter.** `config.filter` takes the webhook filter keys (`inquiry-template-ids`, `account-type-ids`, `workflow-ids`, `list-ids`, `case-template-ids`), each a list of ids of its kind, and holds the event's subject to them as a webhook's filters do, before the criteria: an event it does not allow ends its delivery `filtered` with `subject_filter_not_met`. Publishing writes the keys to the trigger's index row.

A transaction's event passes a filter that allows any one of its linked templates or account types; a graph-query or transaction-type event fails any present filter; a case passes `inquiry-template-ids` only when every inquiry it holds is of a listed template.

## Loop guards

- An event a run staged carries that run. A run it starts has `trigger_depth` one higher, refused past 8 with `trigger_depth_exceeded`.
- A workflow already in the causal chain of the same root is refused with `trigger_cycle`, unless `allow-self-trigger` is set. The walk goes back through deliveries, events, parents and scheduled runs.
- A workflow and subject get 60 runs a minute, and the excess waits (`not_before`), never dropped.
- Publishing warns when a graph emits its own trigger event.
- A 51st workflow on one event is refused at publish and, at run time, a `refused` delivery.

## The API trigger

`POST /workflows/:id/trigger` takes `{ data: { attributes: { fields } } }`, validated by the live version's declared `inputs`. A file value is `{ filename, data }` with base64 data, at most 10 MiB decoded and 14 MiB a request, typed by magic bytes and stored sealed; a run sees its id, never its bytes. A malformed file value answers 400 and any other field 422 `trigger_input_invalid`, each with `source.pointer` and never the value. A paused or archived workflow, a module, and a version with no `trigger-api` answer 409 `workflow_not_running`. Every starting route honours `Idempotency-Key`, and a run keeps a digest of it past the 24-hour store.

## Manual, scheduled and recurring runs

A manual run takes `object-ids` (at most 1,000) or a one-column CSV of `object-id`. The answer lists the runs and what was refused, with a code per row. It needs the grant of every rollout side, because an object can land on either, and a run the rate limit holds is refused rather than deferred.

Schedule Workflow creates a scheduled run (`srrun_`): a base time, an offset and a target with `trigger-schedule`. It is canceled with its subject's redaction and when its target is archived, and it does not wait for a paused target: it ends `workflow_not_running`. It keeps its source run's trigger depth, and a parent's cancel does not reach it.

A recurring trigger takes a five-field cron or `every-minutes` in an IANA zone, an object type, a filter and a batch cap. Each tick starts one run per matching object, oldest first, and keeps a cursor. An outage gives one catch-up tick, never a burst. Times are computed with explicit disambiguation: a local time that does not exist fires at the first valid minute after the gap, one that occurs twice fires once, at the first occurrence, and intervals follow elapsed time. A tick reads at most 1,000 objects. A filter is a [condition](conditions.md) over the object in 8A; a filter that errors on an object leaves it out, with its code in the log.

## Account actions

An account action binds a running `trigger-account` workflow to an account type with a label and a form. `prefill` maps an input to an `account.fields.*` path, never a value, and `GET /accounts/:id/available-actions` renders it under the viewer's mask: a masked field stays empty, and the run reads the live value under its grant. `POST /accounts/:id/run-action` validates the parameters, needs `workflows:trigger`, `accounts:read` and the version's grant, and answers the run's id.
