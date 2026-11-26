/**
 * C274.3 and C275.3 (Workflow 11E, docs-security): the ASVS 5.0.0 Level 2 and MASVS v2.1.0
 * checklists' evidence test. Each CSV holds exactly the committed ids (no requirement or control
 * text, C274.2, C275.2), our status, our evidence paths and our notes:
 *
 * - the ids are exactly the committed list's, in its order, each once, with its level (ASVS) or
 *   group (MASVS);
 * - every status is one of C274.1's five, and every evidence path exists;
 * - a `met` row cites at least one test or check that ran locally (11E decisions item 6: a CI job may
 *   be named beside it, never alone);
 * - a `not_applicable`, `partial` or `operator` row says why in `notes`; a `gap` row names a phase, a
 *   Workflow, the next release or a finding id;
 * - every `threats` id exists in the threat model; every row has a review date and commit;
 * - a metric a row names is registered (the API suite's `metrics-documents.test.ts` covers the ASVS
 *   CSV, not the MASVS one, so this rule reads both with the same functions, imported).
 *
 * Evidence and threats are `; `-separated lists of repository paths and threat ids.
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { unregisteredMetricsIn } from '../../../../apps/api/src/metrics-documents.js';
import { metrics } from '../../../../apps/api/src/metrics-registry.js';
import type { CheckFinding, Repository } from '../types.js';
import { evidencePathExists } from './threat-model.js';

export const ASVS_CSV_PATH = 'docs/security/asvs-5.0.0-l2.csv';
export const ASVS_IDS_PATH = 'docs/security/asvs-5.0.0-l2-ids.txt';
export const MASVS_CSV_PATH = 'docs/security/masvs-2.1.0.csv';
export const MASVS_IDS_PATH = 'docs/security/masvs-2.1.0-ids.txt';

/** C274.1's columns, in order. */
export const SECURITY_CHECKLIST_COLUMNS = [
  'id',
  'level',
  'status',
  'evidence',
  'notes',
  'threats',
  'reviewed_at',
  'reviewed_commit',
] as const;

/** C274.1's five statuses. */
export const SECURITY_CHECKLIST_STATUSES = [
  'met',
  'partial',
  'gap',
  'not_applicable',
  'operator',
] as const;
export type SecurityChecklistStatus = (typeof SECURITY_CHECKLIST_STATUSES)[number];

/** One committed id and its level (ASVS) or group (MASVS). */
export interface StandardId {
  readonly id: string;
  readonly level: string;
}

/** One checklist row, with its evidence and threats split. */
export interface SecurityChecklistRow {
  readonly line: number;
  readonly id: string;
  readonly level: string;
  readonly status: string;
  readonly evidence: readonly string[];
  readonly notes: string;
  readonly threats: readonly string[];
  readonly reviewedAt: string;
  readonly reviewedCommit: string;
}

/** What the evidence test reads beside a checklist. */
export interface SecurityChecklistContext {
  readonly csvPath: string;
  readonly ids: readonly StandardId[];
  readonly threatIds: ReadonlySet<string>;
}

/** Parses a committed id list (`#` lines skipped, `<id> <level-or-group>` per line). */
export function parseStandardIdList(text: string): readonly StandardId[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [id = '', level = ''] = line.split(' ');
      return { id, level };
    });
}

const listOf = (cell: string): readonly string[] =>
  cell
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');

/** Parses a checklist CSV; a header other than C274.1's throws. */
export function parseSecurityChecklist(text: string): readonly SecurityChecklistRow[] {
  const records: string[][] = parse(text, { relax_column_count: true, skip_empty_lines: true });
  const [header = [], ...rows] = records;
  if (header.join(',') !== SECURITY_CHECKLIST_COLUMNS.join(',')) {
    throw new Error(
      `a checklist's columns are ${SECURITY_CHECKLIST_COLUMNS.join(', ')} (C274.1), not ${header.join(', ')}`,
    );
  }
  return rows.map((cells, index) => {
    const [
      id = '',
      level = '',
      status = '',
      evidence = '',
      notes = '',
      threats = '',
      at = '',
      commit = '',
    ] = cells;
    return {
      line: index + 2,
      id,
      level,
      status,
      evidence: listOf(evidence),
      notes,
      threats: listOf(threats),
      reviewedAt: at,
      reviewedCommit: commit,
    };
  });
}

/** A test file of any suite, or a contract test of a shell, chart or Python check. */
const TEST_FILE =
  /(?:\.(?:test|spec)\.(?:ts|tsx|mjs|js)|(?:^|\/)test_[^/]+\.py|Test\.kt|\.test\.sh|_test\.yaml)$/;

/** Whether an evidence path is a test or a check that runs locally (11E decisions item 6). */
export function isTestEvidence(path: string): boolean {
  return TEST_FILE.test(path);
}

