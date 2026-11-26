/**
 * C274.6 (Workflow 11E, docs-security): a checklist row is stale when a file its evidence cites
 * changed after the row's `reviewed_commit`. It is computed from git through an injected
 * {@link EvidenceHistory}, so the generated summary never depends on the working tree's moving HEAD
 * (rule 6), and a later code edit elsewhere never fails the docs-tools suite: a stale row is an
 * `owner` finding (release:check's default mode reports it and exits 0, C284.2), never an `error`.
 */
import { execFileSync } from 'node:child_process';
import type { CheckFinding, CheckResult } from '../types.js';
import type { SecurityChecklistRow } from './checklist.js';

/** The files among `paths` that changed between `commit` and HEAD. */
export interface EvidenceHistory {
  changedSince(commit: string, paths: readonly string[]): readonly string[];
}

/** One stale row: its id and the cited files that changed after its review. */
export interface StaleChecklistRow {
  readonly id: string;
  readonly reviewedCommit: string;
  readonly changed: readonly string[];
}

/** Whether `file` is `cited`, or lies under the directory `cited` names with a trailing `/`. */
const covers = (cited: string, file: string): boolean =>
  cited.endsWith('/') ? file.startsWith(cited) : file === cited;

/** The rows whose cited evidence changed after their `reviewed_commit`. */
export function staleChecklistRows(
  rows: readonly SecurityChecklistRow[],
  history: EvidenceHistory,
): readonly StaleChecklistRow[] {
  const byCommit = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.evidence.length === 0) {
      continue;
    }
    const paths = byCommit.get(row.reviewedCommit) ?? new Set<string>();
    row.evidence.forEach((path) => paths.add(path));
    byCommit.set(row.reviewedCommit, paths);
  }
  const changed = new Map<string, readonly string[]>();
  for (const [commit, paths] of byCommit) {
    changed.set(commit, history.changedSince(commit, [...paths].sort()));
  }
  return rows.flatMap((row): StaleChecklistRow[] => {
    const files = (changed.get(row.reviewedCommit) ?? []).filter((file) =>
      row.evidence.some((cited) => covers(cited, file)),
    );
    return files.length === 0
      ? []
      : [{ id: row.id, reviewedCommit: row.reviewedCommit, changed: files }];
  });
}

/** A history read from the git repository at `root` (the real tree, or a fixture repository). */
export function createGitEvidenceHistory(root: string): EvidenceHistory {
  return {
    changedSince: (commit, paths) => {
      if (paths.length === 0) {
        return [];
      }
      try {
        const out = execFileSync(
          'git',
          ['-C', root, 'diff', '--name-only', `${commit}..HEAD`, '--', ...paths],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        return out
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .sort();
      } catch {
        // A commit the repository does not hold (a shallow clone, a rewritten history) cannot be
        // compared, so every cited file is treated as changed: the review is due again.
        return [...paths];
      }
    },
  };
}

/** The staleness of one checklist as a check whose findings are the owner's (C284.2). */
export function stalenessCheck(
  name: string,
  csvPath: string,
  rows: readonly SecurityChecklistRow[],
  history: EvidenceHistory,
): CheckResult {
  const lines = new Map(rows.map((row) => [row.id, row.line]));
  const findings = staleChecklistRows(rows, history).map((stale): CheckFinding => ({
    rule: 'stale-evidence',
    path: csvPath,
    line: lines.get(stale.id) ?? 0,
    message: `${stale.id}: ${stale.changed.join(', ')} changed after reviewed_commit ${stale.reviewedCommit}; review the row again (C274.6)`,
    severity: 'owner',
  }));
  return { name, status: 'built', findings };
}
