# TDD evidence: Workflow 8A Stage 2, `code-sandbox` (Phase 8)

- **Slice owner:** the Workflow 8A Stage 2 `code-sandbox` agent, beside `foundation-8a`, `engine-logic` and the later calls of `contracts-8a`.
- **Date:** 2026-11-02.
- **Base:** `72880487`, the first call of `contracts-8a` ((X) code checkpoint `94ea6475`).
- **Input:** C123.3 to C123.9 of `docs/plans/phase-8.plan.md`, the "code-sandbox" bullet, F19, F24, P15 to P18, and the Stage 1a amendments 22 to 25.

Each slice follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles, typechecks and lints; the test, run to see it fail for the intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`). Every value in these tests is synthetic. All commands ran after `source scripts/env.sh`, and output is trimmed to the lines that matter.

## 1. Frames (C123.3, P16)

Stub `e4dfa708`; RED `89b34d69`; GREEN `ba785485`.
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/frames.test.ts --coverage.enabled=false
RED    rc=1   Tests  18 failed (18)      "the frames are not built yet"
GREEN  rc=0   Tests  18 passed (18)
```
The length is checked before the only allocation, so a header announcing 1 GiB costs four bytes. `jsonDepthWithin` reads the text without recursion: 5,000,000 open brackets answer in a loop.

## 2. The limits of one evaluation (C123.5)

Stub `17aeccbc`; RED `4c6642f9`; GREEN `1b9e5e2f`.
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/limits.test.ts --coverage.enabled=false
RED    rc=1   Tests  20 failed (20)
GREEN  rc=0   Tests  20 passed (20)
```

## 3. The child and its real paths (C123.3 to C123.6, F19)

Stub `58bc4b9c`; RED `ed1f64bd`; GREEN `d923ef2f`.
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/paths.test.ts src/code-runner/child.test.ts --coverage.enabled=false
RED    rc=1   Test Files  2 failed (2)   Tests  53 skipped (53)   Error: the runner paths are not built yet
GREEN  rc=0   Test Files  2 passed (2)   Tests  53 passed (53)
```
What a spike under the real flags found first, none of it in the research note:
- **The permission model needs the links too.** The ES module resolver reads `<importer's node_modules>/@jitl/quickjs-ffi-types/package.json` through the link and `realpathSync` stats the link, each a checked read, so real paths alone give `ERR_ACCESS_DENIED`:
  ```
  Error: Access to this API has been restricted. Use --allow-fs-read to manage permissions.
      at packageResolve (node:internal/modules/esm/resolve:770:43)
    resource: '.../quickjs-emscripten-core@0.32.0/node_modules/@jitl/quickjs-ffi-types/package.json'
  ```
  `fsRead` is the entry, the three real package directories and those two links.
- **V8's stack limit can come first.** Small recursive frames hit V8's limit inside WebAssembly before QuickJS's 512 KiB check, which measures the shadow stack. It reaches the host as a `RangeError` with the VM in the middle of a call, so the child answers `stack_overflow` and never touches that VM again. Larger frames reach QuickJS's own `InternalError: stack overflow`. A test covers each.
- **Module evaluation can answer a pending promise** (top-level await), so promises are settled by running jobs, with the deadline read between batches. An async function works for the same reason.

## 4. The pool and the security tests (C123.3, C123.5, C123.6, C123.9)

Stub `da82c0d5`; RED `8c046ba1`; GREEN `749f8dec`.
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/pool.test.ts --coverage.enabled=false
RED    rc=1   Tests  54 failed (54)      Error: the pool is not built yet
GREEN  rc=0   Test Files  7 passed (7)   Tests  160 passed (160)      (the whole folder)
```
`testing/fake-child.mjs` is a compromised child under the real flags on the real pipes. It covers the 1 GiB header, each malformed frame, wrong ids, a second handshake, a console flood and the permission probe (read, write, spawn and worker `ERR_ACCESS_DENIED`, addon `ERR_DLOPEN_DISABLED`, an empty `process.env`, no `process.send`).

The first GREEN run had two failures, both in the tests: the long native call allocated past 64 MiB (it read `memory_limit`), and the addon probe expected the wrong code. While fixing the first, RED showed a real gap: a guest that ended past its deadline between two interrupt checks was answered as a value.
```
 FAIL  src/code-runner/child.test.ts > the limits > never answers past the limit, though the guest ended between two interrupt checks
```
The child now reads the clock after the output is rendered.

## 5. The container form (C123.3, P17)

Stub `5f33af10`; RED `a1bbffec`; GREEN `8fcd6b23`.
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/socket.test.ts src/code-runner/limits.test.ts src/code-runner/protocol.test.ts --coverage.enabled=false
RED    rc=1   Tests  36 failed | 34 passed (70)
         15 × serveCodeRunner is not built yet    11 × the socket form is not built yet    2 × evaluateRequestAllowed is not built yet
GREEN  rc=0   Test Files  8 passed (8)   Tests  199 passed (199)      (the whole folder)
```
The two protocol additions landed in the stub commit and their tests pass from the RED commit on; they are data, so there is nothing to see fail.

