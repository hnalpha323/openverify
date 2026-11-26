/**
 * The cross-language seed vectors (C33): `contracts/fixtures/mrz/*.json` and
 * `contracts/fixtures/aamva/*.json`. These tests keep the vector files honest on their own terms
 * (every check digit, every AAMVA offset and length, the synthetic marker), run our ICAO 9303
 * parser over the TD1, TD2 and TD3 vectors, and use the `mrz` package (5.0.2, dev only) as an
 * independent oracle for the check digits. `checks-logic` owns and extends the vectors and the
 * parsers; the Python generator and Kotlin `Mrz.kt` test against the same files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as oracleParse } from 'mrz';
import { describe, expect, it } from 'vitest';
import { AamvaParseError, parseAamva } from './aamva.js';
import { MrzParseError, computeMrzCheckDigit, parseMrz } from './mrz.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../contracts/fixtures');

interface CheckDigitVector {
  input: string;
  printed: string;
  computed: number;
  valid: boolean;
}

interface MrzVector {
  id: string;
  format: 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB' | null;
  lines: string[];
  valid: boolean;
  error?: string;
  check_digits?: Record<string, CheckDigitVector | null>;
  fields?: Record<string, string | null>;
  /** OCR correction vectors (C31.3) only. */
  corrected_lines?: string[];
  corrections?: { line: number; position: number; field: string; from: string; to: string }[];
}

interface VectorFile<V> {
  schema_version: number;
  description: string;
  source: { citation: string; url: string };
  vectors: V[];
}

function files<V>(directory: string): [string, VectorFile<V>][] {
  const dir = path.join(FIXTURES, directory);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => [name, JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as VectorFile<V>]);
}

const mrzVectors = () => files<MrzVector>('mrz').flatMap(([, file]) => file.vectors);

