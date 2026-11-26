# Phase 9 gap after Workflow 9B: the chart primitives (owner decision B9 (b))

Applied by the orchestrator on 2026-11-06, after 9B's close (`079cdba0`) and before 9C. The owner chose B9 (b): `d3-scale` and `d3-shape` (ISC) with plain React SVG, instead of visx, whose `@visx/vendor` reaches `robust-predicates` (The Unlicense, not on CLAUDE.md rule 4's list). Plan: `docs/plans/phase-9.plan.md`, "Owner decision after Workflow 9B Stage 1a (visx, 2026-11-06)".

## Registry facts read before the install

- `d3-scale` 4.0.2 (2021-09-24), `d3-shape` 3.2.0 (2022-12-20), `@types/d3-scale` 4.0.9 (2025-02-05), `@types/d3-shape` 3.2.0 (2026-08-21).
- Most d3 modules had a new patch release on 2026-11-03 (`d3-scale` 4.0.3, `d3-shape` 3.2.1, `d3-array` 3.2.5, `d3-format` 3.1.3, `d3-time` 3.1.1, `d3-time-format` 4.1.1, `d3-path` 3.1.1, `d3-interpolate` 3.0.2), published by GitHub Actions. They are 3 days old, so `minimumReleaseAge: 20160` keeps them out, and none is resolved.

## RED (`70d3697f`)

`apps/dashboard/src/chart-dependencies.test.ts`:

```text
$ pnpm exec vitest run src/chart-dependencies.test.ts      # apps/dashboard
     × pins d3-scale 4.0.2 in the catalog
     × pins d3-shape 3.2.0 in the catalog
     × pins @types/d3-scale 4.0.9 in the catalog
     × pins @types/d3-shape 3.2.0 in the catalog
     × gives the dashboard the primitives at run time and their types for development
     × carries a licence row for every package the two bring in, from the lockfile
AssertionError: expected 'packages:\n  - apps/*\n  - packages/*…' to contain '\n  d3-scale: 4.0.2\n'
AssertionError: expected undefined to be 'catalog:' // Object.is equality
AssertionError: d3-scale: expected +0 to be 1 // Object.is equality
      Tests  6 failed | 1 passed (7)
```

The one passing test is the guard (no `@visx/*`, `robust-predicates` or `d3-delaunay` in the lockfile, no `minimumReleaseAgeExclude`), which held before and must keep holding.

## GREEN

- `pnpm-workspace.yaml`: four exact catalog pins with their reason.
- `apps/dashboard/package.json`: `d3-scale` and `d3-shape` as dependencies, the two `@types` as dev dependencies, all `catalog:`.
- `pnpm install` (under `/tmp/openverify-pnpm.lock`): `Packages: +12`. The 12 are `d3-scale` 4.0.2, `d3-shape` 3.2.0, `d3-array` 3.2.4, `d3-format` 3.1.2, `d3-time` 3.1.0, `d3-time-format` 4.1.0, `d3-path` 3.1.0, `internmap` 2.0.3, `@types/d3-scale` 4.0.9, `@types/d3-shape` 3.2.0, `@types/d3-time` 3.0.4 and `@types/d3-path` 3.1.1. `d3-interpolate` 3.0.1 and `d3-color` 3.1.0 were already locked through `@xyflow/system`. No build script (no install, postinstall or prepare script in any of the 12).
- Licences read from each installed package's `package.json` and `LICENSE`: the eight d3 modules ISC ("Copyright 20xx-20xx Mike Bostock"), the four `@types` MIT (Microsoft). `THIRD_PARTY_LICENSES.md` §2.1.16 has a row for each.
- The test's one lint finding (a non-null assertion) was fixed with a default in the destructuring.

```text
$ pnpm exec vitest run src/chart-dependencies.test.ts      # apps/dashboard
      Tests  7 passed (7)
```

## Gates (scoped: a dependency added to the dashboard, nothing imports it yet)

| Gate | Result | Time |
|---|---|---|
| `pnpm install --frozen-lockfile` | rc=0 | 0 s |
| `prettier --check` on the changed files | rc=0 | 1 s |
| `pnpm --filter @openverify/dashboard typecheck` | rc=0 | 43 s |
| `pnpm --filter @openverify/dashboard lint` | rc=0 after the fix (the first run found the non-null assertion) | 118 s |
| `pnpm --filter @openverify/dashboard test` | 420 files, 5,602 tests passed; statements 96.38%, branches 88.96%, functions 95.93%, lines 96.37% | 337 s |
| The other lockfile and catalog readers: `workspace-conventions.test.ts` (config), `lists-dependencies` and `user-agent-dependencies` (checks), `dependencies.test.ts` (workflow-engine), `axe.test.ts` and `paths.test.ts` (e2e) | 56, 5, 12 and 12 tests passed; each single-file run exits 1 only on the package's 80% coverage gate, which a one-file run cannot meet | 1-3 s each |

Nothing imports the two packages yet, so the dashboard's build output is unchanged; `dashboard-analytics` (9C) is the first importer.
