/**
 * C279.1 (H27): the calibration reports' summary blocks, read one way. Each report under
 * `docs/calibration/` carries exactly one block between {@link SUMMARY_START} and
 * {@link SUMMARY_END} (Workflow 11D Stage 1a amendment 14; 11E decisions item 16), one fenced
 * `json` object valid against `contracts/fixtures/calibration/summary.schema.json`. The catalog
 * prints each headline figure in the form the report's own text writes it ({@link figureForm}),
 * so a block that drifts from its report fails {@link calibrationFindings}.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { CheckFinding, Repository } from '../types.js';

export const SUMMARY_START = '<!-- openverify:calibration-summary:start -->';
export const SUMMARY_END = '<!-- openverify:calibration-summary:end -->';
export const SUMMARY_SCHEMA_PATH = 'contracts/fixtures/calibration/summary.schema.json';
export const CALIBRATION_DIR = 'docs/calibration';

export interface CalibrationBudget {
  readonly metric: string;
  readonly comparison: string;
  readonly value: number;
  readonly unit: string;
}

export interface CalibrationRow {
  readonly id: string;
  readonly title: string;
  readonly contract: string;
  readonly owner: string;
  readonly budget: CalibrationBudget | null;
  readonly verdict: string;
  readonly median: number | null;
  readonly unit: string | null;
  readonly gap: number | null;
  readonly configuration: string;
}

export interface CalibrationMachine {
  readonly cpu: string;
  readonly 'logical-cpus': number;
  readonly 'memory-gib': number;
  readonly 'disk-class': string;
}

export interface CalibrationSummary {
  readonly report: string;
  readonly workflow: string;
  readonly status: string;
  readonly head: string | null;
  readonly machine: CalibrationMachine | null;
  readonly rows: readonly CalibrationRow[];
}

/** One report: its block (null when it has none or an invalid one), its prose and its errors. */
export interface CalibrationReport {
  readonly path: string;
  readonly summary: CalibrationSummary | null;
  /** The report's text without its block: where a figure must also appear. */
  readonly prose: string;
  readonly errors: readonly string[];
}

/** A reference from a catalog entry to rows of a report (an empty list cites the report alone). */
export interface CalibrationReference {
  readonly report: string;
  readonly rows: readonly string[];
}

/** Which reports and rows each check, report type and signal cites. */
export interface CalibrationSources {
  readonly checks: Readonly<Record<string, readonly CalibrationReference[]>>;
  readonly reports: Readonly<Record<string, readonly CalibrationReference[]>>;
  readonly signals: Readonly<Record<string, readonly CalibrationReference[]>>;
}

const report = (name: string, ...rows: string[]): CalibrationReference =>
  Object.freeze({ report: `${CALIBRATION_DIR}/${name}.md`, rows: Object.freeze(rows) });

const GOVERNMENT_ID = (...rows: string[]) => [report('government-id-phase3', ...rows)];
const FACE_MATCH = [
  report('selfie-phase4', 'face-match-threshold-far-1e-3', 'shared-threshold-far'),
  report('selfie-phase4-method'),
];
const MATCHER = (...extra: string[]) => [
  report('watchlist-phase6', 'c78-7-100k', 'c78-7-2m', 'rescreen-1000', ...extra),
  report('watchlist-phase6c', 'c78-7-100k', 'c78-7-2m', 'rescreen-1000'),
  report('watchlist-phase6d', 'c78-7-100k', 'c78-7-2m', 'rescreen-1000'),
  report('watchlist-phase11', 'c787-100k', 'c787-2m', 'rescreen-1000'),
  report('load-phase11', 'screening-throughput-2m'),
];

/**
 * Ours (docs-catalog): the reports each catalog entry cites, by the rows that measure it. A
 * report a check rests on with no row of its own (no variant was built to trip it) is cited with
 * no rows. The Android document guidance report is cited by no server check: its constants decide
 * only when the SDK takes a photo (C202.5), and the catalog lists it under "Calibration reports".
 */
