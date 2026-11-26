/**
 * C100.2 to C100.4, C100.7: strict decoding, the csv-parse options, the caps, and the codes that
 * stand in for what the parser would echo. Every value is synthetic, and the secret marker of the
 * last block proves that no refusal carries the file's text.
 */
import { IMPORT_LIMITS, IMPORT_ERROR_CODES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { decodeImportFile, resolveImportEncoding } from './encoding.js';
import { readImportFile } from './read-file.js';

const utf8 = (text: string) => new TextEncoder().encode(text);
const read = (text: string, kind: Parameters<typeof readImportFile>[2] = 'string') =>
  readImportFile(utf8(text), 'utf-8', kind);

describe('resolveImportEncoding (decision 31)', () => {
  it.each([
    ['utf-8', 'utf-8'],
    ['UTF8', 'utf-8'],
    ['windows-1252', 'windows-1252'],
    ['latin1', 'windows-1252'],
    ['iso-8859-2', 'iso-8859-2'],
    ['koi8-r', 'koi8-r'],
    ['ibm866', 'ibm866'],
  ])('reads %s as %s', (label, name) => {
    expect(resolveImportEncoding(label)).toBe(name);
  });

  it.each([
    // The contract's pattern lets these two past: both are labels of UTF-16.
    ['csunicode'],
    ['iso-10646-ucs-2'],
    ['utf-16le'],
    // Multi-byte legacy encodings are not single-byte labels.
    ['shift_jis'],
    ['gbk'],
    ['euc-kr'],
    ['big5'],
    // No such label, or one the platform refuses.
    ['nonsense'],
    ['iso-2022-kr'],
    ['x-user-defined'],
  ])('refuses %s', (label) => {
    expect(resolveImportEncoding(label)).toBeNull();
  });
});

describe('decodeImportFile (C100.2, C100.7)', () => {
  it('refuses an invalid UTF-8 byte rather than replacing it', () => {
    expect(decodeImportFile(Uint8Array.from([0x61, 0xff, 0x62]), 'utf-8')).toBeNull();
  });

  it('strips one UTF-8 BOM', () => {
    expect(decodeImportFile(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), 'utf-8')).toBe('a');
  });

  it('reads a windows-1252 file by parameter, and the same bytes are refused as UTF-8', () => {
    const bytes = Uint8Array.from([0x80, 0xe9]);

    expect(decodeImportFile(bytes, 'windows-1252')).toBe('€é');
    expect(decodeImportFile(bytes, 'utf-8')).toBeNull();
  });

  it.each([
    ['little-endian', [0xff, 0xfe, 0x61, 0x00]],
    ['big-endian', [0xfe, 0xff, 0x00, 0x61]],
  ])('refuses a UTF-16 BOM (%s) whatever the encoding says', (_name, bytes) => {
    expect(decodeImportFile(Uint8Array.from(bytes), 'utf-8')).toBeNull();
    // As windows-1252 these bytes would decode to two letters and a silently wrong file.
    expect(decodeImportFile(Uint8Array.from(bytes), 'windows-1252')).toBeNull();
  });

  it('refuses a byte a single-byte encoding leaves undefined', () => {
    expect(decodeImportFile(Uint8Array.from([0xd2]), 'windows-1253')).toBeNull();
  });

  it('refuses an encoding it no longer accepts', () => {
    expect(decodeImportFile(utf8('a'), 'utf-16le')).toBeNull();
  });
});

describe('readImportFile: a clean file', () => {
  it('reads rows by the file line, under trimmed header names, as strings', () => {
    expect(read(' value \n0012\n1.50\n')).toEqual({
      refused: false,
      rows: [
        { row: 2, cells: { value: '0012' } },
        { row: 3, cells: { value: '1.50' } },
      ],
      errors: [],
      rowCount: 2,
    });
  });

  it('takes columns in any order, and CRLF', () => {
    expect(read('name_last,name_first\r\nExample,Jane\r\n', 'name')).toMatchObject({
      refused: false,
      rows: [{ row: 2, cells: { name_first: 'Jane', name_last: 'Example' } }],
    });
  });

  it('accepts a header with no rows', () => {
    expect(read('value\n')).toEqual({ refused: false, rows: [], errors: [], rowCount: 0 });
  });

  it('names a multi-line cell by the line it ends on, and counts the next row after it', () => {
    expect(read('value\n"line one\nline two"\nnext\n')).toMatchObject({
      refused: false,
      rows: [
        { row: 3, cells: { value: 'line one\nline two' } },
        { row: 4, cells: { value: 'next' } },
      ],
      rowCount: 2,
    });
  });
});

