/**
 * Phase 12A C1 and C2: `parseViz` on the shapes a phone capture of a Quebec-format licence gives
 * (format hints, labels glued to their values, year-month-day dates, OCR digit confusions, dates
 * inside longer lines, the unlabeled number and the two unlabeled name lines). Every value is
 * synthetic: the cases come from `contracts/fixtures/quebec-dl/ocr-lines.json`, written by
 * `services/vision/tools/synthetic_quebec.py` (a SPECIMEN card with invented values).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseViz, parseVizDate, type VizLine, type VizParseOptions } from './viz.js';

interface OcrCase {
  id: string;
  now: string;
  lines: VizLine[];
  expected: Record<string, { value: string; via: string }>;
  absent: string[];
}

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../contracts/fixtures/quebec-dl/ocr-lines.json',
);
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: OcrCase[] }).cases;
const NOW = new Date('2026-11-22T00:00:00.000Z');

function caseLines(id: string): VizLine[] {
  const found = CASES.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no OCR case ${id}`);
  }
  return found.lines.map((line) => ({ ...line, box: [...line.box] as const }));
}

const readings = (lines: readonly VizLine[], options: VizParseOptions = {}) =>
  Object.fromEntries(
    Object.entries(parseViz(lines, { now: NOW, ...options }).fields).map(([field, reading]) => [
      field,
      { value: reading.value, via: reading.via },
    ]),
  );

function line(text: string, x: number, y: number, width = 200, height = 24): VizLine {
  return { text, confidence: 0.95, box: [x, y, width, height] };
}

describe('the committed Quebec OCR fixture (C1, C2 acceptance)', () => {
  it('holds the five cases the plan names', () => {
    expect(CASES.map((entry) => entry.id)).toEqual([
      'printed',
      'phone-ocr',
      'labels-unread',
      'number-confusion',
      'not-quebec',
    ]);
  });

  it.each(CASES.map((entry) => [entry.id, entry] as const))(
    'reads exactly the expected fields of %s, with their value and how',
    (_id, fixture) => {
      const parsed = parseViz(fixture.lines, { now: new Date(fixture.now) });
      const read = Object.fromEntries(
        Object.entries(parsed.fields).map(([field, reading]) => [
          field,
          { value: reading.value, via: reading.via },
        ]),
      );
      expect(read).toEqual(fixture.expected);
      for (const field of fixture.absent) {
        expect(parsed.fields).not.toHaveProperty(field);
      }
    },
  );
});

describe('parseVizDate: format hints and OCR confusions (C1)', () => {
  it.each([
    ['(A-M-J):1990-02-14', 'DMY', '1990-02-14'],
    ['(AAAA-MM-JJ) 1990-02-14', 'MDY', '1990-02-14'],
    ['(Y-M-D) 1990-02-14', 'DMY', '1990-02-14'],
    ['(YYYY/MM/DD) 1990/02/14', 'DMY', '1990-02-14'],
    // A day-first hint wins over the order the caller passed, and a month-first one too.
    ['(JJ.MM.AAAA) 03.04.1990', 'MDY', '1990-04-03'],
    ['(DD/MM/YYYY) 03/04/1990', 'MDY', '1990-04-03'],
    ['(TT.MM.JJJJ) 03.04.1990', 'MDY', '1990-04-03'],
    ['(MM/DD/YYYY) 03/04/1990', 'DMY', '1990-03-04'],
  ] as const)('reads %j (%s) as %s', (text, order, expected) => {
    expect(parseVizDate(text, order)).toBe(expected);
  });

  it.each([
    ['1990-0Z-14', '1990-02-14'],
    ['199O-O2-I4', '1990-02-14'],
    ['l990-02-14', '1990-02-14'],
    ['1995-0S-14', '1995-05-14'],
    ['1988-02-1B', '1988-02-18'],
    ['2O21-03-15', '2021-03-15'],
  ] as const)('maps the confusions inside the date %j', (text, expected) => {
    expect(parseVizDate(text, 'DMY')).toBe(expected);
  });

  it('does not take a parenthesised word or a size for a hint', () => {
    expect(parseVizDate('(CM) 1990-02-14', 'DMY')).toBeNull();
    expect(parseVizDate('(A-B-C) 1990-02-14', 'DMY')).toBeNull();
  });
});

describe('parseViz: Quebec shapes (C1)', () => {
  it('drops a format hint from a label and applies its date order to the value below', () => {
    expect(
      readings(
        [line('DATE DE NAISSANCE (JJ/MM/AAAA)', 20, 100, 400), line('03/04/1990', 20, 130)],
        { dateOrder: 'MDY' },
      ),
    ).toEqual({ birthdate: { value: '1990-04-03', via: 'label' } });
  });

  it('splits a label glued to its value, at a colon or at a letter-to-digit boundary', () => {
    expect(
      readings([
        line('SEXE:M', 20, 100),
        line('DELIVRE LE2021-03-15', 20, 140, 300),
        line('DOB 03/04/1990', 20, 180, 300),
      ]),
    ).toEqual({
      sex: { value: 'M', via: 'label' },
      'issue-date': { value: '2021-03-15', via: 'label' },
      birthdate: { value: '1990-04-03', via: 'label' },
    });
  });

  it('finds one date inside a longer line by pattern, and none in a line with two', () => {
    expect(readings([line('EMIS LE 2O21-03-15 A MONTREAL', 20, 100, 400)])).toEqual({
      'issue-date': { value: '2021-03-15', via: 'pattern' },
    });
    expect(readings([line('VALIDE DU 2021-03-15 AU 2029-02-14', 20, 100, 400)])).toEqual({});
  });

  it('never maps the confusions inside a name', () => {
    expect(
      readings([
        line('NOM', 20, 100),
        line('SIMONS', 20, 130),
        line('PRENOM', 20, 180),
        line('ZOE', 20, 210),
      ]),
    ).toEqual({
      'name-last': { value: 'SIMONS', via: 'label' },
      'name-first': { value: 'ZOE', via: 'label' },
    });
    expect(readings([line('SURNAME', 20, 100), line('BOIS', 20, 130)])).toEqual({
      'name-last': { value: 'BOIS', via: 'label' },
    });
  });

  it('reads the Quebec number after a French label, compact and with its confusions mapped', () => {
    expect(readings([line('NO DE PERMIS Tl234-56789O-12', 20, 100, 400)])).toEqual({
      'identification-number': { value: 'T123456789012', via: 'label' },
    });
    expect(
      readings([line('NUMERO DE PERMIS', 20, 100, 300), line('T1234 567890 12', 20, 130, 300)]),
    ).toEqual({ 'identification-number': { value: 'T123456789012', via: 'label' } });
  });
});

describe('parseViz: the Quebec number and layout (C2)', () => {
  const withoutQuebecLine = () => caseLines('phone-ocr').filter((entry) => entry.text !== 'QUEBEC');

  it('reads the number by its pattern without a Quebec signal, but not the names', () => {
    const read = readings(withoutQuebecLine());
    expect(read['identification-number']).toEqual({ value: 'T123456789012', via: 'pattern' });
    expect(read).not.toHaveProperty('name-last');
    expect(read).not.toHaveProperty('name-first');
  });

  it('reads the names by layout when the barcode names Quebec, with no QUEBEC line', () => {
    const read = readings(withoutQuebecLine(), { jurisdiction: { country: 'CA', code: 'QC' } });
    expect(read['name-last']).toEqual({ value: 'TREMBLAY', via: 'layout' });
    expect(read['name-first']).toEqual({ value: 'MARIE', via: 'layout' });
  });

  it('keeps the rule off for another jurisdiction', () => {
    const read = readings(withoutQuebecLine(), { jurisdiction: { country: 'CA', code: 'ON' } });
    expect(read).not.toHaveProperty('name-last');
  });

  it('reads neither name when only one name line qualifies', () => {
    const misread = caseLines('phone-ocr').map((entry) =>
      entry.text === 'MARIE' ? { ...entry, text: 'MAR1E' } : entry,
    );
    expect(readings(misread)).not.toHaveProperty('name-last');
    const missing = caseLines('phone-ocr').filter((entry) => entry.text !== 'MARIE');
    const read = readings(missing);
    expect(read).not.toHaveProperty('name-last');
    expect(read).not.toHaveProperty('name-first');
  });

  it('never overrides a label reading: the label wins and the rule reads neither name', () => {
    const read = readings([...caseLines('phone-ocr'), line('NOM: GAGNON', 600, 600, 200, 16)]);
    expect(read['name-last']).toEqual({ value: 'GAGNON', via: 'label' });
    expect(read).not.toHaveProperty('name-first');
  });

  it('reads no number by the pattern when two lines are Quebec-shaped', () => {
    const lines = [...caseLines('phone-ocr'), line('A9876-543210-98', 600, 600)];
    const read = readings(lines);
    expect(read).not.toHaveProperty('identification-number');
    expect(read).not.toHaveProperty('name-last');
  });

  it('ignores a line beside the column and a line too far below', () => {
    const far = caseLines('phone-ocr').map((entry) =>
      entry.text === 'MARIE' ? { ...entry, box: [408, 400, 100, 24] as const } : entry,
    );
    expect(readings(far)).not.toHaveProperty('name-first');
  });
});
