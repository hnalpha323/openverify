/**
 * C100.5, C100.6: the shared CSV writer and the importer's reverse. The golden vectors are the
 * characters OWASP's CSV Injection page lists and the payloads it gives for a field separator or a
 * quote that opens a new cell; every other value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { neutraliseCell, stripNeutraliser, writeCsv } from './index.js';

/** The characters OWASP lists, and the full-width forms `escape_formulas` also misses. */
const FORMULA_CHARACTERS = ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠'];

/** OWASP: a separator or a quote can start a new cell inside one value. */
const OWASP_PAYLOADS = ['=1+2";=1+2', `=1+2'" ;,=1+2`, "=cmd|' /C calc'!A0", '@SUM(1+1)*cmd'];

/** RFC 4180, as a spreadsheet reads the writer's output: only what these tests need. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let index = 0;
  while (index < text.length) {
    expect(text[index]).toBe('"');
    index += 1;
    let cell = '';
    for (;;) {
      if (text[index] === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        break;
      } else {
        cell += text.charAt(index);
        index += 1;
      }
    }
    row.push(cell);
    if (text[index] === ',') {
      index += 1;
    } else {
      expect(text.slice(index, index + 2)).toBe('\r\n');
      index += 2;
      rows.push(row);
      row = [];
    }
  }
  return rows;
}

/** A deterministic generator, so a failing value is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('neutraliseCell (C100.6)', () => {
  it.each(FORMULA_CHARACTERS.map((character) => [character]))(
    'prefixes one apostrophe to a cell starting with %j',
    (character) => {
      expect(neutraliseCell(`${character}1+1`)).toBe(`'${character}1+1`);
    },
  );

  it.each(OWASP_PAYLOADS.map((payload) => [payload]))('neutralises %j', (payload) => {
    expect(neutraliseCell(payload)).toBe(`'${payload}`);
  });

  it('prefixes an E.164 number, which starts with a formula character', () => {
    expect(neutraliseCell('+12025550100')).toBe(`'+12025550100`);
  });

  it.each(['', 'plain', 'a=b', '1+1', `'quoted`, ' =spaced'])('leaves %j as it is', (value) => {
    expect(neutraliseCell(value)).toBe(value);
  });

  it('prefixes a value that already starts with apostrophes before a formula character', () => {
    // Without this, stripNeutraliser would change the value on the way back (C100.5).
    expect(neutraliseCell(`'=1+1`)).toBe(`''=1+1`);
  });
});

describe('stripNeutraliser (C100.5)', () => {
  it.each(FORMULA_CHARACTERS.map((character) => [character]))(
    'strips the apostrophe before %j',
    (character) => {
      expect(stripNeutraliser(`'${character}1+1`)).toBe(`${character}1+1`);
    },
  );

  it('strips once', () => {
    expect(stripNeutraliser(`''=1+1`)).toBe(`'=1+1`);
  });

  it.each(['', `'`, `'plain`, `''plain`, '=1+1', '+12025550100'])('leaves %j', (value) => {
    expect(stripNeutraliser(value)).toBe(value);
  });

  it('gives back every value the writer neutralised, unchanged', () => {
    const next = seededRandom(7);
    const alphabet = [...FORMULA_CHARACTERS, "'", '"', ',', ';', 'a', '1', ' ', 'é'];
    for (let round = 0; round < 2000; round += 1) {
      const length = Math.floor(next() * 6);
      const value = Array.from(
        { length },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join('');
      expect(stripNeutraliser(neutraliseCell(value))).toBe(value);
    }
  });
});

describe('writeCsv (C100.6)', () => {
  it('quotes every field, under RFC 4180 records', () => {
    expect(writeCsv(['id', 'status'], [['acc_1', 'active']])).toBe(
      '"id","status"\r\n"acc_1","active"\r\n',
    );
  });

  it('answers the header alone for no rows', () => {
    expect(writeCsv(['id'], [])).toBe('"id"\r\n');
  });

  it('quotes an empty and a null cell, so no field is bare', () => {
    expect(writeCsv(['a', 'b'], [['', null]])).toBe('"a","b"\r\n"",""\r\n');
  });

  it('writes numbers and booleans as text, leaving a negative number alone', () => {
    expect(writeCsv(['a', 'b', 'c'], [[2, -1.5, true]])).toBe(
      '"a","b","c"\r\n"2","-1.5","true"\r\n',
    );
    expect(writeCsv(['a'], [[false]])).toBe('"a"\r\n"false"\r\n');
  });

  it('doubles an embedded quote and keeps a separator or a line inside its cell', () => {
    expect(writeCsv(['a'], [['say "hi", ok\nbye']])).toBe('"a"\r\n"say ""hi"", ok\nbye"\r\n');
  });

  it('neutralises every string cell, a header too', () => {
    expect(writeCsv(['=a'], [['+12025550100']])).toBe(`"'=a"\r\n"'+12025550100"\r\n`);
  });

  it.each(OWASP_PAYLOADS.map((payload) => [payload]))(
    'keeps %j in one neutralised cell',
    (payload) => {
      const rows = readCsv(writeCsv(['a', 'b'], [[payload, 'next']]));
      expect(rows).toEqual([
        ['a', 'b'],
        [`'${payload}`, 'next'],
      ]);
    },
  );

  it('reads back as written, through the importer strip', () => {
    const next = seededRandom(11);
    const alphabet = [...FORMULA_CHARACTERS, "'", '"', ',', 'a', '1', ' '];
    const rows = Array.from({ length: 200 }, () => [
      Array.from({ length: 5 }, () => alphabet[Math.floor(next() * alphabet.length)]).join(''),
      'x',
    ]);
    const [, ...read] = readCsv(writeCsv(['a', 'b'], rows));
    expect(read.map(([cell = '', other]) => [stripNeutraliser(cell), other])).toEqual(rows);
  });

  it('refuses a row that does not fit the header, rather than shift a column', () => {
    expect(() => writeCsv(['a', 'b'], [['only one']])).toThrow(TypeError);
  });
});