describe('readImportFile: refused headers (C100.3)', () => {
  it('refuses an empty file', () => {
    expect(read('')).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: 'value', code: 'missing_column' }],
      rowCount: 0,
    });
  });

  it('refuses a missing column, naming it', () => {
    expect(read('name_first\nJane\n', 'name')).toMatchObject({
      refused: true,
      rows: [],
      errors: [{ row: null, column: 'name_last', code: 'missing_column' }],
    });
  });

  it('refuses a repeated column', () => {
    expect(read('value,value\n1,2\n')).toMatchObject({
      refused: true,
      errors: [{ row: null, column: 'value', code: 'duplicate_column' }],
    });
  });

  it('refuses unknown columns once, never naming them', () => {
    expect(read('value,extra,more\n1,2,3\n')).toMatchObject({
      refused: true,
      errors: [{ row: null, column: null, code: 'unknown_column' }],
    });
  });

  it('refuses a file with no header, whose first row holds a person', () => {
    const { errors, refused } = read('jane@example.com\njohn@example.com\n', 'email-address');

    expect(refused).toBe(true);
    expect(errors).toEqual([
      { row: null, column: null, code: 'unknown_column' },
      { row: null, column: 'value', code: 'missing_column' },
      { row: null, column: 'match_type', code: 'missing_column' },
    ]);
  });

  it('refuses a header the parser could not read', () => {
    expect(read('"value"x\n1\n')).toMatchObject({ refused: true, rows: [] });
  });
});

describe('readImportFile: rows the parser refuses', () => {
  it('keeps reading past a row of the wrong length', () => {
    expect(read('value,match_type\na,email_address\nb\nc,domain\n', 'email-address')).toEqual({
      refused: false,
      rows: [
        { row: 2, cells: { value: 'a', match_type: 'email_address' } },
        { row: 4, cells: { value: 'c', match_type: 'domain' } },
      ],
      errors: [{ row: 3, column: null, code: 'field_count_mismatch' }],
      rowCount: 3,
    });
  });

  it('keeps reading past a quote inside a field', () => {
    expect(read('value\nx"y\nnext\n')).toEqual({
      refused: false,
      rows: [{ row: 3, cells: { value: 'next' } }],
      errors: [{ row: 2, column: null, code: 'invalid_value' }],
      rowCount: 2,
    });
  });

  it('names a row with two problems once', () => {
    expect(read('value,match_type\nx"y\nnext,domain\n', 'email-address')).toMatchObject({
      refused: false,
      errors: [{ row: 2, column: null, code: 'field_count_mismatch' }],
      rowCount: 2,
    });
  });
});

/**
 * With `skip_records_with_error` csv-parse returns from its loop on a record too large, and stays
 * inside a quote after a bad closing quote, so every later row is lost with no error. A skip-invalid
 * import must not apply a part of a file and call it read.
 */
describe('readImportFile: a file the parser cannot read to its end', () => {
  it('refuses the whole file at a record too large, and keeps no row', () => {
    // The parser checks before it appends, so a record gets through at one byte over.
    const big = 'x'.repeat(IMPORT_LIMITS.recordCharacters + 2);

    expect(read(`value\nfirst\n${big}\nlater\n`)).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: 3, column: null, code: 'record_too_large' }],
      rowCount: 2,
    });
  });

  it('accepts a record at the limit', () => {
    const big = 'x'.repeat(IMPORT_LIMITS.recordCharacters);

    expect(read(`value\n${big}\n`)).toMatchObject({ refused: false, errors: [], rowCount: 1 });
  });

  it('refuses the whole file at a bad closing quote', () => {
    expect(read('value\nfirst\n"x"y\nlater\nmore\n')).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: 3, column: null, code: 'invalid_value' }],
      rowCount: 2,
    });
  });

  it('refuses the whole file at a quote never closed', () => {
    const { refused, rows, errors } = read('value\nfirst\n"open\nlater\n');

    expect(refused).toBe(true);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ column: null, code: 'invalid_value' });
  });
});