/** A phase, a Workflow, the next release or a finding id (the threat model's gap rule). */
const GAP_OWNER =
  /\b(?:Phase \d+|Workflow 1\d[A-G]?|1[01][A-G]|KP\d{2}-\d+|K\d+[A-Z]?-[A-Z]?\d+|R0\d\d|E0\d\d|Q\d{1,2})\b|\bnext release\b/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

const isStatus = (status: string): status is SecurityChecklistStatus =>
  (SECURITY_CHECKLIST_STATUSES as readonly string[]).includes(status);

/** A new checklist for `ids`: every id at `gap`, no evidence (a version migration starts here). */
export function securityChecklistSkeleton(ids: readonly StandardId[], reviewedAt: string): string {
  return stringify(
    [
      [...SECURITY_CHECKLIST_COLUMNS],
      ...ids.map((item) => [
        item.id,
        item.level,
        'gap',
        '',
        'Not yet assessed against this version; next release.',
        '',
        reviewedAt,
        '0000000',
      ]),
    ],
    { record_delimiter: '\n' },
  );
}

/** C274.3's id rules: exactly the committed ids, each once, in the committed order. */
function idFindings(
  rows: readonly SecurityChecklistRow[],
  context: SecurityChecklistContext,
  error: (rule: string, message: string, line?: number) => void,
): void {
  const committed = new Set(context.ids.map((item) => item.id));
  const present = new Set(rows.map((row) => row.id));
  for (const item of context.ids) {
    if (!present.has(item.id)) {
      error('missing-id', `${item.id}: a committed id has no row`);
    }
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!committed.has(row.id)) {
      error('extra-id', `${row.id}: not in the committed id list`, row.line);
    } else if (seen.has(row.id)) {
      error('duplicate-id', `${row.id}: the id appears more than once`, row.line);
    }
    seen.add(row.id);
  }
  const listed = rows.map((row) => row.id).filter((id) => committed.has(id));
  const expected = context.ids.map((item) => item.id).filter((id) => present.has(id));
  if (new Set(listed).size === listed.length && listed.join('\n') !== expected.join('\n')) {
    error('order', "the rows are not in the committed list's order");
  }
}

/** C274.3's rules for one row. */
function rowFindings(
  repo: Repository,
  row: SecurityChecklistRow,
  context: SecurityChecklistContext,
  level: string | undefined,
  error: (rule: string, message: string, line?: number) => void,
): void {
  const fail = (rule: string, message: string): void => {
    error(rule, `${row.id}: ${message}`, row.line);
  };
  if (level !== undefined && level !== row.level) {
    fail('level', `level ${row.level}, the committed list says ${level}`);
  }
  if (!isStatus(row.status)) {
    fail('status', `unknown status "${row.status}"`);
  }
  for (const path of row.evidence) {
    if (!evidencePathExists(repo, path)) {
      fail('evidence-path', `${path} does not exist`);
    }
  }
  if (row.status === 'met' && !row.evidence.some(isTestEvidence)) {
    fail('met-evidence', 'a met row cites a test or check that ran locally');
  }
  const needsReason = ['not_applicable', 'partial', 'operator'].includes(row.status);
  if (needsReason && row.notes.trim() === '') {
    fail('reason', `a ${row.status} row says why in notes`);
  }
  if (row.status === 'gap' && !GAP_OWNER.test(row.notes)) {
    fail('gap-owner', 'a gap row names a phase, the next release or a finding id');
  }
  for (const threat of row.threats) {
    if (!context.threatIds.has(threat)) {
      fail('threat-id', `${threat} is not a threat-model id`);
    }
  }
  if (!DATE.test(row.reviewedAt)) {
    fail('reviewed-at', 'reviewed_at is a date (YYYY-MM-DD)');
  }
  if (!COMMIT.test(row.reviewedCommit)) {
    fail('reviewed-commit', 'reviewed_commit is a commit id');
  }
  for (const name of unregisteredMetricsIn(row.notes, metrics)) {
    fail('metric-name', `names the metric ${name}, which is not registered (C250.7)`);
  }
}

/** C274.3's rules over one checklist. */
export function securityChecklistFindings(
  repo: Repository,
  rows: readonly SecurityChecklistRow[],
  context: SecurityChecklistContext,
): readonly CheckFinding[] {
  const findings: CheckFinding[] = [];
  const error = (rule: string, message: string, line?: number): void => {
    findings.push(
      line === undefined
        ? { rule, path: context.csvPath, message, severity: 'error' }
        : { rule, path: context.csvPath, line, message, severity: 'error' },
    );
  };
  idFindings(rows, context, error);
  const levels = new Map(context.ids.map((item) => [item.id, item.level]));
  for (const row of rows) {
    rowFindings(repo, row, context, levels.get(row.id), error);
  }
  return findings;
}
