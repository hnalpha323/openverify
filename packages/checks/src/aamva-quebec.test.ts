/**
 * Phase 12A C4: the AAMVA parser's tolerance of the known real-world deviations, on the synthetic
 * Quebec-format payloads of `contracts/fixtures/quebec-dl/aamva.json` (IIN 604428, a `ZQ` subfile
 * marking them as OpenVerify synthetic test data; invented values only).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AamvaParseError, parseAamva } from './aamva.js';

interface AamvaCase {
  id: string;
  payload: string;
  expected: Record<string, string>;
}

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../contracts/fixtures/quebec-dl/aamva.json',
);
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: AamvaCase[] }).cases;

function payloadOf(id: string): string {
  const found = CASES.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no AAMVA case ${id}`);
  }
  return found.payload;
}

/** The issues each case carries: none for the standard payload and the two plain variants. */
const ISSUES: Readonly<Record<string, readonly { code: string; details: unknown }[]>> = {
  'qc-v10': [],
  'qc-file-type-aamva': [{ code: 'aamva_header_nonstandard', details: { field: 'file_type' } }],
  'qc-printed-number': [],
  'qc-offset-shift': [{ code: 'aamva_designator_offset_mismatch', details: { subfile: 'DL' } }],
  'qc-v08': [],
};

describe('the committed Quebec AAMVA fixture (C4 acceptance)', () => {
  it('holds the five cases the plan names', () => {
    expect(CASES.map((entry) => entry.id)).toEqual(Object.keys(ISSUES));
  });

  it.each(CASES.map((entry) => [entry.id, entry] as const))(
    'reads the expected fields of %s, and reports its deviation as a non-throwing issue',
    (id, fixture) => {
      const parsed = parseAamva(fixture.payload);
      const read = Object.fromEntries(
        Object.keys(fixture.expected).map((field) => [
          field,
          parsed.fields[field as keyof typeof parsed.fields],
        ]),
      );
      expect(read).toEqual(fixture.expected);
      expect(parsed.issuer).toMatchObject({ code: 'QC', country: 'CA' });
      expect(parsed.syntheticMarker).toBe(true);
      expect(parsed.issues).toEqual(ISSUES[id]);
      expect(parsed.valid).toBe(ISSUES[id]?.length === 0);
    },
  );
});

describe('parseAamva tolerance (C4)', () => {
  it('still refuses a file type that is neither ANSI nor AAMVA', () => {
    expect(() => parseAamva(payloadOf('qc-v10').replace('ANSI ', 'ANSX '))).toThrow(
      expect.objectContaining({
        code: 'aamva_header_invalid',
        details: { field: 'file_type' },
      }) as Error,
    );
  });

  it('still refuses a designator far from its subfile, whose fallback position fails too', () => {
    const text = payloadOf('qc-v10');
    // The DL offset (bytes 23-26) moved 30 bytes on: the fallback is bounded.
    const moved = `${text.slice(0, 23)}0071${text.slice(27)}`;
    let thrown: unknown;
    try {
      parseAamva(moved);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AamvaParseError);
    expect(thrown).toMatchObject({
      code: 'aamva_subfile_designator_invalid',
      details: { subfile: 'DL' },
    });
  });

  it('normalizes a Quebec number to its compact form, and leaves another IIN as read', () => {
    expect(parseAamva(payloadOf('qc-printed-number')).fields['identification-number']).toBe(
      'T123456789012',
    );
    const ontario = payloadOf('qc-printed-number').replace('604428', '636012');
    expect(parseAamva(ontario).fields['identification-number']).toBe('T1234-567890-12');
  });
});
