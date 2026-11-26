/**
 * The C36 calibration report: scores the raw measurements of every synthetic variant with the
 * real evaluators and writes `docs/calibration/government-id-phase3.md`.
 *
 *     cd services/vision && uv run python tools/calibrate_government_id.py
 *     pnpm --filter @openverify/checks calibration:report [--now <ISO-8601>]
 *         [--input <measurements.json>] [--output <report.md>]
 *
 * The input defaults to the calibration tool's output, the report to the path the plan names.
 * Pin `--now` for a reproducible report: expiry and age depend on it.
 *
 * The C49 face-match report (selfie mode):
 *
 *     cd services/vision && uv run python tools/calibrate_selfie.py
 *     pnpm --filter @openverify/checks calibration:report --selfie [--seed <n>] [--replicates <n>]
 *         [--input <selfie-measurements.json>] [--output <report.md>]
 *
 * It reads `fixtures/generated/calibration/selfie-measurements.json` and writes
 * `docs/calibration/selfie-phase4.md` by default; the seed pins the bootstrap.
 *
 * Workflow 11D's face-list rates (`docs/calibration/lists-phase11.md` item (i)), from the same
 * measurements: FPIR and FNIR at galleries of 1,000 and 10,000, at 0.5 and at the rule's pick:
 *
 *     pnpm --filter @openverify/checks calibration:report --face-list --seed <n> [--replicates <n>]
 *         [--input <selfie-measurements.json>] [--output <face-list.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { faceListReport, parseFaceListArgs } from '../src/calibration/face-list.js';
import { selfieCalibrationSchema } from '../src/calibration/selfie-report.js';
import {
  DEFAULT_MEASUREMENTS,
  DEFAULT_SELFIE_MEASUREMENTS,
  parseCalibrationArgs,
  runCalibrationReport,
  runSelfieCalibrationReport,
} from '../src/calibration/cli.js';

try {
  if (process.argv.includes('--face-list')) {
    const root = path.resolve(import.meta.dirname, '../../..');
    const args = parseFaceListArgs(process.argv.slice(2), root);
    const measurements = selfieCalibrationSchema.parse(
      JSON.parse(readFileSync(args.input, 'utf8')),
    );
    const report = faceListReport(measurements, { seed: args.seed, replicates: args.replicates });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      `wrote ${args.output}: ${String(report.identities)} identities; 0.5 ${report.stays ? 'stays' : 'does not meet the rule'}${report.picked === null ? '' : `; picked ${String(report.picked)}`}`,
    );
    process.exit(0);
  }
  const options = parseCalibrationArgs(process.argv.slice(2), {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    now: new Date(),
  });
  if (options.selfie === true) {
    const { pairs, identities } = runSelfieCalibrationReport(options);
    console.log(
      `wrote ${options.output}: ${String(pairs)} pairs, ${String(identities)} identities`,
    );
  } else {
    const { variants, aamva } = runCalibrationReport(options);
    console.log(
      `wrote ${options.output}: ${String(variants)} variants, ${String(aamva)} AAMVA images`,
    );
  }
} catch (error) {
  const selfie = process.argv.includes('--selfie');
  const tool = selfie ? 'calibrate_selfie.py' : 'calibrate_government_id.py';
  const written = selfie ? DEFAULT_SELFIE_MEASUREMENTS : DEFAULT_MEASUREMENTS;
  const missing =
    error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? `; measure first: cd services/vision && uv run python tools/${tool} (writes ${written})`
      : '';
  console.error(`error: ${error instanceof Error ? error.message : String(error)}${missing}`);
  process.exitCode = 1;
}
