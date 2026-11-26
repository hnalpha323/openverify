import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEASUREMENTS,
  DEFAULT_REPORT,
  DEFAULT_SELFIE_MEASUREMENTS,
  DEFAULT_SELFIE_REPORT,
  parseCalibrationArgs,
  runSelfieCalibrationReport,
} from './cli.js';

const NOW = new Date('2026-10-21T12:00:00Z');

const SELFIE_MEASUREMENTS = {
  schema_version: 1,
  generated_at: '2026-10-21T12:00:00Z',
  domain: 'studio portrait pairs',
  models: { detector: 'yunet-2026may', recognizer: 'sface-2021dec' },
  set: { manifest_sha256: '0'.repeat(64), identities: 2, images: 4, excluded: [] },
  pairs: [
    { a: 'p0001-1', b: 'p0001-2', genuine: true, cosine: 0.71 },
    { a: 'p0002-1', b: 'p0002-2', genuine: true, cosine: 0.64 },
    { a: 'p0001-1', b: 'p0002-1', genuine: false, cosine: 0.08 },
  ],
  skew: { sex: {}, ita_degrees: [], per_group_frr_measured: false },
  provisional: {},
};
const SUMMARY_START = '<!-- openverify:calibration-summary:start -->';
/** A committed summary section as docs-catalog added them (Workflow 11E, 3aefe390f). */
const SUMMARY_SECTION = [
  '',
  '## Summary block',
  '',
  "Added in Workflow 11E by `docs-catalog`: this report's own figures.",
  '',
  SUMMARY_START,
  '```json',
  '{ "schema": "openverify/calibration-summary@1", "rows": [] }',
  '```',
  '<!-- openverify:calibration-summary:end -->',
  '',
].join('\n');

describe('parseCalibrationArgs', () => {
  it('reads the calibration tool output and writes the report the plan names by default', () => {
    expect(path.isAbsolute(DEFAULT_MEASUREMENTS)).toBe(true);
    expect(DEFAULT_MEASUREMENTS).toMatch(
      /fixtures[/\\]generated[/\\]calibration[/\\]government-id-measurements\.json$/,
    );
    expect(path.isAbsolute(DEFAULT_REPORT)).toBe(true);
    expect(DEFAULT_REPORT).toMatch(/docs[/\\]calibration[/\\]government-id-phase3\.md$/);
    expect(parseCalibrationArgs([], { cwd: '/work', now: NOW })).toEqual({
      input: DEFAULT_MEASUREMENTS,
      output: DEFAULT_REPORT,
      now: NOW,
    });
  });

  it('resolves relative paths against the directory it was started from, and takes --now', () => {
    expect(
      parseCalibrationArgs(
        ['--input', 'measurements.json', '--output=out/report.md', '--now', '2026-01-02T03:04:05Z'],
        { cwd: '/work', now: NOW },
      ),
    ).toEqual({
      input: path.resolve('/work', 'measurements.json'),
      output: path.resolve('/work', 'out/report.md'),
      now: new Date('2026-01-02T03:04:05Z'),
    });
  });

  it('refuses an instant that is not ISO-8601, and unknown options', () => {
    expect(() => parseCalibrationArgs(['--now', 'yesterday'], { cwd: '/work', now: NOW })).toThrow(
      /--now/,
    );
    expect(() => parseCalibrationArgs(['--bogus'], { cwd: '/work', now: NOW })).toThrow();
  });
});

describe('the selfie mode (C49)', () => {
  it('reads the selfie calibration output and writes the report the plan names by default', () => {
    expect(DEFAULT_SELFIE_MEASUREMENTS).toMatch(
      /fixtures[/\\]generated[/\\]calibration[/\\]selfie-measurements\.json$/,
    );
    expect(DEFAULT_SELFIE_REPORT).toMatch(/docs[/\\]calibration[/\\]selfie-phase4\.md$/);
    expect(parseCalibrationArgs(['--selfie'], { cwd: '/work', now: NOW })).toEqual({
      input: DEFAULT_SELFIE_MEASUREMENTS,
      output: DEFAULT_SELFIE_REPORT,
      now: NOW,
      selfie: true,
    });
  });

  it('takes the bootstrap seed and replicates as whole numbers', () => {
    expect(
      parseCalibrationArgs(['--selfie', '--seed', '7', '--replicates=200'], {
        cwd: '/w',
        now: NOW,
      }),
    ).toMatchObject({ selfie: true, seed: 7, replicates: 200 });
    expect(() =>
      parseCalibrationArgs(['--selfie', '--seed', 'x'], { cwd: '/w', now: NOW }),
    ).toThrow(/--seed/);
    expect(() =>
      parseCalibrationArgs(['--selfie', '--replicates', '0'], { cwd: '/w', now: NOW }),
    ).toThrow(/--replicates/);
  });

  it('writes the report and counts its pairs and identities', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'openverify-selfie-report-'));
    const input = path.join(folder, 'measurements.json');
    writeFileSync(
      input,
      JSON.stringify({
        schema_version: 1,
        generated_at: '2026-10-21T12:00:00Z',
        domain: 'studio portrait pairs',
        models: { detector: 'yunet-2026may', recognizer: 'sface-2021dec' },
        set: { manifest_sha256: '0'.repeat(64), identities: 2, images: 4, excluded: [] },
        pairs: [
          { a: 'p0001-1', b: 'p0001-2', genuine: true, cosine: 0.71 },
          { a: 'p0002-1', b: 'p0002-2', genuine: true, cosine: 0.64 },
          { a: 'p0001-1', b: 'p0002-1', genuine: false, cosine: 0.08 },
        ],
        skew: { sex: {}, ita_degrees: [], per_group_frr_measured: false },
        provisional: {},
      }),
    );
    const output = path.join(folder, 'out', 'selfie.md');
    expect(
      runSelfieCalibrationReport({
        input,
        output,
        now: NOW,
        selfie: true,
        seed: 1,
        replicates: 50,
      }),
    ).toEqual({ pairs: 3, identities: 2 });
    expect(readFileSync(output, 'utf8')).toContain('studio portrait pairs');
  });

  // KP11-75 (Workflow 11F): a re-run keeps the committed summary block (C279.1) the check catalog
  // reads, byte for byte, after the rendered report; a report that has none gets none.
  it('keeps the committed summary block of the report it rewrites', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'openverify-selfie-summary-'));
    const input = path.join(folder, 'measurements.json');
    writeFileSync(input, JSON.stringify(SELFIE_MEASUREMENTS));
    const output = path.join(folder, 'selfie.md');
    const options = { input, output, now: NOW, selfie: true, seed: 1, replicates: 50 } as const;
    runSelfieCalibrationReport(options);
    const fresh = readFileSync(output, 'utf8');
    expect(fresh).not.toContain(SUMMARY_START);
    writeFileSync(output, `${fresh}${SUMMARY_SECTION}`);

    runSelfieCalibrationReport(options);

    expect(readFileSync(output, 'utf8')).toBe(`${fresh}${SUMMARY_SECTION}`);
  });
});

describe('the calibration:report script (Workflow 11D review, load-harness followup)', () => {
  it('runs with type stripping that accepts core parameter properties', () => {
    // `--selfie` loads @openverify/core's sources, whose classes use parameter properties: plain
    // type stripping refuses them (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX), as the API's commands know.
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['calibration:report']).toMatch(/^node --experimental-transform-types /);
  });
});
