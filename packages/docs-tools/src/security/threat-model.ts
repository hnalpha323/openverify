/**
 * C273.4 (Workflow 11E, docs-security): the threat model's parsing test. `docs/security/threat-model.md`
 * is the source of truth (C273.1); this module reads it and holds it to what a reader relies on:
 *
 * - every boundary of the boundaries table considers all six STRIDE letters, as a row or as a line
 *   `- <boundary> <letter>: not applicable because <reason>` (and never both);
 * - every row has a known status, a known boundary and letters, and an id that starts with its
 *   boundary and appears once;
 * - every `control` cites at least one repository path, and every path any row cites exists;
 * - every `gap` names a phase, a Workflow, the next release or a finding id;
 * - every `accepted` row is in the accepted-risks table (C273.3), every id there is an accepted row,
 *   and each risk names its monitoring: `metric: <name>` (a registered metric; the API suite's
 *   `metrics-documents.test.ts` checks the name, 11E decisions item 15) or an `operator check:`.
 *
 * Rows are the lines of every table whose header is C273.1's
 * `| id | boundary | STRIDE | threat | status | evidence | mitigation or owner |`.
 */
import type { CheckFinding, Repository } from '../types.js';

/** The threat model's path. */
export const THREAT_MODEL_PATH = 'docs/security/threat-model.md';

/** The six STRIDE letters. */
export const STRIDE_LETTERS = ['S', 'T', 'R', 'I', 'D', 'E'] as const;
export type StrideLetter = (typeof STRIDE_LETTERS)[number];

/** C273.1's four statuses. */
export const THREAT_STATUSES = ['control', 'gap', 'accepted', 'operator'] as const;
export type ThreatStatus = (typeof THREAT_STATUSES)[number];

/** One row of a threat table. */
export interface ThreatRow {
  readonly line: number;
  readonly id: string;
  readonly boundary: string;
  readonly stride: readonly string[];
  readonly threat: string;
  readonly status: string;
  readonly evidence: string;
  readonly mitigation: string;
}

/** A "not applicable because" line: a boundary's letter with no row, and why. */
export interface NotApplicable {
  readonly line: number;
  readonly boundary: string;
  readonly letter: string;
  readonly reason: string;
}

/** One row of the accepted-risks table (C273.3). */
export interface AcceptedRisk {
  readonly line: number;
  readonly risk: string;
  readonly rows: readonly string[];
  readonly monitoring: string;
}

export interface ThreatModel {
  readonly boundaries: readonly string[];
  readonly rows: readonly ThreatRow[];
  readonly notApplicable: readonly NotApplicable[];
  readonly acceptedRisks: readonly AcceptedRisk[];
}

const ROW_HEADER = [
  'id',
  'boundary',
  'stride',
  'threat',
  'status',
  'evidence',
  'mitigation or owner',
];
const BOUNDARY_HEADER = ['boundary', 'what crosses it'];
const ACCEPTED_HEADER = ['risk', 'rows', 'monitoring'];

const NOT_APPLICABLE = /^\s*-\s+(B\d+|BX)\s+([A-Z])\s*:\s*not applicable because\s+(\S.*)$/;
const DELIMITER = /^\|?\s*:?-{3,}/;
const ROW_ID = /\b(?:B\d+|BX)-[A-Z]\d+\b/g;

