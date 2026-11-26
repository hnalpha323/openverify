/**
 * Two of C284.2's rules over records 11F writes (docs-release; reviews H14, H17):
 * - the 11F verifier's table, `docs/release/verified-findings.md` (`| Finding | Severity | Verdict
 *   | Fixed | Commits | Summary |`): a CRITICAL or HIGH finding that is neither refuted nor fixed
 *   fails both modes (a confirmed one is never closed by a record); until 11F writes the table its
 *   absence is reported "pending (11F)" and refused by `--tag`;
 * - the checklist's "Open medium advisories (H14)" table (`| Advisory | Package | Severity |
 *   Published | Notes |`): every medium published more than 90 days before the checklist's date is
 *   listed (C259.2's time frame).
 */
import type { CheckFinding, Repository } from '../types.js';
import { CHECKLIST_PATH, parseChecklist } from './checklist.js';
import { tablesOf } from './markdown.js';

export const VERIFIED_FINDINGS_PATH = 'docs/release/verified-findings.md';
export const VERIFIED_HEADER = ['Finding', 'Severity', 'Verdict', 'Fixed', 'Commits', 'Summary'];
export const ADVISORIES_HEADER = ['Advisory', 'Package', 'Severity', 'Published', 'Notes'];
/** C259.2: a medium's remediation time frame, in days from the advisory's publication. */
export const MEDIUM_TIME_FRAME_DAYS = 90;

const DAY_MS = 86_400_000;

export const VERIFIED_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const VERIFIED_VERDICTS = ['refuted', 'confirmed', 'plausible'] as const;

/** What is wrong with a row's cells, or null when they hold the frozen vocabulary. */
function malformedVerifierRow(
  severity: string,
  verdict: string,
  fixed: string,
  commits: string,
): string | null {
  if (!(VERIFIED_SEVERITIES as readonly string[]).includes(severity.toUpperCase())) {
    return `Severity "${severity}" is not one of ${VERIFIED_SEVERITIES.join(', ')}`;
  }
  if (!(VERIFIED_VERDICTS as readonly string[]).includes(verdict.toLowerCase())) {
    return `Verdict "${verdict}" is not one of ${VERIFIED_VERDICTS.join(', ')}`;
  }
  const answer = fixed.toLowerCase();
  if (answer !== 'yes' && answer !== 'no') {
    return `Fixed "${fixed}" is not yes or no`;
  }
  const named = commits.trim().toLowerCase();
  if (answer === 'yes' && (named === '' || named === 'none')) {
    return 'Fixed is yes but Commits names no commit';
  }
  return null;
}

/** C284.2's verifier rule (H17). */
export function verifierFindings(repo: Repository): readonly CheckFinding[] {
  if (!repo.exists(VERIFIED_FINDINGS_PATH)) {
    return [
      {
        rule: 'verifier-table',
        path: VERIFIED_FINDINGS_PATH,
        message:
          "11F: the verifier's table does not exist yet: pending (11F); --tag refuses a release without it",
        severity: 'owner',
      },
    ];
  }
  const tables = tablesOf(repo.readText(VERIFIED_FINDINGS_PATH)).filter(
    (table) => table.header.join('|') === VERIFIED_HEADER.join('|'),
  );
  if (tables.length === 0) {
    return [
      {
        rule: 'verifier-table',
        path: VERIFIED_FINDINGS_PATH,
        message: `no table with the header | ${VERIFIED_HEADER.join(' | ')} |`,
        severity: 'error',
      },
    ];
  }
  const findings: CheckFinding[] = [];
  for (const row of tables.flatMap((table) => table.rows)) {
    const [id = '', severity = '', verdict = '', fixed = '', commits = ''] = row.cells;
    // F006 (Workflow 11F review): a cell outside the frozen vocabulary fails the row, so a
    // malformed severity or verdict never lets a CRITICAL or HIGH through.
    const malformed = malformedVerifierRow(severity, verdict, fixed, commits);
    if (malformed !== null) {
      findings.push({
        rule: 'verifier-table',
        path: VERIFIED_FINDINGS_PATH,
        line: row.line,
        message: `${id}: ${malformed}`,
        severity: 'error',
      });
      continue;
    }
    const serious = ['CRITICAL', 'HIGH'].includes(severity.toUpperCase());
    const refuted = verdict.toLowerCase() === 'refuted';
    const isFixed = fixed.toLowerCase() === 'yes';
    if (serious && !refuted && !isFixed) {
      findings.push({
        rule: 'verifier-table',
        path: VERIFIED_FINDINGS_PATH,
        line: row.line,
        message: `${id} (${severity}, ${verdict}) is not fixed: a confirmed CRITICAL or HIGH is never closed by a record`,
        severity: 'error',
      });
    }
  }
  return findings;
}

/** C284.2's medium rule (H14), against the checklist's `As of` date. */
export function mediumFindings(repo: Repository): readonly CheckFinding[] {
  if (!repo.exists(CHECKLIST_PATH)) {
    return [];
  }
  const text = repo.readText(CHECKLIST_PATH);
  const asOf = parseChecklist(text).facts.asOf;
  const now = asOf === null ? Number.NaN : Date.parse(`${asOf}T00:00:00Z`);
  const findings: CheckFinding[] = [];
  for (const table of tablesOf(text)) {
    if (table.header.join('|') !== ADVISORIES_HEADER.join('|')) {
      continue;
    }
    for (const row of table.rows) {
      const [advisory = '', pkg = '', severity = '', published = ''] = row.cells;
      if (severity.toLowerCase() !== 'medium') {
        continue;
      }
      const at = Date.parse(`${published}T00:00:00Z`);
      if (Number.isNaN(at) || Number.isNaN(now)) {
        findings.push({
          rule: 'medium-advisory',
          path: CHECKLIST_PATH,
          line: row.line,
          message: `${advisory}: "${published}" is not a publication date (YYYY-MM-DD)`,
          severity: 'error',
        });
        continue;
      }
      const days = Math.floor((now - at) / DAY_MS);
      if (days > MEDIUM_TIME_FRAME_DAYS) {
        findings.push({
          rule: 'medium-advisory',
          path: CHECKLIST_PATH,
          line: row.line,
          message: `owner: ${advisory} (${pkg}, medium) was published ${String(days)} days before ${asOf ?? ''}, past its ${String(MEDIUM_TIME_FRAME_DAYS)}-day time frame`,
          severity: 'owner',
        });
      }
    }
  }
  return findings;
}