describe('readImportFile: the row cap (C100.2)', () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `v${String(index)}`);

  it('accepts exactly the cap', () => {
    const reading = read(`value\n${lines(IMPORT_LIMITS.rows).join('\n')}\n`);

    expect(reading).toMatchObject({ refused: false, rowCount: IMPORT_LIMITS.rows });
    expect(reading.rows).toHaveLength(IMPORT_LIMITS.rows);
  });

  it('refuses one row over it', () => {
    expect(read(`value\n${lines(IMPORT_LIMITS.rows + 1).join('\n')}\n`)).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: null, code: 'row_limit_exceeded' }],
      rowCount: IMPORT_LIMITS.rows + 1,
    });
  });

  it('counts refused rows against the cap', () => {
    const header = 'value,match_type';
    const good = Array.from({ length: IMPORT_LIMITS.rows }, (_, index) => `v${String(index)},domain`);

    expect(read([header, ...good, 'short'].join('\n'), 'email-address')).toMatchObject({
      refused: true,
      errors: [{ row: null, code: 'row_limit_exceeded' }],
    });
  });

  describe('a file of refused rows (R003)', () => {
    const cpuMilliseconds = (run: () => void) => {
      const before = process.cpuUsage();
      run();
      const { user, system } = process.cpuUsage(before);
      return (user + system) / 1000;
    };

    it('stops at the cap, not at the end of the file: its cost is bounded by the cap', () => {
      const text = `value,match_type\n${'a\n'.repeat(1_000_000)}`;
      let reading: ReturnType<typeof read> | undefined;

      // Reading all of it costs about 30 s; stopping at the cap about 3 s.
      expect(
        cpuMilliseconds(() => {
          reading = read(text, 'email-address');
        }),
      ).toBeLessThan(15_000);

      expect(reading).toEqual({
        refused: true,
        rows: [],
        errors: [{ row: null, column: null, code: 'row_limit_exceeded' }],
        rowCount: IMPORT_LIMITS.rows + 1,
      });
    });

    it('still names a bad header first', () => {
      const text = `value,unknown\n${'a\n'.repeat(IMPORT_LIMITS.rows + 10)}`;

      expect(read(text, 'email-address').errors).not.toContainEqual(
        expect.objectContaining({ code: 'row_limit_exceeded' }),
      );
    });

    it('keeps the cap on rows: a row with two problems counts once', () => {
      const header = 'value,match_type';
      const rows = Array.from({ length: 60_000 }, () => 'x"y');

      const reading = read([header, ...rows].join('\n'), 'email-address');

      expect(reading.errors).not.toContainEqual(
        expect.objectContaining({ code: 'row_limit_exceeded' }),
      );
      expect(reading.rowCount).toBe(60_000);
    });
  });

  it('caps rows, not lines: multi-line cells are never cut off silently', () => {
    const cells = Array.from({ length: 60_000 }, (_, index) => `"a${String(index)}\nb"`);
    const reading = read(`value\n${cells.join('\n')}\n`);

    expect(reading).toMatchObject({ refused: false, rowCount: 60_000 });
    expect(reading.rows.at(-1)?.row).toBe(120_001);
  });
});

describe('no value in any error (C100.4)', () => {
  const SECRET = 'sentinel-person@example.com';

  it.each([
    ['a wrong header', `${SECRET}\nother\n`],
    ['a short row', `value,match_type\n${SECRET}\n`],
    ['a quote in a field', `value,match_type\n${SECRET}"x,domain\n`],
    ['a bad closing quote', `value,match_type\n"${SECRET}"x,domain\n`],
    ['a quote never closed', `value,match_type\n"${SECRET}\n`],
    ['a record too large', `value,match_type\n${SECRET}${'x'.repeat(5000)},domain\n`],
  ])('%s', (_name, text) => {
    const { errors } = readImportFile(utf8(text), 'utf-8', 'email-address');

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).not.toContain('sentinel-person');
    for (const error of errors) {
      expect(Object.keys(error).sort()).toEqual(['code', 'column', 'row']);
      expect(IMPORT_ERROR_CODES).toContain(error.code);
    }
  });
});

describe('readImportFile: encodings', () => {
  it('answers invalid_encoding for the whole file', () => {
    expect(readImportFile(Uint8Array.from([0x76, 0xff]), 'utf-8', 'string')).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: null, code: 'invalid_encoding' }],
      rowCount: 0,
    });
  });

  it('reads a windows-1252 row', () => {
    const bytes = Uint8Array.from([...utf8('value\n'), 0xe9, 0x0a]);

    expect(readImportFile(bytes, 'windows-1252', 'string')).toMatchObject({
      refused: false,
      rows: [{ row: 2, cells: { value: 'é' } }],
    });
  });

  it('reads a UTF-8 BOM before the header', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('value\nx\n')]);

    expect(readImportFile(bytes, 'utf-8', 'string')).toMatchObject({
      refused: false,
      rows: [{ row: 2, cells: { value: 'x' } }],
    });
  });
});
