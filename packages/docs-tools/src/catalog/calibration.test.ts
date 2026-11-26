/** C279.1 (H27): every calibration report carries one valid summary block, and each figure the catalog prints appears in the report's own text. */
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import {
  CALIBRATION_SOURCES,
  SUMMARY_END,
  SUMMARY_SCHEMA_PATH,
  SUMMARY_START,
  calibrationFindings,
  figureForm,
  readCalibrationReports,
} from './calibration.js';

const repo = createRepository(REPOSITORY_ROOT);
const schema = repo.readText(SUMMARY_SCHEMA_PATH);

const row = (id: string, median: number | null, unit: string | null) => ({
  id,
  title: `Row ${id}`,
  contract: 'C1',
  owner: 'workflow-1a',
  budget: null,
  verdict: 'reported',
  median,
  unit,
  gap: null,
  configuration: 'default',
  takes: [],
});

function report(name: string, prose: string, rows: readonly object[]): string {
  const summary = {
    schema: 'openverify/calibration-summary@1',
    report: `docs/calibration/${name}.md`,
    workflow: '1A',
    status: 'published',
    'method-commit': null,
    base: null,
    head: null,
    machine: null,
    rows,
  };
  return `${prose}\n\n${SUMMARY_START}\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n${SUMMARY_END}\n`;
}

describe('figureForm', () => {
  it('prints the form the report itself writes', () => {
    expect(figureForm(390.048, 'ms', 'p95 390.0 ms against 150')).toBe('390.0');
    expect(figureForm(14592, 'per-hour', 'met at 14,592 an hour')).toBe('14,592');
    expect(figureForm(0.000757, 'ratio', 'FAR 7.57e-4 (5.62e-4 to 9.87e-4)')).toBe('7.57e-4');
    expect(figureForm(0.214, 'ratio', 'the upper end 21.4% fails')).toBe('21.4%');
    expect(figureForm(0.006406, 'ms', 'a lookup in 0.0064 ms')).toBe('0.0064');
    expect(figureForm(102, null, '| `x` | 102.0 | yes |')).toBe('102.0');
    expect(figureForm(616, null, 'default 616 (genuine 924-1500)')).toBe('616');
  });

  it('answers null when no form appears as a whole number in the text', () => {
    expect(figureForm(390.048, 'ms', 'p95 1390.05 ms')).toBeNull();
    expect(figureForm(12, null, 'version 120')).toBeNull();
  });
});

describe('the calibration reports (the real tree)', () => {
  const reports = readCalibrationReports(repo);

  it('reads every report under docs/calibration with one block valid against the schema', () => {
    expect(reports.map((item) => item.path)).toEqual(
      repo.listFiles('docs/calibration').filter((file) => file.endsWith('.md')),
    );
    expect(reports.length).toBeGreaterThanOrEqual(10);
    for (const item of reports) {
      expect(item.errors, item.path).toEqual([]);
      expect(item.summary?.report, item.path).toBe(item.path);
      expect(item.prose).not.toContain(SUMMARY_START);
    }
  });

  it('cites only reports and rows that exist', () => {
    const rows = new Map(
      reports.map((item) => [item.path, new Set(item.summary?.rows.map((entry) => entry.id))]),
    );
    const references = [
      ...Object.values(CALIBRATION_SOURCES.checks),
      ...Object.values(CALIBRATION_SOURCES.reports),
      ...Object.values(CALIBRATION_SOURCES.signals),
    ].flat();
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(rows.has(reference.report), reference.report).toBe(true);
      for (const id of reference.rows) {
        expect(rows.get(reference.report)?.has(id), `${reference.report} ${id}`).toBe(true);
      }
    }
  });

  it('finds nothing wrong: blocks valid, references resolve, every headline figure in its report text', () => {
    expect(calibrationFindings(repo)).toEqual([]);
  });
});

describe('calibrationFindings over fixtures', () => {
  it('reports a report without a block, an invalid block and a figure its text does not hold', () => {
    const fixture = createMemoryRepository({
      [SUMMARY_SCHEMA_PATH]: schema,
      'docs/calibration/a-phase1.md': '# A\n\nNo block here.\n',
      'docs/calibration/b-phase1.md': report('b-phase1', '# B\n\nThe p95 was 12.5 ms.', [
        row('fine', 12.5, 'ms'),
        row('absent', 99.9, 'ms'),
      ]),
      'docs/calibration/c-phase1.md': report('c-phase1', '# C', [{ id: 'bad' }]),
    });
    const findings = calibrationFindings(fixture);
    const messages = findings.map((finding) => `${finding.path}: ${finding.message}`);
    expect(
      messages.some((text) => text.startsWith('docs/calibration/a-phase1.md: no summary block')),
    ).toBe(true);
    expect(messages.some((text) => text.includes('b-phase1.md: row absent'))).toBe(true);
    expect(messages.some((text) => text.includes('b-phase1.md: row fine'))).toBe(false);
    expect(messages.some((text) => text.startsWith('docs/calibration/c-phase1.md: invalid'))).toBe(
      true,
    );
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('reports two blocks in one report', () => {
    const one = report('d-phase1', '# D', [row('x', null, null)]);
    const fixture = createMemoryRepository({
      [SUMMARY_SCHEMA_PATH]: schema,
      'docs/calibration/d-phase1.md': `${one}\n${one}`,
    });
    expect(calibrationFindings(fixture).map((finding) => finding.message)).toContain(
      'more than one summary block',
    );
  });
});
