import { describe, expect, it } from 'vitest';
import { csvOf, neutraliseCell } from './csv';

describe('the console CSV writer (C100.6)', () => {
  it('puts an apostrophe before a cell that starts with a formula character', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']) {
      expect(neutraliseCell(`${lead}1+1`), JSON.stringify(lead)).toBe(`'${lead}1+1`);
    }
  });

  it('also guards a run of apostrophes before a formula character, as the API writer does', () => {
    expect(neutraliseCell("'=x")).toBe("''=x");
    expect(neutraliseCell("'plain")).toBe("'plain");
  });

  it('leaves other text alone', () => {
    expect(neutraliseCell('invalid_value')).toBe('invalid_value');
    expect(neutraliseCell('')).toBe('');
  });

  it('quotes every field, doubles embedded quotes, neutralises text and writes numbers plainly', () => {
    expect(
      csvOf([
        ['row', 'column', 'code'],
        [4, 'value', 'invalid_value'],
        [null, null, '=HYPERLINK("x")'],
      ]),
    ).toBe(
      '"row","column","code"\r\n"4","value","invalid_value"\r\n"","","\'=HYPERLINK(""x"")"\r\n',
    );
  });
});
