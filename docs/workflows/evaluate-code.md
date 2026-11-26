# Evaluate Code

Runs an operator's JavaScript over mapped values, in QuickJS compiled to WebAssembly, in a child process. It is R-tier as an engine. What the code decides is the operator's logic, so the step records the source's SHA-256, and a decision record names any decision that depended on it.

```json
{
  "source": "export default function (input) { return input.score > 3; }",
  "properties": { "score": "{{ vars.score }}" },
  "return-type": "boolean"
}
```

Only mapped properties reach the code, so PII it does not use never enters it. A property can never be a secret. The output is `{ value, source-sha256 }`, checked against `return-type`: `boolean`, `number`, `string`, `object` (a JSON object or array), or `none`, which takes only `null`, what a function that returns nothing gives. An output carries the taint of its properties, and with no schema it is always masked without PII visibility.

## What the guest gets

One JSON string in, parsed inside the VM, and one JSON string out, produced there and parsed on the host with its cap. No host function, no module loader, no `fetch`, no timers, no secrets, no `process`. `console` is undefined in a production run, so a call raises a `ReferenceError`; a sandbox test run captures at most 50 lines of 1 KiB, sealed, shown only to its author, purged with the run. An async function and top-level await are settled, with the deadline read between batches, and a promise that never settles reads `invalid_output`. A `__proto__` key in a guest's output is dropped at the host.

## Where it runs

- `OPENVERIFY_WORKFLOW_CODE_RUNNER=socket:/run/code-runner/code-runner.sock` is the production setting: the `code-runner` service, which compose's `app` profile starts and the worker reaches over a Unix socket on a shared volume. It has no network, a read-only root, a non-root user, no capability, `no-new-privileges`, memory and PID limits, and no secret.
- `pool` starts the children inside the worker. They hold an empty environment, the Node permission model and a heap cap, but Node 22's permission model has no network permission, so they share the worker's network namespace. A production worker on `pool` logs a warning naming this.
- `OPENVERIFY_WORKFLOW_CODE_ENABLED=false` turns the action off for the install: it reads `available: false`, `code_disabled`.

Each evaluation gets a fresh WebAssembly instance and memory, then one runtime and context, all disposed after. A child serves one environment at a time. It is recycled for another environment, after 100 evaluations, and after any interrupt, out-of-memory, stack overflow, crash or framing error. The parent kills it at the step's time limit plus 250 ms, whatever the guest does. Frames on fds 3 and 4 are length-checked before any byte is buffered.

On Kubernetes, run the same image as a sidecar with a read-only root, a non-root user, and an egress-denying `NetworkPolicy`, sharing an `emptyDir` for the socket. Size it from what was measured: a child holds about 100 MB and 6 threads at the 64 MiB limit, the server 82 MB and 11 threads, and `OPENVERIFY_CODE_RUNNER_POOL_SIZE` defaults to CPUs minus one. A limit too low for the pool reads as `sandbox_crashed`.

Backpressure: at most four evaluations per child wait for one (`waiting-per-child`); past that the pool answers at once with `sandbox_crashed`, reason `runner_busy`, and nothing runs, so the step's `retry` may find room. The worker's timer for one evaluation is its time limit, the 250 ms kill and a 30 s margin for the queue; when it passes, that evaluation alone reads `sandbox_crashed` (`socket_timeout`), the connection stays for the others, and the late answer is dropped. When the worker's connection goes, the service drops what that connection left waiting before a child takes it; an evaluation already running ends at its own deadline.

## Limits and errors

[Limits](limits.md#evaluate-code) are provisional. `time-ms` and `memory-bytes` may be set per step, never past the ceilings of 5,000 ms and 64 MiB. Evaluations are budgeted per environment (`workflow-code`), failing closed.

| Code | Type | Meaning |
|---|---|---|
| `timeout` | unknown-error | The guest ran past its time. Follows the step's `retry` |
| `sandbox_crashed` | unknown-error | The runner failed, not the code. Follows the step's `retry` |
| `memory_limit`, `stack_overflow` | unknown-error | The guest hit a limit |
| `runtime_error` | unknown-error | The guest threw, or an input was past its cap |
| `invalid_output`, `type_mismatch` | configuration-error | The answer does not fit |
| `code_disabled` | unknown-error | Turned off for this install |

Only `timeout` and `sandbox_crashed` retry. The guest's own message can carry inputs, so it goes only in the step's sealed output, cut to 1 KiB and scrubbed of resolved secrets. The plaintext error column holds the code; events, the journal and logs never carry the words.

## What the sandbox does not cover

A QuickJS memory-safety bug together with a V8 WebAssembly bug; Spectre-class side channels inside one process; denial of service beyond the budgets; the in-worker pool's network exposure; and anything the operator passes in. The wrapper's releases and NVD are checked monthly for `quickjs` (C123.10).