## 6. The image (C123.3, F19, P17)

RED `2321b813`; GREEN `1a78952c`.
```
$ bash infra/tests/code-runner.test.sh
RED    rc=1   FAIL - the Dockerfile exists   0 passed, 1 failed
GREEN  rc=0   44 passed, 0 failed
```
`pnpm deploy --offline` failed on the release-age policy, which reads registry metadata (`ERR_PNPM_NO_OFFLINE_META`), so the deploy step runs online. The install before it stays frozen and offline, and that is the step the lockfile pins.

## 7. A defect load found (C123.5)

RED `b054b8a7`; GREEN `55ca5a3a`.

Six copies of the folder's tests side by side (load about 14) failed three tests in some runs, each `sandbox_crashed`:
```
 FAIL  src/code-runner/pool.test.ts > the sandbox (C123.9) > ends a long native call through the interrupt or the kill
InternalError: interrupted
```
This was no test problem. The deadline started before the harness was evaluated, so with a 1 ms limit the interrupt could fire in our own setup, where `unwrapResult` threw on the host and the child exited 65. A 1-byte memory limit failed the same way. The fix is in the child: our setup runs outside the guest's limits, and the clock and the limit start at the guest. The deterministic test advances `Date.now` by 10 ms a call, so the deadline always passes during setup:
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/code-runner/child.test.ts --coverage.enabled=false
RED    rc=1   FAIL starts the clock at the guest: a slow start of the harness is no crash    (InternalError: interrupted)
              FAIL gives memory_limit below what the input needs, never a crash
              Tests  2 failed | 45 passed (47)
GREEN  rc=0   Tests  48 passed (48)
```
The second needed one more step: with no room for an error object QuickJS throws `null`, which reads as a guest's own `throw null`. The child tells them apart by the memory in use against the limit, with a test each way.

Six side-by-side copies after the clock fix (load 8.7 to 13.9) failed only that last test, in all six, before its fix. Six more after it (load 11.7 to 17.3): 214 of 214 passed in each, every run rc 0.

## 8. Measurements

Under `flock /tmp/openverify-e2e.lock`, one step per hold, load `6.65 5.86 3.92` before and `6.52 5.84 3.93` after, from source on Node 22.22.1:

| Measure | n | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| Cold child, spawn to the first answer | 20 | 96.9 | 114.0 | 114.0 |
| Warm evaluation, a fresh instance and memory each | 95 | 2.8 | 7.7 | 12.9 |
| Warm evaluation with a 256 KiB input | 50 | 10.8 | 20.3 | 21.8 |
| A 50 ms interrupt timeout, with the child's restart | 10 | 158.8 | 192.0 | 192.0 |
| Warm evaluation over the Unix socket | 95 | 3.6 | 13.2 | 17.8 |

In the container, a child holding a guest at its 64 MiB limit had 6 threads and 100 MB of RSS; the server had 11 threads and 82 MB. `/app` is 29 MB, and the image 365 MB, nearly all of it the Node base image.

## 9. Final gates

Run in the foreground; each exit code read from the call, the output in a file.

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/workflow-engine typecheck` | rc 0 |
| `pnpm --filter @openverify/workflow-engine lint` | rc 0 |
| `pnpm --filter @openverify/workflow-engine test --coverage.reportsDirectory=<own>` | rc 0; 327 tests in 12 files; statements 97.82%, branches 95.4%, functions 97.82%, lines 99.48%; `src/code-runner` 97.28%, 94.09%, 97.32%, 99.35% |
| `pnpm format:check` | rc 0 |
| `pnpm turbo run lint typecheck --force` | The whole call did not finish inside its 590 s bound at a load of about 30 (rc 124, killed by `timeout`, no task failed). Split, with the same forced tasks under `NODE_OPTIONS=--max-old-space-size=4096`: typecheck 16 of 16 rc 0 in 3 min 8 s (load 26 falling to 9); lint without api and dashboard 14 of 14 rc 0 in 3 min 6 s (load 7.8 to 3.9); lint of api and dashboard 2 of 2 rc 0 in 2 min 6 s (load 3.9 to 3.4) |
| `docker build -f infra/docker/code-runner.Dockerfile .` | rc 0 |
| `bash infra/tests/code-runner.test.sh` | rc 0; 44 passed; the compose checks skip until `integration-8a` adds the service |
| `bash infra/tests/code-runner.test.sh --static-only` | rc 0; 11 passed |
| `pnpm --filter @openverify/config exec vitest run --coverage.enabled=false` | rc 0; 216 tests (the workspace conventions) |
