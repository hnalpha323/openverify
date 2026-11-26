/** The committed report tables are read from `packages/checks/data/reports/` by plain name only. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_DATA_DIRECTORY, readReportData } from './data.js';

describe('readReportData', () => {
  it('reads from data/reports beside the sources', () => {
    expect(REPORT_DATA_DIRECTORY.endsWith(join('checks', 'data', 'reports'))).toBe(true);
    expect(existsSync(join(REPORT_DATA_DIRECTORY, 'free-mail-domains.json'))).toBe(true);
  });

  it('parses a committed table', () => {
    expect(readReportData('free-mail-domains.json')).toEqual(
      expect.objectContaining({ providers: expect.any(Array) as unknown }),
    );
  });

  it.each(['../manifest.json', 'nested/table.json', 'table.txt', '.hidden.json', ''])(
    'refuses %j, which is not a plain table name',
    (name) => {
      expect(() => readReportData(name)).toThrow(/plain file name/);
    },
  );

  it('names the table it cannot read', () => {
    expect(() => readReportData('missing-table.json')).toThrow(/cannot read report table/);
  });
});