/** The cells of a table line (`| a | b |`), trimmed; `null` for a line that is not one. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }
  const inner = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split('|').map((cell) => cell.trim());
}

const lower = (cells: readonly string[]): string[] => cells.map((cell) => cell.toLowerCase());

const sameHeader = (cells: readonly string[], header: readonly string[]): boolean =>
  cells.length === header.length && lower(cells).every((cell, index) => cell === header[index]);

/** Parses the threat model's text. */
export function parseThreatModel(text: string): ThreatModel {
  const boundaries: string[] = [];
  const rows: ThreatRow[] = [];
  const notApplicable: NotApplicable[] = [];
  const acceptedRisks: AcceptedRisk[] = [];
  let table: 'rows' | 'boundaries' | 'accepted' | null = null;

  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const cells = cellsOf(raw);
    if (cells === null) {
      table = null;
      const match = NOT_APPLICABLE.exec(raw);
      if (match !== null) {
        notApplicable.push({
          line,
          boundary: match[1] ?? '',
          letter: match[2] ?? '',
          reason: (match[3] ?? '').trim(),
        });
      }
      return;
    }
    if (DELIMITER.test(raw.trim())) {
      return;
    }
    if (sameHeader(cells, ROW_HEADER)) {
      table = 'rows';
      return;
    }
    if (sameHeader(cells, BOUNDARY_HEADER)) {
      table = 'boundaries';
      return;
    }
    if (sameHeader(cells, ACCEPTED_HEADER)) {
      table = 'accepted';
      return;
    }
    if (table === 'boundaries') {
      boundaries.push(cells[0] ?? '');
    } else if (table === 'rows') {
      const [
        id = '',
        boundary = '',
        stride = '',
        threat = '',
        status = '',
        evidence = '',
        mitigation = '',
      ] = cells;
      rows.push({
        line,
        id,
        boundary,
        stride: stride
          .split(',')
          .map((letter) => letter.trim())
          .filter((letter) => letter !== ''),
        threat,
        status,
        evidence,
        mitigation,
      });
    } else if (table === 'accepted') {
      const [risk = '', ids = '', monitoring = ''] = cells;
      acceptedRisks.push({ line, risk, rows: ids.match(ROW_ID) ?? [], monitoring });
    }
  });
  return { boundaries, rows, notApplicable, acceptedRisks };
}