export const CALIBRATION_SOURCES: CalibrationSources = Object.freeze({
  checks: Object.freeze({
    id_unprocessable_submission_detection: GOVERNMENT_ID(
      'id-unprocessable-submission-detection-min-text-lines',
    ),
    id_blur_detection: GOVERNMENT_ID(
      'id-blur-detection-min-document-blur-score',
      'id-blur-detection-min-document-width-px',
    ),
    id_glare_detection: GOVERNMENT_ID('id-glare-detection-max-document-glare-ratio'),
    id_double_side_detection: GOVERNMENT_ID(
      'id-double-side-detection-min-front-back-phash-distance',
    ),
    id_portrait_clarity_detection: GOVERNMENT_ID(),
    id_color_inconsistency_detection: GOVERNMENT_ID(
      'id-color-inconsistency-detection-max-color-inconsistency-score',
    ),
    id_electronic_replica_detection: GOVERNMENT_ID(
      'id-electronic-replica-detection-max-electronic-replica-score',
    ),
    id_tamper_detection: GOVERNMENT_ID('id-tamper-detection-max-tamper-score'),
    id_fabrication_detection: GOVERNMENT_ID(),
    id_handwriting_detection: GOVERNMENT_ID('id-handwriting-detection-max-handwriting-score'),
    id_entity_detection: GOVERNMENT_ID(),
    id_repeat_detection: GOVERNMENT_ID('id-repeat-detection-max-phash-distance'),
    id_inconsistent_repeat_detection: FACE_MATCH,
    id_selfie_comparison: FACE_MATCH,
    id_nfc_selfie_comparison: FACE_MATCH,
    selfie_id_comparison: FACE_MATCH,
    selfie_account_comparison: FACE_MATCH,
    selfie_repeat_detection: [
      report('selfie-phase4', 'selfie-repeat-threshold-frr'),
      report('selfie-phase4-method'),
    ],
    selfie_liveness_detection: [report('selfie-phase4')],
    selfie_suspicious_entity_detection: [report('selfie-phase4')],
  }),
  reports: Object.freeze({
    watchlist: MATCHER('recall-persons-tolerant'),
    'business-watchlist': MATCHER(),
    'politically-exposed-person': MATCHER(),
    'custom-list': [
      report(
        'lists-phase11',
        'fuzzy-name-cap',
        'face-list-threshold',
        'background-list-thresholds',
      ),
      report('load-phase11', 'lists-match'),
    ],
    'ip-address': [report('load-phase11', 'network-lookup')],
  }),
  signals: Object.freeze({}),
});

const FENCED = /^\n```json\n([\s\S]*)\n```\n$/;

/** A summary validator from the committed schema (ajv, draft 2020-12). */
function validatorFor(repo: Repository): ((value: unknown) => readonly string[]) | null {
  if (!repo.exists(SUMMARY_SCHEMA_PATH)) {
    return null;
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(repo.readText(SUMMARY_SCHEMA_PATH)) as object);
  return (value) =>
    validate(value)
      ? []
      : (validate.errors ?? []).map(
          (error) =>
            `${error.instancePath === '' ? '/' : error.instancePath} ${String(error.message)}`,
        );
}