describe('MRZ vectors (contracts/fixtures/mrz)', () => {
  it('hold the ICAO 9303 examples of TD1, TD2, TD3 and MRV-A, and at least two invalid MRZs', () => {
    const vectors = mrzVectors();
    for (const format of ['TD1', 'TD2', 'TD3', 'MRVA'] as const) {
      expect(
        vectors.some((vector) => vector.format === format && vector.valid),
        format,
      ).toBe(true);
    }
    expect(vectors.filter((vector) => !vector.valid).length).toBeGreaterThanOrEqual(2);
    for (const [name, file] of files<MrzVector>('mrz')) {
      expect(file.schema_version, name).toBe(1);
      expect(file.source.url, name).toMatch(/^https:\/\/www\.icao\.int\//);
    }
    expect(new Set(vectors.map((vector) => vector.id)).size).toBe(vectors.length);
  });

  it('state every check digit as ICAO 9303 Part 3 §4.9 computes it', () => {
    for (const vector of mrzVectors()) {
      for (const [name, digit] of Object.entries(vector.check_digits ?? {})) {
        if (digit === null) {
          continue;
        }
        const label = `${vector.id}.${name}`;
        expect(computeMrzCheckDigit(digit.input), label).toBe(digit.computed);
        expect(digit.valid, label).toBe(digit.printed === String(digit.computed));
      }
      if (vector.check_digits !== undefined) {
        const all = Object.values(vector.check_digits).filter((digit) => digit !== null);
        expect(vector.valid, vector.id).toBe(all.every((digit) => digit.valid));
      }
    }
  });

  it('parse with our parser to their expected fields and check-digit results (TD1-3, MRV-A, MRV-B)', () => {
    const vectors = mrzVectors().filter(
      (candidate) => candidate.error === undefined && candidate.corrections === undefined,
    );
    expect(vectors.some((vector) => vector.format === 'MRVB')).toBe(true);
    for (const vector of vectors) {
      const parsed = parseMrz(vector.lines);
      const fields = vector.fields ?? {};
      expect(parsed.format, vector.id).toBe(vector.format);
      expect(
        {
          document_code: parsed.documentCode,
          issuing_state: parsed.issuingState,
          surname: parsed.surname,
          given_names: parsed.givenNames,
          document_number: parsed.documentNumber,
          nationality: parsed.nationality,
          birth_date: parsed.birthDate,
          sex: parsed.sex,
          expiration_date: parsed.expirationDate,
        },
        vector.id,
      ).toEqual({
        document_code: fields.document_code,
        issuing_state: fields.issuing_state,
        surname: fields.surname,
        given_names: fields.given_names,
        document_number: fields.document_number,
        nationality: fields.nationality,
        birth_date: fields.birth_date,
        sex: fields.sex,
        expiration_date: fields.expiration_date,
      });
      const digits = vector.check_digits ?? {};
      expect(parsed.checkDigits.documentNumber.valid, vector.id).toBe(
        digits.document_number?.valid,
      );
      expect(parsed.checkDigits.birthDate.valid, vector.id).toBe(digits.birth_date?.valid);
      expect(parsed.checkDigits.expirationDate.valid, vector.id).toBe(
        digits.expiration_date?.valid,
      );
      expect(parsed.checkDigits.composite?.valid, vector.id).toBe(digits.composite?.valid);
      expect(parsed.checkDigitsValid, vector.id).toBe(vector.valid);
    }
  });

  it('agree with the mrz package on every TD check digit', () => {
    const oracleField: Record<string, string> = {
      document_number: 'documentNumberCheckDigit',
      birth_date: 'birthDateCheckDigit',
      expiration_date: 'expirationDateCheckDigit',
      optional_data: 'personalNumberCheckDigit',
      composite: 'compositeCheckDigit',
    };
    for (const vector of mrzVectors().filter(
      (candidate) =>
        candidate.error === undefined &&
        candidate.corrections === undefined &&
        candidate.format?.startsWith('TD'),
    )) {
      const oracle = oracleParse(vector.lines);
      for (const [name, digit] of Object.entries(vector.check_digits ?? {})) {
        if (digit === null) {
          continue;
        }
        const detail = oracle.details.find((entry) => entry.field === oracleField[name]);
        expect(detail?.valid, `${vector.id}.${name}`).toBe(digit.valid);
      }
    }
  });

  it('hold the C31.3 OCR correction vectors, and our parser applies exactly their corrections', () => {
    const vectors = mrzVectors().filter((vector) => vector.corrections !== undefined);
    expect(vectors.length).toBeGreaterThanOrEqual(8);
    expect(vectors.some((vector) => vector.corrections?.length === 0)).toBe(true);
    for (const vector of vectors) {
      const parsed = parseMrz(vector.lines, { correct: true });
      expect(parsed.format, vector.id).toBe(vector.format);
      expect(parsed.corrections, vector.id).toEqual(vector.corrections);
      expect(parsed.lines, vector.id).toEqual(vector.corrected_lines);
      expect(parsed.valid, vector.id).toBe(vector.valid);
      expect(parseMrz(vector.lines).corrections, vector.id).toEqual([]);
    }
  });

  it('name the structural error our parser raises for the unreadable ones', () => {
    for (const vector of mrzVectors().filter((candidate) => candidate.error !== undefined)) {
      let thrown: unknown;
      try {
        parseMrz(vector.lines);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, vector.id).toBeInstanceOf(MrzParseError);
      expect((thrown as MrzParseError).code, vector.id).toBe(vector.error);
    }
  });
});

interface AamvaVector {
  id: string;
  payload: string;
  valid: boolean;
  error?: string;
  header?: {
    iin: string;
    aamva_version: number;
    jurisdiction_version: number;
    number_of_entries: number;
  };
  subfiles?: { type: string; offset: number; length: number }[];
  elements?: Record<string, Record<string, string>>;
  synthetic_marker?: boolean;
  document_type?: 'DL' | 'ID';
  real_id_compliance?: string | null;
  fields?: Record<string, string | null>;
  details?: Record<string, unknown>;
}

const aamvaVectors = () => files<AamvaVector>('aamva').flatMap(([, file]) => file.vectors);
const MARKER = 'OPENVERIFY SYNTHETIC TEST DATA';
/** `@`, LF, RS (0x1e), CR, `ANSI `, the IIN, the AAMVA and jurisdiction versions, the entries. */
// eslint-disable-next-line no-control-regex -- Annex D separators are control characters
const HEADER = /^@\n\x1e\rANSI (\d{6})(\d{2})(\d{2})(\d{2})/;

describe('AAMVA vectors (contracts/fixtures/aamva)', () => {
  it('hold at least two valid and two invalid payloads, each marked synthetic', () => {
    const vectors = aamvaVectors();
    expect(vectors.filter((vector) => vector.valid).length).toBeGreaterThanOrEqual(2);
    expect(vectors.filter((vector) => !vector.valid).length).toBeGreaterThanOrEqual(2);
    for (const vector of vectors) {
      // C36: every synthetic payload carries the jurisdiction-specific marker subfile.
      expect(vector.payload, vector.id).toMatch(new RegExp(`Z([A-Z])Z\\1A${MARKER}\r`));
    }
    expect(new Set(vectors.map((vector) => vector.id)).size).toBe(vectors.length);
  });

  it('lay the valid ones out as Annex D says: header, designators, subfiles', () => {
    for (const vector of aamvaVectors().filter((candidate) => candidate.valid)) {
      const header = HEADER.exec(vector.payload);
      expect(header, vector.id).not.toBeNull();
      const [, iin, version, jurisdiction, entries] = header ?? [];
      expect(
        {
          compliance_indicator: '@',
          file_type: 'ANSI ',
          iin,
          aamva_version: Number(version),
          jurisdiction_version: Number(jurisdiction),
          number_of_entries: Number(entries),
        },
        vector.id,
      ).toEqual(vector.header);
      const subfiles = vector.subfiles ?? [];
      expect(subfiles).toHaveLength(Number(entries));
      subfiles.forEach((subfile, index) => {
        const designator = vector.payload.slice(21 + index * 10, 31 + index * 10);
        expect(designator, vector.id).toBe(
          `${subfile.type}${String(subfile.offset).padStart(4, '0')}${String(subfile.length).padStart(4, '0')}`,
        );
        const body = vector.payload.slice(subfile.offset, subfile.offset + subfile.length);
        expect(body.startsWith(subfile.type), `${vector.id}.${subfile.type}`).toBe(true);
        expect(body.endsWith('\r'), `${vector.id}.${subfile.type}`).toBe(true);
        const elements = Object.fromEntries(
          body
            .slice(2, -1)
            .split('\n')
            .map((element) => [element.slice(0, 3), element.slice(3)]),
        );
        expect(elements, `${vector.id}.${subfile.type}`).toEqual(vector.elements?.[subfile.type]);
      });
      const last = subfiles.at(-1);
      expect(last === undefined ? 0 : last.offset + last.length, vector.id).toBe(
        vector.payload.length,
      );
      expect(vector.synthetic_marker, vector.id).toBe(true);
      expect(vector.fields?.['issuing-authority-code'], vector.id).toBe(iin);
    }
  });

  it('name the error of each invalid one, with a defect the layout shows', () => {
    const invalid = aamvaVectors().filter((candidate) => !candidate.valid);
    expect(invalid.every((vector) => vector.error?.startsWith('aamva_'))).toBe(true);
    const byId = new Map(invalid.map((vector) => [vector.id, vector.payload]));
    expect(HEADER.test(byId.get('file-type-not-ansi') ?? '')).toBe(false);
    const offsetPayload = byId.get('subfile-offset-past-the-end') ?? '';
    expect(Number(offsetPayload.slice(23, 27))).toBeGreaterThan(offsetPayload.length);
    expect(byId.get('mandatory-element-missing')).not.toMatch(/\nDAQ/);
    expect(byId.get('birth-date-not-a-date')).toContain('\nDBB02301990\n');
  });

  it('parse with our parser to their expected header, elements and fields', () => {
    const valid = aamvaVectors().filter((candidate) => candidate.valid);
    expect(valid.length).toBeGreaterThanOrEqual(4);
    for (const vector of valid) {
      const parsed = parseAamva(vector.payload);
      expect(parsed.valid, vector.id).toBe(true);
      expect(parsed.header.iin, vector.id).toBe(vector.header?.iin);
      expect(parsed.header.aamvaVersion, vector.id).toBe(vector.header?.aamva_version);
      expect(parsed.header.jurisdictionVersion, vector.id).toBe(
        vector.header?.jurisdiction_version,
      );
      expect(
        parsed.subfiles.map(({ type, offset, length }) => ({ type, offset, length })),
        vector.id,
      ).toEqual(vector.subfiles);
      expect(
        Object.fromEntries(parsed.subfiles.map((subfile) => [subfile.type, subfile.elements])),
        vector.id,
      ).toEqual(vector.elements);
      expect(parsed.documentType, vector.id).toBe(vector.document_type);
      expect(parsed.realIdCompliance, vector.id).toBe(vector.real_id_compliance ?? null);
      expect(parsed.syntheticMarker, vector.id).toBe(true);
      const fields = Object.fromEntries(
        Object.keys(vector.fields ?? {}).map((field) => [
          field,
          (parsed.fields as Record<string, string | undefined>)[field] ?? null,
        ]),
      );
      expect(fields, vector.id).toEqual(vector.fields);
    }
  });

  it('report with our parser the error each invalid one names, and its details', () => {
    for (const vector of aamvaVectors().filter((candidate) => !candidate.valid)) {
      let code: string | undefined;
      let details: unknown;
      try {
        const parsed = parseAamva(vector.payload);
        expect(parsed.valid, vector.id).toBe(false);
        code = parsed.issues[0]?.code;
        details = parsed.issues[0]?.details;
      } catch (error) {
        expect(error, vector.id).toBeInstanceOf(AamvaParseError);
        code = (error as AamvaParseError).code;
        details = (error as AamvaParseError).details;
      }
      expect(code, vector.id).toBe(vector.error);
      expect(details, vector.id).toEqual(vector.details);
    }
  });
});
