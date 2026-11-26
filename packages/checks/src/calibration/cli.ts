/**
 * Reads the raw measurements of `tools/calibrate_government_id.py` and writes the C36 report
 * (`scripts/calibration-report.ts` is the command line around it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { calibrationReport, renderCalibrationMarkdown } from './report.js';
import { renderSelfieCalibrationMarkdown, selfieCalibrationReport } from './selfie-report.js';

export interface RunCalibrationOptions {
  /** The measurements JSON. */
  input: string;
  /** The Markdown report; its folder is created. */
  output: string;
  /** The evaluation instant. */
  now: Date;
  /** C49: the face-match (selfie) report instead of the C36 government ID one. */
  selfie?: boolean;
  /** Selfie mode: the bootstrap's seed and replicates. */
  seed?: number;
  replicates?: number;
}

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** The measurements file `tools/calibrate_government_id.py` writes by default (gitignored). */
export const DEFAULT_MEASUREMENTS = path.join(
  REPO_ROOT,
  'fixtures/generated/calibration/government-id-measurements.json',
);
/** The report the plan names (C36). */
export const DEFAULT_REPORT = path.join(REPO_ROOT, 'docs/calibration/government-id-phase3.md');

/** The measurements file `tools/calibrate_selfie.py` writes by default (gitignored, C49). */
export const DEFAULT_SELFIE_MEASUREMENTS = path.join(
  REPO_ROOT,
  'fixtures/generated/calibration/selfie-measurements.json',
);
/** The selfie report the plan names (C49). */
export const DEFAULT_SELFIE_REPORT = path.join(REPO_ROOT, 'docs/calibration/selfie-phase4.md');

const ISO_INSTANT =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** A whole number option within bounds. */
function wholeNumber(name: string, value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a whole number from ${String(min)} to ${String(max)}`);
  }
  return parsed;
}

/**
 * The command line's options: `--input <measurements.json>`, `--output <report.md>` (relative
 * paths resolve against `cwd`) and `--now <ISO-8601>` (expiry and age depend on it; default
 * `now`). `--selfie` writes the C49 face-match report instead (its own default input and output),
 * with `--seed` and `--replicates` for its bootstrap. Unknown options are refused.
 */
export function parseCalibrationArgs(
  argv: readonly string[],
  options: { cwd: string; now: Date },
): RunCalibrationOptions {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      now: { type: 'string' },
      selfie: { type: 'boolean' },
      seed: { type: 'string' },
      replicates: { type: 'string' },
    },
  });
  let now = options.now;
  if (values.now !== undefined) {
    now = new Date(values.now);
    if (!ISO_INSTANT.test(values.now) || Number.isNaN(now.getTime())) {
      throw new Error(`--now must be an ISO-8601 instant, got ${JSON.stringify(values.now)}`);
    }
  }
  const selfie = values.selfie === true;
  const input = selfie ? DEFAULT_SELFIE_MEASUREMENTS : DEFAULT_MEASUREMENTS;
  const output = selfie ? DEFAULT_SELFIE_REPORT : DEFAULT_REPORT;
  return {
    input: values.input === undefined ? input : path.resolve(options.cwd, values.input),
    output: values.output === undefined ? output : path.resolve(options.cwd, values.output),
    now,
    ...(selfie ? { selfie } : {}),
    ...(values.seed === undefined
      ? {}
      : { seed: wholeNumber('--seed', values.seed, 0, 4_294_967_295) }),
    ...(values.replicates === undefined
      ? {}
      : { replicates: wholeNumber('--replicates', values.replicates, 1, 100_000) }),
  };
}

const SUMMARY_HEADING = '\n## Summary block\n';
const SUMMARY_END = '<!-- openverify:calibration-summary:end -->';

/**
 * KP11-75 (Workflow 11F): the report `rendered` followed by the summary block section of the
 * report it replaces, unchanged, from its `## Summary block` heading through the block's end
 * marker (C279.1; docs-catalog added them in Workflow 11E, and the check catalog reads them). The
 * block's figures were copied from the report's text, which `catalog-calibration` holds.
 */
export function withCommittedSummary(rendered: string, previous: string | null): string {
  if (previous === null) {
    return rendered;
  }
  const start = previous.indexOf(SUMMARY_HEADING);
  const end = previous.indexOf(SUMMARY_END, start);
  if (start === -1 || end === -1) {
    return rendered;
  }
  return `${rendered}${previous.slice(start, end + SUMMARY_END.length)}\n`;
}

/** Writes `text` to `output`, keeping the summary block of the report already there. */
function writeReport(output: string, text: string): void {
  mkdirSync(path.dirname(output), { recursive: true });
  const previous = existsSync(output) ? readFileSync(output, 'utf8') : null;
  writeFileSync(output, withCommittedSummary(text, previous), 'utf8');
}

/** Writes the report and returns how many variants and AAMVA images it covers. */
export function runCalibrationReport(options: RunCalibrationOptions): {
  variants: number;
  aamva: number;
} {
  const measurements: unknown = JSON.parse(readFileSync(options.input, 'utf8'));
  const report = calibrationReport(measurements, {
    now: options.now,
    source: `\`${path.basename(options.input)}\``,
  });
  writeReport(options.output, renderCalibrationMarkdown(report));
  return { variants: report.variants.length, aamva: report.aamva.length };
}

/** Selfie mode: writes the C49 report and returns how many pairs and identities it covers. */
export function runSelfieCalibrationReport(options: RunCalibrationOptions): {
  pairs: number;
  identities: number;
} {
  const measurements: unknown = JSON.parse(readFileSync(options.input, 'utf8'));
  const report = selfieCalibrationReport(measurements, {
    seed: options.seed,
    replicates: options.replicates,
    source: `\`${path.basename(options.input)}\``,
  });
  writeReport(options.output, renderSelfieCalibrationMarkdown(report));
  return {
    pairs: report.counts.genuinePairs + report.counts.impostorPairs,
    identities: report.counts.identities,
  };
}
