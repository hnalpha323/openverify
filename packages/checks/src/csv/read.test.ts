/**
 * C118.5, C133.2 (F13): `readCsv`, the one configuration of `csv-parse`: the rules the importer
 * measured on 7.0.3 (C100.2 to C100.4), now shared by manual runs and holiday imports. Only two
 * parser errors hold one row; every other refuses the file, because `skip_records_with_error`
 * loses later rows silently. Every value is synthetic, and the marker of the last block proves
 * that no refusal carries the file's text.
 */
import { describe, expect, it } from 'vitest';
import { decodeCsv, readCsv, resolveCsvEncoding, type ReadCsvOptions } from './read.js';

const OPTIONS: ReadCsvOptions = { maxRows: 5, maxRecordCharacters: 200 };
const utf8 = (text: string) => new TextEncoder().encode(text);
const read = (text: string, options: Partial<ReadCsvOptions> = {}) =>
  readCsv(utf8(text), { ...OPTIONS, ...options });

describe('readCsv: a clean file', () => {
  it('reads each row by its file line, under the trimmed header', () => {
    expect(read(' id ,name\na,one\nb,two\n')).toEqual({
      refused: false,
      rows: [
        { row: 2, cells: { id: 'a', name: 'one' } },
        { row: 3, cells: { id: 'b', name: 'two' } },
      ],
      errors: [],
      rowCount: 2,
    });
  });

  it('drops a byte order mark, and reads a quoted comma and a doubled quote', () => {
    const { rows } = read('﻿id,name\n"a,b","say ""hi"""\n');
    expect(rows).toEqual([{ row: 2, cells: { id: 'a,b', name: 'say "hi"' } }]);
  });

  it('casts nothing: every cell stays text', () => {
    expect(read('id\n1\n').rows[0]?.cells).toEqual({ id: '1' });
  });

  it('counts a multi-line cell as one record against the cap, on its last line', () => {
    const lines = `id,note\n${'x,"one\ntwo"\n'.repeat(5)}`;
    const reading = read(lines);
    expect(reading.refused).toBe(false);
    expect(reading.rows.map(({ row }) => row)).toEqual([3, 5, 7, 9, 11]);
  });

  it('reads a header-only file as no rows, and an empty file as no header', () => {
    expect(read('id,name\n')).toMatchObject({ refused: false, rows: [], rowCount: 0 });
    expect(read('')).toMatchObject({ refused: false, rows: [], rowCount: 0 });
  });
});

describe('readCsv: a refused row', () => {
  it('holds one row for a wrong column count, and reads on', () => {
    expect(read('id,name\na,one\nb\nc,three\n')).toEqual({
      refused: false,
      rows: [
        { row: 2, cells: { id: 'a', name: 'one' } },
        { row: 4, cells: { id: 'c', name: 'three' } },
      ],
      errors: [{ row: 3, column: null, code: 'field_count_mismatch' }],
      rowCount: 3,
    });
  });

  it('holds one row for a bad opening quote, and reads on', () => {
    const reading = read('id,name\na,x"y\nb,two\n');
    expect(reading.refused).toBe(false);
    expect(reading.rows.map(({ row }) => row)).toEqual([3]);
    expect(reading.errors).toEqual([{ row: 2, column: null, code: 'invalid_value' }]);
  });

  it('keeps one error per row, though a record fails twice', () => {
    expect(read('id,name\nx"y\nb,two\n').errors).toHaveLength(1);
  });
});

describe('readCsv: a refused file', () => {
  it('refuses a closing quote the parser cannot step over, keeping no row', () => {
    const reading = read('id,name\na,one\nb,"two"x\nc,three\n');
    expect(reading).toMatchObject({ refused: true, rows: [] });
    expect(reading.errors).toHaveLength(1);
    expect(reading.errors[0]?.row).toBe(3);
  });

  it('refuses a record past the character cap, in either mode, so no part of a file applies', () => {
    const reading = read(`id,name\na,one\nb,${'x'.repeat(300)}\nc,three\n`);
    expect(reading).toMatchObject({ refused: true, rows: [] });
    expect(reading.errors.at(-1)?.code).toBe('record_too_large');
  });

  it('refuses a file whose header could not be read, whatever follows', () => {
    expect(read('id,"name\n')).toMatchObject({ refused: true, rowCount: 0 });
  });

  it('refuses a file past the row cap, counted on records', () => {
    expect(read(`id\n${'a\n'.repeat(6)}`)).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: null, code: 'row_limit_exceeded' }],
      rowCount: 6,
    });
  });

  it('stops at the cap of refused rows rather than parse a hostile file to its end (R003)', () => {
    const reading = read(`id,name\n${'x\n'.repeat(1_000)}`);
    expect(reading.refused).toBe(true);
    expect(reading.errors).toEqual([{ row: null, column: null, code: 'row_limit_exceeded' }]);
    expect(reading.rowCount).toBeLessThanOrEqual(OPTIONS.maxRows + 1);
  });

  it('lets the caller refuse the header, before the row cap, with no row counted', () => {
    const reading = read(`id\n${'a\n'.repeat(6)}`, {
      headerProblems: () => [{ row: null, column: 'id', code: 'unknown_column' }],
    });
    expect(reading).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: 'id', code: 'unknown_column' }],
      rowCount: 0,
    });
  });

  it('hands the caller the header it read, untrimmed', () => {
    const seen: (readonly string[])[] = [];
    read(' id ,name\n', {
      headerProblems: (header) => {
        seen.push(header);
        return [];
      },
    });
    expect(seen).toEqual([[' id ', 'name']]);
  });
});

describe('readCsv: decoding is strict', () => {
  it('decodes a named single-byte encoding', () => {
    const bytes = new Uint8Array([0x69, 0x64, 0x0a, 0xe9, 0x0a]);
    expect(readCsv(bytes, { ...OPTIONS, encoding: 'latin1' }).rows[0]?.cells).toEqual({ id: 'é' });
  });

  it.each([
    ['a byte that fits no character', new Uint8Array([0x69, 0x64, 0x0a, 0xff, 0x0a]), 'utf-8'],
    ['UTF-16 with its byte order mark', new Uint8Array([0xff, 0xfe, 0x69, 0x00]), 'windows-1252'],
    ['a label of UTF-16', utf8('id\n'), 'csunicode'],
    ['an unknown label', utf8('id\n'), 'not-an-encoding'],
  ])('refuses %s as invalid_encoding', (_name, bytes, encoding) => {
    expect(readCsv(bytes, { ...OPTIONS, encoding })).toEqual({
      refused: true,
      rows: [],
      errors: [{ row: null, column: null, code: 'invalid_encoding' }],
      rowCount: 0,
    });
  });

  it('resolves a label to its WHATWG name, and refuses a multi-byte one', () => {
    expect(resolveCsvEncoding('latin1')).toBe('windows-1252');
    expect(resolveCsvEncoding('UTF8')).toBe('utf-8');
    expect(resolveCsvEncoding('shift_jis')).toBeNull();
    expect(decodeCsv(utf8('id'), 'utf-8')).toBe('id');
  });
});

describe('readCsv: a refusal carries no value', () => {
  it.each([
    ['a wrong column count', 'id,name\nSYNTHETIC-MARKER\n'],
    ['a bad quote', 'id,name\na,"SYNTHETIC-MARKER"x\n'],
    ['a record too large', `id,name\na,SYNTHETIC-MARKER${'x'.repeat(300)}\n`],
  ])('%s', (_name, text) => {
    const { errors } = read(text);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).not.toContain('SYNTHETIC-MARKER');
  });
});
