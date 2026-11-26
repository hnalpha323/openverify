# Steps

A definition is a graph of nodes and edges. Step ids match `^[a-z][a-z0-9_]{0,39}$`, stay stable across versions and read as names in paths: `steps.run_watchlist.output`. `trigger` and `output` are reserved.

| Type | What it does |
|---|---|
| `action` | Calls one [action](actions.md) with its rendered config |
| `wait` | Waits for events on a subject, or for a time |
| `parallel` and `join` | Runs 2 to 10 branches; every branch must finish |
| `conditional` | Takes the first route whose condition holds, else `else` |
| `loop` | `for-each`, `while` or `map`, with `concurrency` 1 to 10 |
| `module` | Runs a module's steps inside this run |
| `output` | Maps the run's declared outputs |

## Edges and ports

`next` leaves a join, wait, action, module, array-map-output and module input. A conditional has `route:<key>` and `else`, a parallel `branch:<key>`, and a loop `body`, `done` and optionally `error`. An action or a module may have an `error` edge too. A loop body's last edge goes back to the loop's `continue` port. The graph check refuses a dangling port, a node that cannot reach `output`, a cycle other than that back-edge, a branch that leaves its parallel, and nesting past 3, each with a JSON Pointer.

## Failure

A failed step follows, in order: its `error` edge, its `continue-on-error`, else the run ends `errored`. Nothing compensates automatically: route a failure to a review, a case or a message. A failing branch or loop iteration waits for what is still running before it fails outward, so a long wait in a sibling keeps the run `in_progress` until that ends.

Retries are the engine's: `retry.intervals-seconds` (at most 10, each up to 3,600 s) where the action allows them. Network errors, timeouts, 408, 429 (honouring `Retry-After`), 5xx and a provider's transient code retry. Other 4xx, a refused destination, validation, expression and template errors, permission errors, Evaluate Code's deterministic failures and a redacted subject do not.

## Waiting

A **time wait** is a row with a due time: not before it, normally within seconds, at worst within the sweep interval plus a lease after an infrastructure failure.

An **event wait** names a subject (a path to an object id), at least one event name and a timeout of up to 30 days. It resolves on an event committed after it began; one committed before never does, whichever side runs first, and a race test pins each order. A filter reads the waited event under the `event` root. A non-matching event leaves the step waiting, and the filter runs at the match. On timeout it follows `next` (`on-timeout: continue`) or errors `wait_timed_out`, and its output says which: `resolved-by: event | timeout`. Which subjects a wait can match: the event's resource, and every to-one relationship in its payload.

Run Report and Run Verification wait by themselves, and their timeouts are always errors.

## Parallel and loops

Parallel branches share no order. Two branches that update one variable are refused at publish. A loop over more than 100 items fails with `loop_limit_exceeded`, never a truncation. A `while` needs `max-iterations`, runs one iteration at a time, and past its maximum it fails rather than stops. Each iteration's steps have their own rows, and a loop's output is `{ iterations }`, or `{ iterations, values[] }` for a map.

## Modules

A module is a workflow of `kind: module`, with a `module-input` start node. Its steps run in the parent's run, in `module:<step id>/…`, on a version pinned when the step starts. It reads parent values only as inputs, it holds no module step, and account and case actions cannot use it.

## Outputs

The output node maps each declared output to a path or a literal. Outputs are sealed and masked like step data, and `workflow-run.completed` carries their names, never their values. A tainted value needs its output declared `pii: true` ([taint](conditions.md#pii-taint)).

Approve and Decline do not end a run: it goes on to `output`.