const BACKTICKED = /`([^`]+)`/g;
/** A repository-relative path: no space, a `/` inside, not a route (`/…`) or a scope (`a:b`). */
const PATH_LIKE = /^[A-Za-z0-9._@-][^\s:]*\/[^\s:]*$/;
/** A file's extension, so an event (`connect/share-token.created`) is never read as a path. */
const FILE_NAME =
  /(?:\.(?:api|cjs|csv|gradle|js|json|kt|kts|lockfile|md|mjs|pro|properties|py|sh|sql|toml|ts|tsx|txt|xml|ya?ml)|^Dockerfile|\.Dockerfile|^pre-commit)$/;

const isDigits = (text: string): boolean => text !== '' && /^\d+$/.test(text);

/** `path` without a trailing `:<line>` or `:<line>-<line>`. */
export function withoutLineSuffix(path: string): string {
  const colon = path.lastIndexOf(':');
  if (colon < 0) {
    return path;
  }
  const [from = '', to, ...rest] = path.slice(colon + 1).split('-');
  const isRange = rest.length === 0 && isDigits(from) && (to === undefined || isDigits(to));
  return isRange ? path.slice(0, colon) : path;
}

/** The repository paths a cell cites: backticked, holding a `/`, a directory or a file name. */
export function pathsCitedIn(cell: string): readonly string[] {
  const paths: string[] = [];
  for (const match of cell.matchAll(BACKTICKED)) {
    const token = withoutLineSuffix((match[1] ?? '').trim());
    if (!PATH_LIKE.test(token)) {
      continue;
    }
    const last = token.split('/').pop() ?? '';
    if (last === '' || FILE_NAME.test(last)) {
      paths.push(token);
    }
  }
  return paths;
}

/** Whether `path` (a file, or a directory with files) exists. */
export function evidencePathExists(repo: Repository, path: string): boolean {
  const bare = withoutLineSuffix(path);
  if (bare.endsWith('/')) {
    return repo.listFiles(bare.slice(0, -1)).length > 0;
  }
  return repo.exists(bare) || repo.listFiles(bare).length > 0;
}

/** A phase, a Workflow, the next release or a finding id (C273.4's gap rule). */
const GAP_OWNER =
  /\b(?:Phase \d+|Workflow 1\d[A-G]?|1[01][A-G]|KP\d{2}-\d+|K\d+[A-Z]?-[A-Z]?\d+|R0\d\d|E0\d\d|Q\d{1,2})\b|\bnext release\b/i;

const isStatus = (status: string): status is ThreatStatus =>
  (THREAT_STATUSES as readonly string[]).includes(status);
const isLetter = (letter: string): letter is StrideLetter =>
  (STRIDE_LETTERS as readonly string[]).includes(letter);

/** C273.4's rules over the parsed model. */
export function threatModelFindings(
  repo: Repository,
  model: ThreatModel,
  path: string = THREAT_MODEL_PATH,
): readonly CheckFinding[] {
  const findings: CheckFinding[] = [];
  const error = (rule: string, message: string, line?: number): void => {
    findings.push(
      line === undefined
        ? { rule, path, message, severity: 'error' }
        : { rule, path, line, message, severity: 'error' },
    );
  };

  if (model.boundaries.length === 0) {
    error('boundaries', 'no boundaries table (| boundary | what crosses it |)');
  }
  if (model.rows.length === 0) {
    error('rows', 'no threat rows (C273.1)');
  }

  const known = new Set(model.boundaries);
  const seen = new Set<string>();
  for (const row of model.rows) {
    if (!known.has(row.boundary)) {
      error(
        'boundary',
        `${row.id}: boundary ${row.boundary} is not in the boundaries table`,
        row.line,
      );
    }
    if (!row.id.startsWith(`${row.boundary}-`)) {
      error('id', `${row.id}: an id starts with its boundary (${row.boundary}-)`, row.line);
    }
    if (seen.has(row.id)) {
      error('unique-id', `${row.id}: the id appears more than once`, row.line);
    }
    seen.add(row.id);
    if (row.stride.length === 0 || !row.stride.every(isLetter)) {
      error(
        'stride',
        `${row.id}: STRIDE letters are S, T, R, I, D and E ("${row.stride.join(', ')}")`,
        row.line,
      );
    }
    if (!isStatus(row.status)) {
      error(
        'status',
        `${row.id}: unknown status "${row.status}" (control, gap, accepted, operator)`,
        row.line,
      );
    }
    const cited = pathsCitedIn(row.evidence);
    if (row.status === 'control' && cited.length === 0) {
      error(
        'control-evidence',
        `${row.id}: a control cites at least one repository path`,
        row.line,
      );
    }
    for (const cite of cited) {
      if (!evidencePathExists(repo, cite)) {
        error('evidence-path', `${row.id}: ${cite} does not exist`, row.line);
      }
    }
    if (row.status === 'gap' && !GAP_OWNER.test(row.mitigation)) {
      error(
        'gap-owner',
        `${row.id}: a gap names a phase, the next release or a finding id`,
        row.line,
      );
    }
  }

  const covered = new Map<string, Set<string>>();
  for (const row of model.rows) {
    const letters = covered.get(row.boundary) ?? new Set<string>();
    row.stride.forEach((letter) => letters.add(letter));
    covered.set(row.boundary, letters);
  }
  const declared = new Map<string, Set<string>>();
  for (const item of model.notApplicable) {
    const letters = declared.get(item.boundary) ?? new Set<string>();
    letters.add(item.letter);
    declared.set(item.boundary, letters);
  }
  for (const boundary of model.boundaries) {
    const missing = STRIDE_LETTERS.filter(
      (letter) =>
        !(covered.get(boundary)?.has(letter) ?? false) &&
        !(declared.get(boundary)?.has(letter) ?? false),
    );
    if (missing.length > 0) {
      error(
        'stride-coverage',
        `${boundary}: no row and no "not applicable because" line for ${missing.join(', ')}`,
      );
    }
  }
  for (const item of model.notApplicable) {
    if (covered.get(item.boundary)?.has(item.letter) ?? false) {
      error(
        'not-applicable-covered',
        `${item.boundary} ${item.letter}: declared not applicable, but a row covers it`,
        item.line,
      );
    }
  }

  const listed = new Set(model.acceptedRisks.flatMap((risk) => risk.rows));
  const accepted = new Set(
    model.rows.filter((row) => row.status === 'accepted').map((row) => row.id),
  );
  for (const id of accepted) {
    if (!listed.has(id)) {
      error(
        'accepted-risks',
        `${id}: an accepted row is listed in the accepted-risks table (C273.3)`,
      );
    }
  }
  for (const risk of model.acceptedRisks) {
    for (const id of risk.rows) {
      if (!accepted.has(id)) {
        error(
          'accepted-risks',
          `${id}: listed as an accepted risk but not an accepted row`,
          risk.line,
        );
      }
    }
    if (!/\bmetric:\s*[a-z]/.test(risk.monitoring) && !/\boperator check:/i.test(risk.monitoring)) {
      error(
        'accepted-monitoring',
        `${risk.risk}: monitoring names a metric (metric: <name>) or an operator check`,
        risk.line,
      );
    }
  }
  return findings;
}
