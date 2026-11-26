import { describe, expect, it } from 'vitest';
import { csvText } from './analytics-csv';

describe('the analytics download writer (C164; K9-18)', () => {
  it('quotes every cell, doubles a quote, and ends every record with CRLF', () => {
    expect(
      csvText([
        ['Metric', 'Value'],
        ['Created', 'fewer than 11'],
        ['Say "hi"', ''],
      ]),
    ).toBe('"Metric","Value"\r\n"Created","fewer than 11"\r\n"Say ""hi""",""\r\n');
  });

  it.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['\rx', "'\rx"],
    ['\nx', "'\nx"],
    ['＝1', "'＝1"],
    ['＋1', "'＋1"],
    ['－1', "'－1"],
    ['＠x', "'＠x"],
    ["'=x", "''=x"],
  ])(
    'writes %j so a spreadsheet never runs it as a formula, as the translations CSV does',
    (cell, written) => {
      expect(csvText([[cell]])).toBe(`"${written}"\r\n`);
    },
  );

  it('leaves a cell that is no formula as it is', () => {
    expect(csvText([['fewer than 11', '20.8%', "it's"]])).toBe(
      '"fewer than 11","20.8%","it\'s"\r\n',
    );
  });
});