function readOne(
  path: string,
  text: string,
  validate: ((value: unknown) => readonly string[]) | null,
): CalibrationReport {
  const count = text.split(SUMMARY_START).length - 1;
  if (count === 0) {
    return { path, summary: null, prose: text, errors: ['no summary block'] };
  }
  if (count > 1) {
    return { path, summary: null, prose: text, errors: ['more than one summary block'] };
  }
  const [before = '', rest = ''] = text.split(SUMMARY_START);
  const end = rest.indexOf(SUMMARY_END);
  const inner = end < 0 ? rest : rest.slice(0, end);
  const prose = before + (end < 0 ? '' : rest.slice(end + SUMMARY_END.length));
  const fenced = FENCED.exec(inner);
  if (end < 0 || fenced?.[1] === undefined) {
    return {
      path,
      summary: null,
      prose,
      errors: ['the summary block is not one fenced json block'],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(fenced[1]);
  } catch {
    return { path, summary: null, prose, errors: ['the summary block is not valid JSON'] };
  }
  const invalid = validate === null ? ['no schema to validate against'] : validate(value);
  if (invalid.length > 0) {
    return { path, summary: null, prose, errors: invalid.map((error) => `invalid: ${error}`) };
  }
  const summary = value as CalibrationSummary;
  const errors =
    summary.report === path ? [] : [`the block names ${summary.report}, not its own path`];
  return { path, summary, prose, errors };
}

/** Every Markdown report under `docs/calibration/`, sorted by path, each read with its block. */
export const readCalibrationReports: (repo: Repository) => readonly CalibrationReport[] = (
  repo,
) => {
  const validate = validatorFor(repo);
  return repo
    .listFiles(CALIBRATION_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => readOne(file, repo.readText(file), validate));
};

/** `1234567.5` as `1,234,567.5`: thousands separated with commas, as the reports write them. */
export function grouped(text: string): string {
  const [whole = '', fraction] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign === '' ? whole : whole.slice(1);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${sign}${groups.join(',')}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** Whether `needle` occurs in `text` with no digit, `.` or `,` before it and no digit after it. */
export function occursAsNumber(text: string, needle: string): boolean {
  const isDigit = (character: string): boolean => character >= '0' && character <= '9';
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : text.charAt(at - 1);
    const after = text.charAt(at + needle.length);
    if (!isDigit(before) && before !== '.' && before !== ',' && !isDigit(after)) {
      return true;
    }
  }
  return false;
}

/** The forms a figure may be written in, the most precise first (ours, docs-catalog). */
function candidates(value: number, unit: string | null): readonly string[] {
  const forms: string[] = [];
  const add = (text: string): void => {
    forms.push(text, grouped(text));
  };
  if (Number.isInteger(value)) {
    add(value.toFixed(1));
    add(String(value));
  } else {
    add(String(value));
    if (unit === 'ratio' || unit === 'percent') {
      forms.push(`${(value * 100).toFixed(2)}%`, `${(value * 100).toFixed(1)}%`);
    }
    for (const digits of [4, 3, 2, 1]) {
      add(value.toFixed(digits));
    }
    for (const digits of [3, 2, 1]) {
      forms.push(value.toExponential(digits));
    }
    for (const precision of [4, 3, 2]) {
      add(String(Number(value.toPrecision(precision))));
    }
  }
  return [...new Set(forms)];
}

/**
 * The form of `value` that the report's own text (`prose`, the report without its block) writes,
 * as a whole number (not part of a longer one), or `null` when no form appears. The catalog prints
 * this form, so every figure it shows can be found in the report it cites (H27).
 */
export const figureForm: (value: number, unit: string | null, prose: string) => string | null = (
  value,
  unit,
  prose,
) => candidates(value, unit).find((form) => occursAsNumber(prose, form)) ?? null;

/** Every problem with the reports' blocks, the references and the figures. */
export const calibrationFindings: (repo: Repository) => readonly CheckFinding[] = (repo) => {
  const reports = readCalibrationReports(repo);
  const byPath = new Map(reports.map((item) => [item.path, item]));
  const error = (path: string, message: string): CheckFinding => ({
    rule: 'calibration-summary',
    path,
    message,
    severity: 'error',
  });
  const blocks = reports.flatMap((item) => [
    ...item.errors.map((message) => error(item.path, message)),
    ...(item.summary?.rows ?? []).flatMap((row) =>
      row.median !== null && figureForm(row.median, row.unit, item.prose) === null
        ? [
            error(
              item.path,
              `row ${row.id}: its figure ${String(row.median)} is not in the report's text`,
            ),
          ]
        : [],
    ),
  ]);
  const references = [
    ...Object.entries(CALIBRATION_SOURCES.checks),
    ...Object.entries(CALIBRATION_SOURCES.reports),
    ...Object.entries(CALIBRATION_SOURCES.signals),
  ].flatMap(([entry, cited]) =>
    cited.flatMap((reference) => {
      const target = byPath.get(reference.report);
      if (target === undefined) {
        return [error(reference.report, `${entry} cites a report that does not exist`)];
      }
      const ids = new Set(target.summary?.rows.map((row) => row.id));
      return reference.rows
        .filter((id) => !ids.has(id))
        .map((id) => error(reference.report, `${entry} cites a row ${id} the block does not hold`));
    }),
  );
  return [...blocks, ...references];
};
