/**
 * C284.2's licence rule (docs-release; review H19): every row of `THIRD_PARTY_LICENSES.md` that
 * reads "owner to confirm" or "pending" is listed on the release checklist (an error when it is
 * not: listing it is docs-release's), and each is reported as an owner item with its state (the
 * licence check never passes a shipped "owner to confirm" row silently).
 */
import type { CheckFinding, Repository } from '../types.js';
import { CHECKLIST_PATH, parseChecklist } from './checklist.js';
import { splitRow } from './markdown.js';

export const LICENCES_PATH = 'THIRD_PARTY_LICENSES.md';

/** One licence row that waits on the owner. */
export interface PendingLicenceRow {
  readonly line: number;
  /** The row's first cell, without backticks. */
  readonly component: string;
  /** The names the first cell lists (versions and parenthesised parts removed). */
  readonly names: readonly string[];
  /** `owner to confirm`, `pending` or both, as the row words it. */
  readonly words: string;
}

const OWNER_WORDS = /owner to confirm/i;
const PENDING_WORD = /\bpending\b/i;

/** `Locust 2.46.7` -> `Locust`: trailing words that are dotted version numbers are dropped. */
function withoutVersion(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && /^\d+\.[\d.]+\S*$/.test(words[words.length - 1] ?? '')) {
    words.pop();
  }
  return words.join(' ');
}

/** The names a component cell lists: `pvutils, pvtsutils, tslib` -> three; `JUnit 4 (...)` -> `JUnit 4`. */
export function namesOf(component: string): readonly string[] {
  return component
    .replace(/\([^)]*\)/g, '')
    .replaceAll('`', '')
    .split(',')
    .map((name) => withoutVersion(name))
    .filter((name) => name !== '');
}

/** The rows of the licence file that read "owner to confirm" or "pending". */
export function pendingLicenceRows(text: string): readonly PendingLicenceRow[] {
  const rows: PendingLicenceRow[] = [];
  text.split('\n').forEach((line, index) => {
    const cells = splitRow(line);
    if (cells === null || cells.length < 2 || /^:?-+:?$/.test(cells[0] ?? '')) {
      return;
    }
    const owner = OWNER_WORDS.test(line);
    const pending = PENDING_WORD.test(line);
    if (!owner && !pending) {
      return;
    }
    const component = (cells[0] ?? '').replaceAll('`', '');
    rows.push({
      line: index + 1,
      component,
      names: namesOf(component),
      words:
        owner && pending ? 'owner to confirm, pending' : owner ? 'owner to confirm' : 'pending',
    });
  });
  return rows;
}

/** C284.2's licence rule. */
export function licenceFindings(repo: Repository): readonly CheckFinding[] {
  if (!repo.exists(LICENCES_PATH)) {
    return [];
  }
  const checklistText = repo.exists(CHECKLIST_PATH)
    ? parseChecklist(repo.readText(CHECKLIST_PATH))
        .lines.map((line) => line.text)
        .join('\n')
    : '';
  const findings: CheckFinding[] = [];
  for (const row of pendingLicenceRows(repo.readText(LICENCES_PATH))) {
    const listed = row.names.some((name) => checklistText.includes(name));
    findings.push(
      listed
        ? {
            rule: 'licence-row',
            path: LICENCES_PATH,
            line: row.line,
            message: `owner: ${row.component} reads "${row.words}" (listed on the checklist)`,
            severity: 'owner',
          }
        : {
            rule: 'licence-row',
            path: CHECKLIST_PATH,
            message: `${row.component} (${LICENCES_PATH}:${String(row.line)}, "${row.words}") is not listed on the checklist`,
            severity: 'error',
          },
    );
  }
  return findings;
}
