# Delivery

Every side effect has the key `<wfr id>/<node id>/<iteration path>`, independent of the attempt. [Actions](actions.md) names each action's guarantee.

| Delivery | What repeats | How |
|---|---|---|
| `exactly-once` | Nothing inside OpenVerify | The effect row and the change are one transaction, and a created object has a unique `(environment, step)`. A target already in the state reads `no_change`; another actor's decision reads `already_decided`, never overwritten |
| `at-least-once` | An HTTPS request | It carries the key as `Idempotency-Key`, so the receiver can drop a repeat |
| `at-most-once` | Nothing: it can be lost | The effect is claimed before sending. A crash between leaves `unknown` |
| `pure` | The computation | Its output is recorded, so a resume reads it |
| `control` | Nothing | It runs in the completing transaction |

`redact_object` on an inquiry or an account is the one internal effect not written in one transaction with its change, because those redactions commit in stages and delete objects after: the effect is claimed first, and the service is idempotent, so a repeat reads `no_change`.

## Runs after a failure

- **Resume** (`POST /workflow-runs/:id/resume`) re-readies the failed step. A `done` effect never repeats. An `unknown` one blocks it with `run_not_resumable` naming the step, unless `meta.skip-unknown-effects: true` acknowledges it, which is audited. A run stopped by `publisher_revoked` is never resumable.
- **Rerun** (`POST .../rerun`) starts a new run of the latest published version on the same trigger snapshot and inputs, linked by `rerun-of`. Its effects are its own: a rerun repeats them.
- **Cancel** (`POST .../cancel`) writes first: pending and waiting steps end, child runs are canceled, and a running step learns from its next heartbeat, within a third of its lease, and is fenced out. What already happened stays.

A step claimed more than 10 times fails with `execution_error`. A claim's lease is the action's time limit plus a margin, extended by the heartbeat, and a sweep reclaims a step past it.

## What holds without Valkey

Postgres is the only record. A timer is a due time on a row, a delayed job is added only within the hour, and a sweep stands behind every timer, lease, delivery and wait. Valkey going away delays work. The worker reads `maxmemory-policy` at start and logs an error unless it is `noeviction`; it does not refuse to start.

The throughput to plan for is in `docs/PROGRESS.md`, measured with `apps/api/scripts/workflow-benchmark.ts`. Fairness is by environment, with a default of 50 steps running or enqueued, in rotation, on two queues: interactive runs and batches.
