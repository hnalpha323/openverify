# Phase 8: the orchestrator's slices between Workflows

## The `node` CI job's timeout (after Workflow 8B, 2026-11-03)

Workflow 8A's Stage 1b amendment 1 set the rule: once `node` passes 15 minutes on GitHub, its `timeout-minutes` becomes 25. On 8B's push
(`1bc82ef4`, CI 41682793143, 14 of 14 green) it took 15.9 of 20 minutes, inside the last 25% of its timeout, and 8C adds tests.

**RED** (`338a841a`): a check in `infra/tests/ci-workflow.test.sh` that the job's timeout is at least 25 minutes.

```
$ bash infra/tests/ci-workflow.test.sh
FAIL - node: the job's timeout keeps its time out of the last 25% (at least 25 minutes) (20)
# 219 passed, 1 failed, 0 skipped
rc=1
```

**GREEN:** `timeout-minutes: 25` on `node` in `.github/workflows/ci.yml`.

```
$ bash infra/tests/ci-workflow.test.sh
# 220 passed, 0 failed, 0 skipped
rc=0
$ pnpm exec prettier --check .github/workflows/ci.yml
rc=0
```

## The format gate's ignore patterns (after Workflow 8B, 2026-11-03): RED only, reverted

`.prettierignore`'s bare `services/` and `data/` match at any depth, so `pnpm format:check` has never checked `apps/api/src/services`
(434 tracked files, 101 of them unformatted) or `packages/checks/src/data` (16 files).

**RED** (`ff46c20f`): `packages/config/src/workspace-conventions.test.ts`, "the format gate".

```
$ pnpm exec vitest run src/workspace-conventions.test.ts --coverage.enabled=false -t 'the format gate'
× checks every tracked TypeScript and JavaScript source under apps/ and packages/
AssertionError: expected [ …(450) ] to deeply equal []
✓ leaves the pinned data assets under packages/*/data/ as they are
rc=1
```

**No GREEN:** the edit of `.prettierignore` (`/services/`, `/data/`, `packages/*/data/`) was refused by a config-protection hook in this
environment, whose only remedy is disabling it, which is the owner's decision. `493eea11` reverts the test so the suite stays green. The fix is
owner item 6 of the 8B entry in `docs/PROGRESS.md`.
