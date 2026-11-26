/**
 * Workflow 11D's verdicts as the release reads them (docs-release; KP11-49, C271.4, C284.4): the
 * summary block of each Phase 11 calibration report (`openverify/calibration-summary@1`, validated
 * against `contracts/fixtures/calibration/summary.schema.json`; Workflow 11D Stage 1a amendment
 * 14), never the prose. Each row that is missed, not measured, invalid or not calibrated has a
 * checklist line `11D/<row id>`, and the release notes carry it with its gap. No verdict is
 * re-judged here.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { CheckFinding, Repository } from '../types.js';
import { CHECKLIST_PATH, parseChecklist } from './checklist.js';

export const CALIBRATION_REPORTS = [
  'docs/calibration/load-phase11.md',
  'docs/calibration/watchlist-phase11.md',
  'docs/calibration/lists-phase11.md',
] as const;
export const SUMMARY_SCHEMA_PATH = 'contracts/fixtures/calibration/summary.schema.json';
export const SUMMARY_START = '<!-- openverify:calibration-summary:start -->';
export const SUMMARY_END = '<!-- openverify:calibration-summary:end -->';

/** The verdicts the checklist and the notes must carry (KP11-49). */
export const NOT_MET_VERDICTS = ['missed', 'not-measured', 'invalid', 'not-calibrated'] as const;

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
  readonly budget: CalibrationBudget | null;
  readonly verdict: string;
  readonly median: number | null;
  readonly unit: string | null;
  readonly gap: number | null;
  readonly configuration: string;
}

export interface CalibrationSummary {
  readonly report: string;
  readonly workflow: string;
  readonly head: string | null;
  readonly machine: {
    readonly cpu: string;
    readonly 'logical-cpus': number;
    readonly 'memory-gib': number;
    readonly 'disk-class': string;
  } | null;
  readonly rows: readonly CalibrationRow[];
}

/** The one summary block of `text`, validated against `schema`, or the reason it is not usable. */
export function parseSummaryBlock(text: string, schema: object): CalibrationSummary | string {
  const parts = text.split(SUMMARY_START);
  if (parts.length !== 2) {
    return parts.length === 1 ? 'no calibration summary block' : 'more than one summary block';
  }
  const inner = parts[1] ?? '';
  const end = inner.indexOf(SUMMARY_END);
  if (end < 0) {
    return 'the summary block has no end marker';
  }
  const body = inner.slice(0, end);
  let value: unknown;
  try {
    value = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
  } catch {
    return 'the summary block is not JSON';
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    return `the summary block does not match ${SUMMARY_SCHEMA_PATH}: ${ajv.errorsText(validate.errors)}`;
  }
  return value as CalibrationSummary;
}

/** The three reports' summaries, in order, and a finding per report that cannot be read. */
export function readCalibrations(repo: Repository): {
  readonly summaries: readonly CalibrationSummary[];
  readonly findings: readonly CheckFinding[];
} {
  const summaries: CalibrationSummary[] = [];
  const findings: CheckFinding[] = [];
  if (!repo.exists(SUMMARY_SCHEMA_PATH)) {
    return {
      summaries,
      findings: [
        {
          rule: 'calibration',
          path: SUMMARY_SCHEMA_PATH,
          message: 'the summary schema does not exist',
          severity: 'error',
        },
      ],
    };
  }
  const schema = JSON.parse(repo.readText(SUMMARY_SCHEMA_PATH)) as object;
  for (const report of CALIBRATION_REPORTS) {
    if (!repo.exists(report)) {
      findings.push({
        rule: 'calibration',
        path: report,
        message: 'the report does not exist',
        severity: 'error',
      });
      continue;
    }
    const summary = parseSummaryBlock(repo.readText(report), schema);
    if (typeof summary === 'string') {
      findings.push({ rule: 'calibration', path: report, message: summary, severity: 'error' });
    } else {
      summaries.push(summary);
    }
  }
  return { summaries, findings };
}

export const isNotMet = (row: CalibrationRow): boolean =>
  (NOT_MET_VERDICTS as readonly string[]).includes(row.verdict);

/** KP11-49's checklist half: each row not met has a checklist line `11D/<row id>`. */
export function calibrationFindings(repo: Repository): readonly CheckFinding[] {
  const { summaries, findings } = readCalibrations(repo);
  const ids = new Set(
    repo.exists(CHECKLIST_PATH)
      ? parseChecklist(repo.readText(CHECKLIST_PATH)).lines.map((line) => line.id)
      : [],
  );
  const missing = summaries.flatMap((summary) =>
    summary.rows
      .filter((row) => isNotMet(row) && !ids.has(`11D/${row.id}`))
      .map((row): CheckFinding => ({
        rule: 'calibration',
        path: CHECKLIST_PATH,
        message: `${summary.report}'s row ${row.id} is ${row.verdict} and has no checklist line 11D/${row.id} (KP11-49)`,
        severity: 'error',
      })),
  );
  return [...findings, ...missing];
}
