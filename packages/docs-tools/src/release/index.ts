/**
 * C284 (Workflow 11E; owner `docs-release`): `docs/release/checklist.md` (C284.1), the generated
 * `docs/release/notes.md` (C284.4) and `pnpm release:check` with every rule of C284.2.
 *
 * `pnpm --filter @openverify/docs-tools docs:release` writes what {@link renderRelease} returns;
 * `pnpm release:check [--tag]` (the root script) runs {@link releaseCheck}. Only the frozen entry
 * points and a few names other areas may need are exported here: the rules' modules stay internal,
 * so their names never collide with another area's in `src/index.ts`.
 */
import type { CheckResult, RenderResult, Repository } from '../types.js';
import { calibrationFindings } from './calibration.js';
import { checkChecklist } from './checklist.js';
import { deferralFindings } from './deferrals.js';
import { notesFindings, renderNotesFile } from './notes.js';
import {
  RELEASE_CHECK_DEPS,
  runReleaseCheck,
  type ReleaseCheckOptions,
  type ReleaseCheckResult,
} from './release-check.js';

export type { ReleaseCheckDeps, ReleaseCheckOptions, ReleaseCheckResult } from './release-check.js';
export { RELEASE_CHECK_DEPS, runReleaseCheck } from './release-check.js';
export { REQUIRED_KNOWN_ITEMS, type RequiredKnownItem } from './known-items.js';

/** Renders `docs/release/notes.md` (C284.4) from the checklist, the reports and the records. */
export function renderRelease(repo: Repository): RenderResult {
  const notes = renderNotesFile(repo);
  return { area: 'release', status: 'built', files: notes === null ? [] : [notes] };
}

/** The release records' own checks: the checklist's record test, the placements, the 11D lines, the notes. */
export function checkRelease(repo: Repository): readonly CheckResult[] {
  return [
    { name: 'release-checklist', status: 'built', findings: checkChecklist(repo) },
    {
      name: 'release-deferrals',
      status: 'built',
      findings: deferralFindings(repo).filter((finding) => finding.severity === 'error'),
    },
    { name: 'release-calibration', status: 'built', findings: calibrationFindings(repo) },
    { name: 'release-notes', status: 'built', findings: notesFindings(repo) },
  ];
}

/** C284.2: every machine-checkable rule of the release checklist, in the mode `options` names. */
export function releaseCheck(repo: Repository, options: ReleaseCheckOptions): ReleaseCheckResult {
  return runReleaseCheck(repo, options, RELEASE_CHECK_DEPS);
}
